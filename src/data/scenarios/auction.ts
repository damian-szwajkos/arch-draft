import type { ComponentKind, DiagramNode, Scenario } from '../../engine/types'
import { SYNC_PROTOCOLS } from '../../engine/types'
import { CLIENT_KINDS, COMPUTE_KINDS, DB_KINDS, type Graph } from '../../engine/graph'
import { diagram, external, kindIs, observability, PAYMENT } from './builder'

// ---------------------------------------------------------------------------
// Space-based vocabulary used by the checks:
// - processing units (PUs): whatever owns Live bidding and takes bid requests
//   (services, functions, modules…, including a queue-fed worker), minus
//   broker-fed plumbing that does not own Live bidding;
// - the bid space: caches the PUs read and write (the in-memory data grid);
// - data pumps: brokers the PUs (or the grid) publish to;
// - data writers: broker-fed plumbing (not owning Live bidding) that persists bids to a database;
// - data readers: plumbing that loads a database into the grid.
// ---------------------------------------------------------------------------

const PLUMBING_KINDS: ComponentKind[] = ['worker', 'function', 'stream-processor', 'cdc']
const PU_KINDS: ComponentKind[] = ['service', 'monolith', 'module', 'plugin', 'function', 'worker', 'bff']
const GRID = /grid|space|hazelcast|ignite|geode|gemfire|coherence|infinispan/i
const PARTITIONED = /partition|distribut|shard|owner|affinit/i

const ids = (ns: DiagramNode[]) => new Set(ns.map((n) => n.id))
const labels = (ns: DiagramNode[]) => ns.map((n) => n.label).join(', ')
const text = (n: DiagramNode) => `${n.label} ${n.notes ?? ''}`

/** Broker-fed component nobody calls synchronously: a relay, not a processing unit. */
function isPlumbing(g: Graph, n: DiagramNode): boolean {
  return (
    PLUMBING_KINDS.includes(n.kind) &&
    g.in(n.id, SYNC_PROTOCOLS).length === 0 &&
    g.sources(n.id).some((s) => s.kind === 'broker' || s.kind === 'cdc')
  )
}

/**
 * The processing units: compute that owns Live bidding. Broker-fed plumbing is excluded unless it
 * owns Live bidding itself, so a worker consuming a bid-intake queue still counts as a unit.
 */
function processingUnits(g: Graph): DiagramNode[] {
  return g
    .ownerFamily('bidding')
    .filter((n) => PU_KINDS.includes(n.kind) && !(isPlumbing(g, n) && !n.domains.includes('bidding')))
}

/** Caches the processing units keep live auction state in. */
function bidSpace(g: Graph, pus: DiagramNode[]): DiagramNode[] {
  return g.storesOf(pus, ['cache'])
}

/** Brokers the processing units (or their grid) publish to directly: the data pumps. */
function dataPumps(g: Graph, pus: DiagramNode[], grids: DiagramNode[]): DiagramNode[] {
  const out = new Map<string, DiagramNode>()
  for (const n of [...pus, ...grids]) for (const t of g.targets(n.id, ['event'])) if (t.kind === 'broker') out.set(t.id, t)
  return [...out.values()]
}

/** Plumbing fed asynchronously from the PUs that writes a database. */
function dataWriters(g: Graph, pus: DiagramNode[], grids: DiagramNode[]): DiagramNode[] {
  const puIds = ids(pus)
  return g
    .ofKind(...PLUMBING_KINDS)
    .filter((w) => !puIds.has(w.id) && g.in(w.id, SYNC_PROTOCOLS).length === 0)
    .filter((w) => g.targets(w.id).some(kindIs(...DB_KINDS)))
    .filter((w) => g.asyncFlow([...pus, ...grids], [w]))
}

export const liveAuction: Scenario = {
  id: 'licytuj-live-auction',
  title: 'Licytuj: the last 60 seconds of a live auction',
  tagline: '300 bids a second all day, then 40,000 a second in the final minute. Nobody may lose a bid they won.',
  industry: 'E-commerce',
  difficulty: 'advanced',
  estMinutes: 50,
  accent: '#e11d48',
  concepts: [
    'space-based-architecture',
    'caching-topologies',
    'guaranteed-delivery',
    'realtime',
    'architecture-characteristics',
    'fallacies-of-distributed-computing',
    'concurrency-control',
    'idempotency',
  ],
  story:
    'Licytuj is the live-auction arm of Bazarek, a Polish marketplace with 14 million buyers. Most of the day it is calm: a few thousand auctions tick along at a few hundred bids per second. Then a limited sneaker drop or a charity auction streamed by a popular gamer reaches its final minute, and the same 300 items attract 40,000 bids per second. Last December a charity auction for a children’s hospital melted the PostgreSQL cluster in 50 seconds: every bid locked the "highest bid" row of the same few items, the connection pool ran dry, bids timed out, and two bidders were each told "You are winning" for the same signed football shirt. Watch pages polled every second and added 150,000 requests per second on top. Support extended the auction by hand and spent a week answering complaints. The CTO wants an architecture that treats the finale as the normal case, keeps the database out of the bidding hot path, and still keeps every accepted bid for disputes and payouts.',
  facts: [
    { label: 'Normal load', value: '~6,000 live auctions, 300–500 bids/s across the site' },
    { label: 'Finale', value: '200–400 hot auctions in their last 60 s: up to 40,000 bids/s (~100×), one item alone up to 3,000 bids/s' },
    { label: 'Watchers', value: 'Up to 250,000 concurrent watchers; 180,000 on a single streamed charity auction' },
    { label: 'Latency', value: 'Bid accepted or rejected < 50 ms (p99); new highest bid on every screen ≤ 200 ms (p95)' },
    { label: 'Durability', value: 'Every accepted bid in the bid history within 5 s, kept 5 years for disputes, payouts and tax' },
    { label: 'Team', value: '5 squads, ~40 engineers, Java/Kotlin; a platform team already runs Kafka' },
  ],
  functional: [
    'Sellers schedule auctions with a start and end time, a reserve price and a minimum increment',
    'Bidders bid from the web and the app; each bid is accepted or rejected (too low, auction closed, over the bidder’s limit) on the spot',
    'Soft close: a bid in the last 30 seconds extends the auction by 30 seconds, so sniping does not pay',
    'Everyone watching sees the current price, bid count and countdown change live; an outbid bidder gets a push notification',
    'When an auction closes, the winner is charged, the seller is paid out, and disputes are settled from the full bid history',
  ],
  nonFunctional: [
    'Elasticity, not just scalability: absorb a 100× burst for 60–120 seconds, then shrink back, several times a day',
    'No database read or write on the bid path: PostgreSQL must never see finale-shaped load again',
    'Exactly one highest bid per auction at any moment: two bidders are never both told they are winning',
    'No accepted bid is ever lost, even if a processing unit crashes mid-finale',
    'Watchers see a new highest bid within 200 ms, without polling',
  ],
  constraints: [
    'Bid history and settlement stay in PostgreSQL: finance, audit and the dispute team already rely on it',
    'JVM shop (Java/Kotlin); Kafka is available as a managed internal platform',
    'Hot auctions are scheduled days ahead, so their data can be loaded before the finale starts',
  ],
  domains: [
    { id: 'catalogue', label: 'Auction catalogue', description: 'Listings, schedules, reserve prices, seller setup' },
    { id: 'bidding', label: 'Live bidding', description: 'Accepting and rejecting bids, highest bid, soft close' },
    { id: 'watchers', label: 'Live feed & outbid alerts', description: 'Pushing prices and countdowns to watchers, outbid notifications' },
    { id: 'settlement', label: 'Settlement & payouts', description: 'Charging winners, paying sellers, disputes from the bid history' },
  ],
  recommendedStyles: ['space-based'],
  styleFeedback: {
    'space-based':
      'Best fit: the finale is a short, extreme burst of concurrent writes to a small set of hot items. Processing units that keep auctions in an in-memory data grid scale out ahead of each scheduled finale and back afterwards, and data pumps carry bids to the database at its own pace, so Postgres never sees the spike.',
    'event-driven':
      'Halfway there: the data pumps are events, and settlement and the live feed react to them. But if each bid consumer still has to read and update the highest bid in PostgreSQL, the database remains the bottleneck. Once you keep that state in memory next to the logic, you have built space-based architecture.',
    microservices:
      'Splitting bidding into fine-grained services, each with its own database, still puts a database round trip on every bid, and adding service-to-service calls eats into the 50 ms budget. Scaling database-bound services out for 60 seconds only moves the contention to more connections.',
    'service-based':
      'A few coarse services sharing one PostgreSQL is a good shape for catalogue and settlement, but it is exactly the shared database that melted last December. The bid path needs to leave the database entirely.',
    monolith:
      'This is what failed: every bid goes through the presentation, business and persistence layers to the same Postgres rows. Adding more instances of the monolith only adds more database connections fighting for the same row locks.',
    'modular-monolith':
      'Clean module boundaries help the teams, but one deployable and one database cannot scale bidding 100× for one minute without scaling everything else, and every bid still locks a row in Postgres.',
    serverless:
      'Functions scale out fast, but they are stateless: every invocation must read and conditionally update the highest bid in a database. A hot sneaker auction concentrates thousands of writes per second on one key, past a single DynamoDB partition’s write limit (~1,000 writes/s), and cold starts land in the busiest minute.',
    microkernel:
      'Auction formats (English, Dutch, buy-now) could be plug-ins, but a plug-in core is about customisation, not elasticity. The core and its plug-ins would still share one process and one database during the finale.',
  },
  starter: diagram(
    [
      ['web', 'web-app', 'Licytuj Web', 0, 0, { tech: 'nextjs' }],
      ['app', 'mobile-app', 'Licytuj App', 0, 140, { tech: 'react-native' }],
      ['lb', 'load-balancer', 'Load Balancer', 280, 70, { tech: 'nginx' }],
      ['mono', 'monolith', 'Licytuj Monolith', 560, -40, { tech: 'spring-boot', w: 480, h: 400 }],
      ['catalogue', 'module', 'Catalogue', 140, 40, { parent: 'mono', tech: 'spring-boot', domains: ['catalogue'] }],
      ['bidding', 'module', 'Bidding', 140, 125, { parent: 'mono', tech: 'spring-boot', domains: ['bidding'] }],
      ['watch', 'module', 'Watch Page API', 140, 210, { parent: 'mono', tech: 'spring-boot', domains: ['watchers'] }],
      ['settle', 'module', 'Settlement', 140, 295, { parent: 'mono', tech: 'spring-boot', domains: ['settlement'] }],
      ['pg', 'relational-db', 'Auctions DB', 1160, 140, { tech: 'postgres', notes: 'SELECT … FOR UPDATE on the highest-bid row of every bid' }],
    ],
    [
      ['web', 'lb', 'http', 'bids · poll price every 1 s'],
      ['app', 'lb', 'http', 'bids · poll price every 1 s'],
      ['lb', 'mono', 'http'],
      ['catalogue', 'pg'],
      ['bidding', 'pg', 'data', 'lock row, insert bid'],
      ['watch', 'pg', 'data', 'SELECT current price'],
      ['settle', 'pg'],
    ],
  ),
  starterDecisions: {
    style: 'monolith',
    communication: 'sync',
    data: 'shared',
    stack: { backend: 'spring-boot', database: 'postgres', frontend: 'nextjs', mobile: 'react-native' },
    rationale: 'One Spring Boot application and one PostgreSQL. Every bid locks the auction row; watch pages poll the price.',
  },
  hints: [
    'Look at where the time goes in the finale: 40,000 bids per second compete for a few hundred rows. What if the current state of each live auction never left memory?',
    'In space-based architecture, processing units (services holding the bidding logic) read and update the auction in an in-memory data grid such as Hazelcast, Apache Ignite or Apache Geode. No database call on the bid path.',
    'Memory is not durable. Every accepted bid goes onto a data pump (a broker such as Kafka), and a data writer consumes it and inserts into PostgreSQL at the pace the database can take.',
    'The grid starts empty. A data reader loads tomorrow’s hot auctions (and, after a crash, their bids) from the database into the grid before the finale.',
    'With a replicated cache, every processing unit holds a full copy and updates are copied asynchronously, so two instances can accept competing bids on the same item. For a hot, write-heavy item, use a partitioned map where each auction has one owner.',
    'Watchers should not poll. Publish each new highest bid through the pump to a WebSocket gateway (Centrifugo, Spring WebSocket) that fans it out to every screen.',
  ],
  checks: [
    {
      id: 'bids-in-memory',
      title: 'Bids are processed against an in-memory data grid, not the database',
      category: 'core',
      why: 'Space-based architecture removes the database from the transactional path: the processing unit validates the bid against auction state held in memory (the "space") and replies as soon as the event is safely on the data pump. Reading or locking a row on every bid, directly or through another service, puts the finale back onto PostgreSQL, and that is the bottleneck that melted last December.',
      hint: 'Give Live bidding to a processing unit (service) that has a Data edge to a Cache / data grid (Hazelcast, Ignite, Geode) and no Data edge to a database, and no synchronous call to anything that has one.',
      concepts: ['space-based-architecture', 'caching', 'concurrency-control'],
      test: (g) => {
        const pus = processingUnits(g)
        if (!pus.length) return { pass: false, detail: 'No processing unit owns Live bidding: assign it to the service the gateway sends bids to.' }
        if (!bidSpace(g, pus).length)
          return { pass: false, detail: `${labels(pus)} keep no state in memory, so every bid has to go to a database.` }
        const direct = pus.filter((p) => g.targets(p.id, ['data']).some(kindIs(...DB_KINDS)))
        if (direct.length)
          return { pass: false, detail: `${labels(direct)} still read or write a database on every bid. At 40,000 bids/s the database becomes the bottleneck again.` }
        const viaHop = g.reaches(pus, kindIs(...DB_KINDS), {
          through: [...COMPUTE_KINDS, 'cache'],
          protocols: [...SYNC_PROTOCOLS, 'data'],
          maxDepth: 4,
        })
        return viaHop
          ? {
              pass: false,
              detail: `The bid path still reaches ${viaHop.label} synchronously (through another service, or a grid that writes through). Persist through a data pump instead.`,
            }
          : { pass: true }
      },
    },
    {
      id: 'data-pump-writer',
      title: 'Data pumps carry accepted bids to a data writer',
      category: 'core',
      why: 'The grid is fast but volatile, and the bid history must last five years. In space-based architecture, processing units hand each change to a data pump (an asynchronous broker), and a separate data writer drains it into the database. In the finale the pump only builds a backlog that the writer works through in seconds; the bidder waits only for the pump’s acknowledgement, never for the writer or the database.',
      hint: 'Bidding processing unit → broker (Kafka) → Data writer (worker) → PostgreSQL. Nobody calls the writer synchronously.',
      concepts: ['space-based-architecture', 'guaranteed-delivery', 'queue-load-leveling'],
      test: (g) => {
        const pus = processingUnits(g)
        if (!pus.length) return { pass: false, detail: 'No processing unit owns Live bidding yet.' }
        const grids = bidSpace(g, pus)
        if (!dataPumps(g, pus, grids).length)
          return { pass: false, detail: 'Accepted bids are not published to a data pump (broker) that carries them to the database.' }
        if (!dataWriters(g, pus, grids).length)
          return {
            pass: false,
            detail: 'No data writer persists bids: a worker should consume the pump and write the bid history to the database, and nobody should call it synchronously.',
          }
        return { pass: true }
      },
    },
    {
      id: 'watchers-realtime',
      title: 'Watchers get new prices pushed through a realtime gateway',
      category: 'core',
      why: 'Polling 250,000 watch pages every second is 250,000 requests per second of pure overhead, and still up to a second late. A WebSocket gateway fed straight from the processing units or their data pump pushes each new highest bid to every screen within milliseconds, and the bidding side never sees the watchers.',
      hint: 'Bidding processing unit → data pump → (Live feed service) → Realtime gateway ← web / app over WebSocket. Do not feed it from the database.',
      concepts: ['realtime', 'fan-out'],
      test: (g) => {
        const rtgs = g.ofKind('realtime-gateway')
        if (!rtgs.length) return { pass: false, detail: 'No realtime gateway, so 250,000 watchers would have to poll.' }
        const pus = processingUnits(g)
        if (!pus.length) return { pass: false, detail: 'No processing unit owns Live bidding yet.' }
        const first = ids([...pus, ...dataPumps(g, pus, bidSpace(g, pus))])
        const relayKinds: ComponentKind[] = ['worker', 'function', 'stream-processor', 'service', 'broker', 'bff']
        const second = ids(g.nodes.filter((n) => relayKinds.includes(n.kind) && !first.has(n.id) && g.sources(n.id).some((s) => first.has(s.id))))
        const fed = rtgs.filter((r) => g.sources(r.id).some((s) => first.has(s.id) || second.has(s.id)))
        if (!fed.length)
          return {
            pass: false,
            detail: 'The realtime gateway is not fed by the processing units or their data pump, so a new price reaches watchers late (or only after the database has it).',
          }
        const fedIds = ids(fed)
        const reached = g
          .ofKind(...CLIENT_KINDS)
          .some(
            (c) =>
              g.targets(c.id).some((t) => fedIds.has(t.id)) ||
              !!g.reaches(c, (t) => fedIds.has(t.id), { through: ['cdn', 'load-balancer', 'waf'], maxDepth: 3 }) ||
              fed.some((r) => g.targets(r.id).some((t) => t.id === c.id)),
          )
        return reached ? { pass: true } : { pass: false, detail: 'No web or app client connects to the realtime gateway.' }
      },
    },
    {
      id: 'settlement-async',
      title: 'Settlement works from durable data, in an ACID store',
      category: 'core',
      why: 'Charging a winner and paying a seller must be exactly right and must survive a restart, while the grid only holds the live state. Settlement reacts to "AuctionClosed" through the pump (or reads the persisted bid history) and records payments in a transactional ledger. Asking the processing units synchronously for the winner couples money to volatile memory and puts settlement traffic on the hot path.',
      hint: 'Data pump → Settlement & payouts → relational database (PostgreSQL). No synchronous calls from Settlement to the bidding units.',
      concepts: ['acid-vs-base', 'event-driven', 'guaranteed-delivery'],
      test: (g) => {
        const settle = g.ownerFamily('settlement')
        if (!settle.length) return { pass: false, detail: 'Nobody owns Settlement & payouts.' }
        const pus = processingUnits(g).filter((p) => !settle.includes(p))
        const puIds = ids(pus)
        if (settle.some((s) => g.targets(s.id, SYNC_PROTOCOLS).some((t) => puIds.has(t.id))))
          return { pass: false, detail: 'Settlement asks the bidding units for results synchronously. Let it react to AuctionClosed events instead.' }
        const grids = bidSpace(g, pus)
        const writtenDbs = ids(dataWriters(g, pus, grids).flatMap((w) => g.targets(w.id).filter(kindIs(...DB_KINDS))))
        const readsHistory = g.storesOf(settle, DB_KINDS).some((s) => writtenDbs.has(s.id))
        if (!(pus.length && g.asyncFlow([...pus, ...grids], settle)) && !readsHistory)
          return { pass: false, detail: 'Settlement is neither driven by AuctionClosed events from the pump nor reads the bid history kept by a data writer.' }
        const acid = g.storesOf(settle, DB_KINDS).filter((s) => s.kind === 'relational-db' || g.hasTrait(s, 'acid'))
        return acid.length
          ? { pass: true }
          : { pass: false, detail: 'Settlement has no ACID store: charges and payouts need transactions, not best-effort writes.' }
      },
    },
    {
      id: 'grid-topology',
      title: 'A partitioned data grid holds the hot auctions',
      category: 'bonus',
      why: 'With a replicated cache, every processing unit holds a full copy and changes travel to the other copies asynchronously. Two instances can accept competing bids on the same auction inside that window, and both bidders are told they are winning: a data collision. The odds grow with the update rate, the number of instances and the replication delay, so a sneaker drop at 3,000 bids/s on one item makes it near certain. A partitioned (distributed) grid gives each auction one owning member, and an entry processor applies the bid there atomically. Replication still suits read-mostly reference data such as the catalogue snapshot.',
      hint: 'Pick an in-memory data grid (Hazelcast, Apache Ignite, Apache Geode) for the bid space, and keep hot bids in a partitioned map rather than a replicated one.',
      concepts: ['caching-topologies', 'concurrency-control', 'cap-theorem'],
      test: (g) => {
        const grids = bidSpace(g, processingUnits(g))
        if (!grids.length) return { pass: false, detail: 'The bidding units use no in-memory store yet.' }
        const isGrid = (n: DiagramNode) => g.hasTrait(n, 'in-memory-data-grid') || (!n.tech && GRID.test(n.label))
        const real = grids.filter(isGrid)
        if (!real.length)
          return {
            pass: false,
            detail: `${labels(grids)} is a client-server cache: workable as a distributed cache, but a data grid gives partition ownership, near caches and entry processors that apply the bid next to the data.`,
          }
        const replicatedOnly = real.filter((n) => /replicat/i.test(text(n)) && !PARTITIONED.test(text(n)))
        return replicatedOnly.length
          ? {
              pass: false,
              detail: `${labels(replicatedOnly)} replicates hot bids to every unit, so two units can accept competing bids on the same item (data collisions). Partition the bid map by auction id.`,
            }
          : { pass: true }
      },
    },
    {
      id: 'grid-preload',
      title: 'A data reader loads the grid before the finale',
      category: 'bonus',
      why: 'The grid starts empty after a deploy or a crash. A data reader loads tomorrow’s scheduled hot auctions and, after a restart, their accepted bids from the database into the space, so processing units never fall back to querying PostgreSQL in the busiest minute of the day.',
      hint: 'Add a Data reader worker that reads the catalogue / bid history database and writes into the grid (or publishes to a pump the processing units consume).',
      concepts: ['space-based-architecture', 'caching'],
      test: (g) => {
        const pus = processingUnits(g)
        const grids = bidSpace(g, pus)
        if (!grids.length) return { pass: false, detail: 'No grid yet.' }
        const gridIds = ids(grids)
        const puIds = ids(pus)
        const feedsUnits = (b: DiagramNode) => b.kind === 'broker' && g.targets(b.id, ['event']).some((t) => puIds.has(t.id))
        const readers = g
          .ofKind(...PLUMBING_KINDS)
          .filter((n) => !puIds.has(n.id))
          .filter((n) => g.targets(n.id).some(kindIs(...DB_KINDS)) || g.sources(n.id).some(kindIs(...DB_KINDS)))
          .filter((n) => g.targets(n.id).some((t) => gridIds.has(t.id)) || g.targets(n.id, ['event']).some(feedsUnits))
        return readers.length
          ? { pass: true }
          : { pass: false, detail: 'Nothing loads the grid from the database, so a restarted unit starts with no auctions.' }
      },
    },
    {
      id: 'pump-guaranteed',
      title: 'The data pump never drops a bid',
      category: 'bonus',
      why: 'Between the grid and the database, the pump is the only copy of an accepted bid. It needs persistent messages and acknowledgements (a durable log or a persistent queue), so a data writer that restarts mid-finale picks up where it left off. Fire-and-forget pub/sub silently loses whatever was published while the writer was down.',
      hint: 'Use Kafka, Redpanda, Pulsar or a persistent RabbitMQ queue for the data pump. Avoid Redis Pub/Sub or MQTT for this job.',
      concepts: ['guaranteed-delivery', 'kafka-vs-rabbitmq'],
      test: (g) => {
        const pus = processingUnits(g)
        const pumps = dataPumps(g, pus, bidSpace(g, pus))
        if (!pumps.length) return { pass: false, detail: 'No data pump yet.' }
        const weak = pumps.filter((b) => !g.hasTrait(b, 'log', 'replayable', 'queue', 'jms', 'managed'))
        return weak.length
          ? {
              pass: false,
              detail: weak.some((b) => b.tech)
                ? `${labels(weak)} can drop bids when a consumer is offline: pick a durable log or persistent queue.`
                : `Choose a technology for ${labels(weak)}.`,
            }
          : { pass: true }
      },
    },
    {
      id: 'bid-gateway',
      title: 'Bids enter through a rate-limited messaging grid',
      category: 'bonus',
      why: 'In space-based terms the messaging grid receives requests and routes them to an available processing unit, ideally the one that owns the auction. A gateway with per-bidder rate limits also stops bid bots from flooding the finale with thousands of requests a second.',
      hint: 'Clients → API gateway / load balancer with rate limiting (Envoy, Kong, NGINX) → Bidding processing units. No client calls a unit directly.',
      concepts: ['api-gateway', 'rate-limiting', 'space-based-architecture'],
      test: (g) => {
        const pus = processingUnits(g)
        if (!pus.length) return { pass: false, detail: 'No processing unit owns Live bidding yet.' }
        const puIds = ids(pus)
        const direct = g.ofKind(...CLIENT_KINDS).filter((c) => g.targets(c.id, SYNC_PROTOCOLS).some((t) => puIds.has(t.id)))
        if (direct.length) return { pass: false, detail: `${labels(direct)} call the bidding units directly.` }
        const viaIntake = (p: DiagramNode) =>
          g.sources(p.id, ['event']).filter((b) => b.kind === 'broker').flatMap((b) => g.sources(b.id))
        const entries = pus
          .flatMap((p) => [
            ...g.sources(p.id, SYNC_PROTOCOLS),
            ...(p.parentId ? g.sources(p.parentId, SYNC_PROTOCOLS) : []),
            ...viaIntake(p),
          ])
          .filter(kindIs('api-gateway', 'load-balancer'))
        if (!entries.length) return { pass: false, detail: 'Bids do not reach the processing units through a gateway or load balancer.' }
        return entries.some((e) => !e.tech || g.hasTrait(e, 'rate-limiting'))
          ? { pass: true }
          : { pass: false, detail: 'The bid entry point has no rate limiting, so bots can flood the finale.' }
      },
    },
    {
      id: 'payouts-psp',
      title: 'Winners pay and sellers get paid through a payment provider',
      category: 'bonus',
      why: 'Settlement charges the winner and pays the seller through a PSP. Driven by events, a slow provider never touches bidding, and an idempotency key per auction makes a retried charge safe.',
      hint: 'Settlement & payouts → payment provider (Przelewy24, PayU, Stripe, Adyen).',
      concepts: ['idempotency'],
      test: (g) => {
        const settle = g.ownerFamily('settlement')
        if (!settle.length) return { pass: false, detail: 'Nobody owns Settlement & payouts.' }
        return g.calls(settle, external(g, 'payment', PAYMENT))
          ? { pass: true }
          : { pass: false, detail: 'Settlement is not connected to a payment provider.' }
      },
    },
    {
      id: 'finale-observability',
      title: 'Finale metrics and alerting',
      category: 'bonus',
      why: 'During the finale you watch bid latency, grid memory, pump lag and writer throughput against an SLO. A growing pump lag is fine for a minute; one that never shrinks means bids are not reaching the database and needs a page.',
      hint: 'Add Metrics and Alerting, and send telemetry from most services and workers.',
      concepts: ['observability', 'slo'],
      test: (g) => {
        const base = observability(g, 'metrics', 'alerting')
        if (!base.pass) return base
        const compute = g.ofKind('service', 'worker', 'function', 'monolith', 'bff')
        const instrumented = g.instrumented().filter((n) => compute.includes(n)).length
        return compute.length && instrumented >= Math.ceil(compute.length / 2)
          ? { pass: true }
          : { pass: false, detail: `${instrumented}/${compute.length} services and workers export telemetry.` }
      },
    },
    {
      id: 'anti-pu-sync-calls',
      title: 'Processing units do not call other services synchronously',
      category: 'antipattern',
      why: 'A processing unit is self-sufficient: everything it needs to decide a bid (auction, reserve price, bidder limit) is already in the grid. Each synchronous call to another service adds latency, a failure point and a dependency that must scale 100× too, because the network is neither instant nor reliable.',
      hint: 'Load what the bid needs (catalogue data, bidder limits) into the grid with a data reader, and publish changes through the pump instead of calling other services.',
      concepts: ['space-based-architecture', 'fallacies-of-distributed-computing'],
      test: (g) => {
        const bad = processingUnits(g).flatMap((p) =>
          g
            .targets(p.id, SYNC_PROTOCOLS)
            .filter((t) => COMPUTE_KINDS.includes(t.kind) && g.deployable(t).id !== g.deployable(p).id)
            .map((t) => `${p.label} → ${t.label}`),
        )
        return bad.length ? { pass: false, detail: `Synchronous calls on the bid path: ${bad.join(', ')}.` } : { pass: true }
      },
    },
  ],
  inspiration: [
    { label: 'Mark Richards — Lesson 166: Space-Based Architecture', url: 'https://www.developertoarchitect.com/lessons/lesson166.html' },
    { label: 'Mark Richards — Lesson 174: Replicated Caching and Data Collisions', url: 'https://www.developertoarchitect.com/lessons/lesson174.html' },
    { label: 'Hazelcast docs — Replicated Map', url: 'https://docs.hazelcast.com/hazelcast/5.5/data-structures/replicated-map' },
    { label: 'Apache Ignite docs — Data Partitioning', url: 'https://ignite.apache.org/docs/latest/data-modeling/data-partitioning' },
  ],
  reference: {
    decisions: {
      style: 'space-based',
      communication: 'hybrid',
      data: 'cqrs',
      stack: { backend: 'spring-boot', frontend: 'nextjs', mobile: 'react-native', database: 'postgres', messaging: 'kafka', cache: 'hazelcast' },
      rationale:
        'Bidding processing units decide every bid against a partitioned Hazelcast grid and reply without touching PostgreSQL. Kafka data pumps carry BidAccepted and AuctionClosed to a data writer, the live feed and settlement. A data reader preloads scheduled auctions, so the units scale out and back for each finale while the database only sees a steady stream of inserts.',
    },
    walkthrough: [
      'Bids arrive through Envoy (the messaging grid), which applies per-bidder rate limits and routes each auction to the processing unit that owns its partition. A Bidding processing unit is a Spring Boot service with an embedded Hazelcast member. It runs the bid as an entry processor on the auction’s partition owner (check the increment, the reserve and the bidder limit, apply the soft close). The unit replies only after Kafka has acknowledged the event (acks=all, idempotent producer, a few ms inside the 50 ms budget), so a crash never loses an accepted bid. If Kafka does not acknowledge in time, the unit reverts the entry and rejects the bid, so the grid never holds a bid the history will not.',
      'The bid space is a partitioned IMap keyed by auction id with one synchronous backup, so exactly one member decides each auction and a crashed member’s auctions fail over to the backup. Read-mostly reference data (catalogue snapshot, bidder limits) sits in a ReplicatedMap, where collisions do not matter because it is almost never written during the finale.',
      'Every accepted bid and every close is published to Kafka (the data pump), keyed by auction id so bids of one auction stay in order. The Data writer consumes in batches and inserts into the Bid History database with an idempotent key (auction id + bid sequence), so a redelivered message is harmless. In the finale the pump lag grows for a few seconds and then shrinks, well inside the 5-second target.',
      'Ten minutes before a scheduled hot auction starts, the Data reader loads it from the Catalogue DB into the grid; after a restart it also reloads accepted bids from the Bid History DB. Processing units therefore never query PostgreSQL. Because hot auctions are scheduled, units are scaled out a few minutes before each finale (partition migration happens before the burst, not during it) and scaled back afterwards.',
      'The Live feed service consumes the same pump, publishes each new price to Centrifugo channels that 250,000 watchers hold open over WebSocket, and sends outbid pushes through FCM. Settlement consumes AuctionClosed, checks the winning bid against the persisted history, records the charge and payout in its own PostgreSQL ledger and calls Przelewy24 with an idempotency key.',
      'Trade-offs: space-based architecture is the hardest style here to build and test. The grid needs careful memory sizing, the data in PostgreSQL is a few seconds behind the grid, and a finale has to be load-tested end to end. That is the price of making 100× bursts routine, which is why the low-traffic catalogue stays a plain service with its own database.',
    ],
    diagram: diagram(
      [
        ['web', 'web-app', 'Licytuj Web', 0, -70, { tech: 'nextjs' }],
        ['app', 'mobile-app', 'Licytuj App', 0, 70, { tech: 'react-native' }],
        ['stream', 'web-app', 'Charity Stream Overlay', 0, 280, { tech: 'react' }],
        ['gw', 'api-gateway', 'Messaging Grid (Gateway)', 280, 0, { tech: 'envoy', notes: 'Routes bids by auction id; per-bidder rate limits' }],
        ['rtg', 'realtime-gateway', 'Live Price Feed', 280, 280, { tech: 'centrifugo', notes: 'One channel per auction' }],
        ['catalogue', 'service', 'Auction Catalogue', 560, -140, { tech: 'spring-boot', domains: ['catalogue'] }],
        [
          'bidPU',
          'service',
          'Bidding Processing Unit ×N',
          560,
          0,
          { tech: 'spring-boot', domains: ['bidding'], notes: 'Embedded Hazelcast member; scales out for each finale' },
        ],
        ['feed', 'service', 'Live Feed & Outbid', 560, 280, { tech: 'go', domains: ['watchers'] }],
        ['push', 'external', 'Outbid Push', 560, 420, { tech: 'fcm' }],
        ['catDb', 'relational-db', 'Catalogue DB', 860, -140, { tech: 'postgres' }],
        [
          'grid',
          'cache',
          'Bid Space (Data Grid)',
          860,
          0,
          { tech: 'hazelcast', notes: 'Partitioned IMap by auction id, 1 sync backup; catalogue snapshot in a ReplicatedMap' },
        ],
        ['kafka', 'broker', 'Data Pump (bid events)', 860, 140, { tech: 'kafka', notes: 'Keyed by auction id; acks=all, idempotent producer' }],
        ['reader', 'worker', 'Data Reader (grid loader)', 1160, -140, { tech: 'spring-boot' }],
        ['writer', 'worker', 'Data Writer', 1160, 140, { tech: 'spring-boot', notes: 'Batched, idempotent inserts' }],
        ['settle', 'service', 'Settlement & Payouts', 1160, 280, { tech: 'spring-boot', domains: ['settlement'] }],
        ['bidDb', 'relational-db', 'Bid History DB', 1460, 140, { tech: 'postgres', notes: 'Append-only, partitioned by month, 5-year retention' }],
        ['settleDb', 'relational-db', 'Settlement Ledger', 1460, 280, { tech: 'postgres' }],
        ['psp', 'external', 'Przelewy24 (charges & payouts)', 1460, 420, { tech: 'przelewy24' }],
        ['metrics', 'metrics', 'Metrics', 560, 560, { tech: 'prometheus' }],
        ['alerts', 'alerting', 'Finale Alerts', 860, 560, { tech: 'grafana' }],
      ],
      [
        ['web', 'gw', 'http', 'browse · place bid'],
        ['app', 'gw', 'http', 'browse · place bid'],
        ['web', 'rtg', 'websocket'],
        ['app', 'rtg', 'websocket'],
        ['stream', 'rtg', 'websocket'],
        ['gw', 'catalogue', 'http'],
        ['gw', 'bidPU', 'http', 'POST /bids (by auction id)'],
        ['catalogue', 'catDb'],
        ['bidPU', 'grid', 'data', 'entry processor on the auction'],
        ['bidPU', 'kafka', 'event', 'BidAccepted · AuctionClosed (acks=all)'],
        ['kafka', 'writer', 'event'],
        ['writer', 'bidDb', 'data', 'batched inserts'],
        ['kafka', 'feed', 'event'],
        ['feed', 'rtg', 'http', 'publish price'],
        ['feed', 'push', 'http', 'you were outbid'],
        ['kafka', 'settle', 'event', 'AuctionClosed'],
        ['settle', 'settleDb'],
        ['settle', 'bidDb', 'data', 'verify winning bid'],
        ['settle', 'psp', 'http', 'charge · pay out'],
        ['reader', 'catDb', 'data', 'auctions starting soon'],
        ['reader', 'bidDb', 'data', 'reload after restart'],
        ['reader', 'grid', 'data', 'preload'],
        ['catalogue', 'metrics', 'telemetry'],
        ['bidPU', 'metrics', 'telemetry'],
        ['feed', 'metrics', 'telemetry'],
        ['writer', 'metrics', 'telemetry'],
        ['reader', 'metrics', 'telemetry'],
        ['settle', 'metrics', 'telemetry'],
        ['metrics', 'alerts', 'telemetry'],
      ],
    ),
  },
}

import type { ComponentKind, DiagramNode, Scenario } from '../../engine/types'
import { SYNC_PROTOCOLS } from '../../engine/types'
import { CLIENT_KINDS, Graph } from '../../engine/graph'
import { diagram, kindIs, observability } from './builder'

/** A replayable log (Kafka, Redpanda…). An untyped broker gets the benefit of the doubt. */
const isLog = (g: Graph) => (n: DiagramNode) => n.kind === 'broker' && (!n.tech || g.hasTrait(n, 'replayable'))

/** A warehouse without real-time ingestion (Snowflake, BigQuery, Redshift). */
const isBatchWarehouse = (g: Graph, n: DiagramNode) =>
  n.kind === 'analytics-db' && !!n.tech && g.hasTrait(n, 'warehouse') && !g.hasTrait(n, 'realtime-analytics')

/** Stores that can serve per-minute counts within seconds of the event. */
const isServingStore = (g: Graph) => (n: DiagramNode) =>
  (n.kind === 'analytics-db' && !isBatchWarehouse(g, n)) || n.kind === 'wide-column' || n.kind === 'document-db'

const PLUMBING: ComponentKind[] = ['broker', 'cdc', 'worker', 'function', 'stream-processor']
const EDGE: ComponentKind[] = ['cdn', 'waf', 'load-balancer', 'api-gateway']
/** Hops that do not make a synchronous call any less synchronous. */
const PROXIES: ComponentKind[] = ['api-gateway', 'load-balancer', 'bff']
/** Relays that copy a log somewhere else without turning it into something new. */
const ARCHIVERS: ComponentKind[] = ['cdc', 'worker', 'function', 'stream-processor']

const AGG_STORE_KINDS: ComponentKind[] = ['analytics-db', 'wide-column', 'document-db']
const CONFIG_STORE = /campaign|config|creative|targeting|catalog|setting|inventory/i
const COUNTER_WRITE = /\bclick|\bcount|impression|\bevent|\bspend|beacon|\+\s*1/i

/** The same graph with some nodes (and their edges) removed, for "is there a path that avoids X?" questions. */
function without(g: Graph, ids: Set<string>) {
  return new Graph({ nodes: g.nodes.filter((n) => !ids.has(n.id)), edges: g.edges }, g.decisions)
}

const idSet = (nodes: DiagramNode[]) => new Set(nodes.map((n) => n.id))

/**
 * Replayable logs that click & impression beacons are appended to by the ingest
 * owner, plus mirrors of them (MirrorMaker / replication into another cluster).
 */
function clickLogs(g: Graph): DiagramNode[] {
  const found = new Map<string, DiagramNode>()
  const queue = g.ownerFamily('click-ingest').flatMap((n) => g.targets(n.id)).filter(isLog(g))
  while (queue.length) {
    const log = queue.shift()!
    if (found.has(log.id)) continue
    found.set(log.id, log)
    for (const t of g.targets(log.id)) {
      if (isLog(g)(t)) queue.push(t)
      else if (t.kind === 'cdc') queue.push(...g.targets(t.id).filter(isLog(g)))
    }
  }
  return [...found.values()]
}

/** Stream processors attached to the click log (in either drawn direction). */
function clickJobs(g: Graph, logs: DiagramNode[]) {
  const ids = idSet(logs)
  return g.ofKind('stream-processor').filter((sp) => g.neighbours(sp.id).some((n) => ids.has(n.id)))
}

/**
 * Stores the click jobs' output lands in (directly, or via an aggregates topic
 * or connector), never by going back through the raw click log itself.
 */
function aggregateStores(g: Graph, jobs: DiagramNode[], logs: DiagramNode[]) {
  if (!jobs.length) return []
  const sub = without(g, idSet(logs))
  return sub
    .ofKind(...AGG_STORE_KINDS)
    .filter((s) => !!sub.reaches(jobs, (n) => n.id === s.id, { through: ['broker', 'cdc'], maxDepth: 3 }))
}

/** The hot path: serving ads and accepting click / impression beacons. */
function hotPath(g: Graph) {
  const ids = new Map<string, DiagramNode>()
  for (const n of [...g.ownerFamily('ad-serving'), ...g.ownerFamily('click-ingest')]) ids.set(n.id, n)
  return [...ids.values()]
}

export const adClicks: Scenario = {
  id: 'clickstream-billing',
  title: 'Klikbit: bill every click exactly once',
  tagline: '50,000 events a second, two regions, duplicates everywhere. Every click billed once, every budget stopped on time.',
  industry: 'AdTech',
  difficulty: 'advanced',
  estMinutes: 50,
  accent: '#be123c',
  concepts: ['stream-processing', 'idempotency', 'event-sourcing', 'backpressure', 'kafka-vs-rabbitmq', 'cqrs'],
  story:
    'Klikbit is a Kraków ad network serving ads on 9,000 publisher sites and apps for 4,000 advertisers in Europe and the US. Billing today is a MySQL table updated with "clicks = clicks + 1" for every click. On last Black Friday it fell 40 minutes behind, campaigns kept running long after their budgets were gone, and Klikbit had to write off 310,000 PLN of free clicks. Mobile SDK retries mean some clicks are counted twice, and one advertiser’s audit found 3% duplicates on its invoice. Finance cannot recompute a disputed day because the raw events are never kept. The CFO wants every click billed exactly once, and the ad-serving team will block any design that slows down ad responses.',
  facts: [
    { label: 'Traffic', value: '50k click + impression events/s at peak (~1.2 bn/day), eu-central and us-east' },
    { label: 'Freshness', value: 'Budgets stop campaigns ≤ 60 s after exhaustion; dashboards ≤ 2 min behind' },
    { label: 'Data', value: '~1.5 TB raw events/day, 13-month immutable retention for audits' },
    { label: 'Team', value: '5 squads, ~35 engineers; Go on the hot path, Kotlin back-office; ad response p99 < 50 ms' },
  ],
  functional: [
    'Serve ads and record impressions and clicks from publisher sites and mobile SDKs',
    'Redirect every click to the advertiser’s landing page in under 100 ms',
    'Advertisers see per-minute impressions, clicks and spend per ad in the console',
    'Pause a campaign within 1 minute of its daily or lifetime budget running out',
    'Nightly reconciliation produces invoices, and finance can recompute any past day from raw events',
  ],
  nonFunctional: [
    'Each click billed exactly once despite SDK retries, duplicate beacons and consumer restarts',
    'Late events (up to 1 h from offline phones) count in the minute they happened, not the minute they arrived',
    'Ad serving p99 < 50 ms and never blocked by billing, reporting or a lagging consumer',
    'A stream-processor outage loses nothing: the pipeline catches up from the log afterwards',
    'Raw events are immutable and kept 13 months for audits and disputes',
  ],
  constraints: [
    'Both regions already run Kafka clusters; a log that is not Kafka-compatible needs a strong reason',
    'Finance only accepts invoice figures from an ACID store they can audit',
    'Managed Kubernetes in two regions; no per-click calls to external services',
  ],
  domains: [
    { id: 'ad-serving', label: 'Ad serving', description: 'Pick an ad for each request and record the impression' },
    { id: 'click-ingest', label: 'Click & impression ingest', description: 'Accept beacons, verify the event id minted before the first send, append to the log, redirect clicks' },
    { id: 'campaigns', label: 'Campaign management', description: 'Advertisers set up campaigns, creatives and budgets' },
    { id: 'budget-pacing', label: 'Budget & pacing', description: 'Track spend against budgets and pause exhausted campaigns' },
    { id: 'reporting', label: 'Advertiser reporting', description: 'Per-minute counts and spend per ad for the console' },
    { id: 'billing', label: 'Billing & reconciliation', description: 'Nightly reconciliation, invoices and recomputing past days' },
  ],
  recommendedStyles: ['event-driven'],
  styleFeedback: {
    'event-driven':
      'Strong fit: clicks and impressions are immutable facts. A replayable log lets dashboards, budgets and billing each consume them at their own pace, and lets you replay a day when something goes wrong.',
    microservices:
      'Splitting serving, ingest, budgets and billing is right, but if they talk by synchronous calls, every click becomes a chain of requests and a slow billing service slows down ad responses. The hub has to be an event log.',
    'modular-monolith':
      'Clean modules suit the advertiser back-office, but 50k events/s of stateful aggregation and a 50 ms ad path in the same deployable means a reporting query or a GC pause hurts revenue directly.',
    monolith:
      'That is today’s system: one database row updated per click, 40 minutes of lag on Black Friday, and no raw events to recompute from.',
    serverless:
      'A function is a fine lightweight ingest endpoint, but exactly-once windowed aggregation needs long-lived state and checkpoints. Stateless functions with per-invocation state lookups will not do that at 50k events/s.',
  },
  hints: [
    'Separate the hot path (serve the ad, accept the click, redirect) from everything that counts money. Give every event its id before the first send (the ad server signs one into the click URL, or the SDK generates a UUID), so a retry carries the same id and ingest only verifies it and appends to a log.',
    'Choose a log you can replay (Kafka, or a Kafka-compatible log such as Redpanda), partitioned by ad or campaign id. A queue that deletes messages once consumed cannot give you "recompute any day".',
    'Put a stateful stream processor (Flink, Kafka Streams) on the click log: deduplicate by event id and count in event-time one-minute tumbling windows. Keep the watermark a few seconds behind so windows fire on time, allow 1 h of lateness that re-emits corrected totals, and checkpoint exactly-once.',
    'Land the per-minute aggregates as idempotent upserts keyed by (ad, minute) in a real-time OLAP store (Pinot, ClickHouse, Druid) that the reporting API reads. Pinot ingests from Kafka, so publish the aggregates to a topic first. A nightly warehouse is too slow for the dashboard.',
    'Feed aggregated spend to a budget & pacing service (from an aggregates topic, or by polling the OLAP store). It writes "campaign paused" into a cache the ad server reads, or publishes an event, directly or through Campaign management, so serving never calls billing.',
    'Archive every raw event to object storage (Kafka Connect S3 sink). The nightly reconciliation recomputes from that archive, compares with the real-time totals, and writes invoices to PostgreSQL.',
  ],
  checks: [
    {
      id: 'replayable-ingest-log',
      title: 'Ingest appends to a replayable, partitioned log',
      category: 'core',
      why: 'A durable log decouples a 50k events/s spike from slow consumers (they fall behind instead of falling over) and keeps every event so a consumer can rewind and replay. A classic queue deletes a message once it is acknowledged, so a bug fix can never be applied to yesterday.',
      hint: 'Click ingest owner → Message broker with Kafka (or a Kafka-compatible log such as Redpanda).',
      concepts: ['backpressure', 'kafka-vs-rabbitmq', 'event-sourcing'],
      test: (g) => {
        const ingest = g.ownerFamily('click-ingest')
        if (!ingest.length) return { pass: false, detail: 'Nobody owns click & impression ingest.' }
        const brokers = ingest.flatMap((n) => g.targets(n.id)).filter(kindIs('broker'))
        if (!brokers.length) return { pass: false, detail: 'Ingest does not publish events to a broker.' }
        if (!brokers.some(isLog(g)))
          return { pass: false, detail: `${brokers.map((b) => b.label).join(', ')} deletes messages once consumed, so you cannot replay a day. Use a replayable log (Kafka, Redpanda).` }
        return { pass: true }
      },
    },
    {
      id: 'stream-aggregation',
      title: 'A stream processor aggregates the click log into a real-time store the dashboard reads',
      category: 'core',
      why: 'A stateful stream processor deduplicates by event id and counts in event-time one-minute windows; the watermark trails by seconds so windows fire on time, and an allowed lateness of 1 h re-emits corrected totals for that minute. Checkpointing state with the log offsets and writing idempotent upserts into a real-time OLAP store means a restart or a re-fire overwrites rows instead of double counting.',
      hint: 'Click log → Stream processor (Flink / Kafka Streams) → aggregates topic or direct sink → real-time analytics store (Pinot, ClickHouse, Druid) ← Reporting owner.',
      concepts: ['stream-processing', 'idempotency', 'cqrs'],
      test: (g) => {
        const logs = clickLogs(g)
        if (!logs.length) return { pass: false, detail: 'Click events never reach a replayable log, so there is nothing to aggregate.' }
        const jobs = clickJobs(g, logs)
        if (!jobs.length) return { pass: false, detail: `No stream processor consumes ${logs.map((l) => l.label).join(', ')}, the log the clicks land in.` }
        const reached = aggregateStores(g, jobs, logs)
        if (!reached.length) return { pass: false, detail: 'The stream processor’s aggregates never land in a store.' }
        const serving = reached.filter(isServingStore(g))
        if (!serving.length)
          return { pass: false, detail: `${reached.map((r) => r.label).join(', ')} is a batch warehouse. Per-minute dashboards need a real-time OLAP store (Pinot, ClickHouse, Druid).` }
        const reads = idSet(g.storesOf(g.ownerFamily('reporting')))
        if (!serving.some((s) => reads.has(s.id)))
          return { pass: false, detail: 'Reporting does not read the store the stream processor writes.' }
        return { pass: true }
      },
    },
    {
      id: 'raw-archive-replay',
      title: 'Raw events archived for replay and reconciliation',
      category: 'core',
      why: 'The immutable raw event log is the source of truth (event sourcing), and every count is a projection of it. Archiving the raw events, not just the aggregates, cheaply to object storage lets finance recompute any day with fixed code and reconcile it against the real-time totals.',
      hint: 'Click log → archiver (Kafka Connect S3 sink, worker or a stream job writing files) → Object storage, read by the Billing & reconciliation owner.',
      concepts: ['event-sourcing', 'idempotency'],
      test: (g) => {
        const logs = clickLogs(g)
        if (!logs.length) return { pass: false, detail: 'Click events never reach a replayable log you could archive from.' }
        // Relays copy the raw stream; a hop through another topic means it is no longer raw.
        const archives = g
          .ofKind('object-storage')
          .filter((o) => !!g.reaches(logs, (n) => n.id === o.id, { through: ARCHIVERS, maxDepth: 3 }))
        if (!archives.length)
          return { pass: false, detail: 'Raw click events never reach object storage (archiving only aggregates does not count), so a past day cannot be recomputed.' }
        const billing = g.ownerFamily('billing')
        if (!billing.length) return { pass: false, detail: 'Nobody owns billing & reconciliation.' }
        const ids = idSet(archives)
        const reads = g.reaches(billing, (n) => ids.has(n.id), { through: ['worker', 'function', 'orchestrator', 'stream-processor'], maxDepth: 3 })
        return reads ? { pass: true } : { pass: false, detail: 'Billing & reconciliation never reads the raw event archive.' }
      },
    },
    {
      id: 'spend-to-budget',
      title: 'Budgets fed by deduplicated, aggregated spend',
      category: 'core',
      why: 'Budget pacing must see the same deduplicated numbers advertisers are billed for, and it needs one update per campaign per minute, not 50k raw events per second. Aggregated spend events from the stream processor give both, and the log absorbs bursts (backpressure) instead of overloading the budget service.',
      hint: 'Stream processor → broker (spend topic) → Budget & pacing owner. Polling the real-time OLAP store the stream job fills also works.',
      concepts: ['stream-processing', 'backpressure'],
      test: (g) => {
        const budget = g.ownerFamily('budget-pacing')
        if (!budget.length) return { pass: false, detail: 'Nobody owns budget & pacing.' }
        const logs = clickLogs(g)
        const jobs = clickJobs(g, logs)
        if (!jobs.length) return { pass: false, detail: 'There is no stream processor aggregating the click log.' }
        // Raw clicks are not "aggregated spend": the path may not loop back through the click log.
        if (without(g, idSet(logs)).asyncFlow(jobs, budget)) return { pass: true }
        const written = idSet(aggregateStores(g, jobs, logs).filter(isServingStore(g)))
        if (g.storesOf(budget).some((s) => written.has(s.id))) return { pass: true }
        return { pass: false, detail: 'Budget & pacing does not receive aggregated spend from the stream processor.' }
      },
    },
    {
      id: 'pause-propagation',
      title: 'Paused campaigns reach the ad server without a per-request call',
      category: 'core',
      why: 'The ad server decides in milliseconds and must not ask the budget service on every request. Pushing a "campaign paused" flag into a cache it reads, or an event it consumes into local memory, stops spend within seconds while serving stays independent of billing.',
      hint: 'Budget & pacing → Cache (paused campaigns) ← Ad server, or Budget & pacing → broker → Ad server. Routing it through Campaign management (which then updates the campaign snapshot the ad server reads) works too.',
      concepts: ['caching', 'event-driven'],
      test: (g) => {
        const budget = g.ownerFamily('budget-pacing')
        const serving = g.ownerFamily('ad-serving')
        if (!budget.length || !serving.length) return { pass: false, detail: 'Needs owners for both ad serving and budget & pacing.' }
        const servingStores = g.storesOf(serving, ['cache', 'document-db', 'wide-column'])
        const delivers = (from: DiagramNode[]) =>
          g.asyncFlow(from, serving) ||
          servingStores.some((s) => !!g.reaches(from, (n) => n.id === s.id, { through: PLUMBING, maxDepth: 4 }))
        if (delivers(budget)) return { pass: true }
        // Campaign management may own campaign status and distribute one snapshot to the ad server.
        const skip = new Set([...idSet(serving), ...idSet(budget)])
        const campaigns = g.ownerFamily('campaigns').filter((n) => !skip.has(n.id))
        if (campaigns.length) {
          const ids = idSet(campaigns)
          const told =
            g.asyncFlow(budget, campaigns) ||
            !!g.reaches(budget, (n) => ids.has(n.id), { protocols: SYNC_PROTOCOLS, through: PROXIES, maxDepth: 3 })
          if (told && delivers(campaigns)) return { pass: true }
        }
        return { pass: false, detail: 'The ad server never learns that a campaign was paused.' }
      },
    },
    {
      id: 'served-ad-events',
      title: 'Ad server publishes served-ad events to the log',
      category: 'bonus',
      why: 'The ad server knows what a beacon cannot: which auction it won, at what price, and the click id it signed. Publishing a served-ad event to the log lets the stream job join each click to its serve (and drop clicks that have none) without the ad server ever waiting on a database write.',
      hint: 'Ad server → log → stream processor.',
      concepts: ['event-driven', 'stream-processing'],
      test: (g) => {
        const serving = g.ownerFamily('ad-serving')
        const jobs = clickJobs(g, clickLogs(g))
        if (!serving.length || !jobs.length) return { pass: false, detail: 'Needs an ad-serving owner and a stream processor on the click log.' }
        return g.asyncFlow(serving, jobs) ? { pass: true } : { pass: false, detail: 'Served-ad events do not reach the stream processor through the log.' }
      },
    },
    {
      id: 'invalid-traffic-edge',
      title: 'Bot and invalid traffic filtered at the edge',
      category: 'bonus',
      why: 'Click fraud and crawlers cost advertisers money and trust. Filtering obvious bots at the edge, before the beacon reaches ingest, is the cheapest first layer (the stream job can still flag subtler patterns).',
      hint: 'Every beacon path: Clients → CDN with bot protection or a WAF → ingest, never straight to ingest or around the filter.',
      concepts: ['rate-limiting', 'cdn'],
      test: (g) => {
        const filters = g.nodes.filter((n) => n.kind === 'waf' || (n.kind === 'cdn' && g.hasTrait(n, 'bot-protection')))
        if (!filters.length) return { pass: false, detail: 'No WAF or bot-protecting CDN.' }
        const ids = idSet(g.ownerFamily('click-ingest'))
        if (!ids.size) return { pass: false, detail: 'Nobody owns click & impression ingest.' }
        const isIngest = (n: DiagramNode) => ids.has(n.id)
        const senders = g.ofKind(...CLIENT_KINDS).filter((c) => !!g.reaches(c, isIngest, { through: EDGE, maxDepth: 4 }))
        if (!senders.length) return { pass: false, detail: 'No client reaches ingest through the edge.' }
        const open = without(g, idSet(filters))
        const bypass = senders.filter((c) => !!open.reaches(c, isIngest, { through: EDGE, maxDepth: 4 }))
        return bypass.length
          ? { pass: false, detail: `${bypass.map((c) => c.label).join(', ')} can reach ingest without passing the WAF or bot filter.` }
          : { pass: true }
      },
    },
    {
      id: 'lag-monitoring',
      title: 'Consumer lag and pipeline health are monitored',
      category: 'bonus',
      why: 'Under backpressure the log simply grows. Consumer lag is the number that tells you budgets are about to be late, so the stream job and the log should export metrics with alerts on lag and checkpoint failures.',
      hint: 'Stream processor / click log → telemetry → Metrics, with Alerting.',
      concepts: ['backpressure', 'observability'],
      test: (g) => {
        const obs = observability(g, 'metrics', 'alerting')
        if (!obs.pass) return obs
        const logs = clickLogs(g)
        const exporting = [...clickJobs(g, logs), ...logs].some((n) => g.out(n.id, ['telemetry']).length > 0)
        return exporting ? { pass: true } : { pass: false, detail: 'Neither the stream processor nor the click log exports telemetry.' }
      },
    },
    {
      id: 'invoices-acid',
      title: 'Invoices stored in an ACID database',
      category: 'bonus',
      why: 'The OLAP store is a fast projection, not a book of record. Final reconciled amounts and invoices belong in a transactional store finance can audit and lock once issued.',
      hint: 'Billing & reconciliation owner → Relational database.',
      concepts: ['acid-vs-base'],
      test: (g) => g.storesOf(g.ownerFamily('billing'), ['relational-db']).length > 0,
    },
    {
      id: 'anti-billing-on-hot-path',
      title: 'Ad serving never waits on billing',
      category: 'antipattern',
      why: 'A synchronous call from the ad server or click endpoint into budgets, reporting or billing couples revenue-critical latency to the slowest back-office system. When billing is slow, ads stop being served and clicks are lost.',
      hint: 'Remove synchronous calls from the hot path, including ones routed through a gateway. Publish events and let the back-office consume them.',
      concepts: ['backpressure', 'event-driven'],
      test: (g) => {
        const hot = hotPath(g)
        const hotIds = idSet(hot)
        const cold = new Set(
          [...g.ownerFamily('budget-pacing'), ...g.ownerFamily('reporting'), ...g.ownerFamily('billing')]
            .filter((n) => !hotIds.has(n.id))
            .map((n) => n.id),
        )
        const bad = hot.filter((h) => !!g.reaches(h, (n) => cold.has(n.id), { protocols: SYNC_PROTOCOLS, through: PROXIES, maxDepth: 3 }))
        return bad.length ? { pass: false, detail: `${bad.map((b) => b.label).join(', ')} call billing-side services synchronously.` } : { pass: true }
      },
    },
    {
      id: 'anti-oltp-click-counter',
      title: 'No per-click writes into an OLTP database',
      category: 'antipattern',
      why: 'Updating a counter row per click serialises 50k writes/s on hot rows, gives at-least-once double counting on retries and throws away the raw event. This is exactly what made today’s system fall 40 minutes behind.',
      hint: 'Ingest appends to the log; aggregates are computed by the stream processor. Reading campaign config from a database is fine.',
      concepts: ['stream-processing', 'idempotency'],
      test: (g) => {
        const ingest = g.ownerFamily('click-ingest')
        const ingestIds = idSet(ingest)
        const campaignSide = idSet(g.ownerFamily('campaigns').filter((n) => !ingestIds.has(n.id)))
        const countsClicks = (storeId: string, label?: string) => {
          const store = g.node(storeId)
          if (!store || (store.kind !== 'relational-db' && store.kind !== 'document-db')) return false
          if (COUNTER_WRITE.test(label ?? '') || COUNTER_WRITE.test(store.label)) return true
          // A store Campaign management owns, or one that is plainly config, is a read of campaign settings.
          if (g.sources(store.id, ['data']).some((s) => campaignSide.has(s.id))) return false
          return !CONFIG_STORE.test(store.label)
        }
        const bad = ingest.filter((n) => g.out(n.id, ['data']).some((e) => countsClicks(e.target, e.label)))
        return bad.length ? { pass: false, detail: `${bad.map((b) => b.label).join(', ')} writes clicks straight into an OLTP database.` } : { pass: true }
      },
    },
  ],
  inspiration: [
    {
      label: 'Uber Engineering — Real-time exactly-once ad event processing with Flink, Kafka and Pinot',
      url: 'https://www.uber.com/en-BR/blog/real-time-exactly-once-ad-event-processing/',
    },
    { label: 'ByteByteGo — Ad click event aggregation', url: 'https://bytebytego.com/courses/system-design-interview/ad-click-event-aggregation' },
  ],
  reference: {
    decisions: {
      style: 'event-driven',
      communication: 'async',
      data: 'cqrs',
      stack: { frontend: 'react', backend: 'go', database: 'postgres', messaging: 'kafka', cache: 'redis' },
      rationale:
        'Clicks are immutable facts. A Go hot path appends them to Kafka, Flink turns them into exactly-once per-minute aggregates, and every consumer (dashboards, budgets, billing) is a projection we can rebuild from the log or the S3 archive.',
    },
    walkthrough: [
      'Publisher pages and SDKs reach the Go ad server and click endpoint through Cloudflare, which filters obvious bots. The ad server signs a click id into every tracking URL it returns, so a retried beacon carries the same id; ingest only verifies the signature, appends the event to Kafka partitioned by ad id and redirects. Nothing on this path waits for billing.',
      'Flink reads the raw topic, joins clicks to their served-ad events, drops duplicates by event id in keyed state with a TTL, and counts clicks, impressions and spend in one-minute event-time tumbling windows. The watermark trails event time by a few seconds so windows fire on time; an allowed lateness of 1 h re-emits corrected totals for that minute, and anything later goes to a side output that the nightly job picks up.',
      'Exactly-once is end-to-end: Flink checkpoints its state together with the Kafka offsets and commits its aggregates to a Kafka topic in a transaction tied to the checkpoint. Pinot consumes that topic with read_committed and upserts by (ad, minute), so a restart, a late re-fire or a replay overwrites the same row instead of adding to it.',
      'Budget & pacing consumes the same aggregates topic and keeps spend per campaign in PostgreSQL; budget limits arrive from Campaigns on a compacted topic. When a budget runs out it sets a "paused" flag in Redis next to the campaign snapshot the ad server reads, so spend stops within seconds.',
      'Kafka Connect archives every raw event to S3 (Parquet, partitioned by hour). Each night, Billing recomputes the day from the archive, compares it with Pinot, and writes reconciled invoices to PostgreSQL. Finance can recompute any disputed day the same way.',
      'The trade-offs are more moving parts (Kafka, Flink, Pinot) and eventual consistency of up to about a minute on dashboards and budgets. A small, bounded over-delivery is accepted in exchange for an ad path that never blocks.',
    ],
    diagram: diagram(
      [
        ['console', 'web-app', 'Advertiser Console', 0, -480, { tech: 'react' }],
        ['gw', 'api-gateway', 'API Gateway', 260, -480, { tech: 'kong' }],
        ['reporting', 'service', 'Reporting API', 1820, -480, { tech: 'ktor', domains: ['reporting'] }],
        ['campaigns', 'service', 'Campaigns', 520, -320, { tech: 'ktor', domains: ['campaigns'] }],
        ['campaignTopic', 'broker', 'Campaign Changes', 1040, -320, { tech: 'kafka', notes: 'compacted: budgets, status' }],
        ['budget', 'service', 'Budget & Pacing', 1300, -320, { tech: 'go', domains: ['budget-pacing'] }],
        ['budgetDb', 'relational-db', 'Spend Ledger', 1560, -320, { tech: 'postgres' }],
        ['campaignsDb', 'relational-db', 'Campaigns DB', 520, -160, { tech: 'postgres' }],
        ['adCache', 'cache', 'Live Campaign State', 780, -160, { tech: 'redis', notes: 'campaign snapshot, paused flags' }],
        ['pubWeb', 'web-app', 'Publisher Sites (ad tag)', 0, 0, { tech: 'react' }],
        ['adserver', 'service', 'Ad Server', 520, 0, { tech: 'go', domains: ['ad-serving'], notes: 'signs a click id into each tracking URL' }],
        ['cdn', 'cdn', 'Edge + Bot Filter', 260, 80, { tech: 'cloudflare' }],
        ['pubApp', 'mobile-app', 'Publisher Apps (SDK)', 0, 160, { tech: 'flutter' }],
        ['ingest', 'service', 'Click & Impression Ingest', 520, 160, { tech: 'go', domains: ['click-ingest'], notes: 'verify id, append, 302 redirect' }],
        ['rawLog', 'broker', 'Raw Events Log', 780, 160, { tech: 'kafka', notes: 'partitioned by ad id, 7-day retention' }],
        ['flink', 'stream-processor', 'Dedup + 1-min Windows', 1040, 160, { tech: 'flink', notes: 'event time, 1 h allowed lateness, exactly-once' }],
        ['aggLog', 'broker', 'Minute Aggregates', 1300, 160, { tech: 'kafka', notes: 'transactional writes' }],
        ['pinot', 'analytics-db', 'Real-time OLAP', 1560, 160, { tech: 'pinot', notes: 'upsert by (ad, minute)' }],
        ['s3Sink', 'cdc', 'S3 Sink Connector', 1040, 320, { tech: 'kafka-connect' }],
        ['archive', 'object-storage', 'Raw Event Archive', 1300, 320, { tech: 's3', notes: 'Parquet by hour, 13 months, Object Lock' }],
        ['billing', 'service', 'Billing & Reconciliation', 1820, 320, { tech: 'spring-boot', domains: ['billing'], notes: 'nightly recompute from archive' }],
        ['billingDb', 'relational-db', 'Invoices DB', 2080, 320, { tech: 'postgres' }],
        ['otel', 'otel-collector', 'OTel Collector', 1820, -160, { tech: 'otel-collector' }],
        ['prom', 'metrics', 'Metrics (lag, latency)', 2080, -160, { tech: 'prometheus' }],
        ['grafana', 'dashboards', 'Ops Dashboards', 2340, -240, { tech: 'grafana' }],
        ['alerts', 'alerting', 'On-call', 2340, -80, { tech: 'pagerduty' }],
      ],
      [
        ['console', 'gw', 'http'],
        ['gw', 'reporting', 'http'],
        ['gw', 'campaigns', 'http'],
        ['campaigns', 'campaignsDb', 'data'],
        ['campaigns', 'campaignTopic', 'event', 'BudgetChanged'],
        ['campaigns', 'adCache', 'data', 'campaign snapshot'],
        ['campaignTopic', 'budget', 'event'],
        ['pubWeb', 'cdn', 'http'],
        ['pubApp', 'cdn', 'http'],
        ['cdn', 'adserver', 'http', 'ad request'],
        ['cdn', 'ingest', 'http', 'click / impression beacon'],
        ['adserver', 'adCache', 'data', 'read'],
        ['adserver', 'rawLog', 'event', 'AdServed'],
        ['ingest', 'rawLog', 'event', 'ClickRecorded'],
        ['rawLog', 'flink', 'event'],
        ['rawLog', 's3Sink', 'event'],
        ['s3Sink', 'archive', 'data'],
        ['flink', 'aggLog', 'event', 'SpendPerMinute'],
        ['aggLog', 'pinot', 'event', 'upsert'],
        ['aggLog', 'budget', 'event'],
        ['budget', 'budgetDb', 'data'],
        ['budget', 'adCache', 'data', 'pause campaign'],
        ['reporting', 'pinot', 'data'],
        ['billing', 'archive', 'data', 'recompute day'],
        ['billing', 'pinot', 'data', 'compare'],
        ['billing', 'billingDb', 'data'],
        ['adserver', 'otel', 'telemetry'],
        ['ingest', 'otel', 'telemetry'],
        ['flink', 'otel', 'telemetry', 'consumer lag'],
        ['budget', 'otel', 'telemetry'],
        ['billing', 'otel', 'telemetry'],
        ['reporting', 'otel', 'telemetry'],
        ['campaigns', 'otel', 'telemetry'],
        ['otel', 'prom', 'telemetry'],
        ['prom', 'grafana', 'telemetry'],
        ['prom', 'alerts', 'telemetry'],
      ],
    ),
  },
}

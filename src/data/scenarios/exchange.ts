import type { ComponentKind, DiagramNode, Scenario } from '../../engine/types'
import { CLIENT_KINDS, COMPUTE_KINDS, DB_KINDS, type Graph } from '../../engine/graph'
import { SYNC_PROTOCOLS } from '../../engine/types'
import { diagram } from './builder'

// ---------------------------------------------------------------------------
// Helpers shared by the checks below
// ---------------------------------------------------------------------------

/** Compute nodes (not containers acting on their behalf) that own matching. */
const matchingNodes = (g: Graph) => g.owners('matching').filter((n) => COMPUTE_KINDS.includes(n.kind))

const ids = (nodes: DiagramNode[]) => new Set(nodes.map((n) => n.id))
const text = (n: DiagramNode) => `${n.label} ${n.notes ?? ''}`

/**
 * Low-latency replicated journals (LMAX-style). The tech catalog has no entry
 * for them yet, so a broker labelled this way counts whatever tech it carries.
 */
const LOW_LATENCY_JOURNAL = /aeron|chronicle|disruptor|in-?memory journal|memory-mapped/i

/**
 * A replayable log: tech traits first; a tech-less broker that is clearly drawn
 * as a journal / log is given the benefit of the doubt.
 */
const isLog = (g: Graph, n: DiagramNode) =>
  n.kind === 'broker' &&
  (g.hasTrait(n, 'replayable', 'log') ||
    LOW_LATENCY_JOURNAL.test(text(n)) ||
    (!n.tech && /journal|event log|append-only|\blog\b/i.test(text(n))))

const isLowLatencyJournal = (g: Graph, n: DiagramNode) => isLog(g, n) && (g.hasTrait(n, 'low-latency') || LOW_LATENCY_JOURNAL.test(text(n)))

/** Labels of replica nodes (hot standby). */
const REPLICA = /standby|replica|follower|passive|backup|secondary|mirror/i

/**
 * A replica is marked as one (label / notes), or is passive: it consumes the
 * journal but publishes nothing (no outgoing events).
 */
const isReplica = (g: Graph, n: DiagramNode) => REPLICA.test(text(n)) || g.out(n.id, ['event']).length === 0

/** Stores that put a disk / network round trip inside the order hot path. */
const HOT_PATH_STORES: ComponentKind[] = [...DB_KINDS, 'cache', 'search', 'analytics-db']

/** Replayable brokers attached (in either direction) to a matching node. */
function matchingJournals(g: Graph) {
  const m = ids(matchingNodes(g))
  return g
    .ofKind('broker')
    .filter((b) => g.targets(b.id).some((t) => m.has(t.id)) || g.sources(b.id).some((s) => m.has(s.id)))
}

/**
 * Brokers the sequencer writes that carry its output into matching: they feed
 * a matching node other than the writer, or the writer is itself the engine
 * (LMAX-style in-process sequencer + business logic).
 */
function sequencedJournals(g: Graph) {
  const seq = g.ownerFamily('sequencing')
  const mIds = ids(matchingNodes(g))
  return g
    .ofKind('broker')
    .filter((b) =>
      g.sources(b.id).some((w) => seq.some((s) => s.id === w.id) && (mIds.has(w.id) || g.targets(b.id).some((t) => mIds.has(t.id) && t.id !== w.id))),
    )
}

/**
 * Stores of `kinds` that `starts` touch with data edges, directly or through
 * synchronous calls into other compute nodes (e.g. gateway → risk service → DB).
 * Nodes in `skip` are not followed (they are judged by another check).
 */
function storesOnSyncPath(g: Graph, starts: DiagramNode[], kinds: ComponentKind[], skip = new Set<string>()) {
  const found = new Map<string, { store: DiagramNode; via: DiagramNode }>()
  const seen = new Set(starts.map((s) => s.id))
  let frontier = [...starts]
  for (let depth = 0; depth < 5 && frontier.length; depth++) {
    const next: DiagramNode[] = []
    for (const n of frontier) {
      for (const t of g.targets(n.id, ['data'])) if (kinds.includes(t.kind) && !found.has(t.id)) found.set(t.id, { store: t, via: n })
      for (const t of g.targets(n.id, SYNC_PROTOCOLS)) {
        if (seen.has(t.id) || skip.has(t.id) || !COMPUTE_KINDS.includes(t.kind)) continue
        seen.add(t.id)
        next.push(t)
      }
    }
    frontier = next
  }
  return [...found.values()]
}

export const exchangeEngine: Scenario = {
  id: 'kursor-exchange',
  title: 'Kursor: a fair matching engine at 500k orders/s',
  tagline: 'Half a million orders a second, under a millisecond, and not one of them out of turn.',
  industry: 'Capital markets',
  difficulty: 'advanced',
  estMinutes: 55,
  accent: '#4d7c0f',
  concepts: ['single-writer', 'event-sourcing', 'sharding', 'cqrs', 'fan-out', 'realtime', 'acid-vs-base'],
  story:
    'Kursor runs a fast-growing Warsaw-based exchange for crypto assets and tokenised stocks. During last month’s meme-coin rally its matching engine, a Java service that locked order rows in PostgreSQL, stalled for 40 seconds. When it came back, some orders had been filled out of sequence, and two market makers are now threatening to leave. The regulator has opened a fairness review, and the board has given engineering one quarter to replace the core. The new design has to match strictly by price-time priority, survive a crash without losing a single acknowledged order, and stream the live order book to every trader, without letting any of that slow the matching path.',
  facts: [
    { label: 'Peak load', value: '500k orders/s, ~1,200 instruments, 60M trades/day' },
    { label: 'Latency SLA', value: 'p99 < 1 ms gateway → ack (order sequenced and replicated)' },
    { label: 'Market data', value: '100k concurrent WebSocket subscribers' },
    { label: 'Team & budget', value: '16 engineers (Rust, Java), 3 SREs, €2.5M/yr infrastructure' },
  ],
  functional: [
    'Accept limit, market and cancel orders from the web terminal, the mobile app and market makers’ binary API',
    'Pre-trade risk: reject orders that exceed available balance or position limits before they reach the book',
    'Match orders strictly by price-time priority, per instrument',
    'Stream order-book depth, trades and tickers live to 100k subscribers',
    'Clear every trade and run end-of-day settlement with the custodian bank',
    'Run market surveillance (spoofing, wash trading) over the full order history',
  ],
  nonFunctional: [
    'p99 below 1 ms from gateway to acknowledgement at 500k orders/s; an order is acknowledged once it is sequenced and replicated to the standby',
    'Zero lost or reordered orders after a crash; failover to the standby within 1 second',
    'Deterministic replay: any historical order-book state can be rebuilt for auditors',
    'Slow market-data consumers or analytics jobs must never slow down matching',
    'Settlement balances are strongly consistent and always reconcile to the last unit',
  ],
  constraints: [
    'No database calls on the order hot path (gateway → sequencer → matching)',
    'Two data centres: primary plus a hot standby; no specialised FPGA or kernel-bypass budget this year',
    'Every order event must be retained and replayable for 5 years (regulatory audit)',
  ],
  domains: [
    { id: 'order-entry', label: 'Order entry & pre-trade risk', description: 'Sessions, rate limits, balance and limit checks' },
    { id: 'sequencing', label: 'Sequencing & journal', description: 'Global ordering and durable journaling of inputs' },
    { id: 'matching', label: 'Matching', description: 'In-memory order books, price-time priority' },
    { id: 'market-data', label: 'Market data', description: 'Depth, trades and tickers for subscribers' },
    { id: 'clearing', label: 'Clearing & settlement', description: 'Trade capture, ledger, end-of-day settlement' },
    { id: 'surveillance', label: 'Surveillance & analytics', description: 'Abuse detection and reporting' },
  ],
  recommendedStyles: ['event-driven'],
  styleFeedback: {
    'event-driven':
      'Exactly right: a sequenced, replayable input journal feeds a deterministic engine, and every downstream concern (market data, clearing, surveillance) is a projection of its output stream.',
    microservices:
      'Splitting into services is part of the answer, but request/response calls between them would put network round trips inside a 1 ms budget. Here the services have to be chained by a sequenced log rather than by APIs.',
    'modular-monolith':
      'In-process modules give low latency, and you could still run the whole process as a primary/replica pair, but market-data fan-out, clearing batches and surveillance would share the engine’s process, heap and release cycle, so a slow settlement job or a GC pause would hit matching.',
    monolith:
      'This is the design that stalled for 40 seconds: matching, persistence and reporting share one process and one database, so contention destroys both fairness and latency.',
    serverless:
      'Cold starts, per-invocation state and millisecond-scale invocation overhead make it impossible to keep an in-memory order book or meet a sub-millisecond p99.',
  },
  hints: [
    'Follow one order from click to acknowledgement. Who authenticates and risk-checks it, who decides its place in the queue, and who matches it? Give each step its own owner.',
    'Price-time priority needs one global order of inputs. Put a sequencer in front of matching and have it append every accepted order to a replayable journal before anything is matched. Nothing may reach the engine any other way.',
    'Mind the 1 ms budget: a disk-replicated broker such as Kafka adds milliseconds per hop. LMAX-style exchanges journal in memory and replicate to the standby (Aeron, Chronicle Queue; draw a Broker and label it), and keep Kafka or Redpanda for the output stream and the 5-year archive. Run the sequencer itself as a primary/standby pair.',
    'Make the matching engine a single writer: one thread per instrument shard, order books in memory, and no database or network call inside the loop. Durability comes from the journal, not from a DB.',
    'Add a hot standby (label it Standby or Replica) that consumes the same journal as the active engines and holds identical books. Let it write periodic snapshots to object storage, so a restart loads the latest one and replays only the tail of the journal.',
    'Everything else reads the engine’s output stream (CQRS): fills update the gateways’ in-memory balances, a market-data publisher feeds a WebSocket gateway, clearing writes an ACID ledger, and surveillance writes an analytics store.',
  ],
  checks: [
    {
      id: 'sequenced-journal',
      title: 'Orders are sequenced and journaled before matching',
      category: 'core',
      why: 'Fairness means every order gets one global position before it is matched. A sequencer that appends inputs to a durable, replayable journal gives you that position, makes the engine’s input replayable after a crash, and serves as the audit trail (event sourcing of inputs). Any second way into the engine breaks determinism.',
      hint: 'Order gateway → Sequencer → replayable journal → Matching engine. For sub-millisecond acks use an in-memory replicated journal (Aeron, Chronicle Queue; label the broker); Kafka, Redpanda or NATS JetStream are replayable but slower. No other component may feed the engine.',
      concepts: ['single-writer', 'event-sourcing'],
      test: (g) => {
        const m = matchingNodes(g)
        const seq = g.ownerFamily('sequencing')
        if (!m.length) return { pass: false, detail: 'Nobody owns Matching yet.' }
        if (!seq.length) return { pass: false, detail: 'Nobody owns Sequencing — who decides which order came first?' }
        const seqIds = ids(seq)
        const mFam = ids(g.ownerFamily('matching'))
        const upstream = new Set([...seqIds, ...mFam])
        // Every input to an engine (that does not sequence itself) must come out of a journal the sequencer writes.
        const bypass: string[] = []
        for (const n of m) {
          if (seqIds.has(n.id)) continue
          for (const e of g.in(n.id)) {
            if (e.protocol === 'telemetry') continue
            const s = g.node(e.source)
            if (!s || mFam.has(s.id) || s.kind === 'object-storage' || s.kind === 'secrets') continue
            if (s.kind === 'broker') {
              for (const w of g.sources(s.id)) if (!upstream.has(w.id)) bypass.push(`${w.label} writes straight into ${s.label}`)
            } else bypass.push(`${s.label} feeds ${n.label} directly`)
          }
        }
        if (bypass.length)
          return { pass: false, detail: `${[...new Set(bypass)].join('; ')}, so those orders skip the sequencer or the journal and cannot be replayed in order.` }
        const journals = sequencedJournals(g)
        if (!journals.length)
          return { pass: false, detail: 'No journal sits between the sequencer and the matching engine, so its input cannot be replayed after a crash.' }
        if (!journals.some((b) => isLog(g, b)))
          return {
            pass: false,
            detail: `${journals.map((b) => b.label).join(', ')} is not a replayable log. Use an in-memory replicated journal (Aeron, Chronicle Queue) or Kafka / Redpanda / NATS JetStream, so the journal survives consumption.`,
          }
        return true
      },
    },
    {
      id: 'replicated-matching',
      title: 'A hot standby rebuilds the same books from the journal',
      category: 'core',
      why: 'Because matching is deterministic, a standby engine consuming the same sequenced journal ends up with identical order books. Failover then takes milliseconds and loses nothing. A second shard is not a standby: it holds different instruments, so if shard A dies, A’s books are gone.',
      hint: 'Add a matching-engine replica, labelled Standby or Replica, that consumes the same replayable journal as the active engine (not the engine’s output stream).',
      concepts: ['single-writer', 'event-sourcing'],
      test: (g) => {
        const m = matchingNodes(g)
        if (!m.length) return { pass: false, detail: 'Nobody owns Matching yet.' }
        const seqIds = ids(g.ownerFamily('sequencing'))
        const replicas = m.filter((n) => isReplica(g, n))
        const active = m.filter((n) => !isReplica(g, n))
        if (m.length < 2) return { pass: false, detail: 'Only one matching engine: if it crashes, trading stops until it is rebuilt.' }
        if (!replicas.length)
          return { pass: false, detail: 'Every matching engine is an active shard. Shards split the load but do not cover each other; add a standby replica.' }
        if (!active.length) return { pass: false, detail: 'No active matching engine publishes trades and acks to an output stream.' }
        const rIds = ids(replicas)
        const ok = g
          .ofKind('broker')
          .filter((b) => isLog(g, b))
          .some((b) => {
            const readers = g.targets(b.id)
            if (!readers.some((r) => rIds.has(r.id))) return false
            return active.some((a) => readers.some((r) => r.id === a.id) || (seqIds.has(a.id) && g.sources(b.id).some((w) => w.id === a.id)))
          })
        return ok ? true : { pass: false, detail: 'The standby is not fed by the same replayable journal as the active engine, so its books can drift.' }
      },
    },
    {
      id: 'matching-recovery',
      title: 'Recovery from snapshot + journal replay',
      category: 'core',
      why: 'Replaying years of journal after a crash takes too long, so the books are periodically snapshotted to object storage. On restart an engine loads the latest snapshot and replays only the journal entries after its sequence number. Snapshotting from the standby (or a dedicated snapshotter) keeps the primary from pausing.',
      hint: 'Connect the matching engine, its standby, or a snapshot worker that reads the journal to Object storage, and make sure matching reads from a replayable log.',
      concepts: ['event-sourcing', 'single-writer'],
      test: (g) => {
        const m = g.ownerFamily('matching')
        if (!m.length) return { pass: false, detail: 'Nobody owns Matching yet.' }
        const journals = matchingJournals(g).filter((b) => isLog(g, b))
        const jIds = ids(journals)
        const engineSnaps = [...g.storesOf(m, ['object-storage']), ...m.flatMap((n) => g.sources(n.id, ['data']).filter((s) => s.kind === 'object-storage'))]
        const snapshotters = g
          .ofKind(...COMPUTE_KINDS)
          .filter((n) => g.sources(n.id).some((s) => jIds.has(s.id)) && g.storesOf([n], ['object-storage']).length > 0)
        if (!engineSnaps.length && !snapshotters.length) return { pass: false, detail: 'No snapshot store: a crash means replaying the entire history.' }
        if (!journals.length) return { pass: false, detail: 'Snapshots alone lose every order since the last one. Pair them with a replayable journal.' }
        return true
      },
    },
    {
      id: 'pre-trade-risk',
      title: 'Pre-trade risk checks use in-memory balances',
      category: 'core',
      why: 'At 500k orders/s with a 1 ms budget, a database round trip per order is too slow and creates lock contention. Gateways check balances and limits against an in-memory (or near-cache) view that is updated from the engine’s fill events.',
      hint: 'Give the order gateway a cache of balances and limits (Hazelcast near cache, Redis), or feed it fill events from the output stream. Do not query a database per order, not even through a separate risk service.',
      concepts: ['cqrs', 'caching'],
      test: (g) => {
        const oe = g.ownerFamily('order-entry')
        if (!oe.length) return { pass: false, detail: 'Nobody owns Order entry.' }
        const hot = ids([...g.ownerFamily('sequencing'), ...g.ownerFamily('matching')])
        const dbs = storesOnSyncPath(g, oe, DB_KINDS, hot)
        if (dbs.length)
          return {
            pass: false,
            detail: `Risk checks read ${dbs.map((d) => (oe.some((o) => o.id === d.via.id) ? d.store.label : `${d.store.label} (via ${d.via.label})`)).join(', ')} on every order, which costs a disk round trip inside the 1 ms budget.`,
          }
        const cache = g.storesOf(oe, ['cache']).length > 0
        const fedByEvents = g.asyncFlow([...g.ownerFamily('matching'), ...g.ownerFamily('clearing')], oe)
        return cache || fedByEvents
          ? true
          : { pass: false, detail: 'The gateways have no view of balances. Add an in-memory cache, or have fill events update them.' }
      },
    },
    {
      id: 'market-data-fanout',
      title: 'Market data fans out via a realtime gateway',
      category: 'core',
      why: 'If 100k subscribers polled the engine it would collapse. A publisher builds depth and ticker views from the engine’s output stream (a read model) and a WebSocket gateway fans them out, conflating updates for slow clients so they never push back on matching.',
      hint: 'Engine → output stream → Market-data publisher → Realtime gateway (WebSocket) ← clients.',
      concepts: ['fan-out', 'realtime', 'cqrs'],
      test: (g) => {
        const md = g.ownerFamily('market-data')
        if (!md.length) return { pass: false, detail: 'Nobody owns Market data.' }
        const rtg = g.ofKind('realtime-gateway')
        if (!rtg.length) return { pass: false, detail: 'No realtime gateway, so 100k subscribers would have to poll.' }
        if (!g.asyncFlow(g.ownerFamily('matching'), md))
          return { pass: false, detail: 'The market-data publisher is not fed asynchronously by the engine’s output events.' }
        const mdIds = ids(md)
        const delivering = rtg.filter((r) => g.sources(r.id).some((s) => mdIds.has(s.id)) || g.asyncFlow(md, [r]))
        if (!delivering.length) return { pass: false, detail: 'The market-data publisher does not push to the realtime gateway.' }
        const dIds = ids(delivering)
        const clients = g.ofKind(...CLIENT_KINDS)
        const reached = clients.some(
          (c) => !!g.reaches(c, (n) => dIds.has(n.id), { through: ['cdn', 'load-balancer', 'waf'], maxDepth: 3 }) || delivering.some((r) => g.targets(r.id).some((t) => t.id === c.id)),
        )
        return reached ? true : { pass: false, detail: 'No client connects to the realtime gateway.' }
      },
    },
    {
      id: 'settlement-ledger',
      title: 'Trades flow as events into an ACID settlement ledger',
      category: 'core',
      why: 'Clearing must not slow matching, but it has to be exactly right. It consumes trade events from the output stream and books them in a relational ledger with ACID transactions, and end-of-day settlement then reconciles that ledger with the custodian.',
      hint: 'Engine → output stream → Clearing service → Relational database (PostgreSQL, CockroachDB).',
      concepts: ['acid-vs-base', 'cqrs', 'event-driven'],
      test: (g) => {
        const cl = g.ownerFamily('clearing')
        if (!cl.length) return { pass: false, detail: 'Nobody owns Clearing & settlement.' }
        if (!g.asyncFlow(g.ownerFamily('matching'), cl)) return { pass: false, detail: 'Trades do not reach clearing as events.' }
        const stores = g.storesOf(cl, DB_KINDS)
        if (!stores.length) return { pass: false, detail: 'Clearing has no ledger database.' }
        const acid = stores.filter((s) => s.kind === 'relational-db' || g.hasTrait(s, 'acid'))
        return acid.length ? true : { pass: false, detail: `${stores.map((s) => s.label).join(', ')} is not an ACID relational store.` }
      },
    },
    {
      id: 'entry-auth',
      title: 'Traders enter through authenticated gateways',
      category: 'bonus',
      why: 'Order gateways are the trust boundary. They validate sessions or API keys issued by an identity provider and enforce per-account rate limits, so one runaway algorithm cannot flood the sequencer.',
      hint: 'Clients → load balancer → Order gateway, with the gateway (or an API gateway in front) connected to an Identity provider.',
      concepts: ['oauth-oidc', 'rate-limiting'],
      test: (g) => {
        const oe = g.ownerFamily('order-entry')
        if (!oe.length) return { pass: false, detail: 'Nobody owns Order entry.' }
        const oeIds = ids(oe)
        const clients = g.ofKind(...CLIENT_KINDS)
        const enter = clients.some((c) => !!g.reaches(c, (n) => oeIds.has(n.id), { through: ['cdn', 'waf', 'load-balancer', 'api-gateway'], maxDepth: 4 }))
        if (!enter) return { pass: false, detail: 'Clients never reach the order gateways.' }
        const doors = [...oe, ...g.ofKind('api-gateway')]
        const auth = doors.some((d) => g.neighbours(d.id).some((n) => n.kind === 'identity'))
        return auth ? true : { pass: false, detail: 'No identity provider behind the gateways.' }
      },
    },
    {
      id: 'low-latency-journal',
      title: 'The acknowledgement path stays in memory',
      category: 'bonus',
      why: 'An order is acknowledged once it is sequenced and replicated. A disk-replicated broker such as Kafka or Redpanda (acks=all) has a p99 of several milliseconds per hop, which alone breaks a 1 ms SLA. LMAX-style exchanges replicate an in-memory journal to the standby and archive it to durable storage asynchronously.',
      hint: 'Make the journal between sequencer and matching a low-latency replicated journal (Aeron Cluster/Archive, Chronicle Queue; label the broker, or use NATS JetStream), and keep Kafka or Redpanda for the output stream and the 5-year archive.',
      concepts: ['event-sourcing', 'single-writer'],
      test: (g) => {
        const journals = sequencedJournals(g).filter((b) => isLog(g, b))
        if (!journals.length) return { pass: false, detail: 'No sequenced journal feeds matching yet.' }
        return journals.some((b) => isLowLatencyJournal(g, b))
          ? true
          : { pass: false, detail: `${journals.map((b) => b.label).join(', ')} is a disk-replicated broker; its round trip alone exceeds the 1 ms ack budget.` }
      },
    },
    {
      id: 'instrument-shards',
      title: 'Order books sharded by instrument',
      category: 'bonus',
      why: 'One thread can match millions of orders a second, but a single engine is still a single blast radius and a single hot spot. Sharding instruments across engines (each still a single writer) isolates a meme-coin frenzy from blue-chip trading.',
      hint: 'Draw two or more active matching engines (e.g. shard A: crypto, shard B: tokenised stocks), each fed by its own journal partition. Standbys do not count as shards.',
      concepts: ['sharding', 'single-writer'],
      test: (g) => {
        const active = matchingNodes(g).filter((n) => !isReplica(g, n))
        if (active.length >= 2) return true
        if (active.some((n) => /shard|partition/i.test(text(n)))) return true
        return { pass: false, detail: 'All instruments share one active matching engine.' }
      },
    },
    {
      id: 'surveillance-offpath',
      title: 'Surveillance and analytics stay off the hot path',
      category: 'bonus',
      why: 'Abuse detection needs every order and trade, but it can tolerate seconds of lag. Reading the event stream into a columnar store keeps heavy queries away from the engine (CQRS: a read model for analysts).',
      hint: 'Output stream → Surveillance consumer (optionally via a stream processor) → Analytics store (ClickHouse, Pinot).',
      concepts: ['cqrs', 'stream-processing'],
      test: (g) => {
        const s = g.ownerFamily('surveillance')
        if (!s.length) return { pass: false, detail: 'Nobody owns Surveillance.' }
        if (!g.asyncFlow([...g.ownerFamily('matching'), ...g.ownerFamily('sequencing')], s))
          return { pass: false, detail: 'Surveillance is not fed by the order/trade event stream.' }
        const store = g.reaches(s, (n) => n.kind === 'analytics-db', { through: ['broker', 'stream-processor', 'worker'], maxDepth: 3 })
        return store ? true : { pass: false, detail: 'No analytics store for surveillance queries.' }
      },
    },
    {
      id: 'latency-slo',
      title: 'Latency is measured and alerted on',
      category: 'bonus',
      why: 'A p99 SLA of 1 ms is only real if you measure it. Latency histograms from the gateways and engines, with alerts on SLO burn, catch GC pauses and slow consumers before traders notice them.',
      hint: 'Export telemetry from the gateways and matching engines to a Metrics store, and add Dashboards or Alerting.',
      concepts: ['slo', 'observability'],
      test: (g) => {
        if (!g.has('metrics')) return { pass: false, detail: 'No metrics store.' }
        if (!g.has('alerting', 'dashboards')) return { pass: false, detail: 'Nobody watches the numbers. Add alerting or dashboards.' }
        const hot = ids([...g.ownerFamily('matching'), ...g.ownerFamily('order-entry')])
        return g.instrumented().some((n) => hot.has(n.id)) ? true : { pass: false, detail: 'Neither the gateways nor the engines export telemetry.' }
      },
    },
    {
      id: 'anti-hotpath-db',
      title: 'No database on the order hot path',
      category: 'antipattern',
      why: 'A single-writer engine is fast because it never waits. A database or cache call per order in the sequencer or the engine adds hundreds of microseconds, lock contention and a second source of truth, which is exactly what made the old engine stall. Persist through the journal and snapshots instead.',
      hint: 'Remove data edges (direct or through a called service) from the sequencer and the matching engine to databases and caches. Keep books in memory and write only snapshots to object storage.',
      concepts: ['single-writer'],
      test: (g) => {
        const hot = [...g.ownerFamily('sequencing'), ...g.ownerFamily('matching')]
        const stores = storesOnSyncPath(g, hot, HOT_PATH_STORES)
        return stores.length
          ? { pass: false, detail: stores.map((s) => `${s.via.label} → ${s.store.label}`).join('; ') }
          : { pass: true }
      },
    },
    {
      id: 'anti-matching-sync',
      title: 'Matching makes no synchronous calls',
      category: 'antipattern',
      why: 'A blocking call from the engine, whether to risk, clearing or a standby, stalls every order queued behind it on that thread. The engine should only consume its journal and publish to its output stream.',
      hint: 'Replace REST/gRPC calls from the matching engine with events on its output stream, and let the standby consume the journal instead of being called.',
      concepts: ['single-writer', 'event-driven'],
      test: (g) => {
        const m = g.ownerFamily('matching')
        const calls = m.flatMap((n) => g.targets(n.id, SYNC_PROTOCOLS).map((t) => `${n.label} → ${t.label}`))
        return calls.length ? { pass: false, detail: calls.join('; ') } : { pass: true }
      },
    },
  ],
  inspiration: [
    { label: 'Martin Fowler — The LMAX Architecture', url: 'https://martinfowler.com/articles/lmax.html' },
    { label: 'ByteByteGo — Design a stock exchange', url: 'https://bytebytego.com/courses/system-design-interview/stock-exchange' },
  ],
  reference: {
    decisions: {
      style: 'event-driven',
      communication: 'hybrid',
      data: 'cqrs',
      stack: { frontend: 'react', mobile: 'flutter', backend: 'axum', database: 'postgres', messaging: 'redpanda', cache: 'hazelcast' },
      rationale:
        'The only synchronous hop on the hot path is gateway to sequencer, which acks once the order sits in an in-memory journal replicated to the standby. That journal feeds single-threaded in-memory engines per shard, and every other concern is a projection of the engines’ Redpanda output stream.',
    },
    walkthrough: [
      'Order gateways (Rust) authenticate sessions against Keycloak, enforce per-account rate limits and run pre-trade risk against balances held in a Hazelcast near cache, which they update from fill events on the output stream. No database is touched per order.',
      'The sequencer, a Rust primary/standby pair, stamps every accepted order with a global sequence number and appends it to an Aeron Cluster journal partitioned by instrument shard. It acks the gateway as soon as the entry is replicated to the standby data centre, which keeps the ack path in memory and under 1 ms. Journal segments are archived to S3 for the 5-year audit trail; a Kafka-class broker here would cost several milliseconds per order.',
      'Each matching engine is a single writer: one thread, order books in memory, deterministic logic. A hot standby consumes the same journal partitions and holds identical books, and it writes the periodic snapshots to S3, so the primaries never pause and a restart loads the last snapshot and replays only the tail of the journal.',
      'Engines publish trades, book deltas and fills to a Redpanda execution stream, where a few milliseconds of lag are acceptable. The gateways update balances from it, the market-data publisher builds depth and tickers and pushes them through Centrifugo to 100k WebSocket subscribers (conflating for slow clients), clearing books trades in a PostgreSQL ledger and settles with the custodian at end of day, and surveillance loads ClickHouse.',
      'The trade-off is operational complexity. Determinism has to be guarded (no wall clocks or randomness in the engine), journal partitions must be sized per shard, and failover of both the sequencer and the engines must be rehearsed. In return the core never waits on I/O, and every state the exchange has ever been in can be replayed.',
    ],
    diagram: diagram(
      [
        ['web', 'web-app', 'Trading Terminal', 0, 0, { tech: 'react' }],
        ['mobile', 'mobile-app', 'Mobile App', 0, 200, { tech: 'flutter' }],
        ['rtg', 'realtime-gateway', 'Market Data WS', 260, -120, { tech: 'centrifugo', notes: 'Conflates updates for slow subscribers' }],
        ['lb', 'load-balancer', 'L4 Load Balancer', 260, 120, { tech: 'haproxy' }],
        ['idp', 'identity', 'Identity', 260, 320, { tech: 'keycloak' }],
        ['ogw', 'service', 'Order Gateway', 520, 80, { tech: 'axum', domains: ['order-entry'], notes: 'Auth, rate limits, pre-trade risk' }],
        ['risk', 'cache', 'Balances & Limits', 520, 260, { tech: 'hazelcast', notes: 'Near cache in gateway memory, updated from fills' }],
        ['seq', 'service', 'Sequencer', 780, 190, { tech: 'axum', domains: ['sequencing'], notes: 'Primary/standby pair; acks once the journal entry is replicated' }],
        ['journal', 'broker', 'Input Journal (Aeron Cluster)', 1040, 300, { notes: 'In-memory, replicated to the standby DC; partition per instrument shard' }],
        ['meA', 'service', 'Matching Engine — shard A', 1300, 80, { tech: 'axum', domains: ['matching'], notes: 'Single thread, books in memory' }],
        ['meB', 'service', 'Matching Engine — shard B', 1300, 300, { tech: 'axum', domains: ['matching'], notes: 'Single thread, books in memory' }],
        ['standby', 'service', 'Hot Standby (A + B)', 1300, 520, { tech: 'axum', domains: ['matching'], notes: 'Replays the same journal; writes snapshots' }],
        ['snap', 'object-storage', 'Snapshots & Journal Archive', 1040, 520, { tech: 's3', notes: '5-year retention (Object Lock)' }],
        ['out', 'broker', 'Execution Stream', 1640, -100, { tech: 'redpanda', notes: 'Trades, book deltas, fills' }],
        ['md', 'service', 'Market Data Publisher', 1380, -280, { tech: 'axum', domains: ['market-data'] }],
        ['clearing', 'service', 'Clearing & Settlement', 1900, -100, { tech: 'spring-boot', domains: ['clearing'] }],
        ['ledger', 'relational-db', 'Settlement Ledger', 2160, -180, { tech: 'postgres' }],
        ['bank', 'external', 'Custodian Bank', 2160, -40, { tech: 'generic-api' }],
        ['surv', 'worker', 'Surveillance', 1900, 80, { tech: 'spring-boot', domains: ['surveillance'] }],
        ['olap', 'analytics-db', 'Trade Analytics', 2160, 100, { tech: 'clickhouse' }],
        ['otel', 'otel-collector', 'OTel Collector', 1640, 190, { tech: 'otel-collector' }],
        ['prom', 'metrics', 'Latency Metrics', 1560, 720, { tech: 'prometheus' }],
        ['logs', 'logging', 'Logs', 1820, 720, { tech: 'loki' }],
        ['grafana', 'dashboards', 'Dashboards', 1300, 720, { tech: 'grafana' }],
        ['alerts', 'alerting', 'SLO Alerts', 1560, 860, { tech: 'alertmanager' }],
      ],
      [
        ['web', 'lb', 'http', 'orders'],
        ['mobile', 'lb', 'http', 'orders'],
        ['web', 'rtg', 'websocket', 'depth & trades'],
        ['mobile', 'rtg', 'websocket', 'depth & trades'],
        ['lb', 'ogw', 'http'],
        ['ogw', 'idp', 'http', 'verify session'],
        ['ogw', 'risk', 'data', 'balance check'],
        ['ogw', 'seq', 'grpc', 'accepted orders'],
        ['seq', 'journal', 'event', 'sequenced inputs'],
        ['journal', 'meA', 'event'],
        ['journal', 'meB', 'event'],
        ['journal', 'standby', 'event', 'same partitions'],
        ['journal', 'snap', 'data', 'archive segments'],
        ['standby', 'snap', 'data', 'snapshots'],
        ['meA', 'out', 'event'],
        ['meB', 'out', 'event'],
        ['out', 'ogw', 'event', 'fills'],
        ['out', 'md', 'event'],
        ['out', 'clearing', 'event', 'trades'],
        ['out', 'surv', 'event'],
        ['md', 'rtg', 'grpc', 'publish channels'],
        ['clearing', 'ledger', 'data'],
        ['clearing', 'bank', 'http', 'EOD settlement'],
        ['surv', 'olap', 'data'],
        ['ogw', 'otel', 'telemetry'],
        ['seq', 'otel', 'telemetry'],
        ['meA', 'otel', 'telemetry'],
        ['meB', 'otel', 'telemetry'],
        ['standby', 'otel', 'telemetry'],
        ['md', 'otel', 'telemetry'],
        ['clearing', 'otel', 'telemetry'],
        ['surv', 'otel', 'telemetry'],
        ['otel', 'prom', 'telemetry'],
        ['otel', 'logs', 'telemetry'],
        ['prom', 'grafana', 'telemetry'],
        ['prom', 'alerts', 'telemetry'],
      ],
    ),
  },
}

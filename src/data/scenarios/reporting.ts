import type { ComponentKind, DiagramNode, Scenario } from '../../engine/types'
import { SYNC_PROTOCOLS } from '../../engine/types'
import { DATA_KINDS, DB_KINDS, type Graph } from '../../engine/graph'
import { diagram, type EdgeSpec, type NodeSpec } from './builder'

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------

/** Operational capabilities owned by the existing microservices. */
const OPERATIONAL = ['orders', 'routing', 'fleet', 'drivers', 'deliveries', 'billing', 'customs']
/** The capabilities the finance and operations reports are built from (customs comes next quarter). */
const REPORTED = ['orders', 'routing', 'fleet', 'drivers', 'deliveries', 'billing']

const DOMAIN_LABEL: Record<string, string> = {
  orders: 'Orders',
  routing: 'Routing',
  fleet: 'Fleet',
  drivers: 'Drivers',
  deliveries: 'Deliveries',
  billing: 'Billing',
  customs: 'Customs',
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

/** BI tools: a Dashboards component, or a client / SaaS box labelled as one. */
const BI = /\bbi\b|power\s?bi|metabase|looker|tableau|superset|qlik|report|analytics|dashboard|wallboard/i
/** Schema registries (Confluent, Apicurio, Karapace, AWS Glue). */
const REGISTRY = /schema.?registry|apicurio|karapace|glue.*(schema|registry)|contract.?registry/i
const OUTBOX = /outbox/i
/** A version marker on an event edge or topic name: OrderPlaced.v3, orders.v2, "schema version 4". */
const VERSIONED = /\bv\d+\b|\.v\d+|version/i

const ownsOperational = (n: DiagramNode) => n.domains.some((d) => OPERATIONAL.includes(d))
const ownsReporting = (n: DiagramNode) => n.domains.includes('reporting') && !ownsOperational(n)
const isBroker = (n: DiagramNode) => n.kind === 'broker'
const labels = (ns: DiagramNode[]) => [...new Set(ns.map((n) => n.label))].join(', ')

const biTools = (g: Graph) =>
  g.nodes.filter((n) => n.kind === 'dashboards' || ((n.kind === 'external' || n.kind === 'web-app') && BI.test(n.label)))

/** Things on either end of any edge touching `id`. */
const touching = (g: Graph, id: string) => g.neighbours(id)

/** Owners of the operational capabilities, with their child modules / containers. */
function operationalOwners(g: Graph): DiagramNode[] {
  const out = new Map<string, DiagramNode>()
  for (const d of OPERATIONAL) for (const n of g.ownerFamily(d)) out.set(n.id, n)
  return [...out.values()]
}

/**
 * Stores that belong to an operational service: its databases, caches and
 * search indexes, plus read replicas / dumps copied straight out of them
 * (a replica still has the service's private schema).
 */
function operationalStores(g: Graph): DiagramNode[] {
  const own = g.storesOf(operationalOwners(g), [...DB_KINDS, 'cache', 'search'])
  const out = new Map(own.map((s) => [s.id, s]))
  for (const s of own) for (const t of g.targets(s.id)) if (DB_KINDS.includes(t.kind)) out.set(t.id, t)
  return [...out.values()]
}

/**
 * Stores dedicated to reporting: any analytics / warehouse store, or another
 * store no operational service uses that is written by the reporting pipeline.
 */
function reportingStores(g: Graph): DiagramNode[] {
  const ops = new Set(operationalStores(g).map((s) => s.id))
  return g.nodes.filter((n) => {
    if (ops.has(n.id) || !DATA_KINDS.includes(n.kind) || n.kind === 'object-storage') return false
    if (n.kind === 'analytics-db') return true
    return g.sources(n.id).some((s) => ownsReporting(s) || (s.kind === 'stream-processor' && !ownsOperational(s)))
  })
}

/** Reporting stores a BI tool reads (an edge in either direction, or through a reporting API it owns). */
function biStores(g: Graph): DiagramNode[] {
  const stores = new Map(reportingStores(g).map((s) => [s.id, s]))
  const out = new Map<string, DiagramNode>()
  for (const bi of biTools(g)) {
    for (const n of touching(g, bi.id)) {
      if (stores.has(n.id)) out.set(n.id, n)
      // BI → Reporting API → reporting store
      if (ownsReporting(n)) for (const m of touching(g, n.id)) if (stores.has(m.id)) out.set(m.id, m)
    }
  }
  return [...out.values()]
}

/** Everything on the reporting side: BI tools, reporting owners, reporting stores and whatever writes into them. */
function reportingSide(g: Graph): DiagramNode[] {
  const stores = reportingStores(g)
  const out = new Map<string, DiagramNode>()
  for (const n of [...biTools(g), ...g.nodes.filter(ownsReporting), ...stores]) out.set(n.id, n)
  for (const s of stores)
    for (const w of g.sources(s.id))
      if (!ownsOperational(w) && !['broker', 'cdc'].includes(w.kind) && !DATA_KINDS.includes(w.kind)) out.set(w.id, w)
  for (const sp of g.ofKind('stream-processor')) if (!ownsOperational(sp)) out.set(sp.id, sp)
  return [...out.values()]
}

/** Generic BFS over outgoing edges where intermediate hops must satisfy `hop`. */
function reach(g: Graph, starts: DiagramNode[], target: (n: DiagramNode) => boolean, hop: (n: DiagramNode) => boolean, maxDepth = 6) {
  const seen = new Set(starts.map((s) => s.id))
  let frontier = starts.map((s) => s.id)
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const next: string[] = []
    for (const id of frontier)
      for (const t of g.targets(id)) {
        if (!t || seen.has(t.id)) continue
        seen.add(t.id)
        if (target(t)) return true
        if (hop(t)) next.push(t.id)
      }
    frontier = next
  }
  return false
}

const PIPELINE_KINDS: ComponentKind[] = ['broker', 'cdc', 'stream-processor', 'worker', 'function']
/** Plumbing between the broker and the reporting store: messaging, consumers, or the reporting service itself. */
const pipelineHop = (n: DiagramNode) => (PIPELINE_KINDS.includes(n.kind) && !ownsOperational(n)) || ownsReporting(n)

/**
 * Brokers a domain publishes domain events to: directly, or from its database
 * through an outbox relay. Raw CDC of the service's tables is not publishing:
 * a broker fed only by raw CDC counts once a translator (a stream processor or
 * worker outside the reporting context) reads it and publishes events to another
 * broker. A broker-to-broker mirror or the reporting projection is not a translator.
 */
function brokersOf(g: Graph, domain: string): DiagramNode[] {
  const fam = g.ownerFamily(domain)
  // This domain's databases (any edge from its family) plus replicas copied out of them.
  const direct = [...new Map(fam.flatMap((f) => g.targets(f.id)).filter((t) => DB_KINDS.includes(t.kind)).map((t) => [t.id, t])).values()]
  const own = new Set([...direct, ...direct.flatMap((s) => g.targets(s.id)).filter((t) => DB_KINDS.includes(t.kind))].map((s) => s.id))
  // Outbox is judged per domain: another service's outbox DB on a shared relay does not cover this one.
  const outboxFor = (c: DiagramNode) => isOutboxRelay(g, c, touching(g, c.id).filter((s) => own.has(s.id)))
  const brokers = g.ofKind('broker')
  const via = (hop: (n: DiagramNode) => boolean) => brokers.filter((b) => reach(g, fam, (n) => n.id === b.id, hop, 3))
  const clean = via((n) => DB_KINDS.includes(n.kind) || (n.kind === 'cdc' && outboxFor(n)))
  const cleanIds = new Set(clean.map((b) => b.id))
  const rawCdcIds = new Set(rawCdc(g).map((c) => c.id))
  // A raw topic: reached through the domain's CDC and fed by raw CDC and nothing else.
  const rawTopics = via((n) => DB_KINDS.includes(n.kind) || n.kind === 'cdc').filter(
    (b) => !cleanIds.has(b.id) && g.sources(b.id).every((s) => rawCdcIds.has(s.id)),
  )
  if (!rawTopics.length) return clean
  const rawIds = new Set(rawTopics.map((b) => b.id))
  // A real translator hop (not the reporting projection) must read the raw topic and publish to another broker.
  const translators = rawTopics
    .flatMap((b) => g.targets(b.id))
    .filter((n) => (n.kind === 'stream-processor' || n.kind === 'worker') && !ownsReporting(n))
  const translated = translators.flatMap((t) => g.targets(t.id)).filter((b) => isBroker(b) && !cleanIds.has(b.id) && !rawIds.has(b.id))
  return [...new Map([...clean, ...translated].map((b) => [b.id, b])).values()]
}

function publishedBrokers(g: Graph): DiagramNode[] {
  const out = new Map<string, DiagramNode>()
  for (const d of REPORTED) for (const b of brokersOf(g, d)) out.set(b.id, b)
  return [...out.values()]
}

const saysOutbox = (n: DiagramNode) => OUTBOX.test(n.label) || OUTBOX.test(n.notes ?? '')

/**
 * Is a CDC relay publishing an outbox table (curated events) rather than raw table rows?
 * It needs an explicit outbox signal on the read side: the relay itself (outbox poller tech,
 * or "outbox" in its label / notes), the service database it reads, the edge between that
 * database and the relay, or the service's own write into that database. An "outbox" label
 * on the relay's edge into the broker is not enough.
 */
function isOutboxRelay(g: Graph, cdc: DiagramNode, sourceStores: DiagramNode[]) {
  if (cdc.tech === 'outbox-poller' || saysOutbox(cdc)) return true
  if (sourceStores.some(saysOutbox)) return true
  return sourceStores.some((s) =>
    [...g.out(s.id), ...g.in(s.id)].some((e) => {
      if (!OUTBOX.test(e.label ?? '')) return false
      if (e.source === cdc.id || e.target === cdc.id) return true
      const writer = g.node(e.source)
      return e.target === s.id && !!writer && ownsOperational(writer)
    }),
  )
}

/** CDC relays that read an operational database and stream its raw rows. */
function rawCdc(g: Graph): DiagramNode[] {
  const ops = new Set(operationalStores(g).map((s) => s.id))
  return g.ofKind('cdc').filter((c) => {
    const stores = touching(g, c.id).filter((n) => ops.has(n.id))
    // Flag a shared relay when any one of the databases it reads is not an outbox.
    return stores.some((s) => !isOutboxRelay(g, c, [s]))
  })
}

// ---------------------------------------------------------------------------
// Diagrams
// ---------------------------------------------------------------------------

const serviceNodes: NodeSpec[] = [
  ['orders', 'service', 'Orders', 0, 0, { tech: 'spring-boot', domains: ['orders'] }],
  ['routing', 'service', 'Routing', 0, 100, { tech: 'spring-boot', domains: ['routing'] }],
  ['fleet', 'service', 'Fleet', 0, 200, { tech: 'spring-boot', domains: ['fleet'] }],
  ['drivers', 'service', 'Drivers', 0, 300, { tech: 'spring-boot', domains: ['drivers'] }],
  ['deliveries', 'service', 'Deliveries', 0, 400, { tech: 'spring-boot', domains: ['deliveries'] }],
  ['billing', 'service', 'Billing', 0, 500, { tech: 'spring-boot', domains: ['billing'] }],
  ['customs', 'service', 'Customs', 0, 620, { tech: 'spring-boot', domains: ['customs'] }],
  ['ordersDb', 'relational-db', 'Orders DB', 260, 0, { tech: 'postgres' }],
  ['routingDb', 'relational-db', 'Routing DB', 260, 100, { tech: 'postgres' }],
  ['fleetDb', 'relational-db', 'Fleet DB', 260, 200, { tech: 'postgres' }],
  ['driversDb', 'relational-db', 'Drivers DB', 260, 300, { tech: 'postgres' }],
  ['deliveriesDb', 'relational-db', 'Deliveries DB', 260, 400, { tech: 'postgres' }],
  ['customsDb', 'document-db', 'Customs DB', 260, 620, { tech: 'mongodb' }],
]

const serviceEdges: EdgeSpec[] = [
  ['orders', 'ordersDb'],
  ['routing', 'routingDb'],
  ['fleet', 'fleetDb'],
  ['drivers', 'driversDb'],
  ['deliveries', 'deliveriesDb'],
  ['customs', 'customsDb'],
]

const starter = diagram(
  [
    ...serviceNodes,
    ['billingDb', 'relational-db', 'Billing DB', 260, 500, { tech: 'postgres' }],
    ['kafka', 'broker', 'Order Events', 560, 0, { tech: 'kafka', notes: 'Only Orders publishes today' }],
    ['powerbi', 'dashboards', 'Power BI (Finance & Ops)', 600, 300, { notes: 'Read-only SQL user on five service databases' }],
  ],
  [
    ...serviceEdges,
    ['billing', 'billingDb'],
    ['orders', 'kafka', 'event', 'OrderPlaced'],
    ['kafka', 'billing', 'event'],
    ['kafka', 'customs', 'event'],
    ['powerbi', 'ordersDb', 'data', 'SELECT … JOIN'],
    ['powerbi', 'routingDb', 'data', 'read-only user'],
    ['powerbi', 'fleetDb', 'data', 'read-only user'],
    ['powerbi', 'deliveriesDb', 'data', 'read-only user'],
    ['powerbi', 'billingDb', 'data', 'read-only user'],
  ],
)

const referenceDiagram = diagram(
  [
    ...serviceNodes,
    ['billingDb', 'relational-db', 'Billing DB + Outbox', 260, 500, { tech: 'postgres', notes: 'invoice row and outbox row written in one transaction' }],
    ['relay', 'cdc', 'Outbox Relay', 540, 500, { tech: 'debezium', notes: 'Debezium outbox event router: publishes outbox rows, never raw invoice tables' }],
    [
      'registry',
      'external',
      'Schema Registry (Confluent)',
      800,
      20,
      { tech: 'generic-api', notes: 'Avro schemas per event, FULL_TRANSITIVE compatibility enforced in CI' },
    ],
    [
      'kafka',
      'broker',
      'Domain Events',
      800,
      300,
      { tech: 'kafka', notes: 'Managed Kafka (EU region). One topic per event type, 13 months retention for backfills' },
    ],
    ['flink', 'stream-processor', 'Live KPIs', 1080, 170, { tech: 'flink', domains: ['reporting'], notes: 'on-time % per depot and customer in 1-minute tumbling windows' }],
    ['ingest', 'worker', 'Reporting Ingest', 1080, 420, { tech: 'spring-boot', domains: ['reporting'], notes: 'Owned by the data team; maps events to fact and dimension tables, idempotent on event id' }],
    ['clickhouse', 'analytics-db', 'Reporting Store', 1360, 300, { tech: 'clickhouse', notes: 'fact_stop, fact_route_cost, fact_invoice; 13 months' }],
    ['powerbi', 'dashboards', 'Power BI (Finance & Ops)', 1640, 300, { notes: 'Reads only the reporting store' }],
  ],
  [
    ...serviceEdges,
    ['billing', 'billingDb', 'data', 'invoice + outbox row, one tx'],
    ['billingDb', 'relay', 'event', 'outbox table'],
    ['relay', 'kafka', 'event', 'InvoiceIssued.v2'],
    ['orders', 'kafka', 'event', 'OrderPlaced.v3'],
    ['routing', 'kafka', 'event', 'RoutePlanned.v2 (km, tolls)'],
    ['fleet', 'kafka', 'event', 'FuelBought.v1, TollPaid.v1'],
    ['drivers', 'kafka', 'event', 'ShiftClosed.v1 (hours, rate)'],
    ['deliveries', 'kafka', 'event', 'StopCompleted.v4 (planned vs actual)'],
    ['kafka', 'customs', 'event', 'OrderPlaced.v3'],
    ['orders', 'registry', 'http', 'register schema'],
    ['kafka', 'flink', 'event', 'StopCompleted, OrderPlaced'],
    ['kafka', 'ingest', 'event', 'all domain events'],
    ['flink', 'registry', 'http', 'resolve schema'],
    ['ingest', 'registry', 'http', 'resolve schema'],
    ['flink', 'clickhouse', 'data', 'live on-time %'],
    ['ingest', 'clickhouse', 'data', 'fact tables'],
    ['powerbi', 'clickhouse', 'data', 'reports'],
  ],
)

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

export const fleetReporting: Scenario = {
  id: 'trasa-reporting',
  title: 'Trasa: reports without raiding the databases',
  tagline: 'Seven microservices, seven private databases, and a CFO who wants cost per route by 06:00.',
  industry: 'Logistics & marketplaces',
  difficulty: 'intermediate',
  estMinutes: 35,
  accent: '#0f766e',
  concepts: ['microservices-reporting', 'bounded-context', 'database-per-service', 'events-vs-messages', 'contract-versioning', 'cdc', 'outbox', 'stream-processing'],
  story:
    'Trasa moves freight for Polish manufacturers across Poland, Czechia, Germany and Lithuania from its Poznań headquarters. Over two years the company split its old dispatch monolith into seven microservices (Orders, Routing, Fleet, Drivers, Deliveries, Billing and Customs). Each team owns its own database and ships on its own schedule. One shortcut from the migration was never removed: Power BI still logs into five of those databases with a read-only SQL user. This quarter it broke twice. The Routing team renamed planned_eta to planned_arrival and the on-time report quietly showed 100% for nine days. Then Billing split its invoices table and the month-end revenue report went blank. On a Monday at 8:00 an analyst ran a nine-way join on the Orders database, and order intake slowed for every customer. The CFO wants cost per route and revenue per customer every morning, and depot managers want live on-time figures on their wallboards. The CTO has ruled out a shared database, and no team will be asked to freeze its schema.',
  facts: [
    { label: 'Platform', value: '7 microservices, 6 teams, each service owns its database (6× PostgreSQL, Customs on MongoDB)' },
    { label: 'Volume', value: '18,000 shipments and ~65,000 delivery stops per day, 1,400 trucks, ~3M business events per day' },
    { label: 'Reports', value: '38 Power BI reports and 12 depot wallboards; daily reports by 06:00, wallboards ≤ 60 s behind' },
    { label: 'Incidents', value: '2 broken reports after schema migrations this quarter; one BI query added +4 s to Orders p95 at peak' },
    { label: 'Data team', value: '2 data engineers, plus 3 finance analysts who build their own reports' },
  ],
  functional: [
    'Finance sees cost per route (fuel, tolls, driver hours) and revenue and margin per customer every morning',
    'Depot managers see on-time delivery % per depot and per customer on live wallboards',
    'Analysts can add a new report and backfill it from the last 13 months of history',
    'Month-end revenue reports reconcile with issued invoices to the grosz',
    'Every team keeps changing its own schema and deploying on its own schedule',
  ],
  nonFunctional: [
    'No report or reporting job may read a service’s operational database, its replica or its private API at report time',
    'A schema migration inside a service must never break a report; contract changes are versioned and compatible',
    'Daily reports are ready by 06:00; live on-time % is at most 60 seconds behind',
    'An issued invoice must always appear in the revenue reports: no lost events, no dual writes',
    'Report history can be rebuilt from scratch when a metric definition changes',
  ],
  constraints: [
    'Stay on microservices: no shared operational database and no schema freeze for the teams',
    'Finance keeps Power BI, and it should connect to exactly one place',
    'Teams build in Kotlin/Spring Boot on PostgreSQL; a managed Kafka cluster already exists but carries only order events',
    'The data team has two engineers, so prefer managed services',
  ],
  domains: [
    { id: 'orders', label: 'Orders', description: 'Customer orders, price agreed, promised delivery windows' },
    { id: 'routing', label: 'Route planning', description: 'Planned routes, kilometres, tolls and stop sequence' },
    { id: 'fleet', label: 'Fleet', description: 'Trucks, fuel cards, tolls and maintenance costs' },
    { id: 'drivers', label: 'Drivers', description: 'Shifts, working-time rules and driver pay rates' },
    { id: 'deliveries', label: 'Deliveries', description: 'Stops, ETAs, proof of delivery, actual arrival times' },
    { id: 'billing', label: 'Billing', description: 'Invoices, credit notes and payment status' },
    { id: 'customs', label: 'Customs', description: 'Export declarations for non-EU legs' },
    { id: 'reporting', label: 'Reporting & analytics', description: 'Reporting store, metric definitions, BI datasets and live KPIs' },
  ],
  recommendedStyles: ['microservices', 'event-driven'],
  styleFeedback: {
    microservices:
      'Right call: keep the microservices. Reporting does not call for a new style. It needs its own bounded context with its own store, fed by the events the services push out.',
    'event-driven':
      'Good fit: domain events such as StopCompleted and InvoiceIssued drive the reporting pipeline, and the same events decouple services from each other. Just keep each service in charge of its own data.',
    'modular-monolith':
      'Merging everything back into one deployable with one schema would make SQL joins easy again, but it throws away two years of independent deployability to fix a reporting problem that events can solve.',
    monolith:
      'Trasa just left this. One big schema with BI on top is how the old dispatch tables used to lock up whenever finance ran month-end reports.',
    serverless:
      'Functions could run the ingestion, but they do not touch the real problem, which is data ownership. Rewriting seven long-running services as functions changes the compute and leaves the reports coupled to private schemas.',
    'service-based':
      'A few coarse services sharing one database would give BI one place to read, but every team’s migration would be a cross-team event again. That is the breakage Trasa suffers now, just concentrated in one schema.',
    'space-based':
      'In-memory data grids handle extreme, spiky concurrent load. Trasa’s problem is analytical reads across domains, and a grid of processing units adds nothing to it.',
    microkernel:
      'A plug-in core suits products customised per client or market. Trasa’s domains are owned by separate teams with separate data, so they are not plug-ins of one core.',
  },
  hints: [
    'Start with the five lines from Power BI into the service databases. Each one is a contract the owning team never agreed to. Where should the BI tool read instead?',
    'Reporting is a bounded context of its own. Give it a dedicated store shaped for analytics (ClickHouse, BigQuery, Snowflake, or a separate reporting PostgreSQL) and connect Power BI only there.',
    'Fill that store by push, not pull. Each service publishes domain events (StopCompleted, ShiftClosed, InvoiceIssued) to a broker, and a reporting pipeline owned by the data team consumes them.',
    'If events carry only an id, the pipeline has to call Orders back for the price and customer, and that is the HTTP pull model again. Put the facts reports need into the event itself.',
    'CDC is fine for a service that cannot publish yet, but raw table rows are the private schema. Put a translation step (stream processor or worker) after the raw topic that turns rows into domain events on a broker, or use the outbox pattern. Billing especially must not lose an invoice.',
    'Version event contracts in a schema registry (or at least in the event names) so teams can evolve them safely. Live on-time % is a windowed aggregation, which is a job for a stream processor.',
  ],
  checks: [
    {
      id: 'no-db-pull',
      title: 'Reporting never reads service databases',
      category: 'core',
      why: 'When a BI tool or ETL job reads a service’s tables (or a replica of them), that private schema becomes a public contract nobody owns. Renaming a column breaks reports, often silently, and heavy analytical queries steal capacity from the operational path. This is the database pull model, and it removes the independence the microservices were built for.',
      hint: 'Remove every edge between Power BI (or any reporting job) and Orders, Routing, Fleet, Drivers, Deliveries or Billing databases, replicas included. Reporting should read only its own store.',
      concepts: ['microservices-reporting', 'bounded-context', 'database-per-service'],
      test: (g) => {
        const ops = operationalStores(g)
        if (!ops.length) return { pass: false, detail: 'Draw the services with their own databases first.' }
        const opIds = new Set(ops.map((s) => s.id))
        const offenders = reportingSide(g).filter((n) => n.kind !== 'cdc' && touching(g, n.id).some((t) => opIds.has(t.id)))
        if (!offenders.length) return true
        const reads = offenders.map((o) => `${o.label} → ${labels(touching(g, o.id).filter((t) => opIds.has(t.id)))}`)
        return { pass: false, detail: `Reporting reads operational data directly: ${reads.join('; ')}.` }
      },
    },
    {
      id: 'bi-reads-reporting-store',
      title: 'Power BI reads a dedicated reporting store',
      category: 'core',
      why: 'Reporting needs its own read model, shaped for cross-domain queries (facts and dimensions, pre-joined, history kept) and owned by the reporting context. Finance gets one place to connect, and services can change their schemas without asking BI first.',
      hint: 'Add an Analytics / warehouse store (ClickHouse, BigQuery, Snowflake) or a separate reporting database written only by the reporting pipeline, and connect Power BI to it.',
      concepts: ['microservices-reporting', 'cqrs'],
      test: (g) => {
        const tools = biTools(g)
        if (!tools.length) return { pass: false, detail: 'No BI tool on the canvas. Add a Dashboards component for Power BI.' }
        if (biStores(g).length) return true
        const stores = reportingStores(g)
        return {
          pass: false,
          detail: stores.length ? `${labels(tools)} is not connected to ${labels(stores)}.` : 'There is no reporting store that is separate from the service databases.',
        }
      },
    },
    {
      id: 'domain-events-published',
      title: 'Every reported domain publishes events to a broker',
      category: 'core',
      why: 'In the push model each service announces what happened (OrderPlaced, StopCompleted, ShiftClosed, InvoiceIssued) on its own schedule and in a contract it owns. Reporting subscribes without reaching into anybody’s database, and the publishing team decides when its private model changes.',
      hint: 'Connect Orders, Routing, Fleet, Drivers, Deliveries and Billing to a Message broker (Kafka) with Event edges, either directly or through an outbox relay on their own database. Raw CDC of a service’s tables is not publishing. A CDC relay counts only when it reads an outbox table: say "outbox" on the relay, on its database, on the edge from that database to the relay, or on the service’s write into it. Otherwise a translator has to turn the raw rows into events on a broker.',
      concepts: ['events-vs-messages', 'event-driven', 'outbox'],
      test: (g) => {
        const missing = REPORTED.filter((d) => !brokersOf(g, d).length)
        return missing.length
          ? { pass: false, detail: `No events from: ${missing.map((d) => DOMAIN_LABEL[d]).join(', ')}.` }
          : true
      },
    },
    {
      id: 'events-feed-reporting-store',
      title: 'Events flow through a pipeline into the reporting store',
      category: 'core',
      why: 'The reporting store is a projection of the domain events. A consumer owned by the data team (a worker, a stream processor, or a reporting service) maps each event into fact tables. Reports can then join orders, routes, costs and invoices without any service being online or involved.',
      hint: 'Have a Reporting Ingest worker or stream processor consume the broker and write into the store Power BI reads. Make sure every reported domain’s events reach it.',
      concepts: ['microservices-reporting', 'event-driven', 'cqrs'],
      test: (g) => {
        const stores = biStores(g)
        if (!stores.length) return { pass: false, detail: 'Connect Power BI to a reporting store first.' }
        const ids = new Set(stores.map((s) => s.id))
        // From each domain: a path that crosses a broker and then only reporting plumbing.
        const lands = (domain: string) => {
          const brokers = brokersOf(g, domain)
          return brokers.length > 0 && reach(g, brokers, (n) => ids.has(n.id), pipelineHop)
        }
        const missing = REPORTED.filter((d) => !lands(d))
        return missing.length
          ? { pass: false, detail: `Events from ${missing.map((d) => DOMAIN_LABEL[d]).join(', ')} never reach ${labels(stores)} through the broker.` }
          : true
      },
    },
    {
      id: 'versioned-contracts',
      title: 'Event contracts are versioned',
      category: 'bonus',
      why: 'Once reporting depends on events, the event schema is the contract. A schema registry with compatibility rules, or at least explicit versions such as StopCompleted.v4, lets a team add fields freely and run v1 and v2 side by side during a breaking change. That is how a breaking change to StopCompleted should play out.',
      hint: 'Add a Schema Registry (Confluent, Apicurio, Glue) used by the publishers or the reporting pipeline, or put versions in every event name on the edges into the broker.',
      concepts: ['contract-versioning', 'events-vs-messages'],
      test: (g) => {
        const brokers = publishedBrokers(g)
        if (!brokers.length) return { pass: false, detail: 'No domain events yet.' }
        const brokerIds = new Set(brokers.map((b) => b.id))
        const related = (n: DiagramNode) => brokerIds.has(n.id) || ownsOperational(n) || pipelineHop(n)
        const registry = g.nodes.some((n) => (g.hasTrait(n, 'schema-registry') || REGISTRY.test(n.label)) && touching(g, n.id).some(related))
        if (registry) return true
        const into = g.edges.filter((e) => brokerIds.has(e.target) && e.protocol === 'event')
        const unversioned = into.filter((e) => !VERSIONED.test(e.label ?? ''))
        return into.length && !unversioned.length
          ? true
          : { pass: false, detail: 'No schema registry connected to the event flow, and not every event into the broker carries a version.' }
      },
    },
    {
      id: 'live-on-time-stream',
      title: 'Live on-time % comes from a stream processor',
      category: 'bonus',
      why: 'Wallboards that lag by at most 60 seconds cannot wait for a nightly load. A stream processor counts on-time stops per depot in one-minute windows as StopCompleted events arrive and writes the result where BI reads it. The daily batch reports keep using the same store.',
      hint: 'Add a Stream processor (Flink, Kafka Streams) that consumes the domain events and writes live KPIs into the store Power BI reads.',
      concepts: ['stream-processing'],
      test: (g) => {
        const brokers = publishedBrokers(g)
        const stores = new Set(biStores(g).map((s) => s.id))
        if (!brokers.length || !stores.size) return { pass: false, detail: 'Needs domain events and a reporting store first.' }
        const live = g
          .ofKind('stream-processor')
          .filter((sp) => !ownsOperational(sp))
          .filter((sp) => reach(g, brokers, (n) => n.id === sp.id, (n) => n.kind === 'broker' || n.kind === 'stream-processor', 3))
          .some((sp) => reach(g, [sp], (n) => stores.has(n.id), pipelineHop, 3))
        return live ? true : { pass: false, detail: 'No stream processor turns the domain events into live KPIs in the reporting store.' }
      },
    },
    {
      id: 'replayable-history',
      title: 'The reporting store can be rebuilt from a replayable log',
      category: 'bonus',
      why: 'New reports and changed metric definitions need history. If the broker keeps events (Kafka, Pulsar, Kinesis), the data team can replay 13 months into a new table without asking six teams for a backfill. With a queue that deletes on ack, history lives only in the store you might need to rebuild.',
      hint: 'Use a log-based broker with retention (Kafka, Redpanda, Pulsar) for the domain events that feed reporting.',
      concepts: ['kafka-vs-rabbitmq', 'event-sourcing'],
      test: (g) => {
        const stores = new Set(biStores(g).map((s) => s.id))
        const feeding = publishedBrokers(g).filter((b) => reach(g, [b], (n) => stores.has(n.id), pipelineHop))
        if (!feeding.length) return { pass: false, detail: 'No broker feeds the reporting store yet.' }
        const replayable = feeding.filter((b) => !b.tech || g.hasTrait(b, 'replayable'))
        return replayable.length ? true : { pass: false, detail: `${labels(feeding)} does not keep events for replay.` }
      },
    },
    {
      id: 'billing-outbox',
      title: 'Billing publishes invoices through a transactional outbox',
      category: 'bonus',
      why: 'Revenue reports must match the ledger. If Billing commits an invoice and then crashes before publishing InvoiceIssued, the report is wrong forever. Writing the event to an outbox table in the same transaction and relaying it (polling or log-based CDC) guarantees every committed invoice is published at least once. The pipeline then deduplicates on event id.',
      hint: 'Have Billing write an outbox row with each invoice and let an Outbox relay (Debezium outbox router, outbox poller) publish it to the broker, with no direct Billing → broker edge.',
      concepts: ['outbox', 'guaranteed-delivery', 'idempotency'],
      test: (g) => {
        const fam = g.ownerFamily('billing')
        if (!fam.length) return { pass: false, detail: 'Nobody owns Billing yet.' }
        const stores = g.storesOf(fam, DB_KINDS)
        const storeIds = new Set(stores.map((s) => s.id))
        const relays = g.nodes.filter(
          (r) =>
            (r.kind === 'cdc' || (r.kind === 'worker' && OUTBOX.test(r.label))) &&
            touching(g, r.id).some((n) => storeIds.has(n.id)) &&
            g.targets(r.id).some(isBroker) &&
            (r.kind !== 'cdc' || isOutboxRelay(g, r, stores)),
        )
        if (!relays.length) return { pass: false, detail: 'Billing events are not relayed from an outbox table in the Billing database.' }
        const relayIds = new Set(relays.map((r) => r.id))
        const direct = fam.filter((n) => !relayIds.has(n.id) && g.targets(n.id).some(isBroker))
        return direct.length
          ? { pass: false, detail: `${labels(direct)} also publishes to the broker directly — that is the dual write the outbox removes.` }
          : true
      },
    },
    {
      id: 'anti-report-http-pull',
      title: 'Reporting does not call service APIs to gather data',
      category: 'antipattern',
      why: 'Pulling report data over HTTP from each service hides the database coupling behind REST, but it keeps the other problems. Reports are only as available as the slowest service, nightly jobs hammer operational APIs, and an anemic event (just an id) that forces a callback turns every message into a synchronous request. Events should carry the data reporting needs.',
      hint: 'Remove synchronous calls from Power BI or the reporting pipeline to Orders, Routing, Billing and the rest. Enrich the events instead, or keep reference data in the reporting store.',
      concepts: ['microservices-reporting', 'events-vs-messages', 'fallacies-of-distributed-computing'],
      test: (g) => {
        const isOp = (n: DiagramNode) => ownsOperational(n)
        const offenders = reportingSide(g).filter((n) =>
          g.reaches(n, isOp, { protocols: SYNC_PROTOCOLS, through: ['api-gateway', 'load-balancer', 'bff'], maxDepth: 3 }),
        )
        return offenders.length ? { pass: false, detail: `${labels(offenders)} call operational services synchronously for report data.` } : true
      },
    },
    {
      id: 'anti-raw-cdc-to-warehouse',
      title: 'Raw CDC rows never land in reporting untranslated',
      category: 'antipattern',
      why: 'Log-based CDC is a useful bridge for a service that cannot publish events yet, but raw change rows are the service’s private table layout. Streaming them straight into the warehouse (or through a broker into a sink) recreates the database pull model over a faster wire. A rename still breaks the reports. A translation step (an anti-corruption layer) has to turn rows into versioned domain events first.',
      hint: 'Put a stream processor or worker after the raw CDC topic that maps rows into domain events on a broker, or switch the service to an outbox table.',
      concepts: ['cdc', 'anti-corruption-layer', 'contract-versioning'],
      test: (g) => {
        const raw = rawCdc(g)
        if (!raw.length) return true
        const ops = new Set(operationalStores(g).map((s) => s.id))
        const bi = new Set(biTools(g).map((b) => b.id))
        const landing = (n: DiagramNode) => bi.has(n.id) || (DATA_KINDS.includes(n.kind) && !ops.has(n.id))
        const offenders = raw.filter((c) => reach(g, [c], landing, (n) => n.kind === 'broker' || n.kind === 'cdc'))
        return offenders.length
          ? { pass: false, detail: `${labels(offenders)} streams raw table rows into reporting without a translation step.` }
          : true
      },
    },
  ],
  inspiration: [
    { label: 'Mark Richards — Lesson 13: Microservices and Reporting', url: 'https://www.developertoarchitect.com/lessons/lesson13.html' },
    { label: 'Mark Richards — Lesson 41: Microservices Contract Versioning', url: 'https://www.developertoarchitect.com/lessons/lesson41.html' },
    { label: 'Shopify Engineering — Capturing every change from Shopify’s sharded monolith (CDC into Kafka for analytics)', url: 'https://shopify.engineering/capturing-every-change-shopify-sharded-monolith' },
    { label: 'Debezium — Reliable microservices data exchange with the outbox pattern', url: 'https://debezium.io/blog/2019/02/19/reliable-microservices-data-exchange-with-the-outbox-pattern/' },
  ],
  starter,
  starterDecisions: {
    style: 'microservices',
    communication: 'sync',
    data: 'per-service',
    stack: { backend: 'spring-boot', database: 'postgres', messaging: 'kafka' },
    rationale: 'Services own their data; Power BI reads the service databases directly with a read-only user.',
  },
  reference: {
    decisions: {
      style: 'microservices',
      communication: 'hybrid',
      data: 'per-service',
      stack: { backend: 'spring-boot', database: 'postgres', messaging: 'kafka' },
      rationale:
        'Keep the seven microservices and make Reporting a bounded context of its own. Services push versioned, data-carrying domain events to the existing managed Kafka (Billing through a transactional outbox). A data-team ingest worker and a Flink job project them into ClickHouse, and Power BI reads only ClickHouse. No reporting component reads a service database or calls a service API, so teams can migrate their schemas freely.',
    },
    walkthrough: [
      'The seven Spring Boot services keep their private databases. Nothing outside a service touches its tables, and the read-only SQL user for Power BI is deleted.',
      'Each reported domain publishes facts the moment they happen: OrderPlaced (customer, agreed price, promised window), RoutePlanned (km, tolls), FuelBought and TollPaid, ShiftClosed (hours, rate), StopCompleted (planned vs actual arrival). Events carry the data reports need, so nobody has to call a service back for the details.',
      'Billing writes each invoice and its InvoiceIssued outbox row in one PostgreSQL transaction. The Debezium outbox router relays only the outbox table, so a crash can never commit an invoice without its event, and the raw invoice tables stay private.',
      'Every event has an Avro schema in the Schema Registry with FULL_TRANSITIVE compatibility checked in CI, because the service teams evolve their events first and the reporting consumers catch up later. A breaking change ships as a new version (StopCompleted.v4 → v5) published side by side until reporting has switched. A column rename inside Routing now never reaches reporting, and a field removed from StopCompleted is rejected by the registry before it ships.',
      'The data team’s Reporting Ingest worker consumes all domain events and upserts fact and dimension tables in ClickHouse, deduplicating on event id. Kafka keeps 13 months of events, so a new report or a changed metric is a replay, not a request to six teams.',
      'A Flink job computes on-time % per depot and customer in one-minute windows from StopCompleted and OrderPlaced and writes it to ClickHouse, so the wallboards stay under 60 seconds behind. Power BI connects only to ClickHouse for both the 06:00 finance pack and the live wallboards. The wallboards use DirectQuery with automatic page refresh; the 06:00 pack can use import mode.',
    ],
    diagram: referenceDiagram,
  },
}

import type { DiagramNode, Scenario } from '../../engine/types'
import { SYNC_PROTOCOLS } from '../../engine/types'
import type { Graph } from '../../engine/graph'
import { COMPUTE_KINDS, DB_KINDS } from '../../engine/graph'
import { diagram, type EdgeSpec, type NodeSpec } from './builder'

// ---------------------------------------------------------------------------
// Starter: the sprawl the team inherited
// ---------------------------------------------------------------------------

const starterNodes: NodeSpec[] = [
  ['sites', 'web-app', 'Customer Websites (SDK)', 0, 120],
  ['console', 'web-app', 'Workspace Console', 0, 420, { tech: 'react' }],
  ['gw', 'api-gateway', 'API Gateway', 260, 120, { tech: 'aws-api-gateway' }],
  ['ingest', 'service', 'Ingest API', 520, 120, { tech: 'express', domains: ['ingestion'] }],
  ['fanout', 'broker', 'Fan-out Topic', 780, 120, { tech: 'sqs' }],
  ['qCrm', 'broker', 'CRM Queue', 1040, 0, { tech: 'sqs' }],
  ['qEmail', 'broker', 'Email Queue', 1040, 100, { tech: 'sqs' }],
  ['qAds', 'broker', 'Ads Queue', 1040, 200, { tech: 'sqs' }],
  ['qHooks', 'broker', 'Webhooks Queue', 1040, 300, { tech: 'sqs' }],
  ['crm', 'service', 'CRM Connector', 1300, 0, { tech: 'nestjs', domains: ['delivery', 'retries'], notes: 'shared-lib v2.3' }],
  ['email', 'service', 'Email Connector', 1300, 100, { tech: 'nestjs', domains: ['delivery', 'retries'], notes: 'shared-lib v1.9' }],
  ['ads', 'service', 'Ads Connector', 1300, 200, { tech: 'express', domains: ['delivery', 'retries'], notes: 'shared-lib v3.0-beta' }],
  ['hooks', 'service', 'Webhooks Connector', 1300, 300, { tech: 'express', domains: ['delivery'] }],
  ['extCrm', 'external', 'CRM APIs', 1560, 0, { tech: 'generic-api' }],
  ['extEmail', 'external', 'Email Tool APIs', 1560, 100, { tech: 'generic-api' }],
  ['extAds', 'external', 'Ad Platform APIs', 1560, 200, { tech: 'generic-api' }],
  ['extHooks', 'external', 'Customer Webhooks', 1560, 300, { tech: 'generic-api' }],
  ['workspaces', 'service', 'Workspaces', 520, 420, { tech: 'nestjs', domains: ['workspaces'] }],
  ['configDb', 'relational-db', 'Config DB', 780, 420, { tech: 'postgres' }],
  ['s3Raw', 'object-storage', 'Raw Batches', 520, 600, { tech: 's3' }],
  ['fnParse', 'function', 'Parse Step', 780, 600, { tech: 'aws-lambda', domains: ['delivery'] }],
  ['s3Parsed', 'object-storage', 'Parsed Batches', 1040, 600, { tech: 's3' }],
  ['fnEnrich', 'function', 'Enrich + Load Step', 1300, 600, { tech: 'aws-lambda', domains: ['delivery'] }],
  ['warehouse', 'external', 'Warehouse Destinations', 1560, 600, { tech: 'generic-api' }],
]

const starterEdges: EdgeSpec[] = [
  ['sites', 'gw', 'http', 'track events'],
  ['console', 'gw', 'http'],
  ['gw', 'ingest', 'http'],
  ['gw', 'workspaces', 'http'],
  ['workspaces', 'configDb'],
  ['ingest', 'fanout', 'event'],
  ['fanout', 'qCrm', 'event'],
  ['fanout', 'qEmail', 'event'],
  ['fanout', 'qAds', 'event'],
  ['fanout', 'qHooks', 'event'],
  ['qCrm', 'crm', 'event'],
  ['qEmail', 'email', 'event'],
  ['qAds', 'ads', 'event'],
  ['qHooks', 'hooks', 'event'],
  ['crm', 'extCrm', 'http'],
  ['email', 'extEmail', 'http'],
  ['ads', 'extAds', 'http'],
  ['hooks', 'extHooks', 'http'],
  ['crm', 'configDb', 'data', 'reads destination settings'],
  ['ads', 'configDb', 'data', 'reads destination settings'],
  ['ingest', 's3Raw', 'data', 'raw batches'],
  ['s3Raw', 'fnParse', 'event', 'ObjectCreated'],
  ['fnParse', 's3Parsed', 'data'],
  ['s3Parsed', 'fnEnrich', 'event', 'ObjectCreated'],
  ['fnEnrich', 'warehouse', 'http'],
]

// ---------------------------------------------------------------------------
// Check helpers
// ---------------------------------------------------------------------------

const union = (...lists: DiagramNode[][]) => {
  const m = new Map<string, DiagramNode>()
  for (const l of lists) for (const n of l) m.set(n.id, n)
  return [...m.values()]
}

const isCompute = (n: DiagramNode) => COMPUTE_KINDS.includes(n.kind)

/** Compute nodes calling a third-party API synchronously (i.e. delivering to a destination). */
function destinationCallers(g: Graph) {
  return g.nodes.filter((n) => isCompute(n) && g.targets(n.id, SYNC_PROTOCOLS).some((t) => t.kind === 'external'))
}

/** Independently running compute units: services, applications, functions and stand-alone workers. */
function runtimeUnits(g: Graph) {
  return g.nodes.filter(
    (n) => n.kind === 'service' || n.kind === 'monolith' || n.kind === 'function' || (n.kind === 'worker' && g.parent(n)?.kind !== 'monolith'),
  )
}

/**
 * Buckets used as a hand-off between pipeline steps, whatever the compute kind:
 * at least two different deployables touch the bucket and one of them is a
 * downstream stage — triggered by the bucket (ObjectCreated) or itself passing
 * data on to another bucket. The replay owner reading the archive is not a stage.
 */
function bucketBuses(g: Graph) {
  const replayUnits = new Set(g.ownerFamily('replay').map((n) => g.deployable(n).id))
  const flagged: DiagramNode[] = []
  for (const s of g.ofKind('object-storage')) {
    const accessors = union(g.sources(s.id), g.targets(s.id)).filter(isCompute)
    const units = new Map<string, DiagramNode[]>()
    for (const a of accessors) {
      const u = g.deployable(a).id
      if (replayUnits.has(u)) continue
      units.set(u, [...(units.get(u) ?? []), a])
    }
    if (units.size < 2) continue
    const isStage = (nodes: DiagramNode[]) =>
      nodes.some(
        (a) =>
          g.out(s.id).some((e) => e.target === a.id && e.protocol !== 'data') ||
          g.neighbours(a.id).some((n) => n.kind === 'object-storage' && n.id !== s.id),
      )
    if ([...units.values()].some(isStage)) flagged.push(s)
  }
  return flagged
}

/** Brokers whose messages survive consumer downtime. */
const isDurableBroker = (g: Graph) => (b: DiagramNode) =>
  b.kind === 'broker' && (!b.tech || g.hasTrait(b, 'log', 'replayable', 'queue', 'managed'))

/** Naming fallback for a parked-events table (no tech trait expresses it). */
const PARKED = /dlq|dead|park|retr|fail|poison|quarantin/i

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

export const integrationsHub: Scenario = {
  id: 'syncly-consolidation',
  title: 'Syncly: 150 connectors, 6 engineers',
  tagline: 'One service per destination drowned the team in ops. Consolidate without losing a single event.',
  industry: 'Data & integrations',
  difficulty: 'intermediate',
  estMinutes: 35,
  accent: '#475569',
  concepts: ['service-granularity', 'modular-monolith', 'dead-letter-queue', 'backpressure', 'rate-limiting', 'idempotency', 'queue-load-leveling'],
  story:
    'Syncly, a customer-data startup from Wrocław, collects events from 3,000 customer websites and forwards them to 150 destinations — CRMs, email tools and ad platforms. Every destination was built as its own microservice with its own queue, its own repo and its own copy of a shared library that has drifted into 37 versions. Last Black Friday one ad platform started throttling; the Ads connector’s retry storm exhausted the connection pool of the Config DB that the CRM connector also reads, and CRMs received hot leads six hours late. Meanwhile a sister team’s enrichment pipeline — one function per step, objects in S3 between steps — now costs more than the rest of the platform combined. The six engineers spend their week babysitting queues instead of shipping connectors, and nobody can replay events after a connector bug. Consolidate before the next peak season.',
  facts: [
    { label: 'Team', value: '6 engineers (TypeScript & Go), no dedicated ops' },
    { label: 'Traffic', value: '~25k events/s at peak, 1.4B events/day' },
    { label: 'Connectors', value: '150 destinations; top 10 carry 80% of volume' },
    { label: 'Targets', value: 'p95 delivery < 60 s, 30-day replay, cloud bill $180k → < $60k/month' },
  ],
  functional: [
    'Accept events from customer websites over HTTP and acknowledge in < 100 ms',
    'Deliver each event to the destinations enabled in the customer’s workspace, transformed per connector',
    'Retry failed deliveries with exponential backoff and park poison events in a dead-letter queue',
    'Replay a workspace’s raw events from the last 30 days to a new or fixed destination',
    'Customers manage destinations and their credentials in a web console',
  ],
  nonFunctional: [
    'A slow or failing destination must never delay delivery to other destinations',
    'No event lost once acknowledged — durable at ingestion',
    'Respect each destination’s API rate limits across all worker instances',
    'Per-destination delivery rate, error rate and lag visible, with alerts',
    'Operable by 6 engineers: few deployables and one version of the connector library',
  ],
  constraints: [
    'Destination credentials (API keys, OAuth tokens) must not live in config files or event payloads',
    'Connectors migrate one by one behind a shared connector interface — no big-bang rewrite',
    'The cloud bill must fall by at least two-thirds',
  ],
  domains: [
    { id: 'ingestion', label: 'Event ingestion', description: 'Tracking API: validate write keys, accept and durably store events' },
    { id: 'workspaces', label: 'Workspaces & destinations', description: 'Customer configuration: enabled destinations, mappings, credentials' },
    { id: 'delivery', label: 'Connector delivery', description: 'Transform and send events to 150 destination APIs' },
    { id: 'retries', label: 'Retries & dead letters', description: 'Backoff schedules, retry topics, parked events' },
    { id: 'replay', label: 'Archive & replay', description: 'Raw event archive and re-delivery after fixes' },
  ],
  recommendedStyles: ['modular-monolith', 'monolith', 'microkernel'],
  styleFeedback: {
    'modular-monolith':
      'Best fit: one connector-runtime deployable with every connector as a module behind a shared interface gives 6 engineers one codebase, one library version and one pool to scale, while module boundaries stop 150 integrations from tangling.',
    monolith:
      'Good fit: consolidating all destinations into one worker deployable is exactly the cure — just keep a clear connector interface inside it so 150 integrations do not become one ball of mud.',
    microservices:
      'This is today’s pain: 150 services for 6 engineers is 25 deployables per person, with drifting shared libraries and constant ops toil. Service granularity should follow team size and ownership, not the number of integrations.',
    'event-driven':
      'Events are the right transport between ingestion and delivery, but a fleet of independently deployed consumers per destination is the sprawl you are removing — keep the log, consolidate the consumers.',
    serverless:
      'One function per step with S3 between steps is what made the sister pipeline so expensive: every hop pays invocations, storage requests and re-serialisation. A steady 25k events/s is far cheaper on a long-running worker pool.',
    'service-based':
      'Far better than 150 services, but even four or five coarse deployables are more than six engineers without ops need. The heart of the fix is one connector runtime, which a plug-in or modular design expresses more directly.',
    'space-based':
      'This style is for spiky, highly concurrent users on shared in-memory state. Syncly has a steady 25k events/s that needs a durable log and replay — a data grid would grow a bill that has to shrink by two-thirds.',
    microkernel:
      'Excellent fit: a connector runtime is a textbook microkernel. The core consumes the log and owns retries, rate limits and credentials; each of the 150 destinations is a plug-in behind one connector contract, so a new destination is a plug-in, not a new deployable — and there is one library version again.',
  },
  starter: diagram(starterNodes, starterEdges),
  starterDecisions: {
    style: 'microservices',
    communication: 'async',
    data: 'shared',
    stack: { backend: 'nestjs', frontend: 'react', database: 'postgres', messaging: 'sqs' },
    rationale: 'One service and one queue per destination so each integration can be deployed on its own.',
  },
  hints: [
    'Count the deployables: one per destination, for a team of 6. What granularity can this team actually operate?',
    'Ingestion should do one thing: validate, append to a durable partitioned log and acknowledge. Delivery happens later, from the log.',
    'Run all connectors as modules (plugins) inside one connector-runtime deployable and scale that pool horizontally across log partitions.',
    'Keep rate-limit state per destination and customer credential (workspace × destination), plus a circuit state per destination, in Redis so every worker instance skips a throttled destination instead of waiting on it.',
    'Retryable failures go to retry topics with exponential backoff; exhausted ones land in a dead-letter queue (or your queue’s native redrive). Archive raw events in object storage and give a Replay module a way to re-publish them. Keep the console and write-key lookups out of the connector pool so ingestion never waits on it.',
  ],
  checks: [
    {
      id: 'durable-log',
      title: 'Ingestion appends to a durable log and acknowledges',
      category: 'core',
      why: 'If the tracking API calls destinations inline, its latency and availability become those of the slowest ad platform. Appending to a durable partitioned log (Kafka, Redpanda, Pulsar, Kinesis) or a durable queue (SQS, RabbitMQ) turns the 25k events/s into a buffer that delivery drains at its own pace — queues give no replay, hence the archive.',
      hint: 'Connect the Ingestion owner to a Message broker with an Event edge and pick a durable log (Kafka, Redpanda, Pulsar, Kinesis) or queue (SQS, RabbitMQ). If one component both ingests and delivers, it must consume the events back from that broker.',
      concepts: ['queue-load-leveling', 'backpressure'],
      test: (g) => {
        const owners = g.owners('ingestion')
        if (!owners.length) return { pass: false, detail: 'Nobody owns event ingestion.' }
        const inline = owners.filter(
          (n) => !n.domains.includes('delivery') && g.targets(n.id, SYNC_PROTOCOLS).some((t) => t.kind === 'external'),
        )
        if (inline.length)
          return { pass: false, detail: `${inline.map((n) => n.label).join(', ')} calls destination APIs inline — one slow destination slows every website.` }
        const durableBroker = isDurableBroker(g)
        const brokers = union(g.ownerFamily('ingestion').flatMap((n) => g.targets(n.id, ['event']).filter((t) => t.kind === 'broker')))
        if (!brokers.length) return { pass: false, detail: 'Ingestion does not publish events to a broker / log.' }
        if (!brokers.some(durableBroker))
          return { pass: false, detail: `${brokers.map((b) => b.label).join(', ')} does not persist messages — pub/sub drops events while consumers are down.` }
        // A component that both ingests and delivers must take the round trip through the log.
        const shortcut = owners.filter(
          (n) => n.domains.includes('delivery') && !g.family(n).some((f) => g.sources(f.id, ['event']).some(durableBroker)),
        )
        return shortcut.length
          ? { pass: false, detail: `${shortcut.map((n) => n.label).join(', ')} ingests and delivers but never consumes back from the log — delivery is still inline.` }
          : { pass: true }
      },
    },
    {
      id: 'async-delivery',
      title: 'Connectors consume events asynchronously',
      category: 'core',
      why: 'Delivery must be decoupled from ingestion: connectors pull from the log, so a destination outage creates lag, not lost events or failed tracking calls. A worker that ingestion calls synchronously is still on the request path.',
      hint: 'Ingestion → broker → connector owner (Event edges). Remove direct HTTP/gRPC calls from ingestion to the connectors.',
      concepts: ['queue-load-leveling', 'idempotency'],
      test: (g) => {
        const ingest = g.ownerFamily('ingestion')
        const delivery = g.ownerFamily('delivery')
        if (!ingest.length || !delivery.length) return { pass: false, detail: 'Assign both Event ingestion and Connector delivery to components.' }
        const deliveryOwners = new Set(g.owners('delivery').map((n) => n.id))
        const deliveryUnits = new Set(delivery.map((n) => g.deployable(n).id))
        const sync = g.owners('ingestion').filter((i) => {
          // in-process call from the ingest code straight into a connector
          if (g.targets(i.id, SYNC_PROTOCOLS).some((t) => t.id !== i.id && deliveryOwners.has(t.id))) return true
          // network call from the ingest deployable into the connector deployable
          const unit = g.deployable(i).id
          return g.family(i).some((f) =>
            g.targets(f.id, SYNC_PROTOCOLS).some((t) => {
              const u = g.deployable(t).id
              return u !== unit && deliveryUnits.has(u)
            }),
          )
        })
        if (sync.length) return { pass: false, detail: `${sync.map((s) => s.label).join(', ')} calls the connectors synchronously.` }
        return g.asyncFlow(ingest, delivery) ? { pass: true } : { pass: false, detail: 'No event flow from ingestion through a broker to the connectors.' }
      },
    },
    {
      id: 'connector-pool',
      title: 'All connectors run in one shared, scalable pool',
      category: 'core',
      why: 'A deployable per destination multiplies pipelines, alerts, autoscaling policies and copies of the shared library — the toil that consumed the team. Connectors as modules/plugins in one runtime share one library version and one horizontally scaled pool.',
      hint: 'Put every connector (and anything that calls destination APIs) inside one Application as Modules, or in one Background worker pool — at most two deployables.',
      concepts: ['service-granularity', 'modular-monolith'],
      test: (g) => {
        const units = new Map<string, DiagramNode>()
        for (const n of union(g.owners('delivery'), destinationCallers(g))) {
          const d = g.deployable(n)
          units.set(d.id, d)
        }
        if (!units.size) return { pass: false, detail: 'Nobody delivers to destinations yet.' }
        if (!destinationCallers(g).length) return { pass: false, detail: 'No connector calls a destination API (Third-party API).' }
        const list = [...units.values()]
        return list.length <= 2
          ? { pass: true }
          : { pass: false, detail: `Connectors are spread over ${list.length} deployables: ${list.map((u) => u.label).join(', ')}.` }
      },
    },
    {
      id: 'destination-isolation',
      title: 'Per-destination rate limits & backoff in a shared store',
      category: 'core',
      why: 'With one pool, isolation comes from state, not from separate queues: a token bucket per destination and customer credential (workspace × destination), plus a circuit state per destination, in Redis lets every instance skip a throttled ad platform and keep delivering to CRMs while staying under each account’s API rate limit.',
      hint: 'Connect the connector (or retries) owner to a Cache (Redis / Valkey) with a Data edge for token buckets and backoff state.',
      concepts: ['rate-limiting', 'backpressure'],
      test: (g) => {
        const fam = union(g.ownerFamily('delivery'), g.ownerFamily('retries'))
        if (!fam.length) return { pass: false, detail: 'Nobody owns delivery yet.' }
        const caches = g.storesOf(fam, ['cache'])
        if (!caches.length) return { pass: false, detail: 'No shared store for per-destination rate limits — each instance throttles blindly.' }
        return caches.some((c) => !c.tech || g.hasTrait(c, 'atomic', 'ttl'))
          ? { pass: true }
          : { pass: false, detail: 'Pick a cache with atomic counters / TTL (Redis, Valkey).' }
      },
    },
    {
      id: 'dead-letters',
      title: 'Retries with backoff and a dead-letter queue',
      category: 'core',
      why: 'Transient errors (429, 503) deserve retries with exponential backoff and jitter; poison events and exhausted retries must be parked in a dead-letter queue — otherwise they block a partition or vanish silently.',
      hint: 'Give the Retries capability to a module/worker in the connector pool and connect it to retry/DLQ topics on a broker (Event edge), draw your queue’s native redrive (queue → DLQ), or add a parked-events table.',
      concepts: ['dead-letter-queue', 'idempotency'],
      test: (g) => {
        const retries = g.ownerFamily('retries')
        if (!retries.length) return { pass: false, detail: 'Nobody owns retries & dead letters.' }
        const delivery = g.ownerFamily('delivery')
        const poolIds = new Set(delivery.map((n) => g.deployable(n).id))
        const inPool = retries.some((r) => poolIds.has(g.deployable(r).id)) || g.asyncFlow(delivery, retries)
        if (!inPool) return { pass: false, detail: 'Retries are not connected to the connectors that fail.' }
        // 1. retry / DLQ topics published by the retries owner
        const topics = g.calls(retries, (t) => t.kind === 'broker', ['event'])
        // 2. broker-native dead-lettering: the queue the connectors consume redrives into another broker
        const consumerIds = new Set(union(delivery, retries).map((n) => n.id))
        const redrive = g
          .ofKind('broker')
          .some(
            (b) =>
              g.targets(b.id, ['event']).some((t) => consumerIds.has(t.id)) &&
              g.targets(b.id, ['event']).some((t) => t.kind === 'broker' && t.id !== b.id),
          )
        // 3. a parked-events table (not just the config DB the connectors read)
        const parked = retries.some((r) =>
          g.out(r.id, ['data']).some((e) => {
            const t = g.node(e.target)
            return !!t && DB_KINDS.includes(t.kind) && (PARKED.test(t.label) || PARKED.test(t.notes ?? '') || PARKED.test(e.label ?? ''))
          }),
        )
        return topics || redrive || parked
          ? { pass: true }
          : { pass: false, detail: 'Failed events have nowhere to go — add retry / DLQ topics, a queue redrive to a DLQ, or a parked-events table.' }
      },
    },
    {
      id: 'replay-archive',
      title: 'Raw events archived and replayable',
      category: 'core',
      why: 'Connector bugs are inevitable. A cheap immutable archive of raw events in object storage, plus a way to re-publish a workspace’s time range into the log, turns a data-loss incident into a replay.',
      hint: 'Feed raw events into Object storage (S3/GCS), and let the Replay owner read it and publish back to the broker.',
      concepts: ['dead-letter-queue', 'idempotency'],
      test: (g) => {
        const replay = g.ownerFamily('replay')
        if (!replay.length) return { pass: false, detail: 'Nobody owns archive & replay.' }
        const archives = g.storesOf(replay, ['object-storage'])
        if (!archives.length) return { pass: false, detail: 'Replay has no archive in object storage.' }
        const ingest = g.ownerFamily('ingestion')
        const archiveIds = new Set(archives.map((a) => a.id))
        const fed = ingest.length > 0 && !!g.reaches(ingest, (n) => archiveIds.has(n.id), { maxDepth: 5 })
        if (!fed) return { pass: false, detail: 'Raw events from ingestion never reach the archive.' }
        return g.calls(replay, (t) => t.kind === 'broker', ['event'])
          ? { pass: true }
          : { pass: false, detail: 'Replay cannot re-publish archived events — connect it to the broker.' }
      },
    },
    {
      id: 'destination-metrics',
      title: 'Per-destination metrics and alerts',
      category: 'bonus',
      why: 'With 150 destinations in one pool you need delivery rate, error rate, consumer lag and DLQ depth labelled per destination — and alerts — or one broken connector hides in the averages.',
      hint: 'Telemetry edge from the connector pool (and broker) to Metrics, plus Alerting.',
      concepts: ['observability', 'slo'],
      test: (g) => {
        const fam = new Set(g.ownerFamily('delivery').map((n) => n.id))
        const inst = g.instrumented().some((n) => fam.has(n.id))
        if (!inst) return { pass: false, detail: 'The connector pool exports no telemetry.' }
        if (!g.has('metrics')) return { pass: false, detail: 'No metrics store.' }
        return g.has('alerting') ? { pass: true } : { pass: false, detail: 'No alerting.' }
      },
    },
    {
      id: 'ingest-edge',
      title: 'Tracking traffic enters through one front door',
      category: 'bonus',
      why: 'Websites send bursts you do not control. A gateway or load balancer in front of the ingest API terminates TLS, enforces per-workspace quotas and lets you scale ingest instances independently.',
      hint: 'Clients → API gateway / Load balancer → Ingest API.',
      concepts: ['api-gateway', 'rate-limiting'],
      test: (g) => g.clientsEnterThrough(['api-gateway', 'load-balancer']),
    },
    {
      id: 'credentials-vault',
      title: 'Destination credentials in a secrets manager',
      category: 'bonus',
      why: 'Thousands of customer API keys and OAuth tokens are the crown jewels: keep them encrypted in a secrets manager, fetched by the connector at send time — never in config files or event payloads.',
      hint: 'Connect the connectors or workspaces owner to a Secrets manager (Vault, AWS Secrets Manager).',
      concepts: ['secrets-management'],
      test: (g) => g.calls(union(g.ownerFamily('delivery'), g.ownerFamily('workspaces')), (t) => t.kind === 'secrets'),
    },
    {
      id: 'workspace-config',
      title: 'Workspace configuration has its own database',
      category: 'bonus',
      why: 'Which destinations are enabled, field mappings and filters are transactional customer data — they belong to the Workspaces owner, not to every connector reading tables directly.',
      hint: 'Workspaces owner → Relational or Document database.',
      concepts: ['database-per-service'],
      test: (g) => g.storesOf(g.ownerFamily('workspaces'), DB_KINDS).length > 0,
    },
    {
      id: 'anti-service-sprawl',
      title: 'Deployables sized for a team of six',
      category: 'antipattern',
      why: 'Each deployable brings a pipeline, dashboards, alerts, scaling rules and on-call surface. More than four services/functions for six engineers means the team operates the system instead of improving it.',
      hint: 'Merge per-destination services and per-step functions into modules of one runtime.',
      concepts: ['service-granularity'],
      test: (g) => {
        const units = runtimeUnits(g)
        return units.length <= 4
          ? { pass: true }
          : { pass: false, detail: `${units.length} deployables for 6 engineers: ${units.map((u) => u.label).join(', ')}.` }
      },
    },
    {
      id: 'anti-bucket-bus',
      title: 'No object storage used as a message bus',
      category: 'antipattern',
      why: 'Chaining steps by writing objects to a bucket and triggering the next function pays for every PUT, GET and invocation, adds seconds of latency and gives you no ordering or backpressure, and dead letters only per hop. Pass data in memory or through a real queue.',
      hint: 'Keep object storage for the archive; hand data between steps in-process (modules) or via a broker.',
      concepts: ['service-granularity', 'queue-load-leveling'],
      test: (g) => {
        const buses = bucketBuses(g)
        return buses.length
          ? { pass: false, detail: `${buses.map((b) => b.label).join(', ')} hands data from one step to the next.` }
          : { pass: true }
      },
    },
  ],
  inspiration: [
    {
      label: 'Twilio Segment — Goodbye microservices: from 100s of problem children to 1 superstar',
      url: 'https://www.twilio.com/en-us/blog/developers/best-practices/goodbye-microservices',
    },
    {
      label: 'InfoQ — Prime Video moves from serverless to a monolith and cuts costs 90%',
      url: 'https://www.infoq.com/news/2023/05/prime-ec2-ecs-saves-costs/',
    },
  ],
  reference: {
    decisions: {
      style: 'modular-monolith',
      communication: 'async',
      data: 'per-service',
      stack: { backend: 'go', frontend: 'nextjs', database: 'postgres', messaging: 'kafka', cache: 'redis' },
      rationale:
        'A small Go Edge API (ingest + workspace console) appends to Kafka; one Go Connector Runtime holds all 150 connectors as modules and scales by partitions. Isolation comes from rate-limit state in Redis, retry/DLQ topics and an S3 archive for replay — not from 150 deployables.',
    },
    walkthrough: [
      'Customer websites and the console enter through Envoy, which enforces per-workspace ingest quotas. The stateless Edge API holds two modules: Ingest validates the write key in-process against Workspaces (cached), appends each event to a Kafka topic partitioned by workspace and acknowledges; it never talks to a destination or to the connector pool, so consumer rebalances and connector deploys cannot slow the tracking path.',
      'The second deployable, the Connector Runtime, holds all 150 connectors as modules behind a single Destination interface (transform, send, classify errors). It is one consumer group scaled horizontally by partitions and learns workspace settings from a compacted config topic, so it never shares the Workspaces database: one shared library version, one pipeline, one thing to operate.',
      'Before each send a worker takes a token from the bucket for that destination and customer credential (workspace × destination) in Redis, next to a per-destination circuit state; throttled or circuit-open destinations are rescheduled to a retry topic instead of blocking the partition, so one slow ad platform cannot delay CRMs.',
      'Retryable errors go to retry topics with exponential backoff and jitter; permanent errors and exhausted retries land in a DLQ topic with the error attached. The Replay module archives raw events to S3 and re-publishes a workspace’s time range after a fix — so every connector must be idempotent.',
      'Each connector is guarded by record/replay contract tests: real destination responses are recorded once and replayed in CI, so six engineers can change the shared runtime without breaking 150 integrations. Per-destination rate, errors, lag and DLQ depth flow via OpenTelemetry to Prometheus and alert on-call.',
      'Trade-off: a bad deploy now hits every connector at once, so roll out canary instances first. If one giant destination needs it later, run it as a separate consumer group from the same build — split deployment, not code.',
    ],
    diagram: diagram(
      [
        ['sites', 'web-app', 'Customer Websites (SDK)', 0, 60],
        ['console', 'web-app', 'Workspace Console', 0, 300, { tech: 'nextjs' }],
        ['gw', 'api-gateway', 'Edge Gateway', 260, 180, { tech: 'envoy' }],
        ['edge', 'monolith', 'Edge API', 500, 100, { tech: 'go', w: 240, h: 260 }],
        ['ingest', 'module', 'Ingest', 20, 50, { tech: 'go', domains: ['ingestion'], parent: 'edge' }],
        ['workspaces', 'module', 'Workspaces', 20, 160, { tech: 'go', domains: ['workspaces'], parent: 'edge' }],
        ['pg', 'relational-db', 'Workspace Config', 520, 440, { tech: 'postgres' }],
        ['kafka', 'broker', 'Event Log (partitioned)', 860, 150, { tech: 'kafka', notes: 'topics: events, workspace-config (compacted), retry-1m, retry-10m, dlq' }],
        ['core', 'monolith', 'Connector Runtime', 1100, 40, { tech: 'go', w: 240, h: 370 }],
        ['connectors', 'module', 'Connectors (150 plugins)', 20, 50, { tech: 'go', domains: ['delivery'], parent: 'core' }],
        ['retries', 'module', 'Retry & DLQ', 20, 160, { tech: 'go', domains: ['retries'], parent: 'core' }],
        ['replay', 'module', 'Archive & Replay', 20, 270, { tech: 'go', domains: ['replay'], parent: 'core' }],
        ['vault', 'secrets', 'Destination Credentials', 1120, -110, { tech: 'vault' }],
        ['s3', 'object-storage', 'Raw Event Archive', 1120, 470, { tech: 's3', notes: '30-day lifecycle, partitioned by workspace/hour' }],
        ['crm', 'external', 'CRM APIs', 1460, -60, { tech: 'generic-api' }],
        ['email', 'external', 'Email Tool APIs', 1460, 40, { tech: 'generic-api' }],
        ['ads', 'external', 'Ad Platform APIs', 1460, 140, { tech: 'generic-api' }],
        ['redis', 'cache', 'Rate Limits & Backoff', 1460, 260, { tech: 'redis', notes: 'token bucket per workspace × destination, circuit per destination' }],
        ['otel', 'otel-collector', 'OTel Collector', 860, 620, { tech: 'otel-collector' }],
        ['prom', 'metrics', 'Per-destination Metrics', 1120, 620, { tech: 'prometheus' }],
        ['grafana', 'dashboards', 'Delivery Dashboards', 1400, 560, { tech: 'grafana' }],
        ['alerts', 'alerting', 'On-call', 1400, 680, { tech: 'alertmanager' }],
      ],
      [
        ['sites', 'gw', 'http', 'track events'],
        ['console', 'gw', 'http'],
        ['gw', 'ingest', 'http'],
        ['gw', 'workspaces', 'http', 'console API'],
        ['ingest', 'kafka', 'event', 'raw events'],
        ['workspaces', 'kafka', 'event', 'config changes'],
        ['workspaces', 'pg'],
        ['kafka', 'connectors', 'event', 'consumer group'],
        ['connectors', 'vault', 'data', 'API keys / OAuth'],
        ['connectors', 'crm', 'http'],
        ['connectors', 'email', 'http'],
        ['connectors', 'ads', 'http'],
        ['connectors', 'redis', 'data', 'token buckets'],
        ['kafka', 'retries', 'event', 'retry topics'],
        ['retries', 'kafka', 'event', 'retry topics + DLQ'],
        ['retries', 'redis', 'data', 'backoff state'],
        ['kafka', 'replay', 'event', 'archive'],
        ['replay', 's3', 'data'],
        ['replay', 'kafka', 'event', 're-publish'],
        ['edge', 'otel', 'telemetry'],
        ['core', 'otel', 'telemetry'],
        ['kafka', 'otel', 'telemetry', 'consumer lag'],
        ['otel', 'prom', 'telemetry'],
        ['prom', 'grafana', 'telemetry'],
        ['prom', 'alerts', 'telemetry', 'DLQ depth, lag'],
      ],
    ),
  },
}

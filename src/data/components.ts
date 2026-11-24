import type { Category, ComponentKind, Protocol } from '../engine/types'

export interface ComponentDef {
  kind: ComponentKind
  name: string
  category: Category
  description: string
  /** Default label when dropped on the canvas. */
  defaultLabel: string
  /** Can own business domains (bounded contexts). */
  ownsDomains?: boolean
  /** Rendered as a resizable container other nodes can be dropped into. */
  container?: boolean
  keywords?: string[]
}

export const CATEGORIES: { id: Category; name: string; description: string }[] = [
  { id: 'clients', name: 'Clients', description: 'Where users interact with your system' },
  { id: 'edge', name: 'Edge & APIs', description: 'Entry points, routing and API composition' },
  { id: 'compute', name: 'Compute', description: 'Services, modules, workers and functions' },
  { id: 'data', name: 'Data', description: 'Storage engines and caches' },
  { id: 'messaging', name: 'Messaging', description: 'Asynchronous communication & streaming' },
  { id: 'observability', name: 'Observability', description: 'Logs, metrics, traces and alerts' },
  { id: 'security', name: 'Security', description: 'Identity, secrets and protection' },
  { id: 'external', name: 'Third-party', description: 'External providers and partner APIs' },
  { id: 'boundaries', name: 'Boundaries & notes', description: 'Group components and annotate' },
]

export const COMPONENTS: ComponentDef[] = [
  // Clients
  { kind: 'web-app', name: 'Web app', category: 'clients', defaultLabel: 'Web App', description: 'Browser single-page or server-rendered application.', keywords: ['spa', 'frontend', 'react', 'angular'] },
  { kind: 'device', name: 'IoT device / edge', category: 'clients', defaultLabel: 'Device Fleet', description: 'Lockers, chargers, sensors or vehicles talking to the backend over MQTT.', keywords: ['iot', 'mqtt', 'sensor', 'locker', 'edge', 'charger'] },
  { kind: 'mobile-app', name: 'Mobile app', category: 'clients', defaultLabel: 'Mobile App', description: 'Native or cross-platform iOS / Android app.', keywords: ['ios', 'android'] },

  // Edge
  { kind: 'cdn', name: 'CDN', category: 'edge', defaultLabel: 'CDN', description: 'Caches static assets and media close to users worldwide.' },
  { kind: 'load-balancer', name: 'Load balancer', category: 'edge', defaultLabel: 'Load Balancer', description: 'Distributes traffic across healthy instances.' },
  { kind: 'api-gateway', name: 'API gateway', category: 'edge', defaultLabel: 'API Gateway', description: 'Single entry point: routing, auth, rate limiting, TLS termination.', keywords: ['gateway', 'rate limit'] },
  { kind: 'bff', name: 'Backend for Frontend', category: 'edge', defaultLabel: 'BFF', description: 'API layer tailored to one client type; aggregates downstream calls.', keywords: ['graphql', 'aggregation'] },
  { kind: 'realtime-gateway', name: 'Realtime gateway', category: 'edge', defaultLabel: 'Realtime Gateway', description: 'Holds WebSocket / SSE connections and pushes live updates.', keywords: ['websocket', 'sse', 'push'] },

  // Compute
  { kind: 'service', name: 'Microservice', category: 'compute', defaultLabel: 'Service', ownsDomains: true, description: 'Independently deployable service owning one business capability.', keywords: ['microservice', 'api'] },
  { kind: 'monolith', name: 'Application (deployable)', category: 'compute', defaultLabel: 'Application', ownsDomains: true, container: true, description: 'A single deployable unit. Drop modules inside to build a modular monolith.', keywords: ['monolith', 'modular'] },
  { kind: 'module', name: 'Module', category: 'compute', defaultLabel: 'Module', ownsDomains: true, description: 'Well-encapsulated module inside a deployable, with a public API.', keywords: ['modular monolith', 'package'] },
  { kind: 'worker', name: 'Background worker', category: 'compute', defaultLabel: 'Worker', ownsDomains: true, description: 'Consumes jobs or events and does work outside the request path.', keywords: ['consumer', 'job'] },
  { kind: 'function', name: 'Serverless function', category: 'compute', defaultLabel: 'Function', ownsDomains: true, description: 'Event-triggered, auto-scaling function.', keywords: ['lambda', 'faas'] },
  { kind: 'orchestrator', name: 'Workflow / saga orchestrator', category: 'compute', defaultLabel: 'Saga Orchestrator', ownsDomains: true, description: 'Coordinates long-running, multi-step business transactions with compensation.', keywords: ['saga', 'temporal', 'workflow'] },

  // Data
  { kind: 'relational-db', name: 'Relational database', category: 'data', defaultLabel: 'Database', description: 'ACID transactions, joins and strong consistency.', keywords: ['sql', 'postgres', 'mysql'] },
  { kind: 'document-db', name: 'Document / key-value DB', category: 'data', defaultLabel: 'Document DB', description: 'Flexible schema, horizontal scale, simple access patterns.', keywords: ['nosql', 'mongo', 'dynamo'] },
  { kind: 'cache', name: 'Cache', category: 'data', defaultLabel: 'Cache', description: 'In-memory store for hot reads, sessions, counters and TTL data.', keywords: ['redis', 'memcached'] },
  { kind: 'search', name: 'Search engine', category: 'data', defaultLabel: 'Search Index', description: 'Full-text search, faceting and relevance ranking.', keywords: ['elasticsearch', 'full text'] },
  { kind: 'object-storage', name: 'Object storage', category: 'data', defaultLabel: 'Object Storage', description: 'Durable blob storage for images, video, documents and archives.', keywords: ['s3', 'blob', 'files', 'media'] },
  { kind: 'wide-column', name: 'Wide-column / time-series', category: 'data', defaultLabel: 'Wide-column Store', description: 'Massive write throughput, time-ordered or partitioned data.', keywords: ['cassandra', 'timeseries'] },
  { kind: 'analytics-db', name: 'Analytics / warehouse', category: 'data', defaultLabel: 'Analytics Store', description: 'OLAP queries, reporting and long-term analytical storage.', keywords: ['olap', 'warehouse', 'clickhouse'] },
  { kind: 'graph-db', name: 'Graph database', category: 'data', defaultLabel: 'Graph DB', description: 'Relationship-heavy queries (followers, recommendations).', keywords: ['neo4j', 'social graph'] },

  // Messaging
  { kind: 'broker', name: 'Message broker / event bus', category: 'messaging', defaultLabel: 'Event Bus', description: 'Decouples producers and consumers. Pick Kafka, RabbitMQ, NATS, SQS…', keywords: ['kafka', 'rabbitmq', 'queue', 'pubsub', 'events'] },
  { kind: 'cdc', name: 'Outbox relay / CDC', category: 'messaging', defaultLabel: 'Outbox Relay', description: 'Publishes committed DB changes as events (transactional outbox, Debezium).', keywords: ['debezium', 'outbox', 'change data capture'] },
  { kind: 'stream-processor', name: 'Stream processor', category: 'messaging', defaultLabel: 'Stream Processor', description: 'Stateful processing over event streams (windows, joins, aggregations).', keywords: ['flink', 'kafka streams'] },

  // Observability
  { kind: 'otel-collector', name: 'Telemetry collector', category: 'observability', defaultLabel: 'OTel Collector', description: 'Receives, processes and routes logs, metrics and traces (OTLP).', keywords: ['opentelemetry', 'otlp'] },
  { kind: 'logging', name: 'Log aggregation', category: 'observability', defaultLabel: 'Logs', description: 'Centralised, searchable structured logs.', keywords: ['loki', 'elk'] },
  { kind: 'metrics', name: 'Metrics store', category: 'observability', defaultLabel: 'Metrics', description: 'Time-series metrics: RED/USE, SLIs and SLOs.', keywords: ['prometheus'] },
  { kind: 'tracing', name: 'Distributed tracing', category: 'observability', defaultLabel: 'Tracing', description: 'Follow a request across services with spans and trace IDs.', keywords: ['jaeger', 'tempo'] },
  { kind: 'dashboards', name: 'Dashboards', category: 'observability', defaultLabel: 'Dashboards', description: 'Visualise health and business KPIs.', keywords: ['grafana'] },
  { kind: 'alerting', name: 'Alerting / on-call', category: 'observability', defaultLabel: 'Alerting', description: 'Routes SLO burn and symptom alerts to humans.', keywords: ['pagerduty', 'alertmanager'] },

  // Security
  { kind: 'identity', name: 'Identity provider', category: 'security', defaultLabel: 'Identity Provider', description: 'OAuth2 / OIDC login, tokens, MFA and user federation.', keywords: ['auth', 'keycloak', 'oauth', 'sso'] },
  { kind: 'secrets', name: 'Secrets manager', category: 'security', defaultLabel: 'Secrets Vault', description: 'Stores and rotates credentials, keys and certificates.', keywords: ['vault', 'kms'] },
  { kind: 'waf', name: 'WAF / bot protection', category: 'security', defaultLabel: 'WAF', description: 'Blocks malicious traffic, bots and L7 attacks at the edge.', keywords: ['firewall', 'ddos', 'bots'] },

  // External
  { kind: 'external', name: 'Third-party API', category: 'external', defaultLabel: 'External API', description: 'Payment provider, email/SMS, maps, card network, KYC…', keywords: ['stripe', 'twilio', 'payment', 'email'] },

  // Boundaries
  { kind: 'zone', name: 'Boundary / context', category: 'boundaries', defaultLabel: 'Bounded Context', container: true, description: 'Visual group: bounded context, team ownership or trust zone.', keywords: ['group', 'ddd', 'bounded context'] },
  { kind: 'note', name: 'Sticky note', category: 'boundaries', defaultLabel: 'Note', description: 'Annotate assumptions and decisions on the canvas.' },
]

export const COMPONENT_BY_KIND = Object.fromEntries(COMPONENTS.map((c) => [c.kind, c])) as Record<
  ComponentKind,
  ComponentDef
>

export const CATEGORY_STYLE: Record<Category, { tile: string; text: string; ring: string; dot: string }> = {
  clients: { tile: 'bg-sky-100 dark:bg-sky-500/15', text: 'text-sky-700 dark:text-sky-300', ring: 'ring-sky-300', dot: '#0ea5e9' },
  edge: { tile: 'bg-violet-100 dark:bg-violet-500/15', text: 'text-violet-700 dark:text-violet-300', ring: 'ring-violet-300', dot: '#8b5cf6' },
  compute: { tile: 'bg-indigo-100 dark:bg-indigo-500/15', text: 'text-indigo-700 dark:text-indigo-300', ring: 'ring-indigo-300', dot: '#6366f1' },
  data: { tile: 'bg-emerald-100 dark:bg-emerald-500/15', text: 'text-emerald-700 dark:text-emerald-300', ring: 'ring-emerald-300', dot: '#10b981' },
  messaging: { tile: 'bg-amber-100 dark:bg-amber-500/15', text: 'text-amber-700 dark:text-amber-300', ring: 'ring-amber-300', dot: '#f59e0b' },
  observability: { tile: 'bg-rose-100 dark:bg-rose-500/15', text: 'text-rose-700 dark:text-rose-300', ring: 'ring-rose-300', dot: '#f43f5e' },
  security: { tile: 'bg-teal-100 dark:bg-teal-500/15', text: 'text-teal-700 dark:text-teal-300', ring: 'ring-teal-300', dot: '#14b8a6' },
  external: { tile: 'bg-zinc-200 dark:bg-zinc-500/20', text: 'text-zinc-700 dark:text-zinc-300', ring: 'ring-zinc-300', dot: '#71717a' },
  boundaries: { tile: 'bg-stone-100 dark:bg-stone-500/15', text: 'text-stone-600 dark:text-stone-300', ring: 'ring-stone-300', dot: '#a8a29e' },
}

export const PROTOCOLS: { id: Protocol; name: string; short: string; description: string; async?: boolean }[] = [
  { id: 'http', name: 'HTTP / REST', short: 'REST', description: 'Synchronous request/response over HTTP.' },
  { id: 'grpc', name: 'gRPC', short: 'gRPC', description: 'Synchronous, typed, binary RPC — great service-to-service.' },
  { id: 'graphql', name: 'GraphQL', short: 'GraphQL', description: 'Client-shaped queries, typically at a BFF.' },
  { id: 'websocket', name: 'WebSocket / SSE', short: 'WS', description: 'Long-lived connection for realtime push.' },
  { id: 'event', name: 'Async message / event', short: 'Event', description: 'Publish to or consume from a broker. Producer → broker → consumer.', async: true },
  { id: 'data', name: 'Data access', short: 'Data', description: 'Reads/writes to a data store (arrow from the accessor to the store).' },
  { id: 'telemetry', name: 'Telemetry (OTLP)', short: 'OTLP', description: 'Logs, metrics and traces export.', async: true },
]

export const PROTOCOL_BY_ID = Object.fromEntries(PROTOCOLS.map((p) => [p.id, p])) as Record<
  Protocol,
  (typeof PROTOCOLS)[number]
>

const DATA_KINDS: ComponentKind[] = [
  'relational-db',
  'document-db',
  'cache',
  'search',
  'object-storage',
  'wide-column',
  'analytics-db',
  'graph-db',
]
const OBS_KINDS: ComponentKind[] = ['otel-collector', 'logging', 'metrics', 'tracing', 'dashboards', 'alerting']

/** Sensible default protocol for a new connection. */
export function defaultProtocol(source: ComponentKind, target: ComponentKind): Protocol {
  if (OBS_KINDS.includes(target)) return 'telemetry'
  if (target === 'broker' || source === 'broker' || target === 'stream-processor' || source === 'stream-processor')
    return 'event'
  if (source === 'cdc' || target === 'cdc') return 'event'
  if (DATA_KINDS.includes(target) || target === 'secrets') return 'data'
  if (target === 'realtime-gateway' && (source === 'web-app' || source === 'mobile-app')) return 'websocket'
  if (source === 'device' || target === 'device') return 'event'
  return 'http'
}

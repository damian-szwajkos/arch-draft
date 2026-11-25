import type { ComponentKind } from '../engine/types'

export interface ComponentDetails {
  /** Longer explanation shown in the palette hover card. */
  details: string
  /** When to reach for it. */
  useWhen: string
  /** Concept ids from src/data/concepts.ts. */
  concepts?: string[]
}

export const COMPONENT_DETAILS: Record<ComponentKind, ComponentDetails> = {
  'web-app': {
    details: 'The code running in the user’s browser: a single-page app (React, Angular, Vue) or server-rendered pages (Next.js, Thymeleaf). It should only talk to your backend through an API, never directly to a database.',
    useWhen: 'Customers or staff use the product from a desktop or mobile browser.',
    concepts: ['bff', 'cdn'],
  },
  'mobile-app': {
    details: 'A native (Swift, Kotlin) or cross-platform (Flutter, React Native) app. Mobile clients deal with flaky networks and old app versions in the wild, so APIs must stay backward-compatible and calls should be retry-safe.',
    useWhen: 'Users need push notifications, offline use, location or device features.',
    concepts: ['bff', 'idempotency'],
  },
  device: {
    details: 'A fleet of physical devices — parcel lockers, EV chargers, meters, vehicles — with constrained hardware and flaky connectivity. They hold a long-lived MQTT connection, publish telemetry and receive commands; each device authenticates with its own certificate.',
    useWhen: 'Your system controls or monitors hardware in the field.',
    concepts: ['iot-messaging', 'backpressure'],
  },
  cdn: {
    details: 'A global network of edge caches that serves static assets, images and video from a location near the user. It offloads traffic from your origin and cuts latency dramatically for read-heavy content.',
    useWhen: 'You serve static files or media, or cacheable responses to a global audience.',
    concepts: ['cdn', 'caching'],
  },
  'load-balancer': {
    details: 'Spreads incoming requests across several instances of a service and stops sending traffic to unhealthy ones. It is what makes horizontal scaling and zero-downtime deploys possible.',
    useWhen: 'You run more than one instance of a service, or need health-checked failover.',
  },
  'api-gateway': {
    details: 'The single front door for clients. It routes requests to the right service and centralises cross-cutting concerns: TLS, authentication, rate limiting, request logging and API versioning.',
    useWhen: 'Several backend services are exposed to external clients.',
    concepts: ['api-gateway', 'rate-limiting'],
  },
  bff: {
    details: 'A thin API built for one specific client (web, iOS, partner). It aggregates calls to several services and shapes responses for that screen, so the client makes one round-trip instead of many.',
    useWhen: 'Different clients need very different payloads, or screens fan out to many services.',
    concepts: ['bff', 'api-gateway'],
  },
  'realtime-gateway': {
    details: 'Keeps long-lived WebSocket or Server-Sent Events connections open and pushes updates to clients as they happen. Usually fed by events from a broker so the business services stay stateless.',
    useWhen: 'Users need live updates: chat, tracking, notifications, collaborative editing.',
    concepts: ['realtime', 'fan-out'],
  },
  service: {
    details: 'A small, independently deployable application that owns one business capability and its own data. Other parts of the system interact with it only through its API or the events it publishes.',
    useWhen: 'Teams need to deploy and scale parts of the system independently.',
    concepts: ['microservices', 'database-per-service', 'bounded-context'],
  },
  monolith: {
    details: 'One deployable unit containing the whole application. Drop Module components inside it to model a modular monolith: one build and deploy, but clear internal boundaries between business areas.',
    useWhen: 'A small team, an evolving domain, or when operational simplicity matters most.',
    concepts: ['modular-monolith', 'strangler-fig'],
  },
  module: {
    details: 'A business module inside a deployable application. It owns its data (often its own schema) and exposes a small public API; other modules must not reach into its internals or tables.',
    useWhen: 'Building a modular monolith, or preparing boundaries before extracting services.',
    concepts: ['modular-monolith', 'bounded-context'],
  },
  plugin: {
    details: 'An optional extension loaded by a core application — a country-specific rule set, a payment adapter, a document parser. It implements a stable plug-in contract, is discovered through a registry, and talks only to the core, never to other plug-ins.',
    useWhen: 'The core rarely changes but behaviour varies per customer, region or product and must be added without touching the core (microkernel).',
    concepts: ['microkernel-architecture', 'contract-versioning'],
  },
  worker: {
    details: 'A process that consumes jobs or events from a queue and does slow or heavy work outside the user’s request: sending emails, resizing images, generating reports, calling flaky partners with retries.',
    useWhen: 'Work is slow, bursty, retryable or doesn’t need to finish before responding.',
    concepts: ['background-jobs', 'queue-load-leveling', 'idempotency'],
  },
  function: {
    details: 'A short-lived piece of code triggered by an event (HTTP call, file upload, message, schedule) that scales to zero when idle. You pay per invocation, but face cold starts and execution-time limits.',
    useWhen: 'Spiky or infrequent workloads and glue code between managed services.',
    concepts: ['event-driven'],
  },
  orchestrator: {
    details: 'Drives a multi-step business process across services (reserve stock → charge card → ship) and runs compensating steps when something fails. Engines like Temporal or Camunda persist state so workflows survive crashes.',
    useWhen: 'A transaction spans several services and must end consistently.',
    concepts: ['saga', 'idempotency'],
  },
  'relational-db': {
    details: 'Stores data in tables with a schema, enforces constraints and gives you ACID transactions and powerful joins. The safe default for business data such as orders, accounts and payments.',
    useWhen: 'Data is relational and correctness matters more than extreme write scale.',
    concepts: ['acid-vs-base', 'database-per-service'],
  },
  'document-db': {
    details: 'Stores JSON-like documents or key-value pairs without a fixed schema and partitions easily across nodes. Great when you read and write whole aggregates by key; weaker for cross-entity joins and transactions.',
    useWhen: 'Flexible or nested data, very high scale, simple key-based access patterns.',
    concepts: ['polyglot-persistence', 'acid-vs-base'],
  },
  cache: {
    details: 'An in-memory store such as Redis that answers in sub-millisecond time. Used for hot reads, sessions, rate-limit counters, leaderboards and short-lived data with TTLs. Data in it can be lost or stale.',
    useWhen: 'The same data is read far more than written, or you need fast counters and locks.',
    concepts: ['caching', 'rate-limiting'],
  },
  search: {
    details: 'An inverted-index engine (Elasticsearch, OpenSearch, Meilisearch) for full-text search, filters, facets and relevance ranking. It is a read model kept in sync from the source of truth, not the primary store.',
    useWhen: 'Users search or filter large catalogues by free text.',
    concepts: ['search-indexing', 'cqrs'],
  },
  'object-storage': {
    details: 'Cheap, durable storage for files of any size (S3, GCS, MinIO), addressed by key. Clients often upload and download directly with pre-signed URLs, and a CDN sits in front for delivery.',
    useWhen: 'Images, video, documents, exports, backups and data-lake files.',
    concepts: ['cdn'],
  },
  'wide-column': {
    details: 'Databases like Cassandra or ScyllaDB built for huge write volumes spread across many nodes. You design tables around your queries and partition keys; time-series stores specialise this for timestamped data.',
    useWhen: 'Massive write throughput: feeds, telemetry, events, IoT and location pings.',
    concepts: ['polyglot-persistence', 'acid-vs-base'],
  },
  'analytics-db': {
    details: 'A column-oriented warehouse (ClickHouse, BigQuery, Snowflake) optimised for scanning and aggregating billions of rows. Fed by events or CDC so heavy reporting never slows down the operational databases.',
    useWhen: 'Reporting, dashboards, BI and historical analysis.',
    concepts: ['cdc', 'cqrs'],
  },
  'graph-db': {
    details: 'Stores entities as nodes and relationships as edges (Neo4j, Neptune), making multi-hop queries like “friends of friends” or “people who bought this also bought” fast and natural to express.',
    useWhen: 'Queries traverse many relationships: social graphs, recommendations, fraud rings.',
    concepts: ['polyglot-persistence'],
  },
  broker: {
    details: 'Moves messages between producers and consumers so they don’t need to be online at the same time. Kafka keeps a replayable log for event streaming; RabbitMQ and SQS are queues for distributing work.',
    useWhen: 'Decoupling services, absorbing traffic spikes, or fanning events out to many consumers.',
    concepts: ['event-driven', 'kafka-vs-rabbitmq', 'queue-load-leveling'],
  },
  cdc: {
    details: 'Reliably turns database changes into events. With the transactional outbox, the service writes the event to an outbox table in the same transaction as its data; a relay (or Debezium reading the DB log) then publishes it.',
    useWhen: 'You must update a database and publish an event without losing or duplicating either.',
    concepts: ['outbox', 'cdc'],
  },
  'stream-processor': {
    details: 'Continuously processes event streams with state: windows, joins, aggregations and pattern detection (Flink, Kafka Streams). Produces derived streams and materialised views in near real time.',
    useWhen: 'Real-time analytics, fraud detection, live counters or continuous ETL.',
    concepts: ['event-driven', 'backpressure'],
  },
  'otel-collector': {
    details: 'Receives logs, metrics and traces from services over OTLP, then batches, filters, samples and forwards them to your backends. Keeps services vendor-neutral and decoupled from where telemetry ends up.',
    useWhen: 'Any system with more than a couple of services that needs observability.',
    concepts: ['opentelemetry', 'observability'],
  },
  logging: {
    details: 'Collects structured logs from every instance into one searchable place (Loki, Elasticsearch). Including trace IDs in logs lets you jump from a slow trace straight to the related log lines.',
    useWhen: 'You need to debug what happened across many instances and services.',
    concepts: ['observability'],
  },
  metrics: {
    details: 'Stores numeric time series (Prometheus, Mimir) such as request rate, errors and latency (RED) or utilisation and saturation (USE). The basis for SLOs, dashboards and alerts.',
    useWhen: 'Tracking health, capacity and service-level objectives over time.',
    concepts: ['slo', 'observability'],
  },
  tracing: {
    details: 'Records the path of a single request through every service as a tree of timed spans (Jaeger, Tempo). Shows exactly where latency and errors come from in a distributed call chain.',
    useWhen: 'Requests cross several services or async hops and you need to find bottlenecks.',
    concepts: ['distributed-tracing', 'opentelemetry'],
  },
  dashboards: {
    details: 'Visualises metrics, logs and traces (Grafana) so teams can see system health and business KPIs at a glance and correlate signals during an incident.',
    useWhen: 'Teams need a shared view of health, SLOs and business numbers.',
    concepts: ['observability', 'slo'],
  },
  alerting: {
    details: 'Evaluates rules (ideally SLO burn rates and user-facing symptoms, not CPU spikes) and pages the on-call engineer through tools like PagerDuty or Opsgenie.',
    useWhen: 'Someone must be woken up when users are actually affected.',
    concepts: ['slo'],
  },
  identity: {
    details: 'Handles login, registration, MFA and social sign-in, and issues OAuth2 / OIDC tokens that services validate (Keycloak, Auth0, Cognito). Keeps password handling out of your own services.',
    useWhen: 'Users or partners must authenticate, or you need SSO and fine-grained scopes.',
    concepts: ['oauth-oidc'],
  },
  secrets: {
    details: 'Central, audited storage for database passwords, API keys and certificates (Vault, AWS Secrets Manager), with automatic rotation and short-lived credentials instead of secrets in config files.',
    useWhen: 'Any service needs credentials, especially in regulated environments.',
    concepts: ['secrets-management'],
  },
  waf: {
    details: 'Inspects traffic at the edge and blocks SQL injection, XSS, credential stuffing, scrapers and bot floods before they reach your services. Often bundled with DDoS protection and CAPTCHA challenges.',
    useWhen: 'Public endpoints, high-value targets like checkout and login, or flash sales.',
    concepts: ['rate-limiting'],
  },
  external: {
    details: 'A service you don’t run: payments (Stripe, Adyen), email/SMS (SendGrid, Twilio), maps, KYC or card networks. Treat it as slow and unreliable: call it with timeouts, retries, idempotency keys and circuit breakers.',
    useWhen: 'Buying a capability is cheaper or safer than building it.',
    concepts: ['circuit-breaker', 'idempotency'],
  },
  zone: {
    details: 'A visual boundary around related components. Use it to show a bounded context, which team owns what, or a trust zone such as a PCI-scoped network segment.',
    useWhen: 'Clarifying ownership, domain boundaries or security perimeters on the diagram.',
    concepts: ['bounded-context'],
  },
  note: {
    details: 'Free-text annotation on the canvas. Capture assumptions, trade-offs, open questions or numbers (RPS, data sizes) that explain why the design looks the way it does.',
    useWhen: 'Explaining a decision a reviewer might otherwise question.',
  },
}

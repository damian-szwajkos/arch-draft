export interface Concept {
  id: string
  title: string
  group: 'Architecture styles' | 'Communication' | 'Data' | 'Reliability' | 'Performance & scale' | 'Observability' | 'Security'
  summary: string
  body: string[]
  useWhen: string[]
  pitfalls: string[]
  related: string[]
}

export const CONCEPTS: Concept[] = [
  // Architecture styles ------------------------------------------------------
  {
    id: 'modular-monolith',
    title: 'Modular monolith',
    group: 'Architecture styles',
    summary: 'One deployable, many well-encapsulated modules with explicit public APIs.',
    body: [
      'A modular monolith keeps the operational simplicity of a single deployable (one build, one deploy, in-process calls, one transaction when you need it) while enforcing boundaries between business modules. Each module owns its data (often a schema), exposes a small API and communicates with others through that API or in-process events.',
      'Tools such as Spring Modulith, ArchUnit or Nx boundaries verify that modules do not reach into each other’s internals. Because boundaries are explicit, extracting a module into a service later is a mechanical step, not an archaeology project.',
    ],
    useWhen: ['Small to mid-size teams (1–3 teams)', 'Domain still evolving — boundaries may move', 'You want fast delivery with low ops overhead'],
    pitfalls: ['Shared tables across modules silently re-create a big ball of mud', 'Without automated boundary checks, modularity erodes'],
    related: ['bounded-context', 'microservices', 'strangler-fig'],
  },
  {
    id: 'microservices',
    title: 'Microservices',
    group: 'Architecture styles',
    summary: 'Independently deployable services, each owning one capability and its data.',
    body: [
      'Microservices trade in-process simplicity for team autonomy and independent scaling. Each service is owned by one team, has its own database, and is deployed on its own cadence. Communication happens over the network — synchronously (REST/gRPC) or asynchronously (events).',
      'The cost is real: distributed failures, eventual consistency, observability, contract versioning and platform engineering. Microservices pay off when many teams would otherwise block each other or when parts of the system have very different scaling or compliance needs.',
    ],
    useWhen: ['Many teams need to deploy independently', 'Components have very different scaling / availability needs', 'Isolation is required (e.g. PCI scope)'],
    pitfalls: ['Shared databases → distributed monolith', 'Long synchronous call chains', 'Splitting too early, before boundaries are understood'],
    related: ['database-per-service', 'api-gateway', 'event-driven', 'distributed-tracing'],
  },
  {
    id: 'event-driven',
    title: 'Event-driven architecture',
    group: 'Architecture styles',
    summary: 'Services publish facts ("OrderPlaced") and others react, without knowing each other.',
    body: [
      'In an event-driven architecture, producers emit events describing something that happened, and any number of consumers react. Producers don’t wait for consumers, so a slow or failed consumer doesn’t break the producer, and new capabilities can be added by subscribing to existing events.',
      'Events require a broker (Kafka, RabbitMQ, NATS…), idempotent consumers (messages may be delivered more than once), schema evolution, and acceptance of eventual consistency.',
    ],
    useWhen: ['Several components must react to the same business fact', 'You need to decouple availability between producer and consumer', 'Workloads must be buffered or replayed'],
    pitfalls: ['Hidden flows that nobody can follow without tracing', 'Using events for queries that need an immediate answer', 'Dual writes (DB + broker) without an outbox'],
    related: ['outbox', 'idempotency', 'saga', 'kafka-vs-rabbitmq'],
  },
  {
    id: 'bounded-context',
    title: 'Bounded context',
    group: 'Architecture styles',
    summary: 'A boundary inside which a domain model and its language are consistent.',
    body: [
      'From Domain-Driven Design: the word "Order" means different things to Sales, Fulfilment and Billing. A bounded context draws the line within which one model applies. Contexts integrate through explicit contracts (APIs, events, anti-corruption layers).',
      'In ArchDraft you model contexts as "capabilities" owned by modules or services. Good boundaries align with teams and minimise chatty cross-boundary calls.',
    ],
    useWhen: ['Splitting a system into modules or services', 'Different teams use the same words differently'],
    pitfalls: ['Splitting by technical layer (controllers / DB) instead of business capability', 'One "god service" owning everything'],
    related: ['modular-monolith', 'microservices'],
  },
  {
    id: 'strangler-fig',
    title: 'Strangler fig migration',
    group: 'Architecture styles',
    summary: 'Replace a legacy system incrementally by routing slices of traffic to new components.',
    body: [
      'Instead of a big-bang rewrite, put a façade (gateway/proxy) in front of the legacy system and route one capability at a time to new code. The legacy shrinks until it can be switched off.',
      'CDC (change data capture) often keeps old and new data stores in sync during the transition.',
    ],
    useWhen: ['Modernising a business-critical legacy system', 'You cannot afford a feature freeze'],
    pitfalls: ['Never finishing — two systems forever', 'Sharing the legacy database with new services'],
    related: ['api-gateway', 'cdc', 'modular-monolith'],
  },

  // Communication ------------------------------------------------------------
  {
    id: 'api-gateway',
    title: 'API gateway',
    group: 'Communication',
    summary: 'A single entry point that routes, authenticates, rate-limits and observes API traffic.',
    body: [
      'An API gateway sits between clients and backend services. It terminates TLS, validates tokens, applies rate limits and quotas, routes to the right service, and emits access logs and metrics. Clients see one stable API while services evolve behind it.',
      'Keep business logic out of the gateway — it should be a smart pipe, not a new monolith.',
    ],
    useWhen: ['Multiple backend services behind one public API', 'Cross-cutting concerns: auth, rate limits, CORS, request logging'],
    pitfalls: ['Business logic creeping into gateway plugins', 'Single point of failure if not highly available'],
    related: ['bff', 'rate-limiting', 'oauth-oidc'],
  },
  {
    id: 'bff',
    title: 'Backend for Frontend (BFF)',
    group: 'Communication',
    summary: 'One API layer per client type, shaping and aggregating data for that client.',
    body: [
      'Mobile, web and partner clients need different payloads. A BFF is owned by the frontend team and aggregates calls to downstream services, returning exactly what the screen needs (often via GraphQL).',
    ],
    useWhen: ['Very different clients (mobile vs. web)', 'Screens need data from many services'],
    pitfalls: ['BFFs that duplicate business logic', 'One shared "BFF" that becomes a monolith'],
    related: ['api-gateway'],
  },
  {
    id: 'kafka-vs-rabbitmq',
    title: 'Kafka vs RabbitMQ',
    group: 'Communication',
    summary: 'Replayable log vs smart message router — choose by retention, ordering and routing needs.',
    body: [
      'Kafka (and Redpanda, Pulsar, Kinesis) is a distributed, partitioned, append-only log. Messages are retained for days or forever; consumers track their own offsets and can replay history. Ordering is guaranteed per partition. Ideal for event streaming, event sourcing, analytics pipelines and high throughput.',
      'RabbitMQ is a message broker with flexible routing (exchanges, topics, headers), per-message acknowledgements, priorities and dead-letter queues. Messages are removed once consumed. Ideal for work queues, RPC-style commands and complex routing at moderate scale.',
    ],
    useWhen: ['Kafka: replay, audit, stream processing, many independent consumers, >100k msg/s', 'RabbitMQ: task queues, routing rules, low latency, simple ops at small scale'],
    pitfalls: ['Running Kafka for a few messages per minute', 'Expecting replay from RabbitMQ', 'Ignoring partition keys and then needing ordering'],
    related: ['event-driven', 'event-sourcing', 'backpressure'],
  },
  {
    id: 'realtime',
    title: 'Realtime push (WebSockets / SSE)',
    group: 'Communication',
    summary: 'Keep a connection open and push updates instead of polling.',
    body: [
      'Polling every second from thousands of clients wastes resources and adds latency. A realtime gateway holds WebSocket or Server-Sent Events connections and pushes updates as they happen, usually fed by a broker so any backend instance can publish.',
    ],
    useWhen: ['Live tracking, chat, notifications, collaborative editing', 'Updates must arrive within a second or two'],
    pitfalls: ['Sticky sessions and connection limits at the load balancer', 'Forgetting reconnection and missed-message recovery'],
    related: ['event-driven', 'fan-out'],
  },
  {
    id: 'background-jobs',
    title: 'Background jobs & work queues',
    group: 'Communication',
    summary: 'Move slow or unreliable work (emails, PDFs, video) off the request path.',
    body: [
      'Anything that does not need to finish before you answer the user — sending an email, generating a PDF, transcoding a video — should be enqueued and processed by workers with retries and dead-letter handling. The user gets a fast response and failures are retried without them noticing.',
    ],
    useWhen: ['Work takes more than ~100 ms or calls flaky third parties', 'Work can be retried safely'],
    pitfalls: ['Non-idempotent jobs executed twice', 'No visibility into queue depth'],
    related: ['idempotency', 'queue-load-leveling', 'outbox'],
  },

  // Data ---------------------------------------------------------------------
  {
    id: 'database-per-service',
    title: 'Database per service',
    group: 'Data',
    summary: 'Each service owns its data; others go through its API or events.',
    body: [
      'If two services share tables, a schema change in one silently breaks the other, and neither can be deployed or scaled independently. Owning your data is the defining property of a microservice.',
      'Data needed by others is exposed via APIs or replicated through events into their own read models.',
    ],
    useWhen: ['Microservices with independent teams', 'Different services need different storage engines'],
    pitfalls: ['Cross-service joins become API calls — design boundaries to minimise them', 'Reporting needs a separate analytical store'],
    related: ['microservices', 'polyglot-persistence', 'cqrs'],
  },
  {
    id: 'acid-vs-base',
    title: 'ACID vs eventual consistency',
    group: 'Data',
    summary: 'Strong transactional guarantees vs availability and scale.',
    body: [
      'ACID databases (PostgreSQL, MySQL, Oracle) guarantee atomic, consistent, isolated and durable transactions — essential for money, inventory and anything that must never be double-counted.',
      'Many distributed stores favour availability and partition tolerance (BASE): data converges eventually. That is fine for timelines, counters and caches, but dangerous for balances or seat allocation.',
    ],
    useWhen: ['ACID: money, bookings, inventory, orders', 'Eventual: feeds, analytics, search, recommendations'],
    pitfalls: ['Choosing a NoSQL store for a ledger "because it scales"', 'Assuming caches are consistent with the database'],
    related: ['saga', 'database-per-service'],
  },
  {
    id: 'polyglot-persistence',
    title: 'Polyglot persistence',
    group: 'Data',
    summary: 'Use the storage engine that matches each access pattern.',
    body: [
      'A relational DB for orders, Redis for sessions, Cassandra for timelines, Elasticsearch for search, S3 for media, ClickHouse for analytics. Each engine excels at something; forcing everything into one leads to poor performance or complexity.',
    ],
    useWhen: ['Access patterns differ wildly between capabilities'],
    pitfalls: ['Every new engine is another thing to operate, back up and secure'],
    related: ['database-per-service', 'cqrs'],
  },
  {
    id: 'cqrs',
    title: 'CQRS',
    group: 'Data',
    summary: 'Separate the write model from read models optimised for queries.',
    body: [
      'Command Query Responsibility Segregation splits writes (validated against a normalised model) from reads (served by denormalised projections such as a search index or a precomputed timeline). Read models are updated asynchronously from events.',
    ],
    useWhen: ['Read and write workloads differ dramatically', 'Many different views of the same data'],
    pitfalls: ['Users seeing stale data right after a write ("read your writes")', 'Complexity for simple CRUD'],
    related: ['event-sourcing', 'search-indexing', 'event-driven'],
  },
  {
    id: 'event-sourcing',
    title: 'Event sourcing & replay',
    group: 'Data',
    summary: 'Store the sequence of events as the source of truth; derive state by replaying them.',
    body: [
      'Instead of overwriting rows, append events ("Deposited 50", "Withdrew 20"). Current state is a fold over events. You get a full audit trail and can rebuild new projections by replaying history — which requires a log that retains events.',
    ],
    useWhen: ['Audit trail is a hard requirement (finance, healthcare)', 'You need to rebuild or add projections over history'],
    pitfalls: ['Schema evolution of old events', 'Using it everywhere when CRUD would do'],
    related: ['cqrs', 'kafka-vs-rabbitmq', 'outbox'],
  },
  {
    id: 'search-indexing',
    title: 'Search indexing',
    group: 'Data',
    summary: 'Feed a search engine asynchronously as a derived read model.',
    body: [
      'Search engines (Elasticsearch, OpenSearch, Meilisearch) provide full-text relevance, typo tolerance and facets. They should not be the source of truth: index documents from events or CDC so you can rebuild the index at any time.',
    ],
    useWhen: ['Full-text or faceted search', 'Search load should not hit the primary DB'],
    pitfalls: ['Writing to DB and index synchronously (dual write)', 'Treating the index as primary storage'],
    related: ['cqrs', 'cdc'],
  },
  {
    id: 'outbox',
    title: 'Transactional outbox',
    group: 'Data',
    summary: 'Commit the event together with the data, then publish it reliably.',
    body: [
      'Writing to your database and then publishing to a broker is a dual write: a crash between the two loses the event (or publishes one for a rolled-back transaction). The outbox pattern writes the event into an outbox table in the same transaction; a relay (polling or CDC like Debezium) publishes it to the broker.',
    ],
    useWhen: ['Any service that changes state and must publish an event about it'],
    pitfalls: ['Consumers must still be idempotent — relays deliver at least once', 'Outbox table growth — clean up published rows'],
    related: ['cdc', 'idempotency', 'event-driven'],
  },
  {
    id: 'cdc',
    title: 'Change data capture (CDC)',
    group: 'Data',
    summary: 'Stream committed database changes from the transaction log.',
    body: [
      'CDC tools (Debezium, Kafka Connect) read the database write-ahead log and emit changes as events — no polling, no missed updates, minimal load. Combined with an outbox table, CDC is the most robust way to publish domain events.',
    ],
    useWhen: ['Implementing the outbox pattern', 'Syncing legacy databases during a migration', 'Feeding analytics or search'],
    pitfalls: ['Leaking internal table structure as public events (use an outbox!)'],
    related: ['outbox', 'strangler-fig'],
  },

  // Reliability --------------------------------------------------------------
  {
    id: 'saga',
    title: 'Saga',
    group: 'Reliability',
    summary: 'A business transaction across services as a sequence of local transactions with compensations.',
    body: [
      'Distributed transactions (2PC) don’t fit microservices. A saga splits the work into local transactions; if a step fails, compensating actions undo the previous steps (refund, release hold).',
      'Orchestration: a central coordinator (Temporal, Camunda) tells each participant what to do — easy to follow and monitor. Choreography: each service reacts to events and emits the next — looser coupling but harder to see the whole flow.',
    ],
    useWhen: ['A business operation spans multiple services and must complete or be compensated'],
    pitfalls: ['Forgetting compensations for every step', 'Non-idempotent steps retried by the orchestrator'],
    related: ['idempotency', 'event-driven', 'outbox'],
  },
  {
    id: 'idempotency',
    title: 'Idempotency',
    group: 'Reliability',
    summary: 'Doing the same operation twice has the same effect as doing it once.',
    body: [
      'Networks retry, brokers redeliver and users double-click. Idempotency keys (on APIs) and processed-message tables (on consumers) ensure a payment is not charged twice and an email is not sent twice. "Exactly-once" in practice means at-least-once delivery + idempotent processing.',
    ],
    useWhen: ['Payment and booking APIs', 'Every event consumer'],
    pitfalls: ['Generating the idempotency key on the server instead of the client', 'Dedup windows shorter than retry windows'],
    related: ['outbox', 'saga', 'background-jobs'],
  },
  {
    id: 'circuit-breaker',
    title: 'Timeouts, retries & circuit breakers',
    group: 'Reliability',
    summary: 'Contain failures so one slow dependency doesn’t take everything down.',
    body: [
      'Every remote call needs a timeout. Retries with exponential backoff and jitter help with transient errors. A circuit breaker stops calling a failing dependency for a while, failing fast and giving it time to recover. Bulkheads isolate resource pools per dependency.',
    ],
    useWhen: ['Any synchronous call between services or to third parties'],
    pitfalls: ['Retry storms multiplying load on a struggling service', 'Long synchronous chains — availability is the product of every hop'],
    related: ['event-driven', 'microservices'],
  },
  {
    id: 'queue-load-leveling',
    title: 'Queue-based load levelling',
    group: 'Reliability',
    summary: 'Put a queue between a spiky producer and a steady consumer.',
    body: [
      'When demand spikes (flash sales, uploads), a queue absorbs the burst and consumers process at a sustainable rate. A virtual waiting room is the user-facing version: admit users at a controlled rate.',
    ],
    useWhen: ['Bursty workloads', 'Expensive downstream resources (DB, transcoding, third-party APIs)'],
    pitfalls: ['Unbounded queues hiding a permanently overloaded consumer', 'No feedback to users about wait times'],
    related: ['backpressure', 'rate-limiting', 'background-jobs'],
  },
  {
    id: 'backpressure',
    title: 'Backpressure',
    group: 'Reliability',
    summary: 'Let slow consumers signal producers instead of drowning.',
    body: [
      'If producers write faster than consumers read, something must give: buffer (queues), drop (sampling), or slow the producer. Log-based brokers decouple producers from consumers; consumer lag is the metric that tells you who is falling behind.',
    ],
    useWhen: ['High-volume streams (IoT, GPS, clicks)'],
    pitfalls: ['Unmonitored consumer lag', 'Memory-unbounded in-process buffers'],
    related: ['queue-load-leveling', 'kafka-vs-rabbitmq'],
  },

  // Performance & scale ------------------------------------------------------
  {
    id: 'caching',
    title: 'Caching strategies',
    group: 'Performance & scale',
    summary: 'Serve hot data from memory: cache-aside, read-through, write-through, TTLs.',
    body: [
      'Cache-aside (lazy loading) is the default: read cache → on miss, read DB and populate cache with a TTL. Write-through updates the cache on every write. Redis adds atomic operations, TTL-based holds, geo queries, rate limiting and leaderboards.',
      'There are only two hard things in computer science: cache invalidation and naming things. Prefer short TTLs plus explicit invalidation on writes.',
    ],
    useWhen: ['Read-heavy data that tolerates slight staleness', 'Expensive computations or aggregations', 'Short-lived state (sessions, holds, tokens)'],
    pitfalls: ['Thundering herd when a hot key expires', 'Treating the cache as the source of truth'],
    related: ['cdn', 'fan-out'],
  },
  {
    id: 'cdn',
    title: 'CDN & object storage',
    group: 'Performance & scale',
    summary: 'Store files in object storage; serve them from edge locations near users.',
    body: [
      'Images, video segments and JS bundles belong in object storage (S3, GCS) — not in databases or on app servers. A CDN caches them in hundreds of edge locations, cutting latency and origin load. Pre-signed URLs let clients upload and download directly.',
    ],
    useWhen: ['Static assets, media, downloads', 'Global audiences'],
    pitfalls: ['Caching personalised responses', 'Forgetting cache invalidation on deploys'],
    related: ['caching'],
  },
  {
    id: 'fan-out',
    title: 'Fan-out on write vs read',
    group: 'Performance & scale',
    summary: 'Precompute feeds when content is written, or assemble them when read.',
    body: [
      'Fan-out on write pushes a new post id into every follower’s timeline cache — reads become a single lookup, but a celebrity with 10M followers creates 10M writes. Fan-out on read merges followees’ posts at read time — cheap writes, expensive reads. Real systems use a hybrid.',
    ],
    useWhen: ['Social feeds, activity streams, notifications'],
    pitfalls: ['Celebrity problem', 'Doing the fan-out synchronously in the post request'],
    related: ['caching', 'event-driven'],
  },
  {
    id: 'rate-limiting',
    title: 'Rate limiting',
    group: 'Performance & scale',
    summary: 'Cap how many requests a client can make to protect capacity and fairness.',
    body: [
      'Token bucket and sliding window algorithms (often in Redis or the gateway) limit requests per user, IP or API key. Limits protect services from abuse, scrapers and accidental retry storms, and keep resources fair under load.',
    ],
    useWhen: ['Public APIs', 'Expensive or abuse-prone endpoints (login, link creation, checkout)'],
    pitfalls: ['Per-instance limits that don’t add up across replicas', 'Returning errors without Retry-After headers'],
    related: ['api-gateway', 'queue-load-leveling'],
  },

  // Observability ------------------------------------------------------------
  {
    id: 'observability',
    title: 'Observability: logs, metrics, traces',
    group: 'Observability',
    summary: 'Understand internal state from the outside, with three complementary signals.',
    body: [
      'Metrics are cheap aggregated numbers (request rate, errors, duration — RED) for dashboards and alerts. Traces follow a single request across services. Logs carry rich detail for a specific event. Correlate them with shared trace ids.',
    ],
    useWhen: ['Always — and the more distributed the system, the more it matters'],
    pitfalls: ['Logging everything, measuring nothing', 'High-cardinality labels exploding metric storage'],
    related: ['distributed-tracing', 'opentelemetry', 'slo'],
  },
  {
    id: 'distributed-tracing',
    title: 'Distributed tracing',
    group: 'Observability',
    summary: 'Follow one request through every hop with spans and propagated context.',
    body: [
      'Each service creates spans and propagates a trace id (W3C traceparent) to downstream calls and message headers. A tracing backend (Jaeger, Tempo) reconstructs the full path and shows where latency and errors originate.',
    ],
    useWhen: ['More than two services on a request path', 'Asynchronous flows through brokers'],
    pitfalls: ['Missing context propagation through queues', '100% sampling at high volume — use tail sampling'],
    related: ['opentelemetry', 'observability'],
  },
  {
    id: 'opentelemetry',
    title: 'OpenTelemetry',
    group: 'Observability',
    summary: 'Vendor-neutral standard and tooling for traces, metrics and logs.',
    body: [
      'OpenTelemetry provides SDKs, auto-instrumentation agents and the OTLP protocol. The OTel Collector receives telemetry, processes it (batching, sampling, redaction) and exports to any backend — so switching vendors is configuration, not re-instrumentation.',
    ],
    useWhen: ['New instrumentation of any kind', 'Avoiding vendor lock-in'],
    pitfalls: ['Running without a collector, coupling apps to a vendor endpoint'],
    related: ['distributed-tracing', 'observability'],
  },
  {
    id: 'slo',
    title: 'SLIs, SLOs & alerting',
    group: 'Observability',
    summary: 'Define what "good" means for users and alert when you are burning the error budget.',
    body: [
      'An SLI is a measurement (fraction of requests under 300 ms). An SLO is the target (99.9% over 30 days). The remainder is the error budget. Alert on fast burn of the budget — symptoms users feel — rather than on CPU or memory.',
    ],
    useWhen: ['Any user-facing service with on-call'],
    pitfalls: ['Alert fatigue from cause-based alerts', '100% targets that make every deploy risky'],
    related: ['observability'],
  },

  // Security -----------------------------------------------------------------
  {
    id: 'oauth-oidc',
    title: 'OAuth 2.0 & OpenID Connect',
    group: 'Security',
    summary: 'Delegate login to an identity provider; services validate signed tokens.',
    body: [
      'An identity provider (Keycloak, Auth0, Okta, Cognito) authenticates users (passwords, MFA, social login) and issues signed JWT access tokens. Gateways and services validate tokens locally without calling the IdP on each request. Scopes and claims drive authorisation.',
    ],
    useWhen: ['Any system with user accounts', 'Single sign-on across apps'],
    pitfalls: ['Long-lived tokens without rotation', 'Rolling your own password storage'],
    related: ['api-gateway', 'secrets-management'],
  },
  {
    id: 'secrets-management',
    title: 'Secrets management',
    group: 'Security',
    summary: 'Store, rotate and audit credentials outside of code and config files.',
    body: [
      'Vault or cloud secret managers keep DB passwords, API keys and signing keys encrypted, access-controlled and audited. Dynamic secrets issue short-lived credentials per service instance, so a leaked credential expires on its own.',
    ],
    useWhen: ['Always in production', 'Regulated environments'],
    pitfalls: ['Secrets in environment files committed to Git', 'Static credentials shared by every service'],
    related: ['oauth-oidc'],
  },
]

export const CONCEPT_BY_ID = Object.fromEntries(CONCEPTS.map((c) => [c.id, c])) as Record<string, Concept>
export const CONCEPT_GROUPS = [...new Set(CONCEPTS.map((c) => c.group))]

// Real-world technologies and libraries that implement each concept.
// Grouped by ecosystem or role; every concept id in CONCEPTS has an entry
// (enforced by conceptExamples.test.ts).

export interface ConceptExample {
  name: string
  note: string
  url?: string
}

export interface ConceptExampleGroup {
  label: string
  items: ConceptExample[]
}

export const CONCEPT_EXAMPLES: Record<string, ConceptExampleGroup[]> = {
  // Architecture styles ------------------------------------------------------
  'modular-monolith': [
    {
      label: 'Java / Spring',
      items: [
        { name: 'Spring Modulith', note: 'Declares modules, verifies boundaries, documents them', url: 'https://spring.io/projects/spring-modulith' },
        { name: 'ArchUnit', note: 'Unit tests that fail on forbidden package dependencies', url: 'https://www.archunit.org' },
        { name: 'jMolecules', note: 'Annotations to express DDD building blocks in code', url: 'https://github.com/xmolecules/jmolecules' },
      ],
    },
    {
      label: 'Node.js / TypeScript',
      items: [
        { name: 'Nx module boundaries', note: 'Lint rule enforcing which libraries may import which', url: 'https://nx.dev/features/enforce-module-boundaries' },
        { name: 'dependency-cruiser', note: 'Validates import graph against your boundary rules', url: 'https://github.com/sverweij/dependency-cruiser' },
      ],
    },
    {
      label: 'Other ecosystems',
      items: [
        { name: 'NetArchTest', note: '.NET fluent API for architecture rules in tests', url: 'https://github.com/BenMorris/NetArchTest' },
        { name: 'deptrac', note: 'PHP static analysis of layer and module dependencies', url: 'https://github.com/deptrac/deptrac' },
        { name: 'Packwerk', note: 'Shopify’s Ruby tool enforcing package boundaries', url: 'https://github.com/Shopify/packwerk' },
        { name: 'import-linter', note: 'Python contracts forbidding imports between packages', url: 'https://github.com/seddonym/import-linter' },
      ],
    },
  ],
  microservices: [
    {
      label: 'Service frameworks',
      items: [
        { name: 'Spring Boot + Spring Cloud', note: 'Config, discovery, gateway and resilience for JVM services', url: 'https://spring.io/projects/spring-cloud' },
        { name: 'Quarkus', note: 'Kubernetes-native Java with fast startup and low memory', url: 'https://quarkus.io' },
        { name: 'NestJS', note: 'Node.js framework with built-in microservice transports', url: 'https://nestjs.com' },
        { name: '.NET Aspire', note: 'Orchestrates and observes multi-service .NET apps locally' },
      ],
    },
    {
      label: 'Platform & infrastructure',
      items: [
        { name: 'Kubernetes', note: 'Schedules, scales and heals independently deployed services', url: 'https://kubernetes.io' },
        { name: 'Istio / Linkerd', note: 'Service mesh: mTLS, retries and traffic shifting', url: 'https://linkerd.io' },
        { name: 'Dapr', note: 'Sidecar APIs for pub/sub, state and service invocation', url: 'https://dapr.io' },
        { name: 'Backstage', note: 'Service catalog: who owns what, docs and templates', url: 'https://backstage.io' },
      ],
    },
    {
      label: 'Testing & verification',
      items: [
        { name: 'Pact', note: 'Consumer-driven contract tests between services', url: 'https://pact.io' },
        { name: 'Testcontainers', note: 'Real dependencies in throwaway containers for tests', url: 'https://testcontainers.com' },
      ],
    },
  ],
  'event-driven': [
    {
      label: 'Brokers',
      items: [
        { name: 'Apache Kafka', note: 'Durable, partitioned event log with replay', url: 'https://kafka.apache.org' },
        { name: 'RabbitMQ', note: 'Flexible routing of messages via exchanges and queues', url: 'https://www.rabbitmq.com' },
        { name: 'NATS JetStream', note: 'Lightweight messaging with persistent streams', url: 'https://nats.io' },
      ],
    },
    {
      label: 'Application frameworks',
      items: [
        { name: 'Spring Cloud Stream', note: 'Binder abstraction for Kafka/RabbitMQ producers and consumers', url: 'https://spring.io/projects/spring-cloud-stream' },
        { name: 'MassTransit', note: '.NET message bus over RabbitMQ, Azure Service Bus, SQS', url: 'https://masstransit.io' },
        { name: 'Watermill', note: 'Go library for building event-driven apps on any broker', url: 'https://watermill.io' },
      ],
    },
    {
      label: 'Contracts & managed services',
      items: [
        { name: 'CloudEvents', note: 'CNCF spec for a common event envelope', url: 'https://cloudevents.io' },
        { name: 'AsyncAPI', note: 'Documents channels and message schemas like OpenAPI', url: 'https://www.asyncapi.com' },
        { name: 'Amazon EventBridge', note: 'Managed event bus with content-based routing rules', url: 'https://aws.amazon.com/eventbridge/' },
      ],
    },
  ],
  'bounded-context': [
    {
      label: 'Discovery techniques',
      items: [
        { name: 'EventStorming', note: 'Workshop format to find domain events and boundaries', url: 'https://www.eventstorming.com' },
        { name: 'Domain Storytelling', note: 'Pictographic stories that reveal language and actors', url: 'https://domainstorytelling.org' },
        { name: 'Bounded Context Canvas', note: 'DDD Crew template to describe one context', url: 'https://github.com/ddd-crew/bounded-context-canvas' },
      ],
    },
    {
      label: 'Modelling tools',
      items: [
        { name: 'Context Mapper', note: 'DSL for context maps; generates diagrams', url: 'https://contextmapper.org' },
        { name: 'Structurizr', note: 'C4 models as code, views per context', url: 'https://structurizr.com' },
      ],
    },
    {
      label: 'Enforcing in code',
      items: [
        { name: 'Spring Modulith', note: 'One module per context with verified boundaries', url: 'https://spring.io/projects/spring-modulith' },
        { name: 'jMolecules', note: 'Marks aggregates, entities and value objects explicitly', url: 'https://github.com/xmolecules/jmolecules' },
        { name: 'ArchUnit', note: 'Tests that contexts don’t depend on each other’s internals', url: 'https://www.archunit.org' },
      ],
    },
  ],
  'strangler-fig': [
    {
      label: 'Routing facade',
      items: [
        { name: 'Envoy', note: 'Route by path or header between legacy and new', url: 'https://www.envoyproxy.io' },
        { name: 'NGINX', note: 'Reverse proxy that peels routes off the legacy app', url: 'https://nginx.org' },
        { name: 'Spring Cloud Gateway', note: 'Programmable JVM gateway with predicate-based routing', url: 'https://spring.io/projects/spring-cloud-gateway' },
        { name: 'YARP', note: '.NET reverse proxy toolkit for incremental migrations' },
      ],
    },
    {
      label: 'Gradual cut-over',
      items: [
        { name: 'OpenFeature', note: 'Vendor-neutral feature flag API to toggle new paths', url: 'https://openfeature.dev' },
        { name: 'Unleash', note: 'Open-source feature flags with gradual rollout', url: 'https://www.getunleash.io' },
        { name: 'GoReplay', note: 'Shadows real traffic onto the new implementation', url: 'https://goreplay.org' },
      ],
    },
    {
      label: 'Data migration',
      items: [
        { name: 'Debezium', note: 'Streams legacy DB changes to keep new store in sync', url: 'https://debezium.io' },
        { name: 'Flyway / Liquibase', note: 'Versioned schema migrations for the new database', url: 'https://www.liquibase.com' },
      ],
    },
  ],

  // Communication ------------------------------------------------------------
  'api-gateway': [
    {
      label: 'Self-hosted gateways',
      items: [
        { name: 'Kong Gateway', note: 'Plugin-based gateway: auth, rate limits, transforms', url: 'https://konghq.com' },
        { name: 'Envoy Gateway', note: 'Envoy managed through the Kubernetes Gateway API', url: 'https://gateway.envoyproxy.io' },
        { name: 'Apache APISIX', note: 'Dynamic, etcd-backed gateway with hot-reloaded routes', url: 'https://apisix.apache.org' },
        { name: 'Traefik', note: 'Auto-discovers routes from Kubernetes and Docker labels', url: 'https://traefik.io' },
      ],
    },
    {
      label: 'Framework gateways',
      items: [
        { name: 'Spring Cloud Gateway', note: 'Reactive JVM gateway with filters and predicates', url: 'https://spring.io/projects/spring-cloud-gateway' },
        { name: 'YARP', note: 'Customizable reverse proxy built on ASP.NET Core' },
      ],
    },
    {
      label: 'Managed cloud services',
      items: [
        { name: 'Amazon API Gateway', note: 'Managed REST/HTTP/WebSocket APIs with throttling', url: 'https://aws.amazon.com/api-gateway/' },
        { name: 'Azure API Management', note: 'Gateway plus developer portal and policies', url: 'https://azure.microsoft.com/products/api-management' },
        { name: 'Google Apigee', note: 'Enterprise API management, analytics and monetisation', url: 'https://cloud.google.com/apigee' },
      ],
    },
  ],
  bff: [
    {
      label: 'GraphQL BFFs',
      items: [
        { name: 'Apollo Server', note: 'GraphQL server aggregating downstream services per client', url: 'https://www.apollographql.com/docs/apollo-server' },
        { name: 'GraphQL Yoga', note: 'Lightweight, spec-compliant GraphQL server for Node', url: 'https://the-guild.dev/graphql/yoga-server' },
        { name: 'Spring for GraphQL', note: 'GraphQL endpoints on Spring with batching support', url: 'https://spring.io/projects/spring-graphql' },
        { name: 'Hot Chocolate', note: '.NET GraphQL server with schema stitching and fusion', url: 'https://chillicream.com' },
      ],
    },
    {
      label: 'Web BFFs',
      items: [
        { name: 'Next.js route handlers', note: 'Server code co-located with the UI it serves', url: 'https://nextjs.org' },
        { name: 'tRPC', note: 'End-to-end typed API between TS frontend and BFF', url: 'https://trpc.io' },
        { name: 'Fastify', note: 'Fast Node.js server for hand-rolled aggregation endpoints', url: 'https://fastify.dev' },
      ],
    },
    {
      label: 'Security',
      items: [
        { name: 'Duende BFF', note: 'Keeps OAuth tokens server-side; browser gets a cookie', url: 'https://duendesoftware.com' },
        { name: 'Spring Cloud Gateway TokenRelay', note: 'Relays the session’s access token to downstream APIs', url: 'https://spring.io/projects/spring-cloud-gateway' },
      ],
    },
  ],
  'kafka-vs-rabbitmq': [
    {
      label: 'Log-based (Kafka family)',
      items: [
        { name: 'Apache Kafka', note: 'Partitioned log; consumers track offsets and can replay', url: 'https://kafka.apache.org' },
        { name: 'Redpanda', note: 'Kafka-API-compatible broker in C++, no JVM/ZooKeeper', url: 'https://www.redpanda.com' },
        { name: 'Apache Pulsar', note: 'Log plus queue semantics with tiered storage', url: 'https://pulsar.apache.org' },
      ],
    },
    {
      label: 'Queue-based (AMQP family)',
      items: [
        { name: 'RabbitMQ', note: 'Exchanges, routing keys, per-message acks; also Streams', url: 'https://www.rabbitmq.com' },
        { name: 'Amazon SQS', note: 'Fully managed queue; no broker to run', url: 'https://aws.amazon.com/sqs/' },
        { name: 'Azure Service Bus', note: 'Managed queues/topics with sessions and dead-lettering', url: 'https://azure.microsoft.com/products/service-bus' },
      ],
    },
    {
      label: 'Clients & operations',
      items: [
        { name: 'Spring for Apache Kafka / Spring AMQP', note: 'Listener containers, retries and transactions on Spring', url: 'https://spring.io/projects/spring-kafka' },
        { name: 'Strimzi', note: 'Operator for running Kafka on Kubernetes', url: 'https://strimzi.io' },
        { name: 'Confluent Cloud / Amazon MSK', note: 'Managed Kafka when you’d rather not operate it', url: 'https://aws.amazon.com/msk/' },
      ],
    },
  ],
  realtime: [
    {
      label: 'Server libraries',
      items: [
        { name: 'Socket.IO', note: 'WebSocket with fallbacks, rooms and reconnection', url: 'https://socket.io' },
        { name: 'ws', note: 'Minimal, fast WebSocket server for Node.js', url: 'https://github.com/websockets/ws' },
        { name: 'ASP.NET Core SignalR', note: 'Hubs over WebSockets/SSE with Redis backplane', url: 'https://learn.microsoft.com/aspnet/core/signalr/introduction' },
        { name: 'Spring WebSocket + STOMP', note: 'Message-broker style topics over WebSocket', url: 'https://docs.spring.io/spring-framework/reference/web/websocket.html' },
      ],
    },
    {
      label: 'Standalone push servers',
      items: [
        { name: 'Centrifugo', note: 'Scalable realtime server; your backend publishes via API', url: 'https://centrifugal.dev' },
        { name: 'Mercure', note: 'SSE-based hub for pushing updates to browsers', url: 'https://mercure.rocks' },
        { name: 'Redis Pub/Sub', note: 'Fans messages out across many socket nodes', url: 'https://redis.io' },
      ],
    },
    {
      label: 'Managed cloud services',
      items: [
        { name: 'Ably', note: 'Managed pub/sub channels with presence and history', url: 'https://ably.com' },
        { name: 'Pusher Channels', note: 'Hosted WebSocket channels with simple SDKs', url: 'https://pusher.com' },
        { name: 'Azure Web PubSub', note: 'Managed WebSocket service with serverless integration', url: 'https://azure.microsoft.com/products/web-pubsub' },
      ],
    },
  ],
  'background-jobs': [
    {
      label: 'Java / .NET',
      items: [
        { name: 'JobRunr', note: 'Persistent background jobs from Java lambdas, with dashboard', url: 'https://www.jobrunr.io' },
        { name: 'db-scheduler', note: 'Cluster-safe scheduled tasks using one database table', url: 'https://github.com/kagkarlsson/db-scheduler' },
        { name: 'Hangfire', note: '.NET fire-and-forget, delayed and recurring jobs', url: 'https://www.hangfire.io' },
      ],
    },
    {
      label: 'Node.js / Python / Ruby / Go',
      items: [
        { name: 'BullMQ', note: 'Redis-backed queues with retries, priorities, rate limits', url: 'https://bullmq.io' },
        { name: 'Celery', note: 'Distributed task queue for Python', url: 'https://docs.celeryq.dev' },
        { name: 'Sidekiq', note: 'Redis-backed background jobs for Ruby', url: 'https://sidekiq.org' },
        { name: 'River', note: 'Go job queue on Postgres, transactional enqueue', url: 'https://riverqueue.com' },
      ],
    },
    {
      label: 'Durable workflows & managed',
      items: [
        { name: 'Temporal', note: 'Durable execution for long-running, retryable work', url: 'https://temporal.io' },
        { name: 'Google Cloud Tasks', note: 'Managed queue that dispatches HTTP tasks to workers', url: 'https://cloud.google.com/tasks' },
        { name: 'KEDA', note: 'Scales worker pods on queue depth', url: 'https://keda.sh' },
      ],
    },
  ],

  // Data ---------------------------------------------------------------------
  'database-per-service': [
    {
      label: 'Schema ownership',
      items: [
        { name: 'Flyway', note: 'Versioned SQL migrations owned by each service', url: 'https://flywaydb.org' },
        { name: 'Liquibase', note: 'Changelog-based migrations with rollback support', url: 'https://www.liquibase.com' },
        { name: 'Atlas', note: 'Declarative schema-as-code with migration linting', url: 'https://atlasgo.io' },
        { name: 'EF Core migrations', note: 'Code-first migrations per .NET bounded context', url: 'https://learn.microsoft.com/ef/core/managing-schemas/migrations/' },
      ],
    },
    {
      label: 'Provisioning',
      items: [
        { name: 'CloudNativePG', note: 'Kubernetes operator: one Postgres cluster per service', url: 'https://cloudnative-pg.io' },
        { name: 'Crossplane', note: 'Services request their own cloud database declaratively', url: 'https://www.crossplane.io' },
        { name: 'Amazon RDS / Aurora', note: 'Managed relational databases per service', url: 'https://aws.amazon.com/rds/' },
      ],
    },
    {
      label: 'Sharing data without sharing tables',
      items: [
        { name: 'Debezium', note: 'Publishes row changes as events other services consume', url: 'https://debezium.io' },
        { name: 'Apache Kafka', note: 'Event backbone for replicated read models', url: 'https://kafka.apache.org' },
      ],
    },
  ],
  'acid-vs-base': [
    {
      label: 'ACID / strongly consistent',
      items: [
        { name: 'PostgreSQL', note: 'Serializable transactions on a single node', url: 'https://www.postgresql.org' },
        { name: 'CockroachDB', note: 'Distributed SQL with serializable isolation by default', url: 'https://www.cockroachlabs.com' },
        { name: 'Google Cloud Spanner', note: 'Globally distributed, externally consistent transactions', url: 'https://cloud.google.com/spanner' },
        { name: 'YugabyteDB', note: 'Postgres-compatible distributed SQL', url: 'https://www.yugabyte.com' },
      ],
    },
    {
      label: 'BASE / tunable consistency',
      items: [
        { name: 'Apache Cassandra', note: 'Per-query consistency levels; AP by default', url: 'https://cassandra.apache.org' },
        { name: 'Amazon DynamoDB', note: 'Eventually consistent reads unless you ask for strong', url: 'https://aws.amazon.com/dynamodb/' },
        { name: 'ScyllaDB', note: 'Cassandra-compatible, low-latency wide-column store', url: 'https://www.scylladb.com' },
      ],
    },
    {
      label: 'Testing & verification',
      items: [
        { name: 'Jepsen', note: 'Tests what databases really guarantee under partitions', url: 'https://jepsen.io' },
        { name: 'Elle', note: 'Checker that detects isolation anomalies in histories', url: 'https://github.com/jepsen-io/elle' },
      ],
    },
  ],
  'polyglot-persistence': [
    {
      label: 'Stores by access pattern',
      items: [
        { name: 'PostgreSQL', note: 'Default relational system of record', url: 'https://www.postgresql.org' },
        { name: 'Redis', note: 'Key-value for sessions, counters, leaderboards', url: 'https://redis.io' },
        { name: 'OpenSearch', note: 'Full-text search and log analytics', url: 'https://opensearch.org' },
        { name: 'ClickHouse', note: 'Columnar store for fast analytical queries', url: 'https://clickhouse.com' },
        { name: 'Neo4j', note: 'Graph database for relationship-heavy queries', url: 'https://neo4j.com' },
      ],
    },
    {
      label: 'Postgres extensions (fewer moving parts)',
      items: [
        { name: 'pgvector', note: 'Vector similarity search inside Postgres', url: 'https://github.com/pgvector/pgvector' },
        { name: 'PostGIS', note: 'Geospatial types and indexes for Postgres', url: 'https://postgis.net' },
        { name: 'TimescaleDB', note: 'Time-series hypertables on top of Postgres' },
      ],
    },
    {
      label: 'Access & synchronisation',
      items: [
        { name: 'Spring Data', note: 'Consistent repository API across many store types', url: 'https://spring.io/projects/spring-data' },
        { name: 'Debezium', note: 'Keeps secondary stores in sync from the primary', url: 'https://debezium.io' },
      ],
    },
  ],
  cqrs: [
    {
      label: 'Java / Spring',
      items: [
        { name: 'Axon Framework', note: 'Command/query buses, aggregates and projections', url: 'https://www.axoniq.io' },
        { name: 'Spring Modulith events', note: 'Update read models from in-process domain events', url: 'https://spring.io/projects/spring-modulith' },
      ],
    },
    {
      label: '.NET',
      items: [
        { name: 'Wolverine', note: 'Command/message handling with durable outbox', url: 'https://wolverinefx.net' },
        { name: 'Marten', note: 'Postgres document store with projections for read models', url: 'https://martendb.io' },
        { name: 'MediatR', note: 'In-process dispatch of commands and queries to handlers', url: 'https://github.com/jbogard/MediatR' },
      ],
    },
    {
      label: 'Node.js / TypeScript',
      items: [
        { name: '@nestjs/cqrs', note: 'CommandBus, QueryBus and EventBus for NestJS', url: 'https://docs.nestjs.com/recipes/cqrs' },
        { name: 'Emmett', note: 'Event-driven building blocks for TS/Node', url: 'https://event-driven-io.github.io/emmett/' },
      ],
    },
    {
      label: 'Read-model stores',
      items: [
        { name: 'PostgreSQL materialized views', note: 'Precomputed query tables refreshed on demand', url: 'https://www.postgresql.org/docs/current/rules-materializedviews.html' },
        { name: 'OpenSearch / Elasticsearch', note: 'Denormalised, query-optimised read side', url: 'https://opensearch.org' },
      ],
    },
  ],
  'event-sourcing': [
    {
      label: 'Event stores',
      items: [
        { name: 'KurrentDB (EventStoreDB)', note: 'Purpose-built event store with streams and subscriptions', url: 'https://www.kurrent.io' },
        { name: 'Axon Server', note: 'Event store and message router for Axon apps', url: 'https://www.axoniq.io' },
        { name: 'Marten', note: '.NET event sourcing on PostgreSQL', url: 'https://martendb.io' },
      ],
    },
    {
      label: 'Libraries',
      items: [
        { name: 'Axon Framework', note: 'Event-sourced aggregates and replayable projections (Java)', url: 'https://www.axoniq.io' },
        { name: 'Eventuous', note: 'Lightweight .NET event sourcing library', url: 'https://eventuous.dev' },
        { name: 'Emmett', note: 'Event sourcing for TypeScript on Postgres/Kurrent', url: 'https://event-driven-io.github.io/emmett/' },
        { name: 'eventsourcing (Python)', note: 'Aggregates, snapshots and projections for Python', url: 'https://eventsourcing.readthedocs.io' },
      ],
    },
    {
      label: 'Actor-based',
      items: [
        { name: 'Apache Pekko Persistence', note: 'Event-sourced actors with journal and snapshots', url: 'https://pekko.apache.org' },
        { name: 'Microsoft Orleans event sourcing', note: 'JournaledGrain persists grain state as events', url: 'https://learn.microsoft.com/dotnet/orleans/' },
      ],
    },
  ],
  'search-indexing': [
    {
      label: 'Search engines',
      items: [
        { name: 'Elasticsearch', note: 'Distributed full-text search and aggregations', url: 'https://www.elastic.co/elasticsearch' },
        { name: 'OpenSearch', note: 'Apache-2.0 fork of Elasticsearch', url: 'https://opensearch.org' },
        { name: 'Meilisearch', note: 'Typo-tolerant instant search, simple to run', url: 'https://www.meilisearch.com' },
        { name: 'Typesense', note: 'Fast in-memory search with faceting', url: 'https://typesense.org' },
      ],
    },
    {
      label: 'Keeping the index in sync',
      items: [
        { name: 'Debezium', note: 'CDC events from the DB drive index updates', url: 'https://debezium.io' },
        { name: 'Hibernate Search', note: 'Auto-indexes JPA entities into Lucene/Elasticsearch', url: 'https://hibernate.org/search/' },
        { name: 'Spring Data Elasticsearch', note: 'Repository-style indexing and querying', url: 'https://spring.io/projects/spring-data-elasticsearch' },
      ],
    },
    {
      label: 'In-database & managed',
      items: [
        { name: 'PostgreSQL full-text search', note: 'tsvector + GIN index, often enough to start', url: 'https://www.postgresql.org/docs/current/textsearch.html' },
        { name: 'Algolia', note: 'Hosted search API with relevance tuning', url: 'https://www.algolia.com' },
        { name: 'Amazon OpenSearch Service', note: 'Managed OpenSearch clusters', url: 'https://aws.amazon.com/opensearch-service/' },
      ],
    },
  ],
  outbox: [
    {
      label: 'CDC-based relay',
      items: [
        { name: 'Debezium Outbox Event Router', note: 'Turns outbox-table rows into routed Kafka events', url: 'https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html' },
        { name: 'Kafka Connect', note: 'Runs the Debezium connector reliably', url: 'https://kafka.apache.org/documentation/#connect' },
      ],
    },
    {
      label: 'Java / Spring',
      items: [
        { name: 'Spring Modulith event publication registry', note: 'Persists events in the transaction, republishes incomplete ones', url: 'https://docs.spring.io/spring-modulith/reference/events.html' },
        { name: 'Eventuate Tram', note: 'Transactional messaging via outbox for Spring services', url: 'https://eventuate.io' },
      ],
    },
    {
      label: '.NET',
      items: [
        { name: 'MassTransit transactional outbox', note: 'EF Core/Mongo outbox plus inbox deduplication', url: 'https://masstransit.io' },
        { name: 'NServiceBus Outbox', note: 'Exactly-once processing via stored outgoing messages', url: 'https://docs.particular.net/nservicebus/outbox/' },
        { name: 'Wolverine', note: 'Durable outbox integrated with Marten and EF Core', url: 'https://wolverinefx.net' },
      ],
    },
    {
      label: 'Go / Node.js',
      items: [
        { name: 'Watermill Forwarder', note: 'Go: writes to SQL in-transaction, forwards to broker', url: 'https://watermill.io' },
        { name: 'Graphile Worker', note: 'Node: enqueue a job in the same Postgres transaction', url: 'https://worker.graphile.org' },
      ],
    },
  ],
  cdc: [
    {
      label: 'Open-source connectors',
      items: [
        { name: 'Debezium', note: 'Log-based CDC for Postgres, MySQL, SQL Server, Mongo', url: 'https://debezium.io' },
        { name: 'Apache Flink CDC', note: 'Streams DB changes straight into Flink pipelines' },
        { name: 'Maxwell’s Daemon', note: 'MySQL binlog to JSON on Kafka/Kinesis', url: 'https://maxwells-daemon.io' },
      ],
    },
    {
      label: 'Database-native',
      items: [
        { name: 'PostgreSQL logical decoding', note: 'Replication slots expose committed changes', url: 'https://www.postgresql.org/docs/current/logicaldecoding.html' },
        { name: 'MongoDB change streams', note: 'Subscribe to inserts/updates on collections', url: 'https://www.mongodb.com/docs/manual/changeStreams/' },
        { name: 'DynamoDB Streams', note: 'Ordered item-level change log per table' },
      ],
    },
    {
      label: 'Managed cloud services',
      items: [
        { name: 'AWS Database Migration Service', note: 'Ongoing replication from source DB to targets', url: 'https://aws.amazon.com/dms/' },
        { name: 'Google Datastream', note: 'Serverless CDC into BigQuery and Cloud Storage', url: 'https://cloud.google.com/datastream' },
        { name: 'Airbyte', note: 'ELT platform with CDC source connectors', url: 'https://airbyte.com' },
      ],
    },
  ],
  saga: [
    {
      label: 'Orchestration engines',
      items: [
        { name: 'Temporal', note: 'Workflows as code with compensations and retries', url: 'https://temporal.io' },
        { name: 'Camunda', note: 'BPMN-modelled long-running processes', url: 'https://camunda.com' },
        { name: 'Restate', note: 'Durable execution with built-in saga patterns', url: 'https://restate.dev' },
      ],
    },
    {
      label: 'Messaging frameworks',
      items: [
        { name: 'MassTransit state machines', note: '.NET sagas persisted per correlation id', url: 'https://masstransit.io' },
        { name: 'NServiceBus sagas', note: 'Message-driven, stateful long-running processes', url: 'https://docs.particular.net/nservicebus/sagas/' },
        { name: 'Axon Framework sagas', note: 'Event-driven sagas with deadlines (Java)', url: 'https://www.axoniq.io' },
        { name: 'Eventuate Tram Sagas', note: 'Orchestrated sagas for Spring microservices', url: 'https://eventuate.io' },
      ],
    },
    {
      label: 'Managed cloud services',
      items: [
        { name: 'AWS Step Functions', note: 'State machines with catch/compensate steps', url: 'https://aws.amazon.com/step-functions/' },
        { name: 'Azure Durable Functions', note: 'Orchestrator functions for multi-step workflows', url: 'https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-overview' },
      ],
    },
  ],
  idempotency: [
    {
      label: 'API conventions',
      items: [
        { name: 'Stripe Idempotency-Key', note: 'Reference design: replay the stored response on retry', url: 'https://docs.stripe.com/api/idempotent_requests' },
        { name: 'IETF Idempotency-Key header draft', note: 'Standardises the header semantics for HTTP APIs', url: 'https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/' },
      ],
    },
    {
      label: 'Libraries',
      items: [
        { name: 'Powertools for AWS Lambda idempotency', note: 'DynamoDB-backed dedup for Lambda handlers', url: 'https://docs.powertools.aws.dev/lambda/python/latest/utilities/idempotency/' },
        { name: 'Spring Integration idempotent receiver', note: 'Metadata store that drops duplicate messages', url: 'https://docs.spring.io/spring-integration/reference/handler-advice/idempotent-receiver.html' },
        { name: 'MassTransit / NServiceBus inbox', note: 'Track processed message ids per consumer', url: 'https://masstransit.io' },
      ],
    },
    {
      label: 'Storage primitives',
      items: [
        { name: 'PostgreSQL INSERT … ON CONFLICT', note: 'Unique key makes the second write a no-op', url: 'https://www.postgresql.org/docs/current/sql-insert.html' },
        { name: 'Redis SET NX', note: 'Atomically claim a key with a TTL', url: 'https://redis.io/docs/latest/commands/set/' },
        { name: 'Kafka idempotent producer', note: 'enable.idempotence removes broker-side duplicates', url: 'https://kafka.apache.org/documentation/' },
      ],
    },
  ],

  // Reliability ---------------------------------------------------------------
  'circuit-breaker': [
    {
      label: 'Java / Spring',
      items: [
        { name: 'Resilience4j', note: 'Circuit breaker, retry, time limiter and bulkhead', url: 'https://resilience4j.readme.io' },
        { name: 'Spring Cloud Circuit Breaker', note: 'Spring abstraction over Resilience4j', url: 'https://spring.io/projects/spring-cloud-circuitbreaker' },
      ],
    },
    {
      label: '.NET',
      items: [
        { name: 'Polly', note: 'Resilience pipelines: retry, timeout, circuit breaker', url: 'https://www.pollydocs.org' },
        { name: 'Microsoft.Extensions.Http.Resilience', note: 'Standard resilience handler for HttpClient', url: 'https://learn.microsoft.com/dotnet/core/resilience/http-resilience' },
      ],
    },
    {
      label: 'Node.js / Go',
      items: [
        { name: 'opossum', note: 'Node.js circuit breaker with fallbacks and events', url: 'https://nodeshift.dev/opossum/' },
        { name: 'cockatiel', note: 'TypeScript retry, timeout, breaker and bulkhead policies', url: 'https://github.com/connor4312/cockatiel' },
        { name: 'sony/gobreaker', note: 'Small, widely used Go circuit breaker', url: 'https://github.com/sony/gobreaker' },
        { name: 'failsafe-go', note: 'Composable Go resilience policies', url: 'https://failsafe-go.dev' },
      ],
    },
    {
      label: 'Platform & testing',
      items: [
        { name: 'Envoy outlier detection', note: 'Ejects failing upstream hosts at the proxy', url: 'https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/outlier' },
        { name: 'Toxiproxy', note: 'Injects latency and failures to test your breakers', url: 'https://github.com/Shopify/toxiproxy' },
        { name: 'Chaos Mesh', note: 'Kubernetes chaos experiments: network delay, pod kill', url: 'https://chaos-mesh.org' },
      ],
    },
  ],
  'queue-load-leveling': [
    {
      label: 'Managed queues',
      items: [
        { name: 'Amazon SQS', note: 'Absorbs bursts; consumers pull at their own pace', url: 'https://aws.amazon.com/sqs/' },
        { name: 'Azure Service Bus', note: 'Queues with sessions, scheduling and dead-lettering', url: 'https://azure.microsoft.com/products/service-bus' },
        { name: 'Google Cloud Pub/Sub', note: 'Managed buffer with flow-controlled subscribers', url: 'https://cloud.google.com/pubsub' },
      ],
    },
    {
      label: 'Self-hosted brokers',
      items: [
        { name: 'RabbitMQ', note: 'Prefetch limits cap work in flight per consumer', url: 'https://www.rabbitmq.com' },
        { name: 'NATS JetStream', note: 'Durable pull consumers with max-ack-pending', url: 'https://docs.nats.io/nats-concepts/jetstream' },
        { name: 'BullMQ', note: 'Redis queue with per-worker concurrency limits', url: 'https://bullmq.io' },
      ],
    },
    {
      label: 'Autoscaling consumers',
      items: [
        { name: 'KEDA', note: 'Scales consumer pods on queue length or lag', url: 'https://keda.sh' },
        { name: 'AWS Lambda event source mapping', note: 'Polls SQS with configurable max concurrency' },
      ],
    },
  ],
  backpressure: [
    {
      label: 'JVM',
      items: [
        { name: 'Project Reactor', note: 'Reactive Streams with demand-driven request(n)', url: 'https://projectreactor.io' },
        { name: 'Kotlin Flow', note: 'Suspending streams; producers wait for collectors', url: 'https://kotlinlang.org/docs/flow.html' },
        { name: 'Apache Pekko Streams', note: 'Bounded, back-pressured stream graphs', url: 'https://pekko.apache.org' },
      ],
    },
    {
      label: 'Node.js / .NET / Go',
      items: [
        { name: 'Node.js streams', note: 'highWaterMark and pipeline() pause fast producers', url: 'https://nodejs.org/api/stream.html' },
        { name: 'System.Threading.Channels', note: 'Bounded channels block or drop when full', url: 'https://learn.microsoft.com/dotnet/core/extensions/channels' },
        { name: 'errgroup.SetLimit', note: 'Caps concurrent goroutines in Go', url: 'https://pkg.go.dev/golang.org/x/sync/errgroup' },
      ],
    },
    {
      label: 'Protocols & brokers',
      items: [
        { name: 'gRPC flow control', note: 'HTTP/2 windows slow down streaming senders', url: 'https://grpc.io' },
        { name: 'Kafka consumer pause/resume', note: 'Stop fetching partitions while downstream catches up', url: 'https://kafka.apache.org/documentation/' },
        { name: 'RabbitMQ prefetch', note: 'Limits unacked deliveries per consumer', url: 'https://www.rabbitmq.com/docs/consumer-prefetch' },
      ],
    },
  ],

  // Performance & scale ------------------------------------------------------
  caching: [
    {
      label: 'Distributed caches',
      items: [
        { name: 'Redis', note: 'In-memory key-value with TTLs and eviction policies', url: 'https://redis.io' },
        { name: 'Valkey', note: 'Open-source Linux Foundation fork of Redis', url: 'https://valkey.io' },
        { name: 'Memcached', note: 'Simple, fast multi-threaded cache', url: 'https://memcached.org' },
      ],
    },
    {
      label: 'In-process & framework',
      items: [
        { name: 'Caffeine', note: 'High-performance JVM cache with W-TinyLFU eviction', url: 'https://github.com/ben-manes/caffeine' },
        { name: 'Spring Cache abstraction', note: '@Cacheable over Caffeine, Redis and others', url: 'https://docs.spring.io/spring-framework/reference/integration/cache.html' },
        { name: 'HybridCache / FusionCache', note: '.NET L1+L2 caching with stampede protection', url: 'https://github.com/ZiggyCreatures/FusionCache' },
        { name: 'lru-cache', note: 'Widely used bounded in-memory cache for Node', url: 'https://github.com/isaacs/node-lru-cache' },
      ],
    },
    {
      label: 'HTTP caching',
      items: [
        { name: 'Varnish Cache', note: 'Reverse-proxy HTTP cache in front of your app', url: 'https://varnish-cache.org' },
        { name: 'Cache-Control headers', note: 'max-age, stale-while-revalidate and friends', url: 'https://developer.mozilla.org/docs/Web/HTTP/Headers/Cache-Control' },
        { name: 'Amazon ElastiCache', note: 'Managed Redis/Valkey/Memcached clusters', url: 'https://aws.amazon.com/elasticache/' },
      ],
    },
  ],
  cdn: [
    {
      label: 'CDNs',
      items: [
        { name: 'Cloudflare', note: 'Global CDN, WAF and edge rules', url: 'https://www.cloudflare.com' },
        { name: 'Amazon CloudFront', note: 'CDN with origin access control for S3', url: 'https://aws.amazon.com/cloudfront/' },
        { name: 'Fastly', note: 'Programmable CDN with instant purge', url: 'https://www.fastly.com' },
      ],
    },
    {
      label: 'Object storage',
      items: [
        { name: 'Amazon S3', note: 'Durable object storage with presigned uploads', url: 'https://aws.amazon.com/s3/' },
        { name: 'Cloudflare R2', note: 'S3-compatible storage without egress fees', url: 'https://developers.cloudflare.com/r2/' },
        { name: 'MinIO', note: 'Self-hosted S3-compatible object store', url: 'https://min.io' },
      ],
    },
    {
      label: 'Media processing',
      items: [
        { name: 'imgproxy', note: 'On-the-fly image resizing behind the CDN', url: 'https://imgproxy.net' },
        { name: 'Thumbor', note: 'Open-source smart cropping and resizing service', url: 'https://www.thumbor.org' },
        { name: 'Cloudinary', note: 'Managed image/video transformation and delivery', url: 'https://cloudinary.com' },
      ],
    },
  ],
  'fan-out': [
    {
      label: 'Messaging fan-out',
      items: [
        { name: 'Amazon SNS + SQS', note: 'One topic, many subscriber queues', url: 'https://aws.amazon.com/sns/' },
        { name: 'RabbitMQ fanout exchange', note: 'Copies each message to every bound queue', url: 'https://www.rabbitmq.com' },
        { name: 'Kafka consumer groups', note: 'Each group independently reads the full stream', url: 'https://kafka.apache.org' },
      ],
    },
    {
      label: 'Timeline storage',
      items: [
        { name: 'Redis sorted sets', note: 'Precomputed per-user timelines trimmed to N entries', url: 'https://redis.io/docs/latest/develop/data-types/sorted-sets/' },
        { name: 'ScyllaDB / Cassandra', note: 'Wide rows per user for write-heavy feeds', url: 'https://www.scylladb.com' },
        { name: 'Stream (GetStream)', note: 'Managed activity feeds API', url: 'https://getstream.io' },
      ],
    },
    {
      label: 'Notifications',
      items: [
        { name: 'Firebase Cloud Messaging', note: 'Push notifications to Android, iOS and web', url: 'https://firebase.google.com/docs/cloud-messaging' },
        { name: 'Novu', note: 'Open-source notification infrastructure across channels', url: 'https://novu.co' },
      ],
    },
  ],
  'rate-limiting': [
    {
      label: 'Application libraries',
      items: [
        { name: 'Bucket4j', note: 'Token-bucket limiter for Java, Redis/Hazelcast backends', url: 'https://bucket4j.com' },
        { name: 'ASP.NET Core rate limiting', note: 'Built-in fixed, sliding, token and concurrency limiters', url: 'https://learn.microsoft.com/aspnet/core/performance/rate-limit' },
        { name: 'rate-limiter-flexible', note: 'Node limiter backed by Redis, Postgres or memory', url: 'https://github.com/animir/node-rate-limiter-flexible' },
        { name: 'golang.org/x/time/rate', note: 'Standard Go token-bucket limiter', url: 'https://pkg.go.dev/golang.org/x/time/rate' },
      ],
    },
    {
      label: 'Gateway & proxy',
      items: [
        { name: 'Envoy global rate limit service', note: 'Central, Redis-backed limits for every proxy', url: 'https://github.com/envoyproxy/ratelimit' },
        { name: 'NGINX limit_req', note: 'Leaky-bucket limiting per key at the edge', url: 'https://nginx.org/en/docs/http/ngx_http_limit_req_module.html' },
        { name: 'Kong Rate Limiting plugin', note: 'Per consumer/route limits without app changes', url: 'https://konghq.com' },
      ],
    },
    {
      label: 'Managed & serverless',
      items: [
        { name: 'Cloudflare rate limiting rules', note: 'Blocks abusive clients before they reach origin', url: 'https://developers.cloudflare.com/waf/rate-limiting-rules/' },
        { name: 'Upstash Ratelimit', note: 'HTTP-based Redis limiter for edge/serverless', url: 'https://github.com/upstash/ratelimit-js' },
      ],
    },
  ],

  // Observability ------------------------------------------------------------
  observability: [
    {
      label: 'Instrumentation',
      items: [
        { name: 'OpenTelemetry SDKs', note: 'One API for traces, metrics and logs', url: 'https://opentelemetry.io' },
        { name: 'Micrometer', note: 'JVM metrics facade used by Spring Boot Actuator', url: 'https://micrometer.io' },
        { name: 'pino / Serilog / slog', note: 'Structured JSON logging for Node, .NET, Go', url: 'https://getpino.io' },
      ],
    },
    {
      label: 'Open-source backends',
      items: [
        { name: 'Prometheus', note: 'Pull-based metrics and PromQL alerting', url: 'https://prometheus.io' },
        { name: 'Grafana', note: 'Dashboards across metrics, logs and traces', url: 'https://grafana.com' },
        { name: 'Grafana Loki', note: 'Label-indexed log aggregation', url: 'https://grafana.com/oss/loki/' },
        { name: 'Grafana Tempo', note: 'Cheap, object-storage-backed trace storage', url: 'https://grafana.com/oss/tempo/' },
      ],
    },
    {
      label: 'Managed platforms',
      items: [
        { name: 'Datadog', note: 'APM, logs, metrics and RUM in one SaaS', url: 'https://www.datadoghq.com' },
        { name: 'Honeycomb', note: 'High-cardinality event querying for debugging', url: 'https://www.honeycomb.io' },
        { name: 'Grafana Cloud', note: 'Hosted Prometheus, Loki and Tempo', url: 'https://grafana.com' },
      ],
    },
  ],
  'distributed-tracing': [
    {
      label: 'Standards & instrumentation',
      items: [
        { name: 'W3C Trace Context', note: 'traceparent header that carries ids across hops', url: 'https://www.w3.org/TR/trace-context/' },
        { name: 'OpenTelemetry Java agent', note: 'Zero-code tracing for common JVM libraries', url: 'https://opentelemetry.io/docs/zero-code/java/agent/' },
        { name: 'Micrometer Tracing', note: 'Spring Boot 3 tracing bridge to OpenTelemetry', url: 'https://docs.micrometer.io/tracing/reference/' },
        { name: '@opentelemetry/auto-instrumentations-node', note: 'Auto-traces HTTP, gRPC, DB clients in Node', url: 'https://opentelemetry.io/docs/languages/js/' },
      ],
    },
    {
      label: 'Trace backends',
      items: [
        { name: 'Jaeger', note: 'CNCF tracing backend with service dependency graph', url: 'https://www.jaegertracing.io' },
        { name: 'Grafana Tempo', note: 'Trace store linked to logs and metrics', url: 'https://grafana.com/oss/tempo/' },
        { name: 'Zipkin', note: 'Long-standing, simple tracing system', url: 'https://zipkin.io' },
      ],
    },
    {
      label: 'Managed cloud services',
      items: [
        { name: 'AWS X-Ray', note: 'Tracing for AWS services and Lambda', url: 'https://aws.amazon.com/xray/' },
        { name: 'Honeycomb', note: 'Trace-first debugging with BubbleUp outlier analysis', url: 'https://www.honeycomb.io' },
      ],
    },
  ],
  opentelemetry: [
    {
      label: 'SDKs & agents',
      items: [
        { name: 'OpenTelemetry language SDKs', note: 'Java, .NET, Go, Python, JS and more', url: 'https://opentelemetry.io/docs/languages/' },
        { name: 'Zero-code instrumentation', note: 'Agents that instrument apps without code changes', url: 'https://opentelemetry.io/docs/zero-code/' },
        { name: 'Semantic conventions', note: 'Standard attribute names for HTTP, DB, messaging', url: 'https://opentelemetry.io/docs/specs/semconv/' },
      ],
    },
    {
      label: 'Pipeline',
      items: [
        { name: 'OpenTelemetry Collector', note: 'Receives OTLP, samples, enriches and exports', url: 'https://opentelemetry.io/docs/collector/' },
        { name: 'OpenTelemetry Operator', note: 'Kubernetes auto-injection and Collector management', url: 'https://github.com/open-telemetry/opentelemetry-operator' },
        { name: 'Grafana Alloy', note: 'OTel-compatible collector distribution from Grafana', url: 'https://grafana.com/docs/alloy/latest/' },
      ],
    },
    {
      label: 'OTLP-native backends',
      items: [
        { name: 'grafana/otel-lgtm', note: 'One Docker image with Collector, Loki, Tempo, Prometheus', url: 'https://github.com/grafana/docker-otel-lgtm' },
        { name: 'SigNoz', note: 'Open-source APM built on OpenTelemetry', url: 'https://signoz.io' },
        { name: 'Jaeger', note: 'Accepts OTLP traces directly', url: 'https://www.jaegertracing.io' },
      ],
    },
  ],
  slo: [
    {
      label: 'SLO tooling',
      items: [
        { name: 'Sloth', note: 'Generates multi-window burn-rate Prometheus rules', url: 'https://sloth.dev' },
        { name: 'Pyrra', note: 'SLO definitions as Kubernetes CRDs with a UI', url: 'https://github.com/pyrra-dev/pyrra' },
        { name: 'OpenSLO', note: 'Vendor-neutral YAML spec for SLOs', url: 'https://openslo.com' },
      ],
    },
    {
      label: 'Alerting',
      items: [
        { name: 'Prometheus Alertmanager', note: 'Routes, groups and silences burn-rate alerts', url: 'https://prometheus.io/docs/alerting/latest/alertmanager/' },
        { name: 'Google SRE Workbook', note: 'Reference method for SLOs and error budgets', url: 'https://sre.google/workbook/implementing-slos/' },
      ],
    },
    {
      label: 'Managed & verification',
      items: [
        { name: 'Nobl9', note: 'SLO platform across many telemetry sources', url: 'https://www.nobl9.com' },
        { name: 'Datadog SLOs', note: 'Metric/monitor-based SLOs with error-budget tracking', url: 'https://www.datadoghq.com' },
        { name: 'Grafana k6', note: 'Load tests with thresholds matching your SLOs', url: 'https://k6.io' },
      ],
    },
  ],

  // Security -------------------------------------------------------------------
  'oauth-oidc': [
    {
      label: 'Identity providers',
      items: [
        { name: 'Keycloak', note: 'Open-source IdP: OIDC, SAML, social login, MFA', url: 'https://www.keycloak.org' },
        { name: 'ZITADEL', note: 'Open-source, multi-tenant identity platform', url: 'https://zitadel.com' },
        { name: 'Auth0 / Okta', note: 'Managed identity with hosted login', url: 'https://auth0.com' },
        { name: 'Microsoft Entra ID', note: 'Enterprise IdP for workforce and B2B apps' },
      ],
    },
    {
      label: 'Java / .NET',
      items: [
        { name: 'Spring Security OAuth2', note: 'Login client and JWT resource server support', url: 'https://docs.spring.io/spring-security/reference/servlet/oauth2/index.html' },
        { name: 'Spring Authorization Server', note: 'Build your own OAuth 2.1 / OIDC provider', url: 'https://spring.io/projects/spring-authorization-server' },
        { name: 'OpenIddict', note: 'OpenID Connect server and client for ASP.NET Core', url: 'https://openiddict.com' },
        { name: 'Duende IdentityServer', note: 'Commercial OIDC/OAuth framework for .NET', url: 'https://duendesoftware.com' },
      ],
    },
    {
      label: 'Node.js / Go',
      items: [
        { name: 'openid-client', note: 'Certified OIDC relying-party library for Node', url: 'https://github.com/panva/openid-client' },
        { name: 'jose', note: 'JWT/JWS/JWE verification for JS runtimes', url: 'https://github.com/panva/jose' },
        { name: 'Auth.js', note: 'Session-based auth for Next.js and friends', url: 'https://authjs.dev' },
        { name: 'coreos/go-oidc', note: 'OIDC token verification for Go', url: 'https://github.com/coreos/go-oidc' },
      ],
    },
  ],
  'secrets-management': [
    {
      label: 'Secret stores',
      items: [
        { name: 'HashiCorp Vault', note: 'Dynamic secrets, leasing and encryption as a service', url: 'https://www.vaultproject.io' },
        { name: 'OpenBao', note: 'Open-source, community fork of Vault', url: 'https://openbao.org' },
        { name: 'Infisical', note: 'Open-source secrets platform with SDKs and CLI', url: 'https://infisical.com' },
      ],
    },
    {
      label: 'Managed cloud services',
      items: [
        { name: 'AWS Secrets Manager', note: 'Stores and auto-rotates credentials', url: 'https://aws.amazon.com/secrets-manager/' },
        { name: 'Azure Key Vault', note: 'Secrets, keys and certificates with RBAC', url: 'https://azure.microsoft.com/products/key-vault' },
        { name: 'Google Secret Manager', note: 'Versioned secrets with IAM access', url: 'https://cloud.google.com/secret-manager' },
      ],
    },
    {
      label: 'Kubernetes & delivery',
      items: [
        { name: 'External Secrets Operator', note: 'Syncs cloud/Vault secrets into Kubernetes Secrets', url: 'https://external-secrets.io' },
        { name: 'SOPS', note: 'Encrypted secret files you can commit to Git', url: 'https://getsops.io' },
        { name: 'Spring Cloud Vault', note: 'Injects Vault secrets into Spring configuration', url: 'https://spring.io/projects/spring-cloud-vault' },
      ],
    },
    {
      label: 'Leak prevention',
      items: [
        { name: 'gitleaks', note: 'Scans commits and history for secrets', url: 'https://github.com/gitleaks/gitleaks' },
        { name: 'TruffleHog', note: 'Finds and verifies leaked credentials', url: 'https://github.com/trufflesecurity/trufflehog' },
      ],
    },
  ],

  // Later additions ------------------------------------------------------------
  'anti-corruption-layer': [
    {
      label: 'Translating models',
      items: [
        { name: 'MapStruct', note: 'Compile-time Java mappers between foreign and domain types', url: 'https://mapstruct.org' },
        { name: 'Mapperly', note: 'Source-generated .NET object mapping', url: 'https://mapperly.riok.app' },
        { name: 'Zod', note: 'Parses untrusted external payloads into typed models', url: 'https://zod.dev' },
        { name: 'Pydantic', note: 'Validates and converts external data in Python', url: 'https://docs.pydantic.dev' },
      ],
    },
    {
      label: 'Typed clients for the other side',
      items: [
        { name: 'OpenAPI Generator', note: 'Generates clients kept behind your adapter', url: 'https://openapi-generator.tech' },
        { name: 'openapi-typescript', note: 'TypeScript types straight from an OpenAPI spec', url: 'https://openapi-ts.dev' },
        { name: 'Apache Camel', note: 'Integration routes that transform legacy protocols', url: 'https://camel.apache.org' },
      ],
    },
    {
      label: 'Testing & verification',
      items: [
        { name: 'WireMock', note: 'Stubs the external system to test the translation', url: 'https://wiremock.org' },
        { name: 'Pact', note: 'Contract tests pin the upstream’s actual behaviour', url: 'https://pact.io' },
        { name: 'ArchUnit', note: 'Fails if legacy types leak beyond the ACL package', url: 'https://www.archunit.org' },
      ],
    },
  ],
  'multi-tenancy': [
    {
      label: 'Data isolation',
      items: [
        { name: 'PostgreSQL Row-Level Security', note: 'Pool model: policies filter rows by tenant', url: 'https://www.postgresql.org/docs/current/ddl-rowsecurity.html' },
        { name: 'Citus', note: 'Distributes Postgres tables by tenant id', url: 'https://www.citusdata.com' },
        { name: 'EF Core global query filters', note: 'Automatic tenant WHERE clause on every query', url: 'https://learn.microsoft.com/ef/core/querying/filters' },
      ],
    },
    {
      label: 'Frameworks',
      items: [
        { name: 'Finbuckle.MultiTenant', note: 'Tenant resolution and per-tenant options for ASP.NET Core', url: 'https://www.finbuckle.com/multitenant' },
        { name: 'django-tenants', note: 'Schema-per-tenant for Django on Postgres', url: 'https://github.com/django-tenants/django-tenants' },
        { name: 'Hibernate multitenancy', note: 'Database, schema or discriminator strategies for JPA', url: 'https://hibernate.org/orm/' },
      ],
    },
    {
      label: 'Identity & infrastructure',
      items: [
        { name: 'Auth0 Organizations', note: 'Tenant-aware login, membership and roles', url: 'https://auth0.com/docs/manage-users/organizations' },
        { name: 'OpenFGA', note: 'Relationship-based authorization scoped per tenant', url: 'https://openfga.dev' },
        { name: 'vCluster', note: 'Virtual Kubernetes clusters for silo tenants', url: 'https://www.vcluster.com' },
      ],
    },
  ],
  'service-granularity': [
    {
      label: 'Finding boundaries',
      items: [
        { name: 'EventStorming', note: 'Surfaces natural seams in the domain', url: 'https://www.eventstorming.com' },
        { name: 'Context Mapper', note: 'Models contexts and suggests service cuts', url: 'https://contextmapper.org' },
        { name: 'CodeScene', note: 'Change-coupling analysis shows what changes together', url: 'https://codescene.com' },
      ],
    },
    {
      label: 'Measuring coupling in code',
      items: [
        { name: 'ArchUnit', note: 'Codifies allowed dependencies between candidate services', url: 'https://www.archunit.org' },
        { name: 'jQAssistant', note: 'Graph queries over code structure in Neo4j', url: 'https://jqassistant.org' },
        { name: 'dependency-cruiser', note: 'Visualises and limits JS/TS module coupling', url: 'https://github.com/sverweij/dependency-cruiser' },
      ],
    },
    {
      label: 'Keeping options open',
      items: [
        { name: 'Spring Modulith', note: 'Start as modules, extract once boundaries are proven', url: 'https://spring.io/projects/spring-modulith' },
        { name: 'Backstage', note: 'Catalog showing ownership and dependencies per service', url: 'https://backstage.io' },
      ],
    },
  ],
  'cell-based-architecture': [
    {
      label: 'Reference guidance',
      items: [
        { name: 'AWS cell-based architecture whitepaper', note: 'Cell sizing, routing and deployment practices', url: 'https://docs.aws.amazon.com/wellarchitected/latest/reducing-scope-of-impact-with-cell-based-architecture/' },
        { name: 'Amazon Route 53 ARC', note: 'Routing controls to shift traffic away from cells', url: 'https://aws.amazon.com/application-recovery-controller/' },
      ],
    },
    {
      label: 'Cell router',
      items: [
        { name: 'Envoy', note: 'Routes requests to a cell by tenant or key', url: 'https://www.envoyproxy.io' },
        { name: 'Cloudflare Workers', note: 'Edge lookup of tenant-to-cell mapping', url: 'https://workers.cloudflare.com' },
      ],
    },
    {
      label: 'Stamping out cells',
      items: [
        { name: 'Terraform / OpenTofu', note: 'One module instantiated per cell', url: 'https://opentofu.org' },
        { name: 'Crossplane', note: 'Cells as Kubernetes custom resources', url: 'https://www.crossplane.io' },
        { name: 'Argo CD', note: 'GitOps rollout to cells in waves', url: 'https://argo-cd.readthedocs.io' },
        { name: 'Argo Rollouts', note: 'Canary analysis before promoting to the next cell', url: 'https://argoproj.github.io/rollouts/' },
      ],
    },
  ],
  'dead-letter-queue': [
    {
      label: 'Broker features',
      items: [
        { name: 'Amazon SQS DLQ + redrive', note: 'maxReceiveCount moves poison messages; redrive replays', url: 'https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html' },
        { name: 'RabbitMQ dead letter exchanges', note: 'Rejected/expired messages routed to a DLX', url: 'https://www.rabbitmq.com/docs/dlx' },
        { name: 'Azure Service Bus dead-lettering', note: 'Built-in DLQ sub-queue per entity', url: 'https://learn.microsoft.com/azure/service-bus-messaging/service-bus-dead-letter-queues' },
      ],
    },
    {
      label: 'Framework retry policies',
      items: [
        { name: 'Spring Kafka retry topics', note: 'Non-blocking backoff topics ending in a DLT', url: 'https://docs.spring.io/spring-kafka/reference/retrytopic.html' },
        { name: 'NServiceBus recoverability', note: 'Immediate + delayed retries, then error queue', url: 'https://docs.particular.net/nservicebus/recoverability/' },
        { name: 'MassTransit retry & redelivery', note: 'Exponential retry then _error queue', url: 'https://masstransit.io' },
        { name: 'BullMQ', note: 'Attempts with exponential backoff; failed set kept', url: 'https://bullmq.io' },
      ],
    },
    {
      label: 'Inspection & replay',
      items: [
        { name: 'ServicePulse', note: 'Inspect and retry failed NServiceBus messages', url: 'https://particular.net/servicepulse' },
        { name: 'Kafbat UI', note: 'Browse, inspect and re-produce Kafka DLT records', url: 'https://github.com/kafbat/kafka-ui' },
        { name: 'AKHQ', note: 'Kafka GUI for topics, consumer groups and messages', url: 'https://akhq.io' },
      ],
    },
  ],
  'load-shedding': [
    {
      label: 'Proxy & platform',
      items: [
        { name: 'Envoy overload manager', note: 'Sheds load when memory or connections run high', url: 'https://www.envoyproxy.io/docs/envoy/latest/configuration/operations/overload_manager/overload_manager' },
        { name: 'Envoy adaptive concurrency', note: 'Latency-driven concurrency limit per upstream', url: 'https://www.envoyproxy.io' },
        { name: 'Kubernetes priority classes', note: 'Critical pods survive when nodes are pressured', url: 'https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/' },
      ],
    },
    {
      label: 'Application libraries',
      items: [
        { name: 'Netflix concurrency-limits', note: 'Adaptive limits that reject before latency explodes', url: 'https://github.com/Netflix/concurrency-limits' },
        { name: 'Resilience4j Bulkhead', note: 'Caps concurrent calls per dependency', url: 'https://resilience4j.readme.io' },
        { name: '@fastify/under-pressure', note: 'Returns 503 when event-loop lag or heap is high', url: 'https://github.com/fastify/under-pressure' },
        { name: 'ConcurrencyLimiter (.NET)', note: 'Queue-or-reject limiter in System.Threading.RateLimiting', url: 'https://learn.microsoft.com/aspnet/core/performance/rate-limit' },
      ],
    },
    {
      label: 'Managed cloud services',
      items: [
        { name: 'Cloudflare Waiting Room', note: 'Queues excess visitors in front of your origin', url: 'https://www.cloudflare.com/waiting-room/' },
        { name: 'Queue-it', note: 'Virtual waiting room for flash-sale traffic', url: 'https://queue-it.com' },
      ],
    },
  ],
  'stream-processing': [
    {
      label: 'Engines',
      items: [
        { name: 'Apache Flink', note: 'Event-time windows, watermarks, exactly-once state', url: 'https://flink.apache.org' },
        { name: 'Kafka Streams', note: 'Library for stateful processing inside your app', url: 'https://kafka.apache.org/documentation/streams/' },
        { name: 'Spark Structured Streaming', note: 'Micro-batch and continuous streaming on Spark', url: 'https://spark.apache.org/streaming/' },
        { name: 'Apache Beam', note: 'Unified batch/stream model, portable runners', url: 'https://beam.apache.org' },
      ],
    },
    {
      label: 'Streaming SQL & Python',
      items: [
        { name: 'RisingWave', note: 'Postgres-compatible streaming database', url: 'https://risingwave.com' },
        { name: 'Materialize', note: 'Incrementally maintained SQL views over streams', url: 'https://materialize.com' },
        { name: 'Quix Streams', note: 'Python stream processing on Kafka', url: 'https://github.com/quixio/quix-streams' },
      ],
    },
    {
      label: 'Managed cloud services',
      items: [
        { name: 'Amazon Managed Service for Apache Flink', note: 'Serverless Flink applications', url: 'https://aws.amazon.com/managed-service-apache-flink/' },
        { name: 'Google Cloud Dataflow', note: 'Managed Apache Beam runner with autoscaling', url: 'https://cloud.google.com/dataflow' },
      ],
    },
  ],
  'double-entry-ledger': [
    {
      label: 'Ledger databases',
      items: [
        { name: 'TigerBeetle', note: 'Purpose-built double-entry accounting database', url: 'https://tigerbeetle.com' },
        { name: 'Formance Ledger', note: 'Open-source programmable ledger for money movement', url: 'https://www.formance.com' },
        { name: 'Modern Treasury Ledgers', note: 'Managed ledger API with balance locking', url: 'https://www.moderntreasury.com' },
      ],
    },
    {
      label: 'Money types',
      items: [
        { name: 'JavaMoney Moneta', note: 'JSR 354 reference implementation of MonetaryAmount', url: 'https://github.com/JavaMoney/jsr354-ri' },
        { name: 'decimal.js', note: 'Arbitrary-precision decimals; avoid float rounding in JS', url: 'https://github.com/MikeMcl/decimal.js' },
        { name: 'Python decimal', note: 'Exact decimal arithmetic in the standard library', url: 'https://docs.python.org/3/library/decimal.html' },
      ],
    },
    {
      label: 'Learn the model',
      items: [
        { name: 'Beancount', note: 'Plain-text double-entry bookkeeping with balance checks', url: 'https://beancount.github.io' },
        { name: 'Ledger CLI', note: 'Command-line double-entry accounting', url: 'https://ledger-cli.org' },
      ],
    },
  ],
  'concurrency-control': [
    {
      label: 'Optimistic locking',
      items: [
        { name: 'JPA @Version (Hibernate)', note: 'Version column rejects lost updates', url: 'https://hibernate.org/orm/' },
        { name: 'EF Core concurrency tokens', note: 'RowVersion check raises DbUpdateConcurrencyException', url: 'https://learn.microsoft.com/ef/core/saving/concurrency' },
        { name: 'HTTP ETag + If-Match', note: 'Conditional updates at the API boundary', url: 'https://developer.mozilla.org/docs/Web/HTTP/Headers/If-Match' },
      ],
    },
    {
      label: 'Database primitives',
      items: [
        { name: 'PostgreSQL row locks', note: 'SELECT … FOR UPDATE, SKIP LOCKED, advisory locks', url: 'https://www.postgresql.org/docs/current/explicit-locking.html' },
        { name: 'Exclusion constraints', note: 'Postgres forbids overlapping bookings at the DB level', url: 'https://www.postgresql.org/docs/current/ddl-constraints.html' },
        { name: 'DynamoDB conditional writes', note: 'Write only if the expected attribute value holds' },
      ],
    },
    {
      label: 'Distributed locks & testing',
      items: [
        { name: 'ShedLock', note: 'Ensures a scheduled task runs on one node', url: 'https://github.com/lukas-krecan/ShedLock' },
        { name: 'etcd', note: 'Leases and compare-and-swap for coordination', url: 'https://etcd.io' },
        { name: 'Lincheck', note: 'JVM tool that checks concurrent code for linearizability', url: 'https://github.com/JetBrains/lincheck' },
      ],
    },
  ],
  sharding: [
    {
      label: 'Sharded SQL',
      items: [
        { name: 'Vitess', note: 'Horizontal sharding middleware for MySQL', url: 'https://vitess.io' },
        { name: 'Citus', note: 'Distributed tables on PostgreSQL by shard key', url: 'https://www.citusdata.com' },
        { name: 'Apache ShardingSphere', note: 'JDBC/proxy layer that routes queries to shards', url: 'https://shardingsphere.apache.org' },
      ],
    },
    {
      label: 'Auto-partitioning stores',
      items: [
        { name: 'CockroachDB', note: 'Automatic range splitting and rebalancing', url: 'https://www.cockroachlabs.com' },
        { name: 'MongoDB sharding', note: 'Hashed or ranged shard keys with balancer', url: 'https://www.mongodb.com/docs/manual/sharding/' },
        { name: 'Amazon DynamoDB', note: 'Partition key design decides hot-key risk', url: 'https://aws.amazon.com/dynamodb/' },
      ],
    },
    {
      label: 'Streams & hot keys',
      items: [
        { name: 'Kafka partitions', note: 'Key-based partitioning; key choice drives skew', url: 'https://kafka.apache.org' },
        { name: 'Redis Cluster', note: 'Hash slots spread keys across nodes', url: 'https://redis.io/docs/latest/operate/oss_and_stack/management/scaling/' },
      ],
    },
  ],
  'single-writer': [
    {
      label: 'Actor / entity ownership',
      items: [
        { name: 'Microsoft Orleans', note: 'Virtual actors: one activation owns each grain', url: 'https://learn.microsoft.com/dotnet/orleans/' },
        { name: 'Apache Pekko Cluster Sharding', note: 'One live entity per id across the cluster', url: 'https://pekko.apache.org' },
        { name: 'Cloudflare Durable Objects', note: 'Single-threaded object per id with storage', url: 'https://developers.cloudflare.com/durable-objects/' },
        { name: 'Dapr actors', note: 'Turn-based concurrency per actor id', url: 'https://docs.dapr.io/developing-applications/building-blocks/actors/' },
      ],
    },
    {
      label: 'In-memory processing',
      items: [
        { name: 'LMAX Disruptor', note: 'Lock-free ring buffer behind single-threaded business logic', url: 'https://lmax-exchange.github.io/disruptor/' },
        { name: 'Kafka partition per key', note: 'One consumer thread owns each key’s ordering', url: 'https://kafka.apache.org' },
      ],
    },
    {
      label: 'Leader election',
      items: [
        { name: 'Kubernetes Leases', note: 'Lease objects elect a single active replica', url: 'https://kubernetes.io/docs/concepts/architecture/leases/' },
        { name: 'Apache Curator', note: 'ZooKeeper recipes: LeaderLatch, LeaderSelector', url: 'https://curator.apache.org' },
        { name: 'etcd election', note: 'Lease-backed leader election with fencing revisions', url: 'https://etcd.io' },
      ],
    },
  ],
  'iot-messaging': [
    {
      label: 'MQTT brokers',
      items: [
        { name: 'Eclipse Mosquitto', note: 'Lightweight open-source MQTT broker', url: 'https://mosquitto.org' },
        { name: 'EMQX', note: 'Clustered MQTT broker with rule engine and bridges', url: 'https://www.emqx.com' },
        { name: 'HiveMQ', note: 'Enterprise MQTT broker with Kafka extension', url: 'https://www.hivemq.com' },
      ],
    },
    {
      label: 'Client libraries',
      items: [
        { name: 'Eclipse Paho', note: 'MQTT clients for C, Java, Python, Go and more', url: 'https://eclipse.dev/paho/' },
        { name: 'MQTT.js', note: 'MQTT client for Node.js and browsers', url: 'https://github.com/mqttjs/MQTT.js' },
        { name: 'MQTTnet', note: 'High-performance MQTT client and server for .NET' },
      ],
    },
    {
      label: 'Managed cloud & telemetry storage',
      items: [
        { name: 'AWS IoT Core', note: 'Managed MQTT, device shadows and rules', url: 'https://aws.amazon.com/iot-core/' },
        { name: 'Azure IoT Hub', note: 'Device identity, telemetry and cloud-to-device commands', url: 'https://azure.microsoft.com/products/iot-hub' },
        { name: 'InfluxDB', note: 'Time-series database for sensor readings', url: 'https://www.influxdata.com' },
        { name: 'Sparkplug', note: 'Eclipse spec for MQTT topic and payload structure', url: 'https://sparkplug.eclipse.org' },
      ],
    },
  ],
  // Mark Richards — Software Architecture Monday coverage --------------------
  'architecture-characteristics': [
    {
      label: 'Catalogues & models',
      items: [
        { name: 'ISO/IEC 25010', note: 'Standard product-quality model of quality characteristics', url: 'https://iso25000.com/index.php/en/iso-25000-standards/iso-25010' },
        { name: 'arc42 Quality Model', note: 'Searchable catalogue of quality attributes with example requirements', url: 'https://quality.arc42.org' },
      ],
    },
    {
      label: 'Further reading',
      items: [
        { name: 'Software Architecture Monday — Lesson 187', note: 'Mark Richards on categorizing architectural characteristics', url: 'https://www.developertoarchitect.com/lessons/lesson187.html' },
        { name: 'Software Architecture Monday — Lesson 188', note: 'Identifying the characteristics that drive a design', url: 'https://www.developertoarchitect.com/lessons/lesson188.html' },
        { name: 'Software Architecture Monday — Lesson 85', note: 'Why scalability and elasticity are different', url: 'https://www.developertoarchitect.com/lessons/lesson85.html' },
        { name: 'Fundamentals of Software Architecture (2nd ed.)', note: 'Richards & Ford book with chapters on identifying and measuring characteristics', url: 'https://www.oreilly.com/library/view/fundamentals-of-software/9781098175504/' },
      ],
    },
  ],
  'architectural-quantum': [
    {
      label: 'Decoupling quanta',
      items: [
        { name: 'Apache Kafka', note: 'Event log that replaces synchronous calls between quanta', url: 'https://kafka.apache.org' },
        { name: 'RabbitMQ', note: 'Queues that let each side scale and fail independently', url: 'https://www.rabbitmq.com' },
        { name: 'Debezium', note: 'CDC feeds a local copy of another quantum’s data', url: 'https://debezium.io' },
      ],
    },
    {
      label: 'Further reading',
      items: [
        { name: 'Software Architecture Monday — Lesson 189', note: 'Mark Richards on architectural quantum trade-offs', url: 'https://www.developertoarchitect.com/lessons/lesson189.html' },
        { name: 'Software Architecture Monday — Lesson 211', note: 'Architectural modularity and when to break a system apart', url: 'https://www.developertoarchitect.com/lessons/lesson211.html' },
        { name: 'Software Architecture: The Hard Parts', note: 'Ford, Richards, Sadalage & Dehghani on quanta, static and dynamic coupling', url: 'https://www.oreilly.com/library/view/software-architecture-the/9781492086888/' },
        { name: 'Building Evolutionary Architectures', note: 'Where the architectural quantum idea was introduced', url: 'https://evolutionaryarchitecture.com' },
      ],
    },
  ],
  'domain-vs-technical-partitioning': [
    {
      label: 'Enforcing the partitioning',
      items: [
        { name: 'Spring Modulith', note: 'Domain modules as top-level packages, verified in tests', url: 'https://spring.io/projects/spring-modulith' },
        { name: 'ArchUnit', note: 'Rules that keep domain slices from depending on each other', url: 'https://www.archunit.org' },
        { name: 'Nx module boundaries', note: 'Tag libraries by domain and lint forbidden imports', url: 'https://nx.dev/features/enforce-module-boundaries' },
      ],
    },
    {
      label: 'Teams & domains',
      items: [
        { name: 'Conway’s Law', note: 'Martin Fowler’s explanation and the inverse Conway manoeuvre', url: 'https://martinfowler.com/bliki/ConwaysLaw.html' },
        { name: 'Team Topologies', note: 'Stream-aligned teams owning business domains end to end', url: 'https://teamtopologies.com' },
        { name: 'Software Architecture Monday — Lesson 120', note: 'Mark Richards on domain vs. technical partitioning', url: 'https://www.developertoarchitect.com/lessons/lesson120.html' },
      ],
    },
  ],
  'fitness-functions': [
    {
      label: 'Structural checks',
      items: [
        { name: 'ArchUnit', note: 'JUnit rules for layers, cycles and package dependencies', url: 'https://www.archunit.org' },
        { name: 'dependency-cruiser', note: 'Fails CI when JS/TS imports break boundary rules', url: 'https://github.com/sverweij/dependency-cruiser' },
        { name: 'jQAssistant', note: 'Scans code into a graph and checks rules with queries', url: 'https://jqassistant.org' },
        { name: 'NetArchTest', note: 'Architecture rules as .NET unit tests', url: 'https://github.com/BenMorris/NetArchTest' },
      ],
    },
    {
      label: 'Runtime & resilience checks',
      items: [
        { name: 'Grafana k6', note: 'Load tests with thresholds that fail a CI build', url: 'https://k6.io' },
        { name: 'Pact', note: 'Consumer-driven contract tests block breaking API changes', url: 'https://pact.io' },
        { name: 'Chaos Monkey', note: 'Continuously terminates instances to prove resilience', url: 'https://netflix.github.io/chaosmonkey/' },
        { name: 'Toxiproxy', note: 'Injects latency and failures between services in tests', url: 'https://github.com/Shopify/toxiproxy' },
      ],
    },
    {
      label: 'Further reading',
      items: [
        { name: 'Software Architecture Monday — Lesson 73', note: 'Mark Richards introduces architecture fitness functions', url: 'https://www.developertoarchitect.com/lessons/lesson73.html' },
        { name: 'Software Architecture Monday — Lesson 215', note: 'Fitness function-driven architecture', url: 'https://www.developertoarchitect.com/lessons/lesson215.html' },
        { name: 'Building Evolutionary Architectures', note: 'Ford, Parsons, Kua & Sadalage book that defined the term', url: 'https://evolutionaryarchitecture.com' },
      ],
    },
  ],
  'architecture-decision-records': [
    {
      label: 'Tools & templates',
      items: [
        { name: 'adr-tools', note: 'Command-line tool to create, number and supersede ADRs', url: 'https://github.com/npryce/adr-tools' },
        { name: 'Log4brains', note: 'Manages ADRs in Git and publishes them as a static site', url: 'https://github.com/thomvaill/log4brains' },
        { name: 'MADR', note: 'Markdown ADR template with options and trade-offs', url: 'https://adr.github.io/madr/' },
        { name: 'ADR examples collection', note: 'Templates and sample records by Joel Parker Henderson', url: 'https://github.com/joelparkerhenderson/architecture-decision-record' },
      ],
    },
    {
      label: 'Further reading',
      items: [
        { name: 'Documenting Architecture Decisions', note: 'Michael Nygard’s 2011 post that popularised ADRs', url: 'https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions' },
        { name: 'Software Architecture Monday — Lesson 55', note: 'Mark Richards on writing ADRs', url: 'https://www.developertoarchitect.com/lessons/lesson55.html' },
        { name: 'Software Architecture Monday — Lesson 168', note: 'ADRs and architecture stories', url: 'https://www.developertoarchitect.com/lessons/lesson168.html' },
        { name: 'adr.github.io', note: 'Community hub for ADR formats and tooling', url: 'https://adr.github.io' },
      ],
    },
  ],
  'fallacies-of-distributed-computing': [
    {
      label: 'Testing against the fallacies',
      items: [
        { name: 'Toxiproxy', note: 'Simulates latency, bandwidth limits and dropped connections', url: 'https://github.com/Shopify/toxiproxy' },
        { name: 'Chaos Toolkit', note: 'Declarative chaos experiments against real environments', url: 'https://chaostoolkit.org' },
        { name: 'Gremlin', note: 'Managed fault injection: network loss, latency, blackholes', url: 'https://www.gremlin.com' },
      ],
    },
    {
      label: 'Further reading',
      items: [
        { name: 'Fallacies of distributed computing', note: 'History of the original eight fallacies', url: 'https://en.wikipedia.org/wiki/Fallacies_of_distributed_computing' },
        { name: 'Software Architecture Monday — Lesson 18', note: 'Mark Richards walks through the fallacies', url: 'https://www.developertoarchitect.com/lessons/lesson18.html' },
        { name: 'Three new fallacies (Thoughtworks podcast)', note: 'Ford & Richards on versioning, compensating updates and observability', url: 'https://www.thoughtworks.com/insights/podcasts/technology-podcasts/three-new-fallacies-distributed-computing' },
      ],
    },
  ],
  'entity-trap': [
    {
      label: 'Discovering behaviour',
      items: [
        { name: 'EventStorming', note: 'Workshop that maps workflows as domain events, not tables', url: 'https://www.eventstorming.com' },
        { name: 'Domain Storytelling', note: 'Actors, work objects and activities drawn as stories', url: 'https://domainstorytelling.org' },
        { name: 'Context Mapper', note: 'DSL to model bounded contexts and derive service cuts', url: 'https://contextmapper.org' },
      ],
    },
    {
      label: 'Further reading',
      items: [
        { name: 'Software Architecture Monday — Lesson 191', note: 'Mark Richards on the entity trap', url: 'https://www.developertoarchitect.com/lessons/lesson191.html' },
        { name: 'Anemic Domain Model', note: 'Martin Fowler on objects that hold data but no behaviour', url: 'https://martinfowler.com/bliki/AnemicDomainModel.html' },
      ],
    },
  ],
  'code-reuse': [
    {
      label: 'Shared libraries',
      items: [
        { name: 'Semantic Versioning', note: 'Version scheme that signals breaking library changes', url: 'https://semver.org' },
        { name: 'Renovate', note: 'Automated dependency-upgrade pull requests per service', url: 'https://docs.renovatebot.com' },
        { name: 'Dependabot', note: 'GitHub’s automated dependency updates', url: 'https://docs.github.com/en/code-security/dependabot' },
      ],
    },
    {
      label: 'Sidecars & service mesh',
      items: [
        { name: 'Istio', note: 'Envoy sidecars add mTLS, retries and telemetry to every service', url: 'https://istio.io' },
        { name: 'Linkerd', note: 'Lightweight service mesh with a Rust micro-proxy', url: 'https://linkerd.io' },
        { name: 'Dapr', note: 'Sidecar APIs for state, pub/sub and secrets in any language', url: 'https://dapr.io' },
      ],
    },
    {
      label: 'Further reading',
      items: [
        { name: 'Software Architecture Monday — Lesson 170', note: 'Mark Richards on managing code reuse in microservices', url: 'https://www.developertoarchitect.com/lessons/lesson170.html' },
        { name: 'Sidecar pattern', note: 'Azure Architecture Center description of the pattern', url: 'https://learn.microsoft.com/azure/architecture/patterns/sidecar' },
      ],
    },
  ],
  'layered-architecture': [
    {
      label: 'Enforcing layers',
      items: [
        { name: 'ArchUnit layeredArchitecture()', note: 'Declares layers and which may access which', url: 'https://www.archunit.org' },
        { name: 'jMolecules', note: 'Layer annotations (@DomainLayer, @InfrastructureLayer) for Java', url: 'https://github.com/xmolecules/jmolecules' },
        { name: 'deptrac', note: 'PHP tool that checks layer dependencies', url: 'https://github.com/deptrac/deptrac' },
      ],
    },
    {
      label: 'Further reading',
      items: [
        { name: 'Software Architecture Monday — Lesson 158', note: 'Mark Richards on the layered architecture style', url: 'https://www.developertoarchitect.com/lessons/lesson158.html' },
        { name: 'Presentation Domain Data Layering', note: 'Martin Fowler on the three classic layers and their limits', url: 'https://martinfowler.com/bliki/PresentationDomainDataLayering.html' },
        { name: 'Patterns of Enterprise Application Architecture', note: 'Fowler’s catalogue of layering and persistence patterns', url: 'https://martinfowler.com/books/eaa.html' },
      ],
    },
  ],
  'service-based-architecture': [
    {
      label: 'Building blocks',
      items: [
        { name: 'Spring Boot', note: 'Each coarse domain service as its own deployable app', url: 'https://spring.io/projects/spring-boot' },
        { name: 'PostgreSQL schemas', note: 'One logical schema per domain inside a shared database', url: 'https://www.postgresql.org/docs/current/ddl-schemas.html' },
        { name: 'Flyway', note: 'Versioned migrations per domain schema', url: 'https://flywaydb.org' },
      ],
    },
    {
      label: 'Further reading',
      items: [
        { name: 'Software Architecture Monday — Lesson 163', note: 'Mark Richards on service-based architecture', url: 'https://www.developertoarchitect.com/lessons/lesson163.html' },
        { name: 'Software Architecture Monday — Lesson 114', note: 'Microservices vs. service-based architecture', url: 'https://www.developertoarchitect.com/lessons/lesson114.html' },
        { name: 'Software Architecture Monday — Lesson 153', note: 'Service-based architecture vs. SOA', url: 'https://www.developertoarchitect.com/lessons/lesson153.html' },
      ],
    },
  ],
  'microkernel-architecture': [
    {
      label: 'Plug-in frameworks',
      items: [
        { name: 'PF4J', note: 'Lightweight plug-in framework for Java', url: 'https://pf4j.org' },
        { name: 'OSGi', note: 'Module and service runtime with hot-swappable bundles', url: 'https://www.osgi.org' },
        { name: 'Apache Felix', note: 'Open-source OSGi implementation', url: 'https://felix.apache.org' },
        { name: 'Extism', note: 'WebAssembly plug-ins callable from many host languages', url: 'https://extism.org' },
      ],
    },
    {
      label: 'Well-known microkernels',
      items: [
        { name: 'VS Code Extension API', note: 'Small editor core extended by thousands of extensions', url: 'https://code.visualstudio.com/api' },
        { name: 'Eclipse IDE', note: 'Built on the Equinox OSGi runtime; nearly everything is a plug-in', url: 'https://www.eclipse.org/ide/' },
        { name: 'Jenkins plugins', note: 'CI core whose features come from plug-ins', url: 'https://plugins.jenkins.io' },
        { name: 'Drools', note: 'Rules engine often used for per-region rule plug-ins', url: 'https://www.drools.org' },
      ],
    },
    {
      label: 'Further reading',
      items: [
        { name: 'Software Architecture Monday — Lesson 160', note: 'Mark Richards on the microkernel style', url: 'https://www.developertoarchitect.com/lessons/lesson160.html' },
        { name: 'Software Architecture Monday — Lesson 196', note: 'How modularity differs across architecture styles', url: 'https://www.developertoarchitect.com/lessons/lesson196.html' },
      ],
    },
  ],
  'space-based-architecture': [
    {
      label: 'In-memory data grids',
      items: [
        { name: 'Hazelcast', note: 'Replicated and partitioned maps embedded in processing units', url: 'https://hazelcast.com' },
        { name: 'Apache Ignite', note: 'Distributed in-memory grid with SQL and compute', url: 'https://ignite.apache.org' },
        { name: 'Apache Geode', note: 'In-memory data grid with asynchronous write-behind', url: 'https://geode.apache.org' },
        { name: 'Oracle Coherence', note: 'Long-standing distributed cache and data grid', url: 'https://coherence.community' },
        { name: 'GigaSpaces', note: 'Commercial platform rooted in tuple-space processing units', url: 'https://www.gigaspaces.com' },
      ],
    },
    {
      label: 'Further reading',
      items: [
        { name: 'Software Architecture Monday — Lesson 166', note: 'Mark Richards on space-based architecture', url: 'https://www.developertoarchitect.com/lessons/lesson166.html' },
        { name: 'Software Architecture Monday — Lesson 174', note: 'Replicated caching and data collisions', url: 'https://www.developertoarchitect.com/lessons/lesson174.html' },
      ],
    },
  ],
  'orchestration-driven-soa': [
    {
      label: 'ESBs & integration platforms',
      items: [
        { name: 'MuleSoft Anypoint Platform', note: 'Commercial ESB and API-led integration platform', url: 'https://www.mulesoft.com' },
        { name: 'WSO2 Micro Integrator', note: 'Open-source ESB-style integration and mediation runtime', url: 'https://wso2.com' },
        { name: 'Apache Camel', note: 'Integration framework implementing the EIP catalogue', url: 'https://camel.apache.org' },
        { name: 'IBM App Connect', note: 'Successor to IBM Integration Bus (formerly Message Broker)', url: 'https://www.ibm.com/products/app-connect' },
      ],
    },
    {
      label: 'Further reading',
      items: [
        { name: 'Software Architecture Monday — Lesson 164', note: 'Mark Richards on service-oriented architecture', url: 'https://www.developertoarchitect.com/lessons/lesson164.html' },
        { name: 'Software Architecture Monday — Lesson 39', note: 'Integration hubs (ESBs)', url: 'https://www.developertoarchitect.com/lessons/lesson39.html' },
        { name: 'Software Architecture Monday — Lesson 154', note: 'Is an ESB still relevant today?', url: 'https://www.developertoarchitect.com/lessons/lesson154.html' },
        { name: 'Enterprise Integration Patterns', note: 'Hohpe & Woolf’s catalogue of messaging and mediation patterns', url: 'https://www.enterpriseintegrationpatterns.com' },
      ],
    },
  ],
  'orchestration-vs-choreography': [
    {
      label: 'Orchestration engines',
      items: [
        { name: 'Temporal', note: 'Durable workflows as code with retries and compensation', url: 'https://temporal.io' },
        { name: 'Camunda', note: 'BPMN process orchestration with visual monitoring', url: 'https://camunda.com' },
        { name: 'AWS Step Functions', note: 'Managed state machines coordinating AWS services', url: 'https://aws.amazon.com/step-functions/' },
        { name: 'Conductor OSS', note: 'Netflix-born orchestrator for microservice workflows', url: 'https://conductor-oss.org' },
      ],
    },
    {
      label: 'Choreography backbones',
      items: [
        { name: 'Apache Kafka', note: 'Topics that services publish to and react on', url: 'https://kafka.apache.org' },
        { name: 'Amazon EventBridge', note: 'Event bus with rule-based routing to consumers', url: 'https://aws.amazon.com/eventbridge/' },
      ],
    },
    {
      label: 'Further reading',
      items: [
        { name: 'Mark Richards — Lesson 23', note: 'Software Architecture Monday: orchestration vs. choreography', url: 'https://www.developertoarchitect.com/lessons/lesson23.html' },
        { name: 'Saga pattern (microservices.io)', note: 'Orchestrated and choreographed sagas compared', url: 'https://microservices.io/patterns/data/saga.html' },
        { name: 'Process Manager (EIP)', note: 'The classic pattern for a central workflow coordinator', url: 'https://www.enterpriseintegrationpatterns.com/patterns/messaging/ProcessManager.html' },
      ],
    },
  ],
  'request-reply-messaging': [
    {
      label: 'Broker & framework support',
      items: [
        { name: 'RabbitMQ direct reply-to', note: 'Pseudo-queue for replies without declaring a queue per request', url: 'https://www.rabbitmq.com/docs/direct-reply-to' },
        { name: 'Spring AMQP request/reply', note: 'RabbitTemplate.sendAndReceive with correlation handling', url: 'https://docs.spring.io/spring-amqp/reference/amqp/request-reply.html' },
        { name: 'Spring Kafka ReplyingKafkaTemplate', note: 'Request/reply over Kafka topics with correlation headers', url: 'https://docs.spring.io/spring-kafka/reference/kafka/sending-messages.html' },
        { name: 'NATS request-reply', note: 'Built-in inbox subjects for replies', url: 'https://docs.nats.io/nats-concepts/core-nats/reqreply' },
      ],
    },
    {
      label: 'Further reading',
      items: [
        { name: 'Request-Reply & Correlation Identifier (EIP)', note: 'The original pattern descriptions', url: 'https://www.enterpriseintegrationpatterns.com/patterns/messaging/RequestReply.html' },
        { name: 'Mark Richards — Lesson 142', note: 'Request/reply vs. async notification', url: 'https://www.developertoarchitect.com/lessons/lesson142.html' },
        { name: 'Mark Richards — Lesson 137', note: 'REST vs. messaging trade-offs', url: 'https://www.developertoarchitect.com/lessons/lesson137.html' },
      ],
    },
  ],
  'events-vs-messages': [
    {
      label: 'Describing events',
      items: [
        { name: 'CloudEvents', note: 'CNCF spec for a common event envelope', url: 'https://cloudevents.io' },
        { name: 'AsyncAPI', note: 'Documents channels, messages and payload schemas', url: 'https://www.asyncapi.com' },
        { name: 'Confluent Schema Registry', note: 'Central schemas for event payloads on Kafka', url: 'https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html' },
      ],
    },
    {
      label: 'Further reading',
      items: [
        { name: 'Mark Richards — Lesson 175', note: 'Events vs. messages', url: 'https://www.developertoarchitect.com/lessons/lesson175.html' },
        { name: 'Mark Richards — Lessons 199 & 198', note: 'Anemic events and the swarm-of-gnats anti-pattern', url: 'https://www.developertoarchitect.com/lessons/lesson199.html' },
        { name: 'Mark Richards — Lesson 105', note: 'Stamp coupling', url: 'https://www.developertoarchitect.com/lessons/lesson105.html' },
        { name: 'Martin Fowler — What do you mean by “Event-Driven”?', note: 'Notification vs. event-carried state transfer', url: 'https://martinfowler.com/articles/201701-event-driven.html' },
      ],
    },
  ],
  'contract-versioning': [
    {
      label: 'Contract testing',
      items: [
        { name: 'Pact', note: 'Consumer-driven contract tests across languages', url: 'https://docs.pact.io' },
        { name: 'Spring Cloud Contract', note: 'Provider contracts that generate stubs and tests', url: 'https://spring.io/projects/spring-cloud-contract' },
      ],
    },
    {
      label: 'Breaking-change detection',
      items: [
        { name: 'Buf breaking', note: 'Fails the build on incompatible Protobuf changes', url: 'https://buf.build/docs/breaking/' },
        { name: 'oasdiff', note: 'Detects breaking changes between OpenAPI versions', url: 'https://www.oasdiff.com' },
        { name: 'Schema Registry compatibility', note: 'BACKWARD/FORWARD/FULL rules for Avro, Protobuf, JSON Schema', url: 'https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html' },
      ],
    },
    {
      label: 'Further reading',
      items: [
        { name: 'Mark Richards — Lesson 41', note: 'Microservices contract versioning', url: 'https://www.developertoarchitect.com/lessons/lesson41.html' },
        { name: 'Mark Richards — Lesson 147', note: 'The fallacies of versioning', url: 'https://www.developertoarchitect.com/lessons/lesson147.html' },
      ],
    },
  ],
  'guaranteed-delivery': [
    {
      label: 'Broker settings',
      items: [
        { name: 'RabbitMQ publisher confirms & consumer acks', note: 'Broker confirms receipt; consumers ack after processing', url: 'https://www.rabbitmq.com/docs/confirms' },
        { name: 'RabbitMQ quorum queues', note: 'Replicated, durable queues based on Raft', url: 'https://www.rabbitmq.com/docs/quorum-queues' },
        { name: 'Kafka acks=all', note: 'Producer waits for all in-sync replicas; pair with idempotence', url: 'https://kafka.apache.org/documentation/#producerconfigs_acks' },
      ],
    },
    {
      label: 'Closing the gaps',
      items: [
        { name: 'Debezium outbox event router', note: 'Publishes outbox rows committed with business data', url: 'https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html' },
        { name: 'Guaranteed Delivery (EIP)', note: 'Store-and-forward pattern description', url: 'https://www.enterpriseintegrationpatterns.com/patterns/messaging/GuaranteedMessaging.html' },
      ],
    },
    {
      label: 'Further reading',
      items: [
        { name: 'Mark Richards — Lesson 70', note: 'Preventing data loss when using messaging', url: 'https://www.developertoarchitect.com/lessons/lesson70.html' },
        { name: 'Mark Richards — Lesson 121', note: 'Transacted messages', url: 'https://www.developertoarchitect.com/lessons/lesson121.html' },
      ],
    },
  ],
  'workflow-event-pattern': [
    {
      label: 'Error handling & repair tooling',
      items: [
        { name: 'ServiceControl & ServicePulse', note: 'Collects failed messages, lets operators edit and retry', url: 'https://docs.particular.net/servicecontrol/' },
        { name: 'Spring Kafka retry topics', note: 'Routes failures to retry and dead-letter topics', url: 'https://docs.spring.io/spring-kafka/reference/retrytopic.html' },
        { name: 'Camunda Tasklist', note: 'Human tasks for cases automation cannot fix', url: 'https://docs.camunda.io/docs/components/tasklist/introduction-to-tasklist/' },
      ],
    },
    {
      label: 'Further reading',
      items: [
        { name: 'Mark Richards — Lesson 81', note: 'Workflow event pattern', url: 'https://www.developertoarchitect.com/lessons/lesson81.html' },
        { name: 'Enterprise Integration Patterns — Invalid Message Channel', note: 'Where unprocessable messages go instead of vanishing', url: 'https://www.enterpriseintegrationpatterns.com/patterns/messaging/InvalidMessageChannel.html' },
      ],
    },
  ],
  'ambulance-pattern': [
    {
      label: 'Priority channels',
      items: [
        { name: 'Priority Queue pattern (Azure)', note: 'Separate queues and consumer pools per priority', url: 'https://learn.microsoft.com/azure/architecture/patterns/priority-queue' },
        { name: 'RabbitMQ priority queues', note: 'In-queue priorities when a separate queue is overkill', url: 'https://www.rabbitmq.com/docs/priority' },
        { name: 'Celery task routing', note: 'Route urgent tasks to dedicated queues and workers', url: 'https://docs.celeryq.dev/en/stable/userguide/routing.html' },
        { name: 'Sidekiq queues', note: 'Strict or weighted queue ordering per worker', url: 'https://github.com/sidekiq/sidekiq/wiki/Advanced-Options' },
      ],
    },
    {
      label: 'Further reading',
      items: [
        { name: 'Mark Richards — Lesson 56', note: 'The ambulance pattern', url: 'https://www.developertoarchitect.com/lessons/lesson56.html' },
        { name: 'Mark Richards — Lesson 46', note: 'Introduction to the reactive architecture patterns', url: 'https://www.developertoarchitect.com/lessons/lesson46.html' },
      ],
    },
  ],
  'supervisor-consumer': [
    {
      label: 'Scaling consumers on load',
      items: [
        { name: 'KEDA', note: 'Scales Kubernetes workloads on queue length or Kafka lag', url: 'https://keda.sh' },
        { name: 'AWS Lambda with SQS', note: 'Pollers scale up and down with queue depth', url: 'https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html' },
        { name: 'Spring AMQP listener concurrency', note: 'Consumers grow from a minimum to a maximum on demand', url: 'https://docs.spring.io/spring-amqp/reference/amqp/listener-concurrency.html' },
      ],
    },
    {
      label: 'Throttling producers',
      items: [
        { name: 'RabbitMQ flow control', note: 'Slows publishers that outpace the broker', url: 'https://www.rabbitmq.com/docs/flow-control' },
        { name: 'RabbitMQ blocked connections', note: 'Publishers blocked on memory or disk alarms', url: 'https://www.rabbitmq.com/docs/connection-blocked' },
      ],
    },
    {
      label: 'Further reading',
      items: [
        { name: 'Mark Richards — Lesson 217', note: 'Supervisor-consumer pattern', url: 'https://www.developertoarchitect.com/lessons/lesson217.html' },
        { name: 'Mark Richards — Lesson 218', note: 'Thread delegate pattern', url: 'https://www.developertoarchitect.com/lessons/lesson218.html' },
        { name: 'Mark Richards — Lesson 171', note: 'Producer control flow pattern', url: 'https://www.developertoarchitect.com/lessons/lesson171.html' },
      ],
    },
  ],
  'cap-theorem': [
    {
      label: 'Tunable consistency in practice',
      items: [
        { name: 'DynamoDB read consistency', note: 'Eventually vs. strongly consistent reads per request', url: 'https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html' },
        { name: 'Apache Cassandra', note: 'Per-query consistency levels such as ONE and QUORUM', url: 'https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html' },
        { name: 'Jepsen', note: 'Tests what databases really do under partitions', url: 'https://jepsen.io' },
      ],
    },
    {
      label: 'Further reading',
      items: [
        { name: 'Eric Brewer — CAP twelve years later', note: 'The author revisits what the theorem means', url: 'https://www.infoq.com/articles/cap-twelve-years-later-how-the-rules-have-changed/' },
        { name: 'Daniel Abadi — PACELC paper', note: 'Adds the latency vs. consistency trade-off', url: 'https://www.cs.umd.edu/~abadi/papers/abadi-pacelc.pdf' },
        { name: 'Spanner, TrueTime and the CAP theorem', note: 'How Google runs an “effectively CA” CP system', url: 'https://research.google/pubs/spanner-truetime-and-the-cap-theorem/' },
        { name: 'Mark Richards — Lessons 111 & 149', note: 'CAP illustrated, and CAP applied to caching', url: 'https://www.developertoarchitect.com/lessons/lesson111.html' },
      ],
    },
  ],
  'caching-topologies': [
    {
      label: 'In-process & near cache',
      items: [
        { name: 'Caffeine', note: 'High-performance in-process cache for the JVM', url: 'https://github.com/ben-manes/caffeine' },
        { name: 'Hazelcast near cache', note: 'Local copy of hot entries in front of the cluster', url: 'https://docs.hazelcast.com/hazelcast/latest/cluster-performance/near-cache' },
        { name: 'Redis client-side caching', note: 'Server-assisted invalidation of local copies', url: 'https://redis.io/docs/latest/develop/reference/client-side-caching/' },
      ],
    },
    {
      label: 'Distributed cache',
      items: [
        { name: 'Redis', note: 'Client/server cache with replication and clustering', url: 'https://redis.io' },
        { name: 'Memcached', note: 'Simple, fast distributed key-value cache', url: 'https://memcached.org' },
      ],
    },
    {
      label: 'Replicated cache / in-memory data grid',
      items: [
        { name: 'Hazelcast', note: 'Replicated and partitioned maps embedded in the app', url: 'https://hazelcast.com' },
        { name: 'Apache Ignite', note: 'Data grid with replicated and partitioned caches', url: 'https://ignite.apache.org' },
        { name: 'Apache Geode', note: 'Data grid with replicated regions (GemFire lineage)', url: 'https://geode.apache.org' },
        { name: 'Mark Richards — Lessons 80 & 174', note: 'Choosing a topology; collisions in replicated caches', url: 'https://www.developertoarchitect.com/lessons/lesson80.html' },
      ],
    },
  ],
  'microservices-reporting': [
    {
      label: 'Push & batch pipelines',
      items: [
        { name: 'Debezium', note: 'CDC streams service data into the reporting store', url: 'https://debezium.io' },
        { name: 'Airbyte', note: 'Open-source ELT connectors into a warehouse', url: 'https://airbyte.com' },
        { name: 'dbt', note: 'SQL transformations that build reporting models', url: 'https://www.getdbt.com' },
      ],
    },
    {
      label: 'Reporting stores',
      items: [
        { name: 'ClickHouse', note: 'Columnar database for fast analytical queries', url: 'https://clickhouse.com' },
        { name: 'Apache Pinot', note: 'Real-time OLAP fed directly from Kafka', url: 'https://pinot.apache.org' },
      ],
    },
    {
      label: 'Further reading',
      items: [
        { name: 'Mark Richards — Lesson 13', note: 'Microservices and reporting', url: 'https://www.developertoarchitect.com/lessons/lesson13.html' },
        { name: 'Zhamak Dehghani — Data mesh principles', note: 'Domain-owned analytical data products', url: 'https://martinfowler.com/articles/data-mesh-principles.html' },
      ],
    },
  ],
}

/** Flat list of example names for a concept (used by search). */
export function conceptExampleNames(id: string): string[] {
  return (CONCEPT_EXAMPLES[id] ?? []).flatMap((g) => g.items.map((i) => i.name))
}

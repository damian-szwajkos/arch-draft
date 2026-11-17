import type { ComponentKind, StackPreferences } from '../engine/types'

export interface Tech {
  id: string
  name: string
  kinds: ComponentKind[]
  /** Machine-readable characteristics the validator can reason about. */
  traits: string[]
  blurb: string
  /** Optional ecosystem tag, e.g. 'jvm', 'node'. */
  ecosystem?: string
}

const BACKEND: ComponentKind[] = ['service', 'monolith', 'module', 'worker', 'bff']

export const TECH: Tech[] = [
  // Frontend
  { id: 'react', name: 'React', kinds: ['web-app'], traits: ['spa'], blurb: 'Component library with a huge ecosystem; pair with Vite or a meta-framework.' },
  { id: 'angular', name: 'Angular', kinds: ['web-app'], traits: ['spa'], blurb: 'Batteries-included framework with DI and strong conventions — popular in enterprise.' },
  { id: 'vue', name: 'Vue', kinds: ['web-app'], traits: ['spa'], blurb: 'Approachable, progressive framework with great DX.' },
  { id: 'svelte', name: 'Svelte', kinds: ['web-app'], traits: ['spa'], blurb: 'Compiler-first framework producing tiny bundles.' },
  { id: 'nextjs', name: 'Next.js', kinds: ['web-app', 'bff'], traits: ['ssr', 'spa'], blurb: 'React meta-framework with SSR/SSG — good for SEO-heavy storefronts.', ecosystem: 'node' },
  { id: 'nuxt', name: 'Nuxt', kinds: ['web-app'], traits: ['ssr', 'spa'], blurb: 'Vue meta-framework with SSR and file-based routing.' },
  // Mobile
  { id: 'react-native', name: 'React Native', kinds: ['mobile-app'], traits: ['cross-platform'], blurb: 'Share React skills and code across iOS and Android.' },
  { id: 'flutter', name: 'Flutter', kinds: ['mobile-app'], traits: ['cross-platform'], blurb: 'Dart-based UI toolkit with pixel-perfect rendering.' },
  { id: 'swiftui', name: 'SwiftUI (iOS)', kinds: ['mobile-app'], traits: ['native'], blurb: 'Native iOS UI framework.' },
  { id: 'jetpack-compose', name: 'Jetpack Compose (Android)', kinds: ['mobile-app'], traits: ['native'], blurb: 'Native Android UI toolkit in Kotlin.' },
  { id: 'ionic', name: 'Ionic', kinds: ['mobile-app'], traits: ['cross-platform', 'hybrid'], blurb: 'Web technologies (Angular/React/Vue) wrapped as native apps.' },

  // Backend frameworks
  { id: 'spring-boot', name: 'Spring Boot', kinds: BACKEND, traits: ['jvm'], ecosystem: 'jvm', blurb: 'The JVM workhorse: mature ecosystem (Spring Data, Security, Cloud, Modulith).' },
  { id: 'quarkus', name: 'Quarkus', kinds: BACKEND, traits: ['jvm', 'fast-startup'], ecosystem: 'jvm', blurb: 'Kubernetes-native Java with fast startup and low memory (GraalVM).' },
  { id: 'micronaut', name: 'Micronaut', kinds: BACKEND, traits: ['jvm', 'fast-startup'], ecosystem: 'jvm', blurb: 'Compile-time DI JVM framework, light and fast.' },
  { id: 'ktor', name: 'Ktor (Kotlin)', kinds: BACKEND, traits: ['jvm'], ecosystem: 'jvm', blurb: 'Lightweight asynchronous Kotlin framework.' },
  { id: 'nestjs', name: 'NestJS', kinds: BACKEND, traits: ['node', 'typescript'], ecosystem: 'node', blurb: 'Structured TypeScript framework inspired by Angular.' },
  { id: 'express', name: 'Express / Fastify', kinds: BACKEND, traits: ['node'], ecosystem: 'node', blurb: 'Minimal Node.js HTTP frameworks.' },
  { id: 'dotnet', name: 'ASP.NET Core', kinds: BACKEND, traits: ['dotnet'], ecosystem: 'dotnet', blurb: 'High-performance .NET web framework.' },
  { id: 'go', name: 'Go (net/http, Gin)', kinds: BACKEND, traits: ['go', 'fast-startup'], ecosystem: 'go', blurb: 'Simple, fast, tiny containers — great for infra-heavy services.' },
  { id: 'fastapi', name: 'FastAPI', kinds: BACKEND, traits: ['python'], ecosystem: 'python', blurb: 'Modern async Python APIs with type hints.' },
  { id: 'django', name: 'Django', kinds: BACKEND, traits: ['python'], ecosystem: 'python', blurb: 'Batteries-included Python framework with admin out of the box.' },
  { id: 'rails', name: 'Ruby on Rails', kinds: BACKEND, traits: ['ruby'], ecosystem: 'ruby', blurb: 'Convention over configuration; fastest path to a working product.' },
  { id: 'phoenix', name: 'Elixir Phoenix', kinds: [...BACKEND, 'realtime-gateway'], traits: ['beam', 'realtime'], ecosystem: 'beam', blurb: 'BEAM concurrency; superb for realtime (Channels, LiveView).' },
  { id: 'axum', name: 'Rust (Axum)', kinds: BACKEND, traits: ['rust', 'fast-startup'], ecosystem: 'rust', blurb: 'Memory-safe, very high performance services.' },
  { id: 'apollo', name: 'Apollo GraphQL', kinds: ['bff'], traits: ['graphql', 'node'], ecosystem: 'node', blurb: 'GraphQL server / federation gateway.' },
  // Workers
  { id: 'celery', name: 'Celery', kinds: ['worker'], traits: ['python', 'jobs'], blurb: 'Python distributed task queue.' },
  { id: 'sidekiq', name: 'Sidekiq', kinds: ['worker'], traits: ['ruby', 'jobs'], blurb: 'Redis-backed background jobs for Ruby.' },
  { id: 'bullmq', name: 'BullMQ', kinds: ['worker'], traits: ['node', 'jobs'], blurb: 'Redis-backed job queue for Node.js.' },
  { id: 'ffmpeg', name: 'FFmpeg workers', kinds: ['worker', 'function'], traits: ['media'], blurb: 'Video/audio transcoding.' },
  // Functions
  { id: 'aws-lambda', name: 'AWS Lambda', kinds: ['function'], traits: ['serverless'], blurb: 'Event-driven functions, pay per invocation.' },
  { id: 'gcp-functions', name: 'Cloud Run functions', kinds: ['function'], traits: ['serverless'], blurb: 'Google Cloud serverless functions.' },
  { id: 'azure-functions', name: 'Azure Functions', kinds: ['function'], traits: ['serverless'], blurb: 'Azure serverless compute.' },
  { id: 'cf-workers', name: 'Cloudflare Workers', kinds: ['function'], traits: ['serverless', 'edge'], blurb: 'V8 isolates running at the edge.' },
  // Orchestrators
  { id: 'temporal', name: 'Temporal', kinds: ['orchestrator'], traits: ['workflow', 'saga', 'durable'], blurb: 'Durable execution: workflows as code with retries and compensation.' },
  { id: 'camunda', name: 'Camunda (BPMN)', kinds: ['orchestrator'], traits: ['workflow', 'saga', 'bpmn'], blurb: 'BPMN process orchestration, visible to business.' },
  { id: 'axon', name: 'Axon Framework', kinds: ['orchestrator', 'service'], traits: ['saga', 'event-sourcing', 'jvm'], blurb: 'CQRS/event-sourcing framework with sagas for the JVM.' },
  { id: 'step-functions', name: 'AWS Step Functions', kinds: ['orchestrator'], traits: ['workflow', 'saga', 'serverless'], blurb: 'Managed state machines.' },
  { id: 'custom-saga', name: 'Custom saga (state machine)', kinds: ['orchestrator'], traits: ['saga'], blurb: 'Hand-rolled orchestrator persisting saga state in its DB.' },

  // Edge
  { id: 'cloudflare', name: 'Cloudflare', kinds: ['cdn', 'waf'], traits: ['global', 'bot-protection'], blurb: 'Global CDN with WAF, bot management and waiting room.' },
  { id: 'cloudfront', name: 'Amazon CloudFront', kinds: ['cdn'], traits: ['global'], blurb: 'AWS CDN integrated with S3.' },
  { id: 'fastly', name: 'Fastly', kinds: ['cdn'], traits: ['global', 'edge-compute'], blurb: 'Programmable CDN with instant purge.' },
  { id: 'akamai', name: 'Akamai', kinds: ['cdn', 'waf'], traits: ['global', 'bot-protection'], blurb: 'Enterprise CDN and security.' },
  { id: 'nginx', name: 'NGINX', kinds: ['load-balancer', 'api-gateway'], traits: ['reverse-proxy'], blurb: 'Battle-tested reverse proxy and load balancer.' },
  { id: 'haproxy', name: 'HAProxy', kinds: ['load-balancer'], traits: ['reverse-proxy'], blurb: 'High-performance TCP/HTTP load balancer.' },
  { id: 'envoy', name: 'Envoy', kinds: ['load-balancer', 'api-gateway'], traits: ['reverse-proxy', 'rate-limiting', 'service-mesh'], blurb: 'Modern L7 proxy, basis of many meshes and gateways.' },
  { id: 'aws-alb', name: 'AWS ALB', kinds: ['load-balancer'], traits: ['managed'], blurb: 'Managed L7 load balancer.' },
  { id: 'kong', name: 'Kong', kinds: ['api-gateway'], traits: ['rate-limiting', 'auth', 'plugins'], blurb: 'Plugin-rich API gateway (auth, rate limiting, transformations).' },
  { id: 'spring-cloud-gateway', name: 'Spring Cloud Gateway', kinds: ['api-gateway'], traits: ['rate-limiting', 'auth', 'jvm'], blurb: 'JVM gateway that fits Spring ecosystems.' },
  { id: 'apigee', name: 'Apigee', kinds: ['api-gateway'], traits: ['rate-limiting', 'auth', 'managed'], blurb: 'Managed API management with analytics and monetisation.' },
  { id: 'aws-api-gateway', name: 'Amazon API Gateway', kinds: ['api-gateway'], traits: ['rate-limiting', 'auth', 'managed', 'serverless'], blurb: 'Managed gateway, natural partner of Lambda.' },
  { id: 'krakend', name: 'KrakenD', kinds: ['api-gateway'], traits: ['rate-limiting', 'aggregation'], blurb: 'Stateless high-performance gateway with response aggregation.' },
  { id: 'traefik', name: 'Traefik', kinds: ['api-gateway', 'load-balancer'], traits: ['rate-limiting', 'reverse-proxy'], blurb: 'Cloud-native edge router with auto discovery.' },
  { id: 'socketio', name: 'Socket.IO', kinds: ['realtime-gateway'], traits: ['websocket', 'node'], blurb: 'WebSocket abstraction with rooms and fallbacks.' },
  { id: 'spring-websocket', name: 'Spring WebSocket / STOMP', kinds: ['realtime-gateway'], traits: ['websocket', 'jvm'], blurb: 'WebSocket messaging on Spring.' },
  { id: 'centrifugo', name: 'Centrifugo', kinds: ['realtime-gateway'], traits: ['websocket', 'scalable'], blurb: 'Scalable realtime messaging server (WS/SSE).' },
  { id: 'signalr', name: 'SignalR', kinds: ['realtime-gateway'], traits: ['websocket', 'dotnet'], blurb: '.NET realtime hub.' },

  // Relational
  { id: 'postgres', name: 'PostgreSQL', kinds: ['relational-db'], traits: ['acid', 'relational', 'oss', 'json'], blurb: 'Feature-rich open-source RDBMS; the default good choice.' },
  { id: 'mysql', name: 'MySQL', kinds: ['relational-db'], traits: ['acid', 'relational', 'oss'], blurb: 'Ubiquitous open-source RDBMS.' },
  { id: 'mariadb', name: 'MariaDB', kinds: ['relational-db'], traits: ['acid', 'relational', 'oss'], blurb: 'Community fork of MySQL.' },
  { id: 'oracle', name: 'Oracle Database', kinds: ['relational-db'], traits: ['acid', 'relational', 'enterprise'], blurb: 'Enterprise RDBMS common in banking.' },
  { id: 'sqlserver', name: 'SQL Server', kinds: ['relational-db'], traits: ['acid', 'relational', 'enterprise'], blurb: 'Microsoft RDBMS.' },
  { id: 'cockroachdb', name: 'CockroachDB', kinds: ['relational-db'], traits: ['acid', 'relational', 'distributed'], blurb: 'Distributed SQL with serializable transactions across regions.' },
  // Document / KV
  { id: 'mongodb', name: 'MongoDB', kinds: ['document-db'], traits: ['document', 'flexible-schema'], blurb: 'Popular document database with flexible schemas.' },
  { id: 'dynamodb', name: 'DynamoDB', kinds: ['document-db'], traits: ['key-value', 'managed', 'scale'], blurb: 'Serverless key-value at any scale; design for access patterns.' },
  { id: 'couchbase', name: 'Couchbase', kinds: ['document-db'], traits: ['document', 'cache'], blurb: 'Document DB with built-in caching.' },
  { id: 'firestore', name: 'Firestore', kinds: ['document-db'], traits: ['document', 'managed', 'realtime'], blurb: 'Managed document DB with realtime listeners.' },
  { id: 'cosmosdb', name: 'Azure Cosmos DB', kinds: ['document-db'], traits: ['document', 'managed', 'global'], blurb: 'Globally distributed multi-model DB.' },
  // Cache
  { id: 'redis', name: 'Redis', kinds: ['cache', 'broker'], traits: ['cache', 'ttl', 'geo', 'pubsub', 'atomic', 'sorted-sets'], blurb: 'In-memory data structures: cache, TTL holds, rate limits, geo, leaderboards.' },
  { id: 'valkey', name: 'Valkey', kinds: ['cache'], traits: ['cache', 'ttl', 'geo', 'atomic', 'sorted-sets'], blurb: 'Open-source Redis fork.' },
  { id: 'memcached', name: 'Memcached', kinds: ['cache'], traits: ['cache', 'ttl'], blurb: 'Simple, fast, multi-threaded key-value cache.' },
  { id: 'hazelcast', name: 'Hazelcast', kinds: ['cache'], traits: ['cache', 'ttl', 'jvm', 'distributed'], blurb: 'Distributed in-memory data grid for the JVM.' },
  // Search
  { id: 'elasticsearch', name: 'Elasticsearch', kinds: ['search', 'logging'], traits: ['full-text'], blurb: 'Distributed search & analytics engine.' },
  { id: 'opensearch', name: 'OpenSearch', kinds: ['search', 'logging'], traits: ['full-text'], blurb: 'Open-source fork of Elasticsearch.' },
  { id: 'meilisearch', name: 'Meilisearch', kinds: ['search'], traits: ['full-text', 'simple'], blurb: 'Developer-friendly instant search.' },
  { id: 'typesense', name: 'Typesense', kinds: ['search'], traits: ['full-text', 'simple'], blurb: 'Typo-tolerant search engine.' },
  // Object storage
  { id: 's3', name: 'Amazon S3', kinds: ['object-storage'], traits: ['blob', 'durable', 'immutable-option'], blurb: 'The de-facto object store (Object Lock for WORM).' },
  { id: 'gcs', name: 'Google Cloud Storage', kinds: ['object-storage'], traits: ['blob', 'durable'], blurb: 'GCP object storage.' },
  { id: 'azure-blob', name: 'Azure Blob Storage', kinds: ['object-storage'], traits: ['blob', 'durable', 'immutable-option'], blurb: 'Azure object storage.' },
  { id: 'minio', name: 'MinIO', kinds: ['object-storage'], traits: ['blob', 's3-compatible'], blurb: 'Self-hosted S3-compatible storage.' },
  { id: 'r2', name: 'Cloudflare R2', kinds: ['object-storage'], traits: ['blob', 'no-egress-fees'], blurb: 'S3-compatible storage without egress fees.' },
  // Wide-column / TS
  { id: 'cassandra', name: 'Apache Cassandra', kinds: ['wide-column'], traits: ['write-heavy', 'partitioned'], blurb: 'Masterless, linear write scale — feeds, timelines, IoT.' },
  { id: 'scylladb', name: 'ScyllaDB', kinds: ['wide-column'], traits: ['write-heavy', 'partitioned'], blurb: 'Cassandra-compatible, C++ performance.' },
  { id: 'timescaledb', name: 'TimescaleDB', kinds: ['wide-column', 'relational-db'], traits: ['timeseries', 'relational', 'acid'], blurb: 'Time-series on top of PostgreSQL.' },
  { id: 'influxdb', name: 'InfluxDB', kinds: ['wide-column', 'metrics'], traits: ['timeseries'], blurb: 'Purpose-built time-series DB.' },
  // Analytics
  { id: 'clickhouse', name: 'ClickHouse', kinds: ['analytics-db'], traits: ['olap', 'realtime-analytics'], blurb: 'Blazing-fast columnar OLAP for event analytics.' },
  { id: 'snowflake', name: 'Snowflake', kinds: ['analytics-db'], traits: ['olap', 'warehouse'], blurb: 'Managed cloud data warehouse.' },
  { id: 'bigquery', name: 'BigQuery', kinds: ['analytics-db'], traits: ['olap', 'warehouse'], blurb: 'Serverless warehouse on GCP.' },
  { id: 'redshift', name: 'Redshift', kinds: ['analytics-db'], traits: ['olap', 'warehouse'], blurb: 'AWS data warehouse.' },
  { id: 'druid', name: 'Apache Druid', kinds: ['analytics-db'], traits: ['olap', 'realtime-analytics'], blurb: 'Real-time analytics on streaming data.' },
  // Graph
  { id: 'neo4j', name: 'Neo4j', kinds: ['graph-db'], traits: ['graph'], blurb: 'Leading property-graph database (Cypher).' },
  { id: 'neptune', name: 'Amazon Neptune', kinds: ['graph-db'], traits: ['graph', 'managed'], blurb: 'Managed graph database.' },
  { id: 'arangodb', name: 'ArangoDB', kinds: ['graph-db'], traits: ['graph', 'document'], blurb: 'Multi-model graph + document.' },

  // Messaging
  { id: 'kafka', name: 'Apache Kafka', kinds: ['broker'], traits: ['log', 'replayable', 'ordering', 'high-throughput', 'streaming'], blurb: 'Durable, partitioned, replayable log. Event streaming & event sourcing.' },
  { id: 'redpanda', name: 'Redpanda', kinds: ['broker'], traits: ['log', 'replayable', 'ordering', 'high-throughput', 'streaming'], blurb: 'Kafka-compatible, no JVM/ZooKeeper, low latency.' },
  { id: 'pulsar', name: 'Apache Pulsar', kinds: ['broker'], traits: ['log', 'replayable', 'queue', 'high-throughput', 'streaming'], blurb: 'Streaming + queuing with tiered storage.' },
  { id: 'kinesis', name: 'Amazon Kinesis', kinds: ['broker'], traits: ['log', 'replayable', 'managed', 'streaming'], blurb: 'Managed data streams on AWS.' },
  { id: 'rabbitmq', name: 'RabbitMQ', kinds: ['broker'], traits: ['queue', 'routing', 'low-latency'], blurb: 'Flexible routing, work queues, per-message acks. Messages leave once consumed.' },
  { id: 'activemq', name: 'ActiveMQ / Artemis', kinds: ['broker'], traits: ['queue', 'jms'], blurb: 'JMS broker common in enterprise Java.' },
  { id: 'nats', name: 'NATS JetStream', kinds: ['broker'], traits: ['pubsub', 'low-latency', 'replayable'], blurb: 'Lightweight, very fast messaging with persistence.' },
  { id: 'sqs', name: 'Amazon SQS / SNS', kinds: ['broker'], traits: ['queue', 'managed', 'pubsub'], blurb: 'Managed queues (+ SNS fan-out). Zero ops.' },
  { id: 'gcp-pubsub', name: 'Google Pub/Sub', kinds: ['broker'], traits: ['pubsub', 'managed'], blurb: 'Managed global pub/sub.' },
  { id: 'azure-service-bus', name: 'Azure Service Bus', kinds: ['broker'], traits: ['queue', 'managed', 'pubsub'], blurb: 'Managed enterprise messaging with sessions.' },
  { id: 'db-queue', name: 'DB-backed job queue', kinds: ['broker'], traits: ['queue', 'simple'], blurb: 'Jobs table polled by workers (e.g. pg-boss, Solid Queue, db-scheduler). Zero new infra.' },
  // CDC
  { id: 'debezium', name: 'Debezium', kinds: ['cdc'], traits: ['cdc', 'outbox'], blurb: 'Log-based CDC; built-in outbox event router.' },
  { id: 'kafka-connect', name: 'Kafka Connect', kinds: ['cdc'], traits: ['cdc', 'connectors'], blurb: 'Connector framework for Kafka sources and sinks.' },
  { id: 'outbox-poller', name: 'Outbox poller', kinds: ['cdc'], traits: ['outbox'], blurb: 'Polls the outbox table and publishes rows (Spring Modulith, MassTransit…).' },
  // Stream processing
  { id: 'kafka-streams', name: 'Kafka Streams', kinds: ['stream-processor'], traits: ['stateful', 'jvm'], blurb: 'Library for stateful stream processing on Kafka.' },
  { id: 'flink', name: 'Apache Flink', kinds: ['stream-processor'], traits: ['stateful', 'cep', 'low-latency'], blurb: 'Low-latency stateful streaming with event time & CEP.' },
  { id: 'spark-streaming', name: 'Spark Structured Streaming', kinds: ['stream-processor'], traits: ['stateful', 'micro-batch'], blurb: 'Micro-batch streaming on Spark.' },

  // Observability
  { id: 'otel-collector', name: 'OpenTelemetry Collector', kinds: ['otel-collector'], traits: ['otlp', 'vendor-neutral'], blurb: 'Vendor-neutral pipeline for logs, metrics and traces.' },
  { id: 'grafana-alloy', name: 'Grafana Alloy', kinds: ['otel-collector'], traits: ['otlp'], blurb: 'OTel-compatible collector from Grafana.' },
  { id: 'fluent-bit', name: 'Fluent Bit', kinds: ['otel-collector'], traits: ['logs'], blurb: 'Lightweight log forwarder.' },
  { id: 'vector', name: 'Vector', kinds: ['otel-collector'], traits: ['logs', 'metrics'], blurb: 'High-performance observability pipeline.' },
  { id: 'loki', name: 'Grafana Loki', kinds: ['logging'], traits: ['logs'], blurb: 'Label-indexed, cheap log storage.' },
  { id: 'elk', name: 'ELK (Elastic + Kibana)', kinds: ['logging'], traits: ['logs', 'full-text'], blurb: 'Full-text indexed logs with Kibana.' },
  { id: 'datadog', name: 'Datadog', kinds: ['logging', 'metrics', 'tracing', 'dashboards', 'alerting'], traits: ['saas'], blurb: 'All-in-one SaaS observability.' },
  { id: 'splunk', name: 'Splunk', kinds: ['logging'], traits: ['logs', 'siem'], blurb: 'Enterprise log analytics / SIEM.' },
  { id: 'prometheus', name: 'Prometheus', kinds: ['metrics'], traits: ['metrics', 'pull'], blurb: 'Pull-based metrics with PromQL — the cloud-native standard.' },
  { id: 'victoriametrics', name: 'VictoriaMetrics', kinds: ['metrics'], traits: ['metrics'], blurb: 'Efficient Prometheus-compatible TSDB.' },
  { id: 'mimir', name: 'Grafana Mimir', kinds: ['metrics'], traits: ['metrics', 'scalable'], blurb: 'Horizontally scalable Prometheus storage.' },
  { id: 'jaeger', name: 'Jaeger', kinds: ['tracing'], traits: ['traces'], blurb: 'CNCF distributed tracing.' },
  { id: 'tempo', name: 'Grafana Tempo', kinds: ['tracing'], traits: ['traces'], blurb: 'Cost-efficient trace storage on object storage.' },
  { id: 'zipkin', name: 'Zipkin', kinds: ['tracing'], traits: ['traces'], blurb: 'Pioneer distributed tracing system.' },
  { id: 'honeycomb', name: 'Honeycomb', kinds: ['tracing'], traits: ['traces', 'saas'], blurb: 'High-cardinality observability SaaS.' },
  { id: 'grafana', name: 'Grafana', kinds: ['dashboards', 'alerting'], traits: ['dashboards'], blurb: 'Dashboards across all telemetry sources.' },
  { id: 'kibana', name: 'Kibana', kinds: ['dashboards'], traits: ['dashboards'], blurb: 'Dashboards for Elastic data.' },
  { id: 'alertmanager', name: 'Alertmanager', kinds: ['alerting'], traits: ['alerts'], blurb: 'Prometheus alert routing, grouping and silencing.' },
  { id: 'pagerduty', name: 'PagerDuty', kinds: ['alerting'], traits: ['alerts', 'on-call'], blurb: 'On-call scheduling & incident response.' },
  { id: 'opsgenie', name: 'Opsgenie', kinds: ['alerting'], traits: ['alerts', 'on-call'], blurb: 'Alerting and on-call management.' },

  // Security
  { id: 'keycloak', name: 'Keycloak', kinds: ['identity'], traits: ['oidc', 'self-hosted'], blurb: 'Open-source IAM with OIDC/SAML, MFA, federation.' },
  { id: 'auth0', name: 'Auth0', kinds: ['identity'], traits: ['oidc', 'saas'], blurb: 'Developer-friendly hosted identity.' },
  { id: 'okta', name: 'Okta', kinds: ['identity'], traits: ['oidc', 'saas', 'workforce'], blurb: 'Enterprise identity platform.' },
  { id: 'cognito', name: 'Amazon Cognito', kinds: ['identity'], traits: ['oidc', 'managed'], blurb: 'AWS user pools and federation.' },
  { id: 'entra', name: 'Microsoft Entra ID', kinds: ['identity'], traits: ['oidc', 'saas', 'workforce'], blurb: 'Azure AD identity.' },
  { id: 'vault', name: 'HashiCorp Vault', kinds: ['secrets'], traits: ['secrets', 'dynamic-secrets', 'pki'], blurb: 'Dynamic secrets, encryption as a service, PKI.' },
  { id: 'aws-secrets', name: 'AWS Secrets Manager / KMS', kinds: ['secrets'], traits: ['secrets', 'managed'], blurb: 'Managed secrets with rotation.' },
  { id: 'azure-keyvault', name: 'Azure Key Vault', kinds: ['secrets'], traits: ['secrets', 'managed'], blurb: 'Keys, secrets and certificates on Azure.' },
  { id: 'aws-waf', name: 'AWS WAF + Shield', kinds: ['waf'], traits: ['bot-protection', 'ddos'], blurb: 'Managed WAF rules and DDoS protection.' },
  { id: 'modsecurity', name: 'ModSecurity (OWASP CRS)', kinds: ['waf'], traits: ['owasp'], blurb: 'Open-source WAF rules.' },

  // External providers
  { id: 'stripe', name: 'Stripe', kinds: ['external'], traits: ['payment', 'webhooks'], blurb: 'Payments with hosted checkout and webhooks.' },
  { id: 'adyen', name: 'Adyen', kinds: ['external'], traits: ['payment', 'webhooks'], blurb: 'Enterprise payments platform.' },
  { id: 'paypal', name: 'PayPal / Braintree', kinds: ['external'], traits: ['payment', 'webhooks'], blurb: 'Wallet and card payments.' },
  { id: 'sendgrid', name: 'SendGrid', kinds: ['external'], traits: ['email'], blurb: 'Transactional email API.' },
  { id: 'ses', name: 'Amazon SES', kinds: ['external'], traits: ['email'], blurb: 'Low-cost email sending.' },
  { id: 'twilio', name: 'Twilio', kinds: ['external'], traits: ['sms', 'voice'], blurb: 'SMS, voice and verification APIs.' },
  { id: 'fcm', name: 'FCM / APNs push', kinds: ['external'], traits: ['push'], blurb: 'Mobile push notifications.' },
  { id: 'google-maps', name: 'Google Maps Platform', kinds: ['external'], traits: ['maps', 'routing'], blurb: 'Geocoding, routing and ETAs.' },
  { id: 'mapbox', name: 'Mapbox', kinds: ['external'], traits: ['maps', 'routing'], blurb: 'Maps, navigation and geospatial APIs.' },
  { id: 'card-network', name: 'Card network (Visa / Mastercard)', kinds: ['external'], traits: ['card-network'], blurb: 'Authorisation & clearing via a card processor (ISO 8583).' },
  { id: 'kyc-provider', name: 'KYC / AML provider', kinds: ['external'], traits: ['kyc'], blurb: 'Identity verification and sanctions screening.' },
  { id: 'mux', name: 'Mux / managed video', kinds: ['external'], traits: ['video'], blurb: 'Managed video encoding & streaming.' },
  { id: 'generic-api', name: 'Generic partner API', kinds: ['external'], traits: [], blurb: 'Any third-party HTTP API.' },
]

export const TECH_BY_ID = Object.fromEntries(TECH.map((t) => [t.id, t])) as Record<string, Tech>

export function techFor(kind: ComponentKind): Tech[] {
  return TECH.filter((t) => t.kinds.includes(kind))
}

export const STACK_SLOTS: {
  key: keyof StackPreferences
  label: string
  kinds: ComponentKind[]
  hint: string
}[] = [
  { key: 'frontend', label: 'Web frontend', kinds: ['web-app'], hint: 'React, Angular, Vue…' },
  { key: 'mobile', label: 'Mobile', kinds: ['mobile-app'], hint: 'Flutter, React Native…' },
  { key: 'backend', label: 'Backend framework', kinds: ['service', 'monolith', 'module', 'worker', 'bff'], hint: 'Spring Boot, NestJS, Go…' },
  { key: 'database', label: 'Primary database', kinds: ['relational-db', 'document-db'], hint: 'PostgreSQL, MongoDB…' },
  { key: 'messaging', label: 'Messaging', kinds: ['broker'], hint: 'Kafka, RabbitMQ…' },
  { key: 'cache', label: 'Cache', kinds: ['cache'], hint: 'Redis, Memcached…' },
]

/** Options for a stack slot (deduplicated across the slot's kinds). */
export function stackOptions(key: keyof StackPreferences): Tech[] {
  const slot = STACK_SLOTS.find((s) => s.key === key)!
  return TECH.filter((t) => t.kinds.some((k) => slot.kinds.includes(k)) && !['celery', 'sidekiq', 'bullmq', 'ffmpeg', 'apollo'].includes(t.id))
}

/** Which stack preference (if any) should seed the tech of a new node of this kind. */
export function stackDefault(kind: ComponentKind, stack: StackPreferences): string | undefined {
  for (const slot of STACK_SLOTS) {
    const value = stack[slot.key]
    if (value && slot.kinds.includes(kind) && TECH_BY_ID[value]?.kinds.includes(kind)) return value
  }
  return undefined
}

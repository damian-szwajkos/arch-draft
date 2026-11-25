import type { Scenario } from '../../engine/types'
import { COMPUTE_KINDS, DB_KINDS } from '../../engine/graph'
import { diagram, ecosystemShare, external, observability, PUSH } from './builder'

export const neobank: Scenario = {
  id: 'neobank-ledger',
  title: 'Neobank: ledger, transfers & cards',
  tagline: 'Money must never be created or lost. Design for correctness first, scale second.',
  industry: 'Banking & Fintech',
  difficulty: 'advanced',
  estMinutes: 45,
  accent: '#10b981',
  concepts: ['event-driven', 'saga', 'outbox', 'idempotency', 'database-per-service', 'event-sourcing', 'distributed-tracing'],
  story:
    'Northwind Bank is a licensed EU neobank growing from 300k to 2M customers. Its first-generation core is a single Rails app that now blocks six product teams. You are asked to design the target architecture for the money-moving core: customer accounts, a double-entry ledger, instant transfers between customers, card authorisations, fraud screening, notifications and regulatory reporting. Auditors will review your design.',
  facts: [
    { label: 'Customers', value: '2M, 400 tx/s at peak' },
    { label: 'Teams', value: '6 squads, ~40 engineers' },
    { label: 'Skills', value: 'Java / Kotlin, some Go' },
    { label: 'Regulation', value: 'PSD2, PCI DSS, 10-year audit retention' },
  ],
  functional: [
    'Open accounts with KYC verification',
    'Double-entry ledger is the single source of truth for balances',
    'Instant transfers between customers (debit + credit, all-or-nothing)',
    'Card authorisations from the card network within 150 ms',
    'Fraud screening on transfers and card activity',
    'Push / SMS notifications for every money movement',
    'Daily regulatory reports and an immutable audit trail',
  ],
  nonFunctional: [
    'Strong consistency for balances — no double spending',
    'Every event that changed money must be published exactly once (effectively)',
    '99.95% availability for card authorisations',
    'Every request traceable end-to-end for incident analysis',
    'Secrets and keys never stored in config files',
  ],
  constraints: ['Teams must deploy independently', 'Card data isolated (PCI scope)', 'Events retained for replay ≥ 30 days'],
  domains: [
    { id: 'accounts', label: 'Accounts & KYC', description: 'Customers, accounts, limits' },
    { id: 'ledger', label: 'Ledger', description: 'Double-entry postings and balances' },
    { id: 'transfers', label: 'Transfers', description: 'Customer-initiated money movement' },
    { id: 'cards', label: 'Cards', description: 'Card authorisation & clearing' },
    { id: 'fraud', label: 'Fraud', description: 'Risk scoring and blocking' },
    { id: 'notifications', label: 'Notifications', description: 'Push, SMS, email' },
    { id: 'reporting', label: 'Reporting & audit', description: 'Regulatory reports, audit trail' },
  ],
  recommendedStyles: ['event-driven', 'microservices'],
  styleFeedback: {
    'event-driven': 'Strong choice: an event backbone lets fraud, notifications and reporting react to ledger changes without coupling to it.',
    microservices: 'Good — independent teams and isolated PCI scope justify services. Make sure money-moving events flow reliably between them.',
    'modular-monolith': 'A defensible first step for one team, but six squads, separate PCI scope and independent scaling of card auth favour separate services here.',
    monolith: 'The current monolith is exactly what blocks six teams today.',
    serverless: 'Cold starts and per-invocation limits make 150 ms card authorisations and long-running sagas risky.',
    'service-based':
      'Fewer, coarser services is tempting, but a shared database would pull the ledger and PCI-scoped card data into one schema and one blast radius. With six squads deploying independently and audited isolation, each service needs its own data — which is microservices.',
    'space-based':
      'In-memory balances with write-behind persistence break the core rule: money must be durably recorded before you say yes. 400 tx/s does not justify that trade.',
    microkernel:
      'Card products or transfer rails can be plug-ins inside one service, but the bank is several equally central domains that six squads must release separately.',
  },
  hints: [
    'Give the Ledger its own relational database. Nobody else touches it — they ask the Ledger or listen to its events.',
    'A transfer is debit + credit + fraud check + notification. Who coordinates the steps and compensations? (saga)',
    'Writing to the DB and publishing to the broker are two systems. How do you avoid publishing an event for a rolled-back transaction? (transactional outbox + CDC)',
    'Auditors want replay: choose a broker that retains events, not one that deletes them after consumption.',
    'Add a collector and tracing backend so one transfer can be followed across every service.',
  ],
  checks: [
    {
      id: 'edge-auth',
      title: 'API gateway with an identity provider',
      category: 'core',
      why: 'All customer traffic should enter through one hardened door that validates OAuth2/OIDC tokens issued by a dedicated identity provider (Strong Customer Authentication under PSD2).',
      hint: 'Clients → API gateway; connect the gateway to an Identity provider (Keycloak, Auth0…).',
      concepts: ['api-gateway', 'oauth-oidc'],
      test: (g) => {
        if (!g.has('api-gateway')) return { pass: false, detail: 'No API gateway.' }
        if (!g.has('identity')) return { pass: false, detail: 'No identity provider.' }
        const linked = g.ofKind('api-gateway').some((gw) => g.neighbours(gw.id).some((n) => n.kind === 'identity'))
        const clientsAuth = g.ofKind('web-app', 'mobile-app').some((c) => g.targets(c.id).some((t) => t.kind === 'identity'))
        return linked || clientsAuth
      },
    },
    {
      id: 'ledger-acid',
      title: 'Ledger on an ACID relational store',
      category: 'core',
      why: 'Double-entry postings must be atomic: both legs commit or neither does. Serializable transactions and constraints in a relational DB give you that for free.',
      hint: 'Connect the Ledger owner to a Relational database (PostgreSQL, Oracle, CockroachDB).',
      concepts: ['acid-vs-base'],
      test: (g) => {
        const stores = g.storesOf(g.ownerFamily('ledger'), DB_KINDS)
        if (!stores.length) return { pass: false, detail: 'The ledger has no database.' }
        const relational = stores.filter((s) => s.kind === 'relational-db')
        return relational.length ? true : { pass: false, detail: `Ledger uses ${stores.map((s) => s.label).join(', ')} — not relational.` }
      },
    },
    {
      id: 'ledger-isolated',
      title: 'Ledger database owned exclusively by the ledger',
      category: 'core',
      why: 'If other services write to ledger tables, invariants (debits = credits) can be broken behind the ledger’s back. Database-per-service protects the most critical data you have.',
      hint: 'Only the Ledger service should have a Data edge to its database. Others call its API or consume its events.',
      concepts: ['database-per-service'],
      test: (g) => {
        const fam = g.ownerFamily('ledger')
        const famIds = new Set(fam.map((f) => f.id))
        const stores = g.storesOf(fam, DB_KINDS)
        if (!stores.length) return { pass: false, detail: 'The ledger has no database yet.' }
        const intruders = stores.flatMap((s) => g.sources(s.id, ['data']).filter((x) => !famIds.has(x.id)))
        return intruders.length ? { pass: false, detail: `Also accessed by: ${intruders.map((i) => i.label).join(', ')}` } : true
      },
    },
    {
      id: 'transfer-saga',
      title: 'Transfers coordinated as a saga',
      category: 'core',
      why: 'A transfer spans several services (limits, fraud, ledger, notifications). Without 2PC you need a saga — orchestrated or choreographed — with compensating actions when a step fails.',
      hint: 'Add a Saga orchestrator (Temporal, Camunda) connected to Transfers and Ledger — or choreograph via events through the broker.',
      concepts: ['saga'],
      test: (g) => {
        const transfers = g.ownerFamily('transfers')
        const ledger = g.ownerFamily('ledger')
        const ids = new Set([...transfers, ...ledger].map((n) => n.id))
        const orchestrated = g.ofKind('orchestrator').some((o) => g.neighbours(o.id).some((n) => ids.has(n.id)))
        return orchestrated || g.asyncFlow(transfers, ledger) || g.asyncFlow(ledger, transfers)
      },
    },
    {
      id: 'outbox',
      title: 'Events published via transactional outbox / CDC',
      category: 'core',
      why: 'Writing to the DB and then to Kafka is a dual write: a crash in between loses or invents events. The outbox pattern commits the event with the data and a relay (Debezium) publishes it.',
      hint: 'Database → Outbox relay / CDC → Broker.',
      concepts: ['outbox', 'cdc'],
      test: (g) =>
        g.ofKind('cdc').some(
          (c) => g.sources(c.id).some((s) => DB_KINDS.includes(s.kind)) && g.targets(c.id).some((t) => t.kind === 'broker'),
        ),
    },
    {
      id: 'replayable-log',
      title: 'Event backbone is durable and replayable',
      category: 'core',
      why: 'Fraud models are retrained and projections rebuilt by replaying history. A log-based broker (Kafka, Redpanda, Pulsar) retains events; classic queues delete them after acknowledgement.',
      hint: 'Pick Kafka / Redpanda / Pulsar for the broker.',
      concepts: ['event-sourcing', 'kafka-vs-rabbitmq'],
      test: (g) => {
        const brokers = g.ofKind('broker')
        if (!brokers.length) return { pass: false, detail: 'No broker.' }
        const ok = brokers.some((b) => g.hasTrait(b, 'replayable'))
        const rabbit = brokers.find((b) => b.tech === 'rabbitmq')
        return ok ? true : { pass: false, detail: rabbit ? 'RabbitMQ removes messages once acknowledged — no replay for audits.' : 'Choose a technology with retention & replay.' }
      },
    },
    {
      id: 'fraud-stream',
      title: 'Fraud consumes the money-movement event stream',
      category: 'core',
      why: 'Fraud detection needs every movement in near real time without slowing the ledger. Consuming events decouples its availability from the payment path.',
      hint: 'Route ledger/transfer events through the broker to whatever owns Fraud.',
      concepts: ['event-driven'],
      test: (g) => g.asyncFlow([...g.ownerFamily('ledger'), ...g.ownerFamily('transfers'), ...g.ownerFamily('cards')], g.ownerFamily('fraud')),
    },
    {
      id: 'audit-archive',
      title: 'Immutable audit trail & reporting store',
      category: 'core',
      why: 'Regulators require years of tamper-evident history. Archive the event stream to WORM object storage or a warehouse for reporting.',
      hint: 'Broker → archiver (worker / connector) → Object storage or Analytics warehouse.',
      concepts: ['event-sourcing'],
      test: (g) =>
        g.ofKind('broker').some(
          (b) =>
            !!g.reaches(b, (n) => n.kind === 'object-storage' || n.kind === 'analytics-db', {
              through: ['worker', 'service', 'function', 'stream-processor', 'cdc'],
              maxDepth: 3,
            }),
        ),
    },
    {
      id: 'three-pillars',
      title: 'Traces, metrics and logs',
      category: 'core',
      why: 'When a transfer is "stuck", you need one trace across gateway → transfers → saga → ledger → Kafka → fraud. Metrics for SLOs, logs for detail.',
      hint: 'Add Distributed tracing, Metrics store and Log aggregation (ideally fed by an OTel collector).',
      concepts: ['observability', 'distributed-tracing'],
      test: (g) => observability(g, 'tracing', 'metrics', 'logging'),
    },
    {
      id: 'card-network',
      title: 'Cards integrate with the card network',
      category: 'bonus',
      why: 'Card authorisations arrive from the network/processor and must be answered fast; that integration is a separate, PCI-scoped service.',
      hint: 'Connect the Cards owner to a Third-party API with the "Card network" technology.',
      test: (g) => g.ownerFamily('cards').some((c) => g.neighbours(c.id).some((n) => n.kind === 'external' && (g.hasTrait(n, 'card-network') || /card|visa|master/i.test(n.label)))),
    },
    {
      id: 'kyc',
      title: 'KYC handled by a specialised provider',
      category: 'bonus',
      why: 'Identity verification and sanctions screening are regulated specialities — buy, don’t build.',
      hint: 'Accounts → Third-party API (KYC / AML provider).',
      test: (g) => g.calls(g.ownerFamily('accounts'), (n) => n.kind === 'external' && (g.hasTrait(n, 'kyc') || /kyc|aml|onfido|identity/i.test(n.label))),
    },
    {
      id: 'notifications-async',
      title: 'Notifications are event-driven',
      category: 'bonus',
      why: 'A slow SMS gateway must never delay a transfer. Notifications should react to events.',
      hint: 'Broker → Notifications → push/SMS provider.',
      test: (g) => {
        const notif = g.ownerFamily('notifications')
        if (!g.asyncFlow(g.ofKind(...COMPUTE_KINDS, ...DB_KINDS), notif)) return { pass: false, detail: 'Notifications are not fed by events.' }
        return g.calls(notif, (n) => external(g, 'push', PUSH)(n) || external(g, 'sms', PUSH)(n))
      },
    },
    {
      id: 'secrets',
      title: 'Secrets come from a vault',
      category: 'bonus',
      why: 'DB passwords, signing keys and API tokens must be rotated and audited. A secrets manager with short-lived credentials beats config files.',
      hint: 'Add a Secrets manager and connect services that need credentials.',
      concepts: ['secrets-management'],
      test: (g) => g.ofKind('secrets').some((s) => g.sources(s.id).length > 0),
    },
    {
      id: 'team-skills',
      title: 'Stack leverages the team’s JVM skills',
      category: 'bonus',
      why: 'The best technology is often the one your team can operate at 3 a.m. With a Java/Kotlin team, JVM frameworks lower risk.',
      hint: 'Choose Spring Boot, Quarkus, Micronaut or Ktor for services (set a Backend stack preference and apply it).',
      test: (g) => ecosystemShare(g, 'jvm'),
    },
  ],
  reference: {
    decisions: {
      style: 'event-driven',
      communication: 'hybrid',
      data: 'per-service',
      stack: { frontend: 'react', mobile: 'flutter', backend: 'spring-boot', database: 'postgres', messaging: 'kafka', cache: 'redis' },
      rationale: 'Synchronous gRPC only where an immediate answer is required (card auth, saga steps). Everything else reacts to ledger events published through an outbox into Kafka.',
    },
    walkthrough: [
      'Kong validates Keycloak-issued tokens (SCA) and routes to Accounts, Transfers and Cards. Card authorisations arrive from the card network directly to the PCI-scoped Cards service.',
      'The Ledger is the only writer to its PostgreSQL. Postings are appended in one ACID transaction together with an outbox row.',
      'Debezium tails the ledger WAL and publishes outbox rows to Kafka — no dual writes, no lost events. Consumers are idempotent (dedupe by event id).',
      'A Temporal workflow orchestrates each transfer: reserve funds → fraud check → post to ledger → notify; on failure it runs compensations.',
      'Fraud, Notifications and the Audit archiver consume Kafka. The archiver writes to S3 with Object Lock (WORM) and to Snowflake for regulatory reports.',
      'Every service exports OTLP to an OpenTelemetry Collector which fans out to Tempo, Prometheus and Loki. Vault issues short-lived DB credentials.',
    ],
    diagram: diagram(
      [
        ['web', 'web-app', 'Web Banking', 0, 60, { tech: 'react' }],
        ['mobile', 'mobile-app', 'Mobile App', 0, 220, { tech: 'flutter' }],
        ['gw', 'api-gateway', 'API Gateway', 260, 140, { tech: 'kong' }],
        ['idp', 'identity', 'Identity (SCA)', 260, 320, { tech: 'keycloak' }],
        ['accounts', 'service', 'Accounts', 520, -60, { tech: 'spring-boot', domains: ['accounts'] }],
        ['accountsDb', 'relational-db', 'Accounts DB', 780, -140, { tech: 'postgres' }],
        ['kyc', 'external', 'KYC Provider', 780, -20, { tech: 'kyc-provider' }],
        ['transfers', 'service', 'Transfers', 520, 100, { tech: 'spring-boot', domains: ['transfers'] }],
        ['transfersDb', 'relational-db', 'Transfers DB', 520, 230, { tech: 'postgres' }],
        ['saga', 'orchestrator', 'Transfer Saga', 780, 100, { tech: 'temporal' }],
        ['cards', 'service', 'Cards (PCI)', 520, 360, { tech: 'spring-boot', domains: ['cards'] }],
        ['cardsDb', 'relational-db', 'Cards DB', 520, 490, { tech: 'postgres' }],
        ['network', 'external', 'Card Network', 260, 470, { tech: 'card-network' }],
        ['ledger', 'service', 'Ledger', 1040, 240, { tech: 'spring-boot', domains: ['ledger'] }],
        ['ledgerDb', 'relational-db', 'Ledger DB', 1040, 380, { tech: 'postgres', notes: 'Postings + outbox table' }],
        ['relay', 'cdc', 'Outbox Relay', 1040, 520, { tech: 'debezium' }],
        ['kafka', 'broker', 'Event Backbone', 1300, 520, { tech: 'kafka' }],
        ['fraud', 'service', 'Fraud', 1560, 360, { tech: 'spring-boot', domains: ['fraud'] }],
        ['fraudCache', 'cache', 'Risk Features', 1820, 360, { tech: 'redis' }],
        ['notify', 'service', 'Notifications', 1560, 520, { tech: 'spring-boot', domains: ['notifications'] }],
        ['push', 'external', 'Push / SMS', 1820, 520, { tech: 'twilio' }],
        ['archiver', 'worker', 'Audit Archiver', 1560, 680, { tech: 'spring-boot', domains: ['reporting'] }],
        ['audit', 'object-storage', 'Audit Archive (WORM)', 1820, 640, { tech: 's3' }],
        ['dwh', 'analytics-db', 'Reporting Warehouse', 1820, 760, { tech: 'snowflake' }],
        ['vault', 'secrets', 'Vault', 780, 640, { tech: 'vault' }],
        ['otel', 'otel-collector', 'OTel Collector', 260, 760, { tech: 'otel-collector' }],
        ['tempo', 'tracing', 'Traces', 520, 860, { tech: 'tempo' }],
        ['prom', 'metrics', 'Metrics', 780, 860, { tech: 'prometheus' }],
        ['loki', 'logging', 'Logs', 1040, 860, { tech: 'loki' }],
      ],
      [
        ['web', 'gw'],
        ['mobile', 'gw'],
        ['gw', 'idp', 'http', 'validate tokens'],
        ['gw', 'accounts'],
        ['gw', 'transfers'],
        ['gw', 'cards'],
        ['network', 'cards', 'http', 'ISO 8583 auth'],
        ['accounts', 'accountsDb'],
        ['accounts', 'kyc'],
        ['transfers', 'transfersDb'],
        ['transfers', 'saga', 'grpc', 'start workflow'],
        ['saga', 'accounts', 'grpc', 'check limits'],
        ['saga', 'fraud', 'grpc', 'score'],
        ['saga', 'ledger', 'grpc', 'post entries'],
        ['cards', 'cardsDb'],
        ['cards', 'fraud', 'grpc', 'pre-auth score'],
        ['cards', 'ledger', 'grpc', 'hold funds'],
        ['ledger', 'ledgerDb'],
        ['ledgerDb', 'relay', 'event', 'WAL / outbox'],
        ['relay', 'kafka', 'event'],
        ['kafka', 'fraud', 'event'],
        ['kafka', 'notify', 'event'],
        ['kafka', 'archiver', 'event'],
        ['fraud', 'fraudCache'],
        ['notify', 'push'],
        ['archiver', 'audit'],
        ['archiver', 'dwh'],
        ['ledger', 'vault', 'data', 'db creds'],
        ['cards', 'vault', 'data', 'keys'],
        ['gw', 'otel', 'telemetry'],
        ['accounts', 'otel', 'telemetry'],
        ['transfers', 'otel', 'telemetry'],
        ['cards', 'otel', 'telemetry'],
        ['ledger', 'otel', 'telemetry'],
        ['fraud', 'otel', 'telemetry'],
        ['notify', 'otel', 'telemetry'],
        ['archiver', 'otel', 'telemetry'],
        ['saga', 'otel', 'telemetry'],
        ['otel', 'tempo', 'telemetry'],
        ['otel', 'prom', 'telemetry'],
        ['otel', 'loki', 'telemetry'],
      ],
    ),
  },
}

import type { Scenario } from '../../engine/types'
import type { Graph } from '../../engine/graph'
import { diagram, type EdgeSpec, type NodeSpec } from './builder'

const starterNodes: NodeSpec[] = [
  ['web', 'web-app', 'Customer Portal', 0, 200, { tech: 'angular' }],
  ['gw', 'api-gateway', 'API Gateway', 260, 200, { tech: 'spring-cloud-gateway' }],
  ['users', 'service', 'Users', 520, 0, { tech: 'spring-boot', domains: ['users'] }],
  ['usersDb', 'relational-db', 'Users DB', 780, 0, { tech: 'postgres' }],
  ['orders', 'service', 'Orders', 520, 140, { tech: 'spring-boot', domains: ['orders'] }],
  ['ordersDb', 'relational-db', 'Orders DB', 780, 120, { tech: 'postgres' }],
  ['inventory', 'service', 'Inventory', 520, 280, { tech: 'spring-boot', domains: ['inventory'] }],
  ['inventoryDb', 'relational-db', 'Inventory DB', 780, 300, { tech: 'postgres' }],
  ['billing', 'service', 'Billing', 520, 420, { tech: 'spring-boot', domains: ['billing'] }],
  ['billingDb', 'relational-db', 'Billing DB', 780, 440, { tech: 'postgres' }],
  ['kafka', 'broker', 'Kafka', 1040, 220, { tech: 'kafka' }],
]
const starterEdges: EdgeSpec[] = [
  ['web', 'gw'],
  ['gw', 'users'],
  ['gw', 'orders'],
  ['gw', 'inventory'],
  ['users', 'usersDb'],
  ['orders', 'ordersDb'],
  ['inventory', 'inventoryDb'],
  ['billing', 'billingDb'],
  ['orders', 'inventory', 'grpc', 'reserve stock'],
  ['orders', 'kafka', 'event', 'OrderPlaced'],
  ['kafka', 'billing', 'event'],
  ['kafka', 'inventory', 'event'],
  ['billing', 'kafka', 'event', 'InvoiceIssued'],
]

const OBS_SINKS = ['otel-collector', 'logging', 'metrics', 'tracing'] as const

function feeds(g: Graph, kind: 'tracing' | 'metrics' | 'logging') {
  const targets = g.ofKind(kind)
  if (!targets.length) return { pass: false, detail: `No ${kind} backend.` }
  const fed = targets.some((t) => g.in(t.id, ['telemetry']).length > 0)
  return fed ? { pass: true } : { pass: false, detail: 'Nothing sends telemetry to it.' }
}

export const observabilityRetrofit: Scenario = {
  id: 'incident-zero',
  title: 'Incident Zero: make it observable',
  tagline: 'An existing microservice system is a black box. Add logs, metrics, traces and alerts.',
  industry: 'SaaS operations',
  difficulty: 'intermediate',
  estMinutes: 25,
  accent: '#f43f5e',
  concepts: ['observability', 'distributed-tracing', 'slo', 'opentelemetry'],
  story:
    'Last Friday orders silently failed for 3 hours. Customers noticed before engineers did. Each service logs to its own container stdout, nobody can tell whether the slowness was in Orders, Inventory or Kafka, and the post-mortem concluded: "we are flying blind". You are given the current architecture (already on the canvas) and asked to retrofit a vendor-neutral observability platform.',
  facts: [
    { label: 'Services', value: '4 Spring Boot services + Kafka' },
    { label: 'Traffic', value: '~800 rps at peak' },
    { label: 'Team', value: '1 platform team, 3 product teams' },
    { label: 'Goal', value: 'Detect incidents in < 5 minutes' },
  ],
  functional: [
    'Follow one request across gateway, services and Kafka',
    'Dashboards for request rate, errors and latency per service (RED)',
    'Searchable centralised logs correlated with traces',
    'Alerts routed to on-call when SLOs burn',
  ],
  nonFunctional: [
    'Vendor-neutral instrumentation — the company may switch vendors later',
    'Low overhead on services (sampling allowed)',
    'Kafka consumer lag must be visible',
  ],
  constraints: ['Do not redesign the business services', 'Prefer open standards (OpenTelemetry)'],
  domains: [
    { id: 'users', label: 'Users', description: 'Existing' },
    { id: 'orders', label: 'Orders', description: 'Existing' },
    { id: 'inventory', label: 'Inventory', description: 'Existing' },
    { id: 'billing', label: 'Billing', description: 'Existing' },
  ],
  recommendedStyles: ['microservices', 'event-driven'],
  styleFeedback: {
    microservices: 'Correct — the system already is microservices; this mission is about seeing inside it.',
    'event-driven': 'Fair description of the existing Kafka-based flows.',
    'modular-monolith': 'Interesting thought, but re-architecting is out of scope. Observe what exists first.',
    monolith: 'Out of scope — keep the existing services.',
    serverless: 'Out of scope — keep the existing services.',
    'service-based':
      'Out of scope — the system already runs as four services with their own data. Renaming the style will not find the next three-hour outage; instrumentation will.',
    'space-based':
      'Out of scope — keep the existing services and make them observable.',
    microkernel:
      'Out of scope — keep the existing services and make them observable.',
  },
  starter: diagram(starterNodes, starterEdges),
  starterDecisions: { stack: { backend: 'spring-boot', frontend: 'angular', database: 'postgres', messaging: 'kafka' } },
  hints: [
    'Instrument every service (and the gateway) with OpenTelemetry and send OTLP to a Collector.',
    'The Collector fans out: traces → Tempo/Jaeger, metrics → Prometheus, logs → Loki/ELK.',
    'Dashboards read from the backends; alerts fire from metrics (SLO burn rate) to on-call.',
    'Kafka is part of the request path too: export its metrics to see consumer lag.',
  ],
  checks: [
    {
      id: 'collector',
      title: 'Telemetry collector in place',
      category: 'core',
      why: 'A collector decouples apps from backends: instrument once with OTLP, route anywhere, add sampling and redaction centrally.',
      hint: 'Add a Telemetry collector (OpenTelemetry Collector).',
      concepts: ['opentelemetry'],
      test: (g) => g.has('otel-collector'),
    },
    {
      id: 'all-instrumented',
      title: 'Every service and the gateway export telemetry',
      category: 'core',
      why: 'One uninstrumented hop breaks the trace and hides exactly the service that is failing.',
      hint: 'Draw a Telemetry edge from every service and the gateway to the collector.',
      concepts: ['distributed-tracing'],
      test: (g) => {
        const must = g.ofKind('service', 'api-gateway')
        const inst = new Set(g.instrumented().map((n) => n.id))
        const missing = must.filter((m) => !inst.has(m.id))
        return missing.length ? { pass: false, detail: `Not instrumented: ${missing.map((m) => m.label).join(', ')}` } : true
      },
    },
    { id: 'traces', title: 'Traces stored in a tracing backend', category: 'core', why: 'Traces show where time goes across hops — the fastest path to root cause.', hint: 'Collector → Distributed tracing (Tempo, Jaeger).', concepts: ['distributed-tracing'], test: (g) => feeds(g, 'tracing') },
    { id: 'metrics', title: 'Metrics stored in a metrics backend', category: 'core', why: 'RED/USE metrics and SLIs are what you alert on.', hint: 'Collector → Metrics store (Prometheus, Mimir).', concepts: ['slo'], test: (g) => feeds(g, 'metrics') },
    { id: 'logs', title: 'Logs centralised', category: 'core', why: 'Structured logs with trace ids give the detail behind a failing span.', hint: 'Collector → Log aggregation (Loki, ELK).', concepts: ['observability'], test: (g) => feeds(g, 'logging') },
    {
      id: 'alerting',
      title: 'Alerts routed to on-call',
      category: 'core',
      why: 'If nobody is paged, the dashboards are just wallpaper. Alert on symptoms (SLO burn), not on every CPU spike.',
      hint: 'Metrics → Alerting (Alertmanager / PagerDuty).',
      concepts: ['slo'],
      test: (g) => g.ofKind('alerting').some((a) => g.neighbours(a.id).some((n) => n.kind === 'metrics' || n.kind === 'dashboards')),
    },
    {
      id: 'dashboards',
      title: 'Dashboards over the telemetry',
      category: 'bonus',
      why: 'A shared dashboard per service (RED) is the starting point of every incident call.',
      hint: 'Connect Dashboards (Grafana) to metrics, traces and logs.',
      test: (g) => g.ofKind('dashboards').some((d) => g.neighbours(d.id).some((n) => (OBS_SINKS as readonly string[]).includes(n.kind))),
    },
    {
      id: 'kafka-lag',
      title: 'Kafka exports metrics (consumer lag)',
      category: 'bonus',
      why: 'Async flows fail silently: the producer is happy while the consumer is hours behind. Consumer lag is the key signal.',
      hint: 'Telemetry edge from the broker to the collector or metrics store.',
      test: (g) => g.ofKind('broker').some((b) => g.out(b.id, ['telemetry']).length > 0),
    },
    {
      id: 'vendor-neutral',
      title: 'Vendor-neutral collector (OTLP)',
      category: 'bonus',
      why: 'OpenTelemetry keeps instrumentation portable — switching from Grafana stack to Datadog becomes a collector config change.',
      hint: 'Choose OpenTelemetry Collector or Grafana Alloy.',
      concepts: ['opentelemetry'],
      test: (g) => g.ofKind('otel-collector').some((c) => g.hasTrait(c, 'otlp')),
    },
  ],
  reference: {
    decisions: {
      style: 'microservices',
      communication: 'hybrid',
      data: 'per-service',
      stack: { backend: 'spring-boot', frontend: 'angular', database: 'postgres', messaging: 'kafka' },
      rationale: 'OpenTelemetry Java agent everywhere, one collector pipeline, Grafana LGTM stack as backends.',
    },
    walkthrough: [
      'The OpenTelemetry Java agent auto-instruments HTTP, gRPC, JDBC and Kafka clients in every service and the gateway — trace context propagates through Kafka headers.',
      'All signals go via OTLP to the OpenTelemetry Collector, which batches, samples (tail sampling keeps errors) and routes them.',
      'Tempo stores traces, Prometheus/Mimir metrics, Loki logs (with trace ids for correlation). Grafana ties them together.',
      'Alertmanager fires SLO burn-rate alerts to PagerDuty; Kafka exporter publishes consumer lag.',
    ],
    diagram: diagram(
      [
        ...starterNodes,
        ['otel', 'otel-collector', 'OTel Collector', 1040, 520, { tech: 'otel-collector' }],
        ['tempo', 'tracing', 'Traces', 1300, 400, { tech: 'tempo' }],
        ['prom', 'metrics', 'Metrics', 1300, 520, { tech: 'prometheus' }],
        ['loki', 'logging', 'Logs', 1300, 640, { tech: 'loki' }],
        ['grafana', 'dashboards', 'Grafana', 1560, 520, { tech: 'grafana' }],
        ['alerts', 'alerting', 'Alertmanager', 1560, 660, { tech: 'alertmanager' }],
        ['pd', 'external', 'PagerDuty', 1820, 660, { tech: 'generic-api' }],
      ],
      [
        ...starterEdges,
        ['gw', 'otel', 'telemetry'],
        ['users', 'otel', 'telemetry'],
        ['orders', 'otel', 'telemetry'],
        ['inventory', 'otel', 'telemetry'],
        ['billing', 'otel', 'telemetry'],
        ['kafka', 'otel', 'telemetry', 'consumer lag'],
        ['otel', 'tempo', 'telemetry'],
        ['otel', 'prom', 'telemetry'],
        ['otel', 'loki', 'telemetry'],
        ['grafana', 'tempo', 'http'],
        ['grafana', 'prom', 'http'],
        ['grafana', 'loki', 'http'],
        ['prom', 'alerts', 'telemetry', 'SLO burn'],
        ['alerts', 'pd', 'http'],
      ],
    ),
  },
}

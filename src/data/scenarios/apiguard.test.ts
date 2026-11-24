import { describe, expect, it } from 'vitest'
import { assertScenarioContract } from '../../engine/scenarioContract'
import { evaluateScenario } from '../../engine/evaluate'
import type { Decisions, Diagram, DiagramNode, Protocol } from '../../engine/types'
import { diagram } from './builder'
import { apiGuard } from './apiguard'

const ref = apiGuard.reference.diagram
const decisions = apiGuard.reference.decisions

function run(d: Diagram, dec: Decisions = decisions) {
  const ev = evaluateScenario(apiGuard, d, dec)
  const byId = Object.fromEntries(ev.results.map((r) => [r.id, r]))
  return { ev, pass: (id: string) => byId[id]?.pass, byId }
}

/** Copy of the reference with tweaks: drop nodes/edges, patch nodes, add edges. */
function variant(opts: {
  dropNodes?: string[]
  dropEdges?: [string, string][]
  patch?: Record<string, Partial<DiagramNode>>
  addEdges?: [string, string, Protocol][]
}): Diagram {
  const drop = new Set(opts.dropNodes ?? [])
  const nodes = ref.nodes.filter((n) => !drop.has(n.id)).map((n) => ({ ...n, ...(opts.patch?.[n.id] ?? {}) }))
  const ids = new Set(nodes.map((n) => n.id))
  const edges = ref.edges.filter(
    (e) => ids.has(e.source) && ids.has(e.target) && !(opts.dropEdges ?? []).some(([s, t]) => s === e.source && t === e.target),
  )
  for (const [s, t, p] of opts.addEdges ?? []) edges.push({ id: `x-${s}-${t}`, source: s, target: t, protocol: p })
  return { nodes, edges }
}

const CORE = ['rate-limited-entry', 'shared-limit-store', 'idempotent-charges', 'reports-isolated', 'async-webhooks', 'domains-owned', 'style-fit']

describe('fintly-public-api', () => {
  assertScenarioContract(apiGuard)

  it('reference passes every scenario check', () => {
    const { ev } = run(ref)
    expect(ev.results.filter((r) => !r.pass)).toEqual([])
  })

  // --- Plausible-but-wrong designs -------------------------------------------

  it('a plain reverse proxy (Caddy) without rate limiting fails the entry check', () => {
    const { pass, ev } = run(variant({ patch: { gw: { tech: 'caddy' } } }))
    expect(pass('rate-limited-entry')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('per-replica in-memory limits (no shared counter store) fail', () => {
    const { pass, ev } = run(variant({ dropNodes: ['limits'] }))
    expect(pass('rate-limited-entry')).toBe(true)
    expect(pass('shared-limit-store')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('merchant servers calling Charges directly bypass the limiter', () => {
    const { pass } = run(variant({ addEdges: [['merchants', 'charges', 'http']] }))
    expect(pass('rate-limited-entry')).toBe(false)
  })

  it('webhooks sent inline from Charges fail async delivery and trip the anti-pattern', () => {
    const d = variant({
      dropNodes: ['hooks', 'dlq'],
      patch: { charges: { domains: ['charges', 'webhooks'] } },
      addEdges: [['charges', 'endpoints', 'http']],
    })
    const { pass, ev } = run(d)
    expect(pass('async-webhooks')).toBe(false)
    expect(pass('anti-inline-webhooks')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('a webhook worker called synchronously by Charges is not async', () => {
    const d = variant({ dropEdges: [['bus', 'hooks']], addEdges: [['charges', 'hooks', 'http']] })
    expect(run(d).pass('async-webhooks')).toBe(false)
  })

  it('reports querying the charges database fail isolation and share a DB', () => {
    const d = variant({ dropNodes: ['reports'], dropEdges: [['bus', 'reporting']], addEdges: [['reporting', 'chargesDb', 'data']] })
    const { pass, ev } = run(d)
    expect(pass('reports-isolated')).toBe(false)
    expect(pass('anti-shared-db')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('reports built by calling the Charges API synchronously fail isolation', () => {
    const d = variant({ dropEdges: [['bus', 'reporting']], addEdges: [['reporting', 'charges', 'http']] })
    expect(run(d).pass('reports-isolated')).toBe(false)
  })

  it('idempotency keys kept only in a cache fail', () => {
    const d = variant({ dropNodes: ['chargesDb'], addEdges: [['charges', 'limits', 'data']] })
    const { pass, byId } = run(d)
    expect(pass('idempotent-charges')).toBe(false)
    expect(byId['idempotent-charges'].detail).toMatch(/cache/)
  })

  it('one service owning everything fails isolation and webhooks', () => {
    const d = diagram(
      [
        ['web', 'web-app', 'Dashboard', 0, 0, { tech: 'react' }],
        ['sdk', 'mobile-app', 'SDK', 0, 120, { tech: 'flutter' }],
        ['gw', 'api-gateway', 'Gateway', 260, 60, { tech: 'kong' }],
        ['api', 'service', 'Payments API', 520, 60, { tech: 'go', domains: ['merchants', 'charges', 'webhooks', 'reporting'] }],
        ['db', 'relational-db', 'DB', 800, 60, { tech: 'postgres' }],
      ],
      [
        ['web', 'gw'],
        ['sdk', 'gw'],
        ['gw', 'api'],
        ['api', 'db'],
      ],
    )
    const { pass } = run(d)
    expect(pass('shared-limit-store')).toBe(false)
    expect(pass('reports-isolated')).toBe(false)
    expect(pass('async-webhooks')).toBe(false)
  })

  // --- Alternative valid designs --------------------------------------------

  it('alternative: modular monolith + Envoy rate-limit service + CDC-fed reports passes all core checks', () => {
    const d = diagram(
      [
        ['web', 'web-app', 'Dashboard', 0, 60, { tech: 'vue' }],
        ['sdk', 'mobile-app', 'Mobile SDK', 0, 200, { tech: 'flutter' }],
        ['shops', 'external', 'Shop Backends', 0, 340, { tech: 'generic-api' }],
        ['lb', 'load-balancer', 'Load Balancer', 260, 40, { tech: 'aws-alb' }],
        ['gw', 'api-gateway', 'Envoy Gateway', 260, 200, { tech: 'envoy' }],
        ['rls', 'function', 'Rate Limit Service', 260, 360, { tech: 'aws-lambda' }],
        ['valkey', 'cache', 'Quota Counters', 260, 500, { tech: 'valkey' }],
        ['idp', 'identity', 'API Key Auth', 520, -80, { tech: 'keycloak' }],
        ['app', 'monolith', 'Fintly Core', 520, 40, { tech: 'spring-boot', w: 480, h: 320 }],
        ['acc', 'module', 'Accounts', 30, 60, { parent: 'app', tech: 'spring-boot', domains: ['merchants'] }],
        ['chg', 'module', 'Charges', 260, 60, { parent: 'app', tech: 'spring-boot', domains: ['charges'] }],
        ['rep', 'module', 'Reporting', 30, 200, { parent: 'app', tech: 'spring-boot', domains: ['reporting'] }],
        ['whk', 'module', 'Webhooks', 260, 200, { parent: 'app', tech: 'spring-boot', domains: ['webhooks'] }],
        ['pg', 'relational-db', 'Core DB', 1120, 60, { tech: 'postgres' }],
        ['psp', 'external', 'Acquirer', 1120, -80, { tech: 'adyen' }],
        ['cdc', 'cdc', 'Debezium', 1120, 200, { tech: 'debezium' }],
        ['olap', 'analytics-db', 'Reports', 1120, 340, { tech: 'clickhouse' }],
        ['mq', 'broker', 'Webhook Queue', 1120, 480, { tech: 'rabbitmq' }],
        ['metrics', 'metrics', 'Metrics', 520, 640, { tech: 'prometheus' }],
        ['pager', 'alerting', 'Pager', 780, 640, { tech: 'pagerduty' }],
      ],
      [
        ['web', 'lb'],
        ['sdk', 'lb'],
        ['shops', 'lb', 'http'],
        ['lb', 'gw'],
        ['gw', 'rls', 'grpc'],
        ['rls', 'valkey'],
        ['gw', 'idp'],
        ['gw', 'app'],
        ['acc', 'pg'],
        ['chg', 'pg'],
        ['chg', 'psp'],
        ['pg', 'cdc'],
        ['cdc', 'olap'],
        ['rep', 'olap'],
        ['chg', 'mq', 'event'],
        ['mq', 'whk', 'event'],
        ['whk', 'shops', 'http'],
        ['gw', 'metrics', 'telemetry'],
        ['app', 'metrics', 'telemetry'],
        ['metrics', 'pager', 'telemetry'],
      ],
    )
    const dec: Decisions = { style: 'modular-monolith', communication: 'hybrid', data: 'shared', stack: { backend: 'spring-boot' } }
    const { pass, ev } = run(d, dec)
    for (const id of CORE) expect(pass(id), id).toBe(true)
    expect(pass('anti-inline-webhooks')).toBe(true)
    expect(pass('anti-shared-db')).toBe(true)
    expect(pass('webhook-dlq')).toBe(true) // RabbitMQ dead-letters natively
    expect(pass('reports-sheddable')).toBe(false) // same deployable — honest trade-off
    expect(ev.passed).toBe(true)
  })

  it('alternative: Hermes push-delivery broker owning webhooks + read replica for reports passes core', () => {
    const d = variant({
      dropNodes: ['hooks', 'dlq', 'reports'],
      dropEdges: [['bus', 'reporting'], ['charges', 'bus']],
      patch: { bus: { tech: 'hermes', label: 'Hermes', domains: ['webhooks'] } },
      addEdges: [
        ['charges', 'bus', 'event'],
        ['bus', 'endpoints', 'http'],
      ],
    })
    d.nodes.push({ id: 'replica', kind: 'relational-db', label: 'Reports Replica', tech: 'postgres', domains: [], x: 1120, y: 440 })
    d.edges.push(
      { id: 'r1', source: 'chargesDb', target: 'replica', protocol: 'data', label: 'streaming replication' },
      { id: 'r2', source: 'reporting', target: 'replica', protocol: 'data' },
    )
    const { pass, ev } = run(d)
    for (const id of CORE) expect(pass(id), id).toBe(true)
    expect(pass('webhook-dlq')).toBe(true)
    expect(ev.passed).toBe(true)
  })

  // --- Regression: fairness of the entry / limiter checks ----------------------

  it.each(['aws-api-gateway', 'apigee'])('a managed gateway (%s) with no cache passes the shared-limit check', (tech) => {
    const { pass, ev } = run(variant({ dropNodes: ['limits'], patch: { gw: { tech } } }))
    expect(pass('shared-limit-store')).toBe(true)
    for (const id of CORE) expect(pass(id), id).toBe(true)
    expect(ev.passed).toBe(true)
  })

  it.each(['hazelcast', 'memcached', 'valkey'])('Spring Cloud Gateway with %s counters passes the shared-limit check', (cache) => {
    const { pass } = run(variant({ patch: { gw: { tech: 'spring-cloud-gateway' }, limits: { tech: cache } } }))
    expect(pass('shared-limit-store')).toBe(true)
  })

  it('a CDN → WAF → LB → gateway edge chain passes the entry check', () => {
    const d = variant({ dropEdges: [['dashboard', 'gw'], ['sdk', 'gw'], ['merchants', 'gw']] })
    d.nodes.push(
      { id: 'cdn', kind: 'cdn', label: 'CDN', tech: 'cloudfront', domains: [], x: 0, y: -100 },
      { id: 'waf', kind: 'waf', label: 'WAF', tech: 'aws-waf', domains: [], x: 260, y: -100 },
      { id: 'lb', kind: 'load-balancer', label: 'ALB', tech: 'aws-alb', domains: [], x: 520, y: -100 },
    )
    d.edges.push(
      { id: 'c1', source: 'dashboard', target: 'cdn', protocol: 'http' },
      { id: 'c2', source: 'sdk', target: 'cdn', protocol: 'http' },
      { id: 'c3', source: 'merchants', target: 'cdn', protocol: 'http' },
      { id: 'c4', source: 'cdn', target: 'waf', protocol: 'http' },
      { id: 'c5', source: 'waf', target: 'lb', protocol: 'http' },
      { id: 'c6', source: 'lb', target: 'gw', protocol: 'http' },
    )
    const { pass, byId } = run(d)
    expect(pass('rate-limited-entry'), byId['rate-limited-entry'].detail).toBe(true)
    for (const id of CORE) expect(pass(id), id).toBe(true)
  })

  it('merchant servers sneaking past the gateway through a load balancer fail', () => {
    const d = variant({ dropEdges: [['merchants', 'gw']] })
    d.nodes.push({ id: 'lb', kind: 'load-balancer', label: 'ALB', tech: 'aws-alb', domains: [], x: 260, y: 520 })
    d.edges.push(
      { id: 'b1', source: 'merchants', target: 'lb', protocol: 'http' },
      { id: 'b2', source: 'lb', target: 'charges', protocol: 'http' },
    )
    expect(run(d).pass('rate-limited-entry')).toBe(false)
  })

  it('a client whose load balancer also routes straight to Charges fails', () => {
    const d = variant({ dropEdges: [['dashboard', 'gw']] })
    d.nodes.push({ id: 'lb', kind: 'load-balancer', label: 'ALB', tech: 'aws-alb', domains: [], x: 260, y: 520 })
    d.edges.push(
      { id: 'b1', source: 'dashboard', target: 'lb', protocol: 'http' },
      { id: 'b2', source: 'lb', target: 'gw', protocol: 'http' },
      { id: 'b3', source: 'lb', target: 'charges', protocol: 'http' },
    )
    expect(run(d).pass('rate-limited-entry')).toBe(false)
  })

  it('untyped merchant nodes labelled "checkout" are still merchants, not a PSP', () => {
    const ok = run(
      variant({
        patch: { merchants: { label: 'Merchant checkout backends', tech: undefined }, endpoints: { label: 'Merchant payment webhooks', tech: undefined } },
      }),
    )
    for (const id of CORE) expect(ok.pass(id), id).toBe(true)
    const bypass = run(
      variant({ patch: { merchants: { label: 'Merchant checkout backends', tech: undefined } }, addEdges: [['merchants', 'charges', 'http']] }),
    )
    expect(bypass.pass('rate-limited-entry')).toBe(false)
  })

  it('an acquirer modelled as a generic API that calls back through the gateway is not a merchant', () => {
    const { ev } = run(variant({ patch: { acquirer: { tech: 'generic-api' } }, addEdges: [['acquirer', 'gw', 'http']] }))
    expect(ev.results.filter((r) => !r.pass)).toEqual([])
  })

  // --- Regression: gaming attempts ---------------------------------------------

  it('an API-key cache on Accounts is not a shared limiter store', () => {
    const d = variant({ dropEdges: [['gw', 'limits']], addEdges: [['accounts', 'limits', 'data']] })
    expect(run(d).pass('shared-limit-store')).toBe(false)
  })

  it('a cache is not a reporting read model', () => {
    const d = variant({ patch: { reports: { kind: 'cache', tech: 'redis' } } })
    expect(run(d).pass('reports-isolated')).toBe(false)
  })

  it('Charges calling a receive-only merchant webhook endpoint inline trips the anti-pattern', () => {
    const d = variant({ addEdges: [['charges', 'endpoints', 'http']] })
    expect(run(d).pass('anti-inline-webhooks')).toBe(false)
  })

  it('Charges calling an untyped "Merchant webhook endpoints" node inline trips the anti-pattern', () => {
    const d = variant({
      dropEdges: [['hooks', 'endpoints']],
      patch: { endpoints: { tech: undefined, label: 'Merchant webhook endpoints' } },
      addEdges: [['charges', 'endpoints', 'http']],
    })
    expect(run(d).pass('anti-inline-webhooks')).toBe(false)
  })

  // --- Bonus checks fail when their point is missing -----------------------------

  it('webhook-dlq fails for a Kafka consumer with nowhere to park failures', () => {
    expect(run(variant({ dropNodes: ['dlq'] })).pass('webhook-dlq')).toBe(false)
  })

  it('api-key-auth fails when the gateway never consults accounts or identity', () => {
    expect(run(variant({ dropEdges: [['gw', 'accounts']] })).pass('api-key-auth')).toBe(false)
  })

  it('throttle-alerting fails without gateway metrics, or with gateway telemetry only in logs', () => {
    expect(run(variant({ dropEdges: [['gw', 'prom']] })).pass('throttle-alerting')).toBe(false)
    const logsOnly = variant({ dropEdges: [['gw', 'prom']] })
    logsOnly.nodes.push({ id: 'loki', kind: 'logging', label: 'Logs', tech: 'loki', domains: [], x: 520, y: 760 })
    logsOnly.edges.push({ id: 'l1', source: 'gw', target: 'loki', protocol: 'telemetry' })
    expect(run(logsOnly).pass('throttle-alerting')).toBe(false)
    expect(run(variant({ dropEdges: [['prom', 'alerts']] })).pass('throttle-alerting')).toBe(false)
  })

  it('throttle-alerting accepts gateway telemetry via an OpenTelemetry Collector', () => {
    const d = variant({ dropEdges: [['gw', 'prom']] })
    d.nodes.push({ id: 'otel', kind: 'otel-collector', label: 'Collector', tech: 'otel-collector', domains: [], x: 520, y: 760 })
    d.edges.push(
      { id: 'o1', source: 'gw', target: 'otel', protocol: 'telemetry' },
      { id: 'o2', source: 'otel', target: 'prom', protocol: 'telemetry' },
    )
    expect(run(d).pass('throttle-alerting')).toBe(true)
  })

  it('reports-sheddable fails when Charges also serves reports', () => {
    const d = variant({ dropNodes: ['reporting', 'reports'], patch: { charges: { domains: ['charges', 'reporting'] } } })
    const { pass } = run(d)
    expect(pass('reports-sheddable')).toBe(false)
    expect(pass('reports-isolated')).toBe(false)
  })

  // --- More valid alternatives -----------------------------------------------------

  it('alternative: SQS queue + Lambda sender owning webhooks', () => {
    const d = variant({ dropNodes: ['hooks', 'dlq'] })
    d.nodes.push(
      { id: 'sqs', kind: 'broker', label: 'Webhook Queue', tech: 'sqs', domains: [], x: 860, y: 560 },
      { id: 'sender', kind: 'function', label: 'Webhook Sender', tech: 'aws-lambda', domains: ['webhooks'], x: 1120, y: 680 },
    )
    d.edges.push(
      { id: 's1', source: 'charges', target: 'sqs', protocol: 'event' },
      { id: 's2', source: 'sqs', target: 'sender', protocol: 'event' },
      { id: 's3', source: 'sender', target: 'endpoints', protocol: 'http' },
    )
    const { pass, ev } = run(d)
    for (const id of CORE) expect(pass(id), id).toBe(true)
    expect(pass('webhook-dlq')).toBe(true)
    expect(pass('anti-inline-webhooks')).toBe(true)
    expect(ev.passed).toBe(true)
  })

  it('alternative: transactional outbox — Charges DB → Debezium → Kafka → worker passes', () => {
    const d = variant({ dropEdges: [['charges', 'bus']] })
    d.nodes.push({ id: 'cdc', kind: 'cdc', label: 'Outbox Relay', tech: 'debezium', domains: [], x: 1380, y: 330 })
    d.edges.push(
      { id: 'o1', source: 'chargesDb', target: 'cdc', protocol: 'data' },
      { id: 'o2', source: 'cdc', target: 'bus', protocol: 'event' },
    )
    const { pass, ev } = run(d)
    for (const id of CORE) expect(pass(id), id).toBe(true)
    expect(ev.passed).toBe(true)
  })

  it('alternative: a webhook worker polling the outbox table in the Charges DB passes async delivery', () => {
    const d = variant({ dropEdges: [['bus', 'hooks']], addEdges: [['hooks', 'chargesDb', 'data']] })
    const { pass, byId } = run(d)
    expect(pass('async-webhooks'), byId['async-webhooks'].detail).toBe(true)
    expect(pass('anti-shared-db')).toBe(true)
  })

  it('checks do not throw on odd graphs', () => {
    const odd: Diagram = {
      nodes: [
        { id: 'a', kind: 'api-gateway', label: 'GW', domains: ['charges'], x: 0, y: 0 },
        { id: 'b', kind: 'external', label: 'X', domains: ['webhooks', 'reporting'], x: 0, y: 0 },
      ],
      edges: [{ id: 'e', source: 'a', target: 'missing', protocol: 'http' }],
    }
    const { ev } = run(odd, { stack: {} })
    expect(ev.results.every((r) => !r.detail?.startsWith('Check failed to run'))).toBe(true)
    expect(ev.passed).toBe(false)
  })
})

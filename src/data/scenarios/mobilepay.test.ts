import { describe, expect, it } from 'vitest'
import { assertScenarioContract } from '../../engine/scenarioContract'
import { evaluateScenario } from '../../engine/evaluate'
import type { Decisions, Diagram, Protocol } from '../../engine/types'
import { diagram } from './builder'
import { mobilePayScheme } from './mobilepay'

const decisions = mobilePayScheme.reference.decisions

function results(d: Diagram, dec: Decisions = decisions) {
  const ev = evaluateScenario(mobilePayScheme, d, dec)
  return { ev, byId: Object.fromEntries(ev.results.map((r) => [r.id, r])) }
}

/** Reference diagram with some edges removed and others added. */
function variant(drop: [string, string][], add: [string, string, Protocol][] = [], mutate?: (d: Diagram) => void): Diagram {
  const ref = structuredClone(mobilePayScheme.reference.diagram)
  ref.edges = ref.edges.filter((e) => !drop.some(([s, t]) => e.source === s && e.target === t))
  add.forEach(([source, target, protocol], i) => ref.edges.push({ id: `extra-${i}`, source, target, protocol }))
  mutate?.(ref)
  return ref
}

describe('kodpay-scheme', () => {
  assertScenarioContract(mobilePayScheme)

  it('synchronous design: switch posts to the ledger and answers the acquirer inline', () => {
    const d = diagram(
      [
        ['issuer', 'external', 'Issuing Bank', 0, 0, { tech: 'generic-api' }],
        ['acquirer', 'external', 'Acquirer', 0, 200, { tech: 'payu' }],
        ['gw', 'api-gateway', 'Gateway', 260, 100, { tech: 'kong' }],
        ['codes', 'service', 'Codes', 520, 0, { tech: 'go', domains: ['codes'] }],
        ['codeCache', 'cache', 'Codes', 800, 0, { tech: 'redis' }],
        ['switch', 'service', 'Switch', 520, 100, { tech: 'go', domains: ['authorization', 'result-delivery'] }],
        ['stateDb', 'relational-db', 'State', 800, 100, { tech: 'postgres' }],
        ['fraud', 'service', 'Fraud', 520, 200, { tech: 'go', domains: ['fraud'] }],
        ['features', 'cache', 'Features', 800, 200, { tech: 'redis' }],
        ['settlement', 'service', 'Settlement', 520, 300, { tech: 'spring-boot', domains: ['settlement'] }],
        ['ledger', 'relational-db', 'Ledger', 800, 300, { tech: 'postgres' }],
      ],
      [
        ['issuer', 'gw'],
        ['acquirer', 'gw'],
        ['gw', 'codes'],
        ['gw', 'switch'],
        ['codes', 'codeCache'],
        ['switch', 'codes', 'grpc'],
        ['switch', 'fraud', 'grpc'],
        ['switch', 'issuer'],
        ['switch', 'stateDb'],
        ['fraud', 'features'],
        ['switch', 'settlement', 'grpc', 'post entries'],
        ['settlement', 'ledger'],
      ],
    )
    const { ev, byId } = results(d, { ...decisions, style: 'microservices' })
    expect(byId['merchant-callback'].pass).toBe(false)
    expect(byId['settlement-ledger'].pass).toBe(false)
    expect(byId['anti-ledger-hot-path'].pass).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('codes in a relational table and acquirers calling the switch directly', () => {
    const d = variant(
      [
        ['codes', 'codeCache'],
        ['acquirer', 'gw'],
      ],
      [
        ['codes', 'stateDb', 'data'],
        ['acquirer', 'switch', 'http'],
      ],
      (dg) => {
        // a dedicated codes table instead of the TTL cache
        dg.nodes.push({ id: 'codesDb', kind: 'relational-db', label: 'Codes table', tech: 'postgres', domains: [], x: 800, y: -120 })
        dg.edges = dg.edges.filter((e) => !(e.source === 'codes' && e.target === 'stateDb'))
        dg.edges.push({ id: 'codes-db', source: 'codes', target: 'codesDb', protocol: 'data' })
      },
    )
    const { ev, byId } = results(d)
    expect(byId['partner-gateway'].pass).toBe(false)
    expect(byId['code-registry-ttl'].pass).toBe(false)
    expect(byId['code-registry-ttl'].detail).toMatch(/Codes table/)
    expect(ev.passed).toBe(false)
  })

  it('fraud scored only after the fact from the event stream', () => {
    const d = variant([['switch', 'fraud']], [['kafka', 'fraud', 'event']])
    const { ev, byId } = results(d)
    expect(byId['fraud-inline'].pass).toBe(false)
    expect(byId['fraud-features-stream'].pass).toBe(true)
    expect(ev.passed).toBe(false)
  })

  it('reference scores 100', () => {
    const { ev } = results(mobilePayScheme.reference.diagram)
    const failed = ev.results.filter((r) => !r.pass).map((r) => `${r.id}: ${r.detail ?? ''}`)
    expect(failed, failed.join('\n')).toEqual([])
  })

  it('no callback path from the bank back to the switch (acquirer entry path intact)', () => {
    // The bank can be called but never answers into the scheme; gw → switch stays for acquirers.
    const d = variant([['issuer', 'gw']])
    const { ev, byId } = results(d)
    expect(byId['issuer-roundtrip'].pass).toBe(false)
    expect(byId['issuer-roundtrip'].detail).toMatch(/no way back/)
    expect(byId['partner-gateway'].pass).toBe(true)
    expect(ev.passed).toBe(false)
  })

  it('payment state kept only in the codes TTL cache is not durable state', () => {
    const d = variant([['switch', 'stateDb']], [['switch', 'codeCache', 'data']])
    const { byId } = results(d)
    expect(byId['issuer-roundtrip'].pass).toBe(false)
    expect(byId['issuer-roundtrip'].detail).toMatch(/durable database/)
  })

  it('webhooks routed through the partner gateway as egress still count as callbacks', () => {
    const d = variant(
      [
        ['delivery', 'egress'],
        ['egress', 'acquirer'],
      ],
      [
        ['delivery', 'gw', 'http'],
        ['gw', 'acquirer', 'http'],
      ],
    )
    d.nodes = d.nodes.filter((n) => n.id !== 'egress')
    const { ev, byId } = results(d)
    expect(byId['merchant-callback'].pass, byId['merchant-callback'].detail).toBe(true)
    expect(byId['issuer-roundtrip'].pass, byId['issuer-roundtrip'].detail).toBe(true)
    expect(ev.passed).toBe(true)
  })

  it('a direct webhook from the dispatcher to the acquirer also passes', () => {
    const d = variant([['delivery', 'egress']], [['delivery', 'acquirer', 'http']])
    const { byId } = results(d)
    expect(byId['merchant-callback'].pass).toBe(true)
  })

  it('a dispatcher that also tells the issuing bank the final status stays valid', () => {
    const d = variant([], [['delivery', 'issuer', 'http']])
    const { ev, byId } = results(d)
    expect(byId['issuer-roundtrip'].pass, byId['issuer-roundtrip'].detail).toBe(true)
    expect(ev.score).toBe(100)
  })

  it('a dispatcher that never calls anyone fails merchant-callback', () => {
    const d = variant([['delivery', 'egress']])
    const { byId } = results(d)
    expect(byId['merchant-callback'].pass).toBe(false)
    expect(byId['merchant-callback'].detail).toMatch(/never calls the acquirer/)
  })

  it('an NGINX partner gateway is accepted (limit_req per client certificate)', () => {
    const d = structuredClone(mobilePayScheme.reference.diagram)
    d.nodes.find((n) => n.id === 'gw')!.tech = 'nginx'
    const { byId } = results(d)
    expect(byId['partner-gateway'].pass, byId['partner-gateway'].detail).toBe(true)
  })

  it('an issuing bank calling the switch directly bypasses the gateway', () => {
    const d = variant([], [['issuer', 'switch', 'http']])
    const { byId } = results(d)
    expect(byId['partner-gateway'].pass).toBe(false)
    expect(byId['partner-gateway'].detail).toMatch(/Issuing Banks/)
  })

  it('the switch writing to the ledger database trips the hot-path anti-pattern', () => {
    const d = variant([], [['switch', 'ledgerDb', 'data']])
    const { byId } = results(d)
    expect(byId['anti-ledger-hot-path'].pass).toBe(false)
    expect(byId['anti-ledger-hot-path'].detail).toMatch(/ledger database directly/)
  })

  it('a RabbitMQ backbone only loses the replay bonus', () => {
    const d = structuredClone(mobilePayScheme.reference.diagram)
    d.nodes.find((n) => n.id === 'kafka')!.tech = 'rabbitmq'
    const { ev, byId } = results(d)
    expect(ev.results.filter((r) => r.category === 'core' && !r.pass)).toEqual([])
    expect(byId['replayable-backbone'].pass).toBe(false)
    expect(ev.passed).toBe(true)
  })

  it('bonus checks fail without the PKI link or the DLQ edge', () => {
    const d = variant([
      ['gw', 'vault'],
      ['delivery', 'kafka'],
    ])
    const { byId } = results(d)
    expect(byId['partner-pki'].pass).toBe(false)
    expect(byId['webhook-dlq'].pass).toBe(false)
  })

  it('alternative design: merged code/switch core, issuer adapters, Redpanda, Lambda webhooks', () => {
    const d = diagram(
      [
        ['bankApp', 'mobile-app', 'Bank App', 0, 0, { tech: 'swiftui' }],
        ['issuer', 'external', 'Banks', 0, 120, { tech: 'generic-api' }],
        ['checkout', 'web-app', 'Checkout', 0, 300, { tech: 'react' }],
        ['acquirer', 'external', 'Payment Gateways', 0, 420, { tech: 'przelewy24' }],
        ['waf', 'waf', 'WAF', 260, 120, { tech: 'aws-waf' }],
        ['gw', 'api-gateway', 'Envoy Edge', 260, 280, { tech: 'envoy' }],
        ['adapter', 'service', 'Issuer Adapters', 520, 0, { tech: 'go' }],
        ['core', 'service', 'Scheme Core', 520, 160, { tech: 'go', domains: ['codes', 'authorization'] }],
        ['codes', 'cache', 'Codes', 800, 80, { tech: 'valkey' }],
        ['state', 'document-db', 'Payments', 800, 200, { tech: 'dynamodb' }],
        ['fraud', 'service', 'Risk', 520, 320, { tech: 'go', domains: ['fraud'] }],
        ['features', 'wide-column', 'Features', 800, 320, { tech: 'scylladb' }],
        ['bus', 'broker', 'Event Log', 1060, 160, { tech: 'redpanda' }],
        ['notify', 'function', 'Result Notifier', 1320, 40, { tech: 'aws-lambda', domains: ['result-delivery'] }],
        ['settle', 'service', 'Settlement', 1320, 280, { tech: 'spring-boot', domains: ['settlement'] }],
        ['ledger', 'relational-db', 'Ledger', 1580, 280, { tech: 'cockroachdb' }],
        ['house', 'external', 'Clearing House', 1580, 160, { tech: 'generic-api' }],
        ['tracing', 'tracing', 'APM', 260, 520, { tech: 'datadog' }],
        ['metrics', 'metrics', 'Metrics', 520, 520, { tech: 'datadog' }],
        ['pager', 'alerting', 'Paging', 800, 520, { tech: 'opsgenie' }],
      ],
      [
        ['bankApp', 'issuer'],
        ['checkout', 'acquirer'],
        ['issuer', 'waf'],
        ['acquirer', 'waf'],
        ['waf', 'gw'],
        ['gw', 'core'],
        ['gw', 'adapter', 'http', 'bank decision'],
        ['core', 'codes'],
        ['core', 'state'],
        ['core', 'fraud', 'grpc'],
        ['core', 'adapter', 'grpc', 'route to bank'],
        ['adapter', 'issuer', 'http'],
        ['adapter', 'bus', 'event', 'IssuerDecision'],
        ['bus', 'core', 'event'],
        ['core', 'bus', 'event', 'PaymentDecided'],
        ['fraud', 'features'],
        ['bus', 'fraud', 'event'],
        ['bus', 'notify', 'event'],
        ['notify', 'acquirer', 'http', 'callback'],
        ['bus', 'settle', 'event'],
        ['settle', 'ledger'],
        ['settle', 'house'],
        ['core', 'tracing', 'telemetry'],
        ['core', 'metrics', 'telemetry'],
        ['metrics', 'pager', 'telemetry'],
      ],
    )
    const { ev } = results(d, { ...decisions, style: 'microservices' })
    const failedCore = ev.results.filter((r) => r.category === 'core' && !r.pass).map((r) => `${r.id}: ${r.detail ?? ''}`)
    expect(failedCore, failedCore.join('\n')).toEqual([])
    const tripped = ev.results.filter((r) => r.category === 'antipattern' && !r.pass).map((r) => r.id)
    expect(tripped).toEqual([])
    expect(ev.passed).toBe(true)
  })

  it('a switch that also owns settlement trips the hot-path anti-pattern', () => {
    const d = structuredClone(mobilePayScheme.reference.diagram)
    d.nodes.find((n) => n.id === 'switch')!.domains.push('settlement')
    const { byId } = results(d)
    expect(byId['anti-ledger-hot-path'].pass).toBe(false)
  })
})

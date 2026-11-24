import { describe, expect, it } from 'vitest'
import { assertScenarioContract } from '../../engine/scenarioContract'
import { evaluateScenario } from '../../engine/evaluate'
import type { Decisions, Diagram, DiagramEdge, DiagramNode } from '../../engine/types'
import { diagram, type EdgeSpec, type NodeSpec } from './builder'
import { insurerStrangler } from './strangler'

const s = insurerStrangler
const decisions = s.reference.decisions

function results(d: Diagram, dec: Decisions = decisions) {
  const ev = evaluateScenario(s, d, dec)
  return { ev, pass: (id: string) => ev.results.find((r) => r.id === id)?.pass }
}

function failingCore(d: Diagram, dec: Decisions = decisions) {
  return evaluateScenario(s, d, dec)
    .results.filter((r) => r.category === 'core' && !r.pass)
    .map((r) => `${r.id}: ${r.detail ?? ''}`)
}

/** Reference diagram with nodes / edges removed or added. */
function tweak(opts: {
  dropNodes?: string[]
  dropEdge?: (e: DiagramEdge) => boolean
  nodes?: NodeSpec[]
  edges?: EdgeSpec[]
}): Diagram {
  const ref = s.reference.diagram
  const drop = new Set(opts.dropNodes ?? [])
  const kept: Diagram = {
    nodes: ref.nodes.filter((n) => !drop.has(n.id)),
    edges: ref.edges.filter((e) => !drop.has(e.source) && !drop.has(e.target) && !(opts.dropEdge?.(e) ?? false)),
  }
  if (!opts.nodes?.length && !opts.edges?.length) return kept
  // Build added nodes/edges with the builder, against kept + new nodes.
  const asSpec = (n: DiagramNode): NodeSpec => [n.id, n.kind, n.label, n.x, n.y, { tech: n.tech, domains: n.domains, parent: n.parentId, w: n.width, h: n.height }]
  const added = diagram([...kept.nodes.map(asSpec), ...(opts.nodes ?? [])], opts.edges ?? [])
  return { nodes: added.nodes, edges: [...kept.edges, ...added.edges.map((e) => ({ ...e, id: `x-${e.id}` }))] }
}

// Legacy block reused by the hand-written designs below.
const legacyNodes: NodeSpec[] = [
  ['core', 'monolith', 'PolisaCore', 520, 340, { tech: 'spring-boot', w: 500, h: 240 }],
  ['mPolicies', 'module', 'Policies', 20, 50, { tech: 'spring-boot', parent: 'core', domains: ['policies'] }],
  ['mClaims', 'module', 'Claims', 260, 50, { tech: 'spring-boot', parent: 'core', domains: ['claims'] }],
  ['mBilling', 'module', 'Billing', 20, 150, { tech: 'spring-boot', parent: 'core', domains: ['billing'] }],
  ['mCustomers', 'module', 'Customers', 260, 150, { tech: 'spring-boot', parent: 'core', domains: ['customers'] }],
  ['oracle', 'relational-db', 'Oracle', 1160, 440, { tech: 'oracle' }],
]

describe('polisa-strangler', () => {
  assertScenarioContract(insurerStrangler)

  it('starter fails the strangler-specific core checks', () => {
    const { pass } = results(s.starter!, s.starterDecisions)
    expect(pass('routing-facade')).toBe(false)
    expect(pass('quotes-extracted')).toBe(false)
    expect(pass('quotes-own-db')).toBe(false)
    expect(pass('legacy-data-sync')).toBe(false)
    expect(pass('acl')).toBe(false)
    expect(pass('incremental-scope')).toBe(true)
  })

  it('mistake: new Quotes service reads the Oracle tables directly (shared-DB shortcut)', () => {
    const ref = s.reference.diagram
    const d: Diagram = {
      nodes: ref.nodes.filter((n) => n.id !== 'quotesDb'),
      edges: [
        ...ref.edges.filter((e) => e.target !== 'quotesDb'),
        { id: 'bad-1', source: 'quotes', target: 'oracle', protocol: 'data', label: 'SELECT * FROM TARIFF' },
      ],
    }
    const { ev, pass } = results(d)
    expect(pass('quotes-own-db')).toBe(false)
    expect(pass('anti-legacy-tables')).toBe(false)
    expect(pass('anti-shared-db')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('mistake: no facade, clients split between old and new, Quotes calls PolisaCore directly', () => {
    const d = diagram(
      [
        ['web', 'web-app', 'Quote & Buy', 0, 60, { tech: 'nextjs' }],
        ['agent', 'web-app', 'Agent Portal', 0, 420, { tech: 'angular' }],
        ['quotes', 'service', 'Quotes', 560, 0, { tech: 'spring-boot', domains: ['quotes', 'payments'] }],
        ['quotesDb', 'relational-db', 'Quotes DB', 1160, 0, { tech: 'postgres' }],
        ...legacyNodes,
      ],
      [
        ['web', 'quotes', 'http'],
        ['agent', 'core', 'http'],
        ['quotes', 'quotesDb', 'data'],
        ['quotes', 'mCustomers', 'http', 'getCustomer + getTariff'],
        ['quotes', 'mPolicies', 'http', 'issuePolicy'],
        ['core', 'oracle', 'data'],
      ],
    )
    const { ev, pass } = results(d, { ...decisions, style: 'microservices' })
    expect(pass('routing-facade')).toBe(false)
    expect(pass('acl')).toBe(false)
    expect(pass('legacy-data-sync')).toBe(false)
    expect(pass('quotes-own-db')).toBe(true)
    expect(ev.passed).toBe(false)
  })

  it('mistake: big-bang rewrite — everything moved to new services and the monolith dropped', () => {
    const domains = ['quotes', 'payments', 'policies', 'claims', 'billing', 'customers']
    const nodes: NodeSpec[] = [
      ['web', 'web-app', 'Web', 0, 200, { tech: 'nextjs' }],
      ['gw', 'api-gateway', 'Gateway', 260, 200, { tech: 'kong' }],
      ...domains.flatMap((dm, i): NodeSpec[] => [
        [dm, 'service', dm, 560, i * 100, { tech: 'spring-boot', domains: [dm] }],
        [`${dm}Db`, 'relational-db', `${dm} DB`, 900, i * 100, { tech: 'postgres' }],
      ]),
    ]
    const edges: EdgeSpec[] = [['web', 'gw'], ...domains.flatMap((dm): EdgeSpec[] => [['gw', dm], [dm, `${dm}Db`]])]
    const { pass } = results(diagram(nodes, edges), { ...decisions, style: 'microservices' })
    expect(pass('incremental-scope')).toBe(false)
    expect(pass('routing-facade')).toBe(false)
    expect(pass('acl')).toBe(false)
  })

  it('mistake: "async" sync worker that queries Oracle on every quote is not a data sync', () => {
    const d = diagram(
      [
        ['web', 'web-app', 'Quote & Buy', 0, 60, { tech: 'nextjs' }],
        ['gw', 'api-gateway', 'Facade', 260, 240, { tech: 'kong' }],
        ['quotes', 'service', 'Quotes', 560, 0, { tech: 'spring-boot', domains: ['quotes', 'payments'] }],
        ['quotesDb', 'relational-db', 'Quotes DB', 1160, 0, { tech: 'postgres' }],
        ['sync', 'worker', 'Sync Worker', 860, 120, { tech: 'spring-boot' }],
        ['acl', 'service', 'Policy Adapter', 860, 240, { tech: 'spring-boot' }],
        ...legacyNodes,
      ],
      [
        ['web', 'gw'],
        ['gw', 'quotes'],
        ['gw', 'core'],
        ['quotes', 'quotesDb'],
        ['quotes', 'sync', 'http', 'fetch tariffs'],
        ['sync', 'oracle', 'data'],
        ['quotes', 'acl', 'grpc'],
        ['acl', 'mPolicies', 'http'],
        ['core', 'oracle', 'data'],
      ],
    )
    const { pass } = results(d, { ...decisions, style: 'microservices' })
    expect(pass('legacy-data-sync')).toBe(false)
    expect(pass('anti-legacy-tables')).toBe(false)
    expect(pass('routing-facade')).toBe(true)
    expect(pass('acl')).toBe(true)
  })

  it('alternative: reverse proxy behind a CDN, outbox + RabbitMQ, synchronous ACL, MongoDB quotes store', () => {
    const d = diagram(
      [
        ['web', 'web-app', 'Quote & Buy', 0, 60, { tech: 'react' }],
        ['agent', 'web-app', 'Agent Portal', 0, 420, { tech: 'angular' }],
        ['cdn', 'cdn', 'CDN', 260, 60, { tech: 'cloudfront' }],
        ['proxy', 'load-balancer', 'Routing Proxy', 520, 240, { tech: 'nginx', notes: 'split_clients 10% → new' }],
        ['quotes', 'service', 'Quote Engine', 780, 0, { tech: 'quarkus', domains: ['quotes'] }],
        ['quotesDb', 'document-db', 'Quotes Store', 1100, 0, { tech: 'mongodb' }],
        ['pay', 'service', 'Checkout', 780, 120, { tech: 'quarkus', domains: ['payments'] }],
        ['blik', 'external', 'BLIK', 1100, 120, { tech: 'blik' }],
        ['acl', 'service', 'Legacy Gateway (ACL)', 1100, 240, { tech: 'spring-boot' }],
        ['core', 'monolith', 'PolisaCore', 520, 360, { tech: 'spring-boot', w: 500, h: 240 }],
        ['mPolicies', 'module', 'Policies', 20, 50, { tech: 'spring-boot', parent: 'core', domains: ['policies'] }],
        ['mClaims', 'module', 'Claims', 260, 50, { tech: 'spring-boot', parent: 'core', domains: ['claims'] }],
        ['mBilling', 'module', 'Billing', 20, 150, { tech: 'spring-boot', parent: 'core', domains: ['billing'] }],
        ['mCustomers', 'module', 'Customers', 260, 150, { tech: 'spring-boot', parent: 'core', domains: ['customers'] }],
        ['oracle', 'relational-db', 'Oracle', 1100, 460, { tech: 'oracle', notes: 'outbox table added' }],
        ['relay', 'cdc', 'Outbox Relay', 1360, 460, { tech: 'outbox-poller' }],
        ['mq', 'broker', 'RabbitMQ', 1360, 120, { tech: 'rabbitmq' }],
      ],
      [
        ['web', 'cdn'],
        ['agent', 'proxy', 'http'],
        ['cdn', 'proxy', 'http'],
        ['proxy', 'quotes', 'http', '10% canary'],
        ['proxy', 'pay', 'http'],
        ['proxy', 'core', 'http'],
        ['quotes', 'quotesDb'],
        ['pay', 'blik'],
        ['quotes', 'acl', 'grpc', 'issue policy'],
        ['acl', 'core', 'http', 'EJB remote → REST'],
        ['core', 'oracle'],
        ['oracle', 'relay', 'event'],
        ['relay', 'mq', 'event', 'CustomerChanged'],
        ['mq', 'quotes', 'event'],
      ],
    )
    const failed = failingCore(d, { ...decisions, style: 'microservices' })
    expect(failed, failed.join('\n')).toEqual([])
    const { ev, pass } = results(d, { ...decisions, style: 'microservices' })
    expect(pass('anti-legacy-tables')).toBe(true)
    expect(pass('anti-shared-db')).toBe(true)
    expect(pass('progressive-rollout')).toBe(true)
    expect(pass('async-policy-issuance')).toBe(false)
    expect(ev.passed).toBe(true)
  })

  // --- Fairness: alternative valid designs ---------------------------------

  it('alternative: facade routes /quote to a Quote & Buy BFF that fans out to Quotes and Payments', () => {
    const d = diagram(
      [
        ['web', 'web-app', 'Quote & Buy', 0, 60, { tech: 'nextjs' }],
        ['agent', 'web-app', 'Agent Portal', 0, 420],
        ['gw', 'api-gateway', 'Strangler Facade', 260, 240, { tech: 'kong' }],
        ['bff', 'bff', 'Quote & Buy BFF', 560, 60, { tech: 'spring-boot' }],
        ['quotes', 'service', 'Quotes', 860, 0, { tech: 'spring-boot', domains: ['quotes'] }],
        ['payments', 'service', 'Payments', 860, 120, { tech: 'spring-boot', domains: ['payments'] }],
        ['quotesDb', 'relational-db', 'Quotes DB', 1160, 0, { tech: 'postgres' }],
        ['paymentsDb', 'relational-db', 'Payments DB', 1160, 120, { tech: 'postgres' }],
        ['payu', 'external', 'PayU', 1160, 240, { tech: 'payu' }],
        ['kafka', 'broker', 'Kafka', 1160, 360, { tech: 'kafka' }],
        ['debezium', 'cdc', 'Debezium', 1400, 440, { tech: 'debezium' }],
        ['aclWorker', 'worker', 'Policy ACL worker', 860, 240, { tech: 'spring-boot' }],
        ...legacyNodes,
      ],
      [
        ['web', 'gw'],
        ['agent', 'gw'],
        ['gw', 'bff', 'http', '/quote'],
        ['gw', 'core', 'http', 'everything else'],
        ['bff', 'quotes', 'http'],
        ['bff', 'payments', 'http'],
        ['quotes', 'quotesDb'],
        ['payments', 'paymentsDb'],
        ['payments', 'payu'],
        ['oracle', 'debezium', 'event'],
        ['debezium', 'kafka', 'event'],
        ['kafka', 'quotes', 'event'],
        ['quotes', 'kafka', 'event', 'PolicyPurchased'],
        ['kafka', 'aclWorker', 'event'],
        ['aclWorker', 'mPolicies', 'http'],
        ['core', 'oracle'],
      ],
    )
    const failed = failingCore(d)
    expect(failed, failed.join('\n')).toEqual([])
    expect(results(d).pass('async-policy-issuance')).toBe(true)
  })

  it('alternative: NGINX load balancer as the facade with telemetry earns side-by-side observability', () => {
    const d = diagram(
      [
        ['web', 'web-app', 'Quote & Buy', 0, 60, { tech: 'react' }],
        ['lb', 'load-balancer', 'NGINX', 260, 240, { tech: 'nginx' }],
        ['quotes', 'service', 'Quotes', 560, 0, { tech: 'spring-boot', domains: ['quotes', 'payments'] }],
        ['quotesDb', 'relational-db', 'Quotes DB', 1160, 0, { tech: 'postgres' }],
        ['kafka', 'broker', 'Kafka', 1160, 220, { tech: 'kafka' }],
        ['debezium', 'cdc', 'Debezium', 1400, 440, { tech: 'debezium' }],
        ['acl', 'service', 'Legacy Adapter', 860, 240, { tech: 'spring-boot' }],
        ['otel', 'otel-collector', 'OTel', 520, 700, { tech: 'otel-collector' }],
        ...legacyNodes,
      ],
      [
        ['web', 'lb'],
        ['lb', 'quotes', 'http', 'canary 5%'],
        ['lb', 'core', 'http'],
        ['quotes', 'quotesDb'],
        ['oracle', 'debezium', 'event'],
        ['debezium', 'kafka', 'event'],
        ['kafka', 'quotes', 'event'],
        ['quotes', 'kafka', 'event'],
        ['kafka', 'acl', 'event'],
        ['acl', 'mPolicies', 'http'],
        ['core', 'oracle'],
        ['lb', 'otel', 'telemetry'],
        ['quotes', 'otel', 'telemetry'],
        ['core', 'otel', 'telemetry'],
        ['acl', 'otel', 'telemetry'],
      ],
    )
    const failed = failingCore(d)
    expect(failed, failed.join('\n')).toEqual([])
    const { pass } = results(d)
    expect(pass('side-by-side-observability')).toBe(true)
    expect(pass('progressive-rollout')).toBe(true)
  })

  it('alternative: the new code is a "Digital Sales" application with Quotes and Payments modules', () => {
    const d = diagram(
      [
        ['web', 'web-app', 'Quote & Buy', 0, 60, { tech: 'nextjs' }],
        ['gw', 'api-gateway', 'Facade', 260, 240, { tech: 'kong' }],
        ['sales', 'monolith', 'Digital Sales', 520, -200, { tech: 'spring-boot', w: 500, h: 140 }],
        ['sQuotes', 'module', 'Quotes', 20, 50, { tech: 'spring-boot', parent: 'sales', domains: ['quotes'] }],
        ['sPay', 'module', 'Payments', 260, 50, { tech: 'spring-boot', parent: 'sales', domains: ['payments'] }],
        ['salesDb', 'relational-db', 'Sales DB', 1160, -160, { tech: 'postgres' }],
        ['kafka', 'broker', 'Kafka', 1160, 220, { tech: 'kafka' }],
        ['debezium', 'cdc', 'Debezium', 1400, 440, { tech: 'debezium' }],
        ['acl', 'worker', 'Legacy Adapter', 860, 240, { tech: 'spring-boot' }],
        ...legacyNodes,
      ],
      [
        ['web', 'gw'],
        ['gw', 'sales', 'http', '/quote, /pay'],
        ['gw', 'core', 'http'],
        ['sales', 'salesDb'],
        ['oracle', 'debezium', 'event'],
        ['debezium', 'kafka', 'event'],
        ['kafka', 'sales', 'event'],
        ['sales', 'kafka', 'event', 'PolicyPurchased'],
        ['kafka', 'acl', 'event'],
        ['acl', 'core', 'http'],
        ['core', 'oracle'],
      ],
    )
    const failed = failingCore(d)
    expect(failed, failed.join('\n')).toEqual([])
  })

  it('alternative: Quotes as serverless functions with DynamoDB and an outbox-polling worker', () => {
    const d = diagram(
      [
        ['web', 'web-app', 'Quote & Buy', 0, 60, { tech: 'react' }],
        ['gw', 'api-gateway', 'Facade', 260, 240, { tech: 'kong' }],
        ['fnQuote', 'function', 'Quote function', 560, 0, { tech: 'aws-lambda', domains: ['quotes'] }],
        ['fnPay', 'function', 'Payment function', 560, 120, { tech: 'aws-lambda', domains: ['payments'] }],
        ['ddb', 'document-db', 'Quotes table', 1160, 0, { tech: 'dynamodb' }],
        ['mq', 'broker', 'RabbitMQ', 1160, 220, { tech: 'rabbitmq' }],
        ['relay', 'worker', 'Outbox poller', 1400, 440, { tech: 'spring-boot' }],
        ['acl', 'function', 'Policy adapter', 860, 240, { tech: 'aws-lambda' }],
        ...legacyNodes,
      ],
      [
        ['web', 'gw'],
        ['gw', 'fnQuote', 'http'],
        ['gw', 'fnPay', 'http'],
        ['gw', 'core', 'http'],
        ['fnQuote', 'ddb'],
        ['relay', 'oracle', 'data', 'SELECT … FROM OUTBOX'],
        ['relay', 'mq', 'event', 'CustomerChanged'],
        ['mq', 'fnQuote', 'event'],
        ['fnPay', 'mq', 'event', 'PolicyPurchased'],
        ['mq', 'acl', 'event'],
        ['acl', 'mPolicies', 'http'],
        ['core', 'oracle'],
      ],
    )
    const failed = failingCore(d, { ...decisions, style: 'microservices' })
    expect(failed, failed.join('\n')).toEqual([])
    const { pass } = results(d, { ...decisions, style: 'microservices' })
    expect(pass('anti-legacy-tables')).toBe(true)
  })

  it('a worker that is called synchronously cannot pose as an outbox relay', () => {
    const d = tweak({
      dropNodes: ['debezium', 'cdcTx'],
      nodes: [['poller', 'worker', 'Tariff poller', 1400, 220, { tech: 'spring-boot' }]],
      edges: [
        ['quotes', 'poller', 'http', 'refresh tariffs now'],
        ['poller', 'oracle', 'data'],
        ['poller', 'kafka', 'event'],
      ],
    })
    const { pass } = results(d)
    expect(pass('anti-legacy-tables')).toBe(false)
  })

  it('a single Kafka cluster with a translator consuming and re-publishing also counts as translated CDC', () => {
    const d = tweak({
      dropEdge: (e) => e.source === 'debezium' && e.target === 'cdcTx',
      edges: [
        ['debezium', 'kafka', 'event', 'raw topics'],
        ['kafka', 'cdcTx', 'event', 'raw topics'],
      ],
    })
    expect(results(d).pass('cdc-translated')).toBe(true)
    expect(results(d).pass('cdc-capture')).toBe(true)
  })

  // --- Gaming attempts / mistakes -------------------------------------------

  it('mistake: the new Payments service calls raw legacy APIs instead of going through an ACL', () => {
    const d = tweak({
      dropNodes: ['acl'],
      edges: [
        ['payments', 'mPolicies', 'http', 'issuePolicy (raw legacy)'],
        ['payments', 'mBilling', 'http', 'recordPremium'],
      ],
    })
    const { pass } = results(d)
    expect(pass('acl')).toBe(false)
  })

  it('mistake: an ACL exists, but another new business service still calls PolisaCore directly', () => {
    const d = tweak({ edges: [['payments', 'mBilling', 'http', 'recordPremium (raw)']] })
    expect(results(d).pass('acl')).toBe(false)
  })

  it('mistake: a new Policy service quietly takes over policies, claims and billing (big bang in disguise)', () => {
    const d = tweak({
      nodes: [
        ['policySvc', 'service', 'Policy Service (new)', 1400, 600, { tech: 'spring-boot', domains: ['policies', 'claims', 'billing'] }],
        ['policyDb', 'relational-db', 'Policy DB', 1400, 720, { tech: 'postgres' }],
      ],
      edges: [
        ['gw', 'policySvc', 'http', '/policies, /claims, /billing'],
        ['policySvc', 'policyDb', 'data'],
      ],
    })
    const { ev, pass } = results(d)
    expect(pass('incremental-scope')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('mistake: a second new application with its own Policies module duplicates audited logic', () => {
    const d = tweak({
      nodes: [
        ['platform', 'monolith', 'Policy Platform', 1400, 600, { tech: 'spring-boot', w: 260, h: 140 }],
        ['pPolicies', 'module', 'Policies v2', 30, 50, { tech: 'spring-boot', parent: 'platform', domains: ['policies'] }],
      ],
      edges: [['gw', 'platform', 'http']],
    })
    expect(results(d).pass('incremental-scope')).toBe(false)
  })

  it('bonus checks flip when their ingredient is removed', () => {
    const noRollout = tweak({ dropNodes: ['flags'], dropEdge: (e) => e.source === 'gw' && e.target === 'quotes' })
    const rolloutEdge = diagram([['gw', 'api-gateway', 'g', 0, 0], ['quotes', 'service', 'q', 0, 0]], [['gw', 'quotes', 'http', '/quote']]).edges[0]
    noRollout.edges.push({ ...rolloutEdge, id: 'plain-quote-route' })
    expect(results(noRollout).pass('progressive-rollout')).toBe(false)

    const noTelemetry = tweak({ dropEdge: (e) => e.protocol === 'telemetry' && e.source === 'gw' })
    expect(results(noTelemetry).pass('side-by-side-observability')).toBe(false)
    const noLegacyTelemetry = tweak({ dropEdge: (e) => e.protocol === 'telemetry' && e.source === 'core' })
    expect(results(noLegacyTelemetry).pass('side-by-side-observability')).toBe(false)

    const noCdc = tweak({ dropNodes: ['debezium'] })
    expect(results(noCdc).pass('cdc-capture')).toBe(false)
    expect(results(noCdc).pass('legacy-data-sync')).toBe(false)
    expect(results(noCdc).pass('cdc-translated')).toBe(false)

    const rawCdc = tweak({ dropNodes: ['cdcTx'], edges: [['debezium', 'kafka', 'event', 'raw row changes']] })
    expect(results(rawCdc).pass('legacy-data-sync')).toBe(true)
    expect(results(rawCdc).pass('cdc-translated')).toBe(false)

    const syncIssuance = tweak({
      dropEdge: (e) => e.source === 'payments' && e.target === 'kafka',
      edges: [['payments', 'acl', 'http', 'issue policy now']],
    })
    expect(results(syncIssuance).pass('async-policy-issuance')).toBe(false)
    expect(results(syncIssuance).pass('acl')).toBe(true)
  })

  it('odd graphs do not throw', () => {
    const odd = diagram([['x', 'monolith', 'Lonely', 0, 0], ['q', 'service', 'Q', 300, 0, { domains: ['quotes'] }]], [['q', 'x', 'http']])
    const ev = evaluateScenario(s, odd, { stack: {} })
    expect(ev.results.every((r) => !r.detail?.startsWith('Check failed to run'))).toBe(true)
    expect(ev.passed).toBe(false)
  })
})

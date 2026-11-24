import { describe, expect, it } from 'vitest'
import { assertScenarioContract } from '../../engine/scenarioContract'
import { evaluateScenario } from '../../engine/evaluate'
import type { Decisions, Diagram, DiagramEdge } from '../../engine/types'
import { diagram, type EdgeSpec, type NodeSpec } from './builder'
import { adClicks } from './adclicks'

const decisions: Decisions = { style: 'event-driven', communication: 'async', data: 'cqrs', stack: {} }

const results = (d: Diagram, dec: Decisions = decisions) => {
  const ev = evaluateScenario(adClicks, d, dec)
  return { ev, byId: Object.fromEntries(ev.results.map((r) => [r.id, r])) }
}
const failedCore = (d: Diagram) =>
  results(d).ev.results.filter((r) => r.category === 'core' && !r.pass).map((r) => r.id)
const failedAll = (d: Diagram) => results(d).ev.results.filter((r) => !r.pass).map((r) => r.id)

/** The reference design with some nodes / edges removed or added, to probe one check at a time. */
function variant(opts: {
  drop?: string[]
  dropEdges?: [string, string][]
  nodes?: NodeSpec[]
  edges?: EdgeSpec[]
  domains?: Record<string, string[]>
  tech?: Record<string, string>
}): Diagram {
  const ref = adClicks.reference.diagram
  const drop = new Set(opts.drop ?? [])
  const dropEdges = new Set((opts.dropEdges ?? []).map(([a, b]) => `${a}>${b}`))
  const nodes = [
    ...ref.nodes
      .filter((n) => !drop.has(n.id))
      .map((n) => ({ ...n, domains: opts.domains?.[n.id] ?? n.domains, tech: opts.tech?.[n.id] ?? n.tech })),
    ...diagram(opts.nodes ?? [], []).nodes,
  ]
  const ids = new Set(nodes.map((n) => n.id))
  const kept = ref.edges.filter((e) => !drop.has(e.source) && !drop.has(e.target) && !dropEdges.has(`${e.source}>${e.target}`))
  const added: DiagramEdge[] = (opts.edges ?? []).map(([source, target, protocol, label], i) => {
    if (!ids.has(source) || !ids.has(target)) throw new Error(`Bad edge ${source} -> ${target}`)
    return { id: `v${i}-${source}-${target}`, source, target, protocol: protocol ?? 'event', label }
  })
  return { nodes, edges: [...kept, ...added] }
}

// Shared front: clients, edge and the back-office that every variant has.
const front: NodeSpec[] = [
  ['pubWeb', 'web-app', 'Publisher Sites', 0, 0, { tech: 'react' }],
  ['pubApp', 'mobile-app', 'Publisher SDK', 0, 140, { tech: 'flutter' }],
  ['console', 'web-app', 'Advertiser Console', 0, 480, { tech: 'react' }],
  ['cdn', 'cdn', 'Edge', 260, 70, { tech: 'cloudflare' }],
  ['gw', 'api-gateway', 'Gateway', 260, 480, { tech: 'kong' }],
  ['adserver', 'service', 'Ad Server', 560, -40, { tech: 'go', domains: ['ad-serving'] }],
  ['reporting', 'service', 'Reporting', 560, 480, { tech: 'ktor', domains: ['reporting'] }],
  ['campaigns', 'service', 'Campaigns', 560, 620, { tech: 'ktor', domains: ['campaigns'] }],
  ['campaignsDb', 'relational-db', 'Campaigns DB', 820, 620, { tech: 'postgres' }],
]
const frontEdges: EdgeSpec[] = [
  ['pubWeb', 'cdn', 'http'],
  ['pubApp', 'cdn', 'http'],
  ['console', 'gw', 'http'],
  ['cdn', 'adserver', 'http'],
  ['gw', 'reporting', 'http'],
  ['gw', 'campaigns', 'http'],
  ['campaigns', 'campaignsDb', 'data'],
]

describe('clickstream-billing', () => {
  assertScenarioContract(adClicks)

  it('mistake: counting clicks with UPDATE in a database and asking the budget service per request', () => {
    const d = diagram(
      [
        ...front,
        ['ingest', 'service', 'Click Tracker', 560, 160, { tech: 'go', domains: ['click-ingest'] }],
        ['clicksDb', 'relational-db', 'Clicks DB', 820, 160, { tech: 'mysql' }],
        ['budget', 'service', 'Budget', 820, 0, { tech: 'go', domains: ['budget-pacing'] }],
        ['budgetDb', 'relational-db', 'Budget DB', 1080, 0, { tech: 'postgres' }],
        ['billing', 'service', 'Billing', 820, 300, { tech: 'spring-boot', domains: ['billing'] }],
        ['billingDb', 'relational-db', 'Invoices', 1080, 300, { tech: 'postgres' }],
      ],
      [
        ...frontEdges,
        ['cdn', 'ingest', 'http'],
        ['ingest', 'clicksDb', 'data', 'clicks = clicks + 1'],
        ['adserver', 'budget', 'grpc', 'can I serve?'],
        ['budget', 'budgetDb', 'data'],
        ['reporting', 'billing', 'http'],
        ['billing', 'billingDb', 'data'],
      ],
    )
    const failed = failedCore(d)
    expect(failed).toEqual(
      expect.arrayContaining(['replayable-ingest-log', 'stream-aggregation', 'raw-archive-replay', 'spend-to-budget', 'pause-propagation']),
    )
    const { byId } = results(d)
    expect(byId['anti-billing-on-hot-path'].pass).toBe(false)
    expect(byId['anti-oltp-click-counter'].pass).toBe(false)
  })

  it('mistake: RabbitMQ work queue with workers incrementing Redis counters', () => {
    const d = diagram(
      [
        ...front,
        ['ingest', 'service', 'Ingest', 560, 160, { tech: 'go', domains: ['click-ingest'] }],
        ['queue', 'broker', 'Click Queue', 820, 160, { tech: 'rabbitmq' }],
        ['counter', 'worker', 'Counter Worker', 1080, 160, { tech: 'go', domains: ['budget-pacing'] }],
        ['counters', 'cache', 'Counters', 1340, 160, { tech: 'redis' }],
        ['billing', 'service', 'Billing', 1080, 300, { tech: 'spring-boot', domains: ['billing'] }],
        ['billingDb', 'relational-db', 'Invoices', 1340, 300, { tech: 'postgres' }],
      ],
      [
        ...frontEdges,
        ['cdn', 'ingest', 'http'],
        ['ingest', 'queue', 'event'],
        ['queue', 'counter', 'event'],
        ['counter', 'counters', 'data', 'INCR'],
        ['adserver', 'counters', 'data'],
        ['reporting', 'counters', 'data'],
        ['billing', 'counters', 'data'],
        ['billing', 'billingDb', 'data'],
      ],
    )
    const { byId } = results(d)
    expect(byId['replayable-ingest-log'].pass).toBe(false)
    expect(byId['replayable-ingest-log'].detail).toMatch(/replay/)
    expect(byId['stream-aggregation'].pass).toBe(false)
    expect(byId['raw-archive-replay'].pass).toBe(false)
    expect(byId['spend-to-budget'].pass).toBe(false)
  })

  it('mistake: Kafka and Flink, but aggregates go to a nightly warehouse', () => {
    const d = diagram(
      [
        ...front,
        ['ingest', 'service', 'Ingest', 560, 160, { tech: 'go', domains: ['click-ingest'] }],
        ['rawLog', 'broker', 'Raw Events', 820, 160, { tech: 'kafka' }],
        ['flink', 'stream-processor', 'Aggregator', 1080, 160, { tech: 'flink' }],
        ['dwh', 'analytics-db', 'Warehouse', 1340, 160, { tech: 'snowflake' }],
        ['budget', 'service', 'Budget', 1340, 0, { tech: 'go', domains: ['budget-pacing'] }],
        ['billing', 'service', 'Billing', 1600, 300, { tech: 'spring-boot', domains: ['billing'] }],
      ],
      [
        ...frontEdges,
        ['cdn', 'ingest', 'http'],
        ['ingest', 'rawLog', 'event'],
        ['adserver', 'rawLog', 'event'],
        ['rawLog', 'flink', 'event'],
        ['flink', 'dwh', 'data'],
        ['reporting', 'dwh', 'data'],
        ['budget', 'dwh', 'data'],
        ['billing', 'dwh', 'data'],
      ],
    )
    const { byId } = results(d)
    expect(byId['replayable-ingest-log'].pass).toBe(true)
    expect(byId['stream-aggregation'].pass).toBe(false)
    expect(byId['stream-aggregation'].detail).toMatch(/warehouse/)
    expect(byId['spend-to-budget'].pass).toBe(false)
    expect(byId['pause-propagation'].pass).toBe(false)
    expect(byId['raw-archive-replay'].pass).toBe(false)
  })

  it('alternative: edge function ingest, Redpanda, Kafka Streams, ClickHouse fed from a topic, pause via events', () => {
    const d = diagram(
      [
        ['pubWeb', 'web-app', 'Publisher Sites', 0, 0, { tech: 'react' }],
        ['pubApp', 'mobile-app', 'Publisher SDK', 0, 140, { tech: 'swiftui' }],
        ['console', 'web-app', 'Advertiser Console', 0, 480, { tech: 'vue' }],
        ['waf', 'waf', 'WAF', 260, 70, { tech: 'aws-waf' }],
        ['lb', 'load-balancer', 'LB', 400, -40, { tech: 'aws-alb' }],
        ['gw', 'api-gateway', 'Gateway', 260, 480, { tech: 'envoy' }],
        ['ingest', 'function', 'Beacon Function', 560, 160, { tech: 'aws-lambda', domains: ['click-ingest'] }],
        ['adserver', 'service', 'Ad Server', 560, -40, { tech: 'axum', domains: ['ad-serving'] }],
        ['reporting', 'service', 'Reporting', 560, 480, { tech: 'go', domains: ['reporting'] }],
        ['campaigns', 'service', 'Campaigns', 560, 620, { tech: 'go', domains: ['campaigns'] }],
        ['campaignsDb', 'relational-db', 'Campaigns DB', 820, 620, { tech: 'postgres' }],
        ['rawLog', 'broker', 'Raw Events', 820, 160, { tech: 'redpanda' }],
        ['streams', 'stream-processor', 'Dedup + Windows', 1080, 160, { tech: 'kafka-streams' }],
        ['aggLog', 'broker', 'Aggregates', 1340, 160, { tech: 'redpanda' }],
        ['ch', 'analytics-db', 'ClickHouse', 1600, 160, { tech: 'clickhouse' }],
        ['budget', 'service', 'Budget & Pacing', 1600, 0, { tech: 'go', domains: ['budget-pacing'] }],
        ['budgetDb', 'wide-column', 'Spend Counters', 1860, 0, { tech: 'scylladb' }],
        ['archiver', 'worker', 'Archiver', 1080, 300, { tech: 'go' }],
        ['archive', 'object-storage', 'Archive', 1340, 300, { tech: 'gcs' }],
        ['recon', 'worker', 'Nightly Reconciliation', 1600, 300, { tech: 'quarkus', domains: ['billing'] }],
        ['ledger', 'relational-db', 'Invoices', 1860, 300, { tech: 'cockroachdb' }],
        ['otel', 'otel-collector', 'Collector', 820, 820, { tech: 'grafana-alloy' }],
        ['metrics', 'metrics', 'Metrics', 1080, 820, { tech: 'victoriametrics' }],
        ['alerts', 'alerting', 'Alerts', 1340, 820, { tech: 'opsgenie' }],
      ],
      [
        ['pubWeb', 'waf', 'http'],
        ['pubApp', 'waf', 'http'],
        ['waf', 'lb', 'http'],
        ['waf', 'ingest', 'http'],
        ['lb', 'adserver', 'http'],
        ['console', 'gw', 'http'],
        ['gw', 'reporting', 'http'],
        ['gw', 'campaigns', 'http'],
        ['campaigns', 'campaignsDb', 'data'],
        ['campaigns', 'aggLog', 'event'],
        ['ingest', 'rawLog', 'event'],
        ['adserver', 'rawLog', 'event'],
        ['rawLog', 'streams', 'event'],
        ['streams', 'aggLog', 'event'],
        ['aggLog', 'ch', 'event', 'Kafka table engine'],
        ['aggLog', 'budget', 'event'],
        ['budget', 'budgetDb', 'data'],
        ['budget', 'aggLog', 'event', 'CampaignPaused'],
        ['aggLog', 'adserver', 'event'],
        ['reporting', 'ch', 'data'],
        ['rawLog', 'archiver', 'event'],
        ['archiver', 'archive', 'data'],
        ['recon', 'archive', 'data'],
        ['recon', 'ledger', 'data'],
        ['streams', 'otel', 'telemetry'],
        ['otel', 'metrics', 'telemetry'],
        ['metrics', 'alerts', 'telemetry'],
      ],
    )
    expect(failedCore(d)).toEqual([])
    const { byId } = results(d)
    expect(byId['anti-billing-on-hot-path'].pass).toBe(true)
    expect(byId['anti-oltp-click-counter'].pass).toBe(true)
    expect(byId['anti-sync-chain'].pass).toBe(true)
    for (const id of ['served-ad-events', 'invalid-traffic-edge', 'lag-monitoring', 'invoices-acid']) expect(byId[id].pass, id).toBe(true)
  })

  it('gaming: the stream job and the archive hang off an unrelated topic while the click log is never read', () => {
    const d = variant({
      dropEdges: [
        ['rawLog', 'flink'],
        ['rawLog', 's3Sink'],
      ],
      edges: [
        ['campaignTopic', 'flink', 'event'],
        ['campaignTopic', 's3Sink', 'event'],
      ],
    })
    const { byId } = results(d)
    expect(byId['replayable-ingest-log'].pass).toBe(true)
    expect(byId['stream-aggregation'].pass).toBe(false)
    expect(byId['stream-aggregation'].detail).toMatch(/Raw Events Log/)
    expect(byId['raw-archive-replay'].pass).toBe(false)
    expect(byId['spend-to-budget'].pass).toBe(false)
  })

  it('gaming: archiving only the minute aggregates is not a raw event archive', () => {
    const d = variant({ dropEdges: [['rawLog', 's3Sink']], edges: [['aggLog', 's3Sink', 'event']] })
    expect(failedCore(d)).toEqual(['raw-archive-replay'])
  })

  it('gaming: a combined ad-edge service (serving + ingest) still may not UPDATE a counter row per click', () => {
    const combined = {
      drop: ['adserver'],
      domains: { ingest: ['ad-serving', 'click-ingest'] },
      edges: [['ingest', 'adCache', 'data', 'read'] as EdgeSpec],
    }
    const bad = variant({
      ...combined,
      nodes: [['clicksDb', 'relational-db', 'Click Totals', 520, 320, { tech: 'mysql' }]],
      edges: [...combined.edges, ['ingest', 'clicksDb', 'data', 'clicks = clicks + 1']],
    })
    expect(results(bad).byId['anti-oltp-click-counter'].pass).toBe(false)

    // Fair counterpart: the same service reading a creative catalog is not a click counter.
    const ok = variant({
      ...combined,
      nodes: [['creatives', 'document-db', 'Creative Catalog', 520, 320, { tech: 'mongodb' }]],
      edges: [...combined.edges, ['ingest', 'creatives', 'data', 'read creatives']],
    })
    expect(failedCore(ok)).toEqual([])
    expect(results(ok).byId['anti-oltp-click-counter'].pass).toBe(true)
  })

  it('gaming: a per-request budget call routed through the API gateway is still on the hot path', () => {
    const d = variant({
      edges: [
        ['adserver', 'gw', 'http', 'can I serve?'],
        ['gw', 'budget', 'http'],
      ],
    })
    expect(results(d).byId['anti-billing-on-hot-path'].pass).toBe(false)
  })

  it('gaming: a WAF in front of the console only does not filter the beacons', () => {
    const d = variant({
      tech: { cdn: 'cloudfront' },
      dropEdges: [['console', 'gw']],
      nodes: [['waf', 'waf', 'Console WAF', 130, -480, { tech: 'aws-waf' }]],
      edges: [
        ['console', 'waf', 'http'],
        ['waf', 'gw', 'http'],
      ],
    })
    const { byId } = results(d)
    expect(byId['invalid-traffic-edge'].pass).toBe(false)
    expect(byId['invalid-traffic-edge'].detail).toMatch(/Publisher/)
  })

  it('alternative: Budget tells Campaigns, which owns campaign status and distributes it to the ad server', () => {
    // Variant 1: BudgetExhausted event -> Campaigns -> compacted topic consumed by the ad server.
    const viaEvents = variant({
      dropEdges: [
        ['budget', 'adCache'],
        ['campaigns', 'adCache'],
      ],
      nodes: [['budgetEvents', 'broker', 'Budget Events', 1300, -480, { tech: 'kafka' }]],
      edges: [
        ['budget', 'budgetEvents', 'event', 'BudgetExhausted'],
        ['budgetEvents', 'campaigns', 'event'],
        ['campaignTopic', 'adserver', 'event', 'CampaignStatusChanged'],
      ],
    })
    expect(failedCore(viaEvents)).toEqual([])

    // Variant 2: Budget calls the Campaigns API (off the hot path); Campaigns writes the snapshot the ad server reads.
    const viaApi = variant({ dropEdges: [['budget', 'adCache']], edges: [['budget', 'campaigns', 'http', 'pause campaign']] })
    expect(failedCore(viaApi)).toEqual([])
    expect(results(viaApi).byId['anti-billing-on-hot-path'].pass).toBe(true)

    // Without any route from Budget, the snapshot alone does not carry the pause.
    const silent = variant({ dropEdges: [['budget', 'adCache']] })
    expect(failedCore(silent)).toEqual(['pause-propagation'])
  })

  it('alternative: Budget polls Pinot and the pause flows Postgres -> Debezium -> Kafka -> ad server', () => {
    const d = variant({
      dropEdges: [
        ['aggLog', 'budget'],
        ['budget', 'adCache'],
      ],
      nodes: [
        ['debezium', 'cdc', 'Outbox Relay', 1560, -160, { tech: 'debezium' }],
        ['pauseTopic', 'broker', 'Campaign Pauses', 1040, -160, { tech: 'kafka' }],
      ],
      edges: [
        ['budget', 'pinot', 'data', 'poll spend'],
        ['budgetDb', 'debezium', 'data'],
        ['debezium', 'pauseTopic', 'event'],
        ['pauseTopic', 'adserver', 'event', 'CampaignPaused'],
      ],
    })
    expect(failedCore(d)).toEqual([])
    expect(results(d).byId['anti-shared-db'].pass).toBe(true)
  })

  it('impressions as client beacons through ingest keep every core check; only the served-ad bonus is lost', () => {
    const d = variant({ dropEdges: [['adserver', 'rawLog']] })
    expect(failedAll(d)).toEqual(['served-ad-events'])
  })

  it('checks do not throw on an odd graph (owners without edges, self loops)', () => {
    const d = diagram(
      [
        ['x', 'stream-processor', 'Lonely', 0, 0],
        ['b', 'broker', 'Bus', 200, 0],
        ['s', 'service', 'Everything', 400, 0, { domains: ['ad-serving', 'click-ingest', 'budget-pacing', 'billing'] }],
      ],
      [
        ['b', 'b', 'event'],
        ['s', 's', 'http'],
      ],
    )
    const { ev } = results(d)
    expect(ev.results.every((r) => !r.detail?.startsWith('Check failed to run'))).toBe(true)
    expect(ev.passed).toBe(false)
  })
})

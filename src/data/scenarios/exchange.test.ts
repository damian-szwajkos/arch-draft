import { describe, expect, it } from 'vitest'
import { assertScenarioContract } from '../../engine/scenarioContract'
import { evaluateScenario } from '../../engine/evaluate'
import { diagram } from './builder'
import { exchangeEngine } from './exchange'
import type { Decisions, Diagram, DiagramNode, Protocol } from '../../engine/types'

const ref = exchangeEngine.reference.diagram

type Patch = {
  drop?: string[]
  add?: DiagramNode[]
  edges?: [string, string, Protocol][]
  dropEdges?: [string, string][]
  set?: Record<string, Partial<DiagramNode>>
}

/** The reference diagram with a few targeted changes. */
function variant(p: Patch): Diagram {
  const drop = new Set(p.drop ?? [])
  const nodes = [...ref.nodes.filter((n) => !drop.has(n.id)).map((n) => ({ ...n, ...(p.set?.[n.id] ?? {}) })), ...(p.add ?? [])]
  const dropEdges = new Set((p.dropEdges ?? []).map(([a, b]) => `${a}>${b}`))
  const edges = [
    ...ref.edges.filter((e) => !drop.has(e.source) && !drop.has(e.target) && !dropEdges.has(`${e.source}>${e.target}`)),
    ...(p.edges ?? []).map(([source, target, protocol], i) => ({ id: `x${i}`, source, target, protocol })),
  ]
  return { nodes, edges }
}

const node = (id: string, kind: DiagramNode['kind'], label: string, extra: Partial<DiagramNode> = {}): DiagramNode => ({
  id,
  kind,
  label,
  x: 0,
  y: 0,
  domains: [],
  ...extra,
})

function failing(d: Diagram, decisions: Decisions = exchangeEngine.reference.decisions) {
  const ev = evaluateScenario(exchangeEngine, d, decisions)
  return { ev, failed: ev.results.filter((r) => !r.pass).map((r) => r.id) }
}

describe('kursor-exchange', () => {
  assertScenarioContract(exchangeEngine)

  it('wrong: CRUD engine called by the gateway, locking rows in PostgreSQL', () => {
    const d = diagram(
      [
        ['web', 'web-app', 'Terminal', 0, 60, { tech: 'react' }],
        ['mobile', 'mobile-app', 'Mobile', 0, 200, { tech: 'flutter' }],
        ['lb', 'load-balancer', 'LB', 260, 130, { tech: 'haproxy' }],
        ['ogw', 'service', 'Order API', 520, 130, { tech: 'spring-boot', domains: ['order-entry', 'sequencing'] }],
        ['accounts', 'relational-db', 'Accounts DB', 520, 300, { tech: 'postgres' }],
        ['me', 'service', 'Matching', 780, 130, { tech: 'spring-boot', domains: ['matching'] }],
        ['books', 'relational-db', 'Order Books DB', 1040, 130, { tech: 'postgres', notes: 'SELECT … FOR UPDATE' }],
        ['mq', 'broker', 'Trades Queue', 1040, 300, { tech: 'rabbitmq' }],
        ['md', 'service', 'Market Data', 1300, 0, { tech: 'spring-boot', domains: ['market-data'] }],
        ['rtg', 'realtime-gateway', 'WS', 260, -100, { tech: 'spring-websocket' }],
        ['clearing', 'service', 'Clearing', 1300, 300, { tech: 'spring-boot', domains: ['clearing', 'surveillance'] }],
        ['ledger', 'relational-db', 'Ledger', 1560, 300, { tech: 'postgres' }],
      ],
      [
        ['web', 'lb'],
        ['mobile', 'lb'],
        ['web', 'rtg', 'websocket'],
        ['lb', 'ogw'],
        ['ogw', 'accounts', 'data', 'SELECT balance'],
        ['ogw', 'me', 'grpc', 'match order'],
        ['me', 'books', 'data'],
        ['me', 'mq', 'event'],
        ['mq', 'md', 'event'],
        ['md', 'rtg', 'grpc'],
        ['mq', 'clearing', 'event'],
        ['clearing', 'ledger'],
      ],
    )
    const { ev, failed } = failing(d)
    expect(failed).toContain('sequenced-journal')
    expect(failed).toContain('replicated-matching')
    expect(failed).toContain('matching-recovery')
    expect(failed).toContain('pre-trade-risk')
    expect(failed).toContain('anti-hotpath-db')
    expect(ev.results.find((r) => r.id === 'sequenced-journal')?.detail).toMatch(/directly/)
    expect(ev.results.find((r) => r.id === 'pre-trade-risk')?.detail).toMatch(/Accounts DB/)
    expect(ev.passed).toBe(false)
  })

  it('wrong: journal in place, but one engine, no snapshots, REST polling and inline clearing', () => {
    const d = diagram(
      [
        ['web', 'web-app', 'Terminal', 0, 60, { tech: 'react' }],
        ['lb', 'load-balancer', 'LB', 260, 130, { tech: 'haproxy' }],
        ['idp', 'identity', 'Identity', 260, 300, { tech: 'keycloak' }],
        ['ogw', 'service', 'Order Gateway', 520, 130, { tech: 'go', domains: ['order-entry'] }],
        ['risk', 'cache', 'Balances', 520, 300, { tech: 'redis' }],
        ['seq', 'service', 'Sequencer', 780, 130, { tech: 'axum', domains: ['sequencing'] }],
        ['journal', 'broker', 'Journal', 1040, 130, { tech: 'kafka' }],
        ['me', 'service', 'Matching Engine', 1300, 130, { tech: 'axum', domains: ['matching'] }],
        ['md', 'service', 'Market Data API', 1560, 0, { tech: 'go', domains: ['market-data'] }],
        ['clearing', 'service', 'Clearing', 1560, 130, { tech: 'spring-boot', domains: ['clearing'] }],
        ['ledger', 'relational-db', 'Ledger', 1820, 130, { tech: 'postgres' }],
        ['surv', 'worker', 'Surveillance', 1560, 260, { tech: 'spring-boot', domains: ['surveillance'] }],
        ['olap', 'analytics-db', 'Analytics', 1820, 260, { tech: 'clickhouse' }],
      ],
      [
        ['web', 'lb'],
        ['web', 'md', 'http', 'poll /depth every 100 ms'],
        ['lb', 'ogw'],
        ['ogw', 'idp', 'http'],
        ['ogw', 'risk', 'data'],
        ['ogw', 'seq', 'grpc'],
        ['seq', 'journal', 'event'],
        ['journal', 'me', 'event'],
        ['me', 'clearing', 'grpc', 'book trade'],
        ['me', 'md', 'http', 'update depth'],
        ['journal', 'surv', 'event'],
        ['clearing', 'ledger'],
        ['surv', 'olap'],
      ],
    )
    const { failed } = failing(d)
    expect(failed).not.toContain('sequenced-journal')
    expect(failed).toContain('replicated-matching')
    expect(failed).toContain('matching-recovery')
    expect(failed).toContain('market-data-fanout')
    expect(failed).toContain('settlement-ledger')
    expect(failed).toContain('anti-matching-sync')
  })

  it('wrong: sequencer journals to a queue that deletes messages once consumed', () => {
    const d = variant({ set: { journal: { tech: 'rabbitmq', label: 'Order Queue', notes: undefined } } })
    const { ev, failed } = failing(d)
    expect(failed).toContain('sequenced-journal')
    expect(failed).toContain('replicated-matching')
    expect(ev.results.find((r) => r.id === 'sequenced-journal')?.detail).toMatch(/replayable/)
  })

  it('alternative: LMAX-style in-process sequencer + engine on NATS, no cache, CockroachDB ledger', () => {
    const d = diagram(
      [
        ['web', 'web-app', 'Web Terminal', 0, 0, { tech: 'vue' }],
        ['mobile', 'mobile-app', 'Mobile', 0, 140, { tech: 'jetpack-compose' }],
        ['cdn', 'cdn', 'Edge', 260, -120, { tech: 'cloudflare' }],
        ['apigw', 'api-gateway', 'API Gateway', 260, 60, { tech: 'envoy' }],
        ['idp', 'identity', 'IdP', 260, 220, { tech: 'auth0' }],
        ['rtg', 'realtime-gateway', 'Ticker Hub', 520, -120, { tech: 'phoenix' }],
        ['ogw', 'service', 'Session Gateway', 520, 60, { tech: 'quarkus', domains: ['order-entry'], notes: 'In-memory balances from fills' }],
        ['core', 'service', 'Matching Core', 780, 60, { tech: 'quarkus', domains: ['sequencing', 'matching'], notes: 'Input journaler + business logic thread' }],
        ['journal', 'broker', 'Input Journal', 1040, 60, { tech: 'nats' }],
        ['replica', 'service', 'Replica Core', 1300, 60, { tech: 'quarkus', domains: ['matching'] }],
        ['snap', 'object-storage', 'Snapshots', 1040, 220, { tech: 'minio' }],
        ['out', 'broker', 'Output Events', 1040, -120, { tech: 'pulsar' }],
        ['md', 'worker', 'Book Builder', 1300, -120, { tech: 'quarkus', domains: ['market-data'] }],
        ['clearing', 'service', 'Post-trade', 1560, -40, { tech: 'spring-boot', domains: ['clearing'] }],
        ['ledger', 'relational-db', 'Ledger', 1820, -40, { tech: 'cockroachdb' }],
        ['cep', 'stream-processor', 'Pattern Detection', 1560, 120, { tech: 'flink' }],
        ['surv', 'worker', 'Surveillance Sink', 1820, 120, { tech: 'spring-boot', domains: ['surveillance'] }],
        ['pinot', 'analytics-db', 'Surveillance OLAP', 2080, 120, { tech: 'pinot' }],
      ],
      [
        ['web', 'cdn'],
        ['cdn', 'apigw'],
        ['mobile', 'apigw'],
        ['web', 'rtg', 'websocket'],
        ['mobile', 'rtg', 'websocket'],
        ['apigw', 'idp', 'http'],
        ['apigw', 'ogw'],
        ['ogw', 'core', 'grpc', 'orders'],
        ['core', 'journal', 'event', 'journal before match'],
        ['journal', 'replica', 'event'],
        ['core', 'snap', 'data'],
        ['core', 'out', 'event'],
        ['out', 'ogw', 'event', 'fills'],
        ['out', 'md', 'event'],
        ['md', 'rtg', 'event'],
        ['out', 'clearing', 'event'],
        ['clearing', 'ledger'],
        ['out', 'cep', 'event'],
        ['cep', 'surv', 'event'],
        ['surv', 'pinot'],
      ],
    )
    const { ev } = failing(d)
    const core = ev.results.filter((r) => r.category === 'core' && !r.pass).map((r) => `${r.id}: ${r.detail ?? ''}`)
    expect(core, core.join('\n')).toEqual([])
    const anti = ev.results.filter((r) => r.category === 'antipattern' && !r.pass).map((r) => r.id)
    expect(anti).toEqual([])
    expect(ev.passed).toBe(true)
  })

  // --- Regression tests for gameable / unfair checks --------------------------

  const result = (d: Diagram, id: string) => failing(d).ev.results.find((r) => r.id === id)!

  it('two active shards are not a hot standby', () => {
    const r = result(variant({ drop: ['standby'] }), 'replicated-matching')
    expect(r.pass).toBe(false)
    expect(r.detail).toMatch(/shard/i)
  })

  it('a standby fed by the output stream instead of the journal does not count', () => {
    const d = variant({ dropEdges: [['journal', 'standby']], edges: [['out', 'standby', 'event']] })
    expect(result(d, 'replicated-matching').pass).toBe(false)
  })

  it('a database behind a risk service called by the gateway fails pre-trade risk', () => {
    const d = variant({
      add: [node('riskSvc', 'service', 'Risk Service', { tech: 'spring-boot' }), node('pg', 'relational-db', 'Accounts', { tech: 'postgres' })],
      edges: [
        ['ogw', 'riskSvc', 'grpc'],
        ['riskSvc', 'pg', 'data'],
      ],
    })
    const r = result(d, 'pre-trade-risk')
    expect(r.pass).toBe(false)
    expect(r.detail).toMatch(/via Risk Service/)
  })

  it('a database written by the sequencer trips the hot-path anti-pattern', () => {
    const d = variant({ add: [node('pg', 'relational-db', 'Orders', { tech: 'postgres' })], edges: [['seq', 'pg', 'data']] })
    const { failed } = failing(d)
    expect(failed).toContain('anti-hotpath-db')
    expect(failed).not.toContain('pre-trade-risk')
  })

  it('a cache read by the matching engine trips the hot-path anti-pattern', () => {
    const d = variant({ add: [node('redis', 'cache', 'Book Cache', { tech: 'redis' })], edges: [['meA', 'redis', 'data']] })
    expect(failing(d).failed).toContain('anti-hotpath-db')
  })

  it('an async side door into the engine bypasses the sequencer', () => {
    const direct = variant({ edges: [['ogw', 'meA', 'event']] })
    expect(result(direct, 'sequenced-journal').pass).toBe(false)
    const fastLane = variant({
      add: [node('fast', 'broker', 'Fast lane', { tech: 'rabbitmq' })],
      edges: [
        ['ogw', 'fast', 'event'],
        ['fast', 'meA', 'event'],
      ],
    })
    const r = result(fastLane, 'sequenced-journal')
    expect(r.pass).toBe(false)
    expect(r.detail).toMatch(/Order Gateway writes straight into Fast lane/)
    const intoJournal = variant({ edges: [['ogw', 'journal', 'event']] })
    expect(result(intoJournal, 'sequenced-journal').pass).toBe(false)
  })

  it('bonus checks fail when their piece is missing', () => {
    const { failed } = failing(variant({ drop: ['idp', 'olap', 'prom'] }))
    expect(failed).toEqual(expect.arrayContaining(['entry-auth', 'surveillance-offpath', 'latency-slo']))
  })

  it('a standby is not a shard', () => {
    const d = variant({ set: { meA: { label: 'Matching Engine' }, meB: { label: 'Hot standby B' } } })
    const { failed } = failing(d)
    expect(failed).toContain('instrument-shards')
    expect(failed).not.toContain('replicated-matching')
  })

  it('a Kafka journal is fair for the core checks but misses the latency bonus', () => {
    const d = variant({ set: { journal: { tech: 'kafka', label: 'Order Journal', notes: undefined } } })
    const { ev, failed } = failing(d)
    expect(ev.results.filter((r) => r.category !== 'bonus' && !r.pass).map((r) => r.id)).toEqual([])
    expect(failed).toEqual(['low-latency-journal'])
  })

  it('a tech-less Chronicle Queue journal counts as a replayable, low-latency log', () => {
    const d = variant({ set: { journal: { tech: undefined, label: 'Chronicle Queue journal', notes: undefined } } })
    expect(failing(d).failed).toEqual([])
  })

  it('recovery accepts the restore direction and a dedicated snapshotter', () => {
    const restore = variant({
      dropEdges: [['standby', 'snap']],
      edges: [
        ['snap', 'meA', 'data'],
        ['snap', 'meB', 'data'],
      ],
    })
    expect(result(restore, 'matching-recovery').pass).toBe(true)
    const snapshotter = variant({
      dropEdges: [['standby', 'snap']],
      add: [node('snapper', 'worker', 'Snapshotter', { tech: 'axum' })],
      edges: [
        ['journal', 'snapper', 'event'],
        ['snapper', 'snap', 'data'],
      ],
    })
    expect(result(snapshotter, 'matching-recovery').pass).toBe(true)
    expect(result(variant({ dropEdges: [['standby', 'snap']] }), 'matching-recovery').pass).toBe(false)
  })

  it('reference layout: no edge cuts through an unrelated node', () => {
    const W = 200
    const H = 84
    const box = new Map(ref.nodes.map((n) => [n.id, n]))
    const centre = (id: string) => ({ x: box.get(id)!.x + W / 2, y: box.get(id)!.y + H / 2 })
    // Liang–Barsky: does segment p→q intersect the rectangle?
    const hits = (p: { x: number; y: number }, q: { x: number; y: number }, n: DiagramNode) => {
      const dx = q.x - p.x
      const dy = q.y - p.y
      let t0 = 0
      let t1 = 1
      const clip = (pp: number, qq: number) => {
        if (pp === 0) return qq >= 0
        const r = qq / pp
        if (pp < 0) {
          if (r > t1) return false
          if (r > t0) t0 = r
        } else {
          if (r < t0) return false
          if (r < t1) t1 = r
        }
        return true
      }
      return clip(-dx, p.x - n.x) && clip(dx, n.x + W - p.x) && clip(-dy, p.y - n.y) && clip(dy, n.y + H - p.y) && t0 <= t1
    }
    const crossings: string[] = []
    for (const e of ref.edges)
      for (const n of ref.nodes)
        if (n.id !== e.source && n.id !== e.target && hits(centre(e.source), centre(e.target), n)) crossings.push(`${e.source}→${e.target} crosses ${n.id}`)
    expect(crossings, crossings.join('\n')).toEqual([])
    // nodes do not overlap (40px gaps)
    const overlaps: string[] = []
    for (const a of ref.nodes)
      for (const b of ref.nodes)
        if (a.id < b.id && Math.abs(a.x - b.x) < W + 40 && Math.abs(a.y - b.y) < 60 + 40) overlaps.push(`${a.id}/${b.id}`)
    expect(overlaps, overlaps.join(', ')).toEqual([])
  })

  it('checks do not throw on an odd graph', () => {
    const d = diagram(
      [
        ['b', 'broker', 'Bus', 0, 0],
        ['z', 'zone', 'Zone', 0, 0, { w: 400, h: 300 }],
        ['m', 'module', 'Loose module', 20, 20, { parent: 'z', domains: ['matching'] }],
      ],
      [['b', 'm', 'event']],
    )
    const ev = evaluateScenario(exchangeEngine, d, { stack: {} })
    expect(ev.results.every((r) => !(r.detail ?? '').startsWith('Check failed to run'))).toBe(true)
    expect(ev.passed).toBe(false)
  })
})

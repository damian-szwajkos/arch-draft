import { describe, expect, it } from 'vitest'
import { assertScenarioContract } from '../../engine/scenarioContract'
import { evaluateScenario } from '../../engine/evaluate'
import type { Decisions, Diagram } from '../../engine/types'
import { diagram, type EdgeSpec, type NodeSpec } from './builder'
import { cellPlatform } from './cells'

const ref = cellPlatform.reference

function results(d: Diagram, decisions: Decisions = ref.decisions) {
  const ev = evaluateScenario(cellPlatform, d, decisions)
  return { ev, byId: Object.fromEntries(ev.results.map((r) => [r.id, r])) }
}

function coreFailures(d: Diagram, decisions: Decisions = ref.decisions) {
  return results(d, decisions).ev.results.filter((r) => r.category === 'core' && !r.pass).map((r) => r.id)
}

const clone = () => structuredClone(ref.diagram)

describe('storefront-cells', () => {
  assertScenarioContract(cellPlatform)

  it('mistake: just scale the shared stack (no cells, no router)', () => {
    // The instinctive answer: more replicas behind a load balancer, one big database.
    const d = diagram(
      [
        ['web', 'web-app', 'Storefronts', 0, 200, { tech: 'react' }],
        ['cdn', 'cdn', 'CDN', 260, 200, { tech: 'fastly' }],
        ['lb', 'load-balancer', 'LB', 520, 200, { tech: 'haproxy' }],
        ['app', 'monolith', 'Kramo App', 780, 100, { tech: 'rails', w: 260, h: 250 }],
        ['store', 'module', 'Storefront', 30, 60, { tech: 'rails', domains: ['storefront'], parent: 'app' }],
        ['co', 'module', 'Checkout', 30, 160, { tech: 'rails', domains: ['checkout'], parent: 'app' }],
        ['q', 'broker', 'Jobs', 1100, 300, { tech: 'redis' }],
        ['w', 'worker', 'Workers', 1340, 300, { tech: 'sidekiq', domains: ['fulfilment'] }],
        ['db', 'relational-db', 'MySQL (primary + 12 replicas)', 1100, 100, { tech: 'mysql' }],
        ['ops', 'service', 'Ops Tooling', 780, 500, { tech: 'go', domains: ['tenant-placement', 'cell-provisioning'] }],
        ['opsDb', 'relational-db', 'Ops DB', 1100, 500, { tech: 'postgres' }],
      ],
      [
        ['web', 'cdn'],
        ['cdn', 'lb'],
        ['lb', 'app'],
        ['store', 'db'],
        ['co', 'db'],
        ['co', 'q'],
        ['q', 'w'],
        ['w', 'db'],
        ['ops', 'opsDb'],
      ],
    )
    const failed = coreFailures(d)
    expect(failed).toContain('cells-drawn')
    expect(failed).toContain('cell-isolation')
    expect(failed).toContain('thin-router')
    expect(failed).toContain('control-plane')
  })

  it('mistake: cells drawn, but they all share one database', () => {
    const d = clone()
    d.nodes = d.nodes.filter((n) => n.id !== 'dbB')
    d.edges = d.edges.map((e) => (e.target === 'dbB' ? { ...e, target: 'dbA' } : e))
    const { byId } = results(d)
    expect(byId['cell-isolation'].pass).toBe(false)
    expect(byId['cell-isolation'].detail).toMatch(/Shop DB is used by/)
    expect(byId['cells-drawn'].pass).toBe(false)
    expect(byId['cells-drawn'].detail).toMatch(/Cell B.*no database of its own/)
    expect(byId['anti-shared-db'].pass).toBe(false)
  })

  it('mistake: router asks the control plane on every request instead of reading a routing table', () => {
    const d = clone()
    d.edges = d.edges.filter((e) => !(e.source === 'router' && e.target === 'routing'))
    d.edges.push({ id: 'ask-cp', source: 'router', target: 'cp', protocol: 'http', label: 'which cell is shop X?' })
    const { byId } = results(d)
    expect(byId['control-plane'].pass).toBe(false)
    expect(byId['control-plane'].detail).toMatch(/synchronously/)
    expect(byId['thin-router'].pass).toBe(false)
    expect(byId['anti-fat-router'].pass).toBe(false)
    expect(byId['cells-drawn'].pass).toBe(true)
  })

  it('mistake: checkout kept as one global service that every cell calls', () => {
    const d = clone()
    for (const n of d.nodes) if (n.id === 'checkoutA' || n.id === 'checkoutB') n.domains = []
    d.nodes.push(
      { id: 'gco', kind: 'service', label: 'Global Checkout', tech: 'go', domains: ['checkout'], x: 1660, y: 520 },
      { id: 'gcoDb', kind: 'relational-db', label: 'Orders DB', tech: 'postgres', domains: [], x: 1660, y: 640 },
    )
    d.edges.push(
      { id: 'a-gco', source: 'checkoutA', target: 'gco', protocol: 'http' },
      { id: 'b-gco', source: 'checkoutB', target: 'gco', protocol: 'http' },
      { id: 'gco-db', source: 'gco', target: 'gcoDb', protocol: 'data' },
    )
    const { byId } = results(d)
    expect(byId['cells-drawn'].pass).toBe(false)
    expect(byId['cells-drawn'].detail).toMatch(/Checkout & orders is owned outside any cell/)
  })

  it('mistake: the "background" worker is called synchronously and the queue is gone', () => {
    const d = clone()
    d.nodes = d.nodes.filter((n) => !['queueA', 'queueB'].includes(n.id))
    d.edges = d.edges.filter((e) => !['queueA', 'queueB'].includes(e.source) && !['queueA', 'queueB'].includes(e.target))
    d.edges.push(
      { id: 'sa', source: 'checkoutA', target: 'workerA', protocol: 'http', label: 'run job' },
      { id: 'sb', source: 'checkoutB', target: 'workerB', protocol: 'http', label: 'run job' },
    )
    expect(coreFailures(d)).toEqual(['cell-job-queues'])
  })

  it('mistake: one job queue shared by all cells', () => {
    const d = clone()
    d.nodes = d.nodes.filter((n) => n.id !== 'queueB')
    d.edges = d.edges.map((e) => (e.target === 'queueB' ? { ...e, target: 'queueA' } : e.source === 'queueB' ? { ...e, source: 'queueA' } : e))
    const failed = coreFailures(d)
    expect(failed).toContain('cell-isolation')
    expect(failed).toContain('cell-job-queues')
  })

  it('mistake: no rate limiting anywhere — fails until a shedder is named', () => {
    const d = clone()
    for (const n of d.nodes) if (n.id === 'router') { n.tech = 'caddy'; n.notes = undefined }
    expect(coreFailures(d)).toEqual(['flash-sale-shedding'])
    for (const n of d.nodes) if (n.id === 'router') n.label = 'Cell Router + per-shop rate limiter'
    expect(coreFailures(d)).toEqual([])
  })

  it('mistake: router implemented as a business service that reads cell databases', () => {
    const d = clone()
    for (const n of d.nodes) if (n.id === 'router') Object.assign(n, { kind: 'service', tech: 'go', domains: ['storefront'] })
    d.edges.push({ id: 'peek', source: 'router', target: 'dbA', protocol: 'data', label: 'load shop' })
    const { byId } = results(d)
    expect(byId['anti-fat-router'].pass).toBe(false)
    expect(byId['cells-drawn'].pass).toBe(false)
  })

  it('a snowflake cell loses the identical-cells bonus but not core', () => {
    const d = clone()
    d.nodes = d.nodes.filter((n) => n.id !== 'cacheB')
    d.edges = d.edges.filter((e) => e.target !== 'cacheB')
    const { byId } = results(d)
    expect(byId['cells-identical'].pass).toBe(false)
    expect(byId['cell-cache'].pass).toBe(false)
    expect(coreFailures(d)).toEqual([])
  })

  it('alternative: microservices per cell, edge-function router, gateway per cell, control plane pushes via events', () => {
    const cell = (p: string, label: string, y: number): NodeSpec[] => [
      [`${p}`, 'zone', label, 820, y, { w: 1000, h: 330 }],
      [`${p}gw`, 'api-gateway', 'Cell Gateway', 30, 130, { tech: 'kong', parent: p }],
      [`${p}store`, 'service', 'Storefront', 280, 40, { tech: 'go', domains: ['storefront'], parent: p }],
      [`${p}co`, 'service', 'Checkout', 280, 220, { tech: 'go', domains: ['checkout'], parent: p }],
      [`${p}storeDb`, 'document-db', 'Catalogue DB', 540, 40, { tech: 'mongodb', parent: p }],
      [`${p}coDb`, 'relational-db', 'Orders DB', 540, 140, { tech: 'postgres', parent: p }],
      [`${p}q`, 'broker', 'Order Jobs', 540, 240, { tech: 'rabbitmq', parent: p }],
      [`${p}w`, 'worker', 'Fulfilment Worker', 780, 240, { tech: 'go', domains: ['fulfilment'], parent: p }],
    ]
    const cellEdges = (p: string): EdgeSpec[] => [
        [`${p}gw`, `${p}store`],
        [`${p}gw`, `${p}co`],
        [`${p}store`, `${p}storeDb`],
        [`${p}co`, `${p}coDb`],
        [`${p}co`, `${p}q`, 'event'],
        [`${p}q`, `${p}w`, 'event'],
        [`${p}w`, `${p}coDb`],
        [`${p}store`, 'otel'],
        [`${p}co`, 'otel'],
        [`${p}w`, 'otel'],
      ]
    const d = diagram(
      [
        ['web', 'web-app', 'Storefronts', 0, 300, { tech: 'nextjs' }],
        ['mob', 'mobile-app', 'Merchant App', 0, 500, { tech: 'flutter' }],
        ['edge', 'function', 'Edge Cell Router', 260, 400, { tech: 'cf-workers' }],
        ['kv', 'cache', 'Routing KV', 260, 560, { tech: 'valkey' }],
        ...cell('c1', 'Cell eu-1', 0),
        ...cell('c2', 'Cell eu-2', 380),
        ['place', 'service', 'Placement Service', 260, 780, { tech: 'go', domains: ['tenant-placement'] }],
        ['placeDb', 'relational-db', 'Placement DB', 520, 780, { tech: 'cockroachdb' }],
        ['prov', 'service', 'Cell Provisioner', 260, 900, { tech: 'go', domains: ['cell-provisioning'] }],
        ['provDb', 'relational-db', 'Cell Inventory DB', 520, 900, { tech: 'postgres' }],
        ['bus', 'broker', 'Control Events', 820, 780, { tech: 'nats' }],
        ['sync', 'worker', 'Routing Sync', 1080, 780, { tech: 'go' }],
        ['otel', 'otel-collector', 'Collector', 1340, 900, { tech: 'otel-collector' }],
        ['prom', 'metrics', 'Metrics', 1600, 900, { tech: 'prometheus' }],
      ],
      [
        ['web', 'edge', 'http'],
        ['mob', 'edge', 'http'],
        ['edge', 'kv'],
        ['edge', 'c1gw', 'http'],
        ['edge', 'c2gw', 'http'],
        ...cellEdges('c1'),
        ...cellEdges('c2'),
        ['place', 'placeDb'],
        ['prov', 'provDb'],
        ['place', 'bus', 'event', 'ShopMoved'],
        ['bus', 'sync', 'event'],
        ['sync', 'kv'],
        ['place', 'otel'],
        ['prov', 'otel'],
        ['otel', 'prom'],
      ],
    )
    const decisions: Decisions = { style: 'microservices', communication: 'hybrid', data: 'per-service', stack: { backend: 'go' } }
    const { ev } = results(d, decisions)
    const core = ev.results.filter((r) => r.category === 'core' && !r.pass).map((r) => `${r.id}: ${r.detail}`)
    expect(core).toEqual([])
    const anti = ev.results.filter((r) => r.category === 'antipattern' && !r.pass).map((r) => r.id)
    expect(anti).toEqual([])
    expect(ev.passed).toBe(true)
  })

  // --- helpers for focused mutations of the reference ----------------------
  const node = (d: Diagram, id: string) => d.nodes.find((n) => n.id === id)!
  const drop = (d: Diagram, src: string, dst: string) => {
    d.edges = d.edges.filter((e) => !(e.source === src && e.target === dst))
  }
  const removeNode = (d: Diagram, id: string) => {
    d.nodes = d.nodes.filter((n) => n.id !== id)
    d.edges = d.edges.filter((e) => e.source !== id && e.target !== id)
  }
  let seq = 0
  const link = (d: Diagram, source: string, target: string, protocol: Diagram['edges'][number]['protocol'], label?: string) =>
    d.edges.push({ id: `t${seq++}`, source, target, protocol, label })
  const coreAndAnti = (d: Diagram, decisions: Decisions = ref.decisions) =>
    results(d, decisions)
      .ev.results.filter((r) => (r.category === 'core' || r.category === 'antipattern') && !r.pass)
      .map((r) => `${r.id}: ${r.detail}`)

  it('gaming: an ownerless shared service that every cell calls synchronously fails cell-isolation', () => {
    const d = clone()
    d.nodes.push(
      { id: 'shared', kind: 'service', label: 'Shared Order Service', tech: 'go', domains: [], x: 1680, y: 560 },
      { id: 'sharedDb', kind: 'relational-db', label: 'Global Orders DB', tech: 'postgres', domains: [], x: 1940, y: 560 },
    )
    link(d, 'checkoutA', 'shared', 'http')
    link(d, 'checkoutB', 'shared', 'http')
    link(d, 'shared', 'sharedDb', 'data')
    const { byId } = results(d)
    expect(byId['cell-isolation'].pass).toBe(false)
    expect(byId['cell-isolation'].detail).toMatch(/Shared Order Service is called by Cell A.*and Cell B.*hits every cell/)
  })

  it('mistake: a direct call from one cell into another fails cell-isolation', () => {
    const d = clone()
    link(d, 'appA', 'appB', 'http', 'fetch shop')
    expect(results(d).byId['cell-isolation'].detail).toMatch(/crosses cells/)
  })

  it('mistake: a cache shared by two cells fails cell-isolation', () => {
    const d = clone()
    removeNode(d, 'cacheB')
    link(d, 'storeB', 'cacheA', 'data')
    const { byId } = results(d)
    expect(byId['cell-isolation'].pass).toBe(false)
    expect(byId['cell-isolation'].detail).toMatch(/Cache is used by/)
  })

  it('mistake: a client calling a cell directly bypasses the router', () => {
    const d = clone()
    link(d, 'shoppers', 'appA', 'http')
    expect(results(d).byId['thin-router'].detail).toMatch(/call a cell directly/)
  })

  it('gaming: a third cell the router never reaches fails thin-router', () => {
    const d = clone()
    const copy = clone()
      .nodes.filter((n) => n.id === 'cellB' || n.parentId === 'cellB' || n.parentId === 'appB')
      .map((n) => ({ ...n, id: n.id.replace(/B$/, 'C'), parentId: n.parentId?.replace(/B$/, 'C') }))
    copy.find((n) => n.id === 'cellC')!.label = 'Cell C'
    copy.find((n) => n.id === 'cellC')!.y = 1000
    d.nodes.push(...copy)
    for (const [s, t, p] of [
      ['storeC', 'cacheC', 'data'], ['storeC', 'dbC', 'data'], ['checkoutC', 'dbC', 'data'],
      ['checkoutC', 'queueC', 'event'], ['queueC', 'workerC', 'event'], ['workerC', 'dbC', 'data'],
    ] as const)
      link(d, s, t, p)
    const { byId } = results(d)
    expect(byId['thin-router'].pass).toBe(false)
    expect(byId['thin-router'].detail).toMatch(/Cell C is never reached by the router/)
    link(d, 'router', 'appC', 'http')
    expect(results(d).byId['thin-router'].pass).toBe(true)
  })

  it('mistake: control plane placed inside a cell', () => {
    const d = clone()
    node(d, 'cp').parentId = 'cellA'
    expect(results(d).byId['control-plane'].detail).toMatch(/sits inside a cell/)
  })

  it('mistake: control plane without a database of its own', () => {
    const d = clone()
    drop(d, 'cp', 'cpDb')
    expect(results(d).byId['control-plane'].detail).toMatch(/no database of its own/)
  })

  it('mistake: control plane that never updates the routing table', () => {
    const d = clone()
    drop(d, 'cp', 'routing')
    expect(results(d).byId['control-plane'].detail).toMatch(/never updates the routing table/)
  })

  it('gaming: the router reading the control plane’s own DB per request fails control-plane', () => {
    const d = clone()
    removeNode(d, 'routing')
    link(d, 'router', 'cpDb', 'data', 'lookup')
    const { byId } = results(d)
    expect(byId['control-plane'].pass).toBe(false)
    expect(byId['control-plane'].detail).toMatch(/reads the control plane’s own database/)
  })

  it('gaming: one unconnected rate-limiting gateway in one cell does not shed for the platform', () => {
    const d = clone()
    Object.assign(node(d, 'router'), { tech: 'caddy', notes: undefined })
    d.nodes.push({ id: 'kongA', kind: 'api-gateway', label: 'Cell Gateway', tech: 'kong', domains: [], parentId: 'cellA', x: 330, y: 270 })
    expect(results(d).byId['flash-sale-shedding'].pass).toBe(false)
    // Connected in Cell A only: Cell B is still unprotected.
    drop(d, 'router', 'appA')
    link(d, 'router', 'kongA', 'http')
    link(d, 'kongA', 'appA', 'http')
    const r = results(d).byId['flash-sale-shedding']
    expect(r.pass).toBe(false)
    expect(r.detail).toMatch(/Cell B/)
  })

  it('gaming: an outbound "throttler" worker does not count as load shedding', () => {
    const d = clone()
    Object.assign(node(d, 'router'), { tech: 'caddy', notes: undefined })
    node(d, 'workerA').label = 'Webhook throttler'
    node(d, 'workerB').label = 'Webhook throttler'
    expect(results(d).byId['flash-sale-shedding'].pass).toBe(false)
  })

  it('alternative: control plane calls each cell to move / drain shops', () => {
    const d = clone()
    link(d, 'cp', 'appA', 'http', 'move shop / drain')
    link(d, 'cp', 'appB', 'http', 'move shop / drain')
    expect(coreAndAnti(d)).toEqual([])
  })

  it('alternative: control plane pushes routes to the router (Envoy xDS), no routing table node', () => {
    const d = clone()
    removeNode(d, 'routing')
    link(d, 'cp', 'router', 'grpc', 'xDS route push')
    expect(coreAndAnti(d)).toEqual([])
  })

  it('alternative: placement published through outbox + CDC + Kafka into the routing table', () => {
    const d = clone()
    drop(d, 'cp', 'routing')
    d.nodes.push(
      { id: 'cdc', kind: 'cdc', label: 'Outbox Relay', tech: 'debezium', domains: [], x: 260, y: 780 },
      { id: 'kafka', kind: 'broker', label: 'Placement Events', tech: 'kafka', domains: [], x: 260, y: 640 },
      { id: 'rsync', kind: 'worker', label: 'Routing Sync', tech: 'go', domains: [], x: 260, y: 480 },
    )
    link(d, 'cpDb', 'cdc', 'event')
    link(d, 'cdc', 'kafka', 'event')
    link(d, 'kafka', 'rsync', 'event')
    link(d, 'rsync', 'routing', 'data')
    expect(coreAndAnti(d)).toEqual([])
  })

  it('alternative: tier sub-zones inside each cell and a region zone around them', () => {
    const d = clone()
    d.nodes.push({ id: 'region', kind: 'zone', label: 'Region eu-central', domains: [], x: 800, y: -20, width: 820, height: 760 })
    for (const c of ['A', 'B']) {
      node(d, `cell${c}`).parentId = 'region'
      d.nodes.push(
        { id: `web${c}`, kind: 'zone', label: 'Web tier', domains: [], parentId: `cell${c}`, x: 10, y: 30, width: 300, height: 290 },
        { id: `jobs${c}`, kind: 'zone', label: 'Jobs tier', domains: [], parentId: `cell${c}`, x: 530, y: 180, width: 240, height: 100 },
      )
      node(d, `app${c}`).parentId = `web${c}`
      node(d, `worker${c}`).parentId = `jobs${c}`
    }
    expect(coreAndAnti(d)).toEqual([])
    expect(results(d).byId['cells-identical'].pass).toBe(true)
  })

  it('alternative: Cloudflare WAF / waiting room in front of a plain HAProxy router', () => {
    const d = clone()
    Object.assign(node(d, 'router'), { kind: 'load-balancer', tech: 'haproxy', notes: undefined })
    d.nodes.push({ id: 'waf', kind: 'waf', label: 'Edge WAF', tech: 'cloudflare', domains: [], x: 130, y: 330 })
    d.edges = d.edges.map((e) => (e.target === 'cdn' && ['shoppers', 'merchants'].includes(e.source) ? { ...e, target: 'waf' } : e))
    link(d, 'waf', 'cdn', 'http')
    expect(coreAndAnti(d)).toEqual([])
  })

  it('alternative: router drawn as a Go service with a KV routing table does not trip anti-shared-db', () => {
    const d = clone()
    Object.assign(node(d, 'router'), { kind: 'service', tech: 'go' })
    const { byId } = results(d)
    expect(coreAndAnti(d)).toEqual([])
    expect(byId['anti-shared-db'].pass).toBe(true)
  })

  it('empty canvas fails every scenario check without throwing', () => {
    const { ev } = results({ nodes: [], edges: [] }, { stack: {} })
    for (const c of cellPlatform.checks.filter((c) => c.category !== 'antipattern'))
      expect(ev.results.find((r) => r.id === c.id)?.pass, c.id).toBe(false)
    expect(ev.results.every((r) => !r.detail?.startsWith('Check failed to run'))).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { assertScenarioContract } from '../../engine/scenarioContract'
import { evaluateScenario } from '../../engine/evaluate'
import type { Decisions, Diagram, DiagramEdge, DiagramNode } from '../../engine/types'
import { diagram, type NodeSpec } from './builder'
import { vanRental } from './vanrental'

const ref = vanRental.reference

function results(d: Diagram, decisions: Decisions = ref.decisions) {
  const ev = evaluateScenario(vanRental, d, decisions)
  return { ev, pass: (id: string) => ev.results.find((r) => r.id === id)?.pass, detail: (id: string) => ev.results.find((r) => r.id === id)?.detail }
}

/** Copy of the reference with some nodes removed / retouched / added and some edges dropped / added. */
function mutate(opts: {
  dropNodes?: string[]
  dropEdges?: (e: DiagramEdge) => boolean
  addEdges?: DiagramEdge[]
  addNodes?: NodeSpec[]
  patch?: Record<string, Partial<DiagramNode>>
}): Diagram {
  const drop = new Set(opts.dropNodes ?? [])
  const added = diagram(opts.addNodes ?? [], []).nodes
  const nodes = [...ref.diagram.nodes.filter((n) => !drop.has(n.id)).map((n) => ({ ...n, ...(opts.patch?.[n.id] ?? {}) })), ...added]
  const edges = ref.diagram.edges
    .filter((e) => !drop.has(e.source) && !drop.has(e.target))
    .filter((e) => !(opts.dropEdges?.(e) ?? false))
  return { nodes, edges: [...edges, ...(opts.addEdges ?? [])] }
}

const failing = (d: Diagram, decisions: Decisions = ref.decisions) =>
  evaluateScenario(vanRental, d, decisions)
    .results.filter((r) => !r.pass)
    .map((r) => r.id)
    .sort()

const failingCore = (d: Diagram, decisions: Decisions = ref.decisions) =>
  evaluateScenario(vanRental, d, decisions)
    .results.filter((r) => (r.category === 'core' || r.category === 'antipattern') && !r.pass)
    .map((r) => `${r.id}: ${r.detail ?? ''}`)

const isEdge = (source: string, target: string) => (e: DiagramEdge) => e.source === source && e.target === target

const edge = (source: string, target: string, protocol: DiagramEdge['protocol'], label?: string): DiagramEdge => ({
  id: `x-${source}-${target}-${protocol}`,
  source,
  target,
  protocol,
  label,
})

const SCHEMAS = ['sBooking', 'sRental', 'sFleet', 'sBilling']

/** The reference with the Oracle Boundary + schemas collapsed into one plain database node. */
function singleOracleNode(tech = 'oracle'): Diagram {
  const d = mutate({
    dropNodes: ['oracle', ...SCHEMAS],
    addNodes: [['db', 'relational-db', 'Oracle 19c (BUSIK)', 1100, 200, { tech }]],
  })
  const remap = (id: string) => (SCHEMAS.includes(id) || id === 'oracle' ? 'db' : id)
  const extra = ref.diagram.edges
    .filter((e) => SCHEMAS.includes(e.target) || e.source === 'oracle')
    .map((e) => edge(remap(e.source), remap(e.target), e.protocol, e.label))
  const seen = new Set<string>()
  return { nodes: d.nodes, edges: [...d.edges, ...extra.filter((e) => !seen.has(e.id) && !!seen.add(e.id))] }
}

describe('busik-van-rental', () => {
  assertScenarioContract(vanRental)

  it('reference stays within the intermediate size budget', () => {
    expect(ref.diagram.nodes.length).toBeGreaterThanOrEqual(14)
    expect(ref.diagram.nodes.length).toBeLessThanOrEqual(24)
  })

  it('starter (the Delphi + PHP system) fails the service-based core checks', () => {
    const { pass } = results(vanRental.starter!, { ...ref.decisions })
    expect(pass('coarse-domain-services')).toBe(false)
    expect(pass('single-api-entry')).toBe(false)
  })

  // --- Granularity ---------------------------------------------------------------

  it('mistake: everything in one modular monolith', () => {
    const d = diagram(
      [
        ['web', 'web-app', 'Booking Site', 0, 60, { tech: 'nextjs' }],
        ['desk', 'web-app', 'Branch Desk', 0, 200, { tech: 'react' }],
        ['gw', 'api-gateway', 'Gateway', 260, 120, { tech: 'kong' }],
        ['app', 'monolith', 'Busik App', 520, 0, { tech: 'dotnet', w: 500, h: 400 }],
        ['mBooking', 'module', 'Booking', 20, 40, { parent: 'app', tech: 'dotnet', domains: ['pricing', 'reservations'] }],
        ['mRental', 'module', 'Rental Desk', 20, 130, { parent: 'app', tech: 'dotnet', domains: ['customers', 'pickup-return'] }],
        ['mFleet', 'module', 'Fleet', 260, 40, { parent: 'app', tech: 'dotnet', domains: ['fleet', 'maintenance'] }],
        ['mBilling', 'module', 'Billing', 260, 130, { parent: 'app', tech: 'dotnet', domains: ['invoicing', 'payments'] }],
        ['mReports', 'module', 'Reporting', 20, 220, { parent: 'app', tech: 'dotnet', domains: ['reporting'] }],
        ['db', 'relational-db', 'Oracle', 1100, 120, { tech: 'oracle' }],
      ],
      [
        ['web', 'gw'],
        ['desk', 'gw'],
        ['gw', 'app', 'http'],
        ['app', 'db', 'data'],
      ],
    )
    const { ev, pass } = results(d, { ...ref.decisions, style: 'modular-monolith' })
    expect(pass('coarse-domain-services')).toBe(false)
    expect(pass('booking-deploys-alone')).toBe(false)
    expect(pass('style-fit')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('mistake: one service per capability (nine services) is not coarse-grained', () => {
    const services: NodeSpec[] = vanRental.domains.map((dm, i) => [`svc-${dm.id}`, 'service', `${dm.label} Service`, 800, 60 + i * 90, { tech: 'dotnet', domains: [dm.id] }])
    const d = diagram(
      [
        ['web', 'web-app', 'Booking Site', 0, 60, { tech: 'nextjs' }],
        ['desk', 'web-app', 'Branch Desk', 0, 200, { tech: 'react' }],
        ['gw', 'api-gateway', 'Gateway', 400, 120, { tech: 'kong' }],
        ['db', 'relational-db', 'Oracle', 1200, 120, { tech: 'oracle' }],
        ...services,
      ],
      [['web', 'gw'], ['desk', 'gw'], ...services.flatMap(([id]) => [['gw', id, 'http'], [id, 'db', 'data']] as [string, string, 'http' | 'data'][])],
    )
    const { ev, pass, detail } = results(d)
    expect(pass('coarse-domain-services')).toBe(false)
    expect(detail('coarse-domain-services')).toMatch(/one service per capability/)
    expect(pass('anti-fine-grained')).toBe(true)
    expect(ev.passed).toBe(false)
  })

  it('mistake: 16 entity-shaped microservices trip the fine-grained anti-pattern', () => {
    const extra: NodeSpec[] = Array.from({ length: 11 }, (_, i) => [`entity${i}`, 'service', `Entity ${i} Service`, 1700, i * 90, { tech: 'dotnet', domains: ['fleet'] }])
    const d = mutate({ addNodes: extra, addEdges: extra.map(([id]) => edge('gw', id, 'http')) })
    const { pass } = results(d)
    expect(pass('anti-fine-grained')).toBe(false)
    expect(pass('coarse-domain-services')).toBe(false)
  })

  it('mistake: a capability-less "Common Utils" service every domain depends on', () => {
    const d = mutate({
      addNodes: [['common', 'service', 'Common Utils Service', 1460, 200, { tech: 'dotnet' }]],
      addEdges: [edge('booking', 'common', 'http', 'validate')],
    })
    const { pass, detail } = results(d)
    expect(pass('coarse-domain-services')).toBe(false)
    expect(detail('coarse-domain-services')).toMatch(/no business capability/)
  })

  it('mistake: only three services', () => {
    const d = mutate({
      dropNodes: ['reporting'],
      patch: { fleet: { domains: ['fleet', 'maintenance', 'reporting'] }, billing: { domains: ['invoicing', 'payments'] } },
    })
    const d2 = mutate({
      dropNodes: ['reporting', 'billing'],
      patch: { fleet: { domains: ['fleet', 'maintenance', 'invoicing', 'payments', 'reporting'] } },
    })
    expect(results(d).pass('coarse-domain-services')).toBe(true)
    expect(results(d2).pass('coarse-domain-services')).toBe(false)
  })

  // --- Deployability of pricing/booking ----------------------------------------

  it('mistake: Booking also owns maintenance, so every promo redeploys it', () => {
    const d = mutate({ patch: { booking: { domains: ['pricing', 'reservations', 'maintenance'] }, fleet: { domains: ['fleet'] } } })
    const { ev, pass, detail } = results(d)
    expect(pass('booking-deploys-alone')).toBe(false)
    expect(detail('booking-deploys-alone')).toMatch(/maintenance/)
    expect(ev.passed).toBe(false)
  })

  it('mistake: pricing lives in the Billing service with invoicing', () => {
    const d = mutate({ patch: { booking: { domains: ['reservations'] }, billing: { domains: ['pricing', 'invoicing', 'payments'] } } })
    expect(results(d).pass('booking-deploys-alone')).toBe(false)
  })

  // --- One shared database ---------------------------------------------------------

  it('mistake: a separate database per service (the split the brief rules out)', () => {
    const d = mutate({
      dropNodes: ['oracle', ...SCHEMAS],
      addNodes: [
        ['dbB', 'relational-db', 'Booking DB', 1100, 60, { tech: 'oracle' }],
        ['dbR', 'relational-db', 'Rental DB', 1100, 200, { tech: 'oracle' }],
        ['dbF', 'relational-db', 'Fleet DB', 1100, 340, { tech: 'oracle' }],
        ['dbI', 'relational-db', 'Billing DB', 1100, 480, { tech: 'oracle' }],
      ],
      addEdges: [edge('booking', 'dbB', 'data'), edge('rental', 'dbR', 'data'), edge('fleet', 'dbF', 'data'), edge('billing', 'dbI', 'data'), edge('dbB', 'replica', 'data')],
    })
    const { ev, pass, detail } = results(d)
    expect(pass('one-shared-database')).toBe(false)
    expect(detail('one-shared-database')).toMatch(/split across/)
    expect(ev.passed).toBe(false)
  })

  it('mistake: Billing moves its data to MongoDB inside the database Boundary', () => {
    const d = mutate({ patch: { sBilling: { kind: 'document-db', tech: 'mongodb' } } })
    const { pass, detail } = results(d)
    expect(pass('one-shared-database')).toBe(false)
    expect(detail('one-shared-database')).toMatch(/separate databases/)
  })

  it('mistake: migrating to PostgreSQL at the same time as the re-architecture', () => {
    const { pass, detail } = results(singleOracleNode('postgres'))
    expect(pass('one-shared-database')).toBe(false)
    expect(detail('one-shared-database')).toMatch(/second migration/)
  })

  it('mistake: Fleet keeps no data in the database', () => {
    expect(results(mutate({ dropEdges: isEdge('fleet', 'sFleet') })).pass('one-shared-database')).toBe(false)
  })

  // --- API entry -------------------------------------------------------------------

  it('mistake: the Branch Desk calls the Rental Desk service directly', () => {
    const d = mutate({ dropEdges: isEdge('desk', 'gw'), addEdges: [edge('desk', 'rental', 'http')] })
    const { ev, pass } = results(d)
    expect(pass('single-api-entry')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('mistake: the gateway never routes to Booking', () => {
    const d = mutate({ dropEdges: isEdge('gw', 'booking') })
    const { pass, detail } = results(d)
    expect(pass('single-api-entry')).toBe(false)
    expect(detail('single-api-entry')).toMatch(/Reservations/)
  })

  // --- Service-to-service coupling ---------------------------------------------------

  it('mistake: Booking → Fleet → Billing synchronous chain', () => {
    const d = mutate({ addEdges: [edge('booking', 'fleet', 'http', 'van available?'), edge('fleet', 'billing', 'http', 'damage costs')] })
    const { pass, detail } = results(d)
    expect(pass('anti-service-chains')).toBe(false)
    expect(detail('anti-service-chains')).toMatch(/→/)
  })

  it('mistake: Rental Desk and Billing call each other back and forth', () => {
    const d = mutate({ addEdges: [edge('billing', 'rental', 'http', 'contract details')] })
    const { pass, detail } = results(d)
    expect(pass('anti-service-chains')).toBe(false)
    expect(detail('anti-service-chains')).toMatch(/each other/)
  })

  it('a single hop between services is fine (the reference Rental Desk → Billing call)', () => {
    expect(results(ref.diagram).pass('anti-service-chains')).toBe(true)
    expect(ref.diagram.edges.some(isEdge('rental', 'billing'))).toBe(true)
  })

  // --- Reasonable alternatives must pass ---------------------------------------------

  it('alternative: one plain Oracle node instead of a schema Boundary only loses the schema bonus', () => {
    expect(failing(singleOracleNode())).toEqual(['schema-per-domain'])
  })

  it('alternative: domain services drawn as Application containers with modules inside', () => {
    const d = mutate({
      dropNodes: ['fleet'],
      addNodes: [
        ['fleetApp', 'monolith', 'Fleet Service', 1460, -400, { tech: 'dotnet', w: 480, h: 130 }],
        ['mFleet', 'module', 'Fleet register', 20, 40, { parent: 'fleetApp', tech: 'dotnet', domains: ['fleet'] }],
        ['mMaint', 'module', 'Service & inspections', 260, 40, { parent: 'fleetApp', tech: 'dotnet', domains: ['maintenance'] }],
      ],
      addEdges: [edge('gw', 'fleetApp', 'http'), edge('mFleet', 'sFleet', 'data'), edge('mMaint', 'sFleet', 'data'), edge('fleetApp', 'collector', 'telemetry')],
    })
    expect(failingCore(d)).toEqual([])
    // Two modules of the same deployable writing one schema is still a single writer.
    expect(results(d).pass('schema-per-domain')).toBe(true)
  })

  it('alternative: a ClickHouse warehouse fed by CDC from the shared database', () => {
    const d = mutate({
      dropNodes: ['replica'],
      addNodes: [
        ['cdc', 'cdc', 'Change capture', 1460, 820, { tech: 'debezium' }],
        ['dwh', 'analytics-db', 'Reporting Warehouse', 1100, 820, { tech: 'clickhouse' }],
      ],
      addEdges: [edge('oracle', 'cdc', 'event'), edge('cdc', 'dwh', 'event'), edge('reporting', 'dwh', 'data')],
    })
    expect(failing(d)).toEqual([])
  })

  it('alternative: a nightly ETL worker loads the warehouse', () => {
    const d = mutate({
      dropNodes: ['replica'],
      addNodes: [
        ['etl', 'worker', 'Nightly ETL', 1460, 820, { tech: 'dotnet' }],
        ['dwh', 'analytics-db', 'Reporting Warehouse', 1100, 820, { tech: 'clickhouse' }],
      ],
      addEdges: [edge('etl', 'sBilling', 'data', 'read'), edge('etl', 'dwh', 'data'), edge('reporting', 'dwh', 'data')],
    })
    expect(results(d).pass('reporting-off-primary')).toBe(true)
  })

  // --- Bonus checks ----------------------------------------------------------------

  it('bonus: reports run on the live database', () => {
    const d = mutate({ dropNodes: ['replica'], addEdges: [edge('reporting', 'sBilling', 'data', 'read')] })
    expect(failing(d)).toEqual(['reporting-off-primary'])
  })

  it('bonus: a reporting copy nobody feeds', () => {
    expect(failing(mutate({ dropEdges: isEdge('oracle', 'replica') }))).toEqual(['reporting-off-primary'])
  })

  it('bonus: two services write the same schema', () => {
    const d = mutate({ dropEdges: isEdge('booking', 'sFleet'), addEdges: [edge('booking', 'sFleet', 'data', 'reserve van')] })
    expect(failing(d)).toEqual(['schema-per-domain'])
  })

  it('bonus: no weekend cache in front of the shared database', () => {
    expect(failing(mutate({ dropNodes: ['cache'] }))).toEqual(['booking-cache'])
  })

  it('bonus: no ADR written', () => {
    expect(failing(ref.diagram, { ...ref.decisions, rationale: '' })).toEqual(['adr-recorded'])
    expect(failing(ref.diagram, { ...ref.decisions, rationale: 'We picked five services because it felt right for the team size.' })).toEqual(['adr-recorded'])
  })

  it('bonus: a service without telemetry', () => {
    expect(failing(mutate({ dropEdges: isEdge('fleet', 'collector') }))).toEqual(['ops-visibility'])
  })

  it('a single-node odd graph does not throw', () => {
    const d = diagram([['x', 'zone', 'Lonely boundary', 0, 0]], [])
    const { ev } = results(d, { stack: {} })
    expect(ev.results.every((r) => !r.detail?.startsWith('Check failed to run'))).toBe(true)
    expect(ev.passed).toBe(false)
  })
})

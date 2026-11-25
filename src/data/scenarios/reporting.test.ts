import { describe, expect, it } from 'vitest'
import { assertScenarioContract } from '../../engine/scenarioContract'
import { evaluateScenario } from '../../engine/evaluate'
import type { Decisions, Diagram, DiagramEdge, DiagramNode } from '../../engine/types'
import { diagram, type NodeSpec } from './builder'
import { fleetReporting } from './reporting'

const ref = fleetReporting.reference

function results(d: Diagram, decisions: Decisions = ref.decisions) {
  const ev = evaluateScenario(fleetReporting, d, decisions)
  return { ev, pass: (id: string) => ev.results.find((r) => r.id === id)?.pass, detail: (id: string) => ev.results.find((r) => r.id === id)?.detail }
}

/** Copy of the reference with some nodes removed / retouched / added and some edges dropped / added. */
function mutate(opts: {
  dropNodes?: string[]
  dropEdges?: (e: DiagramEdge) => boolean
  addEdges?: DiagramEdge[]
  addNodes?: NodeSpec[]
  patch?: Record<string, Partial<DiagramNode>>
  patchEdges?: (e: DiagramEdge) => DiagramEdge
}): Diagram {
  const drop = new Set(opts.dropNodes ?? [])
  const added = diagram(opts.addNodes ?? [], []).nodes
  const nodes = [...ref.diagram.nodes.filter((n) => !drop.has(n.id)).map((n) => ({ ...n, ...(opts.patch?.[n.id] ?? {}) })), ...added]
  const edges = ref.diagram.edges
    .filter((e) => !drop.has(e.source) && !drop.has(e.target))
    .filter((e) => !(opts.dropEdges?.(e) ?? false))
    .map((e) => opts.patchEdges?.(e) ?? e)
  return { nodes, edges: [...edges, ...(opts.addEdges ?? [])] }
}

const failing = (d: Diagram, decisions: Decisions = ref.decisions) =>
  evaluateScenario(fleetReporting, d, decisions)
    .results.filter((r) => !r.pass)
    .map((r) => r.id)
    .sort()

const failingCore = (d: Diagram, decisions: Decisions = ref.decisions) =>
  evaluateScenario(fleetReporting, d, decisions)
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

describe('trasa-reporting', () => {
  assertScenarioContract(fleetReporting)

  it('reference stays within the intermediate size budget', () => {
    expect(ref.diagram.nodes.length).toBeGreaterThanOrEqual(14)
    expect(ref.diagram.nodes.length).toBeLessThanOrEqual(24)
  })

  it('starter: Power BI wired into five service databases fails every reporting check', () => {
    const { ev, pass } = results(fleetReporting.starter!, fleetReporting.starterDecisions)
    expect(pass('no-db-pull')).toBe(false)
    expect(pass('bi-reads-reporting-store')).toBe(false)
    expect(pass('domain-events-published')).toBe(false)
    expect(pass('events-feed-reporting-store')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  // --- Database pull ----------------------------------------------------------

  it('mistake: Power BI reads ClickHouse but still queries the Orders database', () => {
    const d = mutate({ addEdges: [edge('powerbi', 'ordersDb', 'data', 'customer names')] })
    const { ev, pass, detail } = results(d)
    expect(pass('no-db-pull')).toBe(false)
    expect(detail('no-db-pull')).toContain('Orders DB')
    expect(pass('bi-reads-reporting-store')).toBe(true)
    expect(ev.passed).toBe(false)
  })

  it('mistake: Power BI reads a read replica of the Routing database', () => {
    const d = mutate({
      addNodes: [['replica', 'relational-db', 'Routing Read Replica', 540, 100, { tech: 'postgres' }]],
      addEdges: [edge('routingDb', 'replica', 'data', 'streaming replication'), edge('powerbi', 'replica', 'data')],
    })
    expect(results(d).pass('no-db-pull')).toBe(false)
  })

  it('mistake: a nightly ETL job copies service tables into the warehouse (batch pull)', () => {
    const d = mutate({
      addNodes: [['etl', 'worker', 'Nightly ETL', 1080, 560, { tech: 'spring-boot', domains: ['reporting'] }]],
      addEdges: [edge('etl', 'fleetDb', 'data', 'SELECT * FROM fuel_cards'), edge('etl', 'driversDb', 'data'), edge('etl', 'clickhouse', 'data')],
    })
    const { ev, pass } = results(d)
    expect(pass('no-db-pull')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('mistake: the warehouse replicates straight from a service database (DB-to-DB)', () => {
    const d = mutate({ addEdges: [edge('deliveriesDb', 'clickhouse', 'data', 'nightly replication')] })
    expect(results(d).pass('no-db-pull')).toBe(false)
  })

  it('mistake: an ETL worker without a domain still counts as reporting when it loads the warehouse', () => {
    const d = mutate({
      addNodes: [['etl', 'worker', 'Airflow Loader', 1080, 560, { tech: 'spring-boot' }]],
      addEdges: [edge('etl', 'billingDb', 'data'), edge('etl', 'clickhouse', 'data')],
    })
    expect(results(d).pass('no-db-pull')).toBe(false)
  })

  // --- Reporting store --------------------------------------------------------

  it('mistake: no reporting store, Power BI reads the event bus', () => {
    const d = mutate({ dropNodes: ['clickhouse'], addEdges: [edge('powerbi', 'kafka', 'event', 'streaming dataset')] })
    const { ev, pass } = results(d)
    expect(pass('bi-reads-reporting-store')).toBe(false)
    expect(pass('events-feed-reporting-store')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('mistake: no BI tool at all', () => {
    const d = mutate({ dropNodes: ['powerbi'] })
    expect(results(d).pass('bi-reads-reporting-store')).toBe(false)
  })

  // --- Publishing events ------------------------------------------------------

  it('mistake: Fleet and Drivers do not publish events', () => {
    const d = mutate({ dropEdges: (e) => isEdge('fleet', 'kafka')(e) || isEdge('drivers', 'kafka')(e) })
    const { ev, pass, detail } = results(d)
    expect(pass('domain-events-published')).toBe(false)
    expect(detail('domain-events-published')).toBe('No events from: Fleet, Drivers.')
    expect(pass('events-feed-reporting-store')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('mistake: Deliveries only consumes events, it never publishes them', () => {
    const d = mutate({ dropEdges: isEdge('deliveries', 'kafka'), addEdges: [edge('kafka', 'deliveries', 'event', 'RoutePlanned')] })
    expect(results(d).pass('domain-events-published')).toBe(false)
  })

  it('mistake: events are published, but nothing consumes them into the reporting store', () => {
    const d = mutate({ dropEdges: (e) => isEdge('kafka', 'ingest')(e) || isEdge('kafka', 'flink')(e) })
    const { ev, pass } = results(d)
    expect(pass('domain-events-published')).toBe(true)
    expect(pass('events-feed-reporting-store')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('mistake: an operational service relays events into the warehouse (Orders dual-writes facts)', () => {
    const d = mutate({
      dropEdges: (e) => isEdge('kafka', 'ingest')(e) || isEdge('kafka', 'flink')(e),
      addEdges: [edge('kafka', 'orders', 'event'), edge('orders', 'clickhouse', 'data', 'copy facts')],
    })
    expect(results(d).pass('events-feed-reporting-store')).toBe(false)
  })

  // --- HTTP pull / anemic events ---------------------------------------------

  it('mistake: anemic events — the ingest worker calls Orders back for price and customer', () => {
    const d = mutate({ addEdges: [edge('ingest', 'orders', 'http', 'GET /orders/{id}')] })
    const { ev, pass } = results(d)
    expect(pass('anti-report-http-pull')).toBe(false)
    expect(failingCore(d)).toEqual([expect.stringContaining('anti-report-http-pull')])
    expect(ev.score).toBeLessThan(100)
  })

  it('mistake: Power BI pulls from the service REST APIs through the gateway', () => {
    const d = mutate({
      addNodes: [['gw', 'api-gateway', 'API Gateway', 540, 300, { tech: 'kong' }]],
      addEdges: [edge('powerbi', 'gw', 'http', 'web connector'), edge('gw', 'billing', 'http'), edge('gw', 'routing', 'http')],
    })
    expect(results(d).pass('anti-report-http-pull')).toBe(false)
  })

  it('mistake: the live KPI job enriches each stop with a gRPC call to Deliveries', () => {
    const d = mutate({ addEdges: [edge('flink', 'deliveries', 'grpc', 'getStop')] })
    expect(results(d).pass('anti-report-http-pull')).toBe(false)
  })

  // --- CDC --------------------------------------------------------------------

  it('mistake: raw Debezium CDC from the Fleet DB through Kafka straight into ClickHouse', () => {
    const d = mutate({
      dropEdges: isEdge('fleet', 'kafka'),
      addNodes: [['cdc', 'cdc', 'Debezium CDC', 540, 200, { tech: 'debezium' }]],
      addEdges: [edge('fleetDb', 'cdc', 'event', 'WAL'), edge('cdc', 'kafka', 'event', 'fleet.public.fuel_cards'), edge('kafka', 'clickhouse', 'event', 'Kafka engine')],
    })
    const { ev, pass, detail } = results(d)
    expect(pass('no-db-pull')).toBe(true)
    expect(pass('anti-raw-cdc-to-warehouse')).toBe(false)
    expect(pass('domain-events-published')).toBe(false)
    expect(detail('domain-events-published')).toBe('No events from: Fleet.')
    expect(ev.passed).toBe(false)
  })

  it('mistake: raw Debezium CDC on every service database into Kafka and ClickHouse is not publishing events', () => {
    const dbs = ['ordersDb', 'routingDb', 'fleetDb', 'driversDb', 'deliveriesDb', 'billingDb']
    const d = mutate({
      dropNodes: ['relay', 'ingest', 'flink', 'registry'],
      dropEdges: (e) => e.target === 'kafka',
      patch: { billingDb: { label: 'Billing DB', notes: undefined } },
      patchEdges: (e) => (isEdge('billing', 'billingDb')(e) ? { ...e, label: undefined } : e),
      addNodes: [['cdc', 'cdc', 'Debezium CDC', 540, 300, { tech: 'debezium' }]],
      addEdges: [...dbs.map((db) => edge(db, 'cdc', 'event', 'WAL')), edge('cdc', 'kafka', 'event', 'table changes'), edge('kafka', 'clickhouse', 'event', 'Kafka engine')],
    })
    const { ev, pass, detail } = results(d)
    expect(pass('domain-events-published')).toBe(false)
    expect(detail('domain-events-published')).toBe('No events from: Orders, Routing, Fleet, Drivers, Deliveries, Billing.')
    expect(pass('events-feed-reporting-store')).toBe(false)
    expect(pass('anti-raw-cdc-to-warehouse')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('mistake: an "outbox" label on the CDC edge into the broker does not make raw CDC an outbox relay', () => {
    const d = mutate({
      dropEdges: isEdge('fleet', 'kafka'),
      addNodes: [['cdc', 'cdc', 'Debezium CDC', 540, 200, { tech: 'debezium' }]],
      addEdges: [edge('fleetDb', 'cdc', 'event', 'WAL'), edge('cdc', 'kafka', 'event', 'outbox events'), edge('kafka', 'clickhouse', 'event', 'Kafka engine')],
    })
    const { pass } = results(d)
    expect(pass('domain-events-published')).toBe(false)
    expect(pass('anti-raw-cdc-to-warehouse')).toBe(false)
  })

  const allDbs = ['ordersDb', 'routingDb', 'fleetDb', 'driversDb', 'deliveriesDb', 'billingDb']

  it('mistake: one shared Debezium over all six databases; the Billing outbox does not cover the other five', () => {
    const d = mutate({
      dropNodes: ['relay'],
      dropEdges: (e) => e.target === 'kafka',
      addNodes: [['cdc', 'cdc', 'Debezium CDC', 540, 300, { tech: 'debezium' }]],
      addEdges: [...allDbs.map((db) => edge(db, 'cdc', 'event', 'WAL')), edge('cdc', 'kafka', 'event', 'table changes')],
    })
    const { ev, pass, detail } = results(d)
    expect(pass('domain-events-published')).toBe(false)
    expect(detail('domain-events-published')).toBe('No events from: Orders, Routing, Fleet, Drivers, Deliveries.')
    expect(ev.passed).toBe(false)
  })

  it('mistake: shared Debezium where only the Billing write says outbox still leaves five domains unpublished', () => {
    const d = mutate({
      dropNodes: ['relay'],
      patch: { billingDb: { label: 'Billing DB', notes: undefined } },
      dropEdges: (e) => e.target === 'kafka',
      addNodes: [['cdc', 'cdc', 'Debezium CDC', 540, 300, { tech: 'debezium' }]],
      addEdges: [...allDbs.map((db) => edge(db, 'cdc', 'event', 'WAL')), edge('cdc', 'kafka', 'event', 'table changes')],
    })
    const { pass, detail } = results(d)
    expect(pass('domain-events-published')).toBe(false)
    expect(detail('domain-events-published')).toBe('No events from: Orders, Routing, Fleet, Drivers, Deliveries.')
  })

  it('mistake: shared raw Debezium through Kafka into a ClickHouse sink, Billing DB still labelled "+ Outbox"', () => {
    const d = mutate({
      dropNodes: ['relay', 'ingest', 'flink'],
      dropEdges: (e) => e.target === 'kafka',
      addNodes: [['cdc', 'cdc', 'Debezium CDC', 540, 300, { tech: 'debezium' }]],
      addEdges: [...allDbs.map((db) => edge(db, 'cdc', 'event', 'WAL')), edge('cdc', 'kafka', 'event', 'table changes'), edge('kafka', 'clickhouse', 'event', 'Kafka engine')],
    })
    const { ev, pass, detail } = results(d)
    expect(pass('domain-events-published')).toBe(false)
    expect(detail('domain-events-published')).toBe('No events from: Orders, Routing, Fleet, Drivers, Deliveries.')
    expect(pass('anti-raw-cdc-to-warehouse')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('mistake: raw Fleet CDC topic mirrored broker-to-broker into Kafka with no translator', () => {
    const d = mutate({
      dropEdges: isEdge('fleet', 'kafka'),
      addNodes: [
        ['cdc', 'cdc', 'Debezium CDC', 540, 200, { tech: 'debezium' }],
        ['raw', 'broker', 'Raw Fleet Changes', 540, 300, { tech: 'kafka' }],
      ],
      addEdges: [edge('fleetDb', 'cdc', 'event'), edge('cdc', 'raw', 'event', 'fleet.public.*'), edge('raw', 'kafka', 'event', 'MirrorMaker')],
    })
    const { ev, pass, detail } = results(d)
    expect(pass('domain-events-published')).toBe(false)
    expect(detail('domain-events-published')).toBe('No events from: Fleet.')
    expect(ev.passed).toBe(false)
  })

  it('mistake: the reporting KPI job writing a KPI topic is not a translator for raw Fleet CDC', () => {
    const d = mutate({
      dropEdges: (e) => isEdge('fleet', 'kafka')(e) || isEdge('flink', 'clickhouse')(e),
      addNodes: [
        ['cdc', 'cdc', 'Debezium CDC', 540, 200, { tech: 'debezium' }],
        ['kpi', 'broker', 'KPI Topic', 1200, 170, { tech: 'kafka' }],
      ],
      addEdges: [
        edge('fleetDb', 'cdc', 'event'),
        edge('cdc', 'kafka', 'event', 'fleet.public.fuel_cards'),
        edge('flink', 'kpi', 'event', 'on-time %'),
        edge('kpi', 'clickhouse', 'event', 'Kafka engine'),
      ],
    })
    const { ev, pass, detail } = results(d)
    expect(pass('domain-events-published')).toBe(false)
    expect(detail('domain-events-published')).toBe('No events from: Fleet.')
    expect(ev.passed).toBe(false)
  })

  it('mistake: raw CDC on all six databases into Kafka, reporting Flink → KPI topic → ClickHouse', () => {
    const d = mutate({
      dropNodes: ['relay'],
      patch: { billingDb: { label: 'Billing DB', notes: undefined } },
      patchEdges: (e) => (isEdge('billing', 'billingDb')(e) ? { ...e, label: undefined } : e),
      dropEdges: (e) => e.target === 'kafka' || isEdge('flink', 'clickhouse')(e),
      addNodes: [
        ['cdc', 'cdc', 'Debezium CDC', 540, 300, { tech: 'debezium' }],
        ['kpi', 'broker', 'KPI Topic', 1200, 170, { tech: 'kafka' }],
      ],
      addEdges: [
        ...allDbs.map((db) => edge(db, 'cdc', 'event', 'WAL')),
        edge('cdc', 'kafka', 'event', 'table changes'),
        edge('flink', 'kpi', 'event'),
        edge('kpi', 'clickhouse', 'event'),
      ],
    })
    const { ev, pass, detail } = results(d)
    expect(pass('domain-events-published')).toBe(false)
    expect(detail('domain-events-published')).toBe('No events from: Orders, Routing, Fleet, Drivers, Deliveries, Billing.')
    expect(ev.passed).toBe(false)
  })

  it('alternative: a per-database outbox relay for every service instead of direct publishing', () => {
    const others = allDbs.filter((db) => db !== 'billingDb')
    const d = mutate({
      dropEdges: (e) => e.target === 'kafka' && e.source !== 'relay',
      addNodes: others.map((_, i): NodeSpec => [`r${i}`, 'cdc', `Outbox Relay ${i}`, 540, i * 100, { tech: 'debezium' }]),
      addEdges: others.flatMap((db, i) => [edge(db, `r${i}`, 'event', 'outbox table'), edge(`r${i}`, 'kafka', 'event', 'Event.v1')]),
    })
    expect(failingCore(d)).toEqual([])
  })

  it('mistake: Billing relay labelled outbox only towards the broker fails billing-outbox', () => {
    const d = mutate({
      patch: { relay: { label: 'Debezium CDC', notes: undefined }, billingDb: { label: 'Billing DB', notes: undefined } },
      patchEdges: (e) =>
        isEdge('billing', 'billingDb')(e) || isEdge('billingDb', 'relay')(e)
          ? { ...e, label: undefined }
          : isEdge('relay', 'kafka')(e)
            ? { ...e, label: 'outbox InvoiceIssued.v2' }
            : e,
    })
    const { pass } = results(d)
    expect(pass('billing-outbox')).toBe(false)
    expect(pass('domain-events-published')).toBe(false)
  })

  it('alternative: an outbox relay counts when only the database → relay edge says outbox', () => {
    const d = mutate({
      patch: { relay: { label: 'Debezium', notes: undefined }, billingDb: { label: 'Billing DB', notes: undefined } },
      patchEdges: (e) => (isEdge('billing', 'billingDb')(e) ? { ...e, label: 'invoice' } : e),
    })
    expect(failing(d)).toEqual([])
  })

  it('alternative: an outbox relay counts when only the service write says outbox', () => {
    const d = mutate({
      patch: { relay: { label: 'Debezium', notes: undefined }, billingDb: { label: 'Billing DB', notes: undefined } },
      patchEdges: (e) => (isEdge('billingDb', 'relay')(e) ? { ...e, label: 'WAL' } : e),
    })
    expect(failing(d)).toEqual([])
  })

  it('mistake: raw CDC writes straight into the warehouse, no broker at all', () => {
    const d = mutate({
      addNodes: [['cdc', 'cdc', 'Fivetran-style CDC', 540, 200, { tech: 'kafka-connect' }]],
      addEdges: [edge('fleetDb', 'cdc', 'event'), edge('cdc', 'clickhouse', 'data')],
    })
    expect(results(d).pass('anti-raw-cdc-to-warehouse')).toBe(false)
  })

  // --- Alternatives that must pass --------------------------------------------

  it('alternative: raw CDC for Fleet, translated into domain events by a stream processor (anti-corruption layer)', () => {
    const d = mutate({
      dropEdges: isEdge('fleet', 'kafka'),
      addNodes: [
        ['cdc', 'cdc', 'Debezium CDC', 540, 200, { tech: 'debezium' }],
        ['raw', 'broker', 'Raw Fleet Changes', 540, 300, { tech: 'kafka' }],
        ['acl', 'stream-processor', 'Fleet Translator', 540, 400, { tech: 'kafka-streams', domains: ['fleet'] }],
      ],
      addEdges: [
        edge('fleetDb', 'cdc', 'event'),
        edge('cdc', 'raw', 'event', 'fleet.public.*'),
        edge('raw', 'acl', 'event'),
        edge('acl', 'kafka', 'event', 'FuelBought.v1'),
      ],
    })
    expect(failingCore(d)).toEqual([])
  })

  it('alternative: raw CDC translated by a data-team worker that publishes Fleet events to the domain broker', () => {
    const d = mutate({
      dropEdges: isEdge('fleet', 'kafka'),
      addNodes: [
        ['cdc', 'cdc', 'Debezium CDC', 540, 200, { tech: 'debezium' }],
        ['raw', 'broker', 'Raw Fleet Changes', 540, 300, { tech: 'kafka' }],
        ['acl', 'worker', 'Fleet Translator', 540, 400, { tech: 'spring-boot' }],
      ],
      addEdges: [edge('fleetDb', 'cdc', 'event'), edge('cdc', 'raw', 'event'), edge('raw', 'acl', 'event'), edge('acl', 'kafka', 'event', 'FuelBought.v1')],
    })
    expect(failingCore(d)).toEqual([])
  })

  it('alternative: a dedicated reporting PostgreSQL behind a Reporting service, ClickHouse removed', () => {
    const d = mutate({
      dropNodes: ['clickhouse', 'flink'],
      dropEdges: isEdge('kafka', 'ingest'),
      patch: { ingest: { kind: 'service', label: 'Reporting Service' } },
      addNodes: [['repDb', 'relational-db', 'Reporting DB', 1360, 300, { tech: 'postgres' }]],
      addEdges: [edge('kafka', 'ingest', 'event'), edge('ingest', 'repDb', 'data', 'projections'), edge('powerbi', 'repDb', 'data')],
    })
    expect(failingCore(d)).toEqual([])
  })

  it('alternative: Power BI goes through a Reporting API owned by the reporting context', () => {
    const d = mutate({
      dropEdges: isEdge('powerbi', 'clickhouse'),
      addNodes: [['repApi', 'service', 'Reporting API', 1640, 440, { tech: 'spring-boot', domains: ['reporting'] }]],
      addEdges: [edge('powerbi', 'repApi', 'http', 'OData'), edge('repApi', 'clickhouse', 'data')],
    })
    expect(failingCore(d)).toEqual([])
  })

  it('alternative: ClickHouse ingests from Kafka natively and the drawn arrow points into Power BI', () => {
    const d = mutate({
      dropEdges: (e) => isEdge('powerbi', 'clickhouse')(e) || isEdge('kafka', 'ingest')(e) || isEdge('ingest', 'clickhouse')(e),
      dropNodes: ['ingest'],
      patch: { flink: { domains: ['reporting'] } },
      addEdges: [edge('kafka', 'clickhouse', 'event', 'Kafka table engine'), edge('clickhouse', 'powerbi', 'telemetry')],
    })
    expect(failingCore(d)).toEqual([])
  })

  it('alternative: style declared as event-driven', () => {
    expect(failing(ref.diagram, { ...ref.decisions, style: 'event-driven' })).toEqual([])
  })

  // --- Bonus checks -------------------------------------------------------------

  it('bonus: without the registry, versioned event names still count', () => {
    expect(failing(mutate({ dropNodes: ['registry'] }))).toEqual([])
  })

  it('bonus: no registry and unversioned event names', () => {
    const d = mutate({ dropNodes: ['registry'], patchEdges: (e) => ({ ...e, label: e.label?.replace(/\.v\d+/g, '') }) })
    expect(failing(d)).toEqual(['versioned-contracts'])
  })

  it('bonus: no stream processor for live wallboards', () => {
    expect(failing(mutate({ dropNodes: ['flink'] }))).toEqual(['live-on-time-stream'])
  })

  it('bonus: RabbitMQ deletes events on ack, so history cannot be replayed', () => {
    expect(failing(mutate({ patch: { kafka: { tech: 'rabbitmq' } } }))).toEqual(['replayable-history'])
  })

  it('bonus: Billing dual-writes to Kafka instead of using the outbox', () => {
    const d = mutate({ dropNodes: ['relay'], addEdges: [edge('billing', 'kafka', 'event', 'InvoiceIssued.v2')] })
    expect(failing(d)).toEqual(['billing-outbox'])
  })

  it('bonus: outbox relay kept, but Billing also publishes directly', () => {
    const d = mutate({ addEdges: [edge('billing', 'kafka', 'event', 'InvoiceIssued.v2')] })
    expect(failing(d)).toEqual(['billing-outbox'])
  })

  it('alternative: a relay with outbox-poller tech counts even with no outbox label anywhere', () => {
    const d = mutate({
      patch: { relay: { label: 'Relay', notes: undefined, tech: 'outbox-poller' }, billingDb: { label: 'Billing DB', notes: undefined } },
      patchEdges: (e) => (isEdge('billing', 'billingDb')(e) || isEdge('billingDb', 'relay')(e) ? { ...e, label: undefined } : e),
    })
    expect(failing(d)).toEqual([])
  })

  it('bonus: an outbox poller worker owned by Billing also counts', () => {
    const d = mutate({
      dropNodes: ['relay'],
      addNodes: [['poller', 'worker', 'Outbox Poller', 540, 500, { tech: 'spring-boot', domains: ['billing'] }]],
      addEdges: [edge('poller', 'billingDb', 'data', 'poll outbox'), edge('poller', 'kafka', 'event', 'InvoiceIssued.v2')],
    })
    expect(failing(d)).toEqual([])
  })

  it('a single-node odd graph does not throw', () => {
    const d = diagram([['x', 'dashboards', 'Lonely Power BI', 0, 0]], [])
    const { ev } = results(d, { stack: {} })
    expect(ev.results.every((r) => !r.detail?.startsWith('Check failed to run'))).toBe(true)
    expect(ev.passed).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { assertScenarioContract } from '../../engine/scenarioContract'
import { evaluateScenario } from '../../engine/evaluate'
import type { Decisions, Diagram, DiagramEdge, DiagramNode } from '../../engine/types'
import { diagram, type NodeSpec } from './builder'
import { liveAuction } from './auction'

const ref = liveAuction.reference

function results(d: Diagram, decisions: Decisions = ref.decisions) {
  const ev = evaluateScenario(liveAuction, d, decisions)
  return { ev, pass: (id: string) => ev.results.find((r) => r.id === id)?.pass }
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
  evaluateScenario(liveAuction, d, decisions)
    .results.filter((r) => !r.pass)
    .map((r) => r.id)
    .sort()

const failingCore = (d: Diagram, decisions: Decisions = ref.decisions) =>
  evaluateScenario(liveAuction, d, decisions)
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

describe('licytuj-live-auction', () => {
  assertScenarioContract(liveAuction)

  it('reference stays within the advanced size budget', () => {
    expect(ref.diagram.nodes.length).toBeGreaterThanOrEqual(16)
    expect(ref.diagram.nodes.length).toBeLessThanOrEqual(26)
  })

  it('starter (last December’s monolith) fails the space-based core checks', () => {
    const ids = failing(liveAuction.starter!, liveAuction.starterDecisions!)
    expect(ids).toEqual(expect.arrayContaining(['bids-in-memory', 'data-pump-writer', 'watchers-realtime', 'style-fit']))
  })

  // --- Typical mistakes ----------------------------------------------------------

  it('mistake: the processing unit writes PostgreSQL next to the grid on every bid', () => {
    const d = mutate({ addEdges: [edge('bidPU', 'bidDb', 'data', 'INSERT bid')] })
    const { ev, pass } = results(d)
    expect(pass('bids-in-memory')).toBe(false)
    expect(pass('anti-shared-db')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('mistake: no grid at all, the unit reads and locks the auction row', () => {
    const d = mutate({ dropNodes: ['grid', 'reader'], addEdges: [edge('bidPU', 'bidDb', 'data', 'SELECT … FOR UPDATE')] })
    const { ev, pass } = results(d)
    expect(pass('bids-in-memory')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('mistake: the unit calls a "Bid Store" service over HTTP that writes PostgreSQL', () => {
    const d = mutate({
      addNodes: [['store', 'service', 'Bid Store API', 1160, 0, { tech: 'spring-boot' }]],
      addEdges: [edge('bidPU', 'store', 'http', 'save bid'), edge('store', 'bidDb', 'data')],
    })
    const { ev, pass } = results(d)
    expect(pass('bids-in-memory')).toBe(false)
    expect(pass('anti-pu-sync-calls')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('mistake: the grid writes through to PostgreSQL synchronously', () => {
    const d = mutate({ addEdges: [edge('grid', 'bidDb', 'data', 'MapStore write-through')] })
    expect(results(d).pass('bids-in-memory')).toBe(false)
  })

  it('mistake: the unit asks the catalogue service for the auction on every bid', () => {
    const d = mutate({ addEdges: [edge('bidPU', 'catalogue', 'grpc', 'getAuction')] })
    const { pass } = results(d)
    expect(pass('anti-pu-sync-calls')).toBe(false)
    expect(pass('bids-in-memory')).toBe(false)
  })

  it('mistake: bids live only in the grid (no data writer)', () => {
    const d = mutate({ dropNodes: ['writer'] })
    const { ev, pass } = results(d)
    expect(pass('data-pump-writer')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('mistake: bids never leave the unit (no data pump)', () => {
    const d = mutate({ dropEdges: isEdge('bidPU', 'kafka') })
    const { ev, pass } = results(d)
    expect(pass('data-pump-writer')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('mistake: the unit calls the data writer synchronously', () => {
    const d = mutate({ dropEdges: isEdge('kafka', 'writer'), addEdges: [edge('bidPU', 'writer', 'http', 'persist')] })
    const { pass } = results(d)
    expect(pass('data-pump-writer')).toBe(false)
    expect(pass('anti-pu-sync-calls')).toBe(false)
  })

  it('mistake: watchers poll instead of a realtime gateway', () => {
    const d = mutate({ dropNodes: ['rtg'] })
    const { ev, pass } = results(d)
    expect(pass('watchers-realtime')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('mistake: the live feed is driven by CDC on the bid database', () => {
    const d = mutate({
      dropEdges: isEdge('kafka', 'feed'),
      addNodes: [['cdcFeed', 'cdc', 'Bid CDC', 1460, 0, { tech: 'debezium' }]],
      addEdges: [edge('bidDb', 'cdcFeed', 'event'), edge('cdcFeed', 'feed', 'event')],
    })
    expect(results(d).pass('watchers-realtime')).toBe(false)
  })

  it('mistake: no client opens a WebSocket to the gateway', () => {
    const d = mutate({ dropEdges: (e) => e.target === 'rtg' && e.protocol === 'websocket' })
    expect(results(d).pass('watchers-realtime')).toBe(false)
  })

  it('mistake: settlement asks the processing unit for the winner synchronously', () => {
    const d = mutate({ dropEdges: isEdge('kafka', 'settle'), addEdges: [edge('settle', 'bidPU', 'http', 'GET /winner')] })
    const { ev, pass } = results(d)
    expect(pass('settlement-async')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('mistake: settlement is wired to nothing that tells it an auction closed', () => {
    const d = mutate({ dropEdges: (e) => isEdge('kafka', 'settle')(e) || isEdge('settle', 'bidDb')(e) })
    expect(results(d).pass('settlement-async')).toBe(false)
  })

  it('mistake: the settlement ledger lives in a schemaless store without transactions', () => {
    const d = mutate({
      dropEdges: isEdge('settle', 'bidDb'),
      patch: { settleDb: { kind: 'document-db', tech: 'mongodb' } },
    })
    expect(results(d).pass('settlement-async')).toBe(false)
  })

  // --- Reasonable alternatives must pass ------------------------------------------

  it('alternative: Ignite grid, Redpanda pump, JDBC sink connector as writer, unit publishes to Centrifugo directly', () => {
    const d = mutate({
      dropNodes: ['writer', 'feed', 'push'],
      patch: { grid: { tech: 'apache-ignite' }, kafka: { tech: 'redpanda' }, bidPU: { domains: ['bidding', 'watchers'] } },
      addNodes: [['sink', 'cdc', 'JDBC Sink Connector', 1160, 140, { tech: 'kafka-connect' }]],
      addEdges: [edge('kafka', 'sink', 'event'), edge('sink', 'bidDb', 'data'), edge('bidPU', 'rtg', 'http', 'publish price')],
    })
    expect(failingCore(d)).toEqual([])
    expect(results(d).ev.passed).toBe(true)
  })

  it('alternative: the gateway queues bids on an intake broker and a worker owning Live bidding drains it into the grid', () => {
    const d = mutate({
      dropEdges: isEdge('gw', 'bidPU'),
      patch: { bidPU: { kind: 'worker', label: 'Bidding Worker ×N' } },
      addNodes: [['intake', 'broker', 'Bid Intake', 420, 0, { tech: 'kafka' }]],
      addEdges: [edge('gw', 'intake', 'event', 'bid requests'), edge('intake', 'bidPU', 'event')],
    })
    expect(failingCore(d)).toEqual([])
    expect(failing(d)).toEqual([])
  })

  it('mistake: a broker-fed writer that owns Live bidding is a processing unit writing the database', () => {
    const d = mutate({ patch: { writer: { domains: ['bidding'] } } })
    const { ev, pass } = results(d)
    expect(pass('bids-in-memory')).toBe(false)
    expect(ev.results.find((r) => r.id === 'bids-in-memory')?.detail).toContain('Data Writer')
    expect(ev.passed).toBe(false)
  })

  it('alternative: settlement reads the persisted bid history instead of consuming events', () => {
    const d = mutate({ dropEdges: isEdge('kafka', 'settle') })
    expect(results(d).pass('settlement-async')).toBe(true)
  })

  it('alternative: the realtime gateway consumes the pump directly', () => {
    const d = mutate({ dropEdges: isEdge('feed', 'rtg'), addEdges: [edge('kafka', 'rtg', 'event', 'auction channels')] })
    expect(results(d).pass('watchers-realtime')).toBe(true)
  })

  it('alternative: clients reach the WebSocket gateway through a load balancer', () => {
    const d = mutate({
      dropEdges: (e) => e.target === 'rtg' && e.protocol === 'websocket',
      addNodes: [['wslb', 'load-balancer', 'WS Load Balancer', 280, 140, { tech: 'haproxy' }]],
      addEdges: [edge('web', 'wslb', 'websocket'), edge('app', 'wslb', 'websocket'), edge('wslb', 'rtg', 'websocket')],
    })
    expect(results(d).pass('watchers-realtime')).toBe(true)
  })

  it('a non-recommended style keeps the same diagram but fails style-fit', () => {
    for (const style of ['event-driven', 'microservices', 'serverless'] as const) {
      expect(results(ref.diagram, { ...ref.decisions, style }).pass('style-fit')).toBe(false)
    }
  })

  // --- Bonus checks ----------------------------------------------------------------

  it('bonus: Redis as the bid space is a cache, not a data grid', () => {
    expect(failing(mutate({ patch: { grid: { tech: 'redis' } } }))).toEqual(['grid-topology'])
  })

  it('bonus: a replicated-only grid risks data collisions on hot items', () => {
    const d = mutate({ patch: { grid: { notes: 'ReplicatedMap: full copy of every auction in each unit' } } })
    expect(failing(d)).toEqual(['grid-topology'])
  })

  it('bonus: no data reader leaves the grid empty after a restart', () => {
    expect(failing(mutate({ dropNodes: ['reader'] }))).toEqual(['grid-preload'])
  })

  it('bonus: Redis Pub/Sub as the data pump can drop bids', () => {
    expect(failing(mutate({ patch: { kafka: { tech: 'redis' } } }))).toEqual(['pump-guaranteed'])
  })

  it('bonus: a gateway without rate limiting (plain Caddy proxy)', () => {
    expect(failing(mutate({ patch: { gw: { tech: 'caddy' } } }))).toEqual(['bid-gateway'])
  })

  it('bonus: clients calling the bidding unit directly lose the messaging grid', () => {
    const d = mutate({ addEdges: [edge('app', 'bidPU', 'http', 'POST /bids')] })
    expect(results(d).pass('bid-gateway')).toBe(false)
  })

  it('bonus: settlement without a payment provider', () => {
    expect(failing(mutate({ dropNodes: ['psp'] }))).toEqual(['payouts-psp'])
  })

  it('bonus: no alerting during the finale', () => {
    expect(failing(mutate({ dropNodes: ['alerts'] }))).toEqual(['finale-observability'])
  })

  it('a single-node odd graph does not throw', () => {
    const d = diagram([['x', 'cache', 'Lonely grid', 0, 0]], [])
    const { ev } = results(d, { stack: {} })
    expect(ev.results.every((r) => !r.detail?.startsWith('Check failed to run'))).toBe(true)
    expect(ev.passed).toBe(false)
  })
})

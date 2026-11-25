import { describe, expect, it } from 'vitest'
import { assertScenarioContract } from '../../engine/scenarioContract'
import { evaluateScenario } from '../../engine/evaluate'
import type { Decisions, Diagram, DiagramEdge, DiagramNode } from '../../engine/types'
import { diagram, type NodeSpec } from './builder'
import { tickets } from './tickets'

const ref = tickets.reference
const spaceBased: Decisions = { ...ref.decisions, style: 'space-based' }

function results(d: Diagram, decisions: Decisions = ref.decisions) {
  const ev = evaluateScenario(tickets, d, decisions)
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

const failingCore = (d: Diagram, decisions: Decisions = ref.decisions) =>
  evaluateScenario(tickets, d, decisions)
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

/**
 * Space-based variant of the reference: processing units keep holds and admission tokens in a
 * partitioned data grid, a broker pumps hold changes to a data writer that persists them, and the
 * final booking after payment still commits synchronously to PostgreSQL (UNIQUE(show_id, seat_id)).
 */
function spaceBasedVariant(grid: string, opts: { asyncFinalBooking?: boolean } = {}): Diagram {
  return mutate({
    patch: {
      holdsCache: { tech: grid, label: 'Seat Grid (partitioned, TTL)' },
      queueCache: { tech: grid, label: 'Admission Grid' },
    },
    dropEdges: opts.asyncFinalBooking ? isEdge('booking', 'bookingDb') : undefined,
    addNodes: [['holdWriter', 'worker', 'Data Writer', 1560, 300, { tech: 'spring-boot' }]],
    addEdges: [
      edge('holds', 'kafka', 'event', 'HoldPlaced / HoldReleased (data pump)'),
      edge('kafka', 'holdWriter', 'event'),
      edge('holdWriter', 'bookingDb', 'data', 'persist holds'),
    ],
  })
}

describe('gigsy-flash-sale', () => {
  assertScenarioContract(tickets)

  it('space-based feedback keeps the final booking synchronous, not behind an async writer', () => {
    const fb = tickets.styleFeedback['space-based']!
    expect(fb).toMatch(/commits synchronously to PostgreSQL/)
    expect(fb).toMatch(/partitioned/)
    expect(fb).not.toMatch(/final guard/)
  })

  for (const grid of ['hazelcast', 'apache-ignite', 'apache-geode']) {
    it(`alternative: space-based with a ${grid} grid, data pump, data writer and a synchronous final booking passes`, () => {
      const d = spaceBasedVariant(grid)
      expect(failingCore(d, spaceBased)).toEqual([])
      const { ev, pass } = results(d, spaceBased)
      expect(pass('seat-holds')).toBe(true)
      expect(pass('acid-booking')).toBe(true)
      expect(pass('style-fit')).toBe(true)
      expect(pass('style-consistency')).toBe(true)
      expect(ev.passed).toBe(true)
    })
  }

  it('mistake: space-based booking that only reaches PostgreSQL through the async data writer fails acid-booking', () => {
    const d = spaceBasedVariant('hazelcast', { asyncFinalBooking: true })
    const { ev, pass } = results(d, spaceBased)
    expect(pass('acid-booking')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('mistake: space-based declared but no data writer drawn fails style-consistency only', () => {
    const { pass, ev } = results(ref.diagram, spaceBased)
    expect(pass('style-fit')).toBe(true)
    expect(pass('style-consistency')).toBe(false)
    expect(ev.passed).toBe(true)
  })
})

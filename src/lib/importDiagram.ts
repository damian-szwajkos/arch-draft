// Validation and normalisation of imported ArchDraft JSON files. Anything that would crash the
// canvas or the engine (unknown kinds, dangling references, missing fields) is dropped or fixed
// here and reported back so the UI can tell the user what happened.
import { COMPONENT_BY_KIND, defaultProtocol, PROTOCOL_BY_ID } from '../data/components'
import { STYLE_NAMES } from '../engine/evaluate'
import type {
  ArchStyle,
  CommunicationStyle,
  DataStrategy,
  Decisions,
  Diagram,
  DiagramEdge,
  DiagramNode,
  Protocol,
  StackPreferences,
} from '../engine/types'

export interface ImportResult {
  diagram: Diagram
  decisions: Decisions
  /** Human-readable descriptions of nodes / edges that were dropped. */
  skipped: string[]
  /** Non-fatal adjustments and notices (fixed fields, scenario mismatch). */
  warnings: string[]
  /** Scenario id stored in the file (null for sandbox, undefined when absent). */
  scenario?: string | null
}

export class ImportError extends Error {}

const STYLES = new Set(Object.keys(STYLE_NAMES) as ArchStyle[])
const COMMUNICATION = new Set<CommunicationStyle>(['sync', 'async', 'hybrid'])
const DATA = new Set<DataStrategy>(['shared', 'per-service', 'cqrs'])
const STACK_KEYS: (keyof StackPreferences)[] = ['backend', 'frontend', 'mobile', 'database', 'messaging', 'cache']

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const idOf = (v: unknown) => (typeof v === 'string' && v.trim() ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : undefined)

function normaliseDecisions(raw: unknown): Decisions {
  if (!isObj(raw)) return { stack: {} }
  const stack: StackPreferences = {}
  if (isObj(raw.stack)) for (const k of STACK_KEYS) if (typeof raw.stack[k] === 'string' && raw.stack[k]) stack[k] = raw.stack[k] as string
  const d: Decisions = { stack }
  if (STYLES.has(raw.style as ArchStyle)) d.style = raw.style as ArchStyle
  if (COMMUNICATION.has(raw.communication as CommunicationStyle)) d.communication = raw.communication as CommunicationStyle
  if (DATA.has(raw.data as DataStrategy)) d.data = raw.data as DataStrategy
  if (typeof raw.rationale === 'string') d.rationale = raw.rationale
  return d
}

/**
 * Parse an exported ArchDraft file (or a bare `{ nodes, edges }` diagram).
 * Throws `ImportError` only when the file is not an ArchDraft diagram at all.
 */
export function parseImport(raw: unknown, expectedScenario?: string | null): ImportResult {
  if (!isObj(raw)) throw new ImportError('Not an ArchDraft file.')
  if (raw.app !== undefined && raw.app !== 'archdraft') throw new ImportError('Not an ArchDraft file.')
  const rawDiagram = isObj(raw.diagram) ? raw.diagram : Array.isArray(raw.nodes) ? raw : undefined
  if (!rawDiagram || !Array.isArray(rawDiagram.nodes)) throw new ImportError('Not an ArchDraft file: no diagram nodes found.')
  if (rawDiagram.edges !== undefined && !Array.isArray(rawDiagram.edges)) throw new ImportError('Not an ArchDraft file: edges must be a list.')

  const skipped: string[] = []
  const warnings: string[] = []

  // Nodes ------------------------------------------------------------------
  const nodes: DiagramNode[] = []
  const byId = new Map<string, DiagramNode>()
  rawDiagram.nodes.forEach((rn: unknown, i: number) => {
    if (!isObj(rn)) return void skipped.push(`node #${i + 1} (not an object)`)
    const id = idOf(rn.id)
    const name = str(rn.label) || id || `#${i + 1}`
    if (!id) return void skipped.push(`node “${name}” (missing id)`)
    if (byId.has(id)) return void skipped.push(`node “${name}” (duplicate id)`)
    const kind = rn.kind as DiagramNode['kind']
    const def = typeof kind === 'string' ? COMPONENT_BY_KIND[kind] : undefined
    if (!def) return void skipped.push(`node “${name}” (unknown kind${typeof kind === 'string' ? ` “${kind}”` : ''})`)
    if (!finite(rn.x) || !finite(rn.y)) return void skipped.push(`node “${name}” (invalid position)`)
    const node: DiagramNode = {
      id,
      kind,
      label: str(rn.label) ?? def.defaultLabel,
      domains: Array.isArray(rn.domains) ? rn.domains.filter((d): d is string => typeof d === 'string') : [],
      x: rn.x,
      y: rn.y,
    }
    const tech = str(rn.tech)
    if (tech) node.tech = tech
    const notes = str(rn.notes)
    if (notes) node.notes = notes
    if (def.container) {
      if (finite(rn.width) && rn.width > 0) node.width = rn.width
      if (finite(rn.height) && rn.height > 0) node.height = rn.height
    }
    const parentId = idOf(rn.parentId)
    if (parentId) node.parentId = parentId
    nodes.push(node)
    byId.set(id, node)
  })

  // Parents must exist, be containers, and not form a cycle.
  let droppedParents = 0
  for (const n of nodes) {
    if (!n.parentId) continue
    const parent = byId.get(n.parentId)
    if (!parent || parent.id === n.id || !COMPONENT_BY_KIND[parent.kind].container) {
      delete n.parentId
      droppedParents++
    }
  }
  for (const n of nodes) {
    const seen = new Set<string>([n.id])
    let p = n.parentId ? byId.get(n.parentId) : undefined
    while (p) {
      if (seen.has(p.id)) {
        delete n.parentId
        droppedParents++
        break
      }
      seen.add(p.id)
      p = p.parentId ? byId.get(p.parentId) : undefined
    }
  }
  if (droppedParents) warnings.push(`${droppedParents} component${droppedParents > 1 ? 's were' : ' was'} moved out of a missing or invalid container.`)

  // Parents before children (React Flow requirement); stable within the same depth.
  const depth = (n: DiagramNode): number => (n.parentId ? 1 + depth(byId.get(n.parentId)!) : 0)
  const ordered = nodes.map((n, i) => ({ n, i, d: depth(n) })).sort((a, b) => a.d - b.d || a.i - b.i).map((x) => x.n)

  // Edges ------------------------------------------------------------------
  const edges: DiagramEdge[] = []
  const edgeIds = new Set<string>()
  let fixedProtocols = 0
  ;((rawDiagram.edges as unknown[] | undefined) ?? []).forEach((re, i) => {
    if (!isObj(re)) return void skipped.push(`connection #${i + 1} (not an object)`)
    const source = idOf(re.source)
    const target = idOf(re.target)
    const s = source ? byId.get(source) : undefined
    const t = target ? byId.get(target) : undefined
    const name = `${s?.label ?? source ?? '?'} → ${t?.label ?? target ?? '?'}`
    if (!s || !t) return void skipped.push(`connection ${name} (missing endpoint)`)
    if (s.id === t.id) return void skipped.push(`connection ${name} (connects a component to itself)`)
    let id = idOf(re.id) ?? `e-import-${i}`
    if (edgeIds.has(id)) id = `${id}-${i}`
    if (edgeIds.has(id)) return void skipped.push(`connection ${name} (duplicate id)`)
    let protocol = re.protocol as Protocol
    if (typeof protocol !== 'string' || !PROTOCOL_BY_ID[protocol]) {
      protocol = defaultProtocol(s.kind, t.kind)
      fixedProtocols++
    }
    const edge: DiagramEdge = { id, source: s.id, target: t.id, protocol }
    const label = str(re.label)
    if (label) edge.label = label
    edges.push(edge)
    edgeIds.add(id)
  })
  if (fixedProtocols) warnings.push(`${fixedProtocols} connection${fixedProtocols > 1 ? 's had an unknown protocol' : ' had an unknown protocol'} and got the default.`)

  // Scenario ---------------------------------------------------------------
  const scenario = raw.scenario === null ? null : typeof raw.scenario === 'string' ? raw.scenario : undefined
  if (expectedScenario !== undefined && scenario !== undefined && scenario !== expectedScenario) {
    warnings.unshift(
      scenario
        ? `This file was exported from the “${scenario}” ${expectedScenario ? 'scenario, not this one' : 'scenario'}.`
        : 'This file was exported from the sandbox, not this scenario.',
    )
  }

  return { diagram: { nodes: ordered, edges }, decisions: normaliseDecisions(raw.decisions), skipped, warnings, scenario }
}

/** One-line toast body summarising an import. */
export function summariseImport(r: ImportResult): string {
  const parts: string[] = []
  const n = r.diagram.nodes.length
  const e = r.diagram.edges.length
  parts.push(`Loaded ${n} component${n === 1 ? '' : 's'} and ${e} connection${e === 1 ? '' : 's'}.`)
  if (r.skipped.length) {
    const shown = r.skipped.slice(0, 3).join('; ')
    parts.push(`Skipped ${r.skipped.length}: ${shown}${r.skipped.length > 3 ? `; and ${r.skipped.length - 3} more` : ''}.`)
  }
  parts.push(...r.warnings)
  return parts.join(' ')
}

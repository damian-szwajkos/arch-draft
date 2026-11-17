import { COMPONENT_BY_KIND, defaultProtocol } from '../components'
import type { ComponentKind, Diagram, DiagramNode, Protocol } from '../../engine/types'
import type { Graph } from '../../engine/graph'

type NodeOpts = { tech?: string; domains?: string[]; parent?: string; w?: number; h?: number; notes?: string }
export type NodeSpec = [id: string, kind: ComponentKind, label: string, x: number, y: number, opts?: NodeOpts]
export type EdgeSpec = [source: string, target: string, protocol?: Protocol, label?: string]

/** Compact authoring helper for reference / starter diagrams. */
export function diagram(nodes: NodeSpec[], edges: EdgeSpec[]): Diagram {
  const built: DiagramNode[] = nodes.map(([id, kind, label, x, y, o = {}]) => ({
    id,
    kind,
    label,
    x,
    y,
    tech: o.tech,
    domains: o.domains ?? [],
    parentId: o.parent,
    width: o.w,
    height: o.h,
    notes: o.notes,
  }))
  const byId = new Map(built.map((n) => [n.id, n]))
  return {
    nodes: built,
    edges: edges.map(([source, target, protocol, label], i) => {
      const s = byId.get(source)
      const t = byId.get(target)
      if (!s || !t) throw new Error(`Bad edge ${source} -> ${target}`)
      if (!COMPONENT_BY_KIND[s.kind]) throw new Error(`Unknown kind ${s.kind}`)
      return { id: `e${i}-${source}-${target}`, source, target, protocol: protocol ?? defaultProtocol(s.kind, t.kind), label }
    }),
  }
}

// Predicates used in scenario checks ----------------------------------------

export const kindIs =
  (...kinds: ComponentKind[]) =>
  (n: DiagramNode) =>
    kinds.includes(n.kind)

export const external = (g: Graph, trait: string, labelPattern: RegExp) => (n: DiagramNode) =>
  n.kind === 'external' && (g.hasTrait(n, trait) || labelPattern.test(n.label))

export const PAYMENT = /pay|stripe|adyen|braintree|checkout/i
export const EMAIL = /mail|sendgrid|ses|smtp/i
export const PUSH = /push|fcm|apns|sms|twilio/i
export const MAPS = /map|geo|routing/i

export function observability(g: Graph, ...kinds: ComponentKind[]) {
  const missing = kinds.filter((k) => !g.has(k))
  return missing.length === 0
    ? { pass: true }
    : { pass: false, detail: `Missing: ${missing.map((k) => COMPONENT_BY_KIND[k].name).join(', ')}` }
}

export function ecosystemShare(g: Graph, ecosystem: string) {
  const compute = g.ofKind('service', 'monolith', 'worker', 'bff')
  if (!compute.length) return { pass: false, detail: 'No services yet.' }
  const match = compute.filter((n) => g.ecosystem(n) === ecosystem).length
  return { pass: match / compute.length >= 0.6, detail: `${match}/${compute.length} backend components use the team's ecosystem.` }
}

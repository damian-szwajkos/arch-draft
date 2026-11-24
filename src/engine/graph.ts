import { TECH_BY_ID } from '../data/tech'
import type { ComponentKind, Decisions, Diagram, DiagramEdge, DiagramNode, Protocol } from './types'
import { SYNC_PROTOCOLS } from './types'

export const COMPUTE_KINDS: ComponentKind[] = ['service', 'monolith', 'module', 'worker', 'function', 'orchestrator', 'bff']
export const DEPLOYABLE_KINDS: ComponentKind[] = ['service', 'monolith', 'function']
export const CLIENT_KINDS: ComponentKind[] = ['web-app', 'mobile-app']
export const DATA_KINDS: ComponentKind[] = [
  'relational-db',
  'document-db',
  'cache',
  'search',
  'object-storage',
  'wide-column',
  'analytics-db',
  'graph-db',
]
export const DB_KINDS: ComponentKind[] = ['relational-db', 'document-db', 'wide-column', 'graph-db']
export const MESSAGING_KINDS: ComponentKind[] = ['broker', 'cdc', 'stream-processor']

type NodePredicate = (n: DiagramNode) => boolean

export interface ReachOptions {
  /** Kinds allowed as intermediate hops. Undefined = any kind. */
  through?: ComponentKind[]
  protocols?: Protocol[]
  maxDepth?: number
}

/**
 * Read-only query helper over a diagram. Validation rules are written against
 * this API so they stay short and readable.
 */
export class Graph {
  readonly nodes: DiagramNode[]
  readonly edges: DiagramEdge[]
  readonly decisions: Decisions
  private byId = new Map<string, DiagramNode>()
  private outgoing = new Map<string, DiagramEdge[]>()
  private incoming = new Map<string, DiagramEdge[]>()

  constructor(diagram: Diagram, decisions: Decisions = { stack: {} }) {
    this.nodes = diagram.nodes.filter((n) => n.kind !== 'note')
    this.edges = diagram.edges
    this.decisions = decisions
    for (const n of this.nodes) this.byId.set(n.id, n)
    for (const e of this.edges) {
      if (!this.byId.has(e.source) || !this.byId.has(e.target)) continue
      if (!this.outgoing.has(e.source)) this.outgoing.set(e.source, [])
      if (!this.incoming.has(e.target)) this.incoming.set(e.target, [])
      this.outgoing.get(e.source)!.push(e)
      this.incoming.get(e.target)!.push(e)
    }
  }

  node(id: string) {
    return this.byId.get(id)
  }

  ofKind(...kinds: ComponentKind[]): DiagramNode[] {
    return this.nodes.filter((n) => kinds.includes(n.kind))
  }

  has(...kinds: ComponentKind[]): boolean {
    return this.ofKind(...kinds).length > 0
  }

  count(...kinds: ComponentKind[]): number {
    return this.ofKind(...kinds).length
  }

  techTraits(n: DiagramNode): string[] {
    return n.tech ? (TECH_BY_ID[n.tech]?.traits ?? []) : []
  }

  hasTrait(n: DiagramNode, ...traits: string[]): boolean {
    const t = this.techTraits(n)
    return traits.some((x) => t.includes(x))
  }

  ecosystem(n: DiagramNode): string | undefined {
    return n.tech ? TECH_BY_ID[n.tech]?.ecosystem : undefined
  }

  out(id: string, protocols?: Protocol[]): DiagramEdge[] {
    const list = this.outgoing.get(id) ?? []
    return protocols ? list.filter((e) => protocols.includes(e.protocol)) : list
  }

  in(id: string, protocols?: Protocol[]): DiagramEdge[] {
    const list = this.incoming.get(id) ?? []
    return protocols ? list.filter((e) => protocols.includes(e.protocol)) : list
  }

  targets(id: string, protocols?: Protocol[]): DiagramNode[] {
    return this.out(id, protocols).map((e) => this.byId.get(e.target)!)
  }

  sources(id: string, protocols?: Protocol[]): DiagramNode[] {
    return this.in(id, protocols).map((e) => this.byId.get(e.source)!)
  }

  neighbours(id: string): DiagramNode[] {
    return [...this.targets(id), ...this.sources(id)]
  }

  parent(n: DiagramNode): DiagramNode | undefined {
    return n.parentId ? this.byId.get(n.parentId) : undefined
  }

  children(id: string): DiagramNode[] {
    return this.nodes.filter((n) => n.parentId === id)
  }

  /** Compute nodes owning a business domain. */
  owners(domain: string): DiagramNode[] {
    return this.nodes.filter((n) => n.domains.includes(domain))
  }

  /**
   * The owner plus everything that acts on its behalf: its container
   * (monolith), its child modules, and siblings inside the same deployable.
   */
  family(n: DiagramNode): DiagramNode[] {
    const set = new Map<string, DiagramNode>([[n.id, n]])
    const parent = this.parent(n)
    if (parent && parent.kind === 'monolith') {
      set.set(parent.id, parent)
    }
    for (const c of this.children(n.id)) set.set(c.id, c)
    return [...set.values()]
  }

  ownerFamily(domain: string): DiagramNode[] {
    const out = new Map<string, DiagramNode>()
    for (const o of this.owners(domain)) for (const f of this.family(o)) out.set(f.id, f)
    return [...out.values()]
  }

  /** Is the domain owned by at least one component? */
  owned(domain: string): boolean {
    return this.owners(domain).length > 0
  }

  /** Breadth-first search for any node matching `target`, reachable from `from`. */
  reaches(from: DiagramNode | DiagramNode[], target: NodePredicate, opts: ReachOptions = {}): DiagramNode | undefined {
    const starts = Array.isArray(from) ? from : [from]
    const maxDepth = opts.maxDepth ?? 6
    const seen = new Set(starts.map((s) => s.id))
    let frontier = starts.map((s) => s.id)
    for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
      const next: string[] = []
      for (const id of frontier) {
        for (const e of this.out(id, opts.protocols)) {
          const t = this.byId.get(e.target)
          if (!t || seen.has(t.id)) continue
          seen.add(t.id)
          if (target(t)) return t
          if (!opts.through || opts.through.includes(t.kind)) next.push(t.id)
        }
      }
      frontier = next
    }
    return undefined
  }

  /** Does `from` (or its family) send a direct edge to a node matching `target`? */
  calls(from: DiagramNode[], target: NodePredicate, protocols?: Protocol[]): boolean {
    return from.some((f) => this.targets(f.id, protocols).some(target))
  }

  /**
   * Asynchronous flow from any of `from` to any of `to`: a path that passes
   * through at least one broker (optionally via an outbox table + CDC relay).
   * Once a broker has been crossed, consumers acting as plumbing (workers,
   * functions, orchestrators, stream processors) may relay the flow onward, and
   * a component may consume its own events (e.g. a monolith draining its queue).
   */
  asyncFlow(from: DiagramNode[], to: DiagramNode[]): boolean {
    const toIds = new Set(to.map((t) => t.id))
    const through: ComponentKind[] = [...MESSAGING_KINDS, ...DB_KINDS]
    const relays: ComponentKind[] = ['worker', 'function', 'orchestrator', 'stream-processor']
    // Search from each source, tracking whether a broker was crossed.
    for (const start of from) {
      const queue: { id: string; viaBroker: boolean; depth: number }[] = [
        { id: start.id, viaBroker: false, depth: 0 },
      ]
      const seen = new Set<string>([`${start.id}:false`])
      while (queue.length) {
        const cur = queue.shift()!
        if (cur.depth > 6) continue
        for (const e of this.out(cur.id)) {
          const t = this.byId.get(e.target)
          if (!t) continue
          const viaBroker = cur.viaBroker || t.kind === 'broker' || t.kind === 'cdc'
          if (toIds.has(t.id) && viaBroker) return true
          if (!through.includes(t.kind) && !(viaBroker && relays.includes(t.kind))) continue
          const key = `${t.id}:${viaBroker}`
          if (seen.has(key)) continue
          seen.add(key)
          queue.push({ id: t.id, viaBroker, depth: cur.depth + 1 })
        }
      }
    }
    return false
  }

  /** Data stores accessed (data edges) by a node family. */
  storesOf(owners: DiagramNode[], kinds: ComponentKind[] = DATA_KINDS): DiagramNode[] {
    const out = new Map<string, DiagramNode>()
    for (const o of owners) for (const t of this.targets(o.id, ['data'])) if (kinds.includes(t.kind)) out.set(t.id, t)
    return [...out.values()]
  }

  /** Root deployable of a node (module → its monolith). */
  deployable(n: DiagramNode): DiagramNode {
    const p = this.parent(n)
    return p && p.kind === 'monolith' ? p : n
  }

  /** Databases written/read by more than one independently deployed service. */
  sharedDatabases(): { store: DiagramNode; services: DiagramNode[] }[] {
    const result: { store: DiagramNode; services: DiagramNode[] }[] = []
    for (const store of this.ofKind(...DB_KINDS)) {
      const accessors = this.sources(store.id, ['data']).filter((s) => s.kind === 'service' || s.kind === 'monolith' || s.kind === 'module')
      const units = new Map<string, DiagramNode>()
      for (const a of accessors) {
        const d = this.deployable(a)
        units.set(d.id, d)
      }
      const services = [...units.values()].filter((u) => u.kind === 'service' || u.kind === 'monolith')
      if (services.length > 1) result.push({ store, services })
    }
    return result
  }

  /**
   * Longest chain of synchronous calls between compute nodes. Calls between
   * modules of the same deployable are in-process, so they are not network hops.
   */
  longestSyncChain(): DiagramNode[] {
    const compute = new Set(this.ofKind('service', 'function', 'bff', 'monolith', 'module').map((n) => n.id))
    let best: string[] = []
    const dfs = (id: string, path: string[]) => {
      if (path.length > best.length) best = [...path]
      if (path.length > 12) return
      const unit = this.deployable(this.byId.get(id)!).id
      for (const e of this.out(id, SYNC_PROTOCOLS)) {
        if (!compute.has(e.target) || path.includes(e.target)) continue
        if (this.deployable(this.byId.get(e.target)!).id === unit) continue
        dfs(e.target, [...path, e.target])
      }
    }
    for (const id of compute) dfs(id, [id])
    return best.map((id) => this.byId.get(id)!)
  }

  /**
   * Every client enters through one of `entryKinds` (optionally behind a CDN /
   * WAF / load balancer) and none calls compute directly.
   */
  clientsEnterThrough(entryKinds: ComponentKind[]): { pass: boolean; detail?: string } {
    const clients = this.ofKind(...CLIENT_KINDS)
    if (!clients.length) return { pass: false, detail: 'No clients on the canvas.' }
    const edge: ComponentKind[] = ['cdn', 'waf', 'load-balancer']
    const bypass = clients.filter((c) => this.targets(c.id, SYNC_PROTOCOLS).some((t) => COMPUTE_KINDS.includes(t.kind) && !entryKinds.includes(t.kind)))
    if (bypass.length) return { pass: false, detail: `${bypass.map((c) => c.label).join(', ')} call services directly, bypassing the entry point.` }
    const missing = clients.filter((c) => !(entryKinds.includes(c.kind) || this.reaches(c, (t) => entryKinds.includes(t.kind), { through: edge, maxDepth: 5 })))
    return missing.length ? { pass: false, detail: `${missing.map((c) => c.label).join(', ')} never reach an entry point.` } : { pass: true }
  }

  /** Clients that talk straight to a data store. */
  clientsTouchingData(): DiagramNode[] {
    return this.ofKind(...CLIENT_KINDS, 'device').filter((c) =>
      this.targets(c.id).some((t) => DATA_KINDS.includes(t.kind) && t.kind !== 'object-storage'),
    )
  }

  /** Something on the request path from any client reaches the target kind. */
  clientPathHas(kind: ComponentKind): boolean {
    const clients = this.ofKind(...CLIENT_KINDS)
    return clients.some((c) => this.targets(c.id).some((t) => t.kind === kind))
  }

  /** Compute nodes that export telemetry to any observability component. */
  instrumented(): DiagramNode[] {
    return this.ofKind(...COMPUTE_KINDS, 'api-gateway').filter(
      (n) =>
        this.out(n.id, ['telemetry']).length > 0 ||
        // modules inherit their monolith's instrumentation
        (n.parentId ? this.out(n.parentId, ['telemetry']).length > 0 : false),
    )
  }

  /** Services/monoliths/functions — the things that get deployed independently. */
  deployables(): DiagramNode[] {
    return this.ofKind(...DEPLOYABLE_KINDS)
  }
}

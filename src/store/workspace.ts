import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type XYPosition,
} from '@xyflow/react'
import { create } from 'zustand'
import { COMPONENT_BY_KIND, defaultProtocol } from '../data/components'
import { stackDefault } from '../data/tech'
import type { ComponentKind, Decisions, Diagram, Evaluation, Protocol } from '../engine/types'

export type NodeData = {
  kind: ComponentKind
  label: string
  tech?: string
  domains: string[]
  notes?: string
  flagged?: boolean
}
export type ArchNode = Node<NodeData>
export type EdgeData = { protocol: Protocol; label?: string }
export type ArchEdge = Edge<EdgeData>

export type RightTab = 'inspect' | 'decisions' | 'review'
export type LeftTab = 'brief' | 'components'

interface FlowSnapshot {
  nodes: ArchNode[]
  edges: ArchEdge[]
}

/** One undo step: the canvas plus the architecture decisions. */
interface Snapshot extends FlowSnapshot {
  decisions: Decisions
}

export const CONTAINER_SIZE: Partial<Record<ComponentKind, { width: number; height: number }>> = {
  monolith: { width: 460, height: 300 },
  zone: { width: 420, height: 280 },
}

export function nodeType(kind: ComponentKind) {
  if (COMPONENT_BY_KIND[kind]?.container) return 'container'
  if (kind === 'note') return 'note'
  return 'arch'
}

export function isContainer(n: Pick<ArchNode, 'data'>) {
  return !!COMPONENT_BY_KIND[n.data.kind]?.container
}

/** Containers must precede their children in React Flow's node array. */
function sortNodes(nodes: ArchNode[]) {
  const containers = nodes.filter((n) => isContainer(n))
  const others = nodes.filter((n) => !isContainer(n))
  return [...containers, ...others]
}

export function diagramToFlow(d: Diagram): FlowSnapshot {
  const nodes: ArchNode[] = d.nodes.map((n) => {
    const size = CONTAINER_SIZE[n.kind]
    return {
      id: n.id,
      type: nodeType(n.kind),
      position: { x: n.x, y: n.y },
      parentId: n.parentId,
      ...(size ? { width: n.width ?? size.width, height: n.height ?? size.height } : {}),
      data: { kind: n.kind, label: n.label, tech: n.tech, domains: [...n.domains], notes: n.notes },
    }
  })
  const edges: ArchEdge[] = d.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'arch',
    data: { protocol: e.protocol, label: e.label },
  }))
  return { nodes: sortNodes(nodes), edges }
}

export function flowToDiagram(nodes: ArchNode[], edges: ArchEdge[]): Diagram {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: n.data.kind,
      label: n.data.label,
      tech: n.data.tech,
      domains: n.data.domains ?? [],
      notes: n.data.notes,
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
      parentId: n.parentId,
      ...(isContainer(n)
        ? { width: Math.round(n.width ?? n.measured?.width ?? 400), height: Math.round(n.height ?? n.measured?.height ?? 260) }
        : {}),
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      protocol: e.data?.protocol ?? 'http',
      label: e.data?.label || undefined,
    })),
  }
}

let idCounter = 0
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`

const EMPTY_DECISIONS: Decisions = { stack: {} }

/** Window in which consecutive coalesced edits (typing, toggling) share one undo step. */
const COALESCE_MS = 800

/** True while a container resize gesture is in progress (history is pushed once at its start). */
let resizing = false

interface WorkspaceState {
  storageKey: string
  nodes: ArchNode[]
  edges: ArchEdge[]
  decisions: Decisions
  evaluation?: Evaluation
  past: Snapshot[]
  future: Snapshot[]
  rightTab: RightTab
  leftTab: LeftTab
  dirtySinceEval: boolean
  lastHistoryPush: number
  /** The reference solution was loaded into this workspace: scores are not recorded. */
  usedReference: boolean

  load: (key: string, diagram: Diagram, decisions?: Decisions, usedReference?: boolean) => void
  /** Swap the whole diagram + decisions as ONE undoable step (reset, import, load reference). */
  replaceDiagram: (diagram: Diagram, decisions: Decisions, opts?: { usedReference?: boolean }) => void
  onNodesChange: (changes: NodeChange<ArchNode>[]) => void
  onEdgesChange: (changes: EdgeChange<ArchEdge>[]) => void
  onConnect: (c: Connection) => void
  addNode: (kind: ComponentKind, position: XYPosition, parentId?: string) => string
  updateNode: (id: string, patch: Partial<NodeData>) => void
  updateEdge: (id: string, patch: Partial<EdgeData>) => void
  reverseEdge: (id: string) => void
  removeElements: (ids: string[]) => void
  duplicateNode: (id: string) => void
  setParent: (id: string, parentId: string | undefined, position: XYPosition) => void
  /** Re-parent several nodes in a single update (multi-node drag into / out of containers). */
  setParents: (updates: { id: string; parentId: string | undefined; position: XYPosition }[]) => void
  setDecisions: (patch: Partial<Decisions>) => void
  applyStack: () => number
  setEvaluation: (e?: Evaluation) => void
  select: (id?: string) => void
  setRightTab: (t: RightTab) => void
  setLeftTab: (t: LeftTab) => void
  flag: (ids: string[]) => void
  pushHistory: (coalesce?: boolean) => void
  undo: () => void
  redo: () => void
  diagram: () => Diagram
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  storageKey: '',
  nodes: [],
  edges: [],
  decisions: EMPTY_DECISIONS,
  past: [],
  future: [],
  rightTab: 'decisions',
  leftTab: 'brief',
  dirtySinceEval: true,
  lastHistoryPush: 0,
  usedReference: false,

  load: (key, diagram, decisions, usedReference = false) => {
    const flow = diagramToFlow(diagram)
    resizing = false
    set({
      storageKey: key,
      nodes: flow.nodes,
      edges: flow.edges,
      decisions: decisions ?? EMPTY_DECISIONS,
      evaluation: undefined,
      past: [],
      future: [],
      dirtySinceEval: true,
      lastHistoryPush: 0,
      usedReference,
    })
  },

  replaceDiagram: (diagram, decisions, opts) => {
    get().pushHistory()
    const flow = diagramToFlow(diagram)
    set({
      nodes: flow.nodes,
      edges: flow.edges,
      decisions: { ...decisions, stack: { ...(decisions.stack ?? {}) } },
      evaluation: undefined,
      dirtySinceEval: true,
      // The next edit must start a fresh undo step rather than coalesce into this one.
      lastHistoryPush: 0,
      ...(opts?.usedReference !== undefined ? { usedReference: opts.usedReference } : {}),
    })
  },

  pushHistory: (coalesce = false) => {
    const now = Date.now()
    const { nodes, edges, decisions, past, future, lastHistoryPush } = get()
    // Never coalesce right after an undo: the edit must still discard the redo stack.
    if (coalesce && future.length === 0 && now - lastHistoryPush < COALESCE_MS) return
    set({ past: [...past.slice(-49), { nodes, edges, decisions }], future: [], lastHistoryPush: now })
  },

  undo: () => {
    const { past, nodes, edges, decisions, future } = get()
    const prev = past[past.length - 1]
    if (!prev) return
    set({
      nodes: prev.nodes,
      edges: prev.edges,
      decisions: prev.decisions,
      past: past.slice(0, -1),
      future: [{ nodes, edges, decisions }, ...future],
      dirtySinceEval: true,
      lastHistoryPush: 0,
    })
  },

  redo: () => {
    const { past, nodes, edges, decisions, future } = get()
    const next = future[0]
    if (!next) return
    set({
      nodes: next.nodes,
      edges: next.edges,
      decisions: next.decisions,
      future: future.slice(1),
      past: [...past, { nodes, edges, decisions }],
      dirtySinceEval: true,
      lastHistoryPush: 0,
    })
  },

  // Removals from React Flow (keyboard delete) are recorded once in the canvas's onBeforeDelete,
  // so a node and its connected edges are a single undo step.
  onNodesChange: (changes) => {
    const structural = changes.some((c) => c.type === 'remove' || c.type === 'add')
    const dragEnd = changes.some((c) => c.type === 'position' && c.dragging === false)
    const resizeStart = changes.some((c) => c.type === 'dimensions' && c.resizing === true)
    const resizeEnd = changes.some((c) => c.type === 'dimensions' && c.resizing === false)
    if (resizeStart && !resizing) {
      resizing = true
      get().pushHistory()
    }
    if (resizeEnd) resizing = false
    const nodes = applyNodeChanges(changes, get().nodes)
    const meaningful = structural || dragEnd || resizeEnd || changes.some((c) => c.type === 'position')
    set({ nodes, ...(meaningful ? { dirtySinceEval: true } : {}) })
    if (changes.some((c) => c.type === 'select')) {
      const anySelected = nodes.some((n) => n.selected) || get().edges.some((e) => e.selected)
      if (anySelected && get().rightTab !== 'inspect') set({ rightTab: 'inspect' })
    }
  },

  onEdgesChange: (changes) => {
    const edges = applyEdgeChanges(changes, get().edges)
    const meaningful = changes.some((c) => c.type !== 'select')
    set({ edges, ...(meaningful ? { dirtySinceEval: true } : {}) })
    if (changes.some((c) => c.type === 'select' && c.selected) && get().rightTab !== 'inspect') set({ rightTab: 'inspect' })
  },

  onConnect: (c) => {
    if (!c.source || !c.target || c.source === c.target) return
    const { nodes, edges } = get()
    const s = nodes.find((n) => n.id === c.source)
    const t = nodes.find((n) => n.id === c.target)
    if (!s || !t || s.data.kind === 'note' || t.data.kind === 'note') return
    if (edges.some((e) => e.source === c.source && e.target === c.target)) return
    get().pushHistory()
    const protocol = defaultProtocol(s.data.kind, t.data.kind)
    set({
      // Handle ids are dropped: edges float between node borders, and the 'drop' handle is transient.
      edges: addEdge<ArchEdge>({ ...c, sourceHandle: null, targetHandle: null, id: uid('e'), type: 'arch', data: { protocol } }, edges),
      dirtySinceEval: true,
    })
  },

  addNode: (kind, position, parentId) => {
    get().pushHistory()
    const def = COMPONENT_BY_KIND[kind]
    const id = uid(kind)
    const size = CONTAINER_SIZE[kind]
    const sameKind = get().nodes.filter((n) => n.data.kind === kind).length
    const node: ArchNode = {
      id,
      type: nodeType(kind),
      position,
      parentId,
      selected: true,
      ...(size ? { width: size.width, height: size.height } : {}),
      data: {
        kind,
        label: sameKind ? `${def.defaultLabel} ${sameKind + 1}` : def.defaultLabel,
        tech: stackDefault(kind, get().decisions.stack),
        domains: [],
      },
    }
    set({
      nodes: sortNodes([...get().nodes.map((n) => ({ ...n, selected: false })), node]),
      edges: get().edges.map((e) => ({ ...e, selected: false })),
      rightTab: 'inspect',
      dirtySinceEval: true,
    })
    return id
  },

  updateNode: (id, patch) => {
    get().pushHistory(true)
    set({ nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)), dirtySinceEval: true })
  },

  updateEdge: (id, patch) => {
    get().pushHistory(true)
    set({
      edges: get().edges.map((e) => (e.id === id ? { ...e, data: { protocol: 'http', ...e.data, ...patch } } : e)),
      dirtySinceEval: true,
    })
  },

  reverseEdge: (id) => {
    get().pushHistory()
    set({
      edges: get().edges.map((e) =>
        e.id === id ? { ...e, source: e.target, target: e.source, sourceHandle: e.targetHandle, targetHandle: e.sourceHandle } : e,
      ),
      dirtySinceEval: true,
    })
  },

  removeElements: (ids) => {
    get().pushHistory()
    const idSet = new Set(ids)
    // Removing a container removes its children too.
    let grew = true
    while (grew) {
      grew = false
      for (const n of get().nodes) if (n.parentId && idSet.has(n.parentId) && !idSet.has(n.id)) (idSet.add(n.id), (grew = true))
    }
    set({
      nodes: get().nodes.filter((n) => !idSet.has(n.id)),
      edges: get().edges.filter((e) => !idSet.has(e.id) && !idSet.has(e.source) && !idSet.has(e.target)),
      dirtySinceEval: true,
    })
  },

  duplicateNode: (id) => {
    const n = get().nodes.find((x) => x.id === id)
    if (!n || isContainer(n)) return
    get().pushHistory()
    const copy: ArchNode = {
      ...n,
      id: uid(n.data.kind),
      position: { x: n.position.x + 30, y: n.position.y + 40 },
      selected: true,
      data: { ...n.data, label: `${n.data.label} copy`, domains: [...n.data.domains] },
    }
    set({ nodes: sortNodes([...get().nodes.map((x) => ({ ...x, selected: false })), copy]), dirtySinceEval: true })
  },

  setParent: (id, parentId, position) => get().setParents([{ id, parentId, position }]),

  setParents: (updates) => {
    if (!updates.length) return
    const byId = new Map(updates.map((u) => [u.id, u]))
    set({
      nodes: sortNodes(
        get().nodes.map((n) => {
          const u = byId.get(n.id)
          return u ? { ...n, parentId: u.parentId, position: u.position, extent: undefined } : n
        }),
      ),
      dirtySinceEval: true,
    })
  },

  setDecisions: (patch) => {
    get().pushHistory(true)
    set({ decisions: { ...get().decisions, ...patch }, dirtySinceEval: true })
  },

  applyStack: () => {
    get().pushHistory()
    let changed = 0
    const stack = get().decisions.stack
    const nodes = get().nodes.map((n) => {
      const t = stackDefault(n.data.kind, stack)
      if (t && t !== n.data.tech) {
        changed++
        return { ...n, data: { ...n.data, tech: t } }
      }
      return n
    })
    set({ nodes, dirtySinceEval: true })
    return changed
  },

  setEvaluation: (evaluation) => set({ evaluation, dirtySinceEval: false }),

  select: (id) =>
    set({
      nodes: get().nodes.map((n) => ({ ...n, selected: n.id === id })),
      edges: get().edges.map((e) => ({ ...e, selected: e.id === id })),
      ...(id ? { rightTab: 'inspect' as RightTab } : {}),
    }),

  setRightTab: (rightTab) => set({ rightTab }),
  setLeftTab: (leftTab) => set({ leftTab }),

  flag: (ids) => {
    const s = new Set(ids)
    set({ nodes: get().nodes.map((n) => ({ ...n, data: { ...n.data, flagged: s.has(n.id) } })) })
  },

  diagram: () => flowToDiagram(get().nodes, get().edges),
}))

import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type NodeTypes,
  type EdgeTypes,
  type XYPosition,
} from '@xyflow/react'
import { useCallback, useEffect, useState, type DragEvent } from 'react'
import { MousePointer2 } from 'lucide-react'
import { CATEGORY_STYLE, COMPONENT_BY_KIND } from '../../data/components'
import type { ComponentKind } from '../../engine/types'
import { isContainer, useWorkspace, type ArchEdge, type ArchNode } from '../../store/workspace'
import { ArchNodeView } from './ArchNodeView'
import { ContainerNodeView } from './ContainerNodeView'
import { NoteNodeView } from './NoteNodeView'
import { ArchEdgeView } from './ArchEdgeView'
import { CanvasToolbar } from './CanvasToolbar'

export const nodeTypes: NodeTypes = { arch: ArchNodeView, container: ContainerNodeView, note: NoteNodeView }
export const edgeTypes: EdgeTypes = { arch: ArchEdgeView }
export const DND_MIME = 'application/archdraft-kind'

/** Find the innermost container whose bounds contain the given flow point. */
export function useContainerAt() {
  const { getInternalNode } = useReactFlow<ArchNode>()
  return useCallback(
    (point: XYPosition, excludeId?: string) => {
      const nodes = useWorkspace.getState().nodes
      let best: { id: string; area: number; x: number; y: number } | undefined
      for (const n of nodes) {
        if (!isContainer(n) || n.id === excludeId) continue
        const internal = getInternalNode(n.id)
        if (!internal) continue
        const p = internal.internals.positionAbsolute
        const w = internal.measured.width ?? 0
        const h = internal.measured.height ?? 0
        if (point.x >= p.x && point.x <= p.x + w && point.y >= p.y && point.y <= p.y + h) {
          const area = w * h
          if (!best || area < best.area) best = { id: n.id, area, x: p.x, y: p.y }
        }
      }
      return best
    },
    [getInternalNode],
  )
}

export function Canvas() {
  const nodes = useWorkspace((s) => s.nodes)
  const edges = useWorkspace((s) => s.edges)
  const onNodesChange = useWorkspace((s) => s.onNodesChange)
  const onEdgesChange = useWorkspace((s) => s.onEdgesChange)
  const onConnect = useWorkspace((s) => s.onConnect)
  const { screenToFlowPosition, getInternalNode } = useReactFlow<ArchNode>()
  const containerAt = useContainerAt()
  const [showMap, setShowMap] = useState(false)

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      const kind = e.dataTransfer.getData(DND_MIME) as ComponentKind
      if (!kind || !COMPONENT_BY_KIND[kind]) return
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const container = COMPONENT_BY_KIND[kind].container ? undefined : containerAt(p)
      const pos = { x: p.x - 100, y: p.y - 28 }
      if (container) useWorkspace.getState().addNode(kind, { x: pos.x - container.x, y: pos.y - container.y }, container.id)
      else useWorkspace.getState().addNode(kind, pos)
    },
    [screenToFlowPosition, containerAt],
  )

  // Re-parent nodes dropped into / out of containers — every dragged node, in one update.
  const onNodeDragStop = useCallback(
    (_: unknown, node: ArchNode, dragged: ArchNode[]) => {
      const moved = dragged.length ? dragged : [node]
      const movedIds = new Set(moved.map((n) => n.id))
      const updates: { id: string; parentId: string | undefined; position: XYPosition }[] = []
      for (const n of moved) {
        // Containers keep their place; children of a container that moved with it stay inside it.
        if (isContainer(n) || (n.parentId && movedIds.has(n.parentId))) continue
        const internal = getInternalNode(n.id)
        if (!internal) continue
        const abs = internal.internals.positionAbsolute
        const center = { x: abs.x + (internal.measured.width ?? 0) / 2, y: abs.y + (internal.measured.height ?? 0) / 2 }
        const container = containerAt(center, n.id)
        if (container?.id === n.parentId) continue
        updates.push(
          container
            ? { id: n.id, parentId: container.id, position: { x: abs.x - container.x, y: abs.y - container.y } }
            : { id: n.id, parentId: undefined, position: { x: abs.x, y: abs.y } },
        )
      }
      useWorkspace.getState().setParents(updates)
    },
    [getInternalNode, containerAt],
  )

  // One keyboard delete (a node plus its connected edges) = one undo step.
  const onBeforeDelete = useCallback(async ({ nodes, edges }: { nodes: ArchNode[]; edges: ArchEdge[] }) => {
    if (nodes.length || edges.length) useWorkspace.getState().pushHistory()
    return true
  }, [])

  // Undo / redo / duplicate shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) (e.preventDefault(), useWorkspace.getState().undo())
      else if ((k === 'z' && e.shiftKey) || k === 'y') (e.preventDefault(), useWorkspace.getState().redo())
      else if (k === 'd') {
        const sel = useWorkspace.getState().nodes.find((n) => n.selected)
        if (sel) (e.preventDefault(), useWorkspace.getState().duplicateNode(sel.id))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="relative h-full w-full" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow<ArchNode, ArchEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStart={() => useWorkspace.getState().pushHistory()}
        onNodeDragStop={onNodeDragStop}
        onBeforeDelete={onBeforeDelete}
        connectionMode={ConnectionMode.Loose}
        deleteKeyCode={['Backspace', 'Delete']}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.15}
        maxZoom={2}
        snapToGrid
        snapGrid={[10, 10]}
        defaultEdgeOptions={{ type: 'arch' }}
        proOptions={{ hideAttribution: false }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} />
        {showMap && (
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            nodeColor={(n) => CATEGORY_STYLE[COMPONENT_BY_KIND[(n as ArchNode).data.kind].category].dot}
            nodeStrokeWidth={0}
            maskColor="rgba(99,102,241,0.08)"
          />
        )}
      </ReactFlow>
      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <div className="max-w-sm rounded-2xl border border-dashed border-zinc-300 bg-white/80 p-6 text-center backdrop-blur dark:border-white/15 dark:bg-white/5">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
              <MousePointer2 className="h-5 w-5" />
            </div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-white">Your canvas is empty</p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Drag components from the <b>Components</b> panel (or click them) and connect their edges to describe how they talk.
            </p>
          </div>
        </div>
      )}
      <CanvasToolbar showMap={showMap} onToggleMap={() => setShowMap((v) => !v)} />
    </div>
  )
}

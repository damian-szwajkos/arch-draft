import { BaseEdge, EdgeLabelRenderer, getBezierPath, Position, useInternalNode, type EdgeProps, type InternalNode } from '@xyflow/react'
import { memo, useId } from 'react'
import { PROTOCOL_BY_ID } from '../../data/components'
import type { Protocol } from '../../engine/types'
import { cn } from '../../lib/cn'
import { useWorkspace, type ArchEdge, type ArchNode } from '../../store/workspace'

export const PROTOCOL_STYLE: Record<Protocol, { color: string; dash?: string; width: number; animated?: boolean }> = {
  http: { color: '#94a3b8', width: 1.6 },
  grpc: { color: '#64748b', width: 1.6 },
  graphql: { color: '#d946ef', width: 1.6 },
  websocket: { color: '#8b5cf6', width: 1.8 },
  event: { color: '#f59e0b', dash: '6 4', width: 1.8, animated: true },
  data: { color: '#10b981', width: 1.5 },
  telemetry: { color: '#f43f5e', dash: '2 5', width: 1.4 },
}

type Pt = { x: number; y: number }

function centerOf(n: InternalNode<ArchNode>): Pt {
  const p = n.internals.positionAbsolute
  return { x: p.x + (n.measured.width ?? 0) / 2, y: p.y + (n.measured.height ?? 0) / 2 }
}

/** Point where the line between two node centres crosses the border of `node`. */
function intersection(node: InternalNode<ArchNode>, other: Pt): Pt {
  const w = (node.measured.width ?? 0) / 2
  const h = (node.measured.height ?? 0) / 2
  const c = centerOf(node)
  const xx1 = (other.x - c.x) / (2 * w) - (other.y - c.y) / (2 * h)
  const yy1 = (other.x - c.x) / (2 * w) + (other.y - c.y) / (2 * h)
  const a = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1)
  const xx3 = a * xx1
  const yy3 = a * yy1
  return { x: w * (xx3 + yy3) + c.x, y: h * (-xx3 + yy3) + c.y }
}

function side(node: InternalNode<ArchNode>, p: Pt): Position {
  const pos = node.internals.positionAbsolute
  const w = node.measured.width ?? 0
  const h = node.measured.height ?? 0
  if (p.x <= pos.x + 1) return Position.Left
  if (p.x >= pos.x + w - 1) return Position.Right
  if (p.y <= pos.y + 1) return Position.Top
  if (p.y >= pos.y + h - 1) return Position.Bottom
  return Position.Top
}

function ArchEdgeViewImpl({ id, source, target, data, selected }: EdgeProps<ArchEdge>) {
  const markerId = `ad-m-${useId().replace(/:/g, '')}`
  const s = useInternalNode<ArchNode>(source)
  const t = useInternalNode<ArchNode>(target)
  if (!s || !t || !s.measured.width || !t.measured.width) return null

  const sp = intersection(s, centerOf(t))
  const tp = intersection(t, centerOf(s))
  const protocol = data?.protocol ?? 'http'
  const st = PROTOCOL_STYLE[protocol]
  const [path, labelX, labelY] = getBezierPath({
    sourceX: sp.x,
    sourceY: sp.y,
    sourcePosition: side(s, sp),
    targetX: tp.x,
    targetY: tp.y,
    targetPosition: side(t, tp),
    curvature: 0.2,
  })
  const short = PROTOCOL_BY_ID[protocol].short
  const stroke = selected ? '#6366f1' : st.color
  return (
    <>
      <defs>
        <marker id={markerId} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={stroke} />
        </marker>
      </defs>
      <BaseEdge
        id={id}
        path={path}
        className={cn('arch-edge-path', st.animated && 'edge-animated')}
        markerEnd={`url(#${markerId})`}
        interactionWidth={18}
        style={{ stroke, strokeWidth: selected ? st.width + 0.8 : st.width, strokeDasharray: st.dash }}
      />
      <EdgeLabelRenderer>
        <div
          className={cn(
            'nodrag nopan pointer-events-auto absolute flex max-w-[180px] items-center gap-1 rounded-full border bg-white/95 px-1.5 py-[1px] text-[10px] font-medium shadow-sm backdrop-blur dark:bg-[#1a1d26]/95',
            selected ? 'border-brand-400 text-brand-700 dark:text-brand-300' : 'border-zinc-200 text-zinc-600 dark:border-white/10 dark:text-zinc-300',
          )}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          onClick={() => useWorkspace.getState().select(id)}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: st.color }} />
          <span className="font-mono">{short}</span>
          {data?.label && <span className="truncate text-zinc-500 dark:text-zinc-400">· {data.label}</span>}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
export const ArchEdgeView = memo(ArchEdgeViewImpl)

import { Handle, Position, useConnection, type NodeProps } from '@xyflow/react'
import { memo } from 'react'
import { CATEGORY_STYLE, COMPONENT_BY_KIND } from '../../data/components'
import { TECH_BY_ID } from '../../data/tech'
import { cn } from '../../lib/cn'
import { KIND_ICON } from '../../lib/icons'
import type { ArchNode } from '../../store/workspace'
import { useWorkspaceContext } from '../workspace/ScenarioContext'

/** Returns true while the user drags a connection from another node. */
export function useIsDropTarget(id: string) {
  return useConnection((c) => c.inProgress && c.fromNode?.id !== id)
}

/** Four visible connection handles + a full-size drop zone while connecting. */
export function Handles({ dropTarget = false }: { dropTarget?: boolean }) {
  return (
    <>
      {dropTarget && (
        <Handle
          type="target"
          position={Position.Top}
          id="drop"
          isConnectableStart={false}
          style={{ left: 0, top: 0, width: '100%', height: '100%', transform: 'none', borderRadius: 12, opacity: 0, border: 0 }}
        />
      )}
      <Handle type="source" position={Position.Top} id="t" />
      <Handle type="source" position={Position.Right} id="r" />
      <Handle type="source" position={Position.Bottom} id="b" />
      <Handle type="source" position={Position.Left} id="l" />
    </>
  )
}

function ArchNodeViewImpl({ id, data, selected }: NodeProps<ArchNode>) {
  const dropTarget = useIsDropTarget(id)
  const def = COMPONENT_BY_KIND[data.kind]
  const Icon = KIND_ICON[data.kind]
  const style = CATEGORY_STYLE[def.category]
  const tech = data.tech ? TECH_BY_ID[data.tech]?.name : undefined
  const { domainLabel } = useWorkspaceContext()
  return (
    <div
      className={cn(
        'relative w-[200px] rounded-xl border bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(16,24,40,0.06)] transition-shadow dark:bg-[#1a1d26]',
        selected
          ? 'border-brand-500 shadow-[0_0_0_3px_rgba(99,102,241,0.18)]'
          : 'border-zinc-200 hover:shadow-md dark:border-white/10',
        data.flagged && !selected && 'border-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.25)]',
        dropTarget && 'hover:border-brand-500 hover:shadow-[0_0_0_4px_rgba(99,102,241,0.25)]',
      )}
    >
      <Handles dropTarget={dropTarget} />
      <div className="flex items-center gap-2.5">
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', style.tile, style.text)}>
          <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] leading-tight font-semibold text-zinc-900 dark:text-zinc-50">{data.label}</div>
          <div className={cn('mt-0.5 truncate text-[11px] leading-tight', tech ? 'font-medium text-zinc-600 dark:text-zinc-300' : 'text-zinc-400')}>
            {tech ?? def.name}
          </div>
        </div>
      </div>
      {data.domains.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {data.domains.map((d) => (
            <span key={d} className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
              {domainLabel(d)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
export const ArchNodeView = memo(ArchNodeViewImpl)

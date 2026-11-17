import { NodeResizer, type NodeProps } from '@xyflow/react'
import { memo } from 'react'
import { TECH_BY_ID } from '../../data/tech'
import { cn } from '../../lib/cn'
import { KIND_ICON } from '../../lib/icons'
import type { ArchNode } from '../../store/workspace'
import { useWorkspaceContext } from '../workspace/ScenarioContext'
import { Handles, useIsDropTarget } from './ArchNodeView'

function ContainerNodeViewImpl({ id, data, selected }: NodeProps<ArchNode>) {
  const dropTarget = useIsDropTarget(id)
  const Icon = KIND_ICON[data.kind]
  const tech = data.tech ? TECH_BY_ID[data.tech]?.name : undefined
  const isApp = data.kind === 'monolith'
  const { domainLabel } = useWorkspaceContext()
  return (
    <div
      className={cn(
        'relative h-full w-full rounded-2xl border-2 border-dashed',
        isApp
          ? 'border-indigo-300 bg-indigo-50/50 dark:border-indigo-400/40 dark:bg-indigo-500/[0.06]'
          : 'border-stone-300 bg-stone-100/40 dark:border-stone-500/40 dark:bg-white/[0.02]',
        selected && 'border-brand-500',
        data.flagged && !selected && 'border-amber-400',
        dropTarget && 'hover:border-brand-500',
      )}
    >
      <NodeResizer isVisible={selected} minWidth={240} minHeight={150} lineClassName="!border-transparent" />
      <Handles dropTarget={dropTarget} />
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <div className={cn('flex h-6 w-6 items-center justify-center rounded-md', isApp ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300' : 'bg-stone-200 text-stone-600 dark:bg-white/10 dark:text-stone-300')}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <span className="truncate text-[13px] font-semibold text-zinc-800 dark:text-zinc-100">{data.label}</span>
        {tech && <span className="truncate rounded-md bg-white/80 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-white/10 dark:text-zinc-300">{tech}</span>}
        {isApp && <span className="ml-auto shrink-0 text-[10px] font-medium tracking-wide text-indigo-500/80 uppercase">Deployable</span>}
      </div>
      {data.domains.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pt-1.5">
          {data.domains.map((d) => (
            <span key={d} className="rounded-md bg-white/70 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
              {domainLabel(d)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
export const ContainerNodeView = memo(ContainerNodeViewImpl)

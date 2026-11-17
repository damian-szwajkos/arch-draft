import type { NodeProps } from '@xyflow/react'
import { memo } from 'react'
import { cn } from '../../lib/cn'
import type { ArchNode } from '../../store/workspace'

function NoteNodeViewImpl({ data, selected }: NodeProps<ArchNode>) {
  return (
    <div
      className={cn(
        'w-[190px] rotate-[-0.6deg] rounded-md bg-amber-100 px-3 py-2.5 text-[12px] leading-snug whitespace-pre-wrap text-amber-950 shadow-[0_6px_14px_-6px_rgba(120,80,0,0.35)] dark:bg-amber-200',
        selected && 'ring-2 ring-brand-500',
      )}
    >
      {data.label}
      {data.notes && <div className="mt-1.5 border-t border-amber-300/70 pt-1.5 text-[11px] text-amber-900/80">{data.notes}</div>}
    </div>
  )
}
export const NoteNodeView = memo(NoteNodeViewImpl)

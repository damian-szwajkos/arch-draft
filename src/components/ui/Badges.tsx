import type { Difficulty } from '../../engine/types'
import { cn } from '../../lib/cn'

const DIFF: Record<Difficulty, string> = {
  beginner: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-500/10 dark:text-emerald-300',
  intermediate: 'bg-amber-50 text-amber-700 ring-amber-600/15 dark:bg-amber-500/10 dark:text-amber-300',
  advanced: 'bg-rose-50 text-rose-700 ring-rose-600/15 dark:bg-rose-500/10 dark:text-rose-300',
}

export function DifficultyBadge({ value, className }: { value: Difficulty; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold capitalize ring-1 ring-inset', DIFF[value], className)}>
      {value}
    </span>
  )
}

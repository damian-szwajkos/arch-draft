import { Activity, ArrowRight, Clock, GraduationCap, Landmark, Link2, MessageCircle, ShoppingBag, Ticket, Truck, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Scenario } from '../engine/types'
import type { ProgressRecord } from '../lib/storage'
import { DifficultyBadge, Stars } from './ui/Badges'

export const INDUSTRY_ICON: Record<string, LucideIcon> = {
  'E-commerce': ShoppingBag,
  'Banking & Fintech': Landmark,
  'Social media': MessageCircle,
  'Logistics & marketplaces': Truck,
  Ticketing: Ticket,
  'SaaS operations': Activity,
  'Web platform': Link2,
  EdTech: GraduationCap,
}

export function ScenarioCard({ s, progress }: { s: Scenario; progress?: ProgressRecord }) {
  const Icon = INDUSTRY_ICON[s.industry] ?? Activity
  const status = progress?.passed ? 'done' : progress && progress.attempts > 0 ? 'attempted' : progress ? 'started' : 'new'
  return (
    <Link
      to={`/play/${s.id}`}
      className="group flex flex-col rounded-2xl border border-zinc-200/80 bg-white p-5 transition-all hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-[0_12px_32px_-16px_rgba(16,24,40,0.25)] dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/20"
    >
      <div className="flex items-start justify-between">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: `${s.accent}1a`, color: s.accent }}>
          <Icon className="h-5 w-5" />
        </span>
        {status === 'done' ? (
          <Stars value={progress!.stars} />
        ) : status === 'attempted' ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">Best {progress!.bestScore}</span>
        ) : status === 'started' ? (
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-white/10 dark:text-zinc-300">In progress</span>
        ) : null}
      </div>
      <p className="mt-4 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">{s.industry}</p>
      <h3 className="mt-1 text-[15px] leading-snug font-semibold text-zinc-900 dark:text-white">{s.title}</h3>
      <p className="mt-1.5 line-clamp-2 text-sm text-zinc-500 dark:text-zinc-400">{s.tagline}</p>
      <div className="mt-auto flex items-center gap-3 pt-5 text-xs text-zinc-500 dark:text-zinc-400">
        <DifficultyBadge value={s.difficulty} />
        <span className="flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" /> {s.estMinutes} min
        </span>
        <span>{s.concepts.length} concepts</span>
        <ArrowRight className="ml-auto h-4 w-4 text-zinc-300 transition-transform group-hover:translate-x-0.5 group-hover:text-zinc-600 dark:text-zinc-600 dark:group-hover:text-zinc-300" />
      </div>
    </Link>
  )
}

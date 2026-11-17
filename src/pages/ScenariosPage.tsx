import { PenTool, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ScenarioCard } from '../components/ScenarioCard'
import { SiteFooter, SiteHeader } from '../components/SiteHeader'
import { CONCEPT_BY_ID } from '../data/concepts'
import { INDUSTRIES, SCENARIOS } from '../data/scenarios'
import type { Difficulty } from '../engine/types'
import { cn } from '../lib/cn'
import { useProgress } from '../lib/progress'

const LEVELS: (Difficulty | 'all')[] = ['all', 'beginner', 'intermediate', 'advanced']

export function ScenariosPage() {
  const progress = useProgress()
  const [q, setQ] = useState('')
  const [level, setLevel] = useState<Difficulty | 'all'>('all')
  const [industry, setIndustry] = useState('all')
  const done = SCENARIOS.filter((s) => progress[s.id]?.passed).length
  const stars = SCENARIOS.reduce((a, s) => a + (progress[s.id]?.stars ?? 0), 0)

  const list = useMemo(() => {
    const term = q.trim().toLowerCase()
    return SCENARIOS.filter((s) => {
      if (level !== 'all' && s.difficulty !== level) return false
      if (industry !== 'all' && s.industry !== industry) return false
      if (!term) return true
      const hay = [s.title, s.tagline, s.industry, ...s.concepts.map((c) => CONCEPT_BY_ID[c]?.title ?? c)].join(' ').toLowerCase()
      return hay.includes(term)
    })
  }, [q, level, industry])

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-end">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Scenarios</h1>
            <p className="mt-2 max-w-xl text-zinc-500 dark:text-zinc-400">
              Real-world briefs with users, constraints and quality attributes. Draw an architecture, choose your stack, and get an instant review.
            </p>
          </div>
          <div className="flex gap-3 md:ml-auto">
            <div className="rounded-xl border border-zinc-200/80 px-4 py-2.5 dark:border-white/10">
              <div className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Completed</div>
              <div className="text-lg font-semibold tabular-nums">
                {done}<span className="text-zinc-400">/{SCENARIOS.length}</span>
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200/80 px-4 py-2.5 dark:border-white/10">
              <div className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Stars</div>
              <div className="text-lg font-semibold tabular-nums">
                {stars}<span className="text-zinc-400">/{SCENARIOS.length * 3}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-3 lg:flex-row lg:items-center">
          <label className="relative block lg:w-80">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input className="input pl-9" placeholder="Search scenarios or concepts" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search scenarios" />
          </label>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Difficulty">
            {LEVELS.map((l) => (
              <button
                key={l}
                onClick={() => setLevel(l)}
                aria-pressed={level === l}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-[13px] font-medium capitalize transition-colors',
                  level === l ? 'border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900' : 'border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-white/10 dark:text-zinc-300',
                )}
              >
                {l === 'all' ? 'All levels' : l}
              </button>
            ))}
          </div>
          <select className="input lg:ml-auto lg:w-56" value={industry} onChange={(e) => setIndustry(e.target.value)} aria-label="Industry">
            <option value="all">All industries</option>
            {INDUSTRIES.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((s) => (
            <ScenarioCard key={s.id} s={s} progress={progress[s.id]} />
          ))}
          <Link
            to="/sandbox"
            className="group flex flex-col justify-between rounded-2xl border border-dashed border-zinc-300 p-5 transition-colors hover:border-brand-400 hover:bg-brand-50/40 dark:border-white/15 dark:hover:bg-brand-500/5"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
              <PenTool className="h-5 w-5" />
            </span>
            <div className="mt-4">
              <h3 className="text-[15px] font-semibold">Sandbox</h3>
              <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">No brief, no score. Sketch your own system and run the architecture lint for anti-patterns.</p>
            </div>
            <span className="mt-5 text-sm font-medium text-brand-600 dark:text-brand-400">Open blank canvas →</span>
          </Link>
        </div>
        {!list.length && <p className="mt-10 text-center text-zinc-500">No scenarios match these filters.</p>}
      </main>
      <SiteFooter />
    </div>
  )
}

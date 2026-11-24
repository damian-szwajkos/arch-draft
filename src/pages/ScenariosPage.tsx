import { PenTool, Search, SearchX } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ScenarioCard } from '../components/ScenarioCard'
import { SiteFooter, SiteHeader } from '../components/SiteHeader'
import { CONCEPT_BY_ID } from '../data/concepts'
import { INDUSTRIES, SCENARIOS } from '../data/scenarios'
import type { Difficulty, Scenario } from '../engine/types'
import { cn } from '../lib/cn'
import { useProgress } from '../lib/progress'

const DIFFICULTIES: Difficulty[] = ['beginner', 'intermediate', 'advanced']
const LEVELS: (Difficulty | 'all')[] = ['all', ...DIFFICULTIES]
const LEVEL_LABEL: Record<Difficulty, string> = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' }

const haystack = (s: Scenario) => [s.title, s.tagline, s.industry, ...s.concepts.map((c) => CONCEPT_BY_ID[c]?.title ?? c)].join(' ').toLowerCase()

export function ScenariosPage() {
  const progress = useProgress()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  // The search box keeps local state so typing stays smooth while the URL catches up.
  const [qInput, setQInput] = useState(q)
  const pushedQ = useRef(q)
  useEffect(() => {
    if (q !== pushedQ.current) {
      pushedQ.current = q
      setQInput(q)
    }
  }, [q])
  const levelParam = params.get('level')
  const level: Difficulty | 'all' = LEVELS.includes(levelParam as Difficulty) ? (levelParam as Difficulty) : 'all'
  const industryParam = params.get('industry')
  const industry = industryParam && INDUSTRIES.includes(industryParam) ? industryParam : 'all'
  const done = SCENARIOS.filter((s) => progress[s.id]?.passed).length
  const filtering = !!q.trim() || level !== 'all' || industry !== 'all'

  /** Update one filter in the URL; default values are removed to keep links clean. */
  const setFilter = (key: 'q' | 'level' | 'industry', value: string) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (!value || value === 'all') next.delete(key)
        else next.set(key, value)
        return next
      },
      { replace: true },
    )
  }
  const clearFilters = () => setParams({}, { replace: true })

  // Scenarios matching search + industry, before the level filter (drives the per-level counts).
  const base = useMemo(() => {
    const term = q.trim().toLowerCase()
    return SCENARIOS.filter((s) => (industry === 'all' || s.industry === industry) && (!term || haystack(s).includes(term)))
  }, [q, industry])
  const counts = useMemo(() => {
    const c: Record<Difficulty | 'all', number> = { all: base.length, beginner: 0, intermediate: 0, advanced: 0 }
    for (const s of base) c[s.difficulty]++
    return c
  }, [base])
  const list = level === 'all' ? base : base.filter((s) => s.difficulty === level)
  const groups = DIFFICULTIES.map((d) => ({ level: d, items: list.filter((s) => s.difficulty === d) })).filter((g) => g.items.length)

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
              <div className="text-[11px] font-semibold tracking-wide text-zinc-600 uppercase dark:text-zinc-400">Completed</div>
              <div className="text-lg font-semibold tabular-nums">
                {done}
                <span className="text-zinc-500 dark:text-zinc-400">/{SCENARIOS.length}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-3 lg:flex-row lg:items-center">
          <label className="relative block lg:w-80">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="search"
              className="input pl-9"
              placeholder="Search scenarios or concepts"
              value={qInput}
              onChange={(e) => {
                setQInput(e.target.value)
                pushedQ.current = e.target.value
                setFilter('q', e.target.value)
              }}
              aria-label="Search scenarios"
            />
          </label>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Difficulty">
            {LEVELS.map((l) => (
              <button
                key={l}
                onClick={() => setFilter('level', l)}
                aria-pressed={level === l}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors',
                  level === l
                    ? 'border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900'
                    : 'border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-white/10 dark:text-zinc-300',
                )}
              >
                {l === 'all' ? 'All levels' : LEVEL_LABEL[l]}
                <span className={cn('tabular-nums text-[12px]', level === l ? 'opacity-75' : 'text-zinc-500 dark:text-zinc-400')}>{counts[l]}</span>
              </button>
            ))}
          </div>
          <select className="input lg:ml-auto lg:w-56" value={industry} onChange={(e) => setFilter('industry', e.target.value)} aria-label="Industry">
            <option value="all">All industries</option>
            {INDUSTRIES.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </div>

        <div className="mt-4 flex min-h-7 items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
          <span>{filtering ? `${list.length} of ${SCENARIOS.length} scenarios` : `${SCENARIOS.length} scenarios`}</span>
          {filtering && list.length > 0 && (
            <button className="font-medium text-brand-600 hover:underline dark:text-brand-400" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>

        {list.length ? (
          <div className="mt-4 space-y-10">
            {groups.map((g) => (
              <section key={g.level} aria-labelledby={`level-${g.level}`}>
                <h2 id={`level-${g.level}`} className="mb-3 flex items-baseline gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
                  {LEVEL_LABEL[g.level]}
                  <span className="text-xs font-medium text-zinc-500 tabular-nums dark:text-zinc-400">{g.items.length}</span>
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {g.items.map((s) => (
                    <ScenarioCard key={s.id} s={s} progress={progress[s.id]} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="mt-4 flex flex-col items-center rounded-2xl border border-zinc-200/80 px-6 py-14 text-center dark:border-white/10">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
              <SearchX className="h-5 w-5" />
            </span>
            <p className="mt-4 font-semibold text-zinc-900 dark:text-white">No scenarios match these filters</p>
            <p className="mt-1 max-w-sm text-sm text-zinc-600 dark:text-zinc-400">Try a different search term, level or industry.</p>
            <button className="btn-secondary mt-5" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        )}

        <Link
          to="/sandbox"
          className="group mt-10 flex flex-col gap-4 rounded-2xl border border-dashed border-zinc-300 p-5 transition-colors hover:border-brand-400 hover:bg-brand-50/40 sm:flex-row sm:items-center dark:border-white/15 dark:hover:bg-brand-500/5"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
            <PenTool className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold">Sandbox</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">No brief, no score. Sketch your own system and run the architecture lint for anti-patterns.</p>
          </div>
          <span className="text-sm font-medium text-brand-600 dark:text-brand-400">Open blank canvas →</span>
        </Link>
      </main>
      <SiteFooter />
    </div>
  )
}

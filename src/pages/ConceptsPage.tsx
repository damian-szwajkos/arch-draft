import { ArrowLeft, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ConceptBody } from '../components/workspace/ConceptDialog'
import { SiteFooter, SiteHeader } from '../components/SiteHeader'
import { CONCEPT_BY_ID, CONCEPT_GROUPS, CONCEPTS } from '../data/concepts'
import { NotFound } from './NotFound'

export function ConceptsPage() {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? CONCEPTS.filter((c) => [c.title, c.summary, c.group].join(' ').toLowerCase().includes(t)) : CONCEPTS
  }, [q])
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight">Concept library</h1>
        <p className="mt-2 max-w-2xl text-zinc-500 dark:text-zinc-400">
          Short, practical explanations of the patterns you’ll meet in scenarios — when to use them, and how they go wrong.
        </p>
        <label className="relative mt-6 block max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input className="input pl-9" placeholder="Search concepts" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search concepts" />
        </label>
        {CONCEPT_GROUPS.map((g) => {
          const items = filtered.filter((c) => c.group === g)
          if (!items.length) return null
          return (
            <section key={g} className="mt-10">
              <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">{g}</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((c) => (
                  <Link
                    key={c.id}
                    to={`/concepts/${c.id}`}
                    className="rounded-2xl border border-zinc-200/80 p-4 transition-colors hover:border-zinc-300 hover:bg-zinc-50/60 dark:border-white/10 dark:hover:border-white/20 dark:hover:bg-white/[0.03]"
                  >
                    <h3 className="font-semibold text-zinc-900 dark:text-white">{c.title}</h3>
                    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{c.summary}</p>
                  </Link>
                ))}
              </div>
            </section>
          )
        })}
      </main>
      <SiteFooter />
    </div>
  )
}

export function ConceptDetailPage() {
  const { id = '' } = useParams()
  const c = CONCEPT_BY_ID[id]
  if (!c) return <NotFound />
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
        <Link to="/concepts" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
          <ArrowLeft className="h-4 w-4" /> All concepts
        </Link>
        <p className="mt-6 text-xs font-semibold tracking-wide text-brand-600 uppercase dark:text-brand-400">{c.group}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{c.title}</h1>
        <div className="mt-6">
          <ConceptBody concept={c} />
        </div>
        {c.related.length > 0 && (
          <div className="mt-8">
            <h2 className="label">Related</h2>
            <div className="flex flex-wrap gap-2">
              {c.related.map((r) => (
                <Link key={r} to={`/concepts/${r}`} className="chip hover:border-brand-300">
                  {CONCEPT_BY_ID[r]?.title}
                </Link>
              ))}
            </div>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  )
}

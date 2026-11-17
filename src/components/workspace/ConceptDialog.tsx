import { ArrowUpRight, BookOpen } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CONCEPT_BY_ID, type Concept } from '../../data/concepts'
import { SCENARIOS } from '../../data/scenarios'
import { Modal } from '../ui/Modal'

export function ConceptBody({ concept }: { concept: Concept }) {
  const practice = SCENARIOS.filter((s) => s.concepts.includes(concept.id))
  return (
    <div className="space-y-5">
      <p className="text-[15px] leading-relaxed font-medium text-zinc-800 dark:text-zinc-200">{concept.summary}</p>
      {concept.body.map((p) => (
        <p key={p.slice(0, 24)} className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          {p}
        </p>
      ))}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/50 p-3.5 dark:border-emerald-500/20 dark:bg-emerald-500/5">
          <h4 className="text-xs font-semibold tracking-wide text-emerald-700 uppercase dark:text-emerald-300">Use when</h4>
          <ul className="mt-2 space-y-1.5 text-[13px] text-zinc-700 dark:text-zinc-300">
            {concept.useWhen.map((u) => (
              <li key={u}>• {u}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-rose-200/70 bg-rose-50/50 p-3.5 dark:border-rose-500/20 dark:bg-rose-500/5">
          <h4 className="text-xs font-semibold tracking-wide text-rose-700 uppercase dark:text-rose-300">Pitfalls</h4>
          <ul className="mt-2 space-y-1.5 text-[13px] text-zinc-700 dark:text-zinc-300">
            {concept.pitfalls.map((u) => (
              <li key={u}>• {u}</li>
            ))}
          </ul>
        </div>
      </div>
      {practice.length > 0 && (
        <div>
          <h4 className="label">Practice it</h4>
          <div className="flex flex-wrap gap-2">
            {practice.map((s) => (
              <Link key={s.id} to={`/play/${s.id}`} className="chip hover:border-brand-300 hover:text-brand-700">
                {s.title.split(':')[0]} <ArrowUpRight className="h-3 w-3" />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function ConceptChip({ id }: { id: string }) {
  const [open, setOpen] = useState(false)
  const c = CONCEPT_BY_ID[id]
  if (!c) return null
  return (
    <>
      <button className="chip hover:border-brand-300 hover:text-brand-700 dark:hover:text-brand-300" onClick={() => setOpen(true)}>
        <BookOpen className="h-3 w-3" />
        {c.title}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={c.title} subtitle={c.group} size="lg">
        <div className="p-5">
          <ConceptBody concept={c} />
        </div>
      </Modal>
    </>
  )
}

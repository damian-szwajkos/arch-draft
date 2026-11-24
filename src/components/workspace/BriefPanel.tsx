import { CheckCircle2, Circle, Clock, ExternalLink, Lightbulb } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Scenario } from '../../engine/types'
import { cn } from '../../lib/cn'
import { useWorkspace } from '../../store/workspace'
import { DifficultyBadge } from '../ui/Badges'
import { ConceptChip } from './ConceptDialog'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="label">{title}</h3>
      {children}
    </section>
  )
}

function Bullets({ items, tone = 'zinc' }: { items: string[]; tone?: 'zinc' | 'amber' }) {
  return (
    <ul className="space-y-1.5">
      {items.map((i) => (
        <li key={i} className="flex gap-2 text-[13px] leading-snug text-zinc-700 dark:text-zinc-300">
          <span className={cn('mt-[7px] h-1 w-1 shrink-0 rounded-full', tone === 'amber' ? 'bg-amber-500' : 'bg-zinc-400')} />
          {i}
        </li>
      ))}
    </ul>
  )
}

export function BriefPanel({ scenario, hintsRevealed, onRevealHint }: { scenario: Scenario; hintsRevealed: number; onRevealHint: () => void }) {
  const nodes = useWorkspace((s) => s.nodes)
  const owned = useMemo(() => new Set(nodes.flatMap((n) => n.data.domains)), [nodes])
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="scrollbar-thin h-full overflow-y-auto px-4 pt-3 pb-8">
      <div className="flex flex-wrap items-center gap-2">
        <DifficultyBadge value={scenario.difficulty} />
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{scenario.industry}</span>
        <span className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          <Clock className="h-3 w-3" /> ~{scenario.estMinutes} min
        </span>
      </div>
      <h2 className="mt-2 text-lg leading-snug font-semibold text-zinc-900 dark:text-white">{scenario.title}</h2>
      <p className={cn('mt-2 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-400', !expanded && 'line-clamp-5')}>{scenario.story}</p>
      <button className="mt-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400" onClick={() => setExpanded((v) => !v)}>
        {expanded ? 'Show less' : 'Read full story'}
      </button>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {scenario.facts.map((f) => (
          <div key={f.label} className="rounded-xl border border-zinc-200/80 bg-zinc-50/60 p-2.5 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">{f.label}</div>
            <div className="mt-0.5 text-[12px] leading-snug font-medium text-zinc-800 dark:text-zinc-200">{f.value}</div>
          </div>
        ))}
      </div>

      <Section title="Business capabilities to own">
        <ul className="space-y-1">
          {scenario.domains.map((d) => {
            const ok = owned.has(d.id)
            return (
              <li key={d.id} className="flex items-start gap-2 text-[13px]">
                {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-300 dark:text-zinc-600" />}
                <span>
                  <span className={cn('font-medium', ok ? 'text-zinc-900 dark:text-white' : 'text-zinc-700 dark:text-zinc-300')}>{d.label}</span>
                  <span className="text-zinc-500 dark:text-zinc-400"> — {d.description}</span>
                </span>
              </li>
            )
          })}
        </ul>
        <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">Assign capabilities to services or modules in the inspector.</p>
      </Section>

      <Section title="Functional requirements">
        <Bullets items={scenario.functional} />
      </Section>
      <Section title="Quality attributes">
        <Bullets items={scenario.nonFunctional} />
      </Section>
      <Section title="Constraints">
        <Bullets items={scenario.constraints} tone="amber" />
      </Section>
      {scenario.inspiration && scenario.inspiration.length > 0 && (
        <Section title="Inspired by real systems">
          <ul className="space-y-1.5">
            {scenario.inspiration.map((i) => (
              <li key={i.url}>
                <a
                  href={i.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-start gap-2 rounded-lg text-[13px] leading-snug text-zinc-600 hover:text-brand-700 dark:text-zinc-400 dark:hover:text-brand-300"
                >
                  <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400 group-hover:text-brand-500" />
                  <span>{i.label}</span>
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-snug text-zinc-500">The company in the story is fictional; the problem is modelled on these public engineering write-ups.</p>
        </Section>
      )}
      <Section title="Concepts in play">
        <div className="flex flex-wrap gap-1.5">
          {scenario.concepts.map((c) => (
            <ConceptChip key={c} id={c} />
          ))}
        </div>
      </Section>

      <Section title={`Hints (${hintsRevealed}/${scenario.hints.length})`}>
        <ol className="space-y-2">
          {scenario.hints.slice(0, hintsRevealed).map((h, i) => (
            <li key={h} className="flex gap-2 rounded-xl bg-amber-50 p-2.5 text-[13px] leading-snug text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              <span className="font-mono text-[11px] font-semibold opacity-70">{i + 1}</span>
              {h}
            </li>
          ))}
        </ol>
        {hintsRevealed < scenario.hints.length && (
          <button className="btn-secondary mt-2 w-full" onClick={onRevealHint}>
            <Lightbulb className="h-4 w-4 text-amber-500" />
            Reveal {hintsRevealed ? 'next' : 'a'} hint
          </button>
        )}
      </Section>
    </div>
  )
}

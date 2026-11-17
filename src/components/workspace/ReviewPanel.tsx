import { AlertTriangle, CheckCircle2, ChevronDown, Eye, Info, Play, RefreshCw, Sparkles, XCircle } from 'lucide-react'
import { useState } from 'react'
import type { CheckResult, Evaluation } from '../../engine/types'
import { cn } from '../../lib/cn'
import { useWorkspace } from '../../store/workspace'
import { Stars } from '../ui/Badges'
import { ConceptChip } from './ConceptDialog'

function ScoreRing({ score, passed }: { score: number; passed: boolean }) {
  const r = 34
  const c = 2 * Math.PI * r
  const color = passed ? '#10b981' : score >= 50 ? '#f59e0b' : '#f43f5e'
  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg viewBox="0 0 80 80" className="h-24 w-24 -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" strokeWidth="7" className="stroke-zinc-100 dark:stroke-white/10" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          stroke={color}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - score / 100)}
          style={{ transition: 'stroke-dashoffset 700ms ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold text-zinc-900 tabular-nums dark:text-white">{score}</span>
        <span className="-mt-0.5 text-[10px] font-medium tracking-wide text-zinc-500 uppercase">score</span>
      </div>
    </div>
  )
}

function Bar({ label, value, total, tone }: { label: string; value: number; total: number; tone: string }) {
  return (
    <div className="grid grid-cols-[92px_1fr_36px] items-center gap-2 text-[12px]">
      <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-white/10">
        <span className="block h-full rounded-full transition-all duration-700" style={{ width: `${total ? (value / total) * 100 : 0}%`, background: tone }} />
      </span>
      <span className="text-right font-mono text-[11px] text-zinc-500 tabular-nums">
        {value}/{total}
      </span>
    </div>
  )
}

function ResultRow({ r }: { r: CheckResult }) {
  const [open, setOpen] = useState(false)
  const anti = r.category === 'antipattern'
  const Icon = r.pass ? CheckCircle2 : anti ? AlertTriangle : XCircle
  const color = r.pass ? 'text-emerald-500' : anti ? 'text-rose-500' : r.category === 'bonus' ? 'text-zinc-400' : 'text-amber-500'
  return (
    <li className="rounded-xl border border-zinc-200/80 dark:border-white/10">
      <button className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', color)} />
        <span className="min-w-0 flex-1">
          <span className={cn('block text-[13px] leading-snug font-medium', r.pass ? 'text-zinc-700 dark:text-zinc-300' : 'text-zinc-900 dark:text-white')}>
            {anti ? (r.pass ? `No issue: ${r.title.toLowerCase()}` : r.title) : r.title}
          </span>
          {r.detail && !r.pass && <span className="mt-0.5 block text-[12px] leading-snug text-zinc-500 dark:text-zinc-400">{r.detail}</span>}
        </span>
        <ChevronDown className={cn('mt-0.5 h-4 w-4 shrink-0 text-zinc-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-2.5 border-t border-zinc-100 px-3 py-3 text-[12px] leading-relaxed dark:border-white/10">
          <p className="text-zinc-600 dark:text-zinc-400">
            <b className="font-semibold text-zinc-800 dark:text-zinc-200">Why it matters. </b>
            {r.why}
          </p>
          {!r.pass && (
            <p className="rounded-lg bg-amber-50 p-2 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              <b className="font-semibold">Try: </b>
              {r.hint}
            </p>
          )}
          {r.concepts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {r.concepts.map((c) => (
                <ConceptChip key={c} id={c} />
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function Group({ title, items }: { title: string; items: CheckResult[] }) {
  if (!items.length) return null
  return (
    <section className="mt-5">
      <h3 className="label">{title}</h3>
      <ul className="space-y-1.5">
        {items.map((r) => (
          <ResultRow key={r.id} r={r} />
        ))}
      </ul>
    </section>
  )
}

export function ReviewPanel({
  evaluation,
  onCheck,
  onReference,
  sandbox,
}: {
  evaluation?: Evaluation
  onCheck: () => void
  onReference?: () => void
  sandbox?: boolean
}) {
  const dirty = useWorkspace((s) => s.dirtySinceEval)
  if (!evaluation)
    return (
      <div className="p-4">
        <div className="rounded-2xl border border-dashed border-zinc-200 p-5 text-center dark:border-white/10">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
            <Sparkles className="h-5 w-5" />
          </div>
          <p className="text-sm font-semibold text-zinc-900 dark:text-white">{sandbox ? 'Architecture lint' : 'Ready for review?'}</p>
          <p className="mt-1 text-[13px] text-zinc-500 dark:text-zinc-400">
            {sandbox
              ? 'Scan your diagram for common anti-patterns: shared databases, long sync chains, clients hitting databases…'
              : 'Your design is checked against the requirements, quality attributes and common anti-patterns.'}
          </p>
          <button className="btn-primary mt-4 w-full" onClick={onCheck}>
            <Play className="h-4 w-4" /> Check my design
          </button>
        </div>
      </div>
    )

  const core = evaluation.results.filter((r) => r.category === 'core')
  const bonus = evaluation.results.filter((r) => r.category === 'bonus')
  const anti = evaluation.results.filter((r) => r.category === 'antipattern')
  const antiFound = anti.filter((r) => !r.pass).length
  const coreMissing = core.filter((r) => !r.pass).length
  const verdict = sandbox
    ? antiFound
      ? `${antiFound} anti-pattern${antiFound > 1 ? 's' : ''} found`
      : 'No anti-patterns found'
    : evaluation.passed
      ? evaluation.stars === 3
        ? 'Outstanding design!'
        : 'Design approved'
      : coreMissing
        ? `${coreMissing} key requirement${coreMissing > 1 ? 's' : ''} missing`
        : 'Almost there'

  return (
    <div className="scrollbar-thin h-full overflow-y-auto p-4 pb-10">
      {dirty && (
        <button
          onClick={onCheck}
          className="mb-3 flex w-full items-center gap-2 rounded-xl bg-brand-50 px-3 py-2 text-left text-[12px] font-medium text-brand-700 hover:bg-brand-100 dark:bg-brand-500/10 dark:text-brand-200"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Diagram changed since this review — re-check
        </button>
      )}
      {!sandbox && (
        <div className="flex items-center gap-4">
          <ScoreRing score={evaluation.score} passed={evaluation.passed} />
          <div className="min-w-0">
            <Stars value={evaluation.stars} size="lg" />
            <p className="mt-1.5 text-[15px] font-semibold text-zinc-900 dark:text-white">{verdict}</p>
            <p className="text-[12px] text-zinc-500 dark:text-zinc-400">{evaluation.passed ? 'Passed — 70+ and all key requirements met.' : 'Pass = 70+ and all key requirements met.'}</p>
          </div>
        </div>
      )}
      {sandbox && <p className="text-[15px] font-semibold text-zinc-900 dark:text-white">{verdict}</p>}
      {!sandbox && (
        <div className="mt-4 space-y-2 rounded-xl bg-zinc-50 p-3 dark:bg-white/[0.04]">
          <Bar label="Requirements" value={core.filter((r) => r.pass).length} total={core.length} tone="#6366f1" />
          <Bar label="Bonus" value={bonus.filter((r) => r.pass).length} total={bonus.length} tone="#14b8a6" />
          <Bar label="Anti-patterns" value={anti.length - antiFound} total={anti.length} tone={antiFound ? '#f43f5e' : '#10b981'} />
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <button className="btn-secondary flex-1" onClick={onCheck}>
          <RefreshCw className="h-4 w-4" /> Re-check
        </button>
        {onReference && (
          <button className="btn-secondary flex-1" onClick={onReference}>
            <Eye className="h-4 w-4" /> Reference
          </button>
        )}
      </div>

      <Group title="Key requirements" items={core} />
      <Group title="Anti-patterns" items={anti} />
      <Group title="Bonus points" items={bonus} />

      {evaluation.lint.length > 0 && (
        <section className="mt-5">
          <h3 className="label">Review notes</h3>
          <ul className="space-y-1.5">
            {evaluation.lint.map((l) => (
              <li key={l.id} className="flex items-start gap-2.5 rounded-xl bg-zinc-50 px-3 py-2.5 text-[12px] leading-snug text-zinc-600 dark:bg-white/[0.04] dark:text-zinc-400">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-500" />
                <span className="flex-1">{l.message}</span>
                <button
                  className="shrink-0 font-medium text-brand-600 hover:underline dark:text-brand-400"
                  onClick={() => {
                    useWorkspace.getState().flag(l.nodeIds)
                    setTimeout(() => useWorkspace.getState().flag([]), 2500)
                  }}
                >
                  Show
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

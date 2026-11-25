import { Check, Wand2 } from 'lucide-react'
import { useState } from 'react'
import { STYLE_NAMES } from '../../engine/evaluate'
import type { ArchStyle, CommunicationStyle, DataStrategy } from '../../engine/types'
import { STACK_SLOTS, stackOptions } from '../../data/tech'
import { cn } from '../../lib/cn'
import { useWorkspace } from '../../store/workspace'

const STYLE_INFO: Record<ArchStyle, string> = {
  monolith: 'One deployable split into technical layers — simplest to run.',
  'modular-monolith': 'One deployable with strictly separated modules.',
  microservices: 'Independently deployable services, each owning its data.',
  'event-driven': 'Services collaborate mainly through events on a broker.',
  serverless: 'Event-triggered functions and managed services.',
  'service-based': 'A handful of coarse domain services, often sharing one database.',
  'space-based': 'Processing units with an in-memory data grid for extreme, spiky load.',
  microkernel: 'A core system extended by isolated plug-ins (rules, adapters).',
}

function Segmented<T extends string>({ value, options, onChange }: { value?: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="grid rounded-xl bg-zinc-100 p-1 dark:bg-white/5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={cn(
            'rounded-lg px-2 py-1.5 text-[12px] font-medium transition-colors',
            value === o.id ? 'bg-white text-zinc-900 shadow-sm dark:bg-white/15 dark:text-white' : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function DecisionsPanel() {
  const decisions = useWorkspace((s) => s.decisions)
  const setDecisions = useWorkspace((s) => s.setDecisions)
  const [applied, setApplied] = useState<number | null>(null)

  return (
    <div className="scrollbar-thin h-full overflow-y-auto p-4 pb-10">
      <p className="text-[12px] leading-snug text-zinc-500 dark:text-zinc-400">
        Record your key architecture decisions — like a lightweight ADR. They are evaluated together with your diagram.
      </p>

      <div className="mt-4">
        <span className="label">Architecture style</span>
        <div className="space-y-1.5">
          {(Object.keys(STYLE_NAMES) as ArchStyle[]).map((s) => {
            const on = decisions.style === s
            return (
              <button
                key={s}
                onClick={() => setDecisions({ style: s })}
                aria-pressed={on}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                  on ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-500/10' : 'border-zinc-200 hover:border-zinc-300 dark:border-white/10 dark:hover:border-white/20',
                )}
              >
                <span
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                    on ? 'border-brand-600 bg-brand-600 text-white' : 'border-zinc-300 dark:border-white/20',
                  )}
                >
                  {on && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span>
                  <span className="block text-[13px] font-medium text-zinc-900 dark:text-zinc-100">{STYLE_NAMES[s]}</span>
                  <span className="block text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{STYLE_INFO[s]}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-5">
        <span className="label">Default communication</span>
        <Segmented<CommunicationStyle>
          value={decisions.communication}
          onChange={(v) => setDecisions({ communication: v })}
          options={[
            { id: 'sync', label: 'Sync' },
            { id: 'hybrid', label: 'Hybrid' },
            { id: 'async', label: 'Async' },
          ]}
        />
      </div>

      <div className="mt-5">
        <span className="label">Data strategy</span>
        <Segmented<DataStrategy>
          value={decisions.data}
          onChange={(v) => setDecisions({ data: v })}
          options={[
            { id: 'shared', label: 'Shared DB' },
            { id: 'per-service', label: 'DB per service' },
            { id: 'cqrs', label: 'CQRS' },
          ]}
        />
      </div>

      <div className="mt-6">
        <span className="label">Technology stack</span>
        <p className="-mt-0.5 mb-3 text-[11px] text-zinc-500 dark:text-zinc-400">New components get these technologies automatically.</p>
        <div className="space-y-2.5">
          {STACK_SLOTS.map((slot) => (
            <div key={slot.key} className="grid grid-cols-[110px_1fr] items-center gap-2">
              <label htmlFor={`stack-${slot.key}`} className="text-[12px] font-medium text-zinc-700 dark:text-zinc-300">
                {slot.label}
              </label>
              <select
                id={`stack-${slot.key}`}
                className="input py-1.5"
                value={decisions.stack[slot.key] ?? ''}
                onChange={(e) => {
                  setApplied(null)
                  setDecisions({ stack: { ...decisions.stack, [slot.key]: e.target.value || undefined } })
                }}
              >
                <option value="">— {slot.hint}</option>
                {stackOptions(slot.key).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <button className="btn-secondary mt-3 w-full" onClick={() => setApplied(useWorkspace.getState().applyStack())}>
          <Wand2 className="h-4 w-4" /> Apply stack to diagram
        </button>
        {applied !== null && (
          <p className="mt-1.5 text-center text-[11px] text-zinc-500">{applied ? `Updated ${applied} component${applied > 1 ? 's' : ''}.` : 'Everything already matches.'}</p>
        )}
      </div>

      <div className="mt-6">
        <label className="label" htmlFor="rationale">Rationale (ADR)</label>
        <textarea
          id="rationale"
          className="input min-h-28 resize-y"
          placeholder="Context → decision → consequences. Why this style? What trade-offs do you accept?"
          value={decisions.rationale ?? ''}
          onChange={(e) => setDecisions({ rationale: e.target.value })}
        />
      </div>
    </div>
  )
}

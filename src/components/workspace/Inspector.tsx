import { ArrowLeftRight, ArrowRight, Copy, MousePointer2, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { CATEGORIES, CATEGORY_STYLE, COMPONENT_BY_KIND, PROTOCOLS } from '../../data/components'
import { TECH_BY_ID, techFor } from '../../data/tech'
import { cn } from '../../lib/cn'
import { KIND_ICON } from '../../lib/icons'
import { useWorkspace, type ArchEdge, type ArchNode } from '../../store/workspace'
import { PROTOCOL_STYLE } from '../canvas/ArchEdgeView'
import { useWorkspaceContext } from './ScenarioContext'

export function Inspector() {
  const selectedNodes = useWorkspace(useShallow((s) => s.nodes.filter((n) => n.selected)))
  const selectedEdges = useWorkspace(useShallow((s) => s.edges.filter((e) => e.selected)))
  const total = selectedNodes.length + selectedEdges.length

  if (total === 0) return <EmptyInspector />
  if (total > 1)
    return (
      <div className="p-4">
        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{total} elements selected</p>
        <button
          className="btn-secondary mt-3 w-full text-rose-600"
          onClick={() => useWorkspace.getState().removeElements([...selectedNodes.map((n) => n.id), ...selectedEdges.map((e) => e.id)])}
        >
          <Trash2 className="h-4 w-4" /> Delete selection
        </button>
      </div>
    )
  return selectedNodes[0] ? <NodeInspector node={selectedNodes[0]} key={selectedNodes[0].id} /> : <EdgeInspector edge={selectedEdges[0]} key={selectedEdges[0].id} />
}

function EmptyInspector() {
  const tips = [
    ['Add', 'Drag a component from the left panel, or click it.'],
    ['Connect', 'Hover a component and drag from a dot to another component.'],
    ['Group', 'Drop Modules inside an Application to build a modular monolith.'],
    ['Inspect', 'Select a component to pick its technology and capabilities.'],
  ]
  return (
    <div className="p-4">
      <div className="rounded-xl border border-dashed border-zinc-200 p-4 dark:border-white/10">
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-white/10">
          <MousePointer2 className="h-4 w-4" />
        </div>
        <p className="text-sm font-semibold text-zinc-900 dark:text-white">Nothing selected</p>
        <ul className="mt-3 space-y-2.5">
          {tips.map(([t, d]) => (
            <li key={t} className="text-[13px] leading-snug text-zinc-600 dark:text-zinc-400">
              <b className="font-medium text-zinc-800 dark:text-zinc-200">{t}.</b> {d}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] text-zinc-500">
          <span><kbd className="kbd">⌫</kbd> delete</span>
          <span><kbd className="kbd">⌘Z</kbd> undo</span>
          <span><kbd className="kbd">⌘D</kbd> duplicate</span>
          <span><kbd className="kbd">Shift</kbd>+drag select</span>
        </div>
      </div>
    </div>
  )
}

function NodeInspector({ node }: { node: ArchNode }) {
  const { scenario, domainLabel } = useWorkspaceContext()
  const update = useWorkspace((s) => s.updateNode)
  const edges = useWorkspace(useShallow((s) => s.edges.filter((e) => e.source === node.id || e.target === node.id)))
  const nodes = useWorkspace((s) => s.nodes)
  const parent = nodes.find((n) => n.id === node.parentId)
  const def = COMPONENT_BY_KIND[node.data.kind]
  const style = CATEGORY_STYLE[def.category]
  const Icon = KIND_ICON[node.data.kind]
  const techs = techFor(node.data.kind)
  const selectedTech = node.data.tech ? TECH_BY_ID[node.data.tech] : undefined
  const isNote = node.data.kind === 'note'
  const [freeDomain, setFreeDomain] = useState('')

  const toggleDomain = (id: string) => {
    const has = node.data.domains.includes(id)
    update(node.id, { domains: has ? node.data.domains.filter((d) => d !== id) : [...node.data.domains, id] })
  }

  return (
    <div className="scrollbar-thin h-full overflow-y-auto p-4 pb-10">
      <div className="flex items-center gap-3">
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', style.tile, style.text)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-zinc-900 dark:text-white">{def.name}</div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">{CATEGORIES.find((c) => c.id === def.category)?.name}</div>
        </div>
        {!def.container && (
          <button className="icon-btn" title="Duplicate (⌘D)" aria-label="Duplicate" onClick={() => useWorkspace.getState().duplicateNode(node.id)}>
            <Copy className="h-4 w-4" />
          </button>
        )}
        <button className="icon-btn hover:!text-rose-600" title="Delete" aria-label="Delete" onClick={() => useWorkspace.getState().removeElements([node.id])}>
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-3 text-[12px] leading-snug text-zinc-500 dark:text-zinc-400">{def.description}</p>
      {parent && (
        <p className="mt-2 text-[12px] text-zinc-500">
          Inside <b className="font-medium text-zinc-700 dark:text-zinc-300">{parent.data.label}</b>. Drag it out to detach.
        </p>
      )}

      <div className="mt-5">
        <label className="label" htmlFor="node-name">{isNote ? 'Note' : 'Name'}</label>
        {isNote ? (
          <textarea id="node-name" className="input min-h-28 resize-y" value={node.data.label} onChange={(e) => update(node.id, { label: e.target.value })} />
        ) : (
          <input id="node-name" className="input" value={node.data.label} onChange={(e) => update(node.id, { label: e.target.value })} />
        )}
      </div>

      {techs.length > 0 && (
        <div className="mt-5">
          <span className="label">Technology</span>
          <div className="flex flex-wrap gap-1.5">
            {techs.map((t) => {
              const on = node.data.tech === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => update(node.id, { tech: on ? undefined : t.id })}
                  aria-pressed={on}
                  className={cn(
                    'rounded-lg border px-2.5 py-1 text-[12px] font-medium transition-colors',
                    on
                      ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200'
                      : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:border-white/20',
                  )}
                >
                  {t.name}
                </button>
              )
            })}
          </div>
          {selectedTech ? (
            <div className="mt-2.5 rounded-xl bg-zinc-50 p-3 dark:bg-white/[0.04]">
              <p className="text-[12px] leading-snug text-zinc-700 dark:text-zinc-300">{selectedTech.blurb}</p>
              {selectedTech.traits.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {selectedTech.traits.map((tr) => (
                    <span key={tr} className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 ring-1 ring-zinc-200 dark:bg-white/5 dark:text-zinc-400 dark:ring-white/10">
                      {tr}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-zinc-500">No technology chosen — pick one to make trade-offs explicit.</p>
          )}
        </div>
      )}

      {def.ownsDomains && (
        <div className="mt-5">
          <span className="label">Owns capabilities</span>
          {scenario ? (
            <div className="flex flex-wrap gap-1.5">
              {scenario.domains.map((d) => {
                const on = node.data.domains.includes(d.id)
                const otherOwners = nodes.filter((n) => n.id !== node.id && n.data.domains.includes(d.id))
                return (
                  <button
                    key={d.id}
                    onClick={() => toggleDomain(d.id)}
                    aria-pressed={on}
                    title={d.description + (otherOwners.length ? ` — also owned by ${otherOwners.map((o) => o.data.label).join(', ')}` : '')}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors',
                      on
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200'
                        : 'border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-white/10 dark:text-zinc-400',
                    )}
                  >
                    {d.label}
                    {otherOwners.length > 0 && !on && <span className="ml-1 opacity-60">•</span>}
                  </button>
                )
              })}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {node.data.domains.map((d) => (
                  <button key={d} className="chip" onClick={() => toggleDomain(d)} title="Remove">
                    {domainLabel(d)} ×
                  </button>
                ))}
              </div>
              <form
                className="mt-2 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  const v = freeDomain.trim()
                  if (v && !node.data.domains.includes(v)) update(node.id, { domains: [...node.data.domains, v] })
                  setFreeDomain('')
                }}
              >
                <input className="input" placeholder="e.g. Orders" value={freeDomain} onChange={(e) => setFreeDomain(e.target.value)} />
                <button className="btn-secondary px-2.5" aria-label="Add capability">
                  <Plus className="h-4 w-4" />
                </button>
              </form>
            </>
          )}
        </div>
      )}

      {!isNote && (
        <div className="mt-5">
          <label className="label" htmlFor="node-notes">Notes</label>
          <textarea
            id="node-notes"
            className="input min-h-20 resize-y"
            placeholder="Assumptions, scaling notes, SLAs…"
            value={node.data.notes ?? ''}
            onChange={(e) => update(node.id, { notes: e.target.value })}
          />
        </div>
      )}

      {edges.length > 0 && (
        <div className="mt-5">
          <span className="label">Connections ({edges.length})</span>
          <ul className="space-y-1">
            {edges.map((e) => {
              const other = nodes.find((n) => n.id === (e.source === node.id ? e.target : e.source))
              const outgoing = e.source === node.id
              const p = e.data?.protocol ?? 'http'
              return (
                <li key={e.id}>
                  <button
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-zinc-50 dark:hover:bg-white/5"
                    onClick={() => useWorkspace.getState().select(e.id)}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: PROTOCOL_STYLE[p].color }} />
                    <span className="w-12 shrink-0 font-mono text-[10px] text-zinc-500">{PROTOCOLS.find((x) => x.id === p)?.short}</span>
                    <span className="text-zinc-400">{outgoing ? '→' : '←'}</span>
                    <span className="truncate text-zinc-700 dark:text-zinc-300">{other?.data.label}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

function EdgeInspector({ edge }: { edge: ArchEdge }) {
  const nodes = useWorkspace((s) => s.nodes)
  const update = useWorkspace((s) => s.updateEdge)
  const s = nodes.find((n) => n.id === edge.source)
  const t = nodes.find((n) => n.id === edge.target)
  const protocol = edge.data?.protocol ?? 'http'
  return (
    <div className="scrollbar-thin h-full overflow-y-auto p-4 pb-10">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-zinc-900 dark:text-white">Connection</div>
          <div className="mt-1 flex items-center gap-1.5 text-[12px] text-zinc-600 dark:text-zinc-400">
            <span className="truncate font-medium">{s?.data.label}</span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate font-medium">{t?.data.label}</span>
          </div>
        </div>
        <button className="icon-btn" title="Reverse direction" aria-label="Reverse direction" onClick={() => useWorkspace.getState().reverseEdge(edge.id)}>
          <ArrowLeftRight className="h-4 w-4" />
        </button>
        <button className="icon-btn hover:!text-rose-600" title="Delete" aria-label="Delete connection" onClick={() => useWorkspace.getState().removeElements([edge.id])}>
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-3 text-[12px] leading-snug text-zinc-500 dark:text-zinc-400">
        Arrows point the way requests or data flow: caller → callee, producer → broker → consumer, service → database.
      </p>
      <div className="mt-5">
        <span className="label">Communication</span>
        <div className="space-y-1.5">
          {PROTOCOLS.map((p) => {
            const on = protocol === p.id
            return (
              <button
                key={p.id}
                onClick={() => update(edge.id, { protocol: p.id })}
                aria-pressed={on}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors',
                  on ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-500/10' : 'border-zinc-200 hover:border-zinc-300 dark:border-white/10 dark:hover:border-white/20',
                )}
              >
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: PROTOCOL_STYLE[p.id].color }} />
                <span>
                  <span className="flex items-center gap-2 text-[13px] font-medium text-zinc-900 dark:text-zinc-100">
                    {p.name}
                    {p.async && <span className="rounded bg-amber-100 px-1 text-[9px] font-semibold tracking-wide text-amber-700 uppercase dark:bg-amber-500/15 dark:text-amber-300">async</span>}
                  </span>
                  <span className="block text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{p.description}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="mt-5">
        <label className="label" htmlFor="edge-label">Label</label>
        <input
          id="edge-label"
          className="input"
          placeholder={protocol === 'event' ? 'e.g. OrderPlaced' : 'e.g. GET /products'}
          value={edge.data?.label ?? ''}
          onChange={(e) => update(edge.id, { label: e.target.value })}
        />
      </div>
    </div>
  )
}

import { useReactFlow } from '@xyflow/react'
import { BookOpen, Info, Plus, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { COMPONENT_DETAILS } from '../../data/componentDetails'
import { CONCEPT_BY_ID } from '../../data/concepts'
import { techFor } from '../../data/tech'
import { CATEGORIES, CATEGORY_STYLE, COMPONENTS, type ComponentDef } from '../../data/components'
import { cn } from '../../lib/cn'
import { KIND_ICON } from '../../lib/icons'
import { CONTAINER_SIZE, useWorkspace } from '../../store/workspace'
import { DND_MIME } from '../canvas/Canvas'
import { Modal } from '../ui/Modal'

/** First position on a spiral around `start` that doesn't overlap a top-level node. */
function freeSpot(start: { x: number; y: number }, size = { width: 200, height: 60 }) {
  const taken = useWorkspace.getState().nodes.filter((n) => !n.parentId)
  const overlaps = (x: number, y: number) =>
    taken.some((n) => {
      const w = n.width ?? n.measured?.width ?? 200
      const h = n.height ?? n.measured?.height ?? 60
      return x < n.position.x + w + 20 && x + size.width > n.position.x - 20 && y < n.position.y + h + 20 && y + size.height > n.position.y - 20
    })
  for (let ring = 0; ring < 8; ring++) {
    for (let i = 0; i < Math.max(1, ring * 8); i++) {
      const a = (i / Math.max(1, ring * 8)) * Math.PI * 2
      const x = Math.round(start.x + Math.cos(a) * ring * Math.max(120, size.width * 0.6))
      const y = Math.round(start.y + Math.sin(a) * ring * Math.max(90, size.height * 0.6))
      if (!overlaps(x, y)) return { x, y }
    }
  }
  return start
}

const CARD_WIDTH = 320

/** Full description, typical technologies and related concepts for a component. */
function ComponentDetails({ c, compact = false }: { c: ComponentDef; compact?: boolean }) {
  const d = COMPONENT_DETAILS[c.kind]
  const tech = techFor(c.kind).slice(0, compact ? 6 : 10)
  const concepts = (d.concepts ?? []).map((id) => CONCEPT_BY_ID[id]).filter(Boolean)
  const text = compact ? 'text-[12px]' : 'text-[13px]'
  return (
    <>
      <p className={cn('leading-relaxed text-zinc-600 dark:text-zinc-300', text)}>{d.details}</p>
      <p className={cn('mt-2.5 leading-relaxed text-zinc-600 dark:text-zinc-300', text)}>
        <span className="font-semibold text-zinc-800 dark:text-zinc-100">Use when: </span>
        {d.useWhen}
      </p>
      {tech.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">Typical choices</p>
          <div className="flex flex-wrap gap-1">
            {tech.map((t) => (
              <span key={t.id} className="rounded-md border border-zinc-200 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:border-white/10 dark:text-zinc-300">
                {t.name}
              </span>
            ))}
          </div>
        </div>
      )}
      {concepts.length > 0 && (
        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
          <BookOpen className="mt-px h-3 w-3 shrink-0" aria-hidden />
          <span>Related concepts: {concepts.map((x) => x.title).join(', ')}</span>
        </p>
      )}
    </>
  )
}

/** Hover card with the full description, typical technologies and related concepts. */
function HoverCard({ c, anchor }: { c: ComponentDef; anchor: { left: number; top: number } }) {
  const ref = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(anchor.top)
  useEffect(() => {
    const h = ref.current?.offsetHeight ?? 0
    setTop(Math.max(12, Math.min(anchor.top, window.innerHeight - h - 12)))
  }, [anchor.top, c.kind])
  const style = CATEGORY_STYLE[c.category]
  const Icon = KIND_ICON[c.kind]
  return createPortal(
    <div
      ref={ref}
      id="palette-hovercard"
      role="tooltip"
      className="panel pointer-events-none fixed z-50 animate-[hovercard-in_120ms_ease-out] p-4"
      style={{ left: anchor.left, top, width: CARD_WIDTH }}
    >
      <div className="mb-3 flex items-center gap-2.5">
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', style.tile, style.text)}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-zinc-900 dark:text-white">{c.name}</p>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{CATEGORIES.find((x) => x.id === c.category)?.name}</p>
        </div>
      </div>
      <ComponentDetails c={c} compact />
    </div>,
    document.body,
  )
}

/** The same details as the hover card, in a dialog — for touch and small screens where hover cards can't show. */
function DetailsDialog({ c, onClose, onAdd }: { c?: ComponentDef; onClose: () => void; onAdd: (c: ComponentDef) => void }) {
  return (
    <Modal
      open={!!c}
      onClose={onClose}
      size="sm"
      title={c?.name}
      subtitle={c && CATEGORIES.find((x) => x.id === c.category)?.name}
      footer={
        c && (
          <button
            className="btn-dark"
            onClick={() => {
              onClose()
              onAdd(c)
            }}
          >
            <Plus className="h-4 w-4" /> Add to canvas
          </button>
        )
      }
    >
      {c && (
        <div className="p-5">
          <ComponentDetails c={c} />
        </div>
      )}
    </Modal>
  )
}

export function Palette({ onAdded }: { onAdded?: () => void }) {
  const [q, setQ] = useState('')
  const { screenToFlowPosition } = useReactFlow()
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return COMPONENTS
    return COMPONENTS.filter((c) => [c.name, c.description, ...(c.keywords ?? [])].join(' ').toLowerCase().includes(term))
  }, [q])

  const addAtCenter = (c: ComponentDef) => {
    const el = document.querySelector('.react-flow')
    const r = el?.getBoundingClientRect()
    const center = r ? screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) : { x: 0, y: 0 }
    const size = CONTAINER_SIZE[c.kind] ?? { width: 200, height: 60 }
    useWorkspace.getState().addNode(c.kind, freeSpot({ x: center.x - size.width / 2, y: center.y - size.height / 2 }, size))
    onAdded?.()
  }

  const [info, setInfo] = useState<ComponentDef>()
  const [hover, setHover] = useState<{ c: ComponentDef; anchor: { left: number; top: number } }>()
  const timer = useRef<number | undefined>(undefined)
  // Once a card has been shown, moving to the next item swaps it almost instantly.
  const lastShown = useRef(0)
  const hide = () => {
    window.clearTimeout(timer.current)
    setHover((h) => {
      if (h) lastShown.current = Date.now()
      return undefined
    })
  }
  const show = (el: HTMLElement, c: ComponentDef, delay: number) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const panel = el.closest('aside')?.getBoundingClientRect() ?? el.getBoundingClientRect()
      const left = panel.right + 10
      if (left + CARD_WIDTH > window.innerWidth - 8) return // no room next to the panel (small screens)
      setHover({ c, anchor: { left, top: el.getBoundingClientRect().top - 4 } })
      lastShown.current = Date.now()
    }, delay)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const onDragStart = (e: DragEvent, c: ComponentDef) => {
    hide()
    e.dataTransfer.setData(DND_MIME, c.kind)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div className="flex h-full flex-col">
      <div className="p-3 pb-2">
        <label className="relative block">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input className="input pl-9" placeholder="Search components…  e.g. kafka, cache" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search components" />
        </label>
        <p className="mt-2 px-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">Drag onto the canvas, or click to add.</p>
      </div>
      <div className="scrollbar-thin flex-1 overflow-x-hidden overflow-y-auto px-3 pb-6" onScroll={hide}>
        {CATEGORIES.map((cat) => {
          const items = filtered.filter((c) => c.category === cat.id)
          if (!items.length) return null
          const style = CATEGORY_STYLE[cat.id]
          return (
            <section key={cat.id} className="mt-3 first:mt-1">
              <h3 className="mb-1.5 flex items-center gap-1.5 px-0.5 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: style.dot }} />
                {cat.name}
              </h3>
              <div className="flex flex-col gap-0.5">
                {items.map((c) => {
                  const Icon = KIND_ICON[c.kind]
                  return (
                    <div key={c.kind} className="relative">
                      <button
                        draggable
                        onDragStart={(e) => onDragStart(e, c)}
                        onClick={() => {
                          hide()
                          addAtCenter(c)
                        }}
                        onMouseEnter={(e) => show(e.currentTarget, c, Date.now() - lastShown.current < 400 ? 60 : 350)}
                        onMouseLeave={hide}
                        onFocus={(e) => show(e.currentTarget, c, 0)}
                        onBlur={hide}
                        aria-describedby={hover?.c.kind === c.kind ? 'palette-hovercard' : undefined}
                        className="group flex w-full min-w-0 cursor-grab items-center gap-2.5 rounded-lg border border-transparent px-1.5 py-1.5 text-left transition-colors hover:border-zinc-200 hover:bg-zinc-50 active:cursor-grabbing max-md:pr-10 pointer-coarse:pr-10 dark:hover:border-white/10 dark:hover:bg-white/5"
                      >
                        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', style.tile, style.text)}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-zinc-800 dark:text-zinc-100">{c.name}</span>
                          <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">{c.description}</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="absolute top-1/2 right-0.5 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 max-md:flex pointer-coarse:flex dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
                        aria-label={`About ${c.name}`}
                        title={`About ${c.name}`}
                        onClick={() => {
                          hide()
                          setInfo(c)
                        }}
                      >
                        <Info className="h-4 w-4" />
                      </button>
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}
        {hover && <HoverCard c={hover.c} anchor={hover.anchor} />}
        <DetailsDialog c={info} onClose={() => setInfo(undefined)} onAdd={addAtCenter} />
        {!filtered.length && <p className="mt-6 text-center text-sm text-zinc-500">No components match “{q}”.</p>}
      </div>
    </div>
  )
}

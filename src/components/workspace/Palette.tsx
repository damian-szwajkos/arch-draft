import { useReactFlow } from '@xyflow/react'
import { Search } from 'lucide-react'
import { useMemo, useState, type DragEvent } from 'react'
import { CATEGORIES, CATEGORY_STYLE, COMPONENTS, type ComponentDef } from '../../data/components'
import { cn } from '../../lib/cn'
import { KIND_ICON } from '../../lib/icons'
import { CONTAINER_SIZE, useWorkspace } from '../../store/workspace'
import { DND_MIME } from '../canvas/Canvas'

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

  const onDragStart = (e: DragEvent, c: ComponentDef) => {
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
      <div className="scrollbar-thin flex-1 overflow-x-hidden overflow-y-auto px-3 pb-6">
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
                    <button
                      key={c.kind}
                      draggable
                      onDragStart={(e) => onDragStart(e, c)}
                      onClick={() => addAtCenter(c)}
                      title={c.description}
                      className="group flex w-full min-w-0 cursor-grab items-center gap-2.5 rounded-lg border border-transparent px-1.5 py-1.5 text-left transition-colors hover:border-zinc-200 hover:bg-zinc-50 active:cursor-grabbing dark:hover:border-white/10 dark:hover:bg-white/5"
                    >
                      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', style.tile, style.text)}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-zinc-800 dark:text-zinc-100">{c.name}</span>
                        <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">{c.description}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          )
        })}
        {!filtered.length && <p className="mt-6 text-center text-sm text-zinc-500">No components match “{q}”.</p>}
      </div>
    </div>
  )
}

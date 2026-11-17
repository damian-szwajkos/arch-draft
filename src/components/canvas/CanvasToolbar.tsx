import { useReactFlow, useViewport } from '@xyflow/react'
import { Map, Maximize, Redo2, Undo2, ZoomIn, ZoomOut } from 'lucide-react'
import { cn } from '../../lib/cn'
import { useWorkspace } from '../../store/workspace'

export function CanvasToolbar({ showMap, onToggleMap }: { showMap: boolean; onToggleMap: () => void }) {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const { zoom } = useViewport()
  const canUndo = useWorkspace((s) => s.past.length > 0)
  const canRedo = useWorkspace((s) => s.future.length > 0)
  const undo = useWorkspace((s) => s.undo)
  const redo = useWorkspace((s) => s.redo)
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4">
      <div className="panel pointer-events-auto flex items-center gap-0.5 rounded-full px-1.5 py-1">
        <button className="icon-btn rounded-full" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)" aria-label="Undo">
          <Undo2 className="h-4 w-4" />
        </button>
        <button className="icon-btn rounded-full" onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)" aria-label="Redo">
          <Redo2 className="h-4 w-4" />
        </button>
        <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-white/10" />
        <button className="icon-btn rounded-full" onClick={() => zoomOut({ duration: 150 })} title="Zoom out" aria-label="Zoom out">
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="w-11 text-center font-mono text-[11px] text-zinc-500 tabular-nums dark:text-zinc-400">{Math.round(zoom * 100)}%</span>
        <button className="icon-btn rounded-full" onClick={() => zoomIn({ duration: 150 })} title="Zoom in" aria-label="Zoom in">
          <ZoomIn className="h-4 w-4" />
        </button>
        <button className="icon-btn rounded-full" onClick={() => fitView({ padding: 0.2, duration: 300 })} title="Fit to screen" aria-label="Fit to screen">
          <Maximize className="h-4 w-4" />
        </button>
        <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-white/10" />
        <button
          className={cn('icon-btn rounded-full', showMap && 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300')}
          onClick={onToggleMap}
          title="Toggle minimap"
          aria-label="Toggle minimap"
          aria-pressed={showMap}
        >
          <Map className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

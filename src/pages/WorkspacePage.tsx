import { getNodesBounds, getViewportForBounds, ReactFlowProvider, useReactFlow } from '@xyflow/react'
import { toPng } from 'html-to-image'
import {
  CheckCircle2,
  ChevronRight,
  Download,
  FileJson,
  Image as ImageIcon,
  Lightbulb,
  Moon,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Play,
  RotateCcw,
  Sun,
  Upload,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Canvas } from '../components/canvas/Canvas'
import { BriefPanel } from '../components/workspace/BriefPanel'
import { DecisionsPanel } from '../components/workspace/DecisionsPanel'
import { Inspector } from '../components/workspace/Inspector'
import { Palette } from '../components/workspace/Palette'
import { ReferenceDialog } from '../components/workspace/ReferenceDialog'
import { ReviewPanel } from '../components/workspace/ReviewPanel'
import { WorkspaceContext } from '../components/workspace/ScenarioContext'
import { DifficultyBadge } from '../components/ui/Badges'
import { Modal } from '../components/ui/Modal'
import { LogoMark } from '../components/ui/Logo'
import { SCENARIO_BY_ID } from '../data/scenarios'
import { evaluateSandbox, evaluateScenario } from '../engine/evaluate'
import type { Decisions, Diagram, Evaluation, Scenario } from '../engine/types'
import { cn } from '../lib/cn'
import { readJSON, recordAttempt, touchScenario, writeJSON } from '../lib/storage'
import { useTheme } from '../lib/theme'
import { useWorkspace, type ArchNode, type RightTab } from '../store/workspace'
import { NotFound } from './NotFound'

interface SavedWorkspace {
  version: 1
  diagram: Diagram
  decisions: Decisions
  evaluation?: Evaluation
  hintsRevealed?: number
}

const EMPTY: Diagram = { nodes: [], edges: [] }

export function WorkspacePage({ mode }: { mode: 'scenario' | 'sandbox' }) {
  const { id = '' } = useParams()
  const scenario = mode === 'scenario' ? SCENARIO_BY_ID[id] : undefined
  if (mode === 'scenario' && !scenario) return <NotFound />
  const key = `archdraft:ws:${scenario?.id ?? 'sandbox'}`
  return (
    <ReactFlowProvider key={key}>
      <Workspace scenario={scenario} storageKey={key} />
    </ReactFlowProvider>
  )
}

function useIsDesktop() {
  const [desk, setDesk] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const on = () => setDesk(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return desk
}

function Workspace({ scenario, storageKey }: { scenario?: Scenario; storageKey: string }) {
  const desktop = useIsDesktop()
  const [ready, setReady] = useState(false)
  const [hints, setHints] = useState(0)
  const [savedAt, setSavedAt] = useState<number>()
  const [leftOpen, setLeftOpen] = useState(desktop || !!scenario)
  const [rightOpen, setRightOpen] = useState(desktop)
  const [refOpen, setRefOpen] = useState(false)
  const [toast, setToast] = useState<{ title: string; body: string; success?: boolean }>()
  const [confirmReset, setConfirmReset] = useState(false)
  const leftTab = useWorkspace((s) => s.leftTab)
  const rightTab = useWorkspace((s) => s.rightTab)
  const evaluation = useWorkspace((s) => s.evaluation)
  const anySelected = useWorkspace((s) => s.nodes.some((n) => n.selected) || s.edges.some((e) => e.selected))
  const { setLeftTab, setRightTab } = useWorkspace.getState()
  const { fitView } = useReactFlow()

  // Load saved state (or scenario starter) before the canvas mounts.
  useEffect(() => {
    const saved = readJSON<SavedWorkspace | null>(storageKey, null)
    const ws = useWorkspace.getState()
    ws.load(storageKey, saved?.diagram ?? scenario?.starter ?? EMPTY, saved?.decisions ?? scenario?.starterDecisions ?? { stack: {} })
    if (saved?.evaluation) useWorkspace.setState({ evaluation: saved.evaluation, dirtySinceEval: false })
    setHints(saved?.hintsRevealed ?? 0)
    ws.setLeftTab(scenario ? (saved ? 'components' : 'brief') : 'components')
    ws.setRightTab(saved?.evaluation ? 'review' : 'decisions')
    if (scenario) touchScenario(scenario.id)
    setReady(true)
  }, [storageKey, scenario])

  // Persist (debounced) on every change.
  const hintsRef = useRef(hints)
  hintsRef.current = hints
  const persist = useCallback(() => {
    const s = useWorkspace.getState()
    if (s.storageKey !== storageKey) return
    writeJSON(storageKey, { version: 1, diagram: s.diagram(), decisions: s.decisions, evaluation: s.evaluation, hintsRevealed: hintsRef.current } satisfies SavedWorkspace)
    setSavedAt(Date.now())
  }, [storageKey])
  useEffect(() => {
    if (!ready) return
    let t: number | undefined
    const unsub = useWorkspace.subscribe((s, prev) => {
      if (s.nodes === prev.nodes && s.edges === prev.edges && s.decisions === prev.decisions && s.evaluation === prev.evaluation) return
      window.clearTimeout(t)
      t = window.setTimeout(persist, 400)
    })
    return () => {
      unsub()
      window.clearTimeout(t)
    }
  }, [ready, persist])
  useEffect(() => {
    if (ready) persist()
  }, [hints, ready, persist])

  // On mobile, open the inspector when something gets selected.
  useEffect(() => {
    if (!desktop && anySelected && rightTab === 'inspect') setRightOpen(true)
  }, [anySelected, desktop, rightTab])

  const domainLabel = useMemo(() => {
    const map = new Map(scenario?.domains.map((d) => [d.id, d.label]))
    return (id: string) => map.get(id) ?? id
  }, [scenario])

  const check = () => {
    const s = useWorkspace.getState()
    const ev = scenario ? evaluateScenario(scenario, s.diagram(), s.decisions) : evaluateSandbox(s.diagram(), s.decisions)
    s.setEvaluation(ev)
    s.setRightTab('review')
    setRightOpen(true)
    if (scenario) {
      recordAttempt(scenario.id, ev.score, ev.passed)
      if (ev.passed) setToast({ title: 'Scenario passed', body: `You scored ${ev.score}/100.`, success: true })
    }
  }

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(undefined), 4500)
    return () => window.clearTimeout(t)
  }, [toast])

  const loadReference = () => {
    if (!scenario) return
    const s = useWorkspace.getState()
    s.pushHistory()
    const past = s.past
    s.load(storageKey, scenario.reference.diagram, scenario.reference.decisions)
    useWorkspace.setState({ past })
    setRefOpen(false)
    setTimeout(() => fitView({ padding: 0.15, duration: 400 }), 50)
  }

  const rightTabs: { id: RightTab; label: string }[] = [
    { id: 'inspect', label: 'Inspect' },
    { id: 'decisions', label: 'Decisions' },
    { id: 'review', label: 'Review' },
  ]

  return (
    <WorkspaceContext.Provider value={{ scenario, domainLabel }}>
      <div className="flex h-dvh flex-col bg-[var(--canvas-bg)]">
        <TopBar
          scenario={scenario}
          onToggleLeft={() => setLeftOpen((v) => !v)}
          onToggleRight={() => setRightOpen((v) => !v)}
          leftOpen={leftOpen}
          rightOpen={rightOpen}
          onCheck={check}
          savedAt={savedAt}
          hintsLeft={scenario ? scenario.hints.length - hints : 0}
          onHint={() => {
            setHints((h) => Math.min((scenario?.hints.length ?? 0), h + 1))
            setLeftTab('brief')
            setLeftOpen(true)
          }}
          onReference={scenario ? () => setRefOpen(true) : undefined}
          storageKey={storageKey}
          onReset={() => setConfirmReset(true)}
          notify={(title, body) => setToast({ title, body })}
        />
        <div className="relative flex-1 overflow-hidden">
          <div className={cn('absolute inset-0 transition-[left,right] duration-200', leftOpen && 'lg:left-[316px]', rightOpen && 'lg:right-[356px]')}>
            {ready && <Canvas />}
          </div>

          {/* Left panel */}
          <aside
            className={cn(
              'panel absolute top-3 bottom-3 left-3 z-20 flex w-[min(300px,calc(100vw-24px))] flex-col overflow-hidden transition-transform duration-200',
              leftOpen ? 'translate-x-0' : '-translate-x-[calc(100%+24px)]',
            )}
            aria-label="Brief and components"
          >
            <div className="flex items-center gap-1 border-b border-zinc-100 p-1.5 dark:border-white/10">
              {scenario && (
                <TabButton active={leftTab === 'brief'} onClick={() => setLeftTab('brief')}>
                  Brief
                </TabButton>
              )}
              <TabButton active={leftTab === 'components' || !scenario} onClick={() => setLeftTab('components')}>
                Components
              </TabButton>
              <button className="icon-btn ml-auto lg:hidden" onClick={() => setLeftOpen(false)} aria-label="Close panel">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              {scenario && leftTab === 'brief' ? (
                <BriefPanel scenario={scenario} hintsRevealed={hints} onRevealHint={() => setHints((h) => h + 1)} />
              ) : (
                <Palette onAdded={() => !desktop && setLeftOpen(false)} />
              )}
            </div>
          </aside>

          {/* Right panel */}
          <aside
            className={cn(
              'panel absolute top-3 right-3 bottom-3 z-20 flex w-[min(340px,calc(100vw-24px))] flex-col overflow-hidden transition-transform duration-200',
              rightOpen ? 'translate-x-0' : 'translate-x-[calc(100%+24px)]',
            )}
            aria-label="Inspector, decisions and review"
          >
            <div className="flex items-center gap-1 border-b border-zinc-100 p-1.5 dark:border-white/10">
              {rightTabs.map((t) => (
                <TabButton key={t.id} active={rightTab === t.id} onClick={() => setRightTab(t.id)}>
                  {t.label}
                  {t.id === 'review' && evaluation && scenario && (
                    <span className={cn('ml-1 rounded px-1 font-mono text-[10px]', evaluation.passed ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300')}>
                      {evaluation.score}
                    </span>
                  )}
                </TabButton>
              ))}
              <button className="icon-btn ml-auto lg:hidden" onClick={() => setRightOpen(false)} aria-label="Close panel">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              {rightTab === 'inspect' && <Inspector />}
              {rightTab === 'decisions' && <DecisionsPanel />}
              {rightTab === 'review' && <ReviewPanel evaluation={evaluation} onCheck={check} sandbox={!scenario} onReference={scenario ? () => setRefOpen(true) : undefined} />}
            </div>
          </aside>

          {toast && (
            <div className="pointer-events-none absolute inset-x-0 top-4 z-30 flex justify-center px-4">
              <div className="panel pointer-events-auto flex items-center gap-3 px-4 py-3">
                {toast.success && <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />}
                <div>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-white">{toast.title}</p>
                  <p className="text-xs text-zinc-500">{toast.body}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        size="sm"
        title={scenario?.starter ? 'Reset to the starting point?' : 'Clear the canvas?'}
        subtitle="Your diagram and decisions will be replaced. You can still undo with ⌘Z."
        footer={
          <>
            <button className="btn-secondary" onClick={() => setConfirmReset(false)}>
              Cancel
            </button>
            <button
              className="btn bg-rose-600 text-white hover:bg-rose-700"
              onClick={() => {
                const s = useWorkspace.getState()
                s.pushHistory()
                const past = s.past
                s.load(storageKey, scenario?.starter ?? EMPTY, scenario?.starterDecisions ?? { stack: {} })
                useWorkspace.setState({ past })
                setConfirmReset(false)
                setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50)
              }}
            >
              Reset canvas
            </button>
          </>
        }
      >
        <span />
      </Modal>
      {scenario && (
        <ReferenceDialog scenario={scenario} open={refOpen} onClose={() => setRefOpen(false)} hasAttempted={!!evaluation} onLoad={loadReference} />
      )}
    </WorkspaceContext.Provider>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-center rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors',
        active ? 'bg-zinc-100 text-zinc-900 dark:bg-white/10 dark:text-white' : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200',
      )}
    >
      {children}
    </button>
  )
}

function TopBar({
  scenario,
  onToggleLeft,
  onToggleRight,
  leftOpen,
  rightOpen,
  onCheck,
  savedAt,
  hintsLeft,
  onHint,
  onReference,
  storageKey,
  onReset,
  notify,
}: {
  scenario?: Scenario
  onReset: () => void
  notify: (title: string, body: string) => void
  onToggleLeft: () => void
  onToggleRight: () => void
  leftOpen: boolean
  rightOpen: boolean
  onCheck: () => void
  savedAt?: number
  hintsLeft: number
  onHint: () => void
  onReference?: () => void
  storageKey: string
}) {
  const { isDark, toggle } = useTheme()
  return (
    <header className="z-30 flex h-14 shrink-0 items-center gap-2 border-b border-zinc-200/80 bg-white px-3 dark:border-white/10 dark:bg-[#111318]">
      <Link to="/" aria-label="ArchDraft home" className="shrink-0">
        <LogoMark />
      </Link>
      <button className={cn('icon-btn', leftOpen && 'text-zinc-900 dark:text-white')} onClick={onToggleLeft} title="Toggle left panel" aria-label="Toggle left panel">
        <PanelLeft className="h-4 w-4" />
      </button>
      <nav className="flex min-w-0 items-center gap-1.5 text-sm" aria-label="Breadcrumb">
        <Link to={scenario ? '/scenarios' : '/'} className="hidden shrink-0 text-zinc-500 hover:text-zinc-900 sm:inline dark:text-zinc-400 dark:hover:text-white">
          {scenario ? 'Scenarios' : 'Home'}
        </Link>
        <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-zinc-300 sm:inline" />
        <span className="truncate font-semibold text-zinc-900 dark:text-white">{scenario ? scenario.title.split(':')[0] : 'Sandbox'}</span>
        {scenario && (
          <span className="hidden md:inline">
            <DifficultyBadge value={scenario.difficulty} />
          </span>
        )}
      </nav>
      <div className="ml-auto flex items-center gap-1">
        {savedAt && <span className="mr-2 hidden text-xs text-zinc-400 xl:inline">Saved in this browser</span>}
        {scenario && (
          <button className="btn-ghost hidden px-2.5 sm:inline-flex" onClick={onHint} disabled={hintsLeft === 0} title="Reveal a hint">
            <Lightbulb className="h-4 w-4 text-amber-500" />
            <span className="hidden md:inline">Hint</span>
            <span className="font-mono text-[11px] text-zinc-400">{hintsLeft}</span>
          </button>
        )}
        <MoreMenu scenario={scenario} onReference={onReference} storageKey={storageKey} onReset={onReset} notify={notify} />
        <button className="icon-btn" onClick={toggle} title="Toggle theme" aria-label="Toggle theme">
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <button className={cn('icon-btn', rightOpen && 'text-zinc-900 dark:text-white')} onClick={onToggleRight} title="Toggle right panel" aria-label="Toggle right panel">
          <PanelRight className="h-4 w-4" />
        </button>
        <button className="btn-primary ml-1 px-3" onClick={onCheck}>
          <Play className="h-4 w-4" />
          <span className="hidden sm:inline">Check design</span>
        </button>
      </div>
    </header>
  )
}

function MoreMenu({
  scenario,
  onReference,
  storageKey,
  onReset,
  notify,
}: {
  scenario?: Scenario
  onReference?: () => void
  storageKey: string
  onReset: () => void
  notify: (title: string, body: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const { getNodes, fitView } = useReactFlow<ArchNode>()
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const name = scenario?.id ?? 'sandbox'
  const download = (href: string, file: string) => {
    const a = document.createElement('a')
    a.href = href
    a.download = file
    a.click()
  }
  const exportJson = () => {
    const s = useWorkspace.getState()
    const blob = new Blob([JSON.stringify({ app: 'archdraft', version: 1, scenario: scenario?.id ?? null, diagram: s.diagram(), decisions: s.decisions }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    download(url, `archdraft-${name}.json`)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const exportPng = async () => {
    const nodes = getNodes()
    if (!nodes.length) return notify('Nothing to export', 'Add some components first.')
    const bounds = getNodesBounds(nodes)
    const w = Math.min(4000, Math.max(800, bounds.width + 160))
    const h = Math.min(4000, Math.max(500, bounds.height + 160))
    const vp = getViewportForBounds(bounds, w, h, 0.2, 2, 0.08)
    const el = document.querySelector<HTMLElement>('.react-flow__viewport')
    if (!el) return
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim() || '#ffffff'
    const url = await toPng(el, { backgroundColor: bg, width: w, height: h, pixelRatio: 2, style: { width: `${w}px`, height: `${h}px`, transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` } })
    download(url, `archdraft-${name}.png`)
  }
  const importJson = async (file: File) => {
    try {
      const data = JSON.parse(await file.text())
      if (!data?.diagram?.nodes || !Array.isArray(data.diagram.nodes) || !Array.isArray(data.diagram.edges)) throw new Error('Not an ArchDraft file')
      const s = useWorkspace.getState()
      s.pushHistory()
      const past = s.past
      s.load(storageKey, data.diagram, data.decisions ?? { stack: {} })
      useWorkspace.setState({ past })
      setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50)
    } catch (err) {
      notify('Import failed', (err as Error).message)
    }
  }
  const item = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/10'
  return (
    <div className="relative" ref={ref}>
      <button className="icon-btn" onClick={() => setOpen((v) => !v)} aria-label="More actions" aria-expanded={open}>
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div className="panel absolute top-10 right-0 z-40 w-56 p-1.5" role="menu" onClick={() => setOpen(false)}>
          {onReference && (
            <button className={item} onClick={onReference} role="menuitem">
              <Lightbulb className="h-4 w-4" /> Reference solution
            </button>
          )}
          <button className={item} onClick={exportPng} role="menuitem">
            <ImageIcon className="h-4 w-4" /> Export as PNG
          </button>
          <button className={item} onClick={exportJson} role="menuitem">
            <Download className="h-4 w-4" /> Export JSON
          </button>
          <button className={item} onClick={() => fileRef.current?.click()} role="menuitem">
            <Upload className="h-4 w-4" /> Import JSON
          </button>
          <div className="my-1 h-px bg-zinc-100 dark:bg-white/10" />
          <button className={cn(item, 'text-rose-600 dark:text-rose-400')} onClick={onReset} role="menuitem">
            <RotateCcw className="h-4 w-4" /> Reset canvas
          </button>
          <div className="mt-1 flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-zinc-400">
            <FileJson className="h-3.5 w-3.5" /> Autosaved locally
          </div>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) importJson(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}

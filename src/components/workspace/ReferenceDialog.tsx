import { Background, BackgroundVariant, ConnectionMode, ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { EyeOff, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { STYLE_NAMES } from '../../engine/evaluate'
import type { Scenario } from '../../engine/types'
import { TECH_BY_ID, STACK_SLOTS } from '../../data/tech'
import { diagramToFlow } from '../../store/workspace'
import { edgeTypes, nodeTypes } from '../canvas/Canvas'
import { Modal } from '../ui/Modal'

export function ReferenceDialog({
  scenario,
  open,
  onClose,
  hasAttempted,
  onLoad,
}: {
  scenario: Scenario
  open: boolean
  onClose: () => void
  hasAttempted: boolean
  onLoad: () => void
}) {
  const [revealed, setRevealed] = useState(false)
  const [armed, setArmed] = useState(false)
  const flow = useMemo(() => diagramToFlow(scenario.reference.diagram), [scenario])
  const show = hasAttempted || revealed
  const d = scenario.reference.decisions
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Reference solution"
      subtitle="One good answer — not the only one. Compare trade-offs with your design."
      footer={
        show && (
          <>
            {armed && <span className="mr-auto text-xs text-zinc-500">This replaces your current diagram (undo with ⌘Z).</span>}
            <button
              className={armed ? 'btn bg-rose-600 text-white hover:bg-rose-700' : 'btn-secondary'}
              onClick={() => {
                if (!armed) return setArmed(true)
                setArmed(false)
                onLoad()
              }}
              onBlur={() => setArmed(false)}
            >
              <Upload className="h-4 w-4" /> {armed ? 'Yes, replace my canvas' : 'Load into my canvas'}
            </button>
            <button className="btn-dark" onClick={onClose}>
              Back to my design
            </button>
          </>
        )
      }
    >
      {!show ? (
        <div className="flex flex-col items-center px-6 py-16 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-500/10">
            <EyeOff className="h-6 w-6" />
          </div>
          <p className="text-base font-semibold text-zinc-900 dark:text-white">Spoiler ahead</p>
          <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
            You learn far more by attempting the design first. Run <b>Check my design</b> at least once — or peek anyway.
          </p>
          <button className="btn-secondary mt-5" onClick={() => setRevealed(true)}>
            Show me anyway
          </button>
        </div>
      ) : (
        <div className="grid lg:grid-cols-[1fr_360px]">
          <div className="h-[55vh] border-b border-zinc-100 lg:h-[70vh] lg:border-r lg:border-b-0 dark:border-white/10">
            <ReactFlowProvider>
              <ReactFlow
                nodes={flow.nodes}
                edges={flow.edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                connectionMode={ConnectionMode.Loose}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                fitView
                fitViewOptions={{ padding: 0.1 }}
                minZoom={0.1}
              >
                <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} />
              </ReactFlow>
            </ReactFlowProvider>
          </div>
          <div className="scrollbar-thin space-y-5 overflow-y-auto p-5 lg:max-h-[70vh]">
            <div>
              <h3 className="label">Decisions</h3>
              <dl className="grid grid-cols-[100px_1fr] gap-y-1.5 text-[13px]">
                <dt className="text-zinc-500">Style</dt>
                <dd className="font-medium text-zinc-900 dark:text-white">{d.style ? STYLE_NAMES[d.style] : '—'}</dd>
                {STACK_SLOTS.filter((s) => d.stack[s.key]).map((s) => (
                  <div key={s.key} className="contents">
                    <dt className="text-zinc-500">{s.label}</dt>
                    <dd className="font-medium text-zinc-900 dark:text-white">{TECH_BY_ID[d.stack[s.key]!]?.name}</dd>
                  </div>
                ))}
              </dl>
              {d.rationale && <p className="mt-3 rounded-xl bg-zinc-50 p-3 text-[13px] leading-relaxed text-zinc-700 dark:bg-white/[0.04] dark:text-zinc-300">{d.rationale}</p>}
            </div>
            <div>
              <h3 className="label">Walkthrough</h3>
              <ol className="space-y-3">
                {scenario.reference.walkthrough.map((w, i) => (
                  <li key={i} className="flex gap-3 text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-300">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 font-mono text-[10px] font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                      {i + 1}
                    </span>
                    {w}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

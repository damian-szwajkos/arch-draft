import { describe, expect, it } from 'vitest'
import { assertScenarioContract } from '../../engine/scenarioContract'
import { evaluateScenario } from '../../engine/evaluate'
import type { Decisions, Diagram, DiagramEdge, DiagramNode } from '../../engine/types'
import { diagram, type NodeSpec } from './builder'
import { labResults } from './labresults'

const ref = labResults.reference

function results(d: Diagram, decisions: Decisions = ref.decisions) {
  const ev = evaluateScenario(labResults, d, decisions)
  const result = (id: string) => ev.results.find((r) => r.id === id)
  return { ev, result, pass: (id: string) => result(id)?.pass }
}

/** Copy of the reference with some nodes removed / retouched / added and some edges dropped / added. */
function mutate(opts: {
  dropNodes?: string[]
  dropEdges?: (e: DiagramEdge) => boolean
  addEdges?: DiagramEdge[]
  addNodes?: NodeSpec[]
  patch?: Record<string, Partial<DiagramNode>>
}): Diagram {
  const drop = new Set(opts.dropNodes ?? [])
  const added = diagram(opts.addNodes ?? [], []).nodes
  const nodes = [...ref.diagram.nodes.filter((n) => !drop.has(n.id)).map((n) => ({ ...n, ...(opts.patch?.[n.id] ?? {}) })), ...added]
  const edges = ref.diagram.edges
    .filter((e) => !drop.has(e.source) && !drop.has(e.target))
    .filter((e) => !(opts.dropEdges?.(e) ?? false))
  return { nodes, edges: [...edges, ...(opts.addEdges ?? [])] }
}

const failing = (d: Diagram, decisions: Decisions = ref.decisions) =>
  evaluateScenario(labResults, d, decisions)
    .results.filter((r) => !r.pass)
    .map((r) => r.id)
    .sort()

const failingCore = (d: Diagram, decisions: Decisions = ref.decisions) =>
  evaluateScenario(labResults, d, decisions)
    .results.filter((r) => (r.category === 'core' || r.category === 'antipattern') && !r.pass)
    .map((r) => `${r.id}: ${r.detail ?? ''}`)

const isEdge = (source: string, target: string) => (e: DiagramEdge) => e.source === source && e.target === target
const anyOf =
  (...preds: ((e: DiagramEdge) => boolean)[]) =>
  (e: DiagramEdge) =>
    preds.some((p) => p(e))

const edge = (source: string, target: string, protocol: DiagramEdge['protocol'], label?: string): DiagramEdge => ({
  id: `x-${source}-${target}-${protocol}`,
  source,
  target,
  protocol,
  label,
})

describe('labnet-results', () => {
  assertScenarioContract(labResults)

  it('reference stays within the intermediate size budget', () => {
    expect(ref.diagram.nodes.length).toBeGreaterThanOrEqual(14)
    expect(ref.diagram.nodes.length).toBeLessThanOrEqual(26)
  })

  it('starter (today’s Result Router) fails the teaching checks', () => {
    const { ev, pass } = results(labResults.starter!, labResults.starterDecisions!)
    for (const id of ['style-fit', 'results-published', 'stat-ambulance-lane', 'workflow-event-repair', 'guaranteed-delivery', 'hospital-fan-out', 'anti-sync-delivery', 'anti-dead-end-errors'])
      expect(pass(id), id).toBe(false)
    expect(ev.passed).toBe(false)
  })

  // --- Event flow -----------------------------------------------------------------

  it('mistake: ingestion calls the delivery consumers synchronously', () => {
    const d = mutate({ addEdges: [edge('ingest', 'routeWorkers', 'http', 'deliver now')] })
    expect(results(d).pass('results-published')).toBe(false)
  })

  it('mistake: ingestion calls a hospital synchronously as a "fast path" for STAT', () => {
    const d = mutate({ addEdges: [edge('ingest', 'hospFhir', 'http', 'STAT fast path')] })
    const { ev, pass } = results(d)
    expect(pass('anti-sync-delivery')).toBe(false)
    expect(pass('hospital-fan-out')).toBe(true)
    expect(ev.score).toBeLessThan(100)
  })

  it('mistake: one hospital is fed by ingestion directly instead of a broker consumer', () => {
    const d = mutate({
      dropEdges: (e) => e.target === 'hospMllp',
      addEdges: [edge('ingest', 'hospMllp', 'http', 'MLLP')],
    })
    const { ev, pass } = results(d)
    expect(pass('hospital-fan-out')).toBe(false)
    expect(pass('anti-sync-delivery')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('mistake: only one hospital endpoint drawn', () => {
    expect(results(mutate({ dropNodes: ['hospMllp'] })).pass('hospital-fan-out')).toBe(false)
  })

  // --- Ambulance pattern ----------------------------------------------------------

  it('mistake: STAT and routine results share one channel', () => {
    const d = mutate({ dropNodes: ['statTopic'], addEdges: [edge('routineTopic', 'statWorkers', 'event')] })
    const { ev, result } = results(d)
    expect(result('stat-ambulance-lane')?.pass).toBe(false)
    expect(result('stat-ambulance-lane')?.detail).toMatch(/one channel/)
    expect(ev.passed).toBe(false)
  })

  it('mistake: a separate STAT topic drained by the same Routine Delivery consumers', () => {
    const d = mutate({ dropNodes: ['statWorkers'], addEdges: [edge('statTopic', 'routeWorkers', 'event')] })
    const { ev, result } = results(d)
    expect(result('stat-ambulance-lane')?.pass).toBe(false)
    expect(result('stat-ambulance-lane')?.detail).toMatch(/same consumers/)
    expect(ev.passed).toBe(false)
  })

  it('mistake: STAT results are triaged only after the routine queue', () => {
    const d = mutate({
      dropEdges: isEdge('cdc', 'statTopic'),
      addEdges: [edge('routeWorkers', 'statTopic', 'event', 'escalate STAT')],
    })
    const { ev, result } = results(d)
    expect(result('stat-ambulance-lane')?.pass).toBe(false)
    expect(result('stat-ambulance-lane')?.detail).toMatch(/filled by a consumer of the routine channel/)
    expect(ev.passed).toBe(false)
  })

  it('mistake: two channels, but none of them is the STAT one', () => {
    const d = mutate({
      patch: {
        statTopic: { label: 'results.hospitals', notes: undefined },
        statWorkers: { label: 'Hospital Delivery B', notes: undefined },
      },
    })
    expect(results(d).result('stat-ambulance-lane')?.detail).toMatch(/none is marked/)
  })

  it('mistake: the STAT consumer delivers nowhere', () => {
    const d = mutate({ dropEdges: (e) => e.source === 'statWorkers' && ['hospFhir', 'hospMllp', 'pager'].includes(e.target) })
    expect(results(d).pass('stat-ambulance-lane')).toBe(false)
    expect(results(d).result('stat-ambulance-lane')?.detail).toMatch(/never reach a hospital/)
  })

  it('mistake: STAT Delivery only parks everything on the retry channel, so Routine Delivery does the work', () => {
    const d = mutate({ dropEdges: (e) => e.source === 'statWorkers' && ['hospFhir', 'hospMllp', 'pager'].includes(e.target) })
    expect(d.edges.some(isEdge('statWorkers', 'retryTopic'))).toBe(true)
    expect(results(d).result('stat-ambulance-lane')?.detail).toMatch(/never reach a hospital/)
  })

  it('alternative: STAT Delivery hands off to its own per-hospital adapter queue', () => {
    const d = mutate({
      dropEdges: (e) => e.source === 'statWorkers' && ['hospFhir', 'hospMllp', 'pager'].includes(e.target),
      addNodes: [
        ['statOut', 'broker', 'stat.outbound (per hospital)', 1400, -360, { tech: 'kafka' }],
        ['statAdapter', 'worker', 'STAT HIS Adapter', 1680, -360, { tech: 'spring-boot', domains: ['routing'] }],
      ],
      addEdges: [edge('statWorkers', 'statOut', 'event'), edge('statOut', 'statAdapter', 'event'), edge('statAdapter', 'hospFhir', 'http'), edge('statAdapter', 'hospMllp', 'http', 'MLLP')],
    })
    expect(results(d).pass('stat-ambulance-lane')).toBe(true)
  })

  it('a shared audit subscriber on both channels is not a shared delivery consumer', () => {
    expect(results(mutate({})).pass('stat-ambulance-lane')).toBe(true)
  })

  // --- Workflow event pattern ------------------------------------------------------

  it('mistake: malformed messages are logged and dropped (today’s behaviour)', () => {
    const d = mutate({
      dropNodes: ['workflowTopic'],
      addNodes: [['logs', 'logging', 'Logs', 560, 360, { tech: 'loki' }]],
      addEdges: [edge('routeWorkers', 'logs', 'telemetry', 'malformed → log & drop')],
    })
    const { ev, pass } = results(d)
    expect(pass('workflow-event-repair')).toBe(false)
    expect(pass('anti-dead-end-errors')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('mistake: an error topic nobody works on', () => {
    const d = mutate({ dropEdges: (e) => e.source === 'workflowTopic' })
    const { result } = results(d)
    expect(result('workflow-event-repair')?.pass).toBe(false)
    expect(result('anti-dead-end-errors')?.detail).toMatch(/dead end/)
  })

  it('mistake: the error topic is consumed by delivery again (a poison-message loop)', () => {
    const d = mutate({ addEdges: [edge('workflowTopic', 'routeWorkers', 'event', 'retry')] })
    const { result } = results(d)
    expect(result('workflow-event-repair')?.pass).toBe(false)
    expect(result('anti-dead-end-errors')?.detail).toMatch(/loops forever/)
  })

  it('mistake: repair cases are stored but never resubmitted', () => {
    const d = mutate({ dropEdges: anyOf(isEdge('repairSvc', 'routineTopic'), isEdge('repairSvc', 'statTopic')) })
    const { result } = results(d)
    expect(result('workflow-event-repair')?.detail).toMatch(/never resubmits/)
    expect(result('anti-dead-end-errors')?.pass).toBe(false)
  })

  it('mistake: only ingestion reports bad messages, delivery consumers cannot', () => {
    const d = mutate({ dropEdges: anyOf(isEdge('routeWorkers', 'workflowTopic'), isEdge('statWorkers', 'workflowTopic')) })
    expect(results(d).result('workflow-event-repair')?.detail).toMatch(/Only ingestion/)
  })

  it('mistake: no repair console for lab staff', () => {
    const d = mutate({ dropNodes: ['repairUi'] })
    expect(results(d).result('workflow-event-repair')?.detail).toMatch(/console/)
  })

  it('alternative: the repair service resubmits through the ingestion API', () => {
    const d = mutate({
      dropEdges: anyOf(isEdge('repairSvc', 'routineTopic'), isEdge('repairSvc', 'statTopic')),
      addEdges: [edge('repairSvc', 'ingest', 'http', 'resubmit corrected HL7')],
    })
    expect(failingCore(d)).toEqual([])
  })

  // --- Guaranteed delivery ---------------------------------------------------------

  it('mistake: Redis pub/sub for routine results', () => {
    const d = mutate({ patch: { routineTopic: { tech: 'redis' } } })
    const { ev, result } = results(d)
    expect(result('guaranteed-delivery')?.pass).toBe(false)
    expect(result('guaranteed-delivery')?.detail).toMatch(/results.routine/)
    expect(ev.passed).toBe(false)
  })

  it('mistake: the workflow channel itself is not durable', () => {
    const d = mutate({ patch: { workflowTopic: { tech: 'redis' } } })
    expect(results(d).pass('guaranteed-delivery')).toBe(false)
  })

  it('mistake: ingestion publishes straight from memory, with no store', () => {
    const d = mutate({
      dropNodes: ['ingestDb', 'cdc'],
      addEdges: [
        edge('ingest', 'statTopic', 'event'),
        edge('ingest', 'routineTopic', 'event'),
        edge('ingest', 'workflowTopic', 'event'),
      ],
    })
    const { ev, result } = results(d)
    expect(result('guaranteed-delivery')?.detail).toMatch(/Store it first/)
    expect(result('outbox-publish')?.pass).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('alternative: RabbitMQ quorum queues fed by a polling outbox worker pass every core check', () => {
    const d = mutate({
      dropNodes: ['cdc'],
      patch: { statTopic: { tech: 'rabbitmq' }, routineTopic: { tech: 'rabbitmq' }, workflowTopic: { tech: 'rabbitmq' } },
      addNodes: [['poller', 'worker', 'Outbox Poller', 560, 240, { tech: 'spring-boot' }]],
      addEdges: [
        edge('poller', 'ingestDb', 'data', 'poll outbox'),
        edge('poller', 'statTopic', 'event'),
        edge('poller', 'routineTopic', 'event'),
        edge('poller', 'workflowTopic', 'event'),
      ],
    })
    expect(failingCore(d)).toEqual([])
    expect(results(d).pass('outbox-publish')).toBe(true)
  })

  it('alternative: an untyped broker described as durable passes, an untyped plain one does not', () => {
    const ok = mutate({ patch: { routineTopic: { tech: undefined, notes: 'Durable, replicated queue' } } })
    expect(results(ok).pass('guaranteed-delivery')).toBe(true)
    const bad = mutate({ patch: { routineTopic: { tech: undefined, notes: undefined } } })
    expect(results(bad).result('guaranteed-delivery')?.detail).toMatch(/Pick a durable broker/)
  })

  it('alternative: a fully different design (Service Bus, adapters behind per-hospital queues) passes', () => {
    const d = diagram(
      [
        ['lis', 'external', 'Lab LIS', 0, 0, { tech: 'generic-api' }],
        ['console', 'web-app', 'Lab Repair UI', 0, 240, { tech: 'angular' }],
        ['app', 'mobile-app', 'LabNet App', 0, 360, { tech: 'react-native' }],
        ['bff', 'bff', 'Staff & Patient BFF', 280, 300, { tech: 'nestjs' }],
        ['intake', 'service', 'Intake', 280, 0, { tech: 'dotnet', domains: ['ingestion'] }],
        ['inbox', 'relational-db', 'Intake DB', 560, -120, { tech: 'sqlserver' }],
        ['relay', 'cdc', 'Outbox Poller', 560, 0, { tech: 'outbox-poller' }],
        ['urgent', 'broker', 'urgent-results', 840, -120, { tech: 'azure-service-bus' }],
        ['normal', 'broker', 'results', 840, 0, { tech: 'azure-service-bus' }],
        ['errors', 'broker', 'invalid-results', 840, 120, { tech: 'azure-service-bus' }],
        ['urgentSvc', 'service', 'Urgent Router', 1120, -120, { tech: 'dotnet', domains: ['routing'] }],
        ['router', 'service', 'Result Router', 1120, 0, { tech: 'dotnet', domains: ['routing'], notes: 'KEDA scales 1-20 replicas' }],
        ['fixer', 'service', 'Repair', 1120, 120, { tech: 'dotnet', domains: ['repair'] }],
        ['notify', 'service', 'Patient Push', 1120, 240, { tech: 'dotnet', domains: ['patient-notify'] }],
        ['auditor', 'service', 'Audit', 1120, 360, { tech: 'dotnet', domains: ['audit'] }],
        ['h1', 'external', 'Szpital A (FHIR)', 1400, -120, { tech: 'generic-api' }],
        ['h2', 'external', 'Szpital B (MLLP)', 1400, 0, { tech: 'generic-api' }],
        ['h3', 'external', 'GP practices (FHIR)', 1400, 120, { tech: 'generic-api' }],
        ['fixDb', 'relational-db', 'Repair DB', 1400, 240, { tech: 'sqlserver' }],
        ['push', 'external', 'Push', 1400, 360, { tech: 'onesignal' }],
        ['worm', 'object-storage', 'Audit WORM', 1400, 480, { tech: 'azure-blob' }],
      ],
      [
        ['lis', 'intake', 'http'],
        ['intake', 'inbox'],
        ['inbox', 'relay', 'event'],
        ['relay', 'urgent', 'event'],
        ['relay', 'normal', 'event'],
        ['urgent', 'urgentSvc', 'event'],
        ['normal', 'router', 'event'],
        ['urgentSvc', 'h1', 'http'],
        ['urgentSvc', 'h2', 'http'],
        ['router', 'h1', 'http'],
        ['router', 'h2', 'http'],
        ['router', 'h3', 'http'],
        ['router', 'errors', 'event'],
        ['urgentSvc', 'errors', 'event'],
        ['errors', 'fixer', 'event'],
        ['fixer', 'fixDb'],
        ['console', 'bff', 'http'],
        ['bff', 'fixer', 'http'],
        ['fixer', 'normal', 'event', 'resubmit'],
        ['normal', 'notify', 'event'],
        ['notify', 'push', 'http'],
        ['app', 'bff', 'http'],
        ['bff', 'notify', 'http'],
        ['normal', 'auditor', 'event'],
        ['auditor', 'worm'],
      ],
    )
    const { ev } = results(d, { style: 'event-driven', communication: 'async', data: 'per-service', stack: { backend: 'dotnet' } })
    const failedCore = ev.results.filter((r) => (r.category === 'core' || r.category === 'antipattern') && !r.pass).map((r) => `${r.id}: ${r.detail ?? ''}`)
    expect(failedCore, failedCore.join('\n')).toEqual([])
    expect(ev.passed).toBe(true)
  })

  // --- Bonus checks ----------------------------------------------------------------

  it('bonus: ingestion writes the DB and publishes directly (dual write) loses only the outbox bonus', () => {
    const d = mutate({
      dropNodes: ['cdc'],
      addEdges: [edge('ingest', 'statTopic', 'event'), edge('ingest', 'routineTopic', 'event'), edge('ingest', 'workflowTopic', 'event')],
    })
    expect(failing(d)).toEqual(['outbox-publish'])
  })

  it('bonus: routine delivery retries an unreachable hospital in place (no retry channel)', () => {
    const d = mutate({ dropNodes: ['retryTopic'] })
    expect(failing(d)).toEqual(['unreachable-hospital-parked'])
    expect(results(d).result('unreachable-hospital-parked')?.detail).toMatch(/blocks the partition/)
  })

  it('bonus: a retry channel that nobody drains does not count', () => {
    const d = mutate({ dropEdges: isEdge('retryTopic', 'routeWorkers') })
    expect(failing(d)).toEqual(['unreachable-hospital-parked'])
    expect(results(d).result('unreachable-hospital-parked')?.detail).toMatch(/never retried/)
  })

  it('mistake: the retry channel is not durable (Redis pub/sub or MQTT)', () => {
    for (const tech of ['redis', 'mosquitto']) {
      const d = mutate({ patch: { retryTopic: { tech } } })
      expect(failing(d), tech).toEqual(['unreachable-hospital-parked'])
      expect(results(d).result('unreachable-hospital-parked')?.detail, tech).toMatch(/does not keep parked/)
    }
  })

  it('mistake: an untyped retry channel asks for a durable technology; one described as durable passes', () => {
    const bad = mutate({ patch: { retryTopic: { tech: undefined } } })
    expect(failing(bad)).toEqual(['unreachable-hospital-parked'])
    expect(results(bad).result('unreachable-hospital-parked')?.detail).toMatch(/Pick a durable broker/)
    const ok = mutate({ patch: { retryTopic: { tech: undefined, notes: 'Durable, replicated, backoff per endpoint' } } })
    expect(failing(ok)).toEqual([])
  })

  it('mistake: a durable retry channel nobody drains is still never retried', () => {
    const d = mutate({ dropEdges: isEdge('retryTopic', 'routeWorkers'), patch: { retryTopic: { tech: 'rabbitmq' } } })
    expect(failing(d)).toEqual(['unreachable-hospital-parked'])
    expect(results(d).result('unreachable-hospital-parked')?.detail).toMatch(/never retried/)
  })

  it('alternative: retry-topic notes that mention the final DLT do not make it a poison channel', () => {
    const d = mutate({ patch: { retryTopic: { notes: 'Spring retry topics: 5 attempts with backoff, then DLT to workflow' } } })
    expect(failing(d)).toEqual([])
  })

  it('alternative: a separate Retry Worker owning Routing & delivery drains the retry channel', () => {
    const d = mutate({
      dropEdges: isEdge('retryTopic', 'routeWorkers'),
      addNodes: [['retryWorker', 'worker', 'Retry Worker', 1400, 600, { tech: 'spring-boot', domains: ['routing'] }]],
      addEdges: [edge('retryTopic', 'retryWorker', 'event', 'backoff per hospital'), edge('retryWorker', 'hospFhir', 'http'), edge('retryWorker', 'hospMllp', 'http', 'MLLP')],
    })
    expect(results(d).pass('unreachable-hospital-parked')).toBe(true)
    expect(failingCore(d)).toEqual([])
  })

  it('STAT Delivery parks an unreachable hospital too instead of blocking the fixed STAT pool', () => {
    expect(ref.diagram.edges.some((e) => e.source === 'statWorkers' && e.target === 'retryTopic' && e.protocol === 'event')).toBe(true)
    expect(results(ref.diagram).ev.score).toBe(100)
  })

  it('bonus: a per-hospital parking lot drained by delivery is not a poison-message loop', () => {
    const d = mutate({ patch: { retryTopic: { label: 'results.parking (per hospital)', notes: undefined } } })
    expect(failing(d)).toEqual([])
  })

  it('bonus: the workflow topic is not a retry channel', () => {
    const d = mutate({ dropNodes: ['retryTopic'], addEdges: [edge('workflowTopic', 'routeWorkers', 'event', 'retry')] })
    expect(results(d).pass('unreachable-hospital-parked')).toBe(false)
    expect(results(d).pass('anti-dead-end-errors')).toBe(false)
  })

  it('a routine channel labelled "non-critical" is not mistaken for the STAT lane', () => {
    const d = mutate({ patch: { routineTopic: { label: 'results.routine (non-critical)' } } })
    expect(failing(d)).toEqual([])
  })

  it('routine channels labelled "non-urgent", "noncritical" or "low priority" are not mistaken for the STAT lane', () => {
    for (const label of ['results.routine (non-urgent)', 'results.routine (noncritical)', 'results.routine (non critical)', 'results.routine (low priority)', 'results.routine (normal priority)']) {
      const d = mutate({ patch: { routineTopic: { label } } })
      expect(failing(d), label).toEqual([])
    }
  })

  it('alternative: a STAT lane named "urgent", "critical" or "high priority" is still recognised', () => {
    for (const label of ['results.urgent', 'results.critical', 'results.high-priority', 'results.priority']) {
      const d = mutate({ patch: { statTopic: { label, notes: undefined }, statWorkers: { label: 'Fast Delivery', notes: undefined } } })
      expect(results(d).pass('stat-ambulance-lane'), label).toBe(true)
    }
  })

  it('STAT results also reach Patient Notifications', () => {
    expect(ref.diagram.edges.some((e) => e.source === 'statTopic' && e.target === 'patientNotify')).toBe(true)
  })

  it('bonus: no delivery ledger', () => {
    expect(failing(mutate({ dropNodes: ['deliveryDb'] }))).toEqual(['acknowledged-delivery'])
  })

  it('bonus: routine consumers without a scaling rule', () => {
    expect(failing(mutate({ patch: { routeWorkers: { notes: undefined } } }))).toEqual(['elastic-consumers'])
  })

  it('bonus: a scaling rule nobody feeds with backlog metrics', () => {
    const d = mutate({ dropEdges: anyOf(isEdge('routineTopic', 'metrics'), isEdge('routeWorkers', 'metrics')) })
    expect(failing(d)).toEqual(['elastic-consumers'])
  })

  it('bonus: no alerting on STAT delay', () => {
    expect(failing(mutate({ dropNodes: ['alerts'] }))).toEqual(['stat-channel-monitoring'])
  })

  it('bonus: patients are never pushed', () => {
    expect(failing(mutate({ dropNodes: ['push'] }))).toEqual(['patients-notified'])
  })

  it('bonus: audit log in plain object storage', () => {
    expect(failing(mutate({ patch: { auditStore: { tech: 'gcs', label: 'Audit Log' } } }))).toEqual(['audit-trail'])
  })

  it('a single-node odd graph does not throw', () => {
    const d = diagram([['x', 'broker', 'Lone topic', 0, 0]], [])
    const { ev } = results(d, { stack: {} })
    expect(ev.results.every((r) => !r.detail?.startsWith('Check failed to run'))).toBe(true)
    expect(ev.passed).toBe(false)
  })
})

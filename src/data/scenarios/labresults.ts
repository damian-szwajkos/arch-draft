import { SYNC_PROTOCOLS, type ComponentKind, type DiagramNode, type Scenario } from '../../engine/types'
import { COMPUTE_KINDS, DB_KINDS, type Graph } from '../../engine/graph'
import { diagram, EMAIL, external, PUSH } from './builder'

// ---------------------------------------------------------------------------
// Helpers shared by the checks
// ---------------------------------------------------------------------------

/** Words that mark a channel or its consumers as the urgent (STAT) lane. */
const STAT_RE = /\bstat\b|(?<!\bnon[- ]?)(?:urgent|critical)|(?<!\b(?:low|normal|standard)[- ])priority|ambulance|emergenc|\bcito\b|fast.?lane|express/i
/** Words that mark a channel as the place where failed / malformed messages go. */
const ERR_RE = /error|invalid|malformed|reject|repair|workflow|dead|\bdlq\b|\bdlt\b|poison|parking|quarantin|fail/i
/** Words that mark a channel as the per-endpoint retry / parking lane for hospitals that are unreachable. */
const RETRY_RE = /retry|parking|parked|per.?(hospital|endpoint)/i
/**
 * Words that mark a channel as the place for malformed messages, which must never go straight back to delivery.
 * Tested against the label only: retry-topic notes often say where messages go after the last attempt ("then DLT").
 */
const POISON_RE = /error|invalid|malformed|reject|repair|workflow|dead|\bdlq\b|\bdlt\b|poison|quarantin/i
/** Consumers that scale with the backlog (supervisor-consumer). */
const SCALE_RE = /keda|autoscal|\bhpa\b|supervisor|elastic|scal(e|es|ed|ing)\b|replicas|\d+\s*(→|->|–|-|to)\s*\d+\s*(pods|consumers|workers|instances|replicas)?/i
/** Broker with no technology chosen, but described as durable. */
const DURABLE_LABEL_RE = /durable|persistent|quorum|replicated|acks?\s*=\s*all/i
/** Audit store described as append-only / tamper-evident. */
const IMMUTABLE_RE = /worm|immutable|append.?only|object.?lock|tamper/i

const EDGE_KINDS: ComponentKind[] = ['cdn', 'waf', 'load-balancer', 'api-gateway', 'bff']
const OBS_KINDS: ComponentKind[] = ['otel-collector', 'logging', 'metrics', 'tracing', 'dashboards', 'alerting']
const RELAY_KINDS: ComponentKind[] = ['cdc', 'worker', 'function', 'stream-processor']
/** Durable without being a log or a queue: Google Pub/Sub keeps messages until they are acked. */
const DURABLE_TECH = ['gcp-pubsub']

const text = (n: DiagramNode) => `${n.label} ${n.notes ?? ''}`
const ids = (nodes: DiagramNode[]) => new Set(nodes.map((n) => n.id))
const labels = (nodes: DiagramNode[]) => nodes.map((n) => n.label).join(', ')

/**
 * Everything that publishes on behalf of result ingestion: the owner family plus
 * outbox relays (CDC or a polling worker without a domain) attached to its stores.
 */
function publishers(g: Graph): DiagramNode[] {
  const fam = g.ownerFamily('ingestion')
  if (!fam.length) return []
  const own = ids(g.storesOf(fam))
  const relays = g
    .ofKind(...RELAY_KINDS)
    .filter((r) => !fam.includes(r) && r.domains.length === 0)
    .filter((r) => [...g.targets(r.id, ['data']), ...g.sources(r.id)].some((s) => own.has(s.id)))
  return [...fam, ...relays]
}

/** Compute nodes consuming a broker over event edges. */
const consumersOf = (g: Graph, b: DiagramNode) => g.targets(b.id, ['event']).filter((c) => COMPUTE_KINDS.includes(c.kind))

/** A result channel; `delivery` are its consumers that own Routing & delivery (other subscribers such as audit may share channels). */
type Lane = { broker: DiagramNode; consumers: DiagramNode[]; delivery: DiagramNode[]; stat: boolean }

/** Result channels: brokers the ingestion side publishes to that are drained by delivery (routing) consumers. */
function lanes(g: Graph): Lane[] {
  const pubs = ids(publishers(g))
  const routing = ids(g.ownerFamily('routing'))
  if (!pubs.size || !routing.size) return []
  return g
    .ofKind('broker')
    .filter((b) => g.sources(b.id, ['event']).some((p) => pubs.has(p.id)))
    // An error channel that delivery consumers publish failures to is not a result channel, even if delivery also drains it.
    .filter((b) => !(ERR_RE.test(text(b)) && g.sources(b.id, ['event']).some((p) => routing.has(p.id))))
    .map((broker) => {
      const consumers = consumersOf(g, broker)
      const delivery = consumers.filter((c) => routing.has(c.id))
      const stat = STAT_RE.test(text(broker)) || (delivery.length > 0 && delivery.every((c) => STAT_RE.test(text(c))))
      return { broker, consumers, delivery, stat }
    })
    .filter((l) => l.delivery.length > 0)
}

/** The external systems that send results in (each lab's LIS), directly or through the edge. */
function sourceSystems(g: Graph): DiagramNode[] {
  const fam = ids(g.ownerFamily('ingestion'))
  return g.ofKind('external').filter((x) => !!g.reaches(x, (n) => fam.has(n.id), { through: EDGE_KINDS, maxDepth: 3 }))
}

const isNotifier = (g: Graph) => (n: DiagramNode) =>
  external(g, 'push', PUSH)(n) || external(g, 'sms', PUSH)(n) || external(g, 'email', EMAIL)(n)

/** External systems results are delivered to (hospitals, GP practices, pagers). */
function endpoints(g: Graph): DiagramNode[] {
  const sources = ids(sourceSystems(g))
  return g.ofKind('external').filter((x) => !sources.has(x.id) && g.in(x.id).some((e) => e.protocol !== 'telemetry'))
}

/** Hospital / GP integration endpoints: delivery targets that are not push / SMS / email providers. */
const hospitals = (g: Graph) => endpoints(g).filter((n) => !isNotifier(g)(n))

/** Does any of these nodes put corrected messages back into the result flow? */
function resubmits(g: Graph, nodes: DiagramNode[]): boolean {
  if (!nodes.length) return false
  const laneIds = ids(lanes(g).map((l) => l.broker))
  const ingest = g.ownerFamily('ingestion')
  const routing = g.ownerFamily('routing')
  const back = new Set([...laneIds, ...ids(ingest)])
  const direct = nodes.some((n) => g.out(n.id).some((e) => e.protocol !== 'telemetry' && back.has(e.target)))
  return direct || g.asyncFlow(nodes, [...ingest, ...routing].filter((n) => !nodes.includes(n)))
}

/**
 * Retry / parking channels: brokers the delivery owner publishes to when a hospital is unreachable and drains
 * again later, so one HIS in maintenance does not hold up the partition. Not for malformed messages.
 */
function retryChannels(g: Graph): DiagramNode[] {
  const routing = ids(g.ownerFamily('routing'))
  const laneIds = ids(lanes(g).map((l) => l.broker))
  return g
    .ofKind('broker')
    .filter((b) => !laneIds.has(b.id) && RETRY_RE.test(text(b)) && !POISON_RE.test(b.label))
    .filter((b) => g.sources(b.id, ['event']).some((p) => routing.has(p.id)))
    .filter((b) => consumersOf(g, b).some((c) => routing.has(c.id)))
}

/** Brokers fed by the result flow (ingestion or delivery) and drained by the error-repair owner. */
function workflowChannels(g: Graph): DiagramNode[] {
  const repair = ids(g.ownerFamily('repair'))
  const routing = ids(g.ownerFamily('routing'))
  const flow = new Set([...ids(publishers(g)), ...routing])
  for (const id of repair) flow.delete(id)
  const laneIds = ids(lanes(g).map((l) => l.broker))
  return g
    .ofKind('broker')
    .filter((b) => !laneIds.has(b.id))
    .filter((b) => g.sources(b.id, ['event']).some((p) => flow.has(p.id)))
    .filter((b) => {
      const cons = consumersOf(g, b)
      return cons.some((c) => repair.has(c.id)) && !cons.some((c) => routing.has(c.id) && !repair.has(c.id))
    })
}

/**
 * Like `g.reaches` through compute and brokers, but never via `avoid`: a STAT consumer that hands its
 * deliveries to the routine consumers (say, through the shared retry channel) does not deliver on its own.
 */
function reachesAvoiding(g: Graph, from: DiagramNode[], target: (n: DiagramNode) => boolean, avoid: Set<string>, maxDepth = 3): boolean {
  const through: ComponentKind[] = [...COMPUTE_KINDS, 'broker']
  const seen = new Set(from.map((n) => n.id))
  let frontier = from.map((n) => n.id)
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const next: string[] = []
    for (const id of frontier)
      for (const t of g.targets(id)) {
        if (!t || seen.has(t.id) || avoid.has(t.id)) continue
        seen.add(t.id)
        if (target(t)) return true
        if (through.includes(t.kind)) next.push(t.id)
      }
    frontier = next
  }
  return false
}

function durable(g: Graph, b: DiagramNode): boolean {
  if (!b.tech) return DURABLE_LABEL_RE.test(text(b))
  if (g.hasTrait(b, 'mqtt')) return false
  return g.hasTrait(b, 'log', 'replayable', 'queue') || DURABLE_TECH.includes(b.tech)
}

// ---------------------------------------------------------------------------
// Starter: today's Result Router loops over hospital endpoints, one by one
// ---------------------------------------------------------------------------

const starter = diagram(
  [
    ['lis', 'external', 'Lab LIS ×38 (HL7 v2 / MLLP)', 0, 100, { tech: 'generic-api' }],
    [
      'router',
      'monolith',
      'Result Router',
      300,
      90,
      {
        w: 260,
        h: 90,
        tech: 'jakarta-ee',
        domains: ['ingestion', 'routing', 'repair', 'patient-notify', 'audit'],
        notes: 'Parses HL7, then calls every destination in a loop; retries a slow hospital inline',
      },
    ],
    ['db', 'relational-db', 'Router DB', 640, 0, { tech: 'oracle' }],
    ['hospA', 'external', 'Hospital HIS (FHIR R4)', 640, 120, { tech: 'generic-api' }],
    ['hospB', 'external', 'Hospital HIS (HL7 v2 / MLLP)', 640, 240, { tech: 'generic-api' }],
    ['logs', 'logging', 'Router Logs', 300, 260, { tech: 'elk' }],
  ],
  [
    ['lis', 'router', 'http', 'ORU^R01 over MLLP'],
    ['router', 'db', 'data'],
    ['router', 'hospA', 'http', 'POST, wait, next'],
    ['router', 'hospB', 'http', 'send, wait for ACK, next'],
    ['router', 'logs', 'telemetry', 'malformed → log & drop'],
  ],
)

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

export const labResults: Scenario = {
  id: 'labnet-results',
  title: 'LabNet: no lab result left behind',
  tagline: '400,000 results a day, a critical potassium that cannot wait, and not one message allowed to vanish.',
  industry: 'HealthTech',
  difficulty: 'intermediate',
  estMinutes: 35,
  accent: '#dc2626',
  concepts: [
    'event-driven',
    'ambulance-pattern',
    'workflow-event-pattern',
    'guaranteed-delivery',
    'supervisor-consumer',
    'outbox',
    'fan-out',
    'fallacies-of-distributed-computing',
  ],
  story:
    'LabNet Pomorze runs 38 medical laboratories across northern Poland, from Gdańsk and Gdynia to Słupsk and Bydgoszcz. Every analyser result is validated in the lab’s LIS and then goes through a single Java EE "Result Router" to 140 hospitals and GP practices. The router calls each destination in turn and waits. Last February one hospital’s HIS was down for maintenance and the router kept retrying it inline. The backlog reached 3.5 hours, and a critical potassium of 7.1 mmol/l for an emergency patient sat behind 40,000 routine cholesterol panels; the ER doctor finally phoned the lab after 70 minutes. The incident review found something worse: results with a missing patient ID or an unknown test code were written to a log file and discarded, about 4,000 a month, one of them a positive blood culture. The medical director wants a design in which urgent results overtake the queue and no message can ever quietly disappear.',
  facts: [
    { label: 'Network', value: '38 labs, ~420 analysers, 140 hospital and GP endpoints (FHIR R4 APIs, HL7 v2 over MLLP)' },
    { label: 'Volume', value: '400k results/day; 60% arrive 7–10 am (~25 msg/s sustained, 90 msg/s bursts when analysers flush a run)' },
    { label: 'STAT', value: '~6% of results are urgent; critical values must reach the ordering doctor within 60 s, whatever the routine backlog' },
    { label: 'Quality', value: '~1% of messages are malformed or rejected (missing patient ID, unknown test code, HIS refuses the message)' },
    { label: 'Team', value: '4 squads, ~28 engineers, mostly Java/Kotlin' },
  ],
  functional: [
    'Receive validated results from each lab’s LIS (HL7 v2 ORU^R01 over MLLP) and acknowledge them',
    'Deliver every result to the ordering hospital or GP practice in the format its system accepts (FHIR R4 API or HL7 v2 over MLLP)',
    'Call out critical STAT values to the ordering doctor (pager / SMS) as well as to the hospital system',
    'Lab staff see malformed and rejected messages in a repair console, fix them (match the patient, map the test code) and resubmit',
    'Patients get a push notification and can read released results in the LabNet app',
    'Every receipt, delivery, failure and repair is recorded in an audit trail',
  ],
  nonFunctional: [
    'STAT results reach the ordering doctor in under 60 s (p99), independent of the routine backlog',
    'No result is ever lost: not at intake, not inside the broker, not between the broker and the hospital',
    'Absorb the 7–10 am peak by adding consumers, and give the capacity back after the peak',
    'A slow or offline hospital endpoint must never delay results for other hospitals',
    'The audit trail is tamper-evident and retained for 20 years, as medical records are',
  ],
  constraints: [
    'Each lab’s LIS speaks only HL7 v2 over MLLP and resends a message if it gets no ACK within 30 s',
    'Hospital endpoints belong to the hospitals: different protocols, maintenance windows and rate limits',
    'Health data is GDPR special-category data and stays in an EU region',
  ],
  domains: [
    { id: 'ingestion', label: 'Result ingestion', description: 'MLLP listener, HL7 parsing and validation, ACK to the LIS' },
    { id: 'routing', label: 'Routing & delivery', description: 'Who ordered the test, which endpoint and format, delivery to hospitals and GPs' },
    { id: 'repair', label: 'Error repair', description: 'Workflow processor and console where lab staff fix and resubmit bad messages' },
    { id: 'patient-notify', label: 'Patient notifications', description: 'Push notifications and released results in the patient app' },
    { id: 'audit', label: 'Audit trail', description: 'Tamper-evident record of every receipt, delivery, failure and repair' },
  ],
  recommendedStyles: ['event-driven'],
  styleFeedback: {
    'event-driven':
      'Best fit: a lab result is an event that several parties react to (the hospital, the patient app, the audit trail). A durable broker absorbs the morning peak, a separate STAT channel lets urgent results overtake the backlog, and an error channel turns "log and drop" into a repair workflow.',
    microservices:
      'Close, but request-driven microservices keep the core problem: if ingestion calls a delivery service that calls each hospital synchronously, a hospital in a maintenance window still blocks everything behind it. The capabilities are fine; the communication has to become events through a broker.',
    'service-based':
      'A few coarse services over a shared database would separate the code, but delivery would still be a database table polled in order. You would end up rebuilding priority channels, retries and consumer scaling by hand, which is what a broker gives you.',
    'modular-monolith':
      'Clean modules, but one deployable means the STAT path, the routine backlog and every slow hospital share the same threads and the same scaling. You cannot add routine consumers at 7 am without also scaling everything else.',
    monolith:
      'This is today’s Result Router: one process calling destinations in a loop. One HIS in maintenance held a critical potassium for 70 minutes, and malformed messages ended up in a log file.',
    serverless:
      'Functions could handle the bursty fan-out, but HL7 v2 over MLLP needs long-lived TCP connections to the LIS and to many hospitals, and STAT delivery cannot depend on cold starts. Long-running consumers on a durable broker are more predictable here.',
    'space-based':
      'Space-based architecture is for extreme, unpredictable concurrent load where the database is the bottleneck. 90 msg/s is not that, and an in-memory grid that writes to the database later runs against "no result may ever be lost".',
    microkernel:
      'Hospital adapters (FHIR, HL7 v2.3, v2.5…) make good plug-ins inside a delivery service, but a single core process cannot keep STAT isolated from the backlog or scale consumers for the morning peak. Use plug-ins inside the design, not as the overall style.',
  },
  starter,
  starterDecisions: {
    style: 'monolith',
    communication: 'sync',
    data: 'shared',
    stack: { backend: 'jakarta-ee', database: 'oracle' },
  },
  hints: [
    'Stop delivering inside the intake path. Ingestion should store the message, acknowledge the LIS and publish a "result received" event. Delivery to hospitals happens downstream, at whatever pace each hospital can take.',
    'An urgent result must not queue behind 40,000 routine ones. Give STAT results their own channel (draw it as its own topic or queue node) with consumers of their own, and let ingestion, the producer, decide which channel a result goes to. Triaging after the routine queue is too late.',
    'Do not log and drop. When a consumer cannot process a message (unknown patient, unmapped test code, HIS rejects it), it publishes the message to a workflow / error channel. A workflow processor keeps it as a repair case, lab staff fix it in a console, and the corrected message is resubmitted into the normal flow.',
    'Messages get lost in three places: on the way into the broker, inside the broker, and between the broker and the consumer. Store the message before you ACK the LIS (with an outbox), pick a broker that persists messages until they are acknowledged, and let consumers acknowledge only after the hospital has confirmed receipt.',
    'The morning peak is a backlog problem. Scale routine consumers on consumer lag (KEDA, an HPA on lag, or a supervisor process), but keep a fixed, always-on pool for STAT.',
    'Near-solution: LIS → Ingestion (+ outbox) → CDC → results.routine and results.stat topics → separate routine (autoscaled) and STAT consumers → hospital FHIR / MLLP endpoints and a pager; consumers → results.workflow → Repair service + console → resubmit; audit and patient notifications consume the same events.',
  ],
  checks: [
    {
      id: 'results-published',
      title: 'Results flow from ingestion to delivery as events',
      category: 'core',
      why: 'When ingestion only stores, acknowledges and publishes, a slow hospital becomes a longer queue for that hospital instead of a stalled intake. The broker evens out the 7–10 am peak, and new consumers (patient app, audit) subscribe without ingestion knowing about them.',
      hint: 'Result ingestion owner → broker (directly, or via an outbox relay) → Routing & delivery consumers. No synchronous calls from ingestion to delivery.',
      concepts: ['event-driven', 'queue-load-leveling'],
      test: (g) => {
        const ingest = g.ownerFamily('ingestion')
        const routing = g.ownerFamily('routing')
        if (!ingest.length) return { pass: false, detail: 'Nobody owns Result ingestion.' }
        if (!routing.length) return { pass: false, detail: 'Nobody owns Routing & delivery.' }
        const routingIds = ids(routing)
        const syncCalled = ingest.some((i) =>
          g.out(i.id, SYNC_PROTOCOLS).some((e) => {
            const t = g.node(e.target)
            return !!t && routingIds.has(t.id) && g.deployable(t).id !== g.deployable(i).id
          }),
        )
        if (syncCalled) return { pass: false, detail: 'Ingestion calls delivery synchronously, so every slow hospital slows down intake.' }
        if (g.asyncFlow(publishers(g), routing)) return { pass: true }
        return ingest.some((i) => routingIds.has(i.id))
          ? { pass: false, detail: 'Ingestion and delivery are the same component, with no broker between receiving a result and delivering it.' }
          : { pass: false, detail: 'No event flows from ingestion through a broker to the delivery consumers.' }
      },
    },
    {
      id: 'stat-ambulance-lane',
      title: 'STAT results travel in their own channel with their own consumers',
      category: 'core',
      why: 'In the ambulance pattern, urgent messages get a dedicated channel and dedicated consumers, so they never wait behind routine traffic, however long that queue gets. The producer picks the channel: if STAT results are triaged only after they leave the routine queue, they have already waited behind the backlog.',
      hint: 'Ingestion (or its outbox relay) publishes to two channels drawn as separate broker nodes, for example results.routine and results.stat. Give the STAT channel its own consumer, connected to the hospital endpoints and the pager.',
      concepts: ['ambulance-pattern', 'queue-load-leveling'],
      test: (g) => {
        const list = lanes(g)
        if (!list.length) return { pass: false, detail: 'Results do not reach the delivery consumers through a broker yet.' }
        const fedFromBacklog = g
          .ofKind('broker')
          .filter((b) => STAT_RE.test(text(b)) && !list.some((l) => l.broker.id === b.id))
          .filter((b) => g.sources(b.id, ['event']).some((p) => list.some((l) => l.delivery.includes(p))))
        if (list.length < 2) {
          return fedFromBacklog.length
            ? {
                pass: false,
                detail: `${labels(fedFromBacklog)} is filled by a consumer of the routine channel, so STAT results still queue behind the backlog before they are triaged. Let ingestion publish them straight to the STAT channel.`,
              }
            : { pass: false, detail: 'Every result shares one channel, so a critical potassium waits behind the whole morning backlog. Draw the STAT channel as its own topic or queue node.' }
        }
        const stat = list.filter((l) => l.stat)
        const routine = list.filter((l) => !l.stat)
        if (!stat.length) return { pass: false, detail: 'There are several result channels, but none is marked as the STAT / urgent one (name the topic or its consumer).' }
        if (!routine.length) return { pass: false, detail: 'Every channel is marked as urgent. If everything is priority, nothing is.' }
        const routineConsumers = ids(routine.flatMap((l) => l.delivery))
        const dedicated = stat.filter((l) => !l.delivery.some((c) => routineConsumers.has(c.id)))
        if (!dedicated.length) {
          const shared = [...new Map(stat.flatMap((l) => l.delivery).filter((c) => routineConsumers.has(c.id)).map((c) => [c.id, c])).values()]
          return {
            pass: false,
            detail: `STAT and routine results are drained by the same consumers (${labels(shared)}). While they work through the backlog, STAT still waits.`,
          }
        }
        const targets = ids(endpoints(g))
        const delivers = dedicated.some((l) => reachesAvoiding(g, l.delivery, (n) => targets.has(n.id), routineConsumers))
        return delivers
          ? { pass: true }
          : { pass: false, detail: 'The STAT consumers never reach a hospital endpoint or the doctor’s pager.' }
      },
    },
    {
      id: 'workflow-event-repair',
      title: 'Bad messages go to a repair workflow and are resubmitted',
      category: 'core',
      why: 'In the workflow event pattern, a consumer that cannot process a message does not drop it or retry it forever. It publishes the message to a workflow channel. A workflow processor keeps it as a case, people fix the data in a console, and the corrected message goes back into the normal flow. Every malformed result still reaches a doctor, just later.',
      hint: 'Delivery consumers → an error / workflow topic → a Repair service (owning Error repair) with its own store, a console for lab staff (web app → gateway → Repair), and an Event edge back to the result channel or to ingestion.',
      concepts: ['workflow-event-pattern', 'dead-letter-queue'],
      test: (g) => {
        const repair = g.ownerFamily('repair')
        if (!repair.length) return { pass: false, detail: 'Nobody owns Error repair.' }
        const channels = workflowChannels(g)
        if (!channels.length)
          return { pass: false, detail: 'No channel carries failed or malformed results to the repair owner, so they are dropped or retried forever.' }
        const routing = ids(g.ownerFamily('routing'))
        const fromConsumers = channels.some((c) => g.sources(c.id, ['event']).some((s) => routing.has(s.id) && !repair.includes(s)))
        if (!fromConsumers)
          return {
            pass: false,
            detail: 'Only ingestion reports bad messages. A delivery consumer that hits an unknown test code or a rejecting HIS has nowhere to send the message.',
          }
        const repairIds = ids(repair)
        const consoleUi = g.ofKind('web-app').some((w) => !!g.reaches(w, (n) => repairIds.has(n.id), { through: EDGE_KINDS, protocols: SYNC_PROTOCOLS, maxDepth: 4 }))
        if (!consoleUi) return { pass: false, detail: 'Lab staff have no console to inspect and fix the messages (web app → repair owner).' }
        return resubmits(g, repair)
          ? { pass: true }
          : { pass: false, detail: 'The repair side never resubmits corrected messages, so a fixed result still never reaches the doctor.' }
      },
    },
    {
      id: 'guaranteed-delivery',
      title: 'No result can be lost on the way',
      category: 'core',
      why: 'A message can disappear in three places: before it reaches the broker, inside the broker, and between the broker and the consumer. Ingestion stores each message durably before it ACKs the LIS. The broker keeps messages on disk, replicated, until they are acknowledged. Consumers acknowledge only after the hospital has confirmed receipt.',
      hint: 'Give ingestion its own database (inbound messages + outbox), and use a durable broker (Kafka, Redpanda, RabbitMQ quorum queues, Service Bus…) for the result and workflow channels. Redis pub/sub and MQTT are not durable queues.',
      concepts: ['guaranteed-delivery', 'outbox'],
      test: (g) => {
        const list = lanes(g)
        if (!list.length) return { pass: false, detail: 'Results do not reach the delivery consumers through a broker yet.' }
        const channels = [...list.map((l) => l.broker), ...workflowChannels(g)]
        const untyped = channels.filter((b) => !b.tech && !durable(g, b))
        if (untyped.length) return { pass: false, detail: `Pick a durable broker technology for ${labels(untyped)}.` }
        const volatile = channels.filter((b) => !durable(g, b))
        if (volatile.length) return { pass: false, detail: `${labels(volatile)} does not keep messages until a consumer acknowledges them.` }
        const ingest = g.ownerFamily('ingestion')
        return g.storesOf(ingest, [...DB_KINDS, 'object-storage']).length
          ? { pass: true }
          : {
              pass: false,
              detail: 'Ingestion keeps the message only in memory between the ACK to the LIS and the broker. A crash in that window loses a result. Store it first, then ACK.',
            }
      },
    },
    {
      id: 'hospital-fan-out',
      title: 'Every hospital endpoint is fed by a broker consumer',
      category: 'core',
      why: 'Hospitals have different protocols, maintenance windows and rate limits. When each delivery comes from a consumer reading the broker, no hospital is called from the intake path. Inside a partition, though, a consumer that waits for one HIS still blocks every result behind it, so a delivery that fails because the endpoint is unreachable is parked on a per-hospital retry channel and the partition keeps flowing.',
      hint: 'Draw at least two hospital endpoints (for example one FHIR R4 API and one HL7 v2 / MLLP interface) and connect them from the delivery consumers, not from ingestion.',
      concepts: ['fan-out', 'fallacies-of-distributed-computing'],
      test: (g) => {
        const list = hospitals(g)
        if (list.length < 2)
          return { pass: false, detail: 'Draw the hospital integration endpoints (at least two, e.g. a FHIR R4 API and an HL7 v2 / MLLP interface).' }
        const consumers = lanes(g).flatMap((l) => l.delivery)
        if (!consumers.length) return { pass: false, detail: 'No broker consumer delivers results yet.' }
        const unfed = list.filter((h) => !g.reaches(consumers, (n) => n.id === h.id, { through: [...COMPUTE_KINDS, 'broker'], maxDepth: 3 }))
        return unfed.length ? { pass: false, detail: `${labels(unfed)} never gets results from a broker consumer.` } : { pass: true }
      },
    },
    {
      id: 'outbox-publish',
      title: 'Ingestion publishes through a transactional outbox',
      category: 'bonus',
      why: 'Writing the message to the database and then publishing it to the broker are two separate steps, and a crash between them loses or duplicates the event. With an outbox, the message and its event are committed in one transaction, and a relay (CDC or a poller) publishes it reliably. The LIS gets its ACK only after that commit.',
      hint: 'Ingestion → its database (with an outbox table) → Outbox relay / CDC (Debezium) → the result channels.',
      concepts: ['outbox', 'guaranteed-delivery'],
      test: (g) => {
        const fam = g.ownerFamily('ingestion')
        if (!fam.length) return { pass: false, detail: 'Nobody owns Result ingestion.' }
        const relays = publishers(g).filter((p) => !fam.includes(p))
        const laneIds = ids(lanes(g).map((l) => l.broker))
        if (!laneIds.size) return { pass: false, detail: 'No outbox relay publishes results to a broker yet.' }
        return relays.some((r) => g.targets(r.id, ['event']).some((t) => laneIds.has(t.id)))
          ? { pass: true }
          : { pass: false, detail: 'Ingestion writes the message and publishes the event in two separate steps (a dual write).' }
      },
    },
    {
      id: 'unreachable-hospital-parked',
      title: 'An unreachable hospital is parked, not retried in the partition',
      category: 'bonus',
      why: 'A Kafka consumer commits offsets in order. If it keeps retrying a hospital in its maintenance window, every result behind it in that partition waits too, which is the original incident at partition scale. Deliveries that fail because the endpoint is down go to a per-hospital retry channel (for example Spring Kafka non-blocking retry topics) behind a circuit breaker, and the consumer moves on to the next result.',
      hint: 'Routine Delivery → a durable broker such as "results.retry (per hospital)" on Kafka → drained again by the delivery consumers with backoff (give a separate retry worker the Routing & delivery domain). Keep it separate from the workflow channel: an offline HIS is not a malformed message.',
      concepts: ['circuit-breaker', 'fallacies-of-distributed-computing', 'dead-letter-queue'],
      test: (g) => {
        const routine = lanes(g).filter((l) => !l.stat)
        if (!routine.length) return { pass: false, detail: 'No routine result channel yet.' }
        const consumers = ids(routine.flatMap((l) => l.delivery))
        const parked = retryChannels(g).filter((b) => g.sources(b.id, ['event']).some((p) => consumers.has(p.id)))
        if (parked.some((b) => durable(g, b))) return { pass: true }
        if (parked.length) {
          const untyped = parked.filter((b) => !b.tech)
          return untyped.length
            ? { pass: false, detail: `Pick a durable broker technology for ${labels(untyped)}; parked results have to survive until the hospital is back.` }
            : {
                pass: false,
                detail: `${labels(parked)} does not keep parked results until they are retried; a hospital's maintenance window outlasts an in-memory channel.`,
              }
        }
        const undrained = g
          .ofKind('broker')
          .filter((b) => RETRY_RE.test(text(b)) && !POISON_RE.test(b.label))
          .filter((b) => g.sources(b.id, ['event']).some((p) => consumers.has(p.id)))
        return undrained.length
          ? { pass: false, detail: `Nothing on the delivery side drains ${labels(undrained)}, so parked results are never retried.` }
          : {
              pass: false,
              detail: 'Routine delivery has nowhere to park a result for an unreachable hospital, so it retries in place and blocks the partition behind it.',
            }
      },
    },
    {
      id: 'acknowledged-delivery',
      title: 'Delivery consumers record each hand-off before acknowledging',
      category: 'bonus',
      why: 'A consumer should commit its offset or ACK only after the hospital has confirmed receipt and the delivery is recorded. If it crashes earlier, the broker redelivers the message, and the delivery ledger lets the consumer recognise and skip a duplicate (an idempotent consumer).',
      hint: 'Connect the Routing & delivery consumers to a database that records deliveries (result id, endpoint, hospital ACK).',
      concepts: ['guaranteed-delivery', 'idempotency'],
      test: (g) => {
        const routing = g.ownerFamily('routing')
        if (!routing.length) return { pass: false, detail: 'Nobody owns Routing & delivery.' }
        return g.storesOf(routing, DB_KINDS).length
          ? { pass: true }
          : { pass: false, detail: 'Delivery keeps no record of what each hospital has confirmed, so redeliveries cannot be de-duplicated.' }
      },
    },
    {
      id: 'elastic-consumers',
      title: 'Routine consumers scale with the backlog',
      category: 'bonus',
      why: 'In the supervisor-consumer pattern, something watches the queue depth and adds consumers when the backlog grows, then removes them when it drains. That turns the 7–10 am peak into a few extra pods for three hours instead of capacity provisioned all day. STAT keeps a fixed, always-on pool.',
      hint: 'Note the scaling rule on the routine consumer (e.g. "KEDA: 2→24 pods on consumer lag") and export the channel’s lag to Metrics with a Telemetry edge.',
      concepts: ['supervisor-consumer', 'queue-load-leveling'],
      test: (g) => {
        const routine = lanes(g).filter((l) => !l.stat)
        if (!routine.length) return { pass: false, detail: 'No routine result channel yet.' }
        const scaled = routine.filter((l) => l.delivery.some((c) => SCALE_RE.test(text(c))))
        if (!scaled.length) return { pass: false, detail: 'Nothing says how routine consumers grow and shrink with the morning backlog.' }
        const observed = scaled.some(
          (l) =>
            g.targets(l.broker.id, ['telemetry']).some((t) => OBS_KINDS.includes(t.kind)) ||
            l.delivery.some((c) => g.targets(c.id, ['telemetry']).some((t) => OBS_KINDS.includes(t.kind))),
        )
        return observed ? { pass: true } : { pass: false, detail: 'Nobody measures the backlog the scaling rule is supposed to react to.' }
      },
    },
    {
      id: 'stat-channel-monitoring',
      title: 'STAT delivery is measured and alerts on delay',
      category: 'bonus',
      why: 'The 60-second promise needs proof. Monitoring the channel means tracking STAT queue depth and the age of the oldest undelivered STAT result, and paging the lab’s on-call before the doctor has to phone in.',
      hint: 'Add Metrics and Alerting, and send telemetry from the STAT consumers.',
      concepts: ['observability', 'slo'],
      test: (g) => {
        if (!g.has('metrics') || !g.has('alerting')) return { pass: false, detail: 'Missing Metrics or Alerting.' }
        const stat = ids(lanes(g).filter((l) => l.stat).flatMap((l) => l.delivery))
        if (!stat.size) return { pass: false, detail: 'No STAT channel consumers to measure yet.' }
        return g.instrumented().some((n) => stat.has(n.id)) ? { pass: true } : { pass: false, detail: 'The STAT consumers export no telemetry.' }
      },
    },
    {
      id: 'patients-notified',
      title: 'Patients are notified from the same events',
      category: 'bonus',
      why: 'The patient app is one more subscriber to the same events, so ingestion does not change when it is added. Notifications can follow their own rules, for example holding back a critical value until the doctor has seen it.',
      hint: 'Result events → Patient notifications owner → push provider (FCM / APNs).',
      concepts: ['fan-out', 'event-driven'],
      test: (g) => {
        const notify = g.ownerFamily('patient-notify')
        if (!notify.length) return { pass: false, detail: 'Nobody owns Patient notifications.' }
        if (!g.calls(notify, external(g, 'push', PUSH))) return { pass: false, detail: 'Patient notifications is not connected to a push provider.' }
        return g.asyncFlow([...publishers(g), ...g.ownerFamily('routing')], notify)
          ? { pass: true }
          : { pass: false, detail: 'Patient notifications are not driven by result events.' }
      },
    },
    {
      id: 'audit-trail',
      title: 'An append-only audit trail is built from events',
      category: 'bonus',
      why: 'If the audit service subscribes to the result channels, the record of what was received, delivered, failed and repaired does not depend on every component remembering to log it. Kept in write-once storage, it is evidence that holds up for 20 years.',
      hint: 'Result channels → Audit trail owner → object storage with Object Lock / WORM (or an append-only store).',
      concepts: ['event-driven', 'guaranteed-delivery'],
      test: (g) => {
        const audit = g.ownerFamily('audit')
        if (!audit.length) return { pass: false, detail: 'Nobody owns the Audit trail.' }
        if (!g.asyncFlow(publishers(g), audit)) return { pass: false, detail: 'The audit trail is not fed by result events.' }
        const stores = g.storesOf(audit, [...DB_KINDS, 'object-storage', 'wide-column', 'analytics-db'])
        return stores.some((s) => g.hasTrait(s, 'immutable-option') || IMMUTABLE_RE.test(text(s)))
          ? { pass: true }
          : { pass: false, detail: 'The audit store is not write-once / append-only.' }
      },
    },
    {
      id: 'anti-sync-delivery',
      title: 'Ingestion never calls hospital endpoints synchronously',
      category: 'antipattern',
      why: '"The network is reliable" is the first fallacy of distributed computing. A synchronous chain from intake to every hospital ties the LIS ACK, and every result behind it, to the slowest HIS. That is how a maintenance window delayed a critical potassium by 70 minutes.',
      hint: 'Remove HTTP / MLLP calls from the ingestion side to hospitals; publish an event and let delivery consumers call the hospitals.',
      concepts: ['fallacies-of-distributed-computing', 'event-driven'],
      test: (g) => {
        const ingest = g.ownerFamily('ingestion')
        const targets = ids(hospitals(g))
        if (!ingest.length || !targets.size) return { pass: true }
        const hit = g.reaches(ingest, (n) => targets.has(n.id), { protocols: SYNC_PROTOCOLS, through: [...COMPUTE_KINDS, ...EDGE_KINDS], maxDepth: 5 })
        return hit ? { pass: false, detail: `Ingestion reaches ${hit.label} through a synchronous chain.` } : { pass: true }
      },
    },
    {
      id: 'anti-dead-end-errors',
      title: 'Failed messages never end in a dead end',
      category: 'antipattern',
      why: 'An error queue nobody works on, a log line, or a retry loop that sends a malformed message straight back to the consumer all lose the result in the end, and the loop also blocks the channel. This is exactly how 4,000 results a month disappeared.',
      hint: 'Every error / dead-letter channel needs a workflow processor that resubmits corrected messages. Do not send bad messages back to delivery unchanged, and do not let logging be the only place they go.',
      concepts: ['workflow-event-pattern', 'dead-letter-queue'],
      test: (g) => {
        const routing = ids(g.ownerFamily('routing'))
        const repair = ids(g.ownerFamily('repair'))
        const flow = new Set([...ids(publishers(g)), ...routing])
        const laneIds = ids(lanes(g).map((l) => l.broker))
        const retry = ids(retryChannels(g))
        const errChannels = g
          .ofKind('broker')
          .filter((b) => !laneIds.has(b.id) && ERR_RE.test(text(b)))
          .filter((b) => g.sources(b.id, ['event']).some((p) => flow.has(p.id)))
          // A per-hospital retry / parking channel is meant to go back to delivery; it holds reachable-later results, not malformed ones.
          .filter((b) => !retry.has(b.id))
        for (const b of errChannels) {
          const cons = consumersOf(g, b)
          if (!cons.length) return { pass: false, detail: `${b.label} is a dead end: nobody works on the messages parked there.` }
          if (cons.some((c) => routing.has(c.id) && !repair.has(c.id)))
            return { pass: false, detail: `${b.label} feeds bad messages straight back to delivery, so a malformed message loops forever.` }
          if (!resubmits(g, cons)) return { pass: false, detail: `Messages in ${b.label} are never fixed and resubmitted.` }
        }
        const workflowOk = workflowChannels(g).some((c) => resubmits(g, consumersOf(g, c)))
        const logged = [...flow].flatMap((id) =>
          g.out(id).filter((e) => {
            const t = g.node(e.target)
            return !!t && OBS_KINDS.includes(t.kind) && ERR_RE.test(e.label ?? '')
          }),
        )
        if (logged.length && !workflowOk)
          return { pass: false, detail: 'Malformed results are only written to logs and monitoring, then dropped.' }
        return { pass: true }
      },
    },
  ],
  inspiration: [
    { label: 'Mark Richards — Lesson 56: The Ambulance Pattern', url: 'https://www.developertoarchitect.com/lessons/lesson56.html' },
    { label: 'Mark Richards — Lesson 81: Workflow Event Pattern', url: 'https://www.developertoarchitect.com/lessons/lesson81.html' },
    { label: 'Mark Richards — Lesson 70: Preventing Data Loss When Using Messaging', url: 'https://www.developertoarchitect.com/lessons/lesson70.html' },
    { label: 'Confluent — Error handling patterns in Kafka', url: 'https://www.confluent.io/blog/error-handling-patterns-in-kafka/' },
  ],
  reference: {
    decisions: {
      style: 'event-driven',
      communication: 'hybrid',
      data: 'per-service',
      stack: { backend: 'spring-boot', frontend: 'react', mobile: 'flutter', database: 'postgres', messaging: 'kafka' },
      rationale:
        'Ingestion stores, ACKs and publishes through an outbox. Routine and STAT results travel on separate Kafka topics with separate consumers, failures go to a workflow topic that lab staff repair and resubmit, and the audit trail and patient app subscribe to the same events.',
    },
    walkthrough: [
      'Result Ingestion (Spring Boot with a HAPI HL7 MLLP listener) validates each ORU^R01 and writes the raw message and an outbox row in one PostgreSQL transaction. Only then does it send the ACK to the LIS, so a crash before the commit just means the LIS resends; ingestion de-duplicates resends on the HL7 MSH-10 message control id. Debezium publishes the outbox rows to Kafka (replication factor 3, acks=all).',
      'Ingestion decides the channel. Results flagged STAT or carrying a critical value go to results.stat, everything else to results.routine. Validation failures at intake go to results.workflow. Because the producer chooses, an urgent result never waits behind the morning backlog (the ambulance pattern).',
      'Routine Delivery consumers scale from 2 to 24 pods on consumer lag (KEDA); results.routine has 24 partitions, so every pod has one to read. They call each hospital through an adapter (FHIR R4 or HL7 v2 over MLLP). When a hospital is unreachable, the result is parked on results.retry (per hospital) behind a circuit breaker (Spring Kafka non-blocking retry topics) and the consumer moves on, so one HIS in maintenance never blocks the rest of its partition. STAT Delivery is a separate consumer group with a fixed, always-on pool that delivers to the hospital and pages the ordering doctor through SMSAPI. If the HIS is unreachable, the doctor has already been paged, so STAT Delivery parks the hospital copy on results.retry as well and moves on. Both commit their offsets only once the hospital ACK is in the Delivery Ledger, or the result is safely parked on results.retry, which also makes redeliveries idempotent.',
      'When a consumer hits an unknown test code, an unmatched patient or a rejecting HIS, it publishes the message with the reason to results.workflow. The Result Repair service keeps it as a case, lab staff fix it in the Repair Console, and the corrected message is resubmitted to results.routine or results.stat. Nothing is dropped, and nothing loops unchanged.',
      'Audit Trail and Patient Notifications are additional subscribers. Audit writes every event to S3 with Object Lock for 20-year retention. Patient Notifications reads both result topics and pushes "your results are ready", but holds critical values until the doctor has acknowledged them.',
      'Prometheus scrapes topic lag and the age of the oldest STAT message, and Grafana alerts the lab’s on-call at 30 seconds. Trade-off: four topics, a CDC relay and two consumer groups take more to operate than one router, but each part has one job, and urgent results no longer depend on how fast the slowest hospital is.',
    ],
    diagram: diagram(
      [
        ['lis', 'external', 'Lab LIS ×38 (HL7 v2 / MLLP)', 0, 0, { tech: 'generic-api' }],
        ['repairUi', 'web-app', 'Repair Console', 0, 360, { tech: 'react' }],
        ['patientApp', 'mobile-app', 'Patient App', 0, 600, { tech: 'flutter' }],
        ['ingest', 'service', 'Result Ingestion', 280, 0, { tech: 'spring-boot', domains: ['ingestion'], notes: 'Store raw message + outbox row, then ACK the LIS' }],
        ['gw', 'api-gateway', 'API Gateway', 280, 480, { tech: 'kong' }],
        ['ingestDb', 'relational-db', 'Inbound Messages + Outbox', 560, 0, { tech: 'postgres' }],
        ['cdc', 'cdc', 'Outbox Relay', 560, 120, { tech: 'debezium' }],
        ['statTopic', 'broker', 'results.stat', 840, -120, { tech: 'kafka', notes: 'Ambulance channel: own partitions and consumer group' }],
        ['routineTopic', 'broker', 'results.routine', 840, 120, { tech: 'kafka', notes: 'RF=3, acks=all, 24 partitions' }],
        ['retryTopic', 'broker', 'results.retry (per hospital)', 1120, 480, { tech: 'kafka', notes: 'Backoff per endpoint, behind a circuit breaker' }],
        ['workflowTopic', 'broker', 'results.workflow', 840, 360, { tech: 'kafka', notes: 'Malformed or rejected messages, with the reason' }],
        ['statWorkers', 'worker', 'STAT Delivery', 1120, -120, { tech: 'spring-boot', domains: ['routing'], notes: 'Fixed pool of 4, never scaled to zero' }],
        ['audit', 'service', 'Audit Trail', 1120, 0, { tech: 'go', domains: ['audit'] }],
        ['routeWorkers', 'worker', 'Routine Delivery', 1120, 120, { tech: 'spring-boot', domains: ['routing'], notes: 'KEDA: 2→24 pods on consumer lag' }],
        ['patientNotify', 'service', 'Patient Notifications', 1120, 240, { tech: 'spring-boot', domains: ['patient-notify'] }],
        ['repairSvc', 'service', 'Result Repair', 1120, 360, { tech: 'spring-boot', domains: ['repair'] }],
        ['pager', 'external', 'Doctor Pager (SMS)', 1400, -240, { tech: 'smsapi' }],
        ['hospFhir', 'external', 'Hospital HIS (FHIR R4)', 1400, -120, { tech: 'generic-api' }],
        ['auditStore', 'object-storage', 'Audit Log (Object Lock)', 1400, 0, { tech: 's3' }],
        ['hospMllp', 'external', 'Hospital HIS (HL7 v2 / MLLP)', 1400, 120, { tech: 'generic-api' }],
        ['push', 'external', 'Push (FCM / APNs)', 1400, 240, { tech: 'fcm' }],
        ['repairDb', 'relational-db', 'Repair Cases', 1400, 360, { tech: 'postgres' }],
        ['patientDb', 'relational-db', 'Released Results', 1400, 480, { tech: 'postgres' }],
        ['deliveryDb', 'relational-db', 'Delivery Ledger', 1680, 0, { tech: 'postgres' }],
        ['metrics', 'metrics', 'Metrics', 560, 600, { tech: 'prometheus' }],
        ['alerts', 'alerting', 'STAT Lag Alerts', 840, 600, { tech: 'grafana' }],
      ],
      [
        ['lis', 'ingest', 'http', 'ORU^R01 over MLLP, ACK after commit'],
        ['ingest', 'ingestDb', 'data', 'message + outbox (one transaction)'],
        ['ingestDb', 'cdc', 'event', 'outbox rows'],
        ['cdc', 'statTopic', 'event', 'STAT / critical'],
        ['cdc', 'routineTopic', 'event', 'routine'],
        ['cdc', 'workflowTopic', 'event', 'invalid at intake'],
        ['statTopic', 'statWorkers', 'event'],
        ['routineTopic', 'routeWorkers', 'event'],
        ['statWorkers', 'hospFhir', 'http'],
        ['statWorkers', 'hospMllp', 'http', 'MLLP'],
        ['statWorkers', 'pager', 'http', 'critical value call-out'],
        ['routeWorkers', 'hospFhir', 'http', 'FHIR adapter'],
        ['routeWorkers', 'hospMllp', 'http', 'MLLP adapter'],
        ['statWorkers', 'deliveryDb', 'data', 'ledger, then commit offset'],
        ['routeWorkers', 'deliveryDb', 'data', 'ledger, then commit offset'],
        ['statWorkers', 'workflowTopic', 'event', 'unmatched / rejected'],
        ['routeWorkers', 'workflowTopic', 'event', 'unknown test code / HIS rejected'],
        ['routeWorkers', 'retryTopic', 'event', 'HIS unreachable: park, move on'],
        ['statWorkers', 'retryTopic', 'event', 'HIS unreachable: doctor paged, park'],
        ['retryTopic', 'routeWorkers', 'event', 'retry with backoff'],
        ['workflowTopic', 'repairSvc', 'event'],
        ['repairSvc', 'repairDb', 'data'],
        ['repairUi', 'gw', 'http'],
        ['gw', 'repairSvc', 'http', 'fix & resubmit'],
        ['repairSvc', 'routineTopic', 'event', 'resubmit corrected'],
        ['repairSvc', 'statTopic', 'event', 'resubmit corrected STAT'],
        ['routineTopic', 'audit', 'event'],
        ['statTopic', 'audit', 'event'],
        ['workflowTopic', 'audit', 'event'],
        ['audit', 'auditStore', 'data'],
        ['routineTopic', 'patientNotify', 'event'],
        ['statTopic', 'patientNotify', 'event', 'hold critical until doctor ACK'],
        ['patientNotify', 'patientDb', 'data'],
        ['patientNotify', 'push', 'http'],
        ['patientApp', 'gw', 'http'],
        ['gw', 'patientNotify', 'http', 'my results'],
        ['routineTopic', 'metrics', 'telemetry', 'consumer lag'],
        ['statTopic', 'metrics', 'telemetry', 'oldest STAT age'],
        ['ingest', 'metrics', 'telemetry'],
        ['statWorkers', 'metrics', 'telemetry'],
        ['routeWorkers', 'metrics', 'telemetry'],
        ['repairSvc', 'metrics', 'telemetry'],
        ['audit', 'metrics', 'telemetry'],
        ['patientNotify', 'metrics', 'telemetry'],
        ['metrics', 'alerts', 'telemetry'],
      ],
    ),
  },
}

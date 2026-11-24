import { SYNC_PROTOCOLS, type ComponentKind, type DiagramNode, type Scenario } from '../../engine/types'
import { CLIENT_KINDS, COMPUTE_KINDS, DB_KINDS, type Graph } from '../../engine/graph'
import { diagram, type EdgeSpec, type NodeSpec } from './builder'

// ---------------------------------------------------------------------------
// Helpers shared by the checks
// ---------------------------------------------------------------------------

type Channel = 'email' | 'push' | 'sms'
const CHANNELS: Channel[] = ['email', 'push', 'sms']
const CHANNEL_NAMES: Record<Channel, string> = { email: 'email provider', push: 'push provider', sms: 'SMS provider' }
const CHANNEL_RE: Record<Channel, RegExp> = {
  email: /mail|sendgrid|\bses\b|smtp|postmark|brevo|resend|sparkpost|mandrill/i,
  push: /push|fcm|firebase|apns|onesignal|expo|\bsns\b|pinpoint|end.?user.?messaging/i,
  sms: /sms|twilio|vonage|nexmo|messagebird|plivo|sinch|smsapi|\bsns\b|pinpoint|end.?user.?messaging/i,
}
/** Words that mark a lane or its consumers as the critical (OTP / security) path. */
const PRIORITY_RE = /priorit|\botp\b|one.?time|critical|urgent|fast.?lane|transactional|\bauth\b|login|verif|2fa|\bmfa\b/i
/** A single broker node described as several topics / queues ("topics: events, otp, bulk"). */
const LANE_LIST_RE = /\b(topics?|queues?|lanes?|streams?|subscriptions?)\s*:/i
const DLQ_RE = /dead|dlq|dlx|\bdlt\b|parking|poison/i
const DLQ_STORE_RE = /dead|dlq|parking|poison|failed/i
const DLQ_NOTE_RE = /\bdlq\b|dead.?letter|\bdlt\b|\bdlx\b|redrive/i
const READ_RE = /\b(get|read|list|fetch|query)\b|inbox|unread|preference|prefs|settings|quiet/i
const OBS_KINDS: ComponentKind[] = ['otel-collector', 'logging', 'metrics', 'tracing', 'dashboards', 'alerting']
const CONSUMER_KINDS: ComponentKind[] = ['worker', 'function', 'service', 'module', 'monolith', 'orchestrator']

/** Which delivery channels an external provider covers — tech traits first, label as a fallback. */
function channelsOf(g: Graph, n: DiagramNode): Channel[] {
  if (n.kind !== 'external') return []
  const traits = g.techTraits(n)
  const byTrait = CHANNELS.filter((c) => traits.includes(c))
  if (byTrait.length) return byTrait
  return CHANNELS.filter((c) => CHANNEL_RE[c].test(n.label))
}

const isProvider = (g: Graph) => (n: DiagramNode) => channelsOf(g, n).length > 0

/** Compute nodes that call a channel provider directly. */
function senders(g: Graph): DiagramNode[] {
  return g.ofKind(...COMPUTE_KINDS).filter((n) => g.targets(n.id).some(isProvider(g)))
}

type Lane = { broker: DiagramNode; consumers: DiagramNode[]; providers: DiagramNode[] }

/** Broker → consumers that send to a provider. Each such broker is a delivery "lane". */
function lanes(g: Graph): Lane[] {
  const result: Lane[] = []
  for (const b of g.ofKind('broker')) {
    const consumers = g.targets(b.id, ['event']).filter((c) => CONSUMER_KINDS.includes(c.kind) && g.targets(c.id).some(isProvider(g)))
    if (!consumers.length) continue
    const providers = new Map<string, DiagramNode>()
    for (const c of consumers) for (const p of g.targets(c.id).filter(isProvider(g))) providers.set(p.id, p)
    result.push({ broker: b, consumers, providers: [...providers.values()] })
  }
  return result
}

const ids = (nodes: DiagramNode[]) => new Set(nodes.map((n) => n.id))
const overlaps = (a: DiagramNode[], b: DiagramNode[]) => {
  const s = ids(b)
  return a.some((n) => s.has(n.id))
}
const text = (n: DiagramNode) => `${n.label} ${n.notes ?? ''}`

/**
 * Lanes fed from upstream (processing, a topic…). A queue fed only by the
 * senders themselves is a retry loop, not a separate lane.
 */
function inboundLanes(g: Graph): Lane[] {
  const delivery = new Set([...ids(senders(g)), ...ids(g.ownerFamily('channel-delivery'))])
  return lanes(g).filter((l) => g.sources(l.broker.id).some((p) => !delivery.has(p.id) && !OBS_KINDS.includes(p.kind)))
}

/**
 * How critical traffic is separated from bulk traffic.
 * - separated: an OTP does not have to wait behind the bulk backlog.
 * - dedicated: critical traffic also has its own consumer pool.
 */
function priorityLanes(g: Graph) {
  const list = inboundLanes(g)
  const chans = list.map((l) => new Set(l.providers.flatMap((p) => channelsOf(g, p))))
  const marked = list.map((l) => PRIORITY_RE.test(text(l.broker)) || l.consumers.some((c) => PRIORITY_RE.test(text(c))))
  // Two lanes carrying the same channel (whatever provider each uses), or two lanes with one marked as critical.
  const pairs: [Lane, Lane][] = []
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++)
      if ([...chans[i]].some((c) => chans[j].has(c)) || marked[i] || marked[j]) pairs.push([list[i], list[j]])
  // One broker drained by several consumer groups, one of them marked as critical.
  const split = list.filter((l) => {
    const m = l.consumers.filter((c) => PRIORITY_RE.test(text(c))).length
    return m > 0 && m < l.consumers.length
  })
  // One broker node explicitly modelled as several topics, one of them critical.
  const listed = list.filter((l) => PRIORITY_RE.test(text(l.broker)) && LANE_LIST_RE.test(text(l.broker)))
  return {
    count: list.length,
    separated: pairs.length > 0 || split.length > 0 || listed.length > 0,
    dedicated: pairs.some(([a, b]) => !overlaps(a.consumers, b.consumers)) || split.length > 0,
  }
}

/** Where messages the senders gave up on are parked (dead-letter queues). */
function deadLetters(g: Graph) {
  const laneList = lanes(g)
  const laneIds = new Set(laneList.map((l) => l.broker.id))
  const sendList = senders(g)
  const senderIds = ids(sendList)
  const deliveryIds = ids(g.ownerFamily('channel-delivery'))
  const procIds = ids(g.ownerFamily('notification-processing'))
  const candidates = new Map<string, DiagramNode>()
  for (const s of sendList) {
    const inputs = new Set(g.sources(s.id, ['event']).map((b) => b.id))
    for (const d of g.targets(s.id, ['event'])) if (d.kind === 'broker' && !inputs.has(d.id) && !laneIds.has(d.id)) candidates.set(d.id, d)
  }
  // Broker-side dead-lettering (e.g. RabbitMQ DLX, SQS redrive): lane → DLQ.
  for (const l of laneList) for (const d of g.targets(l.broker.id)) if (d.kind === 'broker' && !laneIds.has(d.id)) candidates.set(d.id, d)

  // A replay tool or ops console may drain the DLQ; a sender or processing consuming it is just a retry loop.
  const replay = (c: DiagramNode) =>
    ['worker', 'function', 'orchestrator', 'service'].includes(c.kind) && !senderIds.has(c.id) && !procIds.has(c.id)
  const loops: DiagramNode[] = []
  const queues = [...candidates.values()].filter((d) => {
    const producers = g.sources(d.id).filter((p) => !OBS_KINDS.includes(p.kind))
    const fedByDelivery = producers.length > 0 && producers.every((p) => senderIds.has(p.id) || laneIds.has(p.id) || deliveryIds.has(p.id))
    if (!fedByDelivery) return false
    const consumers = g.targets(d.id).filter((c) => !OBS_KINDS.includes(c.kind))
    if (!consumers.every(replay)) {
      loops.push(d)
      return false
    }
    const drained = g.targets(d.id).some((c) => OBS_KINDS.includes(c.kind) || replay(c))
    return drained || DLQ_RE.test(text(d))
  })
  // A table / dead set the senders write failed sends into, or dead-lettering noted on the lane itself.
  const stores = g.storesOf(sendList, [...DB_KINDS, 'cache', 'object-storage']).filter((s) => DLQ_STORE_RE.test(text(s)))
  const noted = laneList.map((l) => l.broker).filter((b) => DLQ_NOTE_RE.test(text(b)))
  return { found: [...queues, ...stores, ...noted], loops }
}

// ---------------------------------------------------------------------------
// Starter: today's monolith sends email inline, inside the web request
// ---------------------------------------------------------------------------

const starter = diagram(
  [
    ['web', 'web-app', 'Pingly Web', 0, 160, { tech: 'react' }],
    ['lb', 'load-balancer', 'Load Balancer', 260, 160, { tech: 'nginx' }],
    [
      'app',
      'monolith',
      'Pingly App',
      520,
      160,
      { w: 240, h: 90, tech: 'rails', domains: ['projects', 'notification-processing', 'preferences', 'in-app-inbox', 'channel-delivery'], notes: 'NotificationMailer.deliver_now inside controllers; weekly digest rake task on the same servers' },
    ],
    ['db', 'relational-db', 'Pingly DB', 820, 60, { tech: 'postgres' }],
    ['sendgrid', 'external', 'SendGrid', 820, 260, { tech: 'sendgrid' }],
  ],
  [
    ['web', 'lb'],
    ['lb', 'app'],
    ['app', 'db'],
    ['app', 'sendgrid', 'http', 'SMTP/API call inside the request'],
  ],
)

// ---------------------------------------------------------------------------
// Reference solution
// ---------------------------------------------------------------------------

const refNodes: NodeSpec[] = [
  ['web', 'web-app', 'Pingly Web', 0, 240, { tech: 'react' }],
  ['gw', 'api-gateway', 'API Gateway', 260, 240, { tech: 'kong' }],
  ['app', 'monolith', 'Pingly App', 520, 40, { tech: 'rails', domains: ['projects'], w: 220, h: 90 }],
  ['appDb', 'relational-db', 'Pingly DB', 520, -100, { tech: 'postgres' }],
  ['prefs', 'service', 'Preferences', 520, 340, { tech: 'go', domains: ['preferences'], notes: 'Channels per type, quiet hours, time zone' }],
  ['prefsDb', 'relational-db', 'Preferences DB', 260, 400, { tech: 'postgres' }],
  ['inbox', 'service', 'Inbox', 520, 500, { tech: 'go', domains: ['in-app-inbox'] }],
  ['inboxDb', 'document-db', 'Inbox Store', 260, 560, { tech: 'dynamodb', notes: 'PK user, SK time — unread counts' }],
  ['bus', 'broker', 'Event Bus', 780, 40, { tech: 'sqs', notes: 'SNS topic + SQS subscription per consumer' }],
  [
    'notif',
    'service',
    'Notification Service',
    1040,
    40,
    { tech: 'go', domains: ['notification-processing'], notes: 'Recipients, preference filter, templates, priority routing' },
  ],
  ['notifDb', 'relational-db', 'Templates & Log', 1040, -100, { tech: 'postgres', notes: 'Notification types, templates, delivery status' }],
  ['priQ', 'broker', 'Priority Lane', 1300, -40, { tech: 'sqs', notes: 'OTP & security alerts only — never shed' }],
  [
    'bulkQ',
    'broker',
    'Standard Lanes',
    1300,
    140,
    { tech: 'sqs', notes: 'One queue per channel. Under overload: marketing push expires (message TTL), digests pause when OTP lag > 1 min' },
  ],
  ['priW', 'worker', 'Priority Senders', 1560, -40, { tech: 'go', domains: ['channel-delivery'], notes: 'Reserved capacity for critical messages' }],
  ['bulkW', 'worker', 'Channel Senders', 1560, 140, { tech: 'go', domains: ['channel-delivery'], notes: 'Rate-limited per provider, exponential backoff + jitter' }],
  [
    'dedup',
    'cache',
    'Idempotency Keys',
    1300,
    -220,
    { tech: 'redis', notes: 'SET NX id:channel = pending (60 s TTL) before the call; = sent (24 h TTL) after success' },
  ],
  ['dlq', 'broker', 'Dead-letter Queue', 1300, 320, { tech: 'sqs', notes: 'Inspect, fix, replay; alert on depth' }],
  ['ses', 'external', 'Amazon SES', 1820, -80, { tech: 'ses' }],
  ['fcm', 'external', 'FCM / APNs', 1820, 60, { tech: 'fcm' }],
  ['twilio', 'external', 'Twilio SMS', 1820, 200, { tech: 'twilio' }],
  ['metrics', 'metrics', 'Delivery Metrics', 1300, 660, { tech: 'prometheus', notes: 'Sent/failed per channel, lane lag, DLQ depth alerts' }],
]

const refEdges: EdgeSpec[] = [
  ['web', 'gw'],
  ['gw', 'app', 'http'],
  ['gw', 'prefs', 'http', 'settings & quiet hours'],
  ['gw', 'inbox', 'http', 'inbox & unread count'],
  ['app', 'appDb'],
  ['app', 'bus', 'event', 'TaskAssigned, Mentioned, LoginCodeRequested'],
  ['bus', 'notif', 'event'],
  ['notif', 'notifDb'],
  ['notif', 'prefs', 'grpc', 'who wants what, when'],
  ['prefs', 'prefsDb'],
  ['notif', 'inbox', 'grpc', 'in-app notification'],
  ['inbox', 'inboxDb'],
  ['notif', 'priQ', 'event', 'OTP, security'],
  ['notif', 'bulkQ', 'event', 'everything else'],
  ['priQ', 'priW', 'event'],
  ['bulkQ', 'bulkW', 'event'],
  ['priW', 'dedup'],
  ['bulkW', 'dedup'],
  ['priW', 'ses', 'http'],
  ['priW', 'fcm', 'http'],
  ['priW', 'twilio', 'http'],
  ['bulkW', 'ses', 'http'],
  ['bulkW', 'fcm', 'http'],
  ['bulkW', 'twilio', 'http'],
  ['priW', 'dlq', 'event', 'after last retry'],
  ['bulkW', 'dlq', 'event', 'after last retry'],
  ['app', 'metrics', 'telemetry'],
  ['notif', 'metrics', 'telemetry'],
  ['prefs', 'metrics', 'telemetry'],
  ['inbox', 'metrics', 'telemetry'],
  ['priW', 'metrics', 'telemetry'],
  ['bulkW', 'metrics', 'telemetry'],
  ['dlq', 'metrics', 'telemetry', 'DLQ depth'],
]

export const notifyHub: Scenario = {
  id: 'pingly-notifications',
  title: 'Pingly: never lose a notification',
  tagline: 'Move notifications out of the request path and keep login codes fast, even mid-blast.',
  industry: 'SaaS platform',
  difficulty: 'beginner',
  estMinutes: 25,
  accent: '#eab308',
  concepts: ['event-driven', 'dead-letter-queue', 'load-shedding', 'idempotency', 'queue-load-leveling', 'fan-out'],
  story:
    'Pingly is a Kraków-built project-management SaaS used by 40,000 teams. Its Rails monolith sends transactional emails inline in controllers, and the weekly digest runs as a rake task on the same app servers. Last month the digest to 900,000 users saturated them for an hour: requests timed out and the load balancer retried them, so some people got the same digest four times, and an enterprise admin could not log in for 20 minutes because every app thread was busy sending the digest when the login request arrived. Adding the new "you were mentioned" push notification took six days and touched fourteen files. The CTO has promised the biggest customers one thing for next quarter: Pingly never loses a notification.',
  facts: [
    { label: 'Volume', value: '8M notifications/day (~90/s on average); the 900k digest must drain in ≤ 10 min (~1.5k/s peaks)' },
    { label: 'Critical path', value: 'OTP handed to a provider in < 5 s p99, even during a blast' },
    { label: 'Users', value: '1.2M users in 40k workspaces, 60% with the mobile app' },
    { label: 'Team', value: '4-engineer platform squad (Ruby & Go), managed AWS preferred' },
  ],
  functional: [
    'Product features publish what happened (task assigned, mention, login code requested) instead of sending messages themselves',
    'Deliver in-app, email, push and SMS notifications from one platform',
    'Users choose channels per notification type and set quiet hours; security messages ignore quiet hours',
    'New notification types are added with a template and config, not code in the product app',
    'In-app inbox with unread counts in the web app',
  ],
  nonFunctional: [
    'One-time passwords and security alerts never wait behind marketing or digest blasts',
    'No lost notifications: provider outages are retried with backoff, and messages that keep failing are parked, not dropped',
    'No duplicates: a retried send must not reach the user twice',
    'Product app response times do not depend on notification volume or provider speed',
  ],
  constraints: [
    'The product app stays a Rails monolith — only notification code moves out',
    'Providers rate-limit (e.g. 100 SMS/s per sender ID), so sending must be paced',
    'A platform team of four: prefer managed queues over running clusters',
  ],
  domains: [
    { id: 'projects', label: 'Projects & tasks', description: 'The core product (Rails monolith) — the source of notification-worthy events' },
    { id: 'notification-processing', label: 'Notification processing', description: 'Turns events into notifications: recipients, templates, priority' },
    { id: 'preferences', label: 'Preferences & quiet hours', description: 'Per-user channel choices, quiet hours, time zones' },
    { id: 'channel-delivery', label: 'Channel delivery', description: 'Sending email, push and SMS: pacing, retries, provider status' },
    { id: 'in-app-inbox', label: 'In-app inbox', description: 'Notification feed and unread counts inside Pingly' },
  ],
  recommendedStyles: ['event-driven', 'microservices', 'serverless'],
  styleFeedback: {
    'event-driven':
      'Great fit: the product app just publishes events, and a dedicated notification platform reacts to them — bursts are absorbed by queues instead of web requests.',
    microservices:
      'Good fit: a separately deployed notification platform (processing, preferences, inbox) can scale for digest bursts without touching the Rails app — just make sure it is fed by events, not synchronous calls.',
    'modular-monolith':
      'Dedicated Sidekiq processes with a critical queue would isolate web requests, but notification code, templates and deploys would stay coupled to the product app — the six-day cost of a new type, and every digest change shipping with a Rails release, remain.',
    monolith:
      'This is today’s design: emails are sent inside web requests, so one digest blast slows the whole product and delays login codes.',
    serverless:
      'Good fit for a small AWS team: SQS-triggered Lambdas per lane, with maximum concurrency set per provider to pace sends and a separate queue + function for OTP. Watch cold starts on the priority lane (provisioned concurrency) and keep preferences behind one API.',
  },
  starter,
  starterDecisions: {
    style: 'monolith',
    communication: 'sync',
    data: 'shared',
    stack: { backend: 'rails', frontend: 'react', database: 'postgres' },
  },
  hints: [
    'Stop sending from inside the web request: the product app should only announce what happened (an event) and move on.',
    'Give notifications their own home: a service that consumes those events, picks recipients and templates, and checks preferences and quiet hours before anything is sent.',
    'Put queues in front of the channel senders so bursts are absorbed and providers are called at a pace they accept.',
    'A login code must never wait behind a 900k-email digest. Give critical messages their own lane — ideally with senders of their own — and decide what bulk traffic gets shed first under overload.',
    'Providers fail. Retry with exponential backoff, and after the last attempt park the message in a dead-letter queue (its own queue, or a failed-sends table) that only a replay tool or alerting drains — never straight back into the lane. Record a key per send so retries do not double-send.',
    'Near-solution: App → event bus → Notification service (asks Preferences) → priority lane + standard lanes → sender workers → SES / FCM / Twilio; senders → dead-letter queue; idempotency keys in Redis; in-app notifications stored by an Inbox service the web app reads via the gateway.',
  ],
  checks: [
    {
      id: 'async-handoff',
      title: 'The product app hands notifications off as events',
      category: 'core',
      why: 'When the app publishes an event and returns, a 900k-recipient digest becomes queue depth instead of blocked web requests. Producers and the notification platform can then scale and fail independently.',
      hint: 'Connect whatever owns Projects & tasks to a broker with an Event edge, and let the Notification processing owner consume from it.',
      concepts: ['event-driven', 'queue-load-leveling'],
      test: (g) => {
        const proj = g.ownerFamily('projects')
        const proc = g.ownerFamily('notification-processing')
        if (!proj.length) return { pass: false, detail: 'Nobody owns Projects & tasks.' }
        if (!proc.length) return { pass: false, detail: 'Nobody owns Notification processing.' }
        // Read APIs (preferences, inbox) may be called synchronously; asking processing to send may not.
        const procIds = ids(proc)
        const readOnly = (t: DiagramNode, label?: string) =>
          (!t.domains.includes('notification-processing') && (t.domains.includes('preferences') || t.domains.includes('in-app-inbox'))) ||
          READ_RE.test(label ?? '')
        const syncCalled = proj.some((p) =>
          g.out(p.id, SYNC_PROTOCOLS).some((e) => {
            const t = g.node(e.target)
            return !!t && procIds.has(t.id) && g.deployable(t).id !== g.deployable(p).id && !readOnly(t, e.label)
          }),
        )
        if (syncCalled) return { pass: false, detail: 'The product app still calls notification processing synchronously, inside the request.' }
        return g.asyncFlow(proj, proc) ? { pass: true } : { pass: false, detail: 'No event flows from the product app to notification processing through a broker.' }
      },
    },
    {
      id: 'preferences-respected',
      title: 'Preferences and quiet hours are checked before sending',
      category: 'core',
      why: 'Sending what a user muted — or an SMS at 3 a.m. — is the fastest way to lose their trust. Processing must consult a durable preference store for every recipient before a message reaches a channel.',
      hint: 'Give Preferences an owner with its own database, and connect Notification processing to it (call it, own it, or receive its changes as events).',
      concepts: ['bounded-context'],
      test: (g) => {
        const prefs = g.ownerFamily('preferences')
        const proc = g.ownerFamily('notification-processing')
        if (!prefs.length) return { pass: false, detail: 'Nobody owns Preferences & quiet hours.' }
        if (!g.storesOf(prefs, DB_KINDS).length) return { pass: false, detail: 'Preferences have no durable database.' }
        if (!proc.length) return { pass: false, detail: 'Nobody owns Notification processing.' }
        const prefIds = ids(prefs)
        const procStores = ids(g.storesOf(proc))
        const consulted =
          overlaps(proc, prefs) ||
          g.calls(proc, (n) => prefIds.has(n.id)) ||
          g.asyncFlow(prefs, proc) ||
          g.storesOf(prefs).some((s) => procStores.has(s.id))
        return consulted ? { pass: true } : { pass: false, detail: 'Notification processing never looks at preferences.' }
      },
    },
    {
      id: 'channel-providers',
      title: 'Email, push and SMS are delivered through providers, after processing',
      category: 'core',
      why: 'Each channel has a specialised provider (SES/SendGrid/Postmark, FCM/APNs/OneSignal, Twilio) handling deliverability and device tokens. Senders sit downstream of processing so nothing bypasses preference filtering.',
      hint: 'Assign Channel delivery to your sender workers, connect them to an email, a push and an SMS provider, and feed them from Notification processing.',
      concepts: ['fan-out'],
      test: (g) => {
        const delivery = g.ownerFamily('channel-delivery')
        if (!delivery.length) return { pass: false, detail: 'Nobody owns Channel delivery.' }
        const covered = new Set<Channel>()
        for (const d of delivery) for (const t of g.targets(d.id)) for (const c of channelsOf(g, t)) covered.add(c)
        const missing = CHANNELS.filter((c) => !covered.has(c))
        if (missing.length) return { pass: false, detail: `Channel delivery never reaches: ${missing.map((c) => CHANNEL_NAMES[c]).join(', ')}.` }
        const proc = g.ownerFamily('notification-processing')
        const deliveryIds = ids(delivery)
        const fed = overlaps(proc, delivery) || !!g.reaches(proc, (n) => deliveryIds.has(n.id), { maxDepth: 4 })
        return fed ? { pass: true } : { pass: false, detail: 'Channel senders are not fed by notification processing — preferences would be bypassed.' }
      },
    },
    {
      id: 'priority-lane',
      title: 'OTP and security alerts have their own priority lane',
      category: 'core',
      why: 'With one shared queue, a login code waits behind every digest email ahead of it. A separate lane lets critical messages skip the bulk backlog, and under overload you shed low-priority work first: stale marketing pushes expire (message TTL) and digests pause while the priority lane lags.',
      hint: 'Add a second queue for OTP and security messages next to the standard lane(s), carrying the same channel (email or SMS) — it may use its own provider. Dedicated senders for it earn a bonus.',
      concepts: ['load-shedding', 'queue-load-leveling'],
      test: (g) => {
        if (!lanes(g).length) return { pass: false, detail: 'No queue sits in front of the channel senders.' }
        const p = priorityLanes(g)
        if (p.separated) return { pass: true }
        return p.count <= 1
          ? { pass: false, detail: 'Every message to a provider goes through the same queue — an OTP would wait behind a marketing blast.' }
          : {
              pass: false,
              detail: 'Your queues split traffic by channel, but nothing separates critical messages: an OTP email still waits behind the digest in the email queue. Add (or mark) a lane for OTP & security.',
            }
      },
    },
    {
      id: 'retries-dlq',
      title: 'Failed sends are retried, then parked in a dead-letter queue',
      category: 'core',
      why: 'Providers have outages and some messages are simply bad (invalid number, bounced address). Bounded retries with exponential backoff ride out outages; a dead-letter queue keeps poison messages from blocking the lane and from vanishing silently.',
      hint: 'Connect your senders (or their queues) to a separate dead-letter queue with an Event edge — or write failed sends to a failed-sends table — and let only a replay tool or alerting drain it.',
      concepts: ['dead-letter-queue'],
      test: (g) => {
        if (!senders(g).length) return { pass: false, detail: 'Nothing sends to a channel provider yet.' }
        const { found, loops } = deadLetters(g)
        if (found.length) return { pass: true }
        if (loops.length)
          return {
            pass: false,
            detail: `${loops.map((l) => l.label).join(', ')} feeds failed messages straight back to sending — a poison message would loop forever. Park them where only a replay tool or alerting drains them.`,
          }
        return { pass: false, detail: 'Messages that keep failing have nowhere to go — they will block the queue or be lost.' }
      },
    },
    {
      id: 'in-app-inbox',
      title: 'In-app notifications are stored and readable by the app',
      category: 'core',
      why: 'The in-app inbox is a channel too: notifications must be persisted per user and served to the web app, so unread counts survive reloads and devices.',
      hint: 'Give the In-app inbox an owner with its own database, feed it from processing, and let the web app reach it (via the gateway, the product app or a realtime gateway).',
      concepts: ['realtime'],
      test: (g) => {
        const inbox = g.ownerFamily('in-app-inbox')
        if (!inbox.length) return { pass: false, detail: 'Nobody owns the In-app inbox.' }
        if (!g.storesOf(inbox, DB_KINDS).length) return { pass: false, detail: 'In-app notifications are not stored in a database.' }
        const inboxIds = ids(inbox)
        const proc = g.ownerFamily('notification-processing')
        if (!overlaps(proc, inbox) && !g.reaches(proc, (n) => inboxIds.has(n.id), { maxDepth: 4 }))
          return { pass: false, detail: 'Notification processing never delivers to the inbox.' }
        const clients = g.ofKind(...CLIENT_KINDS)
        if (!clients.length) return { pass: false, detail: 'No web or mobile client to show the inbox.' }
        const through: ComponentKind[] = ['cdn', 'waf', 'load-balancer', 'api-gateway', 'bff', 'realtime-gateway', 'monolith', 'module', 'service']
        const reads = !!g.reaches(clients, (n) => inboxIds.has(n.id), { through, maxDepth: 4 })
        const pushed = inbox.some((i) =>
          g.targets(i.id).some((rt) => rt.kind === 'realtime-gateway' && clients.some((c) => g.targets(c.id).some((t) => t.id === rt.id) || g.targets(rt.id).some((t) => t.id === c.id))),
        )
        return reads || pushed ? { pass: true } : { pass: false, detail: 'No client can reach the inbox.' }
      },
    },
    {
      id: 'idempotent-sends',
      title: 'Sends are idempotent',
      category: 'bonus',
      why: 'Queues deliver at least once and retries repeat work, so the same message will reach a sender twice. Claim a key per notification and channel as "pending" with a short TTL before calling the provider, mark it "sent" after success, and pass the notification id as the provider\'s idempotency key where supported — duplicates shrink to the rare crash-after-send window (effectively once, not exactly once), and a crashed attempt is retried once its pending key expires.',
      hint: 'Connect the Channel delivery owners to a cache or database that stores sent-message keys.',
      concepts: ['idempotency'],
      test: (g) => {
        const delivery = g.ownerFamily('channel-delivery')
        return g.storesOf(delivery, [...DB_KINDS, 'cache']).length
          ? { pass: true }
          : { pass: false, detail: 'Senders keep no record of what they already sent.' }
      },
    },
    {
      id: 'dedicated-priority-senders',
      title: 'The priority lane has its own senders',
      category: 'bonus',
      why: 'Two queues drained by the same worker pool still share a bottleneck: if every worker is busy with digest emails, the OTP queue waits. Dedicated consumers reserve capacity for critical traffic.',
      hint: 'Let the priority queue and the standard queue be consumed by different sender workers.',
      concepts: ['load-shedding'],
      test: (g) =>
        priorityLanes(g).dedicated ? { pass: true } : { pass: false, detail: 'Priority and bulk messages are drained by the same senders.' },
    },
    {
      id: 'templates-as-data',
      title: 'Notification types and templates live in data',
      category: 'bonus',
      why: 'Adding a notification type took six days because templates lived in the product code. Storing types and templates with the notification platform makes a new type a config change.',
      hint: 'Connect the Notification processing owner to a database (or object storage) that holds templates.',
      test: (g) => {
        const proc = g.ownerFamily('notification-processing')
        return g.storesOf(proc, [...DB_KINDS, 'object-storage', 'cache']).length
          ? { pass: true }
          : { pass: false, detail: 'Notification processing has no store for templates.' }
      },
    },
    {
      id: 'delivery-metrics',
      title: 'Delivery is measured',
      category: 'bonus',
      why: '"Never lose a notification" needs proof: sent/failed rates per channel, lane lag and dead-letter queue depth, with an alert when the DLQ starts growing.',
      hint: 'Add a Metrics store and draw Telemetry edges from your senders.',
      concepts: ['observability', 'slo'],
      test: (g) => {
        if (!g.has('metrics')) return { pass: false, detail: 'No metrics store.' }
        const delivery = ids(g.ownerFamily('channel-delivery'))
        const measured = g.instrumented().some((n) => delivery.has(n.id))
        return measured ? { pass: true } : { pass: false, detail: 'Senders export no telemetry.' }
      },
    },
    {
      id: 'anti-inline-send',
      title: 'The product app never calls a channel provider inline',
      category: 'antipattern',
      why: 'A provider call inside a web request couples page latency to SendGrid or Twilio, turns provider retries into duplicate sends, and lets a big fan-out exhaust the app servers.',
      hint: 'Remove the edge from the product app to the provider; publish an event instead.',
      concepts: ['event-driven', 'background-jobs'],
      test: (g) => {
        // Any direct edge to an external provider is an inline send, whatever protocol it is drawn with.
        const bad = g
          .ownerFamily('projects')
          .filter((p) => g.out(p.id).some((e) => e.protocol !== 'telemetry' && isProvider(g)(g.node(e.target)!)))
        return bad.length ? { pass: false, detail: `${bad.map((b) => b.label).join(', ')} talks to a provider directly, with no queue in between.` } : { pass: true }
      },
    },
  ],
  inspiration: [
    {
      label: 'monday.com Engineering — Building a reliable and extendable notifications platform',
      url: 'https://engineering.monday.com/building-a-reliable-and-extendable-notifications-platform/',
    },
    { label: 'ByteByteGo — Design a notification system', url: 'https://bytebytego.com/courses/system-design-interview/design-a-notification-system' },
  ],
  reference: {
    decisions: {
      style: 'event-driven',
      communication: 'hybrid',
      data: 'per-service',
      stack: { backend: 'go', frontend: 'react', database: 'postgres', messaging: 'sqs', cache: 'redis' },
      rationale:
        'The Rails app only publishes events; a small Go notification platform on managed SNS/SQS filters by preferences and routes into a priority lane and standard lanes, with retries, a DLQ and idempotency keys.',
    },
    walkthrough: [
      'The Rails app stops sending anything. It publishes events such as TaskAssigned or LoginCodeRequested to an SNS/SQS event bus and returns immediately, so a digest blast becomes queue depth instead of timed-out pages.',
      'The Notification service consumes those events, works out recipients, renders templates stored in its own PostgreSQL, and asks the Preferences service which channels each user wants and whether quiet hours apply. Security messages skip quiet hours.',
      'In-app notifications go to the Inbox service (DynamoDB), which the web app reads through the gateway. Email, push and SMS are routed by priority: OTP and security alerts into a dedicated priority lane with its own senders, everything else into standard per-channel queues paced to each provider’s rate limit. Under overload the standard lanes shed first: stale marketing pushes expire by TTL and digests pause while OTP lag is high.',
      'Senders retry with exponential backoff and jitter; after the last attempt a message moves to a dead-letter queue to be inspected and replayed. Before calling a provider a sender claims a Redis key (notification id + channel) as pending with a short TTL and marks it sent afterwards, passing the id as the provider’s idempotency key where possible — duplicates become rare (effectively once, not exactly once) while a crashed attempt is still retried.',
      'Prometheus tracks sent/failed rates per channel, lane lag and DLQ depth. The trade-off: more moving parts than a Sidekiq job, but each piece is a managed queue or a small stateless Go service a team of four can run.',
    ],
    diagram: diagram(refNodes, refEdges),
  },
}

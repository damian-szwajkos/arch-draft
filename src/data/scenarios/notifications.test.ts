import { describe, expect, it } from 'vitest'
import { assertScenarioContract } from '../../engine/scenarioContract'
import { evaluateScenario } from '../../engine/evaluate'
import type { Decisions, Diagram } from '../../engine/types'
import { diagram } from './builder'
import { notifyHub } from './notifications'

const ref = notifyHub.reference

function results(d: Diagram, decisions: Decisions = ref.decisions) {
  const ev = evaluateScenario(notifyHub, d, decisions)
  return { ev, failed: ev.results.filter((r) => !r.pass).map((r) => r.id), byId: (id: string) => ev.results.find((r) => r.id === id)! }
}

/** Reference diagram with some nodes removed (and their edges) plus extra edges. */
function variant(drop: string[], extraEdges: Diagram['edges'] = [], dropEdges: [string, string][] = []): Diagram {
  const gone = new Set(drop)
  return {
    nodes: ref.diagram.nodes.filter((n) => !gone.has(n.id)),
    edges: [
      ...ref.diagram.edges.filter(
        (e) => !gone.has(e.source) && !gone.has(e.target) && !dropEdges.some(([s, t]) => e.source === s && e.target === t),
      ),
      ...extraEdges,
    ],
  }
}

const coreIds = notifyHub.checks.filter((c) => c.category === 'core').map((c) => c.id)

type Node = Diagram['nodes'][number]
/** Reference diagram edited: drop nodes/edges, patch node fields, add nodes and edges. */
function edit(o: {
  drop?: string[]
  dropEdges?: [string, string][]
  patch?: Record<string, Partial<Node>>
  nodes?: Node[]
  edges?: [string, string, Diagram['edges'][number]['protocol'], string?][]
}): Diagram {
  const base = variant(o.drop ?? [], [], o.dropEdges ?? [])
  return {
    nodes: [...base.nodes.map((n) => ({ ...n, ...(o.patch?.[n.id] ?? {}) })), ...(o.nodes ?? [])],
    edges: [
      ...base.edges,
      ...(o.edges ?? []).map(([source, target, protocol, label], i) => ({ id: `t${i}-${source}-${target}`, source, target, protocol, label })),
    ],
  }
}
const node = (id: string, kind: Node['kind'], label: string, x: number, y: number, extra: Partial<Node> = {}): Node => ({
  id,
  kind,
  label,
  x,
  y,
  domains: [],
  ...extra,
})
const expectCorePass = (d: Diagram, decisions?: Decisions) => {
  const { byId } = results(d, decisions)
  for (const id of coreIds) expect(byId(id).pass, `${id}: ${byId(id).detail ?? ''}`).toBe(true)
}

describe('pingly-notifications', () => {
  assertScenarioContract(notifyHub)

  it('starter fails the hand-off, priority, DLQ checks and trips the inline-send anti-pattern', () => {
    const { ev, failed } = results(notifyHub.starter!, notifyHub.starterDecisions)
    expect(ev.passed).toBe(false)
    expect(failed).toEqual(expect.arrayContaining(['async-handoff', 'priority-lane', 'retries-dlq', 'anti-inline-send', 'style-fit']))
  })

  it('mistake: one shared queue for everything fails the priority lane', () => {
    const { ev, failed } = results(variant(['priQ', 'priW']))
    expect(failed).toContain('priority-lane')
    expect(failed).toContain('dedicated-priority-senders')
    expect(failed).not.toContain('retries-dlq')
    expect(ev.passed).toBe(false)
  })

  it('mistake: two queues drained by the same worker pool passes the lane but not the dedicated-senders bonus', () => {
    const shared = variant(['priW'], [{ id: 'x1', source: 'priQ', target: 'bulkW', protocol: 'event' }])
    const { failed } = results(shared)
    expect(failed).not.toContain('priority-lane')
    expect(failed).toContain('dedicated-priority-senders')
  })

  it('mistake: retrying forever without a dead-letter queue fails retries-dlq', () => {
    const { ev, failed } = results(variant(['dlq']))
    expect(failed).toContain('retries-dlq')
    expect(ev.passed).toBe(false)
  })

  it('mistake: a "delivery status" bus fed by the product app is not a DLQ', () => {
    // Senders publish status back to the main event bus — that is not a place to park failed messages.
    const d = variant(['dlq'], [{ id: 'x2', source: 'bulkW', target: 'bus', protocol: 'event' }, { id: 'x3', source: 'priW', target: 'bus', protocol: 'event' }])
    expect(results(d).failed).toContain('retries-dlq')
  })

  it('mistake: senders consume the event bus directly, bypassing preferences', () => {
    const d = variant(
      [],
      [
        { id: 'x4', source: 'bus', target: 'priW', protocol: 'event' },
        { id: 'x5', source: 'bus', target: 'bulkW', protocol: 'event' },
      ],
      [
        ['notif', 'priQ'],
        ['notif', 'bulkQ'],
        ['priQ', 'priW'],
        ['bulkQ', 'bulkW'],
      ],
    )
    const { failed } = results(d)
    expect(failed).toContain('channel-providers')
  })

  it('mistake: the monolith calls the notification service synchronously', () => {
    const d = variant(['bus'], [{ id: 'x6', source: 'app', target: 'notif', protocol: 'http' }])
    expect(results(d).failed).toContain('async-handoff')
  })

  it('mistake: the Rails app still sends SMS inline next to the new platform', () => {
    const d = variant([], [{ id: 'x7', source: 'app', target: 'twilio', protocol: 'http' }])
    const { failed } = results(d)
    expect(failed).toContain('anti-inline-send')
    expect(failed.filter((id) => coreIds.includes(id))).toEqual([])
  })

  it('mistake: no SMS provider and no preference store', () => {
    const d = variant(['twilio', 'prefsDb'])
    const { failed } = results(d)
    expect(failed).toEqual(expect.arrayContaining(['channel-providers', 'preferences-respected']))
  })

  it('alternative: outbox + Kafka, RabbitMQ per-channel queues with Lambda senders, broker-side DLX and a realtime inbox passes every core check', () => {
    const alt = diagram(
      [
        ['web', 'web-app', 'Web', 0, 100, { tech: 'vue' }],
        ['mobile', 'mobile-app', 'Mobile', 0, 260, { tech: 'flutter' }],
        ['gw', 'api-gateway', 'Gateway', 260, 100, { tech: 'envoy' }],
        ['rt', 'realtime-gateway', 'Live Updates', 260, 300, { tech: 'centrifugo' }],
        ['app', 'monolith', 'Pingly App', 520, 0, { tech: 'rails', w: 260, h: 160 }],
        ['projects', 'module', 'Projects', 30, 60, { parent: 'app', tech: 'rails', domains: ['projects'] }],
        ['appDb', 'relational-db', 'App DB + outbox', 860, -80, { tech: 'postgres' }],
        ['cdc', 'cdc', 'Outbox Relay', 860, 40, { tech: 'debezium' }],
        ['kafka', 'broker', 'Kafka', 1100, 40, { tech: 'kafka' }],
        ['notif', 'service', 'Notifications', 1100, 200, { tech: 'nestjs', domains: ['notification-processing', 'preferences'] }],
        ['notifDb', 'document-db', 'Templates & Prefs', 1360, 200, { tech: 'mongodb' }],
        ['inbox', 'service', 'Inbox', 520, 300, { tech: 'go', domains: ['in-app-inbox'] }],
        ['inboxDb', 'wide-column', 'Inbox Store', 780, 300, { tech: 'cassandra' }],
        ['emailQ', 'broker', 'Email queue', 1360, 340, { tech: 'rabbitmq' }],
        ['pushQ', 'broker', 'Push queue', 1360, 440, { tech: 'rabbitmq' }],
        ['smsQ', 'broker', 'SMS queue', 1360, 540, { tech: 'rabbitmq' }],
        ['critQ', 'broker', 'Critical queue', 1360, 640, { tech: 'rabbitmq' }],
        ['graveyard', 'broker', 'Graveyard', 1620, 760, { tech: 'rabbitmq' }],
        ['emailFn', 'function', 'Email sender', 1620, 340, { tech: 'aws-lambda', domains: ['channel-delivery'] }],
        ['pushFn', 'function', 'Push sender', 1620, 440, { tech: 'aws-lambda', domains: ['channel-delivery'] }],
        ['smsFn', 'function', 'SMS sender', 1620, 540, { tech: 'aws-lambda', domains: ['channel-delivery'] }],
        ['critW', 'worker', 'Critical sender', 1620, 640, { tech: 'bullmq', domains: ['channel-delivery'] }],
        ['postmark', 'external', 'Postmark', 1880, 340, { tech: 'postmark' }],
        ['onesignal', 'external', 'OneSignal', 1880, 440, { tech: 'onesignal' }],
        ['twilio', 'external', 'Twilio', 1880, 540, { tech: 'twilio' }],
        ['metrics', 'metrics', 'Metrics', 1100, 860, { tech: 'datadog' }],
      ],
      [
        ['web', 'gw'],
        ['mobile', 'gw'],
        ['web', 'rt', 'websocket'],
        ['mobile', 'rt', 'websocket'],
        ['gw', 'app', 'http'],
        ['projects', 'appDb'],
        ['cdc', 'appDb', 'data'],
        ['appDb', 'cdc', 'event'],
        ['cdc', 'kafka'],
        ['kafka', 'notif'],
        ['notif', 'notifDb'],
        ['notif', 'kafka', 'event', 'InAppNotification'],
        ['kafka', 'inbox'],
        ['inbox', 'inboxDb'],
        ['inbox', 'rt', 'http', 'publish to user channel'],
        ['notif', 'emailQ'],
        ['notif', 'pushQ'],
        ['notif', 'smsQ'],
        ['notif', 'critQ'],
        ['emailQ', 'emailFn'],
        ['pushQ', 'pushFn'],
        ['smsQ', 'smsFn'],
        ['critQ', 'critW'],
        ['emailFn', 'postmark', 'http'],
        ['pushFn', 'onesignal', 'http'],
        ['smsFn', 'twilio', 'http'],
        ['critW', 'postmark', 'http'],
        ['critW', 'twilio', 'http'],
        ['emailQ', 'graveyard', 'event', 'x-dead-letter-exchange'],
        ['smsQ', 'graveyard', 'event', 'x-dead-letter-exchange'],
        ['critQ', 'graveyard', 'event', 'x-dead-letter-exchange'],
        ['graveyard', 'metrics', 'telemetry'],
        ['emailFn', 'metrics', 'telemetry'],
        ['critW', 'metrics', 'telemetry'],
      ],
    )
    const { ev, byId } = results(alt, { style: 'microservices', communication: 'async', data: 'per-service', stack: {} })
    for (const id of [...coreIds, 'domains-owned', 'style-fit']) expect(byId(id).pass, `${id}: ${byId(id).detail ?? ''}`).toBe(true)
    for (const r of ev.results.filter((x) => x.category === 'antipattern')) expect(r.pass, `${r.id}: ${r.detail ?? ''}`).toBe(true)
    expect(ev.passed).toBe(true)
  })

  it('alternative: one Kafka broker with a topic marked as the priority lane is accepted', () => {
    const d = diagram(
      [
        ['web', 'web-app', 'Web', 0, 100, { tech: 'react' }],
        ['app', 'monolith', 'Pingly App', 260, 100, { tech: 'rails', domains: ['projects'] }],
        ['kafka', 'broker', 'Kafka', 520, 100, { tech: 'kafka', notes: 'topics: events, otp-priority, bulk' }],
        ['notif', 'service', 'Notifications', 780, 100, { tech: 'go', domains: ['notification-processing', 'preferences', 'in-app-inbox'] }],
        ['db', 'relational-db', 'Notif DB', 1040, 100, { tech: 'postgres' }],
        ['sender', 'worker', 'Senders', 780, 260, { tech: 'go', domains: ['channel-delivery'] }],
        ['dlq', 'broker', 'DLQ', 1040, 260, { tech: 'kafka' }],
        ['ses', 'external', 'SES', 1040, 380, { tech: 'ses' }],
        ['fcm', 'external', 'FCM', 1040, 480, { tech: 'fcm' }],
        ['sms', 'external', 'SMSAPI', 1040, 580, { tech: 'generic-api' }],
      ],
      [
        ['web', 'app', 'http'],
        ['app', 'notif', 'http', 'GET inbox'],
        ['app', 'kafka', 'event'],
        ['kafka', 'notif'],
        ['notif', 'db'],
        ['notif', 'kafka', 'event'],
        ['kafka', 'sender'],
        ['sender', 'ses', 'http'],
        ['sender', 'fcm', 'http'],
        ['sender', 'sms', 'http'],
        ['sender', 'dlq', 'event'],
      ],
    )
    const { byId } = results(d)
    for (const id of coreIds) expect(byId(id).pass, `${id}: ${byId(id).detail ?? ''}`).toBe(true)
    expect(byId('dedicated-priority-senders').pass).toBe(false)
  })

  // --- Regression tests for gameable / unfair checks -------------------------

  it('gaming: one shared queue whose notes say "high throughput" or "security" is not a priority lane', () => {
    for (const notes of ['Go workers, high throughput', 'highly available, security-scanned images']) {
      const d = edit({ drop: ['priQ', 'priW'], patch: { bulkW: { notes }, bulkQ: { notes } } })
      const { failed } = results(d)
      expect(failed).toContain('priority-lane')
      expect(failed).toContain('dedicated-priority-senders')
    }
  })

  it('gaming: a retry queue fed back to the senders is neither a priority lane nor a DLQ', () => {
    const retry = node('retryQ', 'broker', 'Retry queue', 1300, 320, { tech: 'sqs' })
    const loop = edit({ drop: ['priQ', 'priW', 'dlq'], nodes: [retry], edges: [['bulkW', 'retryQ', 'event'], ['retryQ', 'bulkW', 'event']] })
    const { failed } = results(loop)
    expect(failed).toEqual(expect.arrayContaining(['priority-lane', 'retries-dlq']))
  })

  it('gaming: a "Retry queue" that redelivers straight into the lane is not a dead-letter queue', () => {
    const retry = node('retryQ', 'broker', 'Retry queue (failed)', 1300, 320, { tech: 'sqs', notes: 'redeliver after delay' })
    const d = edit({
      drop: ['dlq'],
      nodes: [retry],
      edges: [
        ['priW', 'retryQ', 'event'],
        ['bulkW', 'retryQ', 'event'],
        ['retryQ', 'bulkQ', 'event', 'redeliver'],
      ],
    })
    const { failed, byId } = results(d)
    expect(failed).toContain('retries-dlq')
    expect(byId('retries-dlq').detail).toMatch(/loop forever/)
  })

  it('alternative: failed sends parked in a table (with a replay tool) count as dead letters', () => {
    const table = node('failedDb', 'relational-db', 'Failed sends (dead letters)', 1300, 320, { tech: 'postgres' })
    const d = edit({ drop: ['dlq'], nodes: [table], edges: [['priW', 'failedDb', 'data'], ['bulkW', 'failedDb', 'data']] })
    expect(results(d).byId('retries-dlq').pass).toBe(true)
  })

  it('gaming: an event-protocol edge from the app straight to SendGrid is still an inline send', () => {
    const sg = node('sendgrid', 'external', 'SendGrid', 1820, 340, { tech: 'sendgrid' })
    const d = edit({ nodes: [sg], edges: [['app', 'sendgrid', 'event', 'send digest']] })
    const { failed, ev } = results(d)
    expect(failed).toContain('anti-inline-send')
    expect(ev.score).toBeLessThan(100)
  })

  it('alternative: separate providers per lane (Postmark + Twilio Verify for OTP, SES/FCM/Twilio for bulk) passes, with dedicated senders', () => {
    const d = edit({
      dropEdges: [
        ['priW', 'ses'],
        ['priW', 'fcm'],
        ['priW', 'twilio'],
      ],
      patch: {
        priQ: { label: 'Transactional queue', notes: undefined },
        priW: { label: 'Transactional senders', notes: undefined },
      },
      nodes: [
        node('postmark', 'external', 'Postmark', 1820, -220, { tech: 'postmark' }),
        node('verify', 'external', 'Twilio Verify', 1820, -360, { tech: 'twilio' }),
      ],
      edges: [
        ['priW', 'postmark', 'http'],
        ['priW', 'verify', 'http'],
      ],
    })
    const { ev, byId } = results(d)
    expectCorePass(d)
    expect(byId('dedicated-priority-senders').pass).toBe(true)
    expect(ev.passed).toBe(true)
  })

  it('mistake: per-channel queues alone (email, push, SMS) still make an OTP email wait behind the digest', () => {
    const d = diagram(
      [
        ['web', 'web-app', 'Web', 0, 0, { tech: 'react' }],
        ['app', 'monolith', 'App', 260, 0, { tech: 'rails', domains: ['projects'] }],
        ['bus', 'broker', 'Bus', 520, 0, { tech: 'sqs' }],
        ['notif', 'service', 'Notifications', 780, 0, { tech: 'go', domains: ['notification-processing', 'preferences', 'in-app-inbox'] }],
        ['db', 'relational-db', 'DB', 780, 160, { tech: 'postgres' }],
        ['eq', 'broker', 'Email queue', 1040, 0, { tech: 'sqs' }],
        ['pq', 'broker', 'Push queue', 1040, 100, { tech: 'sqs' }],
        ['sq', 'broker', 'SMS queue', 1040, 200, { tech: 'sqs' }],
        ['ew', 'worker', 'Email sender', 1300, 0, { tech: 'go', domains: ['channel-delivery'] }],
        ['pw', 'worker', 'Push sender', 1300, 100, { tech: 'go', domains: ['channel-delivery'] }],
        ['sw', 'worker', 'SMS sender', 1300, 200, { tech: 'go', domains: ['channel-delivery'] }],
        ['ses', 'external', 'SES', 1560, 0, { tech: 'ses' }],
        ['fcm', 'external', 'FCM', 1560, 100, { tech: 'fcm' }],
        ['tw', 'external', 'Twilio', 1560, 200, { tech: 'twilio' }],
      ],
      [
        ['web', 'app', 'http'],
        ['web', 'notif', 'http'],
        ['app', 'bus', 'event'],
        ['bus', 'notif'],
        ['notif', 'db'],
        ['notif', 'eq', 'event'],
        ['notif', 'pq', 'event'],
        ['notif', 'sq', 'event'],
        ['eq', 'ew'],
        ['pq', 'pw'],
        ['sq', 'sw'],
        ['ew', 'ses', 'http'],
        ['pw', 'fcm', 'http'],
        ['sw', 'tw', 'http'],
      ],
    )
    const { byId } = results(d)
    expect(byId('priority-lane').pass).toBe(false)
    expect(byId('priority-lane').detail).toMatch(/split traffic by channel/)
  })

  it('gaming: a sync "send" call to a processing service that also owns preferences fails the hand-off; a read call does not', () => {
    const merged = {
      drop: ['prefs'],
      patch: { notif: { domains: ['notification-processing', 'preferences'] } },
    }
    const inline = edit({ ...merged, edges: [['notif', 'prefsDb', 'data'], ['app', 'notif', 'http', 'POST /notify (inline)']] })
    expect(results(inline).failed).toContain('async-handoff')
    const read = edit({ ...merged, edges: [['notif', 'prefsDb', 'data'], ['app', 'notif', 'http', 'GET preferences']] })
    expect(results(read).byId('async-handoff').pass).toBe(true)
  })

  it('mistake: in-app inbox without a store, without a client path, or never fed by processing', () => {
    expect(results(variant(['inboxDb'])).byId('in-app-inbox').detail).toMatch(/not stored/)
    const noClient = results(variant([], [], [['gw', 'inbox']])).byId('in-app-inbox')
    expect(noClient.pass).toBe(false)
    expect(noClient.detail).toBe('No client can reach the inbox.')
    expect(results(variant([], [], [['notif', 'inbox']])).byId('in-app-inbox').detail).toMatch(/never delivers/)
  })

  it('alternative: the reference declared as serverless passes every core check', () => {
    expectCorePass(ref.diagram, { ...ref.decisions, style: 'serverless' })
  })

  it('providers: AWS SNS / End User Messaging count for SMS by label, "Licenses" does not count as email', () => {
    const sns = edit({ patch: { twilio: { label: 'AWS End User Messaging (SMS)', tech: undefined } } })
    expect(results(sns).byId('channel-providers').pass).toBe(true)
    const lic = edit({ patch: { ses: { label: 'Licenses API', tech: 'generic-api' } } })
    expect(results(lic).byId('channel-providers').detail).toMatch(/email provider/)
  })

  it('odd graphs do not throw', () => {
    const odd = diagram(
      [
        ['q', 'broker', 'Lonely queue', 0, 0],
        ['p', 'external', 'Twilio', 260, 0],
      ],
      [['q', 'p', 'event']],
    )
    const ev = evaluateScenario(notifyHub, odd, { stack: {} })
    expect(ev.results.every((r) => !r.detail?.startsWith('Check failed to run'))).toBe(true)
    expect(ev.passed).toBe(false)
  })
})

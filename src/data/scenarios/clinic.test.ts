import { describe, expect, it } from 'vitest'
import { assertScenarioContract } from '../../engine/scenarioContract'
import { evaluateScenario } from '../../engine/evaluate'
import { diagram, type EdgeSpec, type NodeSpec } from './builder'
import { clinicBooking } from './clinic'
import type { Decisions, Diagram } from '../../engine/types'

function failing(d: Diagram, decisions: Decisions = modular) {
  const ev = evaluateScenario(clinicBooking, d, decisions)
  const result = (id: string) => ev.results.find((r) => r.id === id)
  return { ev, result, failed: ev.results.filter((r) => !r.pass).map((r) => r.id) }
}

const modular: Decisions = { style: 'modular-monolith', communication: 'hybrid', data: 'shared', stack: {} }

/** A sound modular monolith without its reminders part; each test adds its own reminder design. */
function modularApp(nodes: NodeSpec[], edges: EdgeSpec[]): Diagram {
  return diagram(
    [
      ['web', 'web-app', 'Patient Web', 0, 40, { tech: 'nextjs' }],
      ['panel', 'web-app', 'Clinic Panel', 0, 320, { tech: 'react' }],
      ['cdn', 'cdn', 'CDN', 260, 180, { tech: 'cloudflare' }],
      ['idp', 'identity', 'Staff SSO', 260, 320, { tech: 'entra' }],
      ['app', 'monolith', 'App', 520, 40, { tech: 'spring-boot', w: 500, h: 480 }],
      ['directory', 'module', 'Directory', 270, 20, { parent: 'app', tech: 'spring-boot', domains: ['directory'] }],
      ['availability', 'module', 'Availability', 270, 110, { parent: 'app', tech: 'spring-boot', domains: ['availability'] }],
      ['booking', 'module', 'Booking', 270, 200, { parent: 'app', tech: 'spring-boot', domains: ['booking'] }],
      ['admin', 'module', 'Clinic Admin', 270, 300, { parent: 'app', tech: 'spring-boot', domains: ['clinic-admin'] }],
      ['pg', 'relational-db', 'DB', 1120, 285, { tech: 'postgres' }],
      ['redis', 'cache', 'Slot Cache', 1120, 150, { tech: 'redis' }],
      ['search', 'search', 'Search', 1400, 60, { tech: 'meilisearch' }],
      ['sms', 'external', 'SMSAPI.pl', 1680, 380],
      ['mail', 'external', 'Amazon SES', 1680, 500, { tech: 'ses' }],
      ...nodes,
    ],
    [
      ['web', 'cdn'],
      ['panel', 'cdn'],
      ['panel', 'idp', 'http'],
      ['cdn', 'app', 'http'],
      ['directory', 'search'],
      ['availability', 'redis'],
      ['availability', 'pg'],
      ['booking', 'pg'],
      ['admin', 'pg'],
      ...edges,
    ],
  )
}

/** The reminder part of the reference: booking → db-queue → worker → SMS/email. */
const queueWorker: [NodeSpec[], EdgeSpec[]] = [
  [
    ['queue', 'broker', 'Job Queue', 1120, 420, { tech: 'db-queue' }],
    ['worker', 'worker', 'Reminder Worker', 1400, 420, { tech: 'spring-boot', domains: ['notifications'] }],
  ],
  [
    ['booking', 'queue', 'event', 'remind at T-24h'],
    ['queue', 'worker', 'event'],
    ['worker', 'pg', 'data'],
    ['worker', 'sms', 'http'],
    ['worker', 'mail', 'http'],
  ],
]

function expectCoreGreen(d: Diagram, decisions: Decisions = modular) {
  const { ev } = failing(d, decisions)
  const bad = ev.results.filter((r) => (r.category === 'core' || r.category === 'antipattern') && !r.pass).map((r) => `${r.id}: ${r.detail ?? ''}`)
  expect(bad).toEqual([])
  expect(ev.passed).toBe(true)
}

describe('medislot-booking', () => {
  assertScenarioContract(clinicBooking)

  // --- typical learner mistakes ------------------------------------------------

  it('wrong: availability cache decides bookings and reminders are called inline', () => {
    const d = diagram(
      [
        ['web', 'web-app', 'Patient Web', 0, 100, { tech: 'react' }],
        ['panel', 'web-app', 'Clinic Panel', 0, 240, { tech: 'react' }],
        ['idp', 'identity', 'SSO', 260, 360, { tech: 'auth0' }],
        ['lb', 'load-balancer', 'LB', 260, 160, { tech: 'nginx' }],
        ['app', 'monolith', 'App', 520, 40, { tech: 'spring-boot', w: 500, h: 330 }],
        ['directory', 'module', 'Directory', 30, 60, { parent: 'app', tech: 'spring-boot', domains: ['directory'] }],
        ['availability', 'module', 'Availability', 270, 60, { parent: 'app', tech: 'spring-boot', domains: ['availability'] }],
        ['booking', 'module', 'Booking', 270, 200, { parent: 'app', tech: 'spring-boot', domains: ['booking'] }],
        ['admin', 'module', 'Clinic Admin', 30, 200, { parent: 'app', tech: 'spring-boot', domains: ['clinic-admin', 'notifications'] }],
        ['redis', 'cache', 'Slots (Redis)', 1120, 100, { tech: 'redis' }],
        ['pg', 'relational-db', 'DB', 1120, 240, { tech: 'postgres' }],
        ['search', 'search', 'Search', 1120, 0, { tech: 'meilisearch' }],
        ['sms', 'external', 'Twilio', 1120, 400, { tech: 'twilio' }],
        ['mail', 'external', 'SendGrid', 1120, 500, { tech: 'sendgrid' }],
      ],
      [
        ['web', 'lb'],
        ['panel', 'lb'],
        ['panel', 'idp', 'http'],
        ['lb', 'app'],
        ['directory', 'search'],
        ['availability', 'redis'],
        ['booking', 'redis', 'data', 'SETNX slot'],
        ['admin', 'pg'],
        ['booking', 'admin', 'http', 'send reminder'],
        ['admin', 'sms', 'http'],
        ['admin', 'mail', 'http'],
      ],
    )
    const { ev, failed, result } = failing(d)
    expect(failed).toContain('booking-transactional-store')
    expect(failed).toContain('reminders-background')
    expect(result('booking-transactional-store')?.detail).toMatch(/cache/)
    expect(ev.passed).toBe(false)
  })

  it('wrong: SQL LIKE directory, no SSO, booking texts the patient inline', () => {
    const d = diagram(
      [
        ['web', 'web-app', 'Patient Web', 0, 100, { tech: 'react' }],
        ['panel', 'web-app', 'Clinic Panel', 0, 240, { tech: 'react' }],
        ['app', 'monolith', 'App', 520, 40, { tech: 'spring-boot', w: 500, h: 330 }],
        ['directory', 'module', 'Directory', 30, 60, { parent: 'app', tech: 'spring-boot', domains: ['directory', 'clinic-admin'] }],
        ['availability', 'module', 'Availability', 270, 60, { parent: 'app', tech: 'spring-boot', domains: ['availability'] }],
        ['booking', 'module', 'Booking', 270, 200, { parent: 'app', tech: 'spring-boot', domains: ['booking'] }],
        ['pg', 'relational-db', 'DB', 1120, 240, { tech: 'postgres' }],
        ['queue', 'broker', 'Queue', 640, 440, { tech: 'rabbitmq' }],
        ['worker', 'worker', 'Reminders', 900, 440, { tech: 'spring-boot', domains: ['notifications'] }],
        ['sms', 'external', 'Twilio', 1160, 400, { tech: 'twilio' }],
        ['mail', 'external', 'SES', 1160, 500, { tech: 'ses' }],
      ],
      [
        ['web', 'app'],
        ['panel', 'app'],
        ['directory', 'pg', 'data', 'LIKE %cardio%'],
        ['availability', 'pg'],
        ['booking', 'pg'],
        ['booking', 'sms', 'http', 'confirmation SMS'],
        ['booking', 'queue', 'event'],
        ['queue', 'worker', 'event'],
        ['worker', 'sms', 'http'],
        ['worker', 'mail', 'http'],
      ],
    )
    const { failed } = failing(d)
    expect(failed).toContain('directory-search-engine')
    expect(failed).toContain('staff-identity')
    expect(failed).toContain('anti-sync-provider')
    expect(failed).not.toContain('reminders-background')
  })

  it('wrong: microservices sharing one database', () => {
    const d = diagram(
      [
        ['web', 'web-app', 'Patient Web', 0, 100, { tech: 'react' }],
        ['gw', 'api-gateway', 'Gateway', 260, 100, { tech: 'kong' }],
        ['dir', 'service', 'Directory', 520, 0, { tech: 'nestjs', domains: ['directory', 'clinic-admin'] }],
        ['avail', 'service', 'Availability', 520, 120, { tech: 'nestjs', domains: ['availability'] }],
        ['book', 'service', 'Booking', 520, 240, { tech: 'nestjs', domains: ['booking', 'notifications'] }],
        ['pg', 'relational-db', 'Shared DB', 900, 120, { tech: 'postgres' }],
      ],
      [
        ['web', 'gw'],
        ['gw', 'dir'],
        ['gw', 'avail'],
        ['gw', 'book'],
        ['dir', 'pg'],
        ['avail', 'pg'],
        ['book', 'pg'],
      ],
    )
    const { failed } = failing(d, { style: 'microservices', communication: 'sync', data: 'shared', stack: {} })
    expect(failed).toContain('style-fit')
    expect(failed).toContain('anti-shared-db')
  })

  // --- alternative valid designs -------------------------------------------------

  it('alternative: plain Django monolith with Celery workers and RabbitMQ passes every core check', () => {
    const d = diagram(
      [
        ['web', 'web-app', 'Patient Web', 0, 40, { tech: 'nuxt' }],
        ['mobile', 'mobile-app', 'Patient App', 0, 180, { tech: 'flutter' }],
        ['panel', 'web-app', 'Clinic Panel', 0, 320, { tech: 'vue' }],
        ['lb', 'load-balancer', 'Load Balancer', 260, 180, { tech: 'aws-alb' }],
        ['idp', 'identity', 'Staff Login', 260, 400, { tech: 'auth0' }],
        ['app', 'monolith', 'MediSlot (Django)', 520, 160, { tech: 'django', domains: ['directory', 'availability', 'booking', 'clinic-admin'] }],
        ['mysql', 'relational-db', 'Bookings DB', 900, 160, { tech: 'mysql', notes: "UPDATE slots … WHERE status='free' — one winner" }],
        ['typesense', 'search', 'Doctor Index', 900, 40, { tech: 'typesense' }],
        ['rabbit', 'broker', 'Task Broker', 520, 400, { tech: 'rabbitmq' }],
        ['reminders', 'worker', 'Reminder Tasks', 780, 400, { tech: 'celery', domains: ['notifications'] }],
        ['indexer', 'worker', 'Index Tasks', 780, 520, { tech: 'celery' }],
        ['sms', 'external', 'SMS Gateway', 1040, 360, { tech: 'twilio' }],
        ['mail', 'external', 'Amazon SES', 1040, 460, { tech: 'ses' }],
      ],
      [
        ['web', 'lb'],
        ['mobile', 'lb'],
        ['panel', 'lb'],
        ['panel', 'idp', 'http'],
        ['lb', 'app'],
        ['app', 'mysql'],
        ['app', 'typesense', 'data', 'search queries'],
        ['app', 'rabbit', 'event', 'celery eta=T-24h'],
        ['rabbit', 'reminders', 'event'],
        ['rabbit', 'indexer', 'event'],
        ['indexer', 'typesense', 'data'],
        ['reminders', 'mysql', 'data'],
        ['reminders', 'sms', 'http'],
        ['reminders', 'mail', 'http'],
      ],
    )
    expectCoreGreen(d, { style: 'monolith', communication: 'hybrid', data: 'shared', stack: {} })
    expect(failing(d).result('search-indexed-async')?.pass).toBe(true)
  })

  it('alternative: Booking calls a Reminders module API in-process that only enqueues to a db-queue', () => {
    const d = modularApp(
      [
        ['notif', 'module', 'Reminders', 270, 400, { parent: 'app', tech: 'spring-boot', domains: ['notifications'] }],
        ['queue', 'broker', 'Job Queue', 1120, 420, { tech: 'db-queue' }],
        ['worker', 'worker', 'Sender', 1400, 420, { tech: 'spring-boot', domains: ['notifications'] }],
      ],
      [
        ['booking', 'notif', 'http', 'scheduleReminder()'],
        ['notif', 'queue', 'event', 'insert job'],
        ['queue', 'worker', 'event'],
        ['worker', 'sms', 'http'],
        ['worker', 'mail', 'http'],
      ],
    )
    expectCoreGreen(d)
  })

  it('alternative: a Reminders module inside the app polls due visits on a schedule', () => {
    const d = modularApp(
      [['notif', 'module', 'Reminders (JobRunr)', 270, 400, { parent: 'app', tech: 'spring-boot', domains: ['notifications'] }]],
      [
        ['notif', 'pg', 'data', 'visits due in 24h'],
        ['notif', 'sms', 'http'],
        ['notif', 'mail', 'http'],
      ],
    )
    expectCoreGreen(d)
  })

  it('alternative: a db-queue drained by the application itself (Reminders module inside it)', () => {
    const d = modularApp(
      [
        ['notif', 'module', 'Reminders', 270, 400, { parent: 'app', tech: 'spring-boot', domains: ['notifications'] }],
        ['queue', 'broker', 'Job Queue', 1120, 420, { tech: 'db-queue' }],
      ],
      [
        ['booking', 'queue', 'event', 'remind at T-24h'],
        ['queue', 'app', 'event', 'due jobs'],
        ['notif', 'sms', 'http'],
        ['notif', 'mail', 'http'],
      ],
    )
    expectCoreGreen(d)
  })

  it('alternative: MongoDB with a unique index decides bookings', () => {
    const d = modularApp(
      [
        ['mongo', 'document-db', 'Bookings', 1120, 560, { tech: 'mongodb', notes: 'unique index (doctorId, slotStart)' }],
        ...queueWorker[0],
      ],
      [['booking', 'mongo', 'data'], ...queueWorker[1].filter(([s, t]) => !(s === 'worker' && t === 'pg')), ['worker', 'mongo', 'data']],
    )
    // Booking also writes pg in the base; remove that to make Mongo the only store.
    d.edges = d.edges.filter((e) => !(e.source === 'booking' && e.target === 'pg'))
    expect(failing(d).result('booking-transactional-store')?.pass).toBe(true)
    expectCoreGreen(d)
  })

  it('alternative: Cloudflare drawn as a WAF in front of the backend still counts as the spike edge', () => {
    const d = modularApp(queueWorker[0], queueWorker[1])
    const cdn = d.nodes.find((n) => n.id === 'cdn')!
    cdn.kind = 'waf'
    expect(failing(d).result('spike-edge')?.pass).toBe(true)
    expectCoreGreen(d)
  })

  // --- gaming attempts and regression tests ------------------------------------------

  it('gaming: Booking texts inline but also consumes an unrelated queue — still an anti-pattern', () => {
    const d = modularApp(queueWorker[0], [
      ...queueWorker[1],
      ['booking', 'sms', 'http', 'confirmation SMS inline'],
      ['queue', 'booking', 'event', 'slot released'],
    ])
    const { failed, ev } = failing(d)
    expect(failed).toContain('anti-sync-provider')
    expect(ev.score).toBeLessThan(100)
  })

  it('gaming: a direct booking → worker edge relabelled "event" without a broker is not a queue', () => {
    const d = modularApp(
      [['worker', 'worker', 'Reminder Worker', 1400, 420, { tech: 'spring-boot', domains: ['notifications'] }]],
      [
        ['booking', 'worker', 'event', 'remind'],
        ['worker', 'pg', 'data'],
        ['worker', 'sms', 'http'],
        ['worker', 'mail', 'http'],
      ],
    )
    expect(failing(d).failed).toContain('reminders-background')
  })

  it('gaming: a worker with a data edge to a cache is not a scheduled job over visits', () => {
    const d = modularApp(
      [['worker', 'worker', 'Reminder Worker', 1400, 420, { tech: 'spring-boot', domains: ['notifications'] }]],
      [
        ['worker', 'redis', 'data'],
        ['worker', 'sms', 'http'],
        ['worker', 'mail', 'http'],
      ],
    )
    expect(failing(d).failed).toContain('reminders-background')
  })

  it('a reminder worker that is called synchronously by booking is not "background"', () => {
    const ref = clinicBooking.reference.diagram
    const d: Diagram = {
      nodes: ref.nodes,
      edges: [...ref.edges, { id: 'sync', source: 'booking', target: 'worker', protocol: 'http' }],
    }
    expect(failing(d, clinicBooking.reference.decisions).failed).toContain('reminders-background')
  })

  it('gaming: Booking decides in Redis while only the container talks to PostgreSQL', () => {
    const d = modularApp(queueWorker[0], [...queueWorker[1], ['booking', 'redis', 'data', 'SETNX slot'], ['app', 'pg', 'data']])
    d.edges = d.edges.filter((e) => !(e.source === 'booking' && e.target === 'pg'))
    const { failed, result } = failing(d)
    expect(failed).toContain('booking-transactional-store')
    expect(result('booking-transactional-store')?.detail).toMatch(/cache/)
  })

  it('container-level data edge is accepted when Booking draws no data edges itself', () => {
    const d = modularApp(queueWorker[0], [...queueWorker[1], ['app', 'pg', 'data']])
    d.edges = d.edges.filter((e) => !(e.source === 'booking' && e.target === 'pg'))
    expect(failing(d).result('booking-transactional-store')?.pass).toBe(true)
  })

  it('a document store without a chosen technology explains the preference', () => {
    const d = modularApp([['doc', 'document-db', 'Bookings', 1120, 560], ...queueWorker[0]], [['booking', 'doc', 'data'], ...queueWorker[1]])
    d.edges = d.edges.filter((e) => !(e.source === 'booking' && e.target === 'pg'))
    const { result } = failing(d)
    expect(result('booking-transactional-store')?.pass).toBe(false)
    expect(result('booking-transactional-store')?.detail).toMatch(/unique index or conditional write/)
  })

  it('gaming: an identity provider attached only to the reminder worker is not staff SSO', () => {
    const d = modularApp(queueWorker[0], [...queueWorker[1], ['worker', 'idp', 'http']])
    d.edges = d.edges.filter((e) => !(e.source === 'panel' && e.target === 'idp'))
    expect(failing(d).failed).toContain('staff-identity')
  })

  it('a dead-end CDN does not count as the spike edge', () => {
    const d = modularApp(queueWorker[0], [...queueWorker[1], ['web', 'app', 'http'], ['panel', 'app', 'http']])
    d.edges = d.edges.filter((e) => e.source !== 'cdn')
    expect(failing(d).result('spike-edge')?.pass).toBe(false)
  })

  it('Kafka for reminder jobs fails right-sized-messaging', () => {
    const d = modularApp(queueWorker[0], queueWorker[1])
    d.nodes.find((n) => n.id === 'queue')!.tech = 'kafka'
    expect(failing(d).failed).toContain('right-sized-messaging')
  })

  it('a worker with only an SMS provider is missing email', () => {
    const d = modularApp(queueWorker[0], queueWorker[1])
    d.edges = d.edges.filter((e) => !(e.source === 'worker' && e.target === 'mail'))
    const { result } = failing(d)
    expect(result('reminders-channels')?.pass).toBe(false)
    expect(result('reminders-channels')?.detail).toMatch(/an email provider/)
  })

  // --- layout -------------------------------------------------------------------

  it('reference layout: no edge passes through a node that is not one of its endpoints', () => {
    type Rect = { x: number; y: number; w: number; h: number }
    const { nodes, edges } = clinicBooking.reference.diagram
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const abs = (id: string): { x: number; y: number } => {
      const n = byId.get(id)!
      const p = n.parentId ? abs(n.parentId) : { x: 0, y: 0 }
      return { x: p.x + n.x, y: p.y + n.y }
    }
    const rect = (id: string): Rect => {
      const n = byId.get(id)!
      return { ...abs(id), w: n.width ?? 200, h: n.height ?? 64 }
    }
    const ancestors = (id: string): string[] => {
      const p = byId.get(id)?.parentId
      return p ? [p, ...ancestors(p)] : []
    }
    const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })
    // Edges are drawn centre to centre, clipped at each endpoint's border.
    const exit = (r: Rect, to: { x: number; y: number }) => {
      const c = centre(r)
      const dx = to.x - c.x
      const dy = to.y - c.y
      const t = Math.min(dx ? r.w / 2 / Math.abs(dx) : Infinity, dy ? r.h / 2 / Math.abs(dy) : Infinity, 1)
      return { x: c.x + dx * t, y: c.y + dy * t }
    }
    const crosses = (p: { x: number; y: number }, q: { x: number; y: number }, r: Rect) => {
      let t0 = 0
      let t1 = 1
      const d = [-(q.x - p.x), q.x - p.x, -(q.y - p.y), q.y - p.y]
      const m = [p.x - r.x, r.x + r.w - p.x, p.y - r.y, r.y + r.h - p.y]
      for (let i = 0; i < 4; i++) {
        if (d[i] === 0) {
          if (m[i] < 0) return false
        } else {
          const t = m[i] / d[i]
          if (d[i] < 0) t0 = Math.max(t0, t)
          else t1 = Math.min(t1, t)
        }
      }
      return t0 < t1
    }
    const problems: string[] = []
    for (const e of edges) {
      const s = rect(e.source)
      const t = rect(e.target)
      const p = exit(s, centre(t))
      const q = exit(t, centre(s))
      const skip = new Set([e.source, e.target, ...ancestors(e.source), ...ancestors(e.target)])
      for (const n of nodes) if (!skip.has(n.id) && crosses(p, q, rect(n.id))) problems.push(`${e.source} → ${e.target} crosses ${n.id}`)
    }
    expect(problems).toEqual([])
  })
})

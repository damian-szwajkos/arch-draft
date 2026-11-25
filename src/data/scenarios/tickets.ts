import type { Scenario } from '../../engine/types'
import { CLIENT_KINDS } from '../../engine/graph'
import { diagram, EMAIL, external, observability, PAYMENT } from './builder'

export const tickets: Scenario = {
  id: 'gigsy-flash-sale',
  title: 'Gigsy: concert tickets flash sale',
  tagline: '500,000 fans, 50,000 seats, two minutes. Zero oversold seats.',
  industry: 'Ticketing',
  difficulty: 'advanced',
  estMinutes: 45,
  accent: '#ec4899',
  concepts: ['queue-load-leveling', 'rate-limiting', 'caching', 'idempotency', 'acid-vs-base', 'cdn'],
  story:
    'Gigsy sells tickets for stadium tours. Last year the site crashed within 30 seconds of a major on-sale, bots bought thousands of seats, and 1,200 seats were sold twice. This year a global superstar is touring and the CEO promised the press a smooth sale. Design the platform for the on-sale event.',
  facts: [
    { label: 'Spike', value: '500k users within 2 min (normally 200 rps)' },
    { label: 'Inventory', value: '50,000 numbered seats per show' },
    { label: 'Hold', value: 'Seats held 10 min during checkout' },
    { label: 'Team', value: '4 squads, Java & TypeScript' },
  ],
  functional: [
    'Browse events and seat maps',
    'Fair virtual waiting room before the sale opens',
    'Select seats and hold them for 10 minutes',
    'Pay and receive tickets by email',
    'Released holds return to inventory automatically',
  ],
  nonFunctional: [
    'Never sell the same seat twice',
    'Survive 100× traffic spikes without falling over',
    'Block bots and scalpers',
    'Static pages and seat maps served from the edge',
  ],
  constraints: ['Payment provider confirms asynchronously via webhooks', 'Budget allows managed edge services'],
  domains: [
    { id: 'events', label: 'Events & venues', description: 'Event catalog and seat maps' },
    { id: 'waiting-room', label: 'Waiting room', description: 'Admission control / queue tokens' },
    { id: 'reservations', label: 'Seat holds', description: 'Temporary seat reservations' },
    { id: 'booking', label: 'Booking', description: 'Confirmed orders and tickets' },
    { id: 'payments', label: 'Payments', description: 'Charges and webhooks' },
    { id: 'notifications', label: 'Notifications', description: 'Ticket emails' },
  ],
  recommendedStyles: ['microservices', 'event-driven', 'space-based'],
  styleFeedback: {
    microservices: 'Good: waiting room and seat holds need to scale massively for minutes, while booking needs strict correctness — separate deployables help.',
    'event-driven': 'Good: payment confirmations and ticket issuing flow naturally as events.',
    'modular-monolith': 'Workable for normal days, but the on-sale spike hits a few capabilities 100× harder than others.',
    monolith: 'Last year’s monolith crashed within 30 seconds.',
    serverless: 'Functions scale, but cold starts and DB connection storms at 500k users are dangerous without a waiting room.',
    'service-based':
      'Coarse services sharing one database put the waiting room, seat holds and booking on the same store during a 100× spike — the database becomes the thing every fan races for. Split the hot paths and their data.',
    'space-based':
      'Strong fit — an on-sale is the classic case for this style: processing units keep seat holds and admission tokens in a partitioned in-memory grid (each seat has one owner — a replicated grid can let two units hold the same seat) and scale out for the on-sale. The final booking after payment still commits synchronously to PostgreSQL with the unique (show, seat) constraint, while holds and other state persist through data pumps and writers.',
    microkernel:
      'A plug-in core does nothing for a two-minute spike — the core process would still take all 500k users. This is a scaling and contention problem, not an extensibility one.',
  },
  hints: [
    'Absorb the spike before it reaches your services: CDN for static content, bot protection at the edge, rate limiting at the gateway.',
    'A virtual waiting room admits users at a controlled rate (queue-based load levelling).',
    'Seat holds are short-lived and contended: atomic operations with TTL in Redis.',
    'The final booking must be ACID — a unique constraint on (show, seat) is the last line of defence against double selling.',
    'Payments confirm via webhooks; turn them into events that the Booking service consumes idempotently.',
  ],
  checks: [
    {
      id: 'edge-static',
      title: 'Static content and seat maps from a CDN',
      category: 'core',
      why: 'Most on-sale traffic is page loads. Serving them from the edge keeps 90% of requests away from your origin.',
      hint: 'Clients → CDN.',
      concepts: ['cdn'],
      test: (g) => g.clientPathHas('cdn'),
    },
    {
      id: 'bots',
      title: 'Bot protection at the edge',
      category: 'core',
      why: 'Scalper bots are faster than humans. A WAF / bot manager challenges suspicious clients before they reach the queue.',
      hint: 'Add a WAF, or pick a CDN with bot protection (Cloudflare, Akamai).',
      test: (g) => g.has('waf') || g.ofKind('cdn').some((c) => g.hasTrait(c, 'bot-protection')),
    },
    {
      id: 'rate-limit',
      title: 'API gateway with rate limiting',
      category: 'core',
      why: 'Even admitted users can hammer endpoints. Per-user and global rate limits protect seat holds and booking.',
      hint: 'Add an API gateway (Kong, Envoy, Spring Cloud Gateway…) in front of services.',
      concepts: ['rate-limiting', 'api-gateway'],
      test: (g) => {
        const gws = g.ofKind('api-gateway')
        if (!gws.length) return { pass: false, detail: 'No API gateway.' }
        return gws.some((gw) => !gw.tech || g.hasTrait(gw, 'rate-limiting')) ? true : { pass: false, detail: 'Chosen gateway has no rate limiting.' }
      },
    },
    {
      id: 'waiting-room',
      title: 'Virtual waiting room controls admission',
      category: 'core',
      why: 'Queue-based load levelling turns a 500k spike into a steady flow your services can handle, and it is fairer than "fastest refresh wins".',
      hint: 'Give a service the Waiting room capability and back it with a Cache (tokens/positions) or a Queue.',
      concepts: ['queue-load-leveling'],
      test: (g) => {
        const fam = g.ownerFamily('waiting-room')
        if (!fam.length) return { pass: false, detail: 'Nobody owns the waiting room.' }
        return g.storesOf(fam, ['cache']).length > 0 || g.calls(fam, (n) => n.kind === 'broker')
      },
    },
    {
      id: 'seat-holds',
      title: 'Seat holds with atomic ops & TTL',
      category: 'core',
      why: 'Thousands of users click the same seat at once. Atomic SET NX with a 10-minute TTL in Redis gives one winner and automatic release.',
      hint: 'Seat holds owner → Cache (Redis / Valkey).',
      concepts: ['caching'],
      test: (g) => {
        const caches = g.storesOf(g.ownerFamily('reservations'), ['cache'])
        if (!caches.length) return { pass: false, detail: 'Seat holds have no fast store.' }
        return caches.some((c) => !c.tech || g.hasTrait(c, 'ttl')) ? true : { pass: false, detail: 'Choose a cache with TTL support.' }
      },
    },
    {
      id: 'acid-booking',
      title: 'Confirmed bookings in an ACID database',
      category: 'core',
      why: 'The definitive "seat X is sold" must be a transaction with a unique constraint — the last guard against overselling.',
      hint: 'Booking owner → Relational database.',
      concepts: ['acid-vs-base'],
      test: (g) => g.storesOf(g.ownerFamily('booking'), ['relational-db']).length > 0,
    },
    {
      id: 'payment-async',
      title: 'Payment confirmations flow as events',
      category: 'core',
      why: 'PSP webhooks can arrive late or twice. Turning them into events consumed idempotently by Booking decouples payment latency from the user flow.',
      hint: 'Payments → payment provider, and Payments → broker → Booking.',
      concepts: ['idempotency', 'event-driven'],
      test: (g) => {
        const pay = g.ownerFamily('payments')
        if (!g.calls(pay, external(g, 'payment', PAYMENT)) && !g.ofKind('external').some((e) => g.targets(e.id).some((t) => pay.includes(t))))
          return { pass: false, detail: 'Payments is not connected to a payment provider.' }
        return g.asyncFlow(pay, g.ownerFamily('booking')) ? true : { pass: false, detail: 'Booking is not notified asynchronously.' }
      },
    },
    {
      id: 'catalog-cache',
      title: 'Event catalog cached',
      category: 'bonus',
      why: 'Event pages and availability summaries are read millions of times during an on-sale.',
      hint: 'Events owner → Cache.',
      concepts: ['caching'],
      test: (g) => g.storesOf(g.ownerFamily('events'), ['cache']).length > 0,
    },
    {
      id: 'ticket-email',
      title: 'Tickets emailed asynchronously',
      category: 'bonus',
      why: 'Email delivery should never block a confirmed booking.',
      hint: 'Booking → broker → Notifications → email provider.',
      test: (g) => g.asyncFlow(g.ownerFamily('booking'), g.ownerFamily('notifications')) && g.calls(g.ownerFamily('notifications'), external(g, 'email', EMAIL)),
    },
    {
      id: 'sale-monitoring',
      title: 'Live metrics and alerting for the sale',
      category: 'bonus',
      why: 'During a 2-minute on-sale you need dashboards of queue depth, hold rate and error budget burn — and alerts to on-call.',
      hint: 'Add Metrics, Dashboards and Alerting.',
      concepts: ['observability'],
      test: (g) => observability(g, 'metrics', 'alerting'),
    },
    {
      id: 'clients-through-edge',
      title: 'Every client passes through the edge',
      category: 'bonus',
      why: 'Any path that skips the CDN/WAF/gateway is the path bots will find.',
      hint: 'Connect clients only to CDN / WAF / gateway.',
      test: (g) => {
        const clients = g.ofKind(...CLIENT_KINDS)
        return clients.length > 0 && clients.every((c) => g.targets(c.id).every((t) => ['cdn', 'waf', 'api-gateway', 'load-balancer'].includes(t.kind)))
      },
    },
  ],
  reference: {
    decisions: {
      style: 'microservices',
      communication: 'hybrid',
      data: 'per-service',
      stack: { frontend: 'nextjs', backend: 'spring-boot', database: 'postgres', messaging: 'kafka', cache: 'redis' },
      rationale: 'Absorb the spike at the edge, level it with a waiting room, use Redis for contention and PostgreSQL for truth.',
    },
    walkthrough: [
      'Cloudflare serves the Next.js app and seat maps from the edge and filters bots before anything reaches the origin.',
      'Kong enforces per-user and global rate limits. The waiting-room service issues signed admission tokens at a controlled rate, tracked in Redis.',
      'Seat holds use Redis SET NX with a 10-minute TTL — one winner per seat, automatic release.',
      'Booking writes to PostgreSQL with a unique (show_id, seat_id) constraint, so double selling is impossible even if Redis misbehaves.',
      'Stripe webhooks → Payments → Kafka → Booking (idempotent by payment id) → Notifications emails tickets via SendGrid.',
    ],
    diagram: diagram(
      [
        ['web', 'web-app', 'Web Shop', 0, 100, { tech: 'nextjs' }],
        ['mobile', 'mobile-app', 'Mobile App', 0, 260, { tech: 'react-native' }],
        ['cdn', 'cdn', 'CDN + Bot Mgmt', 260, 180, { tech: 'cloudflare' }],
        ['gw', 'api-gateway', 'API Gateway', 520, 180, { tech: 'kong' }],
        ['events', 'service', 'Events', 780, -40, { tech: 'spring-boot', domains: ['events'] }],
        ['eventsDb', 'relational-db', 'Events DB', 1040, -120, { tech: 'postgres' }],
        ['eventsCache', 'cache', 'Catalog Cache', 1040, -10, { tech: 'redis' }],
        ['queue', 'service', 'Waiting Room', 780, 100, { tech: 'spring-boot', domains: ['waiting-room'] }],
        ['queueCache', 'cache', 'Queue Tokens', 1040, 100, { tech: 'redis' }],
        ['holds', 'service', 'Seat Holds', 780, 230, { tech: 'spring-boot', domains: ['reservations'] }],
        ['holdsCache', 'cache', 'Holds (TTL)', 1040, 230, { tech: 'redis' }],
        ['booking', 'service', 'Booking', 780, 370, { tech: 'spring-boot', domains: ['booking'] }],
        ['bookingDb', 'relational-db', 'Bookings DB', 1040, 370, { tech: 'postgres', notes: 'UNIQUE(show_id, seat_id)' }],
        ['payments', 'service', 'Payments', 780, 510, { tech: 'spring-boot', domains: ['payments'] }],
        ['stripe', 'external', 'Stripe', 520, 510, { tech: 'stripe' }],
        ['kafka', 'broker', 'Event Bus', 1300, 440, { tech: 'kafka' }],
        ['notify', 'service', 'Notifications', 1560, 440, { tech: 'spring-boot', domains: ['notifications'] }],
        ['mail', 'external', 'SendGrid', 1820, 440, { tech: 'sendgrid' }],
        ['prom', 'metrics', 'Metrics', 1300, 640, { tech: 'prometheus' }],
        ['grafana', 'dashboards', 'Sale Dashboard', 1560, 640, { tech: 'grafana' }],
        ['alerts', 'alerting', 'On-call', 1820, 640, { tech: 'pagerduty' }],
      ],
      [
        ['web', 'cdn'],
        ['mobile', 'cdn'],
        ['cdn', 'gw', 'http'],
        ['gw', 'events'],
        ['gw', 'queue'],
        ['gw', 'holds'],
        ['gw', 'booking'],
        ['events', 'eventsDb'],
        ['events', 'eventsCache'],
        ['queue', 'queueCache'],
        ['holds', 'holdsCache'],
        ['booking', 'holds', 'grpc', 'verify hold'],
        ['booking', 'bookingDb'],
        ['booking', 'payments', 'grpc', 'create intent'],
        ['payments', 'stripe'],
        ['stripe', 'payments', 'http', 'webhook'],
        ['payments', 'kafka', 'event', 'PaymentSucceeded'],
        ['kafka', 'booking', 'event'],
        ['booking', 'kafka', 'event', 'BookingConfirmed'],
        ['kafka', 'notify', 'event'],
        ['notify', 'mail'],
        ['booking', 'prom', 'telemetry'],
        ['holds', 'prom', 'telemetry'],
        ['queue', 'prom', 'telemetry'],
        ['prom', 'grafana', 'telemetry'],
        ['prom', 'alerts', 'telemetry'],
      ],
    ),
  },
}

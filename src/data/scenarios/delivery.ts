import type { Scenario } from '../../engine/types'
import { CLIENT_KINDS } from '../../engine/graph'
import { diagram, external, MAPS, observability, PAYMENT, PUSH } from './builder'

export const delivery: Scenario = {
  id: 'dash-delivery',
  title: 'Dash: food delivery with live tracking',
  tagline: 'Three apps, thousands of couriers streaming GPS, and an order lifecycle full of events.',
  industry: 'Logistics & marketplaces',
  difficulty: 'intermediate',
  estMinutes: 35,
  accent: '#f97316',
  concepts: ['event-driven', 'realtime', 'caching', 'idempotency', 'backpressure'],
  story:
    'Dash connects hungry customers, restaurants and couriers in 30 cities. Customers order in the app, restaurants accept on a tablet, a courier is dispatched and the customer watches the courier approach on a map in real time. The current system polls the database every few seconds for everything and the DB is melting.',
  facts: [
    { label: 'Couriers', value: '10k online, GPS every 4 s (~2.5k msg/s)' },
    { label: 'Orders', value: '50k / hour at dinner peak' },
    { label: 'Clients', value: 'Customer app, courier app, restaurant tablet' },
    { label: 'Teams', value: '5 squads (Kotlin & Go)' },
  ],
  functional: [
    'Browse restaurants and menus, place orders',
    'Pay by card or wallet',
    'Restaurants accept / reject orders',
    'Automatic courier assignment (dispatch) near the restaurant',
    'Customers see courier location live on a map with ETA',
    'Push notifications on every status change',
  ],
  nonFunctional: [
    'Location updates visible to the customer within ~2 s',
    'Dispatch must not miss an order even if a service restarts',
    'Menu browsing must stay fast during dinner peaks',
    'Location ingest must absorb bursts without dropping the order flow',
  ],
  constraints: ['Polling the database is no longer acceptable', 'Mobile networks are flaky — expect retries and duplicates'],
  domains: [
    { id: 'restaurants', label: 'Restaurants & menus', description: 'Restaurant catalog and menus' },
    { id: 'ordering', label: 'Ordering', description: 'Order placement and lifecycle' },
    { id: 'payments', label: 'Payments', description: 'Charges and refunds' },
    { id: 'dispatch', label: 'Dispatch', description: 'Courier assignment' },
    { id: 'tracking', label: 'Tracking', description: 'Courier location ingest and ETA' },
    { id: 'notifications', label: 'Notifications', description: 'Push and SMS' },
  ],
  recommendedStyles: ['event-driven', 'microservices'],
  styleFeedback: {
    'event-driven': 'Exactly right — the order lifecycle is a sequence of events (Placed → Accepted → CourierAssigned → PickedUp → Delivered).',
    microservices: 'Good, as long as the order lifecycle flows through events instead of polling.',
    'modular-monolith': 'Location ingest at 2.5k msg/s and dispatch have very different scaling needs from menus; separate deployables pay off here.',
    monolith: 'The polling monolith is the problem we are solving.',
    serverless: 'Per-message functions for 2.5k GPS pings per second get expensive and add latency; long-lived WebSockets do not fit.',
  },
  hints: [
    'You have three distinct clients — draw each one.',
    'Courier GPS pings are a stream: ingest them in a small service, store the latest position in a geo-capable cache and publish them to a high-throughput log.',
    'Customers should receive live updates over a WebSocket, not by polling.',
    'Dispatch reacts to "OrderAccepted" events; consumers must be idempotent because mobile retries cause duplicates.',
  ],
  checks: [
    {
      id: 'clients',
      title: 'Customer, courier and restaurant clients',
      category: 'core',
      why: 'Each actor has a different app with different needs — they are separate clients (and often get separate BFFs).',
      hint: 'Add at least three clients (e.g. two Mobile apps and a Web app for restaurants).',
      test: (g) => {
        const n = g.count(...CLIENT_KINDS)
        return { pass: n >= 3 && g.has('mobile-app'), detail: `${n} client(s) drawn.` }
      },
    },
    {
      id: 'location-stream',
      title: 'Locations flow through a streaming log',
      category: 'core',
      why: 'GPS pings are high-volume, ordered per courier and consumed by several readers (ETA, realtime, analytics). A partitioned log like Kafka handles that and absorbs bursts.',
      hint: 'Tracking owner → broker (Kafka / Redpanda / Kinesis) with an Event edge.',
      concepts: ['backpressure', 'kafka-vs-rabbitmq'],
      test: (g) => {
        const fam = g.ownerFamily('tracking')
        const out = fam.flatMap((f) => g.targets(f.id, ['event'])).filter((b) => b.kind === 'broker')
        if (!out.length) return { pass: false, detail: 'Tracking does not publish to a broker.' }
        return out.some((b) => g.hasTrait(b, 'streaming')) ? true : { pass: false, detail: 'Pick a streaming log technology (Kafka, Redpanda, Kinesis, Pulsar).' }
      },
    },
    {
      id: 'geo-cache',
      title: 'Latest courier positions in a geo cache',
      category: 'core',
      why: 'Dispatch asks "which couriers are within 2 km of this restaurant?" thousands of times a minute. Redis GEO answers in microseconds.',
      hint: 'Tracking → Cache (Redis with GEO).',
      concepts: ['caching'],
      test: (g) => {
        const caches = g.storesOf(g.ownerFamily('tracking'), ['cache'])
        if (!caches.length) return { pass: false, detail: 'Tracking has no cache.' }
        return caches.some((c) => !c.tech || g.hasTrait(c, 'geo')) ? true : { pass: false, detail: 'Chosen cache has no geo-spatial queries — consider Redis/Valkey.' }
      },
    },
    {
      id: 'realtime',
      title: 'Live updates pushed over WebSockets',
      category: 'core',
      why: 'Polling every second from 100k phones is wasteful. A realtime gateway holds connections and pushes position updates.',
      hint: 'Customer app → Realtime gateway (WebSocket edge); feed the gateway from Tracking (events or calls).',
      concepts: ['realtime'],
      test: (g) => {
        const rts = g.ofKind('realtime-gateway')
        if (!rts.length) return { pass: false, detail: 'No realtime gateway.' }
        const clientsConnected = g.ofKind(...CLIENT_KINDS).some((c) => g.targets(c.id, ['websocket']).some((t) => t.kind === 'realtime-gateway'))
        if (!clientsConnected) return { pass: false, detail: 'No client connects with a WebSocket edge.' }
        const fam = g.ownerFamily('tracking')
        return g.asyncFlow(fam, rts) || g.calls(fam, (n) => n.kind === 'realtime-gateway')
      },
    },
    {
      id: 'dispatch-events',
      title: 'Dispatch reacts to order events',
      category: 'core',
      why: 'If Ordering calls Dispatch synchronously and Dispatch is down, orders are lost. Events persisted in a broker are retried until handled.',
      hint: 'Ordering → broker → Dispatch.',
      concepts: ['event-driven', 'idempotency'],
      test: (g) => g.asyncFlow(g.ownerFamily('ordering'), g.ownerFamily('dispatch')),
    },
    {
      id: 'payments',
      title: 'Payments via a payment provider',
      category: 'core',
      why: 'Card data and wallets are delegated to a PSP — far smaller PCI scope.',
      hint: 'Payments owner → Third-party API (Stripe, Adyen…).',
      test: (g) => g.calls(g.ownerFamily('payments'), external(g, 'payment', PAYMENT)),
    },
    {
      id: 'maps',
      title: 'Routing & ETA from a maps provider',
      category: 'bonus',
      why: 'Road-network routing is a product in itself. Buy it.',
      hint: 'Dispatch or Tracking → Third-party API (Google Maps / Mapbox).',
      test: (g) => g.calls([...g.ownerFamily('dispatch'), ...g.ownerFamily('tracking')], external(g, 'maps', MAPS)),
    },
    {
      id: 'menu-cache',
      title: 'Menus cached for dinner peaks',
      category: 'bonus',
      why: 'Menus change rarely and are read constantly — cache them.',
      hint: 'Restaurants owner → Cache, or put a CDN in front of menu images.',
      concepts: ['caching'],
      test: (g) => g.storesOf(g.ownerFamily('restaurants'), ['cache']).length > 0,
    },
    {
      id: 'notify',
      title: 'Notifications driven by order events',
      category: 'bonus',
      why: 'Every status change is an event — notifications just subscribe.',
      hint: 'Broker → Notifications → Push provider.',
      test: (g) => g.asyncFlow(g.ownerFamily('ordering'), g.ownerFamily('notifications')) && g.calls(g.ownerFamily('notifications'), external(g, 'push', PUSH)),
    },
    {
      id: 'observe',
      title: 'Metrics and tracing',
      category: 'bonus',
      why: 'Consumer lag, dispatch latency and order funnel need metrics; a trace per order shows where time is lost.',
      hint: 'Add Metrics and Distributed tracing.',
      concepts: ['observability'],
      test: (g) => observability(g, 'metrics', 'tracing'),
    },
  ],
  reference: {
    decisions: {
      style: 'event-driven',
      communication: 'hybrid',
      data: 'per-service',
      stack: { frontend: 'react', mobile: 'flutter', backend: 'spring-boot', database: 'postgres', messaging: 'kafka', cache: 'redis' },
      rationale: 'Kotlin/Spring services for business flows, a small Go service for location ingest; Kafka carries both the order lifecycle and the location stream.',
    },
    walkthrough: [
      'Three clients: customer and courier apps (Flutter) and a restaurant tablet web app, all behind an API gateway.',
      'Ordering stores orders in PostgreSQL and publishes lifecycle events to Kafka. Dispatch, Notifications and Payments react to them idempotently.',
      'Courier apps send GPS to a Go ingest service that keeps the last position in Redis GEO and appends to a Kafka topic partitioned by courier id.',
      'A realtime gateway consumes location and status events and pushes them over WebSockets to the customer watching that order.',
      'Dispatch queries Redis GEO for nearby couriers and Google Maps for ETAs.',
    ],
    diagram: diagram(
      [
        ['customer', 'mobile-app', 'Customer App', 0, 0, { tech: 'flutter' }],
        ['courier', 'mobile-app', 'Courier App', 0, 180, { tech: 'flutter' }],
        ['tablet', 'web-app', 'Restaurant Tablet', 0, 360, { tech: 'react' }],
        ['gw', 'api-gateway', 'API Gateway', 260, 180, { tech: 'kong' }],
        ['rt', 'realtime-gateway', 'Realtime Gateway', 260, -120, { tech: 'spring-websocket' }],
        ['restaurants', 'service', 'Restaurants', 520, -40, { tech: 'spring-boot', domains: ['restaurants'] }],
        ['restDb', 'relational-db', 'Restaurants DB', 780, -120, { tech: 'postgres' }],
        ['menuCache', 'cache', 'Menu Cache', 780, -10, { tech: 'redis' }],
        ['ordering', 'service', 'Ordering', 520, 100, { tech: 'spring-boot', domains: ['ordering'] }],
        ['orderDb', 'relational-db', 'Orders DB', 780, 100, { tech: 'postgres' }],
        ['payments', 'service', 'Payments', 520, 230, { tech: 'spring-boot', domains: ['payments'] }],
        ['stripe', 'external', 'Stripe', 780, 230, { tech: 'stripe' }],
        ['tracking', 'service', 'Location Ingest', 520, 380, { tech: 'go', domains: ['tracking'] }],
        ['geo', 'cache', 'Courier Positions', 780, 380, { tech: 'redis' }],
        ['kafka', 'broker', 'Kafka', 1040, 240, { tech: 'kafka' }],
        ['dispatch', 'service', 'Dispatch', 1300, 120, { tech: 'spring-boot', domains: ['dispatch'] }],
        ['dispatchDb', 'relational-db', 'Dispatch DB', 1560, 60, { tech: 'postgres' }],
        ['maps', 'external', 'Maps & ETA', 1560, 180, { tech: 'google-maps' }],
        ['notify', 'service', 'Notifications', 1300, 340, { tech: 'spring-boot', domains: ['notifications'] }],
        ['push', 'external', 'Push', 1560, 340, { tech: 'fcm' }],
        ['otel', 'otel-collector', 'OTel Collector', 780, 540, { tech: 'otel-collector' }],
        ['traces', 'tracing', 'Traces', 1040, 540, { tech: 'jaeger' }],
        ['metrics', 'metrics', 'Metrics', 1300, 540, { tech: 'prometheus' }],
      ],
      [
        ['customer', 'gw'],
        ['courier', 'gw'],
        ['tablet', 'gw'],
        ['customer', 'rt', 'websocket'],
        ['tablet', 'rt', 'websocket'],
        ['gw', 'restaurants'],
        ['gw', 'ordering'],
        ['gw', 'payments'],
        ['gw', 'tracking', 'http', 'GPS pings'],
        ['restaurants', 'restDb'],
        ['restaurants', 'menuCache'],
        ['ordering', 'orderDb'],
        ['ordering', 'kafka', 'event', 'order lifecycle'],
        ['payments', 'stripe'],
        ['payments', 'kafka', 'event', 'PaymentCaptured'],
        ['tracking', 'geo'],
        ['tracking', 'kafka', 'event', 'locations'],
        ['kafka', 'dispatch', 'event'],
        ['kafka', 'notify', 'event'],
        ['kafka', 'rt', 'event'],
        ['dispatch', 'dispatchDb'],
        ['dispatch', 'geo', 'data', 'nearby couriers'],
        ['dispatch', 'maps'],
        ['dispatch', 'kafka', 'event', 'CourierAssigned'],
        ['notify', 'push'],
        ['ordering', 'otel', 'telemetry'],
        ['dispatch', 'otel', 'telemetry'],
        ['tracking', 'otel', 'telemetry'],
        ['otel', 'traces', 'telemetry'],
        ['otel', 'metrics', 'telemetry'],
      ],
    ),
  },
}

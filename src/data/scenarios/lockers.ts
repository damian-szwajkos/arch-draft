import type { ComponentKind, DiagramEdge, DiagramNode, Scenario } from '../../engine/types'
import { SYNC_PROTOCOLS } from '../../engine/types'
import { DB_KINDS, Graph } from '../../engine/graph'
import { diagram, external, kindIs, observability, PUSH } from './builder'

/** An MQTT broker: tech with the 'mqtt' trait, or an untyped broker labelled as one. */
const isMqtt = (g: Graph) => (n: DiagramNode) =>
  n.kind === 'broker' && (g.hasTrait(n, 'mqtt') || (!n.tech && /mqtt|iot/i.test(n.label)))

/** A broker for business events — anything that is not the device-facing MQTT broker. */
const isEventBroker = (g: Graph) => (n: DiagramNode) => n.kind === 'broker' && !isMqtt(g)(n)

const EDGE_HOPS: ComponentKind[] = ['waf', 'load-balancer', 'api-gateway', 'bff']
const READ_STORES: ComponentKind[] = ['cache', 'search', 'document-db', 'wide-column', 'relational-db']
const RELAY_KINDS: ComponentKind[] = ['worker', 'function', 'cdc', 'stream-processor']

/**
 * The same graph with load balancers collapsed (a → LB → b becomes a → b), so a
 * TCP/TLS load balancer in front of an MQTT cluster does not break async-flow
 * checks. Only used for the device-side checks.
 */
function withoutLoadBalancers(g: Graph): Graph {
  const lbs = new Set(g.ofKind('load-balancer').map((n) => n.id))
  if (!lbs.size) return g
  const edges: DiagramEdge[] = g.edges.filter((e) => !lbs.has(e.source) && !lbs.has(e.target))
  for (const lb of lbs) {
    for (const i of g.in(lb)) {
      for (const o of g.out(lb)) {
        if (i.source === o.target || lbs.has(i.source) || lbs.has(o.target)) continue
        edges.push({ ...o, id: `${i.id}~${o.id}`, source: i.source, protocol: i.protocol })
      }
    }
  }
  return new Graph({ nodes: g.nodes.filter((n) => !lbs.has(n.id)), edges }, g.decisions)
}

/** Does a device talk to an MQTT broker directly or through a TCP load balancer? */
const onMqtt = (g: Graph, d: DiagramNode) =>
  g
    .neighbours(d.id)
    .some((n) => isMqtt(g)(n) || (n.kind === 'load-balancer' && g.neighbours(n.id).some(isMqtt(g))))

/**
 * Everything that publishes on behalf of the parcel lifecycle: the owner family
 * plus outbox relays (polling worker or CDC) that share a store with it.
 */
function parcelPublishers(g: Graph): DiagramNode[] {
  const parcels = g.ownerFamily('parcels')
  if (!parcels.length) return []
  const own = new Set(g.storesOf(parcels).map((s) => s.id))
  const relays = g
    .ofKind(...RELAY_KINDS)
    .filter((r) => !parcels.includes(r) && r.domains.length === 0)
    .filter((r) => [...g.targets(r.id, ['data']), ...g.sources(r.id)].some((s) => own.has(s.id)))
  return [...parcels, ...relays]
}

/** Does the parcel side publish (directly or via an outbox relay) to a non-MQTT broker? */
const parcelBrokers = (g: Graph): DiagramNode[] => {
  const pubs = parcelPublishers(g)
  if (!pubs.length) return []
  return g
    .ofKind('broker')
    .filter((b) => isEventBroker(g)(b) && !!g.reaches(pubs, (n) => n.id === b.id, { through: [...DB_KINDS, 'cdc'], maxDepth: 3 }))
}

export const parcelLockers: Scenario = {
  id: 'skrytka-lockers',
  title: 'Skrytka: a parcel-locker network at peak',
  tagline: '60,000 lockers on flaky LTE, 15 million parcels on Black Friday. Every door must open.',
  industry: 'Logistics & marketplaces',
  difficulty: 'intermediate',
  estMinutes: 35,
  accent: '#ca8a04',
  concepts: ['iot-messaging', 'cqrs', 'queue-load-leveling', 'event-driven', 'cdn', 'idempotency', 'dead-letter-queue'],
  story:
    'Skrytka runs 60,000 self-service parcel lockers in Poland, from Warsaw tower blocks to village petrol stations. Last Black Friday the lockers polled a REST API every 10 seconds. When the API slowed down, 40,000 lockers retried at once, couriers stood in the rain in front of doors that would not open, and the public tracking page took the order database down with it. Merchants could not print labels for six hours, and #SkrytkaNieDziala trended on Polish Twitter. This year volume is forecast at 5× normal, with 15 million parcels on the peak day. The board wants an architecture that keeps doors opening even when the backend is having a bad day.',
  facts: [
    { label: 'Fleet', value: '60,000 lockers, ~4.2M compartments, LTE with 2–5% offline at any time' },
    { label: 'Peak', value: '15M parcels on the peak day, 5× normal; tracking peaks at 90k req/s' },
    { label: 'Latency', value: 'Compartment opens < 2 s after a tap in the app (p95)' },
    { label: 'Team', value: '7 squads, ~55 engineers, Java/Kotlin and Go' },
  ],
  functional: [
    'Merchants create shipments through an API and download a PDF label',
    'Couriers scan parcels on a handheld and load them into locker compartments',
    'Recipients open their compartment remotely from the consumer app (or with a pickup code)',
    'Lockers report door, compartment and health telemetry continuously',
    'Anyone can track a parcel on a public page; recipients get push / SMS at every step',
  ],
  nonFunctional: [
    'Desired locker state (compartment assignments, pickup codes, config) survives offline periods; remote-open commands expire after ~60 s, and offline pickups fall back to a code the locker validates locally',
    'Public tracking traffic must never touch the parcel write database',
    'Label generation absorbs a 5× merchant spike without slowing shipment creation',
    'Parcel lifecycle events can be replayed to rebuild read models or onboard new consumers',
    'On-call sees broker backlog, offline lockers and door-open latency live during the peak',
  ],
  constraints: [
    'Lockers run embedded Linux on cellular links; they cannot accept inbound connections',
    'Squads must deploy independently during the peak-season freeze window',
    'Merchants integrate over a public REST API with per-merchant quotas',
  ],
  domains: [
    { id: 'shipments', label: 'Shipments & labels', description: 'Merchant shipment API, label PDFs, quotas' },
    { id: 'parcels', label: 'Parcel lifecycle', description: 'Parcel state machine: Created → Dropped → Delivered → Collected' },
    { id: 'courier-ops', label: 'Courier operations', description: 'Handheld scanning, loading, courier routes' },
    { id: 'lockers', label: 'Locker fleet', description: 'Compartment allocation, device commands, telemetry, health' },
    { id: 'tracking', label: 'Public tracking', description: 'Read model behind the tracking page and app timeline' },
    { id: 'notifications', label: 'Recipient notifications', description: 'Push and SMS to recipients' },
  ],
  recommendedStyles: ['event-driven', 'microservices'],
  styleFeedback: {
    'event-driven':
      'Strong fit: a parcel is a stream of facts (Created, Dropped, Delivered, Collected) that tracking, notifications and billing react to, and lockers are event sources by nature.',
    microservices:
      'Good fit: tracking reads, locker commands and label rendering scale very differently at peak, and seven squads need to deploy independently. Make sure the services talk through events, not long REST chains.',
    'modular-monolith':
      'Clean boundaries, but one deployable means the 90k req/s tracking spike, label rendering and locker commands all share the same scaling and failure fate.',
    monolith:
      'This is what failed last Black Friday: one overloaded API took tracking, label printing and door opening down together.',
    serverless:
      'Managed MQTT (IoT Core) plus functions handle the fleet, label rendering and notification fan-out well, but a steady 90k req/s of tracking reads and ordered parcel streams are cheaper and more predictable on long-running consumers.',
  },
  hints: [
    'Start with the lockers: they sit behind cellular NAT and drop offline. Should they poll your API, or keep one connection open to a broker built for devices?',
    'Use MQTT (AWS IoT Core, EMQX, Mosquitto) for the fleet. The Locker service publishes commands such as "open compartment 17", and lockers publish telemetry on separate topics.',
    'A locker that is offline still has to hand out parcels. Keep desired state (assignments, pickup codes) in a device shadow or the Locker service DB so it syncs on reconnect, but give remote "open" commands a short expiry so a stale one never pops a door.',
    'Parcel state changes are business events: publish ParcelCreated, Dropped, Delivered and Collected to a replayable log (Kafka) so tracking and notifications react without calling the Parcel service.',
    'Tracking is a read model (CQRS): a projection in Redis or OpenSearch, fed from events and served behind a CDN with a short TTL. It never queries the parcel write database.',
    'Merchant shipment creation returns immediately. A queue feeds label-rendering workers that write PDFs to object storage, so a 5× spike becomes a longer queue instead of timeouts.',
  ],
  checks: [
    {
      id: 'fleet-over-mqtt',
      title: 'Locker fleet connects through an MQTT broker',
      category: 'core',
      why: 'Lockers sit behind cellular NAT with intermittent links. MQTT keeps one lightweight, outbound, authenticated session per device, with QoS, retained messages and persistent sessions built for flaky networks, so 60,000 lockers do not hammer an HTTP API.',
      hint: 'Add an IoT device for the locker fleet and connect it to a Message broker with MQTT tech (AWS IoT Core, EMQX, Mosquitto).',
      concepts: ['iot-messaging'],
      test: (g) => {
        const devices = g.ofKind('device')
        if (!devices.length) return { pass: false, detail: 'No locker fleet on the canvas: add an IoT device / edge component.' }
        const mqtt = g.nodes.filter(isMqtt(g))
        if (!mqtt.length) return { pass: false, detail: 'No MQTT broker. General-purpose brokers such as Kafka or RabbitMQ are not built for 60k flaky device sessions.' }
        const loose = devices.filter((d) => !onMqtt(g, d))
        return loose.length
          ? { pass: false, detail: `${loose.map((d) => d.label).join(', ')} not connected to the MQTT broker.` }
          : { pass: true }
      },
    },
    {
      id: 'locker-commands',
      title: 'Commands go down and telemetry comes up through the broker',
      category: 'core',
      why: 'Commands and telemetry flow in opposite directions on separate topics. The Locker service publishes "open compartment" commands for devices to consume, and backend consumers subscribe to door and health telemetry. Nobody calls a locker directly.',
      hint: 'Locker-fleet owner → MQTT broker → lockers (commands), and lockers → MQTT broker → Locker service (telemetry).',
      concepts: ['iot-messaging', 'event-driven'],
      test: (graph) => {
        const g = withoutLoadBalancers(graph)
        const devices = g.ofKind('device')
        const fam = g.ownerFamily('lockers').filter((n) => n.kind !== 'device')
        if (!devices.length) return { pass: false, detail: 'No locker fleet on the canvas.' }
        if (!fam.length) return { pass: false, detail: 'Nobody owns the Locker fleet capability.' }
        if (!g.asyncFlow(fam, devices)) return { pass: false, detail: 'The Locker service never sends commands to lockers through a broker.' }
        // Telemetry must land with the locker-fleet owner, or with a plumbing
        // ingester that writes a store the owner reads.
        const fleetStores = new Set(g.storesOf(fam).map((s) => s.id))
        const ingesters = g
          .ofKind(...RELAY_KINDS)
          .filter((n) => n.domains.length === 0 && g.targets(n.id, ['data']).some((s) => fleetStores.has(s.id)))
        if (!g.asyncFlow(devices, [...fam, ...ingesters]))
          return { pass: false, detail: 'Door and health telemetry never reaches the Locker fleet owner through a broker.' }
        return { pass: true }
      },
    },
    {
      id: 'parcel-events',
      title: 'Parcel lifecycle published as business events',
      category: 'core',
      why: 'ParcelCreated, Dropped, Delivered and Collected are facts that many capabilities react to. Publishing them to an event broker decouples notifications and tracking from the parcel state machine, and the broker evens out the Black Friday burst.',
      hint: 'Parcel lifecycle owner → event broker (Kafka, Pulsar…), consumed by Notifications. An outbox + CDC relay counts too.',
      concepts: ['event-driven', 'queue-load-leveling'],
      test: (g) => {
        const parcels = g.ownerFamily('parcels')
        if (!parcels.length) return { pass: false, detail: 'Nobody owns the Parcel lifecycle capability.' }
        if (!parcelBrokers(g).length)
          return { pass: false, detail: 'Parcel lifecycle does not publish to an event broker. The MQTT broker is for devices, not business events.' }
        const notify = g.ownerFamily('notifications')
        if (!notify.length) return { pass: false, detail: 'Nobody owns Recipient notifications.' }
        return g.asyncFlow(parcelPublishers(g), notify)
          ? { pass: true }
          : { pass: false, detail: 'Notifications are not driven by parcel events.' }
      },
    },
    {
      id: 'tracking-read-model',
      title: 'Tracking served from its own read model',
      category: 'core',
      why: 'Public tracking is read thousands of times more often than a parcel changes. A CQRS projection in a cache or search index, updated from parcel events, serves those reads cheaply and keeps the 90k req/s peak away from the write database.',
      hint: 'Tracking owner → its own Cache / Search store, fed asynchronously from parcel events. No synchronous calls to the Parcel service.',
      concepts: ['cqrs', 'caching'],
      test: (g) => {
        const tracking = g.ownerFamily('tracking')
        const parcels = g.ownerFamily('parcels')
        if (!tracking.length) return { pass: false, detail: 'Nobody owns Public tracking.' }
        if (!parcels.length) return { pass: false, detail: 'Nobody owns the Parcel lifecycle capability.' }
        const writers = parcels.filter((p) => !tracking.includes(p))
        const writtenByParcels = (s: DiagramNode) => g.sources(s.id, ['data']).some((src) => writers.includes(src))
        if (g.storesOf(tracking).some(writtenByParcels))
          return { pass: false, detail: 'Tracking reads the parcel write database, so peak tracking traffic lands on it.' }
        const reads = g.storesOf(tracking, READ_STORES)
        if (!reads.length) return { pass: false, detail: 'Tracking has no read store of its own, so it reads the parcel write side.' }
        if (g.calls(tracking, (n) => writers.includes(n), SYNC_PROTOCOLS))
          return { pass: false, detail: 'Tracking calls the Parcel service synchronously on every page view.' }
        // A separate projector (worker / stream processor) that writes the read store counts as the tracking side.
        const projectors = reads
          .flatMap((s) => g.sources(s.id, ['data']))
          .filter((f) => !writers.includes(f) && !tracking.includes(f))
        return g.asyncFlow(parcelPublishers(g), [...tracking, ...projectors])
          ? { pass: true }
          : { pass: false, detail: 'The tracking projection is not updated from parcel events.' }
      },
    },
    {
      id: 'tracking-cdn',
      title: 'Public tracking behind a CDN',
      category: 'core',
      why: 'Tracking pages get hammered on peak days, often by people refreshing the same parcel. A CDN with a short TTL (10–30 s) turns most of those requests into edge hits before they reach your origin.',
      hint: 'Tracking web page → CDN → (gateway) → Tracking owner.',
      concepts: ['cdn', 'caching'],
      test: (g) => {
        const webs = g.ofKind('web-app')
        const tracking = g.ownerFamily('tracking')
        if (!webs.length) return { pass: false, detail: 'No public tracking web page on the canvas.' }
        if (!tracking.length) return { pass: false, detail: 'Nobody owns Public tracking.' }
        const isTracking = (n: DiagramNode) => tracking.includes(n)
        const cdns = g.ofKind('cdn').filter((cdn) => g.reaches(cdn, isTracking, { through: EDGE_HOPS, maxDepth: 6 }))
        const fronted = webs.filter((w) =>
          cdns.some((cdn) => g.reaches(w, (n) => n.id === cdn.id, { through: ['waf', 'load-balancer'], maxDepth: 3 })),
        )
        if (!fronted.length)
          return { pass: false, detail: 'Tracking requests do not pass through a CDN on the way to the tracking read model.' }
        // Any path from a tracking page that skips the CDN undoes the edge cache.
        const bypass = fronted.filter((w) => g.reaches(w, isTracking, { through: EDGE_HOPS, maxDepth: 5 }))
        return bypass.length
          ? { pass: false, detail: `${bypass.map((w) => w.label).join(', ')} also reach tracking without the CDN.` }
          : { pass: true }
      },
    },
    {
      id: 'label-async',
      title: 'Label PDFs rendered asynchronously',
      category: 'core',
      why: 'Rendering a PDF takes far longer than recording a shipment. With a queue between the shipment API and the rendering workers, a 5× merchant spike becomes a longer backlog that workers drain, instead of API timeouts (queue-based load levelling).',
      hint: 'Shipments owner → queue → worker / function (not called synchronously) → Object storage for the PDFs.',
      concepts: ['queue-load-leveling', 'background-jobs'],
      test: (g) => {
        const ship = g.ownerFamily('shipments')
        if (!ship.length) return { pass: false, detail: 'Nobody owns Shipments & labels.' }
        const writesPdf = (n: DiagramNode) => g.targets(n.id, ['data']).some(kindIs('object-storage'))
        const syncCalled = (n: DiagramNode) =>
          g.in(n.id, SYNC_PROTOCOLS).length > 0 || (!!n.parentId && g.in(n.parentId, SYNC_PROTOCOLS).length > 0)
        // The request-path side of Shipments (what merchants call) must not render PDFs itself.
        if (ship.some((s) => syncCalled(s) && writesPdf(s)))
          return { pass: false, detail: 'The Shipments API writes label PDFs itself, on the request path. Hand rendering to a queue-fed worker.' }
        // Renderers act for shipments: plumbing with no domain of its own, or a shipments-owned worker.
        const others = new Set(
          g.nodes.filter((n) => n.domains.some((d) => d !== 'shipments')).flatMap((n) => g.family(n)).map((n) => n.id),
        )
        const renderers = g
          .ofKind('worker', 'function', 'service', 'module')
          .filter((n) => !others.has(n.id) && !syncCalled(n) && writesPdf(n))
        if (!renderers.length) return { pass: false, detail: 'No label renderer writes PDFs to object storage off the request path.' }
        // Fed straight from a queue the Shipments side publishes to (directly or via an outbox relay).
        const front = ship.filter((s) => !renderers.includes(s))
        const shipBrokers = new Set(
          g
            .ofKind('broker')
            .filter((b) => !!g.reaches(front, (n) => n.id === b.id, { through: [...DB_KINDS, 'cdc'], maxDepth: 3 }))
            .map((b) => b.id),
        )
        const async = renderers.filter((r) => g.sources(r.id).some((s) => shipBrokers.has(s.id)) && g.asyncFlow(front, [r]))
        return async.length
          ? { pass: true }
          : { pass: false, detail: 'Labels are rendered on the request path. Put a queue the Shipments API publishes to in front of the renderer.' }
      },
    },
    {
      id: 'device-shadow',
      title: 'Desired state survives offline lockers',
      category: 'bonus',
      why: 'Between 2 and 5% of lockers are offline at any moment. A device shadow (desired vs reported state), or desired state persisted by the Locker service and re-published on reconnect, keeps compartment assignments, pickup codes and config in sync after an outage. Remote "open" commands are the exception: they carry a command id for dedupe and a short expiry (MQTT v5 message expiry, ~60 s), so a stale command never pops a door on an unattended locker.',
      hint: 'Use AWS IoT Core device shadows, or give the Locker service a store for desired compartment state that it re-publishes to lockers over MQTT.',
      concepts: ['iot-messaging', 'idempotency'],
      test: (graph) => {
        const g = withoutLoadBalancers(graph)
        const devices = g.ofKind('device')
        if (!devices.length) return { pass: false, detail: 'No locker fleet on the canvas.' }
        const shadow = g.ofKind('broker').some((b) => g.hasTrait(b, 'device-shadow') && g.neighbours(b.id).some(kindIs('device')))
        const fam = g.ownerFamily('lockers').filter((n) => n.kind !== 'device')
        const stored = g.storesOf(fam, [...DB_KINDS, 'cache']).length > 0 && g.asyncFlow(fam, devices)
        return shadow || stored
          ? { pass: true }
          : { pass: false, detail: 'Nothing persists desired locker state (and re-publishes it to lockers) while a device is offline.' }
      },
    },
    {
      id: 'replayable-parcel-log',
      title: 'Parcel events are replayable',
      category: 'bonus',
      why: 'A retained, replayable log lets you rebuild the tracking projection after a bug, backfill a new consumer such as billing or ETA prediction, and audit what happened to a parcel.',
      hint: 'Pick a log-based broker (Kafka, Redpanda, Pulsar, Kinesis) for parcel events.',
      concepts: ['event-sourcing', 'event-driven'],
      test: (g) => {
        const brokers = parcelBrokers(g)
        if (!brokers.length) return { pass: false, detail: 'Parcel lifecycle does not publish to an event broker yet.' }
        return brokers.some((b) => g.hasTrait(b, 'replayable', 'log'))
          ? { pass: true }
          : { pass: false, detail: 'The parcel event broker deletes messages once consumed.' }
      },
    },
    {
      id: 'recipients-notified',
      title: 'Recipients get push / SMS from events',
      category: 'bonus',
      why: '"Your parcel is in locker WAW-123" is what actually brings people to the locker. Driven by events, notification bursts never slow the parcel flow, and failed sends can retry or go to a dead-letter queue.',
      hint: 'Parcel events → Notifications → push (FCM) / SMS (Twilio) provider.',
      concepts: ['fan-out', 'dead-letter-queue'],
      test: (g) => {
        const notify = g.ownerFamily('notifications')
        if (!notify.length) return { pass: false, detail: 'Nobody owns Recipient notifications.' }
        const provider = g.calls(notify, (n) => external(g, 'push', PUSH)(n) || external(g, 'sms', PUSH)(n))
        if (!provider) return { pass: false, detail: 'Notifications is not connected to a push / SMS provider.' }
        return g.asyncFlow(parcelPublishers(g), notify) ? { pass: true } : { pass: false, detail: 'Notifications are not driven by parcel events.' }
      },
    },
    {
      id: 'api-gateway-limits',
      title: 'Apps and merchants enter through a rate-limited gateway',
      category: 'bonus',
      why: 'One gateway authenticates the consumer app, couriers and merchant integrations and enforces per-merchant quotas, so a single misbehaving shop cannot flood label rendering on Black Friday.',
      hint: 'Mobile apps → API gateway (Kong, Envoy…) → services, with the Shipments API behind the same gateway.',
      concepts: ['api-gateway', 'rate-limiting'],
      test: (g) => {
        const gws = g.ofKind('api-gateway')
        if (!gws.length) return { pass: false, detail: 'No API gateway.' }
        if (!gws.some((gw) => !gw.tech || g.hasTrait(gw, 'rate-limiting'))) return { pass: false, detail: 'The chosen gateway has no rate limiting.' }
        const mobiles = g.ofKind('mobile-app')
        if (!mobiles.length) return { pass: false, detail: 'No consumer or courier app on the canvas.' }
        const stray = mobiles.filter((m) => !g.reaches(m, kindIs('api-gateway', 'bff'), { through: ['cdn', 'waf', 'load-balancer'], maxDepth: 3 }))
        if (stray.length) return { pass: false, detail: `${stray.map((m) => m.label).join(', ')} bypass the gateway.` }
        const ship = g.ownerFamily('shipments')
        return g.reaches(gws, (n) => ship.includes(n), { through: ['load-balancer', 'waf'], maxDepth: 2 })
          ? { pass: true }
          : { pass: false, detail: 'The merchant Shipments API is not behind the gateway.' }
      },
    },
    {
      id: 'peak-observability',
      title: 'Peak-day metrics and alerting',
      category: 'bonus',
      why: 'On the peak day you watch queue backlog, offline-locker ratio and door-open latency against an SLO, and page on-call before couriers start phoning in.',
      hint: 'Add Metrics and Alerting, and send telemetry from most services and workers.',
      concepts: ['observability', 'slo'],
      test: (g) => {
        const base = observability(g, 'metrics', 'alerting')
        if (!base.pass) return base
        const compute = g.ofKind('service', 'worker', 'function', 'monolith', 'bff')
        const instrumented = g.instrumented().filter((n) => compute.includes(n)).length
        return compute.length && instrumented >= Math.ceil(compute.length / 2)
          ? { pass: true }
          : { pass: false, detail: `${instrumented}/${compute.length} services and workers export telemetry.` }
      },
    },
    {
      id: 'anti-device-rest',
      title: 'Lockers never poll or get called over REST',
      category: 'antipattern',
      why: 'Lockers polling a REST API is what melted the backend last year: thousands of synchronised retries the moment the API slows down. Calling a device synchronously also fails whenever it sits behind cellular NAT or is offline.',
      hint: 'Remove HTTP/gRPC links to and from the locker fleet; use MQTT topics for commands and telemetry instead.',
      concepts: ['iot-messaging', 'backpressure'],
      test: (g) => {
        const bad = g.edges.filter((e) => {
          if (!SYNC_PROTOCOLS.includes(e.protocol)) return false
          const s = g.node(e.source)
          const t = g.node(e.target)
          return !!s && !!t && (s.kind === 'device' || t.kind === 'device')
        })
        return bad.length
          ? { pass: false, detail: `${bad.length} synchronous link${bad.length > 1 ? 's' : ''} to or from the locker fleet.` }
          : { pass: true }
      },
    },
  ],
  inspiration: [
    { label: 'inhire.io — Getting to know InPost from the technology side (PL)', url: 'https://inhire.io/pl/blog/poznaj-inpost-od-strony-technologicznej/' },
    { label: 'Dynatrace — InPost customer story', url: 'https://www.dynatrace.com/customers/inpost-ai/' },
    { label: 'AWS IoT Lens — Device telemetry and commands', url: 'https://docs.aws.amazon.com/wellarchitected/latest/iot-lens/device-telemetry.html' },
  ],
  reference: {
    decisions: {
      style: 'event-driven',
      communication: 'hybrid',
      data: 'cqrs',
      stack: { backend: 'spring-boot', frontend: 'nextjs', mobile: 'react-native', database: 'postgres', messaging: 'kafka', cache: 'redis' },
      rationale:
        'Lockers speak MQTT through AWS IoT Core with device shadows. Parcel facts flow on Kafka to a CDN-fronted tracking projection and to notifications. Label rendering is queued, so peaks turn into backlog rather than outages.',
    },
    walkthrough: [
      'Every locker keeps one outbound MQTT session to AWS IoT Core with its own X.509 certificate. Door and health telemetry go up on telemetry topics, and the Locker Control service publishes "open compartment" commands on separate command topics.',
      'Desired compartment state (assignments, pickup codes) lives in the device shadow and the Locker DB, so a locker that was offline syncs on reconnect and can validate pickup codes locally meanwhile. Remote "open" commands carry an id for dedupe and a 60-second MQTT v5 expiry, so a duplicate opens the door once and a stale one never opens it at all.',
      'The Parcel Lifecycle service owns the state machine and publishes ParcelCreated, Dropped, Delivered and Collected to Kafka. Courier scans are accepted over HTTP by Parcel Lifecycle, which records them and publishes the events; locker door events arrive over MQTT and reach Kafka through Locker Control.',
      'Tracking is a CQRS read model: it consumes parcel events into Redis and serves the page through Cloudflare with a 15-second TTL. The 90k req/s peak never reaches the parcel database, and the projection can be rebuilt by replaying Kafka.',
      'Merchants get a shipment id immediately. A RabbitMQ queue (with a dead-letter queue) feeds label renderers that write PDFs to S3, so a 5× merchant burst only lengthens the backlog. Kong enforces per-merchant quotas.',
      'Trade-off: two brokers (MQTT for devices, Kafka for business events) add operational cost, but each does what the other is bad at: tens of thousands of long-lived, flaky device sessions versus a durable, replayable business log.',
    ],
    diagram: diagram(
      [
        ['merchant', 'external', 'Merchant Shops (API)', 0, -200, { tech: 'generic-api' }],
        ['consumer', 'mobile-app', 'Consumer App', 0, -60, { tech: 'react-native' }],
        ['courierApp', 'mobile-app', 'Courier Handheld', 0, 80, { tech: 'jetpack-compose' }],
        ['lockers', 'device', 'Locker Fleet ×60k', 0, 220, { tech: 'embedded-linux', notes: 'Buffers door events and validates pickup codes locally while offline' }],
        ['trackWeb', 'web-app', 'Tracking Page', 0, 360, { tech: 'nextjs' }],
        ['gw', 'api-gateway', 'API Gateway', 280, -60, { tech: 'kong', notes: 'Per-merchant quotas' }],
        ['mqtt', 'broker', 'MQTT Broker', 280, 220, { tech: 'aws-iot-core', notes: 'cmd/* (60 s expiry) and telemetry/* topics, device shadows' }],
        ['cdn', 'cdn', 'CDN', 280, 360, { tech: 'cloudflare', notes: 'Tracking responses cached 15 s' }],
        ['shipDb', 'relational-db', 'Shipments DB', 560, -340, { tech: 'postgres' }],
        ['shipments', 'service', 'Shipments API', 560, -200, { tech: 'spring-boot', domains: ['shipments'] }],
        ['parcels', 'service', 'Parcel Lifecycle', 560, -60, { tech: 'spring-boot', domains: ['parcels', 'courier-ops'] }],
        ['lockerSvc', 'service', 'Locker Control', 560, 220, { tech: 'go', domains: ['lockers'] }],
        ['tracking', 'service', 'Tracking Query', 560, 360, { tech: 'go', domains: ['tracking'] }],
        ['labelQueue', 'broker', 'Label Jobs + DLQ', 860, -200, { tech: 'rabbitmq' }],
        ['kafka', 'broker', 'Parcel Events', 860, 80, { tech: 'kafka' }],
        ['lockerDb', 'relational-db', 'Lockers DB', 860, 220, { tech: 'postgres', notes: 'Compartments, pickup codes & desired state' }],
        ['labelWorker', 'worker', 'Label Renderer', 1160, -200, { tech: 'spring-boot' }],
        ['parcelDb', 'relational-db', 'Parcels DB', 1160, -60, { tech: 'postgres' }],
        ['notify', 'service', 'Notifications', 1160, 80, { tech: 'spring-boot', domains: ['notifications'] }],
        ['trackCache', 'cache', 'Tracking Projection', 1160, 360, { tech: 'redis' }],
        ['labels', 'object-storage', 'Label PDFs', 1460, -200, { tech: 's3' }],
        ['push', 'external', 'Push / SMS', 1460, 80, { tech: 'fcm' }],
        ['metrics', 'metrics', 'Metrics', 860, 520, { tech: 'prometheus' }],
        ['alerts', 'alerting', 'Peak Alerts', 1160, 520, { tech: 'grafana' }],
      ],
      [
        ['merchant', 'gw', 'http', 'POST /shipments'],
        ['consumer', 'gw', 'http'],
        ['courierApp', 'gw', 'http', 'scans'],
        ['trackWeb', 'cdn', 'http'],
        ['cdn', 'tracking', 'http', 'cache miss'],
        ['gw', 'shipments'],
        ['gw', 'parcels', 'http', 'courier scans'],
        ['gw', 'lockerSvc', 'http', 'open compartment'],
        ['shipments', 'shipDb'],
        ['shipments', 'labelQueue', 'event', 'RenderLabel'],
        ['labelQueue', 'labelWorker', 'event'],
        ['labelWorker', 'labels', 'data', 'PDF'],
        ['shipments', 'kafka', 'event', 'ShipmentCreated'],
        ['kafka', 'parcels', 'event'],
        ['parcels', 'parcelDb'],
        ['parcels', 'kafka', 'event', 'ParcelCreated · Dropped · Delivered · Collected'],
        ['kafka', 'tracking', 'event', 'project'],
        ['tracking', 'trackCache'],
        ['kafka', 'notify', 'event'],
        ['notify', 'push', 'http'],
        ['kafka', 'lockerSvc', 'event', 'ParcelAssigned'],
        ['lockerSvc', 'lockerDb'],
        ['lockerSvc', 'mqtt', 'event', 'cmd/open'],
        ['mqtt', 'lockers', 'event', 'commands'],
        ['lockers', 'mqtt', 'event', 'telemetry · door events'],
        ['mqtt', 'lockerSvc', 'event'],
        ['lockerSvc', 'kafka', 'event', 'CompartmentClosed'],
        ['parcels', 'metrics', 'telemetry'],
        ['lockerSvc', 'metrics', 'telemetry'],
        ['tracking', 'metrics', 'telemetry'],
        ['notify', 'metrics', 'telemetry'],
        ['metrics', 'alerts', 'telemetry'],
      ],
    ),
  },
}

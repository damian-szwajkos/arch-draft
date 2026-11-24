import { describe, expect, it } from 'vitest'
import { assertScenarioContract } from '../../engine/scenarioContract'
import { evaluateScenario } from '../../engine/evaluate'
import type { Decisions, Diagram, DiagramEdge, DiagramNode } from '../../engine/types'
import { diagram, type NodeSpec } from './builder'
import { parcelLockers } from './lockers'

const ref = parcelLockers.reference

function results(d: Diagram, decisions: Decisions = ref.decisions) {
  const ev = evaluateScenario(parcelLockers, d, decisions)
  return { ev, pass: (id: string) => ev.results.find((r) => r.id === id)?.pass }
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
  evaluateScenario(parcelLockers, d, decisions)
    .results.filter((r) => !r.pass)
    .map((r) => r.id)
    .sort()

const failingCore = (d: Diagram, decisions: Decisions = ref.decisions) =>
  evaluateScenario(parcelLockers, d, decisions)
    .results.filter((r) => (r.category === 'core' || r.category === 'antipattern') && !r.pass)
    .map((r) => `${r.id}: ${r.detail ?? ''}`)

const isEdge = (source: string, target: string) => (e: DiagramEdge) => e.source === source && e.target === target

const edge = (source: string, target: string, protocol: DiagramEdge['protocol'], label?: string): DiagramEdge => ({
  id: `x-${source}-${target}-${protocol}`,
  source,
  target,
  protocol,
  label,
})

describe('skrytka-lockers', () => {
  assertScenarioContract(parcelLockers)

  it('reference stays within the intermediate size budget', () => {
    expect(ref.diagram.nodes.length).toBeGreaterThanOrEqual(14)
    expect(ref.diagram.nodes.length).toBeLessThanOrEqual(24)
  })

  it('mistake: lockers poll a REST API instead of using MQTT', () => {
    const d = mutate({
      dropNodes: ['mqtt'],
      addEdges: [edge('lockers', 'gw', 'http', 'poll /commands every 10 s'), edge('gw', 'lockerSvc', 'http')],
    })
    const { ev, pass } = results(d)
    expect(pass('fleet-over-mqtt')).toBe(false)
    expect(pass('locker-commands')).toBe(false)
    expect(pass('anti-device-rest')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('mistake: Locker service calls lockers directly over HTTP, MQTT only for telemetry', () => {
    const d = mutate({
      dropEdges: (e) => (e.source === 'lockerSvc' && e.target === 'mqtt') || (e.source === 'mqtt' && e.target === 'lockers'),
      addEdges: [edge('lockerSvc', 'lockers', 'http', 'POST /open')],
    })
    const { ev, pass } = results(d)
    expect(pass('fleet-over-mqtt')).toBe(true)
    expect(pass('locker-commands')).toBe(false)
    expect(pass('anti-device-rest')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('mistake: tracking page queries the Parcel service on every view', () => {
    const d = mutate({
      dropNodes: ['trackCache'],
      dropEdges: (e) => e.source === 'kafka' && e.target === 'tracking',
      addEdges: [edge('tracking', 'parcels', 'grpc', 'getParcel')],
    })
    const { ev, pass } = results(d)
    expect(pass('tracking-read-model')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('mistake: tracking reads straight from the parcel write database', () => {
    const d = mutate({
      dropNodes: ['trackCache'],
      addEdges: [edge('tracking', 'parcelDb', 'data')],
    })
    const { pass } = results(d)
    expect(pass('tracking-read-model')).toBe(false)
    expect(pass('anti-shared-db')).toBe(false)
  })

  it('mistake: tracking web page calls the gateway directly, no CDN', () => {
    const d = mutate({ dropNodes: ['cdn'], addEdges: [edge('trackWeb', 'gw', 'http'), edge('gw', 'tracking', 'http')] })
    const { ev, pass } = results(d)
    expect(pass('tracking-cdn')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('mistake: Shipments API renders the PDF synchronously', () => {
    const d = mutate({ dropNodes: ['labelQueue', 'labelWorker'], addEdges: [edge('shipments', 'labels', 'data', 'PDF')] })
    const { ev, pass } = results(d)
    expect(pass('label-async')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('mistake: label worker is called synchronously (a "background" job on the request path)', () => {
    const d = mutate({
      dropNodes: ['labelQueue'],
      addEdges: [edge('shipments', 'labelWorker', 'http', 'render')],
    })
    expect(results(d).pass('label-async')).toBe(false)
  })

  it('mistake: parcel events pushed through the MQTT broker', () => {
    const d = mutate({
      dropNodes: ['kafka'],
      addEdges: [
        edge('parcels', 'mqtt', 'event', 'ParcelDelivered'),
        edge('mqtt', 'notify', 'event'),
        edge('mqtt', 'tracking', 'event'),
      ],
    })
    const { ev, pass } = results(d)
    expect(pass('parcel-events')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('alternative design passes every core check: EMQX + outbox/CDC + Pulsar + Lambda labels + OpenSearch tracking', () => {
    const d = diagram(
      [
        ['merchant', 'web-app', 'Merchant Panel', 0, -120, { tech: 'react' }],
        ['app', 'mobile-app', 'Recipient App', 0, 0, { tech: 'flutter' }],
        ['courier', 'mobile-app', 'Courier Scanner', 0, 120, { tech: 'flutter' }],
        ['track', 'web-app', 'Track & Trace', 0, 240, { tech: 'nuxt' }],
        ['fleet', 'device', 'Lockers', 0, 400, { tech: 'embedded-linux' }],
        ['gw', 'api-gateway', 'Gateway', 260, 0, { tech: 'envoy' }],
        ['cdn', 'cdn', 'Edge Cache', 260, 240, { tech: 'cloudfront' }],
        ['emqx', 'broker', 'EMQX Cluster', 260, 400, { tech: 'emqx' }],
        ['ship', 'service', 'Shipments', 540, -120, { tech: 'quarkus', domains: ['shipments'] }],
        ['parcel', 'service', 'Parcels', 540, 0, { tech: 'quarkus', domains: ['parcels'] }],
        ['courierSvc', 'service', 'Courier Ops', 540, 120, { tech: 'quarkus', domains: ['courier-ops'] }],
        ['trackSvc', 'service', 'Tracking', 540, 240, { tech: 'go', domains: ['tracking'] }],
        ['lockerSvc', 'service', 'Fleet Manager', 540, 400, { tech: 'go', domains: ['lockers'] }],
        ['shipDb', 'document-db', 'Shipments', 820, -240, { tech: 'dynamodb' }],
        ['sqs', 'broker', 'Label Queue', 820, -120, { tech: 'sqs' }],
        ['parcelDb', 'relational-db', 'Parcels + Outbox', 820, 0, { tech: 'postgres' }],
        ['courierDb', 'relational-db', 'Courier DB', 820, 120, { tech: 'postgres' }],
        ['search', 'search', 'Tracking Index', 820, 240, { tech: 'opensearch' }],
        ['fleetDb', 'cache', 'Desired State', 820, 400, { tech: 'valkey' }],
        ['lambda', 'function', 'Render Label', 1100, -120, { tech: 'aws-lambda' }],
        ['cdc', 'cdc', 'Outbox Relay', 1100, 0, { tech: 'debezium' }],
        ['pulsar', 'broker', 'Parcel Events', 1100, 120, { tech: 'pulsar' }],
        ['pdfs', 'object-storage', 'Labels', 1380, -120, { tech: 's3' }],
        ['notify', 'service', 'Notify', 1380, 120, { tech: 'go', domains: ['notifications'] }],
        ['sms', 'external', 'SMS', 1660, 120, { tech: 'twilio' }],
      ],
      [
        ['merchant', 'gw'],
        ['app', 'gw'],
        ['courier', 'gw'],
        ['track', 'cdn'],
        ['cdn', 'trackSvc', 'http'],
        ['gw', 'ship'],
        ['gw', 'courierSvc'],
        ['gw', 'lockerSvc'],
        ['ship', 'shipDb'],
        ['ship', 'sqs', 'event'],
        ['sqs', 'lambda', 'event'],
        ['lambda', 'pdfs'],
        ['ship', 'pulsar', 'event', 'ShipmentCreated'],
        ['pulsar', 'parcel', 'event'],
        ['parcel', 'parcelDb'],
        ['parcelDb', 'cdc', 'event'],
        ['cdc', 'pulsar', 'event'],
        ['courierSvc', 'courierDb'],
        ['courierSvc', 'pulsar', 'event', 'ParcelScanned'],
        ['pulsar', 'trackSvc', 'event'],
        ['trackSvc', 'search'],
        ['pulsar', 'notify', 'event'],
        ['notify', 'sms'],
        ['lockerSvc', 'fleetDb'],
        ['lockerSvc', 'emqx', 'event', 'cmd'],
        ['emqx', 'fleet', 'event'],
        ['fleet', 'emqx', 'event', 'telemetry'],
        ['emqx', 'pulsar', 'event', 'bridge door events'],
        ['pulsar', 'lockerSvc', 'event'],
      ],
    )
    const { ev } = results(d, {
      style: 'microservices',
      communication: 'async',
      data: 'per-service',
      stack: { backend: 'quarkus', messaging: 'pulsar' },
    })
    const failedCore = ev.results.filter((r) => r.category === 'core' && !r.pass).map((r) => `${r.id}: ${r.detail ?? ''}`)
    expect(failedCore, failedCore.join('\n')).toEqual([])
    const failedAnti = ev.results.filter((r) => r.category === 'antipattern' && !r.pass).map((r) => r.id)
    expect(failedAnti).toEqual([])
    expect(ev.passed).toBe(true)
  })

  // --- Regression: gaming attempts must fail ---------------------------------

  it('gaming: sync PDF rendering hidden behind an unrelated async S3 writer still fails label-async', () => {
    const d = mutate({
      dropNodes: ['labelQueue', 'labelWorker'],
      addNodes: [
        ['archiver', 'worker', 'Event Archiver', 1460, 80, { tech: 'go' }],
        ['archive', 'object-storage', 'Event Archive', 1460, 220, { tech: 's3' }],
      ],
      addEdges: [
        edge('shipments', 'labels', 'data', 'render PDF inline'),
        edge('kafka', 'archiver', 'event'),
        edge('archiver', 'archive', 'data'),
      ],
    })
    expect(failing(d)).toContain('label-async')
  })

  it('gaming: tracking keeps its cache but also reads the parcel write database', () => {
    const d = mutate({ addEdges: [edge('tracking', 'parcelDb', 'data')] })
    expect(results(d).pass('tracking-read-model')).toBe(false)
  })

  it('gaming: lockers telemetry consumed by an unrelated worker, not the Locker fleet owner', () => {
    const d = mutate({ dropEdges: isEdge('mqtt', 'lockerSvc'), addEdges: [edge('mqtt', 'labelWorker', 'event')] })
    expect(results(d).pass('locker-commands')).toBe(false)
  })

  it('gaming: the tracking page also reaches tracking through the gateway, bypassing the CDN', () => {
    const d = mutate({ addEdges: [edge('trackWeb', 'gw', 'http'), edge('gw', 'tracking', 'http')] })
    expect(results(d).pass('tracking-cdn')).toBe(false)
  })

  // --- Regression: reasonable alternatives must pass ---------------------------

  it('alternative: a separate projector worker feeds the tracking store (CQRS split)', () => {
    const d = mutate({
      dropEdges: (e) => isEdge('kafka', 'tracking')(e) || isEdge('tracking', 'trackCache')(e),
      addNodes: [['projector', 'worker', 'Tracking Projector', 1160, 220, { tech: 'go' }]],
      addEdges: [edge('kafka', 'projector', 'event'), edge('projector', 'trackCache', 'data'), edge('tracking', 'trackCache', 'data', 'read')],
    })
    expect(failingCore(d)).toEqual([])
  })

  it('alternative: a Flink job projects parcel events into OpenSearch', () => {
    const d = mutate({
      dropEdges: (e) => isEdge('kafka', 'tracking')(e) || isEdge('tracking', 'trackCache')(e),
      patch: { trackCache: { kind: 'search', tech: 'opensearch' } },
      addNodes: [['flink', 'stream-processor', 'Tracking Projection Job', 1160, 220, { tech: 'flink' }]],
      addEdges: [edge('kafka', 'flink', 'event'), edge('flink', 'trackCache', 'data'), edge('tracking', 'trackCache', 'data', 'read')],
    })
    expect(failingCore(d)).toEqual([])
  })

  it('alternative: self-hosted EMQX behind a TCP/TLS network load balancer', () => {
    const d = mutate({
      patch: { mqtt: { tech: 'emqx' } },
      dropEdges: (e) => isEdge('mqtt', 'lockers')(e) || isEdge('lockers', 'mqtt')(e),
      addNodes: [['nlb', 'load-balancer', 'NLB :8883', 280, 80, { tech: 'haproxy' }]],
      addEdges: [
        edge('lockers', 'nlb', 'event', 'MQTT/TLS'),
        edge('nlb', 'mqtt', 'event'),
        edge('mqtt', 'nlb', 'event'),
        edge('nlb', 'lockers', 'event', 'commands'),
      ],
    })
    expect(failingCore(d)).toEqual([])
    // Desired state kept by Locker Control and re-published over MQTT still earns the shadow bonus.
    expect(results(d).pass('device-shadow')).toBe(true)
  })

  it('alternative: transactional outbox drained by a polling publisher', () => {
    const d = mutate({
      dropEdges: isEdge('parcels', 'kafka'),
      addNodes: [['outbox', 'worker', 'Outbox Publisher', 1460, -60, { tech: 'spring-boot' }]],
      addEdges: [edge('outbox', 'parcelDb', 'data', 'poll outbox table'), edge('outbox', 'kafka', 'event', 'Parcel events')],
    })
    expect(failingCore(d)).toEqual([])
    const { pass } = results(d)
    expect(pass('replayable-parcel-log')).toBe(true)
    expect(pass('recipients-notified')).toBe(true)
  })

  it('alternative: long edge chain CDN -> WAF -> ALB -> gateway -> BFF -> tracking', () => {
    const d = mutate({
      dropEdges: isEdge('cdn', 'tracking'),
      addNodes: [
        ['waf', 'waf', 'WAF', 280, 500, { tech: 'aws-waf' }],
        ['alb', 'load-balancer', 'ALB', 560, 500, { tech: 'aws-alb' }],
        ['bff', 'bff', 'Web BFF', 560, 640, { tech: 'nextjs' }],
      ],
      addEdges: [edge('cdn', 'waf', 'http'), edge('waf', 'alb', 'http'), edge('alb', 'gw', 'http'), edge('gw', 'bff', 'http'), edge('bff', 'tracking', 'http')],
    })
    expect(results(d).pass('tracking-cdn')).toBe(true)
  })

  it('alternative: a label worker owned by the Shipments domain still counts as async rendering', () => {
    const d = mutate({ patch: { labelWorker: { domains: ['shipments'] } } })
    expect(results(d).pass('label-async')).toBe(true)
  })

  // --- Bonus checks ----------------------------------------------------------------

  it('bonus: RabbitMQ for parcel events loses only the replayable log', () => {
    expect(failing(mutate({ patch: { kafka: { tech: 'rabbitmq' } } }))).toEqual(['replayable-parcel-log'])
  })

  it('bonus: Mosquitto without any locker store has no desired-state persistence', () => {
    const d = mutate({ patch: { mqtt: { tech: 'mosquitto' } }, dropNodes: ['lockerDb'] })
    expect(failing(d)).toEqual(['device-shadow'])
  })

  it('bonus: Mosquitto with a Locker Control desired-state store keeps the bonus', () => {
    expect(failing(mutate({ patch: { mqtt: { tech: 'mosquitto' } } }))).toEqual([])
  })

  it('bonus: notifications without a push / SMS provider', () => {
    expect(failing(mutate({ dropNodes: ['push'] }))).toEqual(['recipients-notified'])
  })

  it('bonus: a gateway without rate limiting (plain Caddy proxy)', () => {
    expect(failing(mutate({ patch: { gw: { tech: 'caddy' } } }))).toEqual(['api-gateway-limits'])
  })

  it('bonus: no alerting on the peak day', () => {
    expect(failing(mutate({ dropNodes: ['alerts'] }))).toEqual(['peak-observability'])
  })

  it('a single-node odd graph does not throw', () => {
    const d = diagram([['x', 'device', 'Lone locker', 0, 0]], [])
    const { ev } = results(d, { stack: {} })
    expect(ev.results.every((r) => !r.detail?.startsWith('Check failed to run'))).toBe(true)
    expect(ev.passed).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { assertScenarioContract } from '../../engine/scenarioContract'
import { evaluateScenario } from '../../engine/evaluate'
import type { Decisions, Diagram } from '../../engine/types'
import { diagram, type EdgeSpec, type NodeSpec } from './builder'
import { integrationsHub } from './integrations'

const run = (d: Diagram, decisions: Decisions) => evaluateScenario(integrationsHub, d, decisions)
const failed = (d: Diagram, decisions: Decisions) =>
  run(d, decisions)
    .results.filter((r) => !r.pass)
    .map((r) => r.id)
const coreFailures = (d: Diagram, decisions: Decisions) =>
  run(d, decisions)
    .results.filter((r) => !r.pass && r.category !== 'bonus')
    .map((r) => `${r.category}:${r.id} ${r.detail ?? ''}`)

const microDecisions: Decisions = { style: 'microservices', communication: 'async', data: 'per-service', stack: { backend: 'go', messaging: 'kafka' } }
const monoDecisions: Decisions = { style: 'monolith', communication: 'async', data: 'per-service', stack: { backend: 'go', messaging: 'sqs' } }
const modularDecisions: Decisions = { ...monoDecisions, style: 'modular-monolith', stack: { backend: 'go', messaging: 'kafka' } }
const check = (id: string, d: Diagram, decisions: Decisions = monoDecisions) => run(d, decisions).results.find((r) => r.id === id)!

/** SQS alternative pieces, reused by the dead-letter variants. */
const sqsNodes: NodeSpec[] = [
  ['sites', 'web-app', 'Customer Websites', 0, 0],
  ['console', 'web-app', 'Console', 0, 200, { tech: 'vue' }],
  ['lb', 'load-balancer', 'Load Balancer', 260, 100, { tech: 'haproxy' }],
  ['ingest', 'service', 'Ingest & Replay API', 520, 0, { tech: 'ktor', domains: ['ingestion', 'replay'] }],
  ['control', 'service', 'Control Plane', 520, 200, { tech: 'ktor', domains: ['workspaces'] }],
  ['pg', 'relational-db', 'Config DB', 780, 300, { tech: 'mysql' }],
  ['s3', 'object-storage', 'Raw Archive', 780, -120, { tech: 'gcs' }],
  ['sqs', 'broker', 'Events Queue', 780, 0, { tech: 'sqs' }],
  ['dlq', 'broker', 'Dead Letters', 1300, 200, { tech: 'sqs' }],
  ['worker', 'worker', 'Connector Workers', 1040, 0, { tech: 'ktor', domains: ['delivery', 'retries'] }],
  ['valkey', 'cache', 'Destination Limits', 1300, 100, { tech: 'valkey' }],
  ['x1', 'external', 'CRMs', 1300, -120, { tech: 'generic-api' }],
  ['x2', 'external', 'Ad Platforms', 1300, 0, { tech: 'generic-api' }],
]
const sqsEdges: EdgeSpec[] = [
  ['sites', 'lb'],
  ['console', 'lb'],
  ['lb', 'ingest', 'http'],
  ['lb', 'control', 'http'],
  ['ingest', 'control', 'http', 'write keys'],
  ['control', 'pg'],
  ['ingest', 's3', 'data', 'archive'],
  ['ingest', 'sqs', 'event'],
  ['sqs', 'worker', 'event'],
  ['worker', 'valkey'],
  ['worker', 'x1'],
  ['worker', 'x2'],
]

describe('syncly-consolidation', () => {
  assertScenarioContract(integrationsHub)

  it('starter sprawl trips the sprawl and bucket-bus anti-patterns and the pool check', () => {
    const ids = failed(integrationsHub.starter!, integrationsHub.starterDecisions!)
    expect(ids).toEqual(expect.arrayContaining(['connector-pool', 'anti-service-sprawl', 'anti-bucket-bus', 'replay-archive', 'style-fit']))
  })

  it('wrong: tidied-up "one service per destination" on Kafka still fails pool and sprawl', () => {
    const d = diagram(
      [
        ['sites', 'web-app', 'Websites', 0, 0],
        ['gw', 'api-gateway', 'Gateway', 260, 0, { tech: 'kong' }],
        ['ingest', 'service', 'Ingest', 520, 0, { tech: 'go', domains: ['ingestion', 'workspaces'] }],
        ['pg', 'relational-db', 'Config', 520, 120, { tech: 'postgres' }],
        ['kafka', 'broker', 'Kafka', 780, 0, { tech: 'kafka' }],
        ['crm', 'service', 'CRM Connector', 1040, -120, { tech: 'go', domains: ['delivery', 'retries'] }],
        ['email', 'service', 'Email Connector', 1040, 0, { tech: 'go', domains: ['delivery', 'retries'] }],
        ['ads', 'service', 'Ads Connector', 1040, 120, { tech: 'go', domains: ['delivery', 'retries'] }],
        ['replay', 'service', 'Replay', 1040, 240, { tech: 'go', domains: ['replay'] }],
        ['s3', 'object-storage', 'Archive', 1300, 240, { tech: 's3' }],
        ['redis', 'cache', 'Limits', 1300, 120, { tech: 'redis' }],
        ['xCrm', 'external', 'CRM', 1560, -120, { tech: 'generic-api' }],
        ['xEmail', 'external', 'Email', 1560, 0, { tech: 'generic-api' }],
        ['xAds', 'external', 'Ads', 1560, 120, { tech: 'generic-api' }],
      ],
      [
        ['sites', 'gw'],
        ['gw', 'ingest'],
        ['ingest', 'pg'],
        ['ingest', 'kafka', 'event'],
        ['kafka', 'crm', 'event'],
        ['kafka', 'email', 'event'],
        ['kafka', 'ads', 'event'],
        ['crm', 'xCrm'],
        ['email', 'xEmail'],
        ['ads', 'xAds'],
        ['crm', 'kafka', 'event', 'dlq'],
        ['ads', 'redis'],
        ['kafka', 'replay', 'event'],
        ['replay', 's3'],
        ['replay', 'kafka', 'event'],
      ],
    )
    const ids = failed(d, microDecisions)
    expect(ids).toEqual(expect.arrayContaining(['connector-pool', 'anti-service-sprawl', 'style-fit']))
    expect(ids).not.toContain('durable-log')
    expect(ids).not.toContain('async-delivery')
  })

  it('wrong: ingest API calls one connector worker synchronously (no log, no DLQ)', () => {
    const d = diagram(
      [
        ['sites', 'web-app', 'Websites', 0, 0],
        ['lb', 'load-balancer', 'LB', 260, 0, { tech: 'aws-alb' }],
        ['ingest', 'service', 'Ingest', 520, 0, { tech: 'go', domains: ['ingestion', 'workspaces', 'replay'] }],
        ['pg', 'relational-db', 'Config', 520, 120, { tech: 'postgres' }],
        ['s3', 'object-storage', 'Archive', 520, 240, { tech: 's3' }],
        ['worker', 'worker', 'Connector Worker', 780, 0, { tech: 'go', domains: ['delivery', 'retries'] }],
        ['redis', 'cache', 'Limits', 1040, 120, { tech: 'redis' }],
        ['x', 'external', 'Destinations', 1040, 0, { tech: 'generic-api' }],
      ],
      [
        ['sites', 'lb'],
        ['lb', 'ingest', 'http'],
        ['ingest', 'pg'],
        ['ingest', 's3'],
        ['ingest', 'worker', 'http', 'deliver now'],
        ['worker', 'x'],
        ['worker', 'redis'],
      ],
    )
    const ids = failed(d, monoDecisions)
    expect(ids).toEqual(expect.arrayContaining(['durable-log', 'async-delivery', 'dead-letters', 'replay-archive']))
    expect(ids).not.toContain('connector-pool')
  })

  it('wrong: per-step functions chained through S3 trip the bucket-bus anti-pattern', () => {
    const d = diagram(
      [
        ['sites', 'web-app', 'Websites', 0, 0],
        ['gw', 'api-gateway', 'API GW', 260, 0, { tech: 'aws-api-gateway' }],
        ['fnIngest', 'function', 'Ingest fn', 520, 0, { tech: 'aws-lambda', domains: ['ingestion', 'replay'] }],
        ['s3a', 'object-storage', 'Stage 1', 780, 0, { tech: 's3' }],
        ['fnTransform', 'function', 'Transform fn', 1040, 0, { tech: 'aws-lambda', domains: ['workspaces'] }],
        ['s3b', 'object-storage', 'Stage 2', 1300, 0, { tech: 's3' }],
        ['fnDeliver', 'function', 'Deliver fn', 1560, 0, { tech: 'aws-lambda', domains: ['delivery', 'retries'] }],
        ['x', 'external', 'Destinations', 1820, 0, { tech: 'generic-api' }],
      ],
      [
        ['sites', 'gw'],
        ['gw', 'fnIngest', 'http'],
        ['fnIngest', 's3a', 'data'],
        ['s3a', 'fnTransform', 'event', 'ObjectCreated'],
        ['fnTransform', 's3b', 'data'],
        ['s3b', 'fnDeliver', 'event', 'ObjectCreated'],
        ['fnDeliver', 'x'],
      ],
    )
    const ids = failed(d, { style: 'serverless', stack: {} })
    expect(ids).toEqual(expect.arrayContaining(['anti-bucket-bus', 'durable-log', 'async-delivery', 'style-fit']))
  })

  it('wrong: Redis pub/sub as the event log is not durable', () => {
    const ref = integrationsHub.reference.diagram
    const d: Diagram = { ...ref, nodes: ref.nodes.map((n) => (n.id === 'kafka' ? { ...n, tech: 'redis' } : n)) }
    expect(failed(d, integrationsHub.reference.decisions)).toContain('durable-log')
  })

  it('alternative: SQS + one stand-alone connector worker pool passes all core checks', () => {
    const d = diagram(sqsNodes, [...sqsEdges, ['worker', 'dlq', 'event', 'after 8 attempts']])
    expect(coreFailures(d, monoDecisions)).toEqual([])
  })

  it('a replay function reading an archive written by a service is not a bucket bus', () => {
    const d = diagram(
      [
        ['ingest', 'service', 'Ingest', 0, 0, { tech: 'go', domains: ['ingestion'] }],
        ['s3', 'object-storage', 'Archive', 260, 0, { tech: 's3' }],
        ['fn', 'function', 'Replay fn', 520, 0, { tech: 'aws-lambda', domains: ['replay'] }],
      ],
      [
        ['ingest', 's3', 'data'],
        ['s3', 'fn', 'data'],
      ],
    )
    const r = run(d, monoDecisions).results.find((x) => x.id === 'anti-bucket-bus')
    expect(r?.pass).toBe(true)
  })

  // --- dead-letters -------------------------------------------------------

  it('gaming: a worker that only reads the Config DB has no dead-letter path', () => {
    const d = diagram(sqsNodes, [...sqsEdges, ['worker', 'pg', 'data', 'destination settings']])
    expect(check('dead-letters', d).pass).toBe(false)
  })

  it('alternative: a parked-events table counts as the dead-letter store', () => {
    const d = diagram(
      [...sqsNodes, ['parked', 'relational-db', 'Parked Events', 1300, 300, { tech: 'postgres' }]],
      [...sqsEdges, ['worker', 'parked', 'data']],
    )
    expect(check('dead-letters', d).pass).toBe(true)
  })

  it('alternative: SQS native redrive to a DLQ passes all core checks', () => {
    const d = diagram(sqsNodes, [...sqsEdges, ['sqs', 'dlq', 'event', 'redrive after 8']])
    expect(coreFailures(d, monoDecisions)).toEqual([])
  })

  // --- durable-log / async-delivery with ingestion inside the application ---

  it('alternative: a single monolith that appends to Kafka and consumes it back passes all core checks', () => {
    const d = diagram(
      [
        ['sites', 'web-app', 'Websites', 0, 0],
        ['lb', 'load-balancer', 'LB', 260, 0, { tech: 'aws-alb' }],
        ['app', 'monolith', 'Syncly App', 520, 0, { tech: 'spring-boot', domains: ['ingestion', 'workspaces', 'delivery', 'retries', 'replay'] }],
        ['kafka', 'broker', 'Events', 780, 0, { tech: 'redpanda' }],
        ['pg', 'relational-db', 'Workspaces DB', 520, 160, { tech: 'postgres' }],
        ['redis', 'cache', 'Limits', 780, 160, { tech: 'redis' }],
        ['s3', 'object-storage', 'Archive', 520, 280, { tech: 's3' }],
        ['x', 'external', 'Destinations', 1040, 0, { tech: 'generic-api' }],
      ],
      [
        ['sites', 'lb'],
        ['lb', 'app', 'http'],
        ['app', 'kafka', 'event', 'append + retry/DLQ topics'],
        ['kafka', 'app', 'event', 'consume'],
        ['app', 'pg'],
        ['app', 'redis'],
        ['app', 's3'],
        ['app', 'x', 'http'],
      ],
    )
    expect(coreFailures(d, monoDecisions)).toEqual([])
  })

  it('wrong: a monolith that publishes to Kafka but delivers inline fails durable-log', () => {
    const d = diagram(
      [
        ['app', 'monolith', 'Syncly App', 0, 0, { tech: 'go', domains: ['ingestion', 'delivery', 'retries'] }],
        ['kafka', 'broker', 'Events', 260, 0, { tech: 'kafka' }],
        ['x', 'external', 'Destinations', 520, 0, { tech: 'generic-api' }],
      ],
      [
        ['app', 'kafka', 'event'],
        ['app', 'x', 'http'],
      ],
    )
    expect(check('durable-log', d).pass).toBe(false)
  })

  it('alternative: modular monolith with an Ingest module and the destination edge on the container passes all core checks', () => {
    const d = diagram(
      [
        ['sites', 'web-app', 'Websites', 0, 0],
        ['gw', 'api-gateway', 'Gateway', 260, 0, { tech: 'kong' }],
        ['app', 'monolith', 'Syncly App', 520, 0, { tech: 'nestjs', w: 460, h: 260 }],
        ['ingest', 'module', 'Ingest', 20, 50, { tech: 'nestjs', domains: ['ingestion'], parent: 'app' }],
        ['ws', 'module', 'Workspaces', 240, 50, { tech: 'nestjs', domains: ['workspaces'], parent: 'app' }],
        ['conn', 'module', 'Connectors', 20, 160, { tech: 'nestjs', domains: ['delivery', 'retries'], parent: 'app' }],
        ['replay', 'module', 'Replay', 240, 160, { tech: 'nestjs', domains: ['replay'], parent: 'app' }],
        ['kafka', 'broker', 'Events', 1100, 0, { tech: 'kafka' }],
        ['pg', 'relational-db', 'Workspaces DB', 520, 320, { tech: 'postgres' }],
        ['redis', 'cache', 'Limits', 1100, 160, { tech: 'valkey' }],
        ['s3', 'object-storage', 'Archive', 1100, 280, { tech: 's3' }],
        ['x', 'external', 'Destinations', 1360, 0, { tech: 'generic-api' }],
      ],
      [
        ['sites', 'gw'],
        ['gw', 'ingest', 'http'],
        ['ingest', 'kafka', 'event'],
        ['kafka', 'conn', 'event'],
        ['conn', 'kafka', 'event', 'dlq'],
        ['conn', 'redis'],
        ['app', 'x', 'http', 'destination calls'],
        ['ws', 'pg'],
        ['kafka', 'replay', 'event'],
        ['replay', 's3'],
        ['replay', 'kafka', 'event'],
      ],
    )
    expect(coreFailures(d, modularDecisions)).toEqual([])
  })

  it('gaming: a sync call from the ingest deployable into the connector runtime fails async-delivery', () => {
    const ref = integrationsHub.reference.diagram
    const d: Diagram = { ...ref, edges: [...ref.edges, { id: 'cheat', source: 'ingest', target: 'core', protocol: 'http', label: 'deliver now' }] }
    expect(check('async-delivery', d, integrationsHub.reference.decisions).pass).toBe(false)
  })

  // --- anti-service-sprawl threshold ---------------------------------------

  const units = (n: number, extra: NodeSpec[] = []) =>
    diagram(
      [...Array.from({ length: n }, (_, i): NodeSpec => ['s' + i, 'service', 'Svc ' + i, 0, i * 100, { tech: 'go' }]), ...extra],
      [],
    )

  it('anti-service-sprawl: 4 runtime units pass, 5 fail, workers inside an application are not counted', () => {
    expect(check('anti-service-sprawl', units(4)).pass).toBe(true)
    expect(check('anti-service-sprawl', units(4, [['w', 'worker', 'Standalone Worker', 300, 0, { tech: 'go' }]])).pass).toBe(false)
    expect(check('anti-service-sprawl', units(5)).pass).toBe(false)
    const inside = units(3, [
      ['app', 'monolith', 'App', 300, 0, { tech: 'go', w: 240, h: 300 }],
      ['w1', 'worker', 'Worker 1', 20, 50, { tech: 'go', parent: 'app' }],
      ['w2', 'worker', 'Worker 2', 20, 160, { tech: 'go', parent: 'app' }],
    ])
    expect(check('anti-service-sprawl', inside).pass).toBe(true)
  })

  // --- anti-bucket-bus fairness and gaming ---------------------------------

  it('an ingest function writing the archive and a replay function reading it is not a bucket bus', () => {
    const d = diagram(
      [
        ['gw', 'api-gateway', 'API GW', 0, 0, { tech: 'aws-api-gateway' }],
        ['fnIngest', 'function', 'Ingest fn', 260, 0, { tech: 'aws-lambda', domains: ['ingestion'] }],
        ['kinesis', 'broker', 'Events', 520, 0, { tech: 'kinesis' }],
        ['s3', 'object-storage', 'Raw Archive', 260, 160, { tech: 's3' }],
        ['fnReplay', 'function', 'Replay fn', 520, 160, { tech: 'aws-lambda', domains: ['replay'] }],
      ],
      [
        ['gw', 'fnIngest', 'http'],
        ['fnIngest', 'kinesis', 'event'],
        ['fnIngest', 's3', 'data', 'archive'],
        ['s3', 'fnReplay', 'data'],
        ['fnReplay', 'kinesis', 'event', 're-publish'],
      ],
    )
    expect(check('anti-bucket-bus', d).pass).toBe(true)
  })

  it('gaming: container workers polling S3 stage by stage is still a bucket bus', () => {
    const d = diagram(
      [
        ['ingest', 'service', 'Ingest', 0, 0, { tech: 'go', domains: ['ingestion'] }],
        ['raw', 'object-storage', 'S3 Raw', 260, 0, { tech: 's3' }],
        ['parse', 'worker', 'Parse worker', 520, 0, { tech: 'go', domains: ['delivery'] }],
        ['parsed', 'object-storage', 'S3 Parsed', 780, 0, { tech: 's3' }],
        ['enrich', 'worker', 'Enrich worker', 1040, 0, { tech: 'go', domains: ['delivery'] }],
        ['wh', 'external', 'Warehouse', 1300, 0, { tech: 'generic-api' }],
      ],
      [
        ['ingest', 'raw', 'data'],
        ['parse', 'raw', 'data'],
        ['parse', 'parsed', 'data'],
        ['enrich', 'parsed', 'data'],
        ['enrich', 'wh', 'http'],
      ],
    )
    expect(check('anti-bucket-bus', d).pass).toBe(false)
  })

  // --- destination-isolation -----------------------------------------------

  it('destination-isolation fails without a shared cache, and Redis used only as the broker does not count', () => {
    const noCache = diagram(sqsNodes.filter((n) => n[0] !== 'valkey'), [...sqsEdges.filter((e) => e[1] !== 'valkey'), ['worker', 'dlq', 'event']])
    expect(check('destination-isolation', noCache).pass).toBe(false)
    const redisBroker = diagram(
      sqsNodes.filter((n) => n[0] !== 'valkey').map((n): NodeSpec => (n[0] === 'sqs' ? ['sqs', 'broker', 'Redis Streams', n[3], n[4], { tech: 'redis' }] : n)),
      [...sqsEdges.filter((e) => e[1] !== 'valkey'), ['worker', 'dlq', 'event']],
    )
    expect(check('destination-isolation', redisBroker).pass).toBe(false)
  })
})

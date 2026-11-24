import { describe, expect, it } from 'vitest'
import { assertScenarioContract } from '../../engine/scenarioContract'
import { evaluateScenario } from '../../engine/evaluate'
import type { Decisions, Diagram } from '../../engine/types'
import { diagram } from './builder'
import { tenantSaas } from './multitenant'

const ref = tenantSaas.reference

function results(d: Diagram, decisions: Decisions = ref.decisions) {
  const ev = evaluateScenario(tenantSaas, d, decisions)
  return { ev, byId: Object.fromEntries(ev.results.map((r) => [r.id, r])) }
}

function coreFailures(d: Diagram, decisions: Decisions = ref.decisions) {
  return results(d, decisions).ev.results.filter((r) => r.category === 'core' && !r.pass).map((r) => r.id)
}

describe('faktura-multitenant', () => {
  assertScenarioContract(tenantSaas)

  it('mistake: one pooled database for everyone and imports run in the web request', () => {
    // Classic first draft: a modular monolith, one Postgres for all tenants,
    // imports processed synchronously inside the app, billing called inline.
    const d = diagram(
      [
        ['web', 'web-app', 'Web', 0, 200, { tech: 'react' }],
        ['gw', 'api-gateway', 'Gateway', 260, 200, { tech: 'kong' }],
        ['idp', 'identity', 'IdP', 260, 360, { tech: 'keycloak' }],
        ['app', 'monolith', 'App', 520, 100, { tech: 'spring-boot', w: 500, h: 300 }],
        ['inv', 'module', 'Invoicing', 30, 60, { tech: 'spring-boot', domains: ['invoicing'], parent: 'app' }],
        ['imp', 'module', 'Imports', 270, 60, { tech: 'spring-boot', domains: ['imports'], parent: 'app' }],
        ['ten', 'module', 'Tenants', 30, 180, { tech: 'spring-boot', domains: ['tenants'], parent: 'app' }],
        ['bill', 'module', 'Billing', 270, 180, { tech: 'spring-boot', domains: ['billing'], parent: 'app' }],
        ['db', 'relational-db', 'Shared DB', 1100, 200, { tech: 'postgres' }],
        ['kv', 'secrets', 'Vault', 1100, 340, { tech: 'vault' }],
      ],
      [
        ['web', 'gw'],
        ['gw', 'idp'],
        ['gw', 'app'],
        ['inv', 'db'],
        ['imp', 'db'],
        ['ten', 'db'],
        ['bill', 'db'],
        ['inv', 'bill', 'http', 'record usage'],
        ['db', 'kv'],
      ],
    )
    const failed = coreFailures(d)
    expect(failed).toContain('bridge-model')
    expect(failed).toContain('imports-queued')
    expect(failed).toContain('metering-async')
    expect(failed).not.toContain('tenant-context')
  })

  it('mistake: clients call the app directly and pass the tenant in the URL', () => {
    const d = structuredClone(ref.diagram)
    d.nodes = d.nodes.filter((n) => !['cdn', 'gw', 'idp'].includes(n.id))
    d.edges = d.edges.filter((e) => ![e.source, e.target].some((x) => ['cdn', 'gw', 'idp'].includes(x)))
    d.edges.push({ id: 'direct', source: 'web', target: 'app', protocol: 'http', label: '?tenant=123' })
    const failed = coreFailures(d)
    expect(failed).toContain('tenant-context')
    expect(failed).toContain('tenant-rate-limits')
    expect(failed).not.toContain('bridge-model')
  })

  it('mistake: the "background" worker is called synchronously by the app', () => {
    const d = structuredClone(ref.diagram)
    d.edges = d.edges.filter((e) => !(e.source === 'queue' && e.target === 'worker'))
    d.edges.push({ id: 'sync-worker', source: 'imp', target: 'worker', protocol: 'http', label: 'run import' })
    const { byId } = results(d)
    expect(byId['imports-queued'].pass).toBe(false)
    expect(byId['imports-queued'].detail).toMatch(/synchronously/)
  })

  it('mistake: no key vault for the bank silos', () => {
    const d = structuredClone(ref.diagram)
    d.nodes = d.nodes.filter((n) => n.id !== 'kv')
    d.edges = d.edges.filter((e) => e.target !== 'kv')
    expect(coreFailures(d)).toEqual(['customer-keys'])
  })

  it('alternative: microservices with a separate bank cell passes every core check', () => {
    // Different topology: a dedicated "bank cell" deployment (silo stack) next to
    // the pooled invoicing service, RabbitMQ + serverless import workers, Envoy,
    // Auth0, HashiCorp Vault, metering via Kafka into BigQuery.
    const d = diagram(
      [
        ['web', 'web-app', 'Web', 0, 200, { tech: 'vue' }],
        ['mobile', 'mobile-app', 'Mobile', 0, 360, { tech: 'flutter' }],
        ['waf', 'waf', 'WAF', 260, 120, { tech: 'aws-waf' }],
        ['gw', 'api-gateway', 'Gateway', 260, 280, { tech: 'envoy' }],
        ['idp', 'identity', 'Auth0', 260, 440, { tech: 'auth0' }],
        ['tenants', 'service', 'Tenant Service', 520, 0, { tech: 'quarkus', domains: ['tenants'] }],
        ['tenantDb', 'relational-db', 'Tenant DB', 820, 0, { tech: 'postgres' }],
        ['billing', 'service', 'Billing', 520, 120, { tech: 'quarkus', domains: ['billing'] }],
        ['billingDb', 'relational-db', 'Billing DB', 820, 120, { tech: 'postgres' }],
        ['inv', 'service', 'Invoicing (pool)', 520, 240, { tech: 'quarkus', domains: ['invoicing'] }],
        ['poolDb', 'relational-db', 'Pool DB', 820, 240, { tech: 'postgres' }],
        ['cell', 'service', 'Bank Cell', 520, 360, { tech: 'quarkus', domains: ['invoicing', 'imports'] }],
        ['cellDb', 'relational-db', 'Bank Cell DB', 820, 360, { tech: 'oracle' }],
        ['imports', 'service', 'Import Intake', 520, 480, { tech: 'quarkus', domains: ['imports'] }],
        ['files', 'object-storage', 'Uploads', 820, 480, { tech: 'minio' }],
        ['rabbit', 'broker', 'Import Jobs', 1100, 480, { tech: 'rabbitmq' }],
        ['fn', 'function', 'Import Processor', 1360, 480, { tech: 'azure-functions', domains: ['imports'] }],
        ['events', 'broker', 'Usage Stream', 1100, 240, { tech: 'kafka' }],
        ['bq', 'analytics-db', 'Usage Warehouse', 1360, 240, { tech: 'bigquery' }],
        ['vault', 'secrets', 'Vault', 1100, 360, { tech: 'vault' }],
      ],
      [
        ['web', 'waf'],
        ['waf', 'gw'],
        ['mobile', 'gw'],
        ['gw', 'idp'],
        ['gw', 'tenants'],
        ['gw', 'inv'],
        ['gw', 'cell'],
        ['gw', 'imports'],
        ['tenants', 'tenantDb'],
        ['billing', 'billingDb'],
        ['inv', 'poolDb'],
        ['cell', 'cellDb'],
        ['cell', 'vault', 'data', 'bank CMK'],
        ['imports', 'files'],
        ['imports', 'rabbit', 'event'],
        ['rabbit', 'fn', 'event'],
        ['fn', 'inv', 'grpc', 'bulk insert'],
        ['inv', 'events', 'event'],
        ['cell', 'events', 'event'],
        ['events', 'billing', 'event'],
        ['events', 'bq', 'event'],
      ],
    )
    const decisions: Decisions = { style: 'microservices', communication: 'hybrid', data: 'per-service', stack: { backend: 'quarkus' } }
    const { ev } = results(d, decisions)
    const failedCore = ev.results.filter((r) => r.category === 'core' && !r.pass).map((r) => `${r.id}: ${r.detail ?? ''}`)
    expect(failedCore).toEqual([])
    const failedAnti = ev.results.filter((r) => r.category === 'antipattern' && !r.pass).map((r) => r.id)
    expect(failedAnti).toEqual([])
    expect(ev.passed).toBe(true)
  })

  // Regression tests for previously gameable / unfair checks ------------------

  function edit(fn: (d: Diagram) => void): Diagram {
    const d = structuredClone(ref.diagram)
    fn(d)
    return d
  }
  const drop = (d: Diagram, source: string, target: string) => {
    d.edges = d.edges.filter((e) => !(e.source === source && e.target === target))
  }
  const add = (d: Diagram, source: string, target: string, protocol: Diagram['edges'][number]['protocol'], label?: string) => {
    d.edges.push({ id: `t-${source}-${target}-${d.edges.length}`, source, target, protocol, label })
  }
  const node = (d: Diagram, id: string, kind: Diagram['nodes'][number]['kind'], label: string, x: number, y: number, tech?: string) => {
    d.nodes.push({ id, kind, label, x, y, tech, domains: [] })
  }

  it('gaming: pool + an unrelated second database (attachments) is not a bank silo', () => {
    const d = edit((d) => {
      d.nodes = d.nodes.filter((n) => n.id !== 'silo')
      d.edges = d.edges.filter((e) => e.source !== 'silo' && e.target !== 'silo')
      node(d, 'att', 'document-db', 'Attachments', 1100, 240, 'mongodb')
      add(d, 'inv', 'att', 'data', 'PDF attachments')
      add(d, 'att', 'kv', 'data', 'CMK')
    })
    const failed = coreFailures(d)
    expect(failed).toContain('bridge-model')
    expect(failed).toContain('customer-keys')
  })

  it('gaming: pool + the tenant catalog is not a bank silo', () => {
    const d = edit((d) => {
      d.nodes = d.nodes.filter((n) => n.id !== 'silo')
      d.edges = d.edges.filter((e) => e.source !== 'silo' && e.target !== 'silo')
      add(d, 'inv', 'catalog', 'data', 'tenant settings')
    })
    const { byId } = results(d)
    expect(byId['bridge-model'].pass).toBe(false)
    expect(byId['bridge-model'].detail).toMatch(/control plane/)
  })

  it('gaming: imports written inline, a metering worker consuming import events does not count as queued', () => {
    const d = edit((d) => {
      d.nodes = d.nodes.filter((n) => n.id !== 'worker')
      d.edges = d.edges.filter((e) => e.source !== 'worker' && e.target !== 'worker')
      add(d, 'imp', 'pooled', 'data', 'inline 2M rows')
      node(d, 'meter', 'worker', 'Metering aggregator', 1380, 160, 'spring-boot')
      add(d, 'queue', 'meter', 'event')
      add(d, 'meter', 'otel', 'telemetry')
    })
    const { byId } = results(d)
    expect(byId['imports-queued'].pass).toBe(false)
    expect(byId['imports-queued'].detail).toMatch(/never write the invoices/)
  })

  it('gaming: async metering does not excuse a per-request synchronous call to billing', () => {
    const d = edit((d) => add(d, 'inv', 'control', 'http', 'record usage (every request)'))
    const { byId } = results(d)
    expect(byId['metering-async'].pass).toBe(false)
    expect(byId['metering-async'].detail).toMatch(/synchronously/)
  })

  it('a synchronous tenant-config lookup from invoicing to the control plane is fine', () => {
    const d = edit((d) => add(d, 'inv', 'control', 'http', 'tenant config lookup'))
    expect(coreFailures(d)).toEqual([])
  })

  it('gaming: a vault holding the import worker’s DB password is not a customer-managed key', () => {
    const d = edit((d) => {
      drop(d, 'silo', 'kv')
      add(d, 'worker', 'kv', 'http', 'DB password')
    })
    expect(coreFailures(d)).toEqual(['customer-keys'])
  })

  it('gaming: a vault wired only to the parent application is not a customer-managed key', () => {
    const d = edit((d) => {
      drop(d, 'silo', 'kv')
      add(d, 'app', 'kv', 'data', 'app secrets')
    })
    expect(coreFailures(d)).toEqual(['customer-keys'])
  })

  it('an invoicing component that encrypts the silo with the vault key passes customer-keys', () => {
    const d = edit((d) => {
      drop(d, 'silo', 'kv')
      add(d, 'inv', 'kv', 'http', 'unwrap bank DEK')
    })
    expect(coreFailures(d)).toEqual([])
  })

  it('bonus: calling KSeF inline from the request path fails ksef-submission', () => {
    const d = edit((d) => {
      drop(d, 'ksefSub', 'ksef')
      add(d, 'inv', 'ksef', 'http', 'submit e-invoice')
    })
    const { byId } = results(d)
    expect(byId['ksef-submission'].pass).toBe(false)
    expect(coreFailures(d)).toEqual([])
  })

  it('NGINX as gateway counts as rate limiting (limit_req) even without a counter cache', () => {
    const d = edit((d) => {
      const gw = d.nodes.find((n) => n.id === 'gw')!
      gw.tech = 'nginx'
      drop(d, 'gw', 'quota')
    })
    expect(coreFailures(d)).toEqual([])
  })

  /**
   * Modular monolith with Tenants and Billing as modules in the same app,
   * a 4-hop edge chain (Web → CDN → WAF → LB → Gateway) and metering through an
   * outbox table relayed by Debezium into Kafka.
   */
  function outboxMonolith(cdcReadsWal: boolean): Diagram {
    return diagram(
      [
        ['web', 'web-app', 'Web', 0, 240, { tech: 'react' }],
        ['cdn', 'cdn', 'CDN', 260, 0, { tech: 'cloudfront' }],
        ['waf', 'waf', 'WAF', 260, 120, { tech: 'aws-waf' }],
        ['lb', 'load-balancer', 'Load balancer', 260, 240, { tech: 'aws-alb' }],
        ['gw', 'api-gateway', 'Gateway', 260, 360, { tech: 'spring-cloud-gateway' }],
        ['redis', 'cache', 'Limits', 0, 480, { tech: 'redis' }],
        ['idp', 'identity', 'Keycloak', 260, 480, { tech: 'keycloak' }],
        ['app', 'monolith', 'Faktulo App', 520, 100, { tech: 'spring-boot', w: 500, h: 260 }],
        ['inv', 'module', 'Invoicing', 30, 50, { tech: 'spring-boot', domains: ['invoicing'], parent: 'app' }],
        ['imp', 'module', 'Imports', 270, 50, { tech: 'spring-boot', domains: ['imports'], parent: 'app' }],
        ['ten', 'module', 'Tenants', 30, 160, { tech: 'spring-boot', domains: ['tenants'], parent: 'app' }],
        ['bill', 'module', 'Billing', 270, 160, { tech: 'spring-boot', domains: ['billing'], parent: 'app' }],
        ['pool', 'relational-db', 'Shared Postgres (RLS)', 1100, 0, { tech: 'postgres' }],
        ['bankDb', 'relational-db', 'Dedicated bank DBs', 1100, 120, { tech: 'postgres' }],
        ['tenantDb', 'relational-db', 'Tenant registry', 1100, 240, { tech: 'postgres' }],
        ['vault', 'secrets', 'Vault Transit', 1380, 120, { tech: 'vault' }],
        ['rabbit', 'broker', 'Import jobs', 1100, 360, { tech: 'rabbitmq' }],
        ['worker', 'worker', 'Import worker', 1380, 360, { tech: 'spring-boot', domains: ['imports'] }],
        ['cdc', 'cdc', 'Outbox relay', 1380, 0, { tech: 'debezium' }],
        ['kafka', 'broker', 'Usage topic', 1100, 480, { tech: 'kafka' }],
      ],
      [
        ['web', 'cdn'],
        ['cdn', 'waf'],
        ['waf', 'lb'],
        ['lb', 'gw'],
        ['gw', 'redis', 'data'],
        ['gw', 'idp'],
        ['gw', 'app'],
        ['inv', 'pool'],
        ['inv', 'bankDb'],
        ['bankDb', 'vault', 'data', 'per-bank CMK'],
        ['ten', 'tenantDb'],
        ['bill', 'tenantDb'],
        ['imp', 'rabbit', 'event'],
        ['rabbit', 'worker', 'event'],
        ['worker', 'pool', 'data'],
        ['worker', 'bankDb', 'data'],
        cdcReadsWal ? ['cdc', 'pool', 'data', 'read WAL'] : ['pool', 'cdc', 'event', 'outbox'],
        ['cdc', 'kafka', 'event'],
        ['kafka', 'bill', 'event'],
      ],
    )
  }

  it('alternative: modular monolith behind CDN → WAF → LB → gateway with outbox + CDC metering (cdc reads WAL)', () => {
    const d = outboxMonolith(true)
    const failed = results(d).ev.results.filter((r) => r.category !== 'bonus' && !r.pass && r.id !== 'tech-choices')
    expect(failed.map((r) => `${r.id}: ${r.detail ?? ''}`)).toEqual([])
  })

  it('alternative: the same design with the edge drawn DB → CDC also passes', () => {
    expect(coreFailures(outboxMonolith(false))).toEqual([])
  })

  it('alternative: bank cells without "bank" in any label are recognised by topology', () => {
    const d = diagram(
      [
        ['web', 'web-app', 'Web', 0, 200, { tech: 'react' }],
        ['gw', 'api-gateway', 'Gateway', 260, 200, { tech: 'envoy' }],
        ['idp', 'identity', 'IdP', 260, 360, { tech: 'auth0' }],
        ['ctl', 'service', 'Control', 520, 0, { tech: 'spring-boot', domains: ['tenants', 'billing'] }],
        ['a', 'service', 'Invoicing A', 520, 160, { tech: 'spring-boot', domains: ['invoicing', 'imports'] }],
        ['b', 'service', 'Invoicing B', 520, 280, { tech: 'spring-boot', domains: ['invoicing', 'imports'] }],
        ['dbA', 'relational-db', 'Invoices A', 820, 160, { tech: 'postgres' }],
        ['dbB', 'relational-db', 'Invoices B', 820, 280, { tech: 'postgres' }],
        ['kms', 'secrets', 'KMS', 1100, 280, { tech: 'aws-secrets' }],
        ['q', 'broker', 'Jobs', 820, 400, { tech: 'sqs' }],
        ['fn', 'function', 'Importer', 1100, 400, { tech: 'aws-lambda', domains: ['imports'] }],
      ],
      [
        ['web', 'gw'],
        ['gw', 'idp'],
        ['gw', 'a'],
        ['gw', 'b'],
        ['a', 'dbA'],
        ['b', 'dbB'],
        ['dbB', 'kms', 'data'],
        ['a', 'q', 'event'],
        ['b', 'q', 'event'],
        ['q', 'fn', 'event'],
        ['q', 'ctl', 'event'],
        ['fn', 'dbA', 'data'],
      ],
    )
    expect(coreFailures(d, { style: 'microservices', stack: {} })).toEqual([])
  })

  it('odd graphs do not throw', () => {
    const d = diagram(
      [
        ['gw', 'api-gateway', 'Gateway', 0, 0],
        ['orphan', 'module', 'Loose module', 260, 0, { domains: ['invoicing', 'imports', 'billing', 'tenants'] }],
        ['kv', 'secrets', 'Vault', 520, 0],
        ['w', 'worker', 'Worker', 780, 0, { domains: ['imports'] }],
        ['cdc', 'cdc', 'CDC', 1040, 0],
        ['ksef', 'external', 'KSeF', 1300, 0],
        ['db', 'relational-db', 'DB', 1560, 0],
      ],
      [
        ['orphan', 'db', 'data'],
        ['db', 'cdc', 'event'],
        ['w', 'w', 'event'],
        ['orphan', 'orphan', 'http', 'record usage'],
      ],
    )
    expect(() => evaluateScenario(tenantSaas, d, { stack: {} })).not.toThrow()
    expect(() => evaluateScenario(tenantSaas, { nodes: d.nodes, edges: [] }, { stack: {} })).not.toThrow()
  })

  it('reference passes every scenario check including bonus', () => {
    const { ev } = results(ref.diagram)
    expect(ev.results.filter((r) => !r.pass)).toEqual([])
  })
})

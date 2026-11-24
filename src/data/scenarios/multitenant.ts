import type { ComponentKind, DiagramNode, Scenario } from '../../engine/types'
import type { Graph } from '../../engine/graph'
import { CLIENT_KINDS, COMPUTE_KINDS, DB_KINDS } from '../../engine/graph'
import { SYNC_PROTOCOLS } from '../../engine/types'
import { diagram } from './builder'

// Helpers -------------------------------------------------------------------

const ASYNC_PROCESSORS: ComponentKind[] = ['worker', 'function']

/** Labels / notes that mark a store as dedicated to the bank tenants. */
const SILO = /bank|silo|dedicated|enterprise|cell|isolat|premium|per[- ]?(tenant|bank)|single[- ]?tenant/i
/** Labels that mark a store as the shared pool (never a silo, even if it says "multi-tenant"). */
const POOL = /pool|shared|smb|multi[- ]?tenant/i
/** Sync calls to billing that are look-ups (plan, limits, routing), not per-request metering. */
const LOOKUP = /config|look ?up|tier|rout|resolve|entitle|plan|limit|quota|catalog|provision|signup|admin/i
/** Sync calls that are clearly metering / billing on the request path. */
const METER = /usage|meter|record|count|bill|charge|track/i
const KSEF = /ksef|e-?invoic|e-?faktur|tax|krajow|government|\bmf\b/i
/** Gateways that rate-limit natively even though the catalogue has no trait for it (NGINX limit_req). */
const NATIVE_RATE_LIMIT = new Set(['nginx'])

const ids = (nodes: DiagramNode[]) => new Set(nodes.map((n) => n.id))
const text = (n: DiagramNode) => `${n.label} ${n.notes ?? ''}`

/** Components of the control plane (tenants / billing) that are not also part of invoicing. */
function controlNodes(g: Graph): DiagramNode[] {
  const inv = ids(g.ownerFamily('invoicing'))
  return [...g.ownerFamily('tenants'), ...g.ownerFamily('billing')].filter((n) => !inv.has(n.id))
}

/** All databases holding invoice data (pool + silos). */
function invoiceStores(g: Graph): DiagramNode[] {
  return g.storesOf(g.ownerFamily('invoicing'), DB_KINDS)
}

/**
 * Which invoice stores are dedicated (silo) storage for the banks. A store
 * counts if its label / notes say so, or — in the cell model — if invoicing
 * runs as two or more deployables that each have a database of their own.
 * Stores the control plane also uses (e.g. the tenant catalog) never count.
 */
function tenancy(g: Graph) {
  const all = invoiceStores(g)
  const control = ids(g.storesOf(controlNodes(g), DB_KINDS))
  const candidates = all.filter((s) => !control.has(s.id))
  const named = candidates.filter((s) => SILO.test(text(s)) && !POOL.test(s.label))
  // Cell model: count deployables of invoicing and the stores only they use.
  const unitsByStore = new Map<string, Set<string>>()
  for (const o of g.owners('invoicing')) {
    const unit = g.deployable(o).id
    for (const s of g.storesOf(g.family(o), DB_KINDS)) {
      if (control.has(s.id)) continue
      if (!unitsByStore.has(s.id)) unitsByStore.set(s.id, new Set())
      unitsByStore.get(s.id)!.add(unit)
    }
  }
  const exclusive = candidates.filter((s) => unitsByStore.get(s.id)?.size === 1)
  const cellUnits = new Set(exclusive.map((s) => [...unitsByStore.get(s.id)!][0]))
  const cells = cellUnits.size >= 2
  const silos = named.length ? named : cells ? exclusive : []
  return { all, control, silos, cells }
}

/** CDC relays attached (in either direction) to a database of invoicing or imports. */
function cdcRelays(g: Graph): DiagramNode[] {
  const stores = ids(g.storesOf([...g.ownerFamily('invoicing'), ...g.ownerFamily('imports')], DB_KINDS))
  return g.ofKind('cdc').filter((c) => g.neighbours(c.id).some((n) => stores.has(n.id)))
}

/**
 * Workers / functions that actually perform the import: they own Bulk imports,
 * or they are fed by the Imports owner and write invoice data (directly or via
 * the Invoicing component). A worker that merely consumes an import event to
 * meter it does not count.
 */
function importProcessors(g: Graph): DiagramNode[] {
  const fam = g.ownerFamily('imports')
  if (!fam.length) return []
  const inv = ids(g.ownerFamily('invoicing'))
  const stores = ids(invoiceStores(g))
  return g.ofKind(...ASYNC_PROCESSORS).filter((w) => {
    if (w.domains.includes('imports')) return true
    const writes = g.storesOf([w], DB_KINDS).some((s) => stores.has(s.id)) || g.targets(w.id).some((t) => inv.has(t.id))
    return writes && g.asyncFlow(fam.filter((f) => f.id !== w.id), [w])
  })
}

/** Like Graph.clientsEnterThrough, but allows a longer CDN → WAF → LB edge chain. */
function clientsEnter(g: Graph, entryKinds: ComponentKind[]): { pass: boolean; detail?: string } {
  const clients = g.ofKind(...CLIENT_KINDS)
  if (!clients.length) return { pass: false, detail: 'No clients on the canvas.' }
  const edge: ComponentKind[] = ['cdn', 'waf', 'load-balancer']
  const bypass = clients.filter((c) => g.targets(c.id, SYNC_PROTOCOLS).some((t) => COMPUTE_KINDS.includes(t.kind) && !entryKinds.includes(t.kind)))
  if (bypass.length) return { pass: false, detail: `${bypass.map((c) => c.label).join(', ')} call services directly, bypassing the gateway that resolves the tenant.` }
  const missing = clients.filter((c) => !g.reaches(c, (t) => entryKinds.includes(t.kind), { through: edge, maxDepth: 5 }))
  return missing.length ? { pass: false, detail: `${missing.map((c) => c.label).join(', ')} never reach the gateway.` } : { pass: true }
}

export const tenantSaas: Scenario = {
  id: 'faktura-multitenant',
  title: 'Faktulo: 5,000 tenants, 3 banks',
  tagline: 'Pool the many, silo the few — and stop one tenant’s import from slowing everyone down.',
  industry: 'SaaS platform',
  difficulty: 'intermediate',
  estMinutes: 35,
  accent: '#9333ea',
  concepts: ['multi-tenancy', 'rate-limiting', 'queue-load-leveling', 'background-jobs', 'secrets-management', 'oauth-oidc', 'cell-based-architecture'],
  story:
    'Faktulo is a Kraków-based invoicing SaaS that 5,000 small businesses use for a few złoty a month — accountants, bakeries, one-person software shops. Last month the sales team closed three banks that want Faktulo white-labelled for their business customers, and the contracts are strict: dedicated data storage, encryption keys the bank controls, and data that never leaves Poland. Meanwhile, on 31 December one tenant’s year-end import of 2 million historical invoices pinned the database for four hours and every other tenant saw timeouts on the busiest invoicing day of the year. The CTO wants one platform that stays cheap for the long tail, passes the banks’ isolation audits, and never again lets one tenant hurt the others.',
  facts: [
    { label: 'Tenants', value: '5,000 SMBs + 3 banks (~40% of volume)' },
    { label: 'Traffic', value: '1.2M invoices/month, 300 req/s at month-end' },
    { label: 'Team', value: '9 engineers, Kotlin / Spring' },
    { label: 'Targets', value: 'p95 < 300 ms, ≤ €1.20 infra per SMB tenant/month' },
  ],
  functional: [
    'Self-service signup provisions a new SMB tenant in under a minute',
    'Issue, correct and send invoices; submit each one to KSeF, Poland’s national e-invoicing system',
    'Bulk import of contractors and historical invoices from CSV / ERP exports (up to millions of rows)',
    'Enterprise onboarding provisions dedicated storage for each bank',
    'Meter usage per tenant (invoices issued, API calls, imported rows) and bill monthly by plan',
  ],
  nonFunctional: [
    'No tenant can ever read another tenant’s data — the tenant comes from the token, never from a URL parameter',
    'One tenant’s burst or import must not degrade latency for the others (noisy neighbour)',
    'Cost per SMB tenant stays low — no dedicated infrastructure for the 5,000',
    'Bank data encrypted with customer-managed keys; revoking the key makes the data unreadable',
    'Latency, errors and usage visible per tenant',
  ],
  constraints: [
    'Bank data must stay in Polish data centres (e.g. Azure Poland Central or GCP Warsaw)',
    'Nine engineers and one on-call rotation — no 30-service platform',
    'Banks audit tenant isolation yearly; dedicated storage per bank is in the contract',
  ],
  domains: [
    { id: 'tenants', label: 'Tenant management', description: 'Onboarding, provisioning, plans and where each tenant’s data lives (control plane)' },
    { id: 'billing', label: 'Billing & metering', description: 'Usage metering, plan limits and monthly subscription invoices' },
    { id: 'invoicing', label: 'Invoicing', description: 'Invoices, corrections, contractors and KSeF submission (application plane)' },
    { id: 'imports', label: 'Bulk imports', description: 'Year-end CSV / ERP imports processed in the background' },
  ],
  recommendedStyles: ['modular-monolith', 'microservices'],
  styleFeedback: {
    'modular-monolith':
      'Great fit for nine engineers: one application plane with Invoicing and Imports modules, a small separate control plane, and background workers — tenancy is enforced in one place instead of in every service.',
    microservices:
      'Defensible: splitting control plane, invoicing and imports lets you scale and silo them independently — but with nine engineers keep the number of services small and the tenant context propagated consistently.',
    'event-driven':
      'Events are the right tool for metering, KSeF submission and imports, but making every invoice flow a choreography of events adds complexity the brief does not need — issuing an invoice is simple request/response.',
    monolith:
      'A single undivided deployable tends to run imports inside the same process and the same connection pool as invoicing — exactly how one tenant’s year-end import stalled everyone — and gives no clear seam for routing banks to their own storage.',
    serverless:
      'Per-request functions make per-tenant cost attractive, but thousands of concurrent functions cause connection storms on a pooled Postgres, a 2M-row import must be chunked to fit execution limits, and cold starts hurt the p95 target — fine for import workers, a poor primary style.',
  },
  hints: [
    'Split the platform in two: a control plane (who the tenants are, their plan, where their data lives) and an application plane (the invoices themselves).',
    'Tenant identity must come from a trusted source: the identity provider puts a tenant_id claim into the token and the gateway validates it before routing.',
    'You do not need 5,003 databases. Pool the SMBs in one database with tenant_id on every row (row-level security) and give each bank a dedicated database — the bridge model. Label the silo so a reviewer can tell it apart from the pool.',
    'Throttle per tenant at the gateway (counters and quotas in Redis) so one tenant’s burst stays its own problem.',
    'Year-end imports: upload the file to object storage, then split it into chunk messages (e.g. 10k rows) on a queue keyed by tenant_id (a session / message group per tenant), so each tenant has at most one chunk in flight and workers interleave tenants; cap worker concurrency at what the database sustains.',
    'Encrypt each bank’s silo with a key in a vault / managed HSM the bank controls, and publish usage events (and KSeF submissions) through a broker instead of calling billing or KSeF on every request.',
  ],
  checks: [
    {
      id: 'tenant-context',
      title: 'Tenant identity comes from a validated token',
      category: 'core',
      why: 'In a pooled system the tenant id is the most security-critical value you have. It must come from a signed token (an OIDC claim) validated at the entry point, never from a header or URL the client can change.',
      hint: 'Route every client through an API gateway and connect the gateway to an Identity provider that issues tokens with a tenant claim.',
      concepts: ['multi-tenancy', 'oauth-oidc', 'api-gateway'],
      test: (g) => {
        const entries = g.ofKind('api-gateway', 'bff')
        if (!entries.length) return { pass: false, detail: 'No gateway / BFF to validate tokens and resolve the tenant.' }
        if (!g.has('identity')) return { pass: false, detail: 'No identity provider issuing tokens with a tenant claim.' }
        const linked =
          entries.some((e) => g.neighbours(e.id).some((n) => n.kind === 'identity')) ||
          g.ofKind(...CLIENT_KINDS).some((c) => g.targets(c.id).some((t) => t.kind === 'identity'))
        if (!linked) return { pass: false, detail: 'The identity provider is not connected to the entry point or the clients.' }
        return clientsEnter(g, ['api-gateway', 'bff'])
      },
    },
    {
      id: 'bridge-model',
      title: 'Pooled storage for SMBs, dedicated storage for banks',
      category: 'core',
      why: 'One pooled database (tenant_id + row-level security) keeps 5,000 small tenants cheap; the banks contractually need their own storage. Running both side by side is the bridge model — isolation where it is paid for, sharing everywhere else.',
      hint: 'Connect the Invoicing owner to a pooled database and to a dedicated database labelled for the bank tenants (e.g. “Bank silo DB”) — or route banks to their own cell with its own database.',
      concepts: ['multi-tenancy', 'cell-based-architecture'],
      test: (g) => {
        if (!g.owned('invoicing')) return { pass: false, detail: 'Nobody owns Invoicing yet.' }
        const { all, control, silos, cells } = tenancy(g)
        if (!all.length) return { pass: false, detail: 'Invoices have no database.' }
        if (all.length === 1)
          return {
            pass: false,
            detail: `All tenants share ${all[0].label}. The banks require dedicated storage — add a silo database next to the pool.`,
          }
        if (!silos.length) {
          const shared = all.filter((s) => control.has(s.id))
          return {
            pass: false,
            detail: shared.length
              ? `${shared.map((s) => s.label).join(', ')} is also used by the control plane, so it is not a bank silo. Add a database dedicated to the bank tenants (label it, e.g. “Bank silo DB”) or give the banks their own cell.`
              : `None of ${all.map((s) => s.label).join(', ')} is marked as dedicated bank storage. Label the silo (e.g. “Bank silo DB”) or give the banks their own cell with its own database.`,
          }
        }
        const pool = all.filter((s) => !silos.includes(s))
        if (!pool.length && !cells) return { pass: false, detail: 'Every invoice store is a silo — where do the 5,000 SMB tenants share a pooled database?' }
        return { pass: true, detail: cells && !pool.length ? 'Invoicing runs as separate cells, each with its own database.' : `Pool: ${pool.map((s) => s.label).join(', ')} · Silo: ${silos.map((s) => s.label).join(', ')}.` }
      },
    },
    {
      id: 'tenant-rate-limits',
      title: 'Per-tenant rate limits at the entry point',
      category: 'core',
      why: 'Without per-tenant throttling a single tenant’s script or burst consumes shared capacity and everyone’s latency rises. A gateway enforcing limits and quotas keyed by the tenant claim contains the noisy neighbour.',
      hint: 'Use an API gateway with rate limiting (Kong, Envoy, Spring Cloud Gateway, NGINX limit_req…) — ideally backed by a shared counter store such as Redis so limits hold across replicas.',
      concepts: ['rate-limiting', 'multi-tenancy'],
      test: (g) => {
        const gws = g.ofKind('api-gateway')
        if (!gws.length) return { pass: false, detail: 'No API gateway to enforce per-tenant limits.' }
        const ok = gws.some(
          (gw) => !gw.tech || NATIVE_RATE_LIMIT.has(gw.tech) || g.hasTrait(gw, 'rate-limiting') || g.storesOf([gw], ['cache']).length > 0,
        )
        return ok ? true : { pass: false, detail: 'The chosen gateway has no rate limiting — pick one that does, or pair it with a shared counter store (e.g. Redis) for per-tenant limits.' }
      },
    },
    {
      id: 'imports-queued',
      title: 'Bulk imports run off a queue, not in the request path',
      category: 'core',
      why: 'A 2-million-row import executed inside a web request holds connections and locks for hours. Queue-based load levelling lets workers drain chunked jobs at a pace the database can sustain, and per-tenant sessions or message groups keep one tenant from starving the rest.',
      hint: 'Imports owner → Queue (broker) → Import workers that write the rows. Nothing should call the workers synchronously.',
      concepts: ['queue-load-leveling', 'background-jobs'],
      test: (g) => {
        if (!g.owned('imports')) return { pass: false, detail: 'Nobody owns Bulk imports.' }
        const processors = importProcessors(g)
        if (!processors.length) {
          const fam = g.ownerFamily('imports')
          const consumers = g.ofKind(...ASYNC_PROCESSORS).filter((w) => g.asyncFlow(fam, [w]))
          return {
            pass: false,
            detail: consumers.length
              ? `${consumers.map((w) => w.label).join(', ')} consume import events but never write the invoices — the import itself still runs in the request path.`
              : 'Imports are processed inside the request path — no background worker fed by a queue.',
          }
        }
        const syncCalled = processors.filter((p) => g.in(p.id, SYNC_PROTOCOLS).length > 0)
        const producers = g.ofKind(...COMPUTE_KINDS, 'api-gateway')
        const queued = processors.filter((p) => !syncCalled.includes(p) && g.asyncFlow(producers.filter((x) => x.id !== p.id), [p]))
        if (queued.length) return true
        return {
          pass: false,
          detail: syncCalled.length
            ? `${syncCalled.map((p) => p.label).join(', ')} called synchronously — the caller still waits for the import.`
            : 'Import workers are not fed through a queue.',
        }
      },
    },
    {
      id: 'customer-keys',
      title: 'Bank data encrypted with customer-managed keys',
      category: 'core',
      why: 'Customer-managed keys (BYOK, kept in a KMS / managed HSM the bank controls — one key per bank) let a bank revoke access to its data by revoking the key. The database or the application uses that key to encrypt the silo; it never sits in config files.',
      hint: 'Add a Secrets manager / key vault and connect it to the bank silo database, or to the invoicing component that encrypts the silo’s data.',
      concepts: ['secrets-management', 'multi-tenancy'],
      test: (g) => {
        const vaults = g.ofKind('secrets')
        if (!vaults.length) return { pass: false, detail: 'No key vault / KMS for customer-managed keys.' }
        const { silos } = tenancy(g)
        if (!silos.length) return { pass: false, detail: 'There is no dedicated bank storage yet for a customer-managed key to protect.' }
        const siloIds = ids(silos)
        const encrypters = g
          .ownerFamily('invoicing')
          .filter((n) => COMPUTE_KINDS.includes(n.kind) && g.storesOf([n], DB_KINDS).some((s) => siloIds.has(s.id)))
        const allowed = new Set([...siloIds, ...encrypters.map((n) => n.id)])
        const ok = vaults.some((v) => g.neighbours(v.id).some((n) => allowed.has(n.id)))
        return ok
          ? true
          : { pass: false, detail: `The key vault is not connected to ${silos.map((s) => s.label).join(', ')} or to the invoicing component that encrypts it — a vault holding ordinary app secrets is not a customer-managed key.` }
      },
    },
    {
      id: 'metering-async',
      title: 'Usage metering flows asynchronously',
      category: 'core',
      why: 'Every invoice, API call and imported row is a billable event. Calling billing synchronously on each request couples latency and availability to it; publishing usage events lets billing and analytics aggregate per tenant at their own pace.',
      hint: 'Publish usage events from Invoicing / Imports (or the gateway, or an outbox relay) to a broker consumed by Billing or an analytics store — and remove direct per-request calls to Billing.',
      concepts: ['multi-tenancy', 'event-driven'],
      test: (g) => {
        const billing = g.ownerFamily('billing')
        if (!billing.length) return { pass: false, detail: 'Nobody owns Billing & metering.' }
        const billingIds = ids(billing)
        const tenantIds = ids(g.ownerFamily('tenants'))
        const app = [...g.ownerFamily('invoicing'), ...g.ownerFamily('imports')]
        const offenders: string[] = []
        for (const n of app) {
          if (billingIds.has(n.id)) continue
          for (const e of g.out(n.id, SYNC_PROTOCOLS)) {
            const t = g.node(e.target)
            if (!t || !billingIds.has(t.id) || g.deployable(n).id === g.deployable(t).id) continue
            const label = e.label ?? ''
            const lookup = tenantIds.has(t.id) ? !METER.test(label) : LOOKUP.test(label) && !METER.test(label)
            if (!lookup) offenders.push(`${n.label} → ${t.label}`)
          }
        }
        if (offenders.length)
          return { pass: false, detail: `Billing is called synchronously on the request path (${[...new Set(offenders)].join(', ')}). Publish usage events instead.` }
        const producers = [...app, ...g.ofKind('api-gateway'), ...cdcRelays(g)]
        if (!producers.length) return { pass: false, detail: 'Nothing produces usage yet.' }
        const sinks = [...billing, ...g.ofKind('analytics-db')]
        return g.asyncFlow(producers, sinks) ? true : { pass: false, detail: 'Usage never reaches billing or analytics through a broker.' }
      },
    },
    {
      id: 'tenant-catalog',
      title: 'Control plane keeps its own tenant catalog',
      category: 'bonus',
      why: 'The control plane knows every tenant, its plan, tier (pool or silo) and data location. Keeping that catalog out of the application databases lets you onboard, migrate and audit tenants without touching invoice data.',
      hint: 'Give Tenant management its own database, separate from the pooled and silo invoice stores.',
      concepts: ['multi-tenancy', 'cell-based-architecture'],
      test: (g) => {
        const stores = g.storesOf(g.ownerFamily('tenants'), DB_KINDS)
        if (!stores.length) return { pass: false, detail: 'Tenant management has no database.' }
        const inv = ids(invoiceStores(g))
        return stores.some((s) => !inv.has(s.id)) ? true : { pass: false, detail: 'The tenant catalog lives inside the invoice database.' }
      },
    },
    {
      id: 'tenant-routing',
      title: 'Gateway resolves tenant tier and limits',
      category: 'bonus',
      why: 'Tenant-aware routing maps the tenant claim to its tier (pool or a bank silo) and its plan limits. Caching that map next to the gateway keeps the control plane off the hot path.',
      hint: 'Connect the gateway to a Cache holding routes and quotas, or to the Tenant management owner.',
      concepts: ['multi-tenancy', 'caching'],
      test: (g) => {
        const gws = g.ofKind('api-gateway', 'bff')
        if (!gws.length) return { pass: false, detail: 'No gateway.' }
        const tenants = ids(g.ownerFamily('tenants'))
        const ok = gws.some((gw) => g.targets(gw.id).some((t) => t.kind === 'cache' || tenants.has(t.id)))
        return ok ? true : { pass: false, detail: 'The gateway does not look up tenant routes or quotas.' }
      },
    },
    {
      id: 'import-staging',
      title: 'Import files staged in object storage',
      category: 'bonus',
      why: 'Uploading a 500 MB file straight into a queue message does not work. Store the file in object storage and put only a reference on the queue (claim check) — workers stream it in chunks and can resume.',
      hint: 'Connect the Imports owner to Object storage.',
      concepts: ['background-jobs'],
      test: (g) =>
        g.storesOf([...g.ownerFamily('imports'), ...importProcessors(g)], ['object-storage']).length > 0
          ? true
          : { pass: false, detail: 'Import files have nowhere to land.' },
    },
    {
      id: 'tenant-observability',
      title: 'Every component reports metrics and logs',
      category: 'bonus',
      why: 'To spot a noisy neighbour you need latency, errors and queue depth broken down by tenant_id. That only works if every deployable — gateway, app, workers — exports telemetry tagged with the tenant.',
      hint: 'Add a Metrics store and Log aggregation, and send telemetry from the gateway, services and workers.',
      concepts: ['observability', 'multi-tenancy'],
      test: (g) => {
        const base = g.ofKind('metrics').length && g.ofKind('logging').length
        if (!base) return { pass: false, detail: 'Add both a Metrics store and Log aggregation.' }
        const all = g.ofKind('service', 'monolith', 'worker', 'function', 'api-gateway')
        const inst = ids(g.instrumented())
        const missing = all.filter((n) => !inst.has(n.id))
        return missing.length ? { pass: false, detail: `No telemetry from: ${missing.map((m) => m.label).join(', ')}` } : true
      },
    },
    {
      id: 'ksef-submission',
      title: 'Invoices submitted to KSeF asynchronously',
      category: 'bonus',
      why: 'In Poland structured e-invoices must be submitted to KSeF, the national e-invoicing system. KSeF accepts an invoice, returns a reference number and confirms it later (UPO), and it has maintenance windows — so submission belongs behind a queue and a worker that retries and polls, not inline in the request.',
      hint: 'Publish an InvoiceIssued event to a broker and let a KSeF submitter worker call a Third-party API labelled KSeF.',
      test: (g) => {
        const inv = g.ownerFamily('invoicing')
        if (!inv.length) return { pass: false, detail: 'Nobody owns Invoicing.' }
        const ksef = g.ofKind('external').filter((n) => KSEF.test(n.label))
        if (!ksef.length) return { pass: false, detail: 'No KSeF integration found.' }
        const invIds = ids(inv)
        const producers = [...inv, ...cdcRelays(g)]
        if (g.asyncFlow(producers, ksef)) return true
        // A dedicated integration service fed through a broker also counts.
        const callers = ksef.flatMap((k) => g.sources(k.id)).filter((c) => COMPUTE_KINDS.includes(c.kind) && !invIds.has(c.id))
        const fed = callers.some((c) => g.asyncFlow(producers, [c]) && !g.in(c.id, SYNC_PROTOCOLS).some((e) => invIds.has(e.source)))
        return fed
          ? true
          : { pass: false, detail: 'KSeF is called inline from the request path — submit through a queue and a worker that retries and polls for the UPO.' }
      },
    },
  ],
  inspiration: [
    { label: 'AWS SaaS Lens — Silo, pool and bridge models', url: 'https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/silo-pool-and-bridge-models.html' },
    { label: 'AWS — Tenant isolation in SaaS (whitepaper)', url: 'https://docs.aws.amazon.com/whitepapers/latest/saas-tenant-isolation-strategies/saas-tenant-isolation-strategies.html' },
  ],
  reference: {
    decisions: {
      style: 'modular-monolith',
      communication: 'hybrid',
      data: 'per-service',
      stack: { frontend: 'react', backend: 'spring-boot', database: 'postgres', messaging: 'azure-service-bus', cache: 'redis' },
      rationale:
        'Bridge model: one modular application plane serves every tenant, SMBs share a pooled Postgres with row-level security, each bank gets a dedicated Postgres encrypted with its own key. A small control plane owns tenants and billing; imports, KSeF submission and metering are asynchronous so no tenant — and no external system — can block another.',
    },
    walkthrough: [
      'Keycloak issues tokens carrying a tenant_id claim; Kong validates them, looks up the tenant’s tier and plan in Redis (cache-aside from the control plane) and enforces per-tenant rate limits and quotas before routing to the application plane.',
      'The application plane is a Spring Modulith app with Invoicing and Imports modules. A tenant-context filter sets the tenant on every connection, so SMB queries hit the pooled Postgres with row-level security and bank queries go to that bank’s dedicated database.',
      'Each bank silo is a managed Postgres in Azure Poland Central whose storage is encrypted with that bank’s own customer-managed key (one key per bank, in a vault / managed HSM the bank controls); revoking the key renders the data unreadable — exactly what the contracts ask for.',
      'Imports upload the file to Blob storage and split it into 10k-row chunk messages on Service Bus with one session per tenant, so each tenant has at most one chunk in flight, workers interleave tenants and worker concurrency is capped at what the databases can take — the year-end incident becomes a slower progress bar for one tenant, not an outage for everyone.',
      'Invoicing and the workers publish InvoiceIssued / RowsImported events to a Service Bus topic — one platform instead of adding Kafka at ~0.5 events/s. A KSeF submitter subscription sends each invoice, retries through maintenance windows and polls for the UPO; the control plane meters usage for billing and ClickHouse powers per-tenant usage dashboards.',
      'Gateway, app, control plane and workers export OTLP tagged with tenant_id to an OpenTelemetry Collector, so latency and queue depth can be sliced per tenant to catch the next noisy neighbour early.',
    ],
    diagram: diagram(
      [
        ['web', 'web-app', 'Faktulo Web', 0, 240, { tech: 'react' }],
        ['quota', 'cache', 'Tenant Routes & Quotas', 0, 400, { tech: 'redis', notes: 'Cache-aside from the Control Plane' }],
        ['gw', 'api-gateway', 'Tenant-aware Gateway', 260, 240, { tech: 'kong', notes: 'Validates tenant claim, per-tenant limits & quotas' }],
        ['idp', 'identity', 'Identity (tenant claim)', 260, 80, { tech: 'keycloak' }],
        ['app', 'monolith', 'Application Plane', 520, 100, { tech: 'spring-boot', w: 260, h: 240 }],
        ['inv', 'module', 'Invoicing', 30, 50, { tech: 'spring-boot', domains: ['invoicing'], parent: 'app' }],
        ['imp', 'module', 'Imports API', 30, 150, { tech: 'spring-boot', domains: ['imports'], parent: 'app' }],
        ['silo', 'relational-db', 'Bank Silo DBs ×3', 1100, 20, { tech: 'postgres', notes: 'One per bank, Azure Poland Central' }],
        ['kv', 'secrets', 'Bank Keys (CMK)', 1380, 20, { tech: 'azure-keyvault', notes: 'One key per bank, managed HSM' }],
        ['pooled', 'relational-db', 'Pooled DB (SMB · RLS)', 1100, 130, { tech: 'postgres', notes: 'tenant_id on every row + row-level security' }],
        ['worker', 'worker', 'Import Workers', 1380, 160, { tech: 'spring-boot', domains: ['imports'], notes: 'Concurrency capped per DB' }],
        ['queue', 'broker', 'Import Chunks (session/tenant)', 1380, 360, { tech: 'azure-service-bus' }],
        ['blob', 'object-storage', 'Import Files', 820, 200, { tech: 'azure-blob' }],
        ['control', 'service', 'Control Plane', 520, 680, { tech: 'spring-boot', domains: ['tenants', 'billing'], notes: 'Onboarding provisions the org in Keycloak and the bank silo + key' }],
        ['catalog', 'relational-db', 'Tenant Catalog', 260, 680, { tech: 'postgres' }],
        ['events', 'broker', 'Invoice & Usage Events', 820, 480, { tech: 'azure-service-bus', notes: 'Topic with KSeF, metering and analytics subscriptions' }],
        ['ksefSub', 'worker', 'KSeF Submitter', 1100, 680, { tech: 'spring-boot', notes: 'Retries, polls UPO, respects maintenance windows' }],
        ['ksef', 'external', 'KSeF (e-invoicing)', 1380, 680, { tech: 'generic-api' }],
        ['analytics', 'analytics-db', 'Usage Analytics', 1380, 480, { tech: 'clickhouse' }],
        ['otel', 'otel-collector', 'OTel Collector', 820, 820, { tech: 'otel-collector' }],
        ['prom', 'metrics', 'Metrics (by tenant)', 1100, 800, { tech: 'prometheus' }],
        ['loki', 'logging', 'Logs', 1100, 900, { tech: 'loki' }],
      ],
      [
        ['web', 'gw'],
        ['gw', 'idp', 'http', 'validate token'],
        ['gw', 'quota', 'data', 'tier + limits'],
        ['gw', 'app'],
        ['gw', 'control', 'http', 'signup · admin · tenant lookup'],
        ['control', 'catalog'],
        ['inv', 'pooled', 'data', 'SMB tenants'],
        ['inv', 'silo', 'data', 'bank tenants'],
        ['silo', 'kv', 'data', 'CMK (data encryption)'],
        ['imp', 'blob', 'data', 'upload'],
        ['imp', 'queue', 'event', 'ImportChunk ×N'],
        ['queue', 'worker', 'event'],
        ['worker', 'blob', 'data', 'stream chunk'],
        ['worker', 'pooled', 'data'],
        ['worker', 'silo', 'data'],
        ['app', 'events', 'event', 'InvoiceIssued'],
        ['worker', 'events', 'event', 'RowsImported'],
        ['events', 'ksefSub', 'event'],
        ['ksefSub', 'ksef', 'http', 'submit + poll UPO'],
        ['events', 'control', 'event', 'metered usage'],
        ['events', 'analytics', 'event'],
        ['gw', 'otel', 'telemetry'],
        ['app', 'otel', 'telemetry'],
        ['control', 'otel', 'telemetry'],
        ['worker', 'otel', 'telemetry'],
        ['ksefSub', 'otel', 'telemetry'],
        ['otel', 'prom', 'telemetry'],
        ['otel', 'loki', 'telemetry'],
      ],
    ),
  },
}

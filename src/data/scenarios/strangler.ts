import type { ComponentKind, DiagramNode, Protocol, Scenario } from '../../engine/types'
import { SYNC_PROTOCOLS } from '../../engine/types'
import { CLIENT_KINDS, COMPUTE_KINDS, DB_KINDS, type Graph } from '../../engine/graph'
import { diagram, external, type EdgeSpec, type NodeSpec } from './builder'

// ---------------------------------------------------------------------------
// Helpers: "legacy" is the Java EE application (monolith container + modules)
// that still owns policies / claims / billing. "New quotes" is whatever owns
// the Quotes capability outside of it; "new owners" is any new component that
// owns one of the scenario's capabilities.
// ---------------------------------------------------------------------------

const DOMAIN_IDS = ['quotes', 'payments', 'policies', 'claims', 'billing', 'customers']
const LEGACY_DOMAINS = ['policies', 'claims', 'billing']
const FACADE_KINDS: ComponentKind[] = ['api-gateway', 'load-balancer', 'bff']
const EDGE_HOPS: ComponentKind[] = ['cdn', 'waf', 'load-balancer', 'api-gateway']
const TRANSLATOR_KINDS: ComponentKind[] = ['service', 'function', 'worker', 'bff', 'orchestrator', 'stream-processor']
const RELAY_KINDS: ComponentKind[] = ['worker', 'function', 'stream-processor']
const FLAGS = /flag|unleash|launchdarkly|flagsmith|growthbook|configcat|split\.io|toggle/i
const ROLLOUT = /canary|%|weight|shadow|dark.?launch|flag|toggle/i

function legacy(g: Graph) {
  const monoliths = g.ofKind('monolith')
  const owning = monoliths.filter((m) => [m, ...g.children(m.id)].some((n) => n.domains.some((d) => LEGACY_DOMAINS.includes(d))))
  const roots = owning.length ? owning : monoliths
  const nodes = roots.flatMap((r) => [r, ...g.children(r.id)])
  const ids = new Set(nodes.map((n) => n.id))
  const dbs = g.storesOf(nodes, DB_KINDS)
  return { roots, nodes, ids, dbs, dbIds: new Set(dbs.map((d) => d.id)) }
}

type Legacy = ReturnType<typeof legacy>

function newQuotes(g: Graph, legacyIds: Set<string>): DiagramNode[] {
  return g.ownerFamily('quotes').filter((n) => !legacyIds.has(n.id) && COMPUTE_KINDS.includes(n.kind))
}

/** Every new compute component (outside legacy) that owns a business capability, plus its container / modules. */
function newOwners(g: Graph, legacyIds: Set<string>): DiagramNode[] {
  const out = new Map<string, DiagramNode>()
  for (const d of DOMAIN_IDS) for (const n of g.ownerFamily(d)) if (!legacyIds.has(n.id) && COMPUTE_KINDS.includes(n.kind)) out.set(n.id, n)
  return [...out.values()]
}

/** CDC connectors attached to the legacy database. */
function legacyCdc(g: Graph, L: Legacy): DiagramNode[] {
  return g.ofKind('cdc').filter((c) => g.neighbours(c.id).some((n) => L.dbIds.has(n.id)))
}

/**
 * Outbox relays drawn as a worker / function: they poll the legacy database and
 * only publish to a broker — nobody calls them synchronously and they own no capability.
 */
function outboxRelays(g: Graph, L: Legacy): DiagramNode[] {
  return g.ofKind('worker', 'function').filter((n) => {
    if (L.ids.has(n.id) || n.domains.length || g.in(n.id, SYNC_PROTOCOLS).length) return false
    const out = g.out(n.id)
    const readsLegacy = out.some((e) => e.protocol === 'data' && L.dbIds.has(e.target))
    const publishes = out.some((e) => e.protocol === 'event' && g.node(e.target)?.kind === 'broker')
    const onlyRelay = out.every(
      (e) =>
        e.protocol === 'telemetry' ||
        (e.protocol === 'data' && L.dbIds.has(e.target)) ||
        (e.protocol === 'event' && g.node(e.target)?.kind === 'broker'),
    )
    return readsLegacy && publishes && onlyRelay
  })
}

/** Facades that route synchronously to both the legacy app and the new Quotes service (a BFF may sit behind the facade on the new side). */
function facades(g: Graph) {
  const L = legacy(g)
  const nq = new Set(newQuotes(g, L.ids).map((n) => n.id))
  const toLegacy = { through: EDGE_HOPS, protocols: SYNC_PROTOCOLS, maxDepth: 3 }
  const toNew = { through: [...EDGE_HOPS, 'bff'] as ComponentKind[], protocols: SYNC_PROTOCOLS, maxDepth: 3 }
  return g
    .ofKind(...FACADE_KINDS)
    .filter((f) => g.reaches(f, (n) => L.ids.has(n.id), toLegacy) && g.reaches(f, (n) => nq.has(n.id), toNew))
}

/**
 * Translating adapters: compute nodes that own no capability (so they are not
 * just another business service), are reached from new code and talk to the legacy app.
 */
function translators(g: Graph) {
  const L = legacy(g)
  const owners = newOwners(g, L.ids)
  const ownerIds = new Set(owners.map((n) => n.id))
  if (!owners.length) return []
  return g
    .ofKind(...TRANSLATOR_KINDS)
    .filter((x) => !L.ids.has(x.id) && !ownerIds.has(x.id) && x.domains.length === 0)
    .filter((x) => g.reaches(owners, (n) => n.id === x.id, { through: ['broker', 'api-gateway', 'load-balancer'], maxDepth: 3 }))
    .filter((x) => g.reaches(x, (n) => L.ids.has(n.id), { through: ['api-gateway', 'load-balancer'], maxDepth: 2 }))
}

// ---------------------------------------------------------------------------
// Starter: the 15-year-old system as it is today
// ---------------------------------------------------------------------------

const starterNodes: NodeSpec[] = [
  ['web', 'web-app', 'Agent Portal (JSF)', 0, 180, { notes: 'Server-rendered JSF screens served by PolisaCore' }],
  ['core', 'monolith', 'PolisaCore (Java EE)', 300, 40, { tech: 'spring-boot', w: 500, h: 330, notes: 'WebLogic, EJB 3, JSF — 1.2M lines (tech shown: closest JVM option)' }],
  ['mQuotes', 'module', 'Quotes', 20, 50, { tech: 'spring-boot', parent: 'core', domains: ['quotes'] }],
  ['mPolicies', 'module', 'Policies', 260, 50, { tech: 'spring-boot', parent: 'core', domains: ['policies'] }],
  ['mClaims', 'module', 'Claims', 20, 150, { tech: 'spring-boot', parent: 'core', domains: ['claims'] }],
  ['mBilling', 'module', 'Billing', 260, 150, { tech: 'spring-boot', parent: 'core', domains: ['billing', 'payments'] }],
  ['mCustomers', 'module', 'Customers', 140, 250, { tech: 'spring-boot', parent: 'core', domains: ['customers'] }],
  ['oracle', 'relational-db', 'Oracle 12c (one schema)', 900, 180, { tech: 'oracle', notes: '1,400 tables, nightly batch' }],
]
const starterEdges: EdgeSpec[] = [
  ['web', 'core', 'http', 'JSF pages (HTML)'],
  ['core', 'oracle', 'data', 'JPA + PL/SQL'],
]

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

export const insurerStrangler: Scenario = {
  id: 'polisa-strangler',
  title: 'Polisa24: strangle the 15-year-old monolith',
  tagline: 'Ship online quote & buy in six months — without a third failed big-bang rewrite.',
  industry: 'Insurance',
  difficulty: 'intermediate',
  estMinutes: 35,
  accent: '#2563eb',
  concepts: ['strangler-fig', 'anti-corruption-layer', 'cdc', 'api-gateway', 'database-per-service', 'service-granularity', 'observability'],
  story:
    'Polisa24 is a mid-sized Polish motor and home insurer whose entire business runs on PolisaCore, a 15-year-old Java EE monolith on a single Oracle database. Two big-bang rewrites were cancelled after burning 40 million złoty between them, and the board will not fund a third. Meanwhile digital-first competitors sell car insurance in three minutes on a phone, and Polisa24 still needs an agent to re-type quotes into JSF screens. The CEO has promised an online "quote & buy" journey within six months. Your job: grow the new system around the old one, slice by slice, without breaking the policies, claims and billing that pay everyone’s salary.',
  facts: [
    { label: 'Legacy', value: '1.2M lines Java EE, one Oracle schema with 1,400 tables' },
    { label: 'Team', value: '3 squads (18 devs), Java; 2 people know PolisaCore well' },
    { label: 'Traffic', value: '~40k quotes/day expected online, peaks of 60 rps after TV ads' },
    { label: 'Deadline', value: 'Quote & buy live in 6 months; quote p95 < 800 ms' },
  ],
  functional: [
    'Customers get a motor or home quote online in under three minutes',
    'Accepted quotes are paid online (BLIK / card) and become policies',
    'Agents keep using the existing portal unchanged; its traffic is re-pointed (DNS) to the new routing layer so agent routes can be migrated later',
    'Quotes use up-to-date customer data and tariff tables from the legacy system',
    'Routes can be switched from legacy to new (and back) without redeploying clients',
  ],
  nonFunctional: [
    'Quote p95 latency < 800 ms even while PolisaCore runs its nightly batch',
    'Rollback of any migrated route in minutes, not a release cycle',
    'Old and new paths observable side by side to compare prices and error rates',
    'New code must not depend on Oracle table structures it does not own',
  ],
  constraints: [
    'Policies, claims and billing stay in PolisaCore this year (Solvency II audit freeze)',
    'PolisaCore releases only once a month — changes to it must be minimal',
    'No big-bang cut-over: the board demands incremental delivery',
  ],
  domains: [
    { id: 'quotes', label: 'Quotes & pricing', description: 'Online quotes, tariff calculation, quote acceptance' },
    { id: 'payments', label: 'Online payments', description: 'First premium paid online before the policy is issued' },
    { id: 'policies', label: 'Policies', description: 'Policy issuance and lifecycle (legacy)' },
    { id: 'claims', label: 'Claims', description: 'Claims handling (legacy)' },
    { id: 'billing', label: 'Billing', description: 'Recurring premiums and invoices (legacy)' },
    { id: 'customers', label: 'Customers', description: 'Customer master data (legacy)' },
  ],
  recommendedStyles: ['event-driven', 'microservices', 'service-based'],
  styleFeedback: {
    'event-driven':
      'Great fit: change events streamed out of Oracle feed the new Quotes service, and accepted quotes flow back as events — new and old stay decoupled while you extract slice by slice.',
    microservices:
      'Good fit: extracting Quotes into its own deployable with its own data lets the new squad release daily while PolisaCore keeps its monthly cadence.',
    'modular-monolith':
      'Modularising PolisaCore is a sensible long-term hygiene step, but it does not give you a separately releasable quote journey in six months under a monthly release train and an audit freeze.',
    monolith:
      'Adding online quote & buy inside PolisaCore ties the new journey to the monthly release train, the nightly batch and the 1,400-table schema — exactly what the business is trying to escape.',
    serverless:
      'Functions could host small slices, but quote pricing needs warm tariff caches and steady p95 latency, and a Java team migrating a JVM monolith gains little from cold-start-sensitive FaaS here.',
    'service-based':
      'Good fit: carving the business into a handful of coarse domain services — Quotes and Payments first, PolisaCore treated as one big service for the rest — is a pragmatic target for 18 developers. Just never let the new services share PolisaCore’s Oracle schema: give them their own data and sync legacy data through CDC.',
    'space-based':
      '60 rps peaks after TV ads do not need an in-memory data grid. The hard part is escaping the legacy schema and release train, not extreme concurrency.',
    microkernel:
      'PolisaCore could in theory become a core with product plug-ins, but that means deep changes to a monolith that ships monthly under an audit freeze — the opposite of strangling it from the outside.',
  },
  starter: diagram(starterNodes, starterEdges),
  starterDecisions: {
    style: 'monolith',
    communication: 'sync',
    data: 'shared',
    stack: { backend: 'spring-boot', database: 'oracle' },
    rationale: 'Everything in PolisaCore (WebLogic + EJB, JSF screens), as it has been since 2011.',
  },
  hints: [
    'You cannot replace PolisaCore in one go. Which single capability does the business need new first?',
    'Put one routing point (an API gateway or reverse proxy) in front of BOTH PolisaCore and anything new, so you can move routes one at a time — and move them back.',
    'Extract Quotes as its own service with its own database. If it reads Oracle tables, you have just built a distributed monolith.',
    'Quotes still needs customers and tariff tables. Stream changes out of Oracle with CDC (Debezium) and keep a local read copy — no code change in PolisaCore, though the DBA must enable ARCHIVELOG mode and supplemental logging on the production database.',
    'Raw CDC events are table-shaped (Oracle rows and column names). Translate them into CustomerChanged / TariffChanged with a small stream processor before Quotes consumes them, and when a policy is bought let an adapter translate "PolicyPurchased" into PolisaCore’s legacy API — both are anti-corruption layers.',
    'Instrument old and new with the same telemetry pipeline and put the migrated route behind a feature flag or canary weight on the facade.',
  ],
  checks: [
    {
      id: 'routing-facade',
      title: 'One routing facade in front of legacy and new',
      category: 'core',
      why: 'The strangler fig works because a single facade decides, per route, whether PolisaCore or a new service answers. Clients never notice the switch, and a bad migration is rolled back by flipping a route.',
      hint: 'Route every client (agents too) through one API gateway / reverse proxy that calls both PolisaCore and the new Quotes service — directly or via a BFF.',
      concepts: ['strangler-fig', 'api-gateway'],
      test: (g) => {
        const L = legacy(g)
        if (!L.roots.length) return { pass: false, detail: 'PolisaCore is gone from the canvas — the strangler grows around the legacy app, it does not delete it on day one.' }
        if (!newQuotes(g, L.ids).length) return { pass: false, detail: 'There is no new Quotes component for the facade to route to yet.' }
        const fs = facades(g)
        if (!fs.length) return { pass: false, detail: 'No gateway / reverse proxy routes to both PolisaCore and the new Quotes service.' }
        const fIds = new Set(fs.map((f) => f.id))
        const clients = g.ofKind(...CLIENT_KINDS)
        if (!clients.length) return { pass: false, detail: 'No clients on the canvas.' }
        const bypass = clients.filter((c) => g.targets(c.id, SYNC_PROTOCOLS).some((t) => COMPUTE_KINDS.includes(t.kind) && !fIds.has(t.id)))
        if (bypass.length) return { pass: false, detail: `${bypass.map((c) => c.label).join(', ')} call a backend directly, bypassing the facade — that route can never be switched.` }
        const missing = clients.filter((c) => !g.reaches(c, (n) => fIds.has(n.id), { through: EDGE_HOPS, maxDepth: 4 }))
        return missing.length ? { pass: false, detail: `${missing.map((c) => c.label).join(', ')} do not go through the routing facade.` } : true
      },
    },
    {
      id: 'quotes-extracted',
      title: 'Quotes extracted into its own deployable',
      category: 'core',
      why: 'The new journey must ship on its own cadence. As long as Quotes lives inside PolisaCore it is stuck with the monthly release train and the nightly batch.',
      hint: 'Add a service (or function) outside PolisaCore and give it the "Quotes & pricing" capability.',
      concepts: ['strangler-fig', 'service-granularity'],
      test: (g) => {
        const nq = newQuotes(g, legacy(g).ids)
        return nq.some((n) => ['service', 'function', 'monolith'].includes(g.deployable(n).kind))
          ? true
          : { pass: false, detail: 'Quotes is only owned inside the legacy application.' }
      },
    },
    {
      id: 'quotes-own-db',
      title: 'New Quotes owns its data — not Oracle',
      category: 'core',
      why: 'If the new service reads PolisaCore’s tables, every Oracle schema change can break it and you cannot retire anything: a distributed monolith. A database per service keeps the new slice independent.',
      hint: 'Connect the Quotes service to its own database, and remove any data edge from it to the Oracle schema.',
      concepts: ['database-per-service'],
      test: (g) => {
        const L = legacy(g)
        const nq = newQuotes(g, L.ids)
        if (!nq.length) return { pass: false, detail: 'Extract Quotes first.' }
        const stores = g.storesOf(nq, DB_KINDS)
        const onLegacy = stores.filter((s) => L.dbIds.has(s.id))
        if (onLegacy.length) return { pass: false, detail: `Quotes reads ${onLegacy.map((s) => s.label).join(', ')} — legacy tables directly.` }
        const own = stores.filter((s) => !g.sources(s.id, ['data']).some((x) => L.ids.has(x.id)))
        return own.length ? true : { pass: false, detail: 'Quotes has no database of its own.' }
      },
    },
    {
      id: 'legacy-data-sync',
      title: 'Legacy reference data reaches Quotes asynchronously',
      category: 'core',
      why: 'Quotes needs customers and tariff tables that PolisaCore still owns. Streaming changes through a broker into a local copy keeps quote latency independent of the monolith and its nightly batch.',
      hint: 'Stream changes from PolisaCore / Oracle (a CDC connector such as Debezium, or an outbox relay) through a broker such as Kafka to the Quotes service or its database.',
      concepts: ['cdc', 'event-driven'],
      test: (g) => {
        const L = legacy(g)
        const nq = newQuotes(g, L.ids)
        if (!nq.length) return { pass: false, detail: 'Extract Quotes first.' }
        if (!L.roots.length) return { pass: false, detail: 'No legacy application to sync from.' }
        const from = [...L.nodes, ...L.dbs, ...legacyCdc(g, L), ...outboxRelays(g, L)]
        const to = [...nq, ...g.storesOf(nq, DB_KINDS)]
        return g.asyncFlow(from, to)
          ? true
          : { pass: false, detail: 'No path from PolisaCore or Oracle through a broker / CDC into Quotes. Synchronous lookups tie quote latency to the monolith.' }
      },
    },
    {
      id: 'acl',
      title: 'Anti-corruption layer between new and legacy',
      category: 'core',
      why: 'PolisaCore’s models ("POL_AGR_V2", 300-column policy rows, EJB faults) would leak into the new domain if Quotes called it directly. A dedicated translator keeps the new model clean and isolates legacy quirks in one place.',
      hint: 'Bought quotes must become policies in PolisaCore: route that through a small adapter (sync or via events) that owns no capability and only translates to the legacy API — no new business service calls PolisaCore itself.',
      concepts: ['anti-corruption-layer', 'strangler-fig'],
      test: (g) => {
        const L = legacy(g)
        const nq = newQuotes(g, L.ids)
        if (!nq.length || !L.roots.length) return { pass: false, detail: 'Extract Quotes next to PolisaCore first.' }
        const opts = { through: ['api-gateway', 'load-balancer'] as ComponentKind[], protocols: SYNC_PROTOCOLS, maxDepth: 3 }
        for (const o of newOwners(g, L.ids)) {
          const hit = g.reaches(o, (n) => L.ids.has(n.id), opts)
          if (hit) return { pass: false, detail: `${o.label} calls ${hit.label} directly — legacy models leak into new business code.` }
        }
        return translators(g).length
          ? true
          : { pass: false, detail: 'How does a bought quote become a policy in PolisaCore? Add a translating adapter between Quotes and the legacy API.' }
      },
    },
    {
      id: 'incremental-scope',
      title: 'Policies, claims and billing stay in PolisaCore for now',
      category: 'core',
      why: 'A strangler migration moves one slice at a time. Rewriting audited capabilities during a Solvency II freeze is the third big-bang rewrite in disguise.',
      hint: 'Keep the Policies, Claims and Billing modules inside the legacy application; extract only what the new journey needs.',
      concepts: ['strangler-fig'],
      test: (g) => {
        const monolithFamilies = new Set(g.ofKind('monolith').flatMap((m) => [m.id, ...g.children(m.id).map((c) => c.id)]))
        const moved = LEGACY_DOMAINS.filter((d) => !g.owners(d).some((o) => monolithFamilies.has(o.id)))
        if (moved.length) return { pass: false, detail: `No longer in the legacy app: ${moved.join(', ')}.` }
        const rogue = g.nodes.filter((n) => !monolithFamilies.has(n.id) && n.domains.some((d) => LEGACY_DOMAINS.includes(d)))
        if (rogue.length) return { pass: false, detail: `${rogue.map((r) => r.label).join(', ')} take over legacy capabilities during the audit freeze — that is a rewrite, not a slice.` }
        const split = LEGACY_DOMAINS.filter((d) => new Set(g.owners(d).map((o) => g.deployable(o).id)).size > 1)
        return split.length
          ? { pass: false, detail: `${split.join(', ')} are owned by more than one application — a second copy of audited logic is being built.` }
          : true
      },
    },
    {
      id: 'cdc-capture',
      title: 'Change data capture on the legacy database',
      category: 'bonus',
      why: 'CDC reads committed changes from Oracle’s redo log, so the new side gets a reliable stream of customer and tariff updates without touching 15-year-old code that releases once a month. The price is a DBA change: ARCHIVELOG mode and supplemental logging on the shared production database.',
      hint: 'Attach a CDC connector (Debezium on Kafka Connect) to the Oracle database and publish its change topics to the broker or a stream processor.',
      concepts: ['cdc'],
      test: (g) => {
        const cdc = legacyCdc(g, legacy(g))
        if (!cdc.length) return { pass: false, detail: 'No CDC connector attached to the legacy database.' }
        return cdc.some((c) => g.targets(c.id).some((t) => t.kind === 'broker' || t.kind === 'stream-processor'))
          ? true
          : { pass: false, detail: 'The CDC connector does not publish its change stream anywhere.' }
      },
    },
    {
      id: 'cdc-translated',
      title: 'Raw legacy changes are translated before new code uses them',
      category: 'bonus',
      why: 'Log-based CDC emits table-shaped events — before/after images of Oracle rows with legacy column names. If Quotes consumes them directly it depends on the 1,400-table schema again; a small translator turning them into CustomerChanged / TariffChanged is the anti-corruption layer on the read side.',
      hint: 'Put a stream processor (Kafka Streams / Flink) or worker that owns no capability between the CDC stream and Quotes, publishing clean domain events.',
      concepts: ['anti-corruption-layer', 'cdc', 'stream-processing'],
      test: (g) => {
        const L = legacy(g)
        const nq = newQuotes(g, L.ids)
        if (!nq.length) return { pass: false, detail: 'Extract Quotes first.' }
        const relays = outboxRelays(g, L)
        const sources = [...L.nodes, ...L.dbs, ...legacyCdc(g, L), ...relays]
        const owners = newOwners(g, L.ids)
        const targetIds = new Set([...owners, ...g.storesOf(owners, DB_KINDS)].map((n) => n.id))
        const relayIds = new Set(relays.map((r) => r.id))
        const fromLegacy = { through: ['broker', 'cdc'] as ComponentKind[], protocols: ['event', 'data'] as Protocol[], maxDepth: 4 }
        const toNew = { through: ['broker'] as ComponentKind[], protocols: ['event', 'data'] as Protocol[], maxDepth: 3 }
        const tx = g
          .ofKind(...RELAY_KINDS)
          .filter((t) => !L.ids.has(t.id) && !relayIds.has(t.id) && !targetIds.has(t.id) && t.domains.length === 0)
          .filter((t) => g.reaches(sources, (n) => n.id === t.id, fromLegacy) && g.reaches(t, (n) => targetIds.has(n.id), toNew))
        return tx.length
          ? true
          : { pass: false, detail: 'Legacy change events reach new code untranslated (or not at all) — Oracle table shapes leak into Quotes.' }
      },
    },
    {
      id: 'async-policy-issuance',
      title: 'Buying does not block on PolisaCore',
      category: 'bonus',
      why: 'PolisaCore is slow during its nightly batch and down during monthly releases. Publishing "PolicyPurchased" as an event lets customers finish checkout while the adapter issues the policy when the legacy is ready.',
      hint: 'New checkout code → broker → adapter (ACL) → PolisaCore, instead of a synchronous call at checkout.',
      concepts: ['event-driven', 'outbox'],
      test: (g) => {
        const L = legacy(g)
        if (!newQuotes(g, L.ids).length) return false
        return g.asyncFlow(newOwners(g, L.ids), [...L.nodes, ...translators(g)])
          ? true
          : { pass: false, detail: 'The new checkout hands bought policies to the legacy side synchronously (or not at all).' }
      },
    },
    {
      id: 'side-by-side-observability',
      title: 'Old and new observed side by side',
      category: 'bonus',
      why: 'During a migration the key question is "does the new path behave like the old one?" — same prices, error rates and latency. That needs the facade, PolisaCore and the new services in one telemetry pipeline.',
      hint: 'Send telemetry from the facade, PolisaCore and the Quotes service to the same collector / metrics backend.',
      concepts: ['observability', 'distributed-tracing'],
      test: (g) => {
        const L = legacy(g)
        const inst = new Set(g.instrumented().map((n) => n.id))
        const missing: string[] = []
        if (!L.nodes.some((n) => inst.has(n.id))) missing.push('PolisaCore')
        const nq = newQuotes(g, L.ids)
        if (!nq.length || !nq.some((n) => inst.has(n.id))) missing.push('Quotes')
        if (!facades(g).some((f) => g.out(f.id, ['telemetry']).length > 0)) missing.push('the routing facade')
        return missing.length ? { pass: false, detail: `Not instrumented: ${missing.join(', ')}.` } : true
      },
    },
    {
      id: 'progressive-rollout',
      title: 'Route switch behind a feature flag or canary',
      category: 'bonus',
      why: 'Moving 100% of quote traffic at once turns a strangler into a big bang. A flag or canary weight on the facade sends 5% to the new path first and rolls back in seconds.',
      hint: 'Connect a feature-flag service (e.g. Unleash) to the facade or Quotes, or label the facade → Quotes route with its canary weight.',
      concepts: ['strangler-fig'],
      test: (g) => {
        const L = legacy(g)
        const scope = [...facades(g), ...newQuotes(g, L.ids)]
        const ids = new Set(scope.map((n) => n.id))
        const isFlag = external(g, 'feature-flags', FLAGS)
        const flagged = scope.some((n) => g.neighbours(n.id).some(isFlag))
        const canary = g.edges.some((e) => ids.has(e.source) && ROLLOUT.test(e.label ?? ''))
        return flagged || canary ? true : { pass: false, detail: 'No feature flag or canary weight on the migrated route.' }
      },
    },
    {
      id: 'anti-legacy-tables',
      title: 'No new code reads or writes legacy tables',
      category: 'antipattern',
      why: 'Any new component with a JDBC connection to PolisaCore’s schema freezes that schema forever and bypasses its business rules. Read via CDC streams, write via the legacy API behind an anti-corruption layer.',
      hint: 'Remove data edges from new services, workers or functions to the Oracle database.',
      concepts: ['database-per-service', 'anti-corruption-layer'],
      test: (g) => {
        const L = legacy(g)
        const relays = new Set(outboxRelays(g, L).map((r) => r.id))
        const bad = g
          .ofKind(...COMPUTE_KINDS, 'stream-processor')
          .filter((n) => !L.ids.has(n.id) && !relays.has(n.id) && g.targets(n.id, ['data']).some((t) => L.dbIds.has(t.id)))
        return bad.length ? { pass: false, detail: `${bad.map((b) => b.label).join(', ')} touch the legacy schema directly.` } : true
      },
    },
  ],
  inspiration: [
    { label: 'Martin Fowler — Strangler Fig Application', url: 'https://martinfowler.com/bliki/StranglerFigApplication.html' },
    { label: 'InfoQ — Airbnb’s migration from monolith to SOA', url: 'https://www.infoq.com/news/2019/02/airbnb-monolith-migration-soa/' },
    { label: 'Google Cloud — PKO Bank Polski road to cloud', url: 'https://cloud.google.com/customers/pko-bank-polski' },
  ],
  reference: {
    decisions: {
      style: 'event-driven',
      communication: 'hybrid',
      data: 'per-service',
      stack: { backend: 'spring-boot', frontend: 'nextjs', database: 'postgres', messaging: 'kafka' },
      rationale:
        'Grow the new quote & buy slice around PolisaCore: one Kong facade switches routes, Debezium streams legacy changes that a small translator turns into domain events, and an ACL adapter is the only thing that speaks the legacy API.',
    },
    walkthrough: [
      'Kong becomes the strangler facade for both portals: /quote and /pay go to the new services, everything else still reaches PolisaCore, and an Unleash flag moves traffic gradually (5% → 50% → 100%) with instant rollback.',
      'Quotes is a new Spring Boot service with its own PostgreSQL; it never opens a connection to Oracle, so the 1,400-table schema can keep evolving underneath it.',
      'Debezium reads Oracle’s redo log (the DBA enables ARCHIVELOG and supplemental logging — the only change on the legacy side). Its raw, table-shaped change events go to a Kafka Streams translator that publishes clean CustomerChanged / TariffChanged events, which Quotes folds into a local read model.',
      'When the first premium is paid, Online Payments publishes PolicyPurchased; the Policy Adapter (anti-corruption layer) turns it into PolisaCore’s SOAP calls — createCustomer, issuePolicy and recordFirstPremium, so Billing still owns the recurring premiums — and absorbs legacy faults and retries.',
      'Policies, claims and billing stay in PolisaCore this year; the facade, PolisaCore and the new services all export OpenTelemetry, so Grafana can compare old and new quote prices, errors and latency side by side.',
      'Trade-off: the local read copy is eventually consistent (seconds behind Oracle), which is acceptable for quoting; policy issuance stays authoritative in the legacy system until it is the next slice to strangle.',
    ],
    diagram: diagram(
      [
        ['agent', 'web-app', 'Agent Portal (JSF)', 0, 160, { notes: 'Unchanged JSF screens; DNS now points at the facade' }],
        ['web', 'web-app', 'Quote & Buy (new)', 0, 320, { tech: 'nextjs' }],
        ['flags', 'external', 'Unleash (feature flags)', 260, 60, { tech: 'generic-api' }],
        ['gw', 'api-gateway', 'Strangler Facade', 260, 260, { tech: 'kong', notes: '/quote, /pay → new; everything else → PolisaCore' }],
        ['core', 'monolith', 'PolisaCore (Java EE)', 520, -40, { tech: 'spring-boot', w: 500, h: 240, notes: 'WebLogic + EJB (tech shown: closest JVM option). Policies, claims, billing stay here this year' }],
        ['mClaims', 'module', 'Claims', 20, 50, { tech: 'spring-boot', parent: 'core', domains: ['claims'] }],
        ['mBilling', 'module', 'Billing', 280, 50, { tech: 'spring-boot', parent: 'core', domains: ['billing'] }],
        ['mCustomers', 'module', 'Customers', 20, 150, { tech: 'spring-boot', parent: 'core', domains: ['customers'] }],
        ['mPolicies', 'module', 'Policies', 280, 150, { tech: 'spring-boot', parent: 'core', domains: ['policies'] }],
        ['acl', 'service', 'Policy Adapter (ACL)', 820, 260, { tech: 'spring-boot', notes: 'PolicyPurchased → legacy SOAP calls; retries around the nightly batch' }],
        ['quotes', 'service', 'Quotes', 580, 300, { tech: 'spring-boot', domains: ['quotes'] }],
        ['payments', 'service', 'Online Payments', 620, 500, { tech: 'spring-boot', domains: ['payments'] }],
        ['payu', 'external', 'PayU (BLIK, cards)', 820, 600, { tech: 'payu', notes: 'Payment status webhook back to Online Payments' }],
        ['oracle', 'relational-db', 'Oracle (legacy schema)', 1140, 160, { tech: 'oracle' }],
        ['debezium', 'cdc', 'Debezium CDC', 1400, 220, { tech: 'debezium', notes: 'CUSTOMER, TARIFF tables via LogMiner' }],
        ['cdcTx', 'stream-processor', 'Legacy Event Translator (ACL)', 1400, 320, { tech: 'kafka-streams', notes: 'Raw row changes → CustomerChanged / TariffChanged' }],
        ['quotesDb', 'relational-db', 'Quotes DB', 1140, 300, { tech: 'postgres', notes: 'Quotes + local read model of customers & tariffs' }],
        ['kafka', 'broker', 'Event Bus', 840, 400, { tech: 'kafka' }],
        ['paymentsDb', 'relational-db', 'Payments DB', 1140, 500, { tech: 'postgres' }],
        ['otel', 'otel-collector', 'OTel Collector', 0, 760, { tech: 'otel-collector' }],
        ['prom', 'metrics', 'Metrics', 260, 760, { tech: 'prometheus' }],
        ['grafana', 'dashboards', 'Old vs New Dashboard', 520, 760, { tech: 'grafana' }],
      ],
      [
        ['agent', 'gw', 'http'],
        ['web', 'gw', 'http'],
        ['gw', 'flags', 'http', 'route toggles'],
        ['gw', 'quotes', 'http', '/quote (canary 5%)'],
        ['gw', 'payments', 'http', '/pay'],
        ['gw', 'core', 'http', 'all other routes'],
        ['quotes', 'quotesDb', 'data'],
        ['payments', 'quotes', 'http', 'accepted quote'],
        ['payments', 'paymentsDb', 'data'],
        ['payments', 'payu', 'http', 'charge'],
        ['payments', 'kafka', 'event', 'PolicyPurchased'],
        ['kafka', 'acl', 'event', 'PolicyPurchased'],
        ['acl', 'core', 'http', 'createCustomer, issuePolicy, recordFirstPremium (SOAP)'],
        ['core', 'oracle', 'data'],
        ['oracle', 'debezium', 'event', 'redo log'],
        ['debezium', 'cdcTx', 'event', 'raw change topics'],
        ['cdcTx', 'kafka', 'event', 'CustomerChanged, TariffChanged'],
        ['kafka', 'quotes', 'event', 'CustomerChanged, TariffChanged'],
        ['gw', 'otel', 'telemetry'],
        ['quotes', 'otel', 'telemetry'],
        ['payments', 'otel', 'telemetry'],
        ['acl', 'otel', 'telemetry'],
        ['core', 'otel', 'telemetry'],
        ['otel', 'prom', 'telemetry'],
        ['grafana', 'prom', 'http'],
      ],
    ),
  },
}

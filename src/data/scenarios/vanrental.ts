import { SYNC_PROTOCOLS, type ComponentKind, type DiagramNode, type Scenario } from '../../engine/types'
import { COMPUTE_KINDS, DB_KINDS, type Graph } from '../../engine/graph'
import { TECH_BY_ID } from '../tech'
import { diagram, kindIs } from './builder'

// ---------------------------------------------------------------------------
// Helpers. A "domain unit" is a separately deployed thing (a service, or an
// Application container with modules inside) that owns business capabilities.
// Service-based architecture is about a handful of coarse units like that,
// sharing one database that is partitioned logically.
// ---------------------------------------------------------------------------

const DOMAIN_IDS = ['pricing', 'reservations', 'customers', 'pickup-return', 'fleet', 'maintenance', 'invoicing', 'payments', 'reporting']
/** Capabilities that change every week and scale on spring weekends. */
const FAST = ['pricing', 'reservations']
/** Capabilities that change a few times a year. */
const RARE = ['fleet', 'maintenance', 'invoicing', 'payments']
const UNIT_KINDS: ComponentKind[] = ['service', 'monolith']
const OWNER_KINDS: ComponentKind[] = ['service', 'monolith', 'module', 'plugin']
const ENTRY_KINDS: ComponentKind[] = ['api-gateway', 'bff']
const FEEDERS: ComponentKind[] = ['cdc', 'broker', 'worker', 'stream-processor', 'function']
/** Edge labels that mark read-only access to another domain's tables. */
const READ_ONLY = /\b(read|reads|read-only|readonly|view|views|select|lookup|r\/o)\b/i

interface Unit {
  node: DiagramNode
  domains: string[]
  family: DiagramNode[]
}

const labels = (ns: DiagramNode[]) => ns.map((n) => n.label).join(', ')
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

function domainUnits(g: Graph): Unit[] {
  const map = new Map<string, Unit>()
  for (const n of g.nodes) {
    if (!OWNER_KINDS.includes(n.kind)) continue
    const own = n.domains.filter((d) => DOMAIN_IDS.includes(d))
    if (!own.length) continue
    const u = g.deployable(n)
    if (!UNIT_KINDS.includes(u.kind)) continue
    const cur = map.get(u.id) ?? { node: u, domains: [], family: [u, ...g.children(u.id)] }
    for (const d of own) if (!cur.domains.includes(d)) cur.domains.push(d)
    map.set(u.id, cur)
  }
  return [...map.values()]
}

/** Units that run the business day to day — everything except a pure Reporting unit. */
const operationalUnits = (g: Graph) => domainUnits(g).filter((u) => !u.domains.every((d) => d === 'reporting'))

const unitsOwning = (g: Graph, domains: string[]) => domainUnits(g).filter((u) => u.domains.some((d) => domains.includes(d)))

/** The physical database a DB node belongs to: the Boundary it sits in (schemas of one database) or the node itself. */
function dbRoot(g: Graph, db: DiagramNode): DiagramNode {
  const p = g.parent(db)
  return p?.kind === 'zone' ? p : db
}

/** Every node that is part of the operational database: the roots the operational units use, plus all schemas inside them. */
function primaryNodes(g: Graph): Map<string, DiagramNode> {
  const out = new Map<string, DiagramNode>()
  for (const u of operationalUnits(g))
    for (const db of g.storesOf(u.family, DB_KINDS)) {
      const root = dbRoot(g, db)
      out.set(db.id, db)
      out.set(root.id, root)
      if (root.kind === 'zone') for (const c of g.children(root.id)) if (DB_KINDS.includes(c.kind)) out.set(c.id, c)
    }
  return out
}

const techName = (id: string) => TECH_BY_ID[id]?.name ?? id

export const vanRental: Scenario = {
  id: 'busik-van-rental',
  title: 'Busik: a van-rental chain outgrows its Delphi desk',
  tagline: '60 branches, one 15-year-old Oracle database and prices that change every Monday. Split the system, not the data.',
  industry: 'Mobility & rental',
  difficulty: 'intermediate',
  estMinutes: 30,
  accent: '#ea580c',
  concepts: [
    'service-based-architecture',
    'service-granularity',
    'architectural-quantum',
    'domain-vs-technical-partitioning',
    'microservices-reporting',
    'fitness-functions',
    'architecture-decision-records',
    'strangler-fig',
  ],
  story:
    'Busik has rented vans and light trucks from 60 branches across Poland since 2009, mostly to people moving flat and to small firms whose own van is in the workshop. Everything still runs on a Delphi desktop application written in 2010: branch PCs connect straight to one Oracle database in the Poznań server room, and the booking website is a PHP page bolted onto the same tables. Every change ships as a new installer to 60 branches on a Friday night, so the pricing team waits six weeks for a promotion a competitor launched on Monday. Over the May bank-holiday weekend the quote page timed out for four hours, because the only way to add capacity was a bigger database server. The board has approved a rebuild, but with the same 9-person IT team, no platform team and no appetite for a big-bang data migration. The Oracle database and its 15 years of reports have to survive the change.',
  facts: [
    { label: 'Network', value: '60 branches, 2,100 vans and light trucks (3.5–7.5 t)' },
    { label: 'Load', value: '~1,500 rentals/day; quotes run 5× higher on spring weekends (April–June)' },
    { label: 'Legacy', value: 'Delphi desktop + Oracle 19c: 1.6 TB, 420 tables, 380 PL/SQL procedures, 70 Crystal Reports' },
    { label: 'Team', value: '9 people: 6 developers, 1 DBA, 1 tester, 1 sysadmin' },
    { label: 'Change cadence', value: 'Pricing and booking weekly; fleet, maintenance and invoicing a few times a year' },
  ],
  functional: [
    'Customers get a quote and book a van online for a branch and time window, with extras (tow bar, trolley, blankets)',
    'Branch staff hand over and take back vehicles in a browser-based Branch Desk: contract, licence check, damage photos, fuel and mileage',
    'Fleet planners move vans between branches and schedule services and technical inspections',
    'Billing pre-authorises card deposits, takes online prepayments and sends every invoice to KSeF, the national e-invoicing system',
    'Head office runs utilisation and revenue reports per branch, including the 70 existing Crystal Reports',
  ],
  nonFunctional: [
    'Pricing and booking ship weekly without redeploying or retesting fleet, maintenance or invoicing',
    'On spring weekends the quote and booking path runs 3–4 extra instances; nothing else needs to scale',
    'Month-end reports never slow down the branch counters or the booking site',
    'Data migration risk stays low: no table moves to another database engine this year',
    'A failed deploy of one area (say, a new promotion engine) must not stop vans being handed over',
  ],
  constraints: [
    'Six developers know Delphi and SQL, two of them also C#; nobody has run Kubernetes, service meshes or a message broker',
    'Oracle 19c stays: the licences are paid until 2028, and the PL/SQL and the reports depend on its schema',
    'Splitting the database per service is out of scope for at least two years',
    'The Delphi client is retired branch by branch, so old and new screens share the same tables during the migration',
  ],
  domains: [
    { id: 'pricing', label: 'Pricing & promotions', description: 'Seasonal tariffs, weekend surcharges, promo codes, B2B price lists' },
    { id: 'reservations', label: 'Reservations & availability', description: 'Van classes per branch, booking calendar, extras' },
    { id: 'customers', label: 'Customers & licences', description: 'Private and business customers, driving-licence category checks, blocklist' },
    { id: 'pickup-return', label: 'Pick-up & return', description: 'Rental contracts, damage records, fuel and mileage at the counter' },
    { id: 'fleet', label: 'Fleet & transfers', description: 'Vehicle register, branch assignment, one-way transfers' },
    { id: 'maintenance', label: 'Service & inspections', description: 'Service intervals, technical inspections, tyres, partner workshops' },
    { id: 'invoicing', label: 'Invoicing & KSeF', description: 'Invoices, corrections, submission to the national e-invoicing system' },
    { id: 'payments', label: 'Deposits & payments', description: 'Card pre-authorisation, online prepayment, refunds' },
    { id: 'reporting', label: 'Reporting', description: 'Utilisation, revenue per branch, management and accounting reports' },
  ],
  recommendedStyles: ['service-based'],
  styleFeedback: {
    'service-based':
      'Best fit: four or five coarse domain services give pricing and booking their own deployment and scaling unit, while one shared Oracle database keeps the reports, the PL/SQL and the branch-by-branch migration working. It is the least distributed design that still meets the deployability and elasticity goals.',
    'modular-monolith':
      'Close, and a good way to organise the code, but it is still one deployable: every weekly tariff change ships and retests fleet and invoicing too, and extra weekend capacity for quotes means running copies of the whole application.',
    monolith:
      'This is roughly what Busik has today: a system split into UI, logic and data layers, where a pricing change touches every layer and every capability ships together every six weeks.',
    microservices:
      'Too much at once: microservices want a database per service, so 420 tables and 380 PL/SQL procedures would have to be pulled apart, and 9 people would end up running pipelines, service discovery and distributed transactions instead of shipping promotions.',
    'event-driven':
      'Events may help later (for example "van returned" → invoice), but a quote or a booking needs an immediate, consistent answer, and an asynchronous system adds brokers, eventual consistency and failure modes the team has never operated.',
    serverless:
      'Functions would scale the quote page, but hundreds of short-lived functions opening connections to one Oracle database on a Saturday morning will exhaust it, and the branch counters need steady latency, not cold starts.',
    'space-based':
      'Space-based architecture is built for extreme, unpredictable spikes (ticket sales, auctions): data lives in an in-memory grid and reaches the database asynchronously. Busik’s spring peak is predictable and moderate, and the grid, data pumps and writers would be the most complex system the team has ever run.',
    microkernel:
      'A plug-in core suits a product customised per client (pricing rules as plug-ins, say), but plug-ins deploy and scale with the core, so booking still would not get its own releases or its own weekend capacity.',
  },
  hints: [
    'Start from the change cadence in the brief: which capabilities change every week, and which a few times a year? That split is your first service boundary.',
    'Group the nine capabilities into a handful of coarse domain services (think 4–7, not 15). Each one owns several related capabilities and is deployed on its own.',
    'Keep one Oracle database. Draw it as a Boundary with one schema per domain service inside, so it is visible which service writes which tables. Label read-only access to another service’s tables "read".',
    'Services in this style rarely need to call each other, because the data they read is already in the shared database. If one service has to call another, keep it to a single hop.',
    'Both the booking site and the Branch Desk should enter through one API layer that routes to the domain services.',
    'Reports join everything. Point Reporting at a read replica or a warehouse instead of the database the counters write to.',
  ],
  checks: [
    {
      id: 'coarse-domain-services',
      title: 'A handful of coarse-grained domain services',
      category: 'core',
      why: 'Service-based architecture splits the system along the business domain into a few coarse services (typically 4–12), each owning several related capabilities and deployed on its own. That gives you separate deployments without the cost of dozens of tiny services. A service that owns no capability ("Common", "Validation", "Data Access") is technical partitioning in disguise: every domain depends on it, so every change goes through it.',
      hint: 'Draw 4–7 Services and give each several related capabilities in the inspector, for example Booking = pricing + reservations, Fleet = fleet + maintenance. Put shared code in a library, not in a service of its own.',
      concepts: ['service-based-architecture', 'service-granularity', 'domain-vs-technical-partitioning', 'code-reuse'],
      test: (g) => {
        const units = domainUnits(g)
        const empty = g.ofKind('service').filter((n) => !n.domains.some((d) => DOMAIN_IDS.includes(d)))
        if (empty.length)
          return {
            pass: false,
            detail: `${labels(empty)} own${plural(empty.length, 's', '')} no business capability. A shared utility service that every domain calls is technical partitioning in disguise; fold it into a domain service or make it a library.`,
          }
        if (units.length < 4)
          return {
            pass: false,
            detail: units.length
              ? `Only ${units.length} separately deployed domain ${plural(units.length, 'service', 'services')} (${labels(units.map((u) => u.node))}). Pricing and booking need to ship weekly without fleet and invoicing, so split the domain into at least four services.`
              : 'No separately deployed domain services yet.',
          }
        if (units.length >= DOMAIN_IDS.length)
          return {
            pass: false,
            detail: `${units.length} services for ${DOMAIN_IDS.length} capabilities is one service per capability or finer: microservice granularity, without the separate databases that make it work. Group related capabilities.`,
          }
        const coarse = units.filter((u) => u.domains.length >= 2)
        if (coarse.length * 2 < units.length)
          return {
            pass: false,
            detail: `Only ${coarse.length} of ${units.length} services own more than one capability. Domain services in this style are coarse: merge closely related capabilities (fleet + maintenance, invoicing + payments).`,
          }
        return { pass: true, detail: `${units.length} domain services for ${DOMAIN_IDS.length} capabilities.` }
      },
    },
    {
      id: 'booking-deploys-alone',
      title: 'Pricing and booking deploy and scale on their own',
      category: 'core',
      why: 'The architecture characteristics that drive this split are deployability (pricing changes weekly) and elasticity (quotes run 5× on spring weekends). Both apply to pricing and booking only. If those capabilities share a deployable with fleet maintenance or invoicing, every promotion redeploys and retests code that changes twice a year, and extra weekend instances copy all of it too.',
      hint: 'Give Pricing & promotions and Reservations to a Service that owns none of fleet, maintenance, invoicing or payments.',
      concepts: ['architecture-characteristics', 'architectural-quantum', 'service-based-architecture'],
      test: (g) => {
        const units = unitsOwning(g, FAST)
        const orphans = FAST.filter((d) => !g.owned(d))
        if (orphans.length) return { pass: false, detail: `Nobody owns ${orphans.join(' and ')} yet.` }
        if (!units.length) return { pass: false, detail: 'Pricing and reservations are not owned by a separately deployed service.' }
        for (const u of units) {
          const rare = u.domains.filter((d) => RARE.includes(d))
          if (rare.length)
            return {
              pass: false,
              detail: `${u.node.label} ships pricing/booking together with ${rare.join(', ')}. Every weekly tariff change would redeploy them, and weekend scaling would copy them.`,
            }
        }
        return true
      },
    },
    {
      id: 'one-shared-database',
      title: 'One shared database, kept on Oracle',
      category: 'core',
      why: 'Service-based architecture usually keeps a single shared database: services deploy separately, but data stays in one place, so joins, reports, PL/SQL and the old Delphi screens keep working during a branch-by-branch migration. Splitting 420 tables into per-service databases, or moving them to a new engine at the same time as changing the architecture, is the high-risk migration the brief rules out. Do one migration at a time.',
      hint: 'Connect every domain service to the same Oracle database (a single Relational DB, or a Boundary holding one schema per service). Leave Reporting free to read a replica.',
      concepts: ['service-based-architecture', 'architectural-quantum', 'strangler-fig'],
      test: (g) => {
        const ops = operationalUnits(g)
        if (!ops.length) return { pass: false, detail: 'No domain services yet.' }
        const per = ops.map((u) => ({ u, dbs: g.storesOf(u.family, DB_KINDS) }))
        const noDb = per.filter((p) => !p.dbs.length).map((p) => p.u.node)
        if (noDb.length) return { pass: false, detail: `${labels(noDb)} keep${plural(noDb.length, 's', '')} no data in the database.` }
        const roots = new Map<string, DiagramNode>()
        for (const p of per) for (const db of p.dbs) roots.set(dbRoot(g, db).id, dbRoot(g, db))
        if (roots.size > 1)
          return {
            pass: false,
            detail: `Data is split across ${labels([...roots.values()])}. Pulling the 420-table Oracle schema apart now is exactly the migration the team cannot afford; keep one database and partition it logically.`,
          }
        const root = [...roots.values()][0]
        const members = root.kind === 'zone' ? g.children(root.id).filter(kindIs(...DB_KINDS)) : [root]
        const techs = [...new Set(members.map((m) => m.tech).filter((t): t is string => !!t))]
        if (techs.length > 1)
          return { pass: false, detail: `${root.label} mixes ${techs.map(techName).join(' and ')}: those are separate databases, not schemas of one.` }
        if (techs.length && techs[0] !== 'oracle')
          return {
            pass: false,
            detail: `Moving 1.6 TB and 380 PL/SQL procedures to ${techName(techs[0])} is a second migration on top of the architecture change. Keep Oracle this year.`,
          }
        return true
      },
    },
    {
      id: 'single-api-entry',
      title: 'Both front ends enter through one API layer',
      category: 'core',
      why: 'In service-based architecture the user interfaces call the domain services through a thin API layer (a gateway or proxy). Clients get one address, auth and TLS live in one place, and the team can move a capability from the Delphi system to a new service, or move it between services, without shipping a new front end to 60 branches.',
      hint: 'Route the booking site (optionally through a CDN) and the Branch Desk to an API gateway, and let the gateway route to Booking and to the pick-up & return service.',
      concepts: ['api-gateway', 'service-based-architecture', 'strangler-fig'],
      test: (g) => {
        const entry = g.clientsEnterThrough(ENTRY_KINDS)
        if (!entry.pass) return entry
        const entries = g.ofKind(...ENTRY_KINDS)
        const missing: string[] = []
        for (const [domain, name] of [
          ['reservations', 'Reservations'],
          ['pickup-return', 'Pick-up & return'],
        ] as const) {
          const ids = new Set(g.ownerFamily(domain).map((n) => n.id))
          const reached = entries.some((e) => g.reaches(e, (n) => ids.has(n.id), { through: [...ENTRY_KINDS, 'load-balancer'], protocols: SYNC_PROTOCOLS, maxDepth: 3 }))
          if (!reached) missing.push(name)
        }
        return missing.length ? { pass: false, detail: `The API layer never routes to ${missing.join(' or ')}.` } : true
      },
    },
    {
      id: 'reporting-off-primary',
      title: 'Reports run on a replica or warehouse, not the live database',
      category: 'bonus',
      why: 'Month-end reports join contracts, invoices and fleet across every schema. Running them on the database the counters write to slows the counters down at the worst moment. A read replica (Active Data Guard) or a warehouse fed from the primary keeps reports away from the operational load, and once reporting reads its own copy, splitting the operational data later gets easier.',
      hint: 'Add a read replica or an analytics store, feed it from the main database (replication, CDC or an ETL job), and connect Reporting only to that copy.',
      concepts: ['microservices-reporting', 'cqrs'],
      test: (g) => {
        const rep = g.ownerFamily('reporting').filter((n) => COMPUTE_KINDS.includes(n.kind))
        if (!rep.length) return { pass: false, detail: 'Nobody owns Reporting yet.' }
        const primary = primaryNodes(g)
        const reads = g.storesOf(rep, [...DB_KINDS, 'analytics-db'])
        const onPrimary = reads.filter((s) => primary.has(s.id) || primary.has(dbRoot(g, s).id))
        if (onPrimary.length) return { pass: false, detail: `Reporting queries ${labels(onPrimary)}, the same database the counters and the booking site write to.` }
        if (!reads.length) return { pass: false, detail: 'Reporting reads no replica or analytics store.' }
        const starts = [...primary.values()]
        const etl = g.ofKind(...FEEDERS)
        const fed = reads.filter(
          (c) =>
            !!g.reaches(starts, (n) => n.id === c.id, { through: FEEDERS, maxDepth: 4 }) ||
            etl.some((x) => g.targets(x.id).some((t) => t.id === c.id) && g.targets(x.id).some((t) => primary.has(t.id))),
        )
        return fed.length ? true : { pass: false, detail: `${labels(reads)} is not fed from the operational database (replication, CDC or an ETL job).` }
      },
    },
    {
      id: 'schema-per-domain',
      title: 'Each domain service writes only its own schema',
      category: 'bonus',
      why: 'A shared database is safe only while table ownership is clear. If each service writes only its own schema and reads other domains through read-only views, a schema change in one area cannot break another service. You can enforce this with a fitness function in CI (an ArchUnit-style test or a check of database grants) that fails the build when Booking writes to FLEET tables. It also leaves the door open to moving a schema into its own database later.',
      hint: 'Draw the Oracle database as a Boundary with one Relational DB per schema (BOOKING, RENTAL, FLEET, BILLING) inside. Each service writes its own schema; label any access to another service’s schema "read".',
      concepts: ['fitness-functions', 'single-writer', 'bounded-context', 'service-based-architecture'],
      test: (g) => {
        const ops = operationalUnits(g)
        if (!ops.length) return { pass: false, detail: 'No domain services yet.' }
        const zones = new Map<string, DiagramNode>()
        for (const u of ops) for (const db of g.storesOf(u.family, DB_KINDS)) if (dbRoot(g, db).kind === 'zone') zones.set(dbRoot(g, db).id, dbRoot(g, db))
        const schemas = [...zones.values()].flatMap((z) => g.children(z.id).filter(kindIs(...DB_KINDS)))
        if (schemas.length < 2)
          return { pass: false, detail: 'The shared database is one undivided box. Draw it as a Boundary with a schema per domain service so table ownership is visible and testable.' }
        const unitOf = new Map<string, Unit>()
        for (const u of ops) for (const f of u.family) unitOf.set(f.id, u)
        const writers = (s: DiagramNode) => {
          const set = new Map<string, DiagramNode>()
          for (const e of g.in(s.id, ['data'])) {
            const u = unitOf.get(e.source)
            if (u && !READ_ONLY.test(e.label ?? '')) set.set(u.node.id, u.node)
          }
          return [...set.values()]
        }
        const contested = schemas.filter((s) => writers(s).length > 1)
        if (contested.length)
          return { pass: false, detail: contested.map((s) => `${s.label} is written by ${labels(writers(s))}`).join('; ') + '. Label read-only access "read", or give each writer its own schema.' }
        const homeless = ops.filter((u) => !schemas.some((s) => writers(s).some((w) => w.id === u.node.id))).map((u) => u.node)
        return homeless.length ? { pass: false, detail: `${labels(homeless)} write${plural(homeless.length, 's', '')} no schema of ${plural(homeless.length, 'its', 'their')} own.` } : true
      },
    },
    {
      id: 'booking-cache',
      title: 'Weekend quote traffic is cached in front of the shared database',
      category: 'bonus',
      why: 'In a shared-database design the database is the one thing every service depends on. Running four Booking instances on a spring Saturday multiplies their connections and queries against the same Oracle the counters use. Caching tariffs and availability per branch for a short time absorbs most quote reads, so scaling Booking does not mean scaling the database.',
      hint: 'Connect the service that owns pricing and reservations to a Cache (Redis, Valkey) with a Data edge.',
      concepts: ['caching', 'architecture-characteristics'],
      test: (g) => {
        const units = unitsOwning(g, FAST)
        if (!units.length) return { pass: false, detail: 'Nobody owns pricing and reservations yet.' }
        return g.storesOf(units.flatMap((u) => u.family), ['cache']).length ? true : { pass: false, detail: 'Quote reads go straight to the shared database.' }
      },
    },
    {
      id: 'adr-recorded',
      title: 'The shared-database decision is written down',
      category: 'bonus',
      why: 'Keeping one database while splitting the services is a deliberate trade-off, and someone will question it in a year. An architecture decision record states the context, the decision and its consequences (what you gain, what you accept, when to revisit it), so the team does not reopen the debate every quarter.',
      hint: 'In Decisions → Rationale, write a short ADR: why one shared Oracle database, how ownership is enforced, and what would make you split it.',
      concepts: ['architecture-decision-records'],
      test: (g) => {
        const r = g.decisions.rationale?.trim() ?? ''
        if (r.length < 40) return { pass: false, detail: 'No rationale recorded yet.' }
        return /(database|\bdb\b|oracle|schema)/i.test(r) ? true : { pass: false, detail: 'The rationale does not mention the database decision.' }
      },
    },
    {
      id: 'ops-visibility',
      title: 'Every domain service reports logs and metrics',
      category: 'bonus',
      why: 'Going from one desktop application to several services means a slow quote can now be the gateway, the Booking service or the database. Central logs and metrics from every service are the minimum for a small team to find out which one, without logging into servers.',
      hint: 'Add Log aggregation and a Metrics store (optionally behind a telemetry collector) and send Telemetry edges from every domain service.',
      concepts: ['observability'],
      test: (g) => {
        if (!g.has('logging') || !g.has('metrics')) return { pass: false, detail: 'Add both log aggregation and metrics.' }
        const seen = new Set(g.instrumented().map((n) => n.id))
        const dark = domainUnits(g).filter((u) => !seen.has(u.node.id)).map((u) => u.node)
        return dark.length ? { pass: false, detail: `No telemetry from ${labels(dark)}.` } : true
      },
    },
    {
      id: 'anti-service-chains',
      title: 'Domain services do not call each other in chains',
      category: 'antipattern',
      why: 'Because the services share a database, they rarely need each other’s data over the network. Each extra synchronous hop runs into the fallacies of distributed computing: the network is not reliable, latency is not zero, and a slow Billing service now slows the counter too. Chains (A → B → C) and services calling each other back and forth pull the system toward a distributed monolith.',
      hint: 'Read the other domain’s tables through a read-only view instead of calling its service, or keep inter-service calls to one hop.',
      concepts: ['fallacies-of-distributed-computing', 'request-reply-messaging', 'service-based-architecture'],
      test: (g) => {
        const unitOf = (n: DiagramNode) => {
          const d = g.deployable(n)
          return ['service', 'monolith', 'function'].includes(d.kind) ? d : undefined
        }
        const adj = new Map<string, Set<string>>()
        for (const e of g.edges) {
          if (!SYNC_PROTOCOLS.includes(e.protocol)) continue
          const s = g.node(e.source)
          const t = g.node(e.target)
          if (!s || !t) continue
          const su = unitOf(s)
          const tu = unitOf(t)
          if (!su || !tu || su.id === tu.id) continue
          adj.set(su.id, (adj.get(su.id) ?? new Set()).add(tu.id))
        }
        for (const [a, bs] of adj)
          for (const b of bs)
            for (const c of adj.get(b) ?? []) {
              const [A, B, C] = [g.node(a)!, g.node(b)!, g.node(c)!]
              return {
                pass: false,
                detail: c === a ? `${A.label} and ${B.label} call each other synchronously.` : `Chain: ${A.label} → ${B.label} → ${C.label}`,
              }
            }
        return true
      },
    },
    {
      id: 'anti-fine-grained',
      title: 'No "microservices for everything" split',
      category: 'antipattern',
      why: 'Fifteen or more services for nine capabilities (VanService, CustomerService, TariffService…) is the entity trap: services shaped like tables rather than business areas. Every use case then crosses several services, which 9 people have to deploy, monitor and keep in step over one database they cannot split.',
      hint: 'Merge entity-shaped services back into a few domain services; 4–12 is the usual range for this style.',
      concepts: ['entity-trap', 'service-granularity', 'microservices'],
      test: (g) => {
        const n = g.count('service', 'function')
        return n > 12 ? { pass: false, detail: `${n} services and functions for a 9-person team.` } : true
      },
    },
  ],
  inspiration: [
    { label: 'Mark Richards — Lesson 163: Service-Based Architecture', url: 'https://www.developertoarchitect.com/lessons/lesson163.html' },
    { label: 'Mark Richards — Lesson 114: Microservices vs Service-Based Architecture', url: 'https://www.developertoarchitect.com/lessons/lesson114.html' },
    { label: 'Mark Richards — Lesson 136: Managing Shared Database Changes', url: 'https://www.developertoarchitect.com/lessons/lesson136.html' },
    { label: 'Segment (Twilio) — Goodbye Microservices: from 100+ services back to one', url: 'https://www.twilio.com/en-us/blog/developers/best-practices/goodbye-microservices' },
  ],
  starter: diagram(
    [
      ['web', 'web-app', 'Busik.pl (PHP site)', 0, 40],
      ['php', 'service', 'Booking pages (PHP)', 280, 40, { domains: ['pricing', 'reservations'] }],
      [
        'delphi',
        'monolith',
        'Delphi Branch Desk ×60',
        280,
        180,
        { w: 260, h: 120, domains: ['customers', 'pickup-return', 'fleet', 'maintenance', 'invoicing', 'payments'], notes: 'Desktop client; every PC connects straight to Oracle' },
      ],
      ['oracle', 'relational-db', 'Oracle 19c (BUSIK)', 820, 120, { tech: 'oracle' }],
      ['reports', 'worker', 'Nightly Crystal Reports', 820, 300, { domains: ['reporting'] }],
    ],
    [
      ['web', 'php', 'http'],
      ['php', 'oracle', 'data'],
      ['delphi', 'oracle', 'data', 'SQL from 60 branches'],
      ['reports', 'oracle', 'data', 'full-table joins at 02:00'],
    ],
  ),
  starterDecisions: { stack: { database: 'oracle' } },
  reference: {
    decisions: {
      style: 'service-based',
      communication: 'sync',
      data: 'shared',
      stack: { backend: 'dotnet', frontend: 'nextjs', database: 'oracle', cache: 'redis' },
      rationale:
        'ADR-001: five coarse domain services (Booking, Rental Desk, Fleet, Billing, Reporting) deployed separately behind one gateway, sharing the existing Oracle database. Context: pricing and booking change weekly and need weekend capacity; the rest changes rarely; 9 people; 420 tables and 380 PL/SQL procedures we cannot split safely now. Decision: one schema per service, each service writes only its own schema and reads others through views, enforced by a CI test on database grants; reports run on an Active Data Guard replica. Consequences: schema changes still need coordination through the DBA; revisit splitting a schema into its own database once its service has been stable for a year.',
    },
    walkthrough: [
      'The booking site (Next.js behind Cloudflare) and the new browser-based Branch Desk both call one API gateway. The gateway routes to five domain services and lets the team move screens off the Delphi client branch by branch without changing the front-end addresses.',
      'The nine capabilities are grouped into five coarse services in ASP.NET Core, a short step from Object Pascal, and two developers already know C#: Booking (pricing + reservations), Rental Desk (customers + pick-up & return), Fleet (fleet + maintenance), Billing (invoicing + payments) and Reporting. Each deploys on its own, so a Monday promotion ships Booking only, and on spring weekends only Booking runs four instances.',
      'All operational services keep using the same Oracle 19c database, now split logically into BOOKING, RENTAL, FLEET and BILLING schemas. Each service writes only its own schema; Booking reads van counts per branch through a FLEET view and Rental Desk reads today’s pick-ups through a BOOKING view. A CI fitness function checks the database grants, so a stray INSERT into another schema fails the build.',
      'Because the data is shared, services hardly call each other. The one call is Rental Desk → Billing when a van comes back (close the contract, release the deposit, issue the invoice), and Billing calls nothing else, so no chain forms. Billing alone talks to PayU for deposits and prepayments and to KSeF for e-invoices.',
      'Booking caches tariffs and availability per branch in Redis for a minute, so four weekend instances do not mean four times the queries on the shared Oracle. Reporting reads only an Active Data Guard replica, so the 70 Crystal Reports and month-end queries never touch the counters’ database.',
      'Trade-off: the shared database remains a single point of failure and every schema change goes through one DBA. That is accepted for now and recorded in an ADR with a trigger for revisiting it. The design is far cheaper to run than database-per-service microservices, and it keeps a migration path open if a schema ever needs its own database.',
    ],
    diagram: diagram(
      [
        ['web', 'web-app', 'Busik.pl Booking Site', 0, 60, { tech: 'nextjs' }],
        ['desk', 'web-app', 'Branch Desk (60 branches)', 0, 300, { tech: 'react' }],
        ['cdn', 'cdn', 'CDN', 260, 60, { tech: 'cloudflare' }],
        ['gw', 'api-gateway', 'API Gateway', 520, 300, { tech: 'kong', notes: 'Routes /quotes, /bookings, /rentals, /fleet, /billing, /reports' }],
        ['collector', 'otel-collector', 'Telemetry Collector', 520, 520, { tech: 'grafana-alloy' }],
        ['logs', 'logging', 'Logs', 260, 640, { tech: 'loki' }],
        ['metrics', 'metrics', 'Metrics', 520, 640, { tech: 'prometheus' }],
        ['booking', 'service', 'Booking Service', 800, 60, { tech: 'dotnet', domains: ['pricing', 'reservations'], notes: '1 instance on weekdays, 4 on spring weekends' }],
        ['rental', 'service', 'Rental Desk Service', 800, 200, { tech: 'dotnet', domains: ['customers', 'pickup-return'] }],
        ['fleet', 'service', 'Fleet Service', 800, 340, { tech: 'dotnet', domains: ['fleet', 'maintenance'] }],
        ['billing', 'service', 'Billing Service', 800, 480, { tech: 'dotnet', domains: ['invoicing', 'payments'] }],
        ['reporting', 'service', 'Reporting Service', 800, 620, { tech: 'dotnet', domains: ['reporting'] }],
        ['cache', 'cache', 'Tariff & Availability Cache', 1100, -60, { tech: 'redis', notes: 'Tariffs and van counts per branch, 60 s TTL' }],
        ['oracle', 'zone', 'Oracle 19c · one database, schema per service', 1100, 40, { w: 280, h: 400 }],
        ['sBooking', 'relational-db', 'BOOKING schema', 40, 40, { parent: 'oracle', tech: 'oracle' }],
        ['sRental', 'relational-db', 'RENTAL schema', 40, 130, { parent: 'oracle', tech: 'oracle' }],
        ['sFleet', 'relational-db', 'FLEET schema', 40, 220, { parent: 'oracle', tech: 'oracle' }],
        ['sBilling', 'relational-db', 'BILLING schema', 40, 310, { parent: 'oracle', tech: 'oracle' }],
        ['replica', 'relational-db', 'Reporting Replica', 1100, 720, { tech: 'oracle', notes: 'Active Data Guard, read-only' }],
        ['payu', 'external', 'PayU (deposits)', 1460, 560, { tech: 'payu' }],
        ['ksef', 'external', 'KSeF e-invoicing', 1460, 680, { tech: 'ksef' }],
      ],
      [
        ['web', 'cdn', 'http'],
        ['cdn', 'gw', 'http'],
        ['desk', 'gw', 'http'],
        ['gw', 'booking', 'http', '/quotes, /bookings'],
        ['gw', 'rental', 'http', '/rentals'],
        ['gw', 'fleet', 'http', '/fleet'],
        ['gw', 'billing', 'http', '/billing'],
        ['gw', 'reporting', 'http', '/reports'],
        ['booking', 'cache', 'data'],
        ['booking', 'sBooking', 'data'],
        ['booking', 'sFleet', 'data', 'read: vans per branch (view)'],
        ['rental', 'sRental', 'data'],
        ['rental', 'sBooking', 'data', "read: today's pick-ups (view)"],
        ['fleet', 'sFleet', 'data'],
        ['billing', 'sBilling', 'data'],
        ['rental', 'billing', 'http', 'close contract → invoice, release deposit'],
        ['billing', 'payu', 'http'],
        ['billing', 'ksef', 'http'],
        ['oracle', 'replica', 'data', 'Active Data Guard redo apply'],
        ['reporting', 'replica', 'data', 'read'],
        ['gw', 'collector', 'telemetry'],
        ['booking', 'collector', 'telemetry'],
        ['rental', 'collector', 'telemetry'],
        ['fleet', 'collector', 'telemetry'],
        ['billing', 'collector', 'telemetry'],
        ['reporting', 'collector', 'telemetry'],
        ['collector', 'logs', 'telemetry'],
        ['collector', 'metrics', 'telemetry'],
      ],
    ),
  },
}

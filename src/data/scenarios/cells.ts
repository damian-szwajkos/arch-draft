import type { ComponentKind, DiagramNode, Protocol, Scenario } from '../../engine/types'
import { SYNC_PROTOCOLS } from '../../engine/types'
import { DATA_KINDS, DB_KINDS, MESSAGING_KINDS, type Graph } from '../../engine/graph'
import { diagram, observability } from './builder'

// ---------------------------------------------------------------------------
// Cell helpers. A "cell" is a Boundary zone that holds a copy of the shop stack.
// Zones nested inside a cell (tiers, AZs) fold into it; zones wrapping several
// cells (regions) are skipped. See cellView() for the exact rule.
// ---------------------------------------------------------------------------

const COMPUTE: ComponentKind[] = ['service', 'monolith', 'module', 'worker', 'function', 'orchestrator', 'bff']
/** Stateful things that must never be shared between cells (object storage is a global, highly durable service). */
const STATEFUL: ComponentKind[] = [...DATA_KINDS.filter((k) => k !== 'object-storage'), ...MESSAGING_KINDS]
/** Request-path components outside the cells that must not be shared synchronous dependencies of several cells. */
const SHARED_SYNC_KINDS: ComponentKind[] = [...COMPUTE, 'api-gateway', 'load-balancer']
const ROUTER_KINDS: ComponentKind[] = ['api-gateway', 'load-balancer', 'function', 'service']
const LOOSE_ROUTER_KINDS: ComponentKind[] = [...ROUTER_KINDS, 'bff', 'monolith']
const EDGE_KINDS: ComponentKind[] = ['cdn', 'waf', 'load-balancer', 'api-gateway']
const ENTRY_KINDS: ComponentKind[] = ['api-gateway', 'load-balancer']
const CLIENTS: ComponentKind[] = ['web-app', 'mobile-app']
const CELL_DOMAINS = [
  { id: 'storefront', label: 'Storefront & catalogue' },
  { id: 'checkout', label: 'Checkout & orders' },
  { id: 'fulfilment', label: 'Fulfilment & webhooks' },
]
const CELL_DOMAIN_IDS = CELL_DOMAINS.map((d) => d.id)
const CONTROL_DOMAINS = ['tenant-placement', 'cell-provisioning']
const SHED = /rate.?limit|throttl|shed|waiting.?room|admission|quota/i

const sheddingText = (n: DiagramNode) => SHED.test(`${n.label} ${n.notes ?? ''}`)

function ancestors(g: Graph, n: DiagramNode): DiagramNode[] {
  const out: DiagramNode[] = []
  const seen = new Set<string>([n.id])
  let cur = g.parent(n)
  while (cur && !seen.has(cur.id)) {
    out.push(cur)
    seen.add(cur.id)
    cur = g.parent(cur)
  }
  return out
}

function descendants(g: Graph, id: string): DiagramNode[] {
  const out: DiagramNode[] = []
  const seen = new Set<string>([id])
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()!
    for (const c of g.children(cur)) {
      if (seen.has(c.id)) continue
      seen.add(c.id)
      out.push(c)
      stack.push(c.id)
    }
  }
  return out
}

interface CellView {
  cells: DiagramNode[]
  cellOf: (n: DiagramNode) => string | undefined
  members: (cellId: string) => DiagramNode[]
  /** Cells whose components touch (or contain) a stateful node, ignoring telemetry. */
  touching: (store: DiagramNode) => Set<string>
  name: (cellId: string) => string
}

/**
 * Candidates are zones containing compute. A candidate is a *region* (a zone
 * wrapping cells) when it holds two or more nested candidates that each carry a
 * copy of the same shop capabilities (overlapping cell domains) — or, when no
 * cell domains are assigned yet, any nested candidate at all. Cells are the
 * outermost candidates that are not regions, so tier / AZ sub-zones inside a
 * cell (which split the capabilities rather than copy them) fold into it.
 */
function cellView(g: Graph): CellView {
  const zones = g.ofKind('zone')
  const desc = new Map(zones.map((z) => [z.id, descendants(g, z.id)]))
  const candidates = zones.filter((z) => desc.get(z.id)!.some((d) => COMPUTE.includes(d.kind)))
  const candidateIds = new Set(candidates.map((z) => z.id))
  const coverage = new Map(
    candidates.map((z) => [z.id, new Set(desc.get(z.id)!.flatMap((d) => d.domains.filter((x) => CELL_DOMAIN_IDS.includes(x))))]),
  )
  /** Candidates nested in z with no other candidate between them and z. */
  const topmostInside = (z: DiagramNode) =>
    desc.get(z.id)!.filter((d) => {
      if (!candidateIds.has(d.id)) return false
      for (const a of ancestors(g, d)) {
        if (a.id === z.id) return true
        if (candidateIds.has(a.id)) return false
      }
      return true
    })
  const overlap = (a: Set<string>, b: Set<string>) => (a.size === 0 && b.size === 0) || [...a].some((x) => b.has(x))
  const regionMemo = new Map<string, boolean>()
  const isRegion = (z: DiagramNode): boolean => {
    if (regionMemo.has(z.id)) return regionMemo.get(z.id)!
    const inner = topmostInside(z)
    let region = false
    if (coverage.get(z.id)!.size === 0) region = inner.length > 0
    else
      for (let i = 0; i < inner.length && !region; i++)
        for (let j = i + 1; j < inner.length && !region; j++)
          if (overlap(coverage.get(inner[i].id)!, coverage.get(inner[j].id)!)) region = true
    regionMemo.set(z.id, region)
    return region
  }
  const cells = candidates.filter(
    (z) => !isRegion(z) && !ancestors(g, z).some((a) => candidateIds.has(a.id) && !isRegion(a)),
  )
  const cellIds = new Set(cells.map((c) => c.id))
  const cellOf = (n: DiagramNode) => {
    let cur = g.parent(n)
    const seen = new Set<string>()
    while (cur && !seen.has(cur.id)) {
      if (cellIds.has(cur.id)) return cur.id
      seen.add(cur.id)
      cur = g.parent(cur)
    }
    return undefined
  }
  const touching = (store: DiagramNode) => {
    const set = new Set<string>()
    const own = cellOf(store)
    if (own) set.add(own)
    const edges = [...g.out(store.id), ...g.in(store.id)].filter((e) => e.protocol !== 'telemetry')
    for (const e of edges) {
      const other = g.node(e.source === store.id ? e.target : e.source)
      const c = other ? cellOf(other) : undefined
      if (c) set.add(c)
    }
    return set
  }
  return {
    cells,
    cellOf,
    members: (id) => descendants(g, id),
    touching,
    name: (id) => g.node(id)?.label ?? id,
  }
}

const isClient = (n: DiagramNode) => CLIENTS.includes(n.kind)

/** Owners of placement / provisioning plus everything acting on their behalf. */
function controlPlane(g: Graph): DiagramNode[] {
  return [...new Map(CONTROL_DOMAINS.flatMap((d) => g.ownerFamily(d)).map((n) => [n.id, n])).values()]
}

/** Is `n` on a client's synchronous request path (directly, or behind CDN / WAF / LB / gateway)? */
function onClientPath(g: Graph, n: DiagramNode): boolean {
  const clients = g.nodes.filter(isClient)
  return !!g.reaches(clients, (x) => x.id === n.id, { through: EDGE_KINDS, protocols: SYNC_PROTOCOLS, maxDepth: 4 })
}

/** Nodes outside every cell that send synchronous requests into at least two different cells. */
function fanOut(g: Graph, v: CellView, kinds: ComponentKind[] = ROUTER_KINDS): DiagramNode[] {
  return g.ofKind(...kinds).filter((n) => {
    if (v.cellOf(n)) return false
    const reached = new Set(g.targets(n.id, SYNC_PROTOCOLS).map((t) => v.cellOf(t)).filter(Boolean))
    return reached.size >= 2
  })
}

/**
 * Cell routers: fan-out nodes on the client request path. The control plane may
 * call cells too (moving or draining shops) — that does not make it a router.
 */
function routers(g: Graph, v: CellView, kinds: ComponentKind[] = ROUTER_KINDS): DiagramNode[] {
  const cp = new Set(controlPlane(g).map((n) => n.id))
  return fanOut(g, v, kinds).filter((n) => !cp.has(n.id) && onClientPath(g, n))
}

/**
 * In-cell entry points behind the routers: nodes inside a cell that the routers
 * call synchronously, following on through in-cell gateways / load balancers.
 */
function cellEntries(g: Graph, v: CellView, rs: DiagramNode[]): DiagramNode[] {
  const out = new Map<string, DiagramNode>()
  const seen = new Set(rs.map((r) => r.id))
  let frontier = rs
  for (let depth = 0; depth < 3 && frontier.length; depth++) {
    const next: DiagramNode[] = []
    for (const f of frontier)
      for (const t of g.targets(f.id, SYNC_PROTOCOLS)) {
        if (seen.has(t.id) || !v.cellOf(t)) continue
        seen.add(t.id)
        out.set(t.id, t)
        if (ENTRY_KINDS.includes(t.kind)) next.push(t)
      }
    frontier = next
  }
  return [...out.values()]
}

export const cellPlatform: Scenario = {
  id: 'storefront-cells',
  title: 'Kramo: contain the blast radius',
  tagline: 'One bad deploy took down 400,000 shops. Split the platform into cells so the next one hits 10% at most.',
  industry: 'SaaS platform',
  difficulty: 'advanced',
  estMinutes: 50,
  accent: '#0284c7',
  concepts: ['cell-based-architecture', 'multi-tenancy', 'sharding', 'load-shedding', 'rate-limiting', 'queue-load-leveling'],
  inspiration: [
    { label: 'Shopify Engineering — A pods architecture to allow Shopify to scale', url: 'https://shopify.engineering/a-pods-architecture-to-allow-shopify-to-scale' },
    { label: 'Slack Engineering — Slack’s migration to a cellular architecture', url: 'https://slack.engineering/slacks-migration-to-a-cellular-architecture/' },
    { label: 'AWS — Reducing the scope of impact with cell-based architecture', url: 'https://docs.aws.amazon.com/wellarchitected/latest/reducing-scope-of-impact-with-cell-based-architecture/what-is-a-cell-based-architecture.html' },
  ],
  story:
    'Kramo hosts 400,000 online shops — from village bakeries in Podhale to a celebrity streetwear label — on one shared Rails stack backed by one giant MySQL cluster. Last quarter two incidents took down every single shop: a migration shipped to all servers at once locked the orders table, and three weeks later the celebrity’s flash sale drove 100× normal traffic until the shared database stopped answering. Merchants lost an estimated 2.1M zł in sales and 1,800 of them moved to a competitor within a month. The CTO’s new rule is blunt: no single failure may touch more than 10% of shops, and nobody gets to rewrite the application to achieve it. Your job is to split the platform into self-contained cells with a thin router in front and a control plane that can place and move shops.',
  facts: [
    { label: 'Shops', value: '400k shops; the top 50 make 30% of GMV' },
    { label: 'Traffic', value: '60k rps normal; one shop can spike 100× in a drop' },
    { label: 'Team', value: '120 engineers in 14 product teams + 8 in platform' },
    { label: 'Targets', value: '99.99% uptime, ≤ 10% of shops per incident, evacuate in < 5 min' },
  ],
  functional: [
    'Every request — storefront, checkout or merchant admin — is served by the one cell that holds that shop’s data',
    'Each cell runs the full product: storefront, cart & checkout, and the fulfilment jobs and webhooks after an order',
    'Operators can create new cells and move a shop between cells without downtime',
    'A celebrity merchant can be pinned to a dedicated cell before a planned drop',
    'Shoppers and merchants sign in once with a global Kramo account',
  ],
  nonFunctional: [
    'Blast radius: a bad deploy, bad data or an overload affects at most 10% of shops',
    'Deploys roll out in waves — canary cell, then 10%, 50%, 100% — with automatic halt on SLO burn',
    'A degraded cell can be failed over or drained within 5 minutes by changing routing, not by redeploying',
    '99.99% availability; the router adds < 5 ms at p99 and keeps working if the control plane is down',
    'One shop’s flash sale must not degrade its neighbours in the same cell',
  ],
  constraints: [
    'Keep the existing Rails codebase — it is copied into every cell, not rewritten',
    'Infrastructure cost may grow by at most 25%',
    'Shops never need to query each other’s data (no cross-shop transactions)',
  ],
  domains: [
    { id: 'storefront', label: 'Storefront & catalogue', description: 'Theme rendering, product pages, search and cart for each shop' },
    { id: 'checkout', label: 'Checkout & orders', description: 'Order placement, payment capture and stock decrement' },
    { id: 'fulfilment', label: 'Fulfilment & webhooks', description: 'Jobs after an order: emails, app webhooks, inventory sync' },
    { id: 'tenant-placement', label: 'Shop placement', description: 'Which cell each shop lives in; moving and pinning shops' },
    { id: 'cell-provisioning', label: 'Cell lifecycle', description: 'Creating cells, capacity planning and wave-based deploys' },
  ],
  recommendedStyles: ['modular-monolith', 'microservices'],
  styleFeedback: {
    'modular-monolith':
      'Great fit — Shopify kept one modular Rails monolith and gave every pod its own isolated MySQL, Redis and Memcached, with its Sorting Hat routing in the load balancers sending each shop to its pod. Here you go one step further and give each cell its own copy of the app and workers too, so a bad deploy is contained as well — and the module boundaries keep 14 teams productive without a rewrite.',
    microservices:
      'Works — each cell can host a small set of services, as long as every service and its data are replicated per cell. Be honest about the cost: N cells × M services is a lot of moving parts.',
    'event-driven':
      'Events are useful inside a cell (jobs, webhooks), but the problem here is blast radius, not coupling. An event backbone shared by all cells would become the new single point of failure.',
    monolith:
      'A plain monolith on one shared stack is exactly what failed twice last quarter. Copy the app into cells and give it module boundaries — that is the modular-monolith option.',
    serverless:
      'Per-request functions do not fix the shared database, and a 100× spike from one shop would still exhaust shared concurrency and connection limits for everyone.',
    'service-based':
      'Coarse services sharing one database per cell would work technically, but the brief says to keep the Rails codebase and copy it into every cell. Splitting it into services now multiplies the moving parts in every cell without shrinking the blast radius.',
    'space-based':
      'An in-memory grid absorbs a flash sale, but one grid shared by many shops is a new shared failure domain, and replication does not respect the 10% rule. Cells plus per-shop limits contain a 100× drop instead.',
    microkernel:
      'Themes and shop apps are plug-in-like, but they do not touch the real problem: one deploy or one overload reaching all 400,000 shops. Isolation comes from routing shops into cells, not from a plug-in core.',
  },
  hints: [
    'Ask: what is the smallest unit a failure should be confined to? Group everything one shop needs — app, database, cache, queue — into a Boundary zone and call it a cell.',
    'Do the maths: ≤ 10% of shops per incident means at least 10 cells of ~40k shops. Draw two identical cells as the template (a note can stand for the rest). Nothing stateful (database, cache, job queue) and no synchronous service may be used by more than one cell — otherwise it is still one big failure domain.',
    'Something must decide which cell serves shop 4711. Put a thin router at the edge that looks up shop_id → cell in a small routing table (a KV / cache such as Valkey that only the control plane writes) and forwards — no business logic, no database calls into cells.',
    'Who creates cells and moves shops? A separate control plane with its own database writes the routing table. The router must never call it per request: if the control plane is down, shops keep selling.',
    'For the celebrity drop: rate-limit per shop at the router or the cell entry (load shedding), and put checkout follow-up work on each cell’s own job queue so spikes are levelled, not amplified.',
    'Finish with telemetry from every cell component (dashboards per cell drive wave deploys), a CDN for static assets and a small global identity provider.',
  ],
  checks: [
    {
      id: 'cells-drawn',
      title: 'Two or more self-contained cells hold the product',
      category: 'core',
      why: 'A cell is a complete copy of the workload — app plus its own database — serving a subset of shops. If any shop-facing capability runs outside the cells, a failure there still hits 100% of shops.',
      hint: 'Draw at least two Boundary zones as cells. Inside each: the application (or services) owning Storefront, Checkout and Fulfilment, and a database only that cell uses.',
      concepts: ['cell-based-architecture', 'sharding'],
      test: (g) => {
        const v = cellView(g)
        if (v.cells.length < 2)
          return { pass: false, detail: `Found ${v.cells.length} cell(s). Draw at least two Boundary zones, each holding a full copy of the shop stack.` }
        const problems: string[] = []
        for (const c of v.cells) {
          const compute = v.members(c.id).filter((n) => COMPUTE.includes(n.kind))
          const ownDb = g.storesOf(compute, DB_KINDS).some((db) => {
            const t = v.touching(db)
            return t.size === 1 && t.has(c.id)
          })
          if (!ownDb) problems.push(`${c.label} has no database of its own`)
        }
        for (const d of CELL_DOMAINS) {
          const outside = g.owners(d.id).filter((o) => !v.cellOf(o))
          if (outside.length) problems.push(`${d.label} is owned outside any cell (${outside.map((o) => o.label).join(', ')}) — a failure there hits every shop`)
          else if (!g.owned(d.id)) problems.push(`nobody inside the cells owns ${d.label}`)
        }
        return problems.length
          ? { pass: false, detail: problems.join('; ') + '.' }
          : {
              pass: true,
              detail: `${v.cells.length} cells drawn — enough as a template; in production ≤ 10% per incident means at least 10 cells.`,
            }
      },
    },
    {
      id: 'cell-isolation',
      title: 'Nothing stateful is shared between cells',
      category: 'core',
      why: 'A database, cache, job queue — or a service every cell calls synchronously — couples the cells’ fate: one celebrity sale or one bad deploy there takes them all down. Isolation is the whole point of cells. (Object storage behind the CDN and the identity provider are deliberately global and exempt.)',
      hint: 'Give every cell its own database, cache and queue, keep shop-facing services inside the cells, and never let a component in one cell call into another cell.',
      concepts: ['cell-based-architecture', 'multi-tenancy'],
      test: (g) => {
        const v = cellView(g)
        if (v.cells.length < 2) return { pass: false, detail: 'Draw at least two cells first.' }
        const rsIds = new Set(routers(g, v).map((r) => r.id))
        const shared = g.ofKind(...STATEFUL).filter((s) => v.touching(s).size > 1)
        const sharedSync = g.ofKind(...SHARED_SYNC_KINDS).filter((n) => {
          if (v.cellOf(n) || rsIds.has(n.id)) return false
          const callers = new Set(g.sources(n.id, SYNC_PROTOCOLS).map((s) => v.cellOf(s)).filter(Boolean))
          return callers.size > 1
        })
        const crossCalls = g.edges.filter((e) => {
          if (e.protocol === 'telemetry') return false
          const s = g.node(e.source)
          const t = g.node(e.target)
          if (!s || !t) return false
          const a = v.cellOf(s)
          const b = v.cellOf(t)
          return !!a && !!b && a !== b
        })
        const problems = [
          ...shared.map((s) => `${s.label} is used by ${[...v.touching(s)].map(v.name).join(' and ')}`),
          ...sharedSync.map((n) => {
            const callers = [...new Set(g.sources(n.id, SYNC_PROTOCOLS).map((s) => v.cellOf(s)).filter((c): c is string => !!c))]
            return `${n.label} is called by ${callers.map(v.name).join(' and ')} — a failure there hits every cell`
          }),
          ...crossCalls.map((e) => `${g.node(e.source)!.label} → ${g.node(e.target)!.label} crosses cells`),
        ]
        return problems.length ? { pass: false, detail: problems.join('; ') + '.' } : { pass: true }
      },
    },
    {
      id: 'thin-router',
      title: 'A cell router maps every shop to its cell',
      category: 'core',
      why: 'Clients must not know about cells. A thin router at the edge looks up shop_id → cell in a routing table and forwards the request — the partition key is the shop, so all of one shop’s traffic lands in one cell.',
      hint: 'Add a router (gateway, load balancer or edge function) outside the cells. Clients reach it (optionally via CDN/WAF), it forwards into every cell and reads a small routing table (KV / cache) — or gets the map pushed to it by the control plane.',
      concepts: ['cell-based-architecture', 'sharding', 'multi-tenancy'],
      test: (g) => {
        const v = cellView(g)
        const cp = controlPlane(g)
        const cpIds = new Set(cp.map((n) => n.id))
        const fan = fanOut(g, v).filter((n) => !cpIds.has(n.id))
        if (!fan.length)
          return { pass: false, detail: 'Nothing outside the cells routes requests into two or more cells. Add a cell router in front of them.' }
        const problems: string[] = []
        const clients = g.nodes.filter(isClient)
        const rs = routers(g, v)
        if (!clients.length) problems.push('no clients on the canvas')
        else if (!rs.length) problems.push(`${fan.map((r) => r.label).join(', ')} route${fan.length > 1 ? '' : 's'} into the cells, but no client reaches ${fan.length > 1 ? 'them' : 'it'}`)
        const hasTable = (r: DiagramNode) =>
          g.storesOf([r]).some((s) => !v.cellOf(s)) ||
          cp.some((c) => g.out(c.id).some((e) => e.target === r.id && e.protocol !== 'telemetry')) ||
          (cp.length > 0 && g.asyncFlow(cp, [r]))
        const noTable = rs.filter((r) => !hasTable(r))
        if (noTable.length) problems.push(`${noTable.map((r) => r.label).join(', ')} has no routing table — how does it know where shop 4711 lives?`)
        const ids = new Set(rs.map((r) => r.id))
        const bypass = clients.filter((c) => g.targets(c.id).some((t) => v.cellOf(t)))
        if (bypass.length) problems.push(`${bypass.map((c) => c.label).join(', ')} call a cell directly`)
        if (rs.length) {
          const missing = clients.filter(
            (c) => !bypass.includes(c) && !g.reaches(c, (n) => ids.has(n.id), { through: EDGE_KINDS, protocols: SYNC_PROTOCOLS, maxDepth: 4 }),
          )
          if (missing.length) problems.push(`${missing.map((c) => c.label).join(', ')} never reach the router`)
          const unreached = v.cells.filter((c) => !rs.some((r) => g.targets(r.id, SYNC_PROTOCOLS).some((t) => v.cellOf(t) === c.id)))
          if (unreached.length) problems.push(`${unreached.map((c) => c.label).join(', ')} ${unreached.length > 1 ? 'are' : 'is'} never reached by the router`)
        }
        return problems.length ? { pass: false, detail: problems.join('; ') + '.' } : { pass: true }
      },
    },
    {
      id: 'control-plane',
      title: 'A separate control plane owns placement — off the request path',
      category: 'core',
      why: 'Creating cells and moving shops is control-plane work with its own state. It publishes the routing map but must not sit on the request path: if it is down or slow, existing cells keep serving and evacuation is just a routing-table write.',
      hint: 'Add a control-plane component outside the cells owning Shop placement and Cell lifecycle, with its own database. It writes the router’s routing table (or pushes config to the router); the router never calls it per request.',
      concepts: ['cell-based-architecture', 'multi-tenancy'],
      test: (g) => {
        const v = cellView(g)
        const cp = controlPlane(g)
        if (!cp.length) return { pass: false, detail: 'Nobody owns Shop placement or Cell lifecycle.' }
        const problems: string[] = []
        const missingDomains = CONTROL_DOMAINS.filter((d) => !g.owned(d))
        if (missingDomains.length) problems.push(`unowned: ${missingDomains.join(', ')}`)
        const inCell = cp.filter((n) => v.cellOf(n))
        if (inCell.length) problems.push(`${inCell.map((n) => n.label).join(', ')} sits inside a cell — the control plane must survive any cell failing`)
        const rs = routers(g, v)
        const rsIds = new Set(rs.map((r) => r.id))
        const cpIdSet = new Set(cp.map((n) => n.id))
        const asRouter = fanOut(g, v).filter((n) => cpIdSet.has(n.id) && onClientPath(g, n))
        if (asRouter.length) problems.push('the control plane is also the router — client traffic must never depend on it')
        const routerStores = new Set(g.storesOf(rs).map((s) => s.id))
        const cpDbs = g.storesOf(cp, DB_KINDS).filter((s) => !v.cellOf(s) && v.touching(s).size === 0)
        const ownDb = cpDbs.some((s) => !routerStores.has(s.id))
        if (!ownDb)
          problems.push(
            cpDbs.some((s) => routerStores.has(s.id))
              ? 'the router reads the control plane’s own database on every request — publish placement into a separate routing table instead'
              : 'it has no database of its own',
          )
        if (!rs.length) problems.push('there is no cell router for it to publish routing changes to')
        else {
          const routerStoreNodes = g.nodes.filter((n) => routerStores.has(n.id))
          const publishes =
            g.storesOf(cp).some((s) => routerStores.has(s.id)) ||
            cp.some((n) => g.out(n.id).some((e) => rsIds.has(e.target) && e.protocol !== 'telemetry')) ||
            g.asyncFlow(cp, rs) ||
            (routerStoreNodes.length > 0 && g.asyncFlow(cp, routerStoreNodes)) ||
            !!g.reaches(cp, (n) => routerStores.has(n.id), {
              through: ['broker', 'cdc', 'worker', 'function', 'stream-processor', ...DB_KINDS],
              protocols: ['event', 'data'] as Protocol[],
              maxDepth: 5,
            })
          if (!publishes) problems.push('it never updates the routing table the router reads')
          const cpIds = new Set(cp.map((n) => n.id))
          const onPath = !!g.reaches(rs, (n) => cpIds.has(n.id), { through: ['api-gateway', 'load-balancer'], protocols: SYNC_PROTOCOLS, maxDepth: 3 })
          if (onPath) problems.push('the router calls it synchronously — every request now depends on the control plane')
        }
        const cpIds = new Set(cp.map((n) => n.id))
        const cellCallers = g.nodes.filter((n) => v.cellOf(n) && g.targets(n.id, SYNC_PROTOCOLS).some((t) => cpIds.has(t.id)))
        if (cellCallers.length) problems.push(`${cellCallers.map((n) => n.label).join(', ')} call the control plane synchronously`)
        return problems.length ? { pass: false, detail: problems.join('; ') + '.' } : { pass: true }
      },
    },
    {
      id: 'cell-job-queues',
      title: 'Every cell levels load with its own job queue',
      category: 'core',
      why: 'A flash sale turns into thousands of follow-up jobs (emails, webhooks, stock sync). Queuing them inside the cell levels the spike; a queue shared by all cells would let one shop’s backlog delay everyone’s orders.',
      hint: 'Inside each cell: the app publishes jobs to a broker / queue only that cell uses, and a worker in the same cell consumes them asynchronously.',
      concepts: ['queue-load-leveling', 'cell-based-architecture'],
      test: (g) => {
        const v = cellView(g)
        if (v.cells.length < 2) return { pass: false, detail: 'Draw at least two cells first.' }
        const bad = v.cells.filter((c) => {
          const members = v.members(c.id)
          const compute = members.filter((n) => COMPUTE.includes(n.kind))
          const ownBroker = g.ofKind('broker').some((b) => {
            const t = v.touching(b)
            return t.size === 1 && t.has(c.id)
          })
          return !ownBroker || !g.asyncFlow(compute, compute)
        })
        return bad.length
          ? { pass: false, detail: `${bad.map((c) => c.label).join(', ')} ha${bad.length > 1 ? 've' : 's'} no asynchronous job path through a cell-local queue.` }
          : { pass: true }
      },
    },
    {
      id: 'flash-sale-shedding',
      title: 'Per-shop rate limiting sheds flash-sale overload',
      category: 'core',
      why: 'Cells contain a spike to 10% of shops — but the celebrity’s neighbours in that cell still suffer unless excess traffic for that one shop is rejected early (load shedding) instead of queuing until everything times out.',
      hint: 'Rate-limit per shop_id at the router or an edge WAF / waiting room in front of it (Envoy, Kong, Traefik, Cloudflare…) — or at the entry gateway of every cell. Label the component that sheds load if its technology does not say so (e.g. “Per-shop rate limiter”, “Waiting room”).',
      concepts: ['load-shedding', 'rate-limiting'],
      test: (g) => {
        const v = cellView(g)
        if (!v.cells.length) return { pass: false, detail: 'Draw the cells first.' }
        const rs = routers(g, v)
        // Global shedders: the router, or an edge node on the client request path.
        const global = [...rs, ...g.ofKind(...EDGE_KINDS).filter((n) => !v.cellOf(n) && onClientPath(g, n))]
        const globalShedder = global.find(
          (n) => g.hasTrait(n, 'rate-limiting') || sheddingText(n) || (n.kind === 'waf' && g.hasTrait(n, 'bot-protection')),
        )
        if (globalShedder) return { pass: true, detail: `${globalShedder.label} sheds excess traffic before it reaches the cells.` }
        // Otherwise every cell needs a shedder at its entry (something the router actually calls).
        const entries = cellEntries(g, v, rs)
        const sheds = (n: DiagramNode) =>
          (ENTRY_KINDS.includes(n.kind) && g.hasTrait(n, 'rate-limiting')) || (n.kind !== 'worker' && sheddingText(n))
        const unprotected = v.cells.filter((c) => !entries.some((e) => v.cellOf(e) === c.id && sheds(e)))
        if (!unprotected.length) return { pass: true, detail: 'Every cell sheds excess traffic at its entry.' }
        return unprotected.length === v.cells.length
          ? { pass: false, detail: 'Nothing on the request path to the cells rate-limits or sheds load per shop.' }
          : { pass: false, detail: `${unprotected.map((c) => c.label).join(', ')} ha${unprotected.length > 1 ? 've' : 's'} no per-shop rate limiting at the router or cell entry.` }
      },
    },
    {
      id: 'cell-telemetry',
      title: 'Every cell is observable on its own',
      category: 'bonus',
      why: 'Wave deploys only work if you can compare the canary cell with the rest: per-cell SLO dashboards decide whether the next wave goes out or the rollout halts.',
      hint: 'Send telemetry from every app and worker in every cell (and the router) to a collector feeding a metrics store; tag it with the cell id.',
      concepts: ['observability', 'slo'],
      test: (g) => {
        const v = cellView(g)
        if (!v.cells.length) return { pass: false, detail: 'No cells yet.' }
        const metrics = observability(g, 'metrics')
        if (!metrics.pass) return metrics
        const inst = new Set(g.instrumented().map((n) => n.id))
        const dark = g.nodes.filter((n) => COMPUTE.includes(n.kind) && v.cellOf(n) && !inst.has(n.id))
        return dark.length ? { pass: false, detail: `No telemetry from: ${dark.map((n) => n.label).join(', ')}` } : { pass: true }
      },
    },
    {
      id: 'cells-identical',
      title: 'Cells are identical copies',
      category: 'bonus',
      why: 'Cells are only predictable if they are cattle, not pets: the same components and technologies everywhere, so capacity planning, automation and wave deploys treat them the same.',
      hint: 'Make every cell contain the same kinds of components with the same technologies.',
      concepts: ['cell-based-architecture'],
      test: (g) => {
        const v = cellView(g)
        if (v.cells.length < 2) return { pass: false, detail: 'Draw at least two cells first.' }
        const sig = (id: string) =>
          v
            .members(id)
            .filter((n) => n.kind !== 'zone')
            .map((n) => `${n.kind}:${n.tech ?? ''}`)
            .sort()
            .join('|')
        const first = sig(v.cells[0].id)
        const odd = v.cells.filter((c) => sig(c.id) !== first)
        return odd.length ? { pass: false, detail: `${odd.map((c) => c.label).join(', ')} differ${odd.length > 1 ? '' : 's'} from ${v.cells[0].label}.` } : { pass: true }
      },
    },
    {
      id: 'cell-cache',
      title: 'Each cell has its own cache',
      category: 'bonus',
      why: 'Storefront reads dominate traffic. A cache per cell absorbs hot product pages during a drop without becoming a shared dependency.',
      hint: 'Add a cache (Memcached, Redis, Valkey) inside every cell, used by that cell’s storefront.',
      concepts: ['caching', 'cell-based-architecture'],
      test: (g) => {
        const v = cellView(g)
        if (!v.cells.length) return { pass: false, detail: 'No cells yet.' }
        const missing = v.cells.filter((c) => {
          const compute = v.members(c.id).filter((n) => COMPUTE.includes(n.kind))
          return !g.storesOf(compute, ['cache']).some((s) => {
            const t = v.touching(s)
            return t.size === 1 && t.has(c.id)
          })
        })
        return missing.length ? { pass: false, detail: `No cell-local cache in ${missing.map((c) => c.label).join(', ')}.` } : { pass: true }
      },
    },
    {
      id: 'global-identity',
      title: 'Identity stays a small global service',
      category: 'bonus',
      why: 'Some things are global by nature — one Kramo account works in every shop. Keep that set tiny (identity, CDN) and highly available, because anything global is outside the cell blast-radius guarantee.',
      hint: 'Add an identity provider outside the cells and connect the cells (or router) to it.',
      concepts: ['oauth-oidc', 'multi-tenancy'],
      test: (g) => {
        const v = cellView(g)
        const ids = g.ofKind('identity')
        if (!ids.length) return { pass: false, detail: 'No identity provider.' }
        const ok = ids.some((i) => !v.cellOf(i) && g.neighbours(i.id).length > 0)
        return ok ? { pass: true } : { pass: false, detail: 'Keep one global identity provider outside the cells and connect it.' }
      },
    },
    {
      id: 'cdn-edge',
      title: 'Static assets served from a CDN',
      category: 'bonus',
      why: 'Theme assets and product images are the bulk of storefront bytes. Serving them from a CDN keeps a drop’s image traffic out of the cells entirely.',
      hint: 'Put a CDN between clients and the router.',
      concepts: ['cdn'],
      test: (g) => {
        const clients = g.nodes.filter(isClient)
        if (!clients.length || !g.has('cdn')) return { pass: false, detail: 'No CDN in front of the clients.' }
        const missing = clients.filter((c) => !g.reaches(c, (n) => n.kind === 'cdn', { through: ['waf'], maxDepth: 2 }))
        return missing.length ? { pass: false, detail: `${missing.map((c) => c.label).join(', ')} bypass the CDN.` } : { pass: true }
      },
    },
    {
      id: 'anti-fat-router',
      title: 'Router has no business logic',
      category: 'antipattern',
      why: 'The router is the one component every request crosses. Business logic, calls to global services or reads from cell databases turn it into the new shared stack — and the next outage hits 100% of shops again.',
      hint: 'Let the router do exactly one thing: look up shop_id → cell and forward. Move everything else into the cells.',
      concepts: ['cell-based-architecture'],
      test: (g) => {
        const v = cellView(g)
        const problems: string[] = []
        for (const r of routers(g, v, LOOSE_ROUTER_KINDS)) {
          if (r.kind === 'monolith' || r.kind === 'bff') problems.push(`${r.label} is a full application acting as router`)
          if (r.domains.length) problems.push(`${r.label} owns business capabilities`)
          const cellStores = g.storesOf([r]).filter((s) => v.touching(s).size > 0)
          if (cellStores.length) problems.push(`${r.label} reads cell data (${cellStores.map((s) => s.label).join(', ')})`)
          const globalCalls = g.targets(r.id, SYNC_PROTOCOLS).filter((t) => !v.cellOf(t) && COMPUTE.includes(t.kind) && t.domains.length > 0)
          if (globalCalls.length) problems.push(`${r.label} calls ${globalCalls.map((t) => t.label).join(', ')} on every request`)
        }
        return problems.length ? { pass: false, detail: problems.join('; ') + '.' } : { pass: true }
      },
    },
  ],
  reference: {
    decisions: {
      style: 'modular-monolith',
      communication: 'hybrid',
      data: 'per-service',
      stack: { backend: 'rails', frontend: 'react', database: 'mysql', messaging: 'redis', cache: 'memcached' },
      rationale:
        'Copy the existing modular Rails monolith into identical cells, each with its own MySQL, Memcached and Redis job queue, and shard shops across them. An Envoy router with per-shop rate limits maps shop_id → cell from a small Valkey routing table that a separate Go control plane publishes from its own database.',
    },
    walkthrough: [
      'Each cell is a full, identical copy of Kramo: the modular Rails app (Storefront and Checkout modules), Sidekiq workers for fulfilment jobs and webhooks, and its own MySQL, Memcached and Redis queue. Shops are sharded across cells by shop_id; at ~40k shops per cell that is ten cells (two are drawn as the template), plus a dedicated cell for pinned celebrity shops.',
      'The cell router (Envoy with a small Lua filter) does one thing: look up shop_id → cell in the routing table, cache the answer in-process for a few seconds and forward. It also enforces per-shop rate limits, so a celebrity drop sheds excess requests for that one shop instead of starving its neighbours; inside the cell, checkout follow-up work is levelled through the job queue.',
      'The control plane (a Go service with its own Postgres as the source of truth) creates cells, places new shops, pins big merchants and moves shops. It publishes placement into a separate Valkey routing table — a single-writer projection that can be rebuilt from Postgres at any time, and a cache-style KV rather than a second database the router and control plane would share. It is never on the request path, so if it is down shops keep selling.',
      'Evacuation in under 5 minutes works because each cell’s MySQL replicates asynchronously to a warm standby copy of that cell in a second availability zone: failing over is “promote the standby + flip shop_id → cell in the routing table”, which takes about a minute. Moving an individual shop between live cells is a separate, slower copy-then-flip migration that the control plane orchestrates in the background.',
      'Global services are deliberately minimal: the CDN for theme assets and images, and Keycloak for the single Kramo account. Every app, worker and the router export OTLP tagged with the cell id; per-cell SLO dashboards drive wave deploys — canary cell, then 10%, 50%, 100% — and an SLO burn in the canary halts the rollout before it reaches other cells.',
      'Trade-offs: N copies cost more (idle headroom and a standby per cell, which is why cells are sized at ~40k shops rather than a few thousand), and cross-shop features such as platform-wide analytics need a separate asynchronous pipeline out of the cells.',
    ],
    diagram: diagram(
      [
        ['shoppers', 'web-app', 'Shopper Storefronts', 0, 220, { tech: 'react' }],
        ['merchants', 'web-app', 'Merchant Admin', 0, 440, { tech: 'react' }],
        ['cdn', 'cdn', 'CDN (themes, images)', 260, 330, { tech: 'fastly' }],
        ['idp', 'identity', 'Kramo Accounts', 520, 120, { tech: 'keycloak' }],
        ['router', 'api-gateway', 'Cell Router', 520, 330, { tech: 'envoy', notes: 'shop_id → cell lookup + per-shop rate limits. Nothing else.' }],
        ['routing', 'cache', 'Routing Table (shop → cell)', 520, 480, { tech: 'valkey', notes: 'Single writer: the control plane. Rebuildable from the Placement DB.' }],
        // Cell A
        ['cellA', 'zone', 'Cell A (shops 0–40k)', 820, 0, { w: 780, h: 330 }],
        ['appA', 'monolith', 'Kramo App', 30, 50, { tech: 'rails', parent: 'cellA', w: 260, h: 250 }],
        ['storeA', 'module', 'Storefront', 30, 60, { tech: 'rails', domains: ['storefront'], parent: 'appA' }],
        ['checkoutA', 'module', 'Checkout', 30, 160, { tech: 'rails', domains: ['checkout'], parent: 'appA' }],
        ['cacheA', 'cache', 'Cache', 330, 60, { tech: 'memcached', parent: 'cellA' }],
        ['queueA', 'broker', 'Job Queue', 330, 200, { tech: 'redis', parent: 'cellA' }],
        ['dbA', 'relational-db', 'Shop DB', 550, 60, { tech: 'mysql', parent: 'cellA' }],
        ['workerA', 'worker', 'Jobs & Webhooks', 550, 200, { tech: 'sidekiq', domains: ['fulfilment'], parent: 'cellA' }],
        // Cell B
        ['cellB', 'zone', 'Cell B (shops 40k–80k)', 820, 380, { w: 780, h: 330 }],
        ['appB', 'monolith', 'Kramo App', 30, 50, { tech: 'rails', parent: 'cellB', w: 260, h: 250 }],
        ['storeB', 'module', 'Storefront', 30, 60, { tech: 'rails', domains: ['storefront'], parent: 'appB' }],
        ['checkoutB', 'module', 'Checkout', 30, 160, { tech: 'rails', domains: ['checkout'], parent: 'appB' }],
        ['cacheB', 'cache', 'Cache', 330, 60, { tech: 'memcached', parent: 'cellB' }],
        ['queueB', 'broker', 'Job Queue', 330, 200, { tech: 'redis', parent: 'cellB' }],
        ['dbB', 'relational-db', 'Shop DB', 550, 60, { tech: 'mysql', parent: 'cellB' }],
        ['workerB', 'worker', 'Jobs & Webhooks', 550, 200, { tech: 'sidekiq', domains: ['fulfilment'], parent: 'cellB' }],
        [
          'moreCells',
          'note',
          'Cells C–J use the same template (10 cells × ~40k shops), plus a dedicated cell for pinned celebrity shops. Each cell has a warm standby in a second AZ.',
          820,
          750,
          { w: 780, h: 70 },
        ],
        // Control plane (off the request path)
        ['cp', 'service', 'Control Plane', 520, 640, { tech: 'go', domains: ['tenant-placement', 'cell-provisioning'] }],
        ['cpDb', 'relational-db', 'Cells & Placement DB', 520, 780, { tech: 'postgres' }],
        // Observability (right-hand column, between the cells)
        ['otel', 'otel-collector', 'OTel Collector', 1680, 330, { tech: 'otel-collector' }],
        ['metrics', 'metrics', 'Per-cell Metrics', 1940, 330, { tech: 'mimir' }],
        ['logs', 'logging', 'Logs', 1940, 450, { tech: 'loki' }],
        ['alerts', 'alerting', 'On-call', 2200, 330, { tech: 'pagerduty' }],
      ],
      [
        ['shoppers', 'cdn'],
        ['merchants', 'cdn'],
        ['cdn', 'router'],
        ['router', 'routing', 'data', 'shop_id → cell'],
        ['router', 'appA', 'http', 'cell A'],
        ['router', 'appB', 'http', 'cell B'],
        ['storeA', 'cacheA'],
        ['storeA', 'dbA'],
        ['checkoutA', 'dbA'],
        ['checkoutA', 'queueA', 'event', 'order jobs'],
        ['queueA', 'workerA', 'event'],
        ['workerA', 'dbA'],
        ['appA', 'idp', 'http', 'verify session'],
        ['storeB', 'cacheB'],
        ['storeB', 'dbB'],
        ['checkoutB', 'dbB'],
        ['checkoutB', 'queueB', 'event', 'order jobs'],
        ['queueB', 'workerB', 'event'],
        ['workerB', 'dbB'],
        ['appB', 'idp', 'http', 'verify session'],
        ['cp', 'cpDb'],
        ['cp', 'routing', 'data', 'publish placement'],
        ['router', 'otel'],
        ['appA', 'otel'],
        ['workerA', 'otel'],
        ['appB', 'otel'],
        ['workerB', 'otel'],
        ['otel', 'metrics'],
        ['otel', 'logs'],
        ['metrics', 'alerts'],
      ],
    ),
  },
}

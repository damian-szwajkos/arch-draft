import { SYNC_PROTOCOLS, type ComponentKind, type DiagramNode, type Scenario } from '../../engine/types'
import { DB_KINDS, type Graph } from '../../engine/graph'
import { diagram, kindIs, type EdgeSpec, type NodeSpec } from './builder'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The existing product-screen capabilities owned by the domain teams. */
const PRODUCT_DOMAINS = ['catalog', 'pricing', 'inventory', 'reviews', 'recommendations']
const OPTIONAL_DOMAINS = ['reviews', 'recommendations']
const CRITICAL_DOMAINS = ['catalog', 'pricing', 'inventory']
const CLIENTS: ComponentKind[] = ['web-app', 'mobile-app', 'device']
const DOMAIN_COMPUTE: ComponentKind[] = ['service', 'monolith', 'module', 'function', 'worker', 'orchestrator']
/** Infrastructure a request may pass through before it reaches application code. */
const EDGE: ComponentKind[] = ['cdn', 'waf', 'load-balancer', 'api-gateway']
/** Stores a BFF may legitimately read: read models / caches, never a domain's primary database. */
const READ_MODEL_KINDS: ComponentKind[] = ['cache', 'search']
/** Web clients that are in-store devices rather than the public storefront. */
const KIOSK_RE = /kiosk|in-store|terminal|\bpos\b/i
/** BFF labels that clearly serve a non-web experience. */
const NON_WEB_BFF_RE = /kiosk|in-store|terminal|\bpos\b|mobile|ios|android|\bapp\b/i

/** A component that implements business capabilities (not an edge/BFF layer). */
const isDomainCompute = (n: DiagramNode) =>
  n.kind !== 'bff' && n.kind !== 'api-gateway' && !CLIENTS.includes(n.kind) && (DOMAIN_COMPUTE.includes(n.kind) || n.domains.some((d) => PRODUCT_DOMAINS.includes(d)))

/** Does the node (or, for a monolith, one of its modules) own a product domain? */
const ownsAny = (g: Graph, n: DiagramNode, domains: string[] = PRODUCT_DOMAINS) =>
  n.domains.some((d) => domains.includes(d)) || g.children(n.id).some((c) => c.domains.some((d) => domains.includes(d)))

/** A domain team's component — the thing clients must not call directly. Infra and BFFs are excluded. */
const isDomainOwner = (g: Graph) => (n: DiagramNode) =>
  n.kind !== 'bff' && !EDGE.includes(n.kind) && !CLIENTS.includes(n.kind) && ownsAny(g, n)

/** Every node matching `pred` reachable from `from` over sync calls, hopping only through `through` kinds. */
function reachAll(g: Graph, from: DiagramNode, pred: (n: DiagramNode) => boolean, through: ComponentKind[], maxDepth = 6): DiagramNode[] {
  const found = new Map<string, DiagramNode>()
  const seen = new Set([from.id])
  let frontier = [from.id]
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const t of g.targets(id, SYNC_PROTOCOLS)) {
        if (!t || seen.has(t.id)) continue
        seen.add(t.id)
        if (pred(t)) found.set(t.id, t)
        else if (through.includes(t.kind)) next.push(t.id)
      }
    }
    frontier = next
  }
  return [...found.values()]
}

const clientsOf = (g: Graph) => g.ofKind(...CLIENTS)
const bffsOf = (g: Graph, c: DiagramNode, through: ComponentKind[] = EDGE) => reachAll(g, c, kindIs('bff'), through)
const isStorefront = (n: DiagramNode) => n.kind === 'web-app' && !KIOSK_RE.test(n.label)
/** The public web storefront(s); if every web client looks like a kiosk, fall back to all of them. */
function storefronts(g: Graph): DiagramNode[] {
  const web = g.ofKind('web-app')
  const sf = web.filter(isStorefront)
  return sf.length ? sf : web
}

/**
 * Product domains a BFF gets for its screen: by calling the owner (directly or via
 * a load balancer / internal gateway), or by reading a read model (cache/search)
 * that the owner keeps up to date — written directly or fed by events — or by
 * consuming the owner's events into its own read model.
 */
function domainsFetchedBy(g: Graph, bff: DiagramNode): Set<string> {
  const out = new Set<string>()
  for (const t of reachAll(g, bff, isDomainCompute, ['load-balancer', 'api-gateway'], 3)) for (const d of t.domains) if (PRODUCT_DOMAINS.includes(d)) out.add(d)
  const readModels = g.storesOf([bff], READ_MODEL_KINDS)
  if (!readModels.length) return out
  for (const d of PRODUCT_DOMAINS) {
    if (out.has(d)) continue
    const owners = g.ownerFamily(d).filter((n) => n.kind !== 'bff')
    if (!owners.length) continue
    const written = new Set(g.storesOf(owners, READ_MODEL_KINDS).map((s) => s.id))
    if (readModels.some((s) => written.has(s.id) || g.asyncFlow(owners, [s])) || g.asyncFlow(owners, [bff])) out.add(d)
  }
  return out
}

const names = (ns: DiagramNode[]) => ns.map((n) => n.label).join(', ')

/** "X never reach a BFF" plus a pointer when a client was drawn as an event-only IoT device. */
function unreachedDetail(g: Graph, list: DiagramNode[], suffix = ''): string {
  const asyncOnly = list.filter((c) => c.kind === 'device' && g.out(c.id).length > 0 && g.out(c.id, SYNC_PROTOCOLS).length === 0)
  const tip = asyncOnly.length
    ? ` ${names(asyncOnly)} only sends async events, which carry no request/response. A touch-screen kiosk is a browser: draw it as a Web app, or switch its edge to HTTP.`
    : ''
  return `${names(list)} never reach a BFF${suffix}.${tip}`
}

/**
 * A shared gateway can route each client to any BFF behind it, so the diagram
 * only tells us which BFFs a client *could* reach. Experiences get dedicated
 * BFFs if each one can be assigned a different BFF from its candidates
 * (bipartite matching — Kuhn's algorithm, tiny inputs).
 */
function distinctBffs(candidates: string[][]): boolean {
  const owner = new Map<string, number>()
  const tryAssign = (i: number, seen: Set<string>): boolean => {
    for (const b of candidates[i]) {
      if (seen.has(b)) continue
      seen.add(b)
      const cur = owner.get(b)
      if (cur === undefined || tryAssign(cur, seen)) {
        owner.set(b, i)
        return true
      }
    }
    return false
  }
  return candidates.every((_, i) => tryAssign(i, new Set()))
}

type Experience = { label: string; kind: ComponentKind; storefront: boolean; bffs: string[] }

/** Candidate BFF ids per experience: all mobile apps form one experience, every other client is its own. */
function experiences(g: Graph): Experience[] {
  const out: Experience[] = []
  const mobile = g.ofKind('mobile-app')
  if (mobile.length) out.push({ label: names(mobile), kind: 'mobile-app', storefront: false, bffs: [...new Set(mobile.flatMap((c) => bffsOf(g, c).map((b) => b.id)))] })
  for (const c of g.ofKind('web-app', 'device')) out.push({ label: c.label, kind: c.kind, storefront: isStorefront(c), bffs: bffsOf(g, c).map((b) => b.id) })
  return out
}

// ---------------------------------------------------------------------------
// Starter: three clients talking to five domain services directly
// ---------------------------------------------------------------------------

const domainNodes: NodeSpec[] = [
  ['catalog', 'service', 'Catalog Service', 920, 40, { tech: 'spring-boot', domains: ['catalog'] }],
  ['pricing', 'service', 'Pricing Service', 920, 170, { tech: 'spring-boot', domains: ['pricing'] }],
  ['inventory', 'service', 'Inventory Service', 920, 300, { tech: 'spring-boot', domains: ['inventory'] }],
  ['reviews', 'service', 'Reviews Service', 920, 430, { tech: 'spring-boot', domains: ['reviews'] }],
  ['recs', 'service', 'Recommendations', 920, 560, { tech: 'fastapi', domains: ['recommendations'] }],
  ['catalogDb', 'relational-db', 'Catalog DB', 1220, 40, { tech: 'postgres' }],
  ['pricingDb', 'relational-db', 'Pricing DB', 1220, 170, { tech: 'postgres' }],
  ['inventoryDb', 'relational-db', 'Inventory DB', 1220, 300, { tech: 'postgres' }],
  ['reviewsDb', 'document-db', 'Reviews DB', 1220, 430, { tech: 'mongodb' }],
  ['recsDb', 'document-db', 'Recs Store', 1220, 560, { tech: 'dynamodb' }],
]
const domainEdges: EdgeSpec[] = [
  ['catalog', 'catalogDb'],
  ['pricing', 'pricingDb'],
  ['inventory', 'inventoryDb'],
  ['reviews', 'reviewsDb'],
  ['recs', 'recsDb'],
]

const starterNodes: NodeSpec[] = [
  ['web', 'web-app', 'Web Storefront', 0, 120, { tech: 'react' }],
  ['kiosk', 'web-app', 'Store Kiosk', 0, 300, { tech: 'react' }],
  ['mobile', 'mobile-app', 'Mobile App', 0, 480, { tech: 'react-native' }],
  ...domainNodes,
]
const starterEdges: EdgeSpec[] = [
  ...domainEdges,
  ...(['web', 'mobile', 'kiosk'] as const).flatMap((c): EdgeSpec[] => [
    [c, 'catalog', 'http'],
    [c, 'pricing', 'http'],
    [c, 'inventory', 'http'],
    [c, 'reviews', 'http'],
    [c, 'recs', 'http'],
  ]),
]

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

export const retailBff: Scenario = {
  id: 'koszyk-bff',
  title: 'Woltomat: one backend, three frontends',
  tagline: 'Give the web store, the mobile app and the in-store kiosks each an API shaped for them.',
  industry: 'E-commerce',
  difficulty: 'beginner',
  estMinutes: 20,
  accent: '#d946ef',
  concepts: ['bff', 'api-gateway', 'circuit-breaker', 'cdn', 'caching', 'rate-limiting'],
  story:
    'Woltomat sells TVs, laptops and phones online and in 85 stores across Poland. The web storefront, the mobile app and the touch-screen kiosks in stores all call the same five domain services directly, through one generic REST contract nobody dares to change. Opening a product in the mobile app takes seven round-trips — on a train with weak 3G that is four seconds of spinner, and the app rating has dropped to 3.1. Last Black Week the Reviews service slowed down and every product page in every channel hung with it. The domain teams are not going to rewrite their services; your job is to redesign the layer between the frontends and the services.',
  facts: [
    { label: 'Teams', value: '3 UI teams (web, mobile, stores) + 5 domain teams, ~45 engineers' },
    { label: 'Traffic', value: '~1,800 rps peak (6× in Black Week), 65% mobile' },
    { label: 'Product screen', value: '7 round-trips, p95 4.2 s on 3G — target < 800 ms' },
    { label: 'Stores', value: '320 kiosks in 85 stores, need in-store stock levels' },
  ],
  functional: [
    'Product page shows details, price, stock, reviews and recommendations in one screen',
    'Web storefront pages are server-rendered so search engines index them',
    'Mobile app gets a compact payload made for small screens and slow networks',
    'Kiosks show stock in this store and nearby stores and can reserve an item for pickup',
    'Each UI team can ship an API change without waiting for the other two',
  ],
  nonFunctional: [
    'Product screen p95 < 800 ms on mobile, at most one round-trip from the device',
    'If reviews or recommendations are slow or down, the page still renders without them',
    'Authentication, TLS and rate limiting are handled once at the edge',
    'Popular catalog data is cached instead of fetched from Catalog on every view',
    'Web pages and assets are cacheable at the edge for SEO and speed',
  ],
  constraints: [
    'The five domain services and their databases stay as they are',
    'BFFs are owned by the UI teams and contain no business rules (prices and stock come from the domain services)',
  ],
  domains: [
    { id: 'catalog', label: 'Catalog', description: 'Product data, specs, images (existing service)' },
    { id: 'pricing', label: 'Pricing', description: 'Prices and promotions (existing service)' },
    { id: 'inventory', label: 'Inventory', description: 'Stock per warehouse and store (existing service)' },
    { id: 'reviews', label: 'Reviews', description: 'Ratings and customer reviews (existing service)' },
    { id: 'recommendations', label: 'Recommendations', description: '"Customers also bought" (existing service)' },
  ],
  recommendedStyles: ['microservices', 'event-driven'],
  styleFeedback: {
    microservices:
      'Right fit: the domain services already exist and are owned by separate teams. You add one BFF per frontend, deployed independently by the team that owns that frontend.',
    'event-driven':
      'Acceptable if you justify it: events can keep a BFF read cache or precomputed recommendations up to date, but the product screen itself is still a request/response aggregation.',
    'modular-monolith':
      'Out of scope: the five domain services and their teams stay. Merging them into one deployable would not fix the shared API that slows down the three UI teams.',
    monolith:
      'The single generic API is exactly what is slowing down three UI teams today. Going back to one deployable makes the bottleneck bigger.',
    serverless:
      'BFFs can run as functions, but each product view fans out to five services, and cold starts plus connection limits work against a sub-800 ms mobile target. Pick long-running BFF services as your main style.',
    'service-based':
      'The five domain services already exist with their own databases, so there is nothing to reshape into coarse services over a shared store. The work is the per-frontend layer in front of them, which this style says nothing about.',
    'space-based':
      'Space-based targets extreme concurrent writes to shared state. A product screen is a read-heavy aggregation at ~1,800 rps — a cache in each BFF gives the speed without a data grid, data pumps and writers.',
    microkernel:
      'Treating web, mobile and kiosk as plug-ins of one shared API recreates the single generic contract that makes three UI teams wait on each other. Separate BFFs, each owned by its UI team, are the point.',
  },
  starter: diagram(starterNodes, starterEdges),
  starterDecisions: { stack: { frontend: 'react', mobile: 'react-native', backend: 'spring-boot', database: 'postgres' } },
  hints: [
    'Count the arrows leaving the mobile app. Each one is a separate round-trip over a slow network. Where could those calls be combined?',
    'Put a layer between each frontend and the domain services. It should belong to the team that builds that frontend.',
    'Avoid one shared "BFF" for everything, because it turns into the same generic API you have now. Give web, mobile and kiosks a BFF each (kiosks are touch-screen browsers, so draw them as Web app clients).',
    'Put an API gateway in front of the BFFs to handle TLS, token checks and rate limits. Put a CDN in front of the server-rendered web storefront and connect it onward to the gateway.',
    'The web and mobile BFFs each fetch catalog, pricing, inventory, reviews and recommendations in parallel. Give every call its own timeout and circuit breaker, and leave out reviews or recommendations when they fail. Cache catalog data in a Redis owned by each BFF.',
  ],
  checks: [
    {
      id: 'bff-per-experience',
      title: 'Each frontend experience has its own BFF',
      category: 'core',
      why: 'A mobile screen on 3G and an SEO-rendered web page need different payloads, caching and release cycles. With one BFF per experience, each UI team can shape its own API. A shared one turns back into the generic bottleneck.',
      hint: 'Add a Backend for Frontend for web and another for mobile (kiosks can get a third). Route each client only to its own BFF.',
      concepts: ['bff'],
      test: (g) => {
        const clients = clientsOf(g)
        if (!clients.length) return { pass: false, detail: 'No clients on the canvas.' }
        if (g.count('bff') < 2) return { pass: false, detail: 'Fewer than two BFFs — one shared API layer is the bottleneck you are replacing.' }
        const without = clients.filter((c) => !bffsOf(g, c).length)
        if (without.length) return { pass: false, detail: unreachedDetail(g, without) }
        const exps = experiences(g)
        const mobileExp = exps.find((e) => e.kind === 'mobile-app')
        if (mobileExp) {
          const clash = exps.filter((e) => e !== mobileExp && !distinctBffs([mobileExp.bffs, e.bffs]))
          if (clash.length) return { pass: false, detail: `${mobileExp.label} and ${clash.map((e) => e.label).join(', ')} can only reach the same BFF.` }
        }
        return { pass: true }
      },
    },
    {
      id: 'gateway-in-front',
      title: 'An API gateway sits in front of the BFFs',
      category: 'core',
      why: 'TLS termination, token validation and rate limiting belong in one place at the edge. If every BFF does them, three teams build security three times. A gateway handles them once, and the BFFs keep only screen-specific logic.',
      hint: 'Route every client (through the CDN where relevant) to an API gateway, and from the gateway to the BFFs.',
      concepts: ['api-gateway', 'rate-limiting'],
      test: (g) => {
        const clients = clientsOf(g)
        if (!clients.length) return { pass: false, detail: 'No clients on the canvas.' }
        if (!g.has('api-gateway')) return { pass: false, detail: 'No API gateway on the canvas.' }
        const bypass = clients.filter((c) => bffsOf(g, c, ['cdn', 'waf', 'load-balancer']).length > 0)
        if (bypass.length) return { pass: false, detail: `${names(bypass)} reach a BFF without passing the gateway.` }
        const missing = clients.filter((c) => !bffsOf(g, c).length)
        if (missing.length) return { pass: false, detail: unreachedDetail(g, missing, ' through the gateway') }
        return { pass: true }
      },
    },
    {
      id: 'bff-aggregates',
      title: 'Each product screen is one round-trip to its own BFF',
      category: 'core',
      why: 'On a slow mobile network, latency comes mostly from the number of round-trips. The BFF should call the services in parallel inside the data centre (or read a read model they keep fresh) and return one response, so seven 3G round-trips become one. The web and mobile product pages both show all five sections, and each needs its own aggregating BFF.',
      hint: 'Connect the mobile BFF and the web BFF each to catalog, pricing, inventory, reviews and recommendations (or to a cache those services keep up to date). Make sure every BFF calls more than one service, otherwise it is only a proxy.',
      concepts: ['bff'],
      test: (g) => {
        const bffs = g.ofKind('bff')
        if (!bffs.length) return { pass: false, detail: 'No BFFs yet.' }
        const fetched = new Map(bffs.map((b) => [b.id, domainsFetchedBy(g, b)]))
        const proxies = bffs.filter((b) => fetched.get(b.id)!.size < 2)
        if (proxies.length) return { pass: false, detail: `${names(proxies)} fetches fewer than two domains — that is a proxy, not an aggregator.` }
        if (!g.has('mobile-app')) return { pass: false, detail: 'No mobile app on the canvas.' }
        const full = (id: string) => PRODUCT_DOMAINS.every((d) => fetched.get(id)?.has(d))
        // Experiences that render the full product screen: the mobile app and the public storefront.
        const screens = experiences(g).filter((e) => e.kind === 'mobile-app' || e.storefront)
        for (const e of screens) {
          if (e.bffs.some(full)) continue
          const cands = e.bffs.map((id) => g.node(id)!).filter(Boolean)
          if (!cands.length) return { pass: false, detail: `${e.label} never reaches a BFF.` }
          const best = cands.reduce((a, b) => (fetched.get(b.id)!.size > fetched.get(a.id)!.size ? b : a))
          const missing = PRODUCT_DOMAINS.filter((d) => !fetched.get(best.id)!.has(d))
          return { pass: false, detail: `${e.label}: the best BFF it reaches, ${best.label}, does not fetch ${missing.join(', ')}, so the device needs extra round-trips.` }
        }
        if (!distinctBffs(screens.map((e) => e.bffs.filter(full)))) {
          const covering = bffs.filter((b) => full(b.id))
          return {
            pass: false,
            detail: `${screens.map((e) => e.label).join(' and ')} would have to share ${names(covering)}, the only BFF that fetches the whole product screen. Give each experience its own aggregating BFF.`,
          }
        }
        return { pass: true }
      },
    },
    {
      id: 'optional-degrade',
      title: 'Reviews and recommendations can fail on their own',
      category: 'core',
      why: 'Reviews and recommendations are nice to have. The BFF calls them with a short timeout and a circuit breaker, and leaves them out when they fail. That only works if no critical service, such as Catalog, calls them synchronously, because then their slowness becomes Catalog’s slowness.',
      hint: 'Have each BFF call Reviews and Recommendations directly, or read a cache or search index they keep up to date. Remove any synchronous call from Catalog, Pricing or Inventory to them.',
      concepts: ['circuit-breaker'],
      test: (g) => {
        const bffs = g.ofKind('bff')
        if (!bffs.length) return { pass: false, detail: 'No BFFs yet.' }
        for (const d of OPTIONAL_DOMAINS) {
          const owners = g.owners(d).filter(isDomainCompute)
          if (!owners.length) return { pass: false, detail: `Nobody owns ${d}.` }
          const ownerIds = new Set(owners.map((o) => o.id))
          // Only critical-path services matter: an optional service calling another optional one is already behind the BFF's breaker.
          const chained = g
            .ofKind(...DOMAIN_COMPUTE)
            .filter((n) => !ownerIds.has(n.id) && ownsAny(g, n, CRITICAL_DOMAINS) && g.targets(n.id, SYNC_PROTOCOLS).some((t) => ownerIds.has(t.id)))
          if (chained.length) return { pass: false, detail: `${names(chained)} calls ${owners[0].label} synchronously — its outage would take the critical path down.` }
          if (!bffs.some((b) => domainsFetchedBy(g, b).has(d)))
            return { pass: false, detail: `No BFF fetches ${d} itself (by calling it or reading a cache it keeps fresh), so it cannot be dropped independently.` }
        }
        return { pass: true }
      },
    },
    {
      id: 'cdn-for-web',
      title: 'The web storefront is served through a CDN',
      category: 'core',
      why: 'A CDN serves static assets and the product-page shell from the edge with a short TTL and stale-while-revalidate, which improves Core Web Vitals (and SEO) and absorbs Black Week traffic before it reaches the BFF. Price and stock stay fresh: they are fetched per request or hydrated on the client, and a price change purges the cached page.',
      hint: 'Connect the web storefront to a CDN, and the CDN onward to the gateway.',
      concepts: ['cdn'],
      test: (g) => {
        const sf = storefronts(g)
        if (!sf.length) return { pass: false, detail: 'No web storefront on the canvas.' }
        const cdns = sf.flatMap((c) => reachAll(g, c, kindIs('cdn'), ['waf'], 2))
        if (!cdns.length) return { pass: false, detail: `${names(sf)} does not go through a CDN.` }
        return cdns.some((cdn) => bffsOf(g, cdn).length > 0)
          ? { pass: true }
          : { pass: false, detail: 'The storefront’s CDN is a dead end — connect it onward to the gateway so pages are actually served through it.' }
      },
    },
    {
      id: 'bff-cache',
      title: 'The BFF caches catalog data',
      category: 'bonus',
      why: 'Product details change a few times a day but are read thousands of times a minute. A cache-aside Redis next to the BFF takes load off Catalog and gives the BFF something to serve when Catalog is slow.',
      hint: 'Connect a BFF to a Cache (Redis, Valkey, Memcached) with a Data edge.',
      concepts: ['caching'],
      test: (g) => (g.ofKind('bff').some((b) => g.storesOf([b], ['cache']).length > 0) ? { pass: true } : { pass: false, detail: 'No BFF uses a cache.' }),
    },
    {
      id: 'ssr-seo',
      title: 'Web storefront is server-side rendered',
      category: 'bonus',
      why: 'Search engines and link previews need full HTML. A server-rendering web BFF (Next.js, Nuxt) produces it and also plays the BFF role for the browser.',
      hint: 'Choose an SSR-capable technology (Next.js, Nuxt) for the web storefront or its BFF.',
      concepts: ['bff'],
      test: (g) => {
        const sf = storefronts(g)
        const webBffs = sf.flatMap((c) => bffsOf(g, c)).filter((b) => !NON_WEB_BFF_RE.test(b.label))
        return [...sf, ...webBffs].some((n) => g.hasTrait(n, 'ssr')) ? { pass: true } : { pass: false, detail: 'Nothing on the storefront path renders on the server.' }
      },
    },
    {
      id: 'kiosk-bff',
      title: 'Kiosks are not squeezed into the storefront BFF',
      category: 'bonus',
      why: 'Kiosks need in-store stock and pickup reservations, and they release on a store-rollout schedule. Mixing them into the storefront BFF couples two teams again.',
      hint: 'Give every web or kiosk client its own BFF (draw kiosks as Web app clients). iOS and Android can share the mobile one.',
      concepts: ['bff'],
      test: (g) => {
        const clients = clientsOf(g)
        if (!clients.length) return { pass: false, detail: 'No clients on the canvas.' }
        const exps = experiences(g)
        if (exps.some((e) => !e.bffs.length)) return { pass: false, detail: 'Some clients never reach a BFF.' }
        return distinctBffs(exps.map((e) => e.bffs))
          ? { pass: true }
          : { pass: false, detail: `${exps.length} experiences (${exps.map((e) => e.label).join(' / ')}) but not enough dedicated BFFs.` }
      },
    },
    {
      id: 'edge-security',
      title: 'The gateway handles auth and rate limiting',
      category: 'bonus',
      why: 'Validating tokens and rate-limiting at the gateway stops scrapers and credential-stuffing bots before they cost any BFF or service capacity.',
      hint: 'Pick a gateway with auth and rate-limiting plugins (Kong, Apigee) or connect it to an Identity provider, and add a WAF or a rate-limiting gateway.',
      concepts: ['api-gateway', 'rate-limiting', 'oauth-oidc'],
      test: (g) => {
        const gws = g.ofKind('api-gateway')
        if (!gws.length) return { pass: false, detail: 'No API gateway.' }
        const auth = gws.some((gw) => g.hasTrait(gw, 'auth')) || [...gws, ...g.ofKind('bff')].some((n) => g.targets(n.id).some(kindIs('identity')))
        const limits = gws.some((gw) => g.hasTrait(gw, 'rate-limiting')) || g.has('waf')
        if (!auth) return { pass: false, detail: 'Nothing validates tokens at the edge (gateway auth plugin or Identity provider).' }
        if (!limits) return { pass: false, detail: 'No rate limiting at the edge.' }
        return { pass: true }
      },
    },
    {
      id: 'edge-tracing',
      title: 'BFFs and gateway are traced',
      category: 'bonus',
      why: 'When a product page is slow, a trace that goes through the BFF and its parallel calls shows which service ate the latency budget.',
      hint: 'Draw Telemetry edges from the gateway and every BFF to a collector or tracing backend (Tempo, Jaeger).',
      concepts: ['distributed-tracing'],
      test: (g) => {
        const must = g.ofKind('bff', 'api-gateway')
        if (!must.length) return { pass: false, detail: 'No BFFs or gateway yet.' }
        if (!g.has('tracing')) return { pass: false, detail: 'No tracing backend.' }
        const inst = new Set(g.instrumented().map((n) => n.id))
        const missing = must.filter((m) => !inst.has(m.id))
        return missing.length ? { pass: false, detail: `Not instrumented: ${names(missing)}` } : { pass: true }
      },
    },
    {
      id: 'anti-client-to-domain',
      title: 'Clients don’t call domain services directly',
      category: 'antipattern',
      why: 'When apps call domain services directly, even through a routing-only gateway, every service contract is frozen by app versions in the wild, and the device does all the aggregation over the slowest network in the system.',
      hint: 'Route client traffic into a BFF. The gateway forwards to BFFs (and edge helpers such as an authorizer), and only BFFs call domain services.',
      concepts: ['bff', 'api-gateway'],
      test: (g) => {
        const bad = clientsOf(g).filter((c) => reachAll(g, c, isDomainOwner(g), EDGE).length > 0)
        return bad.length ? { pass: false, detail: `${names(bad)} reach domain services without a BFF.` } : { pass: true }
      },
    },
    {
      id: 'anti-bff-domain-db',
      title: 'BFFs don’t read a domain service’s database',
      category: 'antipattern',
      why: 'A BFF that queries the Reviews team’s MongoDB couples a UI team to another team’s schema and bypasses the rules that service enforces. The domain services and their databases stay private; BFFs go through the service API or a read model the service publishes.',
      hint: 'Replace the Data edge from the BFF to the domain database with a call to the owning service, or let that service keep a cache or search index the BFF reads.',
      concepts: ['bff', 'database-per-service'],
      test: (g) => {
        const bad = g.ofKind('bff').flatMap((b) =>
          g
            .storesOf([b], DB_KINDS)
            .filter((s) => g.sources(s.id, ['data']).some((n) => n.kind !== 'bff' && ownsAny(g, g.deployable(n))))
            .map((s) => `${b.label} → ${s.label}`),
        )
        return bad.length ? { pass: false, detail: `BFF reads a domain database: ${bad.join('; ')}.` } : { pass: true }
      },
    },
  ],
  inspiration: [
    { label: 'Sam Newman — Backends For Frontends pattern', url: 'https://samnewman.io/patterns/architectural/bff/' },
    { label: 'ByteByteGo — API gateway vs BFF', url: 'https://blog.bytebytego.com/p/api-gateway' },
  ],
  reference: {
    decisions: {
      style: 'microservices',
      communication: 'sync',
      data: 'per-service',
      stack: { frontend: 'nextjs', mobile: 'react-native', backend: 'spring-boot', database: 'postgres', cache: 'redis' },
      rationale:
        'Keep the domain services and add one BFF per experience owned by its UI team: a Next.js SSR BFF for web, a GraphQL BFF for mobile and a small NestJS BFF for kiosks. Kong handles TLS, auth and rate limits in front of them, Cloudflare caches the storefront, and the BFFs fan out in parallel with timeouts and circuit breakers.',
    },
    walkthrough: [
      'Every client enters through Kong, which terminates TLS, validates the OIDC token and applies per-client rate limits. The web storefront goes through Cloudflare first, which caches assets and the product-page shell with a short TTL and stale-while-revalidate; price and stock are fetched fresh on every request.',
      'Each UI team owns its BFF. Next.js renders SEO-friendly HTML for the web, an Apollo GraphQL BFF lets the mobile app ask for exactly the fields one screen needs in one round-trip, and a small NestJS BFF serves kiosks with in-store stock.',
      'A BFF calls catalog, pricing, inventory, reviews and recommendations in parallel. Each call has a timeout budget (e.g. 150 ms) and a circuit breaker (resilience4j / opossum). If reviews or recommendations fail, the response leaves that section out, while price and stock are required.',
      'The web and mobile BFFs each keep product details in their own small Redis (cache-aside, short TTL), so Catalog sees a fraction of the traffic and a slow Catalog does not empty the page. One cache per BFF keeps eviction, TTLs and upgrades in the hands of the team that owns the screen; the cost is two small clusters instead of one shared one.',
      'BFFs contain no business rules and never touch a domain database. Prices and stock always come from the domain services, so three BFFs never disagree about what a TV costs. The trade-off is that the UI teams now run and are on call for three more small services, which are traced end-to-end through Jaeger.',
    ],
    diagram: diagram(
      [
        ['web', 'web-app', 'Web Storefront', 0, 120, { tech: 'nextjs' }],
        ['kiosk', 'web-app', 'Store Kiosk', 0, 300, { tech: 'react' }],
        ['mobile', 'mobile-app', 'Mobile App', 0, 480, { tech: 'react-native' }],
        ['cdn', 'cdn', 'CDN', 260, 120, { tech: 'cloudflare' }],
        ['gw', 'api-gateway', 'API Gateway', 260, 300, { tech: 'kong', notes: 'TLS, OIDC token check, rate limits per client' }],
        ['webCache', 'cache', 'Web BFF Cache', 560, 0, { tech: 'redis', notes: 'Catalog cache-aside, owned by the web team' }],
        ['webBff', 'bff', 'Web BFF (SSR)', 560, 120, { tech: 'nextjs', notes: 'Owned by the web team' }],
        ['kioskBff', 'bff', 'Kiosk BFF', 560, 300, { tech: 'nestjs', notes: 'Owned by the stores team' }],
        ['mobileBff', 'bff', 'Mobile BFF', 560, 480, { tech: 'apollo', notes: 'Owned by the mobile team; parallel calls, 150 ms timeouts, circuit breakers' }],
        ['mobileCache', 'cache', 'Mobile BFF Cache', 560, 660, { tech: 'redis', notes: 'Catalog cache-aside, owned by the mobile team' }],
        ...domainNodes,
        ['tracing', 'tracing', 'Tracing', 0, 800, { tech: 'jaeger' }],
      ],
      [
        ['web', 'cdn', 'http'],
        ['cdn', 'gw', 'http'],
        ['kiosk', 'gw', 'http'],
        ['mobile', 'gw', 'http'],
        ['gw', 'webBff', 'http'],
        ['gw', 'kioskBff', 'http'],
        ['gw', 'mobileBff', 'graphql'],
        ['webBff', 'catalog', 'http'],
        ['webBff', 'pricing', 'http'],
        ['webBff', 'inventory', 'http'],
        ['webBff', 'reviews', 'http', 'optional'],
        ['webBff', 'recs', 'http', 'optional'],
        ['kioskBff', 'catalog', 'http'],
        ['kioskBff', 'pricing', 'http'],
        ['kioskBff', 'inventory', 'http', 'store stock'],
        ['mobileBff', 'catalog', 'http'],
        ['mobileBff', 'pricing', 'http'],
        ['mobileBff', 'inventory', 'http'],
        ['mobileBff', 'reviews', 'http', 'optional'],
        ['mobileBff', 'recs', 'http', 'optional'],
        ['webBff', 'webCache', 'data'],
        ['mobileBff', 'mobileCache', 'data'],
        ...domainEdges,
        ['gw', 'tracing', 'telemetry'],
        ['webBff', 'tracing', 'telemetry'],
        ['kioskBff', 'tracing', 'telemetry'],
        ['mobileBff', 'tracing', 'telemetry'],
      ],
    ),
  },
}

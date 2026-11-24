import { SYNC_PROTOCOLS, type ComponentKind, type DiagramNode, type Scenario } from '../../engine/types'
import { CLIENT_KINDS, COMPUTE_KINDS, DATA_KINDS, DB_KINDS, type Graph } from '../../engine/graph'
import { TECH_BY_ID } from '../tech'
import { diagram, observability, PAYMENT } from './builder'

/** Hops a request may take on its way to the gateway (edge network). */
const EDGE_KINDS: ComponentKind[] = ['cdn', 'waf', 'load-balancer']

/** Labels that describe the merchants' side — checked before the PAYMENT regex, since merchants of a payments API "take payments". */
const MERCHANT = /merchant|shop|store|seller|webhook/i

/** A card processor / PSP the charges service legitimately talks to. Tech traits first, label only as a fallback. */
const isProcessor = (g: Graph, n: DiagramNode) => {
  if (n.kind !== 'external') return false
  if (g.hasTrait(n, 'payment', 'card-network')) return true
  if (MERCHANT.test(n.label)) return false
  return g.techTraits(n).length === 0 && PAYMENT.test(n.label)
}

/** Third parties that call into the platform — i.e. the merchants' own servers. */
const merchantSystems = (g: Graph) =>
  g.ofKind('external').filter((e) => !isProcessor(g, e) && g.out(e.id, SYNC_PROTOCOLS).length > 0)

/** Anything on the merchants' side: callers, webhook receivers, or nodes labelled as merchant endpoints. */
const merchantEndpoints = (g: Graph) => {
  const whTargets = new Set(g.ownerFamily('webhooks').flatMap((w) => g.targets(w.id).map((t) => t.id)))
  return g
    .ofKind('external')
    .filter((e) => !isProcessor(g, e) && (g.out(e.id, SYNC_PROTOCOLS).length > 0 || whTargets.has(e.id) || MERCHANT.test(e.label)))
}

/** Members of `fam` that are not shared with `other` (e.g. drop a common monolith container). */
const only = (fam: DiagramNode[], other: DiagramNode[]) => {
  const ids = new Set(other.map((o) => o.id))
  return fam.filter((n) => !ids.has(n.id))
}

const techName = (n: DiagramNode) => (n.tech ? (TECH_BY_ID[n.tech]?.name ?? n.tech) : n.label)

/** Gateways that can enforce limits: untyped, or with a rate-limiting tech. */
const limitingGateways = (g: Graph) => g.ofKind('api-gateway').filter((gw) => !gw.tech || g.hasTrait(gw, 'rate-limiting'))

/** Limiting gateways that actually sit in front of charge creation (fallback: all limiting gateways). */
const chargeGateways = (g: Graph) => {
  const lim = limitingGateways(g)
  const ids = new Set(g.ownerFamily('charges').map((c) => c.id))
  const front = lim.filter((gw) => g.reaches(gw, (n) => ids.has(n.id), { through: ['load-balancer'], maxDepth: 2 }))
  return front.length ? front : lim
}

/** Managed gateways (Amazon API Gateway, Apigee…) keep per-key quotas globally themselves. */
const managedLimiter = (g: Graph, gw: DiagramNode) => g.hasTrait(gw, 'managed') && g.hasTrait(gw, 'rate-limiting')

/** Domain-less services/functions the gateway consults (a rate-limit or auth sidecar service). */
const gatewayHelpers = (g: Graph, gw: DiagramNode) =>
  g.targets(gw.id, SYNC_PROTOCOLS).filter((t) => (t.kind === 'service' || t.kind === 'function') && t.domains.length === 0)

export const apiGuard: Scenario = {
  id: 'fintly-public-api',
  title: 'Fintly: survive the runaway script',
  tagline: 'One partner’s buggy loop took the payments API down. Make sure it can never happen again.',
  industry: 'Developer platforms',
  difficulty: 'beginner',
  estMinutes: 25,
  accent: '#84cc16',
  concepts: ['rate-limiting', 'idempotency', 'load-shedding', 'api-gateway', 'dead-letter-queue', 'cqrs'],
  story:
    'Fintly is a Kraków fintech whose public REST API lets 3,000 online shops take card payments from their own servers, a merchant dashboard and a mobile SDK. Today everything — charges, reports and webhook sending — runs in one TypeScript monolith on six replicas behind NGINX, sharing one PostgreSQL. Last Tuesday a partner deployed a script with a retry loop and no sleep: 40,000 requests per second from a single API key, and within four minutes every merchant was getting 502s. Two weeks earlier a mobile client timed out, retried POST /charges and a customer was charged twice — the story made it onto a popular Polish tech forum. Black Friday is six weeks away and will triple normal traffic, so the CTO’s brief is short: one noisy merchant must never hurt the others, a retry must never charge twice, and charges must keep working even when reports are on fire.',
  facts: [
    { label: 'Team & today', value: '7 engineers (2 platform), Go & TypeScript; one monolith on 6 replicas behind NGINX, one PostgreSQL' },
    { label: 'Traffic', value: '~1,200 req/s normal, 3× on Black Friday; incident peak 40k req/s from one key' },
    { label: 'Plans & volume', value: 'Per key: Starter 25, Pro 100, Enterprise 500 req/s; 3,000 merchants, ~2M charges/month, 18 months of reports' },
    { label: 'SLA', value: 'POST /charges 99.95% available, p99 < 400 ms' },
  ],
  functional: [
    'Merchants authenticate every API call with a secret API key tied to their plan',
    'Create a charge (POST /charges) — card authorised via the acquirer',
    'Safely retry a charge request with an Idempotency-Key header without paying twice',
    'List transactions and download monthly CSV reports in the dashboard',
    'Notify merchants of payment status changes via signed webhooks',
  ],
  nonFunctional: [
    'Per-API-key rate limits by plan that hold across all gateway replicas (HTTP 429 + Retry-After)',
    'Charge creation stays up even when listing and report endpoints degrade',
    'Webhook delivery retries with backoff for up to 3 days; one dead endpoint never delays others; failures are parked, never lost',
    'On-call is paged when a key is throttled heavily or the charge error rate rises',
  ],
  constraints: [
    'Card data is handled by the acquirer — Fintly never stores PANs',
    'Small platform team: prefer managed or boring, well-known components',
    'The public API contract (paths, Idempotency-Key header) must not change',
  ],
  domains: [
    { id: 'merchants', label: 'Merchant accounts & API keys', description: 'Merchants, API keys, plans and their rate-limit quotas' },
    { id: 'charges', label: 'Charges', description: 'Creating and authorising charges, idempotency keys' },
    { id: 'webhooks', label: 'Webhook delivery', description: 'Signed outbound notifications with retries' },
    { id: 'reporting', label: 'Reporting', description: 'Transaction listing, search and CSV exports' },
  ],
  recommendedStyles: ['microservices', 'modular-monolith'],
  styleFeedback: {
    microservices:
      'Good fit: a handful of services lets charges, reports and webhook delivery scale and fail independently — exactly the isolation the CTO asked for, without dozens of tiny services.',
    'modular-monolith':
      'Reasonable for a 7-person team, as long as reports read from their own store (or run as a separately deployed piece) so a heavy export cannot starve charge creation.',
    monolith:
      'That is today’s system: reports, charges and webhook sending share one process pool and one PostgreSQL, so one heavy caller or one slow export takes everything down.',
    'event-driven':
      'Events are useful for webhooks and the reporting read model, but charge creation is a synchronous request/response that must answer within 400 ms; going fully event-driven adds brokers and eventual consistency where merchants expect an immediate answer.',
    serverless:
      'Functions scale out, but a 40k req/s burst turns into thousands of concurrent invocations and a database connection storm; you still need a gateway with shared rate limits in front.',
  },
  hints: [
    'Every caller — dashboard, SDK and the merchants’ servers — should come through one front door that knows who they are.',
    'Rate limits counted in each gateway replica’s memory do not add up: with 6 replicas a Pro merchant gets 600 req/s instead of 100. Where can all replicas share one counter — or which managed gateway keeps quotas globally for you?',
    'An Idempotency-Key is only safe in durable storage owned by Charges — a unique key in its relational database, recorded before the acquirer is called — not in a cache that can be evicted.',
    'Reports and listings are heavy reads. Give them their own store (an analytics DB fed by events/CDC, or a streaming read replica) so they can be shed without touching charges.',
    'Never call a merchant’s webhook URL inside POST /charges. Publish a "charge.updated" event; a worker delivers it, moves failures to delayed retry topics (so one dead endpoint does not block the others) and finally parks them in a dead-letter queue.',
    'Near-solution: Kong (rate-limiting plugin, counters in Redis) → Accounts, Charges (+PostgreSQL), Reporting (+ClickHouse); Charges → Kafka → Webhook worker → merchant endpoints, with retry + DLQ topics; Prometheus + Alertmanager on the gateway.',
  ],
  checks: [
    {
      id: 'rate-limited-entry',
      title: 'All API traffic passes a rate-limiting gateway',
      category: 'core',
      why: 'A single runaway API key can only be stopped at a point every request crosses. A gateway that enforces per-key quotas turns a 40k req/s flood into cheap 429 responses before it reaches charge creation.',
      hint: 'Put an API gateway with rate limiting (Kong, Envoy, Traefik, Amazon API Gateway, Apigee…) in front of the services and route the dashboard, SDK and merchant servers through it — a CDN, WAF or load balancer in front of it is fine.',
      concepts: ['rate-limiting', 'api-gateway'],
      test: (g) => {
        const gws = g.ofKind('api-gateway')
        if (!gws.length) return { pass: false, detail: 'No API gateway — nothing can enforce per-key limits.' }
        const limiting = limitingGateways(g)
        if (!limiting.length)
          return { pass: false, detail: `${techName(gws[0])} has no built-in per-key rate limiting — pick a gateway that does.` }
        const clients = g.ofKind(...CLIENT_KINDS)
        if (!clients.length) return { pass: false, detail: 'No clients on the canvas — add the dashboard and the mobile SDK.' }
        const callers = [...clients, ...merchantSystems(g)]
        const opts = { through: EDGE_KINDS, protocols: SYNC_PROTOCOLS, maxDepth: 5 }
        const bypass = callers.filter((c) => g.reaches(c, (n) => COMPUTE_KINDS.includes(n.kind), opts))
        if (bypass.length)
          return {
            pass: false,
            detail: `${bypass.map((b) => b.label).join(', ')} reach services without passing the gateway — exactly how last week’s script got through.`,
          }
        const missing = clients.filter((c) => !g.reaches(c, (n) => n.kind === 'api-gateway', opts))
        if (missing.length) return { pass: false, detail: `${missing.map((c) => c.label).join(', ')} never reach the gateway.` }
        const charges = g.ownerFamily('charges')
        if (!charges.length) return { pass: false, detail: 'Nobody owns Charges yet.' }
        const ids = new Set(charges.map((c) => c.id))
        if (!g.reaches(limiting, (n) => ids.has(n.id), { through: ['load-balancer'], maxDepth: 2 }))
          return { pass: false, detail: 'Charge requests do not pass through the rate-limited gateway.' }
        return true
      },
    },
    {
      id: 'shared-limit-store',
      title: 'Rate-limit counters are shared by all gateway replicas',
      category: 'core',
      why: 'A self-hosted gateway runs as several replicas. Counters kept in each replica’s memory let a merchant multiply their quota by the replica count; a shared store with atomic increments (Redis INCR or a Lua token-bucket script) makes the limit global. Managed gateways such as Amazon API Gateway or Apigee keep distributed quotas for you.',
      hint: 'Connect the gateway (or a small rate-limit service it consults) to a Cache such as Redis or Valkey with a Data edge — or pick a managed gateway with built-in per-key quotas.',
      concepts: ['rate-limiting'],
      test: (g) => {
        if (!g.has('api-gateway')) return { pass: false, detail: 'No gateway to keep counters for.' }
        const gws = chargeGateways(g)
        if (!gws.length) return { pass: false, detail: 'No gateway that can rate-limit.' }
        const unshared = gws.filter(
          (gw) => !managedLimiter(g, gw) && !g.storesOf([gw, ...gatewayHelpers(g, gw)], ['cache']).length,
        )
        if (unshared.length)
          return {
            pass: false,
            detail: `${unshared[0].label} would count in each replica’s memory — 6 replicas means 6× the quota. Give it (or a rate-limit service it calls) a shared cache.`,
          }
        return gws.every((gw) => managedLimiter(g, gw))
          ? { pass: true, detail: 'The managed gateway keeps per-key quotas globally.' }
          : true
      },
    },
    {
      id: 'idempotent-charges',
      title: 'Idempotency keys are stored durably by Charges',
      category: 'core',
      why: 'A retried POST /charges must return the original result instead of charging again. Charges inserts the Idempotency-Key (UNIQUE per merchant + key, status "started") in its own transaction before calling the acquirer with a stable reference, then stores the final response against the key: a concurrent retry gets 409, a later one gets the stored response, and a crashed attempt can be reconciled with the acquirer.',
      hint: 'Connect the Charges owner to a Relational database with a Data edge and keep an idempotency_keys table (unique per merchant + key) next to the charges table.',
      concepts: ['idempotency', 'acid-vs-base'],
      test: (g) => {
        const fam = g.ownerFamily('charges')
        if (!fam.length) return { pass: false, detail: 'Nobody owns Charges yet.' }
        const dbs = g.storesOf(fam, DB_KINDS)
        if (!dbs.length)
          return g.storesOf(fam, ['cache']).length
            ? { pass: false, detail: 'Idempotency keys only in a cache: after an eviction or failover the retry charges the customer again.' }
            : { pass: false, detail: 'Charges have no database to record charges and idempotency keys.' }
        const ok = dbs.some((d) => d.kind === 'relational-db' || d.kind === 'document-db' || g.hasTrait(d, 'acid', 'key-value'))
        return ok ? true : { pass: false, detail: 'Pick a store with unique constraints or conditional writes (e.g. PostgreSQL) for idempotency keys.' }
      },
    },
    {
      id: 'reports-isolated',
      title: 'Reports read from their own store, not the charges database',
      category: 'core',
      why: 'A merchant exporting 18 months of transactions runs huge scans. If that hits the database (or API) that creates charges, Black Friday reports slow down payments. A separate read model fed from charge events lets you degrade or shed reports while charges stay fast (CQRS).',
      hint: 'Give the Reporting owner its own store (analytics DB, search index or read replica) and feed it from Charges via a broker, CDC or replication — never by querying the charges DB.',
      concepts: ['cqrs', 'load-shedding'],
      test: (g) => {
        const charges = g.ownerFamily('charges')
        const reportingFam = g.ownerFamily('reporting')
        if (!reportingFam.length) return { pass: false, detail: 'Nobody owns Reporting yet.' }
        if (!charges.length) return { pass: false, detail: 'Nobody owns Charges yet.' }
        const rep = only(reportingFam, charges)
        if (!rep.length) return { pass: false, detail: 'Charges and Reporting are the same component — a heavy export competes with charge creation.' }
        const chargeDbs = g.storesOf(charges, DB_KINDS)
        const allRepStores = g.storesOf(rep)
        const shared = allRepStores.filter((s) => chargeDbs.includes(s))
        if (shared.length) return { pass: false, detail: `Reports query ${shared[0].label}, the same database charges are written to.` }
        const repStores = g.storesOf(rep, DATA_KINDS.filter((k) => k !== 'cache'))
        if (!repStores.length)
          return allRepStores.length
            ? { pass: false, detail: 'A cache cannot hold 18 months of history for exports — use an analytics DB, search index or read replica.' }
            : { pass: false, detail: 'Reporting has no read model of its own.' }
        const chargeIds = new Set(charges.map((c) => c.id))
        if (rep.some((r) => g.targets(r.id, SYNC_PROTOCOLS).some((t) => chargeIds.has(t.id))))
          return { pass: false, detail: 'Reporting pulls data by calling Charges synchronously — exports still load the charge path.' }
        const fed =
          g.asyncFlow(charges, [...rep, ...repStores]) || chargeDbs.some((db) => g.targets(db.id).some((t) => repStores.includes(t)))
        return fed ? true : { pass: false, detail: 'Nothing feeds the reporting store from Charges — publish charge events or replicate the charges DB.' }
      },
    },
    {
      id: 'async-webhooks',
      title: 'Webhooks are delivered asynchronously',
      category: 'core',
      why: 'Merchant endpoints are slow, flaky or down. Calling them inside POST /charges ties your latency and availability to 3,000 servers you do not control. A queue (or a transactional outbox) plus a delivery worker keeps charges fast and allows retries for days.',
      hint: 'Charges → broker → a worker (or push-delivery broker) that owns Webhook delivery → merchant endpoints (an external node). A transactional outbox also works: Charges DB → Debezium/CDC → broker → worker, or a delivery worker polling the outbox table (Data edge to the Charges DB).',
      concepts: ['background-jobs', 'event-driven'],
      test: (g) => {
        const charges = g.ownerFamily('charges')
        const whFam = g.ownerFamily('webhooks')
        if (!whFam.length) return { pass: false, detail: 'Nobody owns Webhook delivery yet.' }
        if (!charges.length) return { pass: false, detail: 'Nobody owns Charges yet.' }
        const wh = only(whFam, charges)
        if (!wh.length) return { pass: false, detail: 'Charges delivers its own webhooks on the request path.' }
        const chargeIds = new Set(charges.map((c) => c.id))
        if (wh.some((w) => g.sources(w.id, SYNC_PROTOCOLS).some((s) => chargeIds.has(s.id))))
          return { pass: false, detail: 'Charges calls the webhook sender synchronously — that is not decoupled.' }
        const chargeDbs = g.storesOf(charges, DB_KINDS)
        const outboxPoller = wh.some(
          (w) => (w.kind === 'worker' || w.kind === 'function') && g.storesOf([w], DB_KINDS).some((db) => chargeDbs.includes(db)),
        )
        if (!outboxPoller && !g.asyncFlow(charges, wh))
          return {
            pass: false,
            detail: 'No queue, event stream or outbox between Charges and webhook delivery — add Charges → broker → worker, or Charges DB → Debezium → broker → worker.',
          }
        const delivers = wh.some((w) => g.targets(w.id).some((t) => t.kind === 'external' && !isProcessor(g, t)))
        return delivers ? true : { pass: false, detail: 'Webhook delivery never reaches the merchants — add an external node for merchant endpoints.' }
      },
    },
    {
      id: 'reports-sheddable',
      title: 'Reports can be shed without touching charges',
      category: 'bonus',
      why: 'Load shedding only works if non-critical work runs on capacity you can throttle separately. With reports in their own deployable, the gateway can return fast 503s for /reports on Black Friday while charges keep their own replicas, connection pool and limits.',
      hint: 'Run Reporting as its own service (or extract it from the application) so it scales and fails on its own.',
      concepts: ['load-shedding', 'service-granularity'],
      test: (g) => {
        const rep = g.owners('reporting')
        const ch = g.owners('charges')
        if (!rep.length || !ch.length) return { pass: false, detail: 'Assign both Charges and Reporting first.' }
        const chUnits = new Set(ch.map((n) => g.deployable(n).id))
        const shared = rep.filter((n) => chUnits.has(g.deployable(n).id))
        return shared.length
          ? { pass: false, detail: 'Reports run in the same deployable as charges, sharing threads, connection pool and memory.' }
          : true
      },
    },
    {
      id: 'api-key-auth',
      title: 'API keys are verified at the gateway',
      category: 'bonus',
      why: 'Per-key limits need to know whose key it is. The gateway resolves the key to a merchant and plan — from keys synced out of the merchant accounts, an auth plugin calling them, or an identity provider — before routing.',
      hint: 'Connect the gateway to the component that owns Merchant accounts & API keys, or to an Identity provider.',
      concepts: ['api-gateway', 'oauth-oidc'],
      test: (g) => {
        const gws = g.ofKind('api-gateway')
        if (!gws.length) return { pass: false, detail: 'No gateway.' }
        const accounts = new Set(g.ownerFamily('merchants').map((n) => n.id))
        const isAuth = (t: DiagramNode) => t.kind === 'identity' || accounts.has(t.id)
        const ok = gws.some(
          (gw) => g.targets(gw.id).some(isAuth) || gatewayHelpers(g, gw).some((h) => g.targets(h.id).some(isAuth)),
        )
        return ok ? true : { pass: false, detail: 'The gateway never checks API keys against merchant accounts or an identity provider.' }
      },
    },
    {
      id: 'webhook-dlq',
      title: 'Failed webhooks are retried and parked in a DLQ',
      category: 'bonus',
      why: 'Some merchant endpoints stay down for hours. Backing off inside the consumer would block every other merchant on that partition, so failed deliveries move to delayed retry topics (or a deliveries table with next_attempt_at); after the last attempt they land in a dead-letter queue to be inspected and replayed instead of being lost or blocking others.',
      hint: 'Let the webhook worker publish failed deliveries to retry / DLQ topics, or consume from a queue with built-in redelivery and dead-lettering (SQS, RabbitMQ).',
      concepts: ['dead-letter-queue', 'idempotency'],
      test: (g) => {
        const wh = only(g.ownerFamily('webhooks'), g.ownerFamily('charges'))
        if (!wh.length) return { pass: false, detail: 'No separate webhook delivery component.' }
        const publishes = wh.some((w) => {
          const inputs = new Set(g.sources(w.id).map((s) => s.id))
          return g.targets(w.id).some((t) => t.kind === 'broker' && !inputs.has(t.id))
        })
        const nativeDlq = wh.some((w) => g.sources(w.id).some((s) => s.kind === 'broker' && g.hasTrait(s, 'queue', 'push-delivery')))
        const pushBroker = wh.some((w) => w.kind === 'broker' && g.hasTrait(w, 'push-delivery'))
        return publishes || nativeDlq || pushBroker
          ? true
          : { pass: false, detail: 'Nowhere to park webhooks that keep failing — add retry / dead-letter topics or a queue with dead-lettering.' }
      },
    },
    {
      id: 'throttle-alerting',
      title: 'Throttling and errors are visible and alerting',
      category: 'bonus',
      why: 'Last week nobody noticed the flood until merchants complained. Gateway metrics (429s per key, latency per route) feeding alert rules let on-call spot a runaway client in a minute, not an hour.',
      hint: 'Send the gateway’s telemetry to Metrics (directly or via an OpenTelemetry Collector) and connect Metrics to Alerting.',
      concepts: ['observability', 'slo'],
      test: (g) => {
        const obs = observability(g, 'metrics', 'alerting')
        if (!obs.pass) return obs
        const metricsOf = (gw: DiagramNode) =>
          g.ofKind('metrics').filter(
            (m) => g.reaches(gw, (n) => n.id === m.id, { through: ['otel-collector'], protocols: ['telemetry'], maxDepth: 3 }) !== undefined,
          )
        const fed = g.ofKind('api-gateway').flatMap(metricsOf)
        if (!fed.length) return { pass: false, detail: 'The gateway’s telemetry never reaches a metrics store — you cannot see which key is being throttled.' }
        const alerts = fed.some(
          (m) =>
            g.reaches(m, (n) => n.kind === 'alerting', { through: ['otel-collector', 'dashboards'], maxDepth: 3 }) ||
            g.ofKind('alerting').some((a) => g.targets(a.id).some((t) => t.id === m.id)),
        )
        return alerts ? true : { pass: false, detail: 'Gateway metrics are collected but no alert rule reaches on-call — connect Metrics to Alerting.' }
      },
    },
    {
      id: 'anti-inline-webhooks',
      title: 'Charges never call merchant servers inline',
      category: 'antipattern',
      why: 'A synchronous call to a merchant’s webhook URL inside charge creation makes every charge as slow as the slowest merchant, and a failed callback can roll back or duplicate a payment.',
      hint: 'Remove the direct Charges → merchant edge; publish an event and let the webhook worker deliver it.',
      concepts: ['background-jobs'],
      test: (g) => {
        const merchants = new Set(merchantEndpoints(g).map((m) => m.id))
        const bad = g.ownerFamily('charges').filter((c) => g.targets(c.id).some((t) => merchants.has(t.id)))
        return bad.length ? { pass: false, detail: `${bad.map((b) => b.label).join(', ')} call merchant servers directly.` } : true
      },
    },
  ],
  inspiration: [
    { label: 'Stripe Blog — Scaling your API with rate limiters', url: 'https://stripe.com/blog/rate-limiters' },
    { label: 'Stripe Blog — Designing robust and predictable APIs with idempotency', url: 'https://stripe.com/blog/idempotency' },
  ],
  reference: {
    decisions: {
      style: 'microservices',
      communication: 'hybrid',
      data: 'per-service',
      stack: { frontend: 'react', mobile: 'react-native', backend: 'go', database: 'postgres', messaging: 'kafka', cache: 'redis' },
      rationale:
        'Three small Go services behind Kong: per-key limits counted in Redis stop noisy merchants, idempotency keys live with charges in PostgreSQL, and reports and webhooks are fed asynchronously so they can degrade without touching charge creation.',
    },
    walkthrough: [
      'Every caller — the React dashboard, the mobile SDK and merchant servers — enters through Kong. API keys are synced from the Accounts service into Kong consumers (or validated by a small auth plugin), so Kong knows the merchant and plan; its rate-limiting plugin with policy: redis keeps per-key counters in Redis, so the limit holds across all gateway replicas and a runaway script gets 429 + Retry-After instead of an outage. (A Stripe-style token bucket can be done with a Redis Lua script.)',
      'Priority comes from separation, not magic: POST /charges has its own per-route limits and separately scaled Charges replicas, while /reports and listing routes get tighter limits and are the first to be shed with a fast 503 when the platform is under pressure.',
      'Charges first inserts the Idempotency-Key into PostgreSQL (UNIQUE on merchant + key, status started) in its own transaction, then calls the acquirer with a stable reference, then stores the final response against the key. A concurrent retry gets 409, a later mobile retry gets the stored response, and a crashed attempt is reconciled with the acquirer — the customer is charged once. Fintly never touches card numbers.',
      'Charges publishes charge.updated events to Kafka. The Reporting service consumes them into ClickHouse, so 18-month CSV exports scan a column store instead of the transactional database — the trade-off is that reports are a few seconds behind.',
      'A webhook worker consumes the same events and POSTs signed payloads to merchant endpoints. A failed delivery is not retried in place (that would block the partition for every other merchant): it moves to delayed retry topics (1 min, 1 h, 6 h…) and, after 3 days, to a dead-letter topic for replay.',
      'Prometheus scrapes 429s per key and charge latency from the gateway and services, and Alertmanager pages on-call before merchants notice.',
    ],
    diagram: diagram(
      [
        ['dashboard', 'web-app', 'Merchant Dashboard', 0, 80, { tech: 'react' }],
        ['sdk', 'mobile-app', 'Mobile SDK', 0, 220, { tech: 'react-native', notes: 'Sends Idempotency-Key on every POST' }],
        ['merchants', 'external', 'Merchant Servers', 0, 360, { tech: 'generic-api', notes: 'Call the REST API with their secret key' }],
        ['limits', 'cache', 'Rate-limit Counters', 260, 60, { tech: 'redis', notes: 'Per-key counters (rate-limiting plugin, policy: redis)' }],
        ['gw', 'api-gateway', 'API Gateway', 260, 220, { tech: 'kong', notes: 'Per-key + per-route limits; /reports sheds first' }],
        ['accounts', 'service', 'Accounts & Keys', 560, 0, { tech: 'go', domains: ['merchants'], notes: 'Syncs API keys + plans into Kong consumers' }],
        ['charges', 'service', 'Charges', 560, 220, { tech: 'go', domains: ['charges'] }],
        ['reporting', 'service', 'Reporting', 560, 440, { tech: 'go', domains: ['reporting'] }],
        ['acquirer', 'external', 'Acquirer', 860, 110, { tech: 'card-network' }],
        ['bus', 'broker', 'Charge Events', 860, 330, { tech: 'kafka' }],
        ['hooks', 'worker', 'Webhook Worker', 860, 560, { tech: 'go', domains: ['webhooks'], notes: 'Signs payloads; never retries in place' }],
        ['accountsDb', 'relational-db', 'Accounts DB', 1120, 0, { tech: 'postgres' }],
        ['chargesDb', 'relational-db', 'Charges DB', 1120, 220, { tech: 'postgres', notes: 'idempotency_keys: UNIQUE(merchant_id, key), stored response' }],
        ['reports', 'analytics-db', 'Reports Store', 1120, 440, { tech: 'clickhouse' }],
        ['dlq', 'broker', 'Retry + DLQ Topics', 1120, 680, { tech: 'kafka', notes: 'webhooks.retry.1m / .1h / .6h → webhooks.dlq' }],
        ['endpoints', 'external', 'Merchant Webhook Endpoints', 1380, 560, { tech: 'generic-api' }],
        ['prom', 'metrics', 'Metrics', 0, 760, { tech: 'prometheus' }],
        ['alerts', 'alerting', 'On-call Alerts', 260, 760, { tech: 'alertmanager' }],
      ],
      [
        ['dashboard', 'gw'],
        ['sdk', 'gw'],
        ['merchants', 'gw', 'http', 'REST API'],
        ['gw', 'limits', 'data', 'per-key counters'],
        ['gw', 'accounts', 'http', 'key + plan'],
        ['gw', 'charges', 'http', 'POST /charges'],
        ['gw', 'reporting', 'http', '/reports (sheddable)'],
        ['accounts', 'accountsDb'],
        ['charges', 'chargesDb'],
        ['charges', 'acquirer', 'http', 'authorise'],
        ['charges', 'bus', 'event', 'charge.updated'],
        ['bus', 'reporting', 'event'],
        ['reporting', 'reports'],
        ['bus', 'hooks', 'event'],
        ['hooks', 'endpoints', 'http', 'signed webhook'],
        ['hooks', 'dlq', 'event', 'retry / dead-letter'],
        ['gw', 'prom', 'telemetry'],
        ['charges', 'prom', 'telemetry'],
        ['reporting', 'prom', 'telemetry'],
        ['prom', 'alerts', 'telemetry'],
      ],
    ),
  },
}

import type { DiagramNode, Scenario } from '../../engine/types'
import type { Graph } from '../../engine/graph'
import { CLIENT_KINDS, COMPUTE_KINDS, DATA_KINDS, DB_KINDS } from '../../engine/graph'
import { diagram, kindIs, observability } from './builder'

const ids = (nodes: DiagramNode[]) => new Set(nodes.map((n) => n.id))

/**
 * Breadth-first search over non-telemetry edges that never passes through
 * `avoid` nodes, external partners or clients (they are only endpoints).
 */
function flowsTo(g: Graph, from: DiagramNode[], target: (n: DiagramNode) => boolean, avoid: Set<string>, maxDepth = 6): boolean {
  const seen = new Set(from.map((f) => f.id))
  let frontier = from.map((f) => f.id)
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const e of g.out(id)) {
        if (e.protocol === 'telemetry') continue
        const t = g.node(e.target)
        if (!t || seen.has(t.id) || avoid.has(t.id)) continue
        seen.add(t.id)
        if (target(t)) return true
        if (t.kind !== 'external' && !CLIENT_KINDS.includes(t.kind)) next.push(t.id)
      }
    }
    frontier = next
  }
  return false
}

/** Hops an outbound partner call may pass through (egress proxy, partner gateway, WAF). */
const EGRESS_HOPS: DiagramNode['kind'][] = ['api-gateway', 'load-balancer', 'waf']

/** Does `from` call an external partner over HTTP/gRPC, directly or via an egress hop? */
function callsPartner(g: Graph, from: DiagramNode[]): boolean {
  return !!g.reaches(from, kindIs('external'), { through: EGRESS_HOPS, protocols: ['http', 'grpc'], maxDepth: 3 })
}

export const mobilePayScheme: Scenario = {
  id: 'kodpay-scheme',
  title: 'KodPay: a national 6-digit mobile payment scheme',
  tagline: 'Twelve banks, 100,000 merchants, one 6-digit code. Two seconds to say yes — and never lose a złoty.',
  industry: 'Banking & Fintech',
  difficulty: 'advanced',
  estMinutes: 55,
  accent: '#dc2626',
  concepts: ['idempotency', 'double-entry-ledger', 'event-driven', 'circuit-breaker', 'stream-processing', 'dead-letter-queue', 'rate-limiting'],
  story:
    'KodPay is the payment scheme jointly owned by twelve Polish banks: shoppers open their banking app, get a 6-digit code, type it at checkout and approve the payment on their phone. The pilot ran as a single Java application on one PostgreSQL database — and at last year’s Black Friday rehearsal it froze at 90 TPS while expired codes piled up in a table nobody cleaned. This year KodPay goes national: 100,000 online merchants connected through their payment gateways, 300 payments per second at the peak and a contractual 99.99% availability. The regulator insists that no customer personal data is stored centrally, and the banks want interbank settlement several times a day without ever slowing a checkout. The banks’ CTOs review your target architecture on Monday — one bad answer and the launch slips a year.',
  facts: [
    { label: 'Participants', value: '12 issuing banks, 9 acquirers, 100k online merchants' },
    { label: 'Volume', value: '8M payments/day avg, 300 TPS peak (Black Friday)' },
    { label: 'Latency & SLA', value: 'Result < 2 s after approval, 99.99% (≈ 4 min/month)' },
    { label: 'Team', value: '30 engineers in 5 squads, Go & Java' },
  ],
  functional: [
    'An issuing bank requests a 6-digit code for its shopper; codes are unique and expire after 120 seconds',
    'The acquirer sends code + amount from the merchant checkout; the scheme resolves the code to its issuing bank',
    'The issuing bank pushes the payment to the shopper’s app; the shopper approves or declines within 60 seconds',
    'The acquirer receives a yes/no callback; late or duplicate bank answers never change a final result',
    'Every payment is fraud-scored before it is routed to the bank',
    'Interbank clearing & settlement runs several times a day from a double-entry ledger',
  ],
  nonFunctional: [
    'Merchant gets the result < 2 s after approval; code lookup + fraud scoring < 150 ms',
    '99.99% availability — one slow or failing bank must not affect payments of the other eleven',
    '300 TPS peak; a misbehaving partner cannot overload the scheme',
    'No customer PII stored centrally — only opaque issuer tokens',
    'Every payment traceable end-to-end; SLO burn alerts page on-call',
  ],
  constraints: [
    'Partners connect over mutual TLS with certificates issued by the scheme',
    'Clearing & settlement must stay off the authorisation hot path',
    'Banks and acquirers are external systems — you define the APIs they call and the callbacks/webhooks you send to them, not their internals',
  ],
  domains: [
    { id: 'codes', label: 'Code registry', description: 'Issue 6-digit codes, map them to an opaque issuer token, expire after 120 s' },
    { id: 'authorization', label: 'Authorisation switch', description: 'Resolve the code, route to the issuer, run each payment’s state machine' },
    { id: 'fraud', label: 'Fraud scoring', description: 'Inline risk score with fallback rules' },
    { id: 'result-delivery', label: 'Result delivery', description: 'Deliver yes/no to acquirers via webhooks with retries' },
    { id: 'settlement', label: 'Clearing & settlement', description: 'Double-entry ledger, net positions, settlement batches' },
  ],
  recommendedStyles: ['event-driven', 'microservices'],
  styleFeedback: {
    'event-driven':
      'Best fit: the shopper’s approval arrives up to 60 s later as a callback, and webhooks, fraud features and settlement all react to the same decision events — events are the natural shape of a payment scheme.',
    microservices:
      'Good fit: the 99.99% authorisation path must scale and deploy independently of settlement batches and webhook retries. Just make sure post-decision work flows over events, not more synchronous calls.',
    'modular-monolith':
      'Clean modules help, but one deployable couples the 99.99% authorisation path to settlement batches and webhook retries — one bad release or GC pause stops payments for the whole country.',
    monolith:
      'The pilot monolith already froze at 90 TPS. A national scheme for 12 banks needs isolated failure domains and independent scaling of the hot path.',
    serverless:
      'Tempting for the Black Friday spike, but cold starts that pay a fresh mTLS handshake to the bank, connection pools that reset whenever instances scale out, and 60-second stateful payment flows put the < 2 s, 99.99% path at risk. Functions fit peripheral jobs such as webhook delivery.',
    'service-based':
      'Coarse services over a shared database couple the 99.99% authorisation path to settlement batches through one store — a heavy clearing query becomes a slow payment. The hot path needs its own data and failure domain.',
    'space-based':
      '300 TPS is not the extreme concurrency a data grid exists for, and write-behind persistence is the wrong trade-off for money: the final yes/no and the ledger entry must be durable before you answer.',
    microkernel:
      'A switch core with one adapter plug-in per bank is a sound internal design for bank connectivity, but as the system style it would run fraud, result delivery and settlement in the same process as authorisation.',
  },
  hints: [
    'Start with the partners: acquirers and issuing banks are Third-party API nodes, and both enter through one hardened partner gateway (mTLS, rate limits per partner).',
    'A code lives for 120 seconds and is read once or twice — that is a key with a TTL in an in-memory store, not a table row. Store only an opaque issuer token, never the shopper’s name or account number.',
    'The shopper may need 60 seconds to approve. Don’t hold anything open: persist each payment as a state machine (CREATED → PENDING → APPROVED / DECLINED / EXPIRED) and accept the bank’s answer as a separate callback — idempotently, keyed by payment id.',
    'Score fraud inline with a hard timeout (≈ 50 ms) and rule-based fallback, reading features from a low-latency store. Keep those features fresh with a stream processor over the payment events.',
    'Publish every final decision as an event (Kafka). A webhook dispatcher calls acquirers back with retries and a dead-letter topic, and clearing & settlement consumes the same events into a double-entry ledger in PostgreSQL.',
  ],
  checks: [
    {
      id: 'partner-gateway',
      title: 'Partners enter through a rate-limited partner gateway',
      category: 'core',
      why: 'Banks and acquirers are untrusted networks. One partner gateway terminates mutual TLS, authenticates each participant and enforces per-partner rate limits, so a buggy acquirer retry loop cannot take the scheme down for everyone.',
      hint: 'Model acquirers and issuing banks as Third-party API nodes and connect them to an API gateway (Kong, Envoy, Apigee…), optionally behind a WAF or load balancer.',
      concepts: ['api-gateway', 'rate-limiting'],
      test: (g) => {
        const partners = g.ofKind('external')
        if (!partners.length) return { pass: false, detail: 'Model the acquirers and issuing banks as Third-party API nodes.' }
        const inbound = partners.filter((p) => g.targets(p.id).some((t) => t.kind !== 'external' && !CLIENT_KINDS.includes(t.kind)))
        if (!inbound.length) return { pass: false, detail: 'No partner sends anything into the scheme — draw the acquirer and bank calls.' }
        const bypass = inbound.filter((p) =>
          g.targets(p.id).some((t) => COMPUTE_KINDS.includes(t.kind) || DATA_KINDS.includes(t.kind) || t.kind === 'broker'),
        )
        if (bypass.length) return { pass: false, detail: `${bypass.map((p) => p.label).join(', ')} call internal components directly, bypassing the partner gateway.` }
        const missing = inbound.filter((p) => !g.reaches(p, kindIs('api-gateway'), { through: ['waf', 'load-balancer', 'cdn'], maxDepth: 3 }))
        if (missing.length) return { pass: false, detail: `${missing.map((p) => p.label).join(', ')} never reach an API gateway.` }
        // Dedicated gateways advertise 'rate-limiting'; reverse proxies (NGINX limit_req keyed on the
        // client-certificate DN, HAProxy stick-tables) rate-limit per partner just as well.
        const gws = g.ofKind('api-gateway')
        return gws.some((gw) => !gw.tech || g.hasTrait(gw, 'rate-limiting', 'reverse-proxy'))
          ? true
          : { pass: false, detail: 'The chosen gateway technology has no per-partner rate limiting.' }
      },
    },
    {
      id: 'code-registry-ttl',
      title: 'Codes live in an in-memory store with TTL',
      category: 'core',
      why: 'A code exists for 120 seconds and is read once or twice. An in-memory key with a TTL (Redis SET NX EX 120) gives uniqueness and automatic expiry in microseconds — a table of 8M short-lived rows a day needs cleanup jobs and becomes the hottest index in the scheme.',
      hint: 'Connect the Code registry owner to a Cache (Redis / Valkey) and store code → opaque issuer token only.',
      concepts: ['caching'],
      test: (g) => {
        const fam = g.ownerFamily('codes')
        if (!fam.length) return { pass: false, detail: 'Nobody owns the code registry.' }
        const caches = g.storesOf(fam, ['cache'])
        if (!caches.length) {
          const others = g.storesOf(fam)
          return { pass: false, detail: others.length ? `Codes are kept in ${others.map((s) => s.label).join(', ')} — use a TTL key-value store.` : 'The code registry has no store.' }
        }
        return caches.some((c) => !c.tech || g.hasTrait(c, 'ttl')) ? true : { pass: false, detail: 'Choose a cache technology that supports TTL expiry.' }
      },
    },
    {
      id: 'issuer-roundtrip',
      title: 'Switch routes to the issuer, gets its answer back and keeps durable payment state',
      category: 'core',
      why: 'The shopper needs up to 60 s to approve, so the switch must not hold a call open: it sends the request to the issuing bank, records the payment as PENDING and returns; the bank’s decision arrives later as a separate callback or event. Persisting each payment as a state machine in a durable database makes duplicate or late callbacks idempotent — an EXPIRED payment can never flip to APPROVED — and survives a node failover. Wrap every bank call in a timeout and a per-bank circuit breaker so one slow bank cannot exhaust the switch.',
      hint: 'Authorisation switch → issuing bank, issuing bank → gateway → switch (the decision callback), and switch → a database holding each payment’s state (not the codes cache).',
      concepts: ['idempotency', 'circuit-breaker'],
      test: (g) => {
        const auth = g.ownerFamily('authorization')
        if (!auth.length) return { pass: false, detail: 'Nobody owns the authorisation switch.' }
        const authIds = ids(auth)
        // Paths through webhook delivery or settlement are not the issuer route.
        const avoid = new Set(
          [...g.ownerFamily('result-delivery'), ...g.ownerFamily('settlement')].map((n) => n.id).filter((id) => !authIds.has(id)),
        )
        // Issuers are the partners the switch itself routes to; who else (e.g. webhook delivery) calls them is irrelevant.
        const issuers = g.ofKind('external').filter((x) => flowsTo(g, auth, (n) => n.id === x.id, avoid))
        if (!issuers.length) return { pass: false, detail: 'The switch never reaches an issuing bank.' }
        if (!issuers.some((x) => flowsTo(g, [x], (n) => authIds.has(n.id), avoid)))
          return { pass: false, detail: 'The bank’s approval has no way back to the switch — add a callback (via the gateway or an event).' }
        if (g.storesOf(auth, DB_KINDS).length) return true
        const caches = g.storesOf(auth, ['cache'])
        return {
          pass: false,
          detail: caches.length
            ? `Payment state only lives in ${caches.map((c) => c.label).join(', ')} — a failover or eviction loses PENDING payments. Keep it in a durable database.`
            : 'The switch keeps no payment state — callbacks cannot be matched or deduplicated.',
        }
      },
    },
    {
      id: 'fraud-inline',
      title: 'Inline fraud scoring on a low-latency feature store',
      category: 'core',
      why: 'Fraud must be decided before the payment reaches the bank, within a tight budget. The switch calls the scorer synchronously with a strict timeout (~50 ms) and a rule-based fallback; a circuit breaker stops calling the model at all once it keeps timing out, so every payment falls straight to the rules until it recovers. Scoring reads precomputed features from a millisecond-latency store rather than querying history on the fly.',
      hint: 'Switch → Fraud (gRPC) and Fraud → a Cache / wide-column / key-value feature store.',
      concepts: ['circuit-breaker'],
      test: (g) => {
        const fraud = g.ownerFamily('fraud')
        if (!fraud.length) return { pass: false, detail: 'Nobody owns fraud scoring.' }
        if (!g.storesOf(fraud, ['cache', 'wide-column', 'document-db']).length)
          return { pass: false, detail: 'Fraud has no low-latency feature store.' }
        const auth = g.ownerFamily('authorization')
        const fraudIds = ids(fraud)
        const inProcess = auth.some((a) => fraudIds.has(a.id))
        const called = g.calls(auth, (n) => fraudIds.has(n.id), ['http', 'grpc'])
        return inProcess || called
          ? true
          : { pass: false, detail: 'Fraud only sees payments after the fact — the switch must score inline before routing to the bank.' }
      },
    },
    {
      id: 'merchant-callback',
      title: 'Results reach acquirers asynchronously via callbacks',
      category: 'core',
      why: 'The acquirer cannot hold a connection open for up to 60 s. Once a payment is decided, an event triggers a webhook to the acquirer with retries — the switch stays fast and a slow acquirer only delays its own callbacks.',
      hint: 'Switch → broker → Result delivery (worker / function) → acquirer (webhook), optionally through an egress proxy or the partner gateway.',
      concepts: ['event-driven', 'idempotency'],
      test: (g) => {
        const delivery = g.ownerFamily('result-delivery')
        if (!delivery.length) return { pass: false, detail: 'Nobody owns result delivery.' }
        if (!g.asyncFlow(g.ownerFamily('authorization'), delivery))
          return { pass: false, detail: 'Result delivery is not fed by decision events from the switch.' }
        return callsPartner(g, delivery)
          ? true
          : { pass: false, detail: 'Result delivery never calls the acquirer back.' }
      },
    },
    {
      id: 'settlement-ledger',
      title: 'Settlement consumes events into a double-entry ledger',
      category: 'core',
      why: 'Interbank positions must balance to the grosz and be auditable, so every payment becomes balanced debit and credit entries in an ACID database. Because settlement runs a few times a day, it consumes decision events asynchronously — the hot path never waits for a ledger write.',
      hint: 'Broker → Clearing & settlement → Relational database (PostgreSQL) holding append-only entries.',
      concepts: ['double-entry-ledger', 'event-driven', 'acid-vs-base'],
      test: (g) => {
        const settle = g.ownerFamily('settlement')
        if (!settle.length) return { pass: false, detail: 'Nobody owns clearing & settlement.' }
        if (!g.storesOf(settle, ['relational-db']).length) return { pass: false, detail: 'The ledger needs an ACID relational database.' }
        return g.asyncFlow(g.ownerFamily('authorization'), settle)
          ? true
          : { pass: false, detail: 'Settlement is not fed by authorisation events.' }
      },
    },
    {
      id: 'fraud-features-stream',
      title: 'Fraud features updated from the event stream',
      category: 'bonus',
      why: 'Velocity features such as “payments per device in the last 10 minutes” must be fresh within seconds. A stream processor over the decision events maintains them continuously, so scoring reads one precomputed key instead of scanning history.',
      hint: 'Broker → Stream processor (Flink / Kafka Streams) → feature store, or broker → Fraud.',
      concepts: ['stream-processing'],
      test: (g) => {
        const fraud = g.ownerFamily('fraud')
        if (!fraud.length) return { pass: false, detail: 'Nobody owns fraud scoring.' }
        const stores = g.storesOf(fraud, ['cache', 'wide-column', 'document-db'])
        return g.asyncFlow(g.ownerFamily('authorization'), [...fraud, ...stores])
          ? true
          : { pass: false, detail: 'Fraud features are not fed by payment events.' }
      },
    },
    {
      id: 'replayable-backbone',
      title: 'Decision events are durable and replayable',
      category: 'bonus',
      why: 'If a settlement run fails or a bank disputes its position, you re-run it from the same events. A log-based broker (Kafka, Redpanda, Pulsar) retains history; classic queues delete messages once acknowledged.',
      hint: 'Pick Kafka / Redpanda / Pulsar for the event backbone.',
      concepts: ['kafka-vs-rabbitmq'],
      test: (g) => {
        const brokers = g.ofKind('broker')
        if (!brokers.length) return { pass: false, detail: 'No broker.' }
        return brokers.some((b) => g.hasTrait(b, 'replayable')) ? true : { pass: false, detail: 'Choose a broker with retention & replay.' }
      },
    },
    {
      id: 'webhook-dlq',
      title: 'Webhook retries with a dead-letter topic',
      category: 'bonus',
      why: 'Acquirer endpoints go down. Retrying with exponential backoff and parking undeliverable results in a dead-letter topic keeps one broken acquirer from blocking everyone else — and nothing is silently lost.',
      hint: 'Connect Result delivery → broker (retry / DLQ topics).',
      concepts: ['dead-letter-queue'],
      test: (g) => {
        const delivery = g.ownerFamily('result-delivery')
        if (!delivery.length) return { pass: false, detail: 'Nobody owns result delivery.' }
        return delivery.some((d) => g.targets(d.id, ['event']).some(kindIs('broker')))
          ? true
          : { pass: false, detail: 'Failed webhooks have nowhere to go for retry or dead-lettering.' }
      },
    },
    {
      id: 'slo-alerting',
      title: 'Tracing, SLO metrics and alerting',
      category: 'bonus',
      why: '99.99% leaves about four minutes of downtime a month. You need per-bank latency SLIs, error-budget burn alerts that page on-call, and traces that follow one payment from acquirer to bank and back.',
      hint: 'Instrument the switch and add Distributed tracing, a Metrics store and Alerting (ideally via an OTel collector).',
      concepts: ['slo', 'distributed-tracing'],
      test: (g) => {
        const obs = observability(g, 'tracing', 'metrics', 'alerting')
        if (!obs.pass) return obs
        const instrumented = ids(g.instrumented())
        return g.ownerFamily('authorization').some((a) => instrumented.has(a.id))
          ? true
          : { pass: false, detail: 'The authorisation switch exports no telemetry.' }
      },
    },
    {
      id: 'partner-pki',
      title: 'Partner mTLS certificates come from a vault',
      category: 'bonus',
      why: 'Every bank and acquirer authenticates with a client certificate. A secrets manager with a PKI issues, rotates and revokes them — revoking a compromised acquirer takes minutes, not a redeploy.',
      hint: 'Add a Secrets manager (Vault) and connect it to the partner gateway.',
      concepts: ['secrets-management'],
      test: (g) => g.ofKind('api-gateway').some((gw) => g.neighbours(gw.id).some(kindIs('secrets'))),
    },
    {
      id: 'anti-ledger-hot-path',
      title: 'Ledger writes are not on the authorisation hot path',
      category: 'antipattern',
      why: 'If the switch waits for a ledger posting (or shares a deployable with settlement), a slow settlement batch or ledger lock directly delays — or fails — live payments. Ledger work belongs behind the event stream.',
      hint: 'Remove synchronous calls from the switch to settlement and let settlement consume decision events instead.',
      concepts: ['double-entry-ledger', 'event-driven'],
      test: (g) => {
        const authOwners = ids(g.owners('authorization'))
        const both = g.owners('settlement').filter((s) => authOwners.has(s.id))
        if (both.length) return { pass: false, detail: `${both.map((b) => b.label).join(', ')} runs both authorisation and settlement.` }
        const auth = g.ownerFamily('authorization')
        const authIds = ids(auth)
        const settle = g.ownerFamily('settlement').filter((s) => !authIds.has(s.id))
        const settleIds = ids(settle)
        if (g.calls(auth, (n) => settleIds.has(n.id), ['http', 'grpc', 'graphql']))
          return { pass: false, detail: 'The switch calls settlement synchronously on every payment.' }
        const ledgerIds = ids(g.storesOf(settle, ['relational-db']))
        return g.calls(auth, (n) => ledgerIds.has(n.id), ['data'])
          ? { pass: false, detail: 'The switch writes to the ledger database directly.' }
          : true
      },
    },
  ],
  inspiration: [
    {
      label: 'ITwiz — BLIK on building an extremely reliable, data-driven payment system (PL)',
      url: 'https://itwiz.pl/blik-o-budowaniu-ekstremalnie-niezawodnego-data%E2%80%91driven-systemu-platnosci/',
    },
    {
      label: 'Money.pl — 300 transactions per second: how Poles built Europe’s biggest player (PL)',
      url: 'https://www.money.pl/biznes-klasa/300-transakcji-na-sekunde-jak-polacy-zbudowali-najwiekszego-gracza-w-europie-7304644608238145v.html',
    },
    { label: 'Stripe — How we built Radar (real-time fraud scoring)', url: 'https://stripe.dev/blog/how-we-built-it-stripe-radar' },
  ],
  reference: {
    decisions: {
      style: 'event-driven',
      communication: 'hybrid',
      data: 'per-service',
      stack: { frontend: 'nextjs', mobile: 'flutter', backend: 'go', database: 'postgres', messaging: 'kafka', cache: 'redis' },
      rationale:
        'Only code lookup and fraud scoring are synchronous, each behind a strict timeout. The bank’s approval comes back as a callback into an idempotent state machine, and every decision is published through an outbox to Kafka, which feeds webhooks, fraud features and the settlement ledger off the hot path.',
    },
    walkthrough: [
      'Banks and acquirers connect over mTLS to a Kong partner gateway that authenticates each participant with Vault-issued certificates and rate-limits per partner. The shoppers’ apps and merchant checkouts never talk to KodPay directly — they talk to their bank and their payment gateway.',
      'The Code registry issues a 6-digit code with Redis SET NX EX 120, mapping it to an opaque issuer token — no names or account numbers are ever stored centrally.',
      'The authorisation switch (Go) resolves the code, scores fraud inline with a 50 ms timeout and rule-based fallback, then pushes the request to the issuing bank behind a per-bank circuit breaker. The payment is stored as a state machine in PostgreSQL; the bank’s approval callback is a conditional update (PENDING → APPROVED), so duplicates and post-expiry answers are no-ops.',
      'State changes and an outbox row commit in one transaction; Debezium publishes them to Kafka. A webhook dispatcher calls the acquirer back within the 2-second budget through an egress proxy with static IPs and the scheme’s client certificate, retrying with backoff and parking failures on a dead-letter topic.',
      'Flink turns the same stream into velocity features in Valkey for the fraud model, while Clearing & settlement (Spring Boot) books balanced double-entry postings in its own PostgreSQL and sends net positions to the interbank clearing house several times a day.',
      'Every component exports OTLP to a collector; Tempo traces one payment end-to-end, Prometheus tracks per-bank latency SLIs and Alertmanager pages on error-budget burn.',
    ],
    diagram: diagram(
      [
        ['bankApp', 'mobile-app', 'Bank Mobile App', 0, 0, { tech: 'flutter' }],
        ['issuer', 'external', 'Issuing Banks (12)', 0, 110, { tech: 'generic-api' }],
        ['checkout', 'web-app', 'Merchant Checkout', 0, 300, { tech: 'nextjs' }],
        ['acquirer', 'external', 'Acquirers / Payment Gateways', 0, 410, { tech: 'payu' }],
        ['gw', 'api-gateway', 'Partner Gateway (mTLS)', 260, 200, { tech: 'kong' }],
        ['vault', 'secrets', 'Partner PKI', 260, 400, { tech: 'vault' }],
        ['egress', 'load-balancer', 'Egress Proxy (static IPs)', 260, 520, { tech: 'envoy', notes: 'Outbound webhooks with scheme client certs' }],
        ['codes', 'service', 'Code Registry', 520, 0, { tech: 'go', domains: ['codes'] }],
        ['switch', 'service', 'Authorisation Switch', 520, 170, { tech: 'go', domains: ['authorization'], notes: 'Per-bank circuit breakers & timeouts' }],
        ['fraud', 'service', 'Fraud Scoring', 520, 340, { tech: 'go', domains: ['fraud'], notes: '50 ms budget, rule-based fallback' }],
        ['codeCache', 'cache', 'Codes (TTL 120 s)', 800, 0, { tech: 'redis', notes: 'code → issuer token, no PII' }],
        ['stateDb', 'relational-db', 'Payment State + Outbox', 800, 170, { tech: 'postgres' }],
        ['features', 'cache', 'Feature Store', 800, 340, { tech: 'valkey' }],
        ['relay', 'cdc', 'Outbox Relay', 1060, 170, { tech: 'debezium' }],
        ['flink', 'stream-processor', 'Feature Pipeline', 1060, 340, { tech: 'flink' }],
        ['kafka', 'broker', 'Decision Events', 1320, 170, { tech: 'kafka' }],
        ['delivery', 'worker', 'Webhook Dispatcher', 1320, 520, { tech: 'go', domains: ['result-delivery'] }],
        ['settlement', 'service', 'Clearing & Settlement', 1580, 300, { tech: 'spring-boot', domains: ['settlement'] }],
        ['clearing', 'external', 'Interbank Clearing House', 1840, 180, { tech: 'generic-api' }],
        ['ledgerDb', 'relational-db', 'Double-entry Ledger', 1840, 300, { tech: 'postgres', notes: 'Append-only entries; debits = credits' }],
        ['otel', 'otel-collector', 'OTel Collector', 260, 680, { tech: 'otel-collector' }],
        ['tempo', 'tracing', 'Traces', 520, 680, { tech: 'tempo' }],
        ['prom', 'metrics', 'SLO Metrics', 800, 680, { tech: 'prometheus' }],
        ['alerts', 'alerting', 'On-call Alerts', 1060, 680, { tech: 'alertmanager' }],
      ],
      [
        ['bankApp', 'issuer', 'http', 'get code / approve'],
        ['checkout', 'acquirer', 'http', 'pay with code'],
        ['issuer', 'gw', 'http', 'issue code · decision callback'],
        ['acquirer', 'gw', 'http', 'code + amount'],
        ['gw', 'vault', 'data', 'mTLS certs'],
        ['gw', 'codes', 'http', 'issue code'],
        ['gw', 'switch', 'http', 'authorise · bank decision'],
        ['codes', 'codeCache', 'data', 'SET NX EX 120'],
        ['switch', 'codes', 'grpc', 'resolve code'],
        ['switch', 'fraud', 'grpc', 'score (50 ms timeout)'],
        ['switch', 'issuer', 'http', 'push to shopper’s bank'],
        ['switch', 'stateDb', 'data', 'state machine + outbox'],
        ['fraud', 'features', 'data'],
        ['stateDb', 'relay', 'event', 'outbox'],
        ['relay', 'kafka', 'event'],
        ['kafka', 'delivery', 'event', 'PaymentDecided'],
        ['delivery', 'egress', 'http', 'webhook + retries'],
        ['egress', 'acquirer', 'http', 'PaymentResult webhook'],
        ['delivery', 'kafka', 'event', 'retry / DLQ topics'],
        ['kafka', 'flink', 'event'],
        ['flink', 'features', 'data', 'velocity features'],
        ['kafka', 'settlement', 'event'],
        ['settlement', 'ledgerDb', 'data'],
        ['settlement', 'clearing', 'http', 'net positions'],
        ['gw', 'otel', 'telemetry'],
        ['codes', 'otel', 'telemetry'],
        ['switch', 'otel', 'telemetry'],
        ['fraud', 'otel', 'telemetry'],
        ['delivery', 'otel', 'telemetry'],
        ['settlement', 'otel', 'telemetry'],
        ['otel', 'tempo', 'telemetry'],
        ['otel', 'prom', 'telemetry'],
        ['prom', 'alerts', 'telemetry'],
      ],
    ),
  },
}

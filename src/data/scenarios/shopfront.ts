import { SYNC_PROTOCOLS, type Scenario } from '../../engine/types'
import { COMPUTE_KINDS } from '../../engine/graph'
import { diagram, EMAIL, external, kindIs, PAYMENT } from './builder'

export const shopfront: Scenario = {
  id: 'indie-shop',
  title: 'Indie Shop: launch an online store',
  tagline: 'Design a lean e-commerce platform a three-person team can actually run.',
  industry: 'E-commerce',
  difficulty: 'beginner',
  estMinutes: 20,
  accent: '#0ea5e9',
  concepts: ['modular-monolith', 'bounded-context', 'caching', 'cdn', 'background-jobs'],
  story:
    'Mila and two friends sell hand-made ceramics on Instagram. Orders arrive as DMs and payments are chased by hand. They raised a small seed round and want a real web shop within three months: browse products, add to cart, pay by card and receive a confirmation email. They are a tiny team with no dedicated ops person — but they hope to grow into a marketplace for other makers next year.',
  facts: [
    { label: 'Team', value: '3 full-stack developers' },
    { label: 'Traffic', value: '~5k daily visitors, spikes on launches' },
    { label: 'Catalog', value: '~2,000 products with photos' },
    { label: 'Budget', value: 'Small — managed services welcome' },
  ],
  functional: [
    'Customers browse the catalog and product pages',
    'Customers add items to a cart and check out',
    'Card payments through a payment provider (no card data stored)',
    'Order confirmation email after successful payment',
    'Staff manage products and orders through an admin area',
  ],
  nonFunctional: [
    'Product pages load fast worldwide (images!)',
    'Checkout must never lose an order once paid',
    'Low operational overhead — one deployable is ideal',
    'Codebase should allow extracting services later',
  ],
  constraints: ['No dedicated ops/SRE', 'PCI scope must stay minimal'],
  domains: [
    { id: 'catalog', label: 'Catalog', description: 'Products, categories, prices, images' },
    { id: 'cart', label: 'Cart', description: 'Shopping cart and session' },
    { id: 'orders', label: 'Orders', description: 'Checkout and order lifecycle' },
    { id: 'payments', label: 'Payments', description: 'Payment intents and provider webhooks' },
    { id: 'notifications', label: 'Notifications', description: 'Transactional emails' },
  ],
  recommendedStyles: ['modular-monolith', 'monolith'],
  styleFeedback: {
    'modular-monolith': 'Great fit: one deployable for a tiny team, with module boundaries that make a later extraction cheap.',
    monolith: 'Works for this size — just keep internal boundaries clean so it does not become a big ball of mud.',
    microservices: 'Over-engineered: 3 developers would spend their time on deployment pipelines, network failures and distributed data instead of the shop.',
    'event-driven': 'Event-driven microservices bring brokers, eventual consistency and many deployables — too much for a 3-person team.',
    serverless: 'Possible, but splitting checkout across many functions makes the core flow hard to reason about and test for this team.',
  },
  hints: [
    'Start with one Application container and drop Modules inside it for each capability.',
    'Static images are the heaviest part of the page — what sits between the browser and those files?',
    'Never handle raw card numbers: delegate to a payment provider and react to its webhooks.',
    'Sending an email should not block checkout. Hand it to a background worker through a simple queue.',
    'Kafka is a fantastic tool… for a different team. A DB-backed queue or RabbitMQ is plenty here.',
  ],
  checks: [
    {
      id: 'web-entry',
      title: 'Customers reach the backend through a web frontend',
      category: 'core',
      why: 'The storefront is the product. It should call your backend API — directly or via a load balancer — never the database.',
      hint: 'Add a Web app and connect it to your Application (optionally through a Load balancer).',
      test: (g) => {
        const web = g.ofKind('web-app')
        if (!web.length) return { pass: false, detail: 'No web app on the canvas.' }
        return !!g.reaches(web, kindIs(...COMPUTE_KINDS), { through: ['cdn', 'load-balancer', 'api-gateway', 'waf'] })
      },
    },
    {
      id: 'orders-relational',
      title: 'Orders are stored in a relational database',
      category: 'core',
      why: 'Orders, payments and stock updates need ACID transactions. A relational database (PostgreSQL, MySQL) is the boring, correct default.',
      hint: 'Connect whatever owns Orders to a Relational database with a "Data" edge.',
      concepts: ['acid-vs-base'],
      test: (g) => g.storesOf(g.ownerFamily('orders'), ['relational-db']).length > 0,
    },
    {
      id: 'payment-provider',
      title: 'Payments are delegated to a payment provider',
      category: 'core',
      why: 'Using Stripe/Adyen hosted checkout keeps card data out of your systems, shrinking PCI-DSS scope to almost nothing.',
      hint: 'Add a Third-party API, choose Stripe/Adyen/PayPal, and connect the Payments owner to it.',
      test: (g) => g.calls(g.ownerFamily('payments'), external(g, 'payment', PAYMENT)),
    },
    {
      id: 'async-email',
      title: 'Confirmation emails are sent asynchronously',
      category: 'core',
      why: 'If the email provider is slow or down, checkout must still succeed. A background job with retries decouples the two.',
      hint: 'Orders → queue → worker that owns Notifications → email provider (SendGrid / SES).',
      concepts: ['background-jobs', 'event-driven'],
      test: (g) => {
        const notif = g.ownerFamily('notifications')
        const orders = g.ownerFamily('orders')
        const orderIds = new Set(orders.map((o) => o.id))
        // A worker only decouples if checkout doesn't call it synchronously.
        const calledSync = notif.some((n) => g.sources(n.id, SYNC_PROTOCOLS).some((s) => orderIds.has(s.id)))
        const decoupled = g.asyncFlow(orders, notif) || (!calledSync && notif.some((n) => n.kind === 'worker' || n.kind === 'function'))
        const sends = g.calls(notif, external(g, 'email', EMAIL))
        if (!decoupled) return { pass: false, detail: 'Email sending is on the checkout request path.' }
        if (!sends) return { pass: false, detail: 'Nothing sends to an email provider.' }
        return true
      },
    },
    {
      id: 'cdn',
      title: 'Static assets & images served via a CDN',
      category: 'bonus',
      why: 'A CDN caches images and JS bundles at the edge — faster pages worldwide and far less load on your app.',
      hint: 'Add a CDN and connect the Web app to it.',
      concepts: ['cdn'],
      test: (g) => g.clientPathHas('cdn'),
    },
    {
      id: 'catalog-cache',
      title: 'Catalog reads are cached',
      category: 'bonus',
      why: 'Catalog pages are read thousands of times more often than they change — the textbook cache-aside case.',
      hint: 'Connect the Catalog owner to a Cache (Redis) with a Data edge.',
      concepts: ['caching'],
      test: (g) => g.storesOf(g.ownerFamily('catalog'), ['cache']).length > 0,
    },
    {
      id: 'basic-observability',
      title: 'Logs and metrics are collected',
      category: 'bonus',
      why: 'Even a small shop needs to know when checkout errors spike. Centralised logs + a few metrics are the minimum.',
      hint: 'Add Log aggregation and a Metrics store and connect the app with Telemetry edges.',
      concepts: ['observability'],
      test: (g) => g.has('logging') && g.has('metrics'),
    },
    {
      id: 'right-sized',
      title: 'Tooling is right-sized for the team',
      category: 'bonus',
      why: 'Operating a Kafka cluster is a job on its own. For a few emails per minute, a DB-backed queue or a managed queue is the pragmatic choice.',
      hint: 'Prefer RabbitMQ, a managed queue (SQS) or a DB-backed job queue over Kafka/Pulsar here.',
      test: (g) => {
        const heavy = g.ofKind('broker').filter((b) => g.hasTrait(b, 'log'))
        return { pass: heavy.length === 0, detail: heavy.length ? `${heavy.map((h) => h.label).join(', ')} is heavy for this team.` : undefined }
      },
    },
  ],
  reference: {
    decisions: {
      style: 'modular-monolith',
      communication: 'hybrid',
      data: 'shared',
      stack: { frontend: 'react', backend: 'spring-boot', database: 'postgres', messaging: 'db-queue', cache: 'redis' },
      rationale: 'One Spring Boot application with Spring Modulith modules; one PostgreSQL with a schema per module. Emails via a DB-backed job queue.',
    },
    walkthrough: [
      'A single Spring Boot application split into modules (Catalog, Cart, Orders, Payments). Modules talk through public APIs and in-process events — boundaries are enforced, deployment stays trivial.',
      'One PostgreSQL instance, but each module owns its own schema. No cross-module joins: that keeps future extraction possible.',
      'Stripe hosted checkout keeps card data away; Stripe webhooks hit the Payments module, which marks the order paid.',
      'The Orders module enqueues a job in a DB-backed queue in the same transaction as the order (a mini outbox). A worker sends the email via SendGrid with retries.',
      'Cloudflare caches images and the React bundle; Redis caches hot catalog pages and stores carts.',
    ],
    diagram: diagram(
      [
        ['web', 'web-app', 'Storefront', 0, 200, { tech: 'react' }],
        ['cdn', 'cdn', 'CDN', 260, 40, { tech: 'cloudflare' }],
        ['lb', 'load-balancer', 'Load Balancer', 260, 200, { tech: 'nginx' }],
        ['app', 'monolith', 'Shop Application', 520, 60, { tech: 'spring-boot', w: 500, h: 330 }],
        ['catalog', 'module', 'Catalog', 30, 60, { parent: 'app', tech: 'spring-boot', domains: ['catalog'] }],
        ['cart', 'module', 'Cart', 270, 60, { parent: 'app', tech: 'spring-boot', domains: ['cart'] }],
        ['orders', 'module', 'Orders', 30, 200, { parent: 'app', tech: 'spring-boot', domains: ['orders'] }],
        ['payments', 'module', 'Payments', 270, 200, { parent: 'app', tech: 'spring-boot', domains: ['payments'] }],
        ['pg', 'relational-db', 'Shop DB', 1120, 120, { tech: 'postgres', notes: 'Schema per module' }],
        ['redis', 'cache', 'Cache', 1120, 0, { tech: 'redis' }],
        ['stripe', 'external', 'Stripe', 1120, 260, { tech: 'stripe' }],
        ['queue', 'broker', 'Job Queue', 780, 470, { tech: 'db-queue' }],
        ['mailer', 'worker', 'Email Worker', 1040, 470, { tech: 'spring-boot', domains: ['notifications'] }],
        ['sendgrid', 'external', 'SendGrid', 1300, 470, { tech: 'sendgrid' }],
        ['logs', 'logging', 'Logs', 520, 600, { tech: 'loki' }],
        ['metrics', 'metrics', 'Metrics', 780, 600, { tech: 'prometheus' }],
      ],
      [
        ['web', 'cdn'],
        ['web', 'lb'],
        ['lb', 'app'],
        ['catalog', 'redis'],
        ['catalog', 'pg'],
        ['cart', 'redis'],
        ['orders', 'pg'],
        ['payments', 'pg'],
        ['payments', 'stripe', 'http', 'checkout session'],
        ['orders', 'queue', 'event', 'enqueue email'],
        ['queue', 'mailer', 'event'],
        ['mailer', 'sendgrid', 'http'],
        ['app', 'logs', 'telemetry'],
        ['app', 'metrics', 'telemetry'],
        ['mailer', 'logs', 'telemetry'],
      ],
    ),
  },
}

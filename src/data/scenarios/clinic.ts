import { SYNC_PROTOCOLS, type ComponentKind, type DiagramNode, type Scenario } from '../../engine/types'
import { CLIENT_KINDS, COMPUTE_KINDS, DB_KINDS, type Graph } from '../../engine/graph'
import { diagram, EMAIL, external, kindIs } from './builder'

/** SMS gateways — label fallback when no tech with the `sms` trait is chosen. */
const SMS = /sms|twilio|vonage|nexmo|messagebird|plivo|sinch|smsapi|serwer\s?sms/i

const EDGE_KINDS: ComponentKind[] = ['cdn', 'waf', 'load-balancer', 'api-gateway', 'bff']

/** Document stores whose unique indexes / conditional writes can reject a second claim on the same slot. */
const CONDITIONAL_WRITE_TECH = ['mongodb', 'dynamodb', 'cosmosdb', 'firestore']

/** Nodes that own a domain plus their children — but not their container, so a monolith is not blamed for its modules. */
function ownersAndChildren(g: Graph, domain: string): DiagramNode[] {
  const out = new Map<string, DiagramNode>()
  for (const o of g.owners(domain)) {
    out.set(o.id, o)
    for (const c of g.children(o.id)) out.set(c.id, c)
  }
  return [...out.values()]
}

const isSms = (g: Graph) => external(g, 'sms', SMS)
const isEmail = (g: Graph) => external(g, 'email', EMAIL)
const isProvider = (g: Graph) => (n: DiagramNode) => isSms(g)(n) || isEmail(g)(n)
const isBroker = (n: DiagramNode) => n.kind === 'broker' || n.kind === 'cdc'
const labels = (ns: DiagramNode[]) => ns.map((n) => n.label).join(', ')

export const clinicBooking: Scenario = {
  id: 'medislot-booking',
  title: 'MediSlot: book a doctor in two taps',
  tagline: 'A doctor-booking marketplace where two patients must never get the same slot.',
  industry: 'HealthTech',
  difficulty: 'beginner',
  estMinutes: 25,
  accent: '#06b6d4',
  concepts: ['modular-monolith', 'concurrency-control', 'background-jobs', 'search-indexing', 'caching', 'oauth-oidc'],
  story:
    'MediSlot started in Kraków as a spreadsheet of private clinics that still booked visits by phone. Today patients across Poland want to search for a cardiologist in Gdańsk, see free slots and book in two taps, while clinics juggle calendars in a web panel. Last winter a TV report on the flu season sent traffic up 7× in an hour, and the old PHP prototype double-booked forty visits; two patients showing up for the same 9:00 slot made national news. The investors gave the 8-person team one quarter to rebuild the core before the next flu season. Health data is involved, so GDPR auditors will read your design too.',
  facts: [
    { label: 'Team', value: '8 developers in 2 product teams' },
    { label: 'Traffic', value: '~30k bookings/day, 7× spikes when health news breaks' },
    { label: 'Directory', value: '15,000 doctors in 2,400 clinics, ~3M slots per month' },
    { label: 'SLA', value: 'Search p95 < 300 ms, 99.9% booking availability' },
  ],
  functional: [
    'Patients search doctors by specialty, city and insurance',
    'Patients see free slots and book a visit in two taps',
    'Clinic staff manage doctors, opening hours and calendars in a web panel',
    'SMS and email reminders are sent 24 hours before every visit',
    'Patients can cancel, which frees the slot for others',
  ],
  nonFunctional: [
    'Two patients must NEVER be confirmed for the same slot',
    'Survive 7× traffic spikes without the booking path falling over',
    'Search results feel instant; availability may be seconds stale, bookings may not',
    'A slow SMS gateway must never slow down or fail a booking',
    'Health data is GDPR special-category data: hosted in the EU and shared with providers only as far as needed',
  ],
  constraints: ['No dedicated ops team — keep the number of deployables small', 'Clinic staff sign in with company accounts (SSO, MFA)', 'Budget for managed services, not for a platform team'],
  domains: [
    { id: 'directory', label: 'Doctor directory & search', description: 'Doctor profiles, specialties, cities, search' },
    { id: 'availability', label: 'Calendar & availability', description: 'Opening hours, slots, free/busy view' },
    { id: 'booking', label: 'Booking', description: 'Claiming a slot, confirmations, cancellations' },
    { id: 'notifications', label: 'Reminders', description: 'SMS and email reminders before visits' },
    { id: 'clinic-admin', label: 'Clinic admin', description: 'Clinic panel, staff accounts, doctor management' },
  ],
  recommendedStyles: ['modular-monolith', 'monolith'],
  styleFeedback: {
    'modular-monolith':
      'Best fit: two product teams can own clear modules (directory, availability, booking, admin) in one deployable, and one relational database makes the "one slot, one patient" rule a simple transaction.',
    monolith:
      'A reasonable choice for 8 developers — just keep booking, availability and directory code separated so both teams do not trip over each other, and run reminders as background jobs.',
    microservices:
      'Over-engineered: splitting availability and booking into services turns a single database transaction into a distributed consistency problem, and 8 developers would spend the quarter on pipelines instead of fixing double bookings.',
    'event-driven':
      'Events are useful for reminders and search indexing, but making the whole system event-driven makes the booking decision eventually consistent — exactly where MediSlot needs an immediate, strongly consistent answer.',
    serverless:
      'Functions could send reminders, but scattering the booking flow across functions makes transactions and connection pooling to the database hard during 7× spikes, and cold starts hurt the search latency target.',
  },
  hints: [
    'Two teams, one quarter: start with one Application container and a Module per capability.',
    'Where is the single source of truth for "Dr Nowak, 9:00 is taken"? During a 7× spike a cache can absorb the availability reads — but should it decide who gets the slot?',
    'Two patients press "Book" in the same millisecond. Which component can reject the second write atomically — and how does a cancelled slot become bookable again?',
    'Reminders fire 24 hours later, not during the request. Put a "remind at T-24h" job in a queue (or let a scheduled job pick up tomorrow’s visits) and send SMS and email from a worker or a scheduled job inside the app.',
    'Filtering 15,000 doctors by specialty, city and insurance is a job for a search engine. Keep it fresh asynchronously: clinic edits enqueue a re-index job instead of writing to the index inline.',
    'Clinic staff already have company accounts. Add an identity provider that the clinic panel and the backend trust, and federate each clinic’s directory into it.',
  ],
  checks: [
    {
      id: 'clients-reach-api',
      title: 'Patients and clinics reach the backend through an API',
      category: 'core',
      why: 'Both the patient apps and the clinic panel are thin clients of one backend API. Routing them through an edge layer (CDN, load balancer, gateway) gives you one place for TLS, rate limits and spike protection.',
      hint: 'Add patient and clinic clients and connect them to your Application, optionally through a CDN, load balancer or gateway.',
      concepts: ['api-gateway'],
      test: (g) => {
        const clients = g.ofKind(...CLIENT_KINDS)
        if (!clients.length) return { pass: false, detail: 'No patient or clinic client on the canvas.' }
        const stranded = clients.filter((c) => !g.reaches(c, kindIs(...COMPUTE_KINDS), { through: EDGE_KINDS, maxDepth: 4 }))
        return stranded.length ? { pass: false, detail: `${labels(stranded)} never reach the backend.` } : { pass: true }
      },
    },
    {
      id: 'booking-transactional-store',
      title: 'Bookings are decided in a transactional database',
      category: 'core',
      why: 'Check-then-write in application code races: two requests both see 9:00 as free and both book it, so the database has to be the referee. Use a conditional update on the slot row (UPDATE slots SET status=\'booked\', version=version+1 WHERE id=? AND status=\'free\' AND version=? — exactly one request sees "1 row updated", and cancelling sets it back to free) or, in PostgreSQL, a partial unique index on bookings(doctor_id, slot_start) WHERE status <> \'cancelled\'.',
      hint: 'Connect the Booking owner itself to a relational database (PostgreSQL, MySQL) with a Data edge and note how it rejects the second claim. A document store only works with a unique index or conditional write (MongoDB, DynamoDB).',
      concepts: ['concurrency-control', 'acid-vs-base'],
      test: (g) => {
        const owners = ownersAndChildren(g, 'booking')
        if (!owners.length) return { pass: false, detail: 'Nobody owns Booking yet.' }
        let stores = g.storesOf(owners)
        // Learners often draw data edges from the container only — accept that when Booking itself has none.
        if (!stores.length) stores = g.storesOf(owners.map((o) => g.parent(o)).filter((p): p is DiagramNode => p?.kind === 'monolith'))
        const decides = (s: DiagramNode) =>
          s.kind === 'relational-db' || (DB_KINDS.includes(s.kind) && (g.hasTrait(s, 'acid') || CONDITIONAL_WRITE_TECH.includes(s.tech ?? '')))
        if (stores.some(decides)) return true
        const caches = stores.filter((s) => s.kind === 'cache')
        if (caches.length)
          return { pass: false, detail: `Booking writes to ${labels(caches)} — a cache can show free slots, but it cannot guarantee one patient per slot.` }
        const docs = stores.filter((s) => DB_KINDS.includes(s.kind))
        if (docs.length)
          return {
            pass: false,
            detail: `${labels(docs)} needs a technology that can reject a second claim (unique index or conditional write, e.g. MongoDB, DynamoDB) — a relational DB with one transaction for the booking and its reminder job is simplest here.`,
          }
        return { pass: false, detail: 'Booking writes to no database that can reject a second claim on the same slot.' }
      },
    },
    {
      id: 'directory-search-engine',
      title: 'Doctor directory is served by a search engine',
      category: 'core',
      why: 'Filtering 15,000 doctors by specialty, city, insurance and free text with LIKE queries hammers the booking database exactly when traffic spikes. A search engine gives typo tolerance, facets and fast reads, and keeps that load off the transactional store.',
      hint: 'Add a Search engine (OpenSearch, Meilisearch, Typesense) and connect the Directory owner to it with a Data edge.',
      concepts: ['search-indexing'],
      test: (g) => {
        const owners = g.ownerFamily('directory')
        if (!owners.length) return { pass: false, detail: 'Nobody owns the doctor directory yet.' }
        return g.storesOf(owners, ['search']).length > 0 ? true : { pass: false, detail: 'The directory queries no search engine.' }
      },
    },
    {
      id: 'reminders-background',
      title: 'Reminders run as background jobs, off the booking path',
      category: 'core',
      why: 'A reminder fires 24 hours later, and SMS gateways time out. Scheduling a job in a queue (or letting a scheduled job pick up upcoming visits) keeps a slow provider from slowing down or failing a booking, and gives you retries for free.',
      hint: 'Have Booking enqueue a "remind at T-24h" job, or let a scheduled job read tomorrow’s visits from the bookings database. Run it in a separate worker or as a scheduled job inside the application — never inline from Booking.',
      concepts: ['background-jobs', 'queue-load-leveling'],
      test: (g) => {
        const notif = ownersAndChildren(g, 'notifications')
        if (!notif.length) return { pass: false, detail: 'Nobody owns Reminders yet.' }
        const notifIds = new Set(notif.map((n) => n.id))
        const bookingFam = g.ownerFamily('booking')
        const bookingIds = new Set(bookingFam.map((b) => b.id))
        const provider = isProvider(g)
        // A reminders API that only puts a job on a queue may be called in-process; one that sends messages may not.
        const enqueuesOnly = (n: DiagramNode) => !g.targets(n.id).some(provider) && g.targets(n.id, ['event']).some(isBroker)
        const inline = notif.filter(
          (n) => !enqueuesOnly(n) && g.sources(n.id, SYNC_PROTOCOLS).some((s) => bookingIds.has(s.id) && s.id !== n.id),
        )
        if (inline.length)
          return { pass: false, detail: `Booking calls ${labels(inline)} synchronously, so sending reminders sits on the request path — enqueue a job instead.` }

        // Fed by a queue: Booking → broker → reminders (a module may be fed via its application container).
        const units = new Map(notif.map((n) => [n.id, n]))
        for (const n of notif) {
          const p = g.parent(n)
          if (p?.kind === 'monolith') units.set(p.id, p)
        }
        // A broker someone else feeds (not a consumer looping back to itself).
        const fedBy = (b: DiagramNode, consumer: DiagramNode) => isBroker(b) && g.sources(b.id).some((s) => s.id !== consumer.id)
        const viaQueue =
          g.asyncFlow(bookingFam, [...units.values()]) || [...units.values()].some((u) => g.sources(u.id, ['event']).some((b) => fedBy(b, u)))

        // Scheduled job: reads upcoming visits from the bookings database and is never invoked by Booking.
        const bookingDbs = new Set(g.storesOf(bookingFam, DB_KINDS).map((s) => s.id))
        const scheduled = notif.some(
          (n) =>
            ['worker', 'function', 'module'].includes(n.kind) &&
            !g.sources(n.id).some((s) => bookingIds.has(s.id) && !notifIds.has(s.id)) &&
            (n.kind === 'module' || g.sources(n.id, SYNC_PROTOCOLS).length === 0) &&
            g.storesOf([n], DB_KINDS).some((s) => bookingDbs.has(s.id)),
        )
        return viaQueue || scheduled
          ? true
          : { pass: false, detail: 'Reminders are not fed by a queue, nor by a scheduled job that reads upcoming visits from the bookings database.' }
      },
    },
    {
      id: 'reminders-channels',
      title: 'Reminders go out by SMS and email',
      category: 'core',
      why: 'Patients forget visits; an SMS plus an email the day before cuts no-shows dramatically. Use specialised providers — running your own SMS gateway or mail server is not a beginner side quest.',
      hint: 'Connect the Reminders owner to an SMS provider (e.g. SMSAPI, Twilio) and an email provider (e.g. Amazon SES, SendGrid).',
      concepts: ['background-jobs'],
      test: (g) => {
        const notif = g.ownerFamily('notifications')
        if (!notif.length) return { pass: false, detail: 'Nobody owns Reminders yet.' }
        const sms = g.calls(notif, isSms(g))
        const email = g.calls(notif, isEmail(g))
        if (sms && email) return true
        const missing = [!sms && 'an SMS provider', !email && 'an email provider'].filter(Boolean).join(' and ')
        return { pass: false, detail: `Reminders do not reach ${missing}.` }
      },
    },
    {
      id: 'staff-identity',
      title: 'Clinic staff sign in through an identity provider',
      category: 'core',
      why: 'Clinic staff see patients’ health data. An identity provider (OIDC) gives SSO, MFA and central offboarding when a receptionist leaves — far safer than a home-grown password table, and auditors under GDPR will ask for it.',
      hint: 'Add an Identity provider (Auth0, Entra ID, Keycloak) and connect the clinic panel, the gateway or the Clinic Admin owner to it.',
      concepts: ['oauth-oidc'],
      test: (g) => {
        const idps = g.ofKind('identity')
        if (!idps.length) return { pass: false, detail: 'No identity provider on the canvas.' }
        const admin = new Set(g.ownerFamily('clinic-admin').map((n) => n.id))
        const relevant = (n: DiagramNode) =>
          CLIENT_KINDS.includes(n.kind) || EDGE_KINDS.includes(n.kind) || (admin.has(n.id) && n.kind !== 'worker' && n.kind !== 'function')
        return idps.some((i) => g.neighbours(i.id).some(relevant))
          ? true
          : { pass: false, detail: 'The identity provider is not connected to a client, the gateway or whatever owns Clinic Admin.' }
      },
    },
    {
      id: 'availability-cache',
      title: 'Availability reads are cached',
      category: 'bonus',
      why: 'During a flu-season spike thousands of patients refresh the same calendars. Caching computed free slots for a few seconds absorbs those reads — while the booking itself still goes to the database.',
      hint: 'Connect the Availability owner to a Cache (Redis, Valkey) with a Data edge.',
      concepts: ['caching', 'concurrency-control'],
      test: (g) => g.storesOf(g.ownerFamily('availability'), ['cache']).length > 0,
    },
    {
      id: 'search-indexed-async',
      title: 'The search index is updated asynchronously',
      category: 'bonus',
      why: 'When a clinic edits a doctor or a calendar, re-indexing should not block the panel or fail the save if the search cluster is busy. Publishing a change job and indexing in the background keeps the index eventually consistent and the write path fast.',
      hint: 'Publish "profile/slots changed" jobs to a queue and let a worker or the directory module consume them and update the index.',
      concepts: ['search-indexing', 'background-jobs'],
      test: (g) => {
        const indexes = g.ofKind('search')
        if (!indexes.length) return { pass: false, detail: 'No search engine yet.' }
        const asyncWriter = (w: DiagramNode) =>
          ['worker', 'function', 'stream-processor', 'cdc', 'broker'].includes(w.kind) || g.sources(w.id, ['event']).some(isBroker)
        return indexes.some((ix) => g.sources(ix.id).some(asyncWriter))
          ? true
          : { pass: false, detail: 'Nothing feeds the search index from a queue, CDC or background worker.' }
      },
    },
    {
      id: 'spike-edge',
      title: 'A CDN absorbs traffic spikes at the edge',
      category: 'bonus',
      why: 'When the news breaks, most new visitors land on the same doctor pages and JS bundles. A CDN serves those from the edge, so the origin only handles searches and bookings.',
      hint: 'Put a CDN (Cloudflare, CloudFront) between the clients and the backend.',
      concepts: ['cdn'],
      test: (g) => {
        const edge = (n: DiagramNode) => (n.kind === 'cdn' || (n.kind === 'waf' && g.hasTrait(n, 'global'))) && g.out(n.id).length > 0
        return g.ofKind(...CLIENT_KINDS).some((c) => g.targets(c.id).some(edge))
          ? true
          : { pass: false, detail: 'No client goes through a CDN that forwards to the backend.' }
      },
    },
    {
      id: 'right-sized-messaging',
      title: 'Messaging is right-sized for the team',
      category: 'bonus',
      why: 'A few hundred thousand reminder and indexing jobs a day fit easily in a DB-backed job queue or RabbitMQ. Running a Kafka cluster would be a second job for an 8-person team with no ops.',
      hint: 'Prefer a DB-backed job queue, RabbitMQ or a managed queue (SQS) over Kafka/Pulsar here.',
      concepts: ['kafka-vs-rabbitmq'],
      test: (g) => {
        const heavy = g.ofKind('broker').filter((b) => g.hasTrait(b, 'log'))
        return heavy.length ? { pass: false, detail: `${labels(heavy)} is heavy for this team.` } : true
      },
    },
    {
      id: 'ops-visibility',
      title: 'Logs and metrics are collected',
      category: 'bonus',
      why: 'You need to see booking conflicts, reminder failures and latency during a spike before patients call the press. Centralised logs plus metrics are the minimum.',
      hint: 'Add Log aggregation and a Metrics store and connect the Application and workers with Telemetry edges.',
      concepts: ['observability'],
      test: (g) => {
        if (!g.has('logging') || !g.has('metrics')) return { pass: false, detail: 'Add both log aggregation and metrics.' }
        return g.instrumented().length > 0 ? true : { pass: false, detail: 'Nothing sends telemetry yet.' }
      },
    },
    {
      id: 'anti-sync-provider',
      title: 'Booking never calls SMS/email providers inline',
      category: 'antipattern',
      why: 'If the booking request waits for an SMS gateway, a provider outage turns into failed bookings — or worse, a slot claimed in the database while the patient sees an error.',
      hint: 'Remove the direct call from Booking to the provider; enqueue a job and let the reminder worker send it.',
      concepts: ['background-jobs'],
      test: (g) => {
        const provider = isProvider(g)
        // Only a node that does not own Booking and drains a queue counts as a worker; Booking itself never gets a pass.
        const worker = (n: DiagramNode) => !n.domains.includes('booking') && g.sources(n.id, ['event']).some(isBroker)
        const offenders = g
          .ownerFamily('booking')
          .filter((n) => !worker(n))
          .filter((n) => g.targets(n.id, SYNC_PROTOCOLS).some(provider))
        return offenders.length ? { pass: false, detail: `${labels(offenders)} call a messaging provider during the booking request.` } : true
      },
    },
  ],
  inspiration: [
    { label: 'Buddy.Works — How Docplanner ships hundreds of deploys a day with a modular approach', url: 'https://buddy.works/customer-stories/docplanner' },
    { label: 'Google Cloud — Booksy scales a booking platform for 7× spikes', url: 'https://cloud.google.com/customers/booksy' },
    { label: 'Cockroach Labs — Booksy moves bookings to distributed SQL', url: 'https://www.cockroachlabs.com/customers/booksy/' },
  ],
  reference: {
    decisions: {
      style: 'modular-monolith',
      communication: 'hybrid',
      data: 'shared',
      stack: { frontend: 'nextjs', mobile: 'react-native', backend: 'spring-boot', database: 'postgres', messaging: 'db-queue', cache: 'redis' },
      rationale:
        'One Spring Boot application with a module per capability and one managed PostgreSQL (schema per module), where a conditional update on the slot row makes double booking impossible. Reminders and search re-indexing run as background jobs from a DB-backed queue, and every hosted piece is a managed service in an EU region, so a team without ops can run it.',
    },
    walkthrough: [
      'Patients use a Next.js site and a React Native app; clinic staff use a React panel. Everything goes through Cloudflare, which caches doctor pages and bundles and soaks up the 7× news spikes.',
      'One Spring Boot application (Spring Modulith) holds Directory, Availability, Booking and Clinic Admin modules, each owned by one of the two product teams and talking only through public module APIs — one deployable, clear boundaries.',
      'Booking claims a slot with a conditional update: UPDATE slots SET status=\'booked\', version=version+1 WHERE id=? AND status=\'free\' AND version=?. When two patients press "Book" at once, only one sees "1 row updated" and the other gets a friendly "slot just taken"; cancelling sets the row back to free so others can book it. A partial unique index on bookings(doctor_id, slot_start) WHERE status <> \'cancelled\' is an equally valid PostgreSQL guard. Redis caches free-slot views for a few seconds, but never decides.',
      'In the same transaction Booking inserts a "remind at T-24h" job into a DB-backed queue — on the JVM that is db-scheduler, JobRunr or Quartz with a JDBC job store (pg-boss in Node, Solid Queue or GoodJob in Rails, Celery beat in Python). A Background Worker picks due jobs and sends SMS via SMSAPI.pl and email via Amazon SES in an EU region, with retries, so a slow gateway never touches a booking. Messages carry only date, time and clinic address — no specialty or diagnosis — so providers see as little health data as possible.',
      'Clinic and calendar changes enqueue re-index jobs that the same worker applies to a managed OpenSearch cluster (e.g. Amazon OpenSearch Service in Frankfurt); the Directory module only reads from it for fast specialty and city search.',
      'Clinic staff sign in through Auth0 on an EU tenant: each clinic’s Entra ID or Google Workspace is federated as an enterprise connection with MFA enforced, so offboarding happens at the clinic. PostgreSQL, Redis and the Grafana Cloud logs and metrics stack are managed EU services too, which keeps the platform work small enough for 8 developers.',
    ],
    diagram: diagram(
      [
        ['web', 'web-app', 'Patient Web', 0, 40, { tech: 'nextjs' }],
        ['mobile', 'mobile-app', 'Patient App', 0, 180, { tech: 'react-native' }],
        ['panel', 'web-app', 'Clinic Panel', 0, 320, { tech: 'react' }],
        ['cdn', 'cdn', 'CDN + WAF', 260, 180, { tech: 'cloudflare' }],
        ['idp', 'identity', 'Staff SSO', 260, 320, { tech: 'auth0', notes: 'EU tenant; clinic Entra ID / Google Workspace federated, MFA enforced' }],
        ['app', 'monolith', 'MediSlot Application', 520, 40, { tech: 'spring-boot', w: 500, h: 390 }],
        ['directory', 'module', 'Directory', 270, 50, { parent: 'app', tech: 'spring-boot', domains: ['directory'] }],
        ['availability', 'module', 'Availability', 270, 135, { parent: 'app', tech: 'spring-boot', domains: ['availability'] }],
        ['booking', 'module', 'Booking', 270, 220, { parent: 'app', tech: 'spring-boot', domains: ['booking'] }],
        ['admin', 'module', 'Clinic Admin', 270, 305, { parent: 'app', tech: 'spring-boot', domains: ['clinic-admin'] }],
        ['redis', 'cache', 'Slot Cache', 1120, 150, { tech: 'redis', notes: 'Managed Redis, EU region; free-slot views with a few seconds TTL' }],
        [
          'pg',
          'relational-db',
          'MediSlot DB',
          1120,
          285,
          {
            tech: 'postgres',
            notes: "Managed PostgreSQL, EU region, schema per module. UPDATE slots SET status='booked' … WHERE status='free' AND version=? — one winner; cancel sets status back to 'free'",
          },
        ],
        ['queue', 'broker', 'Job Queue', 1120, 420, { tech: 'db-queue', notes: 'Jobs table in PostgreSQL (db-scheduler / JobRunr), scheduled with run_at' }],
        ['search', 'search', 'Doctor Search', 1400, 60, { tech: 'opensearch', notes: 'Managed OpenSearch, EU region' }],
        ['worker', 'worker', 'Background Worker', 1400, 420, { tech: 'spring-boot', domains: ['notifications'], notes: 'Sends reminders and applies re-index jobs' }],
        ['sms', 'external', 'SMSAPI.pl SMS (EU)', 1680, 380, { notes: 'Text carries date, time and clinic only — no specialty' }],
        ['mail', 'external', 'Amazon SES (EU region)', 1680, 500, { tech: 'ses' }],
        ['logs', 'logging', 'Logs (Grafana Cloud EU)', 520, 680, { tech: 'loki' }],
        ['metrics', 'metrics', 'Metrics (Grafana Cloud EU)', 780, 680, { tech: 'mimir' }],
      ],
      [
        ['web', 'cdn'],
        ['mobile', 'cdn'],
        ['panel', 'cdn'],
        ['panel', 'idp', 'http', 'staff login (OIDC)'],
        ['cdn', 'app', 'http'],
        ['app', 'idp', 'http', 'verify tokens'],
        ['directory', 'search', 'data', 'search queries'],
        ['availability', 'redis'],
        ['availability', 'pg'],
        ['booking', 'availability', 'http', 'in-process API'],
        ['booking', 'pg', 'data', 'UPDATE … WHERE status=free'],
        ['admin', 'pg'],
        ['booking', 'queue', 'event', 'remind at T-24h'],
        ['admin', 'queue', 'event', 'profile & calendar changed'],
        ['queue', 'worker', 'event', 'due jobs'],
        ['worker', 'pg', 'data', 'load visit'],
        ['worker', 'search', 'data', 're-index'],
        ['worker', 'sms', 'http'],
        ['worker', 'mail', 'http'],
        ['app', 'logs', 'telemetry'],
        ['app', 'metrics', 'telemetry'],
        ['worker', 'logs', 'telemetry'],
        ['worker', 'metrics', 'telemetry'],
      ],
    ),
  },
}

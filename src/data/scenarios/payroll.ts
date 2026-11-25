import { SYNC_PROTOCOLS, type ComponentKind, type DiagramNode, type Scenario } from '../../engine/types'
import { COMPUTE_KINDS, DATA_KINDS, DB_KINDS, type Graph } from '../../engine/graph'
import { diagram, kindIs } from './builder'

/** Government filing systems — label fallback, since no tech entry describes them. */
const GOV =
  /zus|\bpue\b|płatnik|platnik|e-?deklar|e-?urz|skarbow|\bkas\b|elster|finanzamt|de[uü]v|\bgkv\b|sv\.?net|sodra|\bvmi\b|[čc]ssz|e-?pod[aá]n|government|\bgov\b|tax (office|authority)|social (insurance|security)|urz[aą]d|revenue/i

/** A plug-in registry / manifest store, recognised by its label. */
const REGISTRY = /plug-?in|registry|manifest|catalog|extension/i

/** A plug-in contract version written on the plug-in, e.g. "SPI v3" or "contract 2". */
const CONTRACT_VERSION = /(contract|spi|api|interface|extension point)\s*v?\d|\bv\d+(\.\d+)*\b/i

/** Customer rules a rules engine may run safely: declarative DMN decision tables / FEEL, never DRL or Java. */
const DECLARATIVE_RULES = /\bdmn\b|\bfeel\b(?!\s+free)|decision tables?/i

/** Imperative rule code a customer must not author (a "no DRL" / "without Java" mention is fine). */
const IMPERATIVE_RULES = /(?<!\b(?:no|not|without)\s+)\b(drl|java)\b/i

/** Egress hops a plug-in may use to reach a government system (an outbound proxy, for instance). */
const EGRESS_KINDS: ComponentKind[] = ['api-gateway', 'load-balancer']

const isPlugin = kindIs('plugin')
const labels = (ns: DiagramNode[]) => [...new Map(ns.map((n) => [n.id, n])).values()].map((n) => n.label).join(', ')
const isGov = (n: DiagramNode) => n.kind === 'external' && GOV.test(n.label)

/** Application containers that own the payroll run, directly or through one of their modules. */
function coreApps(g: Graph): DiagramNode[] {
  const out = new Map<string, DiagramNode>()
  for (const o of g.owners('payroll-run')) {
    if (o.kind === 'plugin') continue
    const d = g.deployable(o)
    if (d.kind === 'monolith') out.set(d.id, d)
  }
  return [...out.values()]
}

/** The core itself: the core Application containers plus their modules (never their plug-ins). */
function coreNodes(g: Graph): DiagramNode[] {
  return coreApps(g).flatMap((app) => [app, ...g.children(app.id).filter((c) => c.kind !== 'plugin')])
}

/** Country plug-ins living inside an Application container. */
const countryPlugins = (g: Graph, app: DiagramNode) => g.children(app.id).filter((n) => isPlugin(n) && n.domains.includes('country-rules'))

/** A node that sits inside the core Application (the container itself or one of its modules). */
const inCore = (g: Graph) => (n: DiagramNode) => n.kind === 'monolith' || (n.kind === 'module' && g.parent(n)?.kind === 'monolith')

export const payrollPlugins: Scenario = {
  id: 'placa-payroll-plugins',
  title: 'Płaca: one payroll core, a plug-in per country',
  tagline: 'A payroll SaaS whose core barely changes — but every country’s tax rules change every January.',
  industry: 'HR & payroll',
  difficulty: 'beginner',
  estMinutes: 25,
  accent: '#b45309',
  concepts: ['microkernel-architecture', 'contract-versioning', 'anti-corruption-layer', 'domain-vs-technical-partitioning', 'architecture-characteristics', 'modular-monolith'],
  story:
    'Płaca.io is a five-person payroll start-up from Poznań. Its core — employees, contracts, pay periods, the gross-to-net run and payslips — has barely changed in two years, and customers love it. The pain is everything around it: Polish PIT and ZUS contributions, Czech social and health insurance, Lithuanian Sodra rates all change on 1 January (sometimes mid-year too), and every change today means editing `if (country == "PL")` branches deep inside the payroll run and re-testing every market. Germany goes live in spring, Slovakia and Romania are on next year’s roadmap, and forty enterprise customers want their own bonus and commission formulas. On top of that each country files its declarations with its own government system — ZUS (eZUS/PUE) and e-Deklaracje in Poland, ČSSZ e-Podání in Czechia, Sodra and VMI in Lithuania, ELSTER and the health insurance funds’ GKV communication server in Germany — each with its own formats and quirks. The founders want a design where a new country, or next year’s rules, is something you add, not something you rewrite.',
  facts: [
    { label: 'Team', value: '5 developers, no dedicated ops' },
    { label: 'Customers', value: '1,400 companies, ~85,000 payslips per month' },
    { label: 'Countries', value: 'PL, CZ, LT live · DE in Q2 · SK and RO next year' },
    { label: 'Rule changes', value: 'Every 1 January in every country, plus mid-year surprises' },
    { label: 'Run time', value: 'A 3,000-employee company must be calculated in < 2 minutes' },
  ],
  functional: [
    'HR staff maintain employees, contracts and salaries, and start a payroll run for a pay period',
    'The run calculates gross-to-net for every employee using the rules of the employee’s country and of that year',
    'Employees download their payslips from a self-service portal',
    'Monthly and annual declarations are filed with each country’s government systems',
    'Enterprise customers configure their own bonus and commission formulas',
  ],
  nonFunctional: [
    'Adding a country or next year’s rules must not require changing the core payroll run',
    'Corrections for last December must still be calculated with last year’s rules',
    'A change to the Lithuanian rules must not require changing, redeploying or re-testing the Polish rules',
    'A customer’s bonus formula must never crash the run or read another customer’s data',
    'Payslips are legal documents: a finished run is stored exactly once and never half-written',
  ],
  constraints: ['Five developers — one deployable to operate, not a fleet', 'The JVM team already knows Spring Boot', 'Country rules may be written by a contracted local payroll expert, not only by the core team'],
  domains: [
    { id: 'employees', label: 'Employees & contracts', description: 'Employee records, contracts, salaries, pay periods' },
    { id: 'payroll-run', label: 'Payroll run & payslips', description: 'Runs a pay period, orchestrates gross-to-net, locks results, produces payslips' },
    { id: 'country-rules', label: 'Country tax & insurance rules', description: 'Income tax, social and health contributions, allowances — per country and per year' },
    { id: 'gov-filing', label: 'Government filings', description: 'Country-specific declarations to ZUS, ČSSZ, Sodra/VMI, ELSTER and GKV' },
    { id: 'custom-rules', label: 'Customer bonus rules', description: 'Bonus and commission formulas authored by customers' },
  ],
  recommendedStyles: ['microkernel'],
  styleFeedback: {
    microkernel:
      'Best fit: the payroll run is a stable, general core, and the volatile part — country rules, government formats, customer formulas — varies by market and by year. Plug-ins behind one contract let the team add Germany or the 2027 rules without touching the core, and the whole thing still deploys as one application.',
    monolith:
      'A layered monolith slices the code by technical layer, so Polish tax logic ends up spread across controllers, services and repositories next to Czech logic. Every January change touches the core and forces a re-test of every market — exactly today’s pain.',
    'modular-monolith':
      'Close, and it keeps one deployable — but modules partition the system by business capability, and every country is the same capability with different rules. Modules are always compiled in and released together; plug-ins can be added, versioned and enabled per customer without a core release.',
    microservices:
      'A service per country turns a gross-to-net calculation — essentially a pure function — into network calls, and a payroll run into a distributed transaction. Five developers would be running a fleet of pipelines instead of keeping up with tax law.',
    'event-driven':
      'A payroll run is an ordered, all-or-nothing calculation that must give one exact answer. Spreading it across asynchronous events makes payslips eventually consistent and hard to reproduce for an auditor, with nothing to gain at 85,000 payslips a month.',
    serverless:
      'A function per country is a set of tiny separately deployed services with no shared contract enforced at build time, and the run would lose its single transaction. Cold starts and per-call limits also fight the "3,000 employees in under two minutes" target.',
    'service-based':
      'A few coarse services (Employees, Payroll, Filing) would still put all country rules inside the Payroll service, so the variation problem is not solved — and the team now operates several deployables and a shared database for no gain.',
    'space-based':
      'Space-based architecture exists for extreme, unpredictable concurrent load. Payroll is a predictable monthly batch; an in-memory data grid with data pumps adds complexity and a risk of losing writes in a domain where every grosz must reconcile.',
  },
  hints: [
    'Ask which part of the system changes every January and which part has not changed in two years. The stable part is your core; the volatile part should be pluggable.',
    'Draw one Application container for the core and put a Plug-in inside it for each country — Poland, Czechia, Lithuania (and Germany next). Assign "Country tax & insurance rules" to the plug-ins only.',
    'Plug-ins talk to the core, never to each other. If the Czech plug-in needs something the Polish one has, move it into the core contract.',
    'Where does a plug-in get the employee’s salary and contract? The core passes it in through the plug-in contract — plug-ins should not open the core’s database.',
    'Each country files in its own format with its own government system. Let each country plug-in own its filing adapter, so the core only says "file this period".',
    'Customers write their own bonus formulas. How do you stop one bad formula from crashing the run — a rules engine limited to DMN decision tables, or a sandboxed WebAssembly plug-in?',
  ],
  checks: [
    {
      id: 'rules-as-plugins',
      title: 'Country rules are plug-ins inside the core application',
      category: 'core',
      why: 'In a microkernel the core holds the general, stable workflow and each source of variation becomes a plug-in behind one contract. Here the variation is per country (and per year), so each country is one plug-in: adding Germany means adding a plug-in, not editing the payroll run.',
      hint: 'Inside the Application that owns the payroll run, add a Plug-in for each country (at least PL, CZ and LT) and give each one the "Country tax & insurance rules" capability.',
      concepts: ['microkernel-architecture', 'domain-vs-technical-partitioning'],
      test: (g) => {
        const apps = coreApps(g)
        if (!apps.length) {
          const services = g.owners('payroll-run').filter(kindIs('service'))
          return {
            pass: false,
            detail: services.length
              ? `${labels(services)} is a separate service — draw the core as an Application container that owns the payroll run.`
              : 'No Application container owns the payroll run yet.',
          }
        }
        const [app, plugins] = apps.map((a) => [a, countryPlugins(g, a)] as const).sort((a, b) => b[1].length - a[1].length)[0]
        if (plugins.length >= 3) return true
        const inPlugins = new Set(plugins.map((p) => p.id))
        const elsewhere = g.owners('country-rules').filter((o) => !inPlugins.has(o.id))
        return {
          pass: false,
          detail: `${app.label} hosts ${plugins.length} country plug-in${plugins.length === 1 ? '' : 's'}${elsewhere.length ? `; country rules also live in ${labels(elsewhere)}` : ''} — Poland, Czechia and Lithuania each need their own plug-in inside the core.`,
        }
      },
    },
    {
      id: 'core-owns-run',
      title: 'The core owns the payroll run; only plug-ins know country rules',
      category: 'core',
      why: 'A microkernel only pays off when the core stays free of the variation. If the payroll run lives in a plug-in, or the core keeps a "shared tax helper" full of country switches, every January release touches the core again and a Lithuanian change still forces a re-release and re-test of Polish payslips.',
      hint: 'Assign "Payroll run & payslips" and "Employees & contracts" to the core Application or its modules, and "Country tax & insurance rules" to plug-ins only — move any country logic out of core modules.',
      concepts: ['microkernel-architecture', 'bounded-context'],
      test: (g) => {
        const problems: string[] = []
        for (const [domain, name] of [
          ['payroll-run', 'the payroll run'],
          ['employees', 'employees & contracts'],
        ] as const) {
          const owners = g.owners(domain)
          if (!owners.length) problems.push(`Nobody owns ${name}.`)
          const outside = owners.filter((o) => !inCore(g)(o))
          if (outside.length) problems.push(`${labels(outside)} own${outside.length === 1 ? 's' : ''} ${name} — it belongs to the core application, not to a plug-in or a separate service.`)
        }
        const ruleOwners = g.owners('country-rules')
        if (!ruleOwners.length) problems.push('Nobody owns the country rules.')
        const leaking = ruleOwners.filter((o) => !isPlugin(o))
        if (leaking.length) problems.push(`${labels(leaking)} own${leaking.length === 1 ? 's' : ''} country rules — that is a country switch outside the plug-ins.`)
        return problems.length ? { pass: false, detail: problems.join(' ') } : true
      },
    },
    {
      id: 'core-payroll-store',
      title: 'The core stores the payroll run in a transactional database',
      category: 'core',
      why: 'Payslips are legal documents: a finished run must be stored all at once or not at all, and a correction must be reproducible later. The core owns this data and hands each plug-in exactly the employee and period data it needs, so the plug-ins can stay simple calculators.',
      hint: 'Connect the payroll run owner (or the core Application) to a relational database such as PostgreSQL with a Data edge.',
      concepts: ['acid-vs-base'],
      test: (g) => {
        const core = g.ownerFamily('payroll-run').filter((n) => !isPlugin(n))
        if (!core.length) return { pass: false, detail: 'Nobody in the core owns the payroll run yet.' }
        const stores = g.storesOf(core, DB_KINDS)
        if (stores.some((s) => s.kind === 'relational-db' || g.hasTrait(s, 'acid'))) return true
        return {
          pass: false,
          detail: stores.length
            ? `${labels(stores)} cannot store a whole payroll run atomically — use a transactional (ACID) database.`
            : 'The payroll run is not stored in any database.',
        }
      },
    },
    {
      id: 'gov-filing-via-plugins',
      title: 'Each country plug-in files with its own government system',
      category: 'core',
      why: 'Government systems differ in format, authentication and quirks, and they change with the law. Putting each one behind its country plug-in makes that plug-in an anti-corruption layer: the core only says "file this period", and a new XML schema from ZUS never leaks into the payroll run.',
      hint: 'Add the government systems as Third-party APIs (ZUS, ČSSZ e-Podání, Sodra, ELSTER), connect each country plug-in to its own one, and assign "Government filings" to the plug-ins — not to a core module.',
      concepts: ['anti-corruption-layer', 'microkernel-architecture'],
      test: (g) => {
        const owners = g.owners('gov-filing')
        if (!owners.length) return { pass: false, detail: 'Nobody owns government filings yet.' }
        const coreOwners = owners.filter((o) => !isPlugin(o))
        if (coreOwners.length)
          return { pass: false, detail: `${labels(coreOwners)} own${coreOwners.length === 1 ? 's' : ''} government filings — the filing format of each country belongs in its plug-in.` }
        const govs = g.ofKind('external').filter(isGov)
        if (!govs.length) return { pass: false, detail: 'No government system (ZUS, ČSSZ, Sodra, ELSTER…) on the canvas.' }
        const viaPlugins = (s: DiagramNode) =>
          isPlugin(s) || (EGRESS_KINDS.includes(s.kind) && g.sources(s.id).length > 0 && g.sources(s.id).every(isPlugin))
        const direct = govs.flatMap((gv) => g.sources(gv.id).filter((s) => !viaPlugins(s)))
        if (direct.length) return { pass: false, detail: `${labels(direct)} call${direct.length === 1 ? 's' : ''} a government system directly — route filing through the country plug-ins.` }
        const filers = g.ofKind('plugin').filter((p) => g.reaches(p, isGov, { through: EGRESS_KINDS, maxDepth: 2 }))
        return filers.length >= 2
          ? true
          : { pass: false, detail: `Only ${filers.length} plug-in${filers.length === 1 ? '' : 's'} file${filers.length === 1 ? 's' : ''} with a government system — each country plug-in should own its filing adapter.` }
      },
    },
    {
      id: 'sandboxed-customer-rules',
      title: 'Customer bonus formulas run in a sandboxed or declarative-rules (DMN) plug-in',
      category: 'bonus',
      why: 'Code written by forty different customers is untrusted: an endless loop or a reach into another tenant’s data must not be possible. A WebAssembly sandbox (Extism: memory and time limits, no I/O by default) can run customer code safely. A rules engine is only safe if customers may edit nothing but DMN decision tables and FEEL expressions — Drools DRL rules run arbitrary Java in their consequences, so no DRL and no Java from customers.',
      hint: 'Give "Customer bonus rules" to a Plug-in and choose Extism (WebAssembly) as its technology — or Drools, noting on the plug-in that customers edit only DMN decision tables.',
      concepts: ['microkernel-architecture', 'multi-tenancy'],
      test: (g) => {
        const owners = g.owners('custom-rules')
        if (!owners.length) return { pass: false, detail: 'Nobody owns customer bonus rules yet.' }
        const plugins = owners.filter(isPlugin)
        if (!plugins.length) return { pass: false, detail: `${labels(owners)} run${owners.length === 1 ? 's' : ''} customer formulas inside the core — make them a plug-in.` }
        const safe = (p: DiagramNode) => {
          const text = `${p.label} ${p.notes ?? ''}`
          return g.hasTrait(p, 'sandbox') || (g.hasTrait(p, 'rules-engine') && DECLARATIVE_RULES.test(text) && !IMPERATIVE_RULES.test(text))
        }
        const unsafe = plugins.filter((p) => !safe(p))
        if (!unsafe.length) return true
        const engines = unsafe.filter((p) => g.hasTrait(p, 'rules-engine'))
        const rest = unsafe.filter((p) => !g.hasTrait(p, 'rules-engine'))
        const details = [
          ...(engines.length
            ? [`${labels(engines)} let${engines.length === 1 ? 's' : ''} customers write rules that can run arbitrary Java (DRL) — restrict them to DMN decision tables / FEEL and say so in the notes, or use a sandbox (Extism).`]
            : []),
          ...(rest.length
            ? [`${labels(rest)} run${rest.length === 1 ? 's' : ''} customer code with full access to the JVM — use a sandbox (Extism), or a rules engine limited to DMN decision tables.`]
            : []),
        ]
        return { pass: false, detail: details.join(' ') }
      },
    },
    {
      id: 'plugin-registry',
      title: 'The core loads plug-ins from a registry',
      category: 'bonus',
      why: 'A plug-in registry (manifests with name, country, valid-from date and contract version) lets the core discover which plug-ins exist and enable them per customer — so "Germany for these three customers" is configuration, not a code change.',
      hint: 'Add an Object storage or Document DB labelled "Plug-in Registry" and connect the core Application to it with a Data edge.',
      concepts: ['microkernel-architecture'],
      test: (g) => {
        const stores = g.storesOf(coreNodes(g)).filter((s) => REGISTRY.test(s.label))
        return stores.length ? true : { pass: false, detail: 'The core reads no plug-in registry or manifest store.' }
      },
    },
    {
      id: 'versioned-plugin-contract',
      title: 'Plug-ins implement a versioned contract',
      category: 'bonus',
      why: 'The core and the plug-ins evolve at different speeds. A versioned plug-in contract (e.g. "PayrollRules SPI v3") lets the 2026 and 2027 Polish plug-ins live side by side, so last December’s correction runs with last year’s rules, and old plug-ins keep working while new ones adopt v4.',
      hint: 'Write the contract version on each plug-in (label or notes, e.g. "SPI v3"), or use a plug-in framework with versioned bundles such as OSGi.',
      concepts: ['contract-versioning'],
      test: (g) => {
        const plugins = g.ofKind('plugin')
        if (!plugins.length) return { pass: false, detail: 'No plug-ins yet.' }
        if (coreApps(g).some((a) => g.hasTrait(a, 'versioned-contracts'))) return true
        const missing = plugins.filter((p) => !g.hasTrait(p, 'versioned-contracts') && !CONTRACT_VERSION.test(`${p.label} ${p.notes ?? ''}`))
        return missing.length ? { pass: false, detail: `No contract version on ${labels(missing)}.` } : true
      },
    },
    {
      id: 'ops-visibility',
      title: 'Logs and metrics are collected',
      category: 'bonus',
      why: 'On payday you need to see which plug-in slowed the run down or which government system rejected a filing — before 1,400 HR departments call support.',
      hint: 'Add Log aggregation and a Metrics store and connect the core Application with Telemetry edges.',
      concepts: ['observability'],
      test: (g) => {
        if (!g.has('logging') || !g.has('metrics')) return { pass: false, detail: 'Add both log aggregation and metrics.' }
        return g.instrumented().length > 0 ? true : { pass: false, detail: 'Nothing sends telemetry yet.' }
      },
    },
    {
      id: 'anti-plugin-crosstalk',
      title: 'Plug-ins never call each other',
      category: 'antipattern',
      why: 'Plug-ins are independent by design: you can add, remove or upgrade one without the others noticing. As soon as the Czech plug-in calls the Polish one to reuse a rate table, removing or upgrading Poland breaks Czechia and the plug-ins become a hidden monolith.',
      hint: 'Remove the plug-in-to-plug-in edges. Shared behaviour belongs in the core (exposed through the plug-in contract), not in another plug-in.',
      concepts: ['microkernel-architecture'],
      test: (g) => {
        const sync = g.pluginCrossTalk()
        const other = g
          .ofKind('plugin')
          .flatMap((p) => g.out(p.id).filter((e) => !SYNC_PROTOCOLS.includes(e.protocol)).map((e) => ({ from: p, to: g.node(e.target)! })))
          .filter((x) => isPlugin(x.to))
        const all = [...sync, ...other]
        return all.length ? { pass: false, detail: all.map((x) => `${x.from.label} → ${x.to.label}`).join('; ') } : true
      },
    },
    {
      id: 'anti-plugin-shared-data',
      title: 'Plug-ins do not reach into shared data stores',
      category: 'antipattern',
      why: 'If a plug-in reads the core’s tables, every schema change in the core can break every country — the plug-in contract is bypassed. The usual rule: the core passes the data a plug-in needs through the contract; a plug-in may keep a private store that nobody else touches, but never shares one with the core or another plug-in.',
      hint: 'Remove the plug-in’s Data edge to the core’s (or another plug-in’s) store and let the core pass the employee, contract and period data into the plug-in call.',
      concepts: ['microkernel-architecture', 'database-per-service'],
      test: (g) => {
        const offenders: string[] = []
        for (const p of g.ofKind('plugin'))
          for (const store of g.targets(p.id).filter(kindIs(...DATA_KINDS))) {
            const others = g.sources(store.id).filter((s) => s.id !== p.id && COMPUTE_KINDS.includes(s.kind))
            if (others.length) offenders.push(`${p.label} → ${store.label} (also used by ${labels(others)})`)
          }
        return offenders.length ? { pass: false, detail: offenders.join('; ') } : true
      },
    },
  ],
  inspiration: [
    { label: 'Mark Richards — Software Architecture Monday, Lesson 160: Microkernel Architecture', url: 'https://www.developertoarchitect.com/lessons/lesson160.html' },
    { label: 'Mark Richards — Lesson 147: The Fallacies of Versioning', url: 'https://www.developertoarchitect.com/lessons/lesson147.html' },
    { label: 'Shopify Engineering — How Shopify uses WebAssembly to run merchant code safely', url: 'https://shopify.engineering/shopify-webassembly' },
    { label: 'Martin Fowler — Rules Engine', url: 'https://martinfowler.com/bliki/RulesEngine.html' },
  ],
  starterDecisions: { stack: {} },
  starter: diagram(
    [
      ['hr', 'web-app', 'HR Panel', 0, 120, { tech: 'react' }],
      ['app', 'monolith', 'Płaca Application', 300, 40, { tech: 'spring-boot', w: 480, h: 300 }],
      ['employees', 'module', 'Employees', 30, 60, { parent: 'app', tech: 'spring-boot', domains: ['employees'] }],
      ['run', 'module', 'Payroll Run', 30, 170, { parent: 'app', tech: 'spring-boot', domains: ['payroll-run'] }],
      ['tax', 'module', 'Tax & ZUS (if country == PL…)', 260, 60, { parent: 'app', tech: 'spring-boot', domains: ['country-rules', 'gov-filing'] }],
      ['db', 'relational-db', 'Payroll DB', 300, 420, { tech: 'postgres' }],
      ['zus', 'external', 'ZUS (eZUS/PUE)', 880, 100, { tech: 'generic-api' }],
    ],
    [
      ['hr', 'app'],
      ['employees', 'db'],
      ['run', 'db'],
      ['run', 'tax', 'http', 'calculate'],
      ['tax', 'zus', 'http', 'declarations'],
    ],
  ),
  reference: {
    decisions: {
      style: 'microkernel',
      communication: 'sync',
      data: 'shared',
      stack: { frontend: 'react', backend: 'spring-boot', database: 'postgres' },
      rationale:
        'Microkernel: one Spring Boot core owns employees, contracts and the payroll run, and every source of variation is a plug-in behind a versioned PayrollRules contract — a PF4J plug-in per country (rules plus its government filing adapter) and an Extism WebAssembly sandbox for customer bonus formulas. Plug-ins never call each other and never touch the core’s PostgreSQL; the core passes them the data they need. The core discovers plug-ins and per-customer enablement from a manifest registry in object storage, so adding Germany or the 2027 rules is a new plug-in, not a core release.',
    },
    walkthrough: [
      'HR staff and employees use React front ends that reach the core through a load balancer; both sign in through Keycloak, which the core also uses to verify tokens.',
      'The core is one Spring Boot application with two modules — Employees & Contracts and Payroll Run & Payslips. It knows nothing about Polish or Czech law: it loads employees and contracts for the pay period, calls the right country plug-in for each employee, applies the customer’s bonus plug-in, and stores the finished run in PostgreSQL in one transaction.',
      'Each country is a PF4J plug-in (PL, CZ, LT and the new DE) implementing the same PayrollRules contract, SPI v3: calculate(employee, contract, period) returns contributions, taxes and net pay, and file(period) builds the country’s declarations. Each plug-in is versioned by rules year, so the 2026 and 2027 Polish plug-ins live side by side and last December’s correction uses last year’s rules.',
      'Every country plug-in owns its government adapter — ZUS (eZUS/PUE) and e-Deklaracje, ČSSZ e-Podání, Sodra and VMI, ELSTER for wage tax and the GKV communication server for DEÜV social-insurance notifications. That makes it an anti-corruption layer: a new XML schema or a certificate change stays inside one plug-in.',
      'Plug-ins never call each other and have no Data edges: the core passes in exactly what they need. Customer bonus formulas compile to WebAssembly and run in an Extism plug-in with memory and time limits, so a bad formula fails one payslip calculation instead of the whole run.',
      'The core runs each country calculation with a timeout and per-country error handling, so a Lithuanian failure marks the Lithuanian payslips as failed and the Polish ones still finish. What a single-process microkernel cannot promise is fault isolation: PF4J class loaders isolate dependencies, not crashes, so a plug-in that leaks memory or kills its thread still shares the JVM. That residual risk is accepted for the country plug-ins the team reviews itself; untrusted customer rules go to the sandboxed Extism plug-in instead.',
      'At start-up the core reads plug-in manifests (country, valid-from, contract version, which customers have it enabled) from a Plug-in Registry bucket. Logs and metrics go to Loki and Prometheus, so a slow plug-in or a rejected filing is visible on payday.',
    ],
    diagram: diagram(
      [
        ['hr', 'web-app', 'HR & Payroll Panel', 0, 120, { tech: 'react' }],
        ['portal', 'web-app', 'Employee Payslips', 0, 300, { tech: 'react' }],
        ['lb', 'load-balancer', 'Load Balancer', 270, 210, { tech: 'nginx' }],
        ['idp', 'identity', 'Customer SSO', 270, 380, { tech: 'keycloak' }],
        ['app', 'monolith', 'Płaca Core', 560, 40, { tech: 'spring-boot', w: 540, h: 420, notes: 'PF4J plug-in manager; PayrollRules SPI v3' }],
        ['employees', 'module', 'Employees & Contracts', 30, 60, { parent: 'app', tech: 'spring-boot', domains: ['employees'] }],
        ['run', 'module', 'Payroll Run & Payslips', 30, 170, { parent: 'app', tech: 'spring-boot', domains: ['payroll-run'] }],
        [
          'bonus',
          'plugin',
          'Custom Bonus Rules',
          30,
          320,
          { parent: 'app', tech: 'extism', domains: ['custom-rules'], notes: 'BonusRules SPI v1 · customer formulas compiled to WebAssembly, memory and time limits' },
        ],
        ['pl', 'plugin', 'Poland (PIT + ZUS)', 310, 50, { parent: 'app', tech: 'pf4j', domains: ['country-rules', 'gov-filing'], notes: 'PayrollRules SPI v3 · rules 2026 and 2027' }],
        ['cz', 'plugin', 'Czechia', 310, 140, { parent: 'app', tech: 'pf4j', domains: ['country-rules', 'gov-filing'], notes: 'PayrollRules SPI v3 · rules 2027' }],
        ['lt', 'plugin', 'Lithuania', 310, 230, { parent: 'app', tech: 'pf4j', domains: ['country-rules', 'gov-filing'], notes: 'PayrollRules SPI v3 · rules 2027' }],
        ['de', 'plugin', 'Germany (new)', 310, 320, { parent: 'app', tech: 'pf4j', domains: ['country-rules', 'gov-filing'], notes: 'PayrollRules SPI v3 · rules 2027' }],
        ['zus', 'external', 'ZUS (eZUS/PUE) + e-Deklaracje', 1200, 90, { tech: 'generic-api' }],
        ['cssz', 'external', 'ČSSZ e-Podání', 1200, 180, { tech: 'generic-api' }],
        ['sodra', 'external', 'Sodra + VMI', 1200, 270, { tech: 'generic-api' }],
        ['elster', 'external', 'ELSTER + GKV (DEÜV)', 1200, 360, { tech: 'generic-api' }],
        ['db', 'relational-db', 'Payroll DB', 560, 540, { tech: 'postgres', notes: 'Employees, contracts, runs and payslips; one transaction per finished run' }],
        ['registry', 'object-storage', 'Plug-in Registry', 840, 540, { tech: 's3', notes: 'Manifests: country, valid-from, contract version, enabled customers; WASM modules' }],
        ['logs', 'logging', 'Logs', 560, 680, { tech: 'loki' }],
        ['metrics', 'metrics', 'Metrics', 840, 680, { tech: 'prometheus' }],
      ],
      [
        ['hr', 'lb'],
        ['portal', 'lb'],
        ['hr', 'idp', 'http', 'login (OIDC)'],
        ['portal', 'idp', 'http', 'login (OIDC)'],
        ['lb', 'app'],
        ['app', 'idp', 'http', 'verify tokens'],
        ['run', 'employees', 'http', 'contracts for period'],
        ['employees', 'db'],
        ['run', 'db', 'data', 'store finished run'],
        ['run', 'pl', 'http', 'calculate / file'],
        ['run', 'cz', 'http', 'calculate / file'],
        ['run', 'lt', 'http', 'calculate / file'],
        ['run', 'de', 'http', 'calculate / file'],
        ['run', 'bonus', 'http', 'bonus(employee, period)'],
        ['pl', 'zus', 'http', 'KEDU / PIT XML'],
        ['cz', 'cssz', 'http', 'monthly reports'],
        ['lt', 'sodra', 'http', 'SAM / GPM313'],
        ['de', 'elster', 'http', 'Lohnsteuer + DEÜV notifications'],
        ['app', 'registry', 'data', 'load manifests'],
        ['app', 'logs', 'telemetry'],
        ['app', 'metrics', 'telemetry'],
      ],
    ),
  },
}

import { COMPONENT_BY_KIND } from '../data/components'
import { COMPUTE_KINDS, Graph } from './graph'
import type { ArchStyle, Check, CheckResult, Decisions, Diagram, Evaluation, LintIssue, Scenario } from './types'

const STYLE_NAMES: Record<ArchStyle, string> = {
  monolith: 'Monolith',
  'modular-monolith': 'Modular monolith',
  microservices: 'Microservices',
  'event-driven': 'Event-driven microservices',
  serverless: 'Serverless',
}
export { STYLE_NAMES }

// ---------------------------------------------------------------------------
// Reusable checks shared by all scenarios
// ---------------------------------------------------------------------------

export function domainsCheck(s: Scenario): Check {
  return {
    id: 'domains-owned',
    title: 'Every business capability has an owner',
    category: 'core',
    why: 'Clear ownership of each capability (bounded context) is the backbone of any architecture — monolith or microservices. Unowned capabilities become the "everyone and no-one" code that rots first.',
    hint: 'Select a service or module and assign capabilities in the inspector ("Owns capabilities").',
    concepts: ['bounded-context'],
    test: (g) => {
      const missing = s.domains.filter((d) => !g.owned(d.id))
      return missing.length === 0
        ? { pass: true }
        : { pass: false, detail: `Unowned: ${missing.map((d) => d.label).join(', ')}` }
    },
  }
}

export function styleCheck(s: Scenario): Check {
  return {
    id: 'style-fit',
    title: 'Architecture style fits the context',
    category: 'core',
    why: 'Architecture style is a trade-off driven by team size, scale, and change cadence — not fashion. The "right" answer depends on the scenario facts.',
    hint: `Open "Decisions" and pick a style. Re-read team size and scale in the brief.`,
    concepts: ['modular-monolith', 'microservices', 'event-driven'],
    test: (g) => {
      const style = g.decisions.style
      if (!style) return { pass: false, detail: 'No architecture style selected yet.' }
      const ok = s.recommendedStyles.includes(style)
      return { pass: ok, detail: s.styleFeedback[style] ?? (ok ? undefined : `${STYLE_NAMES[style]} is not a great fit here.`) }
    },
  }
}

export const styleConsistencyCheck: Check = {
  id: 'style-consistency',
  title: 'Diagram matches the declared style',
  category: 'bonus',
  why: 'A decision that is not reflected in the design is just a wish. Reviewers will compare your ADR with the diagram.',
  hint: 'Modular monolith → one Application with Modules inside. Microservices → several independent services.',
  concepts: ['modular-monolith', 'microservices'],
  test: (g) => {
    const style = g.decisions.style
    if (!style) return { pass: false, detail: 'Declare a style first.' }
    const services = g.count('service')
    const monoliths = g.ofKind('monolith')
    const modules = g.count('module')
    switch (style) {
      case 'monolith':
        return { pass: monoliths.length + services <= 2, detail: services > 1 ? `${services} services drawn for a monolith.` : undefined }
      case 'modular-monolith':
        return {
          pass: monoliths.length >= 1 && modules >= 2 && services <= 1,
          detail: modules < 2 ? 'Add an Application container with at least two Modules inside.' : services > 1 ? 'Too many separately deployed services for a modular monolith.' : undefined,
        }
      case 'microservices':
      case 'event-driven':
        return {
          pass: services >= 3 && (style !== 'event-driven' || g.has('broker')),
          detail: services < 3 ? 'Microservices need several independently deployable services.' : style === 'event-driven' && !g.has('broker') ? 'Event-driven design needs a broker / event bus.' : undefined,
        }
      case 'serverless':
        return { pass: g.count('function') >= 2, detail: 'Use serverless functions for the compute.' }
    }
  },
}

export const techChoicesCheck: Check = {
  id: 'tech-choices',
  title: 'Concrete technologies chosen',
  category: 'bonus',
  why: 'Boxes become real once you commit to technology — it exposes trade-offs (e.g. Kafka replay vs RabbitMQ routing, Postgres ACID vs Mongo flexibility).',
  hint: 'Select components and choose a technology in the inspector, or set stack preferences in Decisions and click "Apply to diagram".',
  test: (g) => {
    const techable = g.nodes.filter((n) => n.kind !== 'zone')
    if (!techable.length) return false
    const withTech = techable.filter((n) => n.tech).length
    const ratio = withTech / techable.length
    return { pass: ratio >= 0.8, detail: `${withTech}/${techable.length} components have a technology.` }
  },
}

export const noClientToDataCheck: Check = {
  id: 'anti-client-db',
  title: 'Clients never talk to databases directly',
  category: 'antipattern',
  why: 'Exposing a database to browsers or apps bypasses validation, authorisation and business rules, and couples clients to your schema forever.',
  hint: 'Route client traffic through an API (gateway / BFF / service) instead.',
  concepts: ['api-gateway'],
  test: (g) => {
    const bad = g.clientsTouchingData()
    return { pass: bad.length === 0, detail: bad.length ? `${bad.map((b) => b.label).join(', ')} access a data store directly.` : undefined }
  },
}

export const noSharedDbCheck: Check = {
  id: 'anti-shared-db',
  title: 'No database shared between services',
  category: 'antipattern',
  why: 'A shared database is a hidden coupling: one team’s migration breaks another service, and you lose independent deployability — a "distributed monolith".',
  hint: 'Give each service its own database (or schema with strict ownership) and share data via APIs or events.',
  concepts: ['database-per-service'],
  test: (g) => {
    const shared = g.sharedDatabases()
    return {
      pass: shared.length === 0,
      detail: shared.length ? shared.map((s) => `${s.store.label} ← ${s.services.map((x) => x.label).join(', ')}`).join('; ') : undefined,
    }
  },
}

export function syncChainCheck(max = 3): Check {
  return {
    id: 'anti-sync-chain',
    title: `Synchronous call chains ≤ ${max} hops`,
    category: 'antipattern',
    why: 'Each synchronous hop multiplies latency and failure probability (availability = product of all hops). Long chains create cascading failures.',
    hint: 'Break long chains with events, caching, or by moving data closer to the caller.',
    concepts: ['circuit-breaker', 'event-driven'],
    test: (g) => {
      const chain = g.longestSyncChain()
      const hops = Math.max(0, chain.length - 1)
      return { pass: hops <= max, detail: hops > max ? `Chain: ${chain.map((c) => c.label).join(' → ')}` : undefined }
    },
  }
}

export function genericChecks(s: Scenario): Check[] {
  return [domainsCheck(s), styleCheck(s), styleConsistencyCheck, techChoicesCheck, noClientToDataCheck, noSharedDbCheck, syncChainCheck()]
}

// ---------------------------------------------------------------------------
// Lint — informational, never scored
// ---------------------------------------------------------------------------

export function lint(g: Graph): LintIssue[] {
  const issues: LintIssue[] = []
  const orphans = g.nodes.filter((n) => {
    if (n.kind === 'zone' || n.kind === 'monolith') return false
    if (g.neighbours(n.id).length) return false
    if (n.kind === 'module' && n.parentId) return false
    return true
  })
  if (orphans.length)
    issues.push({
      id: 'orphans',
      message: `${orphans.length} component${orphans.length > 1 ? 's are' : ' is'} not connected to anything.`,
      nodeIds: orphans.map((o) => o.id),
    })
  const ownerless = g.ofKind('service', 'module').filter((n) => n.domains.length === 0)
  if (ownerless.length)
    issues.push({
      id: 'ownerless',
      message: `${ownerless.length} service/module${ownerless.length > 1 ? 's have' : ' has'} no business capability assigned.`,
      nodeIds: ownerless.map((o) => o.id),
    })
  const strayModules = g.ofKind('module').filter((m) => g.parent(m)?.kind !== 'monolith')
  if (strayModules.length)
    issues.push({
      id: 'stray-modules',
      message: 'Modules should live inside an Application (drag them into the container).',
      nodeIds: strayModules.map((m) => m.id),
    })
  const godService = g.ofKind('service').find((n) => n.domains.length >= 4)
  if (godService)
    issues.push({
      id: 'god-service',
      message: `"${godService.label}" owns ${godService.domains.length} capabilities — is it really a microservice?`,
      nodeIds: [godService.id],
    })
  const computeNoTelemetry = g.has('otel-collector', 'logging', 'metrics', 'tracing')
    ? g.ofKind(...COMPUTE_KINDS).filter((n) => n.kind !== 'module' && !g.instrumented().includes(n))
    : []
  if (computeNoTelemetry.length)
    issues.push({
      id: 'uninstrumented',
      message: `${computeNoTelemetry.length} compute component${computeNoTelemetry.length > 1 ? 's do' : ' does'} not export telemetry.`,
      nodeIds: computeNoTelemetry.map((n) => n.id),
    })
  return issues
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const WEIGHTS = { core: 10, bonus: 4, antipattern: 8 }

export function runChecks(checks: Check[], g: Graph): CheckResult[] {
  return checks.map((c) => {
    let outcome: { pass: boolean; detail?: string }
    try {
      const raw = c.test(g)
      outcome = typeof raw === 'boolean' ? { pass: raw } : raw
    } catch (err) {
      outcome = { pass: false, detail: `Check failed to run: ${(err as Error).message}` }
    }
    return {
      id: c.id,
      title: c.title,
      category: c.category,
      pass: outcome.pass,
      detail: outcome.detail,
      why: c.why,
      hint: c.hint,
      concepts: c.concepts ?? [],
    }
  })
}

export function score(results: CheckResult[]): Pick<Evaluation, 'score' | 'passed'> {
  let possible = 0
  let earned = 0
  let penalty = 0
  for (const r of results) {
    if (r.category === 'antipattern') {
      if (!r.pass) penalty += WEIGHTS.antipattern
      continue
    }
    possible += WEIGHTS[r.category]
    if (r.pass) earned += WEIGHTS[r.category]
  }
  const raw = possible ? (earned / possible) * 100 : 0
  const value = Math.max(0, Math.min(100, Math.round(raw - penalty)))
  const coreOk = results.filter((r) => r.category === 'core').every((r) => r.pass)
  const passed = coreOk && value >= 70
  return { score: value, passed }
}

export function evaluateScenario(s: Scenario, diagram: Diagram, decisions: Decisions): Evaluation {
  const g = new Graph(diagram, decisions)
  const results = runChecks([...s.checks, ...genericChecks(s)], g)
  return { ...score(results), results: sortResults(results), lint: lint(g), evaluatedAt: Date.now() }
}

/** Sandbox mode: only generic anti-patterns and lint. */
export function evaluateSandbox(diagram: Diagram, decisions: Decisions): Evaluation {
  const g = new Graph(diagram, decisions)
  const results = runChecks([styleConsistencyCheck, techChoicesCheck, noClientToDataCheck, noSharedDbCheck, syncChainCheck()], g)
  return { ...score(results), results: sortResults(results), lint: lint(g), evaluatedAt: Date.now() }
}

const ORDER = { core: 0, antipattern: 1, bonus: 2 }
function sortResults(r: CheckResult[]) {
  return [...r].sort((a, b) => ORDER[a.category] - ORDER[b.category])
}

export function kindName(kind: keyof typeof COMPONENT_BY_KIND) {
  return COMPONENT_BY_KIND[kind]?.name ?? kind
}

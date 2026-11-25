import { describe, expect, it } from 'vitest'
import { assertScenarioContract, layoutProblems } from '../../engine/scenarioContract'
import { evaluateScenario } from '../../engine/evaluate'
import type { Decisions, Diagram, DiagramEdge, DiagramNode } from '../../engine/types'
import { diagram, type NodeSpec } from './builder'
import { payrollPlugins } from './payroll'

const ref = payrollPlugins.reference

function results(d: Diagram, decisions: Decisions = ref.decisions) {
  const ev = evaluateScenario(payrollPlugins, d, decisions)
  return { ev, pass: (id: string) => ev.results.find((r) => r.id === id)?.pass, detail: (id: string) => ev.results.find((r) => r.id === id)?.detail }
}

/** Copy of the reference with some nodes removed / retouched / added and some edges dropped / added. */
function mutate(opts: {
  dropNodes?: string[]
  dropEdges?: (e: DiagramEdge) => boolean
  addEdges?: DiagramEdge[]
  addNodes?: NodeSpec[]
  patch?: Record<string, Partial<DiagramNode>>
}): Diagram {
  const drop = new Set(opts.dropNodes ?? [])
  const added = diagram(opts.addNodes ?? [], []).nodes
  const nodes = [...ref.diagram.nodes.filter((n) => !drop.has(n.id)).map((n) => ({ ...n, ...(opts.patch?.[n.id] ?? {}) })), ...added]
  const edges = ref.diagram.edges
    .filter((e) => !drop.has(e.source) && !drop.has(e.target))
    .filter((e) => !(opts.dropEdges?.(e) ?? false))
  return { nodes, edges: [...edges, ...(opts.addEdges ?? [])] }
}

const failing = (d: Diagram, decisions: Decisions = ref.decisions) =>
  evaluateScenario(payrollPlugins, d, decisions)
    .results.filter((r) => !r.pass)
    .map((r) => r.id)
    .sort()

const failingCore = (d: Diagram, decisions: Decisions = ref.decisions) =>
  evaluateScenario(payrollPlugins, d, decisions)
    .results.filter((r) => (r.category === 'core' || r.category === 'antipattern') && !r.pass)
    .map((r) => `${r.id}: ${r.detail ?? ''}`)

const isEdge = (source: string, target: string) => (e: DiagramEdge) => e.source === source && e.target === target

const edge = (source: string, target: string, protocol: DiagramEdge['protocol'], label?: string): DiagramEdge => ({
  id: `x-${source}-${target}-${protocol}`,
  source,
  target,
  protocol,
  label,
})

const COUNTRIES = ['pl', 'cz', 'lt', 'de']

describe('placa-payroll-plugins', () => {
  assertScenarioContract(payrollPlugins)

  it('reference stays within the beginner size budget', () => {
    expect(ref.diagram.nodes.length).toBeGreaterThanOrEqual(12)
    expect(ref.diagram.nodes.length).toBeLessThanOrEqual(22)
  })

  it('starter fails because country rules are a module with country switches', () => {
    const { pass } = results(payrollPlugins.starter!, payrollPlugins.starterDecisions)
    expect(pass('rules-as-plugins')).toBe(false)
    expect(pass('core-owns-run')).toBe(false)
    expect(pass('gov-filing-via-plugins')).toBe(false)
  })

  // --- rules-as-plugins ------------------------------------------------------

  it('mistake: country rules as modules (a modular monolith)', () => {
    const patch = Object.fromEntries(COUNTRIES.map((c) => [c, { kind: 'module' as const, tech: 'spring-boot' }]))
    const { ev, pass } = results(mutate({ patch }), { ...ref.decisions, style: 'modular-monolith' })
    expect(pass('rules-as-plugins')).toBe(false)
    expect(pass('core-owns-run')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('mistake: a microservice per country', () => {
    const patch = Object.fromEntries(
      COUNTRIES.map((c, i) => [c, { kind: 'service' as const, tech: 'spring-boot', parentId: undefined, x: 1200, y: 600 + i * 90 }]),
    )
    const { ev, pass } = results(mutate({ patch }))
    expect(pass('rules-as-plugins')).toBe(false)
    expect(pass('core-owns-run')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('mistake: only two country plug-ins — Lithuania and Germany are folded into the core', () => {
    const d = mutate({ dropNodes: ['lt', 'de', 'sodra', 'elster'] })
    const { pass, detail } = results(d)
    expect(pass('rules-as-plugins')).toBe(false)
    expect(detail('rules-as-plugins')).toMatch(/2 country plug-ins/)
  })

  it('mistake: country plug-ins live in a second application, not in the core', () => {
    const patch = Object.fromEntries(COUNTRIES.map((c) => [c, { parentId: 'rulesApp' }]))
    const d = mutate({ patch, addNodes: [['rulesApp', 'monolith', 'Rules Server', 560, 800, { tech: 'spring-boot', w: 540, h: 420 }]] })
    expect(results(d).pass('rules-as-plugins')).toBe(false)
  })

  it('mistake: the payroll run is a separate service', () => {
    const d = mutate({ patch: { run: { kind: 'service', parentId: undefined, x: 300, y: 600 } } })
    const { pass, detail } = results(d)
    expect(pass('rules-as-plugins')).toBe(false)
    expect(detail('rules-as-plugins')).toMatch(/separate service/)
    expect(pass('core-owns-run')).toBe(false)
  })

  // --- core-owns-run ---------------------------------------------------------

  it('mistake: the core keeps a shared Tax Engine module with country switches', () => {
    const d = mutate({
      addNodes: [['taxEngine', 'module', 'Tax Engine (shared)', 30, 250, { parent: 'app', tech: 'spring-boot', domains: ['country-rules'] }]],
      addEdges: [edge('run', 'taxEngine', 'http', 'if country…')],
    })
    const { ev, pass } = results(d)
    expect(pass('rules-as-plugins')).toBe(true)
    expect(pass('core-owns-run')).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('mistake: the payroll run is moved into a plug-in', () => {
    const d = mutate({ patch: { run: { kind: 'plugin', tech: 'pf4j' } } })
    const { pass } = results(d)
    expect(pass('core-owns-run')).toBe(false)
    expect(pass('rules-as-plugins')).toBe(false)
  })

  it('alternative: the core Application owns the run itself, without modules', () => {
    const d = mutate({
      dropNodes: ['employees', 'run'],
      patch: { app: { domains: ['employees', 'payroll-run'] } },
      addEdges: [
        edge('app', 'db', 'data'),
        ...COUNTRIES.map((c) => edge('app', c, 'http', 'calculate / file')),
        edge('app', 'bonus', 'http'),
      ],
    })
    expect(failingCore(d)).toEqual([])
  })

  // --- core-payroll-store ----------------------------------------------------

  it('mistake: payroll runs stored in a schemaless document store', () => {
    const d = mutate({ patch: { db: { kind: 'document-db', tech: 'mongodb' } } })
    const { pass } = results(d)
    expect(pass('core-payroll-store')).toBe(false)
  })

  it('mistake: the payroll run is never stored', () => {
    const d = mutate({ dropEdges: isEdge('run', 'db') })
    expect(results(d).pass('core-payroll-store')).toBe(false)
  })

  it('alternative: the data edge is drawn from the core container', () => {
    const d = mutate({ dropEdges: isEdge('run', 'db'), addEdges: [edge('app', 'db', 'data')] })
    expect(results(d).pass('core-payroll-store')).toBe(true)
  })

  // --- gov-filing-via-plugins -----------------------------------------------

  it('mistake: a core Filing module talks to every government system', () => {
    const d = mutate({
      dropEdges: (e) => COUNTRIES.includes(e.source) && e.target !== 'db',
      patch: Object.fromEntries(COUNTRIES.map((c) => [c, { domains: ['country-rules'] }])),
      addNodes: [['filing', 'module', 'Filing', 30, 250, { parent: 'app', tech: 'spring-boot', domains: ['gov-filing'] }]],
      addEdges: ['zus', 'cssz', 'sodra', 'elster'].map((g) => edge('filing', g, 'http')),
    })
    const { ev, pass } = results(d)
    expect(pass('gov-filing-via-plugins')).toBe(false)
    expect(pass('rules-as-plugins')).toBe(true)
    expect(ev.passed).toBe(false)
  })

  it('mistake: plug-ins own filings but the core calls ZUS directly', () => {
    const d = mutate({ addEdges: [edge('run', 'zus', 'http', 'quick fix')] })
    const { pass, detail } = results(d)
    expect(pass('gov-filing-via-plugins')).toBe(false)
    expect(detail('gov-filing-via-plugins')).toMatch(/Payroll Run/)
  })

  it('mistake: no government systems drawn', () => {
    const d = mutate({ dropNodes: ['zus', 'cssz', 'sodra', 'elster'] })
    expect(results(d).pass('gov-filing-via-plugins')).toBe(false)
  })

  it('alternative: ELSTER and the GKV communication server drawn as two externals', () => {
    const d = mutate({
      patch: { elster: { label: 'ELSTER' } },
      addNodes: [['gkv', 'external', 'GKV Kommunikationsserver', 1200, 450, { tech: 'generic-api' }]],
      addEdges: [edge('de', 'gkv', 'http', 'DEÜV notifications')],
    })
    expect(failing(d)).toEqual([])
  })

  it('mistake: the core calls the GKV communication server directly', () => {
    const d = mutate({
      addNodes: [['gkv', 'external', 'GKV Kommunikationsserver', 1200, 450, { tech: 'generic-api' }]],
      addEdges: [edge('run', 'gkv', 'http')],
    })
    expect(results(d).pass('gov-filing-via-plugins')).toBe(false)
    expect(results(d).detail('gov-filing-via-plugins')).toMatch(/Payroll Run/)
  })

  it('alternative: plug-ins file through an outbound egress proxy', () => {
    const govs = ['zus', 'cssz', 'sodra', 'elster']
    const d = mutate({
      dropEdges: (e) => govs.includes(e.target),
      addNodes: [['egress', 'api-gateway', 'Egress Proxy (mTLS)', 1200, 520, { tech: 'envoy' }]],
      addEdges: [...COUNTRIES.map((c) => edge(c, 'egress', 'http')), ...govs.map((g) => edge('egress', g, 'http'))],
    })
    expect(failingCore(d)).toEqual([])
  })

  // --- antipatterns ----------------------------------------------------------

  it('mistake: the Czech plug-in calls the Polish one to reuse rates', () => {
    const d = mutate({ addEdges: [edge('cz', 'pl', 'http', 'reuse rate table')] })
    const { pass, detail } = results(d)
    expect(pass('anti-plugin-crosstalk')).toBe(false)
    expect(detail('anti-plugin-crosstalk')).toMatch(/Czechia → Poland/)
  })

  it('mistake: plug-ins exchange events directly', () => {
    const d = mutate({ addEdges: [edge('lt', 'de', 'event', 'rates changed')] })
    expect(results(d).pass('anti-plugin-crosstalk')).toBe(false)
  })

  it('mistake: a plug-in reads the core payroll database', () => {
    const d = mutate({ addEdges: [edge('pl', 'db', 'data', 'SELECT * FROM contracts')] })
    const { pass } = results(d)
    expect(pass('anti-plugin-shared-data')).toBe(false)
    expect(pass('anti-shared-db')).toBe(true) // same deployable, so the generic check cannot see it
  })

  it('mistake: country plug-ins share one tax-tables database', () => {
    const d = mutate({
      addNodes: [['rates', 'relational-db', 'Tax Tables', 1200, 680, { tech: 'postgres' }]],
      addEdges: [edge('pl', 'rates', 'data'), edge('cz', 'rates', 'data')],
    })
    expect(results(d).pass('anti-plugin-shared-data')).toBe(false)
  })

  it('alternative: a plug-in keeps a private store nobody else touches', () => {
    const d = mutate({
      addNodes: [['deRates', 'document-db', 'DE Tax Tables', 1200, 680, { tech: 'mongodb' }]],
      addEdges: [edge('de', 'deRates', 'data')],
    })
    expect(failing(d)).toEqual([])
  })

  // --- bonus checks ----------------------------------------------------------

  it('bonus: customer formulas in a plain PF4J plug-in lose only the sandbox bonus', () => {
    expect(failing(mutate({ patch: { bonus: { tech: 'pf4j' } } }))).toEqual(['sandboxed-customer-rules'])
  })

  it('bonus: a Drools plug-in limited to DMN decision tables counts as safe', () => {
    const bonus = { tech: 'drools', notes: 'BonusRules SPI v1 · customers edit DMN decision tables / FEEL only — no DRL, no Java' }
    expect(failing(mutate({ patch: { bonus } }))).toEqual([])
  })

  it('bonus: a Drools plug-in without the DMN restriction is not a sandbox (DRL runs arbitrary Java)', () => {
    const d = mutate({ patch: { bonus: { tech: 'drools', notes: 'BonusRules SPI v1 · customer DRL rules' } } })
    expect(failing(d)).toEqual(['sandboxed-customer-rules'])
    expect(results(d).detail('sandboxed-customer-rules')).toMatch(/DMN/)
  })

  it('bonus: a Drools plug-in mixing DMN tables with customer DRL is not safe', () => {
    const d = mutate({ patch: { bonus: { tech: 'drools', notes: 'BonusRules SPI v1 · DMN tables plus customer DRL' } } })
    expect(failing(d)).toEqual(['sandboxed-customer-rules'])
  })

  it('bonus: negated or look-alike DMN wording does not count as declarative-only', () => {
    for (const notes of ['BonusRules SPI v1 · customers write DRL, not DMN', 'BonusRules SPI v1 · feel free to write DRL with Java']) {
      expect(failing(mutate({ patch: { bonus: { tech: 'drools', notes } } }))).toEqual(['sandboxed-customer-rules'])
    }
  })

  it('bonus: a second, unsandboxed custom-rules plug-in loses the sandbox bonus', () => {
    const d = mutate({
      addNodes: [['commission', 'plugin', 'Commission Formulas', 30, 245, { parent: 'app', tech: 'pf4j', domains: ['custom-rules'], notes: 'BonusRules SPI v1' }]],
      addEdges: [edge('run', 'commission', 'http', 'commission(employee, period)')],
    })
    expect(layoutProblems(d)).toEqual([])
    expect(failing(d)).toEqual(['sandboxed-customer-rules'])
    expect(results(d).detail('sandboxed-customer-rules')).toMatch(/Commission Formulas/)
    expect(results(d).detail('sandboxed-customer-rules')).not.toMatch(/Custom Bonus Rules/)
  })

  it('bonus: a DMN label alone also satisfies the rules-engine route', () => {
    expect(failing(mutate({ patch: { bonus: { tech: 'drools', label: 'Custom Bonus Rules (DMN)' } } }))).toEqual([])
  })

  it('bonus: a sandbox plug-in needs no DMN note', () => {
    expect(failing(mutate({ patch: { bonus: { notes: 'BonusRules SPI v1' } } }))).toEqual([])
  })

  it('bonus: customer formulas run in a core module', () => {
    const d = mutate({ patch: { bonus: { kind: 'module', tech: 'spring-boot' } } })
    expect(failing(d)).toEqual(['sandboxed-customer-rules'])
  })

  it('bonus: no plug-in registry', () => {
    expect(failing(mutate({ dropNodes: ['registry'] }))).toEqual(['plugin-registry'])
  })

  it('bonus: plug-ins without a contract version', () => {
    const patch = Object.fromEntries([...COUNTRIES, 'bonus'].map((c) => [c, { notes: undefined }]))
    expect(failing(mutate({ patch }))).toEqual(['versioned-plugin-contract'])
  })

  it('bonus: OSGi bundles carry versioned contracts without notes', () => {
    const patch = Object.fromEntries(COUNTRIES.map((c) => [c, { notes: undefined, tech: 'osgi' }]))
    expect(failing(mutate({ patch: { ...patch, bonus: { notes: 'BonusRules contract v1' } } }))).toEqual([])
  })

  it('bonus: no metrics', () => {
    expect(failing(mutate({ dropNodes: ['metrics'] }))).toEqual(['ops-visibility'])
  })

  it('a single-node odd graph does not throw', () => {
    const d = diagram([['x', 'plugin', 'Lone plug-in', 0, 0]], [])
    const { ev } = results(d, { stack: {} })
    expect(ev.results.every((r) => !r.detail?.startsWith('Check failed to run'))).toBe(true)
    expect(ev.passed).toBe(false)
  })
})

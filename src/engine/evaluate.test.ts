import { describe, expect, it } from 'vitest'
import { SCENARIOS } from '../data/scenarios'
import { evaluateScenario } from './evaluate'
import { assertScenarioContract } from './scenarioContract'

describe('scenario contract', () => {
  for (const s of SCENARIOS) assertScenarioContract(s)
  it('scenario ids are unique', () => {
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length)
  })
})

describe('anti-patterns', () => {
  it('flags a shared database between services', async () => {
    const { diagram } = await import('../data/scenarios/builder')
    const d = diagram(
      [
        ['a', 'service', 'A', 0, 0],
        ['b', 'service', 'B', 0, 0],
        ['db', 'relational-db', 'DB', 0, 0],
      ],
      [
        ['a', 'db'],
        ['b', 'db'],
      ],
    )
    const ev = evaluateScenario(SCENARIOS[0], d, { stack: {} })
    expect(ev.results.find((r) => r.id === 'anti-shared-db')?.pass).toBe(false)
  })

  it('flags clients talking to databases', async () => {
    const { diagram } = await import('../data/scenarios/builder')
    const d = diagram(
      [
        ['w', 'web-app', 'Web', 0, 0],
        ['db', 'relational-db', 'DB', 0, 0],
      ],
      [['w', 'db']],
    )
    const ev = evaluateScenario(SCENARIOS[0], d, { stack: {} })
    expect(ev.results.find((r) => r.id === 'anti-client-db')?.pass).toBe(false)
  })
})

describe('concept references', () => {
  it('every referenced concept exists', async () => {
    const { CONCEPT_BY_ID, CONCEPTS } = await import('../data/concepts')
    const { genericChecks } = await import('./evaluate')
    const refs = new Set<string>()
    for (const s of SCENARIOS) {
      s.concepts.forEach((c) => refs.add(c))
      ;[...s.checks, ...genericChecks(s)].forEach((c) => c.concepts?.forEach((x) => refs.add(x)))
    }
    CONCEPTS.forEach((c) => c.related.forEach((r) => refs.add(r)))
    const missing = [...refs].filter((r) => !CONCEPT_BY_ID[r])
    expect(missing).toEqual([])
  })
})

describe('component details', () => {
  it('reference existing concepts', async () => {
    const { COMPONENT_DETAILS } = await import('../data/componentDetails')
    const { CONCEPT_BY_ID } = await import('../data/concepts')
    const missing = Object.entries(COMPONENT_DETAILS).flatMap(([k, d]) => (d.concepts ?? []).filter((c) => !CONCEPT_BY_ID[c]).map((c) => `${k}:${c}`))
    expect(missing).toEqual([])
  })
})

describe('graph engine', () => {
  it('asyncFlow relays through a worker after a broker', async () => {
    const { diagram } = await import('../data/scenarios/builder')
    const { Graph } = await import('./graph')
    const g = new Graph(
      diagram(
        [
          ['posts', 'service', 'Posts', 0, 0],
          ['bus', 'broker', 'Bus', 0, 0],
          ['idx', 'worker', 'Indexer', 0, 0],
          ['os', 'search', 'Index', 0, 0],
        ],
        [
          ['posts', 'bus', 'event'],
          ['bus', 'idx', 'event'],
          ['idx', 'os', 'data'],
        ],
      ),
    )
    expect(g.asyncFlow([g.node('posts')!], [g.node('os')!])).toBe(true)
  })

  it('asyncFlow accepts a component consuming its own queue', async () => {
    const { diagram } = await import('../data/scenarios/builder')
    const { Graph } = await import('./graph')
    const g = new Graph(diagram([['app', 'monolith', 'App', 0, 0], ['q', 'broker', 'Queue', 0, 0]], [['app', 'q', 'event'], ['q', 'app', 'event']]))
    const app = g.node('app')!
    expect(g.asyncFlow([app], [app])).toBe(true)
  })

  it('in-process module calls are not sync network hops', async () => {
    const { diagram } = await import('../data/scenarios/builder')
    const { Graph } = await import('./graph')
    const g = new Graph(
      diagram(
        [
          ['app', 'monolith', 'App', 0, 0],
          ['a', 'module', 'A', 0, 0, { parent: 'app' }],
          ['b', 'module', 'B', 0, 0, { parent: 'app' }],
          ['c', 'module', 'C', 0, 0, { parent: 'app' }],
          ['d', 'module', 'D', 0, 0, { parent: 'app' }],
          ['e', 'module', 'E', 0, 0, { parent: 'app' }],
        ],
        [['a', 'b', 'http'], ['b', 'c', 'http'], ['c', 'd', 'http'], ['d', 'e', 'http']],
      ),
    )
    expect(g.longestSyncChain().length).toBeLessThanOrEqual(1)
  })

  it('clientsEnterThrough rejects clients bypassing the entry point', async () => {
    const { diagram } = await import('../data/scenarios/builder')
    const { Graph } = await import('./graph')
    const ok = new Graph(diagram([['w', 'web-app', 'Web', 0, 0], ['cdn', 'cdn', 'CDN', 0, 0], ['gw', 'api-gateway', 'GW', 0, 0], ['s', 'service', 'S', 0, 0]], [['w', 'cdn'], ['cdn', 'gw'], ['gw', 's']]))
    expect(ok.clientsEnterThrough(['api-gateway']).pass).toBe(true)
    const bad = new Graph(diagram([['w', 'web-app', 'Web', 0, 0], ['gw', 'api-gateway', 'GW', 0, 0], ['s', 'service', 'S', 0, 0]], [['w', 'gw'], ['w', 's', 'http'], ['gw', 's']]))
    expect(bad.clientsEnterThrough(['api-gateway']).pass).toBe(false)
  })
})

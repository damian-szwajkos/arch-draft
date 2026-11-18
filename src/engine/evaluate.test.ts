import { describe, expect, it } from 'vitest'
import { SCENARIOS } from '../data/scenarios'
import { COMPONENT_BY_KIND } from '../data/components'
import { TECH_BY_ID } from '../data/tech'
import { evaluateScenario } from './evaluate'

describe('scenario reference solutions', () => {
  for (const s of SCENARIOS) {
    it(`${s.id}: reference passes with a perfect score`, () => {
      const ev = evaluateScenario(s, s.reference.diagram, s.reference.decisions)
      const failed = ev.results.filter((r) => !r.pass).map((r) => `${r.category}:${r.id} ${r.detail ?? ''}`)
      expect(failed, failed.join('\n')).toEqual([])
      expect(ev.score).toBe(100)
      expect(ev.passed).toBe(true)
    })

    it(`${s.id}: empty canvas fails`, () => {
      const ev = evaluateScenario(s, { nodes: [], edges: [] }, { stack: {} })
      expect(ev.passed).toBe(false)
    })

    it(`${s.id}: starter (if any) does not pass`, () => {
      if (!s.starter) return
      const ev = evaluateScenario(s, s.starter, s.starterDecisions ?? { stack: {} })
      expect(ev.passed).toBe(false)
    })

    it(`${s.id}: data references are valid`, () => {
      const domainIds = new Set(s.domains.map((d) => d.id))
      for (const n of s.reference.diagram.nodes) {
        expect(COMPONENT_BY_KIND[n.kind], n.kind).toBeTruthy()
        if (n.tech) {
          expect(TECH_BY_ID[n.tech], `${n.id} tech ${n.tech}`).toBeTruthy()
          expect(TECH_BY_ID[n.tech].kinds, `${n.id}: ${n.tech} on ${n.kind}`).toContain(n.kind)
        }
        for (const d of n.domains) expect(domainIds.has(d), `${n.id} domain ${d}`).toBe(true)
      }
      const ids = new Set(s.reference.diagram.nodes.map((n) => n.id))
      expect(ids.size).toBe(s.reference.diagram.nodes.length)
    })
  }
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

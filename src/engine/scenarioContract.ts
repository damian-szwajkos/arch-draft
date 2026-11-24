// Shared quality contract every scenario must satisfy. Used by the test suite
// (src/engine/evaluate.test.ts) and handy when authoring a single scenario:
//   assertScenarioContract(myScenario) inside a throw-away vitest file.
import { expect, it } from 'vitest'
import { COMPONENT_BY_KIND } from '../data/components'
import { CONCEPT_BY_ID } from '../data/concepts'
import { TECH_BY_ID } from '../data/tech'
import { evaluateScenario, genericChecks, STYLE_NAMES } from './evaluate'
import { CONTAINER_SIZE } from '../store/workspace'
import type { ArchStyle, Diagram, Scenario } from './types'

const STYLES = Object.keys(STYLE_NAMES) as ArchStyle[]

/** Overlapping siblings and children spilling out of their container (approximate node size 200×62). */
export function layoutProblems(d: Diagram): string[] {
  const box = (n: Diagram['nodes'][number]) => {
    const c = CONTAINER_SIZE[n.kind]
    return { x: n.x, y: n.y, w: n.width ?? c?.width ?? 200, h: n.height ?? c?.height ?? (n.kind === 'note' ? 90 : 62) }
  }
  const out: string[] = []
  const groups = new Map<string, Diagram['nodes']>()
  for (const n of d.nodes) groups.set(n.parentId ?? '', [...(groups.get(n.parentId ?? '') ?? []), n])
  for (const [parentId, list] of groups) {
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = box(list[i])
        const b = box(list[j])
        if (a.x < b.x + b.w + 8 && a.x + a.w + 8 > b.x && a.y < b.y + b.h + 8 && a.y + a.h + 8 > b.y) out.push(`${list[i].id} overlaps ${list[j].id}`)
      }
    const parent = d.nodes.find((n) => n.id === parentId)
    if (!parent) continue
    const pb = box(parent)
    for (const c of list) {
      const b = box(c)
      if (b.x < 0 || b.y < 30 || b.x + b.w > pb.w || b.y + b.h > pb.h) out.push(`${c.id} is outside its container ${parentId}`)
    }
  }
  return out
}

export function assertScenarioContract(s: Scenario) {
  it(`${s.id}: reference passes with a perfect score`, () => {
    const ev = evaluateScenario(s, s.reference.diagram, s.reference.decisions)
    const failed = ev.results.filter((r) => !r.pass).map((r) => `${r.category}:${r.id} ${r.detail ?? ''}`)
    expect(failed, failed.join('\n')).toEqual([])
    expect(ev.score).toBe(100)
    expect(ev.passed).toBe(true)
  })

  it(`${s.id}: empty canvas fails without throwing`, () => {
    const ev = evaluateScenario(s, { nodes: [], edges: [] }, { stack: {} })
    expect(ev.passed).toBe(false)
  })

  it(`${s.id}: starter (if any) does not pass`, () => {
    if (!s.starter) return
    const ev = evaluateScenario(s, s.starter, s.starterDecisions ?? { stack: {} })
    expect(ev.passed).toBe(false)
  })

  it(`${s.id}: a non-recommended style fails the style check`, () => {
    const wrong = STYLES.find((st) => !s.recommendedStyles.includes(st))
    if (!wrong) return
    const ev = evaluateScenario(s, s.reference.diagram, { ...s.reference.decisions, style: wrong })
    expect(ev.results.find((r) => r.id === 'style-fit')?.pass).toBe(false)
  })

  it(`${s.id}: content is complete`, () => {
    expect(s.id).toMatch(/^[a-z0-9-]+$/)
    expect(s.accent).toMatch(/^#[0-9a-f]{6}$/i)
    expect(s.facts.length).toBeGreaterThanOrEqual(3)
    expect(s.functional.length).toBeGreaterThanOrEqual(3)
    expect(s.nonFunctional.length).toBeGreaterThanOrEqual(3)
    expect(s.domains.length).toBeGreaterThanOrEqual(2)
    expect(s.hints.length).toBeGreaterThanOrEqual(3)
    expect(s.reference.walkthrough.length).toBeGreaterThanOrEqual(3)
    expect(s.recommendedStyles.length).toBeGreaterThan(0)
    for (const st of STYLES) expect(s.styleFeedback[st], `styleFeedback.${st}`).toBeTruthy()
    const cats = s.checks.map((c) => c.category)
    expect(cats.filter((c) => c === 'core').length, 'core checks').toBeGreaterThanOrEqual(3)
    expect(cats.filter((c) => c === 'bonus').length, 'bonus checks').toBeGreaterThanOrEqual(2)
    const ids = [...s.checks, ...genericChecks(s)].map((c) => c.id)
    expect(new Set(ids).size, 'unique check ids').toBe(ids.length)
  })

  it(`${s.id}: diagrams are laid out without overlaps`, () => {
    expect(layoutProblems(s.reference.diagram), 'reference').toEqual([])
    if (s.starter) expect(layoutProblems(s.starter), 'starter').toEqual([])
  })

  it(`${s.id}: data references are valid`, () => {
    const domainIds = new Set(s.domains.map((d) => d.id))
    expect(domainIds.size).toBe(s.domains.length)
    for (const c of s.concepts) expect(CONCEPT_BY_ID[c], `concept ${c}`).toBeTruthy()
    for (const c of s.checks) for (const x of c.concepts ?? []) expect(CONCEPT_BY_ID[x], `${c.id} concept ${x}`).toBeTruthy()
    const all = [s.reference.diagram, ...(s.starter ? [s.starter] : [])]
    for (const d of all) {
      const ids = new Set(d.nodes.map((n) => n.id))
      expect(ids.size, 'unique node ids').toBe(d.nodes.length)
      for (const n of d.nodes) {
        expect(COMPONENT_BY_KIND[n.kind], n.kind).toBeTruthy()
        if (n.tech) {
          expect(TECH_BY_ID[n.tech], `${n.id} tech ${n.tech}`).toBeTruthy()
          expect(TECH_BY_ID[n.tech].kinds, `${n.id}: ${n.tech} on ${n.kind}`).toContain(n.kind)
        }
        for (const dm of n.domains) expect(domainIds.has(dm), `${n.id} domain ${dm}`).toBe(true)
        if (n.parentId) expect(ids.has(n.parentId), `${n.id} parent ${n.parentId}`).toBe(true)
      }
    }
    const st = s.reference.decisions.stack
    for (const [k, v] of Object.entries(st)) if (v) expect(TECH_BY_ID[v], `stack.${k} ${v}`).toBeTruthy()
  })
}

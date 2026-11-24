import { describe, expect, it } from 'vitest'
import { CONCEPT_EXAMPLES } from './conceptExamples'
import { CONCEPTS, CONCEPT_BY_ID } from './concepts'

describe('CONCEPT_EXAMPLES', () => {
  it.each(CONCEPTS.map((c) => c.id))('%s has at least 2 groups of at least 2 items', (id) => {
    const groups = CONCEPT_EXAMPLES[id]
    expect(groups, `missing examples for ${id}`).toBeDefined()
    expect(groups.length).toBeGreaterThanOrEqual(2)
    for (const g of groups) {
      expect(g.label.trim()).not.toBe('')
      expect(g.items.length, `${id} / ${g.label}`).toBeGreaterThanOrEqual(2)
    }
  })

  it('has no entries for unknown concepts', () => {
    const unknown = Object.keys(CONCEPT_EXAMPLES).filter((k) => !CONCEPT_BY_ID[k])
    expect(unknown).toEqual([])
  })

  it('items have a name, a short note and an https url when present', () => {
    for (const [id, groups] of Object.entries(CONCEPT_EXAMPLES)) {
      for (const g of groups) {
        for (const item of g.items) {
          expect(item.name.trim(), `${id} / ${g.label}`).not.toBe('')
          expect(item.note.split(/\s+/).length, `${id} / ${item.name}`).toBeLessThanOrEqual(12)
          if (item.url) expect(item.url, `${id} / ${item.name}`).toMatch(/^https:\/\//)
        }
      }
    }
  })
})

import { describe, expect, it } from 'vitest'
import { ImportError, parseImport, summariseImport } from './importDiagram'

const file = (diagram: unknown, extra: Record<string, unknown> = {}) => ({ app: 'archdraft', version: 1, scenario: null, diagram, ...extra })

describe('parseImport', () => {
  it('rejects files that are not ArchDraft diagrams', () => {
    expect(() => parseImport(null)).toThrow(ImportError)
    expect(() => parseImport({ foo: 1 })).toThrow(ImportError)
    expect(() => parseImport({ app: 'other', diagram: { nodes: [], edges: [] } })).toThrow(ImportError)
    expect(() => parseImport(file({ nodes: [], edges: 'x' }))).toThrow(ImportError)
  })

  it('keeps a valid file intact and defaults missing fields', () => {
    const r = parseImport(
      file({
        nodes: [
          { id: 'a', kind: 'web-app', label: 'Web', x: 0, y: 0 },
          { id: 'b', kind: 'service', label: 'API', x: 200, y: 0, domains: ['orders', 3] },
        ],
        edges: [{ id: 'e1', source: 'a', target: 'b', protocol: 'http' }],
      }),
    )
    expect(r.skipped).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.diagram.nodes.map((n) => n.domains)).toEqual([[], ['orders']])
    expect(r.diagram.edges).toHaveLength(1)
    expect(r.decisions).toEqual({ stack: {} })
  })

  it('skips unknown kinds, bad positions and duplicate ids', () => {
    const r = parseImport(
      file({
        nodes: [
          { id: 'a', kind: 'web-app', label: 'Web', x: 0, y: 0 },
          { id: 'b', kind: 'flux-capacitor', label: 'Flux', x: 0, y: 0 },
          { id: 'c', kind: 'service', label: 'NaN', x: 'left', y: 0 },
          { id: 'a', kind: 'service', label: 'Dup', x: 0, y: 0 },
          'garbage',
        ],
        edges: [],
      }),
    )
    expect(r.diagram.nodes.map((n) => n.id)).toEqual(['a'])
    expect(r.skipped).toHaveLength(4)
    expect(r.skipped[0]).toContain('flux-capacitor')
  })

  it('drops edges with missing endpoints and fixes invalid protocols', () => {
    const r = parseImport(
      file({
        nodes: [
          { id: 'a', kind: 'service', label: 'A', x: 0, y: 0 },
          { id: 'b', kind: 'relational-db', label: 'DB', x: 0, y: 100 },
        ],
        edges: [
          { id: 'e1', source: 'a', target: 'zzz', protocol: 'http' },
          { id: 'e2', source: 'a', target: 'b', protocol: 'carrier-pigeon' },
          { id: 'e3', source: 'a', target: 'a', protocol: 'http' },
        ],
      }),
    )
    expect(r.diagram.edges).toEqual([{ id: 'e2', source: 'a', target: 'b', protocol: 'data' }])
    expect(r.skipped).toHaveLength(2)
    expect(r.warnings.join(' ')).toMatch(/protocol/)
  })

  it('removes invalid parents and orders parents before children', () => {
    const r = parseImport(
      file({
        nodes: [
          { id: 'child', kind: 'module', label: 'M', x: 10, y: 10, parentId: 'app' },
          { id: 'orphan', kind: 'service', label: 'S', x: 0, y: 0, parentId: 'ghost' },
          { id: 'inSvc', kind: 'service', label: 'S2', x: 0, y: 0, parentId: 'orphan' },
          { id: 'app', kind: 'monolith', label: 'App', x: 0, y: 0, width: 'wide' },
        ],
        edges: [],
      }),
    )
    const ids = r.diagram.nodes.map((n) => n.id)
    expect(ids.indexOf('app')).toBeLessThan(ids.indexOf('child'))
    expect(r.diagram.nodes.find((n) => n.id === 'child')?.parentId).toBe('app')
    expect(r.diagram.nodes.find((n) => n.id === 'orphan')?.parentId).toBeUndefined()
    expect(r.diagram.nodes.find((n) => n.id === 'inSvc')?.parentId).toBeUndefined()
    expect(r.diagram.nodes.find((n) => n.id === 'app')?.width).toBeUndefined()
  })

  it('breaks parent cycles', () => {
    const r = parseImport(
      file({
        nodes: [
          { id: 'z1', kind: 'zone', label: 'Z1', x: 0, y: 0, parentId: 'z2' },
          { id: 'z2', kind: 'zone', label: 'Z2', x: 0, y: 0, parentId: 'z1' },
        ],
      }),
    )
    expect(r.diagram.nodes.filter((n) => n.parentId)).toHaveLength(1)
    expect(r.diagram.edges).toEqual([])
  })

  it('normalises decisions', () => {
    const r = parseImport(file({ nodes: [], edges: [] }, { decisions: { style: 'microservices', communication: 'telepathy', stack: { backend: 'spring', bogus: 'x', cache: 5 } } }))
    expect(r.decisions).toEqual({ style: 'microservices', stack: { backend: 'spring' } })
    expect(parseImport(file({ nodes: [], edges: [] }, { decisions: { style: 'monolith' } })).decisions.stack).toEqual({})
  })

  it('warns when the file belongs to another scenario', () => {
    expect(parseImport(file({ nodes: [], edges: [] }, { scenario: 'shortener' }), 'shopfront').warnings[0]).toMatch(/shortener/)
    expect(parseImport(file({ nodes: [], edges: [] }, { scenario: null }), 'shopfront').warnings[0]).toMatch(/sandbox/)
    expect(parseImport(file({ nodes: [], edges: [] }, { scenario: 'shopfront' }), 'shopfront').warnings).toEqual([])
  })

  it('accepts a bare diagram and summarises the result', () => {
    const r = parseImport({ nodes: [{ id: 'a', kind: 'cache', x: 1, y: 2 }, { id: 'b', kind: '??', x: 0, y: 0 }] })
    expect(r.diagram.nodes[0].label).toBeTruthy()
    expect(summariseImport(r)).toMatch(/Loaded 1 component and 0 connections\. Skipped 1/)
  })
})

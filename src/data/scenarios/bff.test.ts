import { describe, expect, it } from 'vitest'
import { assertScenarioContract } from '../../engine/scenarioContract'
import { evaluateScenario } from '../../engine/evaluate'
import type { Decisions, Diagram, DiagramEdge, DiagramNode } from '../../engine/types'
import { diagram, type EdgeSpec, type NodeSpec } from './builder'
import { retailBff } from './bff'

const services: NodeSpec[] = [
  ['catalog', 'service', 'Catalog', 880, 0, { tech: 'spring-boot', domains: ['catalog'] }],
  ['pricing', 'service', 'Pricing', 880, 130, { tech: 'spring-boot', domains: ['pricing'] }],
  ['inventory', 'service', 'Inventory', 880, 260, { tech: 'spring-boot', domains: ['inventory'] }],
  ['reviews', 'service', 'Reviews', 880, 390, { tech: 'spring-boot', domains: ['reviews'] }],
  ['recs', 'service', 'Recommendations', 880, 520, { tech: 'fastapi', domains: ['recommendations'] }],
  ['catalogDb', 'relational-db', 'Catalog DB', 1180, 0, { tech: 'postgres' }],
  ['pricingDb', 'relational-db', 'Pricing DB', 1180, 130, { tech: 'postgres' }],
  ['inventoryDb', 'relational-db', 'Inventory DB', 1180, 260, { tech: 'postgres' }],
  ['reviewsDb', 'document-db', 'Reviews DB', 1180, 390, { tech: 'mongodb' }],
  ['recsDb', 'document-db', 'Recs DB', 1180, 520, { tech: 'dynamodb' }],
]
const serviceEdges: EdgeSpec[] = [
  ['catalog', 'catalogDb'],
  ['pricing', 'pricingDb'],
  ['inventory', 'inventoryDb'],
  ['reviews', 'reviewsDb'],
  ['recs', 'recsDb'],
]
const clients: NodeSpec[] = [
  ['web', 'web-app', 'Web', 0, 60, { tech: 'nextjs' }],
  ['mobile', 'mobile-app', 'Mobile', 0, 260, { tech: 'react-native' }],
  ['kiosk', 'web-app', 'Kiosk', 0, 440, { tech: 'react' }],
]
const allFive = (from: string): EdgeSpec[] => ['catalog', 'pricing', 'inventory', 'reviews', 'recs'].map((t): EdgeSpec => [from, t, 'http'])

const decisions: Decisions = { style: 'microservices', communication: 'sync', data: 'per-service', stack: {} }

const results = (d: Diagram, dec: Decisions = decisions) => {
  const ev = evaluateScenario(retailBff, d, dec)
  return { ev, byId: Object.fromEntries(ev.results.map((r) => [r.id, r])) }
}
const failedCore = (d: Diagram, dec: Decisions = decisions) =>
  results(d, dec).ev.results.filter((r) => r.category === 'core' && !r.pass).map((r) => r.id)
const failedAnti = (d: Diagram, dec: Decisions = decisions) =>
  results(d, dec).ev.results.filter((r) => r.category === 'antipattern' && !r.pass).map((r) => r.id)

const ref = retailBff.reference.diagram
const refDec = retailBff.reference.decisions
/** The reference with some edges removed, some added, and optionally node changes. */
function tweak(opts: { drop?: [string, string][]; add?: EdgeSpec[]; nodes?: NodeSpec[]; patch?: (n: DiagramNode) => DiagramNode }): Diagram {
  const drop = new Set((opts.drop ?? []).map(([a, b]) => `${a}>${b}`))
  const extra = diagram(
    [...ref.nodes.map((n): NodeSpec => [n.id, n.kind, n.label, n.x, n.y, { tech: n.tech, domains: n.domains }]), ...(opts.nodes ?? [])],
    opts.add ?? [],
  )
  const added = new Set((opts.nodes ?? []).map((n) => n[0]))
  return {
    nodes: [...ref.nodes.map(opts.patch ?? ((n) => n)), ...extra.nodes.filter((n) => added.has(n.id))],
    edges: [
      ...ref.edges.filter((e) => !drop.has(`${e.source}>${e.target}`)),
      ...extra.edges.map((e: DiagramEdge, i) => ({ ...e, id: `x${i}-${e.id}` })),
    ],
  }
}

describe('koszyk-bff', () => {
  assertScenarioContract(retailBff)

  it('starter trips the direct-call anti-pattern and lacks BFFs', () => {
    const { byId } = results(retailBff.starter!, { ...decisions, ...retailBff.starterDecisions! })
    expect(byId['anti-client-to-domain'].pass).toBe(false)
    expect(byId['bff-per-experience'].pass).toBe(false)
    expect(byId['gateway-in-front'].pass).toBe(false)
  })

  it('mistake: one shared "BFF" for all three frontends', () => {
    const d = diagram(
      [
        ...clients,
        ['cdn', 'cdn', 'CDN', 260, 60, { tech: 'cloudflare' }],
        ['gw', 'api-gateway', 'Gateway', 260, 260, { tech: 'kong' }],
        ['bff', 'bff', 'Shared BFF', 560, 260, { tech: 'nestjs' }],
        ...services,
      ],
      [['web', 'cdn'], ['cdn', 'gw'], ['mobile', 'gw'], ['kiosk', 'gw'], ['gw', 'bff'], ...allFive('bff'), ...serviceEdges],
    )
    const { byId } = results(d)
    expect(byId['bff-per-experience'].pass).toBe(false)
    expect(byId['kiosk-bff'].pass).toBe(false)
    expect(byId['anti-client-to-domain'].pass).toBe(true)
  })

  it('mistake: a gateway that only routes to domain services (no BFF)', () => {
    const d = diagram(
      [...clients, ['cdn', 'cdn', 'CDN', 260, 60, { tech: 'cloudflare' }], ['gw', 'api-gateway', 'Gateway', 260, 260, { tech: 'kong' }], ...services],
      [['web', 'cdn'], ['cdn', 'gw'], ['mobile', 'gw'], ['kiosk', 'gw'], ...allFive('gw'), ...serviceEdges],
    )
    const { byId, ev } = results(d)
    expect(byId['anti-client-to-domain'].pass).toBe(false)
    expect(byId['bff-per-experience'].pass).toBe(false)
    expect(byId['bff-aggregates'].pass).toBe(false)
    expect(ev.passed).toBe(false)
  })

  it('mistake: BFFs behind no gateway, and Catalog composes reviews & recommendations synchronously', () => {
    const d = diagram(
      [
        ...clients,
        ['cdn', 'cdn', 'CDN', 260, 60, { tech: 'cloudflare' }],
        ['webBff', 'bff', 'Web BFF', 560, 60, { tech: 'nextjs' }],
        ['mobileBff', 'bff', 'Mobile BFF', 560, 260, { tech: 'apollo' }],
        ['kioskBff', 'bff', 'Kiosk BFF', 560, 440, { tech: 'nestjs' }],
        ...services,
      ],
      [
        ['web', 'cdn'],
        ['cdn', 'webBff'],
        ['mobile', 'mobileBff'],
        ['kiosk', 'kioskBff'],
        ['webBff', 'catalog'],
        ['webBff', 'pricing'],
        ['mobileBff', 'catalog'],
        ['mobileBff', 'pricing'],
        ['mobileBff', 'inventory'],
        ['kioskBff', 'catalog'],
        ['kioskBff', 'inventory'],
        ['catalog', 'reviews', 'http'],
        ['catalog', 'recs', 'http'],
        ...serviceEdges,
      ],
    )
    const failed = failedCore(d)
    expect(failed).toContain('gateway-in-front')
    expect(failed).toContain('optional-degrade')
    expect(failed).toContain('bff-aggregates')
  })

  it('mistake: web storefront skips the CDN', () => {
    const ref = retailBff.reference.diagram
    const d: Diagram = {
      nodes: ref.nodes,
      edges: [...ref.edges.filter((e) => !(e.source === 'web' && e.target === 'cdn')), { id: 'x', source: 'web', target: 'gw', protocol: 'http' }],
    }
    expect(failedCore(d, retailBff.reference.decisions)).toEqual(['cdn-for-web'])
  })

  it('alternative: event-driven, WAF + Envoy + Keycloak, kiosk shares the web BFF, recs precomputed into a cache', () => {
    const d = diagram(
      [
        ['web', 'web-app', 'Storefront', 0, 60, { tech: 'nuxt' }],
        ['ios', 'mobile-app', 'iOS App', 0, 220, { tech: 'swiftui' }],
        ['android', 'mobile-app', 'Android App', 0, 340, { tech: 'jetpack-compose' }],
        ['kiosk', 'web-app', 'Kiosk', 0, 480, { tech: 'vue' }],
        ['waf', 'waf', 'WAF', 260, 0, { tech: 'aws-waf' }],
        ['cdn', 'cdn', 'CDN', 260, 120, { tech: 'cloudfront' }],
        ['gw', 'api-gateway', 'Gateway', 260, 300, { tech: 'envoy' }],
        ['idp', 'identity', 'Keycloak', 260, 460, { tech: 'keycloak' }],
        ['lb', 'load-balancer', 'Internal LB', 420, 300, { tech: 'aws-alb' }],
        ['webBff', 'bff', 'Web BFF', 600, 100, { tech: 'go' }],
        ['mobileBff', 'bff', 'Mobile BFF', 600, 300, { tech: 'spring-boot' }],
        ...services,
        ['recsCache', 'cache', 'Precomputed recs', 1180, 640, { tech: 'redis' }],
        ['kafka', 'broker', 'Product events', 1180, 760, { tech: 'kafka' }],
      ],
      [
        ['web', 'waf'],
        ['waf', 'cdn'],
        ['cdn', 'gw'],
        ['ios', 'gw'],
        ['android', 'gw'],
        ['kiosk', 'gw'],
        ['gw', 'idp', 'http'],
        ['gw', 'lb'],
        ['lb', 'webBff', 'graphql'],
        ['lb', 'mobileBff', 'http'],
        ['webBff', 'catalog', 'grpc'],
        ['webBff', 'pricing', 'grpc'],
        ['webBff', 'inventory', 'grpc'],
        ['webBff', 'reviews', 'grpc'],
        ['webBff', 'recsCache', 'data'],
        ['mobileBff', 'catalog', 'grpc'],
        ['mobileBff', 'pricing', 'grpc'],
        ['mobileBff', 'inventory', 'grpc'],
        ['mobileBff', 'reviews', 'grpc'],
        ['mobileBff', 'recs', 'grpc'],
        ['recs', 'recsCache', 'data'],
        ['catalog', 'kafka', 'event', 'ProductChanged'],
        ['kafka', 'recs', 'event'],
        ...serviceEdges,
      ],
    )
    const dec: Decisions = { style: 'event-driven', communication: 'hybrid', data: 'per-service', stack: {} }
    expect(failedCore(d, dec)).toEqual([])
    const { byId } = results(d, dec)
    expect(byId['anti-client-to-domain'].pass).toBe(true)
    expect(byId['anti-sync-chain'].pass).toBe(true)
    expect(byId['edge-security'].pass).toBe(true)
    expect(byId['ssr-seo'].pass).toBe(true)
    // kiosk shares the storefront BFF — legitimate, but misses the bonus
    expect(byId['kiosk-bff'].pass).toBe(false)
  })

  it('mistake: thin mobile BFF behind the shared gateway (web BFF covers all five)', () => {
    const d = tweak({ drop: [['mobileBff', 'inventory'], ['mobileBff', 'reviews'], ['mobileBff', 'recs']] })
    const { byId } = results(d, refDec)
    expect(byId['bff-aggregates'].pass).toBe(false)
    expect(byId['bff-aggregates'].detail).toMatch(/would have to share Web BFF/)
  })

  it('mistake: no single BFF covers all five — detail names what the best candidate misses', () => {
    const d = tweak({ drop: [['mobileBff', 'recs'], ['webBff', 'reviews']] })
    const { byId } = results(d, refDec)
    expect(byId['bff-aggregates'].pass).toBe(false)
    expect(byId['bff-aggregates'].detail).not.toMatch(/anything/)
    expect(byId['bff-aggregates'].detail).toMatch(/does not fetch (reviews|recommendations)/)
  })

  it('mistake: a BFF reads the Reviews team’s database directly', () => {
    const one = tweak({ drop: [['webBff', 'reviews']], add: [['webBff', 'reviewsDb', 'data']] })
    expect(failedAnti(one, refDec)).toContain('anti-bff-domain-db')
    // if every BFF does it, nobody calls Reviews through its API any more
    const both = tweak({ drop: [['webBff', 'reviews'], ['mobileBff', 'reviews']], add: [['webBff', 'reviewsDb', 'data'], ['mobileBff', 'reviewsDb', 'data']] })
    expect(failedCore(both, refDec)).toEqual(expect.arrayContaining(['optional-degrade', 'bff-aggregates']))
    expect(failedAnti(both, refDec)).toContain('anti-bff-domain-db')
  })

  it('mistake: dead-end CDN, and a CDN only in front of the kiosk', () => {
    const deadEnd = tweak({ drop: [['cdn', 'gw']], add: [['web', 'gw', 'http']] })
    expect(failedCore(deadEnd, refDec)).toEqual(['cdn-for-web'])
    const kioskOnly = tweak({ drop: [['web', 'cdn'], ['kiosk', 'gw']], add: [['web', 'gw', 'http'], ['kiosk', 'cdn', 'http']] })
    expect(failedCore(kioskOnly, refDec)).toEqual(['cdn-for-web'])
  })

  it('gaming: SSR only on the kiosk does not count for the storefront', () => {
    const d = tweak({
      patch: (n) => (n.id === 'web' ? { ...n, tech: 'react' } : n.id === 'webBff' ? { ...n, tech: 'nestjs' } : n.id === 'kiosk' ? { ...n, tech: 'nextjs' } : n),
    })
    expect(results(d, refDec).byId['ssr-seo'].pass).toBe(false)
  })

  it('alternative: Lambda token authorizer behind the gateway is not a domain call', () => {
    const d = tweak({ nodes: [['authz', 'function', 'Token authorizer', 260, 440, { tech: 'aws-lambda' }]], add: [['gw', 'authz', 'http'], ['authz', 'tracing', 'telemetry']] })
    expect(failedCore(d, refDec)).toEqual([])
    expect(failedAnti(d, refDec)).toEqual([])
  })

  it('alternative: Recommendations calling Reviews is off the critical path', () => {
    const d = tweak({ add: [['recs', 'reviews', 'http']] })
    expect(failedCore(d, refDec)).toEqual([])
  })

  it('alternative: precomputed recommendations read by the mobile BFF from a cache Recommendations writes', () => {
    const d = tweak({
      drop: [['mobileBff', 'recs'], ['webBff', 'recs']],
      nodes: [['recsCache', 'cache', 'Precomputed recs', 1220, 680, { tech: 'redis' }]],
      add: [['recs', 'recsCache', 'data'], ['mobileBff', 'recsCache', 'data'], ['webBff', 'recsCache', 'data']],
    })
    expect(failedCore(d, refDec)).toEqual([])
    expect(failedAnti(d, refDec)).toEqual([])
  })

  it('alternative: event-fed BFF read models (Catalog → Kafka → BFFs → their own Redis)', () => {
    const d = tweak({
      drop: [['webBff', 'catalog'], ['mobileBff', 'catalog'], ['webBff', 'recs'], ['mobileBff', 'recs']],
      nodes: [
        ['kafka', 'broker', 'Product events', 1220, 680, { tech: 'kafka' }],
        ['recsIndex', 'search', 'Recs read model', 1220, 800, { tech: 'opensearch' }],
        ['projector', 'worker', 'Recs projector', 920, 800, { tech: 'spring-boot' }],
      ],
      add: [
        ['catalog', 'kafka', 'event', 'ProductChanged'],
        ['kafka', 'webBff', 'event'],
        ['kafka', 'mobileBff', 'event'],
        ['recs', 'kafka', 'event', 'RecsComputed'],
        ['kafka', 'projector', 'event'],
        ['projector', 'recsIndex', 'data'],
        ['webBff', 'recsIndex', 'data'],
        ['mobileBff', 'recsIndex', 'data'],
      ],
    })
    const dec: Decisions = { ...refDec, style: 'event-driven', communication: 'hybrid' }
    expect(failedCore(d, dec)).toEqual([])
    expect(failedAnti(d, dec)).toEqual([])
  })

  it('kiosk drawn as an event-only IoT device gets an explanatory detail', () => {
    const d = tweak({ patch: (n) => (n.id === 'kiosk' ? { ...n, kind: 'device', tech: undefined } : n), drop: [['kiosk', 'gw']], add: [['kiosk', 'gw', 'event']] })
    const { byId } = results(d, refDec)
    expect(byId['bff-per-experience'].pass).toBe(false)
    expect(byId['bff-per-experience'].detail).toMatch(/draw it as a Web app/)
  })

  it('checks do not throw on odd graphs', () => {
    const d = diagram([['m', 'mobile-app', 'M', 0, 0], ['b', 'bff', 'B', 200, 0], ['n', 'note', 'n', 0, 200]], [['m', 'b'], ['b', 'm']])
    const { ev } = results(d)
    expect(ev.results.every((r) => !r.detail?.startsWith('Check failed to run'))).toBe(true)
    expect(ev.passed).toBe(false)
  })
})

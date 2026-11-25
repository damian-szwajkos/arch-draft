// Core domain model for ArchDraft. Everything in here is UI-agnostic so the
// validation engine can be unit-tested without React or React Flow.

export type Category =
  | 'clients'
  | 'edge'
  | 'compute'
  | 'data'
  | 'messaging'
  | 'observability'
  | 'security'
  | 'external'
  | 'boundaries'

export type ComponentKind =
  // clients
  | 'web-app'
  | 'mobile-app'
  | 'device'
  // edge
  | 'cdn'
  | 'load-balancer'
  | 'api-gateway'
  | 'bff'
  | 'realtime-gateway'
  // compute
  | 'service'
  | 'monolith'
  | 'module'
  | 'plugin'
  | 'worker'
  | 'function'
  | 'orchestrator'
  // data
  | 'relational-db'
  | 'document-db'
  | 'cache'
  | 'search'
  | 'object-storage'
  | 'wide-column'
  | 'analytics-db'
  | 'graph-db'
  // messaging
  | 'broker'
  | 'cdc'
  | 'stream-processor'
  // observability
  | 'otel-collector'
  | 'logging'
  | 'metrics'
  | 'tracing'
  | 'dashboards'
  | 'alerting'
  // security
  | 'identity'
  | 'secrets'
  | 'waf'
  // external
  | 'external'
  // boundaries & annotations
  | 'zone'
  | 'note'

/** How two components talk. Arrows point in the direction requests / data flow. */
export type Protocol = 'http' | 'grpc' | 'graphql' | 'websocket' | 'event' | 'data' | 'telemetry'

export const SYNC_PROTOCOLS: Protocol[] = ['http', 'grpc', 'graphql']

export interface DiagramNode {
  id: string
  kind: ComponentKind
  label: string
  tech?: string
  /** Business capabilities (bounded contexts) this component owns. */
  domains: string[]
  notes?: string
  x: number
  y: number
  width?: number
  height?: number
  /** Container (monolith / zone) this node lives in. */
  parentId?: string
}

export interface DiagramEdge {
  id: string
  source: string
  target: string
  protocol: Protocol
  label?: string
}

export interface Diagram {
  nodes: DiagramNode[]
  edges: DiagramEdge[]
}

export type ArchStyle =
  | 'monolith'
  | 'modular-monolith'
  | 'microservices'
  | 'event-driven'
  | 'serverless'
  | 'service-based'
  | 'space-based'
  | 'microkernel'

export type CommunicationStyle = 'sync' | 'async' | 'hybrid'
export type DataStrategy = 'shared' | 'per-service' | 'cqrs'

export interface StackPreferences {
  backend?: string
  frontend?: string
  mobile?: string
  database?: string
  messaging?: string
  cache?: string
}

export interface Decisions {
  style?: ArchStyle
  communication?: CommunicationStyle
  data?: DataStrategy
  stack: StackPreferences
  rationale?: string
}

export type Difficulty = 'beginner' | 'intermediate' | 'advanced'
export type CheckCategory = 'core' | 'bonus' | 'antipattern'

export interface CheckOutcome {
  pass: boolean
  detail?: string
}

export interface Check {
  id: string
  title: string
  category: CheckCategory
  /** Why this matters — shown after evaluation. */
  why: string
  /** Nudge shown when the check fails. */
  hint: string
  concepts?: string[]
  test: (g: import('./graph').Graph) => boolean | CheckOutcome
}

export interface DomainDef {
  id: string
  label: string
  description: string
}

export interface Scenario {
  id: string
  title: string
  tagline: string
  industry: string
  difficulty: Difficulty
  estMinutes: number
  accent: string
  concepts: string[]
  story: string
  facts: { label: string; value: string }[]
  functional: string[]
  nonFunctional: string[]
  constraints: string[]
  domains: DomainDef[]
  recommendedStyles: ArchStyle[]
  styleFeedback: Partial<Record<ArchStyle, string>>
  hints: string[]
  checks: Check[]
  /** Public engineering write-ups the scenario is modelled on. */
  inspiration?: { label: string; url: string }[]
  starter?: Diagram
  starterDecisions?: Decisions
  reference: {
    diagram: Diagram
    decisions: Decisions
    walkthrough: string[]
  }
}

export interface CheckResult {
  id: string
  title: string
  category: CheckCategory
  pass: boolean
  detail?: string
  why: string
  hint: string
  concepts: string[]
}

export interface LintIssue {
  id: string
  message: string
  nodeIds: string[]
}

export interface Evaluation {
  score: number
  passed: boolean
  results: CheckResult[]
  lint: LintIssue[]
  evaluatedAt: number
}

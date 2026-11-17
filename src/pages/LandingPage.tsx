import {
  ArrowRight,
  BookOpen,
  Box,
  CheckCircle2,
  Database,
  Globe2,
  Layers,
  Monitor,
  PenTool,
  Router,
  Rss,
  ScanSearch,
  Smartphone,
  Sparkles,
  Star,
  Bell,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { ScenarioCard } from '../components/ScenarioCard'
import { REPO_URL, SiteFooter, SiteHeader } from '../components/SiteHeader'
import { CONCEPT_GROUPS, CONCEPTS } from '../data/concepts'
import { SCENARIOS } from '../data/scenarios'
import { TECH } from '../data/tech'
import { GithubIcon } from '../lib/icons'
import { useProgress } from '../lib/progress'

// ---------------------------------------------------------------------------
// Hero product mock (pure SVG so it scales with the viewport)
// ---------------------------------------------------------------------------

type MockNode = { x: number; y: number; label: string; sub: string; color: string; Icon: LucideIcon }
const W = 150
const H = 46
const MOCK_NODES: MockNode[] = [
  { x: 16, y: 60, label: 'Web App', sub: 'React', color: '#0ea5e9', Icon: Monitor },
  { x: 16, y: 250, label: 'Mobile App', sub: 'Flutter', color: '#0ea5e9', Icon: Smartphone },
  { x: 206, y: 155, label: 'API Gateway', sub: 'Kong', color: '#8b5cf6', Icon: Router },
  { x: 396, y: 60, label: 'Orders', sub: 'Spring Boot', color: '#6366f1', Icon: Box },
  { x: 396, y: 250, label: 'Payments', sub: 'Spring Boot', color: '#6366f1', Icon: Box },
  { x: 586, y: 20, label: 'Orders DB', sub: 'PostgreSQL', color: '#10b981', Icon: Database },
  { x: 586, y: 155, label: 'Event Bus', sub: 'Apache Kafka', color: '#f59e0b', Icon: Rss },
  { x: 586, y: 290, label: 'Notifications', sub: 'NestJS', color: '#6366f1', Icon: Bell },
]
const curve = (x1: number, y1: number, x2: number, y2: number) => `M${x1} ${y1} C${x1 + 22} ${y1}, ${x2 - 22} ${y2}, ${x2} ${y2}`
const MOCK_EDGES: { d: string; color: string; dashed?: boolean }[] = [
  { d: curve(166, 83, 206, 178), color: '#64748b' },
  { d: curve(166, 273, 206, 178), color: '#64748b' },
  { d: curve(356, 178, 396, 83), color: '#64748b' },
  { d: curve(356, 178, 396, 273), color: '#64748b' },
  { d: curve(546, 83, 586, 43), color: '#10b981' },
  { d: curve(546, 83, 586, 178), color: '#f59e0b', dashed: true },
  { d: curve(546, 273, 586, 178), color: '#f59e0b', dashed: true },
  { d: 'M661 201 L661 290', color: '#f59e0b', dashed: true },
]

function HeroMock() {
  return (
    <div className="relative mx-auto mt-14 max-w-5xl">
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0f1117] shadow-[0_40px_120px_-40px_rgba(99,102,241,0.55)]">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="ml-3 truncate text-xs text-zinc-400">Indie Shop → scaling up · event-driven checkout</span>
          <span className="ml-auto hidden items-center gap-1.5 rounded-md bg-brand-600 px-2 py-1 text-[11px] font-medium text-white sm:flex">
            <Sparkles className="h-3 w-3" /> Check design
          </span>
        </div>
        <div className="relative" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)', backgroundSize: '18px 18px' }}>
          <svg viewBox="0 0 760 360" className="block w-full" role="img" aria-label="Example architecture diagram with web and mobile clients, an API gateway, Orders and Payments services, PostgreSQL, Kafka and a Notifications service">
            {MOCK_EDGES.map((e, i) => (
              <path key={i} d={e.d} fill="none" stroke={e.color} strokeWidth={1.6} strokeDasharray={e.dashed ? '6 4' : undefined} className={e.dashed ? 'edge-animated' : undefined} opacity={0.9} />
            ))}
            <g transform="translate(548 122)">
              <rect width="70" height="18" rx="9" fill="#1a1d26" stroke="rgba(255,255,255,0.12)" />
              <circle cx="10" cy="9" r="3" fill="#f59e0b" />
              <text x="18" y="12.5" fontSize="9" fill="#d4d4d8" fontFamily="JetBrains Mono, monospace">
                OrderPlaced
              </text>
            </g>
            {MOCK_NODES.map(({ x, y, label, sub, color, Icon }) => (
              <g key={label}>
                <rect x={x} y={y} width={W} height={H} rx={11} fill="#171a22" stroke={label === 'Event Bus' ? '#6366f1' : 'rgba(255,255,255,0.1)'} strokeWidth={label === 'Event Bus' ? 1.5 : 1} />
                <rect x={x + 9} y={y + 9} width={28} height={28} rx={7} fill={color} opacity={0.16} />
                <Icon x={x + 15} y={y + 15} width={16} height={16} color={color} strokeWidth={2} />
                <text x={x + 46} y={y + 20} fontSize="12" fontWeight={600} fill="#f4f4f5" fontFamily="Inter, sans-serif">
                  {label}
                </text>
                <text x={x + 46} y={y + 35} fontSize="10" fill="#a1a1aa" fontFamily="Inter, sans-serif">
                  {sub}
                </text>
              </g>
            ))}
          </svg>
        </div>
      </div>

      {/* Floating inspector */}
      <div className="absolute top-24 -left-16 hidden w-56 rounded-xl border border-white/10 bg-[#171a22]/95 p-3 shadow-2xl backdrop-blur xl:block">
        <p className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">Technology</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {['Kafka', 'RabbitMQ', 'NATS', 'Pulsar'].map((t, i) => (
            <span key={t} className={i === 0 ? 'rounded-md border border-brand-400 bg-brand-500/20 px-2 py-0.5 text-[11px] font-medium text-brand-200' : 'rounded-md border border-white/10 px-2 py-0.5 text-[11px] text-zinc-400'}>
              {t}
            </span>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-snug text-zinc-400">Durable, partitioned, replayable log. Event streaming & event sourcing.</p>
      </div>

      {/* Floating review */}
      <div className="absolute -right-2 -bottom-20 hidden w-64 rounded-xl border border-white/10 bg-[#171a22]/95 p-4 shadow-2xl backdrop-blur sm:block xl:-right-16 xl:-bottom-12">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border-4 border-emerald-500/80 text-sm font-semibold text-white">92</div>
          <div>
            <div className="flex gap-0.5">
              {[0, 1, 2].map((i) => (
                <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
              ))}
            </div>
            <p className="mt-0.5 text-sm font-semibold text-white">Design approved</p>
          </div>
        </div>
        <ul className="mt-3 space-y-1.5 text-[12px] text-zinc-300">
          <li className="flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Payment events via outbox
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Database per service
          </li>
          <li className="flex items-center gap-2">
            <TriangleAlert className="h-3.5 w-3.5 text-amber-400" /> Add distributed tracing
          </li>
        </ul>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

const STEPS = [
  {
    n: '01',
    title: 'Read the brief',
    body: 'Every scenario is a realistic product story with users, scale, team size, constraints and quality attributes — like a real design review.',
    Icon: BookOpen,
  },
  {
    n: '02',
    title: 'Draw & decide',
    body: 'Drag services, modules, databases, brokers and observability onto the canvas. Pick technologies, protocols and an architecture style.',
    Icon: PenTool,
  },
  {
    n: '03',
    title: 'Get reviewed',
    body: 'Instant feedback on requirements, anti-patterns and trade-offs — then compare with a reference solution and its walkthrough.',
    Icon: ScanSearch,
  },
]

const FEATURES = [
  { title: 'Architecture styles', body: 'Monolith, modular monolith, microservices, event-driven, serverless — and when each is the wrong answer.', Icon: Layers },
  { title: 'Real technology choices', body: `${TECH.length}+ technologies with trade-offs: Spring Boot or NestJS, Kafka or RabbitMQ, Postgres or Mongo, Redis, Angular or React.`, Icon: Globe2 },
  { title: 'Anti-pattern detection', body: 'Shared databases, clients hitting the DB, long synchronous call chains, god services — flagged as you design.', Icon: TriangleAlert },
  { title: 'Observability built in', body: 'Collectors, logs, metrics, traces, dashboards and alerting are first-class components — not an afterthought.', Icon: ScanSearch },
  { title: 'Concept library', body: 'Saga, outbox, CQRS, CDC, idempotency, fan-out, SLOs… short explanations linked straight from your review.', Icon: BookOpen },
  { title: 'Free & private', body: 'No account, no tracking. Your diagrams autosave in your browser and export to PNG or JSON.', Icon: Sparkles },
]

const FAQ = [
  ['Is ArchDraft really free?', 'Yes. It is an open, account-free learning platform. Everything runs in your browser.'],
  ['Where is my work stored?', 'In your browser’s local storage. Export JSON to move a design between machines or share it.'],
  ['Is there one correct answer?', 'No. Checks focus on the properties a good design must have — the reference solution is one good answer, and the walkthrough explains its trade-offs.'],
  ['Who is it for?', 'Developers growing into senior and architect roles, people preparing for system-design interviews, and teams running architecture katas.'],
]

export function LandingPage() {
  const progress = useProgress()
  const techNames = TECH.filter((t) => !t.kinds.includes('external')).map((t) => t.name)
  return (
    <div className="min-h-dvh">
      <div className="relative overflow-hidden bg-[#0b0d12] text-white">
        <div className="hero-glow pointer-events-none absolute inset-0" />
        <div className="grid-fade pointer-events-none absolute inset-0" />
        <SiteHeader dark />
        <section className="relative mx-auto max-w-6xl px-4 pt-16 pb-28 sm:px-6 sm:pt-24">
          <div className="mx-auto max-w-3xl text-center">
            <Link to="/scenarios" className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-300 hover:bg-white/10">
              <span className="rounded-full bg-brand-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">NEW</span>
              {SCENARIOS.length} real-world scenarios, from shop to neobank
              <ArrowRight className="h-3 w-3" />
            </Link>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
              Learn software architecture <span className="bg-gradient-to-r from-brand-300 via-violet-300 to-teal-200 bg-clip-text text-transparent">by drawing it.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base text-pretty text-zinc-300 sm:text-lg">
              Pick a brief — an online shop, a banking ledger, a social feed — and design it. Microservices or modular monolith, Kafka or RabbitMQ, Postgres or Redis.
              ArchDraft reviews your diagram instantly and explains the trade-offs.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link to="/play/indie-shop" className="btn bg-white px-5 py-2.5 text-zinc-900 hover:bg-zinc-200">
                Start your first scenario <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/scenarios" className="btn border border-white/15 px-5 py-2.5 text-white hover:bg-white/10">
                Browse all scenarios
              </Link>
            </div>
            <p className="mt-5 text-xs text-zinc-500">Free forever · No sign-up · Saved in your browser</p>
          </div>
          <HeroMock />
        </section>
      </div>

      {/* Tech marquee */}
      <section className="border-b border-zinc-200/70 py-8 dark:border-white/10" aria-label="Technologies">
        <p className="text-center text-xs font-semibold tracking-wide text-zinc-500 uppercase">Choose from the stacks teams actually run</p>
        <div className="relative mt-5 overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_10%,black_90%,transparent)]">
          <div className="marquee flex w-max gap-2.5">
            {[...techNames, ...techNames].map((t, i) => (
              <span key={i} className="chip shrink-0 whitespace-nowrap" aria-hidden={i >= techNames.length}>
                {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold text-brand-600 dark:text-brand-400">How it works</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">An architecture kata you can run alone.</h2>
          <p className="mt-3 text-zinc-500 dark:text-zinc-400">Like a design review with a patient senior architect — available whenever you are.</p>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {STEPS.map(({ n, title, body, Icon }) => (
            <div key={n} className="rounded-2xl border border-zinc-200/80 p-6 dark:border-white/10">
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="font-mono text-sm text-zinc-300 dark:text-zinc-600">{n}</span>
              </div>
              <h3 className="mt-5 text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="bg-zinc-50 py-20 dark:bg-white/[0.02]">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold text-brand-600 dark:text-brand-400">What you’ll practice</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Application architecture, not just boxes and arrows.</h2>
          </div>
          <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-zinc-200/80 bg-zinc-200/80 sm:grid-cols-2 lg:grid-cols-3 dark:border-white/10 dark:bg-white/10">
            {FEATURES.map(({ title, body, Icon }) => (
              <div key={title} className="bg-white p-6 dark:bg-[#0f1117]">
                <Icon className="h-5 w-5 text-brand-600 dark:text-brand-400" />
                <h3 className="mt-4 font-semibold">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Scenarios */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold text-brand-600 dark:text-brand-400">Scenarios</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">From your first shop to a regulated bank.</h2>
          </div>
          <Link to="/scenarios" className="btn-secondary sm:ml-auto">
            All scenarios <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SCENARIOS.slice(0, 6).map((s) => (
            <ScenarioCard key={s.id} s={s} progress={progress[s.id]} />
          ))}
        </div>
      </section>

      {/* Concepts */}
      <section className="border-y border-zinc-200/70 py-20 dark:border-white/10">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <p className="text-sm font-semibold text-brand-600 dark:text-brand-400">Concept library</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{CONCEPTS.length} patterns, explained where you need them.</h2>
            <p className="mt-3 text-zinc-500 dark:text-zinc-400">Every check in a review links to the concept behind it: when to use it, and how it fails in production.</p>
            <Link to="/concepts" className="btn-secondary mt-6">
              Explore concepts <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="space-y-5">
            {CONCEPT_GROUPS.map((g) => (
              <div key={g}>
                <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{g}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {CONCEPTS.filter((c) => c.group === g).map((c) => (
                    <Link key={c.id} to={`/concepts/${c.id}`} className="chip hover:border-brand-300 hover:text-brand-700 dark:hover:text-brand-300">
                      {c.title}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
        <h2 className="text-center text-3xl font-semibold tracking-tight">Questions</h2>
        <dl className="mt-10 divide-y divide-zinc-200/80 dark:divide-white/10">
          {FAQ.map(([q, a]) => (
            <div key={q} className="py-5">
              <dt className="font-semibold">{q}</dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{a}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* CTA */}
      <section className="px-4 pb-20 sm:px-6">
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-[#0b0d12] px-6 py-14 text-center text-white sm:px-12">
          <div className="hero-glow pointer-events-none absolute inset-0 opacity-80" />
          <div className="relative">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your next architecture review starts now.</h2>
            <p className="mx-auto mt-3 max-w-xl text-zinc-300">No account, no credit card, no installation. Open a scenario and start drawing.</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link to="/scenarios" className="btn bg-white px-5 py-2.5 text-zinc-900 hover:bg-zinc-200">
                Start drafting <ArrowRight className="h-4 w-4" />
              </Link>
              <a href={REPO_URL} target="_blank" rel="noreferrer" className="btn border border-white/15 px-5 py-2.5 text-white hover:bg-white/10">
                <GithubIcon /> Star on GitHub
              </a>
            </div>
          </div>
        </div>
      </section>
      <SiteFooter />
    </div>
  )
}

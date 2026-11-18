# ArchDraft

**Learn software architecture by drawing it.** · [Open ArchDraft](https://damian-szwajkos.github.io/arch-draft/)

ArchDraft is a free, open, account-free learning platform for *application architecture*.
Pick a real-world scenario — an online shop, a neobank ledger, a social feed, a flash-sale ticketing
system — then design it on a canvas: services or modules, databases, brokers, gateways and
observability. Choose the stack (Spring Boot or NestJS, Angular or React, Kafka or RabbitMQ,
PostgreSQL or MongoDB, Redis…), record your decisions, and get an instant review.

> Sister project to an AWS cloud-architecture trainer — this one focuses on the application level:
> microservices, modular monoliths, event-driven design, data ownership, resilience and observability.

## Features

- **8 scenarios** from beginner to advanced (e-commerce, URL shortener, observability retrofit,
  video courses, social feed, food delivery, ticket flash sale, banking ledger).
- **Diagram workspace** built on React Flow: 36 component types, containers for modular monoliths
  and bounded contexts, 7 communication types (REST, gRPC, GraphQL, WebSocket, events, data, telemetry).
- **150+ technologies** with trade-off notes and machine-readable traits the reviewer reasons about
  (e.g. Kafka is *replayable*, RabbitMQ is a *queue*, Redis supports *geo* and *TTL*).
- **Decisions panel** — architecture style, communication, data strategy, stack preferences and an ADR rationale.
- **Instant review** — key requirements, bonus points and anti-pattern detection (shared databases,
  clients hitting the DB, long synchronous chains), and a 0–100 score.
- **Reference solutions** with walkthroughs, loadable into your canvas.
- **Concept library** — 33 patterns (saga, outbox, CDC, CQRS, fan-out, SLOs…) linked from every check.
- **Sandbox** mode with architecture lint, PNG / JSON export and JSON import.
- **No backend, no auth** — progress and diagrams autosave in `localStorage`.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # validation-engine tests (every reference solution must score 100)
npm run build      # type-check + production build into dist/
```

Requires Node 20+.

## Project structure

```
src/
  engine/        UI-agnostic model + validation engine (Graph queries, checks, scoring)
  data/          component catalog, technology catalog, concepts, scenarios/
  store/         Zustand workspace store (React Flow nodes/edges, history, decisions)
  components/
    canvas/      custom nodes, containers, floating edges, toolbar
    workspace/   palette, brief, inspector, decisions, review, reference dialog
  pages/         landing, scenarios, workspace, concepts
```

### Adding a scenario

1. Create `src/data/scenarios/<name>.ts` exporting a `Scenario` (brief, capabilities, checks, reference).
2. Write checks against the `Graph` API (`owners`, `ownerFamily`, `storesOf`, `asyncFlow`, `calls`, `hasTrait`…).
3. Author the reference diagram with the `diagram()` helper and register it in `scenarios/index.ts`.
4. Run `npm test` — the suite fails unless your reference solution scores 100
   and an empty canvas fails.

## Deployment

The app is a static SPA. `.github/workflows/deploy-pages.yml` builds it with
`BASE_PATH=/arch-draft/` and publishes to GitHub Pages on every push to `main`
(live at https://damian-szwajkos.github.io/arch-draft/). Any static host works: serve `dist/` with a
fallback to `index.html`.

## Tech stack

React 19 · TypeScript · Vite · React Flow (@xyflow/react) · Zustand · Tailwind CSS v4 · Vitest · lucide icons.

Design research and UI references are documented in [docs/DESIGN.md](docs/DESIGN.md).

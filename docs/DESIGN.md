# Design notes

ArchDraft’s UI was shaped by patterns found on [Mobbin](https://mobbin.com). Nothing is copied —
these references informed layout and interaction decisions.

## Workspace (canvas editor)

| Pattern | Reference | How ArchDraft uses it |
| --- | --- | --- |
| Node canvas with icon tiles, labels and minimal chrome; zoom controls on the canvas | [n8n workflow editor](https://mobbin.com/screens/3faaad7b-470a-43df-a7ec-a3ea096bd9d8) | Component nodes are compact cards with a coloured icon tile, name and chosen technology. |
| Floating, pill-shaped bottom toolbar over a dotted canvas | [Luma canvas](https://mobbin.com/screens/f7bd6231-4d82-460c-971d-1ee87a0fe5fa) | Undo / redo / zoom / fit / minimap pill centred at the bottom. |
| Inset rounded side panels floating above the canvas; grouped inspector sections | [Subframe editor](https://mobbin.com/screens/e6f9d7cf-8cb4-4451-9062-d96cca220434) | Left panel (Brief / Components) and right panel (Inspect / Decisions / Review) as inset cards. |
| Searchable element library in a left rail | [Canva whiteboard](https://mobbin.com/screens/41c27e32-a997-408a-8d71-5b3356a31c1e) | Searchable component palette grouped by category; drag or click to add. |
| Contextual properties panel for the selected element | [Givingli editor](https://mobbin.com/screens/5a8a546e-4d30-44a5-abaa-33f8fb490a06) | Inspector switches automatically to the selected node or connection. |

## Catalog & learning

| Pattern | Reference | How ArchDraft uses it |
| --- | --- | --- |
| Blueprint cards with a one-line description and a meta line, search + filter chips | [Stripe Workbench blueprints](https://mobbin.com/screens/fc9452d5-d440-479e-8a1f-4a45998c582b) | Scenario cards: industry, title, tagline, difficulty · minutes · concepts. |
| Course grid with search and filter chips | [Canva Design School](https://mobbin.com/screens/faa63178-3e85-4241-9597-8388bc3abf2d) | Difficulty chips and industry filter on the Scenarios page. |
| Result screen with pass verdict, score and per-category bars | [Uxcel exam results](https://mobbin.com/screens/39bc6126-c7be-4b0c-93de-befbfbe12e40) | Review tab: score ring, verdict and Requirements / Bonus / Anti-pattern bars. |

## Landing page

| Pattern | Reference | How ArchDraft uses it |
| --- | --- | --- |
| Dark hero with a soft glow and a product mock | [Grammarly for Developers](https://mobbin.com/sites/sections/d6cbb462-28bd-4e04-8338-e8d7785c04c0), [1Password Developer](https://mobbin.com/sites/sections/84ae4767-03c2-40fd-a88b-d10071d797d8) | Dark gradient hero with an SVG mock of the workspace plus floating inspector and review cards. |
| Product screenshot as the hero visual | [Frontify developer platform](https://mobbin.com/sites/sections/67380933-75aa-40ed-b13c-617db6250c9c) | The mock is the product itself, not an illustration. |

## Visual language

- **Colour by category** — clients (sky), edge (violet), compute (indigo), data (emerald), messaging (amber),
  observability (rose), security (teal), third-party (zinc). The same hue is used in the palette, nodes and minimap.
- **Colour & stroke by protocol** — sync calls are solid slate, events are dashed animated amber,
  data access is emerald, telemetry is dotted rose.
- **Typography** — Inter for UI, JetBrains Mono for protocol labels and numbers.
- **Light and dark themes** — follows the OS by default, toggle in the header.

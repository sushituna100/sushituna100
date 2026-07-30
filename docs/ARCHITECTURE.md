# SolidPilot architecture

```
┌────────────────────────────────────────────────────────────────────┐
│ Browser (React + three.js)                                         │
│                                                                    │
│  Ribbon ── dialogs ──┐            ┌── AI panel (chat + proposals)  │
│                      ▼            ▼                                │
│                 zustand store ── SSE stream ─────────────┐         │
│                      │                                   │         │
│              CAD kernel (client)                         │         │
│         evaluate → bodies → viewport                     │         │
└──────────────────────────│───────────────────────────────│─────────┘
                     REST /api/projects…             POST /api/agent
┌──────────────────────────▼───────────────────────────────▼─────────┐
│ Node server (Express)                                              │
│   projects.ts  — folder of *.cad.json  ("repo of parts")           │
│   agent.ts     — local-LLM agent loop: list/read/measure/write tools│
│   CAD kernel (server) — same code, validates + measures AI writes  │
└────────────────────────────────────────────────────────────────────┘
```

## The core idea: parts as code

A part is a **plain JSON document**: named parameters (arithmetic expressions) plus an ordered
feature timeline (`src/kernel/types.ts`). That single decision powers everything:

- **The AI edits models the way Cursor edits source.** `update_document` rewrites the JSON;
  the kernel replays the timeline; validation + mass properties come back as tool feedback, so
  the agent iterates until geometry is valid and targets are hit.
- **Project-wide context is trivial.** A project is a folder; the agent lists and reads sibling
  parts to match interfaces (hole patterns, clearances) before designing.
- **Proposals are diffs.** An AI edit is just "old doc → new doc". The client previews the
  proposed geometry in the viewport (green tint) and the user accepts (save) or rejects (discard).
- **Git-native.** Parts diff, review, branch, and merge like any other code.

## Kernel (`src/kernel/`)

- `types.ts` — document schema: parameters, sketches (rect/circle/slot/ngon/polygon entities,
  hole flag), features (sketch, extrude, revolve, primitive, combine, transform, mirror, pattern).
- `expr.ts` — safe recursive-descent expression evaluator (no `eval`), parameter cross-references
  with cycle detection.
- `sketch.ts` — entities → `THREE.Shape` profiles with hole assignment by containment; plane
  bases are right-handed so winding survives into 3D.
- `evaluate.ts` — replays the timeline. Extrude/lathe geometry from profiles; booleans via
  three-bvh-csg (BVH mesh CSG); winding/normal fixes for mirrored transforms; bodies kept baked
  in world space.
- `measure.ts` — volume via signed tetrahedra, surface area, center of mass, bbox, mass from
  material density.
- `validate.ts` — structural checks before any save or AI proposal is admitted.
- `stl.ts` — binary STL export.

The same kernel runs in the browser (live modeling) and in Node (the agent's feedback loop) —
one source of truth for geometry.

## AI copilot (`server/agent.ts`)

Agent loop over a local, open-source LLM served by Ollama (`OLLAMA_MODEL`, default
`qwen2.5-coder:7b`) via its OpenAI-compatible chat-completions API — no cloud API key. Streams SSE
events to the client: `text`, `tool_start`, `tool_result`, `proposal`, `error`, `done`. The `openai`
client + tool-calling shape is provider-agnostic, so swapping in a hosted frontier model (Anthropic,
or any other OpenAI-compatible endpoint) later is a localized change to `server/agent.ts` only —
tool-calling reliability on small local models is the main quality tradeoff versus a hosted model.

Tools: `list_documents`, `read_document`, `mass_properties`, `update_document`, `create_document`.
Writes are validated + evaluated server-side; the agent receives errors and measured mass
properties as the tool result, and the client receives the proposal. Nothing touches disk until
the user accepts. An `overlay` in the request carries the client's unsaved documents and pending
proposals so follow-up conversation operates on what the user is actually looking at.

The document schema the model works against is documented once, in `server/schema.ts`, and
injected into the system prompt.

## Known v0 limitations (deliberate scope cuts)

- **Mesh CSG, not B-rep.** Booleans are triangle-mesh based: robust and fast, but no true faces/
  edges — so no edge fillets/chamfers yet (sketch corner radii work), and tessellation seams show
  in the edge overlay. The upgrade path is OpenCascade.js (WASM B-rep kernel) behind the *same*
  document schema — the evaluator is the only layer that changes.
- Revolve is full-360° only; partial revolves need caps (comes with B-rep).
- Sketches are entity-based, not constraint-solved (no dimension/coincidence constraints yet).
- No STEP/IGES import/export (STL export only).
- Single-user; multi-user needs CRDT documents + server-authoritative evaluation.

## Production roadmap

1. **B-rep kernel** — OpenCascade.js evaluator: fillets/chamfers/shell/draft, partial revolve,
   sweeps/lofts, STEP import/export. Schema stays; documents survive the migration.
2. **Constraint sketcher** — dimensions + geometric constraints (a small planar solver), which
   also gives the AI a richer editing vocabulary ("make these concentric").
3. **Assemblies** — mates between parts; the agent designs *interfaces* explicitly.
4. **Collaboration** — CRDT part documents, presence, review threads on proposals.
5. **Org context for the agent** — fastener/material libraries, DFM rules, company standards as
   retrieval context; batch jobs ("generate the whole bracket family from this spec sheet").
6. **Validation loop upgrades** — interference checks between parts, printability/DFM lint,
   FEA-lite sanity checks as agent tools.

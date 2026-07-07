# SolidPilot — product thesis (B2B)

## One-liner

**Cursor for CAD**: an AI-native CAD workspace where an agent with project-wide context designs
and modifies real parametric parts to hit engineering targets — sold B2B as automated CAD
capacity for hardware teams.

## Why now, why this

- **The wedge exists.** Code got its AI-native editor and it re-segmented the whole market.
  Mechanical CAD has AI *features* bolted onto legacy kernels (Fusion's AutoConstrain, Onshape
  AI advisor) but no AI-*native* workspace where the agent is a first-class modeling user.
- **CAD is uniquely verifiable.** Unlike prose, a CAD edit can be machine-checked: does it
  evaluate, is it watertight, what's the mass, does it interfere with the mating part. That
  feedback loop (already implemented here) is what makes agentic CAD converge instead of hallucinate.
- **The file format is the moat legacy can't cross.** Incumbents' models live in opaque binary
  kernels. SolidPilot parts are diffable JSON in a folder — reviewable in a PR, editable by an
  agent, CI-checkable. "Parts as code" is the same unlock "infra as code" was.

## Who pays (initial ICPs)

1. **Hardware startups (10–200 eng)** — drowning in bracketry, enclosures, fixtures, spacer/
   standoff variants. Sell: "the copilot does your long tail of parts; your MEs do the hard 20%."
2. **Contract manufacturers & job shops** — quote-to-CAD automation: customer spec sheet in,
   parametric part family + STLs/STEPs out.
3. **Industrial-equipment OEMs** — configured-to-order variants (every order is the same machine
   with different dimensions). Agent + parameter schema = sales configurator that emits real CAD.

## Wedge → expansion

- **Wedge:** the long tail of simple parts (plates, brackets, enclosures, spacers, panels) —
  high volume, low glory, fully within reach of today's kernel. Land as a per-seat + usage tool
  next to Fusion/SolidWorks, not a rip-and-replace.
- **Expand:** project context grows into org context (fastener libraries, DFM rules, standards);
  batch generation APIs ("give me the 40-size bracket family"); then assemblies and review
  workflows make it the system of record for new designs.

## Business model

- Per-seat SaaS (workspace) + metered agent usage (heavy compute lives server-side).
- Team plan: shared projects, proposal review (accept/reject is already a review primitive).
- Enterprise: SSO, on-prem/VPC agent, private context libraries, API/batch generation.

## Defensibility

1. The **evaluation loop** (geometry checks + mass properties + interference as agent tools) —
   quality compounds with every tool added.
2. **Proprietary interaction data**: accepted vs. rejected proposals is exactly the preference
   data that makes the next model better at CAD.
3. **Parts-as-code network effects**: shared parametric libraries, versioned in git, reusable
   across customers.

## Honest competitive read

- Autodesk/PTC/Dassault will ship copilots — inside click-driven UIs on closed kernels; their
  agent can't own the document the way ours does.
- Text-to-mesh startups (3D gen-AI) make *shapes*, not engineering parts — no parameters, no
  tolerances, no mass properties. Different market.
- Closest analogues (Zoo/KittyCAD, nTop scripting) validate the space; none pair a full
  interactive workspace with a project-context agent and accept/reject review flow.

## Status vs. plan

| | v0 (this repo) | v1 (fundable demo) | v2 (sellable) |
|---|---|---|---|
| Kernel | mesh CSG, sketches/extrude/revolve/booleans/patterns | + OpenCascade B-rep: fillets, shell, STEP | + assemblies, sweeps/lofts |
| Agent | project context, targets loop, proposals | + interference & DFM checks, part families | + org libraries, batch API |
| Collab | single user, git-friendly files | shared projects, proposal review | CRDT co-editing, SSO |

The v0 in this repo is the end-to-end proof: real kernel, real agent, real accept/reject loop,
running today.

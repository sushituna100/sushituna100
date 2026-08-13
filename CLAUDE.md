# SolidPilot — project context for Claude Code

Read this fully before making changes. This file exists specifically so a fresh
Claude Code session (no prior chat history) can pick up where earlier work left off.

## What this is

SolidPilot ("Cursor for CAD") — an AI-native parametric CAD workspace: a browser-based
CAD kernel (`src/kernel/`), a Fusion-360-style ribbon UI (`src/ui/`), and an AI copilot
(`server/agent.ts`) that reads/writes the project's parts and streams edits to the
viewport as accept/reject proposals. Full architecture: `docs/ARCHITECTURE.md`. Full
product thesis: `docs/PRODUCT.md`. Top-level tour: `README.md`.

## Current AI backend: local Ollama, not a cloud API

The copilot originally used the Anthropic API directly. It now runs entirely against a
**local, open-source LLM served by Ollama** (`http://localhost:11434`, OpenAI-compatible
`/v1/chat/completions` endpoint) — no cloud API key needed for the app itself. Default
model: `qwen2.5-coder:7b`, overridable via `OLLAMA_MODEL` in `.env`. See `.env.example`.

**Run it:** `ollama serve` (or the Ollama tray app — it usually auto-starts, so `ollama
serve` erroring with "port already in use" just means it's already running, not a
problem), `ollama pull <model>`, then `npm install && npm run dev`. Client on :5173,
server on :8787. `GET /api/health` reports `{ aiReady, model }`.

## Known small-local-model reliability issues — already fixed once, watch for regressions

Small local models (7-8B) are meaningfully less reliable than a frontier hosted model at
following OpenAI-style tool/function calling. Three real failure modes were hit and fixed
in `server/agent.ts`; if similar symptoms reappear, look here first before assuming a new
bug class:

1. **Model dumps the whole edited document as JSON in plain chat text** instead of
   calling `update_document`/`create_document` through the real API. Fixed by
   `extractDocumentFromText()` — recovers a document-shaped JSON blob (has `version` +
   `features`) from the reply (fenced or bare) and runs it through the same
   validate/evaluate/propose pipeline a real tool call would.

2. **Model narrates a tool call as prose instead of invoking it** — e.g. writes
   `{"name": "list_documents", "arguments": {}}` as chat text (sometimes inside a
   ```` ```json ```` fence) and then, worse, **fabricates its own fake tool result** to
   keep going (one observed case: it invented a document called `accessory-grip` that
   never existed in the project). Because no real tool call happened, the old code had
   nothing to act on and just stopped — requiring the user to manually nudge every step
   ("continue", "do what I said to X") instead of the task running to completion on its
   own. Fixed by `extractNarratedToolCall()`: detects the narrated call, executes the
   *real* tool, **discards everything the model wrote after the call** (untrustworthy),
   splices the true result back in as a message clearly marked
   `[SYSTEM: this is the real, authoritative result...]`, and continues the agent loop
   automatically (bounded by `MAX_ITERATIONS = 24`). This is what makes one instruction
   run a full multi-step task unattended instead of stalling every turn.

3. **Model writes JS-style near-JSON instead of strict JSON** — `//` comments, trailing
   commas, and bare unquoted CAD expressions as values (`"cy": -width/2 + wall*2` instead
   of `"cy": "-width/2 + wall*2"`). `JSON.parse` throws on all of this, so both recovery
   paths above were silently failing and falling through to dumping the raw broken JSON
   into the chat as plain text — a bad experience even though the underlying cause (model
   explaining a plan instead of acting) was already handled. Fixed by `repairLooseJson()` /
   `parseJsonLoose()`: strips comments and trailing commas, wraps bare-identifier/expression
   values in quotes via a targeted regex, tried once after a strict `JSON.parse` fails.
   Also added `sanitizeUnparsedReply()` as a last-resort backstop: if recovery still fails
   on something that looks like an attempted tool call or document, strip fenced code
   blocks from what's shown to the user rather than ever dumping raw (possibly broken)
   JSON into the chat.

All three fixes were verified against mock Ollama servers reproducing the exact reported
transcripts (see chat history / commit messages `1c53a3b`, `6f8edfa`, and the JSON-repair
commit for the mock harnesses used — they're not checked into the repo, just how the fix
was validated) — worth doing the same (a small Express mock returning canned
`/v1/chat/completions` responses) before believing a tool-calling fix actually works, since
real Ollama+model
runs are slow to iterate on and non-deterministic.

**If you hit a new variant of "the AI said it would do something but nothing happened,"**
the fastest diagnosis is: reproduce with a mock server that returns the exact broken
response shape, single-step through `server/agent.ts`'s loop, and check whether
`extractNarratedToolCall` / `extractDocumentFromText` actually matches the text — most
likely a new phrasing/formatting variant that the balanced-brace scanner or the tool-name
allowlist doesn't catch yet, not a fundamentally new problem.

## Two-repo setup — a recurring source of confusion

- **Source of truth / where fixes get pushed:** `sushituna100/sushituna100`, branch
  `claude/ai-cad-editor-6n4ffe`. Claude Code sessions working on this project from that
  repo push there directly.
- **The user's actual working repo on their machine:** `sushituna100/solidpilot`
  (`main` branch), a separate GitHub repo the user created and clones locally. It does
  **not** auto-update when the source branch above gets new commits — the user has to
  manually pull each time:
  ```
  git fetch https://github.com/sushituna100/sushituna100.git claude/ai-cad-editor-6n4ffe
  git merge FETCH_HEAD
  git push origin main
  ```
  This has been the #1 cause of "I pulled the fix but it's not working" reports — the
  user was actually still running an older commit. **Always check `git log --oneline -5`
  first** when debugging a reported bug against the user's local clone, before assuming
  the bug is new.

## Windows/PowerShell gotchas already hit

- `&&` is not a valid statement separator in PowerShell 5.1 — use `;` or separate lines.
- `npm install` may prompt an `allow-scripts`/`install-scripts` approval gate for
  `esbuild`'s postinstall (downloads its native binary) — approving it is correct and
  required; it's a supply-chain safety gate, not a sign of a broken install. Not every
  npm/Node version combo shows this prompt.
- `ollama serve` erroring "bind: Only one usage of each socket address..." just means
  Ollama's already running as a background service/tray app — not an actual error.

## Verification standard for changes to this project

Don't just typecheck. For kernel changes: `npx tsx scripts/check-samples.ts` (evaluates
the sample parts, checks for 0 errors + sane mass properties) plus `npm run build`. For
agent/copilot changes: stand up a small mock Ollama server (Express, canned
`/v1/chat/completions` + `/api/tags` responses) reproducing the specific model behavior
in question, point `OLLAMA_HOST` at it, drive a real request through the real
`server/index.ts` + `server/agent.ts`, and read the SSE event stream — this has caught
real bugs (the `res.on("close")` vs `req.on("close")` abort bug in particular) that
typechecking alone would never surface.

/** SolidPilot server: project storage API + AI copilot endpoint (SSE). */

import express from "express";
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "./env";

loadEnv();

// Imports below read env (model, projects dir) at module load, so load .env first.
const { runAgent } = await import("./agent");
const store = await import("./projects");
const { evaluateDocument } = await import("../src/kernel/evaluate");
const { measureBody } = await import("../src/kernel/measure");
const { DEFAULT_MATERIAL } = await import("../src/kernel/types");

const app = express();
app.use(express.json({ limit: "10mb" }));

const wrap =
  (fn: (req: express.Request, res: express.Response) => void) =>
  (req: express.Request, res: express.Response) => {
    try {
      fn(req, res);
    } catch (err) {
      res.status(400).json({ error: String((err as Error).message ?? err) });
    }
  };

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5-coder:7b";

app.get("/api/health", async (_req, res) => {
  let aiReady = false;
  try {
    // Ollama's native API (not the /v1 OpenAI-compat surface) lists pulled models.
    const r = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (r.ok) {
      const body = (await r.json()) as { models?: { name: string }[] };
      aiReady = Boolean(body.models?.some((m) => m.name === OLLAMA_MODEL || m.name.startsWith(`${OLLAMA_MODEL}:`)));
    }
  } catch {
    aiReady = false;
  }
  res.json({ ok: true, aiReady, model: OLLAMA_MODEL });
});

app.get("/api/projects", wrap((_req, res) => {
  res.json({ projects: store.listProjects() });
}));

app.post("/api/projects", wrap((req, res) => {
  store.createProject(String(req.body.name));
  res.json({ ok: true });
}));

app.get("/api/projects/:project/documents", wrap((req, res) => {
  res.json({ documents: store.listDocuments(req.params.project) });
}));

app.get("/api/projects/:project/documents/:name", wrap((req, res) => {
  res.json({ document: store.readDocument(req.params.project, req.params.name) });
}));

app.put("/api/projects/:project/documents/:name", wrap((req, res) => {
  store.writeDocument(req.params.project, req.params.name, req.body.document);
  res.json({ ok: true });
}));

app.delete("/api/projects/:project/documents/:name", wrap((req, res) => {
  store.deleteDocument(req.params.project, req.params.name);
  res.json({ ok: true });
}));

/** Server-side evaluation (mass properties) — same kernel the client runs. */
app.post("/api/projects/:project/documents/:name/measure", wrap((req, res) => {
  const doc = store.readDocument(req.params.project, req.params.name);
  const result = evaluateDocument(doc);
  res.json({
    errors: result.errors,
    bodies: result.bodies.map((b) => measureBody(b, doc.material ?? DEFAULT_MATERIAL)),
  });
}));

/** AI copilot: streams agent events as SSE. */
app.post("/api/agent", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const abort = new AbortController();
  // res.on("close") — not req.on("close") — fires when the connection actually
  // terminates. req.on("close") fires as soon as Express finishes reading the
  // request body, i.e. almost immediately, which aborted every agent run.
  res.on("close", () => abort.abort());

  const emit = (event: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  runAgent(req.body, emit, abort.signal)
    .catch((err) => emit({ type: "error", message: String(err) }))
    .finally(() => res.end());
});

// Production: serve the built client.
const dist = path.resolve(process.cwd(), "dist");
if (process.env.NODE_ENV === "production" && fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`[solidpilot] server on http://localhost:${port}`);
  console.log(`[solidpilot] AI copilot: Ollama @ ${OLLAMA_HOST}, model "${OLLAMA_MODEL}" (GET /api/health to check readiness)`);
});

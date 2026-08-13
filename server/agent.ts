/**
 * The SolidPilot copilot: a server-side agent loop over a local, open-source
 * LLM served by Ollama (http://localhost:11434) through its OpenAI-compatible
 * chat-completions API. No cloud API key required.
 *
 * The agent has project-wide context (every part file in the project folder)
 * and tools to read, measure, and rewrite documents. Writes are NOT saved to
 * disk — they stream to the client as *proposals* that the user accepts or
 * rejects in the viewport, exactly like reviewing an AI edit in Cursor.
 *
 * Tool-calling reliability depends entirely on the local model: small models
 * (7-8B) are noticeably less consistent than a frontier hosted model at
 * following the schema and converging on targets across many steps.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { evaluateDocument } from "../src/kernel/evaluate";
import { formatMassProperties, measureBody } from "../src/kernel/measure";
import type { CadDocument } from "../src/kernel/types";
import { DEFAULT_MATERIAL } from "../src/kernel/types";
import { validateDocument } from "../src/kernel/validate";
import * as store from "./projects";
import { SCHEMA_GUIDE } from "./schema";

export interface AgentEvent {
  type: "text" | "tool_start" | "tool_result" | "proposal" | "error" | "done";
  [key: string]: unknown;
}

export interface AgentRequest {
  project: string;
  activeDocument?: string;
  /** Prior conversation turns (plain text). */
  messages: { role: "user" | "assistant"; content: string }[];
  /** Unsaved client-side document states (open editors / pending proposals). */
  overlay?: Record<string, CadDocument>;
}

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5-coder:7b";
const MAX_ITERATIONS = 24;

const TOOL_NAMES = new Set(["list_documents", "read_document", "mass_properties", "update_document", "create_document"]);

/** Find the first balanced {...} object at or after `from`. Doesn't account for
 *  braces inside quoted strings — acceptable here since our expression syntax
 *  never contains braces. */
function scanBalancedObject(text: string, from = 0): { src: string; start: number; end: number } | null {
  const start = text.indexOf("{", from);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return { src: text.slice(start, i + 1), start, end: i + 1 };
    }
  }
  return null;
}

/**
 * Best-effort repair for near-JSON small models sometimes write instead of
 * strict JSON: JS-style `//` comments, trailing commas, and bare unquoted CAD
 * expressions as values (`"cy": -width/2 + wall*2` instead of a quoted
 * string). Applied only after a strict JSON.parse attempt has already failed.
 */
function repairLooseJson(src: string): string {
  let out = src.replace(/\/\/[^\n]*/g, "");
  out = out.replace(/,(\s*[}\]])/g, "$1");
  out = out.replace(
    /("[a-zA-Z_]\w*"\s*:\s*)([^",{[\s][^,}\]]*)/g,
    (whole: string, prefix: string, value: string) => {
      const trimmed = value.trim();
      if (/^(true|false|null)$/.test(trimmed)) return whole;
      if (/^-?\d/.test(trimmed) && !/[a-zA-Z_(]/.test(trimmed)) return whole; // already a plain number
      return `${prefix}"${trimmed.replace(/"/g, '\\"')}"`;
    },
  );
  return out;
}

/** Strict parse, falling back to repairLooseJson() once before giving up entirely. */
function parseJsonLoose(src: string): unknown {
  try {
    return JSON.parse(src);
  } catch {
    try {
      return JSON.parse(repairLooseJson(src));
    } catch {
      return undefined;
    }
  }
}

/**
 * Last resort when neither extractNarratedToolCall nor extractDocumentFromText
 * could make sense of a reply (e.g. JSON broken beyond repair). A wall of
 * malformed JSON is never a useful chat message — show only the surrounding
 * prose, or an honest one-line admission if there isn't any.
 */
function sanitizeUnparsedReply(text: string): string {
  const looksLikeFailedAttempt = /```/.test(text) || /\{\s*"(name|version)"\s*:/.test(text);
  if (!looksLikeFailedAttempt) return text;
  const prose = text.replace(/```[\s\S]*?```/g, "").trim();
  return prose || "I tried to write out a change but it wasn't valid JSON, so nothing was applied. Could you ask again?";
}

const TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_documents",
      description:
        "List every part document in the current project with a one-line summary (parameters, features, bodies). Use this to understand what exists before reading or editing.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "read_document",
      description: "Read the full JSON of one part document in the project.",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "Document name (no extension)" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mass_properties",
      description:
        "Evaluate a document's geometry and return mass properties per body: volume, mass (from material density), surface area, bounding box, center of mass. Use this to verify a design hits numeric targets.",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "Document name" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_document",
      description:
        "Propose a full replacement of one document. The document is validated and its geometry evaluated; you get back any errors plus resulting mass properties. The change is shown to the user as a live preview in their viewport for accept/reject — it is not saved until they accept. Always send the COMPLETE document JSON.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Document name to update" },
          document: { type: "object", description: "The complete new document JSON" },
          rationale: { type: "string", description: "One sentence: what changed and why" },
        },
        required: ["name", "document"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_document",
      description:
        "Create a brand-new part document in the project (proposed to the user for accept/reject, like update_document). Always send the COMPLETE document JSON.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "New document name (letters, digits, - _ only)" },
          document: { type: "object", description: "The complete document JSON" },
          rationale: { type: "string" },
        },
        required: ["name", "document"],
      },
    },
  },
];

function summarizeDocument(name: string, doc: CadDocument): string {
  const params = doc.parameters.map((p) => `${p.name}=${p.expr}`).join(", ");
  const feats = doc.features.map((f) => `${f.type}:${f.id}`).join(", ");
  const desc = doc.description ? ` — ${doc.description}` : "";
  return `${name}${desc}\n  parameters: ${params || "(none)"}\n  timeline: ${feats || "(empty)"}`;
}

/** Evaluate a doc and return a human-readable report (errors + mass properties). */
function evaluationReport(doc: CadDocument): string {
  const result = evaluateDocument(doc);
  const lines: string[] = [];
  if (result.errors.length) {
    lines.push("EVALUATION ERRORS:");
    for (const e of result.errors) lines.push(`  [${e.featureId}] ${e.message}`);
  }
  if (result.bodies.length === 0) {
    lines.push("No solid bodies produced.");
  }
  for (const body of result.bodies) {
    lines.push(formatMassProperties(measureBody(body, doc.material ?? DEFAULT_MATERIAL)));
  }
  return lines.join("\n");
}

function buildSystemPrompt(project: string, activeDocument?: string): string {
  return `You are SolidPilot, an expert mechanical-design copilot embedded in a parametric CAD application. You have full context over the user's project — a folder of part documents — and you design and modify real solid geometry by editing those documents.

${SCHEMA_GUIDE}

# How to work
- Current project: "${project}". ${activeDocument ? `The user is looking at document "${activeDocument}".` : ""}
- Start by listing/reading the documents you need. Don't guess at contents.
- When creating or changing geometry, use update_document / create_document with the COMPLETE document. After every write you receive an evaluation report (errors + mass properties). If there are errors, fix them and write again before answering.
- When the user gives a numeric target (mass, volume, wall thickness, fit against another part), iterate: adjust parameters, re-check mass_properties, converge. Report achieved vs. target.
- Use parameters for anything the user may want to tweak; give them clear names and comments.
- Cross-part reasoning is your superpower: read sibling parts to match hole patterns, clearances, and interfaces.
- Be concise in prose. The user sees your geometry changes live in their viewport as a proposal they accept or reject — describe intent and key numbers, not JSON.
- Never invent tool results — never write out what a tool "would" return. Only report what a real tool call actually returned to you.

# Autonomous mode
Once the user gives you a task, complete EVERY step yourself — listing, reading, editing,
verifying — without pausing to ask "should I proceed?" or "would you like me to continue?".
The user already authorized the whole task in their one message. Only stop when the task is
fully done, or you are genuinely blocked on a decision only the user can make (e.g. two
reasonable interpretations with very different results).

# Calling tools
Always prefer the real function-calling mechanism to invoke a tool.
If you are ever unable to use it, write exactly ONE line containing ONLY a JSON object of the
form {"name": "<tool_name>", "arguments": { ... }} and STOP your reply immediately after that
line — do not write anything else, and above all do not write a fabricated result. The system
will execute the real tool and give you its true output as the next message.
Whenever you write JSON — a tool call or a document, real or narrated — it must be strictly
valid JSON: no // comments, no trailing commas, and every expression value must be a quoted
string ("width/2 - 4"), never bare (width/2 - 4). Do not explain a plan with example JSON and
then stop — either call the tool for real or write the single-line narrated call above; never
just describe what you would do.`;
}

/** Ollama's OpenAI-compatible endpoint doesn't check the key; any non-empty string works. */
function makeClient(): OpenAI {
  return new OpenAI({ baseURL: `${OLLAMA_HOST}/v1`, apiKey: "ollama" });
}

export async function runAgent(
  req: AgentRequest,
  emit: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const client = makeClient();

  // In-run view of documents: disk state + client overlay + this run's proposals.
  const overlay = new Map<string, CadDocument>(Object.entries(req.overlay ?? {}));
  const readDoc = (name: string): CadDocument =>
    overlay.get(name) ?? store.readDocument(req.project, name);
  const listDocs = (): string[] => {
    const names = new Set(store.listDocuments(req.project));
    for (const n of overlay.keys()) names.add(n);
    return [...names].sort();
  };

  /** Validate, evaluate, and emit a proposal for a document. Shared by the normal
   *  tool-call path and the plain-text recovery path below. */
  function proposeDocument(
    intendedTool: "create_document" | "update_document" | undefined,
    docName: string,
    doc: CadDocument,
    rationale: string,
  ): { ok: boolean; report: string } {
    const exists = listDocs().includes(docName);
    if (intendedTool === "create_document" && exists) {
      return { ok: false, report: `ERROR: document "${docName}" already exists. Use update_document.` };
    }
    if (intendedTool === "update_document" && !exists) {
      return { ok: false, report: `ERROR: document "${docName}" does not exist. Use create_document.` };
    }
    const check = validateDocument(doc);
    if (!check.ok) {
      return {
        ok: false,
        report: `VALIDATION ERRORS (document NOT proposed):\n${check.errors.map((e) => `  - ${e}`).join("\n")}`,
      };
    }
    const report = evaluationReport(doc);
    overlay.set(docName, doc);
    emit({ type: "proposal", name: docName, document: doc, created: !exists, rationale });
    return { ok: true, report: `Proposed. The user now sees this in their viewport.\n${report}` };
  }

  function handleTool(name: string, input: Record<string, unknown>): string {
    switch (name) {
      case "list_documents": {
        const names = listDocs();
        if (names.length === 0) return "Project is empty — no documents yet.";
        return names.map((n) => summarizeDocument(n, readDoc(n))).join("\n\n");
      }
      case "read_document": {
        return JSON.stringify(readDoc(String(input.name)), null, 2);
      }
      case "mass_properties": {
        return evaluationReport(readDoc(String(input.name))) || "No output.";
      }
      case "create_document":
      case "update_document": {
        const { report } = proposeDocument(
          name as "create_document" | "update_document",
          String(input.name),
          input.document as CadDocument,
          String(input.rationale ?? ""),
        );
        return report;
      }
      default:
        return `Unknown tool "${name}"`;
    }
  }

  /**
   * Small local models occasionally narrate a tool call as prose instead of
   * using the structured function-calling API — writing something like
   * `{"name": "read_document", "arguments": {"name": "enclosure-base"}}`
   * directly in their reply, sometimes followed by a fabricated "result" they
   * made up themselves. Detect the first such call, actually execute it for
   * real, and discard anything the model wrote after it (untrustworthy —
   * never a genuine tool result). This is what lets the agent keep making
   * real progress autonomously instead of stalling on a call nobody ran.
   */
  function extractNarratedToolCall(
    text: string,
  ): { toolName: string; args: Record<string, unknown>; before: string } | null {
    let from = 0;
    for (;;) {
      const found = scanBalancedObject(text, from);
      if (!found) return null;
      const parsed = parseJsonLoose(found.src) as { name?: unknown; arguments?: unknown } | undefined;
      if (parsed && typeof parsed.name === "string" && TOOL_NAMES.has(parsed.name)) {
        const args = parsed.arguments && typeof parsed.arguments === "object" ? parsed.arguments : {};
        return { toolName: parsed.name, args: args as Record<string, unknown>, before: text.slice(0, found.start).trim() };
      }
      from = found.end;
    }
  }

  /**
   * Small local models also sometimes print a whole edited document as JSON
   * directly in their reply instead of calling update_document/create_document
   * at all. Recover the edit rather than silently losing it (and dumping raw
   * JSON into the chat). Looks for a ```json fenced block first, then a
   * balanced top-level {...} — tried only after extractNarratedToolCall finds
   * nothing, since a narrated call may itself contain a nested document.
   */
  function extractDocumentFromText(
    text: string,
  ): { doc: CadDocument; before: string; after: string } | null {
    const tryParse = (candidate: string, start: number, end: number) => {
      const json = parseJsonLoose(candidate);
      if (json && typeof json === "object" && "version" in json && "features" in json) {
        return { doc: json as CadDocument, before: text.slice(0, start).trim(), after: text.slice(end).trim() };
      }
      return null;
    };

    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence && fence.index !== undefined) {
      const result = tryParse(fence[1], fence.index, fence.index + fence[0].length);
      if (result) return result;
    }

    const found = scanBalancedObject(text);
    return found ? tryParse(found.src, found.start, found.end) : null;
  }

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(req.project, req.activeDocument) },
    ...req.messages.map((m): ChatCompletionMessageParam => ({ role: m.role, content: m.content })),
  ];

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      if (signal?.aborted) break;
      const response = await client.chat.completions.create(
        { model: MODEL, messages, tools: TOOLS, tool_choice: "auto" },
        { signal },
      );

      const choice = response.choices[0];
      const message = choice.message;
      const toolCalls = message.tool_calls ?? [];

      if (toolCalls.length === 0) {
        // Model narrated a tool call instead of using the real API. Execute
        // it for real, splice the true result into history, and keep going
        // autonomously — this is what turns multi-step tasks into one shot
        // instead of requiring the user to nudge every step forward.
        const narrated = message.content ? extractNarratedToolCall(message.content) : null;
        if (narrated) {
          if (narrated.before) emit({ type: "text", text: narrated.before });
          emit({ type: "tool_start", name: narrated.toolName, input: narrated.args });
          let result: string;
          try {
            result = handleTool(narrated.toolName, narrated.args);
          } catch (err) {
            result = `ERROR: ${String((err as Error).message ?? err)}`;
          }
          emit({
            type: "tool_result",
            name: narrated.toolName,
            ok: !result.startsWith("ERROR") && !result.startsWith("VALIDATION"),
          });
          messages.push({ role: "assistant", content: narrated.before || null });
          messages.push({
            role: "user",
            content: `[SYSTEM: this is the real, authoritative result of the "${narrated.toolName}" call you requested — anything you wrote after that call in your previous reply was discarded as unverified. Continue the task.]\n${result}`,
          });
          continue;
        }

        // Model dumped a whole edited document as JSON instead of calling
        // update_document/create_document at all. Recover the edit, then let
        // the model see the same evaluation report a real call would return
        // and decide whether to continue or wrap up.
        const recovered = message.content ? extractDocumentFromText(message.content) : null;
        if (recovered) {
          if (recovered.before) emit({ type: "text", text: recovered.before });
          const docName = recovered.doc.name || req.activeDocument || "untitled";
          emit({ type: "tool_start", name: "update_document", input: { name: docName } });
          const { ok, report } = proposeDocument(undefined, docName, recovered.doc, recovered.after);
          emit({ type: "tool_result", name: "update_document", ok });
          messages.push({ role: "assistant", content: recovered.before || null });
          messages.push({
            role: "user",
            content: `[SYSTEM: this is the real result of proposing that document — anything you wrote after the JSON in your previous reply was discarded.]\n${report}`,
          });
          continue;
        }

        if (message.content && message.content.trim()) {
          emit({ type: "text", text: sanitizeUnparsedReply(message.content) });
        }
        break;
      }

      if (message.content && message.content.trim()) {
        emit({ type: "text", text: message.content });
      }
      messages.push({ role: "assistant", content: message.content ?? null, tool_calls: toolCalls });

      for (const call of toolCalls) {
        const fnName = call.function.name;
        let args: Record<string, unknown> = {};
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: `ERROR: could not parse arguments as JSON: ${call.function.arguments}`,
          });
          continue;
        }

        emit({ type: "tool_start", name: fnName, input: args });
        let result: string;
        try {
          result = handleTool(fnName, args);
        } catch (err) {
          result = `ERROR: ${String((err as Error).message ?? err)}`;
        }
        emit({
          type: "tool_result",
          name: fnName,
          ok: !result.startsWith("ERROR") && !result.startsWith("VALIDATION"),
        });
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
    }
  } catch (err) {
    const message = String((err as Error).message ?? err);
    const hint = message.includes("ECONNREFUSED") || message.includes("fetch failed")
      ? ` Is Ollama running? Start it with "ollama serve" and make sure "${MODEL}" is pulled ("ollama pull ${MODEL}").`
      : "";
    emit({ type: "error", message: message + hint });
  }
  emit({ type: "done" });
}

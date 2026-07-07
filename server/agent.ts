/**
 * The SolidPilot copilot: a server-side agent loop over the Claude API.
 *
 * The agent has project-wide context (every part file in the project folder)
 * and tools to read, measure, and rewrite documents. Writes are NOT saved to
 * disk — they stream to the client as *proposals* that the user accepts or
 * rejects in the viewport, exactly like reviewing an AI edit in Cursor.
 */

import Anthropic from "@anthropic-ai/sdk";
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

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
const MAX_ITERATIONS = 24;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "list_documents",
    description:
      "List every part document in the current project with a one-line summary (parameters, features, bodies). Use this to understand what exists before reading or editing.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "read_document",
    description: "Read the full JSON of one part document in the project.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string", description: "Document name (no extension)" } },
      required: ["name"],
    },
  },
  {
    name: "mass_properties",
    description:
      "Evaluate a document's geometry and return mass properties per body: volume, mass (from material density), surface area, bounding box, center of mass. Use this to verify a design hits numeric targets.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string", description: "Document name" } },
      required: ["name"],
    },
  },
  {
    name: "update_document",
    description:
      "Propose a full replacement of one document. The document is validated and its geometry evaluated; you get back any errors plus resulting mass properties. The change is shown to the user as a live preview in their viewport for accept/reject — it is not saved until they accept. Always send the COMPLETE document JSON.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Document name to update" },
        document: { type: "object", description: "The complete new document JSON" },
        rationale: { type: "string", description: "One sentence: what changed and why" },
      },
      required: ["name", "document"],
    },
  },
  {
    name: "create_document",
    description:
      "Create a brand-new part document in the project (proposed to the user for accept/reject, like update_document). Always send the COMPLETE document JSON.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "New document name (letters, digits, - _ only)" },
        document: { type: "object", description: "The complete document JSON" },
        rationale: { type: "string" },
      },
      required: ["name", "document"],
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
- Never invent tool results. If something fails repeatedly, explain what you tried and ask a precise question.`;
}

export async function runAgent(
  req: AgentRequest,
  emit: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    emit({
      type: "error",
      message: "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key to enable the copilot.",
    });
    emit({ type: "done" });
    return;
  }
  const client = new Anthropic({ apiKey });

  // In-run view of documents: disk state + client overlay + this run's proposals.
  const overlay = new Map<string, CadDocument>(Object.entries(req.overlay ?? {}));
  const readDoc = (name: string): CadDocument =>
    overlay.get(name) ?? store.readDocument(req.project, name);
  const listDocs = (): string[] => {
    const names = new Set(store.listDocuments(req.project));
    for (const n of overlay.keys()) names.add(n);
    return [...names].sort();
  };

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
        const docName = String(input.name);
        if (name === "create_document" && listDocs().includes(docName)) {
          return `ERROR: document "${docName}" already exists. Use update_document.`;
        }
        if (name === "update_document" && !listDocs().includes(docName)) {
          return `ERROR: document "${docName}" does not exist. Use create_document.`;
        }
        const doc = input.document as CadDocument;
        const check = validateDocument(doc);
        if (!check.ok) {
          return `VALIDATION ERRORS (document NOT proposed):\n${check.errors.map((e) => `  - ${e}`).join("\n")}`;
        }
        const report = evaluationReport(doc);
        overlay.set(docName, doc);
        emit({
          type: "proposal",
          name: docName,
          document: doc,
          created: name === "create_document",
          rationale: input.rationale ?? "",
        });
        return `Proposed. The user now sees this in their viewport.\n${report}`;
      }
      default:
        return `Unknown tool "${name}"`;
    }
  }

  const messages: Anthropic.MessageParam[] = req.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      if (signal?.aborted) break;
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 8192,
        system: buildSystemPrompt(req.project, req.activeDocument),
        tools: TOOLS,
        messages,
      });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === "text" && block.text.trim()) {
          emit({ type: "text", text: block.text });
        } else if (block.type === "tool_use") {
          emit({ type: "tool_start", name: block.name, input: block.input });
          let result: string;
          try {
            result = handleTool(block.name, (block.input ?? {}) as Record<string, unknown>);
          } catch (err) {
            result = `ERROR: ${String((err as Error).message ?? err)}`;
          }
          emit({
            type: "tool_result",
            name: block.name,
            ok: !result.startsWith("ERROR") && !result.startsWith("VALIDATION"),
          });
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
        }
      }

      if (response.stop_reason === "tool_use" && toolResults.length > 0) {
        messages.push({ role: "assistant", content: response.content });
        messages.push({ role: "user", content: toolResults });
        continue;
      }
      break;
    }
  } catch (err) {
    emit({ type: "error", message: String((err as Error).message ?? err) });
  }
  emit({ type: "done" });
}

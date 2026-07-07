/** Client-side API layer: project CRUD + streaming copilot events (SSE over fetch). */

import type { CadDocument } from "./kernel/types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () =>
    fetch("/api/health").then((r) => json<{ ok: boolean; hasApiKey: boolean; model: string }>(r)),
  listProjects: () => fetch("/api/projects").then((r) => json<{ projects: string[] }>(r)),
  createProject: (name: string) =>
    fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).then((r) => json<{ ok: boolean }>(r)),
  listDocuments: (project: string) =>
    fetch(`/api/projects/${encodeURIComponent(project)}/documents`).then((r) =>
      json<{ documents: string[] }>(r),
    ),
  readDocument: (project: string, name: string) =>
    fetch(`/api/projects/${encodeURIComponent(project)}/documents/${encodeURIComponent(name)}`).then(
      (r) => json<{ document: CadDocument }>(r),
    ),
  writeDocument: (project: string, name: string, document: CadDocument) =>
    fetch(`/api/projects/${encodeURIComponent(project)}/documents/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document }),
    }).then((r) => json<{ ok: boolean }>(r)),
  deleteDocument: (project: string, name: string) =>
    fetch(`/api/projects/${encodeURIComponent(project)}/documents/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }).then((r) => json<{ ok: boolean }>(r)),
};

export interface AgentStreamEvent {
  type: "text" | "tool_start" | "tool_result" | "proposal" | "error" | "done";
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  ok?: boolean;
  document?: CadDocument;
  created?: boolean;
  rationale?: string;
  message?: string;
}

export async function streamAgent(
  body: {
    project: string;
    activeDocument?: string;
    messages: { role: "user" | "assistant"; content: string }[];
    overlay?: Record<string, CadDocument>;
  },
  onEvent: (e: AgentStreamEvent) => void,
): Promise<void> {
  const res = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    onEvent({ type: "error", message: `Copilot request failed (${res.status})` });
    onEvent({ type: "done" });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.trim();
      if (!line.startsWith("data:")) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()) as AgentStreamEvent);
      } catch {
        // skip malformed chunk
      }
    }
  }
}

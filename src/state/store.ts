/** Application state (zustand): project, active document, evaluation, AI chat, dialogs. */

import { create } from "zustand";
import { api, streamAgent, type AgentStreamEvent } from "../api";
import { evaluateDocument, type EvaluationResult } from "../kernel/evaluate";
import type { CadDocument, Feature } from "../kernel/types";
import { emptyDocument } from "../kernel/types";

export interface ChatItem {
  role: "user" | "assistant" | "event";
  content: string;
  kind?: "tool" | "error";
}

export interface Proposal {
  name: string;
  document: CadDocument;
  created: boolean;
  rationale: string;
  /** Document state before the proposal (null when created). */
  baseline: CadDocument | null;
}

export type DialogKind =
  | { kind: "feature"; featureType: Feature["type"]; editId?: string }
  | { kind: "parameters" }
  | { kind: "newDocument" }
  | { kind: "sketchEntity"; sketchId: string; entityKind: "rect" | "circle" | "slot" | "ngon"; editEntityId?: string };

export interface SketchMode {
  sketchId: string;
  tool: "rect" | "circle" | null;
}

interface AppState {
  project: string | null;
  documents: string[];
  activeDoc: string | null;
  doc: CadDocument | null;
  evaluation: EvaluationResult | null;
  /** Evaluation of the proposal being previewed (if any). */
  proposalEvaluation: EvaluationResult | null;
  selection: string | null;
  showSketches: boolean;
  sectionView: boolean;
  ribbonTab: "solid" | "sketch" | "modify" | "inspect";
  dialog: DialogKind | null;
  sketchMode: SketchMode | null;
  proposals: Record<string, Proposal>;
  chat: ChatItem[];
  aiBusy: boolean;
  aiAvailable: boolean | null;
  aiModel: string;
  error: string | null;

  init: () => Promise<void>;
  openDocument: (name: string) => Promise<void>;
  createDocument: (name: string) => Promise<void>;
  deleteDocument: (name: string) => Promise<void>;
  /** Mutate the active document, re-evaluate and persist. */
  updateDoc: (mutate: (doc: CadDocument) => void) => void;
  setSelection: (id: string | null) => void;
  setRibbonTab: (tab: AppState["ribbonTab"]) => void;
  setDialog: (d: DialogKind | null) => void;
  setSketchMode: (m: SketchMode | null) => void;
  setShowSketches: (v: boolean) => void;
  setSectionView: (v: boolean) => void;
  sendChat: (text: string) => Promise<void>;
  acceptProposal: (name: string) => Promise<void>;
  rejectProposal: (name: string) => void;
  clearError: () => void;
}

function safeEvaluate(doc: CadDocument): EvaluationResult {
  try {
    return evaluateDocument(doc);
  } catch (err) {
    return {
      bodies: [],
      sketches: [],
      errors: [{ featureId: "$document", message: String((err as Error).message ?? err) }],
      params: {},
    };
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useStore = create<AppState>((set, get) => ({
  project: null,
  documents: [],
  activeDoc: null,
  doc: null,
  evaluation: null,
  proposalEvaluation: null,
  selection: null,
  showSketches: true,
  sectionView: false,
  ribbonTab: "solid",
  dialog: null,
  sketchMode: null,
  proposals: {},
  chat: [],
  aiBusy: false,
  aiAvailable: null,
  aiModel: "",
  error: null,

  init: async () => {
    try {
      const health = await api.health();
      set({ aiAvailable: health.aiReady, aiModel: health.model });
      let { projects } = await api.listProjects();
      if (projects.length === 0) {
        await api.createProject("my-project");
        projects = ["my-project"];
      }
      const project = projects[0];
      const { documents } = await api.listDocuments(project);
      set({ project, documents });
      if (documents.length > 0) await get().openDocument(documents[0]);
    } catch (err) {
      set({ error: String((err as Error).message ?? err) });
    }
  },

  openDocument: async (name) => {
    const { project, proposals } = get();
    if (!project) return;
    try {
      // `doc`/`evaluation` always reflect the saved state; a pending proposal is
      // evaluated separately and previewed on top until accepted or rejected.
      const proposal = proposals[name];
      const saved = proposal?.created ? null : (await api.readDocument(project, name)).document;
      set({
        activeDoc: name,
        doc: saved,
        evaluation: saved ? safeEvaluate(saved) : null,
        proposalEvaluation: proposal ? safeEvaluate(proposal.document) : null,
        selection: null,
        sketchMode: null,
      });
    } catch (err) {
      set({ error: String((err as Error).message ?? err) });
    }
  },

  createDocument: async (name) => {
    const { project } = get();
    if (!project) return;
    try {
      const doc = emptyDocument(name);
      await api.writeDocument(project, name, doc);
      const { documents } = await api.listDocuments(project);
      set({ documents });
      await get().openDocument(name);
    } catch (err) {
      set({ error: String((err as Error).message ?? err) });
    }
  },

  deleteDocument: async (name) => {
    const { project, activeDoc } = get();
    if (!project) return;
    try {
      await api.deleteDocument(project, name);
      const { documents } = await api.listDocuments(project);
      set({ documents });
      if (activeDoc === name) {
        set({ activeDoc: null, doc: null, evaluation: null, proposalEvaluation: null });
        if (documents.length > 0) await get().openDocument(documents[0]);
      }
    } catch (err) {
      set({ error: String((err as Error).message ?? err) });
    }
  },

  updateDoc: (mutate) => {
    const { doc, project, activeDoc } = get();
    if (!doc || !project || !activeDoc) return;
    const next = structuredClone(doc);
    mutate(next);
    set({ doc: next, evaluation: safeEvaluate(next) });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      api.writeDocument(project, activeDoc, next).catch((err) =>
        set({ error: `Save failed: ${String((err as Error).message ?? err)}` }),
      );
    }, 400);
  },

  setSelection: (id) => set({ selection: id }),
  setRibbonTab: (tab) => set({ ribbonTab: tab }),
  setDialog: (d) => set({ dialog: d }),
  setSketchMode: (m) => set({ sketchMode: m, ribbonTab: m ? "sketch" : get().ribbonTab }),
  setShowSketches: (v) => set({ showSketches: v }),
  setSectionView: (v) => set({ sectionView: v }),
  clearError: () => set({ error: null }),

  sendChat: async (text) => {
    const { project, activeDoc, chat, aiBusy, doc, proposals } = get();
    if (!project || aiBusy || !text.trim()) return;

    const history = chat
      .filter((c) => c.role === "user" || c.role === "assistant")
      .map((c) => ({ role: c.role as "user" | "assistant", content: c.content }));

    set({ chat: [...chat, { role: "user", content: text }], aiBusy: true });

    // Give the agent the client's live view: unsaved active doc + pending proposals.
    const overlay: Record<string, CadDocument> = {};
    for (const p of Object.values(proposals)) overlay[p.name] = p.document;
    if (doc && activeDoc) overlay[activeDoc] = doc;

    const push = (item: ChatItem) => set((s) => ({ chat: [...s.chat, item] }));

    await streamAgent(
      { project, activeDocument: activeDoc ?? undefined, messages: [...history, { role: "user", content: text }], overlay },
      (e: AgentStreamEvent) => {
        switch (e.type) {
          case "text":
            push({ role: "assistant", content: e.text ?? "" });
            break;
          case "tool_start": {
            const label =
              e.name === "read_document"
                ? `Reading ${(e.input as { name?: string })?.name ?? "document"}…`
                : e.name === "list_documents"
                  ? "Scanning project…"
                  : e.name === "mass_properties"
                    ? `Measuring ${(e.input as { name?: string })?.name ?? "part"}…`
                    : e.name === "update_document"
                      ? `Editing ${(e.input as { name?: string })?.name ?? "part"}…`
                      : e.name === "create_document"
                        ? `Creating ${(e.input as { name?: string })?.name ?? "part"}…`
                        : `${e.name}…`;
            push({ role: "event", content: label, kind: "tool" });
            break;
          }
          case "proposal": {
            const name = e.name ?? "";
            const state = get();
            const isActive = name === state.activeDoc;
            const baseline = e.created
              ? null
              : (state.proposals[name]?.baseline ?? (isActive ? state.doc : null));
            const proposal: Proposal = {
              name,
              document: e.document!,
              created: Boolean(e.created),
              rationale: e.rationale ?? "",
              baseline,
            };
            const documents = state.documents.includes(name)
              ? state.documents
              : [...state.documents, name].sort();
            set({
              proposals: { ...state.proposals, [name]: proposal },
              documents,
              ...(isActive || state.activeDoc === null
                ? {
                    activeDoc: name,
                    proposalEvaluation: safeEvaluate(e.document!),
                  }
                : {}),
            });
            break;
          }
          case "error":
            push({ role: "event", content: e.message ?? "Unknown error", kind: "error" });
            break;
          case "done":
            set({ aiBusy: false });
            break;
        }
      },
    ).catch((err) => {
      push({ role: "event", content: String((err as Error).message ?? err), kind: "error" });
      set({ aiBusy: false });
    });
    set({ aiBusy: false });
  },

  acceptProposal: async (name) => {
    const { project, proposals, activeDoc } = get();
    const proposal = proposals[name];
    if (!project || !proposal) return;
    try {
      await api.writeDocument(project, name, proposal.document);
      const { documents } = await api.listDocuments(project);
      const next = { ...proposals };
      delete next[name];
      set({ proposals: next, documents, proposalEvaluation: activeDoc === name ? null : get().proposalEvaluation });
      if (activeDoc === name) {
        set({ doc: proposal.document, evaluation: safeEvaluate(proposal.document) });
      }
    } catch (err) {
      set({ error: String((err as Error).message ?? err) });
    }
  },

  rejectProposal: (name) => {
    const { proposals, activeDoc, documents } = get();
    const proposal = proposals[name];
    if (!proposal) return;
    const next = { ...proposals };
    delete next[name];
    const patch: Partial<AppState> = { proposals: next };
    if (proposal.created) {
      patch.documents = documents.filter((d) => d !== name);
      if (activeDoc === name) {
        patch.activeDoc = null;
        patch.doc = null;
        patch.evaluation = null;
      }
    }
    if (activeDoc === name) patch.proposalEvaluation = null;
    set(patch as AppState);
  },
}));

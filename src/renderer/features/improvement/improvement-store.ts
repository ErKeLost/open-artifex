import { create } from "zustand";
import type {
  AddImprovementFeedbackInput,
  CreateImprovementCandidateInput,
  EvaluateImprovementCandidateInput,
  ImprovementSnapshot,
  ImprovementScope,
  RequestImprovementPublicationInput,
  ResolveImprovementPublicationInput,
  RollbackImprovementCandidateInput,
} from "../../../shared/improvement-protocol.js";

export type ImprovementStoreStatus = "idle" | "loading" | "ready" | "error";

interface ImprovementStore {
  status: ImprovementStoreStatus;
  error?: string;
  snapshot: ImprovementSnapshot;
  initialize(scope: ImprovementScope): Promise<void>;
  refresh(scope: ImprovementScope): Promise<void>;
  addFeedback(input: AddImprovementFeedbackInput): Promise<void>;
  createCandidate(input: CreateImprovementCandidateInput): Promise<void>;
  evaluateCandidate(input: EvaluateImprovementCandidateInput): Promise<void>;
  requestPublication(input: RequestImprovementPublicationInput): Promise<void>;
  resolvePublication(
    input: ResolveImprovementPublicationInput,
  ): Promise<void>;
  rollback(input: RollbackImprovementCandidateInput): Promise<void>;
}

function api() {
  if (typeof window === "undefined" || !window.openArtifex) {
    throw new Error("桌面 API 尚未连接");
  }
  return window.openArtifex;
}

function resultValue<Value>(
  result:
    | { ok: true; value: Value }
    | { ok: false; error: { message: string } },
): Value {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function scopeKey(scope: ImprovementScope): string {
  return `${scope.workspacePath}\0${scope.model ?? ""}\0${scope.reasoningEffort ?? ""}`;
}

let activeScope: string | undefined;
let initialization: Promise<void> | undefined;

export const useImprovementStore = create<ImprovementStore>((set) => ({
  status: "idle",
  snapshot: { traces: [], candidates: [] },

  async initialize(scope) {
    const nextScope = scopeKey(scope);
    if (initialization && activeScope === nextScope) return initialization;
    activeScope = nextScope;
    initialization = (async () => {
      set({ status: "loading", error: undefined });
      try {
        set({ snapshot: resultValue(await api().improvement.list(scope)), status: "ready" });
      } catch (error) {
        set({
          status: "error",
          error: error instanceof Error ? error.message : "改进记录加载失败",
        });
      } finally {
        initialization = undefined;
      }
    })();
    return initialization;
  },

  async refresh(scope) {
    const snapshot = resultValue(await api().improvement.list(scope));
    activeScope = scopeKey(scope);
    set({ snapshot, status: "ready", error: undefined });
  },

  async addFeedback(input) {
    const snapshot = resultValue(await api().improvement.addFeedback(input));
    set({ snapshot, status: "ready", error: undefined });
  },

  async createCandidate(input) {
    const snapshot = resultValue(
      await api().improvement.createCandidate(input),
    );
    set({ snapshot, status: "ready", error: undefined });
  },

  async evaluateCandidate(input) {
    const snapshot = resultValue(
      await api().improvement.evaluateCandidate(input),
    );
    set({ snapshot, status: "ready", error: undefined });
  },

  async requestPublication(input) {
    const snapshot = resultValue(
      await api().improvement.requestPublication(input),
    );
    set({ snapshot, status: "ready", error: undefined });
  },

  async resolvePublication(input) {
    const snapshot = resultValue(
      await api().improvement.resolvePublication(input),
    );
    set({ snapshot, status: "ready", error: undefined });
  },

  async rollback(input) {
    const snapshot = resultValue(await api().improvement.rollback(input));
    set({ snapshot, status: "ready", error: undefined });
  },
}));

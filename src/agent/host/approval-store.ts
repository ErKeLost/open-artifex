import { randomUUID } from "node:crypto";

import type {
  AgentApprovalResolution,
  RuntimeApprovalRequest,
  RuntimeApprovalResult,
  ToolEventPayload,
} from "../../shared/agent-protocol.js";

interface PendingApproval {
  runId: string;
  toolCallId: string;
  request: RuntimeApprovalRequest;
  resolve(result: RuntimeApprovalResult): void;
  reject(error: Error): void;
  removeAbortListener(): void;
}

type EmitApprovalEvent = (
  runId: string,
  type: "tool.approval_required" | "tool.updated",
  payload: ToolEventPayload,
) => void;

/** Owns one-shot approval promises and ensures cancellation settles each waiter. */
export class ApprovalStore {
  readonly #pending = new Map<string, PendingApproval>();

  constructor(private readonly emit: EmitApprovalEvent) {}

  request(
    runId: string,
    request: RuntimeApprovalRequest,
    signal: AbortSignal,
  ): Promise<RuntimeApprovalResult> {
    if (signal.aborted) return Promise.reject(createAbortError());

    const approvalId = randomUUID();
    this.emit(runId, "tool.approval_required", {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      approval: {
        id: approvalId,
        status: "pending",
        risk: request.risk,
        reason: request.reason,
        preview: request.preview,
      },
    });

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.#pending.delete(approvalId);
        reject(createAbortError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.#pending.set(approvalId, {
        runId,
        toolCallId: request.toolCallId,
        request,
        resolve,
        reject,
        removeAbortListener: () => signal.removeEventListener("abort", onAbort),
      });
    });
  }

  resolve(resolution: AgentApprovalResolution): void {
    const pending = this.#pending.get(resolution.approvalId);
    if (
      !pending ||
      pending.runId !== resolution.runId ||
      pending.toolCallId !== resolution.toolCallId
    ) {
      return;
    }

    this.#pending.delete(resolution.approvalId);
    pending.removeAbortListener();
    this.emit(resolution.runId, "tool.updated", {
      toolCallId: resolution.toolCallId,
      toolName: pending.request.toolName,
      approval: {
        id: resolution.approvalId,
        status: resolution.decision === "reject" ? "rejected" : "approved",
        risk: pending.request.risk,
        reason: pending.request.reason,
        preview: pending.request.preview,
      },
    });
    pending.resolve(resolution);
  }

  rejectRun(runId: string, error: Error): void {
    for (const [approvalId, pending] of this.#pending) {
      if (pending.runId !== runId) continue;
      this.#pending.delete(approvalId);
      pending.removeAbortListener();
      pending.reject(error);
    }
  }
}

function createAbortError(): Error {
  const error = new Error("Agent run was cancelled");
  error.name = "AbortError";
  return error;
}

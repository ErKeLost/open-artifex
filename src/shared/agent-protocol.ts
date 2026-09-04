/**
 * Process-neutral contracts for the agent runtime.
 *
 * Keep this module free of Tauri, Mastra and renderer imports. Every value that
 * crosses this boundary must be accepted by the structured clone algorithm. Tool
 * adapters should reduce richer values (Buffers, Errors, class instances) to JSON
 * before emitting them.
 */

import type {
  BrowserCommand,
  BrowserCommandResponse,
  BrowserEvent,
  BrowserSessionState,
} from "./browser-protocol.js";
import {
  isBrowserCommand,
  isBrowserEvent,
  isBrowserSessionState,
} from "./browser-protocol.js";
import type { OpenRouterReasoningEffort } from "./openrouter-protocol.js";

export const AGENT_PROTOCOL_VERSION = 1 as const;

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type AgentRunStatus = "completed" | "cancelled";
export type ApprovalDecision = "approve-once" | "approve-session" | "reject";
export type ApprovalRisk = "low" | "medium" | "high";

export interface AgentRunInput {
  threadId: string;
  prompt: string;
  workspacePath?: string;
  model?: string;
  reasoningEffort?: OpenRouterReasoningEffort;
}

/** Internal request. The main process adds credentials; the renderer never can. */
export interface AgentRunRequest extends Omit<AgentRunInput, "workspacePath"> {
  runId: string;
  workspacePath: string;
  provider: {
    kind: "openrouter";
    apiKey: string;
    model: string;
  };
}

export interface AgentApprovalResolution {
  runId: string;
  approvalId: string;
  toolCallId: string;
  decision: ApprovalDecision;
  message?: string;
}

export interface RuntimeApprovalRequest {
  toolCallId: string;
  toolName: string;
  reason: string;
  risk: ApprovalRisk;
  preview?: string;
}

export interface RuntimeApprovalResult extends AgentApprovalResolution {}

export interface AgentUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

export interface AgentError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ToolEventPayload {
  toolCallId: string;
  toolName: string;
  title?: string;
  input?: JsonValue;
  output?: JsonValue;
  error?: AgentError;
  progress?: {
    current?: number;
    total?: number;
    message?: string;
  };
  startedAt?: number;
  completedAt?: number;
  approval?: {
    id: string;
    status: "pending" | "approved" | "rejected";
    risk: ApprovalRisk;
    reason: string;
    preview?: string;
  };
}

export interface AgentEventPayloadMap {
  "run.started": {
    threadId: string;
    workspacePath: string;
    model: string;
  };
  "run.status": {
    stage: string;
    message?: string;
  };
  "reasoning.delta": {
    delta: string;
  };
  "assistant.delta": {
    delta: string;
  };
  "assistant.completed": {
    text: string;
  };
  "tool.started": ToolEventPayload;
  "tool.updated": ToolEventPayload;
  "tool.completed": ToolEventPayload;
  "tool.failed": ToolEventPayload;
  "tool.approval_required": ToolEventPayload;
  "usage.updated": AgentUsage;
  "run.completed": {
    status: AgentRunStatus;
    finalText?: string;
    usage?: AgentUsage;
  };
  "run.failed": {
    error: AgentError;
  };
}

export type AgentEventType = keyof AgentEventPayloadMap;

export type AgentEvent = {
  [Type in AgentEventType]: {
    id: string;
    runId: string;
    sequence: number;
    timestamp: number;
    type: Type;
    payload: AgentEventPayloadMap[Type];
  };
}[AgentEventType];

/** Events a runtime adapter may emit. The worker owns run lifecycle and approval. */
export type RuntimeEventType = Exclude<
  AgentEventType,
  "run.started" | "run.completed" | "run.failed" | "tool.approval_required"
>;

export type AgentRuntimeEvent = {
  [Type in RuntimeEventType]: {
    type: Type;
    payload: AgentEventPayloadMap[Type];
  };
}[RuntimeEventType];

export interface AgentRunResult {
  status: AgentRunStatus;
  finalText?: string;
  usage?: AgentUsage;
}

export interface AgentRuntimeContext {
  signal: AbortSignal;
  emit(event: AgentRuntimeEvent): void;
  requestApproval(
    request: RuntimeApprovalRequest,
  ): Promise<RuntimeApprovalResult>;
}

/** Browser capability exposed by the agent-host runtime. */
export interface AgentBrowserRuntime {
  execute(command: BrowserCommand): Promise<BrowserSessionState | void>;
  onEvent(listener: (event: BrowserEvent) => void): () => void;
}

export interface AgentScheduleRuntime {
  execute(command: JsonValue): Promise<JsonValue>;
}

/** Durable conversation index backed by the same memory store as agent runs. */
export interface AgentConversationRuntime {
  execute(command: JsonValue): Promise<JsonValue>;
}

/** Controlled self-improvement APIs backed by Mastra workflows and storage. */
export interface AgentImprovementRuntime {
  execute(command: JsonValue): Promise<JsonValue>;
}

/**
 * Dependency-inversion seam implemented by `src/agent/runtime.ts`.
 * Implementations may use Mastra internally; callers in the Tauri bridge and renderer may not.
 */
export interface AgentRuntime {
  initialize?(): Promise<void>;
  run(
    request: AgentRunRequest,
    context: AgentRuntimeContext,
  ): Promise<AgentRunResult>;
  browser?: AgentBrowserRuntime;
  schedules?: AgentScheduleRuntime;
  conversations?: AgentConversationRuntime;
  improvement?: AgentImprovementRuntime;
  dispose?(): Promise<void>;
}

export type AgentRuntimeFactory = () => AgentRuntime | Promise<AgentRuntime>;

export interface AgentRuntimeModule {
  createAgentRuntime: AgentRuntimeFactory;
}

export type MainToAgentMessage =
  | {
      version: typeof AGENT_PROTOCOL_VERSION;
      type: "agent.run";
      request: AgentRunRequest;
    }
  | {
      version: typeof AGENT_PROTOCOL_VERSION;
      type: "agent.cancel";
      runId: string;
    }
  | {
      version: typeof AGENT_PROTOCOL_VERSION;
      type: "agent.approval.resolve";
      resolution: AgentApprovalResolution;
    }
  | {
      version: typeof AGENT_PROTOCOL_VERSION;
      type: "agent.shutdown";
    }
  | {
      version: typeof AGENT_PROTOCOL_VERSION;
      type: "browser.command";
      requestId: string;
      command: BrowserCommand;
    }
  | {
      version: typeof AGENT_PROTOCOL_VERSION;
      type: "schedule.command";
      requestId: string;
      command: JsonValue;
    }
  | {
      version: typeof AGENT_PROTOCOL_VERSION;
      type: "conversation.command";
      requestId: string;
      command: JsonValue;
    }
  | {
      version: typeof AGENT_PROTOCOL_VERSION;
      type: "improvement.command";
      requestId: string;
      command: JsonValue;
    };

export type AgentToMainMessage =
  | {
      version: typeof AGENT_PROTOCOL_VERSION;
      type: "agent.ready";
    }
  | {
      version: typeof AGENT_PROTOCOL_VERSION;
      type: "agent.event";
      event: AgentEvent;
    }
  | {
      version: typeof AGENT_PROTOCOL_VERSION;
      type: "agent.run.finished";
      runId: string;
    }
  | {
      version: typeof AGENT_PROTOCOL_VERSION;
      type: "agent.worker.error";
      runId?: string;
      error: AgentError;
    }
  | {
      version: typeof AGENT_PROTOCOL_VERSION;
      type: "browser.response";
      response: BrowserCommandResponse;
    }
  | {
      version: typeof AGENT_PROTOCOL_VERSION;
      type: "browser.event";
      event: BrowserEvent;
    }
  | {
      version: typeof AGENT_PROTOCOL_VERSION;
      type: "schedule.response";
      requestId: string;
      ok: boolean;
      value?: JsonValue;
      error?: AgentError;
    }
  | {
      version: typeof AGENT_PROTOCOL_VERSION;
      type: "conversation.response";
      requestId: string;
      ok: boolean;
      value?: JsonValue;
      error?: AgentError;
    }
  | {
      version: typeof AGENT_PROTOCOL_VERSION;
      type: "improvement.response";
      requestId: string;
      ok: boolean;
      value?: JsonValue;
      error?: AgentError;
    };

const MAX_ID_LENGTH = 256;
const MAX_PATH_LENGTH = 16_384;
const MAX_PROMPT_LENGTH = 2_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= maxLength
  );
}

export function isAgentRunInput(value: unknown): value is AgentRunInput {
  if (!isRecord(value)) return false;

  return (
    isBoundedString(value.threadId, MAX_ID_LENGTH) &&
    isBoundedString(value.prompt, MAX_PROMPT_LENGTH) &&
    (value.workspacePath === undefined ||
      isBoundedString(value.workspacePath, MAX_PATH_LENGTH)) &&
    (value.model === undefined ||
      isBoundedString(value.model, MAX_ID_LENGTH)) &&
    (value.reasoningEffort === undefined ||
      isBoundedString(value.reasoningEffort, 32))
  );
}

export function isAgentApprovalResolution(
  value: unknown,
): value is AgentApprovalResolution {
  if (!isRecord(value)) return false;

  return (
    isBoundedString(value.runId, MAX_ID_LENGTH) &&
    isBoundedString(value.approvalId, MAX_ID_LENGTH) &&
    isBoundedString(value.toolCallId, MAX_ID_LENGTH) &&
    (value.decision === "approve-once" ||
      value.decision === "approve-session" ||
      value.decision === "reject") &&
    (value.message === undefined ||
      (typeof value.message === "string" && value.message.length <= 10_000))
  );
}

export function isAgentEvent(value: unknown): value is AgentEvent {
  if (!isRecord(value) || !isRecord(value.payload)) return false;

  return (
    isBoundedString(value.id, MAX_ID_LENGTH) &&
    isBoundedString(value.runId, MAX_ID_LENGTH) &&
    typeof value.sequence === "number" &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence >= 0 &&
    typeof value.timestamp === "number" &&
    Number.isFinite(value.timestamp) &&
    AGENT_EVENT_TYPES.has(value.type)
  );
}

export function isMainToAgentMessage(
  value: unknown,
): value is MainToAgentMessage {
  if (!isRecord(value) || value.version !== AGENT_PROTOCOL_VERSION)
    return false;

  switch (value.type) {
    case "agent.run":
      return isAgentRunRequest(value.request);
    case "agent.cancel":
      return isBoundedString(value.runId, MAX_ID_LENGTH);
    case "agent.approval.resolve":
      return isAgentApprovalResolution(value.resolution);
    case "agent.shutdown":
      return true;
    case "browser.command":
      return (
        isBoundedString(value.requestId, MAX_ID_LENGTH) &&
        isBrowserCommand(value.command)
      );
    case "schedule.command":
    case "conversation.command":
    case "improvement.command":
      return (
        isBoundedString(value.requestId, MAX_ID_LENGTH) &&
        isJsonValue(value.command)
      );
    default:
      return false;
  }
}

export function isAgentToMainMessage(
  value: unknown,
): value is AgentToMainMessage {
  if (!isRecord(value) || value.version !== AGENT_PROTOCOL_VERSION)
    return false;

  switch (value.type) {
    case "agent.ready":
      return true;
    case "agent.event":
      return isAgentEvent(value.event);
    case "agent.run.finished":
      return isBoundedString(value.runId, MAX_ID_LENGTH);
    case "agent.worker.error":
      return (
        (value.runId === undefined ||
          isBoundedString(value.runId, MAX_ID_LENGTH)) &&
        isAgentError(value.error)
      );
    case "browser.response":
      return isBrowserCommandResponse(value.response);
    case "browser.event":
      return isBrowserEvent(value.event);
    case "schedule.response":
    case "conversation.response":
    case "improvement.response":
      return (
        isBoundedString(value.requestId, MAX_ID_LENGTH) &&
        typeof value.ok === "boolean" &&
        (value.value === undefined || isJsonValue(value.value)) &&
        (value.error === undefined || isAgentError(value.error)) &&
        (value.ok ? value.error === undefined : value.error !== undefined)
      );
    default:
      return false;
  }
}

function isBrowserCommandResponse(
  value: unknown,
): value is BrowserCommandResponse {
  if (!isRecord(value)) return false;
  if (
    value.version !== 1 ||
    !isBoundedString(value.requestId, MAX_ID_LENGTH) ||
    !isBoundedString(value.threadId, MAX_ID_LENGTH) ||
    typeof value.ok !== "boolean"
  ) {
    return false;
  }
  if (value.state !== undefined && !isBrowserSessionState(value.state))
    return false;
  if (value.error !== undefined) {
    if (!isRecord(value.error)) return false;
    if (
      !isBoundedString(value.error.code, MAX_ID_LENGTH) ||
      !isBoundedString(value.error.message, 8_192) ||
      typeof value.error.retryable !== "boolean"
    ) {
      return false;
    }
  }
  return value.ok ? value.error === undefined : value.error !== undefined;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function isAgentRunRequest(value: unknown): value is AgentRunRequest {
  if (!isRecord(value) || !isAgentRunInput(value) || !isRecord(value.provider))
    return false;

  return (
    isBoundedString(value.runId, MAX_ID_LENGTH) &&
    value.provider.kind === "openrouter" &&
    isBoundedString(value.provider.apiKey, 16_384) &&
    isBoundedString(value.provider.model, MAX_ID_LENGTH)
  );
}

function isAgentError(value: unknown): value is AgentError {
  return (
    isRecord(value) &&
    isBoundedString(value.code, MAX_ID_LENGTH) &&
    isBoundedString(value.message, 100_000) &&
    typeof value.retryable === "boolean"
  );
}

const AGENT_EVENT_TYPES = new Set<unknown>([
  "run.started",
  "run.status",
  "reasoning.delta",
  "assistant.delta",
  "assistant.completed",
  "tool.started",
  "tool.updated",
  "tool.completed",
  "tool.failed",
  "tool.approval_required",
  "usage.updated",
  "run.completed",
  "run.failed",
] satisfies AgentEventType[]);

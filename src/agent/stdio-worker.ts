import { randomUUID } from "node:crypto";
import * as readline from "node:readline";

import { ApprovalStore } from "./host/approval-store.js";
import { BrowserRelay } from "./host/browser-relay.js";
import { createAgentRuntime } from "./runtime.js";
import {
  AGENT_PROTOCOL_VERSION,
  isMainToAgentMessage,
  type AgentError,
  type AgentEvent,
  type AgentEventPayloadMap,
  type AgentEventType,
  type MainToAgentMessage,
  type AgentRunRequest,
  type AgentRuntime,
  type AgentRuntimeEvent,
  type JsonValue,
  type AgentToMainMessage,
} from "../shared/agent-protocol.js";
import type { BrowserCommand } from "../shared/browser-protocol.js";

interface ActiveRun {
  controller: AbortController;
  sequence: number;
}

const activeRuns = new Map<string, ActiveRun>();
const runTasks = new Set<Promise<void>>();
let runtime: AgentRuntime | undefined;
let runtimeError: unknown;
let shuttingDown = false;

function post(message: AgentToMainMessage): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const browserRelay = new BrowserRelay(post);
const approvals = new ApprovalStore((runId, type, payload) =>
  emit(runId, type, payload),
);
const runtimeReady = initializeRuntime();

const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});
input.on("line", (line) => {
  const message = parseMessage(line);
  if (!message) return;

  switch (message.type) {
    case "agent.run":
      trackRun(executeRun(message.request));
      break;
    case "agent.cancel":
      activeRuns.get(message.runId)?.controller.abort();
      break;
    case "agent.approval.resolve":
      approvals.resolve(message.resolution);
      break;
    case "browser.command":
      trackRun(executeBrowserCommand(message.requestId, message.command));
      break;
    case "schedule.command":
      trackRun(executeScheduleCommand(message.requestId, message.command));
      break;
    case "conversation.command":
      trackRun(executeConversationCommand(message.requestId, message.command));
      break;
    case "improvement.command":
      trackRun(executeImprovementCommand(message.requestId, message.command));
      break;
    case "agent.shutdown":
      void shutdown();
      break;
  }
});

async function initializeRuntime(): Promise<void> {
  try {
    runtime = await createAgentRuntime();
    await runtime.initialize?.();
    browserRelay.attach(runtime);
    post({ version: AGENT_PROTOCOL_VERSION, type: "agent.ready" });
  } catch (error) {
    runtimeError = error;
    post({
      version: AGENT_PROTOCOL_VERSION,
      type: "agent.worker.error",
      error: toAgentError(error, "AGENT_INITIALIZATION_FAILED", false),
    });
  }
}

async function executeBrowserCommand(
  requestId: string,
  command: BrowserCommand,
): Promise<void> {
  await runtimeReady;
  await browserRelay.execute(requestId, command, shuttingDown);
}

async function executeScheduleCommand(
  requestId: string,
  command: JsonValue,
): Promise<void> {
  await runtimeReady;
  if (shuttingDown || !runtime?.schedules) {
    post({
      version: AGENT_PROTOCOL_VERSION,
      type: "schedule.response",
      requestId,
      ok: false,
      error: {
        code: shuttingDown ? "SCHEDULE_SHUTTING_DOWN" : "SCHEDULE_UNAVAILABLE",
        message: shuttingDown
          ? "Schedule service is shutting down"
          : "Schedule service is unavailable",
        retryable: true,
      },
    });
    return;
  }
  try {
    const value = await runtime.schedules.execute(command);
    post({
      version: AGENT_PROTOCOL_VERSION,
      type: "schedule.response",
      requestId,
      ok: true,
      value,
    });
  } catch (error) {
    post({
      version: AGENT_PROTOCOL_VERSION,
      type: "schedule.response",
      requestId,
      ok: false,
      error: toAgentError(error, "SCHEDULE_OPERATION_FAILED", false),
    });
  }
}

async function executeConversationCommand(
  requestId: string,
  command: JsonValue,
): Promise<void> {
  await runtimeReady;
  if (shuttingDown || !runtime?.conversations) {
    post({
      version: AGENT_PROTOCOL_VERSION,
      type: "conversation.response",
      requestId,
      ok: false,
      error: {
        code: shuttingDown
          ? "CONVERSATION_SHUTTING_DOWN"
          : "CONVERSATION_UNAVAILABLE",
        message: shuttingDown
          ? "Conversation service is shutting down"
          : "Conversation service is unavailable",
        retryable: true,
      },
    });
    return;
  }
  try {
    const value = await runtime.conversations.execute(command);
    post({
      version: AGENT_PROTOCOL_VERSION,
      type: "conversation.response",
      requestId,
      ok: true,
      value,
    });
  } catch (error) {
    post({
      version: AGENT_PROTOCOL_VERSION,
      type: "conversation.response",
      requestId,
      ok: false,
      error: toAgentError(error, "CONVERSATION_OPERATION_FAILED", false),
    });
  }
}

async function executeImprovementCommand(
  requestId: string,
  command: JsonValue,
): Promise<void> {
  await runtimeReady;
  if (shuttingDown || !runtime?.improvement) {
    post({
      version: AGENT_PROTOCOL_VERSION,
      type: "improvement.response",
      requestId,
      ok: false,
      error: {
        code: shuttingDown ? "IMPROVEMENT_SHUTTING_DOWN" : "IMPROVEMENT_UNAVAILABLE",
        message: shuttingDown
          ? "Improvement service is shutting down"
          : "Improvement service is unavailable",
        retryable: true,
      },
    });
    return;
  }
  try {
    const value = await runtime.improvement.execute(command);
    post({
      version: AGENT_PROTOCOL_VERSION,
      type: "improvement.response",
      requestId,
      ok: true,
      value,
    });
  } catch (error) {
    post({
      version: AGENT_PROTOCOL_VERSION,
      type: "improvement.response",
      requestId,
      ok: false,
      error: toAgentError(error, "IMPROVEMENT_OPERATION_FAILED", false),
    });
  }
}

async function executeRun(request: AgentRunRequest): Promise<void> {
  await runtimeReady;
  if (shuttingDown) {
    return postRunError(
      request.runId,
      "AGENT_SHUTTING_DOWN",
      "Agent is shutting down",
      true,
    );
  }
  if (!runtime) {
    return postRunError(
      request.runId,
      "AGENT_INITIALIZATION_FAILED",
      errorMessage(runtimeError) || "Agent runtime is not ready",
      true,
    );
  }
  if (activeRuns.has(request.runId)) {
    return postRunError(
      request.runId,
      "DUPLICATE_RUN",
      "Agent run already exists",
      false,
    );
  }

  const controller = new AbortController();
  activeRuns.set(request.runId, { controller, sequence: -1 });
  emit(request.runId, "run.started", {
    threadId: request.threadId,
    workspacePath: request.workspacePath,
    model: request.provider.model,
  });

  try {
    const result = await runtime.run(request, {
      signal: controller.signal,
      emit: (event) => emitRuntimeEvent(request.runId, event),
      requestApproval: (approval) =>
        approvals.request(request.runId, approval, controller.signal),
    });
    emit(request.runId, "run.completed", {
      status:
        controller.signal.aborted || result.status === "cancelled"
          ? "cancelled"
          : "completed",
      finalText: result.finalText,
      usage: result.usage,
    });
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) {
      emit(request.runId, "run.completed", { status: "cancelled" });
    } else {
      emit(request.runId, "run.failed", {
        error: toAgentError(error, "AGENT_RUN_FAILED", true),
      });
    }
  } finally {
    approvals.rejectRun(request.runId, new Error("Agent run finished"));
    activeRuns.delete(request.runId);
    post({
      version: AGENT_PROTOCOL_VERSION,
      type: "agent.run.finished",
      runId: request.runId,
    });
  }
}

function parseMessage(line: string): MainToAgentMessage | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return isMainToAgentMessage(value)
      ? (value as MainToAgentMessage)
      : undefined;
  } catch {
    return undefined;
  }
}

function trackRun(task: Promise<void>): void {
  runTasks.add(task);
  void task.then(
    () => runTasks.delete(task),
    () => runTasks.delete(task),
  );
}

function emitRuntimeEvent(runId: string, event: AgentRuntimeEvent): void {
  emit(runId, event.type, event.payload);
}

function emit<Type extends AgentEventType>(
  runId: string,
  type: Type,
  payload: AgentEventPayloadMap[Type],
): void {
  const active = activeRuns.get(runId);
  if (!active) return;
  active.sequence += 1;
  const event = {
    id: randomUUID(),
    runId,
    sequence: active.sequence,
    timestamp: Date.now(),
    type,
    payload,
  } as AgentEvent;
  post({ version: AGENT_PROTOCOL_VERSION, type: "agent.event", event });
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const run of activeRuns.values()) run.controller.abort();
  await Promise.allSettled([...runTasks]);
  browserRelay.clear();
  await runtime?.dispose?.();
  process.exit(0);
}

function postRunError(
  runId: string,
  code: string,
  message: string,
  retryable: boolean,
): void {
  post({
    version: AGENT_PROTOCOL_VERSION,
    type: "agent.worker.error",
    runId,
    error: { code, message, retryable },
  });
  post({ version: AGENT_PROTOCOL_VERSION, type: "agent.run.finished", runId });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function toAgentError(
  error: unknown,
  code: string,
  retryable: boolean,
): AgentError {
  return {
    code,
    message:
      error instanceof Error
        ? error.message || "Unknown agent error"
        : "Unknown agent error",
    retryable,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "";
}

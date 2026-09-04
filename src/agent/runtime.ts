import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AgentBrowser } from "@mastra/agent-browser";
import { Agent } from "@mastra/core/agent";
import { AgentController, type Session } from "@mastra/core/agent-controller";
import { Mastra } from "@mastra/core";
import { MastraStorageExporter, Observability } from "@mastra/observability";
import type {
  AgentControllerEvent,
  ToolCategory,
} from "@mastra/core/agent-controller";
import { SkillSearchProcessor } from "@mastra/core/processors";
import { LocalFilesystem, Workspace } from "@mastra/core/workspace";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import {
  createOpenRouter,
  type OpenRouterChatSettings,
} from "@openrouter/ai-sdk-provider";
import type {
  AgentError,
  AgentBrowserRuntime,
  AgentRunRequest,
  AgentRunResult,
  AgentRuntime,
  AgentRuntimeContext,
  AgentConversationRuntime,
  AgentImprovementRuntime,
  AgentScheduleRuntime,
  AgentUsage,
  JsonValue,
  RuntimeApprovalRequest,
} from "../shared/agent-protocol.js";
import type {
  BrowserCommand,
  BrowserEvent,
} from "../shared/browser-protocol.js";
import { BrowserSessionService } from "./browser/browser-session-service.js";
import { createToolFactoryContext } from "./core/tool-context.js";
import { createCodingTools } from "./tools/index.js";
import { ImprovementService } from "./improvement/service.js";
import { redactForImprovement } from "./improvement/redaction.js";

type RuntimeBundle = {
  agent: Agent;
  scheduledAgent: Agent;
  controller: AgentController;
  mastra: Mastra;
  browser: AgentBrowser;
  browserService: BrowserSessionService;
  storage: LibSQLStore;
  memory: Memory;
  improvement: ImprovementService;
};

const LOCAL_RESOURCE_ID = "local-user";

type ScheduleHostRequest = AgentRunRequest & {
  schedule:
    | { operation: "list" }
    | {
        operation: "create";
        prompt: string;
        cadence: "once" | "daily" | "weekly";
        runAt: number;
        timezone?: string;
      }
    | { operation: "set-status"; id: string; status: "active" | "paused" }
    | { operation: "delete"; id: string };
};

type ConversationHostRequest = AgentRunRequest & {
  conversation:
    | { operation: "list" }
    | { operation: "messages"; threadId: string }
    | { operation: "create"; threadId: string; title: string };
};

type ImprovementHostRequest = AgentRunRequest & {
  improvement:
    | { operation: "list" }
    | {
        operation: "add-feedback";
        traceId: string;
        rating: 1 | -1;
        comment?: string;
      }
    | { operation: "create-candidate"; traceId: string }
    | { operation: "evaluate-candidate"; candidateId: string }
    | { operation: "request-publication"; candidateId: string }
    | { operation: "resolve-publication"; candidateId: string; approved: boolean }
    | { operation: "rollback"; candidateId: string };
};

type MastraScheduleView = {
  id: string;
  prompt?: string;
  cron: string;
  status: "active" | "paused";
  nextFireAt: number;
  lastFireAt?: number;
  metadata?: Record<string, unknown>;
  createdAt: number;
};

class MastraControllerRuntime implements AgentRuntime {
  private readonly bundles = new Map<string, Promise<RuntimeBundle>>();
  private readonly browserListeners = new Set<(event: BrowserEvent) => void>();
  private readonly browserUnsubscribers = new Set<() => void>();

  readonly browser: AgentBrowserRuntime = {
    execute: (command) => this.executeBrowser(command),
    onEvent: (listener) => {
      this.browserListeners.add(listener);
      return () => this.browserListeners.delete(listener);
    },
  };

  readonly schedules: AgentScheduleRuntime = {
    execute: (command) => this.executeSchedule(command),
  };

  readonly conversations: AgentConversationRuntime = {
    execute: (command) => this.executeConversation(command),
  };

  readonly improvement: AgentImprovementRuntime = {
    execute: (command) => this.executeImprovement(command),
  };

  async run(
    request: AgentRunRequest,
    context: AgentRuntimeContext,
  ): Promise<AgentRunResult> {
    const bundle = await this.getBundle(request);
    const session = await bundle.controller.createSession({
      resourceId: LOCAL_RESOURCE_ID,
      scope: request.workspacePath,
      threadId: request.threadId,
    });

    await configurePermissions(session);
    const state = createRunState();
    const unsubscribe = session.subscribe((event) => {
      void handleControllerEvent(session, event, state, context).catch(
        (error) => {
          context.emit({
            type: "run.status",
            payload: { stage: "event-error", message: errorMessage(error) },
          });
        },
      );
    });
    const abort = () => session.abort();
    context.signal.addEventListener("abort", abort, { once: true });

    try {
      await session.sendMessage({ content: request.prompt });
      await ensureThreadTitle(bundle.memory, request.threadId, request.prompt);
      try {
        await bundle.improvement.captureRun({
          id: request.runId,
          threadId: request.threadId,
          model: request.provider.model,
          status: context.signal.aborted ? "cancelled" : "completed",
          promptExcerpt: redactForImprovement(request.prompt, 4_000),
          ...(state.finalText
            ? { answerExcerpt: redactForImprovement(state.finalText, 4_000) }
            : {}),
          toolNames: [...state.toolNames].sort(),
          toolCount: state.toolCount,
          failedToolCount: state.failedToolCount,
          createdAt: Date.now(),
        });
      } catch (error) {
        context.emit({
          type: "run.status",
          payload: {
            stage: "improvement-capture-error",
            message: errorMessage(error),
          },
        });
      }
      return {
        status: context.signal.aborted ? "cancelled" : "completed",
        finalText: state.finalText,
        usage: state.usage,
      };
    } finally {
      context.signal.removeEventListener("abort", abort);
      unsubscribe();
    }
  }

  async dispose(): Promise<void> {
    const bundles = await Promise.allSettled(this.bundles.values());
    await Promise.allSettled(
      bundles.flatMap((result) =>
        result.status === "fulfilled"
          ? [
              result.value.browserService.dispose(),
              result.value.controller.destroy(),
              result.value.browser.close(),
              result.value.mastra.shutdown(),
            ]
          : [],
      ),
    );
    for (const unsubscribe of this.browserUnsubscribers) unsubscribe();
    this.browserUnsubscribers.clear();
    this.bundles.clear();
  }

  private async executeBrowser(
    command: BrowserCommand,
  ): Promise<Awaited<ReturnType<BrowserSessionService["execute"]>>> {
    const request: AgentRunRequest = {
      runId: `browser-${command.request.threadId}`,
      threadId: command.request.threadId,
      prompt: "",
      workspacePath: command.request.workspacePath,
      model: command.request.model,
      reasoningEffort: command.request.reasoningEffort,
      provider: command.request.provider,
    };
    const bundle = await this.getBundle(request);
    // The listener is installed once per bundle in getBundle; forwarding from
    // the service keeps preview frames out of the agent event timeline.
    return bundle.browserService.execute(command);
  }

  private getBundle(request: AgentRunRequest): Promise<RuntimeBundle> {
    const key = this.bundleKey(request);
    const current = this.bundles.get(key);
    if (current) return current;
    const created = createRuntimeBundle(request).then((bundle) => {
      const unsubscribe = bundle.browserService.onEvent((event) => {
        for (const listener of this.browserListeners) {
          try {
            listener(event);
          } catch (error) {
            console.error("Browser runtime listener failed", error);
          }
        }
      });
      this.browserUnsubscribers.add(unsubscribe);
      return bundle;
    });
    this.bundles.set(key, created);
    return created;
  }

  private bundleKey(request: AgentRunRequest): string {
    const fingerprint = createHash("sha256")
      .update(request.provider.apiKey)
      .digest("hex")
      .slice(0, 12);
    return `${request.workspacePath}\0${request.provider.model}\0${request.reasoningEffort ?? ""}\0${fingerprint}`;
  }

  private async executeSchedule(command: JsonValue): Promise<JsonValue> {
    const request = parseScheduleRequest(command);
    const bundle = await this.getBundle(request);
    const { mastra, scheduledAgent } = bundle;
    const input = request.schedule;

    switch (input.operation) {
      case "list": {
        const schedules = await mastra.schedules.list({
          agentId: scheduledAgent.id,
        });
        return { tasks: schedules.map((schedule) => toScheduleTask(schedule)) };
      }
      case "create": {
        const created = await mastra.schedules.create({
          agentId: scheduledAgent.id,
          cron: cronFor(input.cadence, input.runAt),
          timezone: input.timezone,
          prompt: input.prompt,
          threadId: request.threadId,
          resourceId: LOCAL_RESOURCE_ID,
          ifActive: { behavior: "discard" },
          ifIdle: { behavior: "wake" },
          ...(request.reasoningEffort
            ? {
                providerOptions: {
                  openrouter: {
                    reasoning: { effort: request.reasoningEffort },
                  },
                },
              }
            : {}),
          metadata: {
            cadence: input.cadence,
            workspacePath: request.workspacePath,
            model: request.provider.model,
            ...(request.reasoningEffort
              ? { reasoningEffort: request.reasoningEffort }
              : {}),
            threadId: request.threadId,
          },
        });
        return { task: toScheduleTask(created) };
      }
      case "set-status": {
        const updated =
          input.status === "paused"
            ? await mastra.schedules.pause(input.id)
            : await mastra.schedules.resume(input.id);
        return { task: toScheduleTask(updated) };
      }
      case "delete":
        await mastra.schedules.delete(input.id);
        return { deleted: input.id };
    }
  }

  private async executeConversation(command: JsonValue): Promise<JsonValue> {
    const request = parseConversationRequest(command);
    const bundle = await this.getBundle(request);
    const { conversation } = request;

    switch (conversation.operation) {
      case "list": {
        const result = await bundle.memory.listThreads({
          filter: { resourceId: LOCAL_RESOURCE_ID },
          orderBy: { field: "updatedAt", direction: "DESC" },
          perPage: 50,
        });
        return { threads: result.threads.map(toConversationThread) };
      }
      case "messages": {
        const result = await bundle.memory.recall({
          threadId: conversation.threadId,
          resourceId: LOCAL_RESOURCE_ID,
          orderBy: { field: "createdAt", direction: "DESC" },
          perPage: 200,
        });
        return {
          messages: result.messages
            .map(toConversationMessage)
            .filter((message): message is NonNullable<typeof message> =>
              Boolean(message),
            )
            .reverse(),
        };
      }
      case "create": {
        await ensureThreadTitle(
          bundle.memory,
          conversation.threadId,
          conversation.title,
          true,
        );
        const thread = await bundle.memory.getThreadById({
          threadId: conversation.threadId,
          resourceId: LOCAL_RESOURCE_ID,
        });
        if (!thread) throw new Error("Conversation was not persisted");
        return { thread: toConversationThread(thread) };
      }
    }
  }

  private async executeImprovement(command: JsonValue): Promise<JsonValue> {
    const request = parseImprovementRequest(command);
    const bundle = await this.getBundle(request);
    const input = request.improvement;
    switch (input.operation) {
      case "list":
        return toJsonValue(await bundle.improvement.snapshot());
      case "add-feedback":
        await bundle.improvement.addFeedback(input);
        return toJsonValue(await bundle.improvement.snapshot());
      case "create-candidate":
        await bundle.improvement.createCandidate(input.traceId);
        return toJsonValue(await bundle.improvement.snapshot());
      case "evaluate-candidate":
        await bundle.improvement.evaluateCandidate(input.candidateId);
        return toJsonValue(await bundle.improvement.snapshot());
      case "request-publication":
        await bundle.improvement.requestPublication(input.candidateId);
        return toJsonValue(await bundle.improvement.snapshot());
      case "resolve-publication":
        await bundle.improvement.resolvePublication(input.candidateId, input.approved);
        return toJsonValue(await bundle.improvement.snapshot());
      case "rollback":
        await bundle.improvement.rollback(input.candidateId);
        return toJsonValue(await bundle.improvement.snapshot());
    }
  }
}

function parseScheduleRequest(value: JsonValue): ScheduleHostRequest {
  if (!isJsonObject(value)) throw new Error("Schedule request is invalid");
  const workspacePath = boundedString(
    value.workspacePath,
    16_384,
    "workspacePath",
  );
  const threadId = boundedString(value.threadId, 256, "threadId");
  const model = boundedString(value.model, 256, "model");
  const reasoningEffort = optionalReasoningEffort(value.reasoningEffort);
  const provider = value.provider;
  if (!isJsonObject(provider)) throw new Error("Schedule provider is invalid");
  const apiKey = boundedString(provider.apiKey, 16_384, "provider.apiKey");
  const providerModel = boundedString(provider.model, 256, "provider.model");
  const schedule = value.schedule;
  if (!isJsonObject(schedule) || typeof schedule.operation !== "string") {
    throw new Error("Schedule operation is invalid");
  }
  const request: Omit<AgentRunRequest, "runId" | "prompt"> = {
    threadId,
    workspacePath,
    model,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    provider: { kind: "openrouter", apiKey, model: providerModel },
  };
  const base = {
    ...request,
    runId: `schedule-${Date.now()}`,
    prompt: "",
    schedule: undefined,
  };

  if (schedule.operation === "list")
    return { ...base, schedule: { operation: "list" } };
  if (schedule.operation === "create") {
    const cadence = schedule.cadence;
    const runAt = schedule.runAt;
    if (
      (cadence !== "once" && cadence !== "daily" && cadence !== "weekly") ||
      typeof runAt !== "number" ||
      !Number.isSafeInteger(runAt) ||
      runAt <= 0
    ) {
      throw new Error("Schedule cadence or time is invalid");
    }
    return {
      ...base,
      schedule: {
        operation: "create",
        prompt: boundedString(schedule.prompt, 12_000, "prompt"),
        cadence,
        runAt,
        ...(typeof schedule.timezone === "string"
          ? { timezone: schedule.timezone }
          : {}),
      },
    };
  }
  const id = boundedString(schedule.id, 256, "id");
  if (schedule.operation === "delete")
    return { ...base, schedule: { operation: "delete", id } };
  if (
    schedule.operation === "set-status" &&
    (schedule.status === "active" || schedule.status === "paused")
  ) {
    return {
      ...base,
      schedule: { operation: "set-status", id, status: schedule.status },
    };
  }
  throw new Error("Schedule operation is invalid");
}

function parseConversationRequest(value: JsonValue): ConversationHostRequest {
  if (!isJsonObject(value)) throw new Error("Conversation request is invalid");
  const workspacePath = boundedString(
    value.workspacePath,
    16_384,
    "workspacePath",
  );
  const threadId = boundedString(value.threadId, 256, "threadId");
  const model = boundedString(value.model, 256, "model");
  const reasoningEffort = optionalReasoningEffort(value.reasoningEffort);
  const provider = value.provider;
  if (!isJsonObject(provider))
    throw new Error("Conversation provider is invalid");
  const apiKey = boundedString(provider.apiKey, 16_384, "provider.apiKey");
  const providerModel = boundedString(provider.model, 256, "provider.model");
  const conversation = value.conversation;
  if (
    !isJsonObject(conversation) ||
    typeof conversation.operation !== "string"
  ) {
    throw new Error("Conversation operation is invalid");
  }
  const base: Omit<ConversationHostRequest, "conversation"> = {
    runId: `conversation-${Date.now()}`,
    prompt: "",
    threadId,
    workspacePath,
    model,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    provider: { kind: "openrouter", apiKey, model: providerModel },
  };
  if (conversation.operation === "list") {
    return { ...base, conversation: { operation: "list" } };
  }
  if (conversation.operation === "messages") {
    return {
      ...base,
      conversation: {
        operation: "messages",
        threadId: boundedString(conversation.threadId, 256, "threadId"),
      },
    };
  }
  if (conversation.operation === "create") {
    return {
      ...base,
      conversation: {
        operation: "create",
        threadId: boundedString(conversation.threadId, 256, "threadId"),
        title: boundedString(conversation.title, 256, "title"),
      },
    };
  }
  throw new Error("Conversation operation is invalid");
}

function parseImprovementRequest(value: JsonValue): ImprovementHostRequest {
  if (!isJsonObject(value)) throw new Error("Improvement request is invalid");
  const workspacePath = boundedString(
    value.workspacePath,
    16_384,
    "workspacePath",
  );
  const threadId = boundedString(value.threadId, 256, "threadId");
  const model = boundedString(value.model, 256, "model");
  const reasoningEffort = optionalReasoningEffort(value.reasoningEffort);
  const provider = value.provider;
  if (!isJsonObject(provider))
    throw new Error("Improvement provider is invalid");
  const apiKey = boundedString(provider.apiKey, 16_384, "provider.apiKey");
  const providerModel = boundedString(provider.model, 256, "provider.model");
  const improvement = value.improvement;
  if (!isJsonObject(improvement) || typeof improvement.operation !== "string") {
    throw new Error("Improvement operation is invalid");
  }
  const base: Omit<ImprovementHostRequest, "improvement"> = {
    runId: `improvement-${Date.now()}`,
    prompt: "",
    threadId,
    workspacePath,
    model,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    provider: { kind: "openrouter", apiKey, model: providerModel },
  };
  if (improvement.operation === "list") {
    return { ...base, improvement: { operation: "list" } };
  }
  if (improvement.operation === "add-feedback") {
    const rating = improvement.rating;
    if (rating !== 1 && rating !== -1) {
      throw new Error("Improvement rating is invalid");
    }
    const comment = improvement.comment;
    if (comment !== undefined && (typeof comment !== "string" || comment.length > 4_000)) {
      throw new Error("Improvement comment is invalid");
    }
    return {
      ...base,
      improvement: {
        operation: "add-feedback",
        traceId: boundedString(improvement.traceId, 256, "traceId"),
        rating,
        ...(typeof comment === "string" && comment.trim()
          ? { comment: comment.trim() }
          : {}),
      },
    };
  }
  if (improvement.operation === "create-candidate") {
    return {
      ...base,
      improvement: {
        operation: "create-candidate",
        traceId: boundedString(improvement.traceId, 256, "traceId"),
      },
    };
  }
  const candidateId = boundedString(improvement.candidateId, 256, "candidateId");
  if (improvement.operation === "evaluate-candidate") {
    return { ...base, improvement: { operation: "evaluate-candidate", candidateId } };
  }
  if (improvement.operation === "request-publication") {
    return { ...base, improvement: { operation: "request-publication", candidateId } };
  }
  if (improvement.operation === "resolve-publication") {
    if (typeof improvement.approved !== "boolean") {
      throw new Error("Improvement publication decision is invalid");
    }
    return {
      ...base,
      improvement: {
        operation: "resolve-publication",
        candidateId,
        approved: improvement.approved,
      },
    };
  }
  if (improvement.operation === "rollback") {
    return { ...base, improvement: { operation: "rollback", candidateId } };
  }
  throw new Error("Improvement operation is invalid");
}

function toConversationThread(thread: {
  id: string;
  title?: string;
  updatedAt: Date;
}): JsonValue {
  return {
    id: thread.id,
    title: thread.title?.trim() || "新对话",
    updatedAt: timestampOf(thread.updatedAt),
  };
}

function toConversationMessage(message: {
  id: string;
  role: string;
  content: { parts?: unknown[]; content?: unknown };
  createdAt: Date;
}): JsonValue | undefined {
  if (message.role !== "user" && message.role !== "assistant") return undefined;
  const text = textFromMessage(message.content);
  if (!text) return undefined;
  return {
    id: message.id,
    role: message.role,
    text,
    createdAt: timestampOf(message.createdAt),
  };
}

function textFromMessage(content: {
  parts?: unknown[];
  content?: unknown;
}): string {
  const textParts = (content.parts ?? []).flatMap((part) => {
    if (!isTextPart(part)) {
      return [];
    }
    return [part.text];
  });
  if (textParts.length) return textParts.join("\n").trim();
  return typeof content.content === "string" ? content.content.trim() : "";
}

function isTextPart(value: unknown): value is { type: "text"; text: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "text" in value &&
    value.type === "text" &&
    typeof value.text === "string"
  );
}

function timestampOf(value: Date): number {
  const timestamp = value.getTime();
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

async function ensureThreadTitle(
  memory: Memory,
  threadId: string,
  candidateTitle: string,
  replacePlaceholder = false,
): Promise<void> {
  const title =
    candidateTitle.replace(/\s+/g, " ").trim().slice(0, 80) || "新对话";
  const current = await memory.getThreadById({
    threadId,
    resourceId: LOCAL_RESOURCE_ID,
  });
  if (!current) {
    await memory.saveThread({
      thread: {
        id: threadId,
        title,
        resourceId: LOCAL_RESOURCE_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return;
  }
  if (!current.title || (replacePlaceholder && current.title === "新对话")) {
    await memory.updateThread({ id: threadId, title });
  }
}

function toScheduleTask(schedule: MastraScheduleView): JsonValue {
  const metadata = schedule.metadata ?? {};
  const cadence = metadata.cadence;
  const task: { [key: string]: JsonValue } = {
    id: schedule.id,
    prompt: schedule.prompt ?? "",
    workspacePath:
      typeof metadata.workspacePath === "string" ? metadata.workspacePath : "",
    cadence: cadence === "daily" || cadence === "weekly" ? cadence : "once",
    status: metadata.completedAt ? "completed" : schedule.status,
    createdAt: schedule.createdAt,
    nextRunAt: schedule.nextFireAt,
  };
  if (typeof metadata.model === "string") task.model = metadata.model;
  if (typeof metadata.reasoningEffort === "string") {
    task.reasoningEffort = metadata.reasoningEffort;
  }
  if (typeof metadata.threadId === "string") task.threadId = metadata.threadId;
  if (schedule.lastFireAt !== undefined) task.lastRunAt = schedule.lastFireAt;
  if (typeof metadata.lastError === "string")
    task.lastError = metadata.lastError;
  return task;
}

function cronFor(
  cadence: "once" | "daily" | "weekly",
  timestamp: number,
): string {
  const date = new Date(timestamp);
  const minute = date.getMinutes();
  const hour = date.getHours();
  if (cadence === "daily") return `${minute} ${hour} * * *`;
  if (cadence === "weekly") return `${minute} ${hour} * * ${date.getDay()}`;
  return `${minute} ${hour} ${date.getDate()} ${date.getMonth() + 1} *`;
}

function isJsonObject(
  value: JsonValue | undefined,
): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(
  value: JsonValue | undefined,
  maxLength: number,
  label: string,
): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`Schedule ${label} is invalid`);
  }
  return value;
}

function optionalReasoningEffort(
  value: JsonValue | undefined,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  const effort = boundedString(value, 32, "reasoningEffort");
  if (!/^[a-zA-Z0-9_-]+$/.test(effort)) {
    throw new Error("Reasoning effort is invalid");
  }
  return effort;
}

function openRouterModelSettings(
  reasoningEffort?: string,
): OpenRouterChatSettings {
  const settings: OpenRouterChatSettings = { usage: { include: true } };
  if (reasoningEffort) {
    // Effort values are sourced from OpenRouter's model catalog at runtime.
    settings.reasoning = {
      effort: reasoningEffort,
    } as OpenRouterChatSettings["reasoning"];
  }
  return settings;
}

export function createAgentRuntime(): AgentRuntime {
  return new MastraControllerRuntime();
}

async function createRuntimeBundle(
  request: AgentRunRequest,
): Promise<RuntimeBundle> {
  const workspacePath = path.resolve(request.workspacePath);
  const dataDirectory = path.resolve(
    process.env.OPEN_ARTIFEX_DATA_DIR ??
      path.join(workspacePath, ".open-artifex"),
  );
  mkdirSync(dataDirectory, { recursive: true });

  // AgentController subagents resolve model IDs through Mastra's provider registry.
  // The agent host never forwards this environment to shell tools.
  process.env.OPENROUTER_API_KEY = request.provider.apiKey;
  const modelId = `openrouter/${request.provider.model}`;
  const openrouter = createOpenRouter({
    apiKey: request.provider.apiKey,
    headers: {
      "HTTP-Referer": "https://github.com/ErKeLost/open-artifex",
      "X-Title": "Open Artifex",
    },
  });

  const storage = new LibSQLStore({
    id: `open-artifex-${stableId(workspacePath)}`,
    url: pathToFileURL(path.join(dataDirectory, "open-artifex.db")).href,
  });
  await storage.init();
  const filesystem = new LocalFilesystem({
    basePath: workspacePath,
    contained: true,
  });
  const workspace = new Workspace({
    id: `workspace-${stableId(workspacePath)}`,
    name: path.basename(workspacePath),
    filesystem,
    skills: [".agents/skills", ".mastra/skills", "skills"],
    bm25: true,
    tools: { enabled: false },
  });
  const browser = new AgentBrowser({
    headless: true,
    scope: "thread",
    viewport: { width: 1280, height: 800 },
    excludeTools: ["browser_evaluate"],
  });
  const browserService = new BrowserSessionService(browser);
  const toolContext = await createToolFactoryContext(workspacePath, false);
  const tools = createCodingTools(toolContext);
  const scheduledTools = {
    read: tools.read,
    glob: tools.glob,
    grep: tools.grep,
  };
  const skillSearch = new SkillSearchProcessor({
    workspace,
    search: { topK: 5, minScore: 0.1 },
    blockingRefresh: true,
  });
  const memory = new Memory({ storage, options: { lastMessages: 50 } });
  const observability = new Observability({
    configs: {
      default: {
        serviceName: "open-artifex",
        exporters: [new MastraStorageExporter()],
      },
    },
  });

  const agent = new Agent({
    id: "open-artifex-agent",
    name: "Open Artifex",
    description: "A local-first work and coding supervisor.",
    instructions: baseInstructions,
    model: openrouter(
      request.provider.model,
      openRouterModelSettings(request.reasoningEffort),
    ),
    memory,
    workspace,
    browser,
    inputProcessors: [skillSearch],
    tools,
  });
  const scheduledAgent = new Agent({
    id: "open-artifex-scheduled-agent",
    name: "Open Artifex Scheduler",
    description: "A read-only local scheduled work agent.",
    instructions: `${baseInstructions}\n\nScheduled runs are non-interactive. Inspect and report only: do not modify files or run shell commands.`,
    model: openrouter(
      request.provider.model,
      openRouterModelSettings(request.reasoningEffort),
    ),
    memory,
    workspace,
    inputProcessors: [skillSearch],
    tools: scheduledTools,
  });
  const improvementAnalyst = new Agent({
    id: "improvement-analyst",
    name: "Improvement Analyst",
    instructions:
      "Turn privacy-filtered run evidence and human feedback into a narrowly scoped, reversible operating-policy proposal. Never propose source edits, shell commands, external calls, credentials, or hidden reasoning.",
    model: openrouter(
      request.provider.model,
      openRouterModelSettings(request.reasoningEffort),
    ),
  });
  const improvementEvaluator = new Agent({
    id: "improvement-evaluator",
    name: "Improvement Evaluator",
    instructions:
      "Evaluate candidate operating policies conservatively. Approve only policies supported by the supplied evidence, free of secrets, side effects, source edits, and irreversible behavior.",
    model: openrouter(
      request.provider.model,
      openRouterModelSettings(request.reasoningEffort),
    ),
  });
  let mastra!: Mastra;
  const improvement = new ImprovementService({
    getMastra: () => mastra,
    storage,
    analyst: improvementAnalyst,
    evaluator: improvementEvaluator,
  });

  const controller = new AgentController({
    id: `open-artifex-controller-${stableId(workspacePath)}`,
    agent,
    storage,
    workspace,
    browser,
    tools,
    defaultModeId: "build",
    modes: [
      {
        id: "build",
        name: "Build",
        defaultModelId: modelId,
        instructions:
          "Implement requested work, verify it, and report concrete outcomes.",
      },
      {
        id: "plan",
        name: "Plan",
        defaultModelId: modelId,
        instructions:
          "Investigate and produce an actionable plan before making changes.",
        transitionsTo: "build",
        availableTools: [
          "read",
          "glob",
          "grep",
          "runtime_info",
          "ask_user",
          "submit_plan",
          "task_write",
          "task_update",
          "task_complete",
          "task_check",
          "subagent",
          "search_skills",
          "load_skill",
          "skill_read",
          "browser_snapshot",
          "browser_screenshot",
        ],
      },
      {
        id: "review",
        name: "Review",
        defaultModelId: modelId,
        instructions:
          "Review changes for correctness, security, regressions, and missing tests.",
        availableTools: [
          "read",
          "glob",
          "grep",
          "bash",
          "ask_user",
          "task_write",
          "task_update",
          "task_complete",
          "task_check",
          "subagent",
          "search_skills",
          "load_skill",
          "skill_read",
          "browser_snapshot",
          "browser_screenshot",
        ],
      },
    ],
    subagents: [
      {
        id: "explorer",
        name: "Explorer",
        description:
          "Maps unfamiliar code and finds the exact implementation points for a task.",
        instructions:
          "Explore precisely. Return findings with file paths and evidence. Do not edit files.",
        allowedControllerTools: ["read", "glob", "grep"],
        allowedWorkspaceTools: [],
        defaultModelId: modelId,
        maxSteps: 20,
      },
      {
        id: "reviewer",
        name: "Reviewer",
        description:
          "Reviews a proposed or completed change for correctness and regressions.",
        instructions:
          "Inspect changes critically and return only actionable, evidence-backed findings.",
        allowedControllerTools: ["read", "glob", "grep"],
        allowedWorkspaceTools: [],
        defaultModelId: modelId,
        maxSteps: 20,
      },
      {
        id: "tester",
        name: "Tester",
        description:
          "Runs focused verification and diagnoses failures without modifying source files.",
        instructions:
          "Run the smallest relevant checks, diagnose failures, and report reproducible evidence.",
        allowedControllerTools: ["read", "glob", "grep", "bash"],
        allowedWorkspaceTools: [],
        defaultModelId: modelId,
        maxSteps: 20,
      },
    ],
    toolCategoryResolver,
    observability,
  });
  const completeOneTimeSchedule = async (
    scheduleId: string,
    lastError?: string,
  ) => {
    const schedule = await mastra.schedules.get(scheduleId);
    if (!schedule || schedule.metadata?.cadence !== "once") return;
    await mastra.schedules.update(scheduleId, {
      status: "paused",
      metadata: {
        ...schedule.metadata,
        completedAt: Date.now(),
        ...(lastError ? { lastError } : {}),
      },
    });
  };
  mastra = new Mastra({
    agents: {
      openArtifex: agent,
      scheduled: scheduledAgent,
      improvementAnalyst,
      improvementEvaluator,
    },
    agentControllers: { openArtifex: controller },
    workflows: improvement.workflows,
    storage,
    observability,
    backgroundTasks: {
      enabled: true,
      globalConcurrency: 4,
      perAgentConcurrency: 2,
      backpressure: "queue",
      defaultTimeoutMs: 300_000,
    },
    scheduler: { enabled: true },
    schedules: {
      onFinish: async ({ schedule }) => completeOneTimeSchedule(schedule.id),
      onError: async ({ schedule, error }) =>
        completeOneTimeSchedule(schedule.id, error.message),
    },
  });
  await controller.init();
  await mastra.startWorkers();
  return {
    agent,
    scheduledAgent,
    controller,
    mastra,
    browser,
    browserService,
    storage,
    memory,
    improvement,
  };
}

const baseInstructions = `
You are Open Artifex, a local-first work and coding supervisor.

Operate only inside the selected workspace. Inspect before editing and keep
changes focused. Use skills on demand: search first, then load the matching
skill before following it. Delegate bounded exploration, review, and testing to
specialized subagents when it improves correctness or latency. Never expose
credentials. Verify changes before declaring completion.
`.trim();

function toolCategoryResolver(toolName: string): ToolCategory | null {
  if (
    [
      "read",
      "glob",
      "grep",
      "runtime_info",
      "search_skills",
      "load_skill",
      "skill_read",
    ].includes(toolName)
  ) {
    return "read";
  }
  if (["edit", "write", "apply_patch"].includes(toolName)) return "edit";
  if (toolName === "bash" || toolName.startsWith("browser_")) return "execute";
  return "other";
}

async function configurePermissions(session: Session): Promise<void> {
  await session.permissions.setForCategory({
    category: "read",
    policy: "allow",
  });
  await session.permissions.setForCategory({ category: "edit", policy: "ask" });
  await session.permissions.setForCategory({
    category: "execute",
    policy: "ask",
  });
  await session.permissions.setForCategory({
    category: "other",
    policy: "allow",
  });
}

type RunState = {
  finalText: string;
  usage?: AgentUsage;
  messages: Map<string, { text: string; reasoning: string }>;
  toolNames: Set<string>;
  toolCount: number;
  failedToolCount: number;
};

function createRunState(): RunState {
  return {
    finalText: "",
    messages: new Map(),
    toolNames: new Set(),
    toolCount: 0,
    failedToolCount: 0,
  };
}

async function handleControllerEvent(
  session: Session,
  event: AgentControllerEvent,
  state: RunState,
  context: AgentRuntimeContext,
): Promise<void> {
  switch (event.type) {
    case "agent_start":
      context.emit({ type: "run.status", payload: { stage: "thinking" } });
      return;
    case "message_start":
    case "message_update":
    case "message_end": {
      const id = event.message.id;
      const previous = state.messages.get(id) ?? { text: "", reasoning: "" };
      const current = extractMessageContent(event.message);
      if (current.reasoning.startsWith(previous.reasoning)) {
        const delta = current.reasoning.slice(previous.reasoning.length);
        if (delta)
          context.emit({ type: "reasoning.delta", payload: { delta } });
      }
      if (current.text.startsWith(previous.text)) {
        const delta = current.text.slice(previous.text.length);
        if (delta)
          context.emit({ type: "assistant.delta", payload: { delta } });
      }
      state.messages.set(id, current);
      if (event.type === "message_end") {
        state.finalText = current.text;
        context.emit({
          type: "assistant.completed",
          payload: { text: current.text },
        });
      }
      return;
    }
    case "tool_start":
      state.toolNames.add(event.toolName);
      state.toolCount += 1;
      context.emit({
        type: "tool.started",
        payload: {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: toJsonValue(event.args),
          startedAt: Date.now(),
        },
      });
      return;
    case "tool_update":
      context.emit({
        type: "tool.updated",
        payload: {
          toolCallId: event.toolCallId,
          toolName: "tool",
          output: toJsonValue(event.partialResult),
        },
      });
      return;
    case "tool_end":
      if (event.isError) state.failedToolCount += 1;
      context.emit({
        type: event.isError ? "tool.failed" : "tool.completed",
        payload: {
          toolCallId: event.toolCallId,
          toolName: toolNameFromResult(event.result),
          output: toJsonValue(event.result),
          completedAt: Date.now(),
          error: event.isError ? toProtocolError(event.result) : undefined,
        },
      });
      return;
    case "tool_approval_required": {
      const approval = await context.requestApproval(approvalRequest(event));
      session.respondToToolApproval({
        toolCallId: event.toolCallId,
        decision:
          approval.decision === "approve-session"
            ? "always_allow_category"
            : approval.decision === "approve-once"
              ? "approve"
              : "decline",
        declineContext:
          approval.decision === "reject"
            ? { reason: approval.message, message: approval.message }
            : undefined,
      });
      return;
    }
    case "shell_output":
      context.emit({
        type: "tool.updated",
        payload: {
          toolCallId: event.toolCallId,
          toolName: "bash",
          progress: { message: event.output },
        },
      });
      return;
    case "usage_update":
      state.usage = normalizeUsage(event.usage);
      context.emit({ type: "usage.updated", payload: state.usage });
      return;
    case "subagent_start":
      context.emit({
        type: "tool.started",
        payload: {
          toolCallId: event.toolCallId,
          toolName: "subagent",
          title: event.agentType,
          input: toJsonValue({
            task: event.task,
            modelId: event.modelId,
            forked: event.forked,
          }),
          startedAt: Date.now(),
        },
      });
      return;
    case "subagent_text_delta":
      context.emit({
        type: "tool.updated",
        payload: {
          toolCallId: event.toolCallId,
          toolName: "subagent",
          progress: { message: event.textDelta },
        },
      });
      return;
    case "subagent_end":
      context.emit({
        type: event.isError ? "tool.failed" : "tool.completed",
        payload: {
          toolCallId: event.toolCallId,
          toolName: "subagent",
          title: event.agentType,
          output: event.result,
          completedAt: Date.now(),
        },
      });
      return;
    case "error":
      context.emit({
        type: "run.status",
        payload: { stage: "error", message: event.error.message },
      });
      return;
    case "mode_changed":
      context.emit({
        type: "run.status",
        payload: { stage: `mode:${event.modeId}` },
      });
      return;
    default:
      return;
  }
}

function approvalRequest(
  event: Extract<AgentControllerEvent, { type: "tool_approval_required" }>,
): RuntimeApprovalRequest {
  const category = toolCategoryResolver(event.toolName);
  return {
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    reason: `Allow ${event.toolName} to run?`,
    risk: category === "read" ? "low" : category === "edit" ? "high" : "medium",
    preview: truncate(JSON.stringify(event.args, null, 2), 8_000),
  };
}

function extractMessageContent(message: { content: unknown }) {
  const content = message.content as { parts?: unknown[]; content?: string };
  let text = "";
  let reasoning = "";
  for (const part of content.parts ?? []) {
    if (!part || typeof part !== "object") continue;
    const value = part as Record<string, unknown>;
    if (value.type === "text" && typeof value.text === "string")
      text += value.text;
    if (value.type === "reasoning") {
      if (typeof value.reasoning === "string") reasoning += value.reasoning;
      else if (typeof value.text === "string") reasoning += value.text;
    }
  }
  if (!text && typeof content.content === "string") text = content.content;
  return { text, reasoning };
}

function normalizeUsage(value: unknown): AgentUsage {
  const usage = value as Record<string, unknown>;
  return {
    inputTokens: numberValue(usage.inputTokens ?? usage.promptTokens),
    outputTokens: numberValue(usage.outputTokens ?? usage.completionTokens),
    totalTokens: numberValue(usage.totalTokens),
  };
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function toolNameFromResult(result: unknown): string {
  if (
    result &&
    typeof result === "object" &&
    "toolName" in result &&
    typeof result.toolName === "string"
  ) {
    return result.toolName;
  }
  return "tool";
}

function toProtocolError(value: unknown): AgentError {
  return { code: "TOOL_ERROR", message: errorMessage(value), retryable: false };
}

function toJsonValue(value: unknown, seen = new WeakSet<object>()): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error)
    return { name: value.name, message: value.message };
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => toJsonValue(item, seen));
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([, item]) =>
            item !== undefined &&
            typeof item !== "function" &&
            typeof item !== "symbol",
        )
        .map(([key, item]) => [key, toJsonValue(item, seen)]),
    );
  }
  return String(value);
}

function stableId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

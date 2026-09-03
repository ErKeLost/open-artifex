import { create } from "zustand";
import type { AgentEvent, AgentRunInput } from "../../shared/agent-protocol.js";
import type {
  AppInfo,
  ConversationMessage,
  ConversationThread,
  CredentialStatus,
  OpenArtifexBrowserPort,
  OpenArtifexTerminalPort,
  WorkspaceSelection,
} from "../../shared/desktop-api.js";
import type {
  OpenRouterModel,
  OpenRouterReasoningEffort,
} from "../../shared/openrouter-protocol.js";
import { adaptAgentEventsToTimeline } from "../features/timeline/agent-event-adapter";
import type { TimelineItem } from "../features/timeline/timeline.types";
import type { BrowserPort } from "../features/browser";
import type { TerminalPort } from "../features/terminal";
import type { AppTheme } from "../App";

const threadStorageKey = "open-artifex:active-thread:v1";
const themeStorageKey = "open-artifex:theme:v1";
const modelStorageKey = "open-artifex:model-selection:v1";

export type SessionStatus = "booting" | "ready" | "error";
export type ModelCatalogStatus = "idle" | "loading" | "ready" | "error";
export type SessionMessage = Pick<ConversationMessage, "id" | "role" | "text">;
export type SessionThread = ConversationThread;

export interface AppSessionState {
  status: SessionStatus;
  error?: string;
  appInfo?: AppInfo;
  credentials?: CredentialStatus;
  workspace?: WorkspaceSelection;
  workspaces: WorkspaceSelection[];
  threadId: string;
  runId?: string;
  events: AgentEvent[];
  messages: SessionMessage[];
  threads: SessionThread[];
  assistantText: string;
  themeMode: AppTheme;
  models: OpenRouterModel[];
  modelCatalogStatus: ModelCatalogStatus;
  modelCatalogError?: string;
  selectedModel?: string;
  selectedReasoningEffort?: OpenRouterReasoningEffort;
  terminalPort?: OpenArtifexTerminalPort;
  browserPort?: OpenArtifexBrowserPort;
  initialize(): Promise<void>;
  refreshConversations(): Promise<void>;
  submit(prompt: string): Promise<void>;
  stop(): Promise<void>;
  approve(item: TimelineItem): Promise<void>;
  reject(item: TimelineItem): Promise<void>;
  selectWorkspace(path?: string): Promise<void>;
  newTask(): Promise<void>;
  selectThread(threadId: string): Promise<void>;
  setOpenRouterKey(apiKey: string): Promise<void>;
  clearOpenRouterKey(): Promise<void>;
  refreshModels(): Promise<void>;
  setModel(modelId: string): void;
  setReasoningEffort(effort?: OpenRouterReasoningEffort): void;
  setThemeMode(theme: AppTheme): void;
}

function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `thread-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function storedThreadId(): string {
  try {
    const value = window.localStorage.getItem(threadStorageKey);
    if (value && value.length <= 256) return value;
  } catch {
    // The active thread remains usable when local preferences are unavailable.
  }
  return randomId();
}

function storedTheme(): AppTheme {
  try {
    const value = window.localStorage.getItem(themeStorageKey);
    if (value === "light" || value === "dark" || value === "system") {
      return value;
    }
  } catch {
    // Theme preference is optional.
  }
  return "system";
}

function storedModelSelection(): {
  model?: string;
  reasoningEffort?: OpenRouterReasoningEffort;
} {
  try {
    const value = window.localStorage.getItem(modelStorageKey);
    if (!value) return {};
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return {};
    const selection = parsed as Record<string, unknown>;
    return {
      ...(typeof selection.model === "string" && selection.model.length <= 256
        ? { model: selection.model }
        : {}),
      ...(typeof selection.reasoningEffort === "string" &&
      selection.reasoningEffort.length <= 32
        ? { reasoningEffort: selection.reasoningEffort }
        : {}),
    };
  } catch {
    return {};
  }
}

function persistThreadId(threadId: string): void {
  try {
    window.localStorage.setItem(threadStorageKey, threadId);
  } catch {
    // The durable source of truth is Mastra memory, not this preference.
  }
}

function persistModelSelection(
  model: string | undefined,
  reasoningEffort: OpenRouterReasoningEffort | undefined,
): void {
  try {
    window.localStorage.setItem(
      modelStorageKey,
      JSON.stringify({ model, reasoningEffort }),
    );
  } catch {
    // Model preferences are optional and never block a session.
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "桌面会话初始化失败";
}

function resultValue<Value>(
  result:
    { ok: true; value: Value } | { ok: false; error: { message: string } },
): Value {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function closePort(port: { close?: () => Promise<void> } | undefined): void {
  if (!port?.close) return;
  void port.close().catch(() => undefined);
}

function runtimeApi() {
  if (typeof window === "undefined" || !window.openArtifex) {
    throw new Error("桌面 API 尚未连接");
  }
  return window.openArtifex;
}

function conversationScope(state: AppSessionState) {
  if (!state.workspace) throw new Error("请先选择工作区");
  return {
    workspacePath: state.workspace.path,
    model: state.selectedModel ?? state.appInfo?.defaultModel,
    reasoningEffort: state.selectedReasoningEffort,
  };
}

function selectedModelRecord(
  state: AppSessionState,
): OpenRouterModel | undefined {
  return state.models.find((model) => model.id === state.selectedModel);
}

function resolveReasoningEffort(
  model: OpenRouterModel | undefined,
  desired: OpenRouterReasoningEffort | undefined,
): OpenRouterReasoningEffort | undefined {
  const supported = model?.reasoning?.supportedEfforts ?? [];
  if (!supported.length) return undefined;
  if (desired && supported.includes(desired)) return desired;
  if (
    model?.reasoning?.defaultEffort &&
    supported.includes(model.reasoning.defaultEffort)
  ) {
    return model.reasoning.defaultEffort;
  }
  return supported[0];
}

function sortThreads(threads: SessionThread[]): SessionThread[] {
  return [...threads].sort((left, right) => right.updatedAt - left.updatedAt);
}

async function createBrowserPort(
  state: AppSessionState,
  threadId: string,
): Promise<OpenArtifexBrowserPort | undefined> {
  if (!state.workspace || !state.appInfo || !state.credentials?.configured) {
    return undefined;
  }
  const result = await runtimeApi().browser.createPort({
    threadId,
    workspacePath: state.workspace.path,
    model: state.selectedModel ?? state.appInfo.defaultModel,
    reasoningEffort: state.selectedReasoningEffort,
  });
  return result.ok ? result.value : undefined;
}

let unsubscribeAgent: (() => void) | undefined;
let initialization: Promise<void> | undefined;
const initialThreadId = storedThreadId();
const initialModelSelection = storedModelSelection();

export const useAppSessionStore = create<AppSessionState>((set, get) => ({
  status: "booting",
  threadId: initialThreadId,
  events: [],
  messages: [],
  threads: [],
  workspaces: [],
  assistantText: "",
  themeMode: storedTheme(),
  models: [],
  modelCatalogStatus: "idle",
  selectedModel: initialModelSelection.model,
  selectedReasoningEffort: initialModelSelection.reasoningEffort,

  async initialize() {
    if (initialization) return initialization;
    initialization = (async () => {
      try {
        const api = runtimeApi();
        const [
          appInfoResult,
          credentialResult,
          workspaceResult,
          workspacesResult,
        ] = await Promise.all([
          api.app.getInfo(),
          api.credentials.getOpenRouterStatus(),
          api.workspace.getDefault(),
          api.workspace.list(),
        ]);
        const appInfo = resultValue(appInfoResult);
        const credentials = resultValue(credentialResult);
        const workspace = get().workspace ?? resultValue(workspaceResult);
        const workspaces = resultValue(workspacesResult);
        const terminalResult = await api.terminal.createPort({
          workspacePath: workspace.path,
        });
        const terminal = terminalResult.ok ? terminalResult.value : undefined;

        unsubscribeAgent?.();
        unsubscribeAgent = api.agent.onEvent((event) => {
          const current = get();
          if (event.type === "run.started") {
            if (event.payload.threadId !== current.threadId) return;
            if (current.runId && current.runId !== event.runId) return;
            set({ runId: event.runId, events: [...current.events, event] });
            return;
          }
          if (!current.runId || event.runId !== current.runId) return;

          const nextEvents = [...current.events, event];
          if (event.type === "assistant.delta") {
            set({
              events: nextEvents,
              assistantText: `${current.assistantText}${event.payload.delta}`,
            });
          } else if (event.type === "assistant.completed") {
            set({
              events: nextEvents,
              assistantText: event.payload.text,
            });
          } else {
            set({ events: nextEvents });
          }

          if (event.type === "run.completed" || event.type === "run.failed") {
            set({ runId: undefined });
            void get().refreshConversations();
          }
        });

        set({
          status: "ready",
          error: undefined,
          appInfo,
          credentials,
          workspace,
          workspaces,
          terminalPort: terminal,
          selectedModel: get().selectedModel ?? appInfo.defaultModel,
        });
        await get()
          .refreshModels()
          .catch(() => undefined);
        if (credentials.configured) {
          await get().refreshConversations();
          const browser = await createBrowserPort(get(), get().threadId);
          if (browser) set({ browserPort: browser });
        }
      } catch (error) {
        set({ status: "error", error: errorMessage(error) });
      } finally {
        initialization = undefined;
      }
    })();
    return initialization;
  },

  async refreshConversations() {
    const state = get();
    if (!state.credentials?.configured) {
      set({ threads: [], messages: [] });
      return;
    }
    const scope = conversationScope(state);
    const threads = sortThreads(
      resultValue(await runtimeApi().conversation.list(scope)),
    );
    const activeThreadId = threads.some(
      (thread) => thread.id === state.threadId,
    )
      ? state.threadId
      : (threads[0]?.id ?? state.threadId);
    const messages = threads.some((thread) => thread.id === activeThreadId)
      ? resultValue(
          await runtimeApi().conversation.messages({
            ...scope,
            threadId: activeThreadId,
          }),
        )
      : [];
    if (activeThreadId !== state.threadId) persistThreadId(activeThreadId);
    set({
      threadId: activeThreadId,
      threads,
      messages,
      assistantText: "",
    });
  },

  async submit(prompt: string) {
    const value = prompt.trim();
    if (!value || get().runId) return;
    const state = get();
    if (!state.credentials?.configured) {
      throw new Error("请先在设置中配置 OpenRouter API 密钥");
    }
    const scope = conversationScope(state);
    let threads = state.threads;
    if (!threads.some((thread) => thread.id === state.threadId)) {
      const thread = resultValue(
        await runtimeApi().conversation.create({
          ...scope,
          threadId: state.threadId,
          title: value.replace(/\s+/g, " ").slice(0, 80),
        }),
      );
      threads = sortThreads([thread, ...threads]);
    }
    const optimisticMessage: SessionMessage = {
      id: `pending-${randomId()}`,
      role: "user",
      text: value,
    };
    set({
      events: [],
      assistantText: "",
      messages: [...state.messages, optimisticMessage],
      threads,
    });
    const input: AgentRunInput = {
      threadId: state.threadId,
      prompt: value,
      workspacePath: scope.workspacePath,
      model: scope.model,
      reasoningEffort: scope.reasoningEffort,
    };
    const accepted = resultValue(await runtimeApi().agent.run(input));
    set({ runId: accepted.runId });
  },

  async stop() {
    const runId = get().runId;
    if (!runId) return;
    await resultValue(await runtimeApi().agent.cancel({ runId }));
  },

  async approve(item: TimelineItem) {
    const source = item.source;
    if (!source?.runId || !source.toolCallId || !source.approvalId) return;
    await resultValue(
      await runtimeApi().agent.resolveApproval({
        runId: source.runId,
        toolCallId: source.toolCallId,
        approvalId: source.approvalId,
        decision: "approve-once",
      }),
    );
  },

  async reject(item: TimelineItem) {
    const source = item.source;
    if (!source?.runId || !source.toolCallId || !source.approvalId) return;
    await resultValue(
      await runtimeApi().agent.resolveApproval({
        runId: source.runId,
        toolCallId: source.toolCallId,
        approvalId: source.approvalId,
        decision: "reject",
      }),
    );
  },

  async selectWorkspace(path) {
    const current = get();
    const selected = path
      ? resultValue(await runtimeApi().workspace.activate({ path }))
      : resultValue(
          await runtimeApi().workspace.select({
            defaultPath: current.workspace?.path,
          }),
        );
    if (!selected || selected.path === current.workspace?.path) return;
    closePort(current.terminalPort);
    closePort(current.browserPort);
    const workspaces = resultValue(await runtimeApi().workspace.list());
    set({
      workspace: selected,
      workspaces,
      terminalPort: undefined,
      browserPort: undefined,
      threads: [],
      messages: [],
      events: [],
    });
    await get().initialize();
  },

  async newTask() {
    const current = get();
    closePort(current.browserPort);
    const threadId = randomId();
    persistThreadId(threadId);
    set({
      threadId,
      runId: undefined,
      events: [],
      messages: [],
      assistantText: "",
      browserPort: undefined,
    });
    if (current.credentials?.configured && current.workspace) {
      try {
        const thread = resultValue(
          await runtimeApi().conversation.create({
            ...conversationScope(get()),
            threadId,
            title: "新对话",
          }),
        );
        set((state) => ({ threads: sortThreads([thread, ...state.threads]) }));
        const browser = await createBrowserPort(get(), threadId);
        if (browser) set({ browserPort: browser });
      } catch (error) {
        set({ error: errorMessage(error) });
      }
    }
  },

  async selectThread(threadId) {
    const current = get();
    if (
      threadId === current.threadId ||
      !current.threads.some((thread) => thread.id === threadId)
    ) {
      return;
    }
    closePort(current.browserPort);
    const messages = resultValue(
      await runtimeApi().conversation.messages({
        ...conversationScope(current),
        threadId,
      }),
    );
    persistThreadId(threadId);
    set({
      threadId,
      runId: undefined,
      events: [],
      messages,
      assistantText: "",
      browserPort: undefined,
    });
    const browser = await createBrowserPort(get(), threadId);
    if (browser) set({ browserPort: browser });
  },

  async setOpenRouterKey(apiKey) {
    const credentials = resultValue(
      await runtimeApi().credentials.setOpenRouterKey({ apiKey }),
    );
    set({ credentials, error: undefined });
    try {
      resultValue(await runtimeApi().credentials.verifyOpenRouterKey());
    } catch (verificationError) {
      throw new Error(
        `密钥已保存，但 OpenRouter 验证失败：${errorMessage(verificationError)}`,
      );
    }
    await get()
      .refreshModels()
      .catch(() => undefined);
    await get().refreshConversations();
    const browser = await createBrowserPort(get(), get().threadId);
    if (browser) set({ browserPort: browser });
  },

  async clearOpenRouterKey() {
    const credentials = resultValue(
      await runtimeApi().credentials.clearOpenRouterKey(),
    );
    closePort(get().browserPort);
    set({
      credentials,
      browserPort: undefined,
      threads: [],
      messages: [],
      events: [],
    });
  },

  async refreshModels() {
    set({ modelCatalogStatus: "loading", modelCatalogError: undefined });
    try {
      const catalog = resultValue(await runtimeApi().models.list());
      const latest = get();
      const selectedModel =
        latest.selectedModel ??
        latest.appInfo?.defaultModel ??
        catalog.models[0]?.id;
      const model = catalog.models.find((item) => item.id === selectedModel);
      const selectedReasoningEffort = resolveReasoningEffort(
        model,
        latest.selectedReasoningEffort,
      );
      persistModelSelection(selectedModel, selectedReasoningEffort);
      set({
        models: catalog.models,
        modelCatalogStatus: "ready",
        modelCatalogError: undefined,
        selectedModel,
        selectedReasoningEffort,
      });
    } catch (error) {
      set({
        modelCatalogStatus: "error",
        modelCatalogError: errorMessage(error),
      });
      throw error;
    }
  },

  setModel(modelId) {
    const state = get();
    const model = state.models.find((item) => item.id === modelId);
    const selectedReasoningEffort = resolveReasoningEffort(
      model,
      state.selectedReasoningEffort,
    );
    persistModelSelection(modelId, selectedReasoningEffort);
    set({ selectedModel: modelId, selectedReasoningEffort });
  },

  setReasoningEffort(reasoningEffort) {
    const state = get();
    const selectedReasoningEffort = resolveReasoningEffort(
      selectedModelRecord(state),
      reasoningEffort,
    );
    persistModelSelection(state.selectedModel, selectedReasoningEffort);
    set({ selectedReasoningEffort });
  },

  setThemeMode(themeMode) {
    set({ themeMode });
    try {
      window.localStorage.setItem(themeStorageKey, themeMode);
    } catch {
      // Theme preference is optional.
    }
  },
}));

export function useSessionTimeline(): TimelineItem[] {
  return adaptAgentEventsToTimeline(
    useAppSessionStore((state) => state.events),
  );
}

export function useSessionPorts(): {
  terminalPort?: TerminalPort;
  browserPort?: BrowserPort;
} {
  const terminalPort = useAppSessionStore((state) => state.terminalPort);
  const browserPort = useAppSessionStore((state) => state.browserPort);
  return { terminalPort, browserPort };
}

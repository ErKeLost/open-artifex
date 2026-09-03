import type {
  AgentApprovalResolution,
  AgentEvent,
  AgentRunInput,
} from "./agent-protocol.js";
import type { OpenRouterModelCatalog } from "./openrouter-protocol.js";
import type {
  BrowserEvent,
  BrowserKeyAction,
  BrowserMouseAction,
  BrowserSessionRequest,
  BrowserSessionState,
} from "./browser-protocol.js";
import type {
  CreateScheduledTaskInput,
  ScheduledTask,
  ScheduledTaskScope,
  UpdateScheduledTaskInput,
} from "./schedule-protocol.js";
import {
  isBrowserEvent,
  isBrowserKeyAction,
  isBrowserMouseAction,
} from "./browser-protocol.js";

export const IPC_CHANNELS = Object.freeze({
  appInfo: "open-artifex:app:info",
  credentialStatus: "open-artifex:credentials:openrouter:status",
  credentialSet: "open-artifex:credentials:openrouter:set",
  credentialClear: "open-artifex:credentials:openrouter:clear",
  workspaceDefault: "open-artifex:workspace:default",
  workspaceSelect: "open-artifex:workspace:select",
  agentRun: "open-artifex:agent:run",
  agentCancel: "open-artifex:agent:cancel",
  agentResolveApproval: "open-artifex:agent:approval:resolve",
  agentEvent: "open-artifex:agent:event",
  terminalCreate: "open-artifex:terminal:create",
  terminalWrite: "open-artifex:terminal:write",
  terminalResize: "open-artifex:terminal:resize",
  terminalKill: "open-artifex:terminal:kill",
  terminalSubscribe: "open-artifex:terminal:subscribe",
  terminalEvent: "open-artifex:terminal:event",
  browserState: "open-artifex:browser:state",
  browserStart: "open-artifex:browser:start",
  browserNavigate: "open-artifex:browser:navigate",
  browserBack: "open-artifex:browser:back",
  browserForward: "open-artifex:browser:forward",
  browserReload: "open-artifex:browser:reload",
  browserMouse: "open-artifex:browser:mouse",
  browserKey: "open-artifex:browser:key",
  browserClose: "open-artifex:browser:close",
  browserEvent: "open-artifex:browser:event",
});

export interface DesktopApiError {
  code:
    | "INVALID_ARGUMENT"
    | "NOT_AUTHORIZED"
    | "CREDENTIAL_MISSING"
    | "CREDENTIAL_INVALID"
    | "CREDENTIAL_UNAVAILABLE"
    | "SECURE_STORAGE_UNAVAILABLE"
    | "AGENT_UNAVAILABLE"
    | "TERMINAL_UNAVAILABLE"
    | "BROWSER_UNAVAILABLE"
    | "SCHEDULE_UNAVAILABLE"
    | "INTERNAL_ERROR";
  message: string;
}

export type DesktopResult<Value> =
  { ok: true; value: Value } | { ok: false; error: DesktopApiError };

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  defaultModel: string;
}

export interface CredentialStatus {
  configured: boolean;
  secureStorageAvailable: boolean;
  source: "safe-storage" | "session" | "environment" | "missing";
}

export interface CredentialVerification {
  verified: boolean;
}

export interface SetOpenRouterKeyInput {
  apiKey: string;
}

export interface WorkspaceSelectionOptions {
  defaultPath?: string;
}

export interface WorkspaceSelection {
  path: string;
  name: string;
}

export interface WorkspacePathInput {
  workspacePath: string;
}

export interface PullRequestSummary {
  number: number;
  title: string;
  url: string;
  state: string;
  branch: string;
  updatedAt: string;
}

export interface GitOverview {
  isRepository: boolean;
  branch?: string;
  remote?: string;
  changes: string[];
  pullRequests: PullRequestSummary[];
  pullRequestsMessage?: string;
}

export interface PluginSummary {
  name: string;
  version?: string;
  path: string;
}

export interface ConversationScope {
  workspacePath: string;
  model?: string;
  reasoningEffort?: string;
}

export interface ConversationThread {
  id: string;
  title: string;
  updatedAt: number;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
}

export interface AgentRunAccepted {
  runId: string;
}

export interface AgentCancelInput {
  runId: string;
}

export interface TerminalCreateInput {
  /** Stable identity for a renderer-owned terminal. A UUID is generated when omitted. */
  sessionId?: string;
  workspacePath?: string;
  cols?: number;
  rows?: number;
}

export interface TerminalSession {
  sessionId: string;
  workspacePath: string;
  shell: string;
  pid: number;
  cols: number;
  rows: number;
  status: "running" | "exited";
}

export interface TerminalWriteInput {
  sessionId: string;
  data: string;
}

export interface TerminalResizeInput {
  sessionId: string;
  cols: number;
  rows: number;
}

export interface TerminalKillInput {
  sessionId: string;
  signal?: "SIGHUP" | "SIGINT" | "SIGTERM" | "SIGKILL";
}

export interface TerminalSubscribeInput {
  sessionId: string;
}

export interface TerminalSnapshot {
  sessionId: string;
  data: string;
  sequence: number;
  status: "running" | "exited";
}

/** A renderer-safe PTY facade. The implementation is created by the Tauri adapter. */
export interface OpenArtifexTerminalPort {
  subscribeWrite(listener: (chunk: string) => void): () => void;
  sendInput(data: string): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
  close(): Promise<void>;
}

export type BrowserPortSessionInput = Pick<
  BrowserSessionRequest,
  "threadId" | "workspacePath" | "model" | "reasoningEffort"
>;

export interface OpenArtifexBrowserFrame {
  id: string;
  dataUrl: string;
  width: number;
  height: number;
}

/** Renderer-safe facade for a thread-scoped Mastra browser session. */
export interface OpenArtifexBrowserPort {
  getState(): Promise<BrowserSessionState>;
  subscribeState(listener: (state: BrowserSessionState) => void): () => void;
  subscribeFrame(
    listener: (frame: OpenArtifexBrowserFrame) => void,
  ): () => void;
  dispatchMouse(action: BrowserMouseAction): Promise<void>;
  dispatchKey(action: BrowserKeyAction): Promise<void>;
  navigate(url: string): Promise<void>;
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  reload(): Promise<void>;
  close(): Promise<void>;
}

export type TerminalEvent =
  | {
      type: "data";
      sessionId: string;
      data: string;
      sequence: number;
      timestamp: number;
    }
  | {
      type: "exit";
      sessionId: string;
      exitCode: number;
      signal?: number;
      sequence: number;
      timestamp: number;
    };

export interface OpenArtifexDesktopApi {
  app: {
    getInfo(): Promise<DesktopResult<AppInfo>>;
  };
  credentials: {
    getOpenRouterStatus(): Promise<DesktopResult<CredentialStatus>>;
    setOpenRouterKey(
      input: SetOpenRouterKeyInput,
    ): Promise<DesktopResult<CredentialStatus>>;
    clearOpenRouterKey(): Promise<DesktopResult<CredentialStatus>>;
    verifyOpenRouterKey(): Promise<DesktopResult<CredentialVerification>>;
  };
  models: {
    list(): Promise<DesktopResult<OpenRouterModelCatalog>>;
  };
  workspace: {
    getDefault(): Promise<DesktopResult<WorkspaceSelection>>;
    list(): Promise<DesktopResult<WorkspaceSelection[]>>;
    activate(input: {
      path: string;
    }): Promise<DesktopResult<WorkspaceSelection>>;
    select(
      options?: WorkspaceSelectionOptions,
    ): Promise<DesktopResult<WorkspaceSelection | null>>;
    getGitOverview(
      input: WorkspacePathInput,
    ): Promise<DesktopResult<GitOverview>>;
    listPlugins(
      input: WorkspacePathInput,
    ): Promise<DesktopResult<PluginSummary[]>>;
  };
  conversation: {
    list(
      input: ConversationScope,
    ): Promise<DesktopResult<ConversationThread[]>>;
    messages(
      input: ConversationScope & { threadId: string },
    ): Promise<DesktopResult<ConversationMessage[]>>;
    create(
      input: ConversationScope & { threadId: string; title: string },
    ): Promise<DesktopResult<ConversationThread>>;
  };
  agent: {
    run(input: AgentRunInput): Promise<DesktopResult<AgentRunAccepted>>;
    cancel(input: AgentCancelInput): Promise<DesktopResult<void>>;
    resolveApproval(
      input: AgentApprovalResolution,
    ): Promise<DesktopResult<void>>;
    onEvent(listener: (event: AgentEvent) => void): () => void;
  };
  terminal: {
    create(
      input?: TerminalCreateInput,
    ): Promise<DesktopResult<TerminalSession>>;
    createPort(
      input?: TerminalCreateInput,
    ): Promise<DesktopResult<OpenArtifexTerminalPort>>;
    write(input: TerminalWriteInput): Promise<DesktopResult<void>>;
    resize(input: TerminalResizeInput): Promise<DesktopResult<void>>;
    kill(input: TerminalKillInput): Promise<DesktopResult<void>>;
    subscribe(
      input: TerminalSubscribeInput,
    ): Promise<DesktopResult<TerminalSnapshot>>;
    onEvent(listener: (event: TerminalEvent) => void): () => void;
  };
  browser: {
    createPort(
      input: BrowserPortSessionInput,
    ): Promise<DesktopResult<OpenArtifexBrowserPort>>;
    getState(
      input: BrowserPortSessionInput,
    ): Promise<DesktopResult<BrowserSessionState>>;
    start(
      input: BrowserPortSessionInput,
    ): Promise<DesktopResult<BrowserSessionState>>;
    navigate(
      input: BrowserPortSessionInput & { url: string },
    ): Promise<DesktopResult<BrowserSessionState>>;
    back(
      input: BrowserPortSessionInput,
    ): Promise<DesktopResult<BrowserSessionState>>;
    forward(
      input: BrowserPortSessionInput,
    ): Promise<DesktopResult<BrowserSessionState>>;
    reload(
      input: BrowserPortSessionInput,
    ): Promise<DesktopResult<BrowserSessionState>>;
    mouse(
      input: BrowserPortSessionInput & { action: BrowserMouseAction },
    ): Promise<DesktopResult<void>>;
    key(
      input: BrowserPortSessionInput & { action: BrowserKeyAction },
    ): Promise<DesktopResult<void>>;
    close(input: BrowserPortSessionInput): Promise<DesktopResult<void>>;
    onEvent(listener: (event: BrowserEvent) => void): () => void;
  };
  schedule: {
    list(input: ScheduledTaskScope): Promise<DesktopResult<ScheduledTask[]>>;
    create(
      input: CreateScheduledTaskInput,
    ): Promise<DesktopResult<ScheduledTask>>;
    update(
      input: UpdateScheduledTaskInput,
    ): Promise<DesktopResult<ScheduledTask>>;
    delete(
      input: ScheduledTaskScope & { id: string },
    ): Promise<DesktopResult<void>>;
  };
}

declare global {
  interface Window {
    openArtifex: OpenArtifexDesktopApi;
  }
}

export function isAgentCancelInput(value: unknown): value is AgentCancelInput {
  return (
    typeof value === "object" &&
    value !== null &&
    "runId" in value &&
    typeof value.runId === "string" &&
    value.runId.length > 0 &&
    value.runId.length <= 256
  );
}

export function isSetOpenRouterKeyInput(
  value: unknown,
): value is SetOpenRouterKeyInput {
  return (
    typeof value === "object" &&
    value !== null &&
    "apiKey" in value &&
    typeof value.apiKey === "string" &&
    value.apiKey.trim().length >= 20 &&
    value.apiKey.length <= 16_384
  );
}

export function isWorkspaceSelectionOptions(
  value: unknown,
): value is WorkspaceSelectionOptions | undefined {
  if (value === undefined) return true;
  if (typeof value !== "object" || value === null) return false;
  if (!("defaultPath" in value) || value.defaultPath === undefined) return true;

  return (
    typeof value.defaultPath === "string" && value.defaultPath.length <= 16_384
  );
}

const MAX_TERMINAL_SESSION_ID = 256;
const MAX_TERMINAL_DATA_LENGTH = 1_000_000;
const MAX_TERMINAL_DIMENSION = 1_000;
const MAX_BROWSER_THREAD_ID = 256;
const MAX_BROWSER_PATH_LENGTH = 16_384;
const MAX_BROWSER_MODEL_LENGTH = 256;
const MAX_BROWSER_URL_LENGTH = 16_384;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTerminalSessionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_TERMINAL_SESSION_ID &&
    !/[\u0000\u0001-\u001f\u007f]/.test(value)
  );
}

function isTerminalDimension(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_TERMINAL_DIMENSION
  );
}

export function isTerminalCreateInput(
  value: unknown,
): value is TerminalCreateInput | undefined {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return (
    (value.sessionId === undefined || isTerminalSessionId(value.sessionId)) &&
    (value.workspacePath === undefined ||
      (typeof value.workspacePath === "string" &&
        value.workspacePath.length <= 16_384)) &&
    (value.cols === undefined || isTerminalDimension(value.cols)) &&
    (value.rows === undefined || isTerminalDimension(value.rows))
  );
}

export function isTerminalWriteInput(
  value: unknown,
): value is TerminalWriteInput {
  return (
    isRecord(value) &&
    isTerminalSessionId(value.sessionId) &&
    typeof value.data === "string" &&
    value.data.length <= MAX_TERMINAL_DATA_LENGTH
  );
}

export function isTerminalResizeInput(
  value: unknown,
): value is TerminalResizeInput {
  return (
    isRecord(value) &&
    isTerminalSessionId(value.sessionId) &&
    isTerminalDimension(value.cols) &&
    isTerminalDimension(value.rows)
  );
}

export function isTerminalKillInput(
  value: unknown,
): value is TerminalKillInput {
  return (
    isRecord(value) &&
    isTerminalSessionId(value.sessionId) &&
    (value.signal === undefined ||
      value.signal === "SIGHUP" ||
      value.signal === "SIGINT" ||
      value.signal === "SIGTERM" ||
      value.signal === "SIGKILL")
  );
}

export function isTerminalSubscribeInput(
  value: unknown,
): value is TerminalSubscribeInput {
  return isRecord(value) && isTerminalSessionId(value.sessionId);
}

export function isTerminalEvent(value: unknown): value is TerminalEvent {
  if (!isRecord(value) || !isTerminalSessionId(value.sessionId)) return false;
  if (
    typeof value.sequence !== "number" ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 0 ||
    typeof value.timestamp !== "number" ||
    !Number.isFinite(value.timestamp)
  ) {
    return false;
  }
  if (value.type === "data") {
    return (
      typeof value.data === "string" &&
      value.data.length <= MAX_TERMINAL_DATA_LENGTH
    );
  }
  return (
    value.type === "exit" &&
    typeof value.exitCode === "number" &&
    Number.isSafeInteger(value.exitCode) &&
    (value.signal === undefined ||
      (typeof value.signal === "number" && Number.isSafeInteger(value.signal)))
  );
}

export function isBrowserPortSessionInput(
  value: unknown,
): value is BrowserPortSessionInput {
  if (!isRecord(value)) return false;
  return (
    isBrowserSessionValue(value.threadId, MAX_BROWSER_THREAD_ID) &&
    isBrowserSessionValue(value.workspacePath, MAX_BROWSER_PATH_LENGTH) &&
    isBrowserSessionValue(value.model, MAX_BROWSER_MODEL_LENGTH)
  );
}

export function isBrowserNavigateInput(
  value: unknown,
): value is BrowserPortSessionInput & { url: string } {
  return (
    isBrowserPortSessionInput(value) &&
    isBrowserSessionValue(
      (value as Record<string, unknown>).url,
      MAX_BROWSER_URL_LENGTH,
    )
  );
}

export function isBrowserMouseInput(
  value: unknown,
): value is BrowserPortSessionInput & { action: BrowserMouseAction } {
  return (
    isBrowserPortSessionInput(value) &&
    isBrowserMouseAction((value as Record<string, unknown>).action)
  );
}

export function isBrowserKeyInput(
  value: unknown,
): value is BrowserPortSessionInput & { action: BrowserKeyAction } {
  return (
    isBrowserPortSessionInput(value) &&
    isBrowserKeyAction((value as Record<string, unknown>).action)
  );
}

export function isBrowserEventPayload(value: unknown): value is BrowserEvent {
  return isBrowserEvent(value);
}

function isBrowserSessionValue(
  value: unknown,
  maxLength: number,
): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= maxLength
  );
}

export {};

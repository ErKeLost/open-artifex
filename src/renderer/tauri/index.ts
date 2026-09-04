import {
  isAgentEvent,
  type AgentApprovalResolution,
  type AgentEvent,
  type AgentRunInput,
} from "../../shared/agent-protocol.js";
import {
  isBrowserEventPayload,
  isTerminalEvent,
  type AgentCancelInput,
  type AgentRunAccepted,
  type AppInfo,
  type BrowserPortSessionInput,
  type ConversationMessage,
  type ConversationScope,
  type ConversationThread,
  type CredentialStatus,
  type CredentialVerification,
  type GitOverview,
  type OpenArtifexDesktopApi,
  type SetOpenRouterKeyInput,
  type TerminalCreateInput,
  type TerminalEvent,
  type TerminalKillInput,
  type TerminalSession,
  type TerminalSnapshot,
  type TerminalWriteInput,
  type PluginSummary,
  type WorkspaceSelection,
  type WorkspaceSelectionOptions,
} from "../../shared/desktop-api.js";
import type { OpenRouterModelCatalog } from "../../shared/openrouter-protocol.js";
import type {
  CreateScheduledTaskInput,
  ScheduledTask,
  ScheduledTaskScope,
  UpdateScheduledTaskInput,
} from "../../shared/schedule-protocol.js";
import type {
  AddImprovementFeedbackInput,
  CreateImprovementCandidateInput,
  EvaluateImprovementCandidateInput,
  ImprovementScope,
  ImprovementSnapshot,
  RequestImprovementPublicationInput,
  ResolveImprovementPublicationInput,
  RollbackImprovementCandidateInput,
} from "../../shared/improvement-protocol.js";
import type {
  BrowserEvent,
  BrowserSessionState,
} from "../../shared/browser-protocol.js";
import { call, subscribe } from "./client.js";
import { createBrowserPort } from "./browser-port.js";
import { TAURI_COMMANDS, TAURI_EVENTS } from "./channels.js";
import { createTerminalPort } from "./terminal-port.js";

export const tauriApi: OpenArtifexDesktopApi = Object.freeze({
  app: {
    getInfo: () => call<AppInfo>(TAURI_COMMANDS.appInfo),
  },
  credentials: {
    getOpenRouterStatus: () =>
      call<CredentialStatus>(TAURI_COMMANDS.credentialStatus),
    setOpenRouterKey: (input: SetOpenRouterKeyInput) =>
      call<CredentialStatus>(TAURI_COMMANDS.credentialSet, {
        apiKey: input.apiKey,
      }),
    clearOpenRouterKey: () =>
      call<CredentialStatus>(TAURI_COMMANDS.credentialClear),
    verifyOpenRouterKey: () =>
      call<CredentialVerification>(TAURI_COMMANDS.credentialVerify),
  },
  models: {
    list: () => call<OpenRouterModelCatalog>(TAURI_COMMANDS.openRouterModels),
  },
  workspace: {
    getDefault: () => call<WorkspaceSelection>(TAURI_COMMANDS.workspaceDefault),
    list: () => call<WorkspaceSelection[]>(TAURI_COMMANDS.workspaceList),
    activate: (input: { path: string }) =>
      call<WorkspaceSelection>(TAURI_COMMANDS.workspaceActivate, input),
    select: (options?: WorkspaceSelectionOptions) =>
      call<WorkspaceSelection | null>(
        TAURI_COMMANDS.workspaceSelect,
        options ? { options } : undefined,
      ),
    getGitOverview: (input: { workspacePath: string }) =>
      call<GitOverview>(TAURI_COMMANDS.workspaceGitOverview, { input }),
    listPlugins: (input: { workspacePath: string }) =>
      call<PluginSummary[]>(TAURI_COMMANDS.pluginList, { input }),
  },
  conversation: {
    list: (input: ConversationScope) =>
      call<ConversationThread[]>(TAURI_COMMANDS.conversationList, { input }),
    messages: (input: ConversationScope & { threadId: string }) =>
      call<ConversationMessage[]>(TAURI_COMMANDS.conversationMessages, {
        input,
      }),
    create: (input: ConversationScope & { threadId: string; title: string }) =>
      call<ConversationThread>(TAURI_COMMANDS.conversationCreate, { input }),
  },
  agent: {
    run: (input: AgentRunInput) =>
      call<AgentRunAccepted>(TAURI_COMMANDS.agentRun, { input }),
    cancel: (input: AgentCancelInput) =>
      call<void>(TAURI_COMMANDS.agentCancel, { input }),
    resolveApproval: (input: AgentApprovalResolution) =>
      call<void>(TAURI_COMMANDS.agentApproval, { input }),
    onEvent: (listener: (event: AgentEvent) => void) =>
      subscribe(TAURI_EVENTS.agent, isAgentEvent, listener),
  },
  terminal: {
    create: (input?: TerminalCreateInput) =>
      call<TerminalSession>(
        TAURI_COMMANDS.terminalCreate,
        input ? { input } : undefined,
      ),
    createPort: createTerminalPort,
    write: (input: TerminalWriteInput) =>
      call<void>(TAURI_COMMANDS.terminalWrite, { input }),
    resize: (
      input: Parameters<OpenArtifexDesktopApi["terminal"]["resize"]>[0],
    ) => call<void>(TAURI_COMMANDS.terminalResize, { input }),
    kill: (input: TerminalKillInput) =>
      call<void>(TAURI_COMMANDS.terminalKill, { input }),
    subscribe: (
      input: Parameters<OpenArtifexDesktopApi["terminal"]["subscribe"]>[0],
    ) => call<TerminalSnapshot>(TAURI_COMMANDS.terminalSubscribe, { input }),
    onEvent: (listener: (event: TerminalEvent) => void) =>
      subscribe(TAURI_EVENTS.terminal, isTerminalEvent, listener),
  },
  browser: {
    createPort: createBrowserPort,
    getState: (input: BrowserPortSessionInput) =>
      call<BrowserSessionState>(TAURI_COMMANDS.browserState, { input }),
    start: (input: BrowserPortSessionInput) =>
      call<BrowserSessionState>(TAURI_COMMANDS.browserStart, { input }),
    navigate: (
      input: Parameters<OpenArtifexDesktopApi["browser"]["navigate"]>[0],
    ) => call<BrowserSessionState>(TAURI_COMMANDS.browserNavigate, { input }),
    back: (input: BrowserPortSessionInput) =>
      call<BrowserSessionState>(TAURI_COMMANDS.browserBack, { input }),
    forward: (input: BrowserPortSessionInput) =>
      call<BrowserSessionState>(TAURI_COMMANDS.browserForward, { input }),
    reload: (input: BrowserPortSessionInput) =>
      call<BrowserSessionState>(TAURI_COMMANDS.browserReload, { input }),
    mouse: (input: Parameters<OpenArtifexDesktopApi["browser"]["mouse"]>[0]) =>
      call<void>(TAURI_COMMANDS.browserMouse, { input }),
    key: (input: Parameters<OpenArtifexDesktopApi["browser"]["key"]>[0]) =>
      call<void>(TAURI_COMMANDS.browserKey, { input }),
    close: (input: BrowserPortSessionInput) =>
      call<void>(TAURI_COMMANDS.browserClose, { input }),
    onEvent: (listener: (event: BrowserEvent) => void) =>
      subscribe(TAURI_EVENTS.browser, isBrowserEventPayload, listener),
  },
  schedule: {
    list: (input: ScheduledTaskScope) =>
      call<ScheduledTask[]>(TAURI_COMMANDS.scheduleList, { input }),
    create: (input: CreateScheduledTaskInput) =>
      call<ScheduledTask>(TAURI_COMMANDS.scheduleCreate, { input }),
    update: (input: UpdateScheduledTaskInput) =>
      call<ScheduledTask>(TAURI_COMMANDS.scheduleUpdate, { input }),
    delete: (input: ScheduledTaskScope & { id: string }) =>
      call<void>(TAURI_COMMANDS.scheduleDelete, { input }),
  },
  improvement: {
    list: (input: ImprovementScope) =>
      call<ImprovementSnapshot>(TAURI_COMMANDS.improvementList, { input }),
    addFeedback: (input: AddImprovementFeedbackInput) =>
      call<ImprovementSnapshot>(TAURI_COMMANDS.improvementAddFeedback, { input }),
    createCandidate: (input: CreateImprovementCandidateInput) =>
      call<ImprovementSnapshot>(
        TAURI_COMMANDS.improvementCreateCandidate,
        { input },
      ),
    evaluateCandidate: (input: EvaluateImprovementCandidateInput) =>
      call<ImprovementSnapshot>(
        TAURI_COMMANDS.improvementEvaluateCandidate,
        { input },
      ),
    requestPublication: (input: RequestImprovementPublicationInput) =>
      call<ImprovementSnapshot>(
        TAURI_COMMANDS.improvementRequestPublication,
        { input },
      ),
    resolvePublication: (input: ResolveImprovementPublicationInput) =>
      call<ImprovementSnapshot>(
        TAURI_COMMANDS.improvementResolvePublication,
        { input },
      ),
    rollback: (input: RollbackImprovementCandidateInput) =>
      call<ImprovementSnapshot>(TAURI_COMMANDS.improvementRollback, { input }),
  },
});

export function installTauriApi(): void {
  window.openArtifex = tauriApi;
}

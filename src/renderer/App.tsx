import {
  ArrowLeft,
  ArrowRight,
  Desktop,
  DotsThree,
  FolderSimple,
  Moon,
  SidebarSimple,
  SlidersHorizontal,
  Sun,
} from "@phosphor-icons/react";
import { Markdown } from "@lobehub/ui";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useState, useSyncExternalStore, type MouseEvent } from "react";
import { RightUtilityPanel, WorkspaceSidebar } from "./components";
import { Composer, type ComposerProps } from "./features/composer";
import { ScheduleView, type ScheduleStoreStatus } from "./features/schedule";
import { ImprovementView, type ImprovementStoreStatus } from "./features/improvement";
import {
  PluginsView,
  PullRequestsView,
  type InventoryStatus,
} from "./features/inventory";
import type { BrowserPort } from "./features/browser";
import type { TerminalPort } from "./features/terminal";
import {
  ToolTimeline,
  type TimelineItem,
  type ToolTimelineViewState,
} from "./features/timeline";
import type {
  CreateScheduledTaskInput,
  ScheduledTask,
} from "../shared/schedule-protocol.js";
import type {
  ImprovementCandidate,
  ImprovementSnapshot,
  ImprovementTrace,
} from "../shared/improvement-protocol.js";
import type {
  GitOverview,
  PluginSummary,
  WorkspaceSelection,
} from "../shared/desktop-api.js";
import type {
  OpenRouterModel,
  OpenRouterReasoningEffort,
} from "../shared/openrouter-protocol.js";
import type { SessionThread } from "./session/session-store";
import type { ModelCatalogStatus } from "./features/model";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { Button } from "./components/ui/button";
import "./styles/app.css";

export type AppTheme = "light" | "dark" | "system";

export interface AppProps {
  theme?: AppTheme;
  terminalPort?: TerminalPort | null;
  browserPort?: BrowserPort | null;
  workspaceName?: string;
  workspacePath?: string;
  workspaces?: readonly WorkspaceSelection[];
  threads?: readonly SessionThread[];
  activeThreadId?: string;
  onNewTask?: () => void;
  onSelectWorkspace?: (path?: string) => void;
  onSelectThread?: (threadId: string) => void;
  onOpenSettings?: () => void;
  onSubmit?: ComposerProps["onSubmit"];
  onStop?: ComposerProps["onStop"];
  onAttach?: ComposerProps["onAttach"];
  onApprove?: (item: TimelineItem) => void | Promise<void>;
  onReject?: (item: TimelineItem) => void | Promise<void>;
  onThemeChange?: (theme: AppTheme) => void;
  timelineItems?: readonly TimelineItem[];
  timelineState?: ToolTimelineViewState;
  errorMessage?: string;
  assistantMessages?: readonly AppMessage[];
  threadId?: string;
  running?: boolean;
  scheduledTasks?: readonly ScheduledTask[];
  scheduleStatus?: ScheduleStoreStatus;
  scheduleError?: string;
  scheduleModel?: string;
  scheduleReasoningEffort?: OpenRouterReasoningEffort;
  models?: readonly OpenRouterModel[];
  modelCatalogStatus?: ModelCatalogStatus;
  modelCatalogError?: string;
  onSelectModel?: (modelId: string) => void;
  onSelectReasoningEffort?: (effort?: OpenRouterReasoningEffort) => void;
  onRefreshModels?: () => void | Promise<void>;
  onCreateSchedule?: (input: CreateScheduledTaskInput) => Promise<void>;
  onSetSchedulePaused?: (task: ScheduledTask, paused: boolean) => Promise<void>;
  onDeleteSchedule?: (id: string) => Promise<void>;
  improvementSnapshot?: ImprovementSnapshot;
  improvementStatus?: ImprovementStoreStatus;
  improvementError?: string;
  onAddImprovementFeedback?: (
    trace: ImprovementTrace,
    rating: 1 | -1,
  ) => Promise<void>;
  onCreateImprovementCandidate?: (trace: ImprovementTrace) => Promise<void>;
  onEvaluateImprovementCandidate?: (
    candidate: ImprovementCandidate,
  ) => Promise<void>;
  onRequestImprovementPublication?: (
    candidate: ImprovementCandidate,
  ) => Promise<void>;
  onResolveImprovementPublication?: (
    candidate: ImprovementCandidate,
    approved: boolean,
  ) => Promise<void>;
  onRollbackImprovementCandidate?: (
    candidate: ImprovementCandidate,
  ) => Promise<void>;
  inventoryStatus?: InventoryStatus;
  inventoryError?: string;
  gitOverview?: GitOverview;
  plugins?: readonly PluginSummary[];
  onRefreshInventory?: () => void;
}

export interface AppMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

function subscribeToDarkMode(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function getDarkModeSnapshot() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function ThemeIcon({ theme }: { theme: AppTheme }) {
  if (theme === "light")
    return <Sun aria-hidden="true" size={16} weight="regular" />;
  if (theme === "dark")
    return <Moon aria-hidden="true" size={16} weight="regular" />;
  return <Desktop aria-hidden="true" size={16} weight="regular" />;
}

function startWindowDragging(event: MouseEvent<HTMLElement>) {
  if (event.button !== 0) return;
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest("button, input, textarea, select, [role=button]")
  ) {
    return;
  }
  void getCurrentWindow()
    .startDragging()
    .catch(() => undefined);
}

export function App({
  theme = "system",
  terminalPort,
  browserPort,
  workspaceName,
  workspacePath,
  workspaces = [],
  threads = [],
  activeThreadId,
  onNewTask,
  onSelectWorkspace,
  onSelectThread,
  onOpenSettings,
  onSubmit,
  onStop,
  onAttach,
  onApprove,
  onReject,
  onThemeChange,
  timelineItems = [],
  timelineState = "empty",
  errorMessage,
  assistantMessages = [],
  threadId,
  running = false,
  scheduledTasks = [],
  scheduleStatus = "idle",
  scheduleError,
  scheduleModel,
  scheduleReasoningEffort,
  models = [],
  modelCatalogStatus = "idle",
  modelCatalogError,
  onSelectModel,
  onSelectReasoningEffort,
  onRefreshModels,
  onCreateSchedule,
  onSetSchedulePaused,
  onDeleteSchedule,
  improvementSnapshot = { traces: [], candidates: [] },
  improvementStatus = "idle",
  improvementError,
  onAddImprovementFeedback,
  onCreateImprovementCandidate,
  onEvaluateImprovementCandidate,
  onRequestImprovementPublication,
  onResolveImprovementPublication,
  onRollbackImprovementCandidate,
  inventoryStatus = "idle",
  inventoryError,
  gitOverview,
  plugins = [],
  onRefreshInventory,
}: AppProps) {
  const systemDark = useSyncExternalStore(
    subscribeToDarkMode,
    getDarkModeSnapshot,
    () => true,
  );
  const resolvedTheme =
    theme === "system" ? (systemDark ? "dark" : "light") : theme;
  const [utilityOpen, setUtilityOpen] = useState(false);
  const [activeView, setActiveView] = useState<
    "conversation" | "schedule" | "improvement" | "pull-requests" | "plugins"
  >("conversation");
  const taskTitle = workspaceName ? `${workspaceName} 会话` : "新对话";

  return (
    <div
      className={`oa-app oa-workspace${resolvedTheme === "dark" ? " dark" : ""}`}
      data-theme={resolvedTheme}
    >
      <header className="oa-window-chrome" onMouseDown={startWindowDragging}>
        <div className="oa-window-chrome__sidebar">
          <div className="oa-window-chrome__navigation">
            <Button
              aria-label="后退"
              className="oa-icon-button"
              disabled
              size="icon"
              type="button"
              variant="ghost"
            >
              <ArrowLeft aria-hidden="true" size={15} weight="regular" />
            </Button>
            <Button
              aria-label="前进"
              className="oa-icon-button"
              disabled
              size="icon"
              type="button"
              variant="ghost"
            >
              <ArrowRight aria-hidden="true" size={15} weight="regular" />
            </Button>
          </div>
        </div>
        <div className="oa-window-chrome__main">
          <div className="oa-window-chrome__drag-area" data-tauri-drag-region>
            <div className="oa-workspace-topbar__title">
              <FolderSimple aria-hidden="true" size={16} weight="regular" />
              <span>{taskTitle}</span>
            </div>
          </div>
          <Button
            aria-label="更多任务操作"
            className="oa-icon-button"
            size="icon"
            type="button"
            variant="ghost"
          >
            <DotsThree aria-hidden="true" size={17} weight="bold" />
          </Button>
        </div>
        <div className="oa-workspace-topbar__actions">
          {onThemeChange ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="切换主题"
                className="oa-icon-button"
                title="切换主题"
              >
                <ThemeIcon theme={theme} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="oa-theme-menu">
                <DropdownMenuRadioGroup
                  onValueChange={(value) => onThemeChange(value as AppTheme)}
                  value={theme}
                >
                  <DropdownMenuRadioItem value="system">
                    <Desktop aria-hidden="true" size={14} weight="regular" />
                    跟随系统
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="light">
                    <Sun aria-hidden="true" size={14} weight="regular" />
                    浅色
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark">
                    <Moon aria-hidden="true" size={14} weight="regular" />
                    深色
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Button
            aria-label="会话选项"
            className="oa-icon-button"
            size="icon"
            type="button"
            variant="ghost"
          >
            <SlidersHorizontal aria-hidden="true" size={16} weight="regular" />
          </Button>
          <Button
            aria-label={utilityOpen ? "关闭工具面板" : "打开工具面板"}
            className={`oa-icon-button${utilityOpen ? " is-active" : ""}`}
            onClick={() => setUtilityOpen((open) => !open)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <SidebarSimple aria-hidden="true" size={16} weight="regular" />
          </Button>
        </div>
      </header>

      <div className="oa-window-content">
        <WorkspaceSidebar
          onNewTask={() => {
            setActiveView("conversation");
            onNewTask?.();
          }}
          onOpenSettings={onOpenSettings}
          onOpenSchedules={() => setActiveView("schedule")}
          onOpenImprovement={() => setActiveView("improvement")}
          onOpenPullRequests={() => setActiveView("pull-requests")}
          onOpenPlugins={() => setActiveView("plugins")}
          activeThreadId={activeThreadId}
          onSelectThread={onSelectThread}
          onSelectWorkspace={onSelectWorkspace}
          threads={threads}
          workspaces={workspaces}
          workspaceName={workspaceName}
          workspacePath={workspacePath}
        />

        <main className="oa-workspace-main">
          {activeView === "schedule" &&
          onCreateSchedule &&
          onSetSchedulePaused &&
          onDeleteSchedule ? (
            <ScheduleView
              error={scheduleError}
              model={scheduleModel}
              reasoningEffort={scheduleReasoningEffort}
              onCreate={onCreateSchedule}
              onDelete={onDeleteSchedule}
              onSetPaused={onSetSchedulePaused}
              status={scheduleStatus}
              tasks={scheduledTasks}
              threadId={threadId}
              workspacePath={workspacePath}
            />
          ) : activeView === "improvement" &&
            onAddImprovementFeedback &&
            onCreateImprovementCandidate &&
            onEvaluateImprovementCandidate &&
            onRequestImprovementPublication &&
            onResolveImprovementPublication &&
            onRollbackImprovementCandidate ? (
            <ImprovementView
              error={improvementError}
              onCreateCandidate={onCreateImprovementCandidate}
              onEvaluate={onEvaluateImprovementCandidate}
              onFeedback={onAddImprovementFeedback}
              onRequestPublication={onRequestImprovementPublication}
              onResolvePublication={onResolveImprovementPublication}
              onRollback={onRollbackImprovementCandidate}
              snapshot={improvementSnapshot}
              status={improvementStatus}
            />
          ) : activeView === "pull-requests" ? (
            <PullRequestsView
              error={inventoryError}
              onRefresh={onRefreshInventory}
              overview={gitOverview}
              status={inventoryStatus}
            />
          ) : activeView === "plugins" ? (
            <PluginsView
              error={inventoryError}
              onRefresh={onRefreshInventory}
              plugins={plugins}
              status={inventoryStatus}
            />
          ) : (
            <section
              className="oa-workspace-conversation"
              aria-label={threadId ? `会话 ${threadId}` : "当前会话"}
            >
              <div className="oa-workspace-scroll">
                {errorMessage ? (
                  <div className="oa-session-error" role="alert">
                    {errorMessage}
                  </div>
                ) : null}

                {assistantMessages.length ? (
                  <div aria-label="对话记录" className="oa-conversation">
                    {assistantMessages.map((message) => (
                      <article
                        className={`oa-message oa-message--${message.role}`}
                        key={message.id}
                      >
                        {message.role === "assistant" ? (
                          <div className="oa-message__body oa-message__body--markdown">
                            <Markdown
                              fullFeaturedCodeBlock={false}
                              variant="chat"
                            >
                              {message.text || (running ? "正在思考…" : "")}
                            </Markdown>
                          </div>
                        ) : (
                          <div className="oa-message__body">{message.text}</div>
                        )}
                      </article>
                    ))}
                  </div>
                ) : null}

                {timelineItems.some((item) => item.kind !== "reasoning") ? (
                  <section
                    className="oa-timeline-showcase"
                    aria-label="执行记录"
                  >
                    <ToolTimeline
                      items={timelineItems}
                      onApprove={onApprove}
                      onReject={onReject}
                      state={timelineState}
                      theme={resolvedTheme}
                    />
                  </section>
                ) : null}
              </div>

              {running ? (
                <div className="oa-run-status" role="status">
                  <i aria-hidden="true" />
                  <span>正在工作</span>
                  <span className="oa-run-status__count">
                    {timelineItems.length} 项更新
                  </span>
                </div>
              ) : null}

              <div className="oa-workspace-composer">
                <Composer
                  model={scheduleModel}
                  modelCatalogError={modelCatalogError}
                  modelCatalogStatus={modelCatalogStatus}
                  models={models}
                  onAttach={onAttach}
                  onRefreshModels={onRefreshModels}
                  onSelectModel={onSelectModel}
                  onSelectReasoningEffort={onSelectReasoningEffort}
                  onStop={onStop}
                  onSubmit={onSubmit}
                  reasoningEffort={scheduleReasoningEffort}
                  running={running}
                />
              </div>
            </section>
          )}
        </main>

        {utilityOpen ? (
          <aside className="oa-utility-drawer" aria-label="工具面板">
            <RightUtilityPanel
              browserPort={browserPort}
              terminalPort={terminalPort}
              theme={resolvedTheme}
            />
          </aside>
        ) : null}
      </div>
    </div>
  );
}

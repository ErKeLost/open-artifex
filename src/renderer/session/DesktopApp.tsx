import { useEffect, useState } from "react";
import { ThemeProvider } from "@lobehub/ui";
import { App } from "../App";
import { useScheduleStore } from "../features/schedule";
import { useInventoryStore } from "../features/inventory";
import { SettingsDialog } from "../features/settings";
import { TooltipProvider } from "../components/ui/tooltip";
import { useAppSessionStore, useSessionTimeline } from "./session-store";

export function DesktopApp() {
  const initialize = useAppSessionStore((state) => state.initialize);
  const status = useAppSessionStore((state) => state.status);
  const error = useAppSessionStore((state) => state.error);
  const appInfo = useAppSessionStore((state) => state.appInfo);
  const credentials = useAppSessionStore((state) => state.credentials);
  const workspace = useAppSessionStore((state) => state.workspace);
  const workspaces = useAppSessionStore((state) => state.workspaces);
  const threadId = useAppSessionStore((state) => state.threadId);
  const runId = useAppSessionStore((state) => state.runId);
  const messages = useAppSessionStore((state) => state.messages);
  const themeMode = useAppSessionStore((state) => state.themeMode);
  const models = useAppSessionStore((state) => state.models);
  const modelCatalogStatus = useAppSessionStore(
    (state) => state.modelCatalogStatus,
  );
  const modelCatalogError = useAppSessionStore(
    (state) => state.modelCatalogError,
  );
  const selectedModel = useAppSessionStore((state) => state.selectedModel);
  const selectedReasoningEffort = useAppSessionStore(
    (state) => state.selectedReasoningEffort,
  );
  const terminalPort = useAppSessionStore((state) => state.terminalPort);
  const browserPort = useAppSessionStore((state) => state.browserPort);
  const submit = useAppSessionStore((state) => state.submit);
  const stop = useAppSessionStore((state) => state.stop);
  const approve = useAppSessionStore((state) => state.approve);
  const reject = useAppSessionStore((state) => state.reject);
  const selectWorkspace = useAppSessionStore((state) => state.selectWorkspace);
  const newTask = useAppSessionStore((state) => state.newTask);
  const selectThread = useAppSessionStore((state) => state.selectThread);
  const threads = useAppSessionStore((state) => state.threads);
  const setThemeMode = useAppSessionStore((state) => state.setThemeMode);
  const refreshModels = useAppSessionStore((state) => state.refreshModels);
  const setModel = useAppSessionStore((state) => state.setModel);
  const setReasoningEffort = useAppSessionStore(
    (state) => state.setReasoningEffort,
  );
  const refreshConversations = useAppSessionStore(
    (state) => state.refreshConversations,
  );
  const setOpenRouterKey = useAppSessionStore(
    (state) => state.setOpenRouterKey,
  );
  const clearOpenRouterKey = useAppSessionStore(
    (state) => state.clearOpenRouterKey,
  );
  const items = useSessionTimeline();
  const scheduleStatus = useScheduleStore((state) => state.status);
  const scheduleError = useScheduleStore((state) => state.error);
  const scheduledTasks = useScheduleStore((state) => state.tasks);
  const initializeSchedules = useScheduleStore((state) => state.initialize);
  const refreshSchedules = useScheduleStore((state) => state.refresh);
  const createSchedule = useScheduleStore((state) => state.create);
  const setSchedulePaused = useScheduleStore((state) => state.setPaused);
  const deleteSchedule = useScheduleStore((state) => state.remove);
  const inventoryStatus = useInventoryStore((state) => state.status);
  const inventoryError = useInventoryStore((state) => state.error);
  const gitOverview = useInventoryStore((state) => state.overview);
  const plugins = useInventoryStore((state) => state.plugins);
  const refreshInventory = useInventoryStore((state) => state.refresh);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    if (!workspace) return;
    void refreshInventory(workspace.path);
  }, [refreshInventory, workspace]);

  useEffect(() => {
    if (!workspace || !credentials?.configured) return;
    const scope = {
      workspacePath: workspace.path,
      model: selectedModel ?? appInfo?.defaultModel,
      reasoningEffort: selectedReasoningEffort,
    };
    void initializeSchedules(scope);
    const interval = window.setInterval(() => {
      void refreshSchedules(scope);
      void refreshConversations();
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [
    credentials?.configured,
    initializeSchedules,
    refreshConversations,
    refreshSchedules,
    selectedModel,
    selectedReasoningEffort,
    workspace,
  ]);

  return (
    <TooltipProvider>
      <ThemeProvider
        defaultThemeMode={themeMode === "system" ? "auto" : themeMode}
        enableCustomFonts={false}
        enableGlobalStyle={false}
        themeMode={themeMode === "system" ? "auto" : themeMode}
        onThemeModeChange={(mode) =>
          setThemeMode(mode === "auto" ? "system" : mode)
        }
      >
        <App
          activeThreadId={threadId}
          assistantMessages={messages}
          browserPort={browserPort}
          errorMessage={error}
          onApprove={approve}
          onOpenSettings={() => setSettingsOpen(true)}
          onNewTask={() => void newTask()}
          onReject={reject}
          onSelectWorkspace={(path) => void selectWorkspace(path)}
          onSelectThread={(threadId) => void selectThread(threadId)}
          onStop={() => void stop()}
          onSubmit={submit}
          onThemeChange={setThemeMode}
          running={Boolean(runId)}
          scheduleError={scheduleError}
          scheduleModel={selectedModel ?? appInfo?.defaultModel}
          scheduleReasoningEffort={selectedReasoningEffort}
          models={models}
          modelCatalogStatus={modelCatalogStatus}
          modelCatalogError={modelCatalogError}
          onRefreshModels={refreshModels}
          onSelectModel={setModel}
          onSelectReasoningEffort={setReasoningEffort}
          scheduledTasks={scheduledTasks}
          scheduleStatus={scheduleStatus}
          onCreateSchedule={createSchedule}
          onDeleteSchedule={deleteSchedule}
          onSetSchedulePaused={setSchedulePaused}
          gitOverview={gitOverview}
          inventoryError={inventoryError}
          inventoryStatus={inventoryStatus}
          onRefreshInventory={
            workspace ? () => void refreshInventory(workspace.path) : undefined
          }
          plugins={plugins}
          terminalPort={terminalPort}
          theme={themeMode}
          threadId={threadId}
          timelineItems={items}
          timelineState={
            status === "error"
              ? "error"
              : runId && items.length === 0
                ? "loading"
                : items.length
                  ? "ready"
                  : "empty"
          }
          workspaceName={workspace?.name ?? appInfo?.name}
          workspacePath={workspace?.path}
          workspaces={workspaces}
          threads={threads}
        />
        <SettingsDialog
          credentials={credentials}
          onClear={clearOpenRouterKey}
          onClose={() => setSettingsOpen(false)}
          onSave={setOpenRouterKey}
          open={settingsOpen}
        />
      </ThemeProvider>
    </TooltipProvider>
  );
}

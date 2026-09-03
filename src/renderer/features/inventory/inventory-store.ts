import { create } from "zustand";
import type {
  GitOverview,
  PluginSummary,
} from "../../../shared/desktop-api.js";

export type InventoryStatus = "idle" | "loading" | "ready" | "error";

interface InventoryStore {
  status: InventoryStatus;
  error?: string;
  overview?: GitOverview;
  plugins: PluginSummary[];
  refresh(workspacePath: string): Promise<void>;
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

export const useInventoryStore = create<InventoryStore>((set) => ({
  status: "idle",
  plugins: [],

  async refresh(workspacePath) {
    set({ status: "loading", error: undefined });
    try {
      const [overviewResult, pluginsResult] = await Promise.all([
        api().workspace.getGitOverview({ workspacePath }),
        api().workspace.listPlugins({ workspacePath }),
      ]);
      set({
        status: "ready",
        overview: resultValue(overviewResult),
        plugins: resultValue(pluginsResult),
      });
    } catch (error) {
      set({
        status: "error",
        error: error instanceof Error ? error.message : "工作区数据加载失败",
      });
    }
  },
}));

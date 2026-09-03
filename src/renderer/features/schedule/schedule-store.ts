import { create } from "zustand";
import type {
  CreateScheduledTaskInput,
  ScheduledTaskScope,
  ScheduledTask,
} from "../../../shared/schedule-protocol.js";

export type ScheduleStoreStatus = "idle" | "loading" | "ready" | "error";

interface ScheduleStore {
  status: ScheduleStoreStatus;
  error?: string;
  tasks: ScheduledTask[];
  initialize(scope: ScheduledTaskScope): Promise<void>;
  refresh(scope: ScheduledTaskScope): Promise<void>;
  create(input: CreateScheduledTaskInput): Promise<void>;
  setPaused(task: ScheduledTask, paused: boolean): Promise<void>;
  remove(id: string): Promise<void>;
}

function api() {
  if (typeof window === "undefined" || !window.openArtifex) {
    throw new Error("桌面 API 尚未连接");
  }
  return window.openArtifex;
}

function requireValue<Value>(
  result:
    { ok: true; value: Value } | { ok: false; error: { message: string } },
): Value {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function sortTasks(tasks: ScheduledTask[]): ScheduledTask[] {
  return [...tasks].sort((left, right) => left.nextRunAt - right.nextRunAt);
}

let initialization: Promise<void> | undefined;

export const useScheduleStore = create<ScheduleStore>((set) => ({
  status: "idle",
  tasks: [],

  async initialize(scope) {
    if (initialization) return initialization;
    initialization = (async () => {
      set({ status: "loading", error: undefined });
      try {
        const desktopApi = api();
        const tasks = requireValue(await desktopApi.schedule.list(scope));
        set({ status: "ready", tasks: sortTasks(tasks) });
      } catch (error) {
        set({
          status: "error",
          error: error instanceof Error ? error.message : "定时任务加载失败",
        });
      } finally {
        initialization = undefined;
      }
    })();
    return initialization;
  },

  async refresh(scope) {
    const tasks = requireValue(await api().schedule.list(scope));
    set({ status: "ready", error: undefined, tasks: sortTasks(tasks) });
  },

  async create(input) {
    const task = requireValue(await api().schedule.create(input));
    set((state) => ({ tasks: sortTasks([...state.tasks, task]) }));
  },

  async setPaused(task, paused) {
    const updated = requireValue(
      await api().schedule.update({
        id: task.id,
        status: paused ? "paused" : "active",
        workspacePath: task.workspacePath,
        model: task.model,
        reasoningEffort: task.reasoningEffort,
      }),
    );
    set((state) => ({
      tasks: sortTasks(
        state.tasks.map((current) =>
          current.id === updated.id ? updated : current,
        ),
      ),
    }));
  },

  async remove(id) {
    const task = useScheduleStore
      .getState()
      .tasks.find((current) => current.id === id);
    if (!task) return;
    requireValue(
      await api().schedule.delete({
        id,
        workspacePath: task.workspacePath,
        model: task.model,
        reasoningEffort: task.reasoningEffort,
      }),
    );
    set((state) => ({ tasks: state.tasks.filter((task) => task.id !== id) }));
  },
}));

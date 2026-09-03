import { CalendarDots, Pause, Play, Plus, Trash } from "@phosphor-icons/react";
import { useMemo, useState, type FormEvent } from "react";
import type {
  CreateScheduledTaskInput,
  ScheduledTask,
} from "../../../shared/schedule-protocol.js";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import "./schedule.css";

export interface ScheduleViewProps {
  tasks: readonly ScheduledTask[];
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
  workspacePath?: string;
  threadId?: string;
  model?: string;
  reasoningEffort?: string;
  onCreate: (input: CreateScheduledTaskInput) => Promise<void>;
  onSetPaused: (task: ScheduledTask, paused: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const cadenceLabels = {
  once: "仅一次",
  daily: "每天",
  weekly: "每周",
} as const;

function localDateTimeValue(timestamp: number) {
  const date = new Date(timestamp - new Date().getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

function describeNextRun(task: ScheduledTask) {
  if (task.status === "completed") return "已完成";
  if (task.status === "paused") return "已暂停";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(task.nextRunAt);
}

export function ScheduleView({
  tasks,
  status,
  error,
  workspacePath,
  threadId,
  model,
  reasoningEffort,
  onCreate,
  onSetPaused,
  onDelete,
}: ScheduleViewProps) {
  const defaultRunAt = useMemo(
    () => localDateTimeValue(Date.now() + 60 * 60 * 1_000),
    [],
  );
  const [prompt, setPrompt] = useState("");
  const [cadence, setCadence] =
    useState<CreateScheduledTaskInput["cadence"]>("once");
  const [runAt, setRunAt] = useState(defaultRunAt);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!workspacePath || !threadId || !prompt.trim() || submitting) return;
    const timestamp = new Date(runAt).getTime();
    if (!Number.isFinite(timestamp)) {
      setActionError("请选择执行时间");
      return;
    }
    setSubmitting(true);
    setActionError(undefined);
    try {
      await onCreate({
        prompt: prompt.trim(),
        workspacePath,
        threadId,
        model,
        reasoningEffort,
        cadence,
        runAt: timestamp,
      });
      setPrompt("");
      setCadence("once");
      setRunAt(localDateTimeValue(Date.now() + 60 * 60 * 1_000));
    } catch (createError) {
      setActionError(
        createError instanceof Error ? createError.message : "创建定时任务失败",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="oa-schedule" aria-label="定时任务">
      <div className="oa-schedule__content">
        <header className="oa-schedule__header">
          <CalendarDots aria-hidden="true" size={18} weight="regular" />
          <div>
            <h1>定时任务</h1>
            <p>在指定时间于当前工作区执行任务。</p>
          </div>
        </header>

        <form className="oa-schedule-form" onSubmit={submit}>
          <label>
            <span>任务内容</span>
            <Textarea
              disabled={!workspacePath || !threadId || submitting}
              onChange={(event) => setPrompt(event.currentTarget.value)}
              placeholder="例如：检查未提交的改动并生成摘要"
              rows={3}
              value={prompt}
            />
          </label>
          <div className="oa-schedule-form__row">
            <label>
              <span>执行时间</span>
              <Input
                disabled={!workspacePath || !threadId || submitting}
                min={localDateTimeValue(Date.now())}
                onChange={(event) => setRunAt(event.currentTarget.value)}
                type="datetime-local"
                value={runAt}
              />
            </label>
            <label>
              <span>重复</span>
              <Select
                disabled={!workspacePath || !threadId || submitting}
                onValueChange={(value) =>
                  setCadence(value as CreateScheduledTaskInput["cadence"])
                }
                value={cadence}
              >
                <SelectTrigger className="oa-schedule-form__select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(cadenceLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <Button
              aria-label="创建定时任务"
              className="oa-schedule-form__submit"
              disabled={
                !workspacePath || !threadId || !prompt.trim() || submitting
              }
              size="default"
              type="submit"
              variant="default"
            >
              <Plus aria-hidden="true" size={16} weight="bold" />
              <span>{submitting ? "创建中" : "创建"}</span>
            </Button>
          </div>
          {actionError ? (
            <p className="oa-schedule__error">{actionError}</p>
          ) : null}
        </form>

        <div className="oa-schedule__list" aria-live="polite">
          {status === "loading" ? (
            <p className="oa-schedule__muted">正在加载定时任务</p>
          ) : null}
          {status === "error" ? (
            <p className="oa-schedule__error">{error}</p>
          ) : null}
          {status === "ready" && tasks.length === 0 ? (
            <p className="oa-schedule__muted">还没有定时任务</p>
          ) : null}
          {tasks.map((task) => (
            <article className="oa-schedule-task" key={task.id}>
              <div className="oa-schedule-task__copy">
                <p>{task.prompt}</p>
                <span>
                  {cadenceLabels[task.cadence]} - {describeNextRun(task)}
                </span>
                {task.lastError ? (
                  <span className="oa-schedule__error">{task.lastError}</span>
                ) : null}
              </div>
              <div className="oa-schedule-task__actions">
                {task.status !== "completed" ? (
                  <Button
                    aria-label={
                      task.status === "paused" ? "恢复任务" : "暂停任务"
                    }
                    onClick={() =>
                      void onSetPaused(task, task.status !== "paused")
                    }
                    title={task.status === "paused" ? "恢复任务" : "暂停任务"}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    {task.status === "paused" ? (
                      <Play aria-hidden="true" size={15} weight="fill" />
                    ) : (
                      <Pause aria-hidden="true" size={15} weight="fill" />
                    )}
                  </Button>
                ) : null}
                <Button
                  aria-label="删除任务"
                  onClick={() => void onDelete(task.id)}
                  title="删除任务"
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Trash aria-hidden="true" size={15} weight="regular" />
                </Button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

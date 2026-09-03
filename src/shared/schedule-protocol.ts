export const SCHEDULE_CADENCES = ["once", "daily", "weekly"] as const;
export type ScheduleCadence = (typeof SCHEDULE_CADENCES)[number];

export const SCHEDULE_STATUSES = ["active", "paused", "completed"] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export interface ScheduledTask {
  id: string;
  prompt: string;
  workspacePath: string;
  threadId: string;
  model?: string;
  reasoningEffort?: string;
  cadence: ScheduleCadence;
  status: ScheduleStatus;
  createdAt: number;
  nextRunAt: number;
  lastRunAt?: number;
  lastError?: string;
}

export interface CreateScheduledTaskInput {
  prompt: string;
  workspacePath: string;
  threadId: string;
  model?: string;
  reasoningEffort?: string;
  cadence: ScheduleCadence;
  runAt: number;
}

export interface UpdateScheduledTaskInput {
  id: string;
  status: Extract<ScheduleStatus, "active" | "paused">;
  workspacePath: string;
  model?: string;
  reasoningEffort?: string;
}

export interface ScheduledTaskScope {
  workspacePath: string;
  model?: string;
  reasoningEffort?: string;
}

const MAX_ID_LENGTH = 256;
const MAX_PROMPT_LENGTH = 12_000;
const MAX_PATH_LENGTH = 16_384;
const MAX_MODEL_LENGTH = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function isTimestamp(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= 9_223_372_036_854
  );
}

function isCadence(value: unknown): value is ScheduleCadence {
  return (
    typeof value === "string" &&
    SCHEDULE_CADENCES.includes(value as ScheduleCadence)
  );
}

function isStatus(value: unknown): value is ScheduleStatus {
  return (
    typeof value === "string" &&
    SCHEDULE_STATUSES.includes(value as ScheduleStatus)
  );
}

export function isScheduledTask(value: unknown): value is ScheduledTask {
  if (!isRecord(value)) return false;
  return (
    isId(value.id) &&
    typeof value.prompt === "string" &&
    value.prompt.trim().length > 0 &&
    value.prompt.length <= MAX_PROMPT_LENGTH &&
    typeof value.workspacePath === "string" &&
    value.workspacePath.length > 0 &&
    value.workspacePath.length <= MAX_PATH_LENGTH &&
    isId(value.threadId) &&
    (value.model === undefined ||
      (typeof value.model === "string" &&
        value.model.length <= MAX_MODEL_LENGTH)) &&
    (value.reasoningEffort === undefined ||
      (typeof value.reasoningEffort === "string" &&
        value.reasoningEffort.length <= 32)) &&
    isCadence(value.cadence) &&
    isStatus(value.status) &&
    isTimestamp(value.createdAt) &&
    isTimestamp(value.nextRunAt) &&
    (value.lastRunAt === undefined || isTimestamp(value.lastRunAt)) &&
    (value.lastError === undefined ||
      (typeof value.lastError === "string" &&
        value.lastError.length <= MAX_PROMPT_LENGTH))
  );
}

export function isCreateScheduledTaskInput(
  value: unknown,
): value is CreateScheduledTaskInput {
  if (!isRecord(value)) return false;
  return (
    typeof value.prompt === "string" &&
    value.prompt.trim().length > 0 &&
    value.prompt.length <= MAX_PROMPT_LENGTH &&
    typeof value.workspacePath === "string" &&
    value.workspacePath.length > 0 &&
    value.workspacePath.length <= MAX_PATH_LENGTH &&
    isId(value.threadId) &&
    (value.model === undefined ||
      (typeof value.model === "string" &&
        value.model.length <= MAX_MODEL_LENGTH)) &&
    (value.reasoningEffort === undefined ||
      (typeof value.reasoningEffort === "string" &&
        value.reasoningEffort.length <= 32)) &&
    isCadence(value.cadence) &&
    isTimestamp(value.runAt)
  );
}

export function isUpdateScheduledTaskInput(
  value: unknown,
): value is UpdateScheduledTaskInput {
  return (
    isRecord(value) &&
    isId(value.id) &&
    (value.status === "active" || value.status === "paused") &&
    typeof value.workspacePath === "string" &&
    value.workspacePath.length > 0 &&
    value.workspacePath.length <= MAX_PATH_LENGTH &&
    (value.model === undefined ||
      (typeof value.model === "string" &&
        value.model.length <= MAX_MODEL_LENGTH)) &&
    (value.reasoningEffort === undefined ||
      (typeof value.reasoningEffort === "string" &&
        value.reasoningEffort.length <= 32))
  );
}

/**
 * Structured-clone-safe browser contracts shared by the Tauri bridge, agent
 * host, and renderer. Browser preview frames are ephemeral and
 * are never persisted as Mastra messages.
 */

export const BROWSER_PROTOCOL_VERSION = 1 as const;

export type BrowserConnectionStatus = "idle" | "connecting" | "ready" | "error";

export interface BrowserSessionState {
  status: BrowserConnectionStatus;
  url?: string;
  title?: string;
  loading?: boolean;
  canGoBack?: boolean;
  canGoForward?: boolean;
  error?: string;
}

export interface BrowserModifiers {
  alt: boolean;
  control: boolean;
  meta: boolean;
  shift: boolean;
}

export interface BrowserFrame {
  id: string;
  data: string;
  mimeType: "image/jpeg" | "image/png";
  width: number;
  height: number;
  timestamp: number;
}

export interface BrowserSessionRequest {
  threadId: string;
  workspacePath: string;
  model: string;
  reasoningEffort?: string;
  provider: {
    kind: "openrouter";
    apiKey: string;
    model: string;
  };
}

export interface BrowserMouseAction extends BrowserModifiers {
  type: "move" | "down" | "up" | "wheel";
  x: number;
  y: number;
  button?: number;
  deltaX?: number;
  deltaY?: number;
}

export interface BrowserKeyAction extends BrowserModifiers {
  type: "down" | "up";
  key: string;
  code: string;
  repeat: boolean;
}

export type BrowserCommand =
  | {
      type: "state";
      request: BrowserSessionRequest;
    }
  | {
      type: "start";
      request: BrowserSessionRequest;
    }
  | {
      type: "navigate";
      request: BrowserSessionRequest;
      url: string;
    }
  | {
      type: "back";
      request: BrowserSessionRequest;
    }
  | {
      type: "forward";
      request: BrowserSessionRequest;
    }
  | {
      type: "reload";
      request: BrowserSessionRequest;
    }
  | {
      type: "mouse";
      request: BrowserSessionRequest;
      action: BrowserMouseAction;
    }
  | {
      type: "key";
      request: BrowserSessionRequest;
      action: BrowserKeyAction;
    }
  | {
      type: "close";
      request: BrowserSessionRequest;
    };

export interface BrowserCommandEnvelope {
  version: typeof BROWSER_PROTOCOL_VERSION;
  requestId: string;
  command: BrowserCommand;
}

export interface BrowserCommandError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface BrowserCommandResponse {
  version: typeof BROWSER_PROTOCOL_VERSION;
  requestId: string;
  threadId: string;
  ok: boolean;
  state?: BrowserSessionState;
  error?: BrowserCommandError;
}

export type BrowserEvent =
  | {
      type: "state";
      threadId: string;
      state: BrowserSessionState;
      timestamp: number;
    }
  | {
      type: "frame";
      threadId: string;
      frame: BrowserFrame;
    }
  | {
      type: "error";
      threadId: string;
      error: BrowserCommandError;
      timestamp: number;
    };

export interface BrowserEventEnvelope {
  version: typeof BROWSER_PROTOCOL_VERSION;
  type: "browser.event";
  event: BrowserEvent;
}

const MAX_ID_LENGTH = 256;
const MAX_PATH_LENGTH = 16_384;
const MAX_MODEL_LENGTH = 256;
const MAX_KEY_LENGTH = 16_384;
const MAX_URL_LENGTH = 16_384;
const MAX_KEY_VALUE_LENGTH = 512;
const MAX_FRAME_DIMENSION = 16_384;
const MAX_FRAME_DATA_LENGTH = 8 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= maxLength
  );
}

function isFiniteNumber(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}

function isFiniteInteger(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return (
    Number.isSafeInteger(value) &&
    typeof value === "number" &&
    value >= min &&
    value <= max
  );
}

export function isBrowserSessionRequest(
  value: unknown,
): value is BrowserSessionRequest {
  if (!isRecord(value) || !isRecord(value.provider)) return false;
  return (
    isBoundedString(value.threadId, MAX_ID_LENGTH) &&
    isBoundedString(value.workspacePath, MAX_PATH_LENGTH) &&
    isBoundedString(value.model, MAX_MODEL_LENGTH) &&
    (value.reasoningEffort === undefined ||
      isBoundedString(value.reasoningEffort, 32)) &&
    value.provider.kind === "openrouter" &&
    isBoundedString(value.provider.apiKey, MAX_KEY_LENGTH) &&
    isBoundedString(value.provider.model, MAX_MODEL_LENGTH)
  );
}

export function isBrowserMouseAction(
  value: unknown,
): value is BrowserMouseAction {
  if (!isRecord(value) || !isBoundedString(value.type, 16)) return false;
  if (
    value.type !== "move" &&
    value.type !== "down" &&
    value.type !== "up" &&
    value.type !== "wheel"
  ) {
    return false;
  }
  if (
    !isFiniteNumber(value.x, 0, MAX_FRAME_DIMENSION) ||
    !isFiniteNumber(value.y, 0, MAX_FRAME_DIMENSION) ||
    typeof value.alt !== "boolean" ||
    typeof value.control !== "boolean" ||
    typeof value.meta !== "boolean" ||
    typeof value.shift !== "boolean"
  ) {
    return false;
  }
  if (value.type !== "wheel" && !isFiniteInteger(value.button ?? 0, 0, 8))
    return false;
  if (value.type === "wheel") {
    if (
      !isFiniteNumber(value.deltaX ?? 0, -1_000_000, 1_000_000) ||
      !isFiniteNumber(value.deltaY ?? 0, -1_000_000, 1_000_000)
    ) {
      return false;
    }
  }
  return true;
}

export function isBrowserKeyAction(value: unknown): value is BrowserKeyAction {
  if (!isRecord(value)) return false;
  return (
    (value.type === "down" || value.type === "up") &&
    isBoundedString(value.key, MAX_KEY_VALUE_LENGTH) &&
    isBoundedString(value.code, MAX_KEY_VALUE_LENGTH) &&
    typeof value.repeat === "boolean" &&
    typeof value.alt === "boolean" &&
    typeof value.control === "boolean" &&
    typeof value.meta === "boolean" &&
    typeof value.shift === "boolean"
  );
}

export function isBrowserCommand(value: unknown): value is BrowserCommand {
  if (!isRecord(value) || !isBrowserSessionRequest(value.request)) return false;
  switch (value.type) {
    case "state":
    case "start":
    case "back":
    case "forward":
    case "reload":
    case "close":
      return true;
    case "navigate":
      return isBoundedString(value.url, MAX_URL_LENGTH);
    case "mouse":
      return isBrowserMouseAction(value.action);
    case "key":
      return isBrowserKeyAction(value.action);
    default:
      return false;
  }
}

export function isBrowserCommandEnvelope(
  value: unknown,
): value is BrowserCommandEnvelope {
  return (
    isRecord(value) &&
    value.version === BROWSER_PROTOCOL_VERSION &&
    isBoundedString(value.requestId, MAX_ID_LENGTH) &&
    isBrowserCommand(value.command)
  );
}

export function isBrowserSessionState(
  value: unknown,
): value is BrowserSessionState {
  if (!isRecord(value) || typeof value.status !== "string") return false;
  if (
    !(["idle", "connecting", "ready", "error"] as string[]).includes(
      value.status,
    )
  ) {
    return false;
  }
  return (
    (value.url === undefined || typeof value.url === "string") &&
    (value.title === undefined || typeof value.title === "string") &&
    (value.loading === undefined || typeof value.loading === "boolean") &&
    (value.canGoBack === undefined || typeof value.canGoBack === "boolean") &&
    (value.canGoForward === undefined ||
      typeof value.canGoForward === "boolean") &&
    (value.error === undefined || typeof value.error === "string")
  );
}

export function isBrowserEvent(value: unknown): value is BrowserEvent {
  if (!isRecord(value) || !isBoundedString(value.threadId, MAX_ID_LENGTH))
    return false;
  if (value.type === "state") {
    return (
      isBrowserSessionState(value.state) &&
      typeof value.timestamp === "number" &&
      Number.isFinite(value.timestamp)
    );
  }
  if (value.type === "error") {
    return (
      isRecord(value.error) &&
      isBoundedString(value.error.code, MAX_ID_LENGTH) &&
      isBoundedString(value.error.message, MAX_KEY_VALUE_LENGTH * 16) &&
      typeof value.error.retryable === "boolean" &&
      typeof value.timestamp === "number" &&
      Number.isFinite(value.timestamp)
    );
  }
  if (value.type !== "frame" || !isRecord(value.frame)) return false;
  return (
    isBoundedString(value.frame.id, MAX_ID_LENGTH) &&
    typeof value.frame.data === "string" &&
    value.frame.data.length <= MAX_FRAME_DATA_LENGTH &&
    (value.frame.mimeType === "image/jpeg" ||
      value.frame.mimeType === "image/png") &&
    isFiniteInteger(value.frame.width, 1, MAX_FRAME_DIMENSION) &&
    isFiniteInteger(value.frame.height, 1, MAX_FRAME_DIMENSION) &&
    typeof value.frame.timestamp === "number" &&
    Number.isFinite(value.frame.timestamp)
  );
}

export function isBrowserEventEnvelope(
  value: unknown,
): value is BrowserEventEnvelope {
  return (
    isRecord(value) &&
    value.version === BROWSER_PROTOCOL_VERSION &&
    value.type === "browser.event" &&
    isBrowserEvent(value.event)
  );
}

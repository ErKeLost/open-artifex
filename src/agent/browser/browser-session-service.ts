import { randomUUID } from "node:crypto";

import type {
  KeyboardEventParams,
  MouseEventParams,
  ScreencastStream,
} from "@mastra/core/browser";
import { AgentBrowser } from "@mastra/agent-browser";

import type {
  BrowserCommand,
  BrowserEvent,
  BrowserFrame,
  BrowserKeyAction,
  BrowserMouseAction,
  BrowserSessionState,
} from "../../shared/browser-protocol.js";

/**
 * Events emitted by the service are intentionally separate from the agent
 * timeline. Frames are latest-state UI data and must not be persisted as chat
 * messages.
 */
export type BrowserSessionEvent = BrowserEvent;

export interface BrowserSessionServiceOptions {
  streamFormat?: "jpeg" | "png";
  streamQuality?: number;
  streamMaxWidth?: number;
  streamMaxHeight?: number;
  streamEveryNthFrame?: number;
}

/**
 * Owns thread-scoped browser lifecycle and serializes input per thread. The
 * service depends on the Mastra browser interface, so it can be reused by
 * AgentBrowser and a future Stagehand adapter without leaking provider objects
 * across the Tauri agent-process boundary.
 */
export class BrowserSessionService {
  readonly #browser: AgentBrowser;
  readonly #options: Required<BrowserSessionServiceOptions>;
  readonly #streams = new Map<string, ScreencastStream>();
  readonly #queues = new Map<string, Promise<unknown>>();
  readonly #listeners = new Set<(event: BrowserSessionEvent) => void>();
  readonly #states = new Map<string, BrowserSessionState>();

  constructor(browser: AgentBrowser, options: BrowserSessionServiceOptions = {}) {
    this.#browser = browser;
    this.#options = {
      streamFormat: options.streamFormat ?? "jpeg",
      streamQuality: options.streamQuality ?? 65,
      streamMaxWidth: options.streamMaxWidth ?? 1280,
      streamMaxHeight: options.streamMaxHeight ?? 800,
      streamEveryNthFrame: options.streamEveryNthFrame ?? 2,
    };
  }

  onEvent(listener: (event: BrowserSessionEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Return state without launching a browser or creating a thread session. */
  async getState(threadId: string): Promise<BrowserSessionState> {
    assertThreadId(threadId);
    const cached = this.#states.get(threadId);
    const state = await this.#browser.getBrowserState(threadId);
    if (!state) {
      const idle = { status: "idle" } satisfies BrowserSessionState;
      this.#states.set(threadId, idle);
      return idle;
    }

    const activeTab = state.tabs[state.activeTabIndex] ?? state.tabs[0];
    const url = (await this.#browser.getCurrentUrl(threadId)) ?? activeTab?.url;
    const next: BrowserSessionState = {
      status: this.#browser.isBrowserRunning(threadId) ? "ready" : "idle",
      url: url || undefined,
      title: activeTab?.title,
      // Mastra's BrowserState intentionally does not expose history depth. The
      // navigation buttons remain disabled until an adapter can prove it.
      canGoBack: cached?.canGoBack,
      canGoForward: cached?.canGoForward,
      loading: false,
    };
    this.#states.set(threadId, next);
    return next;
  }

  /**
   * Start a preview only when the thread already has a browser session. This
   * preserves the lazy-launch contract: viewing an empty panel does not spawn
   * Chromium.
   */
  async start(threadId: string): Promise<BrowserSessionState> {
    assertThreadId(threadId);
    const state = await this.getState(threadId);
    if (state.status === "error" || this.#streams.has(threadId)) return state;

    const stream = await this.#browser.startScreencastIfBrowserActive({
      threadId,
      format: this.#options.streamFormat,
      quality: this.#options.streamQuality,
      maxWidth: this.#options.streamMaxWidth,
      maxHeight: this.#options.streamMaxHeight,
      everyNthFrame: this.#options.streamEveryNthFrame,
    });
    if (!stream) return state;

    this.#streams.set(threadId, stream);
    stream.on("frame", (frame) => {
      const nextFrame: BrowserFrame = {
        id: randomUUID(),
        data: frame.data,
        mimeType: this.#options.streamFormat === "png" ? "image/png" : "image/jpeg",
        width: Math.max(1, Math.round(frame.viewport.width)),
        height: Math.max(1, Math.round(frame.viewport.height)),
        timestamp: Date.now(),
      };
      this.emit({ type: "frame", threadId, frame: nextFrame });
    });
    stream.on("url", (url) => {
      const current = this.#states.get(threadId) ?? { status: "ready" };
      const next = { ...current, status: "ready", url, loading: false } satisfies BrowserSessionState;
      this.#states.set(threadId, next);
      this.emit({ type: "state", threadId, state: next, timestamp: Date.now() });
    });
    stream.on("stop", (reason) => {
      if (this.#streams.get(threadId) === stream) this.#streams.delete(threadId);
      const current = this.#states.get(threadId) ?? { status: "idle" };
      const next = {
        ...current,
        status: reason === "error" ? "error" : "idle",
        error: reason === "error" ? "Browser screencast stopped unexpectedly" : undefined,
      } satisfies BrowserSessionState;
      this.#states.set(threadId, next);
      this.emit({ type: "state", threadId, state: next, timestamp: Date.now() });
    });
    stream.on("error", (error) => {
      const next = {
        ...(this.#states.get(threadId) ?? { status: "error" }),
        status: "error",
        error: error.message,
      } satisfies BrowserSessionState;
      this.#states.set(threadId, next);
      this.emit({
        type: "error",
        threadId,
        error: { code: "BROWSER_STREAM_ERROR", message: error.message, retryable: true },
        timestamp: Date.now(),
      });
      this.emit({ type: "state", threadId, state: next, timestamp: Date.now() });
    });
    return state;
  }

  async navigate(threadId: string, url: string): Promise<BrowserSessionState> {
    assertSafeUrl(url);
    return this.runSerial(threadId, async () => {
      const result = await this.#browser.goto({ url }, threadId);
      assertBrowserResult(result);
      await this.start(threadId);
      return this.refreshState(threadId, { loading: false });
    });
  }

  async back(threadId: string): Promise<BrowserSessionState> {
    return this.runSerial(threadId, async () => {
      const result = await this.#browser.back(threadId);
      assertBrowserResult(result);
      await this.start(threadId);
      return this.refreshState(threadId, { loading: false });
    });
  }

  /** AgentBrowser currently does not expose a forward method in its public API. */
  async forward(_threadId: string): Promise<BrowserSessionState> {
    throw new BrowserSessionError("BROWSER_UNSUPPORTED", "Forward navigation is not supported by this browser provider");
  }

  async reload(threadId: string): Promise<BrowserSessionState> {
    return this.runSerial(threadId, async () => {
      const state = await this.getState(threadId);
      if (!state.url) return state;
      assertSafeUrl(state.url);
      const result = await this.#browser.goto({ url: state.url }, threadId);
      assertBrowserResult(result);
      await this.start(threadId);
      return this.refreshState(threadId, { loading: false });
    });
  }

  async mouse(threadId: string, action: BrowserMouseAction): Promise<void> {
    return this.runSerial(threadId, async () => {
      const event: MouseEventParams = {
        type:
          action.type === "move"
            ? "mouseMoved"
            : action.type === "down"
              ? "mousePressed"
              : action.type === "up"
                ? "mouseReleased"
                : "mouseWheel",
        x: action.x,
        y: action.y,
        button: action.type === "wheel" ? "none" : mouseButton(action.button),
        clickCount: action.type === "down" ? 1 : undefined,
        deltaX: action.type === "wheel" ? action.deltaX : undefined,
        deltaY: action.type === "wheel" ? action.deltaY : undefined,
        modifiers: modifierMask(action),
      };
      await this.#browser.injectMouseEvent(event, threadId);
    });
  }

  async key(threadId: string, action: BrowserKeyAction): Promise<void> {
    return this.runSerial(threadId, async () => {
      const event: KeyboardEventParams = {
        type: action.type === "down" ? "keyDown" : "keyUp",
        key: action.key,
        code: action.code,
        modifiers: modifierMask(action),
      };
      await this.#browser.injectKeyboardEvent(event, threadId);
    });
  }

  async close(threadId: string): Promise<void> {
    assertThreadId(threadId);
    await this.runSerial(threadId, async () => {
      const stream = this.#streams.get(threadId);
      this.#streams.delete(threadId);
      if (stream) await stream.stop().catch(() => undefined);
      await this.#browser.closeThreadSession(threadId);
      const state = { status: "idle" } satisfies BrowserSessionState;
      this.#states.set(threadId, state);
      this.emit({ type: "state", threadId, state, timestamp: Date.now() });
    });
  }

  async dispose(): Promise<void> {
    const threadIds = [...new Set([...this.#streams.keys(), ...this.#states.keys()])];
    await Promise.allSettled(threadIds.map((threadId) => this.close(threadId)));
    this.#streams.clear();
    this.#states.clear();
    this.#queues.clear();
    this.#listeners.clear();
  }

  /** A narrow dispatcher used by the agent-host browser protocol. */
  async execute(command: BrowserCommand): Promise<BrowserSessionState | void> {
    switch (command.type) {
      case "state":
        return this.getState(command.request.threadId);
      case "start":
        return this.start(command.request.threadId);
      case "navigate":
        return this.navigate(command.request.threadId, command.url);
      case "back":
        return this.back(command.request.threadId);
      case "forward":
        return this.forward(command.request.threadId);
      case "reload":
        return this.reload(command.request.threadId);
      case "mouse":
        await this.mouse(command.request.threadId, command.action);
        return this.getState(command.request.threadId);
      case "key":
        await this.key(command.request.threadId, command.action);
        return this.getState(command.request.threadId);
      case "close":
        await this.close(command.request.threadId);
        return this.getState(command.request.threadId);
    }
  }

  async refreshState(threadId: string, patch: Partial<BrowserSessionState> = {}): Promise<BrowserSessionState> {
    const state = await this.getState(threadId);
    const next = { ...state, ...patch } satisfies BrowserSessionState;
    this.#states.set(threadId, next);
    this.emit({ type: "state", threadId, state: next, timestamp: Date.now() });
    return next;
  }

  private runSerial<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
    assertThreadId(threadId);
    const prior = this.#queues.get(threadId) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(operation);
    this.#queues.set(threadId, next);
    void next.finally(() => {
      if (this.#queues.get(threadId) === next) this.#queues.delete(threadId);
    });
    return next;
  }

  private emit(event: BrowserSessionEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("Browser session listener failed", error);
      }
    }
  }
}

export class BrowserSessionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "BrowserSessionError";
  }
}

function assertThreadId(threadId: string): void {
  if (typeof threadId !== "string" || threadId.length === 0 || threadId.length > 256) {
    throw new BrowserSessionError("INVALID_ARGUMENT", "Browser thread ID is invalid");
  }
}

function assertSafeUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BrowserSessionError("INVALID_ARGUMENT", "Browser URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BrowserSessionError("NOT_AUTHORIZED", "Only HTTP and HTTPS browser URLs are allowed");
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(hostname) ||
    /^10\.(?:\d{1,3}\.){2}\d{1,3}$/.test(hostname) ||
    /^192\.168\.(?:\d{1,3}\.)\d{1,3}$/.test(hostname) ||
    /^169\.254\.(?:\d{1,3}\.)\d{1,3}$/.test(hostname) ||
    /^172\.(?:1[6-9]|2\d|3[0-1])\.(?:\d{1,3}\.)\d{1,3}$/.test(hostname)
  ) {
    throw new BrowserSessionError("NOT_AUTHORIZED", "Private and loopback browser targets are blocked");
  }
}

function assertBrowserResult(value: unknown): asserts value is { success: true } {
  if (!value || typeof value !== "object" || (value as { success?: unknown }).success !== true) {
    const result = value as { error?: unknown; message?: unknown } | null;
    const message =
      result && typeof result.message === "string"
        ? result.message
        : result && typeof result.error === "string"
          ? result.error
          : "Browser operation failed";
    throw new BrowserSessionError("BROWSER_OPERATION_FAILED", message);
  }
}

function mouseButton(button: number | undefined): MouseEventParams["button"] {
  if (button === 1) return "middle";
  if (button === 2) return "right";
  return "left";
}

function modifierMask(value: { alt: boolean; control: boolean; meta: boolean; shift: boolean }): number {
  // CDP Input.DispatchKeyEvent/Input.DispatchMouseEvent modifier bits.
  return (value.alt ? 1 : 0) | (value.control ? 2 : 0) | (value.meta ? 4 : 0) | (value.shift ? 8 : 0);
}

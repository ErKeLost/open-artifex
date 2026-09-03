import {
  AGENT_PROTOCOL_VERSION,
  type AgentRuntime,
  type AgentToMainMessage,
} from "../../shared/agent-protocol.js";
import { BROWSER_PROTOCOL_VERSION } from "../../shared/browser-protocol.js";
import type {
  BrowserCommand,
  BrowserEvent,
} from "../../shared/browser-protocol.js";

type Post = (message: AgentToMainMessage) => void;

/** Converts runtime browser calls/events to bounded agent-protocol messages. */
export class BrowserRelay {
  #runtime: AgentRuntime | undefined;
  #pendingFrames = new Map<string, BrowserEvent>();
  #flushScheduled = false;

  constructor(private readonly post: Post) {}

  attach(runtime: AgentRuntime): (() => void) | undefined {
    this.#runtime = runtime;
    return runtime.browser?.onEvent((event) => this.forward(event));
  }

  async execute(
    requestId: string,
    command: BrowserCommand,
    shuttingDown: boolean,
  ): Promise<void> {
    const threadId = command.request.threadId;
    if (shuttingDown) {
      this.postError(
        requestId,
        threadId,
        "BROWSER_SHUTTING_DOWN",
        "Browser service is shutting down",
        true,
      );
      return;
    }
    if (!this.#runtime?.browser) {
      this.postError(
        requestId,
        threadId,
        "BROWSER_UNAVAILABLE",
        "Browser service is unavailable",
        true,
      );
      return;
    }

    try {
      const state = await this.#runtime.browser.execute(command);
      this.post({
        version: AGENT_PROTOCOL_VERSION,
        type: "browser.response",
        response: {
          version: BROWSER_PROTOCOL_VERSION,
          requestId,
          threadId,
          ok: true,
          state: state && typeof state === "object" ? state : undefined,
        },
      });
    } catch (error) {
      const detail = toBrowserError(error);
      this.postError(
        requestId,
        threadId,
        detail.code,
        detail.message,
        detail.retryable,
      );
    }
  }

  clear(): void {
    this.#pendingFrames.clear();
    this.#runtime = undefined;
  }

  private forward(event: BrowserEvent): void {
    if (event.type !== "frame") {
      this.post({
        version: AGENT_PROTOCOL_VERSION,
        type: "browser.event",
        event,
      });
      return;
    }

    this.#pendingFrames.set(event.threadId, event);
    if (this.#flushScheduled) return;
    this.#flushScheduled = true;
    setImmediate(() => {
      this.#flushScheduled = false;
      for (const frame of this.#pendingFrames.values()) {
        this.post({
          version: AGENT_PROTOCOL_VERSION,
          type: "browser.event",
          event: frame,
        });
      }
      this.#pendingFrames.clear();
    });
  }

  private postError(
    requestId: string,
    threadId: string,
    code: string,
    message: string,
    retryable: boolean,
  ): void {
    this.post({
      version: AGENT_PROTOCOL_VERSION,
      type: "browser.response",
      response: {
        version: BROWSER_PROTOCOL_VERSION,
        requestId,
        threadId,
        ok: false,
        error: { code, message, retryable },
      },
    });
  }
}

function toBrowserError(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
} {
  if (error && typeof error === "object") {
    const value = error as { code?: unknown; message?: unknown };
    if (typeof value.code === "string" && typeof value.message === "string") {
      return {
        code: value.code,
        message: value.message,
        retryable:
          value.code === "BROWSER_UNAVAILABLE" ||
          value.code === "BROWSER_STREAM_ERROR",
      };
    }
  }

  return {
    code: "BROWSER_OPERATION_FAILED",
    message: error instanceof Error ? error.message : "Unknown browser error",
    retryable: false,
  };
}

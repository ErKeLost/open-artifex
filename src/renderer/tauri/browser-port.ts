import { listen } from "@tauri-apps/api/event";

import type {
  BrowserKeyAction,
  BrowserMouseAction,
  BrowserSessionState,
} from "../../shared/browser-protocol.js";
import type {
  BrowserPortSessionInput,
  DesktopResult,
  OpenArtifexBrowserFrame,
  OpenArtifexBrowserPort,
} from "../../shared/desktop-api.js";
import { isBrowserEventPayload } from "../../shared/desktop-api.js";
import { call, requireValue } from "./client.js";
import { TAURI_COMMANDS, TAURI_EVENTS } from "./channels.js";

export async function createBrowserPort(
  input: BrowserPortSessionInput,
): Promise<DesktopResult<OpenArtifexBrowserPort>> {
  let closed = false;
  let state: BrowserSessionState = { status: "connecting" };
  const stateListeners = new Set<(value: BrowserSessionState) => void>();
  const frameListeners = new Set<(value: OpenArtifexBrowserFrame) => void>();
  const stop = await listen<unknown>(TAURI_EVENTS.browser, (event) => {
    if (
      !isBrowserEventPayload(event.payload) ||
      event.payload.threadId !== input.threadId
    ) {
      return;
    }
    if (event.payload.type === "state") {
      state = event.payload.state;
      notify(stateListeners, state);
      return;
    }
    if (event.payload.type === "frame") {
      const frame = event.payload.frame;
      notify(frameListeners, {
        id: frame.id,
        dataUrl: `data:${frame.mimeType};base64,${frame.data}`,
        width: frame.width,
        height: frame.height,
      });
    }
  });

  // Subscribe before starting the session so the first state/frame event cannot
  // race the native command response.
  const start = await call<BrowserSessionState>(TAURI_COMMANDS.browserStart, {
    input,
  });
  if (!start.ok) {
    stop();
    return start;
  }
  state = start.value;

  async function command<Value>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<Value> {
    if (closed) throw new Error("Browser session is closed");
    const next = requireValue(await call<Value>(name, { input: args }));
    if (isBrowserState(next)) state = next;
    return next;
  }

  return {
    ok: true,
    value: {
      getState: () =>
        command<BrowserSessionState>(TAURI_COMMANDS.browserState, input),
      subscribeState(listener) {
        stateListeners.add(listener);
        listener(state);
        return () => stateListeners.delete(listener);
      },
      subscribeFrame(listener) {
        frameListeners.add(listener);
        return () => frameListeners.delete(listener);
      },
      dispatchMouse: (action: BrowserMouseAction) =>
        command<void>(TAURI_COMMANDS.browserMouse, { ...input, action }),
      dispatchKey: (action: BrowserKeyAction) =>
        command<void>(TAURI_COMMANDS.browserKey, { ...input, action }),
      navigate: (url) =>
        command<BrowserSessionState>(TAURI_COMMANDS.browserNavigate, {
          ...input,
          url,
        }).then(() => undefined),
      goBack: () =>
        command<BrowserSessionState>(TAURI_COMMANDS.browserBack, input).then(
          () => undefined,
        ),
      goForward: () =>
        command<BrowserSessionState>(TAURI_COMMANDS.browserForward, input).then(
          () => undefined,
        ),
      reload: () =>
        command<BrowserSessionState>(TAURI_COMMANDS.browserReload, input).then(
          () => undefined,
        ),
      async close() {
        if (closed) return;
        closed = true;
        stateListeners.clear();
        frameListeners.clear();
        stop();
        requireValue(await call<void>(TAURI_COMMANDS.browserClose, { input }));
      },
    },
  };
}

function isBrowserState(value: unknown): value is BrowserSessionState {
  return Boolean(value && typeof value === "object" && "status" in value);
}

function notify<Value>(
  listeners: Set<(value: Value) => void>,
  value: Value,
): void {
  for (const listener of listeners) {
    try {
      listener(value);
    } catch (error) {
      console.error("Browser listener failed", error);
    }
  }
}

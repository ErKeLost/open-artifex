import { invoke } from "@tauri-apps/api/core";
import { listen, type Event, type UnlistenFn } from "@tauri-apps/api/event";

import type { DesktopResult } from "../../shared/desktop-api.js";

export async function call<Value>(
  command: string,
  args?: Record<string, unknown>,
): Promise<DesktopResult<Value>> {
  try {
    return await invoke<DesktopResult<Value>>(command, args);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message:
          error instanceof Error ? error.message : "Desktop operation failed",
      },
    };
  }
}

export function requireValue<Value>(result: DesktopResult<Value>): Value {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export function subscribe<Value>(
  channel: string,
  guard: (value: unknown) => value is Value,
  listener: (value: Value) => void,
): () => void {
  let active = true;
  let unlisten: UnlistenFn | undefined;

  void listen<unknown>(channel, (event: Event<unknown>) => {
    if (!active || !guard(event.payload)) return;
    try {
      listener(event.payload);
    } catch (error) {
      console.error(`Tauri ${channel} listener failed`, error);
    }
  }).then((stop) => {
    if (active) unlisten = stop;
    else stop();
  });

  return () => {
    active = false;
    unlisten?.();
  };
}

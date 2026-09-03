import { listen } from "@tauri-apps/api/event";

import {
  isTerminalEvent,
  type DesktopResult,
  type OpenArtifexTerminalPort,
  type TerminalCreateInput,
  type TerminalKillInput,
  type TerminalSession,
  type TerminalSnapshot,
  type TerminalWriteInput,
} from "../../shared/desktop-api.js";
import { call, requireValue } from "./client.js";
import { TAURI_COMMANDS, TAURI_EVENTS } from "./channels.js";

const MAX_PENDING_CHUNKS = 256;

export async function createTerminalPort(
  input?: TerminalCreateInput,
): Promise<DesktopResult<OpenArtifexTerminalPort>> {
  const created = await call<TerminalSession>(
    TAURI_COMMANDS.terminalCreate,
    input ? { input } : undefined,
  );
  if (!created.ok) return created;

  const sessionId = created.value.sessionId;
  const listeners = new Set<(chunk: string) => void>();
  const pending: Array<{ data: string; sequence: number }> = [];
  let snapshotData = "";
  let snapshotSequence = -1;
  let snapshotReady = false;
  let closed = false;

  const stop = await listen<unknown>(TAURI_EVENTS.terminal, (event) => {
    if (
      !isTerminalEvent(event.payload) ||
      event.payload.sessionId !== sessionId ||
      event.payload.type !== "data"
    ) {
      return;
    }
    if (!snapshotReady || listeners.size === 0) {
      pending.push({
        data: event.payload.data,
        sequence: event.payload.sequence,
      });
      while (pending.length > MAX_PENDING_CHUNKS) pending.shift();
      return;
    }
    notifyListeners(listeners, event.payload.data);
  });

  const snapshot = await call<TerminalSnapshot>(
    TAURI_COMMANDS.terminalSubscribe,
    {
      input: { sessionId },
    },
  );
  if (!snapshot.ok) {
    stop();
    await call<void>(TAURI_COMMANDS.terminalKill, {
      input: { sessionId } satisfies TerminalKillInput,
    });
    return snapshot;
  }

  snapshotData = snapshot.value.data;
  snapshotSequence = snapshot.value.sequence;
  snapshotReady = true;

  const port: OpenArtifexTerminalPort = {
    subscribeWrite(listener) {
      if (typeof listener !== "function" || closed) return () => undefined;
      listeners.add(listener);
      if (snapshotData) listener(snapshotData);
      for (const item of pending.splice(0)) {
        if (item.sequence > snapshotSequence) listener(item.data);
      }
      return () => listeners.delete(listener);
    },
    async sendInput(data) {
      assertOpen(closed);
      requireValue(
        await call<void>(TAURI_COMMANDS.terminalWrite, {
          input: { sessionId, data } satisfies TerminalWriteInput,
        }),
      );
    },
    async resize(cols, rows) {
      assertOpen(closed);
      requireValue(
        await call<void>(TAURI_COMMANDS.terminalResize, {
          input: { sessionId, cols, rows },
        }),
      );
    },
    async close() {
      if (closed) return;
      closed = true;
      listeners.clear();
      stop();
      requireValue(
        await call<void>(TAURI_COMMANDS.terminalKill, {
          input: { sessionId } satisfies TerminalKillInput,
        }),
      );
    },
  };

  return { ok: true, value: port };
}

function assertOpen(closed: boolean): void {
  if (closed) throw new Error("Terminal session is closed");
}

function notifyListeners(
  listeners: Set<(chunk: string) => void>,
  chunk: string,
): void {
  for (const listener of listeners) {
    try {
      listener(chunk);
    } catch (error) {
      console.error("Terminal output listener failed", error);
    }
  }
}

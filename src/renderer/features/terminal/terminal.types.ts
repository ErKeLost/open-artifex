export type TerminalWriteChunk = string | Uint8Array;

export type TerminalWriteListener = (chunk: TerminalWriteChunk) => void;

/**
 * Renderer boundary for a real PTY transport.
 * Implementations live outside the renderer and must return an unsubscribe callback.
 */
export interface TerminalPort {
  subscribeWrite(listener: TerminalWriteListener): () => void;
  sendInput(data: string): void | Promise<void>;
  resize(cols: number, rows: number): void | Promise<void>;
}

export type TerminalSurfaceState = 'empty' | 'loading' | 'ready' | 'error';


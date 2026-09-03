import type {
  BrowserConnectionStatus,
  BrowserKeyAction,
  BrowserModifiers,
  BrowserMouseAction,
  BrowserSessionState,
} from '../../../shared/browser-protocol';

export type { BrowserConnectionStatus, BrowserKeyAction, BrowserModifiers, BrowserMouseAction, BrowserSessionState };

export interface BrowserFrame {
  id: string | number;
  dataUrl: string;
  width: number;
  height: number;
}

/** Renderer boundary for a remote browser session or screenshot stream. */
export interface BrowserPort {
  getState(): BrowserSessionState | Promise<BrowserSessionState>;
  subscribeState(listener: (state: BrowserSessionState) => void): () => void;
  subscribeFrame(listener: (frame: BrowserFrame) => void): () => void;
  dispatchMouse(action: BrowserMouseAction): void | Promise<void>;
  dispatchKey(action: BrowserKeyAction): void | Promise<void>;
  navigate?(url: string): void | Promise<void>;
  goBack?(): void | Promise<void>;
  goForward?(): void | Promise<void>;
  reload?(): void | Promise<void>;
}

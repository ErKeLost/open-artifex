import {
  ArrowClockwise,
  ArrowLeft,
  ArrowRight,
  Browser,
  CircleNotch,
  LockSimple,
  WarningCircle,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import type {
  BrowserFrame,
  BrowserKeyAction,
  BrowserModifiers,
  BrowserMouseAction,
  BrowserPort,
  BrowserSessionState,
} from './browser.types';
import './browser.css';

export interface BrowserSurfaceProps {
  port?: BrowserPort | null;
  className?: string;
}

const idleState: BrowserSessionState = { status: 'idle' };

function modifiers(event: Pick<KeyboardEvent | PointerEvent | WheelEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>): BrowserModifiers {
  return { alt: event.altKey, control: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey };
}

function isSafeFrameUrl(url: string) {
  return /^data:image\/(?:png|jpe?g|webp);base64,/i.test(url) || url.startsWith('blob:');
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : '浏览器操作失败';
}

function normalizeAddress(value: string) {
  const address = value.trim();
  if (!address) return undefined;
  if (/^[a-z][a-z\d+.-]*:/i.test(address)) return address;
  return `https://${address}`;
}

export function BrowserSurface({ port, className }: BrowserSurfaceProps) {
  const [session, setSession] = useState<BrowserSessionState>(port ? { status: 'connecting' } : idleState);
  const [frame, setFrame] = useState<BrowserFrame>();
  const [address, setAddress] = useState('');
  const [actionError, setActionError] = useState<string>();
  const editingAddressRef = useRef(false);
  const frameRef = useRef<HTMLImageElement>(null);
  const moveFrameRef = useRef<number | undefined>(undefined);
  const pendingMoveRef = useRef<BrowserMouseAction | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setFrame(undefined);
    setActionError(undefined);
    setSession(port ? { status: 'connecting' } : idleState);
    if (!port) return;

    const acceptState = (nextState: BrowserSessionState) => {
      if (!active) return;
      setSession(nextState);
      if (!editingAddressRef.current && nextState.url) setAddress(nextState.url);
    };

    let unsubscribeState: () => void = () => undefined;
    let unsubscribeFrame: () => void = () => undefined;
    try {
      unsubscribeState = port.subscribeState(acceptState);
      unsubscribeFrame = port.subscribeFrame((nextFrame) => {
        if (active) setFrame(nextFrame);
      });
      void Promise.resolve(port.getState()).then(acceptState, (error) => {
        if (active) setSession({ status: 'error', error: messageFrom(error) });
      });
    } catch (error) {
      setSession({ status: 'error', error: messageFrom(error) });
    }

    return () => {
      active = false;
      if (moveFrameRef.current !== undefined) cancelAnimationFrame(moveFrameRef.current);
      moveFrameRef.current = undefined;
      pendingMoveRef.current = undefined;
      unsubscribeState();
      unsubscribeFrame();
    };
  }, [port]);

  const runAction = useCallback((action: () => void | Promise<void>) => {
    setActionError(undefined);
    try {
      void Promise.resolve(action()).catch((error) => setActionError(messageFrom(error)));
    } catch (error) {
      setActionError(messageFrom(error));
    }
  }, []);

  const frameCoordinates = useCallback((clientX: number, clientY: number) => {
    const element = frameRef.current;
    if (!element || !frame) return;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    return {
      x: Math.max(0, Math.min(frame.width, ((clientX - rect.left) / rect.width) * frame.width)),
      y: Math.max(0, Math.min(frame.height, ((clientY - rect.top) / rect.height) * frame.height)),
    };
  }, [frame]);

  const dispatchPointer = useCallback(
    (type: 'move' | 'down' | 'up', event: PointerEvent<HTMLDivElement>) => {
      if (!port) return;
      const point = frameCoordinates(event.clientX, event.clientY);
      if (!point) return;
      if (type === 'down') event.currentTarget.setPointerCapture(event.pointerId);
      const action: BrowserMouseAction = { type, ...point, button: event.button, ...modifiers(event) };
      if (type === 'move') {
        pendingMoveRef.current = action;
        if (moveFrameRef.current === undefined) {
          moveFrameRef.current = requestAnimationFrame(() => {
            moveFrameRef.current = undefined;
            const pending = pendingMoveRef.current;
            pendingMoveRef.current = undefined;
            if (pending) runAction(() => port.dispatchMouse(pending));
          });
        }
        return;
      }
      runAction(() => port.dispatchMouse(action));
    },
    [frameCoordinates, port, runAction],
  );

  const dispatchWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      if (!port) return;
      const point = frameCoordinates(event.clientX, event.clientY);
      if (!point) return;
      event.preventDefault();
      const action: BrowserMouseAction = {
        type: 'wheel',
        ...point,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        ...modifiers(event),
      };
      runAction(() => port.dispatchMouse(action));
    },
    [frameCoordinates, port, runAction],
  );

  const dispatchKeyboard = useCallback(
    (type: 'down' | 'up', event: KeyboardEvent<HTMLDivElement>) => {
      if (!port) return;
      event.preventDefault();
      const action: BrowserKeyAction = {
        type,
        key: event.key,
        code: event.code,
        repeat: event.repeat,
        ...modifiers(event),
      };
      runAction(() => port.dispatchKey(action));
    },
    [port, runAction],
  );

  const submitAddress = (event: FormEvent) => {
    event.preventDefault();
    const nextAddress = normalizeAddress(address);
    if (!port?.navigate || !nextAddress) return;
    runAction(() => port.navigate!(nextAddress));
  };

  const classes = ['oa-browser', className].filter(Boolean).join(' ');
  const safeFrame = frame && isSafeFrameUrl(frame.dataUrl) ? frame : undefined;
  const unsafeFrame = frame && !safeFrame;

  if (!port) {
    return (
      <div className={`${classes} oa-browser--empty`} role="status">
        <Browser aria-hidden="true" size={25} weight="light" />
        <strong>浏览器尚未连接</strong>
        <span>连接浏览器端口后，可在这里查看并操作页面。</span>
      </div>
    );
  }

  return (
    <div className={classes}>
      <div className="oa-browser__toolbar">
        <div className="oa-browser__navigation">
          <button aria-label="后退" disabled={!session.canGoBack || !port.goBack} onClick={() => runAction(() => port.goBack!())} type="button">
            <ArrowLeft aria-hidden="true" size={15} />
          </button>
          <button aria-label="前进" disabled={!session.canGoForward || !port.goForward} onClick={() => runAction(() => port.goForward!())} type="button">
            <ArrowRight aria-hidden="true" size={15} />
          </button>
          <button aria-label="重新加载" disabled={!port.reload} onClick={() => runAction(() => port.reload!())} type="button">
            <ArrowClockwise aria-hidden="true" className={session.loading ? 'oa-browser__spin' : undefined} size={15} />
          </button>
        </div>
        <form className="oa-browser__address" onSubmit={submitAddress}>
          <LockSimple aria-hidden="true" size={12} />
          <input
            aria-label="浏览器地址"
            disabled={!port.navigate}
            onBlur={() => {
              editingAddressRef.current = false;
              if (session.url) setAddress(session.url);
            }}
            onChange={(event) => setAddress(event.currentTarget.value)}
            onFocus={() => {
              editingAddressRef.current = true;
            }}
            spellCheck={false}
            value={address}
          />
        </form>
      </div>

      <div
        aria-label={session.title ? `浏览器页面：${session.title}` : '浏览器页面'}
        className="oa-browser__viewport"
        onKeyDown={(event) => dispatchKeyboard('down', event)}
        onKeyUp={(event) => dispatchKeyboard('up', event)}
        onPointerDown={(event) => dispatchPointer('down', event)}
        onPointerMove={(event) => dispatchPointer('move', event)}
        onPointerUp={(event) => dispatchPointer('up', event)}
        onWheel={dispatchWheel}
        role="application"
        tabIndex={safeFrame ? 0 : -1}
      >
        {safeFrame ? (
          <img
            alt={session.title ?? '浏览器页面快照'}
            draggable={false}
            height={safeFrame.height}
            key={safeFrame.id}
            ref={frameRef}
            src={safeFrame.dataUrl}
            width={safeFrame.width}
          />
        ) : null}

        {session.status === 'connecting' || (session.loading && !safeFrame) ? (
          <div className="oa-browser__state" role="status">
            <CircleNotch aria-hidden="true" className="oa-browser__spin" size={20} />
            <span>正在载入浏览器…</span>
          </div>
        ) : null}
        {session.status === 'error' || unsafeFrame ? (
          <div className="oa-browser__state oa-browser__state--error" role="alert">
            <WarningCircle aria-hidden="true" size={20} weight="fill" />
            <span>{unsafeFrame ? '浏览器返回了不安全的帧地址' : session.error ?? '浏览器连接失败'}</span>
          </div>
        ) : null}
        {session.status === 'ready' && !safeFrame && !session.loading ? (
          <div className="oa-browser__state" role="status">
            <Browser aria-hidden="true" size={21} />
            <span>等待第一帧页面画面</span>
          </div>
        ) : null}
      </div>

      {actionError ? <div className="oa-browser__action-error" role="alert">{actionError}</div> : null}
    </div>
  );
}

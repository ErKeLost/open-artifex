import { Terminal, useTerminal } from '@wterm/react';
import '@wterm/react/css';
import { PlugsConnected, TerminalWindow, WarningCircle } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TerminalPort, TerminalSurfaceState, TerminalWriteChunk } from './terminal.types';
import './terminal.css';

export interface TerminalSurfaceProps {
  port?: TerminalPort | null;
  theme?: 'light' | 'dark';
  className?: string;
  onTitleChange?: (title: string) => void;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '终端初始化失败';
}

export function TerminalSurface({ port, theme = 'light', className, onTitleChange }: TerminalSurfaceProps) {
  const { ref, write, focus } = useTerminal();
  const [state, setState] = useState<TerminalSurfaceState>(port ? 'loading' : 'empty');
  const [error, setError] = useState<string>();
  const readyRef = useRef(false);
  const queueRef = useRef<TerminalWriteChunk[]>([]);

  useEffect(() => {
    readyRef.current = false;
    queueRef.current = [];
    setError(undefined);
    setState(port ? 'loading' : 'empty');
    if (!port) return;

    try {
      return port.subscribeWrite((chunk) => {
        if (readyRef.current) write(chunk);
        else queueRef.current.push(chunk);
      });
    } catch (subscribeError) {
      setError(errorMessage(subscribeError));
      setState('error');
    }
  }, [port, write]);

  const reportPortError = useCallback((portError: unknown) => {
    setError(errorMessage(portError));
    setState('error');
  }, []);

  const handleReady = useCallback(() => {
    readyRef.current = true;
    for (const chunk of queueRef.current) write(chunk);
    queueRef.current = [];
    setState('ready');
    focus();
  }, [focus, write]);

  const handleData = useCallback(
    (data: string) => {
      if (!port) return;
      try {
        void Promise.resolve(port.sendInput(data)).catch(reportPortError);
      } catch (inputError) {
        reportPortError(inputError);
      }
    },
    [port, reportPortError],
  );

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      if (!port) return;
      try {
        void Promise.resolve(port.resize(cols, rows)).catch(reportPortError);
      } catch (resizeError) {
        reportPortError(resizeError);
      }
    },
    [port, reportPortError],
  );

  const classes = ['oa-terminal', className].filter(Boolean).join(' ');

  if (!port) {
    return (
      <div className={`${classes} oa-terminal--empty`} role="status">
        <TerminalWindow aria-hidden="true" size={24} weight="light" />
        <strong>终端尚未连接</strong>
        <span>连接 PTY 端口后，输出会显示在这里。</span>
      </div>
    );
  }

  return (
    <div className={classes} data-state={state}>
      <Terminal
        aria-label="工作区终端"
        autoResize
        className="oa-terminal__wterm"
        cursorBlink
        onData={handleData}
        onError={reportPortError}
        onReady={handleReady}
        onResize={handleResize}
        onTitle={onTitleChange}
        ref={ref}
        theme={theme === 'dark' ? undefined : 'light'}
      />

      {state === 'loading' ? (
        <div className="oa-terminal__overlay" role="status">
          <PlugsConnected aria-hidden="true" size={20} />
          <span>正在连接终端…</span>
        </div>
      ) : null}
      {state === 'error' ? (
        <div className="oa-terminal__overlay oa-terminal__overlay--error" role="alert">
          <WarningCircle aria-hidden="true" size={20} weight="fill" />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
}


import { spawn } from "node:child_process";
import { BoundedOutputBuffer } from "./output-buffer";

export type ProcessRunOptions = {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

export type ProcessRunResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
  durationMs: number;
};

export async function runProcess(
  command: string,
  args: readonly string[],
  options: ProcessRunOptions,
): Promise<ProcessRunResult> {
  const startedAt = performance.now();
  const stdout = new BoundedOutputBuffer(options.maxOutputBytes);
  const stderr = new BoundedOutputBuffer(options.maxOutputBytes);
  let timedOut = false;

  const child = spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });

  child.stdout.on("data", (chunk: Buffer) => stdout.append(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.append(chunk));

  const terminate = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      if (process.platform === "win32") child.kill();
      else if (child.pid !== undefined) process.kill(-child.pid, "SIGTERM");
    } catch {
      // The process may have exited between the status check and signal delivery.
    }
  };

  const onAbort = () => terminate();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    terminate();
  }, options.timeoutMs ?? 120_000);

  try {
    const { code, signal } = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    const out = stdout.value();
    const err = stderr.value();
    return {
      exitCode: code,
      signal,
      stdout: out.text,
      stderr: err.text,
      truncated: out.truncated || err.truncated,
      timedOut,
      durationMs: Math.round(performance.now() - startedAt),
    };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

const SAFE_ENV_KEYS = new Set([
  "HOME",
  "USER",
  "LOGNAME",
  "PATH",
  "SHELL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "TERM",
  "COLORTERM",
  "SystemRoot",
  "WINDIR",
]);

export function createToolEnvironment(source = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => SAFE_ENV_KEYS.has(key) || key.startsWith("LC_")),
  );
}

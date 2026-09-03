import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { createToolEnvironment, runProcess } from "../core/process-runner";
import { toolResultSchema } from "../core/tool-result";
import type { ToolFactoryContext } from "../core/tool-context";

export function createBashTool(factory: ToolFactoryContext) {
  return createTool({
    id: "bash",
    description:
      "Run a shell command in the active workspace. Use for builds, tests, Git, and project tooling.",
    requireApproval: factory.requireApproval,
    inputSchema: z.object({
      command: z.string().min(1),
      cwd: z.string().min(1).optional().describe("Workspace-relative working directory"),
      timeoutMs: z.number().int().min(1_000).max(600_000).default(120_000),
    }),
    outputSchema: toolResultSchema,
    mcp: {
      annotations: {
        title: "Run command",
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    execute: async ({ command, cwd, timeoutMs }, context) => {
      const workingDirectory = await factory.workspace.resolveForRead(cwd ?? ".");
      const shell = process.platform === "win32"
        ? process.env.ComSpec ?? "cmd.exe"
        : process.env.SHELL ?? "/bin/sh";
      const args = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command];
      const result = await runProcess(shell, args, {
        cwd: workingDirectory,
        env: createToolEnvironment(),
        signal: context.abortSignal,
        timeoutMs,
        maxOutputBytes: 50 * 1024,
      });
      const sections = [];
      if (result.stdout) sections.push(result.stdout.trimEnd());
      if (result.stderr) sections.push(`[stderr]\n${result.stderr.trimEnd()}`);
      if (!sections.length) sections.push("Command completed with no output.");
      return {
        title: command,
        output: sections.join("\n\n"),
        metadata: {
          cwd: workingDirectory,
          exitCode: result.exitCode,
          signal: result.signal,
          durationMs: result.durationMs,
          timedOut: result.timedOut,
          truncated: result.truncated,
        },
      };
    },
  });
}

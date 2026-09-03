import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { runProcess } from "../core/process-runner";
import { toolResultSchema } from "../core/tool-result";
import type { ToolFactoryContext } from "../core/tool-context";

type RipgrepMatch = {
  type: "match";
  data: {
    path: { text: string };
    lines: { text: string };
    line_number: number;
  };
};

export function createGrepTool(factory: ToolFactoryContext) {
  return createTool({
    id: "grep",
    description: "Search file contents with a regular expression using ripgrep.",
    inputSchema: z.object({
      pattern: z.string().min(1).describe("Regular expression to search for"),
      path: z.string().min(1).optional().describe("File or directory, defaults to workspace root"),
      include: z.string().min(1).optional().describe("Optional include glob such as *.{ts,tsx}"),
      limit: z.number().int().positive().max(500).default(100),
    }),
    outputSchema: toolResultSchema,
    mcp: {
      annotations: { title: "Search contents", readOnlyHint: true, openWorldHint: false },
    },
    execute: async ({ pattern, path: searchPath, include, limit }, context) => {
      const target = await factory.workspace.resolveForRead(searchPath ?? ".");
      const args = ["--json", "--hidden", "--glob", "!.git/**"];
      if (include) args.push("--glob", include);
      args.push("--", pattern, target);
      const run = await runProcess("rg", args, {
        cwd: factory.workspace.root,
        signal: context.abortSignal,
        timeoutMs: 30_000,
        maxOutputBytes: 2 * 1024 * 1024,
      });
      if (run.exitCode !== 0 && run.exitCode !== 1) {
        throw new Error(run.stderr || `ripgrep exited with code ${run.exitCode}`);
      }

      const matches: RipgrepMatch[] = [];
      for (const line of run.stdout.split("\n")) {
        if (!line) continue;
        try {
          const entry = JSON.parse(line) as RipgrepMatch;
          if (entry.type === "match") matches.push(entry);
          if (matches.length >= limit) break;
        } catch {
          // Ignore non-JSON output while retaining a strict structured result.
        }
      }

      const output: string[] = [];
      let activePath = "";
      for (const match of matches) {
        const filePath = match.data.path.text;
        if (filePath !== activePath) {
          if (output.length) output.push("");
          activePath = filePath;
          output.push(`${filePath}:`);
        }
        output.push(`  Line ${match.data.line_number}: ${match.data.lines.text.trimEnd()}`);
      }
      return {
        title: pattern,
        output: output.length ? output.join("\n") : "No matches found.",
        metadata: {
          path: target,
          matches: matches.length,
          truncated: matches.length >= limit || run.truncated,
        },
      };
    },
  });
}

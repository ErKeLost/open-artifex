import { createTool } from "@mastra/core/tools";
import fg from "fast-glob";
import { stat } from "node:fs/promises";
import { z } from "zod";
import { toolResultSchema } from "../core/tool-result";
import type { ToolFactoryContext } from "../core/tool-context";

export function createGlobTool(factory: ToolFactoryContext) {
  return createTool({
    id: "glob",
    description: "Find files by glob pattern inside the active workspace.",
    inputSchema: z.object({
      pattern: z.string().min(1).describe("Glob pattern such as **/*.ts"),
      path: z.string().min(1).optional().describe("Directory to search, defaults to workspace root"),
      limit: z.number().int().positive().max(500).default(100),
    }),
    outputSchema: toolResultSchema,
    mcp: {
      annotations: { title: "Find files", readOnlyHint: true, openWorldHint: false },
    },
    execute: async ({ pattern, path: searchPath, limit }, context) => {
      const directory = await factory.workspace.resolveForRead(searchPath ?? ".");
      if (!(await stat(directory)).isDirectory()) throw new Error(`Glob path is not a directory: ${directory}`);
      const relative = factory.workspace.relative(directory);
      const matches = await fg(pattern, {
        cwd: directory,
        absolute: true,
        onlyFiles: true,
        dot: true,
        followSymbolicLinks: false,
        unique: true,
        ignore: ["**/.git/**"],
      });
      matches.sort((a, b) => a.localeCompare(b));
      const selected = matches.slice(0, limit);
      return {
        title: pattern,
        output: selected.length ? selected.join("\n") : "No files found.",
        metadata: {
          path: directory,
          count: selected.length,
          truncated: matches.length > selected.length,
        },
      };
    },
  });
}

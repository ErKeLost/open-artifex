import { createTool } from "@mastra/core/tools";
import { createTwoFilesPatch } from "diff";
import { z } from "zod";
import { atomicWriteText, pathExists, readTextFile } from "../core/file-io";
import { toolResultSchema } from "../core/tool-result";
import type { ToolFactoryContext } from "../core/tool-context";

export function createWriteTool(factory: ToolFactoryContext) {
  return createTool({
    id: "write",
    description:
      "Create a text file or intentionally replace its full contents. Read an existing file first.",
    requireApproval: factory.requireApproval,
    inputSchema: z.object({
      filePath: z.string().min(1),
      content: z.string(),
    }),
    outputSchema: toolResultSchema,
    mcp: {
      annotations: {
        title: "Write file",
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    execute: async ({ filePath, content }, context) => {
      const resolved = await factory.workspace.resolveForWrite(filePath);
      const relative = factory.workspace.relative(resolved);
      const exists = await pathExists(resolved);
      if (exists) await factory.versions.assertFresh(resolved);
      const source = exists ? await readTextFile(resolved) : undefined;
      const before = source?.text.replaceAll("\r\n", "\n") ?? "";
      const after = content.replaceAll("\r\n", "\n");
      const patch = createTwoFilesPatch(relative, relative, before, after, "before", "after");

      await atomicWriteText(resolved, after, source);
      factory.versions.forget(resolved);
      return {
        title: relative,
        output: `Wrote ${Buffer.byteLength(content)} bytes to ${relative}.`,
        diff: patch,
        metadata: { path: resolved, exists, bytes: Buffer.byteLength(content) },
      };
    },
  });
}

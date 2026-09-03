import { createTool } from "@mastra/core/tools";
import { createTwoFilesPatch } from "diff";
import { z } from "zod";
import { atomicWriteText, pathExists, readTextFile } from "../core/file-io";
import { toolResultSchema } from "../core/tool-result";
import type { ToolFactoryContext } from "../core/tool-context";

export function createEditTool(factory: ToolFactoryContext) {
  return createTool({
    id: "edit",
    description:
      "Replace an exact string in a text file. Read an existing file first so concurrent changes are detected.",
    requireApproval: factory.requireApproval,
    inputSchema: z.object({
      filePath: z.string().min(1),
      oldString: z.string(),
      newString: z.string(),
      replaceAll: z.boolean().default(false),
    }),
    outputSchema: toolResultSchema,
    mcp: {
      annotations: {
        title: "Edit file",
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    execute: async ({ filePath, oldString, newString, replaceAll }, context) => {
      if (oldString === newString) throw new Error("oldString and newString must differ");
      const resolved = await factory.workspace.resolveForWrite(filePath);
      const relative = factory.workspace.relative(resolved);
      const exists = await pathExists(resolved);
      if (!exists && oldString !== "") {
        throw new Error(`File does not exist: ${relative}`);
      }
      if (exists && oldString === "") {
        throw new Error("oldString cannot be empty for an existing file; use write for full replacement");
      }
      if (exists) await factory.versions.assertFresh(resolved);

      const source = exists
        ? await readTextFile(resolved)
        : { text: "", bom: false, lineEnding: "\n" as const };
      const normalizedSource = source.text.replaceAll("\r\n", "\n");
      const search = oldString.replaceAll("\r\n", "\n");
      const replacement = newString.replaceAll("\r\n", "\n");
      const occurrences = search === "" ? 0 : normalizedSource.split(search).length - 1;
      if (search !== "" && occurrences === 0) {
        throw new Error(`oldString was not found in ${relative}`);
      }
      if (!replaceAll && occurrences > 1) {
        throw new Error(`oldString occurs ${occurrences} times; provide more context or set replaceAll`);
      }

      const updated =
        search === ""
          ? replacement
          : replaceAll
            ? normalizedSource.split(search).join(replacement)
            : normalizedSource.replace(search, replacement);
      const patch = createTwoFilesPatch(relative, relative, normalizedSource, updated, "before", "after");
      await atomicWriteText(resolved, updated, source);
      factory.versions.forget(resolved);
      return {
        title: relative,
        output: `Updated ${relative}.`,
        diff: patch,
        metadata: { path: resolved, exists, occurrences: Math.max(occurrences, 1) },
      };
    },
  });
}

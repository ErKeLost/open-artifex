import { createTool } from "@mastra/core/tools";
import { applyPatch, parsePatch, type StructuredPatch } from "diff";
import { unlink } from "node:fs/promises";
import { z } from "zod";
import { atomicWriteText, pathExists, readTextFile, type TextFile } from "../core/file-io";
import { toolResultSchema } from "../core/tool-result";
import type { ToolFactoryContext } from "../core/tool-context";

type PlannedChange =
  | { action: "write"; path: string; relative: string; content: string; source?: TextFile }
  | { action: "delete"; path: string; relative: string };

export function createApplyPatchTool(factory: ToolFactoryContext) {
  return createTool({
    id: "apply_patch",
    description: "Apply one or more standard unified diff patches inside the active workspace.",
    requireApproval: factory.requireApproval,
    inputSchema: z.object({
      patch: z.string().min(1).describe("Standard unified diff text"),
    }),
    outputSchema: toolResultSchema,
    mcp: {
      annotations: {
        title: "Apply patch",
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    execute: async ({ patch }, context) => {
      const parsed = parsePatch(patch);
      if (parsed.length === 0) throw new Error("Patch contains no file changes");
      const planned: PlannedChange[] = [];
      for (const filePatch of parsed) planned.push(await planChange(filePatch, factory));

      for (const change of planned) {
        if (context.abortSignal?.aborted) throw context.abortSignal.reason ?? new Error("Patch cancelled");
        if (change.action === "delete") await unlink(change.path);
        else await atomicWriteText(change.path, change.content, change.source);
        factory.versions.forget(change.path);
      }
      return {
        title: `Patched ${planned.length} file${planned.length === 1 ? "" : "s"}`,
        output: planned.map((item) => `${item.action === "delete" ? "Deleted" : "Updated"} ${item.relative}`).join("\n"),
        diff: patch,
        metadata: { files: planned.map((item) => item.relative), count: planned.length },
      };
    },
  });
}

async function planChange(
  filePatch: StructuredPatch,
  factory: ToolFactoryContext,
): Promise<PlannedChange> {
  const oldName = cleanPatchPath(filePatch.oldFileName);
  const newName = cleanPatchPath(filePatch.newFileName);
  const deleting = filePatch.newFileName === "/dev/null";
  const creating = filePatch.oldFileName === "/dev/null";
  if (!creating && !deleting && oldName !== newName) {
    throw new Error(`Patch renames are not supported: ${oldName} -> ${newName}`);
  }
  const logicalPath = deleting ? oldName : newName;
  if (!logicalPath) throw new Error("Patch is missing a file path");
  const resolved = await factory.workspace.resolveForWrite(logicalPath);
  const relative = factory.workspace.relative(resolved);
  const exists = await pathExists(resolved);

  if (deleting) {
    if (!exists) throw new Error(`Cannot delete missing file: ${relative}`);
    await factory.versions.assertFresh(resolved);
    return { action: "delete", path: resolved, relative };
  }

  if (exists) await factory.versions.assertFresh(resolved);
  const source = exists ? await readTextFile(resolved) : undefined;
  const updated = applyPatch(source?.text ?? "", filePatch);
  if (updated === false) throw new Error(`Patch did not apply cleanly to ${relative}`);
  return { action: "write", path: resolved, relative, content: updated, source };
}

function cleanPatchPath(fileName: string | undefined): string {
  if (!fileName) return "";
  if (fileName === "/dev/null") return "";
  const value = fileName.replace(/^"|"$/g, "");
  return value.startsWith("a/") || value.startsWith("b/") ? value.slice(2) : value;
}

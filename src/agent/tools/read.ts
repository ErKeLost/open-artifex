import { createTool } from "@mastra/core/tools";
import { createReadStream } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import readline from "node:readline";
import { z } from "zod";
import { toolResultSchema } from "../core/tool-result";
import type { ToolFactoryContext } from "../core/tool-context";

const DEFAULT_LINE_LIMIT = 2_000;
const MAX_LINE_LENGTH = 2_000;
const MAX_BYTES = 50 * 1024;
const BINARY_SAMPLE_BYTES = 4_096;

const BINARY_EXTENSIONS = new Set([
  ".zip", ".tar", ".gz", ".7z", ".exe", ".dll", ".so", ".class", ".jar",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".wasm", ".bin",
]);

export function createReadTool(factory: ToolFactoryContext) {
  return createTool({
    id: "read",
    description:
      "Read a text file with line numbers or list a directory. Use offset and limit for large files.",
    inputSchema: z.object({
      filePath: z.string().min(1).describe("Absolute or workspace-relative file or directory path"),
      offset: z.number().int().positive().default(1),
      limit: z.number().int().positive().max(DEFAULT_LINE_LIMIT).default(DEFAULT_LINE_LIMIT),
    }),
    outputSchema: toolResultSchema,
    mcp: {
      annotations: { title: "Read file", readOnlyHint: true, openWorldHint: false },
    },
    execute: async ({ filePath, offset, limit }, context) => {
      const resolved = await factory.workspace.resolveForRead(filePath);
      const relative = factory.workspace.relative(resolved);
      const info = await stat(resolved);

      if (info.isDirectory()) {
        const entries = (await readdir(resolved, { withFileTypes: true }))
          .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`)
          .sort((a, b) => a.localeCompare(b));
        const selected = entries.slice(offset - 1, offset - 1 + limit);
        const truncated = offset - 1 + selected.length < entries.length;
        return {
          title: relative,
          output: selected.length ? selected.join("\n") : "Directory is empty.",
          metadata: {
            path: resolved,
            kind: "directory",
            offset,
            count: selected.length,
            total: entries.length,
            truncated,
          },
        };
      }

      if (!info.isFile()) throw new Error(`Unsupported file type: ${resolved}`);
      if (await isBinary(resolved)) throw new Error(`Cannot read binary file as text: ${relative}`);

      const window = await readLineWindow(resolved, offset, limit, context.abortSignal);
      await factory.versions.markRead(resolved);
      return {
        title: relative,
        output: window.lines.length
          ? window.lines.map(({ number, text }) => `${number}: ${text}`).join("\n")
          : "No lines in the requested range.",
        metadata: {
          path: resolved,
          kind: "file",
          lineStart: window.lines.at(0)?.number ?? offset,
          lineEnd: window.lines.at(-1)?.number ?? offset,
          truncated: window.truncated,
          bytes: window.bytes,
        },
      };
    },
  });
}

async function isBinary(filePath: string): Promise<boolean> {
  const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  if (BINARY_EXTENSIONS.has(extension)) return true;
  const handle = await open(filePath, "r");
  try {
    const sample = Buffer.alloc(BINARY_SAMPLE_BYTES);
    const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
    if (bytesRead === 0) return false;
    let unusual = 0;
    for (const byte of sample.subarray(0, bytesRead)) {
      if (byte === 0) return true;
      if (byte < 9 || (byte > 13 && byte < 32)) unusual += 1;
    }
    return unusual / bytesRead > 0.3;
  } finally {
    await handle.close();
  }
}

async function readLineWindow(
  filePath: string,
  offset: number,
  limit: number,
  signal?: AbortSignal,
) {
  const input = createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  const result: Array<{ number: number; text: string }> = [];
  let lineNumber = 0;
  let bytes = 0;
  let truncated = false;

  try {
    for await (const rawLine of lines) {
      if (signal?.aborted) throw signal.reason ?? new Error("Read cancelled");
      lineNumber += 1;
      if (lineNumber < offset) continue;
      if (result.length >= limit) {
        truncated = true;
        break;
      }
      const text =
        rawLine.length > MAX_LINE_LENGTH
          ? `${rawLine.slice(0, MAX_LINE_LENGTH)}... (line truncated)`
          : rawLine;
      const nextBytes = Buffer.byteLength(text) + 1;
      if (bytes + nextBytes > MAX_BYTES) {
        truncated = true;
        break;
      }
      bytes += nextBytes;
      result.push({ number: lineNumber, text });
    }
  } finally {
    lines.close();
    input.destroy();
  }
  return { lines: result, bytes, truncated };
}

import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export type TextFile = {
  text: string;
  bom: boolean;
  lineEnding: "\n" | "\r\n";
};

export async function readTextFile(filePath: string): Promise<TextFile> {
  const raw = await readFile(filePath, "utf8");
  const bom = raw.charCodeAt(0) === 0xfeff;
  const text = bom ? raw.slice(1) : raw;
  return {
    text,
    bom,
    lineEnding: text.includes("\r\n") ? "\r\n" : "\n",
  };
}

export function encodeTextFile(text: string, source?: TextFile): string {
  const normalized = text.replaceAll("\r\n", "\n");
  const body = source?.lineEnding === "\r\n" ? normalized.replaceAll("\n", "\r\n") : normalized;
  return source?.bom ? `\uFEFF${body}` : body;
}

export async function atomicWriteText(
  filePath: string,
  text: string,
  source?: TextFile,
): Promise<void> {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  let mode: number | undefined;
  try {
    mode = (await stat(filePath)).mode;
  } catch {
    mode = undefined;
  }

  try {
    await writeFile(temporary, encodeTextFile(text, source), "utf8");
    if (mode !== undefined) await chmod(temporary, mode);
    await rename(temporary, filePath);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

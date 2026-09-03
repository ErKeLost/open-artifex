import { existsSync } from "node:fs";
import path from "node:path";

function findProjectRoot(start: string): string {
  let current = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(current, "package.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(start);
    current = parent;
  }
}

export const workspaceRoot = path.resolve(
  process.env.OPEN_ARTIFEX_WORKSPACE ?? findProjectRoot(process.cwd()),
);

export const dataDirectory = path.resolve(
  process.env.OPEN_ARTIFEX_DATA_DIR ?? path.join(workspaceRoot, ".open-artifex"),
);

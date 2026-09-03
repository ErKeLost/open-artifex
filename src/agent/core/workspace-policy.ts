import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";

export class WorkspaceBoundaryError extends Error {
  constructor(
    readonly requestedPath: string,
    readonly workspaceRoot: string,
  ) {
    super(`Path is outside the active workspace: ${requestedPath}`);
    this.name = "WorkspaceBoundaryError";
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function nearestExistingParent(candidate: string): Promise<string> {
  let current = candidate;
  for (;;) {
    try {
      await access(current);
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) throw new Error(`No existing parent for ${candidate}`);
      current = parent;
    }
  }
}

export class WorkspacePolicy {
  private constructor(
    readonly root: string,
    private readonly canonicalRoot: string,
  ) {}

  static async create(workspaceRoot: string): Promise<WorkspacePolicy> {
    const root = path.resolve(workspaceRoot);
    const info = await stat(root);
    if (!info.isDirectory()) throw new Error(`Workspace is not a directory: ${root}`);
    return new WorkspacePolicy(root, await realpath(root));
  }

  async resolveForRead(inputPath: string): Promise<string> {
    const requested = this.resolveLexically(inputPath);
    const canonical = await realpath(requested);
    this.assertInside(canonical, inputPath);
    return canonical;
  }

  async resolveForWrite(inputPath: string): Promise<string> {
    const requested = this.resolveLexically(inputPath);
    const existingParent = await nearestExistingParent(requested);
    const canonicalParent = await realpath(existingParent);
    this.assertInside(canonicalParent, inputPath);

    const remainder = path.relative(existingParent, requested);
    const resolved = path.resolve(canonicalParent, remainder);
    this.assertInside(resolved, inputPath);
    return resolved;
  }

  relative(absolutePath: string): string {
    return path.relative(this.canonicalRoot, absolutePath) || ".";
  }

  private resolveLexically(inputPath: string): string {
    const requested = path.isAbsolute(inputPath)
      ? path.resolve(inputPath)
      : path.resolve(this.root, inputPath);
    this.assertInside(requested, inputPath);
    return requested;
  }

  private assertInside(candidate: string, requestedPath: string): void {
    const normalize = (value: string) =>
      process.platform === "win32" ? value.toLowerCase() : value;
    if (!isInside(normalize(this.canonicalRoot), normalize(candidate))) {
      throw new WorkspaceBoundaryError(requestedPath, this.root);
    }
  }
}

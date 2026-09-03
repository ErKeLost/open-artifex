import { stat } from "node:fs/promises";

type FileVersion = {
  mtimeMs: number;
  size: number;
};

export class FileChangedSinceReadError extends Error {
  constructor(readonly filePath: string) {
    super(`File changed since it was last read: ${filePath}`);
    this.name = "FileChangedSinceReadError";
  }
}

export class FileNotReadError extends Error {
  constructor(readonly filePath: string) {
    super(`Read the existing file before modifying it: ${filePath}`);
    this.name = "FileNotReadError";
  }
}

export class FileVersionTracker {
  private readonly versions = new Map<string, FileVersion>();

  async markRead(filePath: string): Promise<void> {
    const info = await stat(filePath);
    this.versions.set(filePath, { mtimeMs: info.mtimeMs, size: info.size });
  }

  async assertFresh(filePath: string): Promise<void> {
    const recorded = this.versions.get(filePath);
    if (!recorded) throw new FileNotReadError(filePath);
    const current = await stat(filePath);
    if (recorded.mtimeMs !== current.mtimeMs || recorded.size !== current.size) {
      throw new FileChangedSinceReadError(filePath);
    }
  }

  forget(filePath: string): void {
    this.versions.delete(filePath);
  }
}

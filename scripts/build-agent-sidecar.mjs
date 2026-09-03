import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";

const platformTargets = {
  darwin: {
    arm64: { bun: "bun-darwin-arm64", triple: "aarch64-apple-darwin" },
    x64: { bun: "bun-darwin-x64", triple: "x86_64-apple-darwin" },
  },
  linux: {
    arm64: { bun: "bun-linux-arm64", triple: "aarch64-unknown-linux-gnu" },
    x64: { bun: "bun-linux-x64", triple: "x86_64-unknown-linux-gnu" },
  },
  win32: {
    x64: { bun: "bun-windows-x64", triple: "x86_64-pc-windows-msvc" },
  },
};

const target = platformTargets[process.platform]?.[process.arch];
if (!target) {
  throw new Error(`Unsupported sidecar target: ${process.platform}/${process.arch}`);
}

const binariesDirectory = path.resolve("src-tauri/binaries");
const extension = process.platform === "win32" ? ".exe" : "";
const output = path.join(
  binariesDirectory,
  `open-artifex-agent-${target.triple}${extension}`,
);

await mkdir(binariesDirectory, { recursive: true });
const result = Bun.spawnSync([
  process.execPath,
  "build",
  "--compile",
  `--target=${target.bun}`,
  "src/agent/stdio-worker.ts",
  "--outfile",
  output,
], {
  cwd: process.cwd(),
  stderr: "inherit",
  stdout: "inherit",
});
if (result.exitCode !== 0) {
  throw new Error("Unable to build the bundled agent sidecar");
}
if (process.platform !== "win32") await chmod(output, 0o755);

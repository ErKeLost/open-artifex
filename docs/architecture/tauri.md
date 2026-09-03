# Tauri 2 architecture

Open Artifex uses Tauri 2 as the desktop boundary. The React webview has no
filesystem, shell, credential, or agent authority. It calls a small
`@tauri-apps/api` adapter; Rust validates requests, owns native capabilities,
and publishes typed events.

```text
React renderer
  -> @tauri-apps/api/core invoke + @tauri-apps/api/event listen
  -> Rust Tauri commands and managed state
       ├─ workspace capability registry
       ├─ system credential provider
       ├─ terminal process manager
       └─ JSONL agent bridge
            -> Node/Bun stdio worker
                 -> Mastra AgentController + schedules + LibSQL
```

## Boundaries

- `src/renderer/tauri-api.ts` is the only renderer adapter. It converts Tauri
  promise rejections into the existing `DesktopResult` shape and validates
  event payloads before dispatching them to React.
- `src-tauri/src/lib.rs` owns commands, capability checks, process cleanup,
  terminal output snapshots, and the event names `agent:event`,
  `terminal:event`, and `browser:event`.
- `src/agent/stdio-worker.ts` hosts the Mastra runtime over newline delimited
  JSON. Secrets are inserted by Rust into internal requests; they are never
  supplied by renderer input. Interactive and scheduled work use the same
  workspace-scoped LibSQL memory store, so scheduled results appear in their
  target conversation.
- `src/shared/*` remains free of Tauri, Rust, and Mastra imports.

## Agent process

Rust starts `OPEN_ARTIFEX_AGENT_COMMAND` when set. In development it otherwise
uses `bun run src/agent/stdio-worker.ts`; release builds compile the same worker
as a Tauri external binary placed beside the application executable. Messages
use the existing versioned agent protocol. Rust reads worker stdout on a
dedicated thread and forwards only validated event envelopes to the webview.
Shutdown kills the child after the window is destroyed.

## Tauri security

The default capability grants only core window/event functionality. No shell,
filesystem, or arbitrary process plugin is exposed to the webview. Native
operations are explicit commands with canonical workspace checks. CSP is set in
`src-tauri/tauri.conf.json`; remote navigation is not granted to the app webview.

API keys are stored in the operating system credential service through the
native keyring crate. When the service is unavailable, the app falls back to
memory for the current desktop session and reports that condition to the UI;
keys are never written to a plain-text application file.

## Schedules

The scheduler is Mastra's persisted `mastra.schedules` service backed by the
workspace LibSQL database. The agent host starts Mastra workers while the
desktop app is running. Scheduled work uses a separate read-only agent: it can
inspect files and produce a threaded report, but cannot edit files or execute
shell commands without an interactive approval flow.

## Development and packaging

```sh
bun install
bun run dev       # tauri dev, Vite renderer on 127.0.0.1:5173
bun run check
cargo check --manifest-path src-tauri/Cargo.toml
bun run build     # vite build followed by tauri build
```

Tauri owns the application window and packaging. There is no privileged
renderer bridge bundle or second desktop runtime in the build.

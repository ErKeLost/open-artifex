# Harness reference architecture

Status: decision record for the Open Artifex desktop harness.

## Scope

This document records the harness ideas worth borrowing from the five pinned upstream repositories and maps them onto the exact Mastra packages installed in this checkout. It is not a plan to embed or port an upstream loop.

Open Artifex keeps Mastra as the execution authority:

- construct the coding agent with `new Agent()`;
- define every model-facing capability with `createTool()` or another documented Mastra primitive;
- use `SkillSearchProcessor` for dynamic, on-demand skill loading;
- use Mastra memory and LibSQL for persisted threads;
- use `AgentController` as the interactive session control plane behind the Tauri bridge;
- keep the Tauri command/event protocol transport-neutral and project Mastra events into it;
- do not call `createCodingAgent()`.

The upstreams are pinned at these revisions:

| Upstream | Revision | Role in this research |
| --- | --- | --- |
| OpenAI Codex | `8d32abcd017d06511b46050cff9dbba8738fc2fa` | tool routing, approval, cancellation, lifecycle events, skills, memory consolidation |
| OpenCode | `69c172e8a7c0086887b1f93ed5a162f14b6aa0c5` | concrete coding-tool behavior and result metadata |
| Pi | `8d1b1178cdf90ac5a3995f9cc9daf7d081d85373` | compact event vocabulary, steering/follow-up queues, parallel result ordering, branchable session records |
| DeepSeek Harness | `49a606bc5b5934603f22a26957a07dc799ab0291` | plugin seams, durable event projection, scoped tool/skill registries, cancellation and guarded self-modification |
| OpenAI Symphony | `8001b52e3062495a16e520e4ceaf8f9de868c4d0` | outer work scheduler, isolated workspaces, reconciliation and retry |

Installed Mastra versions used for the mapping are `@mastra/core@1.63.2`, `@mastra/memory@1.28.1`, `@mastra/libsql@1.22.2`, and `@mastra/observability@1.17.5`.

## Architecture decision

```text
  React renderer
  -> typed Tauri invoke/listen API
  -> Rust Tauri application
  -> stdio agent host (one trusted agent process)
       -> AgentController (live session authority)
            -> regular Mastra Agent
                 -> OpenRouter model
                 -> custom createTool() coding tools
                 -> SkillSearchProcessor
                 -> Memory + LibSQL
                 -> Mastra subagents/workflows/background tasks
                 -> Observability + Dataset/Experiment improvement loop
```

The agent host is an isolation and lifecycle boundary, not a second backend product. There is no requirement for a Hono or other localhost HTTP server. The packaged desktop app communicates through typed Tauri commands and events.

`AgentController` is beta in Mastra 1.63.2, so it stays behind the existing `AgentRuntime` interface. Pinning it behind that adapter gives the desktop a stable internal protocol even if a later Mastra upgrade changes controller types.

## Source findings

### OpenCode: coding-tool behavior

OpenCode is the primary behavioral reference for the leaf tools, not for the host loop.

- The common tool context carries session/message/call identity, an `AbortSignal`, streaming metadata updates, an approval callback, and the prior message view. Result objects separate `title`, `metadata`, model-facing `output`, and attachments. Source: `upstreams/opencode/packages/opencode/src/tool/tool.ts:36-65`.
- Input validation happens at one tool boundary; invalid arguments become a model-correctable error, while generic result truncation happens after leaf execution. Source: `upstreams/opencode/packages/opencode/src/tool/tool.ts:99-145`.
- Generic output bounding uses both line and UTF-8 byte limits, writes the complete value to retained storage, and returns a preview plus a retrieval hint. Source: `upstreams/opencode/packages/opencode/src/tool/truncate.ts:12-43` and `:85-140`.
- `read` accepts a path plus one-indexed `offset` and `limit`, bounds individual line size and total bytes, handles directories, rejects unsupported binary files, and returns UI-oriented display metadata. Source: `upstreams/opencode/packages/opencode/src/tool/read.ts:13-36` and `:229-376`.
- `glob` and `grep` are bounded searches. `glob` validates that its root is a directory and caps results; `grep` groups matches by file and retains line numbers. Source: `upstreams/opencode/packages/opencode/src/tool/glob.ts:10-72` and `upstreams/opencode/packages/opencode/src/tool/grep.ts:10-112`.
- `edit` performs a read-before-write freshness check, rejects ambiguous replacements, builds the diff before asking permission, writes under a per-file lock, then publishes file and LSP updates. Source: `upstreams/opencode/packages/opencode/src/tool/edit.ts:58-212` and ambiguity handling at `:682-729`.
- `write` constructs the complete diff before approval, preserves BOM state, formats after writing, and reports LSP diagnostics. Source: `upstreams/opencode/packages/opencode/src/tool/write.ts:20-100`.
- `apply_patch` parses and verifies every hunk, plans all file changes and their diffs first, asks once over the complete path set, then mutates and reports diagnostics. Source: `upstreams/opencode/packages/opencode/src/tool/apply_patch.ts:18-215` and `:217-303`.
- The shell tool parses commands to derive permission patterns and external-directory access, streams bounded output, spills overflow, races exit/abort/timeout, and kills the process group before returning. Source: `upstreams/opencode/packages/opencode/src/tool/shell.ts:257-310`, `:378-426`, and `:428-595`.
- Permission rules use last-match-wins wildcard evaluation, with explicit `allow`, `ask`, and `deny`. Pending approvals are settled once, can grant reusable patterns, and are rejected on teardown. Source: `upstreams/opencode/packages/opencode/src/permission/index.ts:28-38` and `:42-174`.
- Tool state is a real state machine: `pending -> running -> completed | error`. Streamed metadata is retained on failure, and interrupted calls are terminalized instead of leaving dangling provider tool calls. Source: `upstreams/opencode/packages/opencode/src/session/processor.ts:123-205`, `:216-419`, and `:553-608`.
- A session-level cancel reaches foreground work and descendant background jobs. Source: `upstreams/opencode/packages/opencode/src/session/run-state.ts:71-107` and `:111-143`.
- Skills are discovered from project, user, configured, and remote roots; the model initially receives only metadata, while the `skill` tool loads one complete body and a sampled supporting-file list. Source: `upstreams/opencode/packages/opencode/src/skill/index.ts:173-233`, `:248-345`, and `upstreams/opencode/packages/opencode/src/tool/skill.ts:8-66`.
- Plugins are deterministic ordered hooks, but Open Artifex does not need to reproduce this plugin runtime. Source: `upstreams/opencode/packages/opencode/src/plugin/index.ts:114-125`, `:219-280`, and `:284-308`.

What to borrow: leaf semantics, bounded results, preview metadata, read-before-write, plan-before-mutate, and explicit terminal states. What not to borrow: OpenCode's Effect runtime, plugin loader, database schema, or session loop.

### Codex: lifecycle, approval, progressive skills, and governed memory

- Codex separates the registry/runtime from the model-visible tool plan. A finalized router can expose a tool directly, through code mode, or through deferred search without changing the runtime identity. Source: `upstreams/codex/codex-rs/core/src/tools/router.rs:73-209`.
- A tool invocation carries stable tool/call identity and a cancellation token all the way to the registered runtime. Source: `upstreams/codex/codex-rs/core/src/tools/router.rs:245-297` and `:323-381`.
- The tool registry owns collision policy and rejects reserved-name or duplicate external tools. It runs pre-tool hooks before dispatch and post-tool hooks before accepting the result. Source: `upstreams/codex/codex-rs/core/src/tools/registry.rs:280-388`, `:495-623`, and `:644-755`.
- Start/finish/aborted lifecycle callbacks are distinct and receive session/thread/turn stores plus the stable call identity. Source: `upstreams/codex/codex-rs/core/src/tools/lifecycle.rs:17-50` and `:76-128`.
- Tool UI events have explicit begin/success/failure stages. Command begin events include command, cwd, parsed command, status, stdout/stderr and duration fields; patch events carry structured changes. Source: `upstreams/codex/codex-rs/core/src/tools/events.rs:43-83`, `:108-179`, and `:181-260`.
- Approval is an action-specific domain for command, stdin, patch, MCP, network and permission requests. Hooks run first, then an automatic reviewer or the user; cancellation participates in review. Source: `upstreams/codex/codex-rs/core/src/tools/approvals.rs:54-151`, `:433-600`, and `:602-694`.
- A run is an owned task with a cancellation token and cleanup hook. Abort first signals cooperative cancellation, waits briefly, then aborts the task, records an interruption marker, runs interruption hooks, and emits a terminal event. Source: `upstreams/codex/codex-rs/core/src/tasks/mod.rs:171-219`, `:270-411`, and `:902-1003`.
- The protocol has correlated top-level events plus granular turn, reasoning, command, patch, approval, item and delta variants. Source: `upstreams/codex/codex-rs/protocol/src/protocol.rs:1336-1356` and `:1397-1547`.
- Skill guidance explicitly uses progressive disclosure: list metadata, fully read a selected `SKILL.md`, then load only referenced files as required. Source: `upstreams/codex/codex-rs/ext/skills/src/catalog_prompt.rs:3-40` and `:81-105`.
- The skill loader separates metadata from the owner-managed snapshot cache. Source: `upstreams/codex/codex-rs/skills/src/loading.rs:14-46` and `:98-115`; skill metadata includes invocation policy, scope, dependency and presentation fields in `upstreams/codex/codex-rs/skills/src/model.rs:6-94`.
- Codex's memory pipeline is a useful model for safe improvement. Phase 1 claims bounded rollout jobs and extracts structured `raw_memory` plus `rollout_summary`; Phase 2 serializes global consolidation behind a lease, computes a Git-baseline diff, launches a locked-down internal agent, validates artifacts, and only then advances the baseline. Source: `upstreams/codex/codex-rs/memories/README.md` sections “Phase 1” and “Phase 2”; implementation at `upstreams/codex/codex-rs/memories/write/src/phase1.rs:51-109`, `:150-223`, and `upstreams/codex/codex-rs/memories/write/src/phase2.rs:47-205`.
- The consolidation agent disables recursive memory, apps, plugins, skills dependency installation and collaboration, uses no approvals, has no network, and writes only inside the memory root. Source: `upstreams/codex/codex-rs/memories/write/src/phase2.rs:312-369`. It validates output artifacts and rejects symlinks before committing the new baseline: `upstreams/codex/codex-rs/memories/write/src/workspace.rs:41-81`.

What to borrow: stable identities, begin/delta/end events, cancellation as lifecycle, progressive skills, and staged/validated memory improvement. What not to borrow: the Rust runtime, Guardian reviewer, sandbox implementation, Responses transport, or Codex-specific protocol.

### Pi: small event algebra and ordering rules

- Pi's public loop vocabulary is deliberately small: agent, turn, message and tool start/update/end. Source: `upstreams/pi/packages/agent/src/types.ts:429-444`.
- `Agent` owns state, sequentially awaits event listeners, exposes one-at-a-time or all-at-once steering/follow-up queues, and propagates one abort signal through the run. Source: `upstreams/pi/packages/agent/src/agent.ts:125-165`, `:167-253`, `:282-329`, and `:486-535`.
- The loop checks steering at safe turn boundaries and follow-up only when it would otherwise stop. Source: `upstreams/pi/packages/agent/src/agent-loop.ts:156-272`.
- Tool arguments are prepared and validated before execution; a before hook can block, an after hook can transform the result, and every failure becomes a tool result rather than an orphaned call. Source: `upstreams/pi/packages/agent/src/agent-loop.ts:593-675` and `:677-797`.
- In parallel mode, preflight remains ordered, completion events can arrive in completion order, but durable/model tool-result messages are emitted in the assistant's original call order. Source: `upstreams/pi/packages/agent/src/types.ts:34-42` and `upstreams/pi/packages/agent/src/agent-loop.ts:487-560`.
- Its event bus offers a race-free “capture snapshot, buffer until listener starts, then flush in order” watch primitive. Source: `upstreams/pi/packages/agent/src/harness/events.ts:75-100`.
- The newer session design records append-only entries and operation records, including operation start/finish, abort request, tool start, queues and usage. Source: `upstreams/pi/packages/agent/src/harness/session/types.ts:14-74` and `:80-212`. The SQLite backend preserves parent links as canonical and keeps branch tables as derived caches: `upstreams/pi/packages/session-backends/sqlite-node/src/sqlite/migrations/001_initial.sql:12-85`.
- Pi's skill loader honors ignore files, stops descending once it finds a `SKILL.md`, validates metadata and keeps full content separate from discovery. Source: `upstreams/pi/packages/agent/src/harness/skills.ts:43-75`, `:104-175`, and `:248-299`.

What to borrow: compact UI event names, queue semantics, source-order result commits, and snapshot-plus-stream reconnection. What not to borrow: Pi's model transport, its incomplete experimental `AgentHarness`, or its custom session repository.

### DeepSeek Harness: extension seams and durable projection

- DeepSeek's core invariant is “model-visible implies logged”: the session log is the source of model history, and the loop, UI and persistence derive from it. Source: `upstreams/deepseek-harness/docs/architecture.md` sections “Events”, “Turn flow”, and “Session log”.
- The tool service has explicit `pre-execute`, around-`execute`, `post-execute`, final-result and change events. Tool definitions declare JSON input/output behavior, cooperative cancellation, optional timeout, concurrency safety and pure call/result presentation. Source: `upstreams/deepseek-harness/packages/core/tools/src/index.ts:129-200` and `:203-280`.
- Tool executions carry stable root/call identity and a required caller-owned signal. The registry snapshots arguments, runs policy and monotonic guards in order, fuses wrapper cancellation back with caller cancellation, drains started work, then materializes and notifies once. Source: `upstreams/deepseek-harness/packages/core/tools/src/index.ts:297-417`, `:1319-1498`, and `:1500-1550`.
- Final result observers are contained so one bad callback cannot change the committed outcome or starve other listeners. Source: `upstreams/deepseek-harness/packages/core/tools/src/index.ts:1647-1667`.
- Approval is fail-closed and audited as paired `approval/asked` and `approval/decided` events. Only `allowed-once` grants execution; abort wins over late answers. Source: `upstreams/deepseek-harness/packages/interaction/user-approval/src/types.ts:13-90` and `upstreams/deepseek-harness/packages/interaction/user-approval/src/index.ts:189-225`, `:252-297`.
- The loop appends turn/step boundaries, raw assistant chunks, assembled messages, tool calls and results. It finalizes interrupted assistant prefixes and records synthetic error results for model tool calls skipped after cancellation. Source: `upstreams/deepseek-harness/packages/core/agent-loop/src/agent.ts:234-339`, `:341-437`, and `upstreams/deepseek-harness/packages/core/agent-loop/src/tool-calls.ts:41-101`, `:113-247`.
- Session events are an append-only, contiguous, lossless-JSON discriminated union. Message-producing events declare how they join the ordered model surface; model history is an incremental projection of that surface. Source: `upstreams/deepseek-harness/packages/core/session/src/types.ts:255-365`, `:367-468`, `upstreams/deepseek-harness/packages/core/session/src/index.ts:633-719`, and `:765-810`.
- The skill registry is provider-based, per-scope, abortable and cache-invalidated. It lists summaries and loads the winning full body on demand. Source: `upstreams/deepseek-harness/packages/skill/skill/src/index.ts:232-299`, `:347-430`, `:464-519`, and `:521-661`.
- The model-facing skill tool checks current visibility both before and after loading, and the durable catalog is replaced when its digest changes. Source: `upstreams/deepseek-harness/packages/skill/tool-skill/src/index.ts:71-161`, `:206-251`, and `:254-335`.
- The filesystem provider watches project/user/bundled roots, invalidates the catalog after relevant writes, and closes all watchers at teardown. Source: `upstreams/deepseek-harness/packages/skill/skill-filesystem/src/index.ts:129-174`, `:176-238`, and `:283-310`, `:542-596`.
- DeepSeek's self-referential extension tools use inspect -> define immutable version -> run/update -> stop/undefine. Definitions are process-local and session-owned, and browser code requires approval. The authors explicitly state that the VM is not a security boundary. Source: `upstreams/deepseek-harness/packages/extensions/tool-cordis/src/index.ts:33-61`, `:151-307`, `:332-391`; lifecycle at `upstreams/deepseek-harness/packages/extensions/cordis-host-runner/src/index.ts:146-217`, `:238-312`; warning in `upstreams/deepseek-harness/packages/extensions/tool-cordis/README.md` section “Trust stance”.

What to borrow: clear extension points, immutable version identities, inspect-before-change, durable projection and fail-closed cancellation. What not to borrow: Cordis, live JavaScript plugin execution, or an agent-writable runtime registry.

### Symphony: the outer work layer

Symphony is not an inner coding-agent loop. It is prior art for the future “work” layer that assigns durable project tasks to isolated agent sessions.

- One orchestrator owns all scheduling state: running, claimed, blocked, retry timers and aggregate usage. Source: `upstreams/symphony/elixir/lib/symphony_elixir/orchestrator.ex:24-44`.
- Every poll reconciles active work before validating and dispatching new work. Source: `upstreams/symphony/elixir/lib/symphony_elixir/orchestrator.ex:256-332`.
- Reconciliation cancels work made ineligible by external state, cleans terminal workspaces, and separately detects stalled sessions. Source: `upstreams/symphony/elixir/lib/symphony_elixir/orchestrator.ex:421-439`, `:554-579`, and `:581-639`.
- Dispatch checks claims and global/per-state concurrency, refreshes the issue immediately before launch, and records the claim only after the worker starts. Source: `upstreams/symphony/elixir/lib/symphony_elixir/orchestrator.ex:781-839` and `:907-1003`.
- Retry replaces the previous timer, uses a stable token to ignore stale timer messages, refreshes external state before retrying, and applies bounded exponential backoff. Source: `upstreams/symphony/elixir/lib/symphony_elixir/orchestrator.ex:1034-1135` and `:1232-1243`.
- The worker reuses one agent session for bounded continuation turns instead of resending the original task. Source: `upstreams/symphony/elixir/lib/symphony_elixir/agent_runner.ex:88-153`.
- Workspaces use a sanitized identifier plus stable hash, are validated beneath the configured root, reject a symlink escape, and run hooks with timeouts. Source: `upstreams/symphony/elixir/lib/symphony_elixir/workspace.ex:13-38`, `:219-287`, `:397-459`, and `:461-510`.
- The language-neutral contract and rationale are in `upstreams/symphony/SPEC.md` sections 7–10 and 14–16.

What to borrow later: one scheduler authority, claims, reconciliation-before-dispatch, bounded retry and isolated workspace ownership. What not to put in the chat loop: polling, issue-tracker state or worker scheduling.

## Mapping to Mastra 1.63.2

The following are verified against the embedded documentation and declaration files in the installed packages, not against remembered APIs.

| Need | Mastra primitive | Exact installed reference |
| --- | --- | --- |
| Base agent without canned harness | `new Agent({...})` | `node_modules/@mastra/core/dist/docs/references/reference-agents-agent.md`, “Constructor parameters” |
| Dynamic model, tools, instructions and processors | `DynamicArgument` resolver using `requestContext` | `node_modules/@mastra/core/dist/agent/types.d.ts:643-708`; `node_modules/@mastra/core/dist/agent/agent.d.ts:748-762` |
| Collaborative desktop session | `new AgentController({ agent, storage, workspace, ... })` and `controller.createSession()` | `node_modules/@mastra/core/dist/docs/references/docs-harness-agent-controller.md`, “Quickstart” and “Understand the runtime model” |
| Run/steer/follow-up/cancel | `Session.sendMessage()`, `.steer()`, `.followUp()`, `.abort()` | `node_modules/@mastra/core/dist/docs/references/reference-agent-controller-session.md`, “Messages and run control” |
| UI-ready live state | `Session.subscribe()`, `session.displayState.get()`, `display_state_changed` | same reference, “Identity and events” and “Display state”; type source `node_modules/@mastra/core/dist/agent-controller/types.d.ts:465-559` |
| Fine-grained controller events | `tool_input_*`, `tool_start`, `tool_update`, `tool_end`, `shell_output`, `command_exit`, `usage_update`, `agent_end` | `node_modules/@mastra/core/dist/agent-controller/types.d.ts:569-690` |
| Custom coding tools | `createTool({ id, inputSchema, outputSchema, execute })` | `node_modules/@mastra/core/dist/docs/references/reference-tools-create-tool.md`, “Parameters” |
| Cancellation inside tools | `execute(input, { abortSignal })` | same reference, `execute.context.abortSignal` |
| Model result vs application result | `toModelOutput` and `transform.display` / `transform.transcript` | same reference, “Example with toModelOutput” and “Example with transform” |
| Tool lifecycle telemetry | `onInputStart`, `onInputDelta`, `onInputAvailable`, `onOutput` plus agent `hooks` | same reference, “Tool lifecycle hooks”; `reference-agents-agent.md`, “Tool hooks” |
| Pre-execution approval | `requireApproval`, request-level `requireToolApproval`, or controller permission policy | `node_modules/@mastra/core/dist/docs/references/docs-agents-human-in-the-loop.md`, “Pre-execution approval”; controller guide, “Approve tools and resume suspensions” |
| Approval persistence/recovery | `Agent.listSuspendedRuns()`, `approveToolCall()`, `declineToolCall()` with Mastra storage | `node_modules/@mastra/core/dist/docs/references/reference-agents-listSuspendedRuns.md` |
| Full raw event stream | `MastraModelOutput.fullStream` | `node_modules/@mastra/core/dist/docs/references/reference-streaming-agents-MastraModelOutput.md`, “Streaming properties” |
| Stream event vocabulary | text/reasoning/tool input/tool call/tool result/step/finish/error/abort chunks | `node_modules/@mastra/core/dist/docs/references/reference-streaming-ChunkType.md`; exact approval/suspension union at `node_modules/@mastra/core/dist/stream/types.d.ts:807-894` |
| Dynamic skill discovery | `new SkillSearchProcessor({ workspace, search, blockingRefresh: true })` | `node_modules/@mastra/core/dist/docs/references/reference-processors-skill-search-processor.md` |
| Skill supporting files | processor-provided `search_skills`/`load_skill` plus agent-level `skill_read` | same reference, “Workspace file tools”; implementation at `node_modules/@mastra/core/dist/agent-B8m3ps7U.js:34384-34455` and `:15674-15907` |
| Dynamic skill roots | `Workspace.skills` resolver or Agent `skills` resolver | `node_modules/@mastra/core/dist/docs/references/docs-sandbox-skills.md`, “Dynamic skill paths”; `node_modules/@mastra/core/dist/agent/types.d.ts:666-708` |
| Inline/version-produced skills | `createSkill()` | `node_modules/@mastra/core/dist/docs/references/reference-agents-createSkill.md` |
| Local conversation storage | `Memory` + `LibSQLStore` | `node_modules/@mastra/memory/dist/docs/references/reference-memory-memory-class.md`; `node_modules/@mastra/libsql/dist/docs/references/integrations-databases-libsql.md` |
| Long-context observation/reflection | `Memory({ options: { observationalMemory: ... } })` | `node_modules/@mastra/core/dist/docs/references/docs-memory-observational-memory.md` |
| Structured task list | `TaskSignalProvider` | `node_modules/@mastra/core/dist/docs/references/reference-tools-task-tools.md` |
| Durable objective | Agent `goal`, `setObjective()`, typed `goal` chunks | `node_modules/@mastra/core/dist/docs/references/docs-harness-goals.md` |
| Deterministic multi-stage jobs | `createWorkflow()`, `createStep()`, `.commit()` | `node_modules/@mastra/core/dist/docs/references/docs-workflows-overview.md` |
| Long-running tool jobs | Mastra `backgroundTasks`, `untilIdle`, manager events | `node_modules/@mastra/core/dist/docs/references/docs-harness-background-tasks.md` |
| Subagents | Agent `agents` plus delegation options; optionally background-task execution | `node_modules/@mastra/core/dist/docs/references/docs-subagents.md` and `docs-harness-background-tasks.md`, “Subagents in the background” |
| Persisted local traces and human feedback | `Observability` + `MastraStorageExporter` + `addFeedback()` | `node_modules/@mastra/observability/dist/default.d.ts`; `reference-observability-feedback.md` |
| Versioned candidate/evaluation records | `mastra.datasets`, `Dataset.createExperiment()`, `submitExperimentResult()`, `finalizeExperiment()` | `node_modules/@mastra/core/dist/docs/references/docs-datasets-overview.md`; `docs-datasets-running-experiments.md` |
| Human publication gate | workflow `suspend()` / `Run.resume()` | `node_modules/@mastra/core/dist/docs/references/docs-workflows-suspend-and-resume.md` |

### Important API consequences

1. The active workspace must be request/session scoped. `Agent.tools`, `Agent.workspace`, `Agent.skills`, `Agent.model`, and processors can resolve from `RequestContext`; a module-load global workspace is not sufficient when the desktop can select different folders.
2. Keep the OpenCode-like leaf semantics inside Mastra `createTool()` implementations. Do not build a second model/tool loop around `Agent.stream()`.
3. Let `AgentController` own live permission state, pending approvals, steer/follow-up queues, run cancellation and display state. The Node stdio worker only bridges those events and decisions across JSONL.
4. `SkillSearchProcessor` is the requested processor-based loader. With on-demand discovery it injects `search_skills` and `load_skill`, suppresses eager `skill`/`skill_search`, and leaves `skill_read` available. The implementation adds skill tools separately from ordinary workspace tools, so disabling generated workspace filesystem/sandbox tools does not remove `skill_read` (`agent-B8m3ps7U.js:34374-34455`).
5. `requireApproval` snapshots need Mastra storage. The existing LibSQL store therefore backs both thread memory and resumable approval snapshots.
6. `AgentController` events already match the desired timeline closely. Prefer adapting these events over inventing tool-state inference from text.

## Target runtime behavior

### Session ownership

Create one `AgentController` per agent host and one controller `Session` per active desktop conversation/workspace scope. The Session owns the active thread, run, mode, model selection, grants, approval and stream. The neutral bridge `runId` and Mastra `runId` must be correlated explicitly; neither should be inferred from timing.

The existing `src/shared/agent-protocol.ts` remains the JSON-safe contract. `src/agent/stdio-worker.ts` adapts controller Session methods rather than becoming an independent approval/run state machine:

- `agent.run` -> create or resolve the controller Session, bind its thread/workspace, then `session.sendMessage()`;
- `agent.cancel` -> `session.abort()`;
- `agent.approval.resolve` -> `session.respondToToolApproval()`;
- controller events -> monotonic `AgentEvent` messages;
- `display_state_changed` -> a replaceable snapshot for reconnect/reducer recovery.

Controller grants, pending approval UI state and other live Session fields are not automatically durable. After a process restart, recreate the Session from its stored thread, query the backing Agent with `listSuspendedRuns({ threadId, resourceId })`, and explicitly re-project any suspended Mastra run into the desktop. Do not infer a pending approval from an incomplete timeline row.

### Workspace and model resolution

Place these validated values in a Mastra `RequestContext` created inside the agent host:

- canonical workspace root;
- thread/resource identity;
- selected OpenRouter model;
- session permission mode;
- non-secret UI and trace metadata.

The renderer never supplies the API key. The agent host receives it only in an internal message from Rust and creates the OpenRouter model there. Tool and Workspace resolvers read only the canonical path already approved by the desktop folder picker.

### Tool contract

All custom coding tools return one common JSON-safe result:

```ts
type CodingToolResult = {
  title: string
  output: string
  metadata: Record<string, unknown>
  diff?: string
}
```

Use the fields as follows:

- `title`: compact timeline label;
- `output`: bounded model-facing result;
- `metadata`: renderer/runtime facts such as path, match count, exit code, elapsed time, truncation, diagnostics and output locator;
- `diff`: raw unified diff, rendered only in the renderer with `@pierre/diffs`.

The UI renderer must not parse prose to recover a path, exit code, diff or status. Those are structured fields.

### Approval policy

Recommended controller categories:

| Category | Tools | Initial policy |
| --- | --- | --- |
| `read` | `read`, `glob`, `grep`, `search_skills`, `load_skill`, `skill_read`, runtime info | allow inside the canonical workspace |
| `edit` | `edit`, `write`, `apply_patch` | ask; allow an explicit session grant |
| `execute` | `bash` and later process/terminal tools | ask; allow an explicit session grant only after showing command and cwd |
| `network` | web search/fetch and network-capable commands | ask or deny according to session mode |
| `dangerous` | deletion outside an already reviewed patch, credential/config mutation | deny by default |

Keep unconditional `requireApproval: true` on destructive leaf tools until category policy is fully wired. Read/search tools should not ask. Every approval card binds to the exact `toolCallId`, tool name and canonical input; a decline reason is returned to the model.

### Cancellation and teardown

The cancellation chain is one-way and complete:

```text
renderer Cancel
  -> Tauri command
  -> agent-host Session.abort()
  -> Mastra abortSignal
  -> createTool execute context
  -> child process / filesystem / network operation
  -> settled tool + agent_end(reason: aborted)
```

Rules:

- Every async tool observes or forwards `abortSignal`.
- A shell abort terminates the process group and waits for exit; teardown does not merely send a signal.
- An abort releases/declines any parked approval and terminalizes the timeline item.
- Stop accepting progress callbacks after a tool settles.
- Utility-process shutdown aborts every session, waits for owned runs, disposes processors/workspaces/controller resources, then exits.

### Tool concurrency

Mastra exposes a run-level `toolCallConcurrency` rather than Pi/DeepSeek's per-call safety classifier. Start with `toolCallConcurrency: 1`. This is a deliberate correctness choice for coding mutations.

A later optimization may raise the value only after:

- read-only tools are proven side-effect free;
- edit/write/apply-patch share per-path locks and read-version checks;
- result events remain source ordered;
- cancellation drains every started call;
- parallel and mixed read/write batches have contract tests.

Do not add a second custom agent loop merely to gain parallel scheduling.

## Timeline event projection

Use `AgentControllerEvent` as the live input and the controller display state as the recovery snapshot. Project it to the neutral Tauri events as follows:

| Mastra controller event | Neutral event/state |
| --- | --- |
| `agent_start` | `run.started` / running display state |
| `message_start` / `message_update` / `message_end` | assistant and reasoning rows derived from typed message parts |
| `tool_input_start` | create pending tool row |
| `tool_input_delta` | update raw input buffer without parsing incomplete JSON |
| `tool_input_end` | freeze completed input |
| `tool_start` | `tool.started`, status `running`, record start time |
| `tool_update` | `tool.updated`, merge partial result |
| `shell_output` | append bounded stdout/stderr to the command row |
| `command_exit` | set exit code and success |
| `tool_approval_required` | `tool.approval_required`, status `approval` |
| `tool_suspended` | interactive waiting row distinct from approval |
| `tool_end` | completed/error/denied terminal state |
| `usage_update` | `usage.updated` |
| `error` | `run.failed` or a scoped error row |
| `agent_end` | `run.completed` with complete/aborted/error/suspended reason |
| `display_state_changed` | atomic recovery snapshot, not an extra visible row |

Preserve `runId`, `toolCallId`, sequence and timestamp. A reducer must be idempotent by `(runId, sequence)` and must tolerate a snapshot followed by buffered events, following Pi's snapshot-plus-watch rule. Do not display private chain-of-thought. Only render reasoning summaries/content that the selected provider and Mastra explicitly expose as reasoning parts.

## Memory and self-improvement

### Phase 1: product memory

Use `Memory` with the local `LibSQLStore` for message history. Add structured working memory for stable project facts only after its schema is defined. Consider Observational Memory with an explicit OpenRouter-backed observer/reflector model after cost and privacy controls exist; do not accept its default provider implicitly.

This phase learns context, not code. It never edits agent instructions, tool definitions or skills.

### Phase 2: governed experience extraction

Implemented in `src/agent/improvement/` as a Mastra-only control plane:

1. Every completed interactive run starts `improvement-trace-capture`, a `createWorkflow()` graph. The persisted Dataset record holds only a bounded, credential-redacted prompt/result excerpt, model, tool names and terminal facts; the workflow's real Observability trace is the feedback anchor.
2. `Observability` with `MastraStorageExporter` writes traces into the same LibSQL database. User ratings attach through `mastra.observability.addFeedback({ traceId, ... })`; raw provider credentials and private reasoning never cross into the candidate record.
3. `improvement-candidate-draft` invokes a dedicated no-tool Mastra `Agent` with structured output. It produces an application operating-policy candidate only; it cannot edit source files, invoke a shell, call a browser, publish a skill, or mutate the workspace.
4. `improvement-candidate-evaluation` invokes a separate no-tool evaluator Agent with structured output. Its real score and verdict are written through a versioned Mastra Dataset and caller-driven `Dataset.createExperiment()`, `submitExperimentResult()`, and `finalizeExperiment()` record.
5. A candidate stays `draft` until the score gate passes. There is no automatic prompt mutation and no model-authored code execution.

The controlled loop is deliberately narrow: it learns a published application operating policy from evidence. It does not yet materialize a filesystem skill or modify a user project.

### Phase 3: approved publication and rollback

Implemented publication is also Mastra-owned:

1. an evaluated candidate enters `improvement-candidate-publication`, whose `approve-improvement-publication` step calls `suspend()` and persists the pending approval snapshot in LibSQL;
2. the desktop explicitly resumes the run with `Run.resume({ resumeData: { approved } })`; rejecting it leaves an audited `rejected` version;
3. approval publishes only the candidate's app-owned policy version, recorded in Mastra Dataset history;
4. the active-version pointer and rollback history live in Mastra `ThreadStateStorage`;
5. rollback selects the prior version or clears the active pointer. It never rewrites history or touches workspace files.

Filesystem skill publication remains a future expansion. It must keep the same Dataset/Experiment gate and suspension before the dynamic skills resolver can see a new version.

Explicitly rejected as “self-evolution”:

- silent system-prompt mutation;
- autonomous edits to Open Artifex source code;
- executing model-authored JavaScript plugins in the desktop process;
- learning from failed or unverified runs without provenance;
- using user secrets, raw environment variables or private reasoning as training material;
- publishing a skill without evaluation and user approval.

## Future work scheduler

Symphony's outer scheduler belongs after the interactive coding session is stable. Implement it with Mastra workflows and background tasks, not inside the Agent loop:

- one workflow owns a work item's claim and state transitions;
- create a separate contained workspace per item;
- reconcile external state before dispatch and before retry;
- use workflow retries for transient step failures and explicit bounded backoff for external eligibility;
- send work to an Agent/AgentController Session as a workflow step;
- use background-task events for long-running progress;
- require idempotent tools before enabling crash recovery;
- preserve workspaces after success unless explicit cleanup policy says otherwise.

The desktop should first expose manual local tasks through `TaskSignalProvider`. A remote issue-tracker daemon is a later product surface, not an MVP prerequisite.

## Adopt / adapt / reject

| Pattern | Source | Decision | Mastra/Open Artifex implementation |
| --- | --- | --- | --- |
| Unified typed tool definition | all coding harnesses | Adopt | `createTool()` with Standard JSON Schema input/output |
| OpenCode read/glob/grep/edit/write/apply-patch/bash semantics | OpenCode | Adapt | Keep behaviors in custom Mastra tools; do not copy its runtime |
| Structured `title/output/metadata/diff` results | OpenCode, DeepSeek | Adopt | Common JSON-safe result; renderer maps metadata, `@pierre/diffs` renders diff |
| Read-before-write and atomic file replacement | OpenCode, Mastra Workspace | Adopt | version tracker + per-file lock; reject stale writes |
| Complete-diff approval before mutation | OpenCode, Codex | Adopt | build preview first, then Mastra approval, then execute |
| Byte/line output caps with full spill locator | OpenCode | Adapt | bounded output now; add owner-only retained spill storage and cleanup |
| Per-tool parallel safety classifier | Pi, DeepSeek | Adapt later | begin with Mastra `toolCallConcurrency: 1`; add locks before increasing |
| `pending/running/completed/error/approval` tool states | OpenCode, Pi | Adopt | AgentController events/display state -> neutral IPC reducer |
| Begin/delta/end protocol with stable call IDs | Codex, Pi, DeepSeek | Adopt | AgentController/fullStream events; preserve `runId` and `toolCallId` |
| Snapshot then ordered live events | Pi | Adopt | send `displayState` snapshot, buffer, then flush IPC events |
| Allow/ask/deny with one-shot/session grant | OpenCode, Codex, DeepSeek | Adopt | AgentController category/tool permissions and `respondToToolApproval()` |
| Approval bound to exact arguments | Codex, Mastra HITL | Adopt | fingerprint canonical tool name/input; consume the grant once |
| Cooperative cancellation plus forced process cleanup | all | Adopt | `Session.abort()` -> Mastra `abortSignal` -> process group termination |
| Tool and turn lifecycle hooks | Codex, OpenCode, DeepSeek | Adopt | Agent hooks, createTool hooks, processors, controller event subscription |
| Entire upstream plugin runtime | OpenCode, DeepSeek | Reject | no Effect or Cordis host inside the desktop |
| On-demand skill discovery and full-body load | Codex, OpenCode, DeepSeek | Adopt | `SkillSearchProcessor` with `blockingRefresh: true` |
| Skill hot refresh and immutable versions | DeepSeek, Codex | Adapt | dynamic skill paths/versioned source; publish only approved versions |
| Eager injection of every skill body | none recommended | Reject | search summaries, load instructions only on demand |
| Custom append-only conversation database | Pi, DeepSeek | Reject for MVP | Mastra Memory/LibSQL is authoritative; neutral IPC events are a projection |
| Observational long-context memory | Codex two-phase memory | Adapt | Mastra Observational Memory with explicit OpenRouter model and privacy controls |
| Autonomous model-authored runtime plugins | DeepSeek Cordis tools | Reject | draft skills/workflows only; never execute generated plugin code |
| Immutable candidate versions with inspect/update/rollback | DeepSeek | Adopt for improvement pipeline | candidate skill versions + eval + approval + published pointer |
| Structured local task list | OpenCode todo, Symphony work | Adopt | Mastra `TaskSignalProvider` and controller display-state task projection |
| Durable objective/judge loop | DeepSeek goals, Symphony work | Adapt | Mastra goals only for explicit user objectives and bounded judge budgets |
| Isolated work-item scheduler with claims/retry/reconciliation | Symphony | Adapt later | Mastra workflow/background-task layer outside chat loop |
| `createCodingAgent()` defaults | Mastra | Reject by product decision | regular `Agent` plus explicitly selected Mastra primitives |
| Separate localhost HTTP backend for packaged desktop core | none required | Reject | Tauri command/event and stdio message transport; HTTP remains optional integration surface |

## Required invariants and tests

Before calling the harness complete, prove these behaviors through the public runtime path:

1. Every selected workspace is canonicalized and confined; symlink escape and outside-root access fail.
2. A write/edit/patch cannot mutate an existing file that changed since its last read.
3. Approval input exactly matches the input that executes; reject, abort and stale replies cannot execute a tool.
4. Cancel reaches model stream, approval wait, shell process group and any child task; shutdown reaches quiescence.
5. Every started tool row reaches one terminal state, including invalid input, denial, timeout and abort.
6. A tool callback throwing cannot prevent later subscribers or corrupt the run result.
7. Output limits are UTF-8 byte safe; the complete result, wrapper and metadata stay bounded.
8. `SkillSearchProcessor` sees newly written `SKILL.md` data in the same request when `blockingRefresh` is enabled.
9. A loaded skill is thread scoped and supporting paths resolve relative to that skill's base.
10. Restart restores messages and suspended Mastra approvals from LibSQL; ephemeral controller grants do not pretend to persist.
11. Timeline replay from stored messages plus a live display-state snapshot is idempotent and does not duplicate tool rows.
12. Diff metadata remains a raw unified patch until the renderer hands it to `@pierre/diffs`.
13. Secret values never enter tool environments, IPC event payloads, logs, spill files or memory extraction inputs.
14. Any future improvement candidate retains provenance, passes evals, and requires explicit publication approval.

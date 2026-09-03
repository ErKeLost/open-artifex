# Browser automation architecture

## Decision

Adopt `@mastra/agent-browser@0.5.1` as Open Artifex's first-party local
browser provider. Instantiate it inside the Node/Bun agent host that Tauri starts and attach
it to the backing Mastra `Agent` through the standard `browser` property. Use
`scope: 'thread'`, lazy launch, a serial action queue per thread, and Mastra's
native tool/approval stream. Do not run a browser HTTP service and do not invent
browser-specific chat events.

Adapt `@mastra/stagehand@0.3.3` later as an opt-in provider for pages where
deterministic accessibility refs are insufficient. Stagehand **does support a
local launch**: `env: 'LOCAL'` is its default. It is not the default because it
adds a second model loop, higher latency/cost, and less deterministic actions.

Reject `BrowserViewer` as the desktop default. It is intended for a Mastra
`Workspace` whose shell tool drives a separately installed browser CLI. Open
Artifex already owns an SDK browser in the agent runtime, so CLI detection, CDP
flag injection, and another executable would add indirection without adding a
capability. Also reject Browserbase/Firecrawl as defaults because this product is
local-first; they can remain explicit remote-provider options.

## Verified baseline

This decision was checked on 2026-09-03 against the installed packages and their
published type declarations:

| Component | Version/contract | Consequence |
| --- | --- | --- |
| Tauri 2 | `2.10.1` Rust shell with a Node/Bun agent host | The webview has no Node access; the agent host must provide Node `>=22.13.0` or a compatible Bun runtime. |
| Mastra core | `1.63.2` | `Agent.browser` accepts a `MastraBrowser`; lifecycle, thread scope, screencast, input injection, and browser context are native Mastra APIs. |
| Mastra AgentBrowser | `0.5.1` | Current stable provider; exact dependency `agent-browser@0.19.0`; peer-compatible with Mastra 1.x and Zod 4. |
| agent-browser | `0.19.0` | Uses `playwright-core ^1.57.0`; this lockfile resolves `playwright-core@1.62.1`. |
| Mastra Stagehand | `0.3.3` | Current stable adapter; depends on `@browserbasehq/stagehand ^3.2.1`, i.e. the Stagehand v3 API, not v4. |
| Stagehand upstream | v3 latest `3.7.3`; overall latest `4.0.2` | Do not force v4 under the current Mastra adapter. v3 has `ai ^5` plus Playwright and provider peer/optional packages. |

The local AgentBrowser smoke test successfully created an isolated thread
session, navigated to `https://example.com`, produced an accessibility snapshot,
returned a PNG screenshot, emitted a JPEG screencast frame, closed the thread,
and then closed the provider. This exercises the same provider APIs and package
resolution that the Node/Bun agent host will use.

## Runtime boundary

```text
Sandboxed React renderer
  ├─ standard AI SDK/Mastra message and tool parts ───────┐
  └─ browser panel input + latest preview frame             │
                                                               ▼
Tauri invoke/listen adapter → Rust capability validation
                                                               │
                                                               ▼
Node/Bun stdio agent host
  ├─ AgentController Session / Mastra Agent
  │    └─ browser: AgentBrowser({ scope: 'thread' })
  ├─ BrowserSessionService (lifecycle, preview, input, policy)
  └─ one Playwright Chromium process per active thread
```

Remote pages never load into the Tauri renderer or its webview. The renderer only
displays inert JPEG/PNG bytes and sanitized metadata. This preserves the
hardening in [`tauri.md`](./tauri.md) and prevents arbitrary websites from sharing the
application's privileged origin.

The agent host is the correct owner because it already owns Mastra, tool
execution, cancellation, secrets, and the thread ID. Browser crashes and memory
pressure are isolated from the main window. The Rust JSONL bridge supplies a
Node environment and a structured-clone message channel; it does not require a
Hono/Express server. The `ws` and `@hono/node-ws` packages mentioned in Mastra's
browser guide are for streaming a screencast through Mastra Studio's WebSocket
server. Direct desktop use of `MastraBrowser.startScreencast()` does not require
that server.

## Mastra wiring

The runtime should create one provider instance and give it directly to the
backing agent:

```ts
import { Agent } from '@mastra/core/agent'
import { AgentBrowser } from '@mastra/agent-browser'

const browser = new AgentBrowser({
  headless: true,
  viewport: { width: 1280, height: 720 },
  timeout: 30_000,
  scope: 'thread',
  executablePath: packagedChromiumPath,
  excludeTools: ['browser_evaluate'],
  screencast: {
    format: 'jpeg',
    quality: 65,
    maxWidth: 1280,
    maxHeight: 720,
    everyNthFrame: 2,
  },
})

const agent = new Agent({
  id: 'open-artifex-agent',
  name: 'Open Artifex',
  model,
  browser,
  instructions,
  memory,
})
```

Do not manually merge `browser.getTools()` into `Agent.tools`. Mastra does that
when `browser` is assigned and also installs the provider's
`BrowserContextProcessor`. The provider's tools read Mastra's `agent.threadId`,
set the current browser thread, call `ensureReady()`, and pass the explicit
thread ID into the operation. Binding the browser session to the persisted Mastra
thread ID therefore gives the chat and browser the same ownership key.

The browser is lazy: constructing the agent must not launch Chromium. The first
browser tool calls `ensureReady()`. Opening the browser panel should call
`startScreencastIfBrowserActive()` so merely viewing a conversation does not
create a browser session.

Use the installed 1.63.2 signatures, not examples copied from an older/current
web page:

- `startScreencast({ threadId, format, quality, maxWidth, maxHeight,
  everyNthFrame })`; the thread ID is inside the options object.
- `startScreencastIfBrowserActive(options)` returns `null` instead of launching.
- `getBrowserState(threadId)`, `getCurrentUrl(threadId)`, `getTabState(threadId)`,
  and `getActiveTabIndex(threadId)` are the installed state methods.
- The installed `ScreencastOptions` type does not have an `enabled` property.
  Starting/stopping the stream controls whether it is active.

These details differ from a few prose examples on the live site, so the pinned
type declarations remain the implementation source of truth.

## Provider tools and presentation

`AgentBrowser@0.5.1` exposes exactly 16 standard Mastra tools:

| Tools | UI family | Default policy |
| --- | --- | --- |
| `browser_snapshot`, `browser_screenshot` | Browser snapshot/read | Allow in the active user-granted session. |
| `browser_goto`, `browser_back`, `browser_tabs` | Browser navigation | Ask before the first new domain; enforce URL policy regardless of approval. |
| `browser_click`, `browser_type`, `browser_press`, `browser_select`, `browser_dialog`, `browser_drag` | Browser action | Ask by default; a user may grant the category for the live Session. |
| `browser_scroll`, `browser_hover`, `browser_wait` | Browser observation | Allow. |
| `browser_close` | Browser lifecycle | Allow. |
| `browser_evaluate` | Arbitrary page JavaScript | Exclude in the first release; developer-mode, per-call approval only later. |

The timeline shown in the product reference is a renderer concern. It derives a
compact Chinese label and summary from the standard tool name and input, for
example `browser_snapshot` → `浏览器 快照` and `browser_goto` → `打开
example.com`. Expanded rows show the original arguments/result. Counts at the top
are reductions over the standard parts. The runtime must not emit parallel
`browser_action_started` or `browser_action_finished` events.

For chat/tool rendering, consume Mastra's native chunks and the AI SDK UI states:

- `tool-call-delta` / `tool_input_start|delta|end` for streaming arguments;
- `tool-call` for the final invocation;
- `tool-result` for completion or failure;
- `tool-call-approval` for pre-execution approval;
- `tool-call-suspended` only when a resumable tool asks for input;
- AI SDK tool states such as `input-streaming`, `input-available`,
  `approval-requested`, `approval-responded`, `output-available`, and
  `output-error` in the renderer.

The browser preview is deliberately not a conversation event. Forward the
provider's existing `ScreencastStream` events—`frame`, `url`, `stop`, and `error`—on
a separate ephemeral MessagePort. Do not save them in SQLite, replay them as
messages, or count them as tool calls.

## Screenshots and live control

`browser_screenshot` captures PNG and its `toModelOutput()` returns native Mastra
media content (`image/png`), so a vision-capable main model can inspect it without
a custom message type. The raw tool result contains base64 plus URL/title. Keep
that payload inside the agent host unless the UI explicitly opens the tool
detail; never copy base64 into logs or thread metadata.

The live browser panel uses the CDP screencast, not repeated screenshot tool calls:

1. Start a stream only while the panel is visible and the thread already has a
   session.
2. Forward at most one pending frame. New frames replace an unsent frame
   (latest-frame-wins) rather than building an unbounded event queue.
3. Use JPEG quality around 60–70 and `everyNthFrame` 2 initially; make the rate
   adaptive when the panel is backgrounded.
4. Revoke object URLs and drop the last frame when the panel closes or the thread
   changes.
5. Scale pointer coordinates from the displayed image to the frame's CSS viewport
   before calling `injectMouseEvent(event, threadId)`.
6. Normalize keyboard events to Mastra's `keyDown | keyUp | char` fields before
   calling `injectKeyboardEvent(event, threadId)`. Do not forward arbitrary DOM
   event objects.

Mastra reconnects active screencasts when tabs change. A UI tab switch must first
bind the requested Mastra thread and must never fall back to a different thread's
active page.

## Thread and multi-agent isolation

Local `scope: 'thread'` creates a dedicated `BrowserManager` and Chromium process
for each active Mastra thread. This is stronger state isolation than separate tabs:
cookies, storage, open pages, and CDP input cannot cross threads. It is also more
expensive, so the host should cap concurrent live browser sessions and evict idle
sessions with `closeThreadSession(threadId)`.

Rules for multi-agent operation:

- Browser actions within one thread are serialized. Accessibility refs become
  stale after navigation/DOM mutation, and parallel clicks or tab changes are
  nondeterministic. Use `toolCallConcurrency: 1` when browser tools are active or
  a keyed mutex in `BrowserSessionService`.
- Different threads may operate concurrently because the provider passes the
  explicit thread ID to each operation.
- Subagents do not receive browser tools by default. A designated browser
  subagent receives only the required browser tools and an intentional thread
  binding. Two agents must not concurrently drive the same thread session.
- Closing/archiving a conversation closes only its thread session. Application
  shutdown calls `browser.close()` before the agent host is terminated.
- Pending approvals and live browser sessions are process-local. After an agent
  process restart, stale approvals are rejected and the browser is relaunched;
  only explicitly persisted state may be restored.

Do not combine `cdpUrl` with `scope: 'thread'`. Mastra's `BrowserConfig` rejects
that combination and falls back to shared scope for an existing CDP endpoint. A
future "connect my Chrome" feature must display that loss of isolation clearly and
prevent concurrent threads from using the shared session.

## Security and approvals

Browser automation is a privileged network capability. A Chromium child process
is not made safe merely because its parent is an isolated agent host.

Apply policy in this order:

1. **Hard policy before approval.** Accept only `http:` and `https:`. Reject
   `file:`, `data:`, `javascript:`, `chrome:`, `devtools:`, extension URLs,
   loopback, link-local, cloud metadata addresses, and private-network targets
   unless a separately named local-development capability was granted.
2. **Request interception.** Direct `browser_goto` validation is insufficient:
   redirects, clicks, iframes, fetches, WebSockets, and DNS changes can reach a
   different host. The Mastra adapter's public `AgentBrowserConfig` does not
   expose `allowedDomains` directly. Use its exported `createThreadManager` seam
   (or a small provider subclass) to construct each underlying
   `BrowserManager` with the allowlist/network policy before any page navigates.
   `agent-browser@0.19.0` has a context-level `allowedDomains` filter that covers
   HTTP requests plus best-effort WebSocket/EventSource/beacon blocking. For
   unrestricted public browsing, add an IP-aware proxy/route guard; hostname
   allowlisting alone does not eliminate DNS-rebinding risk.
3. **Mastra permission policy.** Map browser tool names to `browser-read`,
   `browser-navigate`, `browser-interact`, and `browser-code` categories through
   `AgentController.toolCategoryResolver`. Use Session `allow | ask | deny`
   policies and answer `tool_approval_required` through
   `session.respondToToolApproval()`.
4. **Revalidate on execution.** A UI approval is not the network policy. A
   `beforeToolCall` hook revalidates the exact tool name, arguments, current
   thread, active origin, and policy version immediately before execution.
5. **Bind approval to what was shown.** Hash the canonical tool name and arguments
   and consume approval once. Never interpret "always allow" as durable across a
   process restart or a different thread.

Additional defaults:

- Keep `browser_evaluate` excluded. It can undo in-page best-effort guards and
  make arbitrary requests.
- Do not launch Chromium with `--no-sandbox`.
- Do not reuse the user's normal Chrome profile. A profile can only be opened by
  one process and contains cookies, history, extensions, and credentials.
- Start with ephemeral per-thread state. If login persistence is added, prefer an
  encrypted storage-state artifact per resource/thread. Playwright storage-state
  JSON contains plaintext cookies/tokens and must not be stored unencrypted.
- Human login/password entry uses the direct preview input channel while the agent
  is paused. Credentials must not become model text, tool arguments, screenshots
  retained in memory, or logs.
- Downloads require an explicit destination capability and approval. Never make
  the workspace or home directory an implicit browser download target.
- Treat page text, accessibility snapshots, screenshots, and downloaded files as
  untrusted content and possible prompt injection.

## Stagehand: supported, but optional

The current Mastra adapter's exact behavior is:

- `env?: 'LOCAL' | 'BROWSERBASE'`, default `LOCAL`;
- local launch accepts `headless`, explicit viewport, `profile`,
  `executablePath`, and `cdpUrl` through `localBrowserLaunchOptions`;
- local Stagehand with `scope: 'thread'` creates a dedicated Stagehand/browser
  instance per thread;
- seven tools: `stagehand_act`, `stagehand_extract`, `stagehand_observe`,
  `stagehand_navigate`, `stagehand_tabs`, `stagehand_screenshot`, and
  `stagehand_close`;
- its own local launch cannot honor `viewport: 'window'`; use explicit dimensions.

Stagehand has no native `openrouter` provider prefix in this adapter. If it is
enabled later, adapt OpenRouter through Stagehand v3's OpenAI-compatible model
configuration and test the selected model end-to-end:

```ts
const stagehand = new StagehandBrowser({
  env: 'LOCAL',
  disableAPI: true,
  headless: true,
  scope: 'thread',
  executablePath: packagedChromiumPath,
  model: {
    // `openai/` selects Stagehand's AI SDK OpenAI provider; the remaining model
    // id is sent to OpenRouter.
    modelName: `openai/${openRouterModelId}`,
    apiKey: openRouterApiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    openaiEndpointFormat: 'chat',
    headers: {
      'HTTP-Referer': 'https://github.com/ErKeLost/open-artifex',
      'X-Title': 'Open Artifex',
    },
  },
})
```

This path also needs Stagehand v3's matching optional AI SDK provider package
(for this configuration, `@ai-sdk/openai` in the version range required by
Stagehand v3). It must not reuse a mismatched top-level AI SDK package by
assumption. Stagehand's internal model calls are separate from the outer Mastra
agent call, so expose their latency/cost clearly and never silently enable them.

## Packaging contract

Playwright browser binaries are external executables; `playwright-core` alone is
not a distributable browser. Development may run `bunx playwright install
chromium`, but a released desktop app must work on a clean, offline machine.

Package as follows:

1. Resolve the Chromium revision from the lockfile's Playwright version during
   the release build. Do not download a floating browser at application startup.
2. Stage one platform/architecture-specific Chromium as a Tauri resource or
   alongside the packaged agent sidecar and pass its absolute path through
   `executablePath`.
3. Resolve the resource path through Rust/Tauri packaging metadata; validate that it is a
   regular executable contained by the expected resources directory.
4. Include the full Chromium build if Open Artifex will support a visible/headful
   handoff. The current macOS arm64 Playwright install measures roughly 356 MB
   unpacked (the headless shell alone is roughly 201 MB), so installer size is a
   deliberate product cost.
5. Code-sign nested browser executables/frameworks and cover them in macOS
   notarization and Windows signing tests. Preserve executable bits on Linux and
   macOS.
6. Keep user data, screenshots, and recordings outside the application bundle,
   beneath scoped `userData` directories. Recordings are beta, off by default,
   capped in duration, and never stored in the source workspace.
7. Test packaged builds on clean macOS arm64/x64, Windows x64/arm64 as supported,
   and Linux targets. Verify launch, screenshot, screencast, input, graceful quit,
   and that no Chromium process remains after exit.

The JavaScript provider can be bundled with the agent worker. The browser
executable cannot run from ASAR. The native `agent-browser` CLI binaries included
by its npm package are not part of the SDK execution path and should not be used
as the desktop runtime entry point.

## Module ownership

| Module | Owns | Must not own |
| --- | --- | --- |
| agent runtime/browser factory | Provider construction and packaged executable resolution | UI labels, Tauri renderer APIs |
| `src/agent/browser/browser-policy.ts` | URL/network policy, tool categories, pre-call validation | Browser lifecycle or React state |
| `src/agent/browser/browser-session-service.ts` | Thread binding, keyed action queue, start/stop preview, input injection, idle eviction | Agent prompt or visual styling |
| `src/shared/browser-protocol.ts` | JSON-safe preview/input DTOs aligned with Mastra's frame/input types | Base64 persistence, Mastra objects, Tauri objects |
| `src/renderer/features/browser/` | Frame display, coordinate mapping, user takeover controls | Node, CDP, secrets, provider SDKs |
| `src/renderer/features/tool-timeline/` | Tool-name presentation mapping and grouped counts | Tool execution or policy decisions |

Keep `BrowserSessionService` behind an interface so AgentBrowser and Stagehand can
share lifecycle/UI plumbing without leaking provider-specific tool semantics into
the rest of the runtime.

## Acceptance checks

- Two Mastra threads have different cookies, tabs, and URLs.
- Closing thread A does not close thread B; quitting closes all browser processes.
- Same-thread actions never overlap; different-thread actions can run concurrently.
- Opening the browser panel without an active session does not launch Chromium.
- Tool rows are produced solely from native Mastra/AI SDK parts and match the
  screenshot's compact/expandable presentation.
- Screenshot reaches a vision model as native `image/png` media content.
- Preview uses latest-frame-wins backpressure and mouse coordinates remain correct
  at every panel size/device scale factor.
- Approval decline prevents execution; approval for one argument set cannot be
  replayed for another.
- Direct, redirected, subresource, WebSocket, private-address, and non-HTTP URL
  policy tests fail closed.
- A clean packaged install launches without a global Chrome, Playwright cache,
  Bun, Node, or network download.

## Sources

Version-pinned API/source references:

- [`@mastra/core@1.63.2` browser types](https://unpkg.com/@mastra/core@1.63.2/dist/browser/browser.d.ts)
- [`@mastra/core@1.63.2` thread manager types](https://unpkg.com/@mastra/core@1.63.2/dist/browser/thread-manager.d.ts)
- [`@mastra/core@1.63.2` screencast event types](https://unpkg.com/@mastra/core@1.63.2/dist/browser/screencast/types.d.ts)
- [`@mastra/agent-browser@0.5.1` exact public types](https://unpkg.com/@mastra/agent-browser@0.5.1/dist/index.d.ts)
- [`@mastra/agent-browser@0.5.1` package manifest](https://unpkg.com/@mastra/agent-browser@0.5.1/package.json)
- [`agent-browser@0.19.0` package manifest](https://unpkg.com/agent-browser@0.19.0/package.json)
- [`agent-browser@0.19.0` domain-filter implementation](https://unpkg.com/agent-browser@0.19.0/dist/domain-filter.js)
- [`@mastra/stagehand@0.3.3` exact public types](https://unpkg.com/@mastra/stagehand@0.3.3/dist/index.d.ts)
- [`@mastra/stagehand@0.3.3` implementation](https://unpkg.com/@mastra/stagehand@0.3.3/dist/index.js)
- [`@mastra/stagehand@0.3.3` package manifest](https://unpkg.com/@mastra/stagehand@0.3.3/package.json)
- [Stagehand v3.7.3 model configuration types](https://unpkg.com/@browserbasehq/stagehand@3.7.3/dist/esm/lib/v3/types/public/model.d.ts)
- [Stagehand v3.7.3 AI SDK provider resolution](https://unpkg.com/@browserbasehq/stagehand@3.7.3/dist/esm/lib/v3/llm/LLMProvider.js)

Canonical conceptual references:

- [Mastra browser guide](https://mastra.ai/docs/browser)
- [Mastra AgentBrowser integration](https://mastra.ai/integrations/browsers/agent-browser)
- [Mastra Stagehand integration](https://mastra.ai/integrations/browsers/stagehand)
- [Mastra AgentController permissions](https://mastra.ai/docs/harness/agent-controller)
- [Mastra human-in-the-loop approvals](https://mastra.ai/docs/agents/human-in-the-loop)
- [Tauri commands and events](https://v2.tauri.app/develop/calling-rust/)
- [Tauri sidecars](https://v2.tauri.app/develop/sidecar/)
- [Tauri resources](https://v2.tauri.app/develop/resources/)
- [Playwright browser installation and management](https://playwright.dev/docs/browsers)

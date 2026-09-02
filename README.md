# Open Artifex

Open Artifex is a local-first work and coding agent for the desktop.

The project starts with a comparative study of leading open-source agent
harnesses before its Electron and Mastra implementation is added.

## Architecture direction

- Electron provides the desktop shell and native process boundary.
- Mastra provides the agent runtime and workspace primitives.
- The renderer stays sandboxed; filesystem and process access belong to the
  main process and are exposed through a narrow IPC API.
- Agent operations are scoped to a workspace explicitly selected by the user.

## Upstream references

The `upstreams` directory contains shallow Git submodules pinned to reviewed
commits:

| Project | Role |
| --- | --- |
| [OpenAI Codex](https://github.com/openai/codex) | Local coding agent and desktop reference |
| [OpenCode](https://github.com/anomalyco/opencode) | Open-source coding agent and desktop UI |
| [Pi](https://github.com/earendil-works/pi) | Extensible agent harness and coding CLI |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | Plugin-oriented agent harness |
| [OpenAI Symphony](https://github.com/openai/symphony) | Project-level autonomous work orchestration |

Clone the project and initialize its references with:

```sh
git clone --recurse-submodules --shallow-submodules \
  https://github.com/ErKeLost/open-artifex.git
```

The upstream projects retain their own licenses and are not maintained by or
affiliated with Open Artifex.

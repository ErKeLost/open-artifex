import { Agent } from "@mastra/core/agent";
import path from "node:path";
import { SkillSearchProcessor } from "@mastra/core/processors";
import { createTool } from "@mastra/core/tools";
import { LocalFilesystem, Workspace } from "@mastra/core/workspace";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { Memory } from "@mastra/memory";
import { z } from "zod";
import { createToolFactoryContext } from "../agent/core/tool-context";
import { createCodingTools } from "../agent/tools";
import { workspaceRoot } from "./paths";

const filesystem = new LocalFilesystem({
  basePath: workspaceRoot,
  contained: true,
});

export const openArtifexWorkspace = new Workspace({
  id: "open-artifex-workspace",
  name: path.basename(workspaceRoot),
  filesystem,
  skills: [
    ".agents/skills",
    ".mastra/skills",
    "skills",
  ],
  bm25: true,
  tools: {
    enabled: false,
  },
});

const runtimeInfoTool = createTool({
  id: "runtime_info",
  description: "Return the active Open Artifex workspace and model configuration.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    workspaceRoot: z.string(),
    model: z.string(),
    runtime: z.literal("mastra"),
  }),
  execute: async () => ({
    workspaceRoot,
    model: process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4",
    runtime: "mastra" as const,
  }),
});

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
  headers: {
    "HTTP-Referer": "https://github.com/ErKeLost/open-artifex",
    "X-Title": "Open Artifex",
  },
});

const skillSearch = new SkillSearchProcessor({
  workspace: openArtifexWorkspace,
  search: {
    topK: 5,
    minScore: 0.1,
  },
  blockingRefresh: true,
});

const codingTools = createCodingTools(
  await createToolFactoryContext(workspaceRoot, true),
);

export const openArtifexAgent = new Agent({
  id: "open-artifex-agent",
  name: "Open Artifex",
  description: "A local-first work and coding agent powered by Mastra.",
  instructions: `
You are Open Artifex, a local-first work and coding agent.

Operate only inside the active workspace. Inspect before editing, keep changes
focused, and verify work before declaring it complete. Use search_skills when a
request may match a reusable skill, then load_skill before following it.

Use read before changing an existing file. Use glob and grep to explore before
guessing. Prefer edit for focused replacements, apply_patch for coordinated
changes, and write only for intentional full-file creation or replacement.
Use bash for builds, tests, Git, and project tooling. Never expose secrets.
  `.trim(),
  model: openrouter(
    process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4",
    {
      usage: { include: true },
    },
  ),
  tools: {
    runtime_info: runtimeInfoTool,
    ...codingTools,
  },
  memory: new Memory({
    options: {
      lastMessages: 50,
    },
  }),
  workspace: openArtifexWorkspace,
  inputProcessors: [skillSearch],
});

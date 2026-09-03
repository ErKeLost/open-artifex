import type { TimelineItem } from './timeline.types';

const taskPatch = `diff --git a/.open-artifex/tasks.md b/.open-artifex/tasks.md
new file mode 100644
index 0000000..92cc930
--- /dev/null
+++ b/.open-artifex/tasks.md
@@ -0,0 +1,3 @@
+# 当前任务
+
+- [ ] 完成工具调用时间线
`;

export const mockTimelineItems: readonly TimelineItem[] = [
  {
    id: 'thinking-1',
    kind: 'reasoning',
    label: '思考了',
    detail: '3s',
    content: { type: 'markdown', value: '先检查项目中的 Markdown 文件，再定位 `DimAgent` 的定义。' },
  },
  {
    id: 'glob-markdown',
    kind: 'glob',
    label: '查找',
    detail: '*.md',
    content: { type: 'text', value: '找到 12 个 Markdown 文件' },
  },
  {
    id: 'grep-agent',
    kind: 'search',
    label: '搜索内容',
    detail: 'DimAgent',
    content: { type: 'terminal', command: 'rg -n "DimAgent" .', output: 'src/agent/dim-agent.ts:18:export class DimAgent', exitCode: 0 },
  },
  {
    id: 'browser-snapshot',
    kind: 'browser',
    label: '浏览器',
    detail: '快照',
    content: { type: 'text', value: '已捕获当前页面的可访问性快照。' },
  },
  {
    id: 'goal-tool',
    kind: 'tool',
    label: '使用工具',
    detail: 'goal',
    content: {
      type: 'json',
      value: { objective: '实现模块化 coding agent 桌面端', status: 'in_progress' },
    },
  },
  {
    id: 'agent-state',
    kind: 'agent',
    label: '查询智能体状态',
  },
  {
    id: 'chrome-tool',
    kind: 'tool',
    label: '使用工具',
    detail: 'chrome',
    content: { type: 'text', value: '已打开浏览器并读取可见页面状态。' },
  },
  {
    id: 'web-search',
    kind: 'web-search',
    label: '搜索网络',
    detail: 'OpenAI GPT-5.6 Luna',
    badges: [
      { label: 'D', tone: 'pink', title: '搜索提供商' },
      { label: '◎', tone: 'neutral', title: 'OpenAI' },
      { label: 'Q', tone: 'dark', title: '其他来源' },
      { label: '+2', tone: 'more', title: '另外 2 个来源' },
    ],
    content: {
      type: 'markdown',
      value: '- [OpenAI Developers](https://developers.openai.com/)\n- [OpenRouter Models](https://openrouter.ai/models)',
    },
  },
  {
    id: 'command-dim',
    kind: 'command',
    label: '执行',
    detail: 'dim',
    content: { type: 'terminal', command: 'dim', output: 'Agent harness ready', exitCode: 0 },
  },
  {
    id: 'thinking-2',
    kind: 'reasoning',
    label: '思考了',
    detail: '1s',
    content: { type: 'text', value: '继续核对渲染提示词。' },
  },
  {
    id: 'read-prompt',
    kind: 'read',
    label: '读取',
    detail: 'render-prompts.md',
    content: { type: 'markdown', value: '## Rendering\n\n保持工具事件有序，并在完成后写入耗时。' },
  },
  {
    id: 'fetch-docs',
    kind: 'web-fetch',
    label: '获取网页',
    detail: 'developers.openai.com',
    badges: [{ label: 'D', tone: 'pink', title: '网页来源' }],
    content: { type: 'text', value: '200 OK · text/html · 24.8 KB' },
  },
  {
    id: 'thinking-3',
    kind: 'reasoning',
    label: '思考了',
    detail: '0s',
    content: { type: 'text', value: '准备更新任务。' },
  },
  {
    id: 'task-update',
    kind: 'task',
    label: '更新任务',
    detail: '1 项新建任务',
    content: { type: 'diff', patch: taskPatch },
  },
];

export const mockApprovalItem: TimelineItem = {
  id: 'approval-command',
  kind: 'command',
  label: '等待批准',
  detail: 'bun run build',
  status: 'approval',
  defaultOpen: true,
  content: {
    type: 'approval',
    title: '允许执行这条命令吗？',
    description: '命令将在当前工作区运行。',
  },
};

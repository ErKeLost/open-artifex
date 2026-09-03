import type { AgentEvent, JsonValue, ToolEventPayload } from '../../../shared/agent-protocol.js';
import type { TimelineContent, TimelineItem, TimelineItemKind, TimelineItemStatus } from './timeline.types';

type ToolAgentEvent = Extract<AgentEvent, { type: `tool.${string}` }>;

interface ReasoningSeed {
  type: 'reasoning';
  id: string;
  sequence: number;
  startedAt: number;
  lastAt: number;
  text: string;
}

interface ToolSeed {
  type: 'tool';
  id: string;
  runId: string;
  sequence: number;
  eventType: ToolAgentEvent['type'];
  timestamp: number;
  payload: ToolEventPayload;
}

type TimelineSeed = ReasoningSeed | ToolSeed;

interface ToolPresentation {
  kind: TimelineItemKind;
  label: string;
  detail?: string;
}

function asRecord(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function pickString(record: Record<string, JsonValue> | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function pickNumber(record: Record<string, JsonValue> | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function compactPath(value: string | undefined) {
  if (!value) return undefined;
  const normalized = value.replaceAll('\\', '/');
  const parts = normalized.split('/').filter(Boolean);
  const shouldCompact = parts.length > 3 || (normalized.startsWith('/') && parts.length > 2);
  return shouldCompact ? `…/${parts.slice(-3).join('/')}` : value;
}

function compactUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

function toolPresentation(payload: ToolEventPayload): ToolPresentation {
  const name = payload.toolName.toLowerCase().replaceAll('-', '_');
  const input = asRecord(payload.input);

  if (name === 'read' || name.endsWith('_read')) {
    return { kind: 'read', label: '读取', detail: compactPath(pickString(input, 'path', 'filePath', 'file')) };
  }
  if (name === 'glob' || name.includes('find_files')) {
    return { kind: 'glob', label: '查找', detail: pickString(input, 'pattern', 'glob', 'path') };
  }
  if (name === 'grep' || name.includes('search_content')) {
    return { kind: 'search', label: '搜索内容', detail: pickString(input, 'pattern', 'query', 'search') };
  }
  if (name === 'bash' || name === 'shell' || name === 'exec' || name.includes('command')) {
    return { kind: 'command', label: '执行', detail: pickString(input, 'command', 'cmd') ?? payload.title };
  }
  if (name.includes('web_search') || name === 'websearch') {
    return { kind: 'web-search', label: '搜索网络', detail: pickString(input, 'query', 'search') ?? payload.title };
  }
  if (name.includes('web_fetch') || name === 'webfetch' || name === 'fetch') {
    return { kind: 'web-fetch', label: '获取网页', detail: compactUrl(pickString(input, 'url')) ?? payload.title };
  }
  if (name.includes('browser') || name === 'chrome' || name.includes('screenshot')) {
    return { kind: 'browser', label: '浏览器', detail: pickString(input, 'action') ?? payload.title ?? '操作' };
  }
  if (name === 'task' || name.includes('subagent') || name.includes('agent_status')) {
    return { kind: 'agent', label: name.includes('status') ? '查询智能体状态' : '调用子代理', detail: payload.title };
  }
  if (name.includes('update_plan') || name.includes('update_task') || name === 'todo') {
    return { kind: 'task', label: '更新任务', detail: payload.title };
  }
  if (name.includes('apply_patch') || name === 'edit' || name.includes('diff')) {
    return { kind: 'diff', label: '修改', detail: compactPath(pickString(input, 'path', 'filePath', 'file')) ?? payload.title };
  }
  if (name === 'write' || name.includes('write_file')) {
    return { kind: 'write', label: '写入', detail: compactPath(pickString(input, 'path', 'filePath', 'file')) ?? payload.title };
  }

  return { kind: 'tool', label: '使用工具', detail: payload.title ?? payload.toolName };
}

function toolStatus(eventType: ToolAgentEvent['type']): TimelineItemStatus | undefined {
  if (eventType === 'tool.started' || eventType === 'tool.updated') return 'running';
  if (eventType === 'tool.failed') return 'error';
  if (eventType === 'tool.approval_required') return 'approval';
  return undefined;
}

function getTerminalContent(payload: ToolEventPayload): TimelineContent {
  const input = asRecord(payload.input);
  const output = asRecord(payload.output);
  const command = pickString(input, 'command', 'cmd');
  const stdout = pickString(output, 'stdout', 'output');
  const stderr = pickString(output, 'stderr');
  const directOutput = typeof payload.output === 'string' ? payload.output : undefined;
  const text = [stdout ?? directOutput, stderr].filter(Boolean).join('\n');

  return {
    type: 'terminal',
    command,
    output: text || (payload.error?.message ?? '命令仍在执行…'),
    exitCode: pickNumber(output, 'exitCode', 'code'),
  };
}

function getDiffPatch(payload: ToolEventPayload) {
  const input = asRecord(payload.input);
  const output = asRecord(payload.output);
  return (
    pickString(input, 'patch', 'diff') ??
    pickString(output, 'patch', 'diff') ??
    (typeof payload.output === 'string' && payload.output.startsWith('diff --git') ? payload.output : undefined)
  );
}

function toolContent(payload: ToolEventPayload, presentation: ToolPresentation): TimelineContent | undefined {
  if (payload.approval?.status === 'pending') {
    return {
      type: 'approval',
      title: '允许执行这个工具吗？',
      description: payload.approval.preview ?? payload.approval.reason,
    };
  }
  if (payload.error) return { type: 'text', value: payload.error.message };
  if (presentation.kind === 'command') return getTerminalContent(payload);

  if (presentation.kind === 'diff') {
    const patch = getDiffPatch(payload);
    if (patch) return { type: 'diff', patch };
  }

  if (payload.output !== undefined) {
    return typeof payload.output === 'string'
      ? { type: 'text', value: payload.output }
      : { type: 'json', value: payload.output };
  }
  if (payload.input !== undefined) return { type: 'json', value: payload.input };
  return undefined;
}

function mergePayload(current: ToolEventPayload, next: ToolEventPayload): ToolEventPayload {
  return {
    ...current,
    ...next,
    // Mastra controller progress events do not repeat the tool name. Preserve
    // the name from tool.started so labels stay useful while a call streams.
    toolName: next.toolName === 'tool' ? current.toolName : next.toolName,
    progress: next.progress ? { ...current.progress, ...next.progress } : current.progress,
    approval: next.approval ? { ...current.approval, ...next.approval } : current.approval,
  };
}

function reasoningItem(seed: ReasoningSeed): TimelineItem {
  const durationMs = Math.max(0, seed.lastAt - seed.startedAt);
  return {
    id: seed.id,
    kind: 'reasoning',
    label: '思考了',
    detail: `${Math.round(durationMs / 1000)}s`,
    durationMs,
    content: seed.text.trim() ? { type: 'markdown', value: seed.text } : undefined,
  };
}

function toolItem(seed: ToolSeed): TimelineItem {
  const presentation = toolPresentation(seed.payload);
  const startedAt = seed.payload.startedAt;
  const completedAt = seed.payload.completedAt;
  const durationMs = startedAt !== undefined && completedAt !== undefined ? Math.max(0, completedAt - startedAt) : undefined;

  return {
    id: seed.id,
    ...presentation,
    status: toolStatus(seed.eventType),
    durationMs,
    content: toolContent(seed.payload, presentation),
    defaultOpen: seed.eventType === 'tool.approval_required',
    source: {
      runId: seed.runId,
      toolCallId: seed.payload.toolCallId,
      approvalId: seed.payload.approval?.id,
    },
  };
}

/** Converts serializable IPC events into renderer-only timeline view models. */
export function adaptAgentEventsToTimeline(events: readonly AgentEvent[]): TimelineItem[] {
  const seeds: TimelineSeed[] = [];
  const tools = new Map<string, ToolSeed>();
  let activeReasoning: ReasoningSeed | undefined;

  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    if (event.type === 'reasoning.delta') {
      if (!activeReasoning) {
        activeReasoning = {
          type: 'reasoning',
          id: `reasoning-${event.id}`,
          sequence: event.sequence,
          startedAt: event.timestamp,
          lastAt: event.timestamp,
          text: '',
        };
        seeds.push(activeReasoning);
      }
      activeReasoning.text += event.payload.delta;
      activeReasoning.lastAt = event.timestamp;
      continue;
    }

    activeReasoning = undefined;
    if (!event.type.startsWith('tool.')) continue;

    const toolEvent = event as ToolAgentEvent;
    const existing = tools.get(toolEvent.payload.toolCallId);
    if (existing) {
      existing.eventType = toolEvent.type;
      existing.timestamp = toolEvent.timestamp;
      existing.payload = mergePayload(existing.payload, toolEvent.payload);
      continue;
    }

    const seed: ToolSeed = {
      type: 'tool',
      id: `tool-${toolEvent.payload.toolCallId}`,
      runId: toolEvent.runId,
      sequence: toolEvent.sequence,
      eventType: toolEvent.type,
      timestamp: toolEvent.timestamp,
      payload: toolEvent.payload,
    };
    tools.set(toolEvent.payload.toolCallId, seed);
    seeds.push(seed);
  }

  return seeds.sort((a, b) => a.sequence - b.sequence).map((seed) => (seed.type === 'reasoning' ? reasoningItem(seed) : toolItem(seed)));
}

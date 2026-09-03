import { describe, expect, it } from 'bun:test';
import { adaptAgentEventsToTimeline } from './agent-event-adapter';

const event = (sequence, type, payload, timestamp = sequence * 1000) => ({
  id: `event-${sequence}`,
  runId: 'run-1',
  sequence,
  timestamp,
  type,
  payload,
});

describe('agent event timeline adapter', () => {
  it('merges a tool lifecycle by toolCallId', () => {
    const items = adaptAgentEventsToTimeline([
      event(1, 'tool.started', { toolCallId: 'call-1', toolName: 'read', input: { path: '/repo/src/agent.ts' } }),
      event(2, 'tool.completed', { toolCallId: 'call-1', toolName: 'read', output: 'source', completedAt: 2000 }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'tool-call-1', kind: 'read', label: '读取', detail: '…/repo/src/agent.ts' });
    expect(items[0].status).toBeUndefined();
    expect(items[0].content).toEqual({ type: 'text', value: 'source' });
  });

  it('groups contiguous reasoning deltas into rounds', () => {
    const items = adaptAgentEventsToTimeline([
      event(1, 'reasoning.delta', { delta: '先检查' }, 1000),
      event(2, 'reasoning.delta', { delta: '文件。' }, 3800),
      event(3, 'run.status', { stage: 'tools' }, 4000),
      event(4, 'reasoning.delta', { delta: '继续。' }, 5000),
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: 'reasoning', detail: '3s', content: { type: 'markdown', value: '先检查文件。' } });
    expect(items[1]).toMatchObject({ kind: 'reasoning', detail: '0s' });
  });

  it('maps pending approval into an expanded approval panel', () => {
    const [item] = adaptAgentEventsToTimeline([
      event(1, 'tool.approval_required', {
        toolCallId: 'call-2',
        toolName: 'bash',
        input: { command: 'bun run build' },
        approval: { id: 'approval-1', status: 'pending', risk: 'medium', reason: '执行构建', preview: 'bun run build' },
      }),
    ]);

    expect(item).toMatchObject({
      kind: 'command',
      label: '执行',
      detail: 'bun run build',
      status: 'approval',
      defaultOpen: true,
      source: { runId: 'run-1', toolCallId: 'call-2', approvalId: 'approval-1' },
    });
    expect(item.content).toMatchObject({ type: 'approval', description: 'bun run build' });
  });
});

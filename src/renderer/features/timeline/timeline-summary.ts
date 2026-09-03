import type { TimelineItem, TimelineItemKind, TimelineSummaryEntry } from './timeline.types';

const summaryOrder: readonly TimelineItemKind[] = [
  'read',
  'command',
  'search',
  'web-search',
  'web-fetch',
  'agent',
  'browser',
  'write',
  'diff',
  'tool',
  'task',
  'other',
];

const summaryCopy: Partial<Record<TimelineItemKind, (count: number) => string>> = {
  read: (count) => `读${count}次文件`,
  command: (count) => `执行${count}次命令`,
  search: (count) => `搜${count}次`,
  'web-search': (count) => `网络搜${count}次`,
  'web-fetch': (count) => `抓取${count}次`,
  agent: (count) => `调${count}次子代理`,
  browser: (count) => `浏览器操作${count}次`,
  write: (count) => `写${count}次文件`,
  diff: (count) => `修改${count}次`,
};

const isOtherSummaryKind = (kind: TimelineItemKind) =>
  kind === 'tool' || kind === 'task' || kind === 'other';

const normalizeSummaryKind = (kind: TimelineItemKind): TimelineItemKind => {
  if (kind === 'glob') return 'search';
  if (isOtherSummaryKind(kind)) return 'other';
  return kind;
};

export function getTimelineSummary(items: readonly TimelineItem[]): TimelineSummaryEntry[] {
  const counts = new Map<TimelineItemKind, number>();

  for (const item of items) {
    if (item.kind === 'reasoning') continue;

    const summaryKind = normalizeSummaryKind(item.kind);
    counts.set(summaryKind, (counts.get(summaryKind) ?? 0) + 1);
  }

  return summaryOrder.flatMap((kind) => {
    const count = counts.get(kind) ?? 0;
    if (count === 0) return [];

    const copy = summaryCopy[kind] ?? ((value: number) => `其他${value}次`);
    return [{ kind, count, text: copy(count) }];
  });
}

export function getReasoningRounds(items: readonly TimelineItem[]) {
  return items.filter((item) => item.kind === 'reasoning').length;
}

export function formatTimelineSummary(items: readonly TimelineItem[]) {
  const reasoningRounds = getReasoningRounds(items);
  const actions = getTimelineSummary(items).map((entry) => entry.text);
  const thinking = reasoningRounds > 0 ? `思考${reasoningRounds}轮` : '执行记录';

  return actions.length > 0 ? `${thinking} · ${actions.join('、')}` : thinking;
}

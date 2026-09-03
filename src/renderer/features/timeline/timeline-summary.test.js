import { describe, expect, it } from 'bun:test';
import { formatTimelineSummary, getTimelineSummary } from './timeline-summary';

const item = (id, kind) => ({ id, kind, label: id });

describe('timeline summary', () => {
  it('uses the screenshot ordering and Chinese copy', () => {
    const items = [
      item('think-1', 'reasoning'),
      item('read-1', 'read'),
      item('glob-1', 'glob'),
      item('command-1', 'command'),
      item('search-2', 'search'),
      item('web-search-1', 'web-search'),
      item('fetch-1', 'web-fetch'),
      item('agent-1', 'agent'),
      item('browser-1', 'browser'),
      item('tool-1', 'tool'),
    ];

    expect(formatTimelineSummary(items)).toBe(
      '思考1轮 · 读1次文件、执行1次命令、搜2次、网络搜1次、抓取1次、调1次子代理、浏览器操作1次、其他1次',
    );
  });

  it('folds task and generic tools into the other count', () => {
    const result = getTimelineSummary([
      item('goal', 'tool'),
      item('task', 'task'),
      item('other', 'other'),
      item('think', 'reasoning'),
    ]);

    expect(result).toEqual([{ kind: 'other', count: 3, text: '其他3次' }]);
  });
});

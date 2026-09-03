import { Markdown } from '@lobehub/ui';
import { PatchDiff } from '@pierre/diffs/react';
import type { TimelineContent as TimelineContentValue, TimelineItem } from './timeline.types';

interface TimelineContentProps {
  content: TimelineContentValue;
  item: TimelineItem;
  onApprove?: (item: TimelineItem) => void;
  onReject?: (item: TimelineItem) => void;
  theme?: 'light' | 'dark';
}

const diffOptions = {
  diffIndicators: 'bars' as const,
  diffStyle: 'unified' as const,
  lineDiffType: 'word-alt' as const,
  overflow: 'scroll' as const,
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
};

function formatJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function TimelineContent({ content, item, onApprove, onReject, theme = 'light' }: TimelineContentProps) {
  if (content.type === 'custom') return <div className="oa-timeline-content">{content.node}</div>;

  if (content.type === 'markdown') {
    return (
      <div className="oa-timeline-content oa-timeline-content--markdown">
        <Markdown fullFeaturedCodeBlock={false} variant="chat">
          {content.value}
        </Markdown>
      </div>
    );
  }

  if (content.type === 'terminal') {
    return (
      <div className="oa-timeline-content oa-timeline-terminal">
        {content.command ? (
          <div className="oa-timeline-terminal__command">
            <span aria-hidden="true">$</span>
            <code>{content.command}</code>
          </div>
        ) : null}
        <pre>{content.output}</pre>
        {typeof content.exitCode === 'number' ? (
          <span className="oa-timeline-terminal__exit">退出码 {content.exitCode}</span>
        ) : null}
      </div>
    );
  }

  if (content.type === 'json') {
    return (
      <div className="oa-timeline-content oa-timeline-code">
        <pre>{formatJson(content.value)}</pre>
      </div>
    );
  }

  if (content.type === 'diff') {
    return (
      <div className="oa-timeline-content oa-timeline-diff">
        <PatchDiff disableWorkerPool options={{ ...diffOptions, themeType: theme }} patch={content.patch} />
      </div>
    );
  }

  if (content.type === 'approval') {
    return (
      <div className="oa-timeline-content oa-timeline-approval" role="group" aria-label={content.title}>
        <div className="oa-timeline-approval__copy">
          <strong>{content.title}</strong>
          {content.description ? <p>{content.description}</p> : null}
        </div>
        <div className="oa-timeline-approval__actions">
          <button className="oa-timeline-button oa-timeline-button--quiet" onClick={() => onReject?.(item)} type="button">
            {content.rejectLabel ?? '拒绝'}
          </button>
          <button className="oa-timeline-button oa-timeline-button--primary" onClick={() => onApprove?.(item)} type="button">
            {content.approveLabel ?? '允许'}
          </button>
        </div>
      </div>
    );
  }

  return <div className="oa-timeline-content oa-timeline-content--text">{content.value}</div>;
}

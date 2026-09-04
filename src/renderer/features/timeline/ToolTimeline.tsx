import * as Collapsible from '@radix-ui/react-collapsible';
import { useId } from 'react';
import { TimelineEmpty, TimelineError, TimelineLoading } from './TimelineFeedback';
import { TimelineItemRow } from './TimelineItemRow';
import { TimelineChevron, TimelineSummaryIcon } from './timeline-icons';
import { formatTimelineSummary } from './timeline-summary';
import { useTimelineUiStore } from './timeline-store';
import type { ToolTimelineProps } from './timeline.types';
import './timeline.css';

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function ToolTimeline({
  items,
  className,
  state = 'ready',
  errorMessage,
  initiallyExpanded = true,
  summaryLabel,
  onApprove,
  onReject,
  theme = 'light',
}: ToolTimelineProps) {
  const reactId = useId();
  const runId = `timeline-${reactId}`;
  const storedExpanded = useTimelineUiStore((store) => store.expandedRuns[runId]);
  const setRunExpanded = useTimelineUiStore((store) => store.setRunExpanded);
  const expanded = storedExpanded ?? initiallyExpanded;
  const summary = summaryLabel ?? formatTimelineSummary(items);
  if (state === 'empty' && items.length === 0) return null;

  return (
    <Collapsible.Root
      className={cx('oa-timeline oa-timeline-disclosure', className)}
      data-theme={theme}
      data-open={expanded}
      onOpenChange={(open) => setRunExpanded(runId, open)}
      open={expanded}
    >
      <Collapsible.Trigger asChild>
        <button aria-label={`${expanded ? '收起' : '展开'}执行记录`} className="oa-timeline__summary" type="button">
          <span className="oa-timeline__summary-icon">
            <TimelineSummaryIcon />
          </span>
          <span className="oa-timeline__summary-text">{summary}</span>
          <span className="oa-timeline__summary-chevron">
            <TimelineChevron />
          </span>
        </button>
      </Collapsible.Trigger>

      <Collapsible.Content asChild forceMount>
        <div className="oa-timeline-panel oa-timeline__root-panel">
          <div className="oa-timeline-panel__inner">
            <div className="oa-timeline__body">
              <span aria-hidden="true" className="oa-timeline__rail" />
              <div className="oa-timeline__items">
                {state === 'loading' ? <TimelineLoading /> : null}
                {state === 'empty' ? <TimelineEmpty /> : null}
                {state === 'error' ? <TimelineError message={errorMessage} /> : null}
                {state === 'ready'
                  ? items.map((item) => (
                      <TimelineItemRow item={item} key={item.id} onApprove={onApprove} onReject={onReject} theme={theme} />
                    ))
                  : null}
              </div>
            </div>
          </div>
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

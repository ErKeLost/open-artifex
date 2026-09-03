import * as Collapsible from '@radix-ui/react-collapsible';
import { TimelineContent } from './TimelineContent';
import { TimelineChevron, TimelineKindIcon, TimelineStatusIcon } from './timeline-icons';
import { useTimelineUiStore } from './timeline-store';
import type { TimelineItem } from './timeline.types';

interface TimelineItemRowProps {
  item: TimelineItem;
  onApprove?: (item: TimelineItem) => void;
  onReject?: (item: TimelineItem) => void;
  theme?: 'light' | 'dark';
}

export function TimelineItemRow({ item, onApprove, onReject, theme }: TimelineItemRowProps) {
  const storedOpen = useTimelineUiStore((state) => state.openItems[item.id]);
  const setItemOpen = useTimelineUiStore((state) => state.setItemOpen);
  const expandable = Boolean(item.content);
  const open = expandable && (storedOpen ?? item.defaultOpen ?? item.status === 'approval');
  const status = item.status ?? 'success';

  const rowContents = (
    <>
      <span className="oa-timeline-item__icon">
        <TimelineKindIcon kind={item.kind} />
      </span>
      <span className="oa-timeline-item__copy">
        <span className="oa-timeline-item__label">{item.label}</span>
        {item.detail ? <span className="oa-timeline-item__detail">{item.detail}</span> : null}
        {item.badges?.length ? (
          <span aria-label="使用的提供商" className="oa-timeline-item__badges">
            {item.badges.map((badge, index) => (
              <span
                className={`oa-timeline-item__badge oa-timeline-item__badge--${badge.tone ?? 'neutral'}`}
                key={`${badge.label}-${index}`}
                title={badge.title}
              >
                {badge.label}
              </span>
            ))}
          </span>
        ) : null}
      </span>
      {item.status ? (
        <span className={`oa-timeline-item__status oa-timeline-item__status--${status}`}>
          <TimelineStatusIcon status={status} />
        </span>
      ) : null}
      {expandable ? (
        <span className="oa-timeline-item__chevron">
          <TimelineChevron />
        </span>
      ) : null}
    </>
  );

  if (!expandable) {
    return (
      <div className="oa-timeline-item oa-timeline-item--static" data-status={status}>
        <div className="oa-timeline-item__row">{rowContents}</div>
      </div>
    );
  }

  return (
    <Collapsible.Root
      className="oa-timeline-item oa-timeline-disclosure"
      data-open={open}
      data-status={status}
      onOpenChange={(nextOpen) => setItemOpen(item.id, nextOpen)}
      open={open}
    >
      <Collapsible.Trigger asChild>
        <button
          aria-label={item.accessibleLabel ?? `${open ? '收起' : '展开'}${item.label}${item.detail ? ` ${item.detail}` : ''}`}
          className="oa-timeline-item__row"
          type="button"
        >
          {rowContents}
        </button>
      </Collapsible.Trigger>
      <Collapsible.Content asChild forceMount>
        <div className="oa-timeline-panel">
          <div className="oa-timeline-panel__inner">
            <TimelineContent content={item.content!} item={item} onApprove={onApprove} onReject={onReject} theme={theme} />
          </div>
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

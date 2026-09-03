import type { ReactNode } from 'react';

export type TimelineItemKind =
  | 'reasoning'
  | 'read'
  | 'glob'
  | 'search'
  | 'browser'
  | 'tool'
  | 'agent'
  | 'web-search'
  | 'web-fetch'
  | 'command'
  | 'task'
  | 'diff'
  | 'write'
  | 'other';

export type TimelineItemStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'approval';

export type TimelineContent =
  | { type: 'text'; value: string }
  | { type: 'markdown'; value: string }
  | { type: 'terminal'; command?: string; output: string; exitCode?: number }
  | { type: 'json'; value: unknown }
  | { type: 'diff'; patch: string }
  | {
      type: 'approval';
      title: string;
      description?: string;
      approveLabel?: string;
      rejectLabel?: string;
    }
  | { type: 'custom'; node: ReactNode };

export interface TimelineItem {
  id: string;
  kind: TimelineItemKind;
  label: string;
  detail?: string;
  status?: TimelineItemStatus;
  durationMs?: number;
  content?: TimelineContent;
  badges?: readonly TimelineBadge[];
  defaultOpen?: boolean;
  accessibleLabel?: string;
  source?: TimelineItemSource;
}

export interface TimelineItemSource {
  runId?: string;
  toolCallId?: string;
  approvalId?: string;
}

export interface TimelineBadge {
  label: string;
  tone?: 'neutral' | 'dark' | 'pink' | 'brand' | 'more';
  title?: string;
}

export type ToolTimelineViewState = 'ready' | 'loading' | 'empty' | 'error';

export interface ToolTimelineProps {
  items: readonly TimelineItem[];
  className?: string;
  state?: ToolTimelineViewState;
  errorMessage?: string;
  initiallyExpanded?: boolean;
  summaryLabel?: string;
  onApprove?: (item: TimelineItem) => void;
  onReject?: (item: TimelineItem) => void;
  theme?: 'light' | 'dark';
}

export interface TimelineSummaryEntry {
  kind: TimelineItemKind;
  count: number;
  text: string;
}

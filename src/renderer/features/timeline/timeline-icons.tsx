import {
  BookOpen,
  Browser,
  CaretRight,
  CheckCircle,
  CircleNotch,
  Desktop,
  FileMagnifyingGlass,
  GitDiff,
  Globe,
  ListChecks,
  Lightbulb,
  MagnifyingGlass,
  Network,
  Robot,
  TerminalWindow,
  WarningCircle,
  Wrench,
  XCircle,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import type { TimelineItemKind, TimelineItemStatus } from './timeline.types';

const icons: Record<TimelineItemKind, Icon> = {
  reasoning: Lightbulb,
  read: BookOpen,
  glob: FileMagnifyingGlass,
  search: MagnifyingGlass,
  browser: Desktop,
  tool: Wrench,
  agent: Robot,
  'web-search': Globe,
  'web-fetch': Globe,
  command: TerminalWindow,
  task: ListChecks,
  diff: GitDiff,
  write: FileMagnifyingGlass,
  other: Browser,
};

export function TimelineKindIcon({ kind }: { kind: TimelineItemKind }) {
  const IconComponent = icons[kind];
  return <IconComponent aria-hidden="true" size={18} weight="regular" />;
}

export function TimelineStatusIcon({ status }: { status: TimelineItemStatus }) {
  if (status === 'running') {
    return <CircleNotch aria-hidden="true" className="oa-timeline__spinner" size={14} weight="bold" />;
  }

  if (status === 'error') return <XCircle aria-hidden="true" size={14} weight="fill" />;
  if (status === 'approval') return <WarningCircle aria-hidden="true" size={14} weight="fill" />;
  if (status === 'success') return <CheckCircle aria-hidden="true" size={14} weight="fill" />;
  return null;
}

export function TimelineSummaryIcon() {
  return <Network aria-hidden="true" size={19} weight="regular" />;
}

export function TimelineChevron() {
  return <CaretRight aria-hidden="true" size={15} weight="bold" />;
}

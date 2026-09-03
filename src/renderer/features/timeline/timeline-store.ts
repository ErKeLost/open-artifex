import { create } from 'zustand';

interface TimelineUiState {
  openItems: Record<string, boolean>;
  expandedRuns: Record<string, boolean>;
  setItemOpen: (id: string, open: boolean) => void;
  setRunExpanded: (id: string, expanded: boolean) => void;
}

export const useTimelineUiStore = create<TimelineUiState>((set) => ({
  openItems: {},
  expandedRuns: {},
  setItemOpen: (id, open) =>
    set((state) => ({ openItems: { ...state.openItems, [id]: open } })),
  setRunExpanded: (id, expanded) =>
    set((state) => ({ expandedRuns: { ...state.expandedRuns, [id]: expanded } })),
}));


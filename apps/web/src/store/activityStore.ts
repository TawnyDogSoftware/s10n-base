import type { ActivityEntry } from "@s10n-base/contracts";
import { create } from "zustand";

interface ActivityState {
  readonly activities: ActivityEntry[];
  readonly setSnapshot: (activities: readonly ActivityEntry[]) => void;
  readonly appendActivity: (activity: ActivityEntry) => void;
}

export const useActivityStore = create<ActivityState>((set) => ({
  activities: [],
  setSnapshot: (activities) => set({ activities: [...activities] }),
  appendActivity: (activity) =>
    set((state) => ({
      activities: [activity, ...state.activities].slice(0, 25),
    })),
}));

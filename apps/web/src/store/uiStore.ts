import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UiState {
  readonly denseNotes: boolean;
  readonly showSidebarHints: boolean;
  readonly setDenseNotes: (denseNotes: boolean) => void;
  readonly setShowSidebarHints: (showSidebarHints: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      denseNotes: false,
      showSidebarHints: true,
      setDenseNotes: (denseNotes) => set({ denseNotes }),
      setShowSidebarHints: (showSidebarHints) => set({ showSidebarHints }),
    }),
    {
      name: "s10n-base-ui-settings",
    },
  ),
);

// Persisted camera view for the ocarina stage (slow UI state, not per-frame).

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { cycleView, DEFAULT_VIEW, parseView, type CameraViewId } from './cameraViews';

export interface OcarinaCameraStore {
  view: CameraViewId;
  setView(v: CameraViewId): void;
  step(dir: 1 | -1): void;
}

export const useOcarinaCamera = create<OcarinaCameraStore>()(
  persist(
    (set, get) => ({
      view: DEFAULT_VIEW,
      setView: (v) => set({ view: parseView(v) }),
      step: (dir) => get().setView(cycleView(get().view, dir)),
    }),
    {
      name: 'senecai.ocarina.v1',
      partialize: (s) => ({ view: s.view }),
      // Unknown stored values fall back to the default view.
      merge: (persisted, current) => ({ ...current, view: parseView((persisted as { view?: unknown } | undefined)?.view) }),
    },
  ),
);

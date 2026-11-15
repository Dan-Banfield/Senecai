// Persisted playback/lesson preferences (slow UI state): the selected song,
// shared by the playback bar and the Lesson panel, and the speed applied to
// replays and lessons.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { clampSpeed } from './market/lessonSong';
import { SONGS } from './songs';

/** Song picker value: a built-in song id, or `lib:<market id>` for a downloaded song. */
export const LIB_PREFIX = 'lib:';
export const DEFAULT_PICK = SONGS[0].id;

export interface LessonPrefs {
  pick: string;
  /** One of SPEEDS (0.5, 0.75, 1, 1.5, 2); 1 = the song's own tempo. */
  speed: number;
  setPick(pick: string): void;
  setSpeed(v: number): void;
}

export const useLessonPrefs = create<LessonPrefs>()(
  persist(
    (set) => ({
      pick: DEFAULT_PICK,
      speed: 1,
      setPick: (pick) => set({ pick }),
      setSpeed: (v) => set({ speed: clampSpeed(v) }),
    }),
    {
      name: 'senecai.ocarina.lesson.v1',
      partialize: (s) => ({ pick: s.pick, speed: s.speed }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as { pick?: unknown; speed?: unknown };
        const pick =
          typeof p.pick === 'string' && (p.pick.startsWith(LIB_PREFIX) || SONGS.some((s) => s.id === p.pick)) ? p.pick : DEFAULT_PICK;
        return { ...current, pick, speed: typeof p.speed === 'number' ? clampSpeed(p.speed) : 1 };
      },
    },
  ),
);

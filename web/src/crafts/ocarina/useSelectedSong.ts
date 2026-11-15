// The song picked in the playback bar / Lesson panel, resolved to something
// playable: a built-in Song (with a generated demo take) or a downloaded market
// song (its recorded take, and lesson notes derived from it).

import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_PICK, LIB_PREFIX, useLessonPrefs } from './lessonPrefs';
import { library, useLibrary } from './market/library';
import { songToDemoTake, takeToSong } from './market/lessonSong';
import { SONGS } from './songs';
import type { Song, Take } from './types';

export interface SelectedSong {
  pick: string;
  setPick(pick: string): void;
  /** Downloaded songs for the picker (title order). */
  downloaded: ReturnType<typeof useLibrary>['songs'];
  /** Resolved lesson song; undefined while a downloaded song loads (or failed). */
  song: Song | undefined;
  /** What Watch / Play replays; undefined while loading. */
  take: Take | undefined;
  /** Recorder of a downloaded song. */
  artist: string | null;
  /** The market id of a downloaded pick, else null. */
  libId: string | null;
  error: string | null;
}

interface Loaded {
  pick: string;
  artist: string;
  take: Take;
  song: Song;
}

export function useSelectedSong(): SelectedSong {
  const pick = useLessonPrefs((s) => s.pick);
  const setPick = useLessonPrefs((s) => s.setPick);
  const saved = useLibrary();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const libId = pick.startsWith(LIB_PREFIX) ? pick.slice(LIB_PREFIX.length) : null;

  // A downloaded song that was removed falls back to the first built-in song.
  const listed = saved.songs.some((s) => s.id === libId);
  useEffect(() => {
    if (libId && !saved.error && saved.loaded && !listed) setPick(DEFAULT_PICK);
  }, [libId, listed, saved.error, saved.loaded, setPick]);

  useEffect(() => {
    setError(null);
    if (!libId) return;
    let alive = true;
    library.get(libId).then(
      (full) => {
        if (alive && full) setLoaded({ pick, artist: full.artist, take: full.take, song: takeToSong(full.take, pick, full.title) });
      },
      (e: unknown) => alive && setError(e instanceof Error ? e.message : 'Could not load this song.'),
    );
    return () => {
      alive = false;
    };
  }, [libId, pick]);

  const builtIn = libId ? undefined : SONGS.find((s) => s.id === pick);
  const demo = useMemo(() => (builtIn ? songToDemoTake(builtIn) : undefined), [builtIn]);
  const lib = libId && loaded?.pick === pick ? loaded : null;

  return {
    pick,
    setPick,
    downloaded: saved.songs,
    song: builtIn ?? lib?.song,
    take: demo ?? lib?.take,
    artist: lib?.artist ?? null,
    libId,
    error,
  };
}

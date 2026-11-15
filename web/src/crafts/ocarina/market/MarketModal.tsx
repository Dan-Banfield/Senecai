// Song market modal: search/sort/filter the market, preview a song's first
// seconds as sound only, replay it on the stage and robot through the session
// (closing the modal so you can watch), or download it to the lesson library.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../../ui/icons';
import { midiToName } from '../fingering';
import { useOcarinaUi, type OcarinaSession } from '../session';
import { market } from './index';
import { library, useLibrary } from './library';
import { previewPlayer, usePreview } from './preview';
import type { MarketSongMeta, NoteRange } from './types';

type SortKey = 'newest' | 'title' | 'length';

const SORT_LABEL: Record<SortKey, string> = { newest: 'Newest', title: 'Title A–Z', length: 'Length' };
const SORTS: readonly SortKey[] = ['newest', 'title', 'length'];

const COMPARE: Record<SortKey, (a: MarketSongMeta, b: MarketSongMeta) => number> = {
  newest: (a, b) => b.createdAt - a.createdAt,
  title: (a, b) => a.title.localeCompare(b.title),
  length: (a, b) => a.durationMs - b.durationMs,
};

/** m:ss */
const fmtClock = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const fmtRange = (r: NoteRange | null) => {
  if (!r) return '—';
  return r.low === r.high ? midiToName(r.low) : `${midiToName(r.low)}–${midiToName(r.high)}`;
};

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong.');

type ListState =
  | { status: 'loading'; songs: MarketSongMeta[] }
  | { status: 'ready'; songs: MarketSongMeta[] }
  | { status: 'error'; songs: MarketSongMeta[]; error: string };

export function MarketModal({ session, open, onClose }: { session: OcarinaSession; open: boolean; onClose: () => void }) {
  const recording = useOcarinaUi((s) => s.recording);
  const replaying = useOcarinaUi((s) => s.replaying);
  const muted = useOcarinaUi((s) => s.muted);
  const previewingId = usePreview((s) => s.previewingId);

  const [list, setList] = useState<ListState>({ status: 'loading', songs: [] });
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');
  const [mineOnly, setMineOnly] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const saved = useLibrary();
  const savedIds = useMemo(() => new Set(saved.songs.map((s) => s.id)), [saved.songs]);
  /** Bumped whenever a pending preview fetch must not start playing (close, stop, newer click). */
  const previewSeq = useRef(0);
  /** Bumped on every Play click and on close, so a slow get() can't start a stale replay. */
  const playSeq = useRef(0);
  useEffect(() => {
    if (!open) playSeq.current++;
  }, [open]);

  const setError = (id: string, msg: string | null) =>
    setErrors((prev) => {
      if (msg === null) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: msg };
    });

  const stopPreview = () => {
    previewSeq.current++;
    previewPlayer.stop();
  };

  // Load the list while open, and reload after every publish/remove.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    let seq = 0;
    const load = () => {
      const mine = ++seq;
      setList((prev) => (prev.status === 'ready' ? prev : { status: 'loading', songs: prev.songs }));
      market.list().then(
        (songs: MarketSongMeta[]) => alive && mine === seq && setList({ status: 'ready', songs }),
        (e: unknown) => alive && mine === seq && setList((prev) => ({ status: 'error', songs: prev.songs, error: errText(e) })),
      );
    };
    load();
    const unsubscribe = market.subscribe(load);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [open]);

  // Esc closes; never swallows the event, so other Esc handlers still run.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
    else setConfirmId(null);
  }, [open]);

  useEffect(() => previewPlayer.setMuted(muted), [muted]);

  // Closing the modal, recording or any replay stops the preview; so does unmounting.
  useEffect(() => {
    if (!open || recording || replaying) stopPreview();
  }, [open, recording, replaying]);
  useEffect(() => () => stopPreview(), []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.songs
      .filter((s) => !mineOnly || s.mine)
      .filter((s) => !q || s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q))
      .sort(COMPARE[sort]);
  }, [list.songs, query, sort, mineOnly]);

  const togglePreview = async (song: MarketSongMeta) => {
    setError(song.id, null);
    if (previewingId === song.id) {
      stopPreview();
      return;
    }
    // A preview and a replay never overlap (SPEC: replay <-> preview stop each other).
    if (replaying) session.stopReplay();
    const seq = ++previewSeq.current;
    previewPlayer.stop();
    try {
      const full = await market.get(song.id);
      if (seq !== previewSeq.current) return;
      if (!full) throw new Error('This song is no longer available.');
      previewPlayer.play(song.id, full.take);
    } catch (e) {
      if (seq === previewSeq.current) setError(song.id, errText(e));
    }
  };

  const togglePlay = async (song: MarketSongMeta) => {
    setError(song.id, null);
    if (replaying === song.id) {
      session.stopReplay();
      return;
    }
    const seq = ++playSeq.current;
    setBusyId(song.id);
    try {
      const full = await market.get(song.id);
      if (seq !== playSeq.current) return;
      if (!full) throw new Error('This song is no longer available.');
      stopPreview();
      session.replayTake(full.take, song.id);
      onClose();
    } catch (e) {
      if (seq === playSeq.current) setError(song.id, errText(e));
    } finally {
      setBusyId((b) => (b === song.id ? null : b));
    }
  };

  const download = async (song: MarketSongMeta) => {
    setError(song.id, null);
    setSavingId(song.id);
    try {
      const full = await market.get(song.id);
      if (!full) throw new Error('This song is no longer available.');
      await library.save(full);
    } catch (e) {
      setError(song.id, errText(e));
    } finally {
      setSavingId((b) => (b === song.id ? null : b));
    }
  };

  const remove = async (song: MarketSongMeta) => {
    setError(song.id, null);
    setBusyId(song.id);
    try {
      if (useOcarinaUi.getState().replaying === song.id) session.stopReplay();
      if (usePreview.getState().previewingId === song.id) stopPreview();
      await market.remove(song.id);
      setConfirmId(null);
    } catch (e) {
      setError(song.id, errText(e));
    } finally {
      setBusyId((b) => (b === song.id ? null : b));
    }
  };

  if (!open) return null;

  const hasMine = list.songs.some((s) => s.mine);
  let empty: string | null = null;
  if (list.status !== 'loading' && visible.length === 0) {
    if (mineOnly && !hasMine) empty = "You haven't published any takes yet";
    else if (query.trim()) empty = 'No songs match';
    else if (list.status === 'ready') empty = 'No songs in the market yet';
  }

  return (
    <div
      className="oc-market-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div id="oc-market" className="oc-market" role="dialog" aria-label="Song market" aria-modal="true">
        <header className="oc-market-head">
          <h2>Song market</h2>
          <button type="button" className="oc-icon-btn ghost oc-market-close" aria-label="Close song market" title="Close (Esc)" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>

        <div className="oc-market-toolbar">
          <label className="oc-market-search">
            <Icon name="search" size={16} />
            <input
              ref={searchRef}
              type="search"
              placeholder="Search title or artist"
              aria-label="Search songs by title or artist"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="oc-market-filters">
            <select className="oc-market-sort" aria-label="Sort songs" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              {SORTS.map((k) => (
                <option key={k} value={k}>
                  {SORT_LABEL[k]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={`oc-market-chip${mineOnly ? ' on' : ''}`}
              aria-pressed={mineOnly}
              onClick={() => setMineOnly((m) => !m)}
            >
              My uploads
            </button>
          </div>
        </div>

        <div className="oc-market-body">
          {list.status === 'loading' && list.songs.length === 0 && (
            <p className="oc-market-status" role="status">
              Loading songs…
            </p>
          )}
          {list.status === 'error' && (
            <p className="oc-market-status error" role="alert">
              Couldn't load the market: {list.error}
            </p>
          )}
          {empty && <p className="oc-market-empty">{empty}</p>}
          {visible.length > 0 && (
            <ul className="oc-market-list">
              {visible.map((song) => {
                const playing = replaying === song.id;
                const previewing = previewingId === song.id;
                const busy = busyId === song.id;
                const inLibrary = savedIds.has(song.id);
                const saving = savingId === song.id;
                const err = errors[song.id];
                return (
                  <li key={song.id} className={`oc-market-card${playing ? ' playing' : ''}${previewing ? ' previewing' : ''}`}>
                    <div className="oc-market-card-main">
                      <div className="oc-market-card-text">
                        <h3 className="oc-market-title">{song.title}</h3>
                        <p className="oc-market-artist">
                          {song.artist}
                          {song.mine && <span className="oc-market-badge">Yours</span>}
                        </p>
                        <p className="oc-market-meta">
                          <span title="Duration">{fmtClock(Math.round(song.durationMs / 1000) * 1000)}</span>
                          <span aria-hidden="true">·</span>
                          <span title="Note range">{fmtRange(song.noteRange)}</span>
                        </p>
                      </div>
                      <div className="oc-market-actions">
                        <button
                          type="button"
                          className={`oc-icon-btn${previewing ? ' active' : ''}`}
                          disabled={recording}
                          aria-pressed={previewing}
                          aria-label={previewing ? `Stop preview of ${song.title}` : `Preview ${song.title} (sound only)`}
                          title={previewing ? 'Stop preview' : 'Preview (sound only)'}
                          onClick={() => void togglePreview(song)}
                        >
                          <Icon name={previewing ? 'stop' : 'music'} size={16} />
                        </button>
                        <button
                          type="button"
                          className={`oc-market-play${playing ? ' on' : ''}`}
                          disabled={recording || (busy && !playing)}
                          aria-label={playing ? `Stop ${song.title}` : `Play ${song.title} on the hands`}
                          title={playing ? 'Stop replay' : 'Replay on the stage and robot'}
                          onClick={() => void togglePlay(song)}
                        >
                          <Icon name={playing ? 'stop' : 'play'} size={14} />
                          {playing ? 'Stop' : 'Play'}
                        </button>
                        <button
                          type="button"
                          className={`oc-icon-btn${inLibrary ? ' active' : ''}`}
                          disabled={inLibrary || saving}
                          aria-label={inLibrary ? `${song.title} is in your lesson library` : `Download ${song.title} for lessons`}
                          title={inLibrary ? 'In your lesson library' : 'Download for lessons'}
                          onClick={() => void download(song)}
                        >
                          <Icon name={inLibrary ? 'check' : 'download'} size={16} />
                        </button>
                        {song.mine && (
                          <button
                            type="button"
                            className="oc-icon-btn ghost"
                            disabled={busy || confirmId === song.id}
                            aria-label={`Delete ${song.title}`}
                            title="Delete"
                            onClick={() => setConfirmId(song.id)}
                          >
                            <Icon name="trash" size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                    {confirmId === song.id && (
                      <div className="oc-market-confirm" role="group" aria-label={`Confirm deleting ${song.title}`}>
                        <span>Delete?</span>
                        <button type="button" className="oc-market-chip danger" disabled={busy} onClick={() => void remove(song)}>
                          Yes
                        </button>
                        <button type="button" className="oc-market-chip" disabled={busy} onClick={() => setConfirmId(null)}>
                          No
                        </button>
                      </div>
                    )}
                    {err && (
                      <p className="oc-market-error" role="alert">
                        {err}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

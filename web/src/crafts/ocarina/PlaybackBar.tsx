// Playback bar along the bottom of the ocarina stage, for the song picked in the
// Lesson panel: set the speed and press play. In Free play that plays the
// song's movements on the hands and robot (pause, scrub, stop); in Lesson mode
// it starts the lesson at that speed. Any replay (takes, market songs, demos)
// shows and is controlled here.

import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../../ui/icons';
import { useLessonPrefs } from './lessonPrefs';
import { scheduleSong } from './lesson';
import { songAtSpeed, SPEEDS } from './market/lessonSong';
import { previewPlayer } from './market/preview';
import { useOcarinaUi, type OcarinaSession } from './session';
import { useSelectedSong } from './useSelectedSong';

/** m:ss */
const fmtClock = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/** At least one decimal: 1 -> '1.0×', 2 -> '2.0×', 0.75 -> '0.75×', 1.5 -> '1.5×'. */
const fmtSpeed = (v: number) => `${Number.isInteger(v) ? v.toFixed(1) : String(v)}×`;


/** Watch replays are tagged with this id prefix plus the picker value. */
export const WATCH_PREFIX = 'watch:';

export function PlaybackBar({ session }: { session: OcarinaSession }) {
  const replaying = useOcarinaUi((s) => s.replaying);
  const replayingName = useOcarinaUi((s) => s.replayingName);
  const durationMs = useOcarinaUi((s) => s.replayDurationMs);
  const paused = useOcarinaUi((s) => s.replayPaused);
  const recording = useOcarinaUi((s) => s.recording);
  const lesson = useOcarinaUi((s) => s.lesson);
  const mode = useOcarinaUi((s) => s.mode);
  const speed = useLessonPrefs((s) => s.speed);
  const setSpeed = useLessonPrefs((s) => s.setSpeed);
  const sel = useSelectedSong();
  const [time, setTime] = useState(0);
  const lessonRunning = !!lesson && lesson.state !== 'done';

  useEffect(() => session.setPlaybackRate(speed), [session, speed]);

  // Poll the replay position ~10x per second while something replays.
  useEffect(() => {
    if (!replaying) {
      setTime(0);
      return;
    }
    setTime(session.replayTime);
    const id = window.setInterval(() => setTime(session.replayTime), 100);
    return () => window.clearInterval(id);
  }, [replaying, session]);

  const title = sel.song
    ? sel.artist
      ? `${sel.song.title} · ${sel.artist}`
      : sel.song.title
    : sel.libId
      ? (sel.error ?? 'Loading…')
      : '';
  const lessonMode = mode === 'lesson' && !replaying;
  const lessonMs = useMemo(() => (sel.song ? scheduleSong(songAtSpeed(sel.song, speed)).totalMs : 0), [sel.song, speed]);
  const idleDuration = lessonMode ? lessonMs : (sel.take?.durationMs ?? 0) / speed;
  // Clock shows real (speed-adjusted) time; the seek slider works in take time.
  const shownTotal = replaying ? durationMs / speed : idleDuration;
  const shownTime = replaying ? time / speed : 0;
  const playable = lessonMode ? !!sel.song && sel.song.notes.length > 0 : !!sel.take;
  const canStart = !recording && !lessonRunning && playable;

  const playPause = () => {
    if (lessonMode) {
      if (lessonRunning) session.stopLesson();
      else if (sel.song) {
        previewPlayer.stop();
        session.startLesson(sel.song, false, speed);
      }
      return;
    }
    if (replaying) {
      session.setReplayPaused(!paused);
      return;
    }
    if (!sel.take || !sel.song) return;
    previewPlayer.stop();
    const name = sel.artist ? `${sel.song.title} · ${sel.artist}` : sel.song.title;
    session.replayTake({ ...sel.take, name }, WATCH_PREFIX + sel.pick);
  };

  let mainLabel: string;
  let mainIcon: 'play' | 'pause' | 'stop';
  if (lessonMode) {
    mainLabel = lessonRunning ? 'Stop the lesson' : lesson ? 'Play the lesson again' : 'Start the lesson';
    mainIcon = lessonRunning ? 'stop' : 'play';
  } else if (replaying) {
    mainLabel = paused ? 'Resume' : 'Pause';
    mainIcon = paused ? 'play' : 'pause';
  } else {
    mainLabel = 'Play the movements on the hands and robot';
    mainIcon = 'play';
  }

  return (
    <div className="oc-playback" role="region" aria-label="Playback">
      <button
        type="button"
        className="oc-playback-main"
        disabled={!replaying && !lessonRunning && !canStart}
        aria-label={mainLabel}
        title={mainLabel}
        onClick={playPause}
      >
        <Icon name={mainIcon} size={18} />
      </button>
      <button
        type="button"
        className="oc-icon-btn"
        disabled={!replaying && !lessonRunning}
        aria-label="Stop"
        title="Stop"
        onClick={() => (replaying ? session.stopReplay() : session.stopLesson())}
      >
        <Icon name="stop" size={16} />
      </button>

      <div className="oc-playback-track">
        <span className="oc-playback-title">{replaying ? replayingName : title}</span>
        <div className="oc-playback-seek">
          <span className="mono">{fmtClock(shownTime)}</span>
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.round(durationMs))}
            step={10}
            value={replaying ? Math.min(time, durationMs) : 0}
            disabled={!replaying}
            aria-label="Seek"
            onChange={(e) => {
              const v = Number(e.target.value);
              session.seekReplay(v);
              setTime(v);
            }}
          />
          <span className="mono">{fmtClock(shownTotal)}</span>
        </div>
      </div>

      <label className="oc-playback-speed" title="Speed of playback and lessons">
        <select aria-label="Speed" value={speed} disabled={lessonRunning} onChange={(e) => setSpeed(Number(e.target.value))}>
          {SPEEDS.map((v) => (
            <option key={v} value={v}>
              {fmtSpeed(v)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

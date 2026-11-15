# Ocarina — Song Market

## Goal

On the ocarina page (`/craft/ocarina`), let players browse songs that other people recorded and published, and replay any of them on the stage and the robot hands, exactly like replaying one of their own takes. Players can also publish their own takes to the market.

There is no real server. A **fake local backend** sits behind a small API seam (`SongMarketApi`) so a real server can replace it later.

## Placement

- A **Song market** button on the ocarina page (in the top-right `oc-top-actions` group, icon + short label) opens a **centred modal** over the stage with a dimmed backdrop (z-index 45: above the craft header, below the input-panel drawer).
- The modal closes with its close icon, `Esc`, or a click on the backdrop. **Play closes the modal** so the replay can be watched. Its open/closed state is not persisted.
- While anything replays, the playback bar shows it and controls it.
- Narrow screens (≤ 768px): the modal fills the screen inside a 12px gutter.
- Styled in the existing parchment/atlas craft theme (`.app.craft` tokens, `rgba(78, 61, 43, …)` borders, `--display` headings), and uses the icon set in `web/src/ui/icons.tsx` (new icons are added there).

## Data model

```ts
interface MarketSong {
  id: string;
  title: string;          // 1–60 chars, trimmed
  artist: string;         // 1–40 chars, trimmed
  createdAt: number;      // ms epoch
  durationMs: number;
  noteRange: { low: number; high: number } | null; // MIDI, from frames; null if silent
  mine: boolean;          // published from this browser
  take: Take;             // the existing ocarina Take (frames with dof, holes, midi, inspire)
}
```

`SongMarketApi` (async, Promise-based so a network backend fits later):
- `list(): Promise<MarketSongMeta[]>`: everything except `take.frames` (cheap to render).
- `get(id): Promise<MarketSong | undefined>`: the full song, frames included.
- `publish(take, { title, artist }): Promise<MarketSongMeta>`
- `remove(id): Promise<void>`: only for `mine` songs; rejects otherwise.

### Fake backend
- **Seeded songs:** about 12 short public-domain melodies, written into the codebase as `Song`-style note lists (same shape as `songs.ts`), all within the alto range C5–F6 (`SCALE_MIDI`). Examples: Ode to Joy, Frère Jacques, Greensleeves, Twinkle Twinkle, Santa Lucia, a Finnish folk tune (e.g. *Täällä Pohjantähden alla* or *Karjalan kunnailla*), When the Saints, Amazing Grace, Scarborough Fair, Lightly Row, Au Clair de la Lune, Brahms' Lullaby. Each is credited to a made-up player name and given a deterministic `createdAt` in the past.
- **Generated takes:** each seed melody becomes a `Take` at load time (deterministic, no randomness at runtime beyond a fixed seed). For each note, `fingeringFor(midi)` gives the target holes. Per-finger flexion eases between notes over about 60–90 ms (covered ≈ 0.9–1.0, open ≈ 0.1–0.2, with small per-finger seeded variation so it doesn't look robotic). Rests keep the fingering but stop the sound (`midi: null`). `inspire` comes from the same Dof → Inspire conversion the live pipeline uses (`toInspireAngles`). Frames are generated at about 60 fps. Seeds are generated lazily (on first `get`/preview), not at page load.
- **Uploads:** stored in **IndexedDB** (database `senecai-ocarina-market`, one object store keyed by id) at full fidelity. Seeds are never written to storage.
- **Storage errors** (quota exceeded, IndexedDB unavailable, e.g. a private window) reject with a readable message, shown inline in the publish form. The market still lists seeds when IndexedDB is unavailable.

## Browsing

Drawer layout, top to bottom:
1. **Header:** "Song market" title, close icon.
2. **Toolbar:** a search box (matches title or artist, case-insensitive, live as you type), a sort select (**Newest** (default) / **Title A–Z** / **Length**), and a **My uploads** toggle chip that filters to `mine` songs.
4. **Song list:** one card per song. No cover art. Each card shows:
   - the title (prominent) and artist
   - the duration (`m:ss`) and note range (e.g. `C5–A5`)
   - an **audio preview** icon button
   - a **Play** button (robot replay; closes the modal)
   - a **Download** icon that saves the full song to the lesson library (a check once saved)
   - a delete icon on `mine` songs, which asks for confirmation inline ("Delete? Yes / No")
   - a "Yours" badge on `mine` songs
5. **Empty states:** "No songs match" for a search with no results; "You haven't published any takes yet" for My uploads with nothing in it.

## Audio preview
- Plays the **first ~8 s** of the song as **sound only**: the stage, hands and robot don't move, and nothing is sent to the robot.
- Toggles play/stop on the card. Starting another preview, starting any replay, starting a recording, or closing the modal stops the current preview.
- Uses the existing ocarina synth (respects mute). If audio is not enabled yet, clicking preview counts as the user gesture that unlocks it.
- Disabled while recording.

## Replay (Play)
- Goes through the **same path as take replay**: `OcarinaSession` drives the stage view, holes, sound, and the robot override with the recorded `inspire` commands. Live input is paused as it is for take replay, and the "Replay" stage tag shows.
- The session gains a way to replay a `Take` that isn't in its own take list (e.g. `replayTake(take, label)`); `useOcarinaUi.replaying` holds the market song id while it plays.
- Starting a market replay stops any take replay or preview in progress, and vice versa. Play is disabled while recording.
- When the song ends, replay stops by itself (same as takes) and the now-playing bar disappears.
- The card that's playing shows a Stop button in place of Play.

## Publishing
- Each take in the recorder's take list gets an **upload icon** button (next to delete).
- It opens a small inline form (inside the recorder card, below that take) with **Title** (defaults to the take name) and **Your name** (defaults to the last name used, remembered in `localStorage`; empty on first use). Then **Publish** / **Cancel**.
- Validation: both fields required after trimming, with the length limits above. Publish is disabled while invalid or while saving.
- On success the form closes, the take row shows a "Published" check (for this session), and the song appears in the market (at the top of Newest, with the "Yours" badge). Publishing the same take twice creates two songs (allowed).
- Publishing is disabled for a take while it's recording or replaying.

## Lesson library and playback bar

- **Downloaded songs** are stored in IndexedDB (same database, store `library`, DB version 2) with their full take. They appear in a "Downloaded" group under the built-in songs, in the Lesson panel's song picker. The selection is persisted (`senecai.ocarina.lesson.v1`: `pick`, `speed`).
- A downloaded take becomes lesson notes via `takeToSong`: runs of the sounding MIDI, blips under 90 ms folded into the previous run, silence trimmed, at 120 bpm (1 beat = 500 ms).
- **Playback bar** (bottom centre of the stage; full width at ≤ 1100px; wraps on phones):
  - play/pause, which plays the selected song's movements on the stage and robot: the recorded take for downloaded songs, a generated demo take for built-in ones
  - stop
  - the title of whatever replays (takes and market songs too), with a seek slider and elapsed/total time
  - a speed menu
- **Pause** freezes the hands on the current frame and silences the sound. **Seek** jumps within the take.
- **Speed** is one of 0.5× / 0.75× / 1× / 1.5× / 2× (default 1×, persisted). It sets the session's playback rate for every replay (live, even mid-replay) and the tempo of lessons (count-in included). It's locked while a lesson runs.
- **Lesson mode:** the bar's play button starts the selected song's lesson (always timed; "Wait for me" was removed) at the chosen speed, and stop or play ends it. The Lesson panel keeps only the song picker, the downloaded-song row with its remove icon, and the running lesson's card.
- The bar has no song picker; it plays the song selected in the Lesson panel. The clock shows real (speed-adjusted) time.

## Non-goals
- No real server, accounts, likes, play counts, ratings, prices or coins.
- No cover art.
- No editing a published song (delete and republish instead).
- No changes to how takes are recorded, to lessons, to camera views, or to the bench/kantele.
- Market songs aren't added to the session take list.

## Acceptance criteria
1. Clicking **Song market** opens the modal with about 12 seeded songs sorted Newest. `Esc`, the close icon or a backdrop click closes it.
2. Typing in search filters by title or artist; sort switches between Newest, Title A–Z and Length.
3. **Play** on a seeded song makes the stage hands finger the melody, the sound plays, the robot override streams `inspire`, and the "Replay" tag shows. It stops by itself at the end or via the now-playing stop.
4. The preview icon plays about 8 s of sound with no hand or robot motion. Starting Play or another preview stops it.
5. Recording a take, clicking its upload icon, and publishing with a title and name puts it in the market with a "Yours" badge. It's still there after a page reload and replays identically to the original take.
6. **My uploads** shows only my songs; deleting one (after confirming) removes it, and it stays gone after reload.
7. If IndexedDB is unavailable, seeds still list and play, and publishing shows an inline error instead of throwing.
8. All seeded melodies are playable on the instrument: every note maps to a fingering via `fingeringFor` (unit test).
9. Seed generation is deterministic (same take for the same song across calls; unit test), and generated frames' holes match the fingering of the sounding note.
10. `npm run build` and `npm test` pass.

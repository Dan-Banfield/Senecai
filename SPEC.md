# SPEC: Ocarina craft (Italy)

## 1. Globe pin
- Add one entry to `CRAFTS` in `web/src/crafts/catalog.ts`:
  - `id: 'ocarina'`, `name: 'Ocarina'`, `localName: 'ocarina'`
  - `country: 'Italy'` (must match world-atlas; existing test enforces)
  - `region: 'Budrio, Emilia-Romagna'`, `lat: 44.537`, `lng: 11.535`
  - `blurb`: Giuseppe Donati's 1853 12-hole clay vessel flute from Budrio.
  - `robotSkills`: independent finger isolation; sealing holes with fingertip pads; timed finger-lift sequences; two-hand coordination.
  - `status: 'playable'`, `route: '/craft/ocarina'`
  - `image`: a freely licensed Wikimedia Commons ocarina photo, resized to 640px wide, saved as `web/public/crafts/ocarina.jpg`, with real author/license/source.
- The globe renders the pin through its existing CRAFTS pipeline, so no new pin type is needed.

## 2. Route and page
- Lazy-loaded `OcarinaPage` at `/craft/ocarina` in `App.tsx`.
- Accepts **any input source** (gloves, webcam, keyboard) through the existing pipeline. When no source is active, the page suggests Rokoko gloves first.
- Downstream code stays source-agnostic, per CLAUDE.md: it reads `live` / Retargeter output only.

## 3. Hands: wrist locked, fingers only
- **Instrument model:** the user-supplied 12-hole ocarina `web/public/crafts/ocarina.stl` (binary STL, mm), loaded at runtime with STLLoader.
  - It is placed with finger holes up, the mouthpiece pointing at the player, and the wide end on the left.
  - Hole centres, normals and radii are measured from the mesh.
- Two existing `RobotHand` (Inspire 6-DoF) models.
- **Wrist position and rotation are fixed.** Glove wrist translation and rotation are ignored.
- **Hold:** a flute hold, as the hole layout implies. The subholes sit beside the middle-finger holes, and each thumb hole lies under its index finger.
  - Both hands run index → little from the mouthpiece end.
  - The right hand is on the player's side, palm away, fingers curling over the top.
  - The left hand is on the far side, palm toward the player, fingers curling back over the top.
  - Thumbs press the underside thumb holes.
- Only the calibrated per-finger flexion (0..1 from the Retargeter, thumb = thumb bend) drives the fingers and the holes.
- **Digit posing:** each digit is posed by IK so its pad lands on its real hole, facing into it, whenever the hole counts as covered. Otherwise it follows flexion but stops short, hovering clear of the hole.
- **Clearance:** a test checks the hands against the real mesh. No sampled hand point may be inside the clay when open, hovering or covering.

## 4. Holes and fingering (12-hole Italian alto C, subholes omitted = 10 holes)
- Each finger maps to one hole: L index, middle, ring, pinky and R index, middle, ring, pinky on top; L thumb and R thumb on the back.
- A hole is **covered** when flexion ≥ 0.55 and **uncovered** when flexion < 0.45 (hysteresis; the state holds in between).
- Covered holes light up on the 3D ocarina.
- Pitch uses a Helmholtz (vessel flute) model: pitch depends on the total open-hole area, not on which holes are open. Hole areas are derived so that the standard lift order hits the scale exactly:

  | Open holes (cumulative lift order) | Note |
  |---|---|
  | none (all covered) | C5 |
  | + R pinky | D5 |
  | + R ring | E5 |
  | + R middle | F5 |
  | + R index | G5 |
  | + L pinky | A5 |
  | + L ring | B5 |
  | + L middle | C6 |
  | + L index | D6 |
  | + L thumb | E6 |
  | + R thumb (all open) | **silent** |

  Area formula: `area_k ∝ f_k² − f_(k−1)²`. Any other combination produces a pitch from its total open area, snapped to the nearest semitone, so cross-fingerings give accidentals.
- **Always sounding**: a note plays whenever at least one hole is covered and a hand is tracked. All holes open, or no tracking, means silence. A mute toggle is available.

## 5. Audio
- WebAudio synth: sine plus a little triangle, with soft band-passed breath noise. 30 ms attack, 60 ms release, 20 ms glide between notes.

## 6. Game modes
- **Free play**: shows the current note name, a 10-dot fingering diagram of the covered holes, and the lit holes on the 3D ocarina.
- **Lesson**:
  - Pick a song. A note lane scrolls; the current target note and its fingering diagram are shown.
  - A one-bar count-in starts each run.
  - A "wait for me" toggle: when on, the melody advances only after the correct note has been held for 300 ms. When off, the melody plays at tempo.
  - Scoring (timed mode): a note is a hit if the correct pitch sounds for at least 50% of its duration. The result shows hit % and 1–3 stars (≥60 / ≥80 / ≥95%).
- Songs are plain data in `songs.ts` as `{ title, bpm, beatsPerBar, notes: [{ note: 'E5', beats: 1 }] }`, so more tunes can be added by hand.
- Shipped songs: **C major scale** (up and down) and **"Clockwork Waltz"**, an original slow 3/4 melody of about 16 bars within C5–E6.
  - Copyrighted game melodies (e.g. the Song of Time) are not shipped. The song format lets you add any tune locally.

## 7. Recording and replay (session-only)
- Record/Stop button. Each frame of a take stores:
  - timestamp (ms)
  - both hands' per-finger flexion (calibrated)
  - the 10 hole states
  - the sounding note (MIDI or null)
  - each side's `RobotHandCommand` (Inspire 0..1000)
- Takes are kept **in memory for the session** (not persisted, not exported), listed on the page with replay and delete.
- Replay drives the 3D hands, the holes and the audio from the take, and ignores live input until replay stops.

## 8. Robot bridge streaming
- While playing live, the retargeted `RobotHandCommand`s stream to the bridge through the existing pipeline mechanism.
- During replay, the recorded commands stream instead, so a connected robot reproduces the take.

## 9. Tests (vitest)
- Fingering → pitch: every row of the table; the all-open case is silent; cross-fingerings snap to semitones.
- Hole hysteresis thresholds.
- Lesson scoring (hit %, stars, wait-mode advance).
- Recording: replaying a take reproduces the same hole states and notes frame by frame.
- The catalog's world-atlas country test passes with Italy.
- `npm run build` and `npm test` pass.

## Out of scope
- Persisted or exported takes, microphone breath, subholes (A4/B4), and community/sharing features.

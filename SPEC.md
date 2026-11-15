# Ocarina stage — switchable camera views

## Goal

Let the player switch the ocarina stage camera (`/craft/ocarina`) between three fixed views, using the arrow keys or on-screen buttons. The camera glides smoothly between views, and the chosen view is remembered across reloads.

## Views

The instrument and hands are tipped together about X (`INSTRUMENT_TILT`, about −68°) so the finger holes face the Front camera head-on.


All views look at the existing `TARGET` (`OcarinaStage.tsx`, `(0, -0.15, 0.05)`). Each keeps the existing narrow-screen FOV fit: both hands (about 2.4 units across) stay in frame and FOV is never below 38°.

| id | Label | Description |
|---|---|---|
| `front` | Front | Faces the player from across the instrument, like an audience member, so both hands and the ocarina face are visible. Low elevation (about 15–25° above the table). |
| `top` | Top | Angled top-down: high and in front (~60° up), looking down at the tilted hole face. The picture is rolled 180° so the mouthpiece points towards the viewer. |
| `side` | Side | From the **player's right**, about 30° above the table, swung towards the front so the holes stay visible. |

Exact positions are tuned during implementation so that nothing important is clipped or hidden behind the hands. Each view's position lives in one constant table.

**Default** (first visit or invalid stored value): `top`.

## Controls

### Keyboard
- **Cycle order:** `front → top → side`, wrapping in both directions.
- **→ (ArrowRight)** goes to the next view; **← (ArrowLeft)** goes to the previous one. Up and Down are not used.
- **Conflict with the keyboard input source:** when `usePipeline` source kind is `keyboard`, plain arrows keep turning the wrist (unchanged), and the camera switches only on **Shift + ← / →**. With any other source, both plain arrows and Shift + arrows switch the camera.
- Ignored when focus is in an `input`, `textarea`, `select` or contenteditable element (e.g. the header search), and on key repeat (`e.repeat`).
- Active only while the ocarina page is mounted.
- `preventDefault()` on handled keys so the page doesn't scroll.

### Buttons
- A small 3-button pill (**Front · Top · Side**) overlaid on the 3D stage in a bottom corner. It sits outside the side HUD, so it stays visible when the HUD is collapsed.
- The active view is highlighted. Buttons have `aria-pressed` and a title hint: `Shift+←/→` when the keyboard source is active, `←/→` otherwise.
- Styled to match the existing ocarina HUD / globe pill look (existing CSS tokens). It must not overlap the HUD at desktop sizes, and it must still be reachable at widths ≤ 768px.

## Transition

- The camera eases from its current pose to the target view over **about 0.6 s** (ease-in-out). It interpolates position and look direction, so it never snaps or flips.
- Switching again mid-glide starts a new glide from the current, mid-flight pose.
- FOV is recomputed for the target view and eased along with it. On resize, the current view's framing is re-fit.

## Persistence

- The chosen view id is stored in a small persisted zustand store (same pattern as `usePipeline`'s `persist`), under its own storage key. It is restored on load.
- Unknown stored values fall back to `top`.

## Non-goals

- No free orbit, zoom or mouse-drag camera.
- No change to keyboard-source wrist controls, recording/replay data, lesson logic, audio or the ocarina model.
- Replays do not record or change the camera view.
- No camera views for other pages.

## Acceptance criteria

1. On first visit the stage opens on the `top` view.
2. With the webcam or glove source, ← / → cycle front ↔ top ↔ side with a smooth ~0.6 s glide, wrapping at both ends.
3. With the keyboard source, plain arrows still turn the wrist and do **not** move the camera; Shift + ← / → move the camera.
4. Clicking Front / Top / Side glides to that view, and the active button is highlighted.
5. Typing in the header search box with arrow keys does not change the view.
6. After a reload, the last chosen view is restored.
7. Both hands stay in frame in every view at 1280×800, 1440×900 and a narrow (≤ 768px) viewport.
8. Unit tests cover view cycling (next/prev wrap), the key-handling rules (shift/keyboard-source/input-focus/repeat), and fallback for an invalid persisted value. `npm run typecheck -w web` and the web tests pass.

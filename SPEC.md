# Senecai — Page Redesign Specification (`GlobePage` Aesthetic Alignment)

## 1. Goal & Scope

Redesign all non-globe application pages—specifically `OcarinaPage` (`/craft/ocarina`) and the surrounding app shell / shared HUD components as needed—to match the visual language, spatial layout, and interaction feel of `GlobePage` (`/`), while leaving all game, audio, input-pipeline, and 3D retargeting logic completely untouched.

### In Scope
- **`OcarinaPage` (`/craft/ocarina`)**:
  - Full-bleed 3D viewport stage (`100%` / `100vw` × `100vh`) matching `GlobePage`'s edge-to-edge canvas presentation and atmospheric dark/warm-earth palette.
  - Floating, translucent HUD overlay panels (matching `GlobePage`'s glassmorphic / dark-translucent card & pill styling, typography, borders, and spacing) for ocarina controls, song/note HUD, fingering/hint display, and status indicators.
  - Minimal floating top bar (consistent with `App.tsx` `.app.home` header treatment: floating over the canvas without pushing the viewport down, with Brand link back to `/`, `SearchBar`, and `SourcePill`).
- **Shared HUD / Shell Components**:
  - `App.tsx` / `styles.css`: Unify `.app` shell so `/craft/ocarina` uses the same full-bleed overlay header and viewport framing as `.app.home` (`GlobePage`).
  - `InputPanel`, `PipelineStrip`, `SearchBar`, `WebcamPreview`, `SourcePill`: Ensure consistent floating/collapsible translucent overlay styling when rendered on `OcarinaPage` (and `GlobePage`), without regressing `GlobePage`.
- **Responsiveness & Layering**:
  - Clean `z-index` layering: full-bleed 3D canvas at base layer, floating HUD panels above canvas, `InputPanel` drawer / modals / search dropdowns cleanly layered on top without overlapping or clipping at desktop (`1280×800`, `1440×900`) and smaller viewports (`<= 768px`).

### Explicit Non-Goals
- **No game or domain logic changes**: Do NOT alter ocarina pitch/note detection, Web Audio synth, song definitions/progression, scoring/accuracy logic, fingering tables, robot hand retargeting (`src/robot/*`), input sources (`src/input/*`), or Rokoko bridge logic (`bridge/*`, `src/rokoko/*`).
- **No `GlobePage` functional changes**: `GlobePage` behavior, globe data, and camera/craft selection logic remain unchanged (any shared CSS token or component adjustments must preserve `GlobePage`'s current appearance and behavior).
- **No new routes or new craft games**: Do not implement new craft pages beyond what currently exists in `App.tsx` routes.

---

## 2. Inputs, Outputs & Public Interfaces

### Routes & Pages
- `/` → `GlobePage` (reference aesthetic & layout)
- `/craft/ocarina` → `OcarinaPage` (redesign target)

### Component & Hook Interfaces (Preserved)
- `OcarinaPage` (`web/src/pages/OcarinaPage.tsx`): Default export React component; continues to consume existing ocarina state/hooks/audio/pipeline without changing their signatures or state semantics.
- `App.tsx`: `Shell` continues to render `<Brand />` (on non-home routes), `<SearchBar />`, `<SourcePill />`, `<Routes>`, and `<InputPanel />`.
- `InputPanel`, `PipelineStrip`, `SearchBar`, `WebcamPreview`: Existing props and store subscriptions (`usePipeline`, etc.) remain backward-compatible.

### Visual & Layout Contract (Matching `GlobePage`)
- **Viewport**: Full-bleed `100vw × 100vh` (`overflow: hidden`) with the 3D `<Canvas>` filling the entire viewport behind the HUD.
- **Header**: Floating translucent/overlay top bar (`position: fixed` or `absolute` over the stage, `pointer-events: none` on the bar container with `pointer-events: auto` on interactive children), matching `GlobePage`.
- **HUD Panels**: Translucent dark/glassmorphic surface tokens, subtle `1px` borders, consistent border radii, typography, and accent colors derived from `GlobePage` / `styles.css`.
- **Collapsible/Floating Controls**: Input/pipeline/webcam controls and game HUD widgets float cleanly at screen edges/corners with collapsible or compact states so the 3D ocarina + robot hands remain the visual centerpiece.

---

## 3. Edge Cases, Invariants & Error Handling

### Invariants
1. **Pointer Events**: Overlay HUD containers must not block orbit/canvas pointer interactions in empty regions (`pointer-events: none` on full-screen overlay wrappers, `pointer-events: auto` on interactive panels/buttons).
2. **Game Logic Isolation**: All unit tests for ocarina, robot retargeting, input pipeline, and globe geo must continue to pass without test modifications.
3. **Audio / Input Lifecycle**: Unmounting or navigating between `/` and `/craft/ocarina` must preserve existing cleanup and input source restoration (`useRestoreSource`).
4. **Canvas Resize**: Full-bleed 3D canvas must resize smoothly with the window without scrollbars (`overflow: hidden`) or stretched aspect ratios.

### Edge Cases & Failure Modes
- **Small viewports / narrow screens**: Floating HUD panels must not collide with the top header or cover the center 3D subject; panels should stack, compact, or collapse cleanly.
- **Webcam / InputPanel open state**: Opening `InputPanel` or `WebcamPreview` must remain accessible above HUD overlays without clipping off-screen.
- **Audio / WebGL fallback or loading states**: Suspense fallback (`Loading…`) and any audio-unlock prompt must match the dark full-bleed aesthetic rather than flashing unstyled/light backgrounds.

---

## 4. Verification Criteria

All checks must pass from the repository after the final edit:
1. **Typecheck**: `npm --prefix web run typecheck` (`tsc --noEmit`) exits `0` with zero errors.
2. **Unit Tests**: `npm --prefix web run test` (`vitest run`) exits `0` with all existing tests passing and zero skipped/relaxed assertions.
3. **Production Build**: `npm --prefix web run build` (`tsc --noEmit && vite build`) exits `0`.
4. **Manual / Visual Sanity (if dev server is checked)**:
   - `/` (`GlobePage`) renders identically to before.
   - `/craft/ocarina` (`OcarinaPage`) renders full-bleed 3D stage with floating translucent HUD panels, floating top bar, and intact ocarina playability/controls.

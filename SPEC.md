# SPEC: Globe page performance

## Goal
The globe home page (`web/src/pages/GlobePage.tsx`, `web/src/globe/*`, globe rules in `web/src/styles.css`) currently runs at ~10fps on a mid-range laptop. Target: **steady 60fps on an integrated GPU** (Intel/AMD iGPU, current Chrome/Firefox) when idle, dragging/rotating, zooming and flying to a country.

## Hard constraints
- **Visuals look the same.** Side by side, a person can't tell the before and after apart. Tiny sub-pixel or antialiasing differences are acceptable. This covers the parchment background and frame, the sea texture, country fills and ink borders, the graticule, the canvas rim and drop shadow, labels (fonts, tiers by zoom, limb fade), pins, the hover card with its leader line, the country tooltip and the side panel.
- **Behaviour unchanged.** Click to land, click outside or Escape to go back, hover highlight, pin clustering by altitude, search deep links (`?country=`, `?craft=`), the touch first-tap card, and the `window.senecaiGlobe` dev handle.
- **Keep globe.gl.** Optimise how it's used. Replacing individual layers with custom three.js objects (via `scene()` or custom layers) is fine; replacing the library is not.
- Hover and fly animations must look *close enough*: same end state (raise height, darkened fill, inked side walls), and a smooth transition of about the same length. The mechanism may change.

## Allowed techniques
- **Render on demand.** Stop redrawing when nothing changes. Redraw on camera change, controls damping, hover or selection change, data change, running tweens and transitions, and resize.
- **Adaptive pixel ratio during motion only.** While dragging, zooming or flying, the pixel ratio may drop (for example, to about 1.25). Full sharpness (`min(2, devicePixelRatio)`) returns as soon as motion stops.
- Replace costly CSS on the canvas (two-layer `filter: drop-shadow`) with a cheaper equivalent that looks the same, such as a static pre-rendered shadow or rim element behind the canvas.
- Cut draw calls: merge country fills, borders and graticule into few meshes. Highlight via attributes, uniforms or a separate overlay mesh instead of re-digesting all polygons.
- Cut DOM cost: avoid per-frame layout or style work for labels that are hidden by tier or limb. Avoid `querySelector*` in per-frame paths. Avoid repeated string parsing.

## Out of scope
- Kantele, the workbench, other pages and the bridge.
- Changing the craft catalog, labels or their content.

## Verification
- A dev-only perf HUD that shows FPS, frame time, draw calls and triangles. It is enabled with the `?perf` URL flag, only when `import.meta.env.DEV` is true, and is never shipped or visible in production.
- `npm test`, `npm run typecheck -w web` and `npm run build` all pass.
- Existing globe tests (`geo.test.ts`, the catalog country-name test) stay green. New pure helpers get unit tests where practical.

## Done when
All constraints hold, the HUD shows a large frame-rate and draw-call improvement in idle, drag and fly scenarios, and the scrutinizer passes.

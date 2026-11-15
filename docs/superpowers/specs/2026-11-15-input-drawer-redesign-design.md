# Hand-input drawer redesign

Small change. Approved in conversation 2026-11-15 ("B, go ahead").

## Intent
The input drawer (`web/src/ui/InputPanel.tsx`) reads as generic, unstyled UI: emoji icons, paragraph-long
descriptions with shell commands, rounded dark-app cards, and a flat column of every setting regardless of
source. It should feel like part of the parchment atlas the rest of the app uses, and be quick to scan.

## Goals
- Parchment atlas look: ruled "slip" panel (thin sepia border + inset double rule, 3px radius), small-caps
  Cormorant headings, italic display eyebrows, forest accent — same vocabulary as `.oc-hud` / `.globe-card`.
- Four compact source rows: inked SVG icon, name, one short line. Selected row clearly marked (radio mark).
- Live block for the chosen source: status + fps + hands, camera preview (webcam / fused), calibration.
- Only show settings the chosen source uses. Setup commands and rarely touched settings behind a
  "Setup & advanced" fold.
- Explicit "Stop" button; clicking the selected row no longer silently stops.
- Calibration wizard modal gets the same parchment treatment (Ocarina page reuses it).

## Non-goals
- No change to pipeline behaviour, store shape, or source logic.
- No change to the header source pill beyond what styling falls out.

## Approaches
- A. Restyle only — cheap, keeps the clutter. Rejected.
- **B. Restyle + restructure (picked)** — fixes look, copy and clutter together.
- C. Centred map-plate modal — striking but hides the workspace being calibrated against. Rejected.

## Design
- Rows: `webcam` (camera icon), `fused` (glove+camera), `gloves` (glove), `keyboard` (keys). One-line blurbs.
  Full setup text (bridge commands, Coil Pro caveat, keyboard map) moves into the fold for the selected source.
- Settings per source:
  - all: dominant hand (segmented R | L)
  - webcam: camera select, swap left/right
  - fused: camera select, overhead rotation, swap left/right
  - gloves / fused: bridge URL (in fold)
  - all: mirror to physical robot (in fold)
- Keyboard key map shown as `<kbd>` chips in the fold.

## Left to the builder
Exact icon paths, spacing, copy wording within the one-line limit.

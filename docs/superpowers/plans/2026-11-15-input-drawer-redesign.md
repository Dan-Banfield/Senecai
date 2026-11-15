# Hand-input drawer redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the hand-input drawer as a parchment-atlas slip with compact source rows, a live block and per-source settings.

**Architecture:** A pure `sourceFields(kind)` decides which settings a source shows (unit-tested). `InputPanel.tsx` renders rows, live block, settings and a `<details>` fold from it. New `.inp-*` CSS in `styles.css` reuses the atlas slip vocabulary (`.oc-hud`). No pipeline or store change.

**Tech Stack:** React 19, zustand, vitest, plain CSS.

**Spec:** `docs/superpowers/specs/2026-11-15-input-drawer-redesign-design.md`

## Global Constraints
- No change to `web/src/input/*` behaviour or store shape.
- Slip look: 1px `rgba(78, 61, 43, 0.6)` border, 3px radius, inset double rule, small-caps `var(--display)` headings.
- One-line blurb per source row; setup commands only inside the fold.
- Clicking the selected row does nothing; a "Stop" button stops the source.

## Review Focus
- No source picked: drawer shows rows only, no live block, no source settings, fold shows only global advanced settings.
- Source in `error` state: status line shows the error message in full (wraps, not truncated).
- Keyboard source: `status.message` is the long key map; the live block must not print it as the status line (show "Live" + key chips in fold instead).
- Narrow viewport (375px): drawer is full width, rows don't overflow.
- Calibration modal on the Ocarina page picks up the parchment style.

---

### Task 1: Per-source settings map

**Files:**
- Create: `web/src/ui/inputFields.ts`
- Test: `web/src/ui/inputFields.test.ts`

**Interfaces:**
- Produces: `type InputField = 'camera' | 'rotation' | 'swapHands' | 'bridgeUrl'`; `sourceFields(kind: SourceKind | null): InputField[]`; `SOURCE_INFO: Record<SourceKind, { icon: IconName; blurb: string; setup: string }>`.

- [ ] **Step 1: Write the failing test**

```ts
expect(sourceFields(null)).toEqual([]);
expect(sourceFields('webcam')).toEqual(['camera', 'swapHands']);
expect(sourceFields('fused')).toEqual(['camera', 'rotation', 'swapHands', 'bridgeUrl']);
expect(sourceFields('gloves')).toEqual(['bridgeUrl']);
expect(sourceFields('keyboard')).toEqual([]);
// every blurb is one short line
for (const k of Object.keys(SOURCE_INFO)) expect(SOURCE_INFO[k].blurb.length).toBeLessThanOrEqual(60);
```

- [ ] **Step 2:** `cd web && npx vitest run src/ui/inputFields.test.ts` — FAIL (module missing).
- [ ] **Step 3:** Implement. `setup` holds the old long descriptions (bridge commands, Coil Pro caveat); keyboard `setup` is `KEYBOARD_HELP`.
- [ ] **Step 4:** Re-run — PASS.

### Task 2: Icons, drawer markup, styles

**Files:**
- Modify: `web/src/ui/icons.tsx` (add `camera`, `glove`, `gloveCam`, `keys`, `close`, `chevron`)
- Modify: `web/src/ui/InputPanel.tsx` (`InputPanel`, `CalibrationWizard`)
- Modify: `web/src/styles.css` (replace `.drawer`/`.source-option`/`.status-line`/`.modal` block; add `.inp-*`)

**Interfaces:** Consumes `sourceFields`, `SOURCE_INFO` from Task 1; `WebcamPreview` from `ui/WebcamPreview.tsx` (override `.drawer .webcam` to static, full width).

- [ ] **Step 1:** Markup order: header (small-caps "Hand input", italic eyebrow "How the robot sees your hands", icon close button) → radio rows (`role="radiogroup"`, each `role="radio" aria-checked`) → live block if `kind` (status dot + message or "Live" for keyboard, fps, hands L/R, Stop button, `WebcamPreview`, calibration line + Calibrate/Reset) → settings (dominant hand as segmented R | L, then `camera`/`rotation`/`swapHands` per `sourceFields`) → `<details className="inp-fold">` "Setup & advanced" with selected source's `setup` (keyboard as `<kbd>` chips split on ` · `), `bridgeUrl` if listed, mirror-robot toggle.
- [ ] **Step 2:** CSS: drawer as slip on `rgba(246, 238, 219, 0.98)`, sepia backdrop `rgba(60, 45, 30, 0.35)`, slide-in animation; rows with hairline separators, forest radio mark on selected; inputs/selects 3px radius; `.modal` same slip treatment; drawer full-width under 480px.
- [ ] **Step 3:** `npm run typecheck -w web` and `npm test -w web` — both pass.
- [ ] **Step 4:** Browser check: open drawer on `/` and `/craft/ocarina`, pick each source, open fold, narrow to 375px; open calibration modal.
- [ ] **Step 5: Commit** (`feat(web): redesign hand-input drawer in atlas style`).

# Input Cartouche Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the header input pill with a map-legend cartouche and match the search input to it.

**Architecture:** Markup change in `SourcePill`; styling in `web/src/styles.css`, scoped to `.app.home`/`.app.craft` palette tokens already defined there.

**Tech Stack:** React, plain CSS.

**Spec:** `docs/superpowers/specs/2026-11-15-input-cartouche-design.md`

## Global Constraints
- Click opens the drawer (`setPanelOpen(true)`), `title={status.message}` kept.
- No glow on the status marker. Radius 2px. Breakpoint 640px.

## Review Focus
- Long source label (e.g. "Smartgloves (SDK)") must not wrap or push the header.
- Status `error` must be distinguishable without color (slash).
- No source picked: shows *Choose input*, L/R still faded.
- Header height 76px: two-line cartouche must fit.
- Keyboard focus visible on the button.

---

### Task 1: Cartouche markup and styles

**Files:**
- Modify: `web/src/ui/InputPanel.tsx` (`SourcePill`)
- Modify: `web/src/styles.css` (`.source-pill` block ~line 62, home/craft overrides ~line 384, `.search-input`)

- [ ] **Step 1:** `SourcePill` renders `.source-pill` > `span.cart-mark.<state>` + `span.cart-text` (`span.cart-cap` "Input", `span.cart-name`) + `span.cart-hands` (`span.on|off` for L and R).
- [ ] **Step 2:** CSS: 2px radius, 1px `--line` border + inset double rule, diamond marker via rotated square (`live` filled `--forest`, `waiting/starting` hollow ochre, `error` red + slash, idle hollow `--muted`), Cormorant italic 17px name, caps caption 9.5px tracked, hover darker rule, `:focus-visible` outline, ≤640px hides caption.
- [ ] **Step 3:** `.search-input` radius 2px with the same inset rule.
- [ ] **Step 4:** `npm run typecheck -w web` passes; check in preview (home + craft, 375px width, each status).
- [ ] **Step 5:** Commit.

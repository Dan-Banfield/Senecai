# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Senecai is a Junction 2026 (Rokoko track) project: a web app that teaches a robot hand traditional Finnish crafts (kantele, puukko knife) by teleoperation through Rokoko Smartgloves, a webcam glove emulator, or keyboard. README.md is the detailed user-facing reference (glove setup, assumptions to verify on site, known gaps).

## Commands

npm workspaces monorepo (`web`, `bridge`). Run these from the repo root:

```bash
npm install            # web postinstall copies MediaPipe WASM + hand model into web/public/mediapipe/ (gitignored)
npm run dev            # Vite dev server at http://localhost:5173
npm run build          # tsc --noEmit + vite build (web)
npm test               # web (vitest) then bridge (node:test)
npm run typecheck -w web

npm run bridge         # glove bridge: Studio UDP :14043 -> WebSocket :14044
npm run bridge:sdk     # same, but also spawns rkk-hand-solver --emit-openxr (Rokoko Device SDK, Linux)
npm run fake-sdk       # fake solver (RGMP v2) for testing the bridge without gloves
npm run fake-studio    # fake Studio stream (add `-- --lz4` to test compression)
```

Single tests:
- Web: `cd web && npx vitest run src/robot/retarget.test.ts` (or `-t "<name>"`)
- Bridge: `cd bridge && node --test src/sdk.test.js`

## Architecture

**One frame format everywhere.** Every input source (webcam/MediaPipe, keyboard, real gloves via the bridge) emits Rokoko Studio **JSON v3** frames. Downstream code never knows the source:

```
source -> RokokoFrame -> parseFrame (web/src/rokoko) -> HumanHands -> Retargeter (web/src/robot/retarget.ts) -> RobotHandCommand per side
```

`web/src/rokoko/build.ts` builds frames via FK for the synthetic sources; the bridge converts Device SDK data (RGMP from rkk-hand-solver, OpenXR joints) into the same JSON v3 before forwarding. Do not add source-specific logic downstream of the frame.

**Hot path vs UI state** (`web/src/input/pipeline.ts`): per-frame data lives in the mutable `live` object, which 3D scenes read every frame without React re-renders. The zustand store (`usePipeline`, persisted) holds only slow UI state: source kind, settings, calibration.

**Robot model**: an Inspire RH56-style hand with 6 DoF (thumb rotate, thumb bend, one per finger). Retargeting sums each finger's flexion and normalises it against the user's open/fist calibration. `toInspireAngles` produces `0..1000` commands (1000 = open), which are streamed to the bridge. `bridge/src/robot-output.js` is the stub where the real hand would connect.

**Workbench** (`web/src/bench/`): a generic craft bench (tools, stations, workpieces) driven by a `CraftBench` definition per craft in `bench/crafts/` (registered in `bench/crafts/index.ts`, routed at `/craft/<id>`). **Every change to a workpiece must go through an `Op`** (`bench/core.ts`): a small JSON object applied identically live and in replay. Recordings store both hands' poses plus the ops per frame, so replay rebuilds meshes exactly. Workpieces must be fully reproducible from ops (`apply`/`snapshot`/`restore`). Materials: voxel density-field wood rendered with surface nets (`materials/voxel.ts`, `mesh.ts`) and forged bar (`forge.ts`).

**Kantele** (`web/src/crafts/kantele/`) is separate from the bench: its own session, pluck detection, Karplus-Strong audio, and v1 recording format in `web/src/recording/`.

**Globe** (home page, lazy-loaded): globe.gl with world-atlas country shapes, styled as a parchment atlas (`web/src/globe/atlas.ts`). Crafts come from `web/src/crafts/catalog.ts`. An entry's `country` must match the world-atlas name exactly (a test checks this), and its photo goes in `web/public/crafts/` (640px).

**Community** (`web/src/community/`) is a fake backend (localStorage + procedurally generated seeds) behind the `CommunityApi` seam.

## Debugging

In dev, `window.senecaiKantele`, `window.senecaiBench` and `window.senecaiGlobe` expose the running kantele session, workbench session and globe.gl instance.

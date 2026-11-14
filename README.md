# Senecai

**Old crafts. New hands.** Teach a robot hand the traditional crafts of Finland, using Rokoko Smartgloves or, until we have them, a webcam that pretends to be the gloves.

Junction 2026 · Rokoko track: *"Use professional motion capture to control robotic hands… useful, unexpected, or downright unbelievable."*

- **The globe** (home page): a globe drawn like an old printed atlas on parchment: pastel countries (neighbours in different colours, craft countries in green), a mottled sea with a latitude/longitude grid, and serif lettering for countries, oceans and capitals that fills in as you zoom. Drag to spin, click a country to land, click outside it or press Esc to zoom back out, or use the search bar to find a country, region or craft. Pins mark where each craft comes from, and hover cards show a photo, the story, and what the craft would teach a robot. When zoomed out, crowded countries collapse into one cluster; clicking it lands there.
- **Piano** (Florence, where Bartolomeo Cristofori built the first one around 1700): both robot hands at a two-and-a-half-octave keyboard, learning *Mary Had a Little Lamb* (the next key glows; "Listen first" plays it). Notes come from collisions, not finger angles: each robot fingertip's real position is computed from the hand's joints, a key goes down only as far as a fingertip pushes it, sounds near the bottom of its travel, and stops the finger (the hand rides up) when it bottoms out. Calibrating on this page uses your piano position as the rest pose: hands resting as if on the keys put the robot's right thumb on middle C.
- **Kantele** (Finland's five-string national instrument): one finger per string, which maps directly onto a five-finger robot hand. Guided lessons with a ghost hand, a rhythm-game timing mode, and free play with recording.
- **Puukko workbench** (the Finnish belt knife): a virtual smithy and carving table. Close your hand over a tool to pick it up and squeeze to use it. Heat the bar in the forge, hammer the blade out on the anvil, quench it, sharpen it, then carve the birch handle and fit the blade. For the handle, your other hand picks up the blank with a fist and holds it; it follows that hand in 3D and turns as your wrist turns. The knife takes a shaving wherever you draw it across the wood, and how hard you squeeze sets the depth, from a thin curl to a deep bite. The wood is a density field drawn as a smooth surface with real grain, so cuts thinner than a voxel show.
- **Recordings remember everything**: both robot hands, the tool each one holds, and every change made to the workpiece, frame by frame. Replays rebuild the object's mesh exactly as it was made, and you can scrub through them.
- **Community**: every creation is a recorded teleoperation demonstration. You can watch the robot replay it, press **Learn this** to turn it into a tutorial (ghost hands follow the creator's real movements), or download it as a training-data JSON file.

## Quick start

```bash
npm install          # also copies MediaPipe WASM and the hand model, so hand tracking works offline
npm run dev          # http://localhost:5173
```

Open the app, click **Choose input** (top right), then pick one:

|---|---|
| 📷 Webcam (glove emulator) | MediaPipe hand tracking converted into **Rokoko JSON v3 frames**. Hold your hand up with the palm facing the camera. |
| 🧤 Rokoko Smartgloves | Real gloves: Rokoko Studio → bridge → browser. |
| 🙌 Gloves + webcam | The gloves drive fingers and wrist rotation; the webcam tracks where each hand is. Best with Smartgloves (no Coil Pro needed). |
| ⌨️ Keyboard + mouse | Right hand: `A S D F G` curl thumb…little, `Space` = fist, `H` = thumb across palm, mouse moves the hand. Left hand: `Z` closes/opens its fist, arrow keys turn its wrist. |

Calibrate (open hand, then fist; about 6 seconds) from the same panel. It makes a big difference.

## How "plug in the gloves and it just works" is achieved

Every input source emits the **same Rokoko Studio JSON v3 frame format**. Everything downstream only ever sees those frames:

```
 webcam ─┐ (MediaPipe → Rokoko joints)
keyboard ┼─► RokokoFrame ─► parseFrame ─► HumanHands ─► Retargeter ─► 6-DoF robot command ─► scenes / recorder / robot
 gloves ─┘ (Device SDK or Studio → bridge → WebSocket)
```

The bridge accepts gloves from either Rokoko source and converts the SDK's data into the same JSON v3 frames:

```
Rokoko Device SDK (Linux, macOS, Windows):
  gloves ─USB/Wi-Fi─► rokoko-sdk ─RGMP :12276─► rkk-hand-solver ─RGMP :12277─► bridge ─WS :14044─► app
Rokoko Studio (macOS, Windows):
  gloves ─► Studio ─JSON v3 over UDP :14043─► bridge ─WS :14044─► app
```

Both paths are covered by tests: `bridge/src/sdk.test.js` (RGMP parsing, OpenXR → Studio conversion, a fake solver end to end), `web/src/input/sdkGloves.test.ts` (SDK hands through the app's parser and retargeter), and `web/src/input/webcamSource.test.ts`.

## Gloves on Linux (Rokoko Device SDK, no Studio)

1. **Get the SDK licence (free for the Junction track, no subscription).** Create a Rokoko ID, then submit your Rokoko ID email and team via the form linked in the Rokoko challenge description. Once a Rokoko rep approves it, an **SDK License** tile appears on your team page at [id.rokoko.com](https://id.rokoko.com). Ignore the Studio trial and upgrade buttons; they're unrelated. If approval is slow, ask the Rokoko rep or the Aalto Robotics Club mentors on site.
2. **Install the SDK.** Follow **Install guide** on the SDK License tile ([Linux guide](https://sdk.rokoko.com/guides/install/linux/); needs Ubuntu 22.04 / Debian 12 or newer). Check it with `rokoko-sdk --version`.
3. **Plug in the gloves.** Smartgloves II stream over USB. Smartgloves (I) stream over Wi-Fi; pair them once over USB using the SDK's `network_configuration.py` ([Wi-Fi guide](https://sdk.rokoko.com/guides/wifi-setup/)).
4. **Start everything:**
   ```bash
   npm run bridge:sdk   # starts rkk-hand-solver --emit-openxr (which runs the glove driver), then the bridge
   npm run dev          # in another terminal
   ```
   Or start the solver yourself (`rkk-hand-solver --emit-openxr`; it launches `rokoko-sdk` for you, so do not start that separately) and run `npm run bridge`. Add solver arguments with `SENECAI_SOLVER_ARGS`.
5. In Senecai, choose **Rokoko Smartgloves**. The input panel should say "Streaming from the Rokoko Device SDK". The bridge log shows each glove and which hand it is.
6. **Calibrate** (open hand, then fist). This matters more for gloves: the solver's heading is relative to magnetic north, so until you calibrate, the pose when the gloves connect counts as "neutral".

How SDK gloves behave in the app:
- **Aiming.** Without a Coil Pro, the solver gives hand shape and orientation but no world position. The app therefore aims by wrist angle: tilt or turn your hand to move the robot hand (e.g. the carving knife), like a laser pointer.
- **Glove plugged in but nothing happens (Linux).** The glove appears as `/dev/ttyACM0`, which is usually only readable by group `uucp` (Arch/Omarchy) or `dialout` (Debian/Ubuntu). Run `sudo usermod -aG uucp $USER` (or `dialout`) and log out and back in. `npm run bridge:sdk` warns about this at startup.
- **Troubleshooting.** If the SDK reports "RBDP Protocol Error" or "Could not create device", an old `rokoko-sdk` process is holding the USB device: `pkill -x rokoko-sdk`, replug the gloves, start again. The bridge reuses an already-running driver or solver rather than starting a second one.

Test without gloves:

```bash
npm run bridge
npm run fake-sdk               # pretends to be rkk-hand-solver: two solved hands over RGMP v2
```

## Gloves on a Mac (Rokoko Studio)

1. On the Mac with Rokoko Studio, connect the Smartgloves and check the hands move in Studio.
2. Run the bridge, either on the Mac or on any laptop on the same network: `npm run bridge`.
3. In Studio, go to **Livestream → Custom** and set:
   - data format: **JSON v3**
   - IP: the bridge machine's IP
   - port: **14043**
4. In Senecai, choose **Rokoko Smartgloves**. If the bridge is on another machine, set the bridge URL in the input panel (e.g. `ws://192.168.1.20:14044`).
5. Calibrate.

The bridge accepts plain JSON, LZ4-frame, and raw LZ4-block payloads, since we couldn't confirm which one Studio sends. Its log shows which one arrived. Test without hardware: `npm run bridge` + `npm run fake-studio` (add `-- --lz4` to test compression).

## The robot hand

The hand is modelled on the **Inspire RH56** that the Aalto Robotics Club has already integrated: 6 actuators (thumb rotate, thumb bend, and one per finger, with each finger's two links coupled). About 20 human finger joints are reduced to 6 by summing each finger's flexion and normalising it against the user's calibration (`web/src/robot/retarget.ts`).

Turning on **Mirror to physical robot hand** in the input panel streams Inspire-style commands (`0..1000`, `1000 = open`) to the bridge at 30 Hz. The bridge currently only logs them; `bridge/src/robot-output.js` is the hook for the real hand.

## Project layout

```
bridge/                 Node: Device SDK (RGMP) + Studio (UDP) → WebSocket, fake-sdk, fake-studio, robot output stub
web/src/rokoko/         JSON v3 types, parser, FK frame builder
web/src/input/          webcam / gloves / keyboard sources, live pipeline + calibration (zustand)
web/src/robot/          retargeting, Inspire export, procedural 3D robot hand
web/src/crafts/kantele/ music, lessons, pluck detection, Karplus-Strong audio, session, 3D stage
web/src/crafts/piano/   keyboard layout and song, fingertip/key collision, piano synth, session, 3D stage
web/src/robot/fingertips.ts  robot fingertip positions from a pose (same joint chain RobotHand draws)
web/src/bench/          craft workbench: core (ops, bench state), session (input → tools → ops, holding work in
                        the off hand, recording, replay), materials/ (voxel wood with knife shaving, surface-nets
                        mesher, forged bar), crafts/ (the puukko, plus shared moves in kit.ts),
                        render/ (3D table, tools, stations, wood shader, workpiece meshes)
web/src/recording/      kantele (v1) demonstration recording / playback / export
web/src/community/      CommunityApi + fake backend (localStorage + procedurally generated seeds), places
web/src/crafts/catalog.ts  every craft on the globe: region, story, robot skills, photo credit
web/src/globe/          country shapes + geo helpers, atlas styling (colours, sea, graticule, labels)
web/public/crafts/      craft photos (Wikimedia Commons, resized)
web/src/pages, ui/      React pages and components
```

`npm test` runs the web (vitest) and bridge (node:test) suites. In dev, `window.senecaiKantele` (running kantele session), `window.senecaiBench` (running workbench session) and `window.senecaiGlobe` (globe.gl instance) are exposed for debugging.

## Adding a craft to the globe

Add an entry to `web/src/crafts/catalog.ts` (`country` must match the name in `world-atlas`; `npm test` checks this) and put a 640px photo in `web/public/crafts/`. Set `status: 'playable'` and a `route` once it has a page.

To give it a workbench, add a `CraftBench` in `web/src/bench/crafts/` (tools, stations, workpieces, stages and an `interact` function that turns squeezes into ops), register it in `web/src/bench/crafts/index.ts`, and set its route to `/craft/<id>`. Every change to a workpiece must go through an op so recordings replay it exactly.

## Assumptions to verify on site

- **Rokoko Device SDK**: written from the public docs and Rokoko's ROS 2 bridge, but not yet run against real gloves. Most likely to need adjusting: the joint names in the solver's definition (the bridge also accepts OpenXR enum names, and falls back to OpenXR joint order), the `--emit-openxr` flag (SDK 0.10.0+), and how `device_info.hand` is reported. The bridge logs the device and groups it sees, which should make any mismatch obvious.
- **Studio payload**: compression and position units (metres assumed). Calibration's "centre" step and the position scale absorb most differences.
- **Inspire command order and direction** (`toInspireAngles`): check against the Aalto integration before connecting hardware.
- **MediaPipe handedness**: if hands come out swapped, use "Swap left/right" in the input panel.

## Known gaps (it's a first draft)

- The community backend is fake: localStorage plus generated seed creations. `CommunityApi` is the seam for a real one.
- On the workbench the hand aims like a pointer: its position picks a point in the camera view, and squeezing grabs or uses a tool there. That works for webcam and gloves alike; with a Coil Pro for absolute hand position, true 3D tool contact would be the natural upgrade.
- Only the kantele has seeded example creations in the community; the puukko starts empty.
- Webcam tracking is noisier than the gloves and is smoothed more heavily (`dofTau` in `pipeline.ts`).

## Credits

Craft photos are from Wikimedia Commons, resized to 640px; each card shows its credit and links to the source.

| Photo | Author | Licence | Source |
|---|---|---|---|
| kantele | TheYellowFellow | CC0 | [Commons](https://commons.wikimedia.org/wiki/File:Five_string_kanteles.jpg) |
| piano | The Metropolitan Museum of Art | CC0 | [Commons](https://commons.wikimedia.org/wiki/File:Grand_Piano_MET_DP300910.jpg) |
| puukko | Kuroczynski | CC BY-SA 4.0 | [Commons](https://commons.wikimedia.org/wiki/File:%E2%80%9EIMG_5221_Puukko_and_fish_filleting_knife_with_sheath_by_J._Marttiini_(cropped).jpg) |

Country outlines come from [world-atlas](https://github.com/topojson/world-atlas) (Natural Earth). The globe uses [globe.gl](https://globe.gl).

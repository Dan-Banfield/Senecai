# Senecai

**Old crafts. New hands.** Teach a robot hand the traditional crafts of Finland, using Rokoko Smartgloves or, until we have them, a webcam that pretends to be the gloves.

Junction 2026 · Rokoko track: *"Use professional motion capture to control robotic hands… useful, unexpected, or downright unbelievable."*

- **The globe** (home page): a night-side Earth under a procedural starry sky. Spin it and land on a country. Pins mark where each craft comes from (copper = playable, pale = coming), and hover cards show a photo, the story, and what the craft would teach a robot. Community creations are pinned where they were made, with animated arcs showing who learned from whom. When zoomed out, crowded countries collapse into one cluster; clicking it lands there.
- **Kantele** (Finland's five-string national instrument): one finger per string, which maps directly onto a five-finger robot hand. Guided lessons with a ghost hand, a rhythm-game timing mode, and free play with recording.
- **Kuksa** (the birch-burl cup): the robot hand holds a puukko knife and carves a voxel birch block. Grip strength sets cutting pressure, the other hand turns the workpiece, and an x-ray outline shows the cup inside the wood.
- **Community**: every creation is a recorded teleoperation demonstration. You can watch the robot replay it, press **Learn this** to turn it into a tutorial (the ghost hand follows the creator's real movements), or download it as a training-data JSON file.

## Quick start

```bash
npm install          # also copies MediaPipe WASM, the hand model and Earth textures, so everything works offline
npm run dev          # http://localhost:5173
```

Open the app, click **Choose input** (top right), then pick one:

| Input | What it is |
|---|---|
| 📷 Webcam (glove emulator) | MediaPipe hand tracking converted into **Rokoko JSON v3 frames**. Hold your hand up with the palm facing the camera. |
| 🧤 Rokoko Smartgloves | Real gloves: Rokoko Studio → bridge → browser. |
| ⌨️ Keyboard + mouse | `A S D F G` curl thumb…little, `Space` = fist, `H` = thumb across palm, mouse moves the hand. |

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
- **Aiming.** Without a Coil Pro, the solver gives hand shape and orientation but no world position. The app therefore aims by wrist angle: tilt or turn your hand to move the robot hand (e.g. the kuksa knife), like a laser pointer.
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
web/src/crafts/kuksa/   voxel engine (carve, raycast, scoring), session, 3D stage
web/src/recording/      demonstration recording / playback / export
web/src/community/      CommunityApi + fake backend (localStorage + procedurally generated seeds), places
web/src/crafts/catalog.ts  every craft on the globe: region, story, robot skills, photo credit
web/src/globe/          country shapes + geo helpers, procedural starfield
web/public/crafts/      craft photos (Wikimedia Commons, resized)
web/src/pages, ui/      React pages and components
```

`npm test` runs the web (vitest) and bridge (node:test) suites. In dev, `window.senecaiKantele` (running kantele session) and `window.senecaiGlobe` (globe.gl instance) are exposed for debugging.

## Adding a craft to the globe

Add an entry to `web/src/crafts/catalog.ts` (`country` must match the name in `world-atlas`; `npm test` checks this) and put a 640px photo in `web/public/crafts/`. Set `status: 'playable'` and a `route` once it has a page.

## Assumptions to verify on site

- **Rokoko Device SDK**: written from the public docs and Rokoko's ROS 2 bridge, but not yet run against real gloves. Most likely to need adjusting: the joint names in the solver's definition (the bridge also accepts OpenXR enum names, and falls back to OpenXR joint order), the `--emit-openxr` flag (SDK 0.10.0+), and how `device_info.hand` is reported. The bridge logs the device and groups it sees, which should make any mismatch obvious.
- **Studio payload**: compression and position units (metres assumed). Calibration's "centre" step and the position scale absorb most differences.
- **Inspire command order and direction** (`toInspireAngles`): check against the Aalto integration before connecting hardware.
- **MediaPipe handedness**: if hands come out swapped, use "Swap left/right" in the input panel.

## Known gaps (it's a first draft)

- The community backend is fake: localStorage plus generated seed creations. `CommunityApi` is the seam for a real one.
- The kuksa knife cuts by raycasting from the camera through the hand's position, which works for both webcam and gloves. With a Coil Pro for absolute hand position, true 3D cutting would be the natural upgrade.
- Webcam tracking is noisier than the gloves and is smoothed more heavily (`dofTau` in `pipeline.ts`).

## Credits

Craft photos are from Wikimedia Commons, resized to 640px; each card shows its credit and links to the source.

| Photo | Author | Licence | Source |
|---|---|---|---|
| kantele | TheYellowFellow | CC0 | [Commons](https://commons.wikimedia.org/wiki/File:Five_string_kanteles.jpg) |
| kuksa | Duodjiinfo | CC BY-SA 3.0 | [Commons](https://commons.wikimedia.org/wiki/File:Guksi.jpg) |
| puukko | Kuroczynski | CC BY-SA 4.0 | [Commons](https://commons.wikimedia.org/wiki/File:%E2%80%9EIMG_5221_Puukko_and_fish_filleting_knife_with_sheath_by_J._Marttiini_(cropped).jpg) |
| lace | Krzysiu | CC BY 4.0 | [Commons](https://commons.wikimedia.org/wiki/File:Bobbin_lace_making_Myjava-Festival.jpg) |
| himmeli | Tomi Knuutila | CC BY 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:Himmeli_(1433508300).jpg) |
| dala | Mysid | Public domain | [Commons](https://commons.wikimedia.org/wiki/File:Dalecarlian_horse.jpg) |
| hardanger | Frode Inge Helland | CC BY-SA 3.0 | [Commons](https://commons.wikimedia.org/wiki/File:Midt.jpg) |
| murano | Dennis G. Jarvis | CC BY-SA 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:Italy-1453_-_Murano_Glass_(5228946002).jpg) |
| wycinanki | Unknown author | Public domain | [Commons](https://commons.wikimedia.org/wiki/File:Wycinanka_lowicka._1909_(106673350).jpg) |
| pysanka | Lubap | CC BY-SA 4.0 | [Commons](https://commons.wikimedia.org/wiki/File:Meander_Motif_on_a_Ukrainian_Pysanka.JPG) |
| delft | Unknown author | Public domain | [Commons](https://commons.wikimedia.org/wiki/File:Delft-tile-milkmaid-c1700.JPG) |
| tweed | Callicvol | CC BY-SA 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:Tying_Harris_Tweed.jpg) |
| azulejo | NorbertNagel | CC BY-SA 4.0 | [Commons](https://commons.wikimedia.org/wiki/File:Azulejo_facade_in_Rua_de_S%C3%A3o_Bento_-_Lisbon_-_Portugal.jpg) |
| kannel | Adeliine | CC BY-SA 3.0 | [Commons](https://commons.wikimedia.org/wiki/File:V%C3%A4ikekannel.jpg) |

Earth textures come from the [three-globe](https://github.com/vasturiano/three-globe) examples, and country outlines from [world-atlas](https://github.com/topojson/world-atlas) (Natural Earth). The globe uses [globe.gl](https://globe.gl).

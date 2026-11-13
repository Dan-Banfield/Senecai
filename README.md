# Senecai

**Old crafts. New hands.** Teach a robot hand the traditional crafts of Finland, using Rokoko Smartgloves or, until we have them, a webcam that pretends to be the gloves.

Junction 2026 · Rokoko track: *"Use professional motion capture to control robotic hands… useful, unexpected, or downright unbelievable."*

- **Kantele** (Finland's five-string national instrument): one finger per string, which maps directly onto a five-finger robot hand. Guided lessons with a ghost hand, a rhythm-game timing mode, and free play with recording.
- **Kuksa** (the birch-burl cup): the robot hand holds a puukko knife and carves a voxel birch block. Grip strength sets cutting pressure, the other hand turns the workpiece, and an x-ray outline shows the cup inside the wood.
- **Community**: every creation is a recorded teleoperation demonstration. You can watch the robot replay it, press **Learn this** to turn it into a tutorial (the ghost hand follows the creator's real movements), or download it as a training-data JSON file.

## Quick start

```bash
npm install          # also copies the MediaPipe WASM and downloads the hand model for offline use
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
 gloves ─┘ (Studio → UDP → bridge → WebSocket)
```

The webcam emulator is tested against the same parser and retargeter as the gloves path (`web/src/input/webcamSource.test.ts`), and the full gloves path has been run end to end using `fake-studio`.

## Gloves day checklist

1. On the Mac with Rokoko Studio, connect the Smartgloves and check the hands move in Studio.
2. Run the bridge, either on the Mac or on any laptop on the same network:
   ```bash
   npm run bridge       # UDP :14043 in, WebSocket :14044 out
   ```
3. In Studio, go to **Livestream → Custom** and set:
   - data format: **JSON v3**
   - IP: the bridge machine's IP
   - port: **14043**
4. In Senecai, choose **Rokoko Smartgloves**. If the bridge is on another machine, set the bridge URL in the input panel (e.g. `ws://192.168.1.20:14044`).
5. Calibrate.

The bridge accepts plain JSON, LZ4-frame, and raw LZ4-block payloads, since we couldn't confirm which one Studio sends. Its log shows which one arrived.

To test the gloves path with no hardware:

```bash
npm run bridge
npm run fake-studio            # synthetic glove frames over UDP (add -- --lz4 to test compression)
```

## The robot hand

The hand is modelled on the **Inspire RH56** that the Aalto Robotics Club has already integrated: 6 actuators (thumb rotate, thumb bend, and one per finger, with each finger's two links coupled). About 20 human finger joints are reduced to 6 by summing each finger's flexion and normalising it against the user's calibration (`web/src/robot/retarget.ts`).

Turning on **Mirror to physical robot hand** in the input panel streams Inspire-style commands (`0..1000`, `1000 = open`) to the bridge at 30 Hz. The bridge currently only logs them; `bridge/src/robot-output.js` is the hook for the real hand.

## Project layout

```
bridge/                 Node: Rokoko Studio UDP → WebSocket, fake-studio, robot output stub
web/src/rokoko/         JSON v3 types, parser, FK frame builder
web/src/input/          webcam / gloves / keyboard sources, live pipeline + calibration (zustand)
web/src/robot/          retargeting, Inspire export, procedural 3D robot hand
web/src/crafts/kantele/ music, lessons, pluck detection, Karplus-Strong audio, session, 3D stage
web/src/crafts/kuksa/   voxel engine (carve, raycast, scoring), session, 3D stage
web/src/recording/      demonstration recording / playback / export
web/src/community/      CommunityApi + fake backend (localStorage + procedurally generated seeds)
web/src/pages, ui/      React pages and components
```

`npm test` runs the web (vitest) and bridge (node:test) suites. In dev, `window.senecaiKantele` exposes the running kantele session for debugging.

## Assumptions to verify on site

- **Rokoko Device SDK**: the track provides it, but we had no access yet. Today we use Studio's documented live stream. If the SDK can read the gloves directly (possibly on Linux), add it as another `HandSource` that emits `RokokoFrame`s.
- **Studio payload**: compression and position units (metres assumed). Calibration's "centre" step and the position scale absorb most differences.
- **Inspire command order and direction** (`toInspireAngles`): check against the Aalto integration before connecting hardware.
- **MediaPipe handedness**: if hands come out swapped, use "Swap left/right" in the input panel.

## Known gaps (it's a first draft)

- The community backend is fake: localStorage plus generated seed creations. `CommunityApi` is the seam for a real one.
- The kuksa knife cuts by raycasting from the camera through the hand's position, which works for both webcam and gloves. With a Coil Pro for absolute hand position, true 3D cutting would be the natural upgrade.
- Webcam tracking is noisier than the gloves and is smoothed more heavily (`dofTau` in `pipeline.ts`).

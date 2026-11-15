# Senecai

**Old crafts. New hands.** Teach a robot hand the traditional crafts of Finland, using Rokoko Smartgloves or, until we have them, a webcam that pretends to be the gloves.

Junction 2026 · Rokoko track: *"Use professional motion capture to control robotic hands… useful, unexpected, or downright unbelievable."*

## Quick start

```bash
npm install          # also copies MediaPipe WASM and the hand model, so hand tracking works offline
npm run dev          # http://localhost:5173
```

Open the app, click **Choose input** (top right), then pick one:

|---|---|
| 📷 Webcam (glove emulator) | MediaPipe hand tracking converted into **Rokoko JSON v3 frames**. Hold your hand up with the palm facing the camera. |
| 🧤 Rokoko Smartgloves | Real gloves: Rokoko Studio → bridge → browser. |
| ⌨️ Keyboard + mouse | Right hand: `A S D F G` curl thumb…little, `Space` = fist, `H` = thumb across palm, mouse moves the hand. Left hand: `Z` closes/opens its fist, arrow keys turn its wrist. |

Calibrate (open hand, then fist; about 6 seconds) from the same panel. It makes a big difference.

## Hosting (Vercel + Supabase, free tiers)

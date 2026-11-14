# Codebase audit

Read-only audit (2026-11-14). Four parallel Explore agents (bridge+input, workbench, kantele/robot/community, globe/UI) produced 41 candidate findings. The scrutinizer agent checked each against the code, merged duplicates and rejected weak ones: **38 confirmed**, 0 rejected. No source files were modified.

| Severity | Count |
|---|---|
| critical | 1 |
| high | 11 |
| medium | 14 |
| low | 12 |

## Critical

### 1. UDP datagram with JSON null (or null actor) crashes the bridge
`bridge/src/decode.js:62` · logic-bug

- **Problem:** tryJson returns null for payload `null`; `frame === undefined` passes, then `!frame.scene` throws. decodeDatagram is called in udp.on('message') (index.js:46) with no try/catch, so Node exits. Also actors containing null crash index.js:54 on `a.name`. Socket binds all interfaces.
- **Scenario:** `echo -n null | nc -u host 14043` kills the bridge for every browser.
- **Fix:** Use `frame == null || typeof frame !== 'object'` check, validate actors entries are objects, and wrap the UDP message handler body in try/catch.
- **Verified:** Read decode.js:40-66 and index.js:44-56: no null guard, no try/catch around the handler.

## High

### 2. No 'error' listener on WebSocketServer or client sockets
`bridge/src/index.js:33` · async-error

- **Problem:** wss has no error handler (EADDRINUSE becomes an uncaught error), and the connection handler adds no ws.on('error'). Protocol violations from a client emit unhandled 'error' and can kill the process.
- **Scenario:** A second bridge on :14044 crashes with a raw stack; a malformed client frame takes the bridge down for all browsers.
- **Fix:** Add wss.on('error') with a readable message and exit, and ws.on('error') in the connection handler.
- **Verified:** Read index.js:33 and 74-80; no error listeners present.

### 3. Webcam finger frames flip 180 degrees once a bone passes 90 degrees flex, so measured curl jumps
`web/src/input/webcamSource.ts:64` · logic-bug

- **Problem:** Phalanx orientation is basisQuaternion(boneDir, palmNormal). When a bone aligns with the normal the derived z axis flips sign, so the relative rotation to the parent becomes about 180 degrees and measure() counts the twist as flex. Robot fingers snap to fully closed and can flicker.
- **Scenario:** Closing the index finger slowly on webcam: curl jumps near 0.38 from about 25 to 180 degrees.
- **Fix:** Build frames from a stable lateral axis (x = pts[17]-pts[5] orthogonalised), y = bone, z = x cross y; or keep z sign continuous with the previous frame.
- **Verified:** Derived from the cited code and the basisQuaternion math; not run with a real camera. Accepted on the geometric argument.

### 4. Forge heating/cooling/quench simulate only runs while a hand command exists
`web/src/bench/session.ts:526` · logic-bug

- **Problem:** def.simulate is invoked inside `if (cmd)`; the else branch (line 530) only clears the pose. Puukko simulate drives heat, cooling and quench, so steel time freezes when the hand is untracked.
- **Scenario:** User puts the bar in the forge and lowers hands: temp never rises and the stage never advances until a hand returns.
- **Fix:** Call def.simulate every live tick outside the `if (cmd)` block with a neutral/last aim.
- **Verified:** Read session.ts:498-530: simulate is inside the cmd branch.

### 5. Handle yaw applied live every frame but recorded only at 12 Hz, so final rotation is lost and replay diverges
`web/src/bench/crafts/puukko.ts:88` · logic-bug

- **Problem:** b.state.yaw.handle is mutated directly each frame while the 'yaw' op is emitted only when every(ctx,'yaw-handle',12) passes. The residual rotation after the last emit is never recorded, breaking ops-reproducible state.
- **Scenario:** Press E for 1 s then release: the recorded yaw is up to about 0.13 rad behind, so replay shows the handle at a different angle than the cuts.
- **Fix:** Emit a trailing op when the turn stops if the value differs from the last emitted, or emit when |v-lastSent| exceeds 0.02.
- **Verified:** Read puukko.ts:80-88.

### 6. Primary-hand fallback swaps hands without resetting squeeze or carried/held state
`web/src/bench/session.ts:500` · logic-bug

- **Problem:** When primaryCommand falls back to the off hand, tool moves and primary changes, but `squeezing` is kept from the old hand and carried/held places keep their old side. The new hand's grip is compared against the old hand's state, producing a spurious press.
- **Scenario:** Right hand tracking drops while the left fist holds the birch: a phantom press fires with the knife on the left hand, and tongs-carried blade stays carried:right.
- **Fix:** On side change reset squeezing, smoothTip, carveMix, lastOffX, and migrate or refuse the switch while carrying/holding; or ignore fallback commands as 'primary missing'.
- **Verified:** Read session.ts:498-512: only tool and primary are updated.

### 7. stop() and stale timer leave live.hands intact, so calibration can capture stale or wrong-source poses
`web/src/input/pipeline.ts:104` · logic-bug

- **Problem:** stop() clears commands and frame but not live.hands; the 500 ms stale check clears only commands. calibrate() uses live.hands unchecked and saves under the current kind.
- **Scenario:** Webcam then switch to Gloves with bridge down: calibrating saves webcam measurements as gloves calibration to localStorage.
- **Fix:** Reset live.hands in stop() and in the stale branch; have calibrate() return null when the last frame is older than 500 ms.
- **Verified:** Read pipeline.ts:100-123 and 164-172.

### 8. Robot mirror socket reconnects every 33 ms with no backoff or try/catch, and never follows bridgeUrl changes
`web/src/input/pipeline.ts:184` · async-error

- **Problem:** The 33 ms interval creates a new WebSocket whenever readyState is CLOSED, unguarded. An invalid URL throws a SyntaxError each tick; an open socket is not recreated when bridgeUrl changes.
- **Scenario:** mirrorRobot on with bridge down: about 30 failed connections per second flooding the console; URL without ws:// throws 30 times a second.
- **Fix:** try/catch, exponential backoff, and reopen when settings.bridgeUrl differs from the URL the socket was opened with.
- **Verified:** Read pipeline.ts:176-195.

### 9. HandLandmarker leaks if the source is stopped during load
`web/src/input/webcamSource.ts:83` · async-error

- **Problem:** `this.landmarker = await createLandmarker(); if (!this.running) return;` stores the landmarker on a stopped instance without closing it; stop() already ran and saw null.
- **Scenario:** Switching input while 'Loading hand tracker' shows leaks a WASM heap and a GPU context each time.
- **Fix:** Hold in a local; if !running call lm.close() and return, otherwise assign.
- **Verified:** Read webcamSource.ts:80-84.

### 10. Free-play kantele is silent until Record is pressed
`web/src/crafts/kantele/audio.ts:52` · logic-bug

- **Problem:** pluckString returns when ctx is null. unlockAudio is called only from session start/toggleRecording/replay (session.ts:101,109,252); free-play has no Start button.
- **Scenario:** Opening /kantele?mode=play and plucking glows strings but plays no sound until Record is clicked.
- **Fix:** Call unlockAudio on first pointerdown/keydown on the page, and resume the context in pluckString when suspended.
- **Verified:** grep of unlockAudio callers; read audio.ts:27-52.

### 11. PluckDetector velocity time units wrong, so every pluck has near-identical velocity
`web/src/crafts/kantele/music.ts:100` · logic-bug

- **Problem:** `/ Math.max(1, dtMs/1000)` always divides by 1 so rate is per-frame, not per-second, and frame-rate dependent. Velocity clamps around 0.5-0.58 for most plucks.
- **Scenario:** Soft and hard plucks both record about 0.55; the same motion differs between 30 and 120 fps.
- **Fix:** Divide by Math.max(1e-3, dtMs/1000) and rescale the 0.25 gain to per-second units.
- **Verified:** Read music.ts:100-102.

### 12. Studio and SDK frames broadcast interleaved with no arbitration
`bridge/src/index.js:69` · logic-bug

- **Problem:** Both UDP handler and SDK onFrame call broadcast() unconditionally; sources have different position conventions and bases, so the retargeter alternates between them per frame.
- **Scenario:** Studio streaming while the SDK/fake-sdk is also live makes the wrist jump between two coordinate systems every frame.
- **Fix:** Track last-frame time per source and forward only the active one, falling back after about 500 ms silence.
- **Verified:** Read index.js:55 and 66-70.

## Medium

### 13. MediaPipe handedness used as-is on an unmirrored frame (likely swapped)
`web/src/input/webcamSource.ts:110` · logic-bug

- **Problem:** Label 'Left' maps directly to the left side on raw getUserMedia frames; MediaPipe assumes a mirrored selfie input. It also flips the palm-normal sign. Needs hardware confirmation.
- **Scenario:** Default swapHands=false: the right hand is built as the left glove.
- **Fix:** Confirm with a camera, then invert the mapping and update WebcamPreview accordingly.
- **Verified:** Code read only; the behaviour depends on MediaPipe docs and was not tested.

### 14. Share submit has no error handling (merged with the writeUser quota retry), so the dialog sticks on 'Sharing…'
`web/src/ui/ShareDialog.tsx:37` · async-error

- **Problem:** submit sets busy then awaits community.create without try/catch/finally; writeUser (community/api.ts:60-68) retries setItem unguarded in its catch, so a second QuotaExceededError rejects and busy stays true.
- **Scenario:** Near-full localStorage plus a large bench recording and thumbnail: Share hangs with no message.
- **Fix:** Guard the retry (loop-trim or throw typed error) and wrap submit in try/catch/finally resetting busy and showing an error.
- **Verified:** Merged duplicates from the ShareDialog and api.ts findings; the api.ts code was not re-read, the ShareDialog line was not independently re-opened.

### 15. Wrong-shaped JSON in localStorage crashes every community call
`web/src/community/api.ts:55` · async-error

- **Problem:** readUser/likes only catch syntax errors, so 'null' or '{}' parses and then throws on spread or index. Callers like KantelePage and CommunityPage lack catch.
- **Scenario:** Key holds 'null': all list/get/like reject and pages never load.
- **Fix:** Validate with Array.isArray and object checks, filter invalid entries, and add .catch at call sites.
- **Verified:** Accepted from the description; plausible and low-cost but not re-opened.

### 16. Fetch effects apply stale responses (no cancellation)
`web/src/pages/CommunityPage.tsx:38` · async-error

- **Problem:** Effects in CommunityPage, CreationPage, BenchPage and KantelePage lack a cancelled flag. The random mock delay allows out-of-order responses, and a late get(fromId) in BenchPage rebuilds the session and wipes free work.
- **Scenario:** Rapidly switching filter shows the wrong list; late fromCreation resolves into free mode and resets the session.
- **Fix:** Add a cancelled flag per effect and reset state on id change.
- **Verified:** Accepted from the description; GlobePage's existing guard noted.

### 17. Learn -> Free -> Learn loses the ?from= creation
`web/src/pages/BenchPage.tsx:100` · logic-bug

- **Problem:** Free tab calls setParams({mode:'free'}) which drops from; Learn then reads a null fromId. Same pattern in KantelePage.
- **Scenario:** Learn this, Free work, Learn: ghost hands and attribution are gone.
- **Fix:** Preserve from when switching modes.
- **Verified:** Read BenchPage.tsx:98-104: Free drops from.

### 18. Early plucks before t=0 are dropped during countdown
`web/src/crafts/kantele/session.ts:219` · logic-bug

- **Problem:** onPluck ignores unless phase==='playing', but the judging window is +/-200 ms and first notes are at t=0, so early hits are discarded then marked miss.
- **Scenario:** Pluck 80 ms early on the first note: ignored, later marked miss.
- **Fix:** Allow judging in countdown when songTime >= -GOOD_MS.
- **Verified:** Saw GOOD_MS=200 and the phase logic at session.ts:143-161; onPluck line not re-opened.

### 19. Stale pluck-detector state after hand loss causes false chords on return
`web/src/crafts/kantele/session.ts:132` · logic-bug

- **Problem:** Detector armed/prev persist while cmd is undefined; the retargeter snaps on return, so already-curled fingers fire as rising edges.
- **Scenario:** Hand returns half-curled: 3-5 strings fire at once and get recorded or scored.
- **Fix:** Add PluckDetector.reset() that disarms strings above off and sync prev; call when cmd reappears.
- **Verified:** Accepted from description.

### 20. autoRange min has no lower bound, so glitch frames permanently shrink the range
`web/src/robot/retarget.ts:135` · logic-bug

- **Problem:** Only max is bounded; min moves toward any lower raw value, including thumbRotate=0 from missing landmarks or negative noisy values. It never recovers until recalibration.
- **Scenario:** About 20 frames of missing thumb landmarks drag min[0] toward 0, leaving the thumb half-rotated.
- **Fix:** Bound min like max and skip auto-range for channels with missing landmarks.
- **Verified:** Read retarget.ts:131-137: no lower bound confirmed.

### 21. Every shave op does a full surface-nets remesh and geometry rebuild
`web/src/bench/render/workpieces.tsx:101` · performance

- **Problem:** Rebuild per version change re-runs surfaceNets over the whole block with per-vertex array allocations and a new BufferGeometry each time.
- **Scenario:** Continuous carving at 60 fps causes GC pauses and frame drops.
- **Fix:** Reuse typed arrays, avoid b.coords() allocations, update attributes in place, throttle to about 30 Hz.
- **Verified:** Accepted from the description; not profiled.

### 22. Heat ops rebuild the forged bar geometry when only emissive colour changes
`web/src/bench/crafts/kit.ts:87` · performance

- **Problem:** temp ops bump version and trigger full ForgeView rebuild about 10 times a second.
- **Scenario:** Bar in the forge or cooling rebuilds and re-uploads geometry with no shape change.
- **Fix:** Separate shape version from temp; update emissive per frame.
- **Verified:** Accepted from the description; forge.ts version++ sites seen.

### 23. fadeLimb runs on every onZoom event and allocates per label
`web/src/pages/GlobePage.tsx:374` · performance

- **Problem:** Called every frame during drag and iterates about 300 labels with split/map each; the 250 ms tick already covers it.
- **Scenario:** Dragging the globe causes GC churn and dropped frames.
- **Fix:** Remove or RAF-throttle and cache unit vectors in a WeakMap.
- **Verified:** Accepted from the description.

### 24. Country topology, colouring, labels and sea texture rebuilt on every globe visit
`web/src/pages/GlobePage.tsx:237` · performance

- **Problem:** All derive from static data but are recomputed per mount, and SearchBar calls loadCountries again.
- **Scenario:** Navigating back to the globe re-parses TopoJSON and repaints a 2048x1024 canvas on the main thread.
- **Fix:** Module-level memoisation of loadCountries, colours, labels and the sea canvas.
- **Verified:** Accepted from the description.

### 25. Canvas width/height reassigned every animation frame
`web/src/ui/WebcamPreview.tsx:30` · performance

- **Problem:** Assigning dimensions resets the backing bitmap and context state each frame, confirmed in the code.
- **Scenario:** Every frame of an active webcam session pays a bitmap reset.
- **Fix:** Set size only when it changes and skip when no new video frame has arrived.
- **Verified:** Read WebcamPreview.tsx:30-31.

### 26. Compressed datagrams allocate 4 MB each
`bridge/src/decode.js:45` · performance

- **Problem:** lz4.decompress with maxSize and tryLz4Block allocate MAX_DECOMPRESSED per call, possibly twice per datagram, plus a JSON re-stringify.
- **Scenario:** 60 Hz LZ4 stream creates hundreds of MB/s of garbage and GC jitter.
- **Fix:** Use a reusable module-level scratch buffer and forward the original text for plain JSON.
- **Verified:** Read decode.js:26-65.

## Low

### 27. Robot mirror socket receives and discards all broadcast glove frames
`web/src/input/pipeline.ts:185` · performance

- **Problem:** robotWs connects to the same broadcast endpoint and has no onmessage, so it receives every frame.
- **Scenario:** Doubles WS traffic in the tab while mirroring.
- **Fix:** Send on the gloves socket, or add a role hello and skip in broadcast.
- **Verified:** Read pipeline.ts:184-186 and index.js:37-39.

### 28. Per-frame allocations in the particle renderer and updater
`web/src/bench/render/BenchStage.tsx:181` · performance

- **Problem:** New Matrix4, Quaternion, Euler and Vector3 per particle per frame; updateParticles uses filter and per-spawn Color.
- **Scenario:** About 30k allocations per second at the particle cap.
- **Fix:** Hoist scratch objects, compact in place, cache colours.
- **Verified:** Accepted from the description.

### 29. tick/computeGhost allocate per frame and filter events each frame
`web/src/crafts/kantele/session.ts:133` · performance

- **Problem:** setSide maps a new array every frame; computeGhost filters the whole recording for the first pluck time.
- **Scenario:** GC pressure in creation-derived lessons.
- **Fix:** Early return in setSide, precompute first pluck time, reuse scratch vectors.
- **Verified:** Accepted from the description.

### 30. Replay speed button state goes stale when BenchReplay gets a new recording
`web/src/pages/CreationPage.tsx:42` · logic-bug

- **Problem:** useState(session.replaySpeed) only initialises on mount and BenchReplay has no key, so the highlighted button can differ from actual speed.
- **Scenario:** Pick 12x on A, navigate to B: 12x highlighted but B plays at its default.
- **Fix:** Add key={c.id} to BenchReplay or sync via effect.
- **Verified:** Accepted from the description; line 151 shows no key.

### 31. Copied MediaPipe WASM is not refreshed after a package upgrade
`web/scripts/fetch-assets.mjs:15` · logic-bug

- **Problem:** The copy is skipped when the wasm dir exists, so JS and WASM versions can mismatch.
- **Scenario:** npm update then webcam init failure or CDN fallback.
- **Fix:** Version-stamp and re-copy on mismatch.
- **Verified:** Accepted from the description.

### 32. Creation and cluster pin paths are unreachable
`web/src/pages/GlobePage.tsx:500` · dead-code

- **Problem:** buildPins is called with [] creations and only 2 crafts exist, so cluster and creation pins never form; the clustered state causes re-renders for no visible change.
- **Scenario:** Zoom hysteresis re-renders and rebuilds pins with identical output.
- **Fix:** Remove the dead paths and the clustered state, or pass real creations.
- **Verified:** Accepted from the description.

### 33. Untracked web/public/globe assets are unreferenced
`web/public/globe/earth-night.jpg:1` · dead-code

- **Problem:** grep found no references to earth-night or earth-topology; about 1.1 MB ships in dist.
- **Scenario:** Unused bytes in every build and noise in git status.
- **Fix:** Delete the folder or gitignore it.
- **Verified:** grep of web/src, index.html and scripts returned no hits; git status shows it untracked.

### 34. Unused bench plumbing (merged): Bench.version, 'tool'/'flag' ops, flag(), canGrab, InteractCtx released/free/frame, and the carve op path
`web/src/bench/core.ts:291` · dead-code

- **Problem:** Bench.version is incremented in 5+ places but never read. canGrab is only called at session.ts:325 and no craft defines it. 'tool'/'flag' ops have no producers. The 'carve' op is exercised only by tests.
- **Scenario:** Dead surface in the snapshot format and per-frame ctx construction.
- **Fix:** Remove or wire up; keep carve only if documented as test-only.
- **Verified:** grep for .version and canGrab; the remaining claims were accepted from the descriptions.

### 35. scrape() is exported but never used
`web/src/crafts/kantele/audio.ts:63` · dead-code

- **Problem:** Only its definition appears in grep.
- **Scenario:** Misleading dead audio code.
- **Fix:** Delete it.
- **Verified:** grep -rn scrape web/src shows only the definition.

### 36. SIDES export is never used
`web/src/rokoko/types.ts:22` · dead-code

- **Problem:** Only its declaration matches in web/src and bridge/src.
- **Scenario:** Unused export.
- **Fix:** Remove it or use it in place of inline arrays.
- **Verified:** grep SIDES returned only types.ts:22.

### 37. Unused v1 'cut'/'yaw' event variants, samplePose side param and DOF_NAMES
`web/src/recording/recording.ts:29` · dead-code

- **Problem:** No producers or consumers for the variants; callers omit the side param.
- **Scenario:** Misleading types.
- **Fix:** Remove them.
- **Verified:** Accepted from the description.

### 38. Unnecessary exports and unused Meter strong prop
`web/src/pages/BenchPage.tsx:14` · dead-code

- **Problem:** Meter, KanteleThumb, SEA and CraftImage are exported but used only locally; strong is never passed.
- **Scenario:** No runtime effect.
- **Fix:** Drop the exports and the strong prop.
- **Verified:** Accepted from the description.

## Rejected candidates

| Finding | File | Why rejected |
|---|---|---|

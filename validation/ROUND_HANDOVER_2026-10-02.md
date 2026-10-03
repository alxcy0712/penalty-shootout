# Synchronized next-round presentation

Baseline: published feature commit `d6fcbfca5ebfcd2b7401d3295c2144ecbf49ecf3`.

## Problem and change

Next already replaced the shot, participants and role UI immediately, while the camera continued a 180-degree exponential orbit around the reset scene. The path was approximately 44.3 m in advanced mode and 58.5 m in simple mode; it took 1.28 seconds to reach 99% of the new angle. The new aiming controls could therefore appear while the camera still showed the old role or a side-on view.

The first new-round draw now cuts directly to the stable camera for that role, together with the ready actors, ball and team colors. There is no trailing camera settle while aiming. Buttons and gestures remain immediately available; no timer, input lock, actor translation, opacity animation or render pass was added.

The boundary is identified by match object, round serial and role. Old result clock, shot reference, goal-ball aftermath, trail and net response are cleared once. A same-role new round or restarted match also refreshes correctly. Identity is checked before the paused-frame shortcut, so Next followed by Pause before the next animation frame still presents the new ready scene. Repeated draws/modal changes within the same round do not reset it. The final match result retains its last shot; Home clears presentation state and a resumed match cuts directly to its saved role.

## Verification

- 282/282 tests pass, zero failed or skipped; independently repeated by the parent reviewer
- Vite production build passes; the existing large-chunk warning remains
- Seventeen new handover regressions exercise the actual main click/Next/beginTurn/newMatch/frame/gesture functions, real Match/Shot logic and Stadium update. Only DOM/render plumbing and mesh uploads are stubbed
- Both modes and role directions are checked at 30/60/120 Hz. Tests cover immediate aiming, touch cancellation/release, stable camera projection under a held finger, duplicate Next, same-role serial changes, new/rematch identity, pause before first redraw, final-result retention and Home/resume
- Thirteen of the original fourteen handover cases fail against the previous scene, confirming the suite detects the original mismatch; final-shot retention is the unchanged passing case
- Existing actual-skin, captured-contact, advanced touch-drag freeze, central recovery and first-result clock regressions still pass

A separate production-skin regression projects all four ready styles, keeper, ball and actual goal geometry at five viewport sizes, plus a radius-budget test. Reduced motion, paused resize and hidden/resume timing are covered too.

Only `scene.js` and the static camera-framing helper in `rendering.js` change in the runtime. Physics, rigging, model assets, captured clips and contact calibration data are byte-identical to baseline. The prior dense 40-held-path/1,400-body-pose and 51-central-result/2,295-pose evidence remains applicable to those unchanged modules; those expensive audits were not rerun for a camera/presentation-only edit.

## Resource cost and limits

The rendering bundle changes from 1,264.15 / 348.02 kB to 1,264.23 / 348.05 kB raw/gzip. The game bundle changes from 53.58 / 20.72 kB to 53.87 / 20.78 kB raw/gzip. Combined gzip growth is about 0.09 kB. No meshes, materials, textures, bones, lights, framebuffer dimensions or default render passes are added.

The new steady-frame work is a bounded round-identity comparison and the small aspect-based framing calculation. The old exponential/trigonometric camera orbit is removed. Net reset copies the existing rest buffer only if it was deformed; existing jersey resources are reused. Opt-in CPU profiling begins before the reset so it includes handover work. Deterministic projection-update/path counters are recorded with the camera evidence rather than presenting cloud wall-clock timing as a phone-FPS guarantee.

This is an intentional broadcast-style scene cut between penalty attempts. It does not animate players walking back to their starting positions. Offline camera/geometry diagnostics verify framing and state handover; actual WebGL image quality, browser/device interaction, GPU time and phone thermals remain untested because the previously reported browser access restriction was not bypassed.

## Framing evidence

The first-frame review also exposed a pre-existing crop: advanced portrait's 17 m attack radius placed the compact ready striker partly outside a 390×844 view (x=-44.37…31.89 px), and completely outside a tall 320×900 view (x=-95.25…-13.93 px). The other three ready styles fit. The visible problem warranted a small static, role-specific correction rather than retaining the cropped endpoint.

`advancedAttackRadius(width,height)` uses `clamp(7 + 5.75 * height / (width - 24), 17, 25)`, with a safe denominator. This inexpensive fit was calibrated against the current production skins and full goal. It retains the 43° FOV, preserves landscape's 17 m radius, and bounds the distance by the existing simple-mode 25 m radius. It responds only to viewport dimensions, never finger movement or animation time. Defending and simple-mode framing are unchanged.

All twenty ready-style/viewport combinations at 390×844, 320×700, 320×900, 430×932 and 844×390 retain at least 12 px complete-mesh margin. Measured minimum margins are 15.45, 14.88, 13.14, 15.80 and 38.23 px respectively. At 390×844 the corrected compact striker spans x=15.45…72.92 px; the goal spans x=34.03…355.97 px. Goal width remains about 82–92% on the tested portrait views; the original wide defending goal-frame crop is unchanged. This is a modest pullback, so the actor is slightly smaller while fully visible.

Matched boards are in `/tmp/round-camera-review`, including `advanced-390x844-defend-to-attack.png`, its reverse direction, both landscape boards, the corresponding simple-mode boards, and `overview.png`. They use actual Stadium updates, production CPU-skinned geometry and exact Three camera matrices; textures, UI, lights/shadows and stadium decoration are omitted. They demonstrate framing, not WebGL quality.

Across 79 draws over the first 1.3 seconds, projection-matrix updates fall from 63 (advanced) / 64 (simple) to one. Candidate post-first-draw camera travel is exactly zero. Its first-draw displacement is the deliberate cut and is reported separately; it is not counted as continuous motion. Baseline travel after its first draw is about 40.9–41.9 m advanced and 53.6–55.8 m simple, depending on direction. Camera path length is not a GPU timing measurement.

Exact hashes, frame bounds, paused handover evidence, distinct cut/travel counters and all-style probes are recorded in `round-camera/manifest.json`. The static resource census remains identical before/after: 38 main candidates, 22 shadow candidates, 63,566 main mesh triangles, 36,746 shadow mesh triangles and 5,963,772 logical generated-texture bytes. These are pre-culling candidates, not actual draw calls; framing can change what is visible.

Reproduce the offline diagnostic with:

```sh
node tools/qa/export-round-camera.mjs /tmp/round-camera-review d6fcbfc
python tools/qa/render-round-camera.py /tmp/round-camera-review
node tools/qa/export-round-camera.mjs /tmp/round-camera-review d6fcbfc --probe
```

No app/browser restriction was bypassed and no preview was deployed.

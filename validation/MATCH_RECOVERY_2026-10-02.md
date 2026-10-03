# Central result recovery and exact contact handover

Baseline: published feature commit `aeaa9780985d309d0c96b0479314c2b6423f6026`. This iteration changes match presentation and post-result movement, with no new meshes, textures, lights, postprocessing passes or captured clips.

## Observed problems

The central keeper branch had a block but no return from it. A real central low catch (`x=0, y=.2, power=.5, direction=0, seed=42`, speed/reach 85) left the hip at 0.300 m indefinitely. A missed high central shot left the arms raised. Because live tracking stops at the result, some poses also retained an unfinished step; actual ankle centers reached 0.151 m above the pitch. Simply raising the hip could leave a wide support target beyond the two-bone leg's reach.

The actual main-loop/scene handover had a separate timing error: physics had already advanced to contact, then the first result drawing added the full display-frame interval again. The observed striker clock advance at a central catch was 50 ms at 30 Hz, 33.3 ms at 60 Hz and 25 ms at 120 Hz. The motion inspector starts at the event origin and did not reveal this caller error.

## Bounded changes

The first result frame now displays the exact event origin. Subsequent frames advance only their own result interval. This retains the existing fixed-step interpolation lag rather than adding another frame. Tests execute the real main.js release/frame functions, Shot simulation and Stadium update, replacing only DOM/render surfaces.

Central result recovery waits for the existing 0.44 s gather before moving the support/body. Interrupted boots return to the calibrated stance support height, then the pelvis moves into a reachable standing stance and the arms return. Sampling is deterministic from the captured pose and elapsed result time. The movement is authored recovery, not another motion-capture recording. Live-ball decisions and lateral dives retain their existing paths.

The existing neutral ankle target is 0.075 m, not the sole surface. In the matched baseline low-catch mesh the lowest boot surface is about 18.1 mm above the flat pitch; the interrupted high-miss surfaces were 26.7 and 94.4 mm. Returning to the normal calibrated stance does not establish literal sole contact or a force-balanced human simulation.

## Scope and remaining limits

The explicit next-round repositioning is unchanged: a new kicker/keeper setup appears as the camera rotates. Replacing that reset requires a deliberate match scene transition, not a blend that slides actors several metres across the field. Central catches remain stylized; fingers remain rigid and existing adjacent cloth folds remain possible. Offline CPU skin/Blender views do not establish WebGL image quality, real-phone frame rate, GPU cost or thermal behavior.

## Verification

- 263/263 automated tests passed, with no skipped tests; Vite production build passed
- Four new main-loop handover regressions and two scene recovery regressions cover 30/60/120 Hz, paused/forced drawing, consecutive shots and exact runup contact timing
- Six recovery regressions preserve full baseline live-trajectory hashes, capture/gather endpoints, support and arm continuity, fixed limb lengths, mirror/translation behavior, restored saves and deterministic scrubbing
- Original 40 held-ball paths pass 240 Hz joint and 60 Hz whole-skin sphere/floor checks; largest elbow step remains 36.585 mm at 240 Hz, under the unchanged 40 mm gate
- Original 1,400 actual-skin held poses retain zero protected forearm/torso, calf/torso and opposite lower-leg crossings. Minimum skin height remains -1.924 mm, within the unchanged 5 mm floor tolerance
- Additional central-result coverage: 54 deterministic fixtures, of which 51 remain on the central branch and three switch into existing lateral recovery paths. All 2,295 eligible actual-skin poses pass the same protected-body/floor gates. Sampling is 10 Hz plus explicit support-phase boundaries at +/-10 microseconds; it is not a continuous collision proof
- Central adjacent shoulder-cloth intersections rise from a baseline maximum 0.217 mm to 0.899 mm finite-triangle SAT. The exact marked side/back views show an inward armpit cloth fold, not a forearm through the torso. This statistic is triangle separation, not a volumetric body penetration depth
- The 135-shot collision matrix is unchanged: 58 contacts, 36 catches, zero unfinished shots; first-skin contact gap -0.0060 to +0.1115 mm
- All GLB/Blender assets, original capture tracks, contact calibration data and render budgets are unchanged

The shared rendering chunk is 1,264.15 kB raw / 348.02 kB gzip, versus 1,262.15 / 347.19 kB before (+2.00 kB raw / +0.83 kB gzip). The existing large-chunk warning remains.

## CPU measurement

Tests, Blender and video encoding had finished before measurement. The reusable `benchmark-result-recovery.mjs` ran five warmed alternating rounds on the same cloud Node CPU, comparing 51 actual central results at 60 Hz through four seconds (12,291 samples). It includes `poseAt` and caught-ball gathering, excludes skinning/rendering/GPU/DOM/loading, and verifies unchanged live outcomes and capture poses.

Median complete batch: 260.38 → 248.72 ms (21.18 → 20.24 microseconds/sample, -4.5%). The moving interval was effectively unchanged: 62.73 → 62.49 ms across 4,743 samples. The settled interval used fewer rig solves: 76.75 → 59.95 ms across 6,171 samples (12.44 → 9.71 microseconds/sample). Independent cohort medians do not sum. Raw rounds are retained in `match-recovery/central-cpu.json`.

A separate five-pair 135-shot physics benchmark measured 714.07 → 729.93 ms median (+2.2%); round ranges overlap (685–746 ms before, 691–758 ms after). Near-goal P99 was 0.949 → 0.996 ms. This is reported variation, not evidence of a physics speedup or a guaranteed absence of cost. The existing secured-grasp optimization and render budgets are retained. No cloud timing establishes phone FPS, GPU headroom, battery or thermal behavior.

## Visual evidence and reproduction

Matched production-mesh sequences cover result +0 to +4 seconds, 97 frames at 24 fps, in four fixed views. Both frame-zero vertex arrays match baseline exactly. Reviewed key times are +0, +0.5, +1, +1.5, +2.5 and +4 seconds, with additional early support samples and exact shoulder-seam side/back closeups. Normal and quarter-speed encodes are available; the recorded verdict is sampled image/geometry review, not a claim that a real-device player was exercised.

The low-catch pelvis rises from 0.300 to 0.830 m with fixed ankle locations and attached ball/gloves. The high miss settles both actual ankles to 0.075 m by +0.5 seconds and lowers wrists from about 1.85 to 1.05 m by +1.5 seconds. No visible body break, support snap or separated held ball was found in the reviewed views.

Evidence directory: `/tmp/central-recovery-review-20261002`, including `REVIEW.md`, `low-catch-contact-sheet.png`, `high-miss-contact-sheet.png`, `worst-seam-closeup-clean-and-marked.png`, and the `*-before-after-{normal,quarter}.mp4` files. Hashes, recipes and metrics are committed in `match-recovery/media.json`. The reviewed candidate geometry is reproduced byte-for-byte with the committed exporter:

```sh
node tools/qa/export-character-poses.mjs --motion result --direction 0 --height .2 --power .5 --target 0 --seed 42 --speed 85 --reach 85 --center 0 --duration 4 --fps 24 --out /tmp/result-low
node tools/qa/export-character-poses.mjs --motion result --direction 0 --height 2.25 --power .6 --target -.7 --seed 3 --speed 85 --reach 85 --center 0 --ball false --duration 4 --fps 24 --out /tmp/result-high
node tools/qa/audit-held-body.mjs --central-results --check
node tools/qa/benchmark-result-recovery.mjs /tmp/result-cpu aeaa978
```

The ordinary capture inspector, free-dive source motion and original test budgets remain unchanged. See `summary-match-recovery-2026-10-02.json` for exact frozen runtime hashes and compact gate outcomes.

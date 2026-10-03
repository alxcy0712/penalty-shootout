# Captured run-up onset refinement

2026-10-01; before-clock baseline: `1b1230ec27125ad020e0688b080c977c7b02f76c`.

## Scope and result

Explicit game run-up styles now enter their frozen preparation with zero source-clock velocity and acceleration. A 20 ms smooth onset leads into a bounded catch-up and returns **exactly to the original clock at 200 ms**. Maximum clock-rate multiplier is **50/47 = 1.06383**. The final 350 ms of each approach, compact support plant at 1.0 s, compact contact at 1.125 s, and all post-contact playback remain unchanged. Raw capture inspection and unstyled/native playback stay unchanged.

This is a small timing refinement of the existing two recordings, not new motion capture, pose blending, foot IK, geometry deformation, or a new physical model. Prepared poses remain stationary during aiming. Runtime work is bounded scalar arithmetic with no new objects, geometry, textures, bones, rendering passes, or draw calls. GPU or real-device performance was not measured.

## Production-skin measurements

Measurements use the actual decoded GLB, runtime skeleton and skinning. Boot positions are the mean of the actual skinned boot vertices assigned predominantly to that foot/toe. Values below are first-frame world speeds at 60 Hz, in m/s, before → after.

| Style | Pelvis | Kicking boot | Support boot |
| --- | ---: | ---: | ---: |
| Direct | .1788 → .0776 | .0684 → .0509 | .0625 → .0496 |
| Measured | .0836 → .0357 | .0562 → .0240 | .0518 → .0221 |
| Stutter | .1780 → .0761 | .0642 → .0283 | .1551 → .0669 |
| Compact, independent 10_03 | .5423 → .2719 | .8630 → .5767 | .8873 → .3799 |

At 240 Hz over the first 200 ms, the maximum observed speed increase is **6.383%**, within the 6.5% regression bound. This bounded catch-up is an explicit tradeoff, not a claim that every velocity or acceleration sample is lower. Compact kicking-boot peak at 60 Hz changes from 2.8490 to 2.8541 m/s; at 240 Hz it changes from 2.9092 to 3.0578 m/s. Existing sampled clip interpolation remains present. The C2 guarantee applies to the time remap, not to all derivatives of the sampled capture.

Maximum source lag is 2.916 / 1.682 / 4.044 / 9.541 ms, respectively. Maximum pelvis/boot sample displacement from the old clock is 1.70 / 0.80 / 1.70 / 14.22 mm. Late-clock error is zero in the audited plant/contact samples. Actual boot/ball surface error remains 0.0512 mm on 10_01 and below 0.00001 mm on 10_03.

## Reproduce

- `node --test tests/runup-onset.test.js tests/striker-runup-style.test.js tests/compact-kick-integration.test.js` (18 tests passed before any subsequent model replacement)
- `ARTIFACT_DIR=/tmp/runup-onset node tools/qa/audit-runup-onset.mjs`
- `ARTIFACT_DIR=/tmp/runup-onset-review node tools/qa/export-runup-onset.mjs`
- Render each generated `style-0` through `style-3` directory with `tools/qa/render-refined-poses.py`, `--views 1`

The audit embeds current source/model hashes and a separate frozen old-clock implementation. The before branch samples the native capture, rather than feeding a second remap through the new runtime. The after branch calls production `GameCharacter.kick` once. The exported A/B geometry from the approved candidate and integrated runtime was byte-identical for all four styles.

Dedicated regressions cover the remap endpoints and bound, exact identity after 200 ms, actual boot/pelvis velocity, identical CPU-skinned geometry at the retimed source timestamp, prepared-pose stability under changing aim, arbitrary timestamps after 30/60/120 Hz histories and out-of-order scrubs, unchanged native replay, and compact plant/contact with support drift below 1 mm. Existing tests continue covering 10_01 support, fixed limb lengths, full skin floor clearance and ball contact.

Offline before/after geometry was visually inspected at 0, 16.7, 33.3, 66.7, 125 and 200 ms. The visible difference is restrained, most evident in compact's initial pelvis/boot advance. No new silhouette distortion was observed. These are Blender CPU renders with simplified materials, not browser screenshots or real-device evidence. Rerun the audit and model tests after any model replacement.

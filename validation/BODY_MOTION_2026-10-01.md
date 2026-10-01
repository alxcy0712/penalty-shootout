# Body, clothing and supported goalkeeper motion

Baseline: published `1b1230ec27125ad020e0688b080c977c7b02f76c`. This record concerns offline Blender geometry and actual CPU-deformed runtime poses. It does not establish browser rendering quality or sustained mobile frame rate.

## Visible changes

- Smoothed shoulder/upper-arm form and less padded chest without adding topology there
- Straight-falling football shorts with a separate hem opening around the thigh, replacing the previous skin-tight silhouette
- Two existing real CMU kicks enter motion through a bounded 20 ms source-clock ramp. The original timing is recovered after 200 ms; the final support/strike window is unchanged. These remain two captured performances, not four new captures
- Free saves now progress from reach through arm absorption, modest spine/chest articulation, a planted partial palm/heel brace, boot-supported rise and hand release
- The same articulated frames drive both rendering and contact geometry

See [model workflow](../tools/blender/BODY_CLOTH_REFINEMENT.md), [source-clock study](../docs/RUNUP_ONSET_VALIDATION.md), and [keeper motion](../docs/KEEPER_SOFT_MOTION.md).

## Asset and loading budgets

| Asset | Triangles | GLB bytes | SHA-256 |
|---|---:|---:|---|
| Keeper | 17,954 | 449,080 | `29b228bb40af114dd6cb427312102bd772fd1951c8754a27d87d718377e5e31a` |
| Striker | 17,924 | 446,308 | `aad3a3782a1e806b8fd596e6b9eeb62e47ebe4d729bb421d0ec4631a6fb76996` |

Both fit the original 18,000 triangle / 450,000 byte per-model limits. Each has 22 fewer triangles than the published model. Six materials, two unchanged 512/128 textures, 22 asset bones / 24 runtime bones and four maximum skin weights are retained. Original source actions, binds and protected palm/boot surfaces are unchanged. The source `.blend` files are lossless gzip containers that reopen in Blender 4.3. Their retained captured actions do not bake the runtime procedural keeper or helper-bone postprocessing.

The two GLBs grow by 12,284 bytes combined. Generated contact data grows from 486,040 to 569,735 bytes (+83,695): principally weighted torso hull data and the candidate-only exact skin patch. The Vite shared rendering chunk is 1,261.52 KB / 343.98 KB gzip, approximately +90 KB raw / +26 KB gzip. The existing large-chunk warning remains. This is a real loading/CPU tradeoff; no extra lights, render passes, materials or bones are introduced.

## Contact architecture and CPU cost

The torso broad hull is 80 vertices / 156 faces; an eligible near-surface candidate evaluates 675 vertices / 1,116 faces. The 6 mm broad-phase allowance does not enlarge the physical ball radius. Final contact resolves against the deformed surface; tests distinguish 2 mm hits and misses. Zero-articulation poses retain the rigid path.

Five interleaved same-machine warmed Node runs compare the complete revision with the published baseline. These measure CPU execution, including pose construction and collision where specified, and do not isolate a GPU frame or promise phone performance. Raw source-hashed runs are in [benchmark.json](artifacts/keeper-torso/benchmark.json).

- 135-shot batch median: 1,141.3 → 1,305.5 ms (+14.4%)
- Near-goal physics-step P99 median: 2.236 → 2.153 ms (a noisy tail result, not a claimed speedup)
- Ten grasp paths, 1,690 samples through 2.8 seconds: median 416.6 → 486.0 ms (+16.7%)
- Six free-save paths, 1,446 samples including pose construction and both glove rotations: median 8.00 → 19.19 ms, approximately 5.53 → 13.27 microseconds per sample

Earlier kernels/runs measured batch increases of ~9.7% to 26.3%, illustrating shared-cloud timing variability. The final run started after this task’s full audit/test processes finished, but the cloud was not an exclusive performance laboratory. The retained overhead is not described as negligible. No mobile GPU or sustained-device test was possible in this environment.

## Surface and support limits

The final model differential preserves source shoe/palm vertices exactly. Both captured kicks have zero forearm/shirt intersections in 182 focused samples. Local knee and adjacent sleeve folds remain. Across 71 poses, opposite-thigh pair count falls 676→602 and the worst finite-triangle SAT measure falls 10.835→10.149 mm. Some individual inner-cloth samples worsen, including +1.078 mm at the long kick's 2.2-second follow-through; the reviewed crossing is hidden between cloth panels, with no exposed skin tear. These are finite-triangle separation measures, not a volumetric body-penetration depth.

For free saves, 236 sampled poses have no protected forearm/torso, calf/torso, shoulder-support/torso or opposite-foot/calf intersections. The largest local inner-elbow fold is 1.701 mm at early 0.1 seconds, below the original pose's 1.719 mm; post-landing inner-elbow folds are ≤0.372 mm. The final 40-capture / 1,400-pose held-body gate has zero protected forearm/torso, calf/torso and opposite-foot/calf crossings. It samples all captures at 10 Hz plus the observed wide-middle early/late and central windows at 120 Hz. Residual adjacent shoulder and elbow folds reach 6.217 / 3.165 mm; those categories are not claimed to be zero.

A settled supporting glove is approximately 5 mm above physical y=0, with central palm minimum ~7 mm, area-weighted mean ~29.5 mm and normal ~26.7° from downward. It is a partial palm/heel brace, with rigid fingers. Joint-center floor exceptions are restricted to explicitly tagged bracing wrists; actual skin clearance and fixed support are separately tested. This is a geometric support check, not a force or balance simulation.

## Final verification status

Runtime freeze: anatomy SHA `40a841de7cd387afa12ecab537bd686b6923f742421307037db7b0940a711a8a`, contact SHA `1c8ccc440c07643b455f1c0300fe5b17ec243c37f2b0584b1d34e47f9f2f260a`.

- Complete suite: 240 passed, zero failed/skipped; production build passes
- All 40 actual captured shots through 2.8 seconds: 240 Hz motion / 60 Hz exact full-skin sphere and floor sampling, zero `--check` failures. Worst sphere-to-skin signed gap is −0.000457 mm; maximum elbow step is 3.658 cm/240 Hz under the unchanged 4 cm gate
- The 135-shot matrix retains 58 contacts, 36 catches and zero unfinished shots. First actual skin-contact gap ranges from −0.0022 to +0.1115 mm
- Capture starts exactly at the original ball and incoming pose; both glove attachment and whole-skin floor checks remain separate gates
- The broad audit found two missed wide-middle forearm/ball intersections and an asymmetric central elbow spike after the earlier seven-recipe suite passed. The final tests include both wide mirrors and the central mirror; no clearance or sampling threshold was weakened
- Wide get-up elbow speed falls from 16.82/16.69 to 3.564/3.622 m/s relative to the hip; per-frame upper-arm angle from ~14° to 3.20–3.25°. The central mirror falls from 28.92 to 8.36 m/s; its remaining brisk early gather still requires visual judgment

Reproduce:

```sh
npm test
npm run build
node tools/qa/audit-character.mjs hold --check --out /tmp/keeper-hold
ARTIFACT_DIR=/tmp/keeper-held-body node tools/qa/audit-held-body.mjs --check
node tools/qa/audit-character.mjs matrix --out /tmp/keeper-matrix
ARTIFACT_DIR=/tmp/keeper-support node tools/qa/probe-keeper-support.mjs
node tools/qa/benchmark-keeper-torso.mjs /tmp/keeper-cpu 1b1230e
```

The final simultaneous elbow-circle constraint clears both ball and torso on the same frozen kernel. Exact production reruns of both 40-capture gates pass. The cleaned runtime is deep-equal to its audited/rendered numerical candidate across 26,920 complete gather outputs; debug instrumentation was removed without changing pose values. Final full suite (240 tests) and production build pass on this kernel. Matched early/late wide-catch images and the normal-speed sequence show the forearm staying outside both shirt and ball; the central catch is continuous but still brisk and stylized. Independent reviewer tests/build also pass.

Compact source-hashed numerical evidence: [summary-body-motion](summary-body-motion-2026-10-01.json).

Browser/device validation remains unavailable because the existing browser/network restrictions prevent the local game preview. Blender/CPU comparison sequences use matching cameras and actual skin, but are not WebGL screenshots.

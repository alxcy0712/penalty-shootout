# Grip, wrist and recovery refinement

## Baseline and acceptance scope

This iteration starts from published commit `f2db0191fa438ff111593831cd4613f696ed2a96`, tree `0045fa6eb44fd5c4ab6df15f508b5abf811b10dc`. The preceding ten-round validation remains reproducible and is not counted as new evidence here.

The requested targets are visible elbow/wrist stiffness, open fingers around a held ball, and mechanical getup. Candidate work is isolated until matched views and coupled geometric checks support integration. The existing 645-shot / 205-catch manifest remains fixed; physical outcomes and any intentional differences must be reported explicitly.

Baseline mechanisms under review:

- Fingers have no individual bones. Each hand and its fingers follow one rigid hand transform; the 22 authored bones plus two shoulder helpers already fill the current 24-bone runtime budget.
- Palm orientation is contact-aware, while a narrow forearm/hand blend carries the visible wrist bend. Changing that blend also affects the generated collision surfaces and requires matching regeneration.
- The lateral recovery couples several torso and arm changes to the same rise progress. Candidate timing must retain real geometric support and exact held-ball attachment.

## Required final evidence

1. Same-camera full sequences and enlarged wrist/finger/elbow views, with source and asset hashes. Inspect normal-speed chronological frames as well as critical boundaries; distinguish offline views from actual WebGL output.
2. Whole-skin ball clearance, floor, protected limb/torso crossings and continuity for every actual catch in the fixed manifest; mirrored free-save support and floor sweeps.
3. Capture-start identity, phase reset, repeated timestamps, reverse sampling and 30/60/120 Hz history independence. Any skin deformation must be visible to the CPU audit, not only a rendering shader.
4. Full tests and build, independent review, and unchanged or explicitly quantified asset, bone, draw, load and CPU budgets.

Geometric contact and plausible support placement are not a rigid-body force or balance simulation. Adjacent cloth folds and actual-device performance remain separate, bounded limitations.

## Technique references and authored interpretation

- [FIFA catching exercises](https://www.fifatrainingcentre.com/en/environment/fifa-goalkeeper-training/goalkeeping-fundamentals/learning-to-catch.php) teach bent forearms and controlled absorption. The [inspected glove closeup](https://www.fifatrainingcentre.com/media/images/environment/goalkeeping/1.variant1920x1080.jpeg) shows spread, cupped fingers following the sphere. The candidate therefore seeks a wrap with visible gaps, not a closed fist or floppy wrist.
- [FIFA low-dive exercise 4](https://www.fifatrainingcentre.com/en/environment/fifa-goalkeeper-training/goalkeeping-fundamentals/learning-to-dive-low.php#exercise_4) describes the lower hand behind the ball and upper hand covering it. This supports retaining asymmetric arms during ground protection rather than imposing a universal mirrored hold.
- [Carlisle United academy coaching](https://www.carlisleunited.co.uk/news/2014/june/academy-keeper-training-part-two) includes pendulum-leg recovery without hand support after secured catches. A planted palm is not compulsory during a two-handed hold; leg positioning and body transfer must carry that transition.
- The [floor-to-stand study](https://pubmed.ncbi.nlm.nih.gov/26130427/) separates positioning, support, elevation and stabilisation. It is general movement evidence, not a goalkeeper-specific prescription. Offsetting those authored phases is an interpretation, not new motion capture.

The reference review inspected coaching text and still images. Embedded video playback failed, so no source frame timing or measured joint angles are claimed. External reference media is not redistributed as a game asset.

## Integrated changes

The four fingers now cup the ball through a deterministic 396–704 ms post-capture phase. The deformation changes 1,253 existing distal glove vertices and their normals; the palm, thumb and cuff vertices remain exact. Swept enclosing spheres conservatively cover every affected triangle throughout its linear morph, and a separate vertex halfspace bound protects the turf. Runtime work uses analytic bounds rather than per-frame triangle searches. Source playback and non-grip poses restore the original geometry exactly. See [the grip design and rejected candidates](../docs/KEEPER_GRIP.md).

Late palm pitch rotates each wrist and rigid palm together around the solved ball, retaining the exact ball centre in the palm's local frame. Its maximum angle is 0.61 rad, further reduced by reach and floor margins; the elbow follows its existing two-bone branch. A bounded share of palm twist is carried by the existing forearm bone. Capture onset stays exact. The hand/forearm display transform also now composes in character-local coordinates, preventing a nonuniform display parent from contaminating the physical palm frame.

Recovery advances the pelvis toward the planted boots before the main rise, adds a small chest fold/head counter-motion, and releases the free arm before the supporting arm. Final free-hand targets follow the moving pelvis instead of staying at landing depth. Each boot unrolls only after its own plant; its ankle lowers by 9.5 mm late in that unroll. This keeps the actual sole near the turf instead of trading edge contact for a hovering flat boot. The fallback model consumes the same sole phase with its own existing sole calibration.

The former unloading palm correction used a target that itself only just touched the floor. Its interpolation could dip below the floor and force an almost complete correction until it abruptly switched off. The corrected target is lifted during unloading, while the established planted brace pitch remains unchanged.

## Final combined geometry and regression

- The finger audit covers all 205 pinned catches, 30,750 sampled poses, phase boundaries, reverse evaluation and 82 self-intersection samples. All catches reach full closure. Source/reset changes and new finger crossings are zero; minimum affected-triangle area ratio is 0.505. Its rigid-hand triangle/sphere minimum is approximately −0.000692 mm, a sub-micron contact rounding residual; minimum glove height in this cohort is 36.76 mm. Mixed-weight cuffs and the rest of the body are covered separately by the whole-skin union.
- The recovery sweep covers 36 mirrored ability/height/stretch cases. Maximum 240 Hz hand rotation step is 0.11757 rad, below the existing 0.16 rad limit. The refined release window reaches 0.011514 rad per 0.5 ms. The retained post-parry regression has a 52.627 mm wrist centre, an explicitly tagged brace, and actual glove minimum 5.004 mm.
- The separate free-save sweep passes 27 full paths, 3,267 skin samples and 12,987 joint samples. These support tests inspect real skin rather than interpreting a wrist or ankle centre as a sole/palm surface.
- Runtime GLBs, topology, textures, materials and bone counts remain unchanged. Regenerated contact data differs only in its skin-poser provenance hash; hulls, binds and weighted patches remain exactly equal to the published baseline.
- All 645 fixed shots and 205 catches pass the uniform 12-stage body/hold/trajectory gate: 36,490 body poses, 137,965 joint samples, 34,645 whole-skin sphere/floor samples and 7,500 near-body trajectory poses. Every receipt hash matches the final runtime, assets, loader and audit tools. The manifest is unchanged, with no omitted or repinned recipes.
- Protected forearm/torso, calf/torso and opposite lower-leg crossing counts are zero in those samples. Minimum skin height is −1.924 mm; held sphere and displayed trajectory minima are −3.718 mm and −2.459 mm respectively, within unchanged existing tolerances. These figures do not imply globally intersection-free geometry.
- The largest local upper-arm/support-to-torso cloth SAT measure is 10.971 mm, versus 10.631 mm in the same baseline pair, an increase of 0.340 mm. The largest inner-elbow measure is 5.597 mm. SAT measures separation of finite triangle pairs, not whole-body penetration depth; adjacent seams are evaluated separately from protected crossings.
- The full suite passes 379/379 with zero skips, and the independent root run also passes 379/379. Both builds succeed. The existing large-chunk warning remains; shared rendering output is 1,274.53 kB raw / 352.00 kB gzip, approximately +2.74 kB gzip versus the published baseline.

The former test requiring every recovered ankle to remain exactly at 75 mm was replaced with an actual deformed-boot support check at every sampled rise frame. The post-parry wrist-centre test now uses the same existing tagged-brace-only 30 mm rule as other keeper tests; all other joint-centre bounds remain 65 mm. Neither change relaxes skin floor, sphere, nonadjacent crossing or continuity limits. Frozen world-space secure-pose expectations now retain exact source capture and hand-local sphere calibration, because the requested wrist/body choreography intentionally changes later world-space poses.

## Measured cost and limits

Five warm alternating before/after pairs used the published baseline on the same cloud CPU, after all test and render processes exited. Raw values and source hashes are retained in [physics](grip-recovery/cpu-physics.json), [gather](grip-recovery/cpu-gather.json) and [visual/pose](grip-recovery/cpu-visual.json) receipts.

| Measured stage | Samples per batch | Before median | After median |
| --- | ---: | ---: | ---: |
| Complete physics through result | 645 shots | 5,458.65 ms | 5,372.80 ms |
| Gather, all phases | 34,645 poses | 65.43 µs/pose | 67.57 µs/pose |
| Gather, capture transition | 5,330 poses | 276.32 µs/pose | 303.84 µs/pose |
| Gather, secured phase | 29,110 poses | 21.32 µs/pose | 22.57 µs/pose |
| Loaded character update, held | 3,075 poses | 22.53 µs/pose | 42.09 µs/pose |
| Loaded character update, free | 1,089 poses | 28.57 µs/pose | 27.11 µs/pose |
| Free pose construction | 1,089 poses | 5.01 µs/pose | 4.49 µs/pose |

Held visual work increases **86.8%**, or **19.57 µs per sampled pose** on this CPU. Gathering increases 3.26% overall; the transition subset increases 9.96%. This is a measured cost, not cost-free softening. Physics and free-pose ranges overlap, so their smaller median changes are not claimed as speedups. Near-keeper physics P99 is 1.153 → 1.161 ms. All physics outcomes remain equal: 152,036 steps, 205 catches, 417 touches, 240 goals, 12 rebound goals and zero unfinished shots.

Different sample populations and separate stage medians must not be added into an FPS estimate. The visual benchmark uses identical precomputed final pose inputs for both versions. Pose generation is measured separately with eight equal warmup batches per revision; an earlier insufficiently warmed generation probe was superseded, with its raw output retained outside the repository.

Changing finger poses can update at most **50,376 bytes** of position/normal ranges per rendered pose. Steady closure skips those uploads. This is a structural upload bound, not measured GPU transfer time. The isolated one-time guard preparation took about 44 ms on the cloud CPU and is performed during asset loading. The numerical finger data also consumes memory; estimates are recorded in the grip design. No draw calls, lights, textures, materials, triangles or bones are added. Actual phone GPU cost, frame pacing, thermal behavior and battery impact remain untested.

## Visual conclusion and remaining limitations

Four matched recovery exports and enlarged hand/boot comparisons use the same camera within each pair. Ordered-frame inspection shows the free arm returning in front of the torso, the palms/fingers forming a cup, and each supporting boot unrolling before the rise finishes. The exact adjacent-cloth maximum was reviewed in front, rear and oblique views: the same sleeve fold remains, with 0.36–0.91 mm local sleeve-vertex movement and no new visible body break. See [media recipes and hashes](grip-recovery-media.json) and [the exact seam comparison](grip-recovery/adjacent-cloth-review.json).

Thumbs remain rigid; cuff notches, angular elbows and local cloth folds remain visible. The fingers use an authored surface bend, and recovery uses reference-informed phase curves, not newly captured goalkeeper or finger motion. Geometric support near the turf does not prove load-bearing force balance. These are simplified offline material views, not a browser or phone playtest.

## Validation interruptions

Early overlapping QA processes were forcibly terminated (`SIGKILL`; Blender exit 137). Memory/resource pressure is plausible, but kernel OOM is not confirmed: cgroup memory-event counters were unavailable and kernel-log reading was denied. The 4.9 GiB RAM-backed `/tmp` was also near capacity. Completed evidence was archived to the cloud workspace with original paths preserved as symlinks, and the full union was restarted serially. The restarted union and subsequent complete test runs pass. Incomplete runs are retained and do not count as passing evidence; no game/browser crash was observed in these offline checks.

## Reproduce

    node --test --test-concurrency=4 tests/*.test.js
    npm run build
    node tools/qa/run-union-gates.mjs --fixtures validation/ten-rounds/union-fixtures.json --out ./validation/artifacts/grip-union --jobs 4 --concurrency 1
    node tools/qa/summarize-union-results.mjs ./validation/artifacts/grip-union ./validation/artifacts/grip-union-summary.json validation/ten-rounds/union-fixtures.json
    ARTIFACT_DIR=./validation/artifacts/grip-fingers node tools/qa/audit-finger-grip.mjs --check
    node tools/qa/audit-recovery-transfer.mjs --out ./validation/artifacts/grip-recovery.json --check
    node tools/qa/audit-free-support-sweep.mjs ./validation/artifacts/grip-free-support

Use a writable disk-backed output directory. For paired CPU checks, create a clean checkout at `f2db0191fa438ff111593831cd4613f696ed2a96`, provide its installed dependencies, and run the three benchmark tools with the baseline/fixture options recorded in their receipts. Keep other heavy jobs stopped during measurements.

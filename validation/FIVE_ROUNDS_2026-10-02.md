# Five sequential validation rounds — 2026-10-02

Baseline: published `aeb5e884555f277435443155407ed962d6065901`, tree `8cd4b62b81cd455d21722d2601f0283befd1ebda`. Prior worktrees/history are preserved. All work uses the cloud computer.

These are sequential decision gates, not five repetitions of one suite. Repairs reopen affected checks. The fixed acceptance manifest contains every evaluated shot, including misses and newly caught rebounds. Its cohort labels remain intact; parallel shards only divide execution within a round.

| Round | Scope | Status (UTC) |
| --- | --- | --- |
| 1 | Movement and exact event boundaries | Passed 09:15:40 |
| 2 | Canonical actual-skin crossings and floor | Passed 09:17:30 |
| 3 | New seeds, rebound repairs, and uniform combined acceptance | Passed 11:23:46 |
| 4 | Mobile gestures and interrupted match lifecycle | Passed 11:33:35 |
| 5 | Final resource/CPU budgets and whole-revision regression | Passed with disclosed CPU cost 11:51:35 |

## 1. Movement boundaries

Revision: published baseline, plus four new tests in `tests/motion-boundary-round.test.js`. All 34 existing focused tests and four new tests pass. Both actual captured source clips retain their fingerprints.

- 72 style/aim/shot-type contact combinations, 648 skin samples: zero complete-skin seam/repeat error; maximum boot contact error 0.0513 mm
- 90 keeper launch/landing/brace/get-up boundaries, 360 skin samples: maximum epsilon-step 0.00916 mm, zero repeat error, limb-length error below 1e-15 m
- Nine mirrored preparation boundaries: 72 pose / 54 skin samples, exact mirrored joint symmetry
- Four actual captured contacts and 60 finish-speed measurements retain their source skin paths and final pose; maximum residual finish speed 1.219 mm/s

A small existing preparation derivative seam at normalized phase .08/.90 measures 0.005262 m/phase: approximately 0.0034 m/s for a 1.55 s run-up, or 0.057 mm per 60 Hz frame. There is no position jump. This bounded authored onset/release is recorded rather than replaced with speculative smoothing; support-swap checks remain stricter.

Evidence: `/tmp/penalty-five-rounds/round-1/round-1-report.json`, TAP and source fingerprints. No runtime or asset repair was needed in this round.

## 2. Canonical body and floor

Revision: same published runtime/assets. Both canonical actual-skin cohorts reran from scratch:

- 40 held paths / 1,400 skin poses: zero protected forearm–torso, calf–torso and opposite lower-leg crossings
- 51 central catch/miss paths / 2,295 skin poses: the same protected categories pass; three lateral-recovery paths were explicitly excluded by that older central-only audit
- 28 complete 60 Hz ground sweeps, 7,228 samples: minimum skin height −1.924013 mm, within the unchanged −5 mm gate

Local adjacent cloth/joint contacts remain. The held sleeve/armpit finite-triangle SAT maximum is 6.217 mm and inner elbow 1.461 mm in this sampling. These are not whole-body penetration depths or a zero-intersection claim.

Evidence: `/tmp/penalty-five-rounds/round-2`. No runtime repair was needed. Round 3 subsequently removes the central/lateral exclusion from acceptance.

## 3. Fresh shots, repairs, and combined revalidation

Started 09:18:12. Final accepted physics source: `engine.js` SHA-256 `ab4ac54571278ec294ca494c909a4f40ab1ab1a0f3ab23c5a38e647c9792a4d0`. Final grasp source: `keeper-contact.js` SHA-256 `eb688db73553a3c4d9d15b117aaf7824a3667ae631a58fa9be9826675497c55c`.

### Findings and repairs

The fresh 216-shot grid uses seeds 101/907, mirrored aims, three ball heights/powers and keeper abilities 65/85/99. The released baseline produced 60 catches; 24 failed the expanded held-ball/body or elbow checks. Worst sphere/skin gap was −72.626 mm and elbow displacement 95.889 mm at 240 Hz. Twelve captures already overlapped the thigh at their physical source; a zero visual capture jump did not make those source contacts valid.

The repaired engine separates physical collision from each glove's handling cooldown. A parry no longer disables all keeper surfaces for 90 ms. Initial-overlap correction rechecks remaining flight with a four-resolution cap, preserving tangential movement instead of sticking the ball to a moving shin. The broad phase includes leg extremities. Floor separation respects finite collision surfaces; a corrected catch must still belong to the contacted glove and clear the other surfaces. Goal classification uses the actual remaining segment, and ground response is not charged repeatedly for zero-time corrections.

An affected movement test also exposed a committed footstep whose clock advanced while contact cooldown skipped its updates. Resuming produced a 306 mm foot jump and 151 mm knee jump. The started step now finishes while new tracking decisions remain suspended. The existing 1 ms continuity bound stays unchanged.

For the newly reachable lower-side catch, carrying the ball along the free arm's ground-bracing path forced a forearm through the shirt. The coupled grasp now follows the upper-body frame only for an elevated lower grasp; low horizontal reaches retain their original route. The exact physical capture and secured hold remain fixed. Early ball/floor protection acts only where required, followed by the existing simultaneous ball/floor/torso constraints. No mesh query is added to gathering, and secured holds retain their existing fast path.

A rejected intermediate route generated a finite approximately 299 mm elbow jump in three wide catches. Those exact recipes and the critical .238–.241 s interval are retained through 96 kHz refinement in `tests/keeper-side-grasp.test.js`. After the source-elevation guard, refined displacement shrinks to 0.02884 mm. This was an intermediate regression prevented before publication, not a claim that the released game had that particular animation.

The old long-parry seed 4 now legitimately reaches the other glove. It remains as a catch regression; unchanged long-clearance assertions use verified parry seed 23. Seeds 6/20 additionally exercise the earlier palm-brace interval against actual skin. Only two result-recovery golden trajectories are re-pinned: the committed stride changes pose fields, while ball, velocity, clocks, outcome and finish time remain exact. All semantic recovery assertions remain.

### One fixed acceptance manifest

`five-rounds/union-fixtures.json` has 525 unique shots, retaining all 535 original cohort memberships:

| Cohort | Shots | Actual catches |
| --- | ---: | ---: |
| Canonical | 139 | 40 |
| Central intents, including lateral reactions | 54 | 20 |
| Fresh seeds | 216 | 64 |
| Low-catch neighborhood | 72 | 65 |
| Wide-catch neighborhood | 54 | 3 |

Duplicate recipes are tested once and retain every origin label. There are 184 unique catches. Every catch receives identical gates regardless of its requested or actual dive direction. Catch outcomes are pinned individually, so a lost capture cannot be hidden by a different new capture.

The accepted run started 11:18:26 and finished 11:22:59. All 12 shard/gate executions passed, on one frozen runtime:

- 32,752 actual-skin body poses: zero protected crossings
- 123,832 joint samples at 240 Hz; maximum elbow step 36.585 mm, below the unchanged 40 mm gate
- 31,096 whole-skin sphere/floor samples at 60 Hz; minimum sphere gap −3.718 mm and minimum skin height −1.924 mm, inside the existing 5 mm tolerances
- 5,688 near-body displayed trajectory poses at 120 Hz across all 525 shots; worst gap −0.937 mm
- Ball, hand and elbow worst-interval timestep refinement passes at 96 kHz; exact capture continuity remains checked
- At most three physical resolutions observed per step, below the hard cap of four
- All 113 affected regression tests pass after the final repairs

Body sampling is 10 Hz through 2.8 s plus 120 Hz over 0–.9 s and .95–1.4 s. This is sampled evidence, not a continuous collision proof. The body gate names specific protected regions; it is not an assertion that every triangle pair is disjoint.

A fast wrong-footed ball transfer reaches 45.579 mm per 240 Hz step but shrinks to 0.114001 mm at 96 kHz, converging to 10.9441 m/s. It is continuous, not a finite branch jump. Ball speed is reported; an unjustified blanket 40 mm ball cap is not used. Elbow displacement retains its existing bound, and ball/hand/elbow refinement is gated separately.

### Visual and approximation limits

Matched CPU-skinned Blender views confirm the corrected forearm lies outside the shirt and the original ball/knee/forearm collisions are cleared. Quarter-speed inspection of the repaired wide transition uses newly evaluated 240 Hz poses, played at 60 fps, rather than duplicating sparse frames. The user's shared [animation-workflow article](https://x.com/xingbugengming/status/2105627385387171991) informed this review technique; it supplied no new runtime asset or mobile performance evidence.

The maximum adjacent sleeve-root SAT measure is 10.631 mm. Its magnified view shows a local pinch/open seam, while the full-body silhouette stays continuous. Dense sampling also finds an inherited 6.266 mm inner-elbow crease; matched source poses prove it was not introduced by the latest correction. Both are documented separately from protected forearm/torso penetration. Fingers remain rigid and some catches remain stylized and quick.

Four conservative shin-hull first impacts have positive visible-skin gaps of 7.9–10.04 mm. The worst projects to 0.12–0.61 CSS pixels in the sampled game cameras and reads as a near-shin block. These limb hulls were never exact glove/torso triangle surfaces; their positive gaps are reported separately. All-part penetration and exact-surface contact checks retain their tolerances.

Evidence: `/tmp/penalty-five-rounds/union-release`, `/tmp/penalty-five-rounds/union-release-affected-tests.log`, and `/tmp/penalty-five-rounds/round-3/visual`. Independent review verified all 525 IDs, all 184 body/hold capture IDs, all source/QA hashes, unchanged manifest shards and the critical refinement regression. These are offline geometry/event tests, not WebGL screenshots or real-phone GPU measurements.

Reproduce the uniform gate:

```sh
node tools/qa/run-union-gates.mjs --fixtures validation/five-rounds/union-fixtures.json --out /tmp/penalty-union --jobs 4
```

## 4. Mobile and interrupted lifecycle

Passed 11:33:35: 62/62 focused tests, including 29 new lifecycle tests. The tests run the actual main callbacks, Match, Shot and Stadium with controlled DOM, storage, RAF and renderer stubs. Loaded striker bone matrices remain fixed during a held drag and move after exactly one active release.

Two narrow repairs follow reproduced failures. Visibility changes rebase the frame clock, so returning from 600 seconds hidden cannot consume a Ready turn before its first frame. Cancellation and lost-capture events must match the active pointer ID and element, so unrelated or retired events cannot cancel a new drag. The initially suspected active-match Close-before-RAF path was already safe and receives regression coverage without a redundant repair.

Checks include 30/60/120 Hz and irregular frame intervals; advanced held-input timeout; simple/advanced attack and defense; repeated Next/Home/rematch; blur/pagehide; pause/save/restore of rebound state; independent restored handling maps; and deterministic replay through an opposite-hand catch. This proves the controlled event and simulation behavior, not physical touchscreen or browser rendering behavior.

The final main source SHA-256 is `a08b68e83675eccb4c4f90af0f0ea4769ad6900562dd572e9777cfe8f464d82a`. Evidence is preserved in `five-rounds/round-4-summary.json` and `/tmp/penalty-five-rounds/round-4`; the shared VM harness is `tests/helpers/main-harness.js`.

## 5. Final resources, CPU and aggregate regression

The whole final revision passes **332/332 tests with zero failures or skips**, followed by a successful Vite build. An independent root run repeats both results. After the lifecycle repairs, the entire fixed 525-shot/184-catch union reran again with all 12 shard gates passing; `five-rounds/union-summary.json` verifies detailed receipts, every fixture/capture ID and final source/asset/QA hashes. The sampled geometry counts and limits in Round 3 remain unchanged.

### Resource and operation budgets

No model, texture, light, render pass or sampling resolution changed. Both GLBs remain below 18,000 triangles and 450,000 bytes, with the same bone/weight/material counts. Static pre-culling candidates remain 38 main and 22 shadow draws, with 63,566 main and 36,746 shadow mesh triangles. Generated CanvasTexture logical storage stays 5,963,772 bytes. These are structural counts, not actual GPU submissions or measured GPU memory.

The game chunk is 53.91 KB raw / 20.79 KB gzip; shared rendering is 1,267.02 KB / 349.01 KB gzip. Compared with the published baseline, their combined gzip size increases approximately 0.97 KB. The existing large-chunk warning remains.

The initial-overlap loop has a hard cap of four physical resolutions per step; the full union observes at most three. Independent tracing finds no reflection increases speed and no cap saturation. Fresh 216-shot surface-query calls increase from 4,000 to 4,894 (+22.35%), while total fixed steps decrease from 44,798 to 44,127. Correctly continuing collisions costs CPU even without additional rendering work.

### Same-machine CPU comparison

Benchmarks compare published `aeb5e884` with the frozen final sources, after warmup, in five alternating before/after rounds. Full source hashes, every round's timing, sample counts and outcomes are retained in `five-rounds/cpu-*.json`. Tests, union jobs and rendering had exited before measurements. Other cloud scheduling variation remains possible.

Complete-shot physics includes construction and simulation at 120 Hz; changed shot lifetimes and outcomes are intentionally included:

| Cohort | Median baseline → final batch | Change | Near-keeper P99 baseline → final |
| --- | --- | --- | --- |
| Canonical 135 shots | 711.931 → 830.709 ms | +16.7% | 0.907 → 1.124 ms |
| Uniform 525 shots | 3,021.168 → 3,710.002 ms | +22.8% | 0.895 → 1.065 ms |

Canonical catches/touches remain 36/58, but goals change 80→78 and rebound goals 3→1. In the union, catches change 182→184, touches remain 329, goals change 214→203 and rebound goals 18→7. The old all-surface cooldown allowed rebound flight through keeper surfaces; correcting physical contact legitimately changes later deflections, catches and goal outcomes. These counts are reported rather than forced to historical balance. All shots terminate.

Gather kernels are also timed separately using identical precomputed current-revision pose inputs. This excludes physics, pose generation, skinning and rendering. Canonical 40-catch / 6,760-pose outputs are all exactly equal between kernels. Their overall median is 399.489→393.597 ms; transition-only 1,040 poses are 279.523→285.192 ms; secured 5,680 poses are 124.077→127.174 ms. Overlapping run ranges and phase variance do not establish a general speedup. The secured fast path is retained; no extra early constraint solve runs there.

The uniform 184-catch gather comparison covers 31,096 poses: 31,040 are exactly equal, while 56 change intentionally in repaired transition routes (maximum scalar difference 233.683 mm). Median overall batch is 1,940.407→1,910.202 ms; 4,784 transition samples are 1,308.310→1,300.218 ms and 26,128 secured samples 541.051→538.240 ms. This is kernel timing on identical inputs, not a comparison of the two engines’ differing capture outcomes.

The corrected physical solver therefore retains a measured CPU cost. No phone FPS, GPU, thermal or battery guarantee is made. The current acceptance is bounded work, unchanged graphics budgets, sampled geometric correctness and passing event/regression tests, with the CPU tradeoff explicitly retained. No speculative late optimization changes the accepted collision paths.

Reproduce the timing scopes:

```sh
node tools/qa/benchmark-rebound-physics.mjs --baseline aeb5e884 --out /tmp/physics-canonical --rounds 5
node tools/qa/benchmark-rebound-physics.mjs --baseline aeb5e884 --fixtures validation/five-rounds/union-fixtures.json --out /tmp/physics-union --rounds 5
node tools/qa/benchmark-keeper-gather.mjs --baseline aeb5e884 --out /tmp/gather-canonical --rounds 5
node tools/qa/benchmark-keeper-gather.mjs --baseline aeb5e884 --fixtures validation/five-rounds/union-fixtures.json --out /tmp/gather-union --rounds 5
```

Final whole-suite logs: `/tmp/penalty-five-rounds/round-5/full-tests.log`, `build.log`; independent logs: `/tmp/penalty-five-root-tests.log`, `/tmp/penalty-five-root-build.log`. These temporary full logs and videos are review evidence on the cloud; compact receipts and the fixed fixture manifest are committed.

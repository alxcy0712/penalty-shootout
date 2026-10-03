# Elbow and cuff candidate review, 2026-10-03

Both isolated elbow candidates are rejected. Production GLBs, editable source blends and runtime code were not replaced by this experiment. The modest geometry-only rounding changed five discrete physics result/contact-part records after contact regeneration. The separate weight-only experiment visibly flattened the early-save elbow. Matching source weights at the wrist seam would be a no-op.

The frozen reference is published `42f54ba3a48647cd0a529e612b0c6f3fb3d0e6c1`. The exact keeper GLB is `1865eb66beef6fe492c301779ed4da3fd7b4c771a43756a7bbdcd4bbb0e6b772`, 449,480 bytes, 17,954 triangles. Full source/media hashes and compact numerical receipts are in [the machine-readable record](model-motion-ten/elbow-candidates.json). Full candidate files and evidence remain in the cloud workspace at the record's `evidenceRoot`.

## Same-camera evidence and decisions

Actual CPU-skinned geometry, including the production finger deformation, was exported from the frozen runtime. The two views are a high-save pose at 0.15 seconds and an actual high-catch hold at +1.0 second. Both before/after pairs use the exact saved camera, 768×768 output, 12 CPU samples and the same simplified materials. They are offline Blender images, not WebGL or device screenshots.

- Baseline: `baseline-dive-015/frames/frame-0000.png` and `baseline-gather-1/frames/frame-0000.png`
- Geometry only: `elbow-v1/dive-015/frames/frame-0000.png` and `elbow-v1/gather-1/frames/frame-0000.png`
- Weight only: `elbow-weights-v1/dive-015/frames/frame-0000.png` and `elbow-weights-v1/gather-1/frames/frame-0000.png`

The geometry candidate slightly rounds the held outer elbow; early-save improvement is small. The pointed bent shape and V-shaped cuff contour remain. The weight candidate produces an undesirable flat outer edge in the early-save view, with little useful improvement at the held elbow. Neither result justifies changing the calibrated production model in this round.

## Isolated geometry experiment

`sculpt_elbow_fairing.py` uses a welded diagnostic surface and eight bounded Smooth iterations at factor 0.55. Its mask covers only the exposed elbow cap and fades over native forearm-local y = −85 to +100 mm. It maps positions and affected normals back to the original primitive order. All glove/boot material vertices, hand/foot/toe-influenced points above 0.1 weight, material seams and all non-Skin positions are protected.

297 welded vertices become 303 changed production Skin vertices. Maximum decoded displacement is 3.50685 mm, including at most 0.00763 mm encoding error. The candidate remains 449,476 bytes and 17,954 triangles. No GLB weights, indices, binds, animation data, material definitions or texture streams change.

Candidate SHA-256: `086861baaf6996c84012f249c8b4cb84250bfe5a869d3efe9d46bb7c5f377d70`.

Contact data was regenerated only inside the isolated `elbow-v1-runtime` snapshot. A separate regeneration from the untouched baseline is byte-identical to its published cache, so the differential is not explained by stale baseline data. Palm hulls and exact surfaces, binds, all non-forearm hulls and the torso patch stay equal. Forearm hull vertices change 63→65 on the left and 62→63 on the right. The deforming patch retains 2,514 vertices and identical indices; 285 positions change by at most 3.46657 mm. Its generated weights also change: the existing runtime weight-smoothing mask depends on bind positions, so unchanged GLB weights do not imply an unchanged runtime field. Matching held/early-save poses show nearby Kit movement up to 0.04243 mm from that field change.

All 645 fixed recipes remain included. Catches stay 205, touches 417, and unfinished shots zero. Goals change 240→239 and rebound goals 12→11. Total simulation steps change 152,036→152,745. There are 44 changed terminal records; five contain a discrete result or final contact-part difference:

- `4b8aed703151fefc`: rebound goal becomes a save out of bounds
- `8c5e2b448914ecec` and `43a9ce3c5d8b7164`: saved-ball termination reason changes to a stopped ball
- `5ed0a93fbe707394` and `cbabeb33af8ebce8`: final recorded contact changes from skin to left boot

These fixtures were not repinned or omitted. The candidate is rejected before the expensive final union gate.

## Separate weight experiment

`fair_elbow_weights.py` redistributes at most 0.15 between already-positive upper-arm and forearm influences at 286 existing Skin vertices. It approaches a bounded axial transition over 120 mm. No positions, normals, joint indices, protected points or other influences are changed. It is generated directly from the baseline, not from the geometry candidate.

The candidate is 449,520 bytes and 17,954 triangles, SHA-256 `7722e253d3c4cebe49141d75d373624c09a085b91e8eddced6dc80df6a0a924a`. The existing runtime smoothing propagates the input change into neighboring Kit vertices, reaching 7.427 mm in the early-save pose. The same-camera flattening is the rejection reason. Its contact cache was not regenerated and no coupled-physics pass is claimed.

## Protected surfaces and live grip

`audit-model-candidate-integrity.mjs` verifies unchanged topology, all noneditable decoded buffers, hierarchy, rig, animations, materials, textures, and exact protected source positions, normals, joint indices and weights. Both candidates retain 24 runtime bones and the four-influence source layout.

It also evaluates twelve actual-catch poses on two fixed fixtures: capture, +0.396, +0.55, +0.704, +1.0 and +2.8 seconds. The actual finger component is active; both hands reach amount 1 at +1.0 seconds. All protected live skin vertices, including the complete glove material and boots, are exactly equal to the baseline in these samples: maximum difference 0 mm. These checks preserve the existing live grip; they do not substitute for a whole-body sphere/floor/intersection union.

## Cuff seam hypothesis

`audit_cuff_seams.py` compares source weight fields at coincident Skin/Socks points welded at 1 micrometre. It finds 42 wrist seam points and zero mismatches, with maximum weight difference exactly zero. The runtime already smooths a welded cross-material field. Therefore a coincident seam-weight equality repair would change nothing. The visible V-shaped cuff contour remains an explicit limitation, and no unsupported root-cause claim or no-op geometry change is shipped.

## Reproduction

Use Blender 4.3.2, the repository's Three dependency, and official `meshoptimizer@0.24.0` in a separate tooling directory. Use a disk-backed evidence directory and serialize renders. Set `MODEL_ENCODER` to that package's `index.module.js`. The two packers refuse input assets other than the exact published hashes, preventing accidental repeated fairing.

1. Archive commit `42f54ba3a48647cd0a529e612b0c6f3fb3d0e6c1` into a separate frozen runtime; provide its dependencies without editing its source.
2. Run `pack_surface_fairing.mjs --source BASE/keeper-prototype.glb --out DUMP` to decode the source mesh/rig.
3. Geometry candidate: run Blender with `sculpt_elbow_fairing.py --input DUMP/keeper-prototype-mesh.json --rig DUMP/keeper-prototype-rig.json --output GEOMETRY/keeper-prototype-edits.json`; pack using `pack_surface_fairing.mjs --source BASE/keeper-prototype.glb --out GEOMETRY --edits GEOMETRY/keeper-prototype-edits.json`.
4. Weight candidate: run Python with `fair_elbow_weights.py` and the same input/rig/output argument structure, then `pack_elbow_weight_candidate.mjs` with the corresponding edit JSON. Do not use the geometry candidate as input.
5. Run `audit-model-candidate-integrity.mjs FROZEN_ROOT BASE_GLB CANDIDATE_GLB OUTPUT_JSON geometry` or `weights`.
6. Copy `export-surface-fairing-poses.mjs` into the frozen runtime's `tools/qa` directory. Export each source with `--asset ABSOLUTE_GLB --motion dive --direction 1 --height 2.1 --time .15`, or `--motion gather --direction 1 --height 2.1 --time 1`. Render with `render-refined-poses.py`, `--views 1 --width 768 --height 768 --samples 12` and the corresponding saved camera JSON.
7. For the geometry candidate, copy the frozen runtime to another isolated directory, replace only its keeper GLB and run its `tools/generate-keeper-contact.mjs`. Then run `compare-model-contact-outcomes.mjs BASE_RUNTIME CANDIDATE_RUNTIME OUTPUT_DIR`. The generator has a hardcoded destination; never point this experiment at production.
8. Run `audit_cuff_seams.py` against the unedited source dump. The full 42-point inventory remains in `cuff-seam-weight-audit.json`.

The candidate packings, integrity/live-grip checks, fixed physics comparison and seam audit completed successfully as experiments. The shipping decision is rejection, not an assertion that the rejected candidates pass the final acceptance gates. All new scripts pass syntax checks; no production asset, source blend or runtime source was modified by this experiment.

# Football arm and jersey refinement, 2026-10-02

This pass edits the published v18 geometry from commit `2314f3c8c94b5f213d3c5fbf397a0dc529b19428`. It uses Blender 4.3.2 for real mesh edits, with the existing rig and captured actions. It is not concept artwork, a new motion capture, or runtime cloth simulation.

## Pixel findings and selected changes

Matching rest and extreme-pose renders showed three remaining issues: an overbuilt, angular mid-forearm; a hard elbow transition when folded; and the donor's pronounced scapular ridges under the jersey. The first two are addressed together, with a smaller jersey-back fairing pass. The faceted knee area is left for a separate iteration; shorts, hips and shoulder-helper parameters are unchanged.

`sculpt_production_limbs.py` operates on a welded diagnostic work surface, then maps coordinates and normals back onto the original primitive order. The two rigs keep their original topology and weights:

- Five bounded Blender Smooth iterations at factor 0.40 on the exposed forearm/elbow region; wrist and hand-influenced vertices are excluded
- Up to 10.5% radial reduction only through the overbuilt mid-forearm belly, fading smoothly before the wrist and retaining elbow width
- Ten bounded Smooth iterations at factor 0.48 on the back jersey panel, with a 4 mm displacement cap for fairing
- Original positions and authored normals outside affected neighborhoods remain untouched; updated normals are computed on the welded surface

The maximum final forearm displacement is 11.132 mm, combining fairing and the bounded radial fit. Kit displacement is 4.007 mm including compression error. This is a modest silhouette/deformation refinement, not a wholesale anatomical remodel.

## Asset budgets and protected data

| Asset | Triangles | GLB bytes | Change |
| --- | ---: | ---: | ---: |
| Keeper | 17,954 | 449,480 | +400 bytes |
| Striker | 17,924 | 446,784 | +476 bytes |

Both remain under the original 18,000 triangle / 450,000 byte limits. No topology, materials, textures, draw batches, skin influences or runtime bones are added. Both retain six materials, two original textures, 22 asset bones, 24 runtime bones and a four-weight maximum. The regenerated keeper contact cache on the frozen reference grows from 569,735 to 569,909 bytes (+174); final integration must regenerate it against its own source.

Binary differential checks preserve nodes, hierarchy, transforms, inverse binds, animation definitions and all action samples, texture bytes, original joint indices and weights. Original protected palm, hand, boot and toe vertices have **0 mm** displacement. Shorts and leg geometry are also unchanged. Position compression error is at most 0.00763 mm, normal component error at most 0.000489.

- Keeper GLB SHA-256: `1865eb66beef6fe492c301779ed4da3fd7b4c771a43756a7bbdcd4bbb0e6b772`
- Striker GLB SHA-256: `bf3ec0d6e53766c6a8fd7e7a5775087a3886eed752921a906f36497491b3157f`

## Model-only motion checks

All following comparisons use the same frozen `2314f3c` runtime, including its existing shoulder helpers and arm-clearance rules. They isolate model changes. Later motion/CPU changes need their own merged validation.

- 194 free-save poses: both directions, low/mid/high, full recovery and added landing samples. Protected forearm/torso, calf/torso, upper-arm/support/torso and opposite-foot/calf crossings remain zero. Local inner-elbow pairs fall 141 → 38; the maximum finite-triangle separation measure falls 2.851 → 1.098 mm
- Both captured CMU clips, 71 poses: zero forearm/torso, calf/torso and opposite-lower-leg crossings. Existing knee-fold count stays 60; opposite-thigh count stays 602 and same-thigh count stays 213
- Additional 100 Hz arm-risk windows: 121 poses over long-kick game time 1.50–2.70 s and 61 over compact-kick time 1.20–1.80 s. Forearm/torso and protected lower-leg categories remain zero
- All 40 real catches, 1,400 held-body poses: zero protected body crossings; full-skin floor minimum remains −1.924 mm. Adjacent inner-elbow pairs fall 307 → 68, with the maximum 3.165 → 1.461 mm
- The existing adjacent shoulder folds remain. Their pair count changes 8,150 → 8,152; the worst measure is effectively unchanged at 6.217 mm. This is not described as a global zero-intersection model
- Canonical 40-catch hold gate passes through 2.8 seconds, with 240 Hz pose continuity and 60 Hz full-skin ball/floor checks. Worst skin/ball gap is approximately −0.000457 mm; no attachment or floor gate is relaxed
- Recomputed contact cache: 135 fixed-seed shots produce 58 contacts, 36 catches and no unfinished shots. First-contact skin gap is −0.0060 to +0.1115 mm

Pair counts are triangle-pair counts, not penetration volumes. The finite-triangle SAT quantity is not a whole-body penetration depth. These are sampled geometric checks, not continuous-time collision or physical balance proofs. The unchanged known knee, thigh and adjacent shoulder folds remain explicit limitations.

## Editable Blender source proof

The delivered `.blend` files are rebuilt from the final decoded production GLBs, retaining their 22-bone rigs and both embedded actions. The separate CMU 10_03 animation-only GLB remains unchanged. Runtime helpers and procedural goalkeeper motion are not baked into these source files.

The editable files use lossless gzip serialization, retaining the `.blend` extension. Each was reopened directly in Blender 4.3.2 after compression. Mesh coordinate/weight fingerprints, bone-rest matrices, action curves, keyframe inventories and triangle counts match the uncompressed file exactly. The saved Blender scene includes the existing 80-triangle Icosphere bone-display helper in the `glTF_not_exported` collection; it is not part of the skinned character or runtime GLB budget.

| Source | Compressed bytes | Exact uncompressed SHA-256 |
| --- | ---: | --- |
| Keeper | 1,076,959 | `65b3c9c0e85f78b6cba27744f41608e3f0988f6b0aac1ec8b14e8f34ea6d643b` |
| Striker | 1,387,325 | `9dc59fdcfb8897709d14e8c19d55d787dab802c54c814c1f04ba0c9f05aa2d08` |

`verify_production_model.py` records reproducible structural/data fingerprints. Gzip encoding is deterministic for the same saved Blender bytes; saving Blender again may change internal metadata and is not promised to reproduce the same entire-file hash.

## Reproduction

Do not apply the pass to its own output. The packer accepts only the two exact v18 source hashes. All work stays in a candidate directory until validation and integration are complete.

```sh
mkdir -p /tmp/production-base /tmp/production-result
for name in keeper-prototype striker-mocap; do
  git show 2314f3c:assets/characters/$name.glb > /tmp/production-base/$name.glb
done
npm install --prefix /tmp/production-tools meshoptimizer@0.24.0 --ignore-scripts
export MODEL_ENCODER=/tmp/production-tools/node_modules/meshoptimizer/index.module.js
for name in keeper-prototype striker-mocap; do
  node tools/blender/pack_production_model_edit.mjs \
    --source /tmp/production-base/$name.glb --out /tmp/production-base
  blender -b -t 4 --python tools/blender/sculpt_production_limbs.py -- \
    --input /tmp/production-base/$name-mesh.json \
    --rig /tmp/production-base/$name-rig.json \
    --output /tmp/production-result/$name-edits.json
  node tools/blender/pack_production_model_edit.mjs \
    --source /tmp/production-base/$name.glb --out /tmp/production-result \
    --edits /tmp/production-result/$name-edits.json
  node tools/qa/audit-model-refinement.mjs \
    /tmp/production-base/$name.glb /tmp/production-result/$name.glb
  blender -b --python tools/blender/save_editable_model.py -- \
    --input /tmp/production-result/$name-decoded.glb \
    --output /tmp/production-result/$name-source.blend
  gzip -n -9 -c /tmp/production-result/$name-source.blend > /tmp/production-result/$name.blend
  blender -b --python tools/blender/verify_production_model.py -- \
    --input /tmp/production-result/$name.blend \
    --output /tmp/production-result/$name-inventory.json
done
```

Same-camera, same-color Blender comparisons cover the rest silhouette, the sharply bent elbow, the full high-save recovery, and both captured kicks. The three normal-speed videos and pose sheets use actual CPU-skinned geometry on the frozen runtime. Simplified offline materials and root-following cameras do not establish WebGL quality, world-space foot planting, or sustained phone GPU performance.

Compact hashes, budgets, source inventories and numerical results are in [the validation summary](../../validation/summary-production-models-2026-10-02.json). The complete repository test/build and final merged-motion checks belong to the integration record; the model-only checks above are not substituted for them.

## Merged runtime spot checks

After the integration's central-gather and late-finish changes, the model was checked again on contact SHA `fb920605a23bad79cacbe7c1a9cd4e156268bd43ed63124d0580d818bed07c02`, game-character SHA `d8b5d443949511a77cd8d48c76367cd958c8e5592578c58054ef82ec8d0d69a5`, and regenerated contact-data SHA `5d1d5dea792345ccdc223eca146709b231b2e1a3b4f3cac6cf9a80b97684e40c`.

The 71-pose captured-skin check retains the same protected zero categories and original local thigh/knee counts. Nine additional compact-finish poses at game times 2.50, 2.55, 2.60, 2.65, 2.70, 2.75, 2.80, 2.90 and 3.00 seconds cover the newly extended finish; all six audited categories are zero there. The full 68-frame high-save export and the 0.15-second bent-elbow close-up are byte-identical to the candidate geometry already rendered. Their media is reused with an explicit equality record, rather than described as newly rendered.

Final merged normal-speed media is source-hashed in [the media manifest](../../validation/production-model-media-2026-10-02.json): long and compact kicks at 24 fps (92 / 73 frames), and both central target mirrors at 60 fps (43 frames each, through +0.7 s). The central comparisons also have quarter-speed variants and matched pose sheets. Final central cameras include the whole descent; the earlier tight upper-body versions are retained only as superseded review material and are excluded from the manifest. Pixel review shows continuous forearm contours and retained ball/glove attachment. The central gather remains brisk and stylized; it is not presented as slow naturalistic absorption.

# Distinct CMU striker capture candidate

`cmu-10_03-kick.glb` contains only the `CMU_10_03_Kick` animation and compatible named nodes. It has no mesh, skin, texture or material payload and does not replace the production character. Apply its `AnimationClip` to the existing 22-bone striker rig. Blender's original dot names are sanitized by GLTFLoader in the same way as the production rig.

## Source and event contract

- Actual different CMU capture: Subject 10, take 03, from the existing repository BVH. This is not a time warp of take 01
- Source span: 0.05–2.55 s, original speed, sampled and baked at 120 Hz. The first 50 ms conversion initialization is omitted; the later reset step is cropped after both feet land
- Clip duration: 2.5 s; chosen strike event: 1.125 s (source 1.175 s)
- Supporting foot R: planted interval 1.00–1.29 s; kicking foot L (this rig's anatomical labels are reversed from the converted BVH)
- Model-space ball: (0, 0.11, 0), radius 0.11 m. The exact boot surface is aligned with a small horizontal whole-motion translation. The source has no captured ball track; this is an explicitly calibrated event, not a claim that a ball marker was measured
- The capture starts during approach, not a standing idle loop. Preparation may freeze a posed character or use an entry crossfade; do not loop running data as idle

The legacy source inventory's take03 SHA did not match the repository file; the integrator has now corrected the current inventory. The actual unchanged file is 473955 bytes, SHA-256 `ca203656908b10de2452deede4b194cc7188b15d3f3edf76cc8a5a320dafe305`; the same bytes exist at remote-base commit `e8ce600`. No assumption is made about why the legacy inventory differs. Candidate metadata retains the historical reported hash and records the corrected current hash.

## Provenance and adaptations

CMU Graphics Lab motion capture database: https://mocap.cs.cmu.edu/

The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217.

Converted BVH: Bruce Hahne / cgspeed Daz-friendly conversion, supplied via adventuring/mocap. See `../mocap/cmu-soccer/README.md` and `../mocap/cmu-soccer/CONVERSION-README.txt`. CMU permits project use, including commercial work; standalone resale of motion data, including converted formats, is prohibited. Hand/finger joints in the conversion are not separate real finger capture.

Adaptations are explicit: fixed-length retargeting, supporting-foot lock, sole clearance, chest-referenced arm-roll frame, offline rotation-minimizing shoe-roll transport, and measured boot contact alignment. These corrective frames prevent artificial retarget singularities without replacing the captured joint directions or running cadence. The rendered model remains the CC0 Quaternius-derived production mesh, with its existing credits.

## Byte-exact rebuild without changing production assets

The checked-in clip was calibrated against the original model at `e8ce600`, SHA-256 `6f8e7edba2644c3e42976d1f9cc6b76bb3015f7856aba94755cba03b392e2a24`. The metadata field `productionAssetSha256` records that build input, not whichever production model is installed later. Pin this mesh with `--model` at **both** the sampling and finalization stages to reproduce the delivered clip.

The checked-in Blend was authored with a newer Blender than the installed 4.3. The pipeline reconstructs the original rig from its existing creation helper and extracts the selected model's bind mesh/weights through Three.js MeshoptDecoder. No source Blend or production GLB is overwritten. Run from the repository root; all generated files below stay in `/tmp`.

```sh
mkdir -p /tmp/penalty-cmu-original
git show e8ce600:assets/characters/striker-mocap.glb > /tmp/penalty-cmu-original/calibration.glb
sha256sum /tmp/penalty-cmu-original/calibration.glb
node tools/mocap/sample-cmu-variants.mjs --take 10_03 \
  --model /tmp/penalty-cmu-original/calibration.glb \
  --out /tmp/penalty-cmu-original/samples.json \
  --rig-out /tmp/penalty-cmu-original/rig.json
blender -b -t 4 --python "$PWD/tools/blender/create_mocap_variants.py" -- \
  --samples /tmp/penalty-cmu-original/samples.json \
  --rig-json /tmp/penalty-cmu-original/rig.json \
  --preview-dir /tmp/penalty-cmu-original/preview
node tools/mocap/sample-cmu-variants.mjs \
  --model /tmp/penalty-cmu-original/calibration.glb \
  --finalize /tmp/penalty-cmu-original/preview/cmu-10_03-candidate.glb \
  --meta /tmp/penalty-cmu-original/preview/cmu-10_03-candidate.json \
  --outdir /tmp/penalty-cmu-original/final
cmp /tmp/penalty-cmu-original/final/cmu-10_03-kick.glb \
  assets/characters/mocap-variants/cmu-10_03-kick.glb
sha256sum /tmp/penalty-cmu-original/final/cmu-10_03-kick.glb
node --test tests/cmu-variant.test.js
```

Expected animation-only GLB: 91,676 bytes, SHA-256 `19d2dc23fbc6df84ebb6a4e706a0701f0c16b17daa4ce3b6366dac108e8bdeeb`. `cmp` verifies the actual clip bytes; generated metadata does not reproduce subsequently added audit notes.

The full-mesh `.blend/.glb` preview is an intermediate, before the final horizontal surface calibration. Use the delivered animation-only clip on the selected mesh for actual contact QA. The finalizer rejects incompatible bind rigs. Take05 has a sampling recipe for further audition; no take05 production clip is claimed here.

### Rebuilding against a later model

Omitting `--model` selects the current production mesh at both stages. That is a new model-dependent rebake, not byte-exact reproduction. The refined v17 mesh (`e0b3eb06d09d80135827c5f5e7e58ab26778a5dc0b8c3333be48a704603bfc3d`) adds foot-weight geometry used by sole clearance; rebaking against it produced `25290e81fd225e6d6b7228b153841b75d0e64ba9607e70561720dfd97cf32c89`. Its supporting-foot drift was 0.326 mm and minimum skin Y +3.788 mm. This candidate has not replaced the delivered clip. Always use a separate `/tmp` output directory and review/regression-test a rebake before any intentional promotion. The finalizer's default output directory is also temporary (`/tmp/penalty-mocap-variants`).

## Measured quality of take03

On the original calibration mesh (`6f8e7e…`), 240 Hz bone and 60 Hz full-skin sampling: fixed lengths within 0.0004 mm; support-foot drift 0.331 mm; minimum skin Y +3.419 mm; maximum joint step 5.524 cm and rotation 0.118 radians per 240 Hz sample. The actual shoe touches the ball within numerical precision and within the 2 mm test at multiple rigid headings. Both feet land before the clip ends. Three automated candidate tests pass.

These checks do not certify every future mesh deformation or browser/device. The integrated game, refined model, physical ball release and transition to/from preparation require their own same-version QA. Do not apply take01-specific follow-through/settling overlays to take03.

### Delivered clip checked against refined v17

The unchanged `19d2dc23…` clip was also checked on model `e0b3eb06…`: actual boot contact error 1.12e-9 m, supporting-foot drift 0.331 mm, maximum joint step 5.524 cm and maximum angular step 0.118 radians at 240 Hz. Minimum full-skin Y was −1.314 mm (Boots vertex 1990 at 1.05 s), above the game's grass plane at −14 mm and within the existing −5 mm numerical gate. Both feet finish grounded; all three CMU variant tests pass. These are raw clip/model checks, without runtime arm or shoulder corrections. The separate `validatedOnModels` metadata retains these results without changing the original calibration provenance.

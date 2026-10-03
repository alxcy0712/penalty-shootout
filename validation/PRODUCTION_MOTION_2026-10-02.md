# Production motion and limb refinement

Baseline: published `2314f3c8c94b5f213d3c5fbf397a0dc529b19428`. This iteration improves selected finish/keeper transitions and offline limb form while reclaiming CPU work. It does not claim FIFA/eFootball parity or measured mobile frame rate.

## Changes and source boundaries

**Captured kick finish.** Both recordings previously reached their cropped endpoint while still moving, then stopped in one sample. Styled gameplay now plays the last 0.25 source seconds over 0.50 seconds: the clock decelerates from 1 to 0, adding 0.25 seconds of settling. The mixer and calibrated finish overlay use the same clock. Earlier approach, plant and strike timestamps remain unchanged, and all vertices reach exactly the same final pose. The original asymmetric grounded finish is retained. Native/unstyled inspection stays unmodified. This is a timing adaptation of the same two CMU performances, not new capture or a blend into a different stance.

**Keeper early gather.** The central catch's elbow reached the downward bend seam and reversed while the underlying dive continued. A rounded, at-most 0.30-radian margin lets the elbow absorb the turn earlier. It vanishes at capture and full settlement, preserving ball/wrist/body timing, fixed limb lengths and the simultaneous ball/torso/floor constraints. Mirrored central peak hip-relative elbow speeds fall from 8.69/8.36 to 6.49/7.21 m/s. The effect is modest and the catch remains brisk and stylized. See [the detailed absorption study](KEEPER_GATHER_ABSORPTION_2026-10-02.md).

**Offline modeling.** Blender fairing reduces angular forearm/elbow transitions and excessive back-of-shirt ridges. Palm and boot surfaces, existing skin weights, original bones/binds and captured animation tracks remain unchanged. There is no runtime cloth simulation or added topology. See [reproduction and model checks](../tools/blender/PRODUCTION_LIMB_REFINEMENT.md) and [source/asset evidence](summary-production-models-2026-10-02.json).

## CPU reuse and measurement scope

The secured grasp already has a fixed calibrated palm ray. Once its weight is exactly one, the runtime reuses its module-local offset instead of repeating two exact glove-surface ray searches. Transition frames still evaluate their actual rays. Offsets are rebuilt with the current contact-data module; no mutable pose cache is shared across actors. Within-call torso/full-holding calculations are reused, and stored grip rotations return before constructing unnecessary frames.

The authoritative character pose pipeline also skips two redundant full hierarchy refreshes after the skin has just updated it. Standalone helpers retain their self-refreshing default. Full keeper hierarchy walks fall from 3 to 1, with updateMatrix calls 307→241 in the measured dive. Transform/skin comparisons remained bit-identical under dirty roots, rotated/nonuniform parents, repeated/reversed sampling and separate rigs.

Isolated CPU-reuse verification covered 40 captures ×169 samples: maximum complete-output delta was 1.89e−15, representing floating-point evaluation order. Settlement-boundary samples down to a 10 ns finite-difference window showed ≤5e−8 m/s numerical velocity difference. Current tests also check actual glove tangency, mirrored/custom orientations, exact capture and independent instances.

Final combined CPU timing is recorded below after the other test/render workers stop. It compares warmed interleaved same-machine Node batches with the published baseline. Gather-only timing excludes raw pose generation, asset loading, rendering, GPU and phone thermal/battery effects. It is not whole-game FPS evidence.

Seven interleaved rounds over the same 40 captured paths / 6,760 inputs:

| Gather workload | Samples | Baseline median | Final median |
|---|---:|---:|---:|
| Complete sampled recovery | 6,760 | 1,302.2 ms | 395.6 ms (−69.6%) |
| Transition only | 1,040 | 284.2 ms | 277.8 ms |
| Fully secured | 5,680 | 1,062.4 ms | 128.5 ms (−87.9%) |

The 40 exact capture-start samples account for the difference between the all-samples row and the two phase cohorts. Rows are independently timed batches, so their medians need not add.

A separate five-round full-path benchmark includes pose construction: the 135-shot physics batch is 681.2→676.5 ms, effectively unchanged in this environment; no general physics speedup is claimed. Ten real grasp paths / 1,690 samples fall 390.7→135.0 ms. Six free-save paths / 1,446 pose-and-glove samples are 15.61→15.11 ms, also essentially unchanged. These final runs started after both aggregate test processes exited, with the Blender render queue paused. Shared-host variability still applies.

Source-hashed reports: [gather CPU](production-motion/gather-cpu.json), [full path CPU](production-motion/full-cpu.json). The combined report intentionally includes the elbow-motion change; its early pose differences are not described as optimization roundoff.

## Asset and rendering budgets

| Model | Triangles | GLB bytes | Change |
|---|---:|---:|---:|
| Keeper | 17,954 | 449,480 | +400 B |
| Striker | 17,924 | 446,784 | +476 B |

Both retain the original 18,000-triangle/450,000-byte limits, six materials, two 512/128 textures, 22 asset bones/24 runtime bones and four maximum weights. Losslessly compressed editable Blender sources reopen with the original actions and remain below 2 MB each. No lights, rendering passes, draw submissions, texture sizes or render resolution were added.

Generated contact source grows by 174 bytes. The production rendering chunk is 1,262.15 KB / 347.19 KB gzip, versus 1,261.52 / 343.98 KB: approximately +0.63 KB raw / +3.21 KB gzip. Compressed geometry/contact-number changes need not track raw size. The existing large-chunk warning remains; the iteration is not described as zero-cost loading.

## Combined verification

- Full suite: **251 passed**, zero failed/skipped; production Vite build passes. Independent reviewer run also passes
- The old heading invariant now compares styled/native recovery at the same source timestamp. Its original 1e−9 local position/quaternion thresholds remain; the new independent baseline adapter separately checks timing and full-skin path equality
- Both decoded CMU track fingerprints match the published version. A portable frozen sampling adapter matched the historical runtime on 150 samples with zero vertex error, without requiring git/network in tests
- All four styles: exact early/contact/endpoint skin preservation; same-source tail geometry; 30/60/120 Hz stop sampling; normal/low/chip overlays; aim freeze/support; reverse/repeated sampling; raw/unstyled playback preserved
- At 60 Hz, final long-kick pelvis speed falls 0.664→0.000059 m/s; compact 0.274→0.000024. Tail minimum real skin height is approximately 0.794/0.553 mm above physical y=0. These are finite sampled measurements, not all-derivative guarantees for the captured interpolation
- 40 actual held paths through 2.8 seconds, 240 Hz joint motion and 60 Hz full-skin sphere/floor sampling: zero failures under unchanged tolerances
- 40 captures / 1,400 body poses: 10 Hz whole recovery plus 120 Hz known risk windows. Protected forearm/torso, calf/torso and opposite-foot/calf crossings remain zero. Full-skin floor minimum is −1.924 mm, inside the existing 5 mm tolerance
- Remaining adjacent shoulder/support fold maximum is 6.217 mm. Inner-elbow maximum falls from 3.165 to 1.461 mm. These finite-triangle SAT values are not whole-body penetration depths or a claim that every surface intersection is zero
- 135-shot matrix: 58 contacts, 36 catches, zero unfinished shots. First actual-skin contact gap ranges −0.0060…+0.1115 mm

Final same-camera comparisons cover both complete captured kicks and both central mirrored catches through +0.7 seconds at normal and quarter speed. The arm/jersey silhouette stays continuous, the ball remains attached to the gloves, and the original kick endpoints remain intact. The central change reads as a gentler early arm transition within a quick stylized catch, not a slow naturalistic absorption. The camera was widened before final review so the late descent remains visible.

The high-save and bent-elbow final exports are byte-identical to previously rendered candidate geometry; that equality is recorded rather than claiming a new render. Runtime hashes and final media identities are in [the visual evidence manifest](production-model-media-2026-10-02.json). Superseded tight upper-body crops are not final proof.

Browser/real-device stages remain untested in this cloud workflow; prior browser/network restrictions prevented the local WebGL preview. The visual evidence is actual CPU-skinned geometry rendered offline in Blender. Rigid fingers and some adjacent garment creases remain; no continuous-space proof or universal capture coverage is claimed.

Numerical release evidence: [combined summary](summary-production-motion-2026-10-02.json), [four-style recovery audit](production-motion/recovery-audit.json), [final gather motion audit](production-motion/gather-softening-comparison.json).

## Reproduce

```sh
npm test
npm run build
ARTIFACT_DIR=/tmp/held-body node tools/qa/audit-held-body.mjs --check
node tools/qa/audit-character.mjs hold --check --out /tmp/held-skin
node tools/qa/audit-character.mjs matrix --out /tmp/shot-matrix
ARTIFACT_DIR=/tmp/recovery node tools/qa/audit-striker-recovery.mjs
node tools/qa/benchmark-keeper-gather.mjs --baseline 2314f3c --out /tmp/gather-cpu --rounds 7
node tools/qa/benchmark-keeper-torso.mjs /tmp/full-cpu 2314f3c
```

The optional comparison benchmarks require the stated baseline git object locally. The normal test suite is self-contained. Run CPU benchmarks after tests and offline rendering stop; disclose shared-host timing variability.

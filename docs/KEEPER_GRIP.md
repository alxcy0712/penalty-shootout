# Goalkeeper finger grip

The production goalkeeper previously rotated each rigid glove without bending its fingers. The current four-finger deformation visibly cups a held ball while retaining the existing palm attachment and 24-bone runtime budget.

## Source and geometry

The keeper uses `assets/characters/keeper-prototype.glb`. Its model provenance remains the CC 0 Quaternius character, with the existing attributed Monteiro et al. 2024 goalkeeper motion source recorded in `assets/characters/keeper-prototype.json`. This pass authors a procedural shape over the existing glove mesh; it adds no external animation asset or finger skeleton.

The GLB has 22 bones. Two existing shoulder helpers already use the 24-bone runtime allowance. Socks contains 3,051 render vertices, including 1,109 left and 1,110 right hand-influenced vertices. The decoded geometry contains four separate finger branches above hand-local y=0.12 m. The source fingers are nearly straight.

`src/keeper-finger-grip.js` changes 626 left and 627 right distal vertices. Every changed vertex has exactly 1.0 hand influence. All 952 incident triangles on each hand are covered by the safety model; construction rejects an unsupported mixed-weight boundary instead of silently omitting a face.

The palm, cuff and thumb are unchanged. This pass does not articulate the thumb or change finger spread. Physical wrists, ball radius, contact calibration, GLB contents, materials, mesh count, triangle count, textures and bones are preserved by the finger module. Wrist/forearm changes are a separate coupled-pose refinement.

## Runtime contract

- Construct `createKeeperFingerGrip(root)` during character loading; the QA path supports lazy construction
- Apply after skin pose, arm roll and hand contact
- `pose.grip.ball` must be the exact solved ball center in the same coordinates as the pose joints
- `pose.grip.captureBlend` carries unbounded elapsed gather progress
- Call the controller with null before native capture/clip playback or kick/reset paths
- A standalone holding pose without authoritative ball metadata remains open

The controller clones Socks geometry per actor. Its authored constant-curvature bend reaches approximately 94 degrees at the longest fingertip. Quintic closure spans 396–704 ms after capture, completing while the keeper absorbs and secures the ball.

## Clearance and determinism

The limiter is stateless. Swept bounding spheres cover whole triangles throughout interpolation:68 for the left hand and 80 for the right. Each sphere's center interpolates linearly, while its radius encloses both endpoint triangle clusters. Convexity then guarantees coverage of every intermediate triangle. Analytic first-intersection roots limit closure against the actual ball. A smooth margin fade avoids switching abruptly when an initially overlapping conservative sphere becomes clear.

Linear vertex halfspaces additionally prevent curl from lowering any triangle below the turf target. Normals follow the authored deformation. Zero influence restores position and normal attributes bit-for-bit. No prior-frame smoothing, approximate-input cache or hidden pose history affects the output.

The hand-contact pipeline composes rotations inside the character hierarchy, excluding external display transforms. The focused regression test re-evaluates the complete pose beneath a rotated, translated, nonuniformly scaled parent, then checks that grip geometry is unchanged.

## Cost

No draw calls, triangles, textures or bones are added. Changed-pose position and normal updates are coalesced to at most 50,376 bytes total, with at most one contiguous update range per attribute. A steady grip does not mark the buffers dirty.

Private Socks geometry occupies 249,084 bytes. Numerical entry/guard data is approximately 200 KiB before engine-dependent JavaScript object overhead. These are structural storage estimates, not a browser heap or GPU-memory measurement.

The isolated probe measured 43.9 ms construction and 0.026 ms mean controller time on the cloud CPU. The worst individual call was 6.15 ms and includes scheduling/GC noise. Construction belongs in asset loading to avoid a first-catch pause. These measurements do not establish mobile or GPU performance; the combined runtime benchmark is recorded separately.

## Reproducible checks

    node --test tests/keeper-finger-grip.test.js
    ARTIFACT_DIR=validation/artifacts/finger-grip node tools/qa/audit-finger-grip.mjs --check

The focused suite checks private geometry/source preservation, exact reset, protected palm/thumb coordinates, the bone budget, guard incidence, bounded upload ranges, three real directional catches, sphere clearance, phase continuity, reverse scrubbing, full-pose display covariance and skipped steady-state uploads. A deliberately altered mixed-weight boundary must fail guard construction.

The audit hashes all source modules, the GLB, loader, fixtures and its own script before and after execution. It checks 205 pinned catches at 120 Hz through 1 s, phase boundaries within 10 microseconds, recovery through 2.8 s, reverse replay, exact triangle/sphere distances, floor clearance and whole-face guard coverage. It samples 41 authored morph fractions on both hands for strict transverse triangle intersections and triangle-area collapse. Welded shared-vertex adjacency, coplanar contact and tangent contact are excluded from self-crossing counts.

Run the full audit only on a frozen checkout. Sampled temporal evidence is not a continuous-time proof. Offline geometry renders are not browser screenshots or texture/shader parity checks.

## Isolated results before combined integration

The isolated finger-only probe, before the final wrist/pronation and recovery edits, checked 24,805 poses across 205 actual catches at 120 Hz through 1 s:

- All 205 catches reached full closure
- Zero source/reset changes, reverse-scrub mismatches or nonfinite distances
- Exact rigid-hand triangle/sphere clearance minimum−0.000000684 m, a sub-micron contact-calibration error; mixed-weight cuffs are checked by the separate whole-skin union
- Glove/Socks floor minimum 36.8 mm
- Largest curl step 0.05063 per 1/120 s, following the authored phase without safety clipping
- Both-hand self-check: zero new crossings across 82 morph samples; minimum triangle-area ratio 0.505

These numbers are isolated evidence. The [final combined validation](../validation/GRIP_RECOVERY_2026-10-02.md) passes 205 catches / 30,750 dedicated finger poses and the full 645-shot whole-skin union, with measured CPU and upload costs recorded separately.

## Rejected candidates

An early closure tied directly to bounded grip weight could advance 0.979 of the morph in 8 ms when its conservative guard became clear. It was rejected in favor of the delayed authored phase using raw capture progress. Curvature 21/m penetrated the calibrated sphere by 4.89 mm and was rejected. A y-only selection unintentionally bent 18 thumb-tip vertices and compressed some triangles to 23.6% of their original area; excluding the thumb raised the minimum to 50.5%. No finger-bone budget exception was required.

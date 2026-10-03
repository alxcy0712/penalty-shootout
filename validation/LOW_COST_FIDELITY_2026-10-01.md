# Low-cost football presentation refinement — 2026-10-01

Baseline: `a0db4a3dc00271c7eddb1dc386de6edfdde9e739`. Research and primary references: [LOW_COST_FIDELITY](../docs/LOW_COST_FIDELITY.md). This pass changes presentation and redundant CPU work, not the captured model geometry or competitive shot simulation.

## Verified result

- `npm test`: **218 passed, 0 failed, 0 skipped** (26.62 seconds on this cloud CPU).
- `npm run build`: passed. Shared rendering chunk 1,170.96 kB / gzip 317.63 kB versus 1,171.01 / 317.63 kB before. Game chunk 52.66 / gzip 20.37 kB versus 48.88 / 18.96 kB. The added net behavior increases compressed game JavaScript by about 1.41 kB; the existing >500 kB shared-chunk warning remains.
- Existing touch-drag stationary-until-release regressions, captured boot contact, shoulder support, arm clearance, model budgets and collision tests all pass. All asset files, including compressed editable `.blend` files, are unchanged.
- No new lights, shadow maps, geometry, material draws, rendering passes, postprocessing or framebuffer resolution. Original lighting values, character material values/sides and shadow frustum retained.

## Render work and load

The portable CPU census constructs the real scene with renderer/canvas stubs and loaded character geometry. It is **not actual WebGL draws or a GPU benchmark**. Counts below include the two jersey-number planes, start-of-scene visible flags, and no camera/shadow frustum culling. Transparent extra passes are not modeled.

| Structural candidates | Baseline | Candidate |
| --- | ---: | ---: |
| Main submissions (mesh + line + sprite) | 58 | 45 |
| Shadow mesh submissions | 40 | 22 |
| Main mesh triangles | 63,470 | 63,470 |
| Shadow mesh triangles | 36,986 | 36,790 |
| Generated-canvas logical RGBA + mip bytes | 6,291,452 | 5,963,772 |

Savings come from shared identical floodlamp/plinth/housing materials and removing irrelevant floor/marking/blob/emissive-square shadow casters. The architecture's 856 triangles have an identical material/position/normal/UV/color fingerprint at 1e-5 quantization after merging. This comparison ignores object IDs/shadow flags and checks texture dimensions, not canvas texels. The shared glow texture uses the identical drawing function for both lamps.

Two identical 256² glow maps now share one texture; a 64² contact map replaces the old hard ball-shadow disk in the existing draw. Net generated texture estimate falls **327,680 bytes (320 KiB)**. This is mathematical RGBA+mipmap storage, excluding character maps/number maps/driver overhead; it is not measured device VRAM. No new network texture asset is downloaded.

The opt-in `?profile` overlay now includes the shadow pass by disabling automatic counter reset and explicitly resetting before render. It still updates DOM no more than once per second. Its time around rendering is CPU submission time, not GPU completion time. Normal play keeps Three.js default counters and does not enable instrumentation.

## Character CPU correctness and work reduction

[CPU before](low-cost-fidelity/cpu-before.json) and [after](low-cost-fidelity/cpu-after.json) record five rounds, environment and source hashes. All **1,089 keeper + 2,430 striker frames** retain bit-identical local transforms and world matrices. All **135 seeded competitive shots** retain their outcome hash: 58 touched, 52 saved, 36 caught, 83 goals, including 6 rebound goals.

Two redundant full hierarchy updates were removed from the root-local striker overlay. Active chip/settling frames go from **3 full walks to 1**; observed `updateMatrix` calls go 172→106 for chip and 193→127 for settling. The one final GameCharacter flush leaves all world matrices current even under a nonuniform display transform. Reused scratch quaternion avoids the settling allocation. Keeper code and physics collision sampling remain unchanged.

Whole striker-stream median timing was **30.54→30.71 ms**, within noise. This establishes reduced deterministic work, **not an observed overall speedup, mobile FPS improvement or GPU result**.

## Contact feedback

The existing ball-shadow draw now has a smooth transparent perimeter, spreads and fades with height. At ball-center heights 0.11 / 0.60 / 1.70 m, opacity is 0.270 / 0.139 / 0.032; the old disk remained 0.24. Its reusable state does not allocate each frame. This is an inexpensive grounding cue, not a physically accurate replacement for the existing directional shadow.

Net impacts carry the exact fixed-step collision point, outward surface normal, speed and timestamp. Every collision is delivered once through a reusable synchronous record, including multiple collisions in a coarse display frame. Back contacts drive Z, side contacts X, and roof contacts the sloped roof normal. The existing **242-vertex** line net and its buffer are retained. Front frame, ground and rear corners remain fixed; sparse rear seams have bounded compliance. Eight impulses and distance/gain buffers are allocated once. Idle frames skip vertex updates; expiry/reset restores exact original floats.

At 22 m/s reference impacts, actual topology peaks are **1.79 cm back, 1.69 cm side, 2.38 cm roof**. This is restrained seam motion; the unsplit strands cannot reproduce localized cloth sag with every seam fixed. No cloth solver or geometry growth is claimed. Ordinary expiry in the baseline already restored Z: reset tests are protection, not evidence of a previous ordinary-expiry residual bug.

The post-goal physics stream across **96 trajectories × 720 frames** is bit-identical to the actual baseline class (SHA-256 `213929165b146a738425c225496d2e4e1e87f93a75ef996c2b69de1d8f19a93f`). Actual Stadium integration verifies equivalent 30/60/120 Hz event streams/net samples, repeated timestamps, pause, reset, and once-only consumption. Other tests cover outward directions, attachment weights, invalid inputs, bounded repeated impulses and smooth return to rest.

## Reproduce

```sh
npm test
npm run build
node tools/qa/audit-render-budget.mjs --scene-ref a0db4a3
node tools/qa/audit-render-budget.mjs --check
node tools/qa/benchmark-character-runtime.mjs --out /tmp/character-runtime --rounds 5
node tools/qa/export-net-feedback.mjs /tmp/net-snapshots.json
python tools/qa/render-net-feedback.py /tmp/net-snapshots.json /tmp/net-feedback.png
```

The tracked [render before](low-cost-fidelity/render-before.json) and [after](low-cost-fidelity/render-after.json) reports include source hashes and explicit census scope. Net/contact-shadow diagnostic images use runtime coordinates/parameters and are clearly labeled **CPU diagnostics, not gameplay screenshots**; net displacement arrows are magnified 10× for inspection. `render-contact-shadow.py` accepts JSON samples generated from `ballContactShadow(height)` and previous scale/opacity values.

## Remaining verification limits

The earlier cloud localhost browser security block and Chromium socket restriction remain respected; no bypass or deployment was used. Browser/WebGL screenshots, real touch-device interactions, mobile GPU duration, sustained frame pacing, thermal behavior and battery use are **not tested here**. CPU timings, scene candidates and diagnostic images cannot establish those outcomes. Existing adjacent cloth/skin fold limitations described in the preceding refinement record remain; no model-intersection claim changes in this pass.

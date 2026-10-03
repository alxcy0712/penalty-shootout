# Low-cost football fidelity: research and engineering rationale

Research date: 2026-10-01. Reference code inspected at `a0db4a3dc00271c7eddb1dc386de6edfdde9e739`.

## Direction

Improve the coherence of contact, motion, material response, and feedback before adding rendering complexity. The goal is a more believable mobile-web penalty game inspired by broadcast football presentation, not a claim of FIFA / EA SPORTS FC / eFootball parity.

This document records research rationale and implementation scope. It does not establish measured GPU performance or successful browser visual validation. Exact test results and limitations belong in the accompanying validation record.

## What the references support

- **FC console/PC animation:** EA describes volumetric-data-derived animation and improvements to goalkeeper saves, falls, and recoveries. This supports investment in motion coverage and transitions, but the article is a product description rather than an implementation specification or mobile performance benchmark. [EA FC 25 gameplay deep dive](https://www.ea.com/games/ea-sports-fc/fc-25/news/pitch-notes-fc-25-gameplay-deep-dive)
- **eFootball motion selection:** KONAMI describes selection influenced by ball state, speed, body direction, and ability. Its original announcement includes mobile among the platforms using motion matching. This suggests matching motion to the situation, not merely increasing clip count. Neither source establishes a Three.js implementation budget. [Gameplay details](https://www.konami.com/games/us/en/topics/1756/), [platform announcement](https://www.konami.com/games/us/en/topics/1724/)
- **Mobile presentation:** FC Mobile explicitly emphasizes broadcast cameras, replays, pitch rendering, crowds, lighting, and net sounds. These categories offer practical references for a small game without importing console effects wholesale. [FC Mobile visuals and audio](https://www.ea.com/ea-originals/news/visuals-audio-deep-dive)
- **Mobile graphics evidence:** KONAMI's v5 mobile comparison presents better player appearance, turf, and lighting under its High setting. The official before/after images were inspected in the cloud browser: facial tonal separation and hair/beard definition are visible differences. These are promotional captures, not evidence of a specific shader, device cost, or guaranteed real-time frame rate. [eFootball mobile graphics comparison](https://www.konami.com/efootball/en/page/v5/versioninfo_v5-00)
- **Advanced cloth is a different cost class:** EA describes GPU-compute cloth simulation with denser cloth meshes and character collisions in FC 24. That is not the baseline for this mobile-web project. Prefer authored silhouettes and baked garment detail before simulated cloth. [EA technology overview](https://www.ea.com/zh-hans/news/2024-ea-sports-latest-tech-innovations)

## Selected scope in this refinement

The implementation selects the following bounded changes. Their correctness and actual costs must be checked in the separate validation record:

1. **Net contact coherence:** deform the existing net from the impacted surface's normal and contact timing; reuse the existing geometry and draw path rather than adding particles or a cloth solver
2. **Ball grounding:** use a soft, height-dependent ball shadow in the existing single-draw shadow representation
3. **Resource reuse:** share identical materials/textures where their ownership and mutation semantics permit it; preserve independent team/character material changes
4. **Honest optional counters:** report full-frame shadow-inclusive rendering counts and clearly label CPU submission timing
5. **CPU housekeeping:** remove redundant striker matrix-tree work while preserving pose and contact behavior

The original lighting values, character material values, and shadow frustum are retained. They were not visually validated in a functioning browser, so this iteration does not claim a verified improvement from changing them.

## Why these are preferable to new effects

Contact and event synchronization make existing pixels more convincing. A ball should visibly meet a boot, glove, post, or net at the same moment its motion and feedback change. Supporting feet and recovery hands should remain attached to their intended contact surface. These improvements can reuse the current skeleton, geometry, and draw calls.

For future motion work, annotate stance/contact windows and preserve the captured performance. Fade foot locks smoothly, limit limb extension, and measure world-space foot drift; a rigidly pinned foot is not a success if it produces unnatural knees or pelvis movement. [Daniel Holden: inverse kinematics and foot locking](https://theorangeduck.com/page/inverse-kinematics-foot-locking)

A bounded penalty scenario does not presently justify a full motion-matching database. A small appropriate clip family with contact-aware corrections is a more proportionate experiment. Motion warping can align root motion to a target within a defined window, but cannot supply missing motion coverage. [Epic: motion warping](https://dev.epicgames.com/documentation/unreal-engine/motion-warping-in-unreal-engine)

## Measurement gates

- Compare baseline and candidate with identical seeds, sequence times, viewport, drawing-buffer dimensions, and hardware
- Keep refinement free of additional rendering passes and shadow lights; do not spend assumed optimization savings before measuring them
- Check kick contact, both directions and heights of keeper dives, landing/recovery, side/back/roof net impacts, and the home-camera sequence
- Preserve existing contact, bone-length, clearance, repeat-sampling, and deterministic-physics tests; verify that resource sharing does not leak changes between characters
- Treat screenshots/offline renders, numerical tests, real WebGL rendering, and real-device measurements as separate evidence classes
- Record sustained frame pacing on real phones when available; do not infer GPU cost or thermal behavior from desktop/offline rendering

### Rendering-counter caveat

In the inspected Three.js version, `WebGLRenderer` renders shadow maps before its default automatic `info.reset()`. Reading the default post-render counters therefore omits shadow-pass draws. Full-frame accounting requires disabling automatic reset and explicitly resetting before the frame's render work. Multi-view rendering needs the same frame-level accounting discipline. [Three.js renderer documentation](https://threejs.org/docs/pages/WebGLRenderer.html)

CPU time surrounding `renderer.render()` is CPU submission time, not GPU elapsed time. Texture and geometry counters are object counts, not byte measurements. GPU time requires a supported timer query and invalid/disjoint-result handling; otherwise report it as unavailable. [MDN: timer queries](https://developer.mozilla.org/en-US/docs/Web/API/EXT_disjoint_timer_query)

Drawing-buffer size is an important independent budget: high device pixel ratios multiply pixel work. The existing DPR/pixel ceiling should be preserved until device measurements justify a change. [Three.js responsive rendering](https://threejs.org/manual/pages/responsive.html)

## Deferred experiments

- **Existing-light/material tuning:** restrained skin/cloth tonal separation and roughness hierarchy, judged with fixed-camera A/B captures; not shipped here
- **Shadow-frustum fitting:** potentially sharper contacts at the same map resolution, but first prove coverage across full dives, shadows, and home-camera views; not shipped here. Shadow maps redraw casters, and larger coverage lowers effective resolution. [Three.js shadows](https://threejs.org/manual/pages/shadows.html)
- **Baked character detail:** improve collar, sleeve/shorts edges, broad folds, and silhouette using existing topology/atlas where possible; avoid baking strong directional light into base color
- **Environment lighting:** standard PBR materials benefit from an environment map, but PMREM setup, texture memory, and sampling are not free. Keep it a separate measured experiment. [Three.js standard material](https://threejs.org/docs/pages/MeshStandardMaterial.html)
- **Front-face-only rendering:** evaluate only after inspecting open cuffs, collars, shorts, and eye layers; do not blanket-disable double-sided rendering
- **Advanced effects:** no default bloom, SSAO, depth of field, extra shadow lights, dense grass, simulated cloth, or unbounded mesh-detail increases

The next visual decision should follow reliable runtime evidence, not replace missing evidence with additional complexity.

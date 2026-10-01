# Keeper articulation and supported recovery

This refinement addresses a specific visual problem: the previous keeper could land, move its legs and start getting up while its torso remained a straight segment and both arms retained an extended reaching silhouette.

## Authored changes

- Keep the pre-landing save envelope intact. A regression fixture from published `1b1230e` checks both hands, both elbows, both boots and the hip at representative early times. An experimental early trailing-hand delay was rejected because it changed grasp quality and introduced inner-elbow folding.
- After the reach, bend the lower arm toward a brace and let the upper arm settle slightly later into a different balancing position. This is a change to the authoritative pose, not an extra render-only smoothing filter.
- Give the existing spine/chest/neck/head bones a small shared analytic chain. The maximum authored landing curl is 0.12 rad, axial counterturn 0.035 rad, side bend 0.075 rad and head compensation 0.04 rad. These fade out as the keeper rises. Existing bone and material counts stay unchanged.
- Shorten the initial recovery delay from 0.45 to 0.28 seconds while keeping lower-boot then upper-boot placement. The supporting palm sits farther outside the boot corridor; release begins after both boots arrive. The arm pole transitions only after landing to a front-hemisphere transported bend direction, with a ground-side bias that avoids a floor-constrained IK branch flip.
- Secure-ball recovery remains a coupled ball-and-wrists solve. A bounded lift of up to 11 cm during side-lying/tuck keeps the held ball clear of the knees; both physical wrists follow. Full-mesh clearance and elbow continuity are separate acceptance gates, not inferred from the ball staying attached to a glove.

## Actual support, not only low joint centers

The ground-side wrist is tagged as bracing and may reach 3.5 cm above the physical plane. The ordinary 6.5 cm joint-center heuristic remains for non-bracing wrists and other joints. The exception alone is not acceptance: tests require actual deformed glove skin near the floor, a fixed planted wrist, correct phase tags, and preserved limb lengths. The hip shifts up to 10 cm toward the planted boot before rising. The glove has a thumb-clearance roll and bounded floor-aware tilt.

A central 136-triangle palm patch, excluding fingertips, thumb tip and cuff, sits at approximately 7 mm minimum height during the settled brace; its area-weighted mean is about 29.5 mm and its normal is 26.7 degrees from downward. This is a partial palm/heel brace, not a perfectly flat whole hand. The rendered grass plane is at −14 mm, distinct from the physical y=0 reference. Fingers remain rigid. These geometry checks establish plausible support proximity, not a biomechanical force or center-of-mass stability simulation.

Capture-aware holding preserves the complete incoming pose at elapsed zero, including a low tagged brace wrist. The wrist floor then rises continuously with the grasp blend. The phase-specific exception cannot authorize arbitrary low joints or lower ordinary free-flight thresholds.

There is no random wobble, global slow motion, history-dependent spring or accumulated smoothing. Absolute-time sampling, reverse scrubbing and 30/60/120 Hz histories must yield the same pose.

## Rendering and collision agreement

`keeper-torso.js` is shared by pose construction, skin posing and physical contact. Curved torso landmarks are not hidden behind the previous rigid collider. The existing small torso hull carries source skin weights; only a possible torso hit evaluates its candidate exact surface. The existing arm/shoulder patch uses the same bone frames. The broad-phase allowance is not an extra physical reach radius: final contact uses the actual ball radius and skin surface.

This adds CPU geometry work and collision data, not rendering passes, bones or per-frame full-character mesh collision. The final validation record reports actual counts, timing scope and remaining limitations. Cloud Node timings cannot establish mobile GPU duration or sustained phone frame rate.

## Mirrored capture regressions

The broader 40-capture audit found two wide-middle catches whose non-capturing forearm entered the secured ball during get-up, and a mirrored central catch whose elbow accelerated sharply near an almost-zero ball-away projection. The final correction constrains the fixed-length elbow circle against floor, a tapered forearm/ball envelope, and an anatomically outward/front support plane derived from the shared torso frames. A capsule-proximity envelope activates this jointly for the trailing arm before it approaches the abdomen; the capturing arm retains its source reach until secure. A bounded ball-radius-scaled gradient avoids amplifying near-axis projection noise. Ball and wrist paths remain unchanged. No full-mesh collision loop or extra bone is introduced in the runtime solver.

Both mirrored wide shots and the previously missing central mirror are regression recipes. The wide get-up interval's peak hip-relative elbow speed fell from about 16.8 to 3.56–3.62 m/s, with per-240 Hz upper-arm angular change falling from about 14 to 3.20–3.25 degrees. The central mirror's peak fell from 28.9 to about 8.36 m/s. Its early gather remains brisk; continuity alone does not prove naturalistic motion. Across 40 captured paths, the maximum 240 Hz elbow step is 3.658 cm, below the unchanged 4 cm gate.

Full-skin ball clearance is checked separately at 60 Hz through 2.8 seconds. A complementary actual-skin body audit covers all 40 captures at 10 Hz and the observed early/late wide and central risk windows at 120 Hz (1,400 poses). Both gates must pass on the same numerical kernel. Local adjacent sleeve and elbow folds are reported separately from protected forearm/torso crossings. These sampled tests are not a proof of every continuous pose or every possible shot.

## Source boundary

The keeper remains a procedural physical rig informed by the existing Monteiro markerless-capture study and inspected football reference motion. The study supports preparatory stepping, leg loading/extension and arm contribution to the dive. Its analyzed impulse interval ends at peak center-of-mass velocity; it does **not** provide a recorded complete landing/get-up for this implementation. The recovery, arm settling and torso envelopes here are authored adaptations, not a newly integrated goalkeeper capture.

Primary reference: [Monteiro et al. author paper](https://scilabiocom.eeferp.usp.br/pdf/Monteiro2024.pdf). Existing capture attribution/license details remain in [MOTION_SOURCES](MOTION_SOURCES.md) and `public/character-credits.txt`.

## Acceptance

- Preserve the calibrated ball/skin contact, fixed limb lengths, grounded support and real captured striker contacts
- Review synchronized full-body front/side sequences, including misses, low/high saves, both directions and secured-ball recovery
- Check skin self-intersection separately from joint-center continuity and ball attachment
- Retain honest adjacent cloth-fold limits rather than calling every visible seam an error or claiming zero whole-body intersections
- Run the complete test suite, exact-skin shot matrix, turf audit, dense self-intersection samples, and bounded CPU benchmark against a frozen source tree before publication

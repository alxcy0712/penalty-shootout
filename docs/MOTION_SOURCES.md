# Motion sources and adaptation boundaries

Reviewed 2026-10-01. This file distinguishes actual recordings from runtime procedural adaptations.

## Striker

- **CMU Graphics Lab**, subject 10, soccer kicks 10_01/02/03/05/06: https://mocap.cs.cmu.edu/
- BVH conversion terms: https://sites.google.com/a/cgspeed.com/cgspeed/motion-capture/the-daz-friendly-bvh-release-of-cmus-motion-capture-database/readmefirst-file-for-daz-friendly-primary-release?authuser=0
- The fourth game technique plays separate take **10_03**, a genuine different optical capture with a compact approach. Its game contact is **1.125 s**, with the completed source crop ending at **2.5 s**; its event metadata and exact source hash accompany the animation-only GLB. The three other named cadence techniques remain adaptations of **10_01**.
- Take 10_03 retains its recorded normal-kick follow-through. Low/chip follow-through overlays are specific to 10_01 and are deliberately not applied to an uncalibrated second performance. Shot selection still controls ball physics.
- The compact technique has a separate, small preloaded two-step procedural fallback when model resources fail; that fallback is not labelled as recorded motion in the inspector.
- Separate take 10_03 is a genuine different optical capture with a compact approach. Existing 10_01 has a long prepared opening. Merely cropping, bending or changing the cadence of 10_01 does **not** create a new capture.
- Explicit style headings are fixed rigid rotations around the ball. Target selection controls ball flight; the body does not turn with the live aiming preview. This preserves the captured foot plants and joint deformation. A differential pelvis/ankle path-warp candidate was rejected after actual-triangle audits found additional local knee/ankle folds.
- Existing raw files and attribution are retained under `assets/characters/mocap/cmu-soccer/`. Recorded data needs retargeting, fixed bone lengths, foot stabilization and exact boot-surface contact before game integration.
- Technique reference (reference video only, not redistributed): [FIFA penalty approaches](https://www.fifatrainingcentre.com/en/game/game-analysis/set-plays/set-play-routines/messi-penalties-at-the-fifa-world-cup-2022-seven-steps-to-immortality.php). Angled side-foot approaches and longer, straighter power approaches are different techniques; a rhythm modifier alone should not be labelled as all of them.
- [IFAB Law 14](https://theifab.com/laws/latest/the-penalty-kick/): any early cadence dip is part of the approach; the final kicking action is uninterrupted.

## Goalkeeper

- **Rafael Monteiro (2023)**, [dataset, DOI 10.6084/m9.figshare.23507793.v1](https://figshare.com/articles/dataset/Data_Kinematic_analysis_of_soccer_goalkeeper_s_diving_save_in_penalty_effect_of_instructional_video_and_laterality_on_performance/23507793), **CC BY 4.0**, https://creativecommons.org/licenses/by/4.0/ . No endorsement is implied.
- [Primary research paper](https://www.nature.com/articles/s41598-024-60074-x), [author PDF](https://scilabiocom.eeferp.usp.br/pdf/Monteiro2024.pdf).
- Actual multicamera markerless reconstruction: 120 Hz, 25 anatomical OpenPose points, source X forward/backward, Y lateral, Z vertical. The recorded N05D and O05E trials are retained with hashes and attribution in `assets/characters/mocap/keeper-research/`.
- These short trials end during the dive. They have no tracked ball, secure catch or complete get-up. A normalized *impulse* window from the paper is not a complete save animation.
- The lab’s `capture0` / `capture1` options play the existing retargeted recorded clips separately. The game retains the shared physical/visual rig for target-dependent dive, contact, landing, catch and recovery.
- The game’s new pre-shot set step is **mocap-informed procedural animation**, inspired by the recorded same-side forward step, opposite-leg loading and arm preparation. Its small neutral step does not know the shot target. It returns to the exact existing physical initial pose before release; support-foot and skin tests cover the transition.
- Adaptations to recorded clips: low-pass filtering, coordinate alignment, uniform scale, fixed-length retargeting, foot orientation/floor correction and baked quaternion continuity. These corrections are not presented as raw biomechanical measurements.

## Sources evaluated but not imported

- [Anderson Rohr Soccer Mocap Pack 5](https://andersonrohr.gumroad.com/l/mocap_pack5): real Rokoko captures including two penalty kicks and three saves. Commercial/personal project use is allowed; standalone raw-pack redistribution is prohibited. No checkout or download was performed for this change, and public-repository asset redistribution was not assumed authorized.
- [Earlier Monteiro goalkeeper data](https://doi.org/10.6084/m9.figshare.19059086.v1), [repository](https://github.com/rafaellmmonteiro/DataDivingGoalkeepers): GPL 3.0+ licensing needs separate review before mixing raw data into this asset bundle. Not imported.
- Mixamo raw animation redistribution was not assumed authorized. No unlicensed clips were added.

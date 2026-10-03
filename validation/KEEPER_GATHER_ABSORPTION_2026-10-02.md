# Bounded early goalkeeper elbow absorption

The baseline is `2314f3c`. The remaining central-catch elbow spike occurs before
the simultaneous torso/ball/floor feasibility correction: that solver's
settlement weights are zero in the observed early interval. The moving dive
reference and gather interpolation carry the bend into the downward angular
seam, then back out while the ball-aware elbow correction also acts. Shifting
the entire gather clock mainly relocates the peak.

The accepted change reserves a maximum **0.30 rad (17.2°)** around this extreme
bend during early gathering. Its envelope is `4*w*(1-w)`, where `w` is the
existing gather smootherstep. The margin is exactly zero at capture and when
the ball is fully secured. A proportional `0.12 rad` soft-min boundary is
**C1 continuous**: both position and first derivative agree where it joins
the unconstrained and capped portions. The elbow starts absorbing before its
bend reaches the pole, avoiding the extreme-and-return excursion.

Only the elbow angle around the existing fixed-length IK circle changes. Body
and ball timing, target wrists, glove attachment and final physical constraints
are preserved. The runtime adds scalar arithmetic to two existing arm solves;
it adds no mesh loop, bone, allocation, trigonometric call or frame history.
This is a modest procedural refinement, not a new captured goalkeeper action
or a whole-animation naturalness claim.

## Isolated motion result

For the mirrored central recipes (x=±1.5, y=1.2, power=0.5, initial direction=0,
seed=42, speed/reach=85), peak hip-relative elbow speed over the **entire 2.8 s
recovery** at 240 Hz changes as follows:

| Recipe | Baseline | Candidate | Upper-arm maximum step |
|---|---:|---:|---:|
| Negative central | 8.6855 m/s | 6.4925 m/s | 5.7829° → 4.8240° |
| Positive central | 8.3576 m/s | 7.2066 m/s | 6.2867° → 6.0067° |

Both existing high-catch recipes also improve, from 6.8866 to 5.9828 m/s and
6.2749 to 5.4333 m/s. None of the canonical 40 catches has a higher full-path
peak. Only 289 of 53,840 sampled elbows change, spanning ten captures; maximum
elbow displacement is 6.98 cm. This is not a continuous-space proof.

The isolated motion kernel passed the unchanged 40-path 240 Hz joint / 60 Hz
complete-skin sphere and floor audit and the 1,400-pose protected-body audit.
Both gates had zero failures. The original 4 cm maximum elbow-step gate is
unchanged; the measured whole-cohort maximum remains 3.6585 cm/240 Hz.
Adjacent shoulder and elbow cloth folds are still reported separately.

## Regressions and portable audit

`tests/keeper-gather-softening.test.js` is self-contained. It exercises real
mirrored catches, bounds full-recovery peak speeds, checks original limb
lengths, and requires exact same-kernel identity after reverse scrubbing and
30/60/120 Hz histories. A small immutable `2314f3c` fixture preserves complete
capture/secured poses and early ball/wrist/glove attachment. The fixture
comparison permits only `1e-12` floating-point evaluation-order variation;
the physical capture and same-kernel replay comparisons remain exact.

The separate audit compares both gather kernels using identical **current
engine** physical captures and raw input poses. It therefore isolates the
gather change rather than mixing in separate source-motion or collision
changes. Give it a local baseline checkout, or its `src/keeper-contact.js`
module, with working dependencies:

```sh
node --test tests/keeper-gather-softening.test.js
node tools/qa/audit-keeper-gather-softening.mjs \
  --baseline /path/to/baseline-checkout \
  --out /tmp/gather-comparison --check
```

The audit requires no git access or network. It writes source hashes, every
recipe's full-recovery peak metrics, ball/wrist/glove differences, fixed-length
error, capture/secured-pose differences and random-access error to
`gather-softening-comparison.json`. It rejects source edits during sampling,
an altered 40-catch cohort, peak-speed increases, and failures of the unchanged
4 cm elbow-step gate. Exact skin clearance still requires the separate audits.

An initial combined motion/CPU-kernel audit passed all 26,920 gather samples:
maximum ball difference `2.49e-16 m`, wrist difference `8.90e-16 m`, full
capture/secured-pose numerical difference `1.89e-15`, zero glove-rotation or
random-access differences, and maximum limb-length error `1.23e-15 m`.
These roundoff differences arise from the separate CPU reuse change; the
isolated elbow-margin kernel left ball and wrists bit-identical.

The final combined runtime and model passed both full skin/body gates and
the 251-test suite on the frozen source tree. The repeated 26,920-sample
motion audit is retained in [the source-hashed final report](production-motion/gather-softening-comparison.json).
See [combined validation](PRODUCTION_MOTION_2026-10-02.md) for current
performance, asset budgets and visual limits. None of these CPU geometry tests
establishes mobile frame rate or GPU duration.

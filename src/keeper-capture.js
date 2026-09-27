import * as THREE from 'three';

// BODY_25 joint order, metres, 120 Hz. Source and attribution accompany data.
export function prepareKeeperCapture(data) {
  const raw = data.frames.map(frame => frame.slice(0, 25).map(p => new THREE.Vector3(...p)));
  // Symmetric 5-tap low-pass suppresses markerless jitter without shifting event time.
  const weights = [1, 4, 6, 4, 1];
  const vectors = raw.map((frame, f) => frame.map((_, j) => {
    const point = new THREE.Vector3();
    weights.forEach((w, k) => point.addScaledVector(raw[Math.max(0, Math.min(raw.length - 1, f + k - 2))][j], w / 16));
    return point;
  }));
  const first = vectors[0];
  const origin = first[8].clone().setZ(0);
  const across = first[5].clone().sub(first[2]).setZ(0).normalize();
  const forward = new THREE.Vector3(-across.y, across.x, 0);
  if (forward.dot(first[0].clone().sub(first[1])) < 0) forward.negate();
  const leg = (first[9].distanceTo(first[10]) + first[10].distanceTo(first[11])
    + first[12].distanceTo(first[13]) + first[13].distanceTo(first[14])) / 2;
  const scale = .86 / leg;
  const frames = vectors.map(frame => frame.map(point => {
    const p = point.clone().sub(origin);
    return new THREE.Vector3(p.dot(across) * scale, p.z * scale, p.dot(forward) * scale);
  }));
  const duration = (frames.length - 1) / data.fps;
  return {
    duration,
    sample(time) {
      const cursor = THREE.MathUtils.clamp(time * data.fps, 0, frames.length - 1);
      const index = Math.floor(cursor), next = Math.min(index + 1, frames.length - 1);
      const p = frames[index].map((v, i) => v.clone().lerp(frames[next][i], cursor - index));
      const up = p[1].clone().sub(p[8]).normalize();
      const right = p[5].clone().sub(p[2]).normalize();
      const forward = right.clone().cross(up).normalize();
      right.crossVectors(up, forward).normalize();
      const hip = p[8].clone();
      const shoulder = hip.clone().addScaledVector(up, .49);
      const pose = {hip, shoulder, head:shoulder.clone().addScaledVector(up, .245), up, right, forward,
        hips:[], shoulders:[], knees:[], feet:[], elbows:[], hands:[], footDirections:[], roll:Math.atan2(-up.x, up.y)};
      for (let i = 0; i < 2; i++) {
        const sign = i ? 1 : -1, h = i ? 12 : 9, a = i ? 5 : 2;
        const hr = hip.clone().addScaledVector(right, sign * .125);
        const sr = shoulder.clone().addScaledVector(right, sign * .195);
        const knee = hr.clone().addScaledVector(p[h+1].clone().sub(p[h]).normalize(), .43);
        const foot = knee.clone().addScaledVector(p[h+2].clone().sub(p[h+1]).normalize(), .43);
        const elbow = sr.clone().addScaledVector(p[a+1].clone().sub(p[a]).normalize(), .29);
        const hand = elbow.clone().addScaledVector(p[a+2].clone().sub(p[a+1]).normalize(), .27);
        pose.hips.push(hr); pose.shoulders.push(sr); pose.knees.push(knee); pose.feet.push(foot);
        pose.elbows.push(elbow); pose.hands.push(hand);
        const toe = i ? 19 : 22;
        pose.footDirections.push(p[toe].clone().add(p[toe + 1]).multiplyScalar(.5).sub(p[h + 2]).normalize());
      }
      return pose;
    },
  };
}

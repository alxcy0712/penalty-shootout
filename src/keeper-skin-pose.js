import * as THREE from 'three';

// Apply the existing physical rig to a skinned character without moving any
// collision/contact targets. The asset uses the same metre-scale limb lengths.
export function createKeeperSkinPose(root) {
  const entries = new Map();
  root.traverse(object => {
    if (!object.isSkinnedMesh) return;
    object.skeleton.bones.forEach((bone, i) => {
      if (entries.has(bone.name)) return;
      const bind = object.skeleton.boneInverses[i].clone().invert();
      entries.set(bone.name, {bone, bind, rotation: new THREE.Quaternion().setFromRotationMatrix(bind)});
    });
  });
  const basis = new THREE.Matrix4();
  const bodyRotation = new THREE.Quaternion();
  const swing = new THREE.Quaternion();
  const rotation = new THREE.Quaternion();
  const local = new THREE.Matrix4();
  const world = new THREE.Matrix4();
  const desired = new THREE.Matrix4();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), rest = new THREE.Vector3();
  const right = new THREE.Vector3(), up = new THREE.Vector3(), back = new THREE.Vector3();
  const scale = new THREE.Vector3(1, 1, 1);
  const point = (p, distance) => ({x:p.hip.x+p.up.x*distance, y:p.hip.y+p.up.y*distance, z:p.hip.z+p.up.z*distance});
  function setBone(name, start, end) {
    const entry = entries.get(name);
    a.copy(start);
    rotation.copy(bodyRotation).multiply(entry.rotation);
    if (end) {
      b.copy(end).sub(a).normalize();
      rest.set(0, 1, 0).applyQuaternion(rotation);
      if(name.startsWith('upper_arm')){
        // Lift through lateral abduction. A direct down-to-up shortest arc
        // becomes ambiguous overhead and can rotate the shoulder backwards.
        const lateral=right.clone().multiplyScalar(name.endsWith('L')?-1:1);
        swing.setFromUnitVectors(rest,lateral);rotation.premultiply(swing);
        swing.setFromUnitVectors(lateral,b);rotation.premultiply(swing);
      } else {
        swing.setFromUnitVectors(rest, b);
        rotation.premultiply(swing);
      }
    }
    desired.compose(a, rotation, scale);
    world.multiplyMatrices(root.matrixWorld, desired);
    local.copy(entry.bone.parent.matrixWorld).invert().multiply(world);
    local.decompose(entry.bone.position, entry.bone.quaternion, entry.bone.scale);
    entry.bone.updateMatrixWorld(true);
  }
  return pose => {
    root.updateWorldMatrix(true, true);
    right.copy(pose.right).normalize();
    up.copy(pose.up).normalize();
    back.crossVectors(right, up).normalize();
    right.crossVectors(up, back).normalize();
    bodyRotation.setFromRotationMatrix(basis.makeBasis(right, up, back));
    setBone('pelvis', pose.hip);
    setBone('spine', point(pose, .19));
    setBone('chest', point(pose, .43));
    setBone('neck', point(pose, .51));
    setBone('head', point(pose, .63));
    for (let i = 0; i < 2; i++) {
      const side = i ? 'R' : 'L';
      setBone(`clavicle${side}`, pose.shoulder, pose.shoulders[i]);
      setBone(`upper_arm${side}`, pose.shoulders[i], pose.elbows[i]);
      setBone(`forearm${side}`, pose.elbows[i], pose.hands[i]);
      const hand = {x:2*pose.hands[i].x-pose.elbows[i].x, y:2*pose.hands[i].y-pose.elbows[i].y, z:2*pose.hands[i].z-pose.elbows[i].z};
      setBone(`hand${side}`, pose.hands[i], hand);
      setBone(`thigh${side}`, pose.hips[i], pose.knees[i]);
      setBone(`shin${side}`, pose.knees[i], pose.feet[i]);
      const toe = {x:pose.feet[i].x, y:pose.feet[i].y-.005, z:pose.feet[i].z+.16};
      setBone(`foot${side}`, pose.feet[i], toe);
      setBone(`toe${side}`, toe, {x:toe.x,y:toe.y-.005,z:toe.z+.09});
    }
  };
}

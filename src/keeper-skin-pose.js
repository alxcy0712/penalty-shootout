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
      const rotation = new THREE.Quaternion().setFromRotationMatrix(bind);
      const width = Math.sign(new THREE.Vector3(1,0,0).applyQuaternion(rotation).x);
      entries.set(bone.name, {bone, bind, rotation, width});
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
  const armAcross = new THREE.Vector3(), armBack = new THREE.Vector3(), armBasis = new THREE.Matrix4();
  const normal = new THREE.Vector3(), sole = new THREE.Vector3(), cross = new THREE.Vector3();
  const right = new THREE.Vector3(), up = new THREE.Vector3(), back = new THREE.Vector3();
  const scale = new THREE.Vector3(1, 1, 1);
  const point = (p, distance) => ({x:p.hip.x+p.up.x*distance, y:p.hip.y+p.up.y*distance, z:p.hip.z+p.up.z*distance});
  function setBone(name, start, end, soleUp=null, bend=null) {
    const entry = entries.get(name);
    a.copy(start);
    rotation.copy(bodyRotation).multiply(entry.rotation);
    if (end) {
      b.copy(end).sub(a).normalize();
      rest.set(0, 1, 0).applyQuaternion(rotation);
      if(name.startsWith('upper_arm')){
        // The physical IK keeps a bend margin even at full reach, so the
        // elbow plane supplies a continuous shoulder frame through every phase.
        armBack.copy(bend).sub(end).normalize();
        armAcross.crossVectors(b,armBack).normalize().multiplyScalar(-entry.width);
        armBack.crossVectors(armAcross,b).normalize();
        rotation.setFromRotationMatrix(armBasis.makeBasis(armAcross,b,armBack));
      } else {
        swing.setFromUnitVectors(rest, b);
        rotation.premultiply(swing);
      }
      if(soleUp){
        normal.set(0,1,0).applyQuaternion(entry.rotation.clone().invert()).applyQuaternion(rotation);
        normal.addScaledVector(b,-normal.dot(b)).normalize();
        sole.copy(soleUp).addScaledVector(b,-soleUp.dot(b)).normalize();
        const angle=Math.atan2(b.dot(cross.crossVectors(normal,sole)),normal.dot(sole));
        swing.setFromAxisAngle(b,angle);rotation.premultiply(swing);
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
      setBone(`upper_arm${side}`, pose.shoulders[i], pose.elbows[i],null,pose.hands[i]);
      setBone(`forearm${side}`, pose.elbows[i], pose.hands[i]);
      const hand = {x:2*pose.hands[i].x-pose.elbows[i].x, y:2*pose.hands[i].y-pose.elbows[i].y, z:2*pose.hands[i].z-pose.elbows[i].z};
      setBone(`hand${side}`, pose.hands[i], hand);
      setBone(`thigh${side}`, pose.hips[i], pose.knees[i]);
      setBone(`shin${side}`, pose.knees[i], pose.feet[i]);
      const airborne=THREE.MathUtils.smoothstep(pose.feet[i].y,.085,.19);
      const pitch=airborne*THREE.MathUtils.clamp(Math.atan2(pose.feet[i].z-pose.knees[i].z,pose.knees[i].y-pose.feet[i].y)*.45,-.65,.65);
      const yaw=pose.feetYaw?.[i]??0,facing=pose.forward.z<0?-1:1;
      const direction={x:facing*Math.sin(yaw)*Math.cos(pitch),y:Math.sin(pitch)-.03125,z:facing*Math.cos(yaw)*Math.cos(pitch)};
      const toe={x:pose.feet[i].x+direction.x*.16,y:pose.feet[i].y+direction.y*.16,z:pose.feet[i].z+direction.z*.16};
      const soleUp=new THREE.Vector3(0,1,0).lerp(up,airborne*.7).normalize();
      setBone(`foot${side}`,pose.feet[i],toe,soleUp);
      setBone(`toe${side}`,toe,{x:toe.x+direction.x*.09,y:toe.y+direction.y*.09,z:toe.z+direction.z*.09},soleUp);
    }
  };
}

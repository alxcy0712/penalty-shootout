import * as THREE from 'three';
import {smoothedKeeperWeights} from './keeper-skin-weights.js';

const shoulderSupports = new WeakMap();
export const keeperShoulderFraction=elevation=>.25+.25*THREE.MathUtils.smoothstep(elevation,.25,.85);

// Linear skinning loses volume when a vertex blends the torso with an arm
// rotated almost 180 degrees. Insert a partial-rotation deformation joint in
// that existing blend and use it to support the deltoid cap. Each vertex still
// uses at most four influences; the asset and physical joints are unchanged.
function addShoulderSupport(root) {
  if (shoulderSupports.has(root)) return;
  const smoothed=smoothedKeeperWeights(root);
  const skeletons = new Map();
  const supports = [];
  root.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const original = mesh.skeleton;
    // SkeletonUtils creates a separate Skeleton wrapper per material mesh,
    // even when those wrappers reference the same bone objects/palette.
    const palette = original.bones.map(bone => bone.uuid).join(',');
    let replacement = skeletons.get(palette);
    if (!replacement) {
      const bones = [...original.bones], inverses = original.boneInverses.map(m => m.clone());
      const arms = ['L', 'R'].map(side => {
        const armIndex = bones.findIndex(b => b.name === `upper_arm${side}`);
        const clavicleIndex = bones.findIndex(b => b.name === `clavicle${side}`);
        if (armIndex < 0 || clavicleIndex < 0) return null;
        const bone = new THREE.Bone();
        bone.name = `shoulder_support${side}`;
        root.add(bone);
        const index = bones.length;
        bones.push(bone);
        inverses.push(inverses[armIndex].clone());
        const support = {bone, arm: bones[armIndex], clavicle: bones[clavicleIndex],
          rest: new THREE.Matrix4().multiplyMatrices(inverses[clavicleIndex], inverses[armIndex].clone().invert())};
        supports.push(support);
        const forearmIndex=bones.findIndex(b=>b.name===`forearm${side}`),upperBind=inverses[armIndex].clone().invert(),lowerBind=inverses[forearmIndex].clone().invert();
        return {armIndex,clavicleIndex,index,forearmIndex,upperInverse:inverses[armIndex],upperBind,elbowPosition:new THREE.Vector3().setFromMatrixPosition(lowerBind),elbowAxis:new THREE.Vector3(0,1,0).transformDirection(upperBind).add(new THREE.Vector3(0,1,0).transformDirection(lowerBind)).normalize()};
      }).filter(Boolean);
      replacement = {skeleton: new THREE.Skeleton(bones, inverses), arms};
      skeletons.set(palette, replacement);
    }
    // Geometry may be shared by separately cloned characters. Keep their
    // original weights and skeleton indices intact.
    const geometry = mesh.geometry.clone();
    const indices = geometry.getAttribute('skinIndex'), weights = geometry.getAttribute('skinWeight');
    const positions = geometry.getAttribute('position');
    const boneCount=original.bones.length,globalIndices=original.bones.map(bone=>smoothed.names.indexOf(bone.name)),vertexMap=smoothed.lookup.get(mesh);
    const newIndices = new THREE.Uint16BufferAttribute(indices.count * 4, 4);
    const newWeights = new THREE.Float32BufferAttribute(weights.count * 4, 4);
    for (let v = 0; v < weights.count; v++) {
      const influences = new Map();
      for(let index=0;index<boneCount;index++){const weight=smoothed.field[vertexMap[v]*smoothed.count+globalIndices[index]];if(weight>1e-8)influences.set(index,weight);}
      // The donor is a muscular superhero mesh. A small bind-space taper
      // gives flexed elbows realistic soft-tissue clearance without extra bones
      // or collapsing an entire upper arm toward a shoulder helper.
      const vertex=new THREE.Vector3().fromBufferAttribute(positions,v);
      for(const part of replacement.arms){
        const armWeight=influences.get(part.armIndex)??0,lowerWeight=influences.get(part.forearmIndex)??0;
        if(armWeight+lowerWeight<.6)continue;
        const offset=vertex.clone().sub(part.elbowPosition),along=offset.dot(part.elbowAxis),profile=1-THREE.MathUtils.smoothstep(Math.abs(along),.015,.12);
        vertex.addScaledVector(offset.addScaledVector(part.elbowAxis,-along),-.28*profile);
        if(armWeight>.5){
          const local=vertex.clone().applyMatrix4(part.upperInverse),capProfile=1-THREE.MathUtils.smoothstep(Math.abs(local.y),.025,.16);
          local.x*=1-.12*capProfile;local.z*=1-.12*capProfile;vertex.copy(local.applyMatrix4(part.upperBind));
        }
      }
      positions.setXYZ(v,vertex.x,vertex.y,vertex.z);
      for (const {armIndex, clavicleIndex, index} of replacement.arms) {
        const arm = influences.get(armIndex) ?? 0, clavicle = influences.get(clavicleIndex) ?? 0;
        if (arm <= 0 || clavicle <= 0) continue;
        influences.delete(armIndex); influences.delete(clavicleIndex);
        influences.set(index, 2 * Math.min(arm, clavicle));
        if (arm > clavicle) influences.set(armIndex, arm - clavicle);
        else if (clavicle > arm) influences.set(clavicleIndex, clavicle - arm);
      }
      // The fitted donor cap extends above the humeral pivot. Rotating that
      // entire cap with the humerus swings its back edge through the chest on
      // high reaches. Support the cap and medial sleeve, tapering across the
      // full deltoid instead of creating a hard y=1.32 shoulder/armpit seam.
      // These metre-space bounds describe the shipped fitted keeper mesh.
      const cap = .95 * THREE.MathUtils.smoothstep(positions.getY(v), 1.30, 1.45)
        * (1 - THREE.MathUtils.smoothstep(Math.abs(positions.getX(v)), .25, .33));
      for (const {armIndex, index} of replacement.arms) {
        const transfer = (influences.get(armIndex) ?? 0) * cap;
        if (transfer <= 0) continue;
        influences.set(armIndex, influences.get(armIndex) - transfer);
        influences.set(index, (influences.get(index) ?? 0) + transfer);
      }
      const retained = [...influences].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const total = retained.reduce((sum, [, weight]) => sum + weight, 0);
      let k = 0;
      for (const [index, weight] of retained) {
        newIndices.setComponent(v, k, index); newWeights.setComponent(v, k++, weight / total);
      }
    }
    geometry.setAttribute('skinIndex', newIndices); geometry.setAttribute('skinWeight', newWeights);
    mesh.geometry = geometry; mesh.skeleton = replacement.skeleton;
  });
  shoulderSupports.set(root, supports);
  root.updateWorldMatrix(true, true);
  updateKeeperShoulderSupport(root);
}

const supportWorld = new THREE.Matrix4(), supportLocal = new THREE.Matrix4();
const supportRotation = new THREE.Quaternion(), armRotation = new THREE.Quaternion();
const supportPosition = new THREE.Vector3(), supportScale = new THREE.Vector3(1, 1, 1);

// Also called after clip-based arm correction so the optional helpers never
// retain a stale procedural pose when the same rig is used for a replay.
export function updateKeeperShoulderSupport(root) {
  for (const {bone, arm, clavicle, rest} of shoulderSupports.get(root) ?? []) {
    supportWorld.multiplyMatrices(clavicle.matrixWorld, rest);
    supportWorld.decompose(supportPosition, supportRotation, supportScale);
    arm.getWorldQuaternion(armRotation); arm.getWorldPosition(supportPosition);
    const chest=root.getObjectByName('chest'),bodyUp=new THREE.Vector3(0,1,0).applyQuaternion(chest.getWorldQuaternion(new THREE.Quaternion()));
    const elevation=new THREE.Vector3(0,1,0).applyQuaternion(armRotation).dot(bodyUp);
    supportRotation.slerp(armRotation, keeperShoulderFraction(elevation));
    supportWorld.compose(supportPosition, supportRotation, supportScale);
    supportLocal.copy(bone.parent.matrixWorld).invert().multiply(supportWorld);
    supportLocal.decompose(bone.position, bone.quaternion, bone.scale);
    bone.updateMatrixWorld(true);
  }
}

// Apply the existing physical rig to a skinned character without moving any
// collision/contact targets. The asset uses the same metre-scale limb lengths.
export function createKeeperSkinPose(root, {shoulderSupport = false} = {}) {
  if (shoulderSupport) addShoulderSupport(root);
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
  const armReference = new THREE.Vector3();
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
        // Use the chest-front hemisphere for a deterministic rotation-minimizing
        // frame. A lateral reference flips across the chest; a downward one
        // flips overhead. Even blending those references makes a fast cross-body
        // reach spin the sleeve/wrist. The only remaining singularity is a
        // straight-backward arm, outside the keeper's anatomical reach space.
        armReference.copy(back);
        swing.setFromUnitVectors(rest,armReference);rotation.premultiply(swing);
        swing.setFromUnitVectors(armReference,b);rotation.premultiply(swing);
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
    updateKeeperShoulderSupport(root);
  };
}

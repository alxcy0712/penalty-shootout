import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {createKeeperSkinPose} from '../src/keeper-skin-pose.js';
import {createKeeperArmRoll} from '../src/keeper-arm-roll.js';
import {goalkeeperPose, keeperWarmupPose, holdingPose} from '../src/anatomy.js';

// Exercise the shipping mesh and weights, not a proxy capsule or test rig.
const bytes = Buffer.from(await readFile(new URL('../assets/characters/keeper-prototype.glb', import.meta.url)));
const jsonLength = bytes.readUInt32LE(12), manifest = JSON.parse(bytes.subarray(20, 20 + jsonLength));
for (const material of manifest.materials) {
  delete material.pbrMetallicRoughness?.baseColorTexture;
  delete material.pbrMetallicRoughness?.metallicRoughnessTexture;
  delete material.normalTexture;
}
bytes.fill(32, 20, 20 + jsonLength); bytes.write(JSON.stringify(manifest), 20);
await MeshoptDecoder.ready;
const source = (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'file:///')).scene;
const meshes = root => { const result = []; root.traverse(o => { if (o.isSkinnedMesh) result.push(o); }); return result; };
const position = (root, name) => root.getObjectByName(name).getWorldPosition(new THREE.Vector3());

function reach(elevation, azimuth = 0) {
  const pose = goalkeeperPose({speed:85, reach:85}, 0, 0, 1);
  pose.hip = {x:0, y:.92, z:0}; pose.shoulder = {x:0, y:1.41, z:0};
  pose.up = {x:0, y:1, z:0}; pose.right = {x:1, y:0, z:0};
  for (let i = 0; i < 2; i++) {
    const side = i ? 1 : -1;
    const direction = new THREE.Vector3(side * Math.sin(elevation) * Math.cos(azimuth),
      -Math.cos(elevation), Math.sin(elevation) * Math.sin(azimuth));
    pose.shoulders[i] = {x:side * .195, y:1.41, z:0};
    pose.elbows[i] = new THREE.Vector3().copy(pose.shoulders[i]).addScaledVector(direction, .29);
    pose.hands[i] = new THREE.Vector3().copy(pose.elbows[i]).addScaledVector(direction, .27);
  }
  return pose;
}

function shoulderVolumes(root) {
  const result = [];
  for (const mesh of meshes(root)) {
    mesh.skeleton.update();
    const {position, skinIndex, skinWeight} = mesh.geometry.attributes;
    for (let v = 0; v < position.count; v++) {
      const x = Math.abs(position.getX(v)), y = position.getY(v);
      if (x < .12 || x > .195 || y < 1.32 || y > 1.5) continue;
      let influences = 0;
      const matrix = new THREE.Matrix4(); matrix.elements.fill(0);
      for (let k = 0; k < 4; k++) {
        const index = skinIndex.getComponent(v, k), weight = skinWeight.getComponent(v, k);
        if (weight > .01) influences++;
        for (let n = 0; n < 16; n++) matrix.elements[n] += mesh.skeleton.boneMatrices[index * 16 + n] * weight;
      }
      if (influences > 1) result.push(new THREE.Matrix3().setFromMatrix4(matrix).determinant());
    }
  }
  return result.sort((a, b) => a - b);
}

test('shoulder support stays within 24 bones and does not mutate shared asset geometry', () => {
  const first = clone(source), other = clone(source);
  const originalMeshes = meshes(source), otherMeshes = meshes(other);
  const originalWeights = originalMeshes.map(m => Array.from(m.geometry.attributes.skinWeight.array));
  const originalIndices = originalMeshes.map(m => Array.from(m.geometry.attributes.skinIndex.array));
  createKeeperSkinPose(first, {shoulderSupport:true});
  const firstMeshes = meshes(first), palettes = new Set(firstMeshes.map(m => m.skeleton));
  assert.equal(palettes.size, 1, 'material meshes share one runtime palette');
  assert.equal(firstMeshes[0].skeleton.bones.length, 24);
  const helperBones = []; first.traverse(o => { if (o.name.startsWith('shoulder_support')) helperBones.push(o); });
  assert.equal(helperBones.length, 2, 'per-mesh SkeletonUtils wrappers do not duplicate helpers');
  for (let i = 0; i < firstMeshes.length; i++) {
    assert.notEqual(firstMeshes[i].geometry, originalMeshes[i].geometry);
    assert.equal(otherMeshes[i].geometry, originalMeshes[i].geometry);
    assert.equal(otherMeshes[i].skeleton.bones.length, 22);
    assert.deepEqual(Array.from(originalMeshes[i].geometry.attributes.skinWeight.array), originalWeights[i]);
    assert.deepEqual(Array.from(originalMeshes[i].geometry.attributes.skinIndex.array), originalIndices[i]);
    const {skinIndex, skinWeight} = firstMeshes[i].geometry.attributes;
    for (let v = 0; v < skinWeight.count; v++) {
      let total = 0;
      for (let k = 0; k < 4; k++) {
        const weight = skinWeight.getComponent(v, k), index = skinIndex.getComponent(v, k);
        assert.ok(weight >= 0 && Number.isFinite(weight));
        assert.ok(index < 24); total += weight;
      }
      assert.ok(Math.abs(total - 1) < 1e-5, 'four GPU influences remain normalized');
    }
  }
  createKeeperSkinPose(first, {shoulderSupport:true});
  assert.equal(meshes(first)[0].skeleton.bones.length, 24, 'setup is idempotent');
  createKeeperSkinPose(other);
  assert.equal(meshes(other)[0].skeleton.bones.length, 22, 'striker/default path retains authored skin');
});

test('front, overhead and cross-body reaches do not flip the shoulder or helper frame', () => {
  const root = clone(source), apply = createKeeperSkinPose(root, {shoulderSupport:true});
  const names = ['upper_armL', 'upper_armR', 'shoulder_supportL', 'shoulder_supportR'];
  for (const azimuth of [0, Math.PI / 4, Math.PI / 2, Math.PI * .75, Math.PI]) {
    let previous;
    for (let degree = 0; degree <= 180; degree += .25) {
      apply(reach(THREE.MathUtils.degToRad(degree), azimuth));
      const rotations = names.map(n => root.getObjectByName(n).getWorldQuaternion(new THREE.Quaternion()));
      if (previous) rotations.forEach((q, i) => assert.ok(q.angleTo(previous[i]) < .035,
        `${names[i]} stays continuous at elevation ${degree}, azimuth ${azimuth}`));
      previous = rotations;
    }
  }
});

test('overhead shoulder transition retains volume instead of collapsing under opposing rotations', () => {
  const baseline = clone(source), supported = clone(source);
  createKeeperSkinPose(baseline)(reach(Math.PI));
  createKeeperSkinPose(supported, {shoulderSupport:true})(reach(Math.PI));
  const before = shoulderVolumes(baseline), after = shoulderVolumes(supported);
  assert.ok(before.length > 100 && after.length > 100, 'samples the actual shoulder transition');
  assert.ok(after[0] > before[0] * 2, `minimum local volume: ${before[0]} -> ${after[0]}`);
  assert.ok(after[Math.floor(after.length * .5)] > before[Math.floor(before.length * .5)] + .15,
    'median blended shoulder volume improves materially');
});

test('shoulders, landing calves and recovery boots stay separate at measured skin crossing regressions', async () => {
  const shoulder = JSON.parse(await readFile(new URL('./fixtures/keeper-shoulder-crossings.json', import.meta.url))).crossings;
  const legs = JSON.parse(await readFile(new URL('./fixtures/keeper-leg-crossings.json', import.meta.url))).crossings;
  const crossings=[...shoulder,...legs];
  assert.ok(legs.length>50,'includes both-sided measured landing and recovery skin crossings');
  assert.ok(crossings.length > 50, 'checks the measured pre-fix surface failures on both sides');
  const root = clone(source), apply = createKeeperSkinPose(root, {shoulderSupport:true});
  const roll = createKeeperArmRoll(root), ray = new THREE.Ray();
  const direction = new THREE.Vector3(), hit = new THREE.Vector3(), normal = new THREE.Vector3();
  function crosses(a, b) {
    // Strict transverse crossings only. Coplanar shared seams and tangential
    // contact are not an arm penetrating the chest.
    for (const [surface, other] of [[a,b], [b,a]]) {
      normal.crossVectors(surface[1].clone().sub(surface[0]), surface[2].clone().sub(surface[0])).normalize();
      const distances = other.map(p => normal.dot(p.clone().sub(surface[0])));
      if (Math.min(...distances) >= -1e-8 || Math.max(...distances) <= 1e-8) return false;
    }
    for (const [edges, surface] of [[a,b], [b,a]]) for (let i = 0; i < 3; i++) {
      direction.subVectors(edges[(i + 1) % 3], edges[i]);
      const length = direction.length();
      ray.set(edges[i], direction.normalize());
      if (ray.intersectTriangle(...surface, false, hit) && hit.distanceTo(edges[i]) < length - 1e-8) return true;
    }
    return false;
  }
  let previousPose;
  for (const {pose, faces} of crossings) {
    const key = JSON.stringify(pose);
    if (key !== previousPose) {
      apply(goalkeeperPose({speed:85, reach:85}, pose.d, pose.t, pose.h)); roll();
      for (const mesh of meshes(root)) mesh.skeleton.update();
      previousPose = key;
    }
    const triangles = faces.map(({mesh:name, vertices}) => {
      const mesh = root.getObjectByName(name);
      return vertices.map(i => mesh.applyBoneTransform(i, new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, i)));
    });
    assert.equal(crosses(...triangles), false,
      `measured limb surfaces stay separate: ${key}, faces ${faces.map(f => f.face)}`);
  }
});

test('supported shoulder skin preserves collision endpoints and is deterministic under scrubbing', () => {
  const root = clone(source), apply = createKeeperSkinPose(root, {shoulderSupport:true}), roll = createKeeperArmRoll(root);
  const parent = new THREE.Group(); parent.position.set(3, .4, -2); parent.rotation.set(.1, .8, -.2); parent.scale.setScalar(1.3); parent.add(root);
  let previousPose;
  for (const direction of [-1, 0, 1]) for (let frame = 0; frame <= 240; frame += 3) {
    const t = frame / 60, raw = goalkeeperPose({speed:85, reach:85, stretch:1}, direction, t, 2.2);
    for (const pose of [raw, holdingPose(raw).pose, keeperWarmupPose(t)]) {
      const before = structuredClone(pose); apply(pose); roll();
      assert.deepEqual(pose, before, 'visual deformation never edits physics input');
      for (let i = 0; i < 2; i++) for (const [bone, key] of [['upper_arm','shoulders'], ['forearm','elbows'], ['hand','hands'], ['shin','knees'], ['foot','feet']]) {
        const target = new THREE.Vector3().copy(pose[key][i]).applyMatrix4(root.matrixWorld);
        assert.ok(position(root, bone + (i ? 'R' : 'L')).distanceTo(target) < 1e-5);
      }
      const expected = ['L', 'R'].map(side => root.getObjectByName('shoulder_support' + side).matrixWorld.clone());
      if (previousPose) { apply(previousPose); roll(); }
      apply(pose); roll();
      expected.forEach((matrix, i) => root.getObjectByName('shoulder_support' + (i ? 'R' : 'L')).matrixWorld.elements.forEach((value, n) => {
        assert.ok(Math.abs(value - matrix.elements[n]) < 1e-7, 'helpers are stateless when scrubbing');
      }));
      previousPose = pose;
    }
  }
});

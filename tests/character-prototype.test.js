import {test as nodeTest} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {body} from '../src/anatomy.js';
import {attachJerseyNumber} from '../src/character-prototype-preview.js';

for (const asset of ['striker-prototype-refined', 'striker-quaternius']) {
const test = (name, run) => nodeTest(`${asset}: ${name}`, run);
const metadata = JSON.parse(await readFile(new URL(`../assets/characters/${asset}.json`, import.meta.url), 'utf8'));
const bytes = await readFile(new URL(`../assets/characters/${asset}.glb`, import.meta.url));
// Node verifies actual skinning/animations while the browser verifies decoded textures.
const geometryBytes = Buffer.from(bytes);
const jsonLength = geometryBytes.readUInt32LE(12);
const manifest = JSON.parse(geometryBytes.subarray(20, 20 + jsonLength).toString());
const geometryManifest = structuredClone(manifest);
for (const material of geometryManifest.materials) {
  delete material.pbrMetallicRoughness?.baseColorTexture;
  delete material.pbrMetallicRoughness?.metallicRoughnessTexture;
  delete material.normalTexture;
}
geometryBytes.fill(32, 20, 20 + jsonLength);
geometryBytes.write(JSON.stringify(geometryManifest), 20);
await MeshoptDecoder.ready;
const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(
  geometryBytes.buffer.slice(geometryBytes.byteOffset, geometryBytes.byteOffset + geometryBytes.byteLength),
  'file:///',
);
const clip = gltf.animations[0];
const bones = [];
const skinnedMeshes = [];
const materials = new Set();
let triangleCount = 0;
gltf.scene.traverse(object => {
  if (object.isBone) bones.push(object.name);
  if (!object.isMesh) return;
  if (object.isSkinnedMesh) skinnedMeshes.push(object);
  triangleCount += object.geometry.index
    ? object.geometry.index.count / 3
    : object.geometry.attributes.position.count / 3;
  for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
    materials.add(material);
  }
});

const mixer = new THREE.AnimationMixer(gltf.scene);
const action = mixer.clipAction(clip);
action.play();
action.paused = true;

function sample(time) {
  action.time = THREE.MathUtils.clamp(time, 0, clip.duration);
  mixer.update(0);
  gltf.scene.updateWorldMatrix(true, true);
}

function worldPosition(name) {
  const point = new THREE.Vector3();
  gltf.scene.getObjectByName(name).getWorldPosition(point);
  return point;
}

test('striker GLB fits its mobile asset budget and exports the complete skeleton clip', () => {
  if (asset === 'striker-quaternius') {
    assert.match(metadata.source, /Quaternius/);
    assert.match(metadata.license, /CC0-1.0/);
  } else {
    assert.equal(metadata.source, 'Original procedural mesh and animation authored in-project with Blender; no third-party assets');
    assert.equal(metadata.license, 'No third-party assets; the repository has no stated license');
  }
  assert.ok(bytes.byteLength <= metadata.budgets.glbBytes);
  assert.ok(triangleCount <= metadata.budgets.triangles);
  assert.ok(bones.length <= metadata.budgets.bones);
  assert.ok(materials.size <= metadata.budgets.materials);
  assert.equal(metadata.textures, manifest.images?.length ?? 0);
  assert.equal(bytes.byteLength, metadata.glbBytes);
  assert.equal(triangleCount, metadata.triangles);
  assert.equal(bones.length, metadata.bones);
  assert.equal(materials.size, metadata.materials);
  assert.equal(skinnedMeshes.length, metadata.meshes);
  assert.ok(skinnedMeshes.length > 0);
  assert.ok(bones.includes('pelvis') && bones.includes('chest'));
  assert.ok(bones.includes('thighL') && bones.includes('shinL') && bones.includes('footL'));
  assert.ok(bones.includes('thighR') && bones.includes('shinR') && bones.includes('footR'));
  assert.ok(Math.abs(clip.duration - metadata.durationSeconds) < 1 / metadata.framesPerSecond);
  assert.equal(Math.min(...clip.tracks.map(track => track.times[0])), 0);
  assert.ok(Math.max(...clip.tracks.map(track => track.times.at(-1))) > metadata.contactSeconds);
  assert.ok(metadata.contactSeconds > metadata.supportFootLock.fromSeconds);
  assert.ok(metadata.contactSeconds < metadata.supportFootLock.toSeconds);
});

test('visual limb bones retain the collision rig lengths throughout the shot', () => {
  for (let frame = 0; frame <= Math.round(metadata.durationSeconds * metadata.framesPerSecond); frame++) {
    sample(frame / metadata.framesPerSecond);
    for (const side of ['L', 'R']) {
      const upperArm = worldPosition(`upper_arm${side}`).distanceTo(worldPosition(`forearm${side}`));
      const forearm = worldPosition(`forearm${side}`).distanceTo(worldPosition(`hand${side}`));
      assert.ok(Math.abs(upperArm - body.upperArm) < 0.015, `${side} upper arm is ${upperArm} m at frame ${frame}`);
      assert.ok(Math.abs(forearm - body.forearm) < 0.015, `${side} forearm is ${forearm} m at frame ${frame}`);
      const thighLength = worldPosition(`thigh${side}`).distanceTo(worldPosition(`shin${side}`));
      const shinLength = worldPosition(`shin${side}`).distanceTo(worldPosition(`foot${side}`));
      assert.ok(Math.abs(thighLength - body.thigh) < 0.015, `${side} thigh is ${thighLength} m at frame ${frame}`);
      assert.ok(Math.abs(shinLength - body.shin) < 0.015, `${side} shin is ${shinLength} m at frame ${frame}`);
    }
  }
});

test('support foot remains beside the ball through contact and the character stays above the pitch', () => {
  const start = metadata.supportFootLock.fromSeconds;
  const end = metadata.supportFootLock.toSeconds;
  const target = new THREE.Vector3(...metadata.supportFootLock.assetSceneTargetMeters);
  let reference;
  for (let time = start; time <= end; time += 0.11) {
    sample(time);
    const support = worldPosition('footL');
    assert.ok(support.distanceTo(target) < 0.025, `support foot missed target by ${support.distanceTo(target)} m at ${time.toFixed(2)} s`);
    if (!reference) reference = support.clone();
    assert.ok(support.distanceTo(reference) < 0.025, `support foot drifted ${support.distanceTo(reference)} m at ${time.toFixed(2)} s`);
    for (const mesh of skinnedMeshes) {
      mesh.computeBoundingBox();
      assert.ok(mesh.boundingBox.min.y >= -0.015, `mesh penetrates pitch at ${time.toFixed(2)} s`);
      assert.ok(mesh.boundingBox.max.y <= 2.05, `mesh stretches above expected height at ${time.toFixed(2)} s`);
    }
  }
});

test('sock vertices below the knee are weighted to the shin and ankle, with normalized weights', () => {
  let checked = 0;
  for (const mesh of skinnedMeshes) {
    const {position, skinIndex, skinWeight} = mesh.geometry.attributes;
    for (let i = 0; i < position.count; i++) {
      let sum = 0;
      for (let j = 0; j < 4; j++) {
        const weight = skinWeight.getComponent(i, j);
        sum += weight;
        if (mesh.material.name === 'Socks' && position.getY(i) < 0.30 && weight > 0.001) {
          const bone = mesh.skeleton.bones[skinIndex.getComponent(i, j)].name;
          assert.match(bone, /^(shin|foot|toe)[LR]$/, `lower sock attached to ${bone} weight=${weight} point=${position.getX(i)},${position.getY(i)},${position.getZ(i)}`);
          checked++;
        }
      }
      assert.ok(Math.abs(sum - 1) < 0.001);
    }
  }
  assert.ok(checked > 100);
});

test('jersey number inherits the chest skin transform when scrubbing and rotating', () => {
  const number = new THREE.Object3D();
  const anchor = asset === 'striker-quaternius' ? [0, 1.345, .18] : [0, 1.345, .128];
  attachJerseyNumber(gltf.scene, number, anchor);
  const skin = skinnedMeshes.find(mesh => mesh.material.name === 'Kit');
  const chestIndex = skin.skeleton.bones.findIndex(bone => bone.name === 'chest');
  for (const time of [0, 1.2, 1.9, 2.3, 3.55, 1.9, 0]) {
    sample(time);
    skin.skeleton.update();
    const deformation = new THREE.Matrix4().fromArray(skin.skeleton.boneMatrices, chestIndex * 16);
    const expected = new THREE.Vector3(...anchor).applyMatrix4(deformation);
    assert.ok(number.getWorldPosition(new THREE.Vector3()).distanceTo(expected) < 1e-6);
    assert.equal(number.parent.name, 'chest');
  }
  number.removeFromParent();
});

test('striking toe reaches the physical ball at the shared contact event', () => {
  sample(metadata.contactSeconds);
  const toe = worldPosition('toeR');
  assert.ok(toe.distanceTo(new THREE.Vector3(0, 0.11, 0)) < 0.115, `toe misses ball: ${toe.toArray()}`);
});

test('the complete clip has finite joint motion and scrubs deterministically', () => {
  const names = ['pelvis', 'head', 'shinL', 'shinR', 'footL', 'footR', 'handL', 'handR'];
  sample(0);
  let previous = names.map(worldPosition);
  for (let frame = 1; frame <= metadata.durationSeconds * 240; frame++) {
    sample(frame / 240);
    const current = names.map(worldPosition);
    current.forEach((point, i) => assert.ok(point.distanceTo(previous[i]) < 0.04, `${names[i]} jumps at ${frame / 240}`));
    previous = current;
  }
  sample(1.9);
  const expected = names.map(worldPosition);
  sample(0.8);
  sample(1.9);
  names.map(worldPosition).forEach((point, i) => assert.ok(point.distanceTo(expected[i]) < 1e-8));
});

if (asset === 'striker-quaternius') {
  test('approach alternates planted feet without double airborne steps or stance drift', () => {
    for (let time = .35; time < 1.37; time += 1 / 120) {
      sample(time);
      assert.ok(Math.min(worldPosition('footL').y, worldPosition('footR').y) < .071, `both feet airborne at ${time}`);
    }
    for (const [side, start, end] of [['L', .35, .76], ['R', .76, 1.10], ['L', 1.10, 1.34]]) {
      sample(start);
      const contact = worldPosition(`foot${side}`);
      for (let time = start; time < end; time += 1 / 120) {
        sample(time);
        assert.ok(worldPosition(`foot${side}`).distanceTo(contact) < .003, `${side} stance slides at ${time}: ${worldPosition(`foot${side}`).toArray()} vs ${contact.toArray()}`);
      }
    }
  });
  test('arms relax at rest and vary elbow flexion during the approach', () => {
    sample(0);
    for (const side of ['L','R']) assert.ok(worldPosition(`hand${side}`).y < worldPosition('pelvis').y+.04);
    for (const side of ['L','R']) {
      const angles=[];
      for (let time=.35; time<1.6; time+=1/60) {
        sample(time);
        const upper=worldPosition(`forearm${side}`).sub(worldPosition(`upper_arm${side}`));
        const lower=worldPosition(`hand${side}`).sub(worldPosition(`forearm${side}`));
        angles.push(upper.angleTo(lower));
      }
      assert.ok(Math.max(...angles)-Math.min(...angles)>.5, `${side} elbow stays rigid`);
    }
  });
  test('approach swing speed stays bounded and eases into each landing', () => {
    for (const [side,start,end] of [['R',.45,.75],['L',.77,1.09],['R',1.11,1.33],['L',1.35,1.57]]) {
      sample(start);
      let previous=worldPosition(`foot${side}`);
      for (let time=start+1/120; time<=end; time+=1/120) {
        sample(time);
        const point=worldPosition(`foot${side}`);
        assert.ok(point.distanceTo(previous)*120<4.8, `${side} foot jerks at ${time}`);
        previous=point;
      }
      sample(end-1/60);
      const approach=worldPosition(`foot${side}`);
      sample(end);
      assert.ok(worldPosition(`foot${side}`).distanceTo(approach)*60<.35, `${side} landing has abrupt speed`);
    }
  });
  test('pelvis loads the support side and shoulders follow chest rotation through release', () => {
    sample(metadata.contactSeconds);
    assert.ok(worldPosition('pelvis').x < -.04);
    const shoulderAxis = worldPosition('upper_armR').sub(worldPosition('upper_armL'));
    assert.ok(Math.abs(shoulderAxis.z) > .025, 'shoulders must turn with the chest');
    const hipAxis = worldPosition('thighR').sub(worldPosition('thighL'));
    assert.ok(Math.abs(hipAxis.z) > .03, 'hip sockets must follow pelvic rotation');
  });
}

test('the whole skinned clip stays above turf without abnormal stretching', () => {
  for (let frame = 0; frame <= metadata.durationSeconds * 60; frame++) {
    sample(frame / 60);
    for (const mesh of skinnedMeshes) {
      mesh.computeBoundingBox();
      assert.ok(mesh.boundingBox.min.y >= -0.015, `${mesh.name} crosses turf at ${frame / 60}: ${mesh.boundingBox.min.y}`);
      assert.ok(mesh.boundingBox.max.y <= 2.05);
      assert.ok(mesh.boundingBox.max.x - mesh.boundingBox.min.x < 2.0);
    }
  }
});

}

import {test as nodeTest} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';

const asset = "striker-mocap";
const test = nodeTest;
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

test('mocap exports finite continuous fixed-length limbs and synchronized contact', () => {
  assert.equal(metadata.sourceStartSeconds, 3.15);
  assert.equal(metadata.contactSeconds, 1.85);
  assert.ok(Math.abs(clip.duration - metadata.durationSeconds) < .02);
  const links = [['upper_armL','forearmL',.29],['forearmL','handL',.27],['thighL','shinL',.43],['shinL','footL',.43],['upper_armR','forearmR',.29],['forearmR','handR',.27],['thighR','shinR',.43],['shinR','footR',.43]];
  let minY=Infinity, maxStep=0, lowest;
  let previous;
  for(let i=0;i<=840;i++) {
    sample(i/240);
    for(const [a,b,length] of links) assert.ok(Math.abs(worldPosition(a).distanceTo(worldPosition(b))-length)<.008, `${a} length at ${i/240}`);
    const points=bones.map(worldPosition);
    for(const p of points) assert.ok(p.toArray().every(Number.isFinite));
    if(previous) for(let j=0;j<points.length;j++) maxStep=Math.max(maxStep,points[j].distanceTo(previous[j]));
    previous=points;
    if(i%4===0) for(const mesh of skinnedMeshes) {
      mesh.skeleton.update();
      for(let v=0;v<mesh.geometry.attributes.position.count;v++){
        const p=new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,v);
        mesh.applyBoneTransform(v,p);p.applyMatrix4(mesh.matrixWorld); if(p.y<minY){minY=p.y;lowest={time:i/240,mesh:mesh.name,material:mesh.material.name,vertex:v,point:p.toArray()};}
      }
    }
  }
  sample(metadata.contactSeconds);
  const foot=gltf.scene.getObjectByName('footL');
  const contact=foot.localToWorld(new THREE.Vector3(0,.23,0));
  console.log({minY,maxStep,lowest,contact:contact.toArray(),bytes:bytes.length});
  assert.ok(maxStep<.07, 'no discontinuous joint jumps at 240 Hz');
  assert.ok(minY>-.02, 'skin stays above ground within 2 cm');
  assert.ok(Math.abs(contact.distanceTo(new THREE.Vector3(0,.11,0))-.11)<.02, 'shoe tip reaches the ball surface on event');
});

test('mocap support foot remains planted through contact and follow-through', () => {
  sample(1.65);
  const planted=worldPosition('footR');
  let drift=0;
  for(let i=99;i<=153;i++) {
    sample(i/60);
    drift=Math.max(drift,worldPosition('footR').distanceTo(planted));
  }
  assert.ok(drift<.005, `support foot drift ${drift} m`);
  assert.ok(bytes.length<=metadata.budgets.glbBytes);
  assert.equal(bones.length,22);
  assert.equal(triangleCount,17518);
});

test('idle arms hang below the hips and wrists follow the forearms through the transition', () => {
  for (const time of [0, .15, .35]) {
    sample(time);
    for (const side of ['L', 'R']) {
      const shoulder = worldPosition(`upper_arm${side}`);
      const elbow = worldPosition(`forearm${side}`);
      const wrist = worldPosition(`hand${side}`);
      const direction = elbow.clone().sub(shoulder).normalize();
      assert.ok(direction.dot(new THREE.Vector3(0, -1, 0)) > .97, 'upper arm rests near vertical');
      assert.ok(wrist.y < worldPosition('pelvis').y, 'idle wrist rests below pelvis');
    }
  }
  const previous = {};
  for (let frame = 0; frame <= 840; frame++) {
    sample(frame / 240);
    for (const side of ['L', 'R']) {
      const wrist = worldPosition(`hand${side}`);
      const forearm = wrist.clone().sub(worldPosition(`forearm${side}`)).normalize();
      const handBone = gltf.scene.getObjectByName(`hand${side}`);
      const hand = handBone.localToWorld(new THREE.Vector3(0, .08, 0)).sub(wrist).normalize();
      assert.ok(hand.dot(forearm) > .98, 'wrist avoids synthetic finger-channel deflection');
      if (previous[side]) assert.ok(hand.angleTo(previous[side]) < .15, 'no abrupt wrist rotation');
      previous[side] = hand;
    }
  }
});

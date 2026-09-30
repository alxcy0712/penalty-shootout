import {test as nodeTest} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';

const asset = "keeper-prototype";
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
function worldPosition(name) {
  const point = new THREE.Vector3();
  gltf.scene.getObjectByName(name).getWorldPosition(point);
  return point;
}

test('keeper captures preserve limb lengths, floor clearance and continuity', () => {
  assert.equal(gltf.animations.length, 2);
  assert.ok(bytes.length <= metadata.budgets.glbBytes);
  for (const clip of gltf.animations) {
    mixer.stopAllAction();
    const action=mixer.clipAction(clip); action.play(); action.paused=true;
    let minimum=Infinity, maxStep=0, previous;
    for(let frame=0;frame<=Math.ceil(clip.duration*120);frame++) {
      action.time=Math.min(frame/120,clip.duration);mixer.update(0);gltf.scene.updateWorldMatrix(true,true);
      const points=bones.map(worldPosition);
      for(const p of points) assert.ok(p.toArray().every(Number.isFinite));
      if(previous) points.forEach((p,i)=>maxStep=Math.max(maxStep,p.distanceTo(previous[i])));
      previous=points;
      for(const side of ['L','R']) for(const [a,b,length] of [['upper_arm','forearm',.29],['forearm','hand',.27],['thigh','shin',.43],['shin','foot',.43]])
        assert.ok(Math.abs(worldPosition(a+side).distanceTo(worldPosition(b+side))-length)<.008);
      for(const mesh of skinnedMeshes) {
        mesh.skeleton.update();
        for(let i=0;i<mesh.geometry.attributes.position.count;i++) {
          const p=new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,i);
          mesh.applyBoneTransform(i,p);p.applyMatrix4(mesh.matrixWorld);minimum=Math.min(minimum,p.y);
        }
      }
    }
    console.log({clip:clip.name,duration:clip.duration,minimum,maxStep});
    assert.ok(minimum>-.02, 'skin floor clearance');
    assert.ok(maxStep<.1, 'joint continuity at 120 Hz');
  }
});

test('procedural goalkeeper skin keeps physical wrist, knee and ankle targets unchanged', async () => {
  const {createKeeperSkinPose}=await import('../src/keeper-skin-pose.js');
  const {goalkeeperPose,holdingPose,keeperWarmupPose,keeperHesitationPose,keeperPreparation}=await import('../src/anatomy.js');
  mixer.stopAllAction();
  const apply=createKeeperSkinPose(gltf.scene),stats={speed:85,reach:85};
  for(const d of [-1,1])for(let frame=0;frame<=180;frame++) {
    const t=frame/60;
    const poses=[goalkeeperPose(stats,d,t,2),goalkeeperPose(stats,d,t,.35),keeperWarmupPose(t),keeperPreparation(stats,d,Math.min(t,.8),.8,1.2),holdingPose(goalkeeperPose(stats,d,t,2)).pose,keeperHesitationPose(goalkeeperPose(stats,d,.1,1.2),d,t,goalkeeperPose(stats,d,.099,1.2))];
    for(const p of poses){
      const before=structuredClone(p);apply(p);gltf.scene.updateWorldMatrix(true,true);
      assert.deepEqual(p,before,'visual adapter preserves physics pose');
      for(let i=0;i<2;i++)for(const [bone,key] of [['hand','hands'],['forearm','elbows'],['shin','knees'],['foot','feet']]) {
        assert.ok(worldPosition(bone+(i?'R':'L')).distanceTo(new THREE.Vector3().copy(p[key][i]))<1e-5,`${bone} matches ${key}`);
      }
    }
  }
});

test('arm correction preserves contacts, shoulder roll and a straight wrist on every frame', async () => {
  const {createKeeperArmRoll}=await import('../src/keeper-arm-roll.js');
  const {createKeeperSkinPose}=await import('../src/keeper-skin-pose.js');
  const {goalkeeperPose,keeperWarmupPose,holdingPose}=await import('../src/anatomy.js');
  const correct=createKeeperArmRoll(gltf.scene),apply=createKeeperSkinPose(gltf.scene);
  const names=['upper_armL','forearmL','handL','upper_armR','forearmR','handR'];
  function verify(){
    gltf.scene.updateWorldMatrix(true,true);
    const before=names.map(worldPosition);
    const shoulders=['L','R'].map(side=>gltf.scene.getObjectByName('upper_arm'+side).quaternion.clone());
    correct();
    names.forEach((n,i)=>assert.ok(worldPosition(n).distanceTo(before[i])<1e-6,'arm joints retain their targets'));
    for(const [i,side] of ['L','R'].entries()){
      const upper=gltf.scene.getObjectByName('upper_arm'+side),forearm=gltf.scene.getObjectByName('forearm'+side),hand=gltf.scene.getObjectByName('hand'+side);
      assert.ok(upper.quaternion.clone().normalize().angleTo(shoulders[i].clone().normalize())<1e-4,'elbow correction preserves shoulder roll');
      const axis=new THREE.Vector3(0,1,0),direction=axis.clone().applyQuaternion(forearm.quaternion);
      assert.ok(forearm.quaternion.angleTo(new THREE.Quaternion().setFromUnitVectors(axis,direction))<1e-4,'forearm carries pure hinge swing');
      assert.ok(axis.clone().applyQuaternion(hand.quaternion).distanceTo(axis)<1e-4,'wrist extends along the forearm');
    }
    const expected=names.map(n=>gltf.scene.getObjectByName(n).quaternion.clone());correct();
    names.forEach((n,i)=>assert.ok(gltf.scene.getObjectByName(n).quaternion.clone().normalize().angleTo(expected[i].clone().normalize())<1e-4,'correction is idempotent'));
  }
  for(const clip of gltf.animations){
    mixer.stopAllAction();const action=mixer.clipAction(clip);action.play();action.paused=true;
    for(let f=0;f<=Math.floor(clip.duration*120);f++){action.time=f/120;mixer.update(0);verify();}
  }
  mixer.stopAllAction();
  for(const d of [-1,1])for(let f=0;f<=480;f++){
    const t=f/120,p=goalkeeperPose({speed:85,reach:85},d,t,2);
    for(const pose of [p,holdingPose(p).pose,keeperWarmupPose(t)]){apply(pose);verify();}
  }
});

test('rounded keeper shoulder caps share the upper arm pivots and retain their radius', () => {
  const checked={L:0,R:0};
  for(const mesh of skinnedMeshes){
    if(mesh.material.name!=='Kit')continue;
    const {position,skinIndex,skinWeight}=mesh.geometry.attributes;
    for(let i=0;i<position.count;i++){
      const index=skinIndex.getX(i),name=mesh.skeleton.bones[index].name;
      if(!name.startsWith('upper_arm'))continue;
      assert.ok(skinWeight.getX(i)>.999,'sleeve follows the upper arm');
      const local=new THREE.Vector3().fromBufferAttribute(position,i).applyMatrix4(mesh.bindMatrix).applyMatrix4(mesh.skeleton.boneInverses[index]);
      if(local.y>.002)continue;
      assert.ok(local.length()>.072&&local.length()<.086,'shoulder cap surrounds the joint with a stable radius');
      checked[name.at(-1)]++;
    }
  }
  for(const side of ['L','R'])assert.ok(checked[side]>=60,'checks the full shoulder cap');
});

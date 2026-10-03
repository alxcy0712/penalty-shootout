import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {loadCharacter,skinMinimum,skinSurfaceDistance} from './helpers/load-character.js';
const metadata=JSON.parse(await readFile(new URL('../assets/characters/mocap-variants/cmu-10_03-kick.json',import.meta.url)));
const bytes=await readFile(new URL('../assets/characters/mocap-variants/cmu-10_03-kick.glb',import.meta.url));
const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const clip=gltf.animations.find(clip=>clip.name===metadata.clipName);
async function player(){const actor=await loadCharacter(false),mixer=new THREE.AnimationMixer(actor.root),action=mixer.clipAction(clip).setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();action.paused=true;return{root:actor.root,at(time){action.enabled=true;action.time=Math.max(0,Math.min(metadata.durationSeconds,time));mixer.update(0);actor.root.updateMatrixWorld(true);}};}
const position=(root,name)=>root.getObjectByName(name).getWorldPosition(new THREE.Vector3());

test('second striker animation is a separately sourced CMU10_03 take with the compatible 22-bone rig',async()=>{
 const source=await readFile(new URL('../'+metadata.source,import.meta.url));
 assert.equal(createHash('sha256').update(source).digest('hex'),metadata.sourceSha256);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),metadata.sha256);
 assert.equal(clip.name,'CMU_10_03_Kick');assert.equal(metadata.contactSeconds,1.125);assert.equal(metadata.durationSeconds,2.5);
 assert.ok(metadata.sourceStartSeconds===.05&&metadata.sourceEndSeconds===2.55);
 const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));assert.equal(json.meshes,undefined,'animation-only delivery does not replace the production mesh');
 const actor=await player(),names=new Set();for(const track of clip.tracks){const name=track.name.split('.')[0];names.add(name);assert.ok(actor.root.getObjectByName(name)?.isBone,`existing bone binding ${name}`);}assert.equal(names.size,22);
});

test('real10_03 boot contact, supporting foot and finished stance stay physically grounded',async()=>{
 const actor=await player();for(const yaw of [-.3,0,.3]){actor.root.position.set(0,0,11);actor.root.rotation.y=Math.PI+yaw;actor.at(metadata.contactSeconds);assert.ok(Math.abs(skinSurfaceDistance(actor.root,new THREE.Vector3(0,.11,11),'Boots')-.11)<.002,'actual boot touches the ball, not a virtual toe proxy');}
 actor.root.position.set(0,0,0);actor.root.rotation.set(0,0,0);let anchor,drift=0,minimum=Infinity;
 for(let frame=0;frame<=Math.round(metadata.durationSeconds*240);frame++){
  const time=frame/240;actor.at(time);
  if(time>=metadata.supportPlantSeconds&&time<=metadata.supportReleaseSeconds){const p=position(actor.root,'footR');anchor??=p.clone();drift=Math.max(drift,anchor.distanceTo(p));}
  if(frame%4===0)minimum=Math.min(minimum,skinMinimum(actor.root));
 }
 assert.ok(drift<.005,`plant drift ${drift}`);assert.ok(minimum>-.005,`true skin floor ${minimum}`);
 for(const side of ['L','R'])assert.ok(position(actor.root,'foot'+side).y<.08,'both feet have landed before the source clip ends');
 const end=['pelvis','footL','footR'].map(name=>position(actor.root,name));actor.at(9);end.forEach((point,i)=>assert.ok(point.distanceTo(position(actor.root,['pelvis','footL','footR'][i]))<1e-8));
});

test('real10_03 joints keep fixed lengths and continuous frames with deterministic scrubbing',async()=>{
 const actor=await player(),bones=[];actor.root.traverse(bone=>{if(bone.isBone)bones.push(bone);});let previous,maxStep=0,maxRotation=0;
 for(let frame=0;frame<=600;frame++){
  actor.at(frame/240);const points=bones.map(b=>b.getWorldPosition(new THREE.Vector3())),rotations=bones.map(b=>b.getWorldQuaternion(new THREE.Quaternion()).normalize());
  if(previous)points.forEach((point,i)=>{maxStep=Math.max(maxStep,point.distanceTo(previous.points[i]));maxRotation=Math.max(maxRotation,rotations[i].angleTo(previous.rotations[i]));});previous={points,rotations};
  for(const side of ['L','R'])for(const [a,b,length]of[['thigh','shin',.43],['shin','foot',.43],['upper_arm','forearm',.29],['forearm','hand',.27]])assert.ok(Math.abs(position(actor.root,a+side).distanceTo(position(actor.root,b+side))-length)<1e-5);
 }
 assert.ok(maxStep<.07,`joint step at240Hz ${maxStep}`);assert.ok(maxRotation<.16,`artificial frame roll at240Hz ${maxRotation}`);
 actor.at(.95);const expected=bones.map(b=>b.quaternion.toArray());actor.at(2.5);actor.at(.95);assert.deepEqual(bones.map(b=>b.quaternion.toArray()),expected);
});

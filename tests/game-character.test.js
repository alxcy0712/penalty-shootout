import test from 'node:test';
import assert from 'node:assert/strict';
import {gameKickTime,KICK_CONTACT} from '../src/game-character.js';
import {penaltyStyles} from '../src/anatomy.js';

test('all existing runup durations align mocap contact with ball release',()=>{
  for(const style of penaltyStyles){
    assert.equal(gameKickTime(style.duration/style.duration),KICK_CONTACT);
    assert.equal(gameKickTime(1,0),KICK_CONTACT);
    assert.ok(Math.abs(gameKickTime((style.duration-.0001)/style.duration)-gameKickTime(1,0))<.001);
  }
  assert.equal(gameKickTime(0),0);assert.equal(gameKickTime(1,10),3.5);
});

import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {GameCharacter} from '../src/game-character.js';
import {createKeeperSkinPose} from '../src/keeper-skin-pose.js';
import {createKeeperArmRoll} from '../src/keeper-arm-roll.js';
import {strikerRunupPose,goalkeeperPose} from '../src/anatomy.js';

async function character(asset,keeper){
  const bytes=await readFile(new URL(`../assets/characters/${asset}.glb`,import.meta.url));
  const length=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+length));
  for(const m of json.materials){delete m.pbrMetallicRoughness?.baseColorTexture;delete m.pbrMetallicRoughness?.metallicRoughnessTexture;delete m.normalTexture;}
  bytes.fill(32,20,20+length);bytes.write(JSON.stringify(json),20);
  await MeshoptDecoder.ready;
  const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const c=Object.create(GameCharacter.prototype);c.root=gltf.scene;c.keeper=keeper;
  c.mixer=new THREE.AnimationMixer(c.root);c.actions=gltf.animations.map(clip=>c.mixer.clipAction(clip).setLoop(THREE.LoopOnce,1));
  c.apply=createKeeperSkinPose(c.root);c.relax=createKeeperArmRoll(c.root);return c;
}

test('game mocap reaches the actual penalty ball and repeated pose/gaze stays stable',async()=>{
  const c=await character('striker-mocap',false),ball=new THREE.Vector3(0,.11,11);
  let previous;
  for(let i=0;i<100;i++){
    c.pose(strikerRunupPose(0,1,0,.7,0));c.kick(1,0);c.lookAt(ball,1/60);
    const point=c.root.getObjectByName('footL').localToWorld(new THREE.Vector3(0,.23,0));
    assert.ok(Math.abs(point.distanceTo(ball)-.11)<.02,'shoe meets game ball');
    if(previous)assert.ok(point.distanceTo(previous)<1e-6,'mixer resets do not move the contact');previous=point;
    assert.ok(c.root.getObjectByName('head').quaternion.toArray().every(Number.isFinite));
  }
});

test('game goalkeeper skin preserves physical endpoints in both directions',async()=>{
  const c=await character('keeper-prototype',true);
  for(const direction of [-1,1])for(let t=0;t<3.8;t+=.08){
    const p=goalkeeperPose({reach:80,speed:80},direction,t,2),before=structuredClone(p);
    c.pose(p);c.lookAt(new THREE.Vector3(0,1,5),1/60);c.root.updateWorldMatrix(true,true);
    for(const [i,side] of ['L','R'].entries())for(const [bone,key] of [['hand','hands'],['forearm','elbows'],['shin','knees'],['foot','feet']]){
      const actual=c.root.getObjectByName(bone+side).getWorldPosition(new THREE.Vector3());
      assert.ok(actual.distanceTo(new THREE.Vector3().copy(p[key][i]))<.001,`${bone+side} matches collision rig`);
    }
    assert.deepEqual(p,before,'visual animation preserves physics data');
  }
});

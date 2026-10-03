import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {GameCharacter} from '../src/game-character.js';
import {penaltyStyles} from '../src/anatomy.js';
const defer=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
async function readAsset(path,strip=false){const bytes=await readFile(new URL(path,import.meta.url));if(strip){const len=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+len));for(const m of json.materials){delete m.pbrMetallicRoughness?.baseColorTexture;delete m.pbrMetallicRoughness?.metallicRoughnessTexture;delete m.normalTexture;}bytes.fill(32,20,20+len);bytes.write(JSON.stringify(json),20);}await MeshoptDecoder.ready;return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');}
function actor(){const a=Object.create(GameCharacter.prototype);a.group=new THREE.Group();a.keeper=false;a.color='#b9efd7';a.number=11;a.fallback={group:new THREE.Group(),number:new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshBasicMaterial()),setColor(){},pose(){}};return a;}
test('secondary capture loading cannot expose a half-initialized actor and failure falls back safely',async()=>{
  const primary=await readAsset('../assets/characters/striker-mocap.glb',true),extra=await readAsset('../assets/characters/mocap-variants/cmu-10_03-kick.glb');
  const original=GLTFLoader.prototype.loadAsync;let optional=defer();
  GLTFLoader.prototype.loadAsync=function(url){return String(url).includes('mocap-variants')?optional.promise:Promise.resolve(primary);};
  try{
    const failed=actor(),pending=failed.load();failed.kick(.4,null,{style:penaltyStyles[3]});await Promise.resolve();await Promise.resolve();
    assert.equal(failed.root,undefined,'no root until primary and optional load are settled');optional.reject(new Error('simulated optional capture failure'));
    assert.equal(await pending,true);assert.equal(failed.variantReady,false);assert.equal(failed.actions.length,primary.animations.length);assert.equal(failed.currentKickAction.getClip().name,'CMU_10_01_Runup_Kick_Recovery');
    optional=defer();const loaded=actor(),waiting=loaded.load();loaded.kick(.5,null,{style:penaltyStyles[3]});await Promise.resolve();await Promise.resolve();assert.equal(loaded.root,undefined);
    optional.resolve(extra);assert.equal(await waiting,true);assert.equal(loaded.variantReady,true);assert.equal(loaded.currentKickAction.getClip().name,'CMU_10_03_Kick');assert.equal(loaded.currentKickAction.time,1.125*.5);
  }finally{GLTFLoader.prototype.loadAsync=original;}
});

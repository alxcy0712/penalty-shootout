import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {GameCharacter} from '../../src/game-character.js';
import {createKeeperSkinPose} from '../../src/keeper-skin-pose.js';
import {createKeeperArmRoll} from '../../src/keeper-arm-roll.js';

export async function loadCharacter(keeper=false,assetOverride=null) {
  const bytes=await readFile(assetOverride??new URL(`../../assets/characters/${keeper?'keeper-prototype':'striker-mocap'}.glb`,import.meta.url));
  const length=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+length));
  // Exercise the real skin/animations in Node; texture decoding is a browser check.
  for(const material of json.materials){delete material.pbrMetallicRoughness?.baseColorTexture;delete material.pbrMetallicRoughness?.metallicRoughnessTexture;delete material.normalTexture;}
  bytes.fill(32,20,20+length);bytes.write(JSON.stringify(json),20);await MeshoptDecoder.ready;
  const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const actor=Object.create(GameCharacter.prototype);actor.root=gltf.scene;actor.keeper=keeper;
  actor.mixer=new THREE.AnimationMixer(actor.root);
  if(!keeper){const bytes=await readFile(new URL('../../assets/characters/mocap-variants/cmu-10_03-kick.glb',import.meta.url));const extra=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');gltf.animations.push(...extra.animations);}
  actor.actions=gltf.animations.map(clip=>{const action=actor.mixer.clipAction(clip).setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;return action;});
  actor.apply=createKeeperSkinPose(actor.root,{shoulderSupport:true});actor.relax=createKeeperArmRoll(actor.root);
  return actor;
}


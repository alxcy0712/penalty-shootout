import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {loadCharacter} from './helpers/load-character.js';
import {goalkeeperPose} from '../src/anatomy.js';
import {motionInfo} from '../src/motion-lab-state.js';
const snapshot=actor=>{actor.root.updateMatrixWorld(true);const points=[];actor.root.traverse(bone=>{if(bone.isBone)points.push(...bone.matrixWorld.elements);});return points;};
test('actual goalkeeper source clips can be scrubbed and exit back into collision-aligned motion',async()=>{
  const actor=await loadCharacter(true),base=goalkeeperPose({speed:85,reach:85},1,.4,2);
  actor.pose(base);const expected=snapshot(actor);
  for(let index=0;index<2;index++){
    actor.capture(.4,index);const source=snapshot(actor);assert.notDeepEqual(source,expected);
    for(let i=0;i<4;i++){actor.capture(.4,index);assert.deepEqual(snapshot(actor),source,'same source time is deterministic');}
    actor.capture(100,index);assert.equal(actor.actions[index].time,actor.actions[index].getClip().duration);
    actor.pose(base);const restored=snapshot(actor);restored.forEach((value,i)=>assert.ok(Math.abs(value-expected[i])<1e-6));
    actor.root.updateMatrixWorld(true);
    for(const [i,side]of ['L','R'].entries())for(const[bone,key]of[['hand','hands'],['foot','feet']])assert.ok(actor.root.getObjectByName(bone+side).getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3().copy(base[key][i]))<1e-5);
  }
});
test('source preview duration uses real capture crop and never labels a fictional contact',()=>{
  for(const [name,duration]of[['capture0',1.0666667],['capture1',.975]]){const info=motionInfo(name,1.8,[1.5,1.7,1.8],.44);assert.equal(info.duration,duration);assert.equal(info.contact,null);assert.ok(info.markers.every(marker=>marker.time<=duration));}
});

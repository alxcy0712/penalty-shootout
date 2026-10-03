import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {loadCharacter} from './helpers/load-character.js';
import {penaltyStyles} from '../src/anatomy.js';
function skin(root){
  root.updateMatrixWorld(true);const inverse=root.matrixWorld.clone().invert(),result=[];
  root.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;mesh.skeleton.update();for(let i=0;i<mesh.geometry.attributes.position.count;i+=7){const p=new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,i);mesh.applyBoneTransform(i,p).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);result.push(p);}});return result;
}
function bones(root){const values=[];root.traverse(b=>{if(b.isBone)values.push(...b.position.toArray(),...b.quaternion.toArray(),...b.scale.toArray());});return values;}
test('both captured strikers use exactly two derived shoulder helpers within the24bone palette',async()=>{
  const actor=await loadCharacter();let palette;actor.root.traverse(mesh=>{if(mesh.isSkinnedMesh)palette??=mesh.skeleton;});
  assert.equal(palette.bones.length,24);assert.equal(palette.bones.filter(b=>b.name.startsWith('shoulder_support')).length,2);
  for(const style of[penaltyStyles[0],penaltyStyles[3]])for(const after of[0,.35,.8]){actor.kick(1,after,{style});for(const side of['L','R']){const helper=actor.root.getObjectByName('shoulder_support'+side);assert.ok(Math.abs(helper.quaternion.length()-1)<1e-10);assert.ok(helper.position.toArray().every(Number.isFinite));}}
});
test('derived shoulder skin is covariant under display rotation, translation and nonuniform scale',async()=>{
  const actor=await loadCharacter(),display=new THREE.Group();display.add(actor.root);let maximum=0;
  for(const style of[penaltyStyles[0],penaltyStyles[3]])for(const after of[0,.35]){
    display.position.set(0,0,0);display.rotation.set(0,0,0);display.scale.set(1,1,1);actor.kick(1,after,{style});const expected=skin(actor.root),pose=bones(actor.root);
    for(const [rotation,scale]of[[[.3,.8,-.2],[1.3,.7,1.15]],[[-.2,-1.7,.1],[.7,1.4,.9]]]){
      display.position.set(3,-1,5);display.rotation.set(...rotation);display.scale.set(...scale);actor.kick(1,after,{style});const actual=skin(actor.root),current=bones(actor.root);
      current.forEach((value,i)=>assert.ok(Math.abs(value-pose[i])<1e-9,'keep strict original AND derived bone-local transforms'));
      actual.forEach((p,i)=>maximum=Math.max(maximum,p.distanceTo(expected[i])));
    }
  }
  assert.ok(maximum<1e-8,`root-local actual skin discrepancy ${maximum}`);
});

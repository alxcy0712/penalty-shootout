import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {loadCharacter} from './helpers/load-character.js';
import {createKeeperSkinPose,updateKeeperShoulderSupport} from '../src/keeper-skin-pose.js';

const support = name => name.startsWith('shoulder_support');
async function player(){
  const actor=await loadCharacter(false);
  actor.apply=createKeeperSkinPose(actor.root,{shoulderSupport:true});
  return actor;
}
function localShoulderSkin(root){
  root.updateMatrixWorld(true);const inverse=root.matrixWorld.clone().invert(),result=[],point=new THREE.Vector3();
  root.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;mesh.skeleton.update();const p=mesh.geometry.attributes.position;
    for(let i=0;i<p.count;i++){if(p.getY(i)<1.15||Math.abs(p.getX(i))<.08||Math.abs(p.getX(i))>.38)continue;
      point.fromBufferAttribute(p,i);mesh.applyBoneTransform(i,point);result.push(point.clone().applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse));
    }
  });return result;
}

test('shoulder helpers preserve captured bones and skin under heading and nonuniform display transforms',async()=>{
  const a=await player(),b=await player(),display=new THREE.Group();display.add(b.root);
  for(const t of[0,.6,1.3,2.1967,2.65]){
    a.capture(t,0);b.capture(t,0);const before=[];
    b.root.traverse(bone=>{if(bone.isBone&&!support(bone.name))before.push([bone,bone.position.toArray(),bone.quaternion.toArray(),bone.scale.toArray()]);});
    display.position.set(4,-1,7);display.rotation.set(.27,1.13,-.19);display.scale.set(1.4,.7,1.8);display.updateMatrixWorld(true);
    updateKeeperShoulderSupport(a.root);updateKeeperShoulderSupport(b.root);
    for(const [bone,p,q,s]of before){assert.deepEqual(bone.position.toArray(),p);assert.deepEqual(bone.quaternion.toArray(),q);assert.deepEqual(bone.scale.toArray(),s);}
    for(const side of['L','R']){const x=a.root.getObjectByName('shoulder_support'+side),y=b.root.getObjectByName('shoulder_support'+side);assert.ok(x.position.distanceTo(y.position)<1e-12);x.quaternion.toArray().forEach((v,i)=>assert.ok(Math.abs(v-y.quaternion.toArray()[i])<1e-12));}
    const av=localShoulderSkin(a.root),bv=localShoulderSkin(b.root);assert.equal(av.length,bv.length);assert.ok(av.length>100);
    // Float32 skin-weight sums differ from1 by up to1.4e-7; a translated
    // display frame therefore contributes sub-micrometre affine roundoff.
    av.forEach((v,i)=>assert.ok(v.distanceTo(bv[i])<1e-6,'root-local shoulder skin remains invariant to display transforms'));
  }
});

test('shoulder support refresh is idempotent with at most24bones and four influences',async()=>{
  const actor=await player();actor.capture(2.1967,0);updateKeeperShoulderSupport(actor.root);const bones=[];
  actor.root.traverse(b=>{if(b.isBone)bones.push(b);});assert.equal(bones.length,24);
  const expected=bones.map(b=>[b.position.toArray(),b.quaternion.toArray(),b.scale.toArray()]);
  for(let i=0;i<20;i++)updateKeeperShoulderSupport(actor.root);
  assert.deepEqual(bones.map(b=>[b.position.toArray(),b.quaternion.toArray(),b.scale.toArray()]),expected);
  actor.root.traverse(m=>{if(m.isSkinnedMesh){assert.equal(m.geometry.attributes.skinWeight.itemSize,4);assert.equal(m.skeleton.bones.length,24);}});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {loadCharacter} from './helpers/load-character.js';
import {penaltyStyles} from '../src/anatomy.js';

// Protect the bounded update cost without depending on CPU or machine timing.
test('kick overlays share one final hierarchy flush and leave every world matrix current',async()=>{
  const actor=await loadCharacter(),display=new THREE.Group();
  display.position.set(2,.4,-7);display.rotation.set(.12,.6,-.08);display.scale.set(1.2,.8,1.4);display.add(actor.root);display.updateMatrixWorld(true);
  const root=actor.root,updateWorldMatrix=root.updateWorldMatrix,updateMatrixWorld=root.updateMatrixWorld;
  let fullFlushes=0;
  root.updateWorldMatrix=function(parents,children){if(children)fullFlushes++;return updateWorldMatrix.call(this,parents,children);};
  root.updateMatrixWorld=function(force){fullFlushes++;return updateMatrixWorld.call(this,force);};
  try{
    for(const style of penaltyStyles)for(const shotType of ['normal','low','chip'])for(const after of [0,.08,.2,.39,.6,1.3,1.7]){
      // First call can create an overlay. Count an already initialized frame.
      const options={style,shotType,power:.9,targetX:4.5};actor.kick(1,after,options);fullFlushes=0;actor.kick(1,after,options);
      assert.equal(fullFlushes,1,'mixer and overlays must share one final complete update');
      const snapshots=[];root.traverse(object=>snapshots.push([object,object.matrixWorld.toArray()]));
      updateWorldMatrix.call(root,true,true);
      for(const [object,matrix] of snapshots)assert.deepEqual(object.matrixWorld.toArray(),matrix,`${object.name} is already ready for rendering`);
    }
  }finally{root.updateWorldMatrix=updateWorldMatrix;root.updateMatrixWorld=updateMatrixWorld;}
});

test('switching overlay, contact and raw capture modes never retains a styled leg',async()=>{
  const actor=await loadCharacter(),reference=await loadCharacter();
  const bones=root=>{const result=[];root.traverse(b=>{if(b.isBone)result.push([b.name,b.position.toArray(),b.quaternion.toArray(),b.scale.toArray(),b.matrixWorld.toArray()]);});return result;};
  for(const after of [.2,1.6]){
    actor.kick(1,after,{shotType:'chip',power:.2});actor.kick(1,0);reference.kick(1,0);
    assert.deepEqual(bones(actor.root),bones(reference.root),'contact restores the unmodified captured pose');
    actor.kick(1,after,{shotType:'low',power:1});actor.capture(.8);reference.capture(.8);
    assert.deepEqual(bones(actor.root),bones(reference.root),'raw capture restores the unmodified captured pose');
  }
});

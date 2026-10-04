import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Player} from '../src/character.js';
import {keeperWarmupPose} from '../src/anatomy.js';

globalThis.document={createElement:()=>({width:256,height:256,getContext:()=>({clearRect(){},fillText(){}})})};

for(const order of ['inspection-first','source-first'])test(`procedural ${order} disposal retains shared live limb buffers until both views release them`,()=>{
  const source=new Player(new THREE.Scene(),'#b9efd7',true),inspection=new Player(new THREE.Scene(),'#e9a068',true);
  source.pose(keeperWarmupPose(.3));inspection.copyPose(source);inspection.copyPose(source);
  const buffers=source.limbs.map(limb=>limb.geometry),disposed=[];
  for(const geometry of buffers)geometry.addEventListener('dispose',()=>disposed.push(geometry));
  const [first,last]=order==='inspection-first'?[inspection,source]:[source,inspection];
  first.dispose();first.dispose();assert.deepEqual(disposed,[]);
  assert.deepEqual(last.limbs.map(limb=>limb.geometry),buffers);
  if(last===source)source.pose(keeperWarmupPose(.7));
  assert.ok(last.limbs.every(limb=>limb.geometry.attributes.position.array.every(Number.isFinite)));
  last.dispose();last.dispose();assert.equal(disposed.length,4);assert.equal(new Set(disposed).size,4);
});

test('disposing one procedural actor preserves module sphere and cloth while freeing its own texture/materials',()=>{
  const first=new Player(new THREE.Scene(),'#b9efd7',true),second=new Player(new THREE.Scene(),'#e9a068',true);
  const firstGeometries=new Set(),secondGeometries=new Set();
  first.group.traverse(object=>{if(object.geometry)firstGeometries.add(object.geometry);});
  second.group.traverse(object=>{if(object.geometry)secondGeometries.add(object.geometry);});
  const shared=[...firstGeometries].filter(geometry=>secondGeometries.has(geometry));assert.ok(shared.length>0);
  let sharedDisposals=0,materialDisposals=0,numberDisposals=0;
  for(const geometry of shared)geometry.addEventListener('dispose',()=>sharedDisposals++);
  assert.equal(first.shirt.normalMap,second.shirt.normalMap);
  first.shirt.normalMap.addEventListener('dispose',()=>sharedDisposals++);
  first.shirt.addEventListener('dispose',()=>materialDisposals++);first.numberTexture.addEventListener('dispose',()=>numberDisposals++);
  first.dispose();assert.equal(sharedDisposals,0);assert.equal(materialDisposals,1);assert.equal(numberDisposals,1);
  second.pose(keeperWarmupPose(.7));second.dispose();assert.equal(sharedDisposals,0);
});

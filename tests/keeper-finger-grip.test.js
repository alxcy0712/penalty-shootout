import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {loadCharacter, skinSurfaceDistance} from './helpers/load-character.js';
import {Shot} from '../src/engine.js';
import {keeperGather} from '../src/keeper-contact.js';
import {HOLD_DURATION} from '../src/anatomy.js';
import {createKeeperFingerGrip} from '../src/keeper-finger-grip.js';

const catalog=JSON.parse(await readFile(new URL('../validation/ten-rounds/union-fixtures.json',import.meta.url)));
const selected=[-1,0,1].map(direction=>catalog.fixtures.find(f=>f.expectedCaught&&f.direction===direction));
function capture(recipe){
  const shot=new Shot(recipe.aim,recipe.stats,recipe.stats,recipe.direction,recipe.seed);
  while(!shot.result&&shot.t<30)shot.step(1/120);
  assert.ok(shot.caught,'The pinned recipe must still be a real catch');
  return shot;
}
function held(shot,time){
  return keeperGather(shot.pose,shot.poseAt((shot.animationTime??shot.t)+time),shot.ball,shot.contactPart,time/HOLD_DURATION);
}
function glove(root){let found;root.traverse(mesh=>{if(mesh.isSkinnedMesh&&mesh.material.name==='Socks')found=mesh;});return found;}
function fingerprint(mesh){
  return createHash('sha256').update(new Uint8Array(mesh.geometry.attributes.position.array.buffer)).update(new Uint8Array(mesh.geometry.attributes.normal.array.buffer)).digest('hex');
}

test('four-finger grip isolates geometry, preserves exact open state and the 24-bone budget',async()=>{
  const actor=await loadCharacter(true),mesh=glove(actor.root),original=mesh.geometry;
  const sourcePosition=Array.from(original.attributes.position.array),sourceNormal=Array.from(original.attributes.normal.array);
  const bones=mesh.skeleton.bones.length,apply=actor.fingerGrip=createKeeperFingerGrip(actor.root),shot=capture(selected[2]);
  assert.notEqual(mesh.geometry,original);
  const target=held(shot,1);actor.pose(target.pose);apply(target.pose);
  assert.deepEqual(apply.diagnostics().map(d=>d.amount),[1,1]);
  assert.deepEqual(apply.diagnostics().map(d=>d.vertices),[626,627]);
  assert.deepEqual(apply.diagnostics().map(d=>d.triangles),[952,952]);
  assert.ok(apply.diagnostics().every(d=>d.guards<100));
  assert.equal(mesh.skeleton.bones.length,bones);
  assert.equal(bones,24);
  assert.deepEqual(Array.from(original.attributes.position.array),sourcePosition);
  assert.deepEqual(Array.from(original.attributes.normal.array),sourceNormal);
  let moved=0;
  for(let i=0;i<sourcePosition.length;i+=3)if(sourcePosition.slice(i,i+3).some((v,j)=>v!==mesh.geometry.attributes.position.array[i+j]))moved++;
  assert.equal(moved,1253,'Only the authored distal four-finger vertices move');
  const ranges=mesh.geometry.attributes.position.updateRanges;
  assert.ok(ranges.length<=1,'Dirty vertices are coalesced into one upload span');
  assert.ok(ranges.reduce((bytes,range)=>bytes+range.count*4,0)<=25188);
  const skin=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight;
  for(let i=0;i<mesh.geometry.attributes.position.count;i++){
    const handSlot=[0,1,2,3].find(slot=>/hand[LR]/.test(mesh.skeleton.bones[skin.array[i*4+slot]].name)&&weights.array[i*4+slot]===1);
    if(handSlot===undefined)continue;
    const bone=skin.array[i*4+handSlot],p=new THREE.Vector3().fromArray(sourcePosition,i*3).applyMatrix4(mesh.bindMatrix).applyMatrix4(mesh.skeleton.boneInverses[bone]);
    if(p.y>.105&&Math.abs(p.x)<=.055)continue;
    for(let j=0;j<3;j++)assert.equal(mesh.geometry.attributes.position.array[i*3+j],sourcePosition[i*3+j],'Protected palm/thumb geometry changed');
  }
  actor.capture(0);
  assert.deepEqual(Array.from(mesh.geometry.attributes.position.array),sourcePosition);
  assert.deepEqual(Array.from(mesh.geometry.attributes.normal.array),sourceNormal);
});

test('actual catches retain exact ball clearance, smooth closure and reverse-scrub determinism',async()=>{
  const actor=await loadCharacter(true),mesh=glove(actor.root),apply=actor.fingerGrip=createKeeperFingerGrip(actor.root);
  for(const recipe of selected){
    const shot=capture(recipe),hashes=[],poses=[];let previous=[0,0];
    for(let step=0;step<=120;step++){
      const target=held(shot,step/120);actor.pose(target.pose);apply(target.pose);
      const amounts=apply.diagnostics().map(d=>d.amount);
      for(let i=0;i<2;i++)assert.ok(Math.abs(amounts[i]-previous[i])<.051,'No capture-phase curl pop');
      previous=amounts;poses.push(target.pose);hashes.push(fingerprint(mesh));
      if(step%8===0||step===120){
        const distance=skinSurfaceDistance(actor.root,new THREE.Vector3().copy(target.ball),'Socks');
        assert.ok(distance>=.11-.000002,`Real deformed glove penetrated the ball: ${distance}`);
      }
    }
    assert.deepEqual(previous,[1,1]);
    for(let step=120;step>=0;step--){actor.pose(poses[step]);apply(poses[step]);assert.equal(fingerprint(mesh),hashes[step]);}
  }
});

test('full pose remains grip-covariant under display transforms and repeated hold skips uploads',async()=>{
  const actor=await loadCharacter(true),mesh=glove(actor.root),apply=actor.fingerGrip=createKeeperFingerGrip(actor.root),target=held(capture(selected[0]),1);
  actor.pose(target.pose);apply(target.pose);const expected=fingerprint(mesh),version=mesh.geometry.attributes.position.version;
  apply(target.pose);assert.equal(mesh.geometry.attributes.position.version,version);
  const parent=new THREE.Group();parent.position.set(3,2,-5);parent.rotation.set(.2,.5,-.4);parent.scale.set(.8,1.2,.9);parent.add(actor.root);parent.updateMatrixWorld(true);
  actor.pose(target.pose);apply(target.pose);assert.equal(fingerprint(mesh),expected);
});

test('guard construction rejects an uncovered mixed-weight finger boundary',async()=>{
  const actor=await loadCharacter(true),mesh=glove(actor.root);
  const {position,skinIndex,skinWeight}=mesh.geometry.attributes;
  let vertex=-1,slot=-1,handIndex=-1;
  for(let i=0;i<position.count&&vertex<0;i++)for(let j=0;j<4;j++){
    const index=skinIndex.array[i*4+j],bone=mesh.skeleton.bones[index];
    if(bone.name!=='handL'||skinWeight.array[i*4+j]!==1)continue;
    const p=new THREE.Vector3().fromBufferAttribute(position,i).applyMatrix4(mesh.bindMatrix).applyMatrix4(mesh.skeleton.boneInverses[index]);
    if(p.y>.12&&p.y<.15&&Math.abs(p.x)<.04){vertex=i;slot=j;handIndex=index;break;}
  }
  assert.ok(vertex>=0);
  const other=(slot+1)%4,forearm=mesh.skeleton.bones.findIndex(b=>b.name==='forearmL');
  skinWeight.array[vertex*4+slot]=.8;skinWeight.array[vertex*4+other]=.2;
  skinIndex.array[vertex*4+slot]=handIndex;skinIndex.array[vertex*4+other]=forearm;
  assert.throws(()=>createKeeperFingerGrip(actor.root),/exact single-hand weights on every touched triangle/);
});

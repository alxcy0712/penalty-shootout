import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3,Quaternion} from 'three';
import {goalkeeperPose} from '../src/anatomy.js';
import {keeperSurfaceContacts} from '../src/keeper-contact.js';
import {keeperContactData} from '../src/keeper-contact-data.js';
import {loadCharacter} from './helpers/load-character.js';
import {bootPatches,recoveryOrigin,wristContinuity,parrySupport} from '../tools/qa/audit-recovery-transfer.mjs';

test('the first boot settles its sole before the second without burying heel or forefoot',async()=>{
 const actor=await loadCharacter(true);
 for(const direction of[-1,1])for(const height of[.3,1.2,2.3]){
  const origin=recoveryOrigin(height),pose=phase=>goalkeeperPose({speed:85,reach:85},direction,origin+phase,height),first=direction>0?'R':'L',second=direction>0?'L':'R';
  const staged=bootPatches(actor,pose(.7));
  for(const p of staged.filter(p=>p.side===first)){assert.ok(p.sideRoll<.01,'first sole has no inherited pelvis side roll');assert.ok(p.minimum>=0&&p.minimum<.010,'actual first heel/forefoot stays close to turf');}
  assert.ok(staged.filter(p=>p.side===second).every(p=>p.sideRoll>.35),'second boot is still rolling into support');
  for(const phase of[1.1,1.35,1.7])for(const p of bootPatches(actor,pose(phase))){assert.ok(p.sideRoll<.01);assert.ok(p.minimum>=0&&p.minimum<.010);assert.ok(p.maximum<.037,'opposite boot edge no longer remains100 mm above turf');}
 }
});

test('physical foot contacts use the same unrolled frame as production foot bones',async()=>{
 const actor=await loadCharacter(true),axis=new Vector3(0,1,0);
 for(const direction of[-1,1])for(const phase of[.45,.7,.9,1.2,1.7]){
  const pose=goalkeeperPose({speed:85,reach:85},direction,recoveryOrigin(1.2)+phase,1.2);actor.pose(pose);actor.root.updateMatrixWorld(true);
  for(const side of['L','R']){
   const bone=actor.root.getObjectByName('foot'+side),rotation=bone.getWorldQuaternion(new Quaternion()).normalize(),position=bone.getWorldPosition(new Vector3()),vertices=keeperContactData.hulls['foot'+side].vertices;
   const tip=vertices.reduce((a,b)=>a[1]>b[1]?a:b),world=new Vector3().fromArray(tip).applyQuaternion(rotation).add(position),out=axis.clone().applyQuaternion(rotation);
   const hit=keeperSurfaceContacts(pose,world.clone().addScaledVector(out,.3),world.clone().addScaledVector(out,.108),.11).find(x=>x.part==='foot'+side);
   assert.ok(hit,'physical unrolled foot remains hittable');assert.ok(hit.hit.q.distanceTo(world)<2e-6,'contact point shares the visible rigid foot-bone frame');
  }
 }
});

test('free wrist unloading has no floor-projection branch jump under dense refinement',()=>{
 const report=wristContinuity();assert.equal(report.cases,36);assert.deepEqual(report.failures,[]);
 assert.ok(report.maximumFrame.angle<.16,'unchanged240 Hz hand-angle gate');
 assert.ok(report.maximumRefined.angle<.16*240/2000,'same angular speed bound at2000 Hz');
});

test('the tagged low wrist in the long parry is real glove support with grounded boots',async()=>{
 const records=parrySupport(await loadCharacter(true)),first=records[0];
 assert.ok(first.brace>.999);assert.ok(first.wrist.y>=.03&&first.wrist.y<.065,'exact regression for the scoped brace exception');
 assert.ok(first.partMinimum.handR>=0&&first.partMinimum.handR<.009,'actual glove reaches turf');
 assert.ok(Math.min(first.partMinimum.footL,first.partMinimum.footR)<.009,'a real boot supports unloading');
 for(const r of records)assert.ok(r.skinMinimum>=-.005,'unchanged whole-skin floor bound');
});

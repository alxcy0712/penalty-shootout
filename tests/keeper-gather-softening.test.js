import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Vector3,Quaternion} from 'three';
import {Shot} from '../src/engine.js';
import {HOLD_DURATION} from '../src/anatomy.js';
import {keeperGather} from '../src/keeper-contact.js';

const fixture=JSON.parse(await readFile(new URL('fixtures/keeper-gather-before-absorption.json',import.meta.url)));
const captures=fixture.records.map(record=>{
  const {aim,stats,direction,seed}=record.recipe,shot=new Shot(aim,stats,stats,direction,seed);
  for(let frame=0;frame<3600&&!shot.result;frame++)shot.step(1/120);
  assert.ok(shot.caught,'the regression must start from a real catch');
  return {record,shot};
});
const sample=(shot,time)=>keeperGather(shot.pose,shot.poseAt((shot.animationTime??shot.t)+time),shot.ball,shot.contactPart,time/HOLD_DURATION);
const relative=(pose,index)=>new Vector3().subVectors(pose.elbows[index],pose.hip);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
// Equivalent cached quaternion evaluation can differ by a final floating-point
// bit. This bound is below a trillionth of a metre (or quaternion component),
// while capture and same-kernel random-access identity remain exact below.
function sameFrozen(actual,expected,label){
  if(typeof expected==='number'){
    assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<1e-12,`${label}: ${actual} != ${expected}`);
    return;
  }
  if(expected&&typeof expected==='object'){
    assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort(),`${label}: pose structure`);
    for(const key of Object.keys(expected))sameFrozen(actual[key],expected[key],`${label}.${key}`);
    return;
  }
  assert.equal(actual,expected,label);
}

test('mirrored central catches absorb the elbow tuck without moving its speed peak elsewhere',()=>{
  for(const {record,shot}of captures){
    let previous,peak={speed:0};
    // Inspect the entire secured recovery, not just the former peak window.
    for(let frame=0;frame<=672;frame++){
      const time=frame/240,pose=sample(shot,time).pose;
      if(previous)for(let arm=0;arm<2;arm++){
        const speed=relative(pose,arm).distanceTo(relative(previous,arm))*240;
        if(speed>peak.speed)peak={speed,time,arm};
      }
      previous=pose;
    }
    const limit=record.recipe.aim.x<0?6.7:7.4;
    assert.ok(peak.speed<limit,`central ${record.recipe.aim.x}: ${peak.speed} m/s at ${peak.time}s on arm ${peak.arm}, limit ${limit}`);
  }
});

test('wrist and recovery refinement preserve capture and the calibrated palm attachment',()=>{
  for(const {record,shot}of captures){
    assert.equal(shot.t,record.captureTime);
    assert.equal(shot.animationTime,record.animationTime);
    assert.equal(shot.contactPart,record.contactPart);
    const start=sample(shot,0);
    assert.deepEqual(start.pose,shot.pose,'no source-pose jump at capture');
    assert.deepEqual(start.ball,shot.ball,'capture starts at the real physical contact');
    for(const {t,result}of record.fixedPoses){
      const actual=sample(shot,t);
      if(actual.pose.grip?.ball){
        assert.deepEqual(actual.pose.grip.ball,actual.ball);assert.equal(actual.pose.grip.captureBlend,t/HOLD_DURATION);
      }
      if(!t)sameFrozen(actual,result,'exact original capture');
      else {
        assert.equal(actual.weight,result.weight,'grasp phase retains its original timing');
        // The requested recovery changes the torso/boots, and palm pitch moves
        // wrists around the sphere. Preserve the old calibration in each hand's
        // own frame rather than freezing the obsolete world-space choreography.
        for(let arm=0;arm<2;arm++){
          const local=value=>new Vector3().subVectors(value.ball,value.pose.hands[arm]).applyQuaternion(new Quaternion().fromArray(value.pose.grip.handRotations[arm]).invert());
          assert.ok(local(actual).distanceTo(local(result))<1e-10,`secured palm calibration at ${t}s`);
        }
      }
    }
    for(const {t,ball,hands,handRotations}of record.attachment){
      const actual=sample(shot,t);
      sameFrozen(actual.ball,ball,`unchanged ball at ${t}s`);
      if(t<.6*HOLD_DURATION){
        sameFrozen(actual.pose.hands,hands,`unchanged early wrists at ${t}s`);
        sameFrozen(actual.pose.grip.handRotations,handRotations,`unchanged early palm frame at ${t}s`);
      }
      for(let arm=0;arm<2;arm++){
        const oldRotation=new Quaternion().fromArray(handRotations[arm]),rotation=new Quaternion().fromArray(actual.pose.grip.handRotations[arm]);
        const beforeOffset=new Vector3().subVectors(ball,hands[arm]).applyQuaternion(oldRotation.clone().invert()),afterOffset=new Vector3().subVectors(actual.ball,actual.pose.hands[arm]).applyQuaternion(rotation.clone().invert());
        assert.ok(beforeOffset.distanceTo(afterOffset)<1e-12,`exact rigid palm/sphere offset at ${t}s`);
        assert.ok(oldRotation.angleTo(rotation)<=.610001,`bounded palm pitch at ${t}s`);
      }
    }
    for(let frame=0;frame<=672;frame++){
      const pose=sample(shot,frame/240).pose;
      for(let arm=0;arm<2;arm++){
        assert.ok(Math.abs(distance(pose.shoulders[arm],pose.elbows[arm])-.29)<1e-10);
        assert.ok(Math.abs(distance(pose.elbows[arm],pose.hands[arm])-.27)<1e-10);
      }
    }
  }
});

test('early elbow absorption is identical after reverse scrubbing and different frame histories',()=>{
  for(const {shot}of captures){
    const times=[.125,.175,.2125,.3],expected=times.map(time=>sample(shot,time));
    for(const hz of[30,60,120]){
      for(let frame=0;frame<=Math.ceil(2.8*hz);frame++)sample(shot,frame/hz);
      for(let i=times.length-1;i>=0;i--)assert.deepEqual(sample(shot,times[i]),expected[i]);
    }
  }
});

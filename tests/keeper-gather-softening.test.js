import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Vector3} from 'three';
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

test('elbow absorption preserves the original capture, secured poses and ball/wrist attachment',()=>{
  for(const {record,shot}of captures){
    assert.equal(shot.t,record.captureTime);
    assert.equal(shot.animationTime,record.animationTime);
    assert.equal(shot.contactPart,record.contactPart);
    const start=sample(shot,0);
    assert.deepEqual(start.pose,shot.pose,'no source-pose jump at capture');
    assert.deepEqual(start.ball,shot.ball,'capture starts at the real physical contact');
    for(const {t,result}of record.fixedPoses)sameFrozen(sample(shot,t),result,`unchanged source/secure pose at ${t}s`);
    for(const {t,ball,hands,handRotations}of record.attachment){
      const actual=sample(shot,t);
      sameFrozen(actual.ball,ball,`unchanged ball at ${t}s`);
      sameFrozen(actual.pose.hands,hands,`unchanged wrists at ${t}s`);
      sameFrozen(actual.pose.grip.handRotations,handRotations,`unchanged glove attachment at ${t}s`);
    }
    for(let frame=0;frame<=106;frame++){
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

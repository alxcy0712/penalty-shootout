import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {Shot} from '../src/engine.js';
import {HOLD_DURATION,body} from '../src/anatomy.js';
import {keeperResultRecovery} from '../src/keeper-result-recovery.js';
import {keeperGather} from '../src/keeper-contact.js';
import {loadCharacter,skinMinimum,skinSurfaceDistance} from './helpers/load-character.js';

const stats={accuracy:90,power:90,touch:90,composure:90,curve:90,speed:85,reach:85,handling:99};
// Complete live pose/physics trajectories recorded from aeaa978, including the
// capture instant and compressed clearance clock. No result animation is hashed.
const recipes=[
  [0,.2,.5,0,42,'5600c40e05f53f44c476d7612d852d425dc07d1a4b5c3fb1383eccae196ff9e1'],
  [-.7,2.25,.6,0,3,'ff98b0c04c0c0aebeee656507e148cfd45e4687da92aa114643765dca9cc54c2'],
  [-.7,1,.6,0,3,'61aa226ad5fb62f13dce6ef54fd0f65e6050e900d085c93dc617421c2d9f9a83'],
  [2,.3,.55,1,3,'a920e5249559f6360624453334a2fd204a7944cc741990204a06a89e1bcfd932']
];
function simulate(recipe,ability=stats){
  const [x,y,power,direction,seed]=recipe,shot=new Shot({x,y,power},ability,ability,direction,seed),hash=createHash('sha256');
  for(let i=0;i<6000&&!shot.result;i++){
    shot.step(1/120,shot.playbackRate());
    hash.update(JSON.stringify({t:shot.t,at:shot.animationTime,ball:shot.ball,velocity:shot.velocity,pose:shot.pose,result:shot.result}));
  }
  assert.ok(shot.result);return {shot,hash:hash.digest('hex')};
}
const runs=recipes.map(recipe=>simulate(recipe)),shots=runs.slice(0,3).map(run=>run.shot);
const sample=(shot,time)=>shot.poseAt((shot.animationTime??shot.t)+time);
const displayed=(shot,time)=>{const pose=sample(shot,time);return shot.caught?keeperGather(shot.pose,pose,shot.ball,shot.contactPart,time/HOLD_DURATION):{pose};};
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const pointKeys=['hip','shoulder','head','up','right','forward','shoulders','hips','hands','elbows','knees','feet'];
const points=pose=>pointKeys.flatMap(key=>Array.isArray(pose[key])?pose[key]:[pose[key]]);

test('central result recovery does not change live physics, capture, clearance or side-dive poses',()=>{
  runs.forEach((run,i)=>assert.equal(run.hash,recipes[i][5]));
  const side=runs[3].shot,live=Shot.restore(JSON.parse(JSON.stringify(side)));live.result=null;
  for(const time of[0,.2,.44,.8,1.5,4])assert.deepEqual(sample(side,time),sample(live,time));
  for(const branch of['hesitation','recoveryOrigin']){
    const shot=Shot.restore(JSON.parse(JSON.stringify(shots[0])));
    if(branch==='hesitation')shot.hesitation={pose:shot.pose,direction:-1,at:shot.t,previous:shot.pose};
    else {shot.recoveryOrigin=shot.pose;shot.recoveryAt=shot.t;}
    const before=Shot.restore(JSON.parse(JSON.stringify(shot)));before.result=null;
    for(const time of[0,.2,1,4])assert.deepEqual(sample(shot,time),sample(before,time));
  }
});

test('the exact capture pose persists until the grasp is secure, then the low keeper rises with planted boots',()=>{
  const shot=shots[0];assert.ok(shot.caught);assert.ok(shot.pose.hip.y<.31);
  for(const time of[0,.1,.3,HOLD_DURATION-1e-8])assert.equal(sample(shot,time),shot.pose);
  assert.deepEqual(displayed(shot,0).pose,shot.pose);
  assert.deepEqual(displayed(shot,0).ball,shot.ball);
  let previous=shot.pose.hip.y;
  for(let frame=0;frame<=240;frame++){
    const pose=sample(shot,frame/120);assert.ok(pose.hip.y>=previous-1e-12);previous=pose.hip.y;
    pose.feet.forEach((foot,i)=>assert.ok(distance(foot,shot.pose.feet[i])<1e-12));
  }
  assert.ok(Math.abs(previous-.83)<1e-12);
  assert.deepEqual(sample(shot,2),sample(shot,20),'recovery has a bounded settled endpoint');
});

test('interrupted steps and overextended clearance stances settle before rising to reachable support',()=>{
  for(const shot of shots.slice(1)){
    const raised=shot.pose.feet.filter(foot=>foot.y>.075001).length,end=.12+raised*.18;
    assert.ok(raised>0);assert.equal(sample(shot,0),shot.pose);
    let lowest=shot.pose.hip.y;
    for(let frame=0;frame<=240;frame++){
      const time=frame/120,pose=sample(shot,time);
      pose.feet.forEach((foot,i)=>{
        assert.ok(Math.hypot(foot.x-shot.pose.feet[i].x,foot.z-shot.pose.feet[i].z)<1e-12,'support does not slide');
        if(time>=end)assert.ok(Math.abs(foot.y-.075)<1e-12,'both supports finish before the rise');
      });
      if(time<=end){assert.ok(pose.hip.y<=lowest+1e-12);lowest=pose.hip.y;}
    }
    const final=sample(shot,4);assert.ok(final.hip.y>.75);
    final.hips.forEach((hip,i)=>assert.ok(distance(hip,final.feet[i])<body.thigh+body.shin-.02));
    assert.ok(Math.max(...final.hands.map(hand=>hand.y))<1.1,'the high missed reach releases its arms');
  }
  assert.ok(shots[2].animationTime<shots[2].t,'the clearance fixture exercises the scene clock');
});

test('complete rendered joint motion is continuous across capture, support and rise boundaries',()=>{
  const epsilon=1e-6;
  for(const shot of shots){
    const raised=shot.pose.feet.filter(foot=>foot.y>.075001).length,start=shot.caught?HOLD_DURATION:.12;
    for(const time of[start,start+.18,start+raised*.18,start+raised*.18+1.1]){
      const [before,at,after]=[-epsilon,0,epsilon].map(offset=>points(displayed(shot,time+offset).pose));
      for(let i=0;i<at.length;i++){
        assert.ok(distance(at[i],after[i])<1e-5,`onset jump at ${time}/${i}`);
        const incoming={x:(at[i].x-before[i].x)/epsilon,y:(at[i].y-before[i].y)/epsilon,z:(at[i].z-before[i].z)/epsilon};
        const outgoing={x:(after[i].x-at[i].x)/epsilon,y:(after[i].y-at[i].y)/epsilon,z:(after[i].z-at[i].z)/epsilon};
        assert.ok(distance(incoming,outgoing)<.003,`velocity seam at ${time}/${i}`);
      }
    }
  }
});

test('recovery is mirrored, translated, serialized and independent of frame rate or scrub history',()=>{
  const translate=(source,offset)=>{const pose=structuredClone(source);for(const key of pointKeys.filter(key=>!['up','right','forward'].includes(key))){const list=Array.isArray(pose[key])?pose[key]:[pose[key]];list.forEach(p=>{p.x+=offset.x;p.z+=offset.z;});}return pose;};
  const mirror=source=>{const pose=structuredClone(source);for(const key of pointKeys){if(key==='right'){pose.right.y*=-1;pose.right.z*=-1;continue;}const list=Array.isArray(pose[key])?pose[key].reverse():[pose[key]];list.forEach(p=>{p.x*=-1;});}pose.roll*=-1;return pose;};
  for(const ability of[65,85,99]){
    const {shot}=simulate(recipes[0],{...stats,speed:ability,reach:ability});assert.equal(shot.direction,0);
    const saved=JSON.stringify(shot),restored=Shot.restore(JSON.parse(saved)),legacy=Shot.restore(JSON.parse(saved));delete legacy.animationTime;
    for(const time of[1.3,.1,4,.44,.62,1,.2,1.3]){
      assert.deepEqual(sample(restored,time),sample(shot,time));
      assert.deepEqual(sample(legacy,time),sample(shot,time));
      const expected=sample(shot,time),offset={x:2.3,z:-.8};
      const moved=keeperResultRecovery(translate(shot.pose,offset),time,shot.caught),reflected=keeperResultRecovery(mirror(shot.pose),time,shot.caught);
      points(moved).forEach((p,i)=>assert.ok(distance(p,points(translate(expected,offset))[i])<1e-10));
      points(reflected).forEach((p,i)=>assert.ok(distance(p,points(mirror(expected))[i])<1e-10));
    }
    for(const hz of[30,60,120])for(let frame=0;frame<=2*hz;frame++){
      const pose=sample(shot,frame/hz);
      for(let i=0;i<2;i++)for(const [a,b,length]of[['shoulders','elbows',body.upperArm],['elbows','hands',body.forearm],['hips','knees',body.thigh],['knees','feet',body.shin]])assert.ok(Math.abs(distance(pose[a][i],pose[b][i])-length)<1e-6);
      if(frame%(hz/30)===0)assert.deepEqual(pose,sample(restored,Math.round(frame/hz*30)/30));
    }
    assert.equal(JSON.stringify(shot),saved,'sampling must never update temporal state');
  }
});

test('production skin stays above turf and the captured ball clears the visible body through central get-up',async()=>{
  const actor=await loadCharacter(true);
  for(const shot of shots)for(const time of[0,.12,.3,.44,.6,.8,1,1.3,1.6,2]){
    const state=displayed(shot,time);actor.pose(state.pose);
    assert.ok(skinMinimum(actor.root)>=-.005,'actual skin must remain above the floor');
    if(state.ball)assert.ok(skinSurfaceDistance(actor.root,new THREE.Vector3().copy(state.ball))>=.105,'the held sphere clears every production triangle');
  }
  // The existing calibrated .075m ankle has a roughly .018m skin offset.
  // Verify return to that normal support height, without redefining the rig.
  for(const shot of shots){actor.pose(displayed(shot,2).pose);const minimum=skinMinimum(actor.root);assert.ok(minimum>.015&&minimum<.022);}
});

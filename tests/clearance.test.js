import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Shot} from '../src/engine.js';
const stats={accuracy:90,power:90,touch:90,composure:90,speed:85,reach:90,handling:95};
const make=()=>new Shot({x:2.5,power:.65,y:1.3},stats,stats,1,4);
function finish(shot,accelerated){let displayTime=0;for(let n=0;n<6000&&!shot.result;n++){const rate=accelerated?shot.playbackRate():1;shot.step(1/120,rate);displayTime+=1/120/rate;}assert.ok(shot.result);return displayTime;}

test('a long parry settles quickly on screen while retaining the full physical outcome',()=>{
  const normal=make(),fast=make(),normalTime=finish(normal,false),fastTime=finish(fast,true);
  assert.ok(normalTime>6);assert.ok(fastTime<2.5);assert.deepEqual(fast.result,normal.result);
  assert.deepEqual(fast.ball,normal.ball);assert.deepEqual(fast.velocity,{x:0,y:0,z:0});
  assert.equal(fast.t,normal.t);assert.ok(Math.abs(fast.animationTime-fastTime)<1e-8);
  assert.deepEqual(fast.keeperOffset,{x:0,y:0,z:0});assert.equal(fast.direction,1);
  const displayed=fast.poseAt(fast.animationTime);assert.ok(displayed.hip.x>0);
});
test('loose balls near the goal and rebounds heading back to the goal remain in real time',()=>{
  const shot=make();shot.touched=true;
  for(const [ball,velocity] of[
    [{x:1,y:.11,z:.4},{x:0,y:0,z:-1}],
    [{x:3.66,y:1,z:.3},{x:1,y:0,z:2}],
    [{x:0,y:1,z:4},{x:0,y:0,z:-2}],
  ]){shot.ball=ball;shot.velocity=velocity;assert.equal(shot.playbackRate(),1);}
  shot.ball={x:0,y:.11,z:.05};shot.velocity={x:0,y:0,z:-2};shot.contactUntil=100;
  finish(shot,true);assert.equal(shot.result.goal,true);assert.equal(shot.result.saved,false);
  const untouched=make();untouched.ball={x:0,y:1,z:10};untouched.velocity={x:0,y:0,z:5};assert.equal(untouched.playbackRate(),1);
});
test('clearances restore deterministically and their presentation is independent of frame rate',()=>{
  const shot=make();while(!shot.isClearance()&&!shot.result)shot.step(1/120);
  assert.equal(shot.result,null);const raw=JSON.stringify(shot);let reference;
  for(const fps of[30,60,120]){
    const restored=Shot.restore(JSON.parse(raw));let accumulator=0,frames=0;
    while(!restored.result&&frames<fps*10){const rate=restored.playbackRate();accumulator+=rate/fps;while(accumulator>=1/120&&!restored.result){restored.step(1/120,rate);accumulator-=1/120;}frames++;}
    assert.ok(restored.result?.saved);assert.ok(frames/fps<1.5);
    reference??=restored.result;assert.deepEqual(restored.result,reference);
  }
});
test('post-save visual recovery stays continuous while the distant ball runs ahead',()=>{
  const shot=make();finish(shot,true);let previous=shot.poseAt(shot.animationTime);
  for(let ms=1;ms<=3500;ms++){
    const pose=shot.poseAt(shot.animationTime+ms/1000);
    for(const part of['hands','elbows','knees','feet'])for(let i=0;i<2;i++){
      const p=pose[part][i],q=previous[part][i];assert.ok(Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)<.022);assert.ok(p.y>=.065);
    }
    previous=pose;
  }
  assert.ok(previous.hip.x>0);assert.ok(previous.hip.y>.7);
});

test('a standing keeper releases the low block and returns to a balanced stance after a parry',()=>{
  const shot=new Shot({x:0,power:.1,y:.2},stats,stats,0,42);
  for(let n=0;n<60;n++)shot.step(1/120);
  assert.ok(shot.pose.hip.y<.4);
  shot.touched=true;shot.ball={x:0,y:.11,z:2};shot.velocity={x:0,y:0,z:3};
  for(let n=0;n<100;n++)shot.step(1/120);
  assert.ok(shot.pose.hip.y>.78);assert.ok(Math.abs(shot.pose.hip.x)<.1);
});

test('a left-post rebound leaves the keeper recovering at the landing spot without a crouched chase',()=>{
  const makePost=()=>new Shot({x:-3.7,power:.7,y:1},stats,stats,-1,2);
  const normal=makePost(),fast=makePost();
  const normalTime=finish(normal,false),fastTime=finish(fast,true);
  assert.ok(normal.post);assert.equal(normal.touched,false);assert.equal(normal.result.goal,false);
  assert.deepEqual(fast.result,normal.result);assert.deepEqual(fast.ball,normal.ball);
  assert.ok(fastTime<normalTime/2);
  assert.equal(fast.direction,-1);assert.deepEqual(fast.keeperOffset,{x:0,y:0,z:0});
  const recovered=fast.poseAt(5);
  assert.ok(recovered.hip.x<-1.5);assert.ok(recovered.hip.y>.7);
  let previous=fast.poseAt(0);
  for(let ms=1;ms<=5000;ms++){
    const pose=fast.poseAt(ms/1000);
    for(const part of['hands','elbows','knees','feet'])for(let i=0;i<2;i++){
      const p=pose[part][i],q=previous[part][i];assert.ok(Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)<.022);
    }
    previous=pose;
  }
});
test('post rebounds near the goal remain live, including rebounds back over the line',()=>{
  const shot=make();shot.post=true;shot.touched=false;
  shot.ball={x:0,y:.5,z:.2};shot.velocity={x:0,y:0,z:-2};shot.contactUntil=100;
  assert.equal(shot.playbackRate(),1);
  finish(shot,true);assert.equal(shot.result.goal,true);assert.equal(shot.result.reason,'击中门框后入网');
  const nearby=make();nearby.post=true;nearby.ball={x:3.6,y:1,z:.3};nearby.velocity={x:-1,y:0,z:2};
  assert.equal(nearby.playbackRate(),1);nearby.trackKeeper(1/120);assert.equal(nearby.clearanceAt,undefined);
});
test('a standing keeper rises in place after the ball rebounds away from a post',()=>{
  const shot=new Shot({x:0,power:.1,y:.2},stats,stats,0,42);
  for(let n=0;n<60;n++)shot.step(1/120);
  shot.post=true;shot.ball={x:3.6,y:.11,z:2};shot.velocity={x:3,y:0,z:3};
  const offset={...shot.keeperOffset};
  for(let n=0;n<100;n++)shot.step(1/120);
  assert.deepEqual(shot.keeperOffset,offset);assert.ok(shot.pose.hip.y>.78);
});

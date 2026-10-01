import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Shot} from '../src/engine.js';
import {body,goalkeeperPose} from '../src/anatomy.js';
const stats={accuracy:90,power:90,touch:90,composure:90,speed:85,reach:90,handling:95};
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
function run(shot){for(let n=0;n<3600&&!shot.result;n++)shot.step(1/120);assert.ok(shot.result);return shot.result;}

test('keepers start on the goal line and reactive movement waits until after the kick',()=>{
  for(const direction of[-1,0,1]){
    const shot=new Shot({x:1,power:0},stats,stats,direction,1);
    // The shoe capsule extends 4 cm behind the ankle and overlaps z=0.
    assert.ok(shot.pose.feet.some(foot=>foot.z-.04<=1e-8));
    assert.deepEqual(shot.keeperOffset,{x:0,y:0,z:0});
  }
  const shot=new Shot({x:1,power:0},stats,stats,0,1);
  for(let n=0;n<12;n++)shot.step(1/120);
  assert.deepEqual(shot.keeperOffset,{x:0,y:0,z:0});
  for(let n=0;n<60;n++)shot.step(1/120);
  assert.ok(shot.keeperOffset.x>.2);assert.ok(shot.keeperOffset.z>0);
});
test('near-centre slow balls are intercepted across both sides, powers and preselected directions',()=>{
  let saved=0,total=0;
  for(const x of[-1.2,-.8,-.4,.4,.8,1.2])for(const power of[0,.05,.12])for(const direction of[-1,0,1])for(let seed=1;seed<=10;seed++){
    const shot=new Shot({x,power,y:.2},stats,stats,direction,seed);saved+=Number(run(shot).saved);total++;
  }
  assert.ok(saved/total>.94,`${saved}/${total} near-centre slow balls saved`);
});
test('airborne wrong-way dives keep their momentum and can recover only after landing',()=>{
  const shot=new Shot({x:-3,power:1,y:1.5},stats,stats,1,42);
  shot.ball.z=40;shot.velocity={x:-.15,y:0,z:-4};
  for(let n=0;n<240;n++){shot.step(1/120);assert.equal(shot.direction,1);assert.equal(shot.dive(-1),false);assert.equal(shot.keeperOffset.x,0);}
  for(let n=0;n<240;n++)shot.step(1/120);
  assert.ok(shot.recoveryOrigin);assert.equal(shot.direction,0);assert.ok(shot.keeperVelocity.x<0);
});
test('stretch dives reach upper corners while fast corners retain a scoring advantage',()=>{
  const keeper={...stats,speed:95,reach:95};let reachable=0,fast=0,wrong=0;
  for(const side of[-1,1])for(let seed=1;seed<=30;seed++){
    reachable+=Number(run(new Shot({x:side*3.3,y:2.1,power:.55},stats,keeper,side,seed)).saved);
    fast+=Number(run(new Shot({x:side*3.3,y:2.1,power:1},stats,keeper,side,seed)).saved);
    wrong+=Number(run(new Shot({x:side*3.3,y:2.1,power:.55},stats,keeper,-side,seed)).saved);
  }
  assert.ok(reachable>35,`corner saves ${reachable}`);assert.ok(fast<reachable/2);assert.ok(wrong<reachable/2);
});
test('stretching extends the arms with fixed bone lengths and mirrored poses',()=>{
  for(let n=0;n<=3500;n+=5){
    const right=goalkeeperPose({...stats,stretch:1},1,n/1000,2.2),left=goalkeeperPose({...stats,stretch:1},-1,n/1000,2.2);
    assert.ok(Math.abs(right.hip.x+left.hip.x)<1e-8);
    for(const pose of[right,left])for(let i=0;i<2;i++)for(const[a,b,length]of[[pose.shoulders[i],pose.elbows[i],body.upperArm],[pose.elbows[i],pose.hands[i],body.forearm],[pose.hips[i],pose.knees[i],body.thigh],[pose.knees[i],pose.feet[i],body.shin]])assert.ok(Math.abs(distance(a,b)-length)<1e-8);
  }
  const extended=goalkeeperPose({...stats,stretch:1},1,.4,2.2),normal=goalkeeperPose(stats,1,.4,2.2);
  assert.ok(Math.max(...extended.hands.map(p=>p.y))>Math.max(...normal.hands.map(p=>p.y))+.1);
});
test('tracking, takeoff and recovery remain continuous and obey movement speed limits',()=>{
  for(const power of[0,.1,.4,.7,1])for(const x of[-3.4,-1,0,1,3.4])for(const direction of[-1,0,1]){
    const shot=new Shot({x,power,y:power>.4?2.2:.2},stats,stats,direction,42);let previous=shot.pose;
    for(let ms=1;ms<5000&&!shot.result;ms++){
      shot.step(.001);const pose=shot.pose;
      assert.ok(Math.abs(shot.keeperVelocity.x)<=1.4+1.6*stats.speed/99+1e-8);
      for(const part of['hands','elbows','knees','feet'])for(let i=0;i<2;i++){
        assert.ok(distance(pose[part][i],previous[part][i])<.022,`${part} discontinuity: power ${power}, x ${x}, dir ${direction}, ${ms} ms`);
        const braced=part==='hands'&&(pose.torso?.[i?'braceR':'braceL']??0)>.5;assert.ok(pose[part][i].y>=(braced?.03:.065));
      }
      previous=pose;
    }
  }
});
test('tracking uses the moving ball and survives saves before and after takeoff',()=>{
  for(const power of[0,.1,.55,1])for(const direction of[-1,0,1])for(const steps of[12,48,90]){
    const shot=new Shot({x:2.5,power,y:1.5,curve:.6},{...stats,curve:85},stats,direction,42);
    for(let n=0;n<steps&&!shot.result;n++)shot.step(1/120);
    const restored=Shot.restore(JSON.parse(JSON.stringify(shot)));
    restored.aim.x=-100; // The shot's secret input must not steer the reactive keeper.
    assert.deepEqual(run(shot),run(restored));assert.deepEqual(shot.pose,restored.pose);
  }
});

test('different keeper abilities settle mixed-height, curved and corner shots without invalid poses',()=>{
  let strong=0,weak=0;
  for(const ability of[40,76,99])for(const x of[-3.3,-.8,.8,3.3])for(const power of[.1,.55,1])for(const y of[.2,2.1])for(const direction of[-1,0,1]){
    const keeper={...stats,speed:ability,reach:ability},shot=new Shot({x,power,y,curve:.5},{...stats,curve:90},keeper,direction,42);
    for(let n=0;n<3600&&!shot.result;n++){
      shot.step(1/120);
      for(const part of['hands','feet','knees','elbows'])shot.pose[part].forEach((p,index)=>{assert.ok(Number.isFinite(p.x+p.y+p.z));const braced=part==='hands'&&(shot.pose.torso?.[index?'braceR':'braceL']??0)>.5;assert.ok(p.y>=(braced?.03:.065));});
    }
    assert.ok(shot.result);
  }
  for(let seed=1;seed<=30;seed++)for(const ability of[40,99]){
    const result=run(new Shot({x:3.3,y:2.1,power:.55},stats,{...stats,speed:ability,reach:ability},1,seed));
    if(ability===99)strong+=Number(result.saved);else weak+=Number(result.saved);
  }
  assert.ok(strong>weak+15,`ability-dependent corner saves: ${strong} vs ${weak}`);
});

test('a visible fast shot to the opposite side interrupts the grounded wind-up',()=>{
  for(const side of[-1,1])for(const ability of[40,76,99]){
    const shot=new Shot({x:-side*3,power:.9,y:1.4},stats,{...stats,speed:ability},side,42);
    for(let n=0;n<20&&!shot.hesitation;n++)shot.step(1/120);
    assert.ok(shot.hesitation);assert.ok(shot.hesitation.at>=.09);
    const planted=shot.hesitation.pose.feet;
    const brace=shot.poseAt(shot.hesitation.at+.25),held=shot.poseAt(shot.hesitation.at+.5);
    assert.deepEqual(brace,held);assert.ok(Math.abs(brace.hip.x)<.3);
    assert.ok(brace.hip.y<.75);assert.ok(brace.up.y>.95);
    for(let i=0;i<2;i++)assert.ok(distance(brace.feet[i],planted[i])<1e-8);
    assert.equal(shot.dive(-side),false);
    const restored=Shot.restore(JSON.parse(JSON.stringify(shot)));assert.deepEqual(run(shot),run(restored));
    assert.equal(shot.result.goal,true);
  }
});
test('correct-side dives, slow-ball tracking and fully airborne momentum remain active',()=>{
  for(const power of[.1,.9]){
    const shot=new Shot({x:3,power,y:1.4},stats,stats,power<.2?-1:1,42);
    run(shot);assert.equal(shot.hesitation,undefined);
  }
  const airborne=new Shot({x:3,power:.9,y:1.4},stats,stats,1,42);
  for(let n=0;n<30;n++)airborne.step(1/120);
  airborne.ball={x:-1,y:1,z:7};airborne.velocity={x:-8,y:0,z:-25};
  const before=airborne.pose.hip.x;
  for(let n=0;n<8;n++)airborne.step(1/120);
  assert.equal(airborne.hesitation,undefined);assert.ok(airborne.pose.hip.x>before);
});
test('hesitation is continuous through braking, the pause and standing recovery',()=>{
  for(const side of[-1,1]){
    const shot=new Shot({x:-side*3,power:.9,y:1.4},stats,stats,side,42);
    while(!shot.hesitation)shot.step(1/120);
    const start=shot.hesitation.at;let previous=shot.poseAt(start);
    for(let ms=1;ms<=1500;ms++){
      const pose=shot.poseAt(start+ms/1000);
      for(const part of['hands','elbows','knees','feet'])for(let i=0;i<2;i++){
        assert.ok(distance(pose[part][i],previous[part][i])<.022);
        const braced=part==='hands'&&(pose.torso?.[i?'braceR':'braceL']??0)>.5;assert.ok(pose[part][i].y>=(braced?.03:.065));
      }
      for(let i=0;i<2;i++)for(const[a,b,length]of[[pose.shoulders[i],pose.elbows[i],body.upperArm],[pose.elbows[i],pose.hands[i],body.forearm],[pose.hips[i],pose.knees[i],body.thigh],[pose.knees[i],pose.feet[i],body.shin]])assert.ok(Math.abs(distance(a,b)-length)<1e-8);
      previous=pose;
    }
  }
});
test('a selected side dive stays committed against ordinary central shots',()=>{
  const player={...stats,accuracy:75,power:75,touch:75,composure:75,speed:75,reach:75};
  for(const direction of[-1,1])for(const power of[.45,.6,.8])for(const y of[.3,1.2,2.1]){
    const shot=new Shot({x:0,power,y},player,player,direction,30);
    assert.equal(shot.diveDelay,0);
    for(let n=0;n<36&&!shot.result;n++)shot.step(1/120);
    assert.equal(shot.direction,direction);
    assert.ok(shot.pose.hip.x*direction>.2);
    const restored=Shot.restore(JSON.parse(JSON.stringify(shot)));
    assert.deepEqual(run(shot),run(restored));
  }
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {strikerPose,goalkeeperPose,keeperWarmupPose,holdingPose,HOLD_DURATION} from '../src/anatomy.js';
import {homeAnimation} from '../src/home-animation.js';
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);

test('home warmup keeps moving forward through the shot and camera return',()=>{
 for(const t of[7.99,8,10,13.99,14,19.99,20]){
  const before=homeAnimation(t),after=homeAnimation(t+.001);
  assert.ok(after.warmupTime>before.warmupTime);
  const a=keeperWarmupPose(before.warmupTime),b=keeperWarmupPose(after.warmupTime);
  for(const part of['feet','hands','elbows','knees'])for(let i=0;i<2;i++)assert.ok(distance(a[part][i],b[part][i])<.005);
 }
 const pose=keeperWarmupPose(1.5);
 assert.ok(Math.abs(pose.hands[0].y-pose.hands[1].y)>.04);
});

test('driven and chipped strikes retain contact and finish with distinct swing arcs',()=>{
 const dt=.00001;
 for(const shotType of['low','chip'])for(const power of[0,.5,1])for(const x of[-4.5,0,4.5]){
  const sample=(phase,after)=>strikerPose(0,phase,after,power,x,0,shotType);
  const a=sample(1-dt/.55,-1),b=sample(1,0),c=sample(1,dt);
  assert.ok(distance(b.feet[1],strikerPose(0,1,0,power,x).feet[1])<1e-8);
  const velocityJump=Math.hypot(...['x','y','z'].map(key=>(c.feet[1][key]-2*b.feet[1][key]+a.feet[1][key])/dt));
  assert.ok(velocityJump<.04);
  let previous=sample(0,-1);
  for(let n=1;n<=1600;n++){
   const t=n/1000,pose=sample(Math.min(1,t/.55),t>=.55?t-.55:-1);
   for(const part of['feet','hands','elbows','knees'])for(let i=0;i<2;i++)assert.ok(distance(pose[part][i],previous[part][i])<.022);
   previous=pose;
  }
  assert.ok(previous.feet.every(foot=>Math.abs(foot.y-.075)<1e-8));
 }
 const normal=strikerPose(0,1,.1,.7,0),low=strikerPose(0,1,.1,.7,0,0,'low'),chip=strikerPose(0,1,.1,.7,0,0,'chip');
 assert.ok(normal.feet[1].y-low.feet[1].y>.1);
 assert.ok(chip.feet[1].z-normal.feet[1].z>.15);
});

test('central blocks plant both feet, load the legs and converge on the ball height',()=>{
 const stats={speed:85,reach:85},feet=goalkeeperPose(stats).feet;
 for(const height of[.3,1.2,2.3]){
  let previous=goalkeeperPose(stats,0,0,height),lowest=previous.hip.y;
  for(let n=1;n<=800;n++){
   const pose=goalkeeperPose(stats,0,n/1000,height);lowest=Math.min(lowest,pose.hip.y);
   for(let i=0;i<2;i++)assert.ok(distance(pose.feet[i],feet[i])<1e-8);
   for(const part of['hands','elbows','knees'])for(let i=0;i<2;i++)assert.ok(distance(pose[part][i],previous[part][i])<.022);
   previous=pose;
  }
  assert.ok(lowest<.825);
  assert.ok(previous.hands.every(hand=>height<.5?hand.y<.3:hand.y>1.1));
 }
});

test('get-up transfers weight continuously while the first planted foot supports the rise',()=>{
 const stats={speed:85,reach:85},height=1.2,vy=.7+(height-.35)/1.7*2.1;
 // Follow the authored landing height and support-first recovery clock.
 const start=.13+(vy+Math.sqrt(vy*vy+2*9.81*(.83-.305)))/9.81+.28;
 for(const direction of[-1,1]){
  for(let t=.45;t<=1.45;t+=.01){
   const a=goalkeeperPose(stats,direction,start+t,height),b=goalkeeperPose(stats,direction,start+t+.001,height);
   assert.ok((b.hip.y-a.hip.y)/.001>.015,`rise pauses at ${t}`);
   assert.ok(a.feet.some(foot=>Math.abs(foot.y-.075)<1e-8));
  }
  assert.ok(Math.abs(goalkeeperPose(stats,direction,start+1.75,height).hip.y-.83)<1e-9,'rise ends in the authored standing height rather than drifting forever');
 }
});

test('gathering uses the same gentle start and finish for the ball and wrist grip',()=>{
 const source=goalkeeperPose({speed:85,reach:85},0,.3,1.2),dt=.001/HOLD_DURATION;
 const start=holdingPose(source,0),first=holdingPose(source,dt),last=holdingPose(source,1-dt),end=holdingPose(source,1);
 assert.equal(start.weight,0);assert.equal(end.weight,1);
 assert.ok(first.weight<1e-6);assert.ok(1-last.weight<1e-6);
 assert.equal(end.pose.grip.weight,end.weight);
 for(let i=0;i<2;i++)assert.ok(distance(first.pose.hands[i],source.hands[i])<1e-6);
});

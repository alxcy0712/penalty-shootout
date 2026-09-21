import {test} from 'node:test';
import assert from 'node:assert/strict';
import {body,strikerPose,goalkeeperPose,holdingPose,neckAngles,HOLD_DURATION} from '../src/anatomy.js';
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
function check(p){for(let i=0;i<2;i++)for(const[a,b,length]of[[p.shoulders[i],p.elbows[i],body.upperArm],[p.elbows[i],p.hands[i],body.forearm],[p.hips[i],p.knees[i],body.thigh],[p.knees[i],p.feet[i],body.shin]])assert.ok(Math.abs(distance(a,b)-length)<1e-8);}
test('anatomical segment lengths remain fixed during shots, dives and recovery',()=>{for(let n=0;n<=600;n++){let t=n/120;check(strikerPose(t,Math.min(1,t/.55),t>.55?t-.55:-1));for(const direction of[-1,0,1])for(const height of[.3,1.2,2.3])check(goalkeeperPose({reach:85,speed:85},direction,t,height));}});
test('planted striking foot stays on turf from contact through follow-through',()=>{const origin=strikerPose(0,1,0).feet[0];for(let n=0;n<100;n++){const foot=strikerPose(0,1,n/120).feet[0];assert.ok(distance(origin,foot)<1e-8);assert.ok(Math.abs(foot.y-.075)<1e-8);}});
test('keeper airborne pelvis accelerates under gravity',()=>{const stats={reach:85,speed:85},dt=.001;for(const t of[.20,.25,.30]){const a=goalkeeperPose(stats,1,t-dt,2).hip,b=goalkeeperPose(stats,1,t,2).hip,c=goalkeeperPose(stats,1,t+dt,2).hip;assert.ok(Math.abs((a.y-2*b.y+c.y)/(dt*dt)+9.81)<1e-5);}});
test('dive and get-up keep joint centres above the playing surface',()=>{for(const d of[-1,1])for(const h of[.3,1.2,2.3])for(let n=0;n<=600;n++){const p=goalkeeperPose({reach:99,speed:99},d,n/120,h);for(const key of['hands','feet','knees','elbows'])for(const point of p[key])assert.ok(point.y>=.065,`${key} crossed turf`);}});
test('kicking contact is continuous and boot toe reaches the ball',()=>{const a=strikerPose(0,1,-1),b=strikerPose(0,1,0);assert.ok(distance(a.feet[1],b.feet[1])<.01);assert.ok(distance({x:b.feet[1].x,y:b.feet[1].y,z:b.feet[1].z-.14},{x:0,y:.11,z:11})<.02);});
test('no joint teleports at backswing, takeoff or recovery transitions',()=>{
  const evaluate=[t=>strikerPose(t,Math.min(t/.55,1),t>=.55?t-.55:-1)];
  for(const direction of[-1,1])for(const height of[.3,1.2,2.3])evaluate.push(t=>goalkeeperPose({speed:85,reach:85},direction,t,height));
  for(const pose of evaluate){let previous=pose(0);for(let i=1;i<=3600;i++){const current=pose(i/1000);for(const key of['hands','elbows','feet','knees'])current[key].forEach((point,j)=>assert.ok(distance(point,previous[key][j])<.022,`${key} jumps at ${i}ms`));previous=current;}}
});
test('foot travels through contact continuously and responds to shot power',()=>{
  for(const power of[0,.5,1]){const dt=.00001;const before=strikerPose(0,1-dt/.55,-1,power).feet[1],at=strikerPose(0,1,0,power).feet[1],after=strikerPose(0,1,dt,power).feet[1];const inSpeed=(before.z-at.z)/dt,outSpeed=(at.z-after.z)/dt;assert.ok(Math.abs(inSpeed-(5+13*power))<.02);assert.ok(Math.abs(inSpeed-outSpeed)<.02);}
});
test('left and right shots align the striking foot and preserve impact velocity and support',()=>{
  const dt=.00001;
  for(const x of[-4.5,-2,0,2,4.5])for(const power of[0,.5,1]){
    const before=strikerPose(0,1-dt/.55,-1,power,x),at=strikerPose(0,1,0,power,x),after=strikerPose(0,1,dt,power,x);
    const incoming={x:(at.feet[1].x-before.feet[1].x)/dt,z:(at.feet[1].z-before.feet[1].z)/dt};
    const outgoing={x:(after.feet[1].x-at.feet[1].x)/dt,z:(after.feet[1].z-at.feet[1].z)/dt};
    assert.ok(Math.abs(incoming.x/-incoming.z-x/11)<.002);
    assert.ok(Math.hypot(incoming.x-outgoing.x,incoming.z-outgoing.z)<.03);
    const yaw=at.feetYaw[1],toe={x:at.feet[1].x-.14*Math.sin(yaw),y:at.feet[1].y,z:at.feet[1].z-.14*Math.cos(yaw)};
    assert.ok(distance(toe,{x:0,y:.11,z:11})<.02);
    for(let n=0;n<=120;n++){const t=n/120,p=strikerPose(t,Math.min(t/.55,1),t>=.55?t-.55:-1,power,x);check(p);if(t>=.55)assert.ok(distance(p.feet[0],{x:-.28,y:.075,z:11.02})<1e-8);}
  }
});

test('secured-ball arm pose keeps bone lengths and brings both hands around the ball',()=>{for(const direction of[-1,0,1])for(let n=0;n<180;n++){const p=goalkeeperPose({speed:85,reach:85},direction,n/60,1.2),hold=holdingPose(p);check(hold.pose);assert.ok(hold.center.y>=.15);for(const hand of hold.pose.hands)assert.ok(distance(hand,hold.center)<.19);}});
test('the catch-to-hold transition preserves the original elbow bend at its start',()=>{
  for(const direction of[-1,0,1])for(const height of[.3,1.2,2.3])for(let n=0;n<180;n++){
    const source=goalkeeperPose({speed:85,reach:85},direction,n/60,height),start=holdingPose(source,0).pose,first=holdingPose(source,.001/HOLD_DURATION).pose;
    check(start);check(first);
    for(let i=0;i<2;i++){
      assert.ok(distance(source.elbows[i],start.elbows[i])<1e-7);
      assert.ok(distance(source.hands[i],start.hands[i])<1e-7);
      assert.ok(distance(source.elbows[i],first.elbows[i])<.005);
    }
  }
});

test('ball tracking stays within neck limits and releases attention behind the player',()=>{for(const facing of[-1,1])for(const x of[-10,0,10])for(const y of[-3,0,3])for(const z of[-10,0,10]){const a=neckAngles({x,y,z},facing);assert.ok(Math.abs(a.yaw)<=.55);assert.ok(Math.abs(a.pitch)<=.5);if(z*facing<-.4)assert.equal(Math.abs(a.yaw)+Math.abs(a.pitch),0);}});

test('approach always has a planted support foot and the new plant never slides',()=>{for(const power of[0,.5,1])for(let n=0;n<=1000;n++){const phase=n/1000,p=strikerPose(0,phase,-1,power);assert.ok(p.feet.some(f=>Math.abs(f.y-.075)<.001),`unsupported at ${phase}`);if(phase>=.62)assert.ok(distance(p.feet[0],{x:-.28,y:.075,z:11.02})<1e-8);else assert.ok(distance(p.feet[1],{x:-.03,y:.075,z:12.05})<1e-8);}});

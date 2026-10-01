import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GoalNetMotion,NET_RESPONSE_DURATION,NET_MAX_DISPLACEMENT} from '../src/net-motion.js';
import {GoalBall} from '../src/ball-motion.js';

// Same xyz topology as buildGoal: full-length line segments, no interior nodes.
function authoredNet(){
  const points=[],postX=3.72,barY=2.5,add=(a,b)=>points.push(...a,...b);
  for(let x=-postX;x<=postX+.01;x+=.245){add([x,0,-2],[x,2.1,-1.7]);add([x,2.1,-1.7],[x,barY,.06]);}
  for(let y=0;y<=2.11;y+=.175)add([-postX,y,-2+y/2.1*.3],[postX,y,-2+y/2.1*.3]);
  for(const x of[-postX,postX]){for(let z=-2;z<=0;z+=.22)add([x,0,z],[x,barY+z*.17,z]);for(let y=.17;y<2.3;y+=.17)add([x,y,0],[x,Math.min(y,2.1),-1.7]);}
  return new Float32Array(points);
}
const event=(surface='back',position={x:0,y:1.2,z:-1.78},normal={x:0,y:0,z:-1},speed=22,time=0)=>({surface,position,normal,speed,time});
const displacement=(rest,arr,i)=>Math.hypot(arr[i]-rest[i],arr[i+1]-rest[i+1],arr[i+2]-rest[i+2]);

test('front frame, ground and rear corners stay byte-identical; seams taper',()=>{
  const rest=authoredNet(),out=rest.slice(),net=new GoalNetMotion(rest);net.impact(event());let moving=0,fixed=0,max=0;
  for(let t=0;t<=NET_RESPONSE_DURATION;t+=1/120){
    net.update(out,t);
    for(let i=0;i<rest.length;i+=3){
      const anchor=rest[i+1]<=.025||rest[i+2]>=-.025||(Math.abs(Math.abs(rest[i])-3.72)<1e-6&&Math.abs(rest[i+1]-2.1)<1e-6&&Math.abs(rest[i+2]+1.7)<1e-6);
      const delta=displacement(rest,out,i);max=Math.max(max,delta);
      if(anchor){assert.deepEqual(out.subarray(i,i+3),rest.subarray(i,i+3));fixed++;}else if(delta>1e-6)moving++;
    }
  }
  assert.ok(fixed>0&&moving>0);assert.ok(max>.002&&max<.06,`coarse edge motion remains subtle: ${max}`);
  const sample=new Float32Array([0,1.1,-1.8,3.72,1.1,-1.8]),weights=new GoalNetMotion(sample).weights;
  assert.ok(weights[1]<weights[0]*.3,'outer seam compliance is strongly attenuated');
});

test('back, left/right side and sloped roof sources push outward along their own normal',()=>{
  const slope=.4/1.76,length=Math.hypot(1,slope);
  for(const impact of[event(),event('side',{x:3.61,y:1.1,z:-.9},{x:1,y:0,z:0}),event('side',{x:-3.61,y:1.1,z:-.9},{x:-1,y:0,z:0}),event('roof',{x:0,y:2.14,z:-1.1},{x:0,y:1/length,z:-slope/length})]){
    const p=impact.position,rest=new Float32Array([p.x,p.y,p.z]),out=rest.slice(),net=new GoalNetMotion(rest);net.impact(impact);net.update(out,.075);
    const dx=out[0]-rest[0],dy=out[1]-rest[1],dz=out[2]-rest[2],n=impact.normal,dot=dx*n.x+dy*n.y+dz*n.z;
    assert.ok(dot>.004,`${impact.surface}: first wave pushes outward`);
    assert.ok(Math.hypot(dx-dot*n.x,dy-dot*n.y,dz-dot*n.z)<2e-7,'no unrelated-axis deformation');
  }
});

test('impacts copy metadata and restore every original float exactly once on expiry',()=>{
  const rest=authoredNet(),out=rest.slice(),net=new GoalNetMotion(rest),hit=event();assert.equal(net.update(out,0),false);
  net.impact(hit);hit.position.x=300;hit.normal.z=1;net.update(out,.16);assert.notDeepEqual(out,rest);
  assert.equal(net.update(out,NET_RESPONSE_DURATION),true);assert.deepEqual(out,rest);
  assert.equal(net.update(out,NET_RESPONSE_DURATION+1/60),false);assert.equal(net.update(out,1000),false);
  net.impact(event('back',undefined,undefined,22,1001));net.update(out,1001.2);assert.notDeepEqual(out,rest);
  assert.equal(net.reset(out),true);assert.deepEqual(out,rest);assert.equal(net.update(out,1002),false);
});

test('analytic samples are deterministic across frame rates, pauses and backwards seeks',()=>{
  const rest=authoredNet(),a=rest.slice(),b=rest.slice(),slow=new GoalNetMotion(rest),fast=new GoalNetMotion(rest);
  slow.impact(event());fast.impact(event());
  for(let frame=1;frame<=45;frame++){
    const time=frame/30;slow.update(a,time);fast.update(b,time-1/60);fast.update(b,time);assert.deepEqual(a,b);
    const frozen=b.slice();assert.equal(fast.update(b,time),false);assert.deepEqual(b,frozen);
  }
  slow.update(a,.287);const expected=a.slice();slow.update(a,2);assert.deepEqual(a,rest);slow.update(a,.287);assert.deepEqual(a,expected);
});

test('wave arrival, retrigger and return to rest are continuous with no final-frame pop',()=>{
  const rest=new Float32Array([0,1.2,-1.78,.8,1.2,-1.78,0,1.2,-.78]),out=rest.slice(),net=new GoalNetMotion(rest);
  net.impact(event());const eps=1e-6;
  for(const boundary of[0,.08,.1,1.2,NET_RESPONSE_DURATION]){
    net.update(out,boundary-eps);const before=out.slice();net.update(out,boundary+eps);
    assert.ok(Math.max(...out.map((n,i)=>Math.abs(n-before[i])))<1e-5,`continuous at ${boundary}`);
  }
  net.update(out,.2);const before=out.slice();net.impact(event('side',{x:0,y:1.2,z:-1.78},{x:1,y:0,z:0},22,.2));net.update(out,.2);assert.deepEqual(out,before,'new zero-age impulse does not erase/restart existing wave');
  net.update(out,NET_RESPONSE_DURATION+.2-eps);assert.ok(Math.max(...out.map((n,i)=>Math.abs(n-rest[i])))<1e-7);
  net.update(out,NET_RESPONSE_DURATION+.2);assert.deepEqual(out,rest);
});

test('repeated extreme impulses remain finite and bounded in a fixed eight-slot allocation',()=>{
  const rest=authoredNet(),out=rest.slice(),net=new GoalNetMotion(rest),slots=net.impulses.slice(),distances=slots.map(p=>p.distance),gains=slots.map(p=>p.gain);
  for(let i=0;i<240;i++){
    net.impact(event(i%2?'side':'roof',{x:(i%7)-3,y:.4+(i%8)*.2,z:-1.2},{x:i%2?1:0,y:i%2?0:1,z:-.2},1e12,i/120));
    net.update(out,i/120+.055);
    for(let v=0;v<rest.length;v+=3){assert.ok(Number.isFinite(out[v]+out[v+1]+out[v+2]));assert.ok(displacement(rest,out,v)<=NET_MAX_DISPLACEMENT+2e-7);}
  }
  assert.equal(net.count,8);assert.equal(net.impulses.length,8);
  for(let i=0;i<8;i++){assert.equal(net.impulses[i],slots[i]);assert.equal(net.impulses[i].distance,distances[i]);assert.equal(net.impulses[i].gain,gains[i]);}
  net.update(out,5);assert.deepEqual(out,rest);
});

test('invalid visual input is ignored instead of poisoning vertex positions',()=>{
  const rest=authoredNet(),out=rest.slice(),net=new GoalNetMotion(rest);
  for(const hit of[null,{},event('back',undefined,undefined,NaN),event('back',{x:NaN,y:0,z:0}),event('back',undefined,{x:0,y:0,z:0}),event('back',undefined,undefined,22,Infinity)])assert.equal(net.impact(hit),false);
  assert.equal(net.update(out,NaN),false);assert.deepEqual(out,rest);assert.equal(net.count,0);
  assert.throws(()=>net.update(rest,0),TypeError);assert.throws(()=>net.update(new Float32Array(3),0),TypeError);
});

test('fixed-step collision times drive the same net samples at 30 and 120 Hz',()=>{
  const rest=authoredNet(),a=rest.slice(),b=rest.slice(),netA=new GoalNetMotion(rest),netB=new GoalNetMotion(rest);
  const ballA=new GoalBall({x:3.4,y:2,z:-.12},{x:8,y:4,z:-25}),ballB=new GoalBall(ballA.position,ballA.velocity);
  for(let frame=1;frame<=60;frame++){
    ballA.advance(1/30,hit=>netA.impact(hit));netA.update(a,frame/30);
    for(let sub=0;sub<4;sub++){ballB.advance(1/120,hit=>netB.impact(hit));netB.update(b,((frame-1)*4+sub+1)/120);}
    assert.deepEqual(a,b);
  }
});

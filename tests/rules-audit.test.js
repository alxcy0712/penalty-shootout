import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Shot,GOAL,Match,winnerOf} from '../src/engine.js';
import {goalkeeperPose,placeKeeperPose,penaltyStyles,strikerRunupPose,blendKeeperPose,body} from '../src/anatomy.js';
const stats={accuracy:75,power:75,touch:75,composure:75,speed:75,reach:75,handling:95};
const make=()=>new Shot({x:0,power:.5,y:1},stats,stats,0,1);
test('goal aperture measures 7.32 m between posts and 2.44 m below the bar',()=>{
  for(const [x,y] of [[-3.54,1],[3.54,1],[2,2.32]]){
    const shot=make();shot.contactUntil=100;shot.ball={x,y,z:.3};shot.velocity={x:0,y:0,z:-30};
    for(let n=0;n<4&&!shot.result;n++)shot.step(1/120);
    assert.equal(shot.post,false);assert.equal(shot.result?.goal,true);
  }
  const post=make();post.contactUntil=100;post.ball={x:GOAL.half+GOAL.postRadius,y:1,z:.3};post.velocity={x:0,y:0,z:-30};post.step(1/120);
  assert.equal(post.post,true);assert.ok(post.velocity.z>0);
});
test('goal decision uses the full-ball crossing point rather than the end of the step',()=>{
  for(const [x,vx,goal] of [[3.53,6,true],[3.57,-6,false]]){
    const shot=make();shot.postUntil=shot.contactUntil=100;shot.ball={x,y:1,z:-.1};shot.velocity={x:vx,y:0,z:-30};shot.step(1/120);
    assert.equal(shot.result?.goal,goal);
  }
});
test('a keeper contact behind the completed goal crossing cannot cancel the goal',()=>{
  const shot=make(),pose=placeKeeperPose(goalkeeperPose(stats),{x:0,y:0,z:-.95});shot.poseAt=()=>pose;
  shot.ball={x:0,y:1,z:.05};shot.velocity={x:0,y:0,z:-100};shot.step(1/120);
  assert.equal(shot.result?.goal,true);assert.equal(shot.touched,false);
});
test('touchlines require the whole ball out and halfway is not an end line',()=>{
  const shot=make();shot.touched=true;shot.ball={x:34.05,y:.11,z:4};shot.velocity={x:.1,y:0,z:0};shot.step(1/120);assert.equal(shot.result,null);
  shot.ball={x:34.12,y:.11,z:4};shot.step(1/120);assert.equal(shot.result.goal,false);
  const long=make();long.touched=true;long.ball={x:0,y:.11,z:55};long.velocity={x:0,y:0,z:4};long.step(1/120);assert.equal(long.result,null);
});
test('every regular shootout scoring sequence finishes at the earliest mathematically decisive kick',()=>{
  for(const first of[0,1])for(let mask=0;mask<1024;mask++){
    const match=new Match('simple',1);match.start(first);
    for(let n=0;n<10;n++){
      match.record({goal:!!(mask&(1<<n))});
      const [a,b]=match.teams,expected=a.goals>b.goals+Math.max(0,5-b.kicks.length)?0:b.goals>a.goals+Math.max(0,5-a.kicks.length)?1:null;
      assert.equal(match.winner,expected);if(expected!==null){assert.equal(match.next(),false);break;}match.next();
    }
  }
  assert.equal(winnerOf([{goals:9,kicks:Array(12)},{goals:8,kicks:Array(11)}]),null);
});
test('runup carries forward momentum into the plant and takeoff velocity is continuous',()=>{
  const dt=.00001;
  for(const style of penaltyStyles){const t=style.duration-.55,sample=t=>strikerRunupPose(t,t/style.duration,-1,.7,0,style);assert.ok((sample(t-dt).hip.z-sample(t+dt).hip.z)/(2*dt)>.6);}
  for(const direction of[-1,1])for(const height of[.3,1.2,2.3]){
    const sample=t=>goalkeeperPose(stats,direction,t,height),a=sample(.13-dt),b=sample(.13),c=sample(.13+dt);
    for(const k of['x','y'])assert.ok(Math.abs((c.hip[k]-2*b.hip[k]+a.hip[k])/dt)<.01);
  }
});
test('render interpolation preserves endpoints and fixed bones across a dive',()=>{
  for(let frame=0;frame<200;frame++){
    const a=goalkeeperPose(stats,1,frame/120,2),b=goalkeeperPose(stats,1,(frame+1)/120,2);
    assert.equal(blendKeeperPose(a,b,0,false),a);assert.equal(blendKeeperPose(a,b,1,false),b);
    for(const alpha of[.2,.5,.8]){const p=blendKeeperPose(a,b,alpha,false);for(let i=0;i<2;i++)for(const [x,y,length]of[[p.hips[i],p.knees[i],body.thigh],[p.knees[i],p.feet[i],body.shin],[p.shoulders[i],p.elbows[i],body.upperArm],[p.elbows[i],p.hands[i],body.forearm]])assert.ok(Math.abs(Math.hypot(x.x-y.x,x.y-y.y,x.z-y.z)-length)<1e-8);}
  }
});

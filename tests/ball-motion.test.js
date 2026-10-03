import {test} from 'node:test';import assert from 'node:assert/strict';import {GoalBall} from '../src/ball-motion.js';
test('goal continuation preserves incoming velocity and gravity before net contact',()=>{const ball=new GoalBall({x:0,y:1,z:-.12},{x:1,y:2,z:-15});ball.advance(1/120);assert.equal(ball.velocity.z,-15);assert.ok(Math.abs(ball.velocity.y-(2-9.81/120))<1e-9);assert.equal(ball.netHits,0);});
test('net absorbs energy and the ball settles on the grass',()=>{const ball=new GoalBall({x:3.4,y:2,z:-.12},{x:8,y:4,z:-25});for(let i=0;i<120*15;i++){ball.advance(1/120);assert.ok(ball.position.y>=.11);assert.ok(ball.position.z>=-1.78);if(ball.position.z<0)assert.ok(Math.abs(ball.position.x)<=3.61);}assert.ok(ball.netHits>0);assert.equal(ball.sleeping,true);});
test('goal motion is independent of display frame rate and pause consumes no time',()=>{const a=new GoalBall({x:0,y:1,z:-.12},{x:2,y:3,z:-24}),b=new GoalBall(a.position,a.velocity);for(let i=0;i<240;i++)a.advance(1/120);for(let i=0;i<60;i++)b.advance(1/30);assert.deepEqual(a.position,b.position);const frozen={...a.position};a.advance(0);assert.deepEqual(a.position,frozen);});

test('goal net metadata has the exact contact point and outward back, side and roof normals',()=>{
  const cases=[
    [{x:0,y:1,z:-1.75},{x:0,y:0,z:-12},'back',{x:0,y:0,z:-1}],
    [{x:3.6,y:1,z:-.6},{x:10,y:0,z:0},'side',{x:1,y:0,z:0}],
    [{x:-3.6,y:1,z:-.6},{x:-10,y:0,z:0},'side',{x:-1,y:0,z:0}],
    [{x:0,y:2.2,z:-.6},{x:0,y:12,z:0},'roof',null],
  ];
  for(const [position,velocity,surface,normal]of cases){
    const ball=new GoalBall(position,velocity);let calls=0,contact;
    ball.advance(1/120,impact=>{calls++;contact=structuredClone(impact);});
    assert.equal(calls,1);assert.equal(contact.surface,surface);assert.deepEqual(contact.position,ball.position);
    assert.equal(contact.time,1/120);assert.ok(contact.speed>0);assert.ok(Math.abs(Math.hypot(...Object.values(contact.normal))-1)<1e-14);
    if(normal)assert.deepEqual(contact.normal,normal);
    else{assert.ok(contact.normal.y>0);assert.ok(contact.normal.z<0);assert.ok(Math.abs(contact.normal.z/contact.normal.y+.4/1.76)<1e-14);}
    const fixedContact={...ball.lastNetImpact.position};ball.advance(1/120);assert.deepEqual(ball.lastNetImpact.position,fixedContact);
    assert.notDeepEqual(ball.position,fixedContact,'contact must not alias the moving ball');
  }
});

test('every collision is reported synchronously during a coarse frame using one reusable record',()=>{
  const ball=new GoalBall({x:3.6,y:2.4,z:-1.77},{x:9,y:12,z:-20}),events=[],references=[];
  ball.advance(1/30,impact=>{events.push(structuredClone(impact));references.push(impact);});
  assert.deepEqual(events.map(e=>e.surface),['back','side','roof']);assert.equal(events.length,ball.netHits);
  assert.ok(references.every(record=>record===references[0]));assert.equal(ball.lastNetImpact,references[0]);
  assert.equal(events[0].position.z,-1.78);assert.equal(events[1].position.x,3.61);assert.ok(events[2].normal.y>0);
  assert.equal(events[0].time,events[2].time);assert.ok(ball.time>events[2].time);
});

// Frozen a0db4a3 continuation: this reference intentionally excludes visual metadata.
// Keep collision order, arithmetic, damping and the accumulator byte-for-byte aligned
// with that release so adding net feedback cannot accidentally change trajectories.
class LegacyGoalBall {
  constructor(position,velocity){this.position={...position};this.velocity={...velocity};this.accumulator=0;this.netHits=0;this.lastImpactSpeed=0;this.sleeping=false;}
  advance(seconds){
    if(this.sleeping)return;
    this.accumulator+=Math.max(0,seconds);
    while(this.accumulator>=1/120){this.step(1/120);this.accumulator-=1/120;if(this.sleeping){this.accumulator=0;break;}}
  }
  step(dt){
    const p=this.position,v=this.velocity;v.y-=9.81*dt;p.x+=v.x*dt;p.y+=v.y*dt;p.z+=v.z*dt;
    if(p.y<.11){p.y=.11;if(v.y<-.6)v.y*=-.26;else v.y=0;const speed=Math.hypot(v.x,v.z),friction=Math.max(0,1-4*dt/(speed||1));v.x*=friction;v.z*=friction;}
    if(p.z<-1.78){p.z=-1.78;if(v.z<0){this.lastImpactSpeed=Math.abs(v.z);v.z*=-.13;v.x*=.72;v.y*=.72;this.netHits++;}}
    if(p.z<0){
      if(Math.abs(p.x)>3.61){p.x=Math.sign(p.x)*3.61;if(p.x*v.x>0){this.lastImpactSpeed=Math.abs(v.x);v.x*=-.15;this.netHits++;}}
      const roof=2.39+(p.z-.06)*(.4/1.76);if(p.y>roof){p.y=roof;if(v.y>0){this.lastImpactSpeed=v.y;v.y*=-.15;this.netHits++;}}
    }
    if(p.y===.11&&Math.hypot(v.x,v.y,v.z)<.06){v.x=v.y=v.z=0;this.sleeping=true;}
  }
}

test('metadata leaves every original physics value bit-identical across 96 seeded trajectories',()=>{
  let seed=719;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const state=ball=>({position:ball.position,velocity:ball.velocity,accumulator:ball.accumulator,netHits:ball.netHits,lastImpactSpeed:ball.lastImpactSpeed,sleeping:ball.sleeping});
  const steps=[0,1/240,1/120,1/60,1/30,.047,-.01];let hits=0;
  for(let sample=0;sample<96;sample++){
    const position={x:(random()-.5)*7.2,y:.11+random()*2.28,z:-.12-random()*1.65},velocity={x:(random()-.5)*24,y:(random()-.25)*16,z:-2-random()*36};
    const current=new GoalBall(position,velocity),legacy=new LegacyGoalBall(position,velocity);
    for(let frame=0;frame<720;frame++){
      const dt=steps[(frame+sample)%steps.length];current.advance(dt,()=>{hits++;});legacy.advance(dt);
      assert.deepEqual(state(current),state(legacy),`trajectory ${sample}, frame ${frame}`);
    }
  }
  assert.ok(hits>96,'matrix must exercise net collisions');
});

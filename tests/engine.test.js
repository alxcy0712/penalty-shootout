import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Match, Shot, Random, createTeams, winnerOf, gestureInput, directionMeter} from '../src/engine.js';
import {holdingPose,HOLD_DURATION} from '../src/anatomy.js';
const team=(goals,kicks)=>({goals,kicks:Array(kicks).fill({})});
test('early finish and unequal kick counts',()=>{
  assert.equal(winnerOf([team(3,3),team(0,3)]),0);
  assert.equal(winnerOf([team(4,4),team(2,3)]),null);
  assert.equal(winnerOf([team(2,3),team(4,4)]),null);
  assert.equal(winnerOf([team(2,4),team(4,4)]),1);
});
test('sudden death only resolves after equal kick counts',()=>{
  assert.equal(winnerOf([team(3,5),team(3,5)]),null);
  assert.equal(winnerOf([team(4,6),team(3,5)]),null);
  assert.equal(winnerOf([team(4,6),team(4,6)]),null);
  assert.equal(winnerOf([team(4,6),team(3,6)]),0);
});
test('all eleven kick including goalkeeper before repetition',()=>{
  const m=new Match('advanced',7);m.start(0);const ids=[[],[]];
  for(let i=0;i<24;i++){ids[m.turn].push(m.kicker);m.record({goal:true});if(i<23)m.next();}
  for(const id of ids){assert.equal(new Set(id.slice(0,11)).size,11);assert.ok(id.slice(0,11).includes(0));assert.equal(id[11],id[0]);}
});
test('team generation respects ranges over 100 seeds',()=>{
  for(let s=1;s<=100;s++)for(const t of createTeams(new Random(s),'advanced')){
    assert.equal(t.players.length,11);assert.equal(t.players.filter(p=>p.position==='门将').length,1);
    assert.ok(t.players[0].handling>=90&&t.players[0].handling<=99);
    for(const p of t.players)for(const k of ['accuracy','power','composure','touch','speed','reach','handling'])assert.ok(Number.isInteger(p[k])&&p[k]>=1&&p[k]<=99);
  }
});
test('recording is idempotent and saved match continues deterministic RNG',()=>{
  const m=new Match('simple',22);m.start(1);m.record({goal:true});assert.equal(m.record({goal:true}),false);assert.equal(m.teams[1].goals,1);
  const restored=Match.restore(JSON.parse(JSON.stringify(m)));m.next();restored.next();assert.deepEqual(restored.aiAim,m.aiAim);assert.equal(restored.aiDive,m.aiDive);
});
test('gesture speed, threshold, viewport scaling, and direction',()=>{
  const path=t=>[{x:100,y:200,t:0},{x:110,y:180,t:20},{x:140,y:80,t}];
  const fast=gestureInput(path(120),300,300,2),slow=gestureInput(path(700),300,300,2);
  assert.ok(fast.power>slow.power);assert.equal(fast.x,slow.x);
  assert.ok(gestureInput(path(700),300,300,.7).power>slow.power);
  const scale=gestureInput(path(700).map(p=>({...p,x:p.x*2,y:p.y*2})),600,600,2);
  assert.ok(Math.abs(scale.speed-slow.speed)<.001);
  assert.equal(gestureInput([{x:1,y:1,t:0},{x:3,y:4,t:100}],300,300,2),null);
});
function run(s){for(let i=0;i<120*30&&!s.result;i++)s.step(1/120);assert.ok(s.result,'shot must settle within 30s');return s.result;}
const stats={accuracy:90,power:90,touch:90,composure:90,speed:80,reach:80,handling:95};
test('timeout is central minimum effective force and simulation resolves',()=>{
  const s=new Shot({x:3,power:1,timeout:true},stats,stats,-1,4);assert.equal(s.target.x,0);assert.equal(s.actualPower,0);assert.ok(s.launchSpeed>0);run(s);
});
test('late dive is one shot only, shots restore and produce same results',()=>{
  const a=new Shot({x:2.5,power:.7,y:1.3},stats,stats,0,44);
  for(let i=0;i<12;i++)a.step(1/120);assert.equal(a.dive(1),true);assert.equal(a.dive(-1),false);
  const b=Shot.restore(JSON.parse(JSON.stringify(a)));assert.deepEqual(run(a),run(b));
});
test('central goalkeeper reacts to the ball and late lateral input starts from that pose',()=>{
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
  const central=new Shot({x:0,power:.45,y:1.6},stats,stats,0,41),initial=central.pose;
  for(let i=0;i<36;i++)central.step(1/120);
  assert.equal(central.result,null);
  for(let i=0;i<2;i++){
    assert.ok(central.pose.hands[i].y>initial.hands[i].y+.2);
    assert.ok(central.pose.hands[i].y>central.pose.elbows[i].y);
    assert.ok(Math.abs(central.pose.hands[i].x)<.2);
    assert.ok(distance(central.pose.feet[i],initial.feet[i])<1e-8);
  }
  for(const direction of[-1,1])for(const height of[.3,1.2,2.3]){
    const s=new Shot({x:2.5,power:.5,y:height},stats,stats,0,44);
    for(let i=0;i<24;i++)s.step(1/120);
    const origin=s.pose;assert.equal(s.dive(direction),true);assert.deepEqual(s.poseAt(s.t,height),origin);
    let previous=origin;
    for(let i=1;i<=160;i++){
      const next=s.poseAt(s.t+i/1000,height);
      for(const part of['hands','elbows','feet','knees'])for(let side=0;side<2;side++)assert.ok(distance(next[part][side],previous[part][side])<.022,`${part} jumps on a late dive`);
      previous=next;
    }
  }
});
test('1000 physical shots settle, AI outcomes include goals and saves',()=>{
  const rng=new Random(1);let goals=0,saves=0;
  for(let i=0;i<1000;i++){const s=new Shot({x:rng.range(-4,4),y:rng.range(.1,2.8),power:rng.range(0,1)},stats,stats,rng.int(-1,1),i+1);const r=run(s);goals+=+r.goal;saves+=+r.saved;}
  assert.ok(goals>100&&goals<950);assert.ok(saves>20);
});
test('bounces preserve a committed dive and the result continues from the final physical pose',()=>{
  const s=new Shot({x:2.5,power:.7,y:2.1},stats,stats,1,17);
  for(let i=0;i<24;i++)s.step(1/120);
  const expected=s.poseAt(s.t+.001);
  s.ball={x:10,y:.11,z:3};s.velocity={x:0,y:-1,z:-5};s.step(.001);
  assert.deepEqual(s.pose.hip,expected.hip);
  for(let seed=1;seed<=300;seed++){
    const shot=new Shot({x:Math.sin(seed)*3.5,power:(seed%10)/10,y:.3+(seed%7)/3},stats,stats,seed%3-1,seed);
    run(shot);assert.deepEqual(shot.poseAt(shot.t),shot.pose,`result pose changed for seed ${seed}`);
    const restored=Shot.restore(JSON.parse(JSON.stringify(shot)));
    assert.deepEqual(restored.poseAt(restored.t),shot.pose,`restored result pose changed for seed ${seed}`);
  }
});
test('sideways catches gather the ball without flipping the elbow through the ground',()=>{
  for(const seed of[14,59,71,87,111,128]){
    const shot=new Shot({x:Math.sin(seed)*3.3,power:(seed%10)/10,y:.3+(seed%7)/3},stats,stats,seed%3-1,seed);
    run(shot);assert.ok(shot.caught);let previous=shot.pose;
    for(let ms=1;ms<=HOLD_DURATION*1000;ms++){
      const pose=holdingPose(shot.poseAt(shot.t+ms/1000),ms/1000/HOLD_DURATION).pose;
      for(let i=0;i<2;i++){
        const a=previous.elbows[i],b=pose.elbows[i];
        assert.ok(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)<.022,`catch ${seed} flips at ${ms} ms`);
        assert.ok(b.y>=.075-1e-8);
      }
      previous=pose;
    }
  }
});
test('whole ball, rebound goal, post rebound, and secure possession',()=>{
  const s=new Shot({x:0,power:.5},stats,stats,-1,1);s.ball={x:2,y:1,z:-.10};s.velocity={x:0,y:0,z:0};s.contactUntil=100;s.postUntil=100;s.step(1/120);assert.equal(s.result,null);
  s.touched=true;s.velocity.z=-5;s.step(1/120);assert.equal(s.result.goal,true);assert.equal(s.result.saved,false);
  const p=new Shot({x:0,power:.5},stats,stats,-1,1);p.ball={x:3.66,y:1,z:.3};p.velocity={x:0,y:0,z:-30};p.contactUntil=100;p.step(1/120);assert.equal(p.post,true);assert.ok(p.velocity.z>0);
  const c=new Shot({x:0,power:.5},stats,stats,0,1);c.finish(false,'抱住');c.ball={x:0,y:1,z:-1};c.step(1/120);assert.equal(c.result.goal,false);
});
test('AI dive selection is approximately uniform over many independent turns',()=>{
  const m=new Match('simple',999);const counts=[0,0,0];for(let i=0;i<12000;i++){m.prepare();counts[m.aiDive+1]++;}for(const n of counts)assert.ok(n>3650&&n<4350);
});

test('light pushes remain on the grass even when the gesture asks for height',()=>{
  for(const power of[0,.1,.2])for(const y of[.2,2.4]){
    const shot=new Shot({x:1,power,y},stats,stats,-1,42);
    for(let i=0;i<120&&!shot.result;i++){shot.step(1/120);assert.ok(shot.ball.y<=.115);}
  }
});
test('frontal body contact reflects at the entry surface before crossing the body',()=>{
  const shot=new Shot({x:0,power:1,y:1},stats,stats,0,2);
  const pose=shot.pose;shot.poseAt=()=>pose;
  shot.ball={x:0,y:1,z:.55};shot.velocity={x:0,y:0,z:-60};shot.step(1/120);
  assert.ok(shot.touched);assert.ok(shot.velocity.z>0);assert.ok(shot.ball.z>.2);assert.equal(shot.result,null);
});
test('central keeper lowers hands to block a rolling ball',()=>{
  let saves=0;
  for(let seed=1;seed<=50;seed++){const s=new Shot({x:0,power:.1,y:.2},stats,stats,0,seed);run(s);assert.ok(s.touched);saves+=Number(s.result.saved);}
  assert.ok(saves>=45);
});
test('direction meter accelerates toward corners with no endpoint dwell',()=>{
  const speed=t=>Math.abs((directionMeter(t+.0001)-directionMeter(t))/.0001);
  assert.ok(speed(.65)>speed(.05)*2.5);
  assert.ok(Math.abs(directionMeter(.7)-3.75)<1e-8);
  assert.ok(directionMeter(.69)<3.65&&directionMeter(.71)<3.65);
  for(let t=0;t<8;t+=.001)assert.ok(Math.abs(directionMeter(t))<=3.75+1e-8);
});

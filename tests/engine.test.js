import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Match, Shot, Random, createTeams, winnerOf, gestureInput, directionMeter, powerMeter} from '../src/engine.js';
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
  for(const seed of[16,18,134,158,192,215]){
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
test('the revised elbow paths preserve saves for the previous catch fixtures',()=>{
  for(const seed of [59,87,95]){
    const shot=new Shot({x:Math.sin(seed)*3.3,power:(seed%10)/10,y:.3+(seed%7)/3},stats,stats,seed%3-1,seed);
    run(shot);assert.ok(shot.result.saved,`keeper still saves shot ${seed}`);
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
  assert.ok(speed(.55)>speed(.05)*2.5);
  assert.ok(Math.abs(directionMeter(.6)-4.6)<1e-8);
  assert.ok(directionMeter(.57)>3.8&&directionMeter(.63)>3.8);
  for(let t=0;t<8;t+=.001)assert.ok(Math.abs(directionMeter(t))<=4.6+1e-8);
});


test('minimum push crosses the line slowly without keeper contact',()=>{
  const shot=new Shot({x:2.5,power:0,y:2},stats,stats,-1,5);shot.contactUntil=100;assert.equal(run(shot).goal,true);assert.ok(shot.t>2);assert.ok(shot.launchSpeed<6);
});
test('correct-side keepers save slow balls more often than fast corners',()=>{
  let slow=0,fast=0,wrong=0;
  for(const x of [-3.2,-2.5,-1.6,1.6,2.5,3.2])for(let seed=1;seed<=20;seed++){
    slow+=+run(new Shot({x,power:0,y:1.2},stats,stats,Math.sign(x),seed)).saved;
    fast+=+run(new Shot({x,power:1,y:1.2},stats,stats,Math.sign(x),seed)).saved;
    wrong+=+run(new Shot({x,power:1,y:1.2},stats,stats,-Math.sign(x),seed)).saved;
  }
  assert.ok(slow>100);assert.ok(slow>fast+40);assert.ok(wrong<10);
});
test('full power misses depend on overall control and exceed gentle-shot errors',()=>{
  const misses=(ability,power)=>{let count=0;const player={...stats,accuracy:ability,touch:ability,composure:ability,power:ability};for(let seed=1;seed<=400;seed++){const shot=new Shot({x:2,power,y:1.4},player,stats,-1,seed);count+=Number(shot.target.y>2.33);}return count;};
  assert.ok(misses(55,1)>misses(95,1)+30);assert.ok(misses(55,1)>misses(55,.5)+30);
});
test('adjustable gestures preserve power while held and reduce power on pullback',()=>{
  const start={x:150,y:280,t:0},end={x:180,y:100,t:100};
  const a=gestureInput([start,end],300,300,2,true),held=gestureInput([start,end,{...end,t:3000}],300,300,2,true),back=gestureInput([start,end,{x:180,y:210,t:3100}],300,300,2,true);
  assert.equal(a.power,held.power);assert.ok(back.power<a.power/2);
  const curved=gestureInput([start,{x:230,y:190,t:50},end],300,300,2,true);assert.ok(Math.abs(curved.curve)>.5);assert.equal(a.curve,0);
});
test('curve ability creates lateral acceleration and survives saved-shot restore',()=>{
  const shot=ability=>new Shot({x:2,power:.7,y:1.3,curve:1},{...stats,curve:ability},stats,-1,19);
  const high=shot(99),low=shot(40),vx=high.velocity.x;for(let i=0;i<15;i++){high.step(1/120);low.step(1/120);}assert.ok(high.velocity.x>vx);assert.ok(high.spin>low.spin*2);
  const restored=Shot.restore(JSON.parse(JSON.stringify(high)));assert.deepEqual(run(high),run(restored));
  const match=new Match('advanced',9);for(const team of match.teams)for(const p of team.players)delete p.curve;assert.equal(Match.restore(JSON.parse(JSON.stringify(match))).teams[0].players[0].curve,76);
});

test('slow-ball tracking moves with continuous steps and survives restoring mid-step',()=>{
  for(const direction of[-1,0,1]){
    const shot=new Shot({x:2.5,power:0,y:.2},stats,stats,direction,42),initial=shot.pose;
    for(let ms=1;ms<=360;ms++)shot.step(.001);
    assert.ok(shot.keeperOffset.x>.05);assert.ok(shot.pose.hip.y<initial.hip.y-.07);
    const restored=Shot.restore(JSON.parse(JSON.stringify(shot)));assert.deepEqual(run(shot),run(restored));
  }
});
test('fast shots trigger the committed dive immediately',()=>{
  for(const direction of[-1,1]){
    const shot=new Shot({x:direction*2.5,power:1,y:1.2},stats,stats,direction,42);
    assert.equal(shot.diveDelay,0);assert.ok(shot.poseAt(.1).hip.x*direction>.08);
  }
});

test('corner timing windows are narrow, mirrored and surrounded by reachable lanes and misses',()=>{
  let corner=0,outside=0;
  for(let i=0;i<24000;i++){
    const t=i/10000,x=directionMeter(t);
    assert.ok(Math.abs(x+directionMeter(t+1.2))<1e-10);
    if(x>=3.3&&x<=3.5)corner++;
    if(Math.abs(x)>3.83)outside++;
  }
  // Two passes per side: at most 20 ms per pass in the final safe corner band.
  assert.ok(corner>0&&corner/10000/2<.020);
  assert.ok(outside/24000>.04);
});
test('power meter accelerates into full charge without dwelling and retains gentle pushes',()=>{
  assert.equal(powerMeter(0),0);assert.equal(powerMeter(1.2),1);assert.equal(powerMeter(2.4),0);
  assert.ok(powerMeter(.1)<.03);
  assert.ok(powerMeter(1.2)-powerMeter(1.19)>powerMeter(.2)-powerMeter(.19));
  assert.ok(powerMeter(1.18)<.98&&powerMeter(1.22)<.98);
});
test('simple abilities use 75 in new teams and legacy saves, preserving specialist handling',()=>{
  const m=new Match('simple',42),keys=['accuracy','power','touch','composure','curve','speed','reach'];
  for(const team of m.teams)for(const p of team.players){for(const k of keys){assert.equal(p[k],75);p[k]=76;}assert.equal(p.handling,95);}
  const restored=Match.restore(JSON.parse(JSON.stringify(m)));
  for(const team of restored.teams)for(const p of team.players)for(const k of keys)assert.equal(p[k],75);
});
test('accuracy, foot power, touch and composure affect actual shot launch',()=>{
  const aim={x:2,power:.6,y:1.3};
  const shot=(key,ability,seed)=>new Shot(aim,{...stats,[key]:ability},stats,0,seed,.9);
  let lowAccuracy=0,highAccuracy=0,lowTouch=0,highTouch=0,lowComposure=0,highComposure=0;
  for(let seed=1;seed<=500;seed++){
    lowAccuracy+=Math.abs(shot('accuracy',40,seed).target.x-2);highAccuracy+=Math.abs(shot('accuracy',95,seed).target.x-2);
    lowTouch+=Math.abs(shot('touch',40,seed).actualPower-.6);highTouch+=Math.abs(shot('touch',95,seed).actualPower-.6);
    lowComposure+=Math.abs(shot('composure',40,seed).target.x-2);highComposure+=Math.abs(shot('composure',95,seed).target.x-2);
  }
  assert.ok(lowAccuracy>highAccuracy*3);assert.ok(lowTouch>highTouch*5);assert.ok(lowComposure>highComposure*1.3);
  assert.ok(shot('power',95,1).launchSpeed>shot('power',40,1).launchSpeed+2);
});

test('driven low shots keep speed independent of height and stay near the turf',()=>{
  for(const power of [.12,.6,.85])for(let seed=1;seed<=12;seed++){
    const aim={x:2,power,y:2.4,curve:1};
    const low=new Shot({...aim,low:true},stats,stats,-1,seed);
    const regular=new Shot(aim,stats,stats,-1,seed);
    assert.equal(low.launchSpeed,regular.launchSpeed);
    assert.equal(low.spin,0);
    assert.ok(low.velocity.y<.3);
    while(low.ball.z>1&&!low.result){low.step(1/120);assert.ok(low.ball.y<.16);}
    if(power===.85)assert.ok(low.launchSpeed>25);
  }
});
test('full-power low shots retain ability-dependent mishits',()=>{
  const counts=[55,95].map(ability=>{
    const player={...stats,accuracy:ability,power:ability,touch:ability,composure:ability};let mishits=0;
    for(let seed=1;seed<=600;seed++){
      const shot=new Shot({x:2,power:1,low:true},player,stats,-1,seed);
      if(shot.velocity.y>1)mishits++;
    }
    return mishits;
  });
  assert.ok(counts[0]>counts[1]*2);assert.ok(counts[1]>0);
});
test('Panenka has a slow lofted trajectory and remains reachable by a central keeper',()=>{
  let saves=0;
  for(let seed=1;seed<=20;seed++){
    const chip=new Shot({x:0,power:.55,chip:true},stats,stats,0,seed);
    assert.ok(chip.launchSpeed<13);assert.ok(chip.velocity.y>4);
    let apex=.11;
    while(!chip.result&&chip.t<8){chip.step(1/120);apex=Math.max(apex,chip.ball.y);}
    assert.ok(apex>1.3);assert.ok(apex<2.44);assert.ok(chip.result);
    saves+=Number(chip.result.saved);
  }
  assert.ok(saves>=18);
});
test('Panenka height increases with power, with overhit chips able to clear the bar',()=>{
  const player={...stats,accuracy:99,power:99,touch:99,composure:99};
  for(let seed=1;seed<=30;seed++){
    let previousApex=0;
    for(const power of[0,.25,.5,.75,1]){
      const shot=new Shot({x:0,power,chip:true},player,stats,0,seed);
      const apex=.11+shot.velocity.y**2/(2*9.81);
      assert.ok(apex>previousApex+.2);previousApex=apex;
      if(power===1)assert.ok(shot.target.y>2.44);
    }
  }
});

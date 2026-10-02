// Deterministic physical invariants. This is an audit, not a timing benchmark.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Shot,GOAL,keeperPose} from '../../src/engine.js';
import {placeKeeperPose} from '../../src/anatomy.js';
import {keeperSurfaceContacts} from '../../src/keeper-contact.js';

const root=fileURLToPath(new URL('../../',import.meta.url));
export const STEP=1/120;
const copy=p=>({x:p.x,y:p.y,z:p.z});
const norm2=p=>p.x*p.x+p.y*p.y+p.z*p.z;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const crossing=(a,b)=>a.z>=-GOAL.radius&&b.z<-GOAL.radius?(-GOAL.radius-a.z)/(b.z-a.z):Infinity;
const interpolate=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});
const hand=part=>part==='handL'||part==='handR';

// Independent analytic finite-capsule entry. Goal posts are axis aligned;
// testing cylinder roots plus the end spheres avoids copying sweptDistance.
export function capsuleEntry(start,end,a,b,radius){
  const delta={x:end.x-start.x,y:end.y-start.y,z:end.z-start.z};
  const axis=['x','y','z'].find(k=>a[k]!==b[k]),others=['x','y','z'].filter(k=>k!==axis);
  const nearest={...a,[axis]:Math.max(Math.min(a[axis],b[axis]),Math.min(Math.max(a[axis],b[axis]),start[axis]))};
  if(distance(start,nearest)<radius)return 0;
  const candidates=[];
  function roots(keys,center,accept){
    const A=keys.reduce((s,k)=>s+delta[k]**2,0),B=2*keys.reduce((s,k)=>s+(start[k]-center[k])*delta[k],0),C=keys.reduce((s,k)=>s+(start[k]-center[k])**2,0)-radius**2;
    const discriminant=B*B-4*A*C;if(A<=1e-20||discriminant<0)return;
    for(const t of[(-B-Math.sqrt(discriminant))/(2*A),(-B+Math.sqrt(discriminant))/(2*A)])if(t>=0&&t<=1&&accept(t))candidates.push(t);
  }
  roots(others,a,t=>{const p=start[axis]+delta[axis]*t;return p>=Math.min(a[axis],b[axis])&&p<=Math.max(a[axis],b[axis]);});
  for(const p of[a,b])roots(['x','y','z'],p,()=>true);
  return candidates.length?Math.min(...candidates):Infinity;
}
function capsuleMinimumSquared(start,end,a,b){
  const axis=['x','y','z'].find(k=>a[k]!==b[k]),lo=Math.min(a[axis],b[axis]),hi=Math.max(a[axis],b[axis]);
  const delta={x:end.x-start.x,y:end.y-start.y,z:end.z-start.z},cuts=[0,1];
  if(delta[axis])for(const edge of[lo,hi]){const t=(edge-start[axis])/delta[axis];if(t>0&&t<1)cuts.push(t);}
  cuts.sort((x,y)=>x-y);let minimum=Infinity;
  for(let i=1;i<cuts.length;i++){
    const from=cuts[i-1],to=cuts[i],mid=start[axis]+delta[axis]*(from+to)/2;
    const keys=['x','y','z'].filter(k=>k!==axis||mid<lo||mid>hi),center={...a,[axis]:mid<lo?lo:hi};
    const A=keys.reduce((sum,k)=>sum+delta[k]**2,0),B=keys.reduce((sum,k)=>sum+delta[k]*(start[k]-center[k]),0);
    const t=A?Math.max(from,Math.min(to,-B/A)):from;
    minimum=Math.min(minimum,keys.reduce((sum,k)=>sum+(start[k]+delta[k]*t-center[k])**2,0));
  }
  return minimum;
}
function posts(start,end){
  const x=GOAL.half+GOAL.postRadius,y=GOAL.height+GOAL.postRadius,z=GOAL.postRadius;
  const radius=GOAL.radius+GOAL.postRadius;
  return [[{x:-x,y:0,z},{x:-x,y,z}],[{x,y:0,z},{x,y,z}],[{x:-x,y,z},{x,y,z}]].map(([a,b],index)=>({index,time:capsuleEntry(start,end,a,b,radius),penetrates:capsuleMinimumSquared(start,end,a,b)<radius**2})).filter(p=>Number.isFinite(p.time)&&p.penetrates);
}

export function auditShot(recipe,{shot=new Shot(recipe.aim,recipe.stats,recipe.stats,recipe.direction,recipe.seed),maxSteps=3600,stopAfterSteps=false}={}){
  const failures=[],events=[],rolls=[],lastRoll={},counts={steps:0,keeperResolutions:0,postResolutions:0,reflections:0,handlingRolls:0,energyChecks:0,orderingChecks:0,postAbsenceChecks:0,goalChecks:0,finiteChecks:0};
  let frame=null,part=shot.contactPart,maxResolutions=0,maxEnergyIncrease=0,minimumBallY=shot.ball.y,finishCalls=0;
  const check=(ok,invariant,detail={})=>{if(!ok)failures.push({invariant,step:counts.steps,time:shot.t,...detail});};
  const finite=(value,path)=>{if(typeof value==='number'){counts.finiteChecks++;check(Number.isFinite(value),'finite',{path,value:String(value)});}else if(value&&typeof value==='object')for(const[k,v]of Object.entries(value))finite(v,`${path}.${k}`);};
  const append=event=>{check(!shot.result,'no-contact-after-result');events.push({step:counts.steps,time:shot.t,...event});};
  Object.defineProperty(shot,'contactPart',{configurable:true,enumerable:true,get:()=>part,set:value=>{
    part=value;if(!frame)return;
    const start=frame.sweepStart,end=copy(shot.ball),line=crossing(start,end);
    const candidates=keeperSurfaceContacts(shot.pose,start,end,GOAL.radius).filter(c=>c.hit.time<line).sort((a,b)=>a.hit.time-b.hit.time);
    const selected=candidates.find(c=>c.part===value),first=candidates[0];
    counts.orderingChecks++;
    check(!!first&&!!selected&&selected.hit.time<=first.hit.time+1e-10,'earliest-keeper-surface',{part:value,first:first&&{part:first.part,time:first.hit.time}});
    check(!!selected&&selected.hit.time<line,'keeper-before-whole-ball-crossing',{part:value,entry:selected?.hit.time,crossing:line});
    if(shot.t>shot.postUntil&&selected){
      const earlier=posts(start,end).find(p=>p.time<selected.hit.time-1e-4&&p.time<line);
      check(!earlier,'post-before-keeper',{part:value,keeperTime:selected.hit.time,post:earlier});
    }
    check(!frame.physicalEvents.length||frame.physicalEvents.at(-1).fraction===0,'resweep-only-after-time-zero-contact');
    const event={type:'keeper',part:value,fraction:selected?.hit.time??null};
    frame.keeperEvents.push(event);frame.physicalEvents.push(event);frame.selected=selected;frame.priorCooldown=shot.handlingUntil[value]??0;
    counts.keeperResolutions++;append(event);
  }});
  const reflect=shot.reflect.bind(shot);
  shot.reflect=(hit,radius,restitution)=>{
    const before=norm2(shot.velocity),isPost=restitution===.72;
    if(isPost){
      counts.postResolutions++;const geometric=posts(frame.sweepStart,shot.ball).sort((a,b)=>a.time-b.time),line=crossing(frame.sweepStart,shot.ball);
      counts.orderingChecks++;
      check(geometric.length>0&&Math.abs(hit.time-geometric[0].time)<1e-4,'earliest-post-surface',{actual:hit.time,expected:geometric[0]?.time});
      check(hit.time<line,'post-before-whole-ball-crossing',{entry:hit.time,crossing:line});
      const earlier=keeperSurfaceContacts(shot.pose,frame.sweepStart,shot.ball,GOAL.radius).filter(c=>c.hit.time<hit.time-1e-8&&c.hit.time<line).sort((a,b)=>a.hit.time-b.hit.time)[0];
      check(!earlier,'keeper-before-post',{postTime:hit.time,keeper:earlier&&{part:earlier.part,time:earlier.hit.time},start:copy(frame.sweepStart),end:copy(shot.ball)});
      check(!frame.physicalEvents.length||frame.physicalEvents.at(-1).fraction===0,'resweep-only-after-time-zero-contact');
      const event={type:'post',fraction:hit.time};frame.physicalEvents.push(event);append(event);
    }else{
      check(!!frame.selected,'reflection-follows-selected-contact');
      if(frame.selected)check(distance(hit.p,frame.selected.hit.p)<1e-9,'reflection-uses-selected-surface');
    }
    reflect(hit,radius,restitution);counts.reflections++;counts.energyChecks++;
    const increase=norm2(shot.velocity)-before;maxEnergyIncrease=Math.max(maxEnergyIncrease,increase);
    check(increase<=1e-9*Math.max(1,before),'reflection-energy-nonincreasing',{before,after:norm2(shot.velocity)});
    check(shot.ball.y>=GOAL.radius-1e-9,'reflection-floor',{y:shot.ball.y});
    if(hit.time===0)frame.sweepStart=copy(shot.ball);
  };
  const next=shot.rng.next.bind(shot.rng);
  shot.rng.next=()=>{
    counts.handlingRolls++;check(hand(part),'only-gloves-roll-handling',{part});
    check(shot.t>frame.priorCooldown,'per-glove-cooldown',{part,until:frame.priorCooldown});
    if(lastRoll[part]!==undefined)check(shot.t-lastRoll[part]>=.09-1e-9,'handling-retry-spacing',{part,last:lastRoll[part]});
    lastRoll[part]=shot.t;rolls.push({part,time:shot.t});return next();
  };
  const finish=shot.finish.bind(shot);
  shot.finish=(goal,reason)=>{
    finishCalls++;check(!shot.result,'single-terminal-event');
    if(goal||shot.ball.z<-GOAL.radius){
      counts.goalChecks++;check(shot.ball.z<-GOAL.radius,'whole-ball-required-for-goal');
      const fraction=crossing(frame.sweepStart,shot.ball),point=Number.isFinite(fraction)?interpolate(frame.sweepStart,shot.ball,fraction):shot.ball;
      check(goal===(Math.abs(point.x)<=GOAL.half-GOAL.radius&&point.y<=GOAL.height-GOAL.radius),'last-physical-segment-goal',{point,goal});
    }
    events.push({type:'result',step:counts.steps,time:shot.t,goal,caught:shot.caught});finish(goal,reason);
  };
  for(let index=0;index<maxSteps&&!shot.result;index++){
    counts.steps++;frame={sweepStart:copy(shot.ball),keeperEvents:[],physicalEvents:[],selected:null,priorCooldown:0};
    shot.step(STEP);maxResolutions=Math.max(maxResolutions,frame.physicalEvents.length);
    check(frame.physicalEvents.length<=4,'four-physical-resolutions-per-step',{count:frame.physicalEvents.length});
    // A silent detector is not evidence of clear space. Independently inspect
    // the unresolved actual segment, including entry at its final endpoint.
    // Positive-time contact ends a step; four time-zero contacts exhaust its
    // explicit bound. Only the remaining unconsumed segments must be clear.
    const last=frame.physicalEvents.at(-1);
    if((!last||(last.fraction===0&&frame.physicalEvents.length<4))&&shot.t>shot.postUntil){
      counts.postAbsenceChecks++;
      const line=crossing(frame.sweepStart,shot.ball),expected=posts(frame.sweepStart,shot.ball).filter(p=>p.time<line).sort((a,b)=>a.time-b.time)[0];
      if(expected){
        const keeperFirst=keeperSurfaceContacts(shot.pose,frame.sweepStart,shot.ball,GOAL.radius).some(c=>c.hit.time<=expected.time+1e-8&&c.hit.time<line);
        check(keeperFirst,'expected-post-contact-emitted',{post:expected,start:copy(frame.sweepStart),end:copy(shot.ball)});
      }
    }
    for(const key of['ball','previous','velocity','pose','t','animationTime','reactionHeight','handlingUntil'])finite(shot[key],key);
    minimumBallY=Math.min(minimumBallY,shot.ball.y);check(shot.ball.y>=GOAL.radius-1e-9,'ball-floor',{y:shot.ball.y});
  }
  if(!stopAfterSteps)check(!!shot.result,'termination-within-thirty-seconds');
  if(typeof recipe.expectedCaught==='boolean')check(shot.caught===recipe.expectedCaught,'manifest-catch-pin',{expected:recipe.expectedCaught,actual:shot.caught});
  if(shot.result){
    check(finishCalls===1,'exactly-one-result');
    check(shot.result.saved===(!shot.result.goal&&shot.touched),'saved-result-consistency');
    check(shot.result.post===shot.post,'post-result-consistency');
    if(shot.caught)check(shot.touched&&shot.result.saved&&!shot.result.goal&&norm2(shot.velocity)===0&&hand(shot.contactPart),'secure-possession-terminal-state');
    const before=JSON.stringify(shot),eventCount=events.length;shot.step(STEP);shot.step(1);
    check(JSON.stringify(shot)===before&&events.length===eventCount,'terminal-state-is-immutable');
    check(events.at(-1)?.type==='result','result-is-last-event');
  }
  return {id:recipe.id,counts,steps:counts.steps,caught:shot.caught,touched:shot.touched,post:shot.post,goal:shot.result?.goal??null,terminated:!!shot.result,maxResolutions,maxEnergyIncrease,minimumBallY,firstEvent:events[0]??null,lastPhysicalEvent:events.filter(e=>e.type!=='result').at(-1)??null,lastEvent:events.at(-1)??null,failures};
}

const stats={accuracy:90,power:90,touch:90,composure:90,speed:85,reach:85,handling:95};
export function boundaryCases(){
  const cases=[];
  function add(id,ball,velocity,pose,expected={}){
    const recipe={id,aim:{x:0,y:1,power:.5},stats,direction:0,seed:1},shot=new Shot(recipe.aim,stats,stats,0,1);
    shot.pose=pose;shot.poseAt=()=>pose;shot.trackKeeper=()=>{};shot.ball=ball;shot.velocity=velocity;
    cases.push({recipe,shot,expected});
  }
  // The incoming segment meets the torso, then the post. Mirrors are separate
  // retained fixtures, since reflection and model geometry need not be symmetric.
  for(const side of[-1,1])add(`keeper-before-post-${side}`,{x:side*3.65,y:1,z:.4},{x:0,y:9.81/120,z:-30},placeKeeperPose(keeperPose(stats,0,.5,1.2),{x:side*3.5,y:0,z:0}),{post:false,touched:true});
  const distant=placeKeeperPose(keeperPose(stats),{x:20,y:0,z:0});
  for(const side of[-1,1])add(`unobstructed-post-${side}`,{x:side*3.72,y:1,z:.4},{x:0,y:9.81/120,z:-30},distant,{post:true,goal:null});
  for(const side of[-1,1])for(const[label,speed,post]of[['inside',20.4012,true],['tangent',20.4,false],['outside',20.3988,false]])
    add(`endpoint-post-${side}-${label}`,{x:side*3.72,y:1,z:.4},{x:0,y:9.81/120,z:-speed},distant,{post,goal:null,touched:false});
  for(const side of[-1,1])for(const offset of[-.00001,.00001])add(`crossing-aperture-${side}-${offset}`,{x:side*(3.55+offset),y:1,z:-.10},{x:0,y:9.81/120,z:-3},distant,{goal:offset<0});
  add('keeper-behind-completed-crossing',{x:0,y:1,z:.05},{x:0,y:9.81/120,z:-100},placeKeeperPose(keeperPose(stats),{x:0,y:0,z:-.95}),{goal:true,touched:false});
  return cases;
}
export function auditBoundaries(){
  return boundaryCases().map(({recipe,shot,expected})=>{
    const result=auditShot(recipe,{shot,maxSteps:1,stopAfterSteps:true});
    for(const[key,value]of Object.entries(expected))if(result[key]!==value)result.failures.push({invariant:'boundary-outcome',key,expected:value,actual:result[key]});
    return result;
  });
}
const sourceHashes=async()=>Object.fromEntries(await Promise.all((await readdir(resolve(root,'src'))).filter(f=>f.endsWith('.js')).sort().map(async f=>['src/'+f,hash(await readFile(resolve(root,'src',f)))])));

async function main(){
  const args=process.argv.slice(2),option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
  const manifest=resolve(root,option('--fixtures','validation/five-rounds/union-fixtures.json')),out=resolve(option('--out','/tmp/penalty-ten-rounds/round-1'));
  const bytes=await readFile(manifest),data=JSON.parse(bytes),sources=await sourceHashes(),startedAt=new Date().toISOString();
  assert.equal(new Set(data.fixtures.map(r=>r.id)).size,data.fixtures.length,'no manifest fixture omitted or duplicated');
  assert.ok(data.fixtures.every(r=>typeof r.expectedCaught==='boolean'),'every catch outcome is pinned');
  const records=data.fixtures.map(r=>auditShot(r)),boundaries=auditBoundaries();
  const counts=records.reduce((sum,r)=>{for(const[k,v]of Object.entries(r.counts))sum[k]=(sum[k]??0)+v;return sum;},{});
  const failures=[...records,...boundaries].flatMap(r=>r.failures.map(f=>({id:r.id,...f})));
  if(records.filter(r=>r.caught).length!==data.expectedCaptures)failures.push({invariant:'manifest-total-catch-pin'});
  assert.deepEqual(await sourceHashes(),sources,'runtime source changed during audit');
  await mkdir(out,{recursive:true});
  const detail=JSON.stringify({manifestRecords:records,boundaryRecords:boundaries},null,2)+'\n';
  await writeFile(resolve(out,'physics-invariants.json'),detail);
  let tests=null;
  if(args.includes('--test')){
    const files=['tests/physics-invariants.test.js','tests/rebound-contact-order.test.js','tests/rules-audit.test.js'];
    const run=spawnSync(process.execPath,['--test','--test-reporter=tap',...files],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
    const log=run.stdout+run.stderr;await writeFile(resolve(out,'focused-tests.log'),log);
    tests={command:`node --test --test-reporter=tap ${files.join(' ')}`,exitCode:run.status,tests:Number(log.match(/# tests (\d+)/)?.[1]??0),passed:Number(log.match(/# pass (\d+)/)?.[1]??0),failed:Number(log.match(/# fail (\d+)/)?.[1]??0),logSha256:hash(log)};
    assert.ok(tests.tests>0,'focused test receipt includes executed cases');
  }
  const report={round:1,status:failures.length||tests?.exitCode?'failed':'passed',startedAt,completedAt:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),manifest:{path:manifest,sha256:hash(bytes),shots:records.length,expectedCaptures:data.expectedCaptures},sourceHashes:sources,auditSha256:hash(await readFile(fileURLToPath(import.meta.url))),counts:{...counts,caught:records.filter(r=>r.caught).length,touched:records.filter(r=>r.touched).length,goals:records.filter(r=>r.goal).length,posts:records.filter(r=>r.post).length,terminated:records.filter(r=>r.terminated).length,boundaries:boundaries.length,maximumResolutionsPerStep:Math.max(...records.map(r=>r.maxResolutions)),maximumReflectionEnergyIncrease:Math.max(...records.map(r=>r.maxEnergyIncrease)),minimumBallY:Math.min(...records.map(r=>r.minimumBallY))},failures,tests,details:{path:resolve(out,'physics-invariants.json'),sha256:hash(detail)},limits:'Independent mathematical/semantic assertions; keeper-surface time ordering uses the production geometry query as its oracle, while frame capsule entry is independently analytic. No continuous-time skin proof, rendering, or benchmarking.'};
  await writeFile(resolve(out,'summary.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({out,status:report.status,counts:report.counts,failures,tests},null,2));
  if(args.includes('--check')&&report.status!=='passed')process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();

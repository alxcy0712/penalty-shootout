#!/usr/bin/env node
// Compare both gather kernels on identical current-engine physical captures.
// No git/network is used. The supplied baseline checkout must resolve its own
// dependencies, normally through its existing or symlinked node_modules.
import {readFile,writeFile,mkdir,readdir,stat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {Vector3} from 'three';
import {Shot} from '../../src/engine.js';
import {HOLD_DURATION} from '../../src/anatomy.js';
import {keeperGather as candidate} from '../../src/keeper-contact.js';

const usage='node tools/qa/audit-keeper-gather-softening.mjs --baseline PATH [--out DIR] [--check]\nPATH is a local baseline checkout or its src/keeper-contact.js module. Both kernels use the same current-engine captures and input poses. No git or network is required.';
if(process.argv.includes('--help')){console.log(usage);process.exit(0);}
const args={};for(let i=2;i<process.argv.length;i++){
  const key=process.argv[i];if(key==='--check'){args.check=true;continue;}
  if(!['--baseline','--out'].includes(key)||!process.argv[i+1]||process.argv[i+1].startsWith('--'))throw Error(usage);
  args[key.slice(2)]=process.argv[++i];
}
if(!args.baseline)throw Error(usage);
const root=fileURLToPath(new URL('../../',import.meta.url)),out=resolve(args.out??'validation/artifacts/keeper-gather-softening');
let baselineModule=resolve(args.baseline);if((await stat(baselineModule)).isDirectory())baselineModule=resolve(baselineModule,'src/keeper-contact.js');
if(baselineModule===resolve(root,'src/keeper-contact.js'))throw Error('Baseline and candidate must be different modules.');
const {keeperGather:baseline}=await import(pathToFileURL(baselineModule).href);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function sourceHashes(directory){
  const files=(await readdir(directory)).filter(name=>name.endsWith('.js')).sort();
  return Object.fromEntries(await Promise.all(files.map(async name=>[name,hash(await readFile(resolve(directory,name)))])));
}
const sources={candidate:await sourceHashes(resolve(root,'src')),baseline:await sourceHashes(dirname(baselineModule))};
const stats={accuracy:90,power:90,touch:90,composure:90,speed:85,reach:85,handling:95},recipes=[];
for(const x of[-3.3,-1.5,0,1.5,3.3])for(const y of[.2,1.2,2.2])for(const power of[.12,.5,.9])for(const direction of[-1,0,1])recipes.push({aim:{x,y,power},direction,seed:42,stats});
for(const[direction,y,x,seed]of[[-1,.3,2,3],[-1,2.1,1.5,2],[1,.3,2,3],[1,2.1,1.5,1]])recipes.push({aim:{x:direction*x,y,power:.55},direction,seed,stats:{...stats,speed:95,reach:95}});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const relative=(pose,index)=>new Vector3().subVectors(pose.elbows[index],pose.hip);
const upper=(pose,index)=>new Vector3().subVectors(pose.elbows[index],pose.shoulders[index]);
function maximumDelta(a,b){
  if(typeof a==='number'&&typeof b==='number')return Math.abs(a-b);
  if(a&&b&&typeof a==='object'&&typeof b==='object'){
    const keys=new Set([...Object.keys(a),...Object.keys(b)]);
    return Math.max(0,...[...keys].map(key=>maximumDelta(a[key],b[key])));
  }
  return Object.is(a,b)?0:Infinity;
}
const comparable=r=>({pose:r.pose,ball:r.ball,center:r.center,weight:r.weight});
const hz=240,duration=2.8,records=[],failures=[];
const worst={ball:0,wrist:0,handRotation:0,limbLength:0,captureOrSecuredPose:0,randomAccess:0,elbowChange:0};
let changedElbowSamples=0;
for(const [caseIndex,recipe]of recipes.entries()){
  const shot=new Shot(recipe.aim,recipe.stats,recipe.stats,recipe.direction,recipe.seed);
  for(let step=0;step<3600&&!shot.result;step++)shot.step(1/120);
  if(!shot.caught)continue;
  const at=(kernel,time)=>kernel(shot.pose,shot.poseAt((shot.animationTime??shot.t)+time),shot.ball,shot.contactPart,time/HOLD_DURATION);
  const peaks={baseline:{speed:0,degrees:0,worldStep:0},candidate:{speed:0,degrees:0,worldStep:0}};
  let previous,maxElbowChange=0;
  for(let frame=0;frame<=duration*hz;frame++){
    const time=frame/hz,raw=shot.poseAt((shot.animationTime??shot.t)+time);
    const results={baseline:baseline(shot.pose,raw,shot.ball,shot.contactPart,time/HOLD_DURATION),candidate:candidate(shot.pose,raw,shot.ball,shot.contactPart,time/HOLD_DURATION)};
    const a=results.candidate,b=results.baseline;
    worst.ball=Math.max(worst.ball,distance(a.ball,b.ball));
    worst.handRotation=Math.max(worst.handRotation,maximumDelta(a.pose.grip?.handRotations,b.pose.grip?.handRotations));
    if(time===0||time>=HOLD_DURATION)worst.captureOrSecuredPose=Math.max(worst.captureOrSecuredPose,maximumDelta(comparable(a),comparable(b)));
    for(let arm=0;arm<2;arm++){
      worst.wrist=Math.max(worst.wrist,distance(a.pose.hands[arm],b.pose.hands[arm]));
      worst.limbLength=Math.max(worst.limbLength,Math.abs(distance(a.pose.shoulders[arm],a.pose.elbows[arm])-.29),Math.abs(distance(a.pose.elbows[arm],a.pose.hands[arm])-.27));
      const change=distance(a.pose.elbows[arm],b.pose.elbows[arm]);maxElbowChange=Math.max(maxElbowChange,change);if(change>1e-12)changedElbowSamples++;
      if(previous)for(const [name,result]of Object.entries(results)){
        const before=previous[name],speed=relative(result.pose,arm).distanceTo(relative(before.pose,arm))*hz;
        if(speed>peaks[name].speed)Object.assign(peaks[name],{speed,time,arm});
        peaks[name].degrees=Math.max(peaks[name].degrees,upper(result.pose,arm).angleTo(upper(before.pose,arm))*180/Math.PI);
        peaks[name].worldStep=Math.max(peaks[name].worldStep,distance(result.pose.elbows[arm],before.pose.elbows[arm]));
      }
    }
    previous=results;
  }
  const expected=at(candidate,.177);at(candidate,2.8);at(candidate,0);
  worst.randomAccess=Math.max(worst.randomAccess,maximumDelta(comparable(at(candidate,.177)),comparable(expected)));
  worst.elbowChange=Math.max(worst.elbowChange,maxElbowChange);
  if(peaks.candidate.speed>peaks.baseline.speed+1e-8)failures.push({caseIndex,reason:'Full-path elbow peak increased',baseline:peaks.baseline.speed,candidate:peaks.candidate.speed});
  if(peaks.candidate.worldStep>=.04)failures.push({caseIndex,reason:'Existing 4 cm/240Hz elbow gate exceeded',step:peaks.candidate.worldStep});
  const record={caseIndex,recipe,captureTime:shot.t,animationTime:shot.animationTime,contactPart:shot.contactPart,peaks,maxElbowChange};records.push(record);
  console.log(JSON.stringify({caseIndex,aim:recipe.aim,direction:recipe.direction,baseline:peaks.baseline.speed,candidate:peaks.candidate.speed,maxElbowChange}));
}
if(records.length!==40)failures.push({reason:'Canonical capture count changed',expected:40,actual:records.length});
for(const key of['ball','wrist','handRotation','limbLength','captureOrSecuredPose'])if(worst[key]>1e-12)failures.push({reason:`${key} numerical invariance failed`,delta:worst[key]});
if(worst.randomAccess!==0)failures.push({reason:'History-dependent output',delta:worst.randomAccess});
const sourcesAfter={candidate:await sourceHashes(resolve(root,'src')),baseline:await sourceHashes(dirname(baselineModule))};
if(JSON.stringify(sources)!==JSON.stringify(sourcesAfter))failures.push({reason:'Source changed during audit; rerun on a frozen source tree'});
const report={method:'Both gather kernels receive identical current-engine captures and raw input poses. Full recovery at 240Hz; speed is hip-relative elbow interval distance/dt, angle is upper-arm per-step change. Protected skin clearance is a separate audit. No mobile performance claim.',baselineModule,candidateRoot:root,sources,sourcesAfter,hz,duration,captures:records.length,samples:records.length*(duration*hz+1),changedElbowSamples,worst,records,failures};
await mkdir(out,{recursive:true});await writeFile(resolve(out,'gather-softening-comparison.json'),JSON.stringify(report,null,2)+'\n');
console.log('GATHER_SOFTENING_SUMMARY',JSON.stringify({captures:records.length,samples:report.samples,changedElbowSamples,worst,failures:failures.length,output:resolve(out,'gather-softening-comparison.json')}));
if(args.check&&failures.length)process.exitCode=1;

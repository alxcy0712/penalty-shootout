#!/usr/bin/env node
// Bounded, repeatable Node CPU benchmark. No WebGL, texture decode, GPU or
// mobile frame-rate claim. Timing and call-count instrumentation run separately.
import {performance} from 'node:perf_hooks';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {cpus, platform, arch} from 'node:os';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import * as THREE from 'three';

const args=process.argv.slice(2), root=fileURLToPath(new URL('../../',import.meta.url));
if(args.includes('--help')) {
  console.log('Usage: node tools/qa/benchmark-character-runtime.mjs [--out DIR] [--rounds 3]\nMeasures actual GLB GameCharacter.pose/kick and 135 deterministic shots on Node CPU. No render/GPU/device claims.');
  process.exit(0);
}
function option(name,fallback) { const i=args.indexOf(name);return i<0?fallback:args[i+1]; }
const rounds=Number(option('--rounds',3)),out=resolve(option('--out','validation/artifacts'));
if(!Number.isInteger(rounds)||rounds<1||rounds>20)throw new Error('--rounds must be an integer from 1 to 20');
const sourceFiles=['src/game-character.js','src/character.js','src/batching.js','src/anatomy.js','src/engine.js','src/keeper-skin-pose.js','src/keeper-skin-weights.js','src/keeper-arm-roll.js','src/keeper-hand-contact.js','src/keeper-contact.js','src/keeper-contact-data.js','src/striker-kick-style.js','src/striker-runup-style.js','src/striker-arm-clearance.js','src/striker-captures.js','tools/qa/load-review-character.mjs','assets/characters/keeper-prototype.glb','assets/characters/striker-mocap.glb','assets/characters/mocap-variants/cmu-10_03-kick.glb'];
const digest=value=>createHash('sha256').update(value).digest('hex');
async function hashes(){return Object.fromEntries(await Promise.all(sourceFiles.map(async name=>[name,digest(await readFile(resolve(root,name)))])));}
const sourceSha256=await hashes();
const [{loadCharacter},{goalkeeperPose,penaltyStyles},{Shot}]=await Promise.all([
  import('./load-review-character.mjs'),import('../../src/anatomy.js'),import('../../src/engine.js'),
]);
const stats={accuracy:90,power:90,touch:90,composure:90,speed:85,reach:85,handling:95};
const quantile=(sorted,q)=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*q))]??0;
function summary(values){const sorted=values.slice().sort((a,b)=>a-b);return {n:values.length,mean:values.reduce((a,b)=>a+b,0)/(values.length||1),p50:quantile(sorted,.5),p95:quantile(sorted,.95),p99:quantile(sorted,.99),max:sorted.at(-1)??0};}
const startup=[];
async function load(keeper){const start=performance.now(),actor=await loadCharacter(keeper);startup.push({actor:keeper?'keeper':'striker',elapsedMs:performance.now()-start});return actor;}
const keeper=await load(true),striker=await load(false);
const keeperInputs=[];
for(const direction of [-1,0,1])for(const height of [.3,1.2,2.3])for(let frame=0;frame<=120;frame++)keeperInputs.push({direction,height,time:frame/30});
const keeperPoses=keeperInputs.map(({direction,height,time})=>goalkeeperPose(stats,direction,time,height));
const kickFrames=[];
for(const style of penaltyStyles)for(const shotType of ['normal','low','chip']) {
  for(let frame=0;frame<=Math.ceil((style.duration+1.8)*60);frame++) {
    const time=frame/60;
    kickFrames.push({runup:Math.min(1,time/style.duration),after:time>=style.duration?time-style.duration:null,options:{style,targetX:shotType==='low'?-4.5:shotType==='chip'?4.5:0,power:.85,shotType}});
  }
}
function timeFrames(inputs,apply) {
  const durations=[],start=performance.now();
  for(let i=0;i<inputs.length;i++){const at=performance.now();apply(inputs[i],i);durations.push(performance.now()-at);}
  return {totalMs:performance.now()-start,frameMs:summary(durations)};
}
const operations={
  keeperPoseGeneration:()=>timeFrames(keeperInputs,({direction,height,time})=>goalkeeperPose(stats,direction,time,height)),
  keeperVisualPose:()=>timeFrames(keeperPoses,pose=>keeper.pose(pose)),
  strikerVisualKick:()=>timeFrames(kickFrames,({runup,after,options})=>striker.kick(runup,after,options)),
};
// Warm the real methods, lazy overlay creation, mixer and JS tiering before
// measuring. Inputs are reused intentionally; generation is measured separately.
for(let i=0;i<2;i++)for(const operation of Object.values(operations))operation();
const characterRuns=[];
for(let run=0;run<rounds;run++) {
  const result={};
  // Alternate order to reduce a systematic tiering/thermal order advantage.
  const names=Object.keys(operations);if(run%2)names.reverse();
  for(const name of names)result[name]=operations[name]();
  characterRuns.push(result);
}

// Count actual Object3D methods, including recursive node visits, separately
// from timings. Clones count only explicit .clone() calls, not all allocations.
function countCalls(actor,apply) {
  const counters={updateMatrix:0,updateMatrixWorld:0,updateWorldMatrix:0,getWorldPosition:0,getWorldQuaternion:0,worldToLocal:0,rootFullHierarchyUpdates:0,vectorClones:0,quaternionClones:0},restore=[];
  for(const name of ['updateMatrix','updateMatrixWorld','updateWorldMatrix','getWorldPosition','getWorldQuaternion','worldToLocal']) {
    const original=THREE.Object3D.prototype[name];
    THREE.Object3D.prototype[name]=function(...args){counters[name]++;if(this===actor.root&&(name==='updateMatrixWorld'||name==='updateWorldMatrix'&&args[1]))counters.rootFullHierarchyUpdates++;return original.apply(this,args);};
    restore.push(()=>{THREE.Object3D.prototype[name]=original;});
  }
  for(const [prototype,key] of [[THREE.Vector3.prototype,'vectorClones'],[THREE.Quaternion.prototype,'quaternionClones']]) {
    const original=prototype.clone;prototype.clone=function(){counters[key]++;return original.call(this);};restore.push(()=>{prototype.clone=original;});
  }
  try{apply();}finally{for(const undo of restore.reverse())undo();}
  return counters;
}
function profileSample(actor,apply){apply();return countCalls(actor,apply);}
const legacyStyle=penaltyStyles.find(style=>!style.capture),compactStyle=penaltyStyles.find(style=>style.capture);
const matrixCalls={
  keeperDivePose:profileSample(keeper,()=>keeper.pose(goalkeeperPose(stats,1,.5,1.2))),
  strikerContact:profileSample(striker,()=>striker.kick(1,0,{style:legacyStyle,shotType:'normal',power:.85})),
  strikerChipFollowThrough:profileSample(striker,()=>striker.kick(1,.2,{style:legacyStyle,shotType:'chip',power:.85})),
  strikerSettling:profileSample(striker,()=>striker.kick(1,1.6,{style:legacyStyle,shotType:'normal',power:.85})),
  strikerCompact:profileSample(striker,()=>striker.kick(1,.3,{style:compactStyle,shotType:'normal',power:.85})),
};
// Exact transform fingerprints make optimization comparisons auditable without
// accepting a faster but different pose. They are collected outside timings.
function poseFingerprint(actor,inputs,apply){
  const hash=createHash('sha256'),bones=[];actor.root.traverse(object=>{if(object.isBone)bones.push(object);});
  for(const input of inputs){apply(input);hash.update(JSON.stringify([actor.root.position.toArray(),actor.root.quaternion.toArray(),...bones.map(bone=>[bone.name,bone.position.toArray(),bone.quaternion.toArray(),bone.scale.toArray(),bone.matrixWorld.toArray()])]));}
  return hash.digest('hex');
}
const poseSha256={
  keeper:poseFingerprint(keeper,keeperPoses,pose=>keeper.pose(pose)),
  striker:poseFingerprint(striker,kickFrames,({runup,after,options})=>striker.kick(runup,after,options)),
};
const cases=[];
for(const x of [-3.3,-1.5,0,1.5,3.3])for(const y of [.2,1.2,2.2])for(const power of [.12,.5,.9])for(const direction of [-1,0,1])cases.push({aim:{x,y,power},direction,seed:42});
function contactBenchmark(){
  const construction=[],near=[],all=[],outcomes=[],totals={cases:cases.length,steps:0,touched:0,saved:0,caught:0,goals:0,reboundGoals:0},start=performance.now();
  for(const c of cases){
    const at=performance.now(),shot=new Shot(c.aim,stats,stats,c.direction,c.seed);construction.push(performance.now()-at);
    for(let i=0;i<3600&&!shot.result;i++){
      const close=shot.ball.z<1.5&&shot.ball.z>-.4,before=performance.now();shot.step(1/120);const ms=performance.now()-before;all.push(ms);if(close)near.push(ms);totals.steps++;
    }
    if(!shot.result)throw new Error('A deterministic shot did not settle within 3600 fixed steps');
    totals.touched+=+shot.touched;totals.saved+=+shot.result.saved;totals.caught+=+shot.caught;totals.goals+=+shot.result.goal;totals.reboundGoals+=+(shot.result.goal&&shot.touched);
    outcomes.push({result:shot.result,touched:shot.touched,caught:shot.caught,ball:shot.ball});
  }
  return {...totals,totalMs:performance.now()-start,constructMs:summary(construction),allStepMs:summary(all),nearGoalStepMs:summary(near),outcomeSha256:digest(JSON.stringify(outcomes))};
}
contactBenchmark();
const contactRuns=Array.from({length:rounds},()=>contactBenchmark());
if(new Set(contactRuns.map(run=>run.outcomeSha256)).size!==1)throw new Error('Deterministic shot outcomes changed between runs');
const after=await hashes();
if(JSON.stringify(after)!==JSON.stringify(sourceSha256))throw new Error('Sources/assets changed during measurement; rerun against a stable snapshot');
const medianTotalMs=Object.fromEntries(Object.keys(operations).map(name=>[name,summary(characterRuns.map(run=>run[name].totalMs)).p50]));
const report={
  scope:'Milliseconds on this Node/cloud CPU only. Loaded production GLB skin and GameCharacter methods; texture decoding, browser rendering, GPU, phones, power and frame pacing are not measured. Pose input generation, asset preparation and visual updates are separated. Method-call instrumentation is excluded from timings.',
  generatedAt:new Date().toISOString(),gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  environment:{node:process.version,three:THREE.REVISION,platform:platform(),architecture:arch(),cpu:cpus()[0]?.model,logicalCpuCount:cpus().length},
  configuration:{rounds,characterWarmupPasses:2,contactWarmupPasses:1,keeperFrames:keeperPoses.length,strikerFrames:kickFrames.length,styles:penaltyStyles.map(style=>style.name??style.motion??style.capture?.clipName),contactFixedStepSeconds:1/120},
  sourceSha256,startup:{note:'One sequential uncached Node file/GLB parse+rig-preparation sample each, not a browser network or production cache benchmark.',samples:startup},
  character:{medianTotalMs,runs:characterRuns,poseSha256},matrixCalls,
  contact:{medianTotalMs:summary(contactRuns.map(run=>run.totalMs)).p50,runs:contactRuns},
};
await mkdir(out,{recursive:true});const destination=resolve(out,'character-runtime-benchmark.json');await writeFile(destination,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({report:destination,...report},null,2));

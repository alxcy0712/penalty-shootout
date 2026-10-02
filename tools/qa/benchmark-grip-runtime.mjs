#!/usr/bin/env node
// Compare real GameCharacter.pose CPU work with identical precomputed inputs.
// Rendering, uploads, texture decoding and device frame rate are not measured.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';

const args=process.argv.slice(2),root=fileURLToPath(new URL('../../',import.meta.url));
const option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
if(args.includes('--help')){console.log('node tools/qa/benchmark-grip-runtime.mjs --before BASELINE_CHECKOUT [--out DIR] [--rounds 5] [--fixtures JSON]\nWarm alternating real-skin pose updates on identical final-revision inputs. Both checkouts need installed dependencies. CPU only.');process.exit(0);}
assert.ok(args.includes('--before'),'provide a verified baseline checkout');
const beforeRoot=resolve(option('--before')),out=resolve(option('--out','/tmp/keeper-grip-runtime'));
const rounds=Number(option('--rounds',5));assert.ok(Number.isInteger(rounds)&&rounds>=3&&rounds<=15);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function hashes(dir){
 const files=[...(await readdir(resolve(dir,'src'))).filter(f=>f.endsWith('.js')).sort().map(f=>'src/'+f),'tests/helpers/load-character.js','assets/characters/keeper-prototype.glb'];
 return Object.fromEntries(await Promise.all(files.map(async f=>[f,digest(await readFile(resolve(dir,f)))])));
}
const sourceHashes={before:await hashes(beforeRoot),after:await hashes(root)};
const load=async(dir,path)=>import(pathToFileURL(resolve(dir,path)).href);
const [{loadCharacter:loadBefore},{loadCharacter:loadAfter},{Shot},{keeperGather},{goalkeeperPose,HOLD_DURATION},{goalkeeperPose:beforePose}]=await Promise.all([
  load(beforeRoot,'tests/helpers/load-character.js'),load(root,'tests/helpers/load-character.js'),load(root,'src/engine.js'),load(root,'src/keeper-contact.js'),load(root,'src/anatomy.js'),
  load(beforeRoot,'src/anatomy.js'),
]);
const before=await loadBefore(true),after=await loadAfter(true);
const manifestPath=resolve(option('--fixtures',resolve(root,'validation/ten-rounds/union-fixtures.json'))),manifestBytes=await readFile(manifestPath),manifest=JSON.parse(manifestBytes);
const held=[],free=[],freeInputs=[],captures=[];
for(const recipe of manifest.fixtures){
 const shot=new Shot(recipe.aim,recipe.stats,recipe.stats,recipe.direction,recipe.seed);
 for(let i=0;i<3600&&!shot.result;i++)shot.step(1/120);
 assert.ok(shot.result,`unfinished ${recipe.id}`);assert.equal(shot.caught,recipe.expectedCaught,`capture outcome ${recipe.id}`);
 if(!shot.caught)continue;captures.push(recipe.id);
 for(const t of[0,1/120,.04,.10,.166666667,.22,.30,.44,.60,.85,1.1,1.4,1.8,2.2,2.8])held.push(keeperGather(shot.pose,shot.poseAt((shot.animationTime??shot.t)+t),shot.ball,shot.contactPart,t/HOLD_DURATION).pose);
}
assert.equal(captures.length,manifest.expectedCaptures);
for(const direction of[-1,0,1])for(const height of[.3,1.2,2.3])for(let f=0;f<=120;f++){
 const input=[{speed:85,reach:85},direction,f/30,height];freeInputs.push(input);free.push(goalkeeperPose(...input));
}
const inputs={free,held},inputHashes=Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,digest(JSON.stringify(v))]));
const quantile=(values,q)=>{const s=values.toSorted((a,b)=>a-b);return s[Math.min(s.length-1,Math.floor(s.length*q))];};
function batch(actor,poses){const times=[],start=performance.now();for(const pose of poses){const at=performance.now();actor.pose(pose);times.push(performance.now()-at);}return{totalMs:performance.now()-start,poses:poses.length,p50Ms:quantile(times,.5),p99Ms:quantile(times,.99)};}
for(const poses of Object.values(inputs)){batch(before,poses);batch(after,poses);}
const timing={};
for(const [name,poses]of Object.entries(inputs)){
 const runs={before:[],after:[]};
 for(let round=0;round<rounds;round++)for(const [key,actor]of(round%2?[['after',after],['before',before]]:[['before',before],['after',after]]))runs[key].push(batch(actor,poses));
 timing[name]={runs,medianBatchMs:Object.fromEntries(Object.entries(runs).map(([key,values])=>[key,quantile(values.map(v=>v.totalMs),.5)]))};
}
function generation(fn){const start=performance.now();let checksum=0;for(const input of freeInputs)checksum+=fn(...input).hip.y;assert.ok(Number.isFinite(checksum));return performance.now()-start;}
// Candidate pose generation was also used to prepare the physical inputs.
// Give both revisions repeated equivalent warmup before this separate timing.
for(let warm=0;warm<8;warm++){generation(beforePose);generation(goalkeeperPose);}
const generationRuns={before:[],after:[]};
for(let round=0;round<rounds;round++)for(const [key,fn]of(round%2?[['after',goalkeeperPose],['before',beforePose]]:[['before',beforePose],['after',goalkeeperPose]]))generationRuns[key].push(generation(fn));
const poseGeneration={samples:freeInputs.length,warmupBatchesPerRevision:8,runs:generationRuns,medianBatchMs:Object.fromEntries(Object.entries(generationRuns).map(([key,values])=>[key,quantile(values,.5)]))};
assert.deepEqual(await hashes(beforeRoot),sourceHashes.before,'baseline changed during benchmark');assert.deepEqual(await hashes(root),sourceHashes.after,'candidate changed during benchmark');
assert.deepEqual(Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,digest(JSON.stringify(v))])),inputHashes,'pose update mutated caller input');
const report={generatedAt:new Date().toISOString(),scope:'Cloud Node CPU: real loaded keeper GameCharacter.pose on identical precomputed final-revision inputs. Free-pose construction is timed separately using each revision. Warm alternating paired batches. Excludes gathering, physics, skin readback, GPU, upload time, draw calls, browser/phone performance and thermal behavior; separate medians must not be summed into a frame-rate claim.',baseline:{path:beforeRoot,commit:execFileSync('git',['rev-parse','HEAD'],{cwd:beforeRoot,encoding:'utf8'}).trim()},sourceHashes,benchmarkSha256:digest(await readFile(fileURLToPath(import.meta.url))),manifest:{sha256:digest(manifestBytes),shots:manifest.fixtures.length,captures:captures.length},rounds,inputHashes,samples:{free:free.length,held:held.length},timing,poseGeneration};
await mkdir(out,{recursive:true});await writeFile(resolve(out,'grip-runtime.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({out,samples:report.samples,timing},null,2));

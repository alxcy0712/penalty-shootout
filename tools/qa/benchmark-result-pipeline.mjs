// Quiet alternating CPU batches of the actual terminal presentation pipeline.
// Includes poseAt, caught gathering and the loaded GameCharacter.pose update.
// Excludes renderer/GPU uploads, asset loading, DOM and mobile/device behavior.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';

const args=process.argv.slice(2),root=fileURLToPath(new URL('../../',import.meta.url));
const option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
assert.ok(args.includes('--before'),'provide a clean verified baseline checkout');
const beforeRoot=resolve(option('--before')),out=resolve(option('--out','validation/artifacts/result-pipeline-cpu'));
const fixturePath=resolve(option('--fixtures','validation/model-motion-ten/union-fixtures.json'));
const rounds=Number(option('--rounds',5));assert.ok(Number.isInteger(rounds)&&rounds>=3&&rounds<=15);
const digest=x=>createHash('sha256').update(x).digest('hex');
async function hashes(dir){const files=[...(await readdir(resolve(dir,'src'))).filter(f=>f.endsWith('.js')).sort().map(f=>'src/'+f),'assets/characters/keeper-prototype.glb','tests/helpers/load-character.js'];return Object.fromEntries(await Promise.all(files.map(async f=>[f,digest(await readFile(resolve(dir,f)))])));}
const sourceHashes={before:await hashes(beforeRoot),after:await hashes(root)},fixtureBytes=await readFile(fixturePath),manifest=JSON.parse(fixtureBytes);
const affected=JSON.parse(await readFile(resolve(root,'validation/model-motion-ten/recovery-origin-baseline.json'))),affectedIds=new Set(affected.records.map(r=>r.id));
const versions=[];
for(const dir of[beforeRoot,root]){
 const load=p=>import(pathToFileURL(resolve(dir,p)).href);
 const [{Shot},{keeperGather},{HOLD_DURATION},{loadCharacter}]=await Promise.all([load('src/engine.js'),load('src/keeper-contact.js'),load('src/anatomy.js'),load('tests/helpers/load-character.js')]);
 versions.push({Shot,keeperGather,HOLD_DURATION,actor:await loadCharacter(true)});
}
const cases=[],outcomes={shots:manifest.fixtures.length,catches:0,touches:0,goals:0,reboundGoals:0,unfinished:0};
for(const recipe of manifest.fixtures){
 const pair=versions.map(({Shot})=>{const shot=new Shot(recipe.aim,recipe.stats,recipe.stats,recipe.direction,recipe.seed);for(let i=0;i<3600&&!shot.result;i++)shot.step(1/120,shot.playbackRate());assert.ok(shot.result,recipe.id+' did not finish');assert.equal(!!shot.caught,recipe.expectedCaught,recipe.id+' catch changed');return shot;});
 assert.equal(JSON.stringify(pair[1]),JSON.stringify(pair[0]),recipe.id+' complete physical shot changed');
 const shot=pair[0];outcomes.catches+=!!shot.caught;outcomes.touches+=!!shot.touched;outcomes.goals+=!!shot.result.goal;outcomes.reboundGoals+=!!shot.result.goal&&!!shot.touched;
 cases.push({id:recipe.id,pair,affected:affectedIds.has(recipe.id)});
}
assert.equal(outcomes.catches,manifest.expectedCaptures);
assert.equal(cases.filter(c=>c.affected).length,affectedIds.size,'every affected recipe is included');
const times=[0,.12,.396,.44,.55,.704,1.1,1.7,2.8],cohorts={all:[],affected:[],unchanged:[]};
for(const entry of cases)for(const time of times){const value={entry,time};cohorts.all.push(value);cohorts[entry.affected?'affected':'unchanged'].push(value);}
function batch(index,inputs){
 const version=versions[index],start=performance.now();let checksum=0;
 for(const {entry,time}of inputs){
  const shot=entry.pair[index],raw=shot.poseAt((shot.animationTime??shot.t)+time);
  const pose=shot.caught?version.keeperGather(shot.pose,raw,shot.ball,shot.contactPart,time/version.HOLD_DURATION).pose:raw;
  version.actor.pose(pose);checksum+=pose.hip.y+pose.hands[0].x;
 }
 assert.ok(Number.isFinite(checksum));return {milliseconds:performance.now()-start,checksum};
}
for(let warm=0;warm<4;warm++)for(const index of[0,1])batch(index,cohorts.all);
const median=values=>values.toSorted((a,b)=>a-b)[Math.floor(values.length/2)],timing={};
for(const[name,inputs]of Object.entries(cohorts)){
 const runs={before:[],after:[]};
 for(let round=0;round<rounds;round++)for(const index of round%2?[1,0]:[0,1])runs[index?'after':'before'].push(batch(index,inputs));
 const medianMs=Object.fromEntries(Object.entries(runs).map(([key,rows])=>[key,median(rows.map(r=>r.milliseconds))]));
 timing[name]={samples:inputs.length,rounds,runs,medianMs,microsecondsPerSample:Object.fromEntries(Object.entries(medianMs).map(([key,value])=>[key,value*1000/inputs.length]))};
}
assert.deepEqual(await hashes(beforeRoot),sourceHashes.before);assert.deepEqual(await hashes(root),sourceHashes.after);
assert.equal(digest(await readFile(fixturePath)),digest(fixtureBytes));
const report={createdAt:new Date().toISOString(),baselineCheckout:beforeRoot,sourceHashes,fixtureSha256:digest(fixtureBytes),benchmarkSha256:digest(await readFile(fileURLToPath(import.meta.url))),times,warmupBatchesPerRevision:4,outcomes,affectedIds:[...affectedIds],timing,
 scope:'Same full pinned shot cohort, actual match playback. Complete physical Shot JSON equality is required. Each version samples its own intended result motion, so final visual poses deliberately differ. Includes poseAt+keeperGather+loaded actor pose; excludes GPU/renderer/asset loading/phone FPS. Separate cohort medians need not sum; cloud wall-clock variance is retained.'};
await mkdir(out,{recursive:true});await writeFile(resolve(out,'result-pipeline-cpu.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({out,outcomes,timing}));

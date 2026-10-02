// Interleaved Node/cloud CPU measurement of actual central result presentation.
// Includes poseAt and (when caught) keeperGather; excludes skinning, rendering,
// DOM, asset loading, GPU, phone FPS, thermal behavior and battery consumption.
import {performance} from 'node:perf_hooks';
import {mkdir,mkdtemp,writeFile,readFile,symlink,rm,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {Shot} from '../../src/engine.js';
import {keeperGather} from '../../src/keeper-contact.js';
const root=fileURLToPath(new URL('../../',import.meta.url)),out=resolve(process.argv[2]??'/tmp/result-recovery-cpu'),baseline=process.argv[3]??'aeaa978',rounds=5;
const temp=await mkdtemp(resolve(tmpdir(),'result-recovery-baseline-'));
const hashes=async()=>Object.fromEntries(await Promise.all((await readdir(resolve(root,'src'))).filter(f=>f.endsWith('.js')).sort().map(async f=>[f,createHash('sha256').update(await readFile(resolve(root,'src',f))).digest('hex')])));
const sourceHashes=await hashes();
try{
 for(const name of execFileSync('git',['ls-tree','-r','--name-only',baseline,'src'],{cwd:root,encoding:'utf8'}).trim().split('\n')){const path=resolve(temp,name);await mkdir(dirname(path),{recursive:true});await writeFile(path,execFileSync('git',['show',`${baseline}:${name}`],{cwd:root,maxBuffer:16*1024*1024}));}
 await writeFile(resolve(temp,'package.json'),'{"type":"module"}');await symlink(resolve(root,'node_modules'),resolve(temp,'node_modules'),'dir');
 const {Shot:Before}=await import(pathToFileURL(resolve(temp,'src/engine.js'))),{keeperGather:beforeGather}=await import(pathToFileURL(resolve(temp,'src/keeper-contact.js')));
 const stats={accuracy:90,power:90,touch:90,composure:90,speed:85,reach:85,handling:99},cases=[],excluded=[];
 for(const x of[-.7,0,.7])for(const y of[.2,1,2.25])for(const power of[.4,.6,.8])for(const seed of[1,3]){
  const recipe={x,y,power,seed},pair=[Before,Shot].map(Type=>{const shot=new Type({x,y,power},stats,stats,0,seed);while(!shot.result&&shot.t<30)shot.step(1/120);return shot;});
  assert.deepEqual(pair[1].result,pair[0].result);assert.deepEqual(pair[1].pose,pair[0].pose,'live source pose unchanged');assert.deepEqual(pair[1].ball,pair[0].ball);
  if(pair[0].direction||pair[0].hesitation||pair[0].recoveryOrigin){excluded.push(recipe);continue;}
  cases.push({recipe,pair});
 }
 assert.equal(cases.length,51,'baseline central cohort');
 const cohorts={all:[],capture:[],moving:[],settled:[]};for(let c=0;c<cases.length;c++)for(let frame=0;frame<=240;frame++){const t=frame/60,s={c,t};cohorts.all.push(s);cohorts[t<=.44?'capture':t<2?'moving':'settled'].push(s);}
 function batch(index,inputs){const gather=index?keeperGather:beforeGather,start=performance.now();let checksum=0;for(const{c,t}of inputs){const shot=cases[c].pair[index],pose=shot.poseAt((shot.animationTime??shot.t)+t);const shown=shot.caught?gather(shot.pose,pose,shot.ball,shot.contactPart,t/.44).pose:pose;checksum+=shown.hip.y+shown.hands[0].x;}assert.ok(Number.isFinite(checksum));return performance.now()-start;}
 batch(0,cohorts.all);batch(1,cohorts.all);const timing={};
 for(const[name,inputs]of Object.entries(cohorts)){const runs={before:[],after:[]};for(let r=0;r<rounds;r++)for(const index of r%2?[0,1]:[1,0])runs[index?'after':'before'].push(batch(index,inputs));const medianMs=Object.fromEntries(Object.entries(runs).map(([key,values])=>[key,values.toSorted((a,b)=>a-b)[2]]));timing[name]={samples:inputs.length,rounds,runs,medianMs,microsecondsPerSample:Object.fromEntries(Object.entries(medianMs).map(([key,value])=>[key,value*1000/inputs.length]))};}
 assert.deepEqual(await hashes(),sourceHashes,'runtime changed during benchmark');
 const report={baseline,createdAt:new Date().toISOString(),scope:'Interleaved warmed Node/cloud CPU, actual 51 central results sampled at60Hz for4s. Includes pose construction and secured gathering; excludes skin/render/GPU/device. Separate cohort medians need not sum.',sourceHashes,cases:cases.map(({recipe,pair})=>({...recipe,caught:!!pair[0].caught})),excluded,timing};await mkdir(out,{recursive:true});await writeFile(resolve(out,'result-recovery-cpu.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({cases:cases.length,excluded:excluded.length,timing},null,2));
}finally{await rm(temp,{recursive:true,force:true});}

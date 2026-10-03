// Paired complete-shot CPU cost, including changed rebound lifetimes.
// No rendering, skinning, mobile FPS, GPU, thermal or battery measurements.
import {performance} from 'node:perf_hooks';
import {readFile,writeFile,mkdir,mkdtemp,symlink,rm,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir,cpus} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {Shot as After} from '../../src/engine.js';
import {readAuditFixtures} from './read-audit-fixtures.mjs';

const args=process.argv.slice(2),root=fileURLToPath(new URL('../../',import.meta.url));
if(args.includes('--help')){console.log('node tools/qa/benchmark-rebound-physics.mjs [--baseline REF] [--out DIR] [--rounds 5] [--fixtures JSON]');process.exit(0);}
const option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const baseline=option('--baseline','aeb5e884'),out=resolve(option('--out','/tmp/rebound-cpu')),rounds=Number(option('--rounds',5));
assert.ok(Number.isInteger(rounds)&&rounds>=3&&rounds<=15);
const explicit=await readAuditFixtures(args),stats={accuracy:90,power:90,touch:90,composure:90,speed:85,reach:85,handling:95},cases=[];
if(explicit)cases.push(...explicit.fixtures);
else for(const x of [-3.3,-1.5,0,1.5,3.3])for(const y of [.2,1.2,2.2])for(const power of [.12,.5,.9])for(const direction of [-1,0,1])cases.push({aim:{x,y,power},direction,seed:42,stats});
const hashes=async()=>Object.fromEntries(await Promise.all((await readdir(resolve(root,'src'))).filter(f=>f.endsWith('.js')).sort().map(async f=>[f,createHash('sha256').update(await readFile(resolve(root,'src',f))).digest('hex')])));
const sourceHashes=await hashes(),temporary=await mkdtemp(resolve(tmpdir(),'rebound-cpu-'));
const summary=values=>{const a=values.toSorted((x,y)=>x-y);return {n:a.length,p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],p99:a[Math.floor(a.length*.99)],max:a.at(-1)};};
function batch(Type){
  const started=performance.now(),near=[],outcome={shots:cases.length,steps:0,caught:0,touched:0,goals:0,reboundGoals:0,unfinished:0};
  for(const r of cases){const s=new Type(r.aim,r.stats,r.stats,r.direction,r.seed);
    for(let frame=0;frame<3600&&!s.result;frame++){
      const sample=Math.min(s.ball.z,s.previous.z)<2&&Math.max(s.ball.z,s.previous.z)>-.4,at=sample?performance.now():0;
      s.step(1/120);if(sample)near.push(performance.now()-at);outcome.steps++;
    }
    outcome.caught+=+!!s.caught;outcome.touched+=+!!s.touched;outcome.goals+=+!!s.result?.goal;outcome.reboundGoals+=+!!(s.touched&&s.result?.goal);outcome.unfinished+=+!s.result;
  }
  assert.equal(outcome.unfinished,0);return {totalMs:performance.now()-started,outcome,nearKeeperStepMs:summary(near)};
}
try{
  for(const file of execFileSync('git',['ls-tree','-r','--name-only',baseline,'src'],{cwd:root,encoding:'utf8'}).trim().split('\n')){
    const target=resolve(temporary,file);await mkdir(dirname(target),{recursive:true});await writeFile(target,execFileSync('git',['show',`${baseline}:${file}`],{cwd:root,maxBuffer:16*1024*1024}));
  }
  await writeFile(resolve(temporary,'package.json'),'{"type":"module"}\n');await symlink(resolve(root,'node_modules'),resolve(temporary,'node_modules'),'dir');
  const {Shot:Before}=await import(pathToFileURL(resolve(temporary,'src/engine.js')));
  batch(Before);batch(After);const runs={before:[],after:[]};
  for(let i=0;i<rounds;i++)for(const [name,Type]of i%2?[['before',Before],['after',After]]:[['after',After],['before',Before]])runs[name].push(batch(Type));
  const timing=Object.fromEntries(Object.entries(runs).map(([name,list])=>[name,{medianTotalMs:summary(list.map(r=>r.totalMs)).p50,medianNearKeeperP99Ms:summary(list.map(r=>r.nearKeeperStepMs.p99)).p50,minTotalMs:Math.min(...list.map(r=>r.totalMs)),maxTotalMs:Math.max(...list.map(r=>r.totalMs)),outcome:list[0].outcome}]));
  for(const list of Object.values(runs))for(const run of list)assert.deepEqual(run.outcome,list[0].outcome,'timing repeats cannot change outcomes');
  assert.deepEqual(await hashes(),sourceHashes,'runtime changed during benchmark');
  const report={createdAt:new Date().toISOString(),baseline,sourceHashes,cpu:cpus()[0]?.model,node:process.version,scope:'Warmed alternating complete-shot batches on this cloud CPU. Includes physical construction and120Hz simulation through each actual result, so changed rebound durations are included. Near-step timing is CPU only. No rendering/GPU/phone-FPS claim.',rounds,fixture:explicit&&{sha256:explicit.sha256,path:explicit.path},timing,runs};
  await mkdir(out,{recursive:true});await writeFile(resolve(out,'rebound-physics-cpu.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({out,timing},null,2));
}finally{await rm(temporary,{recursive:true,force:true});}

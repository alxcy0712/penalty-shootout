#!/usr/bin/env node
// Frozen-baseline CPU comparison of the real 40-capture gather cohort.
// No renderer, GPU, mobile frame rate, temperature or battery measurement.
import {performance} from 'node:perf_hooks';
import {readFile,writeFile,mkdir,mkdtemp,symlink,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import assert from 'node:assert/strict';
import {Shot} from '../../src/engine.js';
import {keeperGather as after} from '../../src/keeper-contact.js';
import {readAuditFixtures} from './read-audit-fixtures.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),args=process.argv.slice(2);
if(args.includes('--help')){console.log('node tools/qa/benchmark-keeper-gather.mjs [--out DIR] [--baseline REF] [--rounds N] [--fixtures JSON]\nDefaults: /tmp/keeper-gather, 2314f3c, 5. Interleaved cloud Node CPU batches; precomputed real capture pose inputs; no render/device claims.');process.exit(0);}
const option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const out=resolve(option('--out','/tmp/keeper-gather')),baseline=option('--baseline','2314f3c'),rounds=Number(option('--rounds',5));
if(!Number.isInteger(rounds)||rounds<1||rounds>15)throw Error('Rounds must be an integer from 1 to 15');
const files=['anatomy.js','engine.js','keeper-contact.js','keeper-contact-data.js','keeper-torso.js','keeper-skin-pose.js'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async name=>[name,hash(await readFile(resolve(root,'src',name)))])));
const explicitFixtures=await readAuditFixtures(args);
const sourceHashes=await hashes(),temporary=await mkdtemp(resolve(tmpdir(),'keeper-gather-benchmark-'));
try{
 const paths=execFileSync('git',['ls-tree','--full-tree','-r','--name-only',baseline,'src'],{cwd:root,encoding:'utf8'}).trim().split('\n');
 for(const path of paths){const target=resolve(temporary,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,execFileSync('git',['show',`${baseline}:${path}`],{cwd:root,maxBuffer:16*1024*1024}));}
 await writeFile(resolve(temporary,'package.json'),'{"type":"module"}\n');await symlink(resolve(root,'node_modules'),resolve(temporary,'node_modules'),'dir');
 const{keeperGather:before}=await import(pathToFileURL(resolve(temporary,'src/keeper-contact.js')).href);
 const stats={accuracy:90,power:90,touch:90,composure:90,speed:85,reach:85,handling:95},recipes=[],captures=[],samples=[];
 for(const x of[-3.3,-1.5,0,1.5,3.3])for(const y of[.2,1.2,2.2])for(const power of[.12,.5,.9])for(const direction of[-1,0,1])recipes.push({aim:{x,y,power},direction,seed:42,stats});
 for(const[d,h,x,seed]of[[-1,.3,2,3],[-1,2.1,1.5,2],[1,.3,2,3],[1,2.1,1.5,1]])recipes.push({aim:{x:d*x,y:h,power:.55},direction:d,seed,stats:{...stats,speed:95,reach:95}});
 if(explicitFixtures)recipes.splice(0,recipes.length,...explicitFixtures.fixtures);
 for(const recipe of recipes){const shot=new Shot(recipe.aim,recipe.stats,recipe.stats,recipe.direction,recipe.seed);while(!shot.result&&shot.t<30)shot.step(1/120);if(!shot.caught)continue;const caseIndex=captures.length;captures.push({recipe,captureTime:shot.t,animationTime:shot.animationTime,contactPart:shot.contactPart});for(let f=0;f<=168;f++){const t=f/60;samples.push({caseIndex,t,args:[shot.pose,shot.poseAt((shot.animationTime??shot.t)+t),shot.ball,shot.contactPart,t/.44]});}}
 assert.equal(captures.length,explicitFixtures?.expectedCaptures??40,'exact capture cohort');
 const equivalence={samples:samples.length,exact:0,maxAbsoluteScalarDelta:0,path:null,worst:null,randomAccess:true};
 function compare(a,b,path,sample){if(typeof a==='number'&&typeof b==='number'){const delta=Math.abs(a-b);if(delta>equivalence.maxAbsoluteScalarDelta){equivalence.maxAbsoluteScalarDelta=delta;equivalence.path=path;equivalence.worst={caseIndex:sample.caseIndex,t:sample.t};}}else if(a&&b&&typeof a==='object'&&typeof b==='object'){for(const key of Object.keys(a))compare(a[key],b[key],path+'.'+key,sample);}}
 for(const sample of samples){const a=before(...sample.args),b=after(...sample.args);if(isDeepStrictEqual(a,b))equivalence.exact++;compare(a,b,'',sample);}
 for(let i=samples.length-1;i>=0;i-=17){const expected=after(...samples[i].args);after(...samples[(i*13+19)%samples.length].args);assert.deepEqual(after(...samples[i].args),expected);}
 const batches={all:samples,transition:samples.filter(s=>s.t>0&&s.t<.44),secured:samples.filter(s=>s.t>=.44)},timing={};
 function batch(fn,inputs){const start=performance.now();let checksum=0;for(const sample of inputs)checksum+=fn(...sample.args).ball.x;assert.ok(Number.isFinite(checksum));return performance.now()-start;}
 batch(before,samples);batch(after,samples);
 for(const[name,inputs]of Object.entries(batches)){const runs={before:[],after:[]};for(let i=0;i<rounds;i++)for(const[key,fn]of(i%2?[['before',before],['after',after]]:[['after',after],['before',before]]))runs[key].push(batch(fn,inputs));timing[name]={samples:inputs.length,rounds,runs,medianMs:Object.fromEntries(Object.entries(runs).map(([key,values])=>[key,values.toSorted((a,b)=>a-b)[Math.floor(values.length/2)]]))};}
 assert.deepEqual(await hashes(),sourceHashes,'sources changed during benchmark');
 const report={baseline,explicitFixtures:explicitFixtures&&{path:explicitFixtures.path,sha256:explicitFixtures.sha256},generatedAt:new Date().toISOString(),sourceHashes,scope:'Milliseconds on this Node/cloud CPU only. Both gather kernels consume identical precomputed current-revision physical capture/current poses. Includes analytic glove ray, hand rotation and elbow constraints; excludes pose generation, asset loading, renderer, GPU and device measurements. Equivalence reports any intentional choreography differences too. Interleaved warmed rounds.',captures,equivalence,timing};
 await mkdir(out,{recursive:true});const destination=resolve(out,'keeper-gather-benchmark.json');await writeFile(destination,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({report:destination,captures:captures.length,equivalence,timing},null,2));
}finally{await rm(temporary,{recursive:true,force:true});}

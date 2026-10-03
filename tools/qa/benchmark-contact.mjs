import {performance}from'node:perf_hooks';import{readFile,writeFile}from'node:fs/promises';import{createHash}from'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {Shot as After} from '../../src/engine.js';
const root=fileURLToPath(new URL('../../',import.meta.url)),out=resolve(process.argv[2]??'validation/artifacts');await mkdir(out,{recursive:true});
// This controlled comparison changes contact code only: both implementations
// consume today's same anatomy. Clone the supplied git bundle to get history.
const baseline='5fa6c72cab4a9c718822ac2915a1a3c9ac692f03';
const original=execFileSync('git',['show',baseline+':src/engine.js'],{cwd:root,encoding:'utf8'});
const patched=original.replace(/(['"])\.\/anatomy\.js\1/,JSON.stringify(new URL('../../src/anatomy.js',import.meta.url).href));
const {Shot:Before}=await import('data:text/javascript;base64,'+Buffer.from(patched).toString('base64'));

const stats={accuracy:90,power:90,touch:90,composure:90,speed:85,reach:85,handling:95};
const cases=[];for(const x of[-3.3,-1.5,0,1.5,3.3])for(const y of[.2,1.2,2.2])for(const power of[.12,.5,.9])for(const direction of[-1,0,1])cases.push({aim:{x,y,power},direction,seed:42});
const quantile=(x,q)=>x.toSorted((a,b)=>a-b)[Math.min(x.length-1,Math.floor(x.length*q))],summary=x=>({n:x.length,p50:quantile(x,.5),p95:quantile(x,.95),p99:quantile(x,.99),max:Math.max(...x)});
function bench(Shot){const near=[],construct=[],result={cases:cases.length,touched:0,saved:0,caught:0,goals:0,reboundGoals:0,steps:0};let starts=performance.now();for(const c of cases){const start=performance.now(),s=new Shot(c.aim,stats,stats,c.direction,c.seed);construct.push(performance.now()-start);for(let i=0;i<3600&&!s.result;i++){const before=performance.now(),nearGoal=s.ball.z<1.5&&s.ball.z>-.4;s.step(1/120);if(nearGoal)near.push(performance.now()-before);result.steps++;}if(!s.result)throw Error('unsettled');result.touched+=Number(s.touched);result.saved+=Number(s.result.saved);result.caught+=Number(s.caught);result.goals+=Number(s.result.goal);result.reboundGoals+=Number(s.result.goal&&s.touched);}return{...result,totalMs:performance.now()-starts,nearGoalStepMs:summary(near),constructMs:summary(construct)}}
const sourceHashes={};for(const name of ['anatomy.js','engine.js','keeper-contact.js','keeper-contact-data.js'])sourceHashes[name]=createHash('sha256').update(await readFile(new URL('../../src/'+name,import.meta.url))).digest('hex');
bench(Before);bench(After);const data={sourceHashes,scope:'135 identical seed-42 shots. Before/after share the current anatomy, isolating engine/contact changes. Milliseconds, Node cloud CPU; browser/mobile performance remains device dependent.',before:bench(Before),after:bench(After)};await writeFile(resolve(out,'contact-benchmark.json'),JSON.stringify(data,null,2));console.log(JSON.stringify(data,null,2));

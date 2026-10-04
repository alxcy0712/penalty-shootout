// One acceptance gate for every labeled union shot. Parallel shards only
// divide execution; they use identical checks and cannot omit capture classes.
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const args=process.argv.slice(2),root=fileURLToPath(new URL('../../',import.meta.url));
const option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const manifest=resolve(option('--fixtures',resolve(root,'validation/model-motion-ten/union-fixtures.json'))),out=resolve(option('--out',resolve(root,'validation/artifacts/union'))),jobs=Number(option('--jobs',4));
assert.ok(Number.isInteger(jobs)&&jobs>=1&&jobs<=8);
// Keep fixed shard sizes while limiting concurrent memory-heavy skin audits.
const concurrency=Number(option('--concurrency',1));
assert.ok(Number.isInteger(concurrency)&&concurrency>=1&&concurrency<=jobs);
const bytes=await readFile(manifest),data=JSON.parse(bytes),digest=x=>createHash('sha256').update(x).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all((await readdir(resolve(root,'src'))).filter(f=>f.endsWith('.js')).sort().map(async f=>[f,digest(await readFile(resolve(root,'src',f)))])));
const sourceHashes=await hashes(),startedAt=new Date().toISOString(),bins=Array.from({length:jobs},()=>[]);
assert.equal(new Set(data.fixtures.map(r=>r.id)).size,data.fixtures.length,'unique pinned union IDs');
for(const [index,recipe]of data.fixtures.entries()){assert.equal(typeof recipe.expectedCaught,'boolean');bins[index%jobs].push(recipe);}
assert.deepEqual(bins.flat().map(r=>r.id).sort(),data.fixtures.map(r=>r.id).sort(),'every original union shot is assigned exactly once');
await mkdir(out,{recursive:true});
function run(command,log,env={}){
  return new Promise((accept,reject)=>{
    const output=createWriteStream(log),child=spawn(process.execPath,command,{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
    child.stdout.pipe(output,{end:false});child.stderr.pipe(output,{end:false});
    child.on('error',error=>{output.end();reject(error);});
    child.on('close',(code,signal)=>output.end(()=>accept({exitCode:code,signal})));
  });
}
const runShard=async(fixtures,index)=>{
  const dir=resolve(out,'shard-'+index);await mkdir(dir,{recursive:true});
  const expectedCaptures=fixtures.filter(r=>r.expectedCaught).length;assert.ok(expectedCaptures>0,'use fewer shards for a sparse cohort');
  const input=resolve(dir,'fixtures.json');await writeFile(input,JSON.stringify({...data,expectedCaptures,fixtures},null,2)+'\n');
  const commands=[
    ['body',['tools/qa/audit-held-body.mjs','--fixtures',input,'--check'],{ARTIFACT_DIR:resolve(dir,'body')}],
    ['hold',['tools/qa/audit-character.mjs','hold','--fixtures',input,'--out',resolve(dir,'hold'),'--check'],{}],
    ['trajectory',['tools/qa/audit-character.mjs','trajectory','--fixtures',input,'--out',resolve(dir,'trajectory'),'--check'],{}],
  ],results={};
  for(const [name,command,env]of commands){results[name]=await run(command,resolve(dir,name+'.log'),env);console.log(JSON.stringify({shard:index,gate:name,...results[name]}));}
  const body=JSON.parse(await readFile(resolve(dir,'body/held-body-summary.json'))),hold=JSON.parse(await readFile(resolve(dir,'hold/actual-holding-240hz.json'))),trajectory=JSON.parse(await readFile(resolve(dir,'trajectory/near-keeper-trajectory.json')));
  return {index,fixtureIds:fixtures.map(r=>r.id),expectedCaptures,results,body,hold:{captures:hold.gate.cases,samples:hold.records.length*673,skinSamples:hold.records.reduce((n,r)=>n+r.samples.length,0),failures:hold.gate.failures,minimumSkin:Math.min(...hold.records.map(r=>r.minSkin.y)),minimumGap:Math.min(...hold.records.map(r=>r.minGap.gap)),maxGloveGap:Math.max(...hold.records.map(r=>r.maxGloveGap.gap)),maxElbowStep:Math.max(...hold.records.map(r=>r.maxElbowStep.distance)),maxCaptureJump:Math.max(...hold.records.map(r=>r.captureJump))},trajectory:{cases:trajectory.cases,samples:trajectory.samples,minimumGap:trajectory.minimumGap,maxContactsPerStep:trajectory.maxContactsPerStep,failures:trajectory.gate.failures}};
};
const shards=new Array(jobs);let nextShard=0;
await Promise.all(Array.from({length:concurrency},async()=>{
  while(nextShard<jobs){const index=nextShard++;shards[index]=await runShard(bins[index],index);}
}));
assert.deepEqual(await hashes(),sourceHashes,'runtime changed during the union gate');
const failures=shards.flatMap(s=>Object.entries(s.results).filter(([,r])=>r.exitCode!==0).map(([gate,result])=>({shard:s.index,gate,...result})));
assert.equal(shards.reduce((n,s)=>n+s.trajectory.cases,0),data.fixtures.length,'all union shots reached trajectory validation');
assert.equal(shards.reduce((n,s)=>n+s.hold.captures,0),data.expectedCaptures,'all pinned catches reached uniform hold validation');
assert.equal(shards.reduce((n,s)=>n+s.body.captures,0),data.expectedCaptures,'all pinned catches reached uniform body validation');
const report={startedAt,completedAt:new Date().toISOString(),manifestSha256:digest(bytes),sourceHashes,jobs,concurrency,shots:data.fixtures.length,captures:data.expectedCaptures,cohorts:data.cohorts,denseWindows:data.denseWindows,scope:'All actual catches, regardless of central/lateral classification, use240Hz joint continuity,60Hz whole-skin sphere/floor and the same dense triangle-crossing windows. Every union shot also gets120Hz near-body displayed trajectory checks. Offline CPU geometry, not WebGL or device proof.',failures,shards};
await writeFile(resolve(out,'union-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({out,shots:report.shots,captures:report.captures,failures}));
if(failures.length)process.exitCode=1;

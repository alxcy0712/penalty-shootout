// Paired CPU/event harness measurements; no WebGL/GPU/device FPS claim.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
const args=process.argv.slice(2),value=(key,otherwise)=>args.includes(key)?args[args.indexOf(key)+1]:otherwise;
const before=resolve(value('--before','')),after=resolve(value('--after','.')),out=value('--out',null);
assert.ok(args.includes('--before'),'--before clean baseline checkout required');
const modules=await Promise.all([before,after].map(path=>import(pathToFileURL(resolve(path,'tests/helpers/main-harness.js')))));
const hash=data=>createHash('sha256').update(data).digest('hex');
const sourceHashes=async()=>Object.fromEntries(await Promise.all([before,after].flatMap(root=>['src/main.js','src/scene.js','tests/helpers/main-harness.js'].map(async file=>[resolve(root,file),hash(await readFile(resolve(root,file)))]))));
const hashes=await sourceHashes(),pairs=9,frames=1200;
function run(index,kind){
  const h=modules[index].mainHarness('advanced');
  if(kind==='shot'){h.context.state.aim={x:2.5,y:1,power:.72};h.context.release();}
  const start=performance.now();for(let n=0;n<frames;n++)h.tick(1/120);
  const ms=performance.now()-start,digest=hash(JSON.stringify(h.context.state));
  h.context.graphics?.dispose();return {ms,microsecondsPerCallback:ms*1000/frames,digest};
}
const results={};
for(const kind of ['ready','shot']){
  for(let n=0;n<3;n++){run(0,kind);run(1,kind);}
  const records=[];
  for(let n=0;n<pairs;n++){
    const row={};for(const index of n%2?[1,0]:[0,1])row[index===0?'before':'after']=run(index,kind);
    assert.equal(row.before.digest,row.after.digest,'same callback schedule must retain full game state');records.push(row);
  }
  const median=key=>records.map(row=>row[key].ms).sort((a,b)=>a-b)[Math.floor(pairs/2)];
  results[kind]={records,medianBeforeMs:median('before'),medianAfterMs:median('after'),medianRatio:median('after')/median('before')};
}
assert.deepEqual(await sourceHashes(),hashes,'benchmarked source changed');
const result={timestamp:new Date().toISOString(),pairs,framesPerBlock:frames,warmupPairs:3,sourceHashes:hashes,scope:'Same-machine alternating baseline/candidate real main + Stadium event/CPU harness; renderer and character uploads are stubs, profile disabled. State JSON exact equality. This excludes WebGL GPU, real DOM, loading and native Storage. Shared cloud timing is noisy.',results};
if(out)await writeFile(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));

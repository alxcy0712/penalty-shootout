// Isolated model/contact-cache comparison. Pass baseline root, candidate root, output.
// Never edits either runtime. Full fixed fixture roster is read only from baseline.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const [baseArg,candidateArg,outArg]=process.argv.slice(2);if(!outArg)throw Error('Require baselineRoot candidateRoot outputDir');
const roots=[baseArg,candidateArg].map(x=>resolve(x)),out=resolve(outArg);await mkdir(out,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const manifestBytes=await readFile(join(roots[0],'validation/ten-rounds/union-fixtures.json')),manifest=JSON.parse(manifestBytes);
const runtimes=await Promise.all(roots.map(async root=>({root,engine:await import(pathToFileURL(join(root,'src/engine.js'))),contact:(await import(pathToFileURL(join(root,'src/keeper-contact-data.js')))).keeperContactData,hashes:Object.fromEntries(await Promise.all(['src/engine.js','src/keeper-contact.js','src/keeper-contact-data.js','src/keeper-skin-pose.js','assets/characters/keeper-prototype.glb'].map(async file=>[file,sha(await readFile(join(root,file)))])))})));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const contactDifference={};for(const key of new Set([...Object.keys(runtimes[0].contact),...Object.keys(runtimes[1].contact)])){
 const a=runtimes[0].contact[key],b=runtimes[1].contact[key];
 contactDifference[key]=key==='hulls'?Object.fromEntries(Object.keys(a).map(n=>[n,{equal:same(a[n],b[n]),beforeVertices:a[n].vertices.length,afterVertices:b[n].vertices.length,beforeTriangles:a[n].indices.length/3,afterTriangles:b[n].indices.length/3,surfaceEqual:same(a[n].surface,b[n].surface)}])):{equal:same(a,b)};
 if(key==='patch'||key==='torsoPatch'){
  Object.assign(contactDifference[key],{verticesEqual:same(a.vertices,b.vertices),weightsEqual:same(a.weights,b.weights),indicesEqual:same(a.indices,b.indices),inverseBindsEqual:same(a.inverseBinds,b.inverseBinds),beforeVertices:a.vertices.length,afterVertices:b.vertices.length});
  if(a.vertices.length===b.vertices.length){const distances=a.vertices.map((p,i)=>Math.hypot(...p.map((v,k)=>v-b.vertices[i][k])));Object.assign(contactDifference[key],{changedVertices:distances.filter(d=>d>0).length,maxVertexDisplacementMm:Math.max(...distances)*1000});}
 }
}
async function run(runtime){const records=[];let totalSteps=0;const begin=performance.now();for(const recipe of manifest.fixtures){const shot=new runtime.engine.Shot(recipe.aim,recipe.stats,recipe.stats,recipe.direction,recipe.seed);let steps=0;while(steps<3600&&!shot.result){shot.step(1/120);steps++;}totalSteps+=steps;records.push({id:recipe.id,caught:!!shot.caught,touched:!!shot.touched,contactPart:shot.contactPart??null,steps,time:shot.t,animationTime:shot.animationTime,result:shot.result,ball:shot.ball,velocity:shot.velocity,pose:shot.pose});}return{root:runtime.root,hashes:runtime.hashes,runMs:performance.now()-begin,totalSteps,counts:{shots:records.length,caught:records.filter(r=>r.caught).length,touched:records.filter(r=>r.touched).length,goals:records.filter(r=>r.result?.goal).length,reboundGoals:records.filter(r=>r.result?.goal&&r.touched).length,unfinished:records.filter(r=>!r.result).length},records};}
const before=await run(runtimes[0]),after=await run(runtimes[1]),differences=[];let maxBallDifferenceMm=0;
for(let i=0;i<before.records.length;i++){const a=before.records[i],b=after.records[i],fields=Object.keys(a).filter(k=>!same(a[k],b[k]));if(fields.length)differences.push({id:a.id,fields,discreteDifference:['caught','touched','contactPart','result'].some(k=>!same(a[k],b[k]))});maxBallDifferenceMm=Math.max(maxBallDifferenceMm,Math.hypot(...['x','y','z'].map(k=>a.ball[k]-b.ball[k]))*1000);}
const summary={fixtureSha256:sha(manifestBytes),scriptSha256:sha(await readFile(new URL(import.meta.url))),contactDifference,before:before.counts,after:after.counts,beforeSteps:before.totalSteps,afterSteps:after.totalSteps,differingRecords:differences.length,discreteDifferences:differences.filter(d=>d.discreteDifference).length,maxBallDifferenceMm,differences};
await writeFile(join(out,'physics-before.json'),JSON.stringify(before));await writeFile(join(out,'physics-after.json'),JSON.stringify(after));await writeFile(join(out,'contact-and-physics-summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));

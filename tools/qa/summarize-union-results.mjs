// Verify the completed receipts before making a compact, publishable summary.
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url)),directory=resolve(process.argv[2]??'/tmp/penalty-union'),destination=resolve(process.argv[3]??'/tmp/penalty-union-summary.json');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex'),json=async path=>JSON.parse(await readFile(path));
const union=await json(resolve(directory,'union-report.json')),manifest=resolve(process.argv[4]??resolve(root,'validation/five-rounds/union-fixtures.json')),manifestBytes=await readFile(manifest),fixtures=JSON.parse(manifestBytes);
assert.equal(digest(manifestBytes),union.manifestSha256);assert.deepEqual(union.failures,[]);
const testedFiles={},receipts=[],records=[],trajectoryRecords=[];let bodySamples=0;
const sourceKeys=(await readdir(resolve(root,'src'))).filter(f=>f.endsWith('.js')).sort().map(f=>'src/'+f);
const bodyKeys=[...sourceKeys,'assets/characters/keeper-prototype.glb','tests/helpers/load-character.js','tools/qa/audit-held-body.mjs','tools/qa/read-audit-fixtures.mjs'];
const characterKeys=[...sourceKeys,'assets/characters/keeper-prototype.glb','assets/characters/striker-mocap.glb','tests/helpers/load-character.js','tools/qa/audit-character.mjs','tools/qa/read-audit-fixtures.mjs'];
async function verifyHashes(map,requiredKeys){assert.deepEqual(Object.keys(map).sort(),requiredKeys.toSorted(),'receipt omitted or added source hash keys');for(const [file,hash]of Object.entries(map)){assert.equal(digest(await readFile(resolve(root,file))),hash,`receipt differs from current ${file}`);if(testedFiles[file])assert.equal(testedFiles[file],hash);testedFiles[file]=hash;}}
await verifyHashes(Object.fromEntries(Object.entries(union.sourceHashes).map(([f,h])=>['src/'+f,h])),sourceKeys);
for(const shard of union.shards){
  for(const stage of ['body','hold','trajectory'])assert.equal(shard.results[stage].exitCode,0);
  const base=resolve(directory,'shard-'+shard.index),input=await json(resolve(base,'fixtures.json'));
  assert.deepEqual(input.fixtures.map(r=>r.id),shard.fixtureIds);
  const paths={body:resolve(base,'body/held-body-audit.json'),hold:resolve(base,'hold/actual-holding-240hz.json'),trajectory:resolve(base,'trajectory/near-keeper-trajectory.json')};
  const body=await json(paths.body),hold=await json(paths.hold),trajectory=await json(paths.trajectory);
  await verifyHashes(body.hashes,bodyKeys);assert.deepEqual(body.hashesAfter,body.hashes);await verifyHashes(hold.sourceSha256,characterKeys);await verifyHashes(trajectory.sourceSha256,characterKeys);
  assert.deepEqual(hold.gate.failures,[]);assert.deepEqual(trajectory.gate.failures,[]);
  const expected=input.fixtures.filter(r=>r.expectedCaught).map(r=>r.id).sort();
  assert.deepEqual(body.coverage.captures.map(r=>r.recipe.id).sort(),expected);
  assert.deepEqual(hold.records.map(r=>r.case.id).sort(),expected);
  assert.deepEqual(trajectory.records.map(r=>r.case.id).sort(),input.fixtures.map(r=>r.id).sort());
  records.push(...hold.records);trajectoryRecords.push(...trajectory.records);bodySamples+=body.coverage.samples;
  receipts.push({shard:shard.index,shots:input.fixtures.length,captures:expected.length,files:Object.fromEntries(await Promise.all(Object.entries(paths).map(async([name,path])=>[name,{path,sha256:digest(await readFile(path))}])))});
}
assert.equal(records.length,union.captures);assert.equal(new Set(records.map(r=>r.case.id)).size,union.captures);
assert.deepEqual(trajectoryRecords.map(r=>r.case.id).sort(),fixtures.fixtures.map(r=>r.id).sort());
const worst=(key,value)=>{const record=records.reduce((a,b)=>value(b)>value(a)?b:a);return {id:record.case.id,recipe:record.case,metric:record[key]};};
const protectedCounts=Object.fromEntries(['forearmTorso','calfTorso','oppositeFootCalf'].map(key=>[key,union.shards.reduce((n,s)=>n+s.body.protected[key].count,0)]));
assert.ok(Object.values(protectedCounts).every(n=>n===0));
const report={status:'passed',startedAt:union.startedAt,completedAt:union.completedAt,manifestSha256:union.manifestSha256,shots:union.shots,captures:union.captures,cohorts:union.cohorts,testedFiles,counts:{bodyPoses:bodySamples,jointSamples:records.length*673,skinSphereSamples:records.reduce((n,r)=>n+r.samples.length,0),trajectoryPoses:union.shards.reduce((n,s)=>n+s.trajectory.samples,0)},protectedCounts,minimumSkin:Math.min(...records.map(r=>r.minSkin.y)),minimumSphereGap:Math.min(...records.map(r=>r.minGap.gap)),minimumTrajectoryGap:Math.min(...union.shards.map(s=>s.trajectory.minimumGap)),maximumResolutionsPerStep:Math.max(...union.shards.map(s=>s.trajectory.maxContactsPerStep)),adjacentMaxima:Object.fromEntries(['upperAndSupportTorso','innerElbow'].map(key=>[key,Math.max(...union.shards.map(s=>s.body.adjacent[key].maxSeparation))])),worst:{ballStep:worst('maxBallStep',r=>r.maxBallStep.distance),elbowStep:worst('maxElbowStep',r=>r.maxElbowStep.distance),handStep:worst('maxHandAngle',r=>r.maxHandAngle.angle),ballMicro:worst('maxMicro',r=>r.maxMicro.distance),elbowMicro:worst('maxElbowMicro',r=>r.maxElbowMicro.distance),handMicro:worst('maxHandMicro',r=>r.maxHandMicro.angle)},scope:union.scope,limits:'Sampled sphere/skin distance, selected nonadjacent triangle categories and worst-interval refinement. Adjacent cloth/joint folds are separately recorded. No global continuous-geometry, force-balance, WebGL or mobile-performance proof.',receipts};
await writeFile(destination,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({destination,shots:report.shots,captures:report.captures,counts:report.counts}));

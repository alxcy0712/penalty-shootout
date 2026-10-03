// Preserve completed geometry receipts while proving a later inspector-only fix
// is outside their executable dependency graph. Never rewrite their hashes.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url)),[receipt,out]=process.argv.slice(2);
assert.ok(receipt&&out,'usage: verify-lab-isolation.mjs UNION_SUMMARY OUTPUT_JSON');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const raw=await readFile(resolve(receipt)),summary=JSON.parse(raw),current={},differences=[];
for(const[file,expected]of Object.entries(summary.testedFiles)){
 const actual=digest(await readFile(resolve(root,file)));current[file]=actual;
 if(actual!==expected)differences.push({file,recorded:expected,current:actual});
}
assert.deepEqual(differences.map(d=>d.file),['src/motion-lab-runtime.js'],'only the isolated inspector module may differ');
const recordedSrc=Object.keys(summary.testedFiles).filter(f=>f.startsWith('src/')).sort();
const currentSrc=(await readdir(resolve(root,'src'))).filter(f=>f.endsWith('.js')).map(f=>'src/'+f).sort();
assert.deepEqual(currentSrc,recordedSrc,'no unrecorded runtime module may be introduced');
const entries=['src/main.js','src/engine.js','src/game-character.js','src/anatomy.js','src/keeper-contact.js','tests/helpers/load-character.js'];
const graph={};
async function visit(file){
 if(graph[file])return;
 const bytes=await readFile(resolve(root,file)),source=bytes.toString(),dependencies=[];
 graph[file]={sha256:digest(bytes),dependencies};
 if(!file.endsWith('.js'))return;
 assert.ok(!/\bimport\s*\(/.test(source),file+' needs an explicit dynamic-import review');
 // All project modules in these entry closures use static local imports.
 for(const match of source.matchAll(/(?:^|\n)\s*import\s+(?:[^;'"\n]*(?:\n[^;'"\n]*)*?\s+from\s*)?['"]([^'"]+)['"]/g)){
  if(!match[1].startsWith('.'))continue;
  const dependency=relative(root,resolve(root,dirname(file),match[1]));dependencies.push(dependency);await visit(dependency);
 }
}
for(const entry of entries)await visit(entry);
assert.ok(!graph['src/motion-lab-runtime.js'],'inspector must not execute in the audited game/skin entry closures');
assert.ok(Object.keys(graph).length>=20,'dependency coverage unexpectedly empty/incomplete');
const report={createdAt:new Date().toISOString(),sourceReceiptSha256:digest(raw),sourceReceipt:resolve(receipt),differences,currentTestedFiles:current,entryPoints:entries,staticLocalImportGraph:graph,
 scope:'All recorded game/solver/skin/asset/helper/QA files are byte-identical. The sole later change is the inspector entry module, outside the static audited entry closure and default game entry. Its separate16-test presentation regression covers the change. Original union hashes remain untouched; this is dependency isolation, not a claim that the inspector edit existed during the earlier run.'};
await mkdir(dirname(resolve(out)),{recursive:true});await writeFile(resolve(out),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({differences:report.differences,dependencyFiles:Object.keys(graph).length}));

// A1 changes input/persistence contracts, not a prepared shot's physical meaning.
// Compare complete serialized terminal Shots against an explicit clean baseline.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2),root=fileURLToPath(new URL('../../',import.meta.url));
const option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
assert.ok(args.includes('--before'),'Specify a verified baseline checkout with --before');
const before=resolve(option('--before')),fixture=resolve(option('--fixtures',resolve(root,'validation/model-motion-ten/union-fixtures.json')));
const output=resolve(option('--out',resolve(root,'validation/artifacts/a1-physics.json')));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const bytes=await readFile(fixture),data=JSON.parse(bytes);
const hashes=async base=>Object.fromEntries(await Promise.all(['src/engine.js','src/anatomy.js','src/keeper-contact.js','src/keeper-contact-data.js','src/keeper-result-recovery.js'].map(async path=>[path,hash(await readFile(resolve(base,path)))])));
const sources={before:await hashes(before),after:await hashes(root)};
const versions=await Promise.all([before,root].map(base=>import(pathToFileURL(resolve(base,'src/engine.js')).href)));
const digest=createHash('sha256'),seen=new Set();let catches=0,goals=0,steps=0;
for(const recipe of data.fixtures){
 assert.ok(!seen.has(recipe.id),'duplicate fixture');seen.add(recipe.id);
 const pair=versions.map(({Shot})=>{const shot=new Shot(recipe.aim,recipe.stats,recipe.stats,recipe.direction,recipe.seed);let n=0;for(;n<3600&&!shot.result;n++)shot.step(1/120,shot.playbackRate());assert.ok(shot.result,recipe.id+' did not finish');return {shot,n};});
 assert.equal(JSON.stringify(pair[0].shot),JSON.stringify(pair[1].shot),recipe.id+' physical state changed');
 assert.equal(pair[0].n,pair[1].n,recipe.id+' duration changed');
 assert.equal(!!pair[1].shot.caught,recipe.expectedCaught,recipe.id+' pinned catch changed');
 catches+=!!pair[1].shot.caught;goals+=!!pair[1].shot.result.goal;steps+=pair[1].n;
 digest.update(recipe.id+'\n'+JSON.stringify(pair[1].shot)+'\n');
}
assert.equal(catches,data.expectedCaptures);
assert.deepEqual(await hashes(before),sources.before);assert.deepEqual(await hashes(root),sources.after);
assert.equal(hash(await readFile(fixture)),hash(bytes));
const report={baselineCheckout:before,fixtureSha256:hash(bytes),sources,shots:seen.size,catches,goals,steps,terminalStateSha256:digest.digest('hex'),status:'pass',scope:'Complete physical Shot JSON equality for fixed prepared-shot recipes. New calibrated pointer inputs intentionally differ; this does not test browser behavior or continuous geometry.'};
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));

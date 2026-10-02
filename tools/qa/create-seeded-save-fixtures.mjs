// Generate a reproducible fresh-seed cohort before running unchanged skin gates.
// All simulated outcomes are recorded; every caught case enters the hold audit.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {Shot} from '../../src/engine.js';

const out=resolve(process.argv[2]??'/tmp/penalty-five-rounds/round-3');
await mkdir(out,{recursive:true});
const fixtures=[],records=[];
let index=0;
for(const seed of [101,907])for(const x of [-3.25,-1.4,-.3,.3,1.4,3.25])for(const y of [.18,1.16,2.24])for(const power of [.15,.52,.86])for(const direction of [0,Math.sign(x)]){
  const ability=[65,85,99][index++%3];
  const stats={accuracy:90,power:90,touch:90,composure:90,speed:ability,reach:ability,handling:95};
  const recipe={aim:{x,y,power},direction,seed,stats},shot=new Shot(recipe.aim,stats,stats,direction,seed);
  let frames=0;
  while(!shot.result&&frames++<3600){
    shot.step(1/120);
    assert.ok(Object.values(shot.ball).every(Number.isFinite),'finite physical ball');
  }
  assert.ok(shot.result,'shot must terminate within 30 seconds');
  const record={recipe,result:shot.result,caught:!!shot.caught,touched:!!shot.touched,time:shot.t,animationTime:shot.animationTime,part:shot.contactPart};
  records.push(record);
  if(shot.caught)fixtures.push(recipe);
}
assert.ok(fixtures.length>=12,'fresh cohort must exercise enough catches');
assert.ok(fixtures.some(f=>f.direction<0)&&fixtures.some(f=>f.direction>0)&&fixtures.some(f=>f.direction===0),'all save directions represented');
const hashes=Object.fromEntries(await Promise.all(['src/engine.js','src/anatomy.js','src/keeper-contact.js','tools/qa/create-seeded-save-fixtures.mjs'].map(async file=>[file,createHash('sha256').update(await readFile(new URL('../../'+file,import.meta.url))).digest('hex')])));
const cohort={generatedAt:new Date().toISOString(),method:'Full deterministic Cartesian product, all catches retained, no failing hold pose filtered. Seeds 101 and 907 differ from canonical 42/1/3.',sourceHashes:hashes,candidateFixtures:records.length,expectedCaptures:fixtures.length,fixtures};
await writeFile(resolve(out,'fresh-fixtures.json'),JSON.stringify(cohort,null,2)+'\n');
await writeFile(resolve(out,'all-fixtures.json'),JSON.stringify({...cohort,fixtures:records.map(r=>r.recipe)},null,2)+'\n');
await writeFile(resolve(out,'fresh-outcomes.json'),JSON.stringify({sourceHashes:hashes,records},null,2)+'\n');
console.log(JSON.stringify({candidates:records.length,captures:fixtures.length,contacts:records.filter(r=>r.touched).length,fixtureFile:resolve(out,'fresh-fixtures.json')}));

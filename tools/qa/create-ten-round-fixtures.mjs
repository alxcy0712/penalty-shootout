// Additional deterministic cohorts. Never filter a caught result from acceptance.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {Shot} from '../../src/engine.js';
const args=process.argv.slice(2),stage=Number(args[0]),out=resolve(args[1]??'/tmp/penalty-ten-rounds/round-'+stage);
assert.ok(stage===2||stage===3);
const sha=x=>createHash('sha256').update(x).digest('hex');
const fixtures=[],records=[],stats={accuracy:90,power:90,touch:90,composure:90,speed:85,reach:85,handling:95};
if(stage===2){
 for(const seed of [2027,4099])for(const side of [-1,1])for(const x of [.31,3.28])for(const y of [.16,1.18])for(const power of [.16,.53,.84])
 fixtures.push({aim:{x:side*x,y,power},direction:x<1?0:side,seed,stats:{...stats}});
}else{
 for(const side of [-1,1])for(const speed of [63,67,84,86,98,99])for(const height of [.19,1.21,2.21])for(const kind of ['reach','handling']){
 const attributes={...stats,speed,reach:kind==='reach'?Math.max(1,speed-7):speed,handling:kind==='handling'?90:99};
 fixtures.push({aim:{x:side*(height<.3?3.29:1.48),y:height,power:height<.3?.535:.51},direction:height>2?0:side,seed:2029,stats:attributes});
 }
}
for(const recipe of fixtures){
 const id=sha(JSON.stringify(recipe)).slice(0,16),shot=new Shot(recipe.aim,recipe.stats,recipe.stats,recipe.direction,recipe.seed);
 for(let i=0;i<3600&&!shot.result;i++)shot.step(1/120);
 assert.ok(shot.result,`no termination ${id}`);
 Object.assign(recipe,{id,expectedCaught:!!shot.caught,origins:[{cohort:'ten-round-'+stage,index:records.length}]});
 records.push({id,caught:!!shot.caught,touched:!!shot.touched,time:shot.t,animationTime:shot.animationTime,part:shot.contactPart,result:shot.result});
}
const engineSha256=sha(await readFile(new URL('../../src/engine.js',import.meta.url))),expectedCaptures=fixtures.filter(r=>r.expectedCaught).length;
const manifest={baseline:'2caec2cfa693bb7f8d88271a2bff792fbe213159',scope:'Additional full deterministic cohort, all shots and derived catches retained',cohorts:[{label:'ten-round-'+stage,shots:fixtures.length}],denseWindows:[[0,.9],[.95,1.4]],expectedCaptures,engineSha256,fixtures};
await mkdir(out,{recursive:true});await writeFile(resolve(out,'fixtures.json'),JSON.stringify(manifest,null,2)+'\n');await writeFile(resolve(out,'outcomes.json'),JSON.stringify({engineSha256,records},null,2)+'\n');
console.log(JSON.stringify({stage,shots:fixtures.length,captures:expectedCaptures,out}));

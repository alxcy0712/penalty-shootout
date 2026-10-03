// Preserve original recipe IDs and every cohort membership when broadening gates.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const args=process.argv.slice(2),baselineIndex=args.indexOf('--baseline');
const baseline=baselineIndex<0?'2caec2cfa693bb7f8d88271a2bff792fbe213159':args.splice(baselineIndex,2)[1];
assert.match(baseline,/^[0-9a-f]{40}$/,'baseline must be a full verified commit');
const [out,...inputs]=args;assert.ok(out&&inputs.length>=2);
const hash=b=>createHash('sha256').update(b).digest('hex'),canonical=r=>JSON.stringify({aim:Object.fromEntries(Object.entries(r.aim).sort()),stats:Object.fromEntries(Object.entries(r.stats).sort()),direction:r.direction,seed:r.seed});
const map=new Map(),cohorts=[],sources=[];
for(const path of inputs){const bytes=await readFile(path),data=JSON.parse(bytes);sources.push({path,sha256:hash(bytes)});cohorts.push(...data.cohorts);for(const r of data.fixtures){const key=canonical(r),previous=map.get(key);if(previous){assert.equal(previous.expectedCaught,r.expectedCaught,'same recipe outcome');previous.origins.push(...r.origins);}else map.set(key,structuredClone(r));}}
const fixtures=[...map.values()];assert.equal(new Set(fixtures.map(r=>r.id)).size,fixtures.length);
await writeFile(out,JSON.stringify({baseline,scope:'All prior fixtures retained with original IDs and origin memberships; all additional shots included without direction or outcome filtering',sources,cohorts,denseWindows:[[0,.9],[.95,1.4]],expectedCaptures:fixtures.filter(r=>r.expectedCaught).length,fixtures},null,2)+'\n');console.log(JSON.stringify({out,shots:fixtures.length,captures:fixtures.filter(r=>r.expectedCaught).length}));

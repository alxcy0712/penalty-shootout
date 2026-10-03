import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Explicit fixtures broaden the same production-skin gates. They never replace
// or weaken the default canonical cohorts.
export async function readAuditFixtures(args=process.argv.slice(2)) {
  const index=args.indexOf('--fixtures');
  if(index<0)return null;
  if(!args[index+1])throw Error('--fixtures requires a JSON path');
  const bytes=await readFile(args[index+1]),data=JSON.parse(bytes);
  if(!Array.isArray(data.fixtures)||!data.fixtures.length||data.fixtures.length>1000)throw Error('Expected 1–1000 explicit fixtures');
  if(!Number.isInteger(data.expectedCaptures)||data.expectedCaptures<1||data.expectedCaptures>data.fixtures.length)throw Error('Explicit cohort needs an exact positive expectedCaptures');
  for(const r of data.fixtures){
    if(!r.aim||!r.stats||![-1,0,1].includes(r.direction)||!Number.isInteger(r.seed))throw Error('Invalid fixture identity');
    for(const [key,lo,hi]of [['x',-5,5],['y',0,3.5],['power',0,1]])if(!Number.isFinite(r.aim[key])||r.aim[key]<lo||r.aim[key]>hi)throw Error('Invalid aim '+key);
    for(const key of ['accuracy','power','touch','composure','speed','reach','handling'])if(!Number.isFinite(r.stats[key])||r.stats[key]<1||r.stats[key]>99)throw Error('Invalid stat '+key);
  }
  if(data.denseWindows&&!data.denseWindows.every(w=>Array.isArray(w)&&w.length===2&&w.every(Number.isFinite)&&w[0]>=0&&w[1]>=w[0]&&w[1]<=2.8))throw Error('Invalid dense windows');
  return {denseWindows:data.denseWindows,fixtures:data.fixtures,expectedCaptures:data.expectedCaptures,path:args[index+1],sha256:createHash('sha256').update(bytes).digest('hex')};
}

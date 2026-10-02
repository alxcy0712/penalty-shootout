// Exact deterministic contact-work equivalence; timing is intentionally separate.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,mkdtemp,symlink,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Vector3,Quaternion,Euler} from 'three';
import {readAuditFixtures} from './read-audit-fixtures.mjs';

const args=process.argv.slice(2),root=fileURLToPath(new URL('../../',import.meta.url));
const option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const baseline=option('--baseline','a9b5be0a57c5bc1a8a512caf140ad7e5c043a560'),out=resolve(option('--out','/tmp/penalty-ten-rounds/round-9/equivalence'));
const fixtures=await readAuditFixtures(args);assert.ok(fixtures,'Pass the fixed --fixtures JSON');
await mkdir(out,{recursive:true});
const temporary=await mkdtemp(resolve(tmpdir(),'contact-equivalence-'));
const names=(await readdir(resolve(root,'src'))).filter(name=>name.endsWith('.js')).sort();
const sourceHashes=Object.fromEntries(await Promise.all(names.map(async name=>[name,createHash('sha256').update(await readFile(resolve(root,'src',name))).digest('hex')])));
const profile='export const contactWorkCounters={queries:0,geometryOnlyQueries:0,deferredQueries:0,handHits:0,qualityScans:0,qualityFaceVisits:0};\n';
function instrument(source){
  source=profile+source;
  source=source.replace('function hullDistance(point,hull){','function hullDistance(point,hull){contactWorkCounters.qualityScans++;contactWorkCounters.qualityFaceVisits+=hull.faces.length;');
  const signature=source.match(/export function keeperSurfaceContacts\(pose,start,end,radius[^\n]*\)\{/);assert.ok(signature);
  const mode=signature[0].includes('includeQuality')?'if(includeQuality===false)contactWorkCounters.geometryOnlyQueries++;if(includeQuality===\'deferred\')contactWorkCounters.deferredQueries++;':'';
  source=source.replace(signature[0],signature[0]+'contactWorkCounters.queries++;'+mode);
  const exact='if(hull.exact){hit=sweepHull(a,b,radius,hull.exact);if(!hit)continue;}';assert.ok(source.includes(exact));
  return source.replace(exact,exact+"if(part.type==='hand')contactWorkCounters.handHits++;");
}
async function loadVersion(label){
  const dir=resolve(temporary,label);await mkdir(resolve(dir,'src'),{recursive:true});
  for(const name of names){let source=label==='before'?execFileSync('git',['show',`${baseline}:src/${name}`],{cwd:root,maxBuffer:16*1024*1024,encoding:'utf8'}):await readFile(resolve(root,'src',name),'utf8');if(name==='keeper-contact.js')source=instrument(source);await writeFile(resolve(dir,'src',name),source);}
  await writeFile(resolve(dir,'package.json'),'{"type":"module"}\n');await symlink(resolve(root,'node_modules'),resolve(dir,'node_modules'),'dir');
  return {engine:await import(pathToFileURL(resolve(dir,'src/engine.js'))),contact:await import(pathToFileURL(resolve(dir,'src/keeper-contact.js')))};
}
let comparedStates=0;const trace=createHash('sha256');
async function equalState(before,after,label){
  const a=JSON.stringify(before),b=JSON.stringify(after);if(a!==b){await writeFile(resolve(out,'mismatch-before.json'),a);await writeFile(resolve(out,'mismatch-after.json'),b);throw Error(`Exact serialized state differs: ${label}`);}trace.update(a).update('\n');comparedStates++;
}
const counterCopy=version=>({...version.contact.contactWorkCounters});
function resetCounters(version){for(const key of Object.keys(version.contact.contactWorkCounters))version.contact.contactWorkCounters[key]=0;}
try{
  const before=await loadVersion('before'),after=await loadVersion('after');
  const outcome={shots:fixtures.fixtures.length,steps:0,caught:0,touched:0,goals:0,reboundGoals:0,unfinished:0},restores=[];
  for(const [index,r]of fixtures.fixtures.entries()){
    const a=new before.engine.Shot(r.aim,r.stats,r.stats,r.direction,r.seed),b=new after.engine.Shot(r.aim,r.stats,r.stats,r.direction,r.seed);await equalState(a,b,`${index}/initial`);let snapshot=null;
    for(let frame=0;frame<3600&&!a.result;frame++){
      a.step(1/120);b.step(1/120);await equalState(a,b,`${index}/${frame}`);outcome.steps++;
      if(frame===29)snapshot=JSON.parse(JSON.stringify(a));
    }
    assert.ok(a.result,`fixture ${index} settles`);if(snapshot)restores.push({index,snapshot});
    outcome.caught+=+a.caught;outcome.touched+=+a.touched;outcome.goals+=+a.result.goal;outcome.reboundGoals+=+(a.touched&&a.result.goal);
  }
  assert.equal(outcome.caught,fixtures.expectedCaptures);
  const physicalWork={before:counterCopy(before),after:counterCopy(after)};console.log(JSON.stringify({phase:'physical',outcome,comparedStates,physicalWork}));resetCounters(before);resetCounters(after);
  let restoreSteps=0,legacyCases=0,sharedCases=0;
  for(const {index,snapshot}of restores){
    const a=before.engine.Shot.restore(structuredClone(snapshot)),b=after.engine.Shot.restore(structuredClone(snapshot));await equalState(a,b,`${index}/restore-initial`);
    for(let frame=0;frame<3600&&!a.result;frame++){a.step(1/120);b.step(1/120);await equalState(a,b,`${index}/restore/${frame}`);restoreSteps++;}assert.ok(a.result);
    if(index%37===0){
      const raw=structuredClone(snapshot);delete raw.handlingUntil;
      const x=before.engine.Shot.restore(structuredClone(raw)),y=after.engine.Shot.restore(structuredClone(raw));await equalState(x,y,`${index}/legacy`);
      for(let frame=0;frame<3600&&!x.result;frame++){x.step(1/120);y.step(1/120);await equalState(x,y,`${index}/legacy/${frame}`);restoreSteps++;}legacyCases++;
      const rawA=structuredClone(snapshot),rawB=structuredClone(snapshot),firstA=before.engine.Shot.restore(rawA),secondA=before.engine.Shot.restore(rawA),firstB=after.engine.Shot.restore(rawB),secondB=after.engine.Shot.restore(rawB);firstA.step(1/120);firstB.step(1/120);await equalState(firstA,firstB,`${index}/shared-first`);await equalState(secondA,secondB,`${index}/shared-second`);assert.deepEqual(rawA,rawB,'shared restore inputs remain exactly baseline-equivalent');sharedCases++;
    }
  }
  const restoreWork={before:counterCopy(before),after:counterCopy(after)};
  const stats=fixtures.fixtures[0].stats,poses=[];
  function transform(pose,q,offset){const p=structuredClone(pose),turn=value=>new Vector3().copy(value).applyQuaternion(q),point=value=>Object.assign({},turn(value).add(offset));for(const name of ['hip','shoulder','head'])if(p[name])p[name]=point(p[name]);for(const name of ['up','right','forward'])if(p[name])p[name]=Object.assign({},turn(p[name]));for(const name of ['hands','elbows','shoulders','hips','knees','feet'])p[name]=p[name].map(point);return p;}
  for(const direction of [-1,0,1])for(const time of [.1,.5,1.2,2]){
    const p=before.engine.keeperPose(stats,direction,time,1.2);poses.push(p);poses.push(transform(p,new Quaternion().setFromEuler(new Euler(.12,.63,-.19)),new Vector3(1.2,.2,-.5)));
    const grip=structuredClone(p);grip.grip={handRotations:[0,1].map(i=>before.contact.keeperHandRotation(p,i).toArray())};poses.push(grip);
  }
  const probes=[];
  for(const [index,pose]of poses.entries())for(const hand of [0,1])for(const offset of [-.06,0,.06]){
    const q=before.contact.keeperHandRotation(pose,hand),wrist=new Vector3().copy(pose.hands[hand]);
    const point=z=>new Vector3(offset,.095,z).applyQuaternion(q).add(wrist),start=point(.40),end=point(-.40);
    probes.push({index,pose,start,end});probes.push({index,pose,start:point(.01),end:point(.01)});
  }
  let defaultQueries=0,geometryQueries=0,repeatQueries=0;
  for(const p of probes){
    const expected=before.contact.keeperSurfaceContacts(p.pose,p.start,p.end,.11),actual=after.contact.keeperSurfaceContacts(p.pose,p.start,p.end,.11);assert.deepEqual(actual,expected,`public query ${p.index}`);defaultQueries++;
    const geometry=after.contact.keeperSurfaceContacts(p.pose,p.start,p.end,.11,false),strip=contacts=>contacts.map(({quality,...rest})=>rest);assert.deepEqual(strip(geometry),strip(expected));geometryQueries++;
    const other=probes[(p.index+17)%probes.length];after.contact.keeperSurfaceContacts(other.pose,other.start,other.end,.11);
    assert.deepEqual(after.contact.keeperSurfaceContacts(p.pose,p.start,p.end,.11),expected);repeatQueries++;
  }
  for(const name of names)assert.equal(createHash('sha256').update(await readFile(resolve(root,'src',name))).digest('hex'),sourceHashes[name],'runtime changed during equivalence');
  const report={createdAt:new Date().toISOString(),baseline,sourceHashes,fixture:{path:fixtures.path,sha256:fixtures.sha256,expectedCaptures:fixtures.expectedCaptures},outcome,comparedStates,traceSha256:trace.digest('hex'),restores:{cases:restores.length,steps:restoreSteps,legacyCases,sharedCases},queries:{poses:poses.length,defaultQueries,geometryQueries,repeatQueries},physicalWork,restoreWork,scope:'Exact complete JSON-serialized Shot states including physical state, poses and RNG at construction and every fixed step. Direct API contacts compared with deep strict equality. No timing benchmark or tolerance adjustment.'};
  await writeFile(resolve(out,'contact-quality-equivalence.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({out,outcome,comparedStates,restores:report.restores,queries:report.queries,physicalWork},null,2));
}finally{await rm(temporary,{recursive:true,force:true});}

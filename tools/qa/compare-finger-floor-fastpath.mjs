import * as THREE from 'three';
import {loadCharacter} from '../../tests/helpers/load-character.js';
import {Shot} from '../../src/engine.js';
import {keeperGather} from '../../src/keeper-contact.js';
import {HOLD_DURATION} from '../../src/anatomy.js';
import {createKeeperFingerGrip as unoptimized} from '../../tests/helpers/keeper-thumb-floor-reference.js';
import {createKeeperFingerGrip as optimized} from '../../src/keeper-finger-grip.js';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';import {readAuditFixtures} from './read-audit-fixtures.mjs';
const root=new URL('../../',import.meta.url),args=process.argv.slice(2),out=resolve(args.includes('--out')?args[args.indexOf('--out')+1]:'validation/artifacts/finger-floor-equivalence.json');
const fixtureInput=await readAuditFixtures(args.includes('--fixtures')?args:['--fixtures',new URL('validation/ten-rounds/union-fixtures.json',root).pathname]);
const files=[...(await readdir(new URL('src/',root))).filter(f=>f.endsWith('.js')).map(f=>'src/'+f),'assets/characters/keeper-prototype.glb','tests/helpers/load-character.js','tests/helpers/keeper-thumb-floor-reference.js','tools/qa/compare-finger-floor-fastpath.mjs','tools/qa/read-audit-fixtures.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(new URL(f,root))).digest('hex')])));
const sourceHashes=await hashes();
const fixtures=fixtureInput.fixtures.filter(f=>f.expectedCaught);if(fixtures.length!==fixtureInput.expectedCaptures)throw Error('Caught fixture count mismatch');
const actors=[];for(const make of [unoptimized,optimized]){const a=await loadCharacter(true);a.fingerGrip=make(a.root);a.root.traverse(m=>{if(m.isSkinnedMesh&&m.material.name==='Socks')a.mesh=m});actors.push(a);}
const hash=a=>createHash('sha256').update(new Uint8Array(a.mesh.geometry.attributes.position.array.buffer)).update(new Uint8Array(a.mesh.geometry.attributes.normal.array.buffer)).digest('hex');
const amounts=a=>a.fingerGrip.diagnostics().flatMap(d=>[d.amount,d.thumbAmount]);
let realPoses=0,customPoses=0,geometryMismatches=0,amountMismatches=0;const failures=[];
function compare(context){if(hash(actors[0])!==hash(actors[1])){geometryMismatches++;failures.push(context);}if(JSON.stringify(amounts(actors[0]))!==JSON.stringify(amounts(actors[1])))amountMismatches++;}
for(const [index,r]of (process.argv.includes('--custom-only')?[]:fixtures).entries()){
 const shot=new Shot(r.aim,r.stats,r.stats,r.direction,r.seed);while(!shot.result&&shot.t<30)shot.step(1/120);if(!shot.caught)throw Error(r.id);
 const times=new Set(Array.from({length:121},(_,i)=>i/120));for(let i=11;i<=28;i++)times.add(i/10);for(const edge of [.396,.44,.55,.704])for(const epsilon of[-.00001,0,.00001])times.add(edge+epsilon);
 for(const t of [...times].sort((a,b)=>a-b)){const target=keeperGather(shot.pose,shot.poseAt((shot.animationTime??shot.t)+t),shot.ball,shot.contactPart,t/HOLD_DURATION);for(const a of actors)a.pose(target.pose);compare({id:r.id,t});realPoses++;}
 if(index%50===0)console.log({captures:index+1,realPoses,geometryMismatches,amountMismatches});
}
// Independently oriented, low and below-ground hand frames force the exact
// fallback, including poses where only one of the two groups is constrained.
const nominal=new THREE.Vector3(0,.0765422885373497,.13916779734063595);let differingGroups=0,partlyClipped=0;
for(const x of[0,.3,Math.PI/2,Math.PI,1.9])for(const y of[0,.6,2.1])for(const z of[0,.4,Math.PI/2,Math.PI])for(const height of[-.05,0,.0049999,.005,.0050001,.015,.04,.08,.16,.3])for(const captureBlend of[1.05,1.25,1.6]){
 const m=new THREE.Matrix4().compose(new THREE.Vector3(.02,height,-.04),new THREE.Quaternion().setFromEuler(new THREE.Euler(x,y,z)),new THREE.Vector3(1,1,1));
 const ball=nominal.clone().applyMatrix4(m),p={grip:{ball,captureBlend}};
 for(const a of actors){a.root.matrixWorld.identity();for(const bone of a.mesh.skeleton.bones)if(/^hand[LR]$/.test(bone.name))bone.matrixWorld.copy(m);a.fingerGrip(p);}
 const aa=amounts(actors[0]);if(aa[0]!==aa[1]||aa[2]!==aa[3])differingGroups++;if(aa.some(a=>a>0&&a<1))partlyClipped++;compare({x,y,z,height,captureBlend});customPoses++;
}
const summary={sourceHashes,fixtureSha256:fixtureInput.sha256,captures:process.argv.includes('--custom-only')?0:fixtures.length,realPoses,customPoses,geometryMismatches,amountMismatches,differingGroups,partlyClipped,failures,roundoffMarginMetres:1e-7,scope:'Exact Float32 position+normal hashes and scalar amounts: optimized swept-AABB floor fast path versus original per-vertex halfspaces, same source+target morphs.Every pinned catch with150 sample times each;1800 custom orientation/height/phase cases include below-ground, nearly5mm and differently clipped independent groups.'};
if(JSON.stringify(await hashes())!==JSON.stringify(sourceHashes))throw Error('Source changed during equality check');
if(createHash('sha256').update(await readFile(fixtureInput.path)).digest('hex')!==fixtureInput.sha256)throw Error('Fixture changed during equality check');
await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({...summary,sourceHashes:undefined}));
if(geometryMismatches||amountMismatches||customPoses!==1800||(!args.includes('--custom-only')&&realPoses!==fixtures.length*150)||differingGroups===0||partlyClipped===0)process.exitCode=1;

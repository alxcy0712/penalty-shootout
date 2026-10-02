// Dedicated real-skin grip gate. Run on a frozen checkout:
// ARTIFACT_DIR=/tmp/finger-grip node tools/qa/audit-finger-grip.mjs --check
// --self-only skips the205-catch phase audit while retaining topology/self checks.
// This is CPU geometry evidence, not a GPU/mobile measurement or browser render.
import {readFile, writeFile, mkdir, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {loadCharacter} from '../../tests/helpers/load-character.js';
import {Shot} from '../../src/engine.js';
import {keeperGather} from '../../src/keeper-contact.js';
import {HOLD_DURATION} from '../../src/anatomy.js';
import {createKeeperFingerGrip} from '../../src/keeper-finger-grip.js';

const repo=fileURLToPath(new URL('../../',import.meta.url));
const out=resolve(process.env.ARTIFACT_DIR??join(repo,'validation/artifacts/finger-grip'));
await mkdir(out,{recursive:true});
const files=[...(await readdir(join(repo,'src'))).filter(f=>f.endsWith('.js')).map(f=>'src/'+f),
  'assets/characters/keeper-prototype.glb','tests/helpers/load-character.js',
  'tools/qa/audit-finger-grip.mjs','validation/ten-rounds/union-fixtures.json'];
async function hashes(){return Object.fromEntries(await Promise.all(files.sort().map(async file=>[file,createHash('sha256').update(await readFile(join(repo,file))).digest('hex')])));}
const hashesBefore=await hashes();
const fixtureData=JSON.parse(await readFile(join(repo,'validation/ten-rounds/union-fixtures.json')));
const fixtures=fixtureData.fixtures.filter(f=>f.expectedCaught);
const actor=await loadCharacter(true);
let mesh;actor.root.traverse(m=>{if(m.isSkinnedMesh&&m.material.name==='Socks')mesh=m;});
const original=mesh.geometry,base=new Float32Array(original.attributes.position.array),baseNormal=new Float32Array(original.attributes.normal.array);
const setupStart=performance.now();actor.fingerGrip=createKeeperFingerGrip(actor.root);const setupMs=performance.now()-setupStart;
const apply=actor.fingerGrip,triangle=new THREE.Triangle(),point=new THREE.Vector3(),ball=new THREE.Vector3(),inverse=new THREE.Matrix4();
const fingerprint=()=>createHash('sha256').update(new Uint8Array(mesh.geometry.attributes.position.array.buffer)).update(new Uint8Array(mesh.geometry.attributes.normal.array.buffer)).digest('hex');
const checks=[];
for(const side of ['L','R']){
  const boneIndex=mesh.skeleton.bones.findIndex(b=>b.name==='hand'+side);
  const toHand=mesh.skeleton.boneInverses[boneIndex].clone().multiply(mesh.bindMatrix);
  const ids=[],idSet=new Set(),local=[];
  for(let i=0;i<original.attributes.position.count;i++){
    const pure=[0,1,2,3].some(j=>original.attributes.skinIndex.array[i*4+j]===boneIndex&&original.attributes.skinWeight.array[i*4+j]===1);
    if(pure){ids.push(i);idSet.add(i);local[i]=new THREE.Vector3();}
  }
  const faces=[];
  for(let i=0;i<original.index.count;i+=3){
    const face=Array.from(original.index.array.slice(i,i+3));
    if(!face.every(i=>idSet.has(i)))continue;
    triangle.set(...face.map(i=>new THREE.Vector3().fromArray(base,i*3).applyMatrix4(toHand)));
    // Meshopt-quantized degenerate triangles do not have a well-defined surface.
    if(triangle.getArea()>1e-12)faces.push(face);
  }
  checks.push({side,hand:mesh.skeleton.bones[boneIndex],toHand,ids,idSet,local,faces});
}
function capture(recipe){
  const shot=new Shot(recipe.aim,recipe.stats,recipe.stats,recipe.direction,recipe.seed);
  while(!shot.result&&shot.t<30)shot.step(1/120);
  if(!shot.caught)throw Error('Pinned catch changed: '+recipe.id);
  return shot;
}
function held(shot,t){return keeperGather(shot.pose,shot.poseAt((shot.animationTime??shot.t)+t),shot.ball,shot.contactPart,t/HOLD_DURATION);}

// Read the actual authored endpoint from production, then check every touched
// triangle, including mixed-weight boundary incidence before any filtering.
const example=held(capture(fixtures[0]),1);actor.pose(example.pose);
if(!apply.diagnostics().every(d=>d.amount===1))throw Error('Self-test fixture must reach full closure');
const closed=new Float32Array(mesh.geometry.attributes.position.array),changed=new Set();
for(let i=0;i<base.length;i+=3)if([0,1,2].some(j=>base[i+j]!==closed[i+j]))changed.add(i/3);
const coverage=checks.map(check=>{
  const moved=new Set([...changed].filter(i=>check.idSet.has(i)));let incident=0,covered=0;
  for(let i=0;i<original.index.count;i+=3){const face=Array.from(original.index.array.slice(i,i+3));if(face.some(i=>moved.has(i))){incident++;if(face.every(i=>check.idSet.has(i)))covered++;}}
  return {side:check.side,changedVertices:moved.size,incidentTriangles:incident,coveredTriangles:covered};
});
apply(null);

const selfRecords=[];
for(const check of checks){
  const bindPoints=new Map(check.ids.map(i=>[i,new THREE.Vector3().fromArray(base,i*3).applyMatrix4(check.toHand)]));
  const endPoints=new Map(check.ids.map(i=>[i,new THREE.Vector3().fromArray(closed,i*3).applyMatrix4(check.toHand)]));
  const weldMap=new Map(),weldIds=new Map();
  for(const [i,p] of bindPoints){const key=p.toArray().map(v=>Math.round(v*1e6)).join(',');if(!weldMap.has(key))weldMap.set(key,weldMap.size);weldIds.set(i,weldMap.get(key));}
  const referenceAreas=new Map();let baseline=new Set();
  for(let step=0;step<=40;step++){
    const amount=step/40,positions=new Map([...bindPoints].map(([i,p])=>[i,p.clone().lerp(endPoints.get(i),amount)]));
    const triangles=check.faces.map((face,id)=>{
      const p=face.map(i=>positions.get(i)),normal=new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(p[1],p[0]),new THREE.Vector3().subVectors(p[2],p[0]));
      const area=normal.length()/2;normal.normalize();if(!step)referenceAreas.set(id,area);
      return {id,p,normal,area,changed:face.some(i=>changed.has(i)),weld:face.map(i=>weldIds.get(i)),plane:normal.dot(p[0]),bounds:[Math.min(...p.map(v=>v.x)),Math.max(...p.map(v=>v.x)),Math.min(...p.map(v=>v.y)),Math.max(...p.map(v=>v.y)),Math.min(...p.map(v=>v.z)),Math.max(...p.map(v=>v.z))]};
    }).sort((a,b)=>a.bounds[0]-b.bounds[0]);
    const hits=[];
    for(let i=0;i<triangles.length;i++)for(let j=i+1;j<triangles.length;j++){
      const a=triangles[i],b=triangles[j];if(b.bounds[0]>a.bounds[1])break;
      if((!a.changed&&!b.changed)||a.weld.some(w=>b.weld.includes(w))||a.bounds[2]>b.bounds[3]||b.bounds[2]>a.bounds[3]||a.bounds[4]>b.bounds[5]||b.bounds[4]>a.bounds[5])continue;
      if(crossing(a,b))hits.push([Math.min(a.id,b.id),Math.max(a.id,b.id)].join(':'));
    }
    if(!step)baseline=new Set(hits);
    selfRecords.push({side:check.side,amount,crossings:hits.length,newCrossings:hits.filter(hit=>!baseline.has(hit)),minimumAreaRatio:Math.min(...triangles.filter(t=>t.changed&&referenceAreas.get(t.id)>1e-10).map(t=>t.area/referenceAreas.get(t.id)))});
  }
}

let samples=0,exactSourceChanges=0,determinismFailures=0,nonFinite=0,closedFinal=0;
let minDistance=Infinity,floorMinimum=Infinity,maxDeltaAmount=0,maxClosureRate=0,updateMs=0,maxUpdateMs=0;
const records=[];
if(!process.argv.includes('--self-only'))for(const [index,recipe] of fixtures.entries()){
  const shot=capture(recipe),poses=[],digests=[],amounts=[];
  const times=new Set(Array.from({length:121},(_,i)=>i/120));
  for(let i=11;i<=28;i++)times.add(i/10);
  for(const edge of [.396,.44,.55,.704])for(const epsilon of [-.00001,0,.00001])times.add(edge+epsilon);
  const ordered=[...times].sort((a,b)=>a-b);let previous=[0,0],previousTime=0;
  for(const t of ordered){
    const target=held(shot,t);actor.pose(target.pose);
    // Time the controller alone, after clearing its state with the documented
    // reset. This is a CPU cost probe; it is not a browser GPU benchmark.
    apply(null);const start=performance.now();apply(target.pose);const elapsed=performance.now()-start;
    updateMs+=elapsed;maxUpdateMs=Math.max(maxUpdateMs,elapsed);samples++;
    actor.root.updateMatrixWorld(true);mesh.skeleton.update();
    for(let i=0;i<mesh.geometry.attributes.position.count;i++){point.fromBufferAttribute(mesh.geometry.attributes.position,i);mesh.applyBoneTransform(i,point).applyMatrix4(mesh.matrixWorld);floorMinimum=Math.min(floorMinimum,point.y);}
    const current=apply.diagnostics().map(d=>d.amount);poses.push(target.pose);digests.push(fingerprint());amounts.push(current);
    for(let i=0;i<2;i++){const delta=Math.abs(current[i]-previous[i]);maxDeltaAmount=Math.max(maxDeltaAmount,delta);if(t>previousTime)maxClosureRate=Math.max(maxClosureRate,delta/(t-previousTime));}
    previous=current;previousTime=t;
    if(t===0)for(let i=0;i<base.length;i++)if(mesh.geometry.attributes.position.array[i]!==base[i]||mesh.geometry.attributes.normal.array[i]!==baseNormal[i])exactSourceChanges++;
    for(const check of checks){
      inverse.copy(check.hand.matrixWorld).invert().multiply(actor.root.matrixWorld);ball.copy(target.ball).applyMatrix4(inverse);
      for(const i of check.ids)check.local[i].fromBufferAttribute(mesh.geometry.attributes.position,i).applyMatrix4(check.toHand);
      for(const face of check.faces){triangle.set(...face.map(i=>check.local[i]));triangle.closestPointToPoint(ball,point);const distance=point.distanceTo(ball)-.11;if(!Number.isFinite(distance))nonFinite++;else minDistance=Math.min(minDistance,distance);}
    }
  }
  if(amounts.at(-1).every(amount=>amount===1))closedFinal++;
  for(let i=poses.length-1;i>=0;i--){actor.pose(poses[i]);if(fingerprint()!==digests[i])determinismFailures++;}
  records.push({id:recipe.id,times:ordered,amounts});
  if(index%25===0)console.log(JSON.stringify({captures:index+1,samples,minDistance,determinismFailures}));
}
const hashesAfter=await hashes(),failures=[];
if(JSON.stringify(hashesBefore)!==JSON.stringify(hashesAfter))failures.push('Sources changed during audit; rerun on a frozen checkout');
if(coverage.some(c=>c.incidentTriangles!==c.coveredTriangles))failures.push('A touched triangle has unsupported skin weights');
if(coverage.reduce((sum,c)=>sum+c.changedVertices,0)!==changed.size)failures.push('A moved vertex lacks exact single-hand skinning');
if(selfRecords.some(r=>r.newCrossings.length))failures.push('New finger/palm/thumb self intersections');
if(selfRecords.some(r=>r.minimumAreaRatio<.2))failures.push('Finger triangle area collapsed below20%');
if(samples){
  if(fixtures.length!==205||closedFinal!==205)failures.push('Caught cohort or completed grip changed');
  if(minDistance<-.000002||nonFinite)failures.push('Ball clearance or finite-surface gate failed');
  if(floorMinimum<-.005)failures.push('Glove/sock floor gate failed');
  if(exactSourceChanges||determinismFailures)failures.push('Source/reset or replay determinism changed');
  if(maxClosureRate>6.10)failures.push('Closure exceeded its authored bounded rate');
}
const diagnostics=apply.diagnostics();
const summary={coverage,captures:samples?fixtures.length:0,samples,closedFinal,minDistance:Number.isFinite(minDistance)?minDistance:null,floorMinimum:Number.isFinite(floorMinimum)?floorMinimum:null,exactSourceChanges,determinismFailures,nonFinite,maxDeltaAmount,maxClosureRate,setupMs,meanChangedApplyMs:samples?updateMs/samples:null,maxUpdateMs,diagnostics,maximumPositionAndNormalUploadBytes:50376,selfSamples:selfRecords.length,selfNewCrossings:selfRecords.reduce((n,r)=>n+r.newCrossings.length,0),minimumAreaRatio:Math.min(...selfRecords.map(r=>r.minimumAreaRatio)),failures};
await writeFile(join(out,'finger-grip-audit.json'),JSON.stringify({method:'205 pinned actual catches.120Hz through1s, phase boundaries±10µs, recovery through2.8s, reverse-order replay. Exact triangle/sphere distance in rigid hand coordinates; all touched faces require exact single-hand skinning.41 authored morph fractions per hand use strict transverse triangle intersections, excluding welded shared vertices, coplanar and tangent contacts. CPU-only evidence; no continuous-time or GPU claim.',hashesBefore,hashesAfter,summary,selfRecords,records},null,2));
console.log('FINGER_GRIP_SUMMARY',JSON.stringify(summary));
if(process.argv.includes('--check')&&failures.length)process.exitCode=1;

function crossing(a,b){
  const da=a.p.map(p=>b.normal.dot(p)-b.plane),db=b.p.map(p=>a.normal.dot(p)-a.plane);
  if(Math.min(...da)>=-1e-8||Math.max(...da)<=1e-8||Math.min(...db)>=-1e-8||Math.max(...db)<=1e-8)return false;
  const axis=new THREE.Vector3().crossVectors(a.normal,b.normal);if(axis.lengthSq()<1e-12)return false;axis.normalize();
  const aa=planeSegment(a.p,da).map(p=>axis.dot(p)).sort((a,b)=>a-b),bb=planeSegment(b.p,db).map(p=>axis.dot(p)).sort((a,b)=>a-b);
  return aa.length===2&&bb.length===2&&Math.min(aa[1],bb[1])-Math.max(aa[0],bb[0])>1e-5;
}
function planeSegment(points,distances){
  const result=[];
  for(let i=0;i<3;i++){
    const j=(i+1)%3;
    if(Math.abs(distances[i])<1e-10)result.push(points[i].clone());
    else if(distances[i]*distances[j]<0)result.push(points[i].clone().lerp(points[j],distances[i]/(distances[i]-distances[j])));
    if(result.length===2)break;
  }
  return result;
}

#!/usr/bin/env node
// Read-only differential audit of every thumb-incident face against all skin.
// --self-test is synthetic only; --smoke is explicitly one catch / three poses.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {loadCharacter} from '../../tests/helpers/load-character.js';
import {createKeeperFingerGrip as baselineGrip} from '../../tests/helpers/keeper-finger-grip-baseline.js';
import {createKeeperFingerGrip as candidateGrip} from '../../src/keeper-finger-grip.js';
import {Shot} from '../../src/engine.js';
import {keeperGather} from '../../src/keeper-contact.js';
import {HOLD_DURATION} from '../../src/anatomy.js';
import {readAuditFixtures} from './read-audit-fixtures.mjs';

const args=process.argv.slice(2),root=fileURLToPath(new URL('../../',import.meta.url));
const option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
if(args.includes('--help')){console.log('node tools/qa/audit-thumb-body-differential.mjs [--fixtures JSON] [--out DIR] [--check] [--match-playback] [--smoke | --self-test]\nDefault: final669-shot manifest, all caught recipes,25 uniform checkpoints plus capture/closure boundaries through2.8s. New differential pairs receive120Hz refinement in neighboring checkpoint intervals. --smoke is not an acceptance gate.');process.exit(0);}
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z),cross=V(),sa=[V(),V(),V()],sb=[V(),V(),V()];
function planeSegment(points,distances,out){let n=0;for(let i=0;i<3;i++){const j=(i+1)%3;if(Math.abs(distances[i])<1e-10)out[n++].copy(points[i]);else if(distances[i]*distances[j]<0)out[n++].copy(points[i]).lerp(points[j],distances[i]/(distances[i]-distances[j]));if(n===2)break;}return n;}
function finiteTriangleSeparation(a,b){
 const ea=a.p.map((v,i)=>V().subVectors(a.p[(i+1)%3],v)),eb=b.p.map((v,i)=>V().subVectors(b.p[(i+1)%3],v));let separation=Infinity;
 for(const axis of[a.n,b.n,...ea.flatMap(u=>eb.map(v=>V().crossVectors(u,v)))]){if(axis.lengthSq()<1e-18)continue;const u=axis.clone().normalize(),ap=a.p.map(p=>u.dot(p)),bp=b.p.map(p=>u.dot(p));separation=Math.min(separation,Math.max(0,Math.min(Math.max(...ap)-Math.min(...bp),Math.max(...bp)-Math.min(...ap))));}return separation;
}
function intersection(a,b){
 if(a.area<1e-12||b.area<1e-12)return null;
 const da=a.p.map(p=>b.n.dot(p)-b.plane),db=b.p.map(p=>a.n.dot(p)-a.plane),amin=Math.min(...da),amax=Math.max(...da),bmin=Math.min(...db),bmax=Math.max(...db);
 if(amin>=-1e-8||amax<=1e-8||bmin>=-1e-8||bmax<=1e-8)return null;
 cross.crossVectors(a.n,b.n);if(cross.lengthSq()<1e-12)return null;cross.normalize();
 if(planeSegment(a.p,da,sa)<2||planeSegment(b.p,db,sb)<2)return null;
 const aa=[cross.dot(sa[0]),cross.dot(sa[1])].sort((a,b)=>a-b),bb=[cross.dot(sb[0]),cross.dot(sb[1])].sort((a,b)=>a-b),lo=Math.max(aa[0],bb[0]),hi=Math.min(aa[1],bb[1]);if(hi-lo<=1e-5)return null;
 return{length:hi-lo,finiteTriangleSeparation:finiteTriangleSeparation(a,b),infinitePlaneStraddle:Math.min(-amin,amax,-bmin,bmax),center:sa[0].clone().addScaledVector(cross,(lo+hi)/2-cross.dot(sa[0])).toArray()};
}
function makeSurface(points){const n=V().crossVectors(V().subVectors(points[1],points[0]),V().subVectors(points[2],points[0])),area=n.length()/2;n.normalize();return{p:points,n,area,plane:n.dot(points[0])};}
function syntheticControl(){
 const a=makeSurface([V(-1,-1,0),V(1,-1,0),V(0,1,0)]),b=makeSurface([V(0,-.5,-1),V(0,-.5,1),V(0,.5,0)]),hit=intersection(a,b);assert.ok(hit&&hit.length>.9&&Number.isFinite(hit.finiteTriangleSeparation)&&hit.finiteTriangleSeparation>0);
 assert.equal(intersection(a,makeSurface([V(-1,-1,1),V(1,-1,1),V(0,1,1)])),null);
 assert.equal(intersection(a,makeSurface([V(-.5,-.5,0),V(.5,-.5,0),V(0,.5,0)])),null);
 assert.equal(intersection(a,makeSurface([V(0,1,0),V(0,2,-1),V(0,2,1)])),null);
 assert.equal(intersection(a,makeSurface([V(),V(),V()])),null);
 return{crossing:hit,disjoint:true,coplanarExcluded:true,tangentExcluded:true,degenerateExcluded:true};
}
const controls=syntheticControl();if(args.includes('--self-test')){console.log(JSON.stringify({controls,failures:[]},null,2));process.exit(0);}
const fixturePath=resolve(option('--fixtures',join(root,'validation/model-motion-ten/union-fixtures.json'))),manifest=await readAuditFixtures(['--fixtures',fixturePath]);
const out=resolve(option('--out',process.env.ARTIFACT_DIR??join(root,'validation/artifacts/thumb-body-differential')));await mkdir(out,{recursive:true});
const files=[...(await readdir(join(root,'src'))).filter(f=>f.endsWith('.js')).map(f=>'src/'+f),'assets/characters/keeper-prototype.glb','tests/helpers/load-character.js','tests/helpers/keeper-finger-grip-baseline.js','tools/qa/read-audit-fixtures.mjs','tools/qa/audit-thumb-body-differential.mjs'];
async function hashes(){const result=Object.fromEntries(await Promise.all(files.sort().map(async p=>[p,createHash('sha256').update(await readFile(join(root,p))).digest('hex')])));result['fixtures:'+fixturePath]=createHash('sha256').update(await readFile(fixturePath)).digest('hex');return result;}
const hashesBefore=await hashes(),start=performance.now(),smoke=args.includes('--smoke'),matchPlayback=args.includes('--match-playback');
const actors=[];
for(const create of[baselineGrip,candidateGrip]){const actor=await loadCharacter(true);actor.root.updateMatrixWorld(true);actor.meshes=[];actor.root.traverse(m=>{if(m.isSkinnedMesh)actor.meshes.push(m)});actor.fingerGrip=create(actor.root);actors.push(actor);}
assert.equal(actors[0].meshes.length,actors[1].meshes.length);
const [baseline,candidate]=actors,triangles=[],refs=[],adj=[],weldMap=new Map(),thumbVertices=new Set();let offset=0;
for(let mi=0;mi<baseline.meshes.length;mi++){
 const m=baseline.meshes[mi],other=candidate.meshes[mi],{position,skinIndex,skinWeight}=m.geometry.attributes;
 assert.equal(position.count,other.geometry.attributes.position.count);assert.deepEqual(m.geometry.index.array,other.geometry.index.array);
 const weld=[];
 for(let i=0;i<position.count;i++){
  const p=V().fromBufferAttribute(position,i).applyMatrix4(m.matrixWorld),key=p.toArray().map(v=>Math.round(v*1e6)).join(',');if(!weldMap.has(key))weldMap.set(key,weldMap.size);weld.push(weldMap.get(key));refs.push(p);
  if(m.material.name==='Socks')for(let j=0;j<4;j++){
   const bi=skinIndex.array[i*4+j],name=m.skeleton.bones[bi].name;if(!/^hand[LR]$/.test(name)||skinWeight.array[i*4+j]!==1)continue;
   const q=V().fromBufferAttribute(position,i).applyMatrix4(m.bindMatrix).applyMatrix4(m.skeleton.boneInverses[bi]),sign=name==='handL'?1:-1;
   if(sign*q.x>.058&&(q.x-sign*.067)*(sign*.5402161296864605)+(q.y-.081)*.8003201921280896+(q.z-.041)*.26010406244162915>0)thumbVertices.add(offset+i);
  }
 }
 for(let fi=0;fi<m.geometry.index.count;fi+=3){
  const local=[0,1,2].map(k=>m.geometry.index.getX(fi+k)),verts=local.map(i=>offset+i),weights={};for(const vi of local)for(let k=0;k<4;k++){const w=skinWeight.getComponent(vi,k),bn=m.skeleton.bones[skinIndex.getComponent(vi,k)].name;weights[bn]=(weights[bn]??0)+w/3;}
  const ws=local.map(i=>weld[i]);for(const a of ws){adj[a]??=new Set();for(const b of ws)adj[a].add(b);}
  triangles.push({id:triangles.length,mi,face:fi/3,local,verts,weld:ws,region:Object.entries(weights).sort((a,b)=>b[1]-a[1])[0][0],thumb:verts.some(v=>thumbVertices.has(v))});
 }
 offset+=position.count;
}
const thumbFaces=triangles.filter(t=>t.thumb);assert.equal(thumbVertices.size,230,'Expected the integrated thumb selector');assert.equal(thumbFaces.length,376,'Every thumb-incident face must be covered');
const adjacent=(a,b)=>a.weld.some(w=>b.weld.includes(w)),localPair=(a,b)=>a.weld.some(w=>b.weld.some(v=>adj[w].has(v)));
const triangleBounds=new Float64Array(triangles.length*6),nodes=[];
function build(ids){const index=nodes.length,node={bounds:new Float64Array(6),left:-1,right:-1,ids:null};nodes.push(node);if(ids.length<=8){node.ids=ids;return index;}
 const centers=ids.map(i=>triangles[i].verts.reduce((p,v)=>p.add(refs[v]),V()).multiplyScalar(1/3));let axis=0,extent=-1;for(let k=0;k<3;k++){const values=centers.map(p=>p.getComponent(k)),span=Math.max(...values)-Math.min(...values);if(span>extent){extent=span;axis=k;}}
 const sorted=ids.map((id,i)=>({id,c:centers[i].getComponent(axis)})).sort((a,b)=>a.c-b.c),middle=sorted.length>>1;node.left=build(sorted.slice(0,middle).map(x=>x.id));node.right=build(sorted.slice(middle).map(x=>x.id));return index;
}
build(triangles.map(t=>t.id));
for(const actor of actors){actor.positions=Array.from({length:offset},()=>V());actor.surfaces=new Array(triangles.length);}
function skin(actor){actor.root.updateMatrixWorld(true);let at=0;for(const m of actor.meshes){m.skeleton.update();for(let i=0;i<m.geometry.attributes.position.count;i++){const p=actor.positions[at++].fromBufferAttribute(m.geometry.attributes.position,i);m.applyBoneTransform(i,p).applyMatrix4(m.matrixWorld);if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||!Number.isFinite(p.z))nonFinite++;}}actor.surfaces.fill(null);}
function surface(actor,id){let value=actor.surfaces[id];if(!value){value=makeSurface(triangles[id].verts.map(i=>actor.positions[i]));actor.surfaces[id]=value;}return value;}
function updateBounds(){
 for(const t of triangles){const at=t.id*6;for(let k=0;k<3;k++){let lo=Infinity,hi=-Infinity;for(const a of actors)for(const i of t.verts){const v=a.positions[i].getComponent(k);lo=Math.min(lo,v);hi=Math.max(hi,v);}triangleBounds[at+k*2]=lo;triangleBounds[at+k*2+1]=hi;}}
 for(let ni=nodes.length-1;ni>=0;ni--){const n=nodes[ni];for(let k=0;k<3;k++){let lo=Infinity,hi=-Infinity;if(n.ids){for(const id of n.ids){lo=Math.min(lo,triangleBounds[id*6+k*2]);hi=Math.max(hi,triangleBounds[id*6+k*2+1]);}}else{lo=Math.min(nodes[n.left].bounds[k*2],nodes[n.right].bounds[k*2]);hi=Math.max(nodes[n.left].bounds[k*2+1],nodes[n.right].bounds[k*2+1]);}n.bounds[k*2]=lo;n.bounds[k*2+1]=hi;}}
}
function overlap(a,at,b,bt=0){return a[at]<=b[bt+1]&&b[bt]<=a[at+1]&&a[at+2]<=b[bt+3]&&b[bt+2]<=a[at+3]&&a[at+4]<=b[bt+5]&&b[bt+4]<=a[at+5];}
let checks=0,samples=0,nonFinite=0,bvhCandidateMismatches=0,scanMs=0,smokeBruteMs=0,geometryOutsideThumbDifferences=0,fingerAmountDifferences=0;
const measuredChangedVertices=new Set(),setupMs=performance.now()-start;
const baselinePairStats=new Map(),candidatePairStats=new Map(),newPairStats=new Map(),removedPairStats=new Map(),records=[],cohortChanges=[];
function addStats(map,hit,label){let p=map.get(hit.key);if(!p){p={...hit,count:0,first:label,maxLength:0,maxFiniteTriangleSeparation:0};map.set(hit.key,p);}p.count++;p.maxLength=Math.max(p.maxLength,hit.length);p.maxFiniteTriangleSeparation=Math.max(p.maxFiniteTriangleSeparation,hit.finiteTriangleSeparation);}
function scan(label,pose){
 const scanStart=performance.now();let bruteMs=0;
 for(const actor of actors){actor.pose(pose);skin(actor);}samples++;
 const aa=baseline.fingerGrip.diagnostics(),bb=candidate.fingerGrip.diagnostics();for(let i=0;i<aa.length;i++)if(aa[i].amount!==bb[i].amount)fingerAmountDifferences++;
 for(let i=0;i<offset;i++)if(!baseline.positions[i].equals(candidate.positions[i])){measuredChangedVertices.add(i);if(!thumbVertices.has(i))geometryOutsideThumbDifferences++;}
 updateBounds();const hits=[new Map(),new Map()],queriedPairs=smoke?new Set():null;let broadPairs=0,adjacentExcluded=0;
 for(const a of thumbFaces){const stack=[0],at=a.id*6;while(stack.length){const node=nodes[stack.pop()];if(!overlap(triangleBounds,at,node.bounds))continue;if(!node.ids){stack.push(node.left,node.right);continue;}
  for(const id of node.ids){const b=triangles[id];if(id===a.id||(b.thumb&&id<a.id)||!overlap(triangleBounds,at,triangleBounds,id*6))continue;if(adjacent(a,b)){adjacentExcluded++;continue;}broadPairs++;const isLocal=localPair(a,b),key=[Math.min(a.id,id),Math.max(a.id,id)].join(':');queriedPairs?.add(key);
   for(let version=0;version<2;version++){checks++;const hit=intersection(surface(actors[version],a.id),surface(actors[version],id));if(!hit)continue;if(!Number.isFinite(hit.finiteTriangleSeparation)||!Number.isFinite(hit.length)){nonFinite++;continue;}
    hits[version].set(key,{key,pair:[Math.min(a.id,id),Math.max(a.id,id)],isLocal,faces:[a,b].map(t=>({mesh:baseline.meshes[t.mi].name,material:baseline.meshes[t.mi].material.name,face:t.face,region:t.region,thumb:t.thumb})),...hit});
   }
  }
 }}
 if(smoke){
  const bruteStart=performance.now();
  const brutePairs=new Set();for(const a of thumbFaces)for(const b of triangles){if(a.id===b.id||(b.thumb&&b.id<a.id)||adjacent(a,b)||!overlap(triangleBounds,a.id*6,triangleBounds,b.id*6))continue;brutePairs.add([Math.min(a.id,b.id),Math.max(a.id,b.id)].join(':'));}
  if(brutePairs.size!==queriedPairs.size||[...brutePairs].some(key=>!queriedPairs.has(key)))bvhCandidateMismatches++;
  bruteMs=performance.now()-bruteStart;smokeBruteMs+=bruteMs;
 }
 const newHits=[...hits[1].values()].filter(h=>!hits[0].has(h.key)),removed=[...hits[0].values()].filter(h=>!hits[1].has(h.key)),changed=[...hits[1].values()].filter(h=>{const previous=hits[0].get(h.key);return previous&&(Math.abs(previous.length-h.length)>1e-5||Math.abs(previous.finiteTriangleSeparation-h.finiteTriangleSeparation)>1e-6);});
 for(const hit of hits[0].values())addStats(baselinePairStats,hit,label);for(const hit of hits[1].values())addStats(candidatePairStats,hit,label);for(const hit of newHits)addStats(newPairStats,hit,label);for(const hit of removed)addStats(removedPairStats,hit,label);
 const record={...label,broadPairs,adjacentExcluded,baselineCount:hits[0].size,candidateCount:hits[1].size,newCount:newHits.length,newNonLocal:newHits.filter(h=>!h.isLocal).length,removedCount:removed.length,changedExisting:changed.length,baselinePairs:[...hits[0].keys()],candidatePairs:[...hits[1].keys()],newPairs:newHits.map(h=>h.key),removedPairs:removed.map(h=>h.key)};records.push(record);scanMs+=performance.now()-scanStart-bruteMs;return newHits.length||removed.length||changed.length;
}
const checkpoints=new Set(Array.from({length:25},(_,i)=>Math.round(i*2.8/24*1e9)/1e9));for(const edge of[0,.396,.44,.55,.704])for(const epsilon of[-.00001,0,.00001])if(edge+epsilon>=0)checkpoints.add(edge+epsilon);const initialTimes=[...checkpoints].sort((a,b)=>a-b);
const captureRecords=[];let caught=0,denseSamples=0;
for(const [caseIndex,recipe]of manifest.fixtures.entries()){
 if(smoke&&!recipe.expectedCaught)continue;
 const shot=new Shot(recipe.aim,recipe.stats,recipe.stats,recipe.direction,recipe.seed);while(!shot.result&&shot.t<30)shot.step(1/120,matchPlayback?shot.playbackRate():1);
 if(typeof recipe.expectedCaught==='boolean'&&!!shot.caught!==recipe.expectedCaught)cohortChanges.push({id:recipe.id,expected:recipe.expectedCaught,actual:!!shot.caught});if(!shot.caught)continue;caught++;
 const times=smoke?[0,.55,2.8]:initialTimes,refine=new Set();
 const sample=t=>{const held=keeperGather(shot.pose,shot.poseAt((shot.animationTime??shot.t)+t),shot.ball,shot.contactPart,t/HOLD_DURATION);return scan({id:recipe.id,caseIndex,t,requestedDirection:recipe.direction,actualDirection:shot.direction},held.pose);};
 for(let i=0;i<times.length;i++)if(sample(times[i])&&!smoke){const lo=times[Math.max(0,i-1)],hi=times[Math.min(times.length-1,i+1)];for(let f=Math.ceil(lo*120);f<=Math.floor(hi*120);f++){const t=f/120;if(!times.some(x=>Math.abs(x-t)<1e-10))refine.add(t);}}
 for(const t of [...refine].sort((a,b)=>a-b)){sample(t);denseSamples++;}
 captureRecords.push({id:recipe.id,caseIndex,requestedDirection:recipe.direction,actualDirection:shot.direction,initialSamples:times.length,denseSamples:refine.size});
 if(caught%20===0||smoke)console.log(JSON.stringify({caught,samples,checks,newPairs:newPairStats.size,baselinePairs:baselinePairStats.size,elapsedMs:performance.now()-start}));if(smoke)break;
}
const hashesAfter=await hashes(),failures=[];if(JSON.stringify(hashesBefore)!==JSON.stringify(hashesAfter))failures.push('Sources or fixture bytes changed; rerun frozen');if(!caught||!samples)failures.push('Empty caught-pose coverage');if(measuredChangedVertices.size!==thumbVertices.size||[...thumbVertices].some(i=>!measuredChangedVertices.has(i)))failures.push('Measured changed geometry does not cover the complete thumb selector');if(!smoke&&caught!==manifest.expectedCaptures)failures.push('Caught cohort differs from expectedCaptures');if(cohortChanges.length)failures.push('Pinned capture outcomes changed');if(nonFinite)failures.push('Nonfinite skin or triangle crossing measurement');if(bvhCandidateMismatches)failures.push('BVH omitted or added an overlapping triangle pair');if(geometryOutsideThumbDifferences||fingerAmountDifferences)failures.push('Comparison differs outside isolated thumb deformation');
const newNonLocal=[...newPairStats.values()].filter(p=>!p.isLocal);if(newNonLocal.length)failures.push('New nonlocal thumb/body transverse crossings');
const summary={mode:smoke?'smoke-not-acceptance':'full-caught-manifest',matchPlayback,fixture:{path:fixturePath,sha256:manifest.sha256,shots:manifest.fixtures.length,expectedCaptures:manifest.expectedCaptures},caught,thumbVertices:thumbVertices.size,thumbFaces:thumbFaces.length,totalSkinFaces:triangles.length,totalSkinVertices:offset,measuredChangedVertices:measuredChangedVertices.size,measuredChangedFaces:triangles.filter(t=>t.verts.some(i=>measuredChangedVertices.has(i))).length,setupMs,scanMs,meanScanMs:samples?scanMs/samples:null,smokeBruteMs,initialTimes:smoke?[0,.55,2.8]:initialTimes,samples,denseSamples,trianglePairTests:checks,baselineUniquePairs:baselinePairStats.size,candidateUniquePairs:candidatePairStats.size,newUniquePairs:newPairStats.size,newNonLocalUniquePairs:newNonLocal.length,newLocalUniquePairs:newPairStats.size-newNonLocal.length,removedUniquePairs:removedPairStats.size,bvhCandidateMismatches,nonFinite,geometryOutsideThumbDifferences,fingerAmountDifferences,cohortChanges,runtimeMs:performance.now()-start,failures};
const report={method:'Identical final integrated poses with frozen four-finger-only baseline vs current thumb controller. All actual thumb-incident triangles against every real CPU-skinned face; refitted BVH uses union bounds from both versions. Same1um bind-position weld excludes shared-vertex/seam neighbors; one additional topology edge is classified local and reported separately. Coplanar/tangent contacts and zero-area faces excluded. Strict transverse segments>10um. finiteTriangleSeparation is minimum11-axis SAT translation for the finite convex triangle pair, not whole-body penetration or minimum mesh clearance. Baseline pairs are matched at the identical pose, not globally exempted. Sampled evidence, not continuous-time proof; sphere guard does not prove whole-body clearance.',controls,hashesBefore,hashesAfter,summary,captures:captureRecords,baselinePairs:[...baselinePairStats.values()],candidatePairs:[...candidatePairStats.values()],newPairs:[...newPairStats.values()],removedPairs:[...removedPairStats.values()],records};
await writeFile(join(out,'thumb-body-differential.json'),JSON.stringify(report,null,2));await writeFile(join(out,'thumb-body-summary.json'),JSON.stringify(summary,null,2));console.log('THUMB_BODY_DIFFERENTIAL',JSON.stringify(summary));if(args.includes('--check')&&failures.length)process.exitCode=1;

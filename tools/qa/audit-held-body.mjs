// Focused read-only held-body mesh audit: canonical40 caught fixtures,10Hz full
// recovery plus120Hz observed risk windows. Sphere clearance remains separate.
if(process.argv.includes('--help')){console.log('ARTIFACT_DIR=/tmp/held-body BASE_HZ=10 DENSE_HZ=120 node tools/qa/audit-held-body.mjs [--check]\nChecks protected forearm/torso, calf/torso, opposite lower-leg crossings and5mm skin floor. Reports adjacent shoulder/elbow folds separately.');process.exit(0);}
const auditStarted=performance.now();
import {pathToFileURL} from 'node:url';
const repoURL=new URL('../../',import.meta.url),outURL=pathToFileURL((process.env.ARTIFACT_DIR??process.cwd()+'/validation/artifacts')+'/');
await mkdir(outURL,{recursive:true});
const THREE=await import(new URL('node_modules/three/build/three.module.js',repoURL));
const {loadCharacter}=await import(new URL('tests/helpers/load-character.js',repoURL));
const {Shot}=await import(new URL('src/engine.js',repoURL));
const {keeperGather}=await import(new URL('src/keeper-contact.js',repoURL));
const {goalkeeperPose,keeperWarmupPose,holdingPose,keeperRunupPreparation,HOLD_DURATION}=await import(new URL('src/anatomy.js',repoURL));
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const files=[...(await readdir(new URL('src/',repoURL))).filter(f=>f.endsWith('.js')&&!f.startsWith('.')).sort().map(f=>'src/'+f),'assets/characters/keeper-prototype.glb','tests/helpers/load-character.js','tools/qa/audit-held-body.mjs'];
const hashes=Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(new URL(f,repoURL))).digest('hex')])));
const stats={speed:Number(process.env.STAT??85),reach:Number(process.env.STAT??85)};
const c=await loadCharacter(true), meshes=[]; c.root.traverse(m=>{if(m.isSkinnedMesh)meshes.push(m)});c.root.updateMatrixWorld(true);
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z),tmp=V(),refs=[],triangles=[];let base=0;const weldMap=new Map(),adj=[];
for(let mi=0;mi<meshes.length;mi++) {const m=meshes[mi],{position,skinIndex,skinWeight}=m.geometry.attributes,ids=[];m.skeleton.update();
 for(let i=0;i<position.count;i++){tmp.fromBufferAttribute(position,i).applyMatrix4(m.matrixWorld);const key=tmp.toArray().map(n=>Math.round(n*1e6)).join(',');if(!weldMap.has(key))weldMap.set(key,weldMap.size);ids.push(weldMap.get(key));refs.push(tmp.clone());}
 const idx=m.geometry.index;
 for(let i=0;i<idx.count;i+=3){const local=[idx.getX(i),idx.getX(i+1),idx.getX(i+2)],verts=local.map(i=>base+i),weights={};for(const vi of local)for(let k=0;k<4;k++){const w=skinWeight.getComponent(vi,k),bn=m.skeleton.bones[skinIndex.getComponent(vi,k)].name;weights[bn]=(weights[bn]??0)+w/3;}
 const dominant=Object.entries(weights).sort((a,b)=>b[1]-a[1]);const weld=local.map(i=>ids[i]);const tri={id:triangles.length,mi,face:i/3,local,verts,weld,region:dominant[0][0],bones:dominant.slice(0,3),refArea:V().crossVectors(V().subVectors(refs[verts[1]],refs[verts[0]]),V().subVectors(refs[verts[2]],refs[verts[0]])).length()/2};triangles.push(tri);
 for(const w of weld){adj[w]??=new Set();for(const w2 of weld)adj[w].add(w2)} }
 base+=position.count;
}
const adjacent=(a,b)=>a.weld.some(w=>b.weld.includes(w));
const topologicalNeighbors=(a,b)=>a.weld.some(w=>b.weld.some(v=>adj[w].has(v)));
const cross=V(),segA=[V(),V(),V()],segB=[V(),V(),V()];
function planeSegment(pts,dist,out) {let n=0;for(let i=0;i<3;i++){let j=(i+1)%3;if(Math.abs(dist[i])<1e-10)out[n++].copy(pts[i]);else if(dist[i]*dist[j]<0)out[n++].copy(pts[i]).lerp(pts[j],dist[i]/(dist[i]-dist[j]));if(n===2)break;}return n;}
function finiteTriangleSeparation(a,b){
 const ea=a.p.map((v,i)=>V().subVectors(a.p[(i+1)%3],v)),eb=b.p.map((v,i)=>V().subVectors(b.p[(i+1)%3],v));let separation=Infinity;const axes=[a.n,b.n,...ea.flatMap(u=>eb.map(v=>V().crossVectors(u,v)))];for(const raw of axes){if(raw.lengthSq()<1e-18)continue;const axis=raw.clone().normalize(),ap=a.p.map(p=>axis.dot(p)),bp=b.p.map(p=>axis.dot(p));separation=Math.min(separation,Math.max(0,Math.min(Math.max(...ap)-Math.min(...bp),Math.max(...bp)-Math.min(...ap))));}return separation;
}
function intersection(a,b) {
 const da=a.p.map(p=>b.n.dot(p)-b.plane),db=b.p.map(p=>a.n.dot(p)-a.plane),amin=Math.min(...da),amax=Math.max(...da),bmin=Math.min(...db),bmax=Math.max(...db);
 // Strict transverse crossing: excludes tangent touches and coplanar/duplicate triangles.
 if(amin>=-1e-8||amax<=1e-8||bmin>=-1e-8||bmax<=1e-8)return null;
 cross.crossVectors(a.n,b.n);if(cross.lengthSq()<1e-12)return null;cross.normalize();
 if(planeSegment(a.p,da,segA)<2||planeSegment(b.p,db,segB)<2)return null;
 const aa=segA.slice(0,2).map(p=>cross.dot(p)).sort((a,b)=>a-b),bb=segB.slice(0,2).map(p=>cross.dot(p)).sort((a,b)=>a-b),lo=Math.max(aa[0],bb[0]),hi=Math.min(aa[1],bb[1]);if(hi-lo<=1e-5)return null;
 const center=segA[0].clone().addScaledVector(cross,(lo+hi)/2-cross.dot(segA[0]));
 return {length:hi-lo,finiteTriangleSeparation:finiteTriangleSeparation(a,b),depth:Math.min(-amin,amax,-bmin,bmax),center:center.toArray(),normalDot:a.n.dot(b.n)};
}
const roles=[...new Set(triangles.map(t=>t.region))];if(roles.length>30)throw Error('Role mask budget exceeded');
const roleBits=new Map(roles.map((r,i)=>[r,1<<i])),torso=b=>b==='chest'||b==='spine';
const protectedPair=(a,b)=>(torso(a)&&/^(forearm|shin|upper_arm|shoulder_support)/.test(b))||(torso(b)&&/^(forearm|shin|upper_arm|shoulder_support)/.test(a))||(/upper_arm/.test(a)&&b==='forearm'+a.at(-1))||(/upper_arm/.test(b)&&a==='forearm'+b.at(-1))||(/^(foot|toe|shin)[LR]$/.test(a)&&/^(foot|toe|shin)[LR]$/.test(b)&&a.at(-1)!==b.at(-1));
for(const t of triangles){t.regionBit=roleBits.get(t.region);t.allowedMask=roles.reduce((mask,r)=>mask|(protectedPair(t.region,r)?roleBits.get(r):0),0);}
function sample(label,pose) {
 if(pose)c.pose(pose);c.root.updateMatrixWorld(true);const positions=[];let base=0;
 for(const m of meshes){m.skeleton.update();for(let i=0;i<m.geometry.attributes.position.count;i++){const v=V().fromBufferAttribute(m.geometry.attributes.position,i);m.applyBoneTransform(i,v).applyMatrix4(m.matrixWorld);positions.push(v)}}
 const skinMinimum=Math.min(...positions.map(p=>p.y));const ts=triangles.filter(t=>t.allowedMask).map(t=>{const p=t.verts.map(i=>positions[i]),n=V().crossVectors(V().subVectors(p[1],p[0]),V().subVectors(p[2],p[0])),area=n.length()/2;n.normalize();return {...t,p,n,area,plane:n.dot(p[0]),bounds:[Math.min(...p.map(p=>p.x)),Math.max(...p.map(p=>p.x)),Math.min(...p.map(p=>p.y)),Math.max(...p.map(p=>p.y)),Math.min(...p.map(p=>p.z)),Math.max(...p.map(p=>p.z))]}});
 // Sweep axis; 17k triangles, actual narrowphase only where all bounds overlap.
 const sorted=ts.toSorted((a,b)=>a.bounds[0]-b.bounds[0]);let hits=[],local=0,tests=0;for(let i=0;i<sorted.length;i++){const a=sorted[i];if(a.area<1e-12)continue;for(let j=i+1;j<sorted.length;j++){const b=sorted[j];if(b.bounds[0]>a.bounds[1])break;if(!(a.allowedMask&b.regionBit))continue;if(a.bounds[2]>b.bounds[3]||b.bounds[2]>a.bounds[3]||a.bounds[4]>b.bounds[5]||b.bounds[4]>a.bounds[5]||adjacent(a,b)||b.area<1e-12)continue;tests++;const hit=intersection(a,b);if(hit){const isLocal=topologicalNeighbors(a,b);if(isLocal)local++;hits.push({pair:[Math.min(a.id,b.id),Math.max(a.id,b.id)],faces:[{mesh:meshes[a.mi].name,material:meshes[a.mi].material.name,face:a.face,vertices:a.local,region:a.region},{mesh:meshes[b.mi].name,material:meshes[b.mi].material.name,face:b.face,vertices:b.local,region:b.region}],isLocal,...hit})}}}
 hits.sort((a,b)=>b.length-a.length);let regions={};for(const hit of hits){const key=hit.faces.map(f=>f.region).sort().join(':');regions[key]=(regions[key]??0)+1}
 const areaCompression=ts.filter(t=>t.refArea>1e-6&&t.area/t.refArea<.08).map(t=>({mesh:meshes[t.mi].name,face:t.face,region:t.region,ratio:t.area/t.refArea,refArea:t.refArea}));
 const exportTimes=process.env.EXPORT_TIMES?.split(',').map(Number)??[];
 const geometry=typeof label==='object'&&exportTimes.includes(label.t)?meshes.map((m,mi)=>({name:m.name,material:m.material.name,color:m.material.color.toArray(),positions:positions.slice(meshes.slice(0,mi).reduce((a,m)=>a+m.geometry.attributes.position.count,0),meshes.slice(0,mi+1).reduce((a,m)=>a+m.geometry.attributes.position.count,0)).map(v=>[v.x-pose.hip.x,v.y,v.z]),faces:triangles.filter(t=>t.mi===mi).map(t=>t.local)})):undefined;
 const out={label,geometry,skinMinimum,tests,count:hits.length,nonLocal:hits.length-local,maxLength:hits[0]?.length??0,regions,hits,areaCompression};console.log(JSON.stringify({label,count:out.count,nonLocal:out.nonLocal,maxLength:out.maxLength,regions,compressed:areaCompression.length}));return out;
}
const records=[];records.push(sample('loaded-bind',null));records.push(sample('standby',goalkeeperPose(stats,0,0,1.2)));
const baseHz=Number(process.env.BASE_HZ??10),denseHz=Number(process.env.DENSE_HZ??120),duration=2.8;
if(!Number.isFinite(baseHz)||!Number.isFinite(denseHz)||baseHz<1||baseHz>120||denseHz<baseHz||denseHz>240)throw Error('Invalid sampling rates');
const attrs={accuracy:90,power:90,touch:90,composure:90,speed:85,reach:85,handling:95},fixtures=[];
for(const x of[-3.3,-1.5,0,1.5,3.3])for(const y of[.2,1.2,2.2])for(const power of[.12,.5,.9])for(const direction of[-1,0,1])fixtures.push({aim:{x,y,power},direction,seed:42,stats:attrs});
for(const[d,h,x,seed]of[[-1,.3,2,3],[-1,2.1,1.5,2],[1,.3,2,3],[1,2.1,1.5,1]])fixtures.push({aim:{x:d*x,y:h,power:.55},direction:d,seed,stats:{...attrs,speed:95,reach:95}});
const captures=[];
for(const [caseIndex,recipe]of fixtures.entries()){
 const shot=new Shot(recipe.aim,recipe.stats,recipe.stats,recipe.direction,recipe.seed);while(!shot.result&&shot.t<30)shot.step(1/120);if(!shot.caught)continue;
 const {x,y:h,power}=recipe.aim,d=recipe.direction,wide=Math.abs(x)===3.3&&h===1.2&&power===.5&&d===Math.sign(x),central=Math.abs(x)===1.5&&h===1.2&&power===.5&&d===0;
 const times=new Set(Array.from({length:Math.round(duration*baseHz)+1},(_,i)=>Math.round(i/baseHz*1e9)/1e9));
 const denseWindows=wide?[[.2,.7],[.95,1.4]]:central?[[.12,.25]]:[];for(const[lo,hi]of denseWindows)for(let i=Math.ceil(lo*denseHz);i<=Math.floor(hi*denseHz);i++)times.add(Math.round(i/denseHz*1e9)/1e9);
 const sorted=[...times].sort((a,b)=>a-b);captures.push({caseIndex,recipe,captureTime:shot.t,animationTime:shot.animationTime,contactPart:shot.contactPart,samples:sorted.length,denseWindows});
 for(const t of sorted){const pose=keeperGather(shot.pose,shot.poseAt((shot.animationTime??shot.t)+t),shot.ball,shot.contactPart,t/HOLD_DURATION).pose;records.push(sample({caseIndex,motion:'gather',d,h,x,power,seed:recipe.seed,speed:recipe.stats.speed,reach:recipe.stats.reach,t},pose));}
}
const baselinePairs=new Set(records.slice(0,2).flatMap(r=>r.hits.map(h=>h.pair.join(':'))));for(const r of records){r.newHits=r.hits.filter(h=>!baselinePairs.has(h.pair.join(':')));r.newNonLocal=r.newHits.filter(h=>!h.isLocal).length;}
const hashesAfter=Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(new URL(f,repoURL))).digest('hex')])));
for(const r of records){
 r.newRegions={};for(const h of r.newHits){if(h.isLocal)continue;const key=h.faces.map(f=>f.region).sort().join(':');r.newRegions[key]=(r.newRegions[key]??0)+1;}
 const isTorso=b=>b==='chest'||b==='spine',isElbow=(a,b)=>/upper_arm/.test(a)&&b==='forearm'+a.at(-1)||/upper_arm/.test(b)&&a==='forearm'+b.at(-1),isOtherLeg=(a,b)=>/^(foot|toe|shin)[LR]$/.test(a)&&/^(foot|toe|shin)[LR]$/.test(b)&&a.at(-1)!==b.at(-1);
 const categories={forearmTorso:(a,b)=>isTorso(a)&&b.startsWith('forearm')||isTorso(b)&&a.startsWith('forearm'),calfTorso:(a,b)=>isTorso(a)&&b.startsWith('shin')||isTorso(b)&&a.startsWith('shin'),upperAndSupportTorso:(a,b)=>isTorso(a)&&/^(upper_arm|shoulder_support)/.test(b)||isTorso(b)&&/^(upper_arm|shoulder_support)/.test(a),innerElbow:isElbow,oppositeFootCalf:isOtherLeg};
 r.categories={};for(const[key,predicate]of Object.entries(categories)){const hs=r.newHits.filter(h=>!h.isLocal&&predicate(...h.faces.map(f=>f.region))).sort((a,b)=>b.finiteTriangleSeparation-a.finiteTriangleSeparation);r.categories[key]={count:hs.length,maxSeparation:hs[0]?.finiteTriangleSeparation??0,maxSegment:Math.max(0,...hs.map(h=>h.length)),topHits:hs.slice(0,5)};}
 r.torsoForearmHits=r.newHits.filter(h=>!h.isLocal&&h.faces.some(f=>['chest','spine'].includes(f.region))&&h.faces.some(f=>f.region.startsWith('forearm')));r.torsoForearmCount=r.torsoForearmHits.length;
 if(r.geometry){const prefix=(process.env.OUT??'held-body-audit')+'-pose-'+r.label.d+'-'+r.label.h+'-'+r.label.t;await writeFile(new URL(prefix+'.json',outURL),JSON.stringify({hashes,label:r.label,meshes:r.geometry}));
 const mask={};for(const h of r.torsoForearmHits)for(const f of h.faces){mask[f.mesh]??=new Set();mask[f.mesh].add(f.face)}const highlighted=[];for(const m of r.geometry){const marked=mask[m.name]??new Set();highlighted.push({...m,faces:m.faces.filter((_,i)=>!marked.has(i))});if(marked.size)highlighted.push({...m,name:m.name+'_crossing',material:'CROSSING_HIGHLIGHT',color:[1,.005,.005],faces:m.faces.filter((_,i)=>marked.has(i))});}await writeFile(new URL(prefix+'-highlight.json',outURL),JSON.stringify(highlighted));delete r.geometry;}
 if(!process.env.FULL_DETAILS){r.torsoForearmHits=r.torsoForearmHits.sort((a,b)=>b.depth-a.depth).slice(0,10);r.topHits=r.newHits.filter(h=>!h.isLocal&&!h.faces.every(f=>f.region==='head'||f.region.startsWith('foot')||f.region.startsWith('shin'))).sort((a,b)=>b.length-a.length).slice(0,20);delete r.newHits;delete r.hits;}
}
 await writeFile(new URL((process.env.OUT??'held-body-audit')+'.json',outURL),JSON.stringify({coverage:{candidateFixtures:fixtures.length,captures,samples:records.length-2,baseHz,denseHz,duration,protectedPairFilter:true},runtimeMs:performance.now()-auditStarted,stats,hashes,hashesAfter,method:'Protected role pairs only, with all-skinned-vertex floor measurements.10Hz full held recovery plus120Hz explicitly recorded risk windows; sampled evidence, not a continuous proof. Strict transverse triangle/triangle crossings after exact Three SkinnedMesh.applyBoneTransform; bind-position weld at 1um excludes shared-vertex/seam neighbours; isLocal marks one extra topology edge; coplanar/tangent contacts excluded. Depth is infinite-plane straddle, not a lower bound on penetration. finiteTriangleSeparation is minimum translation to separate the finite convex triangle pair using 11-axis SAT, not whole-body penetration.',records},null,2));

if(JSON.stringify(hashes)!==JSON.stringify(hashesAfter))throw Error("Source changed during triangle audit; rerun on a frozen checkout");

const gated=['forearmTorso','calfTorso','oppositeFootCalf'],failures=[];
if(captures.length!==40)failures.push({reason:'Canonical caught cohort changed',expected:40,actual:captures.length});
for(const r of records){if(r.skinMinimum<-.005)failures.push({label:r.label,reason:'Skin below5mm floor tolerance',skinMinimum:r.skinMinimum});for(const key of gated)if(r.categories[key].count)failures.push({label:r.label,category:key,...r.categories[key]});}
const summary={captures:captures.length,samples:records.length-2,baseHz,denseHz,runtimeMs:performance.now()-auditStarted,floorMinimum:Math.min(...records.map(r=>r.skinMinimum)),protected:Object.fromEntries(gated.map(k=>[k,{count:records.reduce((n,r)=>n+r.categories[k].count,0),maxSeparation:Math.max(...records.map(r=>r.categories[k].maxSeparation))}])),adjacent:Object.fromEntries(['upperAndSupportTorso','innerElbow'].map(k=>[k,{count:records.reduce((n,r)=>n+r.categories[k].count,0),maxSeparation:Math.max(...records.map(r=>r.categories[k].maxSeparation))}])),failures};
await writeFile(new URL('held-body-summary.json',outURL),JSON.stringify(summary,null,2));console.log('HELD_BODY_SUMMARY',JSON.stringify({...summary,failures:failures.length}));if(process.argv.includes('--check')&&failures.length)process.exitCode=1;

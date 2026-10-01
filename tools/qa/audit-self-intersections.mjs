// Read-only CPU skin QA. Run from any directory with Node; outputs in sibling character-qa.
import {pathToFileURL} from 'node:url';
const repoURL=new URL('../../',import.meta.url),outURL=pathToFileURL((process.env.ARTIFACT_DIR??process.cwd()+'/validation/artifacts')+'/');
await mkdir(outURL,{recursive:true});
const THREE=await import(new URL('node_modules/three/build/three.module.js',repoURL));
const {loadCharacter}=await import(new URL('tests/helpers/load-character.js',repoURL));
const {Shot}=await import(new URL('src/engine.js',repoURL));
const {keeperGather}=await import(new URL('src/keeper-contact.js',repoURL));
const {goalkeeperPose,keeperWarmupPose,holdingPose}=await import(new URL('src/anatomy.js',repoURL));
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const files=[...(await readdir(new URL('src/',repoURL))).filter(f=>f.endsWith('.js')&&!f.startsWith('.')).sort().map(f=>'src/'+f),'assets/characters/keeper-prototype.glb','tests/helpers/load-character.js','tools/qa/audit-self-intersections.mjs'];
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
function sample(label,pose) {
 if(pose)c.pose(pose);c.root.updateMatrixWorld(true);const positions=[];let base=0;
 for(const m of meshes){m.skeleton.update();for(let i=0;i<m.geometry.attributes.position.count;i++){const v=V().fromBufferAttribute(m.geometry.attributes.position,i);m.applyBoneTransform(i,v).applyMatrix4(m.matrixWorld);positions.push(v)}}
 const ts=triangles.map(t=>{const p=t.verts.map(i=>positions[i]),n=V().crossVectors(V().subVectors(p[1],p[0]),V().subVectors(p[2],p[0])),area=n.length()/2;n.normalize();return {...t,p,n,area,plane:n.dot(p[0]),bounds:[Math.min(...p.map(p=>p.x)),Math.max(...p.map(p=>p.x)),Math.min(...p.map(p=>p.y)),Math.max(...p.map(p=>p.y)),Math.min(...p.map(p=>p.z)),Math.max(...p.map(p=>p.z))]}});
 // Sweep axis; 17k triangles, actual narrowphase only where all bounds overlap.
 const sorted=ts.toSorted((a,b)=>a.bounds[0]-b.bounds[0]);let hits=[],local=0,tests=0;for(let i=0;i<sorted.length;i++){const a=sorted[i];if(a.area<1e-12)continue;for(let j=i+1;j<sorted.length;j++){const b=sorted[j];if(b.bounds[0]>a.bounds[1])break;if(a.bounds[2]>b.bounds[3]||b.bounds[2]>a.bounds[3]||a.bounds[4]>b.bounds[5]||b.bounds[4]>a.bounds[5]||adjacent(a,b)||b.area<1e-12)continue;tests++;const hit=intersection(a,b);if(hit){const isLocal=topologicalNeighbors(a,b);if(isLocal)local++;hits.push({pair:[Math.min(a.id,b.id),Math.max(a.id,b.id)],faces:[{mesh:meshes[a.mi].name,material:meshes[a.mi].material.name,face:a.face,vertices:a.local,region:a.region},{mesh:meshes[b.mi].name,material:meshes[b.mi].material.name,face:b.face,vertices:b.local,region:b.region}],isLocal,...hit})}}}
 hits.sort((a,b)=>b.length-a.length);let regions={};for(const hit of hits){const key=hit.faces.map(f=>f.region).sort().join(':');regions[key]=(regions[key]??0)+1}
 const areaCompression=ts.filter(t=>t.refArea>1e-6&&t.area/t.refArea<.08).map(t=>({mesh:meshes[t.mi].name,face:t.face,region:t.region,ratio:t.area/t.refArea,refArea:t.refArea}));
 const exportTimes=process.env.EXPORT_TIMES?.split(',').map(Number)??[];
 const geometry=typeof label==='object'&&exportTimes.includes(label.t)?meshes.map((m,mi)=>({name:m.name,material:m.material.name,color:m.material.color.toArray(),positions:positions.slice(meshes.slice(0,mi).reduce((a,m)=>a+m.geometry.attributes.position.count,0),meshes.slice(0,mi+1).reduce((a,m)=>a+m.geometry.attributes.position.count,0)).map(v=>[v.x-pose.hip.x,v.y,v.z]),faces:triangles.filter(t=>t.mi===mi).map(t=>t.local)})):undefined;
 const out={label,geometry,tests,count:hits.length,nonLocal:hits.length-local,maxLength:hits[0]?.length??0,regions,hits,areaCompression};console.log(JSON.stringify({label,count:out.count,nonLocal:out.nonLocal,maxLength:out.maxLength,regions,compressed:areaCompression.length}));return out;
}
const records=[];records.push(sample('loaded-bind',null));records.push(sample('standby',goalkeeperPose(stats,0,0,1.2)));
const times=process.env.TIMES?.split(',').map(Number)??[.18,.2,.2125,.233333,.25,.26,.28,.3,.6,1,1.5,1.6,1.67,1.75,1.9,2.1,2.3,3];
const timesForHeight=h=>{if(!process.env.LANDING_SAMPLES)return times;const high=Math.max(0,Math.min(1,(h-.35)/1.7)),vy=.7+high*2.1,landing=.13+(vy+Math.sqrt(vy*vy+2*9.81*(.83-.305)))/9.81;return [...new Set([...times,...[0,.025,.05,.075,.1,.15,.2,.3].map(dt=>Math.round((landing+dt)*1e6)/1e6)])].sort((a,b)=>a-b);};
if(process.env.MOTION==='gather'){
  const recipes=[[-1,.3,-2,3,.55,95],[1,.3,2,3,.55,95],[-1,2.1,-1.5,2,.55,95],[1,2.1,1.5,1,.55,95],[0,.2,-1.5,42,.12,85],[0,.2,1.5,42,.12,85],[0,1.2,-1.5,42,.5,85]];
  for(const [d,h,x,seed,power,ability] of recipes){
    const attrs={accuracy:90,power:90,touch:90,composure:90,speed:ability,reach:ability,handling:95},shot=new Shot({x,y:h,power},attrs,attrs,d,seed);
    for(let f=0;f<3600&&!shot.result;f++)shot.step(1/120);if(!shot.caught)throw Error('Gather recipe no longer catches');
    for(const t of times)records.push(sample({motion:'gather',d,h,x,seed,t},keeperGather(shot.pose,shot.poseAt(shot.t+t),shot.ball,shot.contactPart,t/.44).pose));
  }
}else for(const d of (process.env.DIRECTIONS?.split(',').map(Number)??[-1,1]))for(const h of (process.env.HEIGHTS?.split(',').map(Number)??[.3,1.2,2.3]))for(const t of timesForHeight(h))records.push(sample({d,h,t},goalkeeperPose(stats,d,t,h)));
const baselinePairs=new Set(records.slice(0,2).flatMap(r=>r.hits.map(h=>h.pair.join(':'))));for(const r of records){r.newHits=r.hits.filter(h=>!baselinePairs.has(h.pair.join(':')));r.newNonLocal=r.newHits.filter(h=>!h.isLocal).length;}
const hashesAfter=Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(new URL(f,repoURL))).digest('hex')])));
for(const r of records){
 r.newRegions={};for(const h of r.newHits){if(h.isLocal)continue;const key=h.faces.map(f=>f.region).sort().join(':');r.newRegions[key]=(r.newRegions[key]??0)+1;}
 const isTorso=b=>b==='chest'||b==='spine',isElbow=(a,b)=>/upper_arm/.test(a)&&b==='forearm'+a.at(-1)||/upper_arm/.test(b)&&a==='forearm'+b.at(-1),isOtherLeg=(a,b)=>/^(foot|toe|shin)[LR]$/.test(a)&&/^(foot|toe|shin)[LR]$/.test(b)&&a.at(-1)!==b.at(-1);
 const categories={forearmTorso:(a,b)=>isTorso(a)&&b.startsWith('forearm')||isTorso(b)&&a.startsWith('forearm'),calfTorso:(a,b)=>isTorso(a)&&b.startsWith('shin')||isTorso(b)&&a.startsWith('shin'),upperAndSupportTorso:(a,b)=>isTorso(a)&&/^(upper_arm|shoulder_support)/.test(b)||isTorso(b)&&/^(upper_arm|shoulder_support)/.test(a),innerElbow:isElbow,oppositeFootCalf:isOtherLeg};
 r.categories={};for(const[key,predicate]of Object.entries(categories)){const hs=r.newHits.filter(h=>!h.isLocal&&predicate(...h.faces.map(f=>f.region))).sort((a,b)=>b.finiteTriangleSeparation-a.finiteTriangleSeparation);r.categories[key]={count:hs.length,maxSeparation:hs[0]?.finiteTriangleSeparation??0,maxSegment:Math.max(0,...hs.map(h=>h.length)),topHits:hs.slice(0,5)};}
 r.torsoForearmHits=r.newHits.filter(h=>!h.isLocal&&h.faces.some(f=>['chest','spine'].includes(f.region))&&h.faces.some(f=>f.region.startsWith('forearm')));r.torsoForearmCount=r.torsoForearmHits.length;
 if(r.geometry){const prefix=(process.env.OUT??'triangle-self-intersection-audit')+'-pose-'+r.label.d+'-'+r.label.h+'-'+r.label.t;await writeFile(new URL(prefix+'.json',outURL),JSON.stringify({hashes,label:r.label,meshes:r.geometry}));
 const mask={};for(const h of r.torsoForearmHits)for(const f of h.faces){mask[f.mesh]??=new Set();mask[f.mesh].add(f.face)}const highlighted=[];for(const m of r.geometry){const marked=mask[m.name]??new Set();highlighted.push({...m,faces:m.faces.filter((_,i)=>!marked.has(i))});if(marked.size)highlighted.push({...m,name:m.name+'_crossing',material:'CROSSING_HIGHLIGHT',color:[1,.005,.005],faces:m.faces.filter((_,i)=>marked.has(i))});}await writeFile(new URL(prefix+'-highlight.json',outURL),JSON.stringify(highlighted));delete r.geometry;}
 if(!process.env.FULL_DETAILS){r.torsoForearmHits=r.torsoForearmHits.sort((a,b)=>b.depth-a.depth).slice(0,10);r.topHits=r.newHits.filter(h=>!h.isLocal&&!h.faces.every(f=>f.region==='head'||f.region.startsWith('foot')||f.region.startsWith('shin'))).sort((a,b)=>b.length-a.length).slice(0,20);delete r.newHits;delete r.hits;}
}
 await writeFile(new URL((process.env.OUT??'triangle-self-intersection-audit')+'.json',outURL),JSON.stringify({stats,hashes,hashesAfter,method:'Strict transverse triangle/triangle crossings after exact Three SkinnedMesh.applyBoneTransform; bind-position weld at 1um excludes shared-vertex/seam neighbours; isLocal marks one extra topology edge; coplanar/tangent contacts excluded. Depth is infinite-plane straddle, not a lower bound on penetration. finiteTriangleSeparation is minimum translation to separate the finite convex triangle pair using 11-axis SAT, not whole-body penetration.',records},null,2));

if(JSON.stringify(hashes)!==JSON.stringify(hashesAfter))throw Error("Source changed during triangle audit; rerun on a frozen checkout");

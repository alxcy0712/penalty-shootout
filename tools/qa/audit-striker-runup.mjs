// Read-only real-triangle run-up QA. Compare every styled pose with its exact source timestamp.
// ARTIFACT_DIR=/tmp/runup-mesh-qa node tools/qa/audit-striker-runup.mjs
// Optional PHASES=0,.2,.4,.6,.8,1 TARGETS=-5,0,5 STYLES=0,1,2 FULL_DETAILS=1
import {pathToFileURL} from 'node:url';
const repoURL=new URL('../../',import.meta.url),outURL=pathToFileURL((process.env.ARTIFACT_DIR??process.cwd()+'/validation/artifacts')+'/');
await mkdir(outURL,{recursive:true});
const THREE=await import(new URL('node_modules/three/build/three.module.js',repoURL));
const {loadCharacter}=await import(new URL('tests/helpers/load-character.js',repoURL));
const {penaltyStyles}=await import(new URL('src/anatomy.js',repoURL));
const {runupClipTime}=await import(new URL('src/striker-runup-style.js',repoURL));
const {KICK_CONTACT}=await import(new URL('src/game-character.js',repoURL));
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const files=[...(await readdir(new URL('src/',repoURL))).filter(f=>f.endsWith('.js')&&!f.startsWith('.')).sort().map(f=>'src/'+f),'assets/characters/striker-mocap.glb','tests/helpers/load-character.js','tools/qa/audit-striker-runup.mjs'];
const hashes=Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(new URL(f,repoURL))).digest('hex')])));
const c=await loadCharacter(false), meshes=[]; c.root.traverse(m=>{if(m.isSkinnedMesh)meshes.push(m)});c.root.updateMatrixWorld(true);
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
function sample(label) {
c.root.updateMatrixWorld(true);const positions=[];let base=0;
 for(const m of meshes){m.skeleton.update();for(let i=0;i<m.geometry.attributes.position.count;i++){const v=V().fromBufferAttribute(m.geometry.attributes.position,i);m.applyBoneTransform(i,v).applyMatrix4(m.matrixWorld);positions.push(v)}}
 const ts=triangles.map(t=>{const p=t.verts.map(i=>positions[i]),n=V().crossVectors(V().subVectors(p[1],p[0]),V().subVectors(p[2],p[0])),area=n.length()/2;n.normalize();return {...t,p,n,area,plane:n.dot(p[0]),bounds:[Math.min(...p.map(p=>p.x)),Math.max(...p.map(p=>p.x)),Math.min(...p.map(p=>p.y)),Math.max(...p.map(p=>p.y)),Math.min(...p.map(p=>p.z)),Math.max(...p.map(p=>p.z))]}});
 // Sweep axis; 17k triangles, actual narrowphase only where all bounds overlap.
 const sorted=ts.toSorted((a,b)=>a.bounds[0]-b.bounds[0]);let hits=[],local=0,tests=0;for(let i=0;i<sorted.length;i++){const a=sorted[i];if(a.area<1e-12)continue;for(let j=i+1;j<sorted.length;j++){const b=sorted[j];if(b.bounds[0]>a.bounds[1])break;if(a.bounds[2]>b.bounds[3]||b.bounds[2]>a.bounds[3]||a.bounds[4]>b.bounds[5]||b.bounds[4]>a.bounds[5]||adjacent(a,b)||b.area<1e-12)continue;tests++;const hit=intersection(a,b);if(hit){const isLocal=topologicalNeighbors(a,b);if(isLocal)local++;hits.push({pair:[Math.min(a.id,b.id),Math.max(a.id,b.id)],faces:[{mesh:meshes[a.mi].name,material:meshes[a.mi].material.name,face:a.face,vertices:a.local,region:a.region},{mesh:meshes[b.mi].name,material:meshes[b.mi].material.name,face:b.face,vertices:b.local,region:b.region}],isLocal,...hit})}}}
 hits.sort((a,b)=>b.length-a.length);let regions={};for(const hit of hits){const key=hit.faces.map(f=>f.region).sort().join(':');regions[key]=(regions[key]??0)+1}
 const areaCompression=ts.filter(t=>t.refArea>1e-6&&t.area/t.refArea<.08).map(t=>({mesh:meshes[t.mi].name,face:t.face,region:t.region,ratio:t.area/t.refArea,refArea:t.refArea}));
 const exportTimes=process.env.EXPORT_TIMES?.split(',').map(Number)??[];
 const geometry=typeof label==='object'&&exportTimes.includes(label.phase)?meshes.map((m,mi)=>({name:m.name,material:m.material.name,color:m.material.color.toArray(),positions:positions.slice(meshes.slice(0,mi).reduce((a,m)=>a+m.geometry.attributes.position.count,0),meshes.slice(0,mi+1).reduce((a,m)=>a+m.geometry.attributes.position.count,0)).map(v=>[v.x,v.y,v.z]),faces:triangles.filter(t=>t.mi===mi).map(t=>t.local)})):undefined;
 const out={label,geometry,tests,count:hits.length,nonLocal:hits.length-local,maxLength:hits[0]?.length??0,regions,hits,areaCompression};console.log(JSON.stringify({label,count:out.count,nonLocal:out.nonLocal,maxLength:out.maxLength,regions,compressed:areaCompression.length}));return out;
}

const records=[],categories={
  kneeFold:(a,b)=>a==='thigh'+b.at(-1)&&b.startsWith('shin')||b==='thigh'+a.at(-1)&&a.startsWith('shin'),
  oppositeLowerLeg:(a,b)=>/^(foot|toe|shin)[LR]$/.test(a)&&/^(foot|toe|shin)[LR]$/.test(b)&&a.at(-1)!==b.at(-1),
  oppositeLeg:(a,b)=>/^(thigh|foot|toe|shin)[LR]$/.test(a)&&/^(thigh|foot|toe|shin)[LR]$/.test(b)&&a.at(-1)!==b.at(-1),
  legTorso:(a,b)=>/^(thigh|foot|toe|shin)[LR]$/.test(a)&&['pelvis','spine','chest'].includes(b)||/^(thigh|foot|toe|shin)[LR]$/.test(b)&&['pelvis','spine','chest'].includes(a),
  lowerLimb:(a,b)=>/^(thigh|foot|toe|shin)[LR]$/.test(a)||/^(thigh|foot|toe|shin)[LR]$/.test(b),
};
const phases=process.env.PHASES?.split(',').map(Number)??Array.from({length:21},(_,i)=>i/20);
const targets=process.env.TARGETS?.split(',').map(Number)??[-5,0,5];
const styles=process.env.STYLES?.split(',').map(Number)??[0,1,2];
for(const styleIndex of styles)for(const targetX of targets)for(const phase of phases){
  const style=penaltyStyles[styleIndex],sourceTime=runupClipTime(phase,style),label={styleIndex,style:style.name,targetX,phase,sourceTime};
  c.kick(sourceTime/KICK_CONTACT,null,{targetX});const source=sample({...label,mode:'source'});
  c.kick(phase,null,{style,targetX});const styled=sample({...label,mode:'styled'});
  const pairs=new Set(source.hits.map(h=>h.pair.join(':')));
  const added=styled.hits.filter(h=>!h.isLocal&&!pairs.has(h.pair.join(':')));
  const categoriesOut={};
  for(const [key,predicate] of Object.entries(categories)){
    const sourceHits=source.hits.filter(h=>!h.isLocal&&predicate(...h.faces.map(f=>f.region)));
    const styledHits=styled.hits.filter(h=>!h.isLocal&&predicate(...h.faces.map(f=>f.region)));
    const addedHits=added.filter(h=>predicate(...h.faces.map(f=>f.region))).sort((a,b)=>b.finiteTriangleSeparation-a.finiteTriangleSeparation);
    categoriesOut[key]={sourceCount:sourceHits.length,styledCount:styledHits.length,addedCount:addedHits.length,maxAddedSeparation:Math.max(0,...addedHits.map(h=>h.finiteTriangleSeparation)),maxAddedSegment:Math.max(0,...addedHits.map(h=>h.length)),topAdded:addedHits.slice(0,10)};
  }
  const record={label,categories:categoriesOut,sourceRegions:source.regions,styledRegions:styled.regions,addedRegions:{},sourceAreaCompression:source.areaCompression,styledAreaCompression:styled.areaCompression};
  for(const hit of added){const key=hit.faces.map(f=>f.region).sort().join(':');record.addedRegions[key]=(record.addedRegions[key]??0)+1;}
  if(process.env.FULL_DETAILS)record.addedHits=added;
  if(styled.geometry){
    const prefix=`striker-${styleIndex}-aim${targetX}-phase${phase}`;
    await writeFile(new URL(prefix+'.json',outURL),JSON.stringify({label,meshes:styled.geometry}));
  }
  console.log(JSON.stringify({summary:label,categories:Object.fromEntries(Object.entries(categoriesOut).map(([k,v])=>[k,{...v,topAdded:undefined}]))}));
  records.push(record);
}
const summary=Object.fromEntries(Object.keys(categories).map(key=>[key,{sourceHits:records.reduce((n,r)=>n+r.categories[key].sourceCount,0),styledHits:records.reduce((n,r)=>n+r.categories[key].styledCount,0),addedHits:records.reduce((n,r)=>n+r.categories[key].addedCount,0),maxAddedSeparation:Math.max(...records.map(r=>r.categories[key].maxAddedSeparation)),worst:records.toSorted((a,b)=>b.categories[key].maxAddedSeparation-a.categories[key].maxAddedSeparation).slice(0,5).map(r=>({label:r.label,...r.categories[key]}))}]));
await writeFile(new URL('striker-runup-triangle-audit.json',outURL),JSON.stringify({hashes,phases,targets,styles,summary,method:'Exact CPU SkinnedMesh.applyBoneTransform; strict transverse triangle crossings; bind-position weld at 1um excludes shared-vertex/seam neighbours; isLocal marks one extra topology edge. Added means a nonlocal crossing pair absent in the same source timestamp. Finite triangle separation is the SAT minimum translation for the finite triangles, not a whole-body penetration depth. Tangential/coplanar overlap is not measured.',records},null,2));
console.log('FINAL_SUMMARY',JSON.stringify(summary));

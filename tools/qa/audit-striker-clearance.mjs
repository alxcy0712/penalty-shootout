// Read-only paired native-time arm-clearance audit; see --help.
import {pathToFileURL} from 'node:url';
if(process.argv.includes('--help')){console.log(`Audit the production striker's actual skinned forearm/shirt and shoulder seams.
ARTIFACT_DIR=/tmp/striker-clearance node tools/qa/audit-striker-clearance.mjs
Optional FPS=100 (1..240); SOURCES=10_01,10_03; MODEL_ASSET=/absolute/candidate.glb
Default: 121 CMU10_01 samples(native1.65..2.85) +61 CMU10_03 samples(1.20..1.80).
Writes arm-clearance.json and metadata.json. Read-only with respect to production assets.
Raw means captured pose with current shoulder support; corrected adds only the source-specific arm correction.
Reports strict transverse triangle intersections, including known internal garment seams.
No claim of globally intersection-free geometry is implied.`);process.exit(0);}
const repoURL=new URL('../../',import.meta.url),outURL=pathToFileURL((process.env.ARTIFACT_DIR??process.cwd()+'/validation/artifacts/striker-clearance')+'/');
const fps=Number(process.env.FPS??100),sources=(process.env.SOURCES??'10_01,10_03').split(',');
if(!Number.isFinite(fps)||fps<1||fps>240||sources.some(source=>!['10_01','10_03'].includes(source)))throw Error('Invalid FPS or SOURCES');
await mkdir(outURL,{recursive:true});
const THREE=await import(new URL('node_modules/three/build/three.module.js',repoURL));
const {loadCharacter}=await import(new URL('tools/qa/load-review-character.mjs',repoURL));
const {penaltyStyles}=await import(new URL('src/anatomy.js',repoURL));
const {runupClipTime}=await import(new URL('src/striker-runup-style.js',repoURL));
const {KICK_CONTACT}=await import(new URL('src/game-character.js',repoURL));
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const files=[...(await readdir(new URL('src/',repoURL))).filter(f=>f.endsWith('.js')&&!f.startsWith('.')).sort().map(f=>'src/'+f),'assets/characters/striker-mocap.glb','assets/characters/mocap-variants/cmu-10_03-kick.glb','tools/qa/load-review-character.mjs','tools/qa/audit-striker-clearance.mjs'];
const hashes=Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(new URL(f,repoURL))).digest('hex')])));
const c=await loadCharacter(false,process.env.MODEL_ASSET), meshes=[]; c.root.traverse(m=>{if(m.isSkinnedMesh)meshes.push(m)});c.root.updateMatrixWorld(true);
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
 const out={label,geometry,tests,count:hits.length,nonLocal:hits.length-local,maxLength:hits[0]?.length??0,regions,hits,areaCompression};return out;
}




const {createStrikerArmClearance}=await import(new URL('src/striker-arm-clearance.js',repoURL));
const {updateKeeperShoulderSupport}=await import(new URL('src/keeper-skin-pose.js',repoURL));
const correct=createStrikerArmClearance(c.root),rows=[];
const categories={
 forearm:regions=>regions.some(name=>name.startsWith('forearm'))&&regions.some(name=>['spine','chest'].includes(name)),
 upper:regions=>regions.some(name=>/^(upper_arm|shoulder_support)/.test(name))&&regions.some(name=>['spine','chest'].includes(name)),
};
const brief=hit=>({pair:hit.pair,faces:hit.faces,finiteTriangleSeparation:hit.finiteTriangleSeparation,length:hit.length,center:hit.center});
for(const recipe of[{take:'10_01',source:'CMU_10_01_Runup_Kick_Recovery',start:1.65,end:2.85,styleIndex:0},{take:'10_03',source:'CMU_10_03_Kick',start:1.20,end:1.80,styleIndex:3}]){
 if(!sources.includes(recipe.take))continue;
 const index=c.actions.findIndex(action=>action.getClip().name===recipe.source);if(index<0)throw Error('Missing source clip '+recipe.source);
 const frameCount=Math.round((recipe.end-recipe.start)*fps);
 for(let frame=0;frame<=frameCount;frame++){
  const nativeTime=recipe.start+(recipe.end-recipe.start)*frame/frameCount;
  const gameTime=recipe.styleIndex===0?penaltyStyles[0].duration+nativeTime-KICK_CONTACT:nativeTime;
  const gameTimes=recipe.styleIndex===0?penaltyStyles.slice(0,3).map((style,styleIndex)=>({styleIndex,name:style.name,time:style.duration+nativeTime-KICK_CONTACT})):[{styleIndex:3,name:penaltyStyles[3].name,time:gameTime}];
  const label={take:recipe.take,source:recipe.source,nativeTime,gameTime,gameTimes},samples=[];
  for(const fixed of[false,true]){
   correct.restore();c.capture(nativeTime,index);if(fixed)correct(nativeTime,recipe.source);
   c.root.updateMatrixWorld(true);updateKeeperShoulderSupport(c.root);samples.push(sample({...label,fixed}));
  }
  const result={...label,before:{},after:{},difference:{}};
  for(const[name,predicate]of Object.entries(categories)){
   const hits=samples.map(s=>s.hits.filter(hit=>!hit.isLocal&&predicate(hit.faces.map(face=>face.region))).sort((a,b)=>b.finiteTriangleSeparation-a.finiteTriangleSeparation));
   const original=new Map(hits[0].map(hit=>[hit.pair.join(':'),hit]));
   for(const[i,key]of['before','after'].entries())result[key][name]={count:hits[i].length,max:Math.max(0,...hits[i].map(hit=>hit.finiteTriangleSeparation)),top:hits[i].slice(0,3).map(brief)};
   const added=hits[1].filter(hit=>!original.has(hit.pair.join(':')));
   result.difference[name]={addedCount:added.length,maxAddedSeparation:Math.max(0,...added.map(hit=>hit.finiteTriangleSeparation)),maxSeparationChange:result.after[name].max-result.before[name].max,topAdded:added.slice(0,3).map(brief)};
  }
  rows.push(result);
  if(frame%25===0||frame===frameCount)console.log(JSON.stringify({take:recipe.take,nativeTime,gameTime,forearmBefore:result.before.forearm.count,forearmAfter:result.after.forearm.count,upperBefore:result.before.upper.max,upperAfter:result.after.upper.max}));
 }
}
const summary=Object.fromEntries(sources.map(take=>{const records=rows.filter(row=>row.take===take);return[take,{samples:records.length,categories:Object.fromEntries(Object.keys(categories).map(name=>[name,{beforeCount:records.reduce((sum,row)=>sum+row.before[name].count,0),afterCount:records.reduce((sum,row)=>sum+row.after[name].count,0),beforeMax:Math.max(...records.map(row=>row.before[name].max)),afterMax:Math.max(...records.map(row=>row.after[name].max)),maxAddedSeparation:Math.max(...records.map(row=>row.difference[name].maxAddedSeparation)),maxPerFrameIncrease:Math.max(0,...records.map(row=>row.difference[name].maxSeparationChange))}]))}];}));
const actualModel=process.env.MODEL_ASSET??new URL('assets/characters/striker-mocap.glb',repoURL);
const metadata={hashes,actualModelSha256:createHash('sha256').update(await readFile(actualModel)).digest('hex'),fps,sources,samples:rows.length,summary,method:'Paired raw/corrected CPU-skinned triangle audit with final root-local shoulder helpers refreshed after correction. Forearm includes either forearm versus spine/chest; upper includes upper_arm and shoulder_support versus spine/chest. Strict transverse crossings exclude shared-vertex and one-ring neighbours; finite-triangle SAT separation is not whole-body penetration depth. Internal garment intersections remain and are reported explicitly.'};
await writeFile(new URL('arm-clearance.json',outURL),JSON.stringify(rows,null,2));
await writeFile(new URL('metadata.json',outURL),JSON.stringify(metadata,null,2));
console.log('CLEARANCE_AUDIT',JSON.stringify({output:outURL.href,...summary}));
if(rows.some(row=>row.after.forearm.count>0)){console.error('Forearm/shirt clearance regression: inspect arm-clearance.json');process.exitCode=1;}

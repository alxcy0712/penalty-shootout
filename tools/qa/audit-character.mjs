// Read-only exact-skin and physics audit. No browser/GPU performance claims.
import {pathToFileURL} from 'node:url';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
const root=fileURLToPath(new URL('../../',import.meta.url)),mode=process.argv[2];
if(mode==='--help'){console.log('Usage: node tools/qa/audit-character.mjs matrix|hold|ground|performance --out DIR\nRead-only CPU audit of the production skin/physics. Results carry source SHA-256.');process.exit(0);}
if(!['matrix','hold','ground','performance'].includes(mode))throw Error('Choose matrix, hold, ground or performance');
const outputIndex=process.argv.indexOf('--out'),out=resolve(outputIndex<0?'validation/artifacts':process.argv[outputIndex+1]);await mkdir(out,{recursive:true});
const url=pathToFileURL(root+'/'),T=await import(new URL('node_modules/three/build/three.module.js',url));
const {Shot}=await import(new URL('src/engine.js',url));
const {loadCharacter}=await import(new URL('tests/helpers/load-character.js',url));
const {holdingPose,HOLD_DURATION,goalkeeperPose,keeperWarmupPose}=await import(new URL('src/anatomy.js',url));
const {keeperGather}=await import(new URL('src/keeper-contact.js',url));
const sourceFiles=[...(await readdir(root+'/src')).filter(f=>f.endsWith('.js')).sort().map(f=>'src/'+f),'assets/characters/keeper-prototype.glb','assets/characters/striker-mocap.glb','tests/helpers/load-character.js','tools/qa/audit-character.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,createHash('sha256').update(await readFile(root+'/'+file)).digest('hex')])));
const sourceSha256=await hashes(),snapshot={sha256:createHash('sha256').update(JSON.stringify(sourceSha256)).digest('hex')};
const stats={accuracy:90,power:90,touch:90,composure:90,speed:85,reach:85,handling:95};
const cases=[];for(const x of[-3.3,-1.5,0,1.5,3.3])for(const y of[.2,1.2,2.2])for(const power of[.12,.5,.9])for(const direction of[-1,0,1])cases.push({aim:{x,y,power},direction,seed:42,stats});
const V=p=>new T.Vector3().copy(p),quantile=(a,p)=>a.toSorted((a,b)=>a-b)[Math.min(a.length-1,Math.floor(a.length*p))];
const summary=a=>({n:a.length,p50:quantile(a,.5),p95:quantile(a,.95),p99:quantile(a,.99),max:Math.max(...a)});
const write=(name,data)=>writeFile(`${out}/${name}.json`,JSON.stringify({snapshotSha256:snapshot.sha256,sourceSha256,note:'CPU test of frozen production source/GLB, not browser or device performance.',...data},null,2));
let actor,meshes;
async function setup(){actor=await loadCharacter(true);meshes=[];actor.root.traverse(m=>{if(m.isSkinnedMesh)meshes.push(m)});}
function geometry(pose){actor.pose(pose);actor.root.updateMatrixWorld(true);return meshes.map(m=>{m.skeleton.update();const {position,skinIndex,skinWeight}=m.geometry.attributes;const vertices=[],hands=[];for(let i=0;i<position.count;i++){const p=new T.Vector3().fromBufferAttribute(position,i);m.applyBoneTransform(i,p).applyMatrix4(m.matrixWorld);vertices.push(p);let hand;for(let j=0;j<4;j++){const n=m.skeleton.bones[skinIndex.getComponent(i,j)].name;if(n.startsWith('hand')&&skinWeight.getComponent(i,j)>.5)hand=n;}hands.push(hand);}return{m,vertices,hands};});}
const tri=new T.Triangle(),q=new T.Vector3();
function distances(point,geo){const target=V(point),best={all:{distance:Infinity},handL:{distance:Infinity},handR:{distance:Infinity}};for(const {m,vertices,hands}of geo){const ids=m.geometry.index;for(let f=0;f<ids.count;f+=3){const ix=[ids.getX(f),ids.getX(f+1),ids.getX(f+2)];tri.set(...ix.map(i=>vertices[i]));tri.closestPointToPoint(target,q);const distance=q.distanceTo(target);if(!Number.isFinite(distance))continue;for(const name of['all','handL','handR'])if(name==='all'||ix.every(i=>hands[i]===name)){if(distance<best[name].distance)best[name]={distance,gap:distance-.11,mesh:m.name,material:m.material.name,face:f/3,point:q.toArray()};}}}return best;}
function skinMin(geo){let worst={y:Infinity};for(const {m,vertices}of geo)vertices.forEach((p,i)=>{if(p.y<worst.y)worst={y:p.y,mesh:m.name,material:m.material.name,vertex:i,position:p.toArray()};});return worst;}
if(mode==='matrix'){
 await setup();const records=[];for(const c of cases){const s=new Shot(c.aim,c.stats,c.stats,c.direction,c.seed),reflect=s.reflect.bind(s);let impact,first;
 s.reflect=(hit,r,e)=>{impact={...hit.p};return reflect(hit,r,e);};
 for(let n=0;n<3600&&!s.result;n++){const touched=s.touched;s.step(1/120);if(!touched&&s.touched){const geo=geometry(s.pose),point=s.caught?s.ball:impact;first={t:s.t,part:s.contactPart,caught:s.caught,impact:point,skin:distances(point,geo),postBall:{...s.ball},postSkin:distances(s.ball,geo)};}}
 records.push({case:c,settled:!!s.result,result:s.result,touched:s.touched,caught:s.caught,first});}
 const touched=records.filter(r=>r.first),data={cases:records.length,contacts:touched.length,caught:records.filter(r=>r.caught).length,unsettled:records.filter(r=>!r.settled).length,maxContactGap:Math.max(...touched.map(r=>r.first.skin.all.gap)),minContactGap:Math.min(...touched.map(r=>r.first.skin.all.gap)),maxPostGap:Math.max(...touched.map(r=>r.first.postSkin.all.gap)),minPostGap:Math.min(...touched.map(r=>r.first.postSkin.all.gap)),records};await write('collision-matrix',data);console.log(JSON.stringify({...data,records:undefined}));
}
if(mode==='performance'){
 function bench(){const near=[],all=[],construct=[],outcome={touched:0,caught:0,goals:0,reboundGoals:0,unsettled:0};const totalStart=performance.now();for(const c of cases){let at=performance.now();const s=new Shot(c.aim,c.stats,c.stats,c.direction,c.seed);construct.push(performance.now()-at);for(let n=0;n<3600&&!s.result;n++){const isNear=s.ball.z<1.5&&s.ball.z>-.4;at=performance.now();s.step(1/120);const ms=performance.now()-at;all.push(ms);if(isNear)near.push(ms);}outcome.touched+=+s.touched;outcome.caught+=+s.caught;outcome.goals+=+!!s.result?.goal;outcome.reboundGoals+=+(s.touched&&!!s.result?.goal);outcome.unsettled+=+!s.result;}return{...outcome,totalMs:performance.now()-totalStart,constructMs:summary(construct),allStepMs:summary(all),nearGoalStepMs:summary(near)}}
 bench();const runs=[bench(),bench(),bench()];await write('performance',{cases:cases.length,runs});console.log(JSON.stringify({cases:cases.length,runs}));
}
if(mode==='hold'){
 await setup();const special=[[-1,.3,2,3],[-1,2.1,1.5,2],[1,.3,2,3],[1,2.1,1.5,1]].map(([direction,y,x,seed])=>({aim:{x:direction*x,y,power:.55},direction,seed,stats:{...stats,speed:95,reach:95}}));
 const records=[];for(const c of [...cases,...special]){const shot=new Shot(c.aim,c.stats,c.stats,c.direction,c.seed);while(!shot.result&&shot.t<30)shot.step(1/120);if(!shot.caught)continue;
 const at=(after)=>{return keeperGather(shot.pose,shot.poseAt((shot.animationTime??shot.t)+after),shot.ball,shot.contactPart,after/HOLD_DURATION)};
 let previous,maxBallStep={distance:0},maxHandAngle={angle:0},minSkin={y:Infinity},minGap={gap:Infinity},maxGloveGap={gap:-Infinity};const samples=[],dur=2.8;
 const init=at(0),captureJump=V(init.ball).distanceTo(V(shot.ball));for(let f=0;f<=dur*240;f++){const after=f/240,now=at(after);actor.pose(now.pose);const hands=['handL','handR'].map(n=>actor.root.getObjectByName(n).getWorldQuaternion(new T.Quaternion()).normalize());if(previous){const distance=V(now.ball).distanceTo(V(previous.ball));if(distance>maxBallStep.distance)maxBallStep={distance,after,previous:previous.ball,current:now.ball};hands.forEach((h,i)=>{const angle=h.angleTo(previous.hands[i]);if(angle>maxHandAngle.angle)maxHandAngle={angle,after,hand:i}});}previous={...now,hands};
 if(f%4===0){const geo=geometry(now.pose),skin=skinMin(geo),d=distances(now.ball,geo),glove=Math.min(d.handL.gap,d.handR.gap);if(skin.y<minSkin.y)minSkin={...skin,after};if(d.all.gap<minGap.gap)minGap={...d.all,after};if(glove>maxGloveGap.gap)maxGloveGap={gap:glove,after};samples.push({after,ball:now.ball,skinMinimum:skin.y,allGap:d.all.gap,leftGloveGap:d.handL.gap,rightGloveGap:d.handR.gap});}}
 // Check the worst 240 Hz interval at 1/96000 s. A large step persisting as
 // the time step shrinks is a branch discontinuity, rather than fast motion.
 let microPrevious,maxMicro={distance:0};for(let i=0;i<=800;i++){const after=Math.max(0,maxBallStep.after-1/240)+i/96000;if(after>maxBallStep.after+1/240)break;const now=at(after);if(microPrevious){const distance=V(now.ball).distanceTo(V(microPrevious));if(distance>maxMicro.distance)maxMicro={distance,after};}microPrevious=now.ball;}
 const record={case:c,t:shot.t,animationTime:shot.animationTime,part:shot.contactPart,captureJump,maxBallStep,maxMicro,maxHandAngle,minSkin,minGap,maxGloveGap,samples};records.push(record);console.log(JSON.stringify({...record,samples:undefined}));}
 await write('actual-holding-240hz',{hz:240,geometryHz:60,duration:2.8,records});
}
if(mode==='ground'){
 await setup();const specs=[];for(const d of[-1,0,1])for(const h of[.3,1.2,2.3])specs.push({label:{d,h,speed:85,reach:85,stretch:0},fn:t=>goalkeeperPose(stats,d,t,h),duration:4});for(const speed of[50,99])for(const d of[-1,1])for(const h of[.3,2.3])for(const stretch of[0,1])specs.push({label:{d,h,speed,reach:speed,stretch},fn:t=>goalkeeperPose({speed,reach:speed,stretch},d,t,h),duration:4});specs.push({label:'warmup',fn:keeperWarmupPose,duration:12});for(const d of[-1,1])specs.push({label:{motion:'held',d},fn:t=>holdingPose(goalkeeperPose(stats,d,t,2)).pose,duration:4});
 const records=[];for(const spec of specs){let worst={y:Infinity};for(let f=0;f<=spec.duration*60;f++){const t=f/60,skin=skinMin(geometry(spec.fn(t)));if(skin.y<worst.y)worst={...skin,t};}const row={label:spec.label,hz:60,...worst};records.push(row);console.log(JSON.stringify(row));}await write('ground-skin',{records});
}

if(JSON.stringify(await hashes())!==JSON.stringify(sourceSha256))throw Error("Source changed during audit; results are invalid, rerun on a frozen checkout");

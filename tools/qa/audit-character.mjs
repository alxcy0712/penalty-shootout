// Read-only exact-skin and physics audit. No browser/GPU performance claims.
import {pathToFileURL} from 'node:url';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {readAuditFixtures} from './read-audit-fixtures.mjs';
const explicitFixtures=await readAuditFixtures();
const root=fileURLToPath(new URL('../../',import.meta.url)),mode=process.argv[2];
if(mode==='--help'){console.log('Usage: node tools/qa/audit-character.mjs matrix|hold|ground|trajectory|performance --out DIR [--check] [--fixtures JSON]\nRead-only CPU audit of the production skin/physics. Results carry source SHA-256.');process.exit(0);}
if(!['matrix','hold','ground','trajectory','performance'].includes(mode))throw Error('Choose matrix, hold, ground, trajectory or performance');
const outputIndex=process.argv.indexOf('--out'),out=resolve(outputIndex<0?'validation/artifacts':process.argv[outputIndex+1]);await mkdir(out,{recursive:true});
const url=pathToFileURL(root+'/'),T=await import(new URL('node_modules/three/build/three.module.js',url));
const {Shot}=await import(new URL('src/engine.js',url));
const {loadCharacter}=await import(new URL('tests/helpers/load-character.js',url));
const {holdingPose,HOLD_DURATION,goalkeeperPose,keeperWarmupPose}=await import(new URL('src/anatomy.js',url));
const {keeperGather,keeperHandRotation}=await import(new URL('src/keeper-contact.js',url));
const sourceFiles=[...(await readdir(root+'/src')).filter(f=>f.endsWith('.js')).sort().map(f=>'src/'+f),'assets/characters/keeper-prototype.glb','assets/characters/striker-mocap.glb','tests/helpers/load-character.js','tools/qa/audit-character.mjs','tools/qa/read-audit-fixtures.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,createHash('sha256').update(await readFile(root+'/'+file)).digest('hex')])));
const sourceSha256=await hashes(),snapshot={sha256:createHash('sha256').update(JSON.stringify(sourceSha256)).digest('hex')};
const stats={accuracy:90,power:90,touch:90,composure:90,speed:85,reach:85,handling:95};
const cases=[];for(const x of[-3.3,-1.5,0,1.5,3.3])for(const y of[.2,1.2,2.2])for(const power of[.12,.5,.9])for(const direction of[-1,0,1])cases.push({aim:{x,y,power},direction,seed:42,stats});
if(explicitFixtures)cases.splice(0,cases.length,...explicitFixtures.fixtures);
const V=p=>new T.Vector3().copy(p),quantile=(a,p)=>a.toSorted((a,b)=>a-b)[Math.min(a.length-1,Math.floor(a.length*p))];
const summary=a=>({n:a.length,p50:quantile(a,.5),p95:quantile(a,.95),p99:quantile(a,.99),max:Math.max(...a)});
const write=(name,data)=>writeFile(`${out}/${name}.json`,JSON.stringify({snapshotSha256:snapshot.sha256,sourceSha256,explicitFixtures:explicitFixtures&&{path:explicitFixtures.path,sha256:explicitFixtures.sha256,expectedCaptures:explicitFixtures.expectedCaptures},note:'CPU test of frozen production source/GLB, not browser or device performance.',...data},null,2));
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
 const touched=records.filter(r=>r.first),data={cases:records.length,contacts:touched.length,caught:records.filter(r=>r.caught).length,unsettled:records.filter(r=>!r.settled).length,maxContactGap:Math.max(...touched.map(r=>r.first.skin.all.gap)),minContactGap:Math.min(...touched.map(r=>r.first.skin.all.gap)),maxPostGap:Math.max(...touched.map(r=>r.first.postSkin.all.gap)),minPostGap:Math.min(...touched.map(r=>r.first.postSkin.all.gap)),records};// Glove and articulated torso use exact triangles; other limb hulls are
 // deliberately conservative. Report their positive gaps without mislabelling
 // them exact-surface failures. Penetration remains gated for every part.
 const exactPart=part=>part==='handL'||part==='handR'||part==='torso'||part==='skin';
 const failures=records.filter(r=>!r.settled||(r.first&&(r.first.skin.all.gap<-.005||(exactPart(r.first.part)&&r.first.skin.all.gap>.002)))).map(r=>({case:r.case,settled:r.settled,first:r.first}));
 if(explicitFixtures&&data.caught!==explicitFixtures.expectedCaptures)failures.push({reason:'Explicit caught cohort changed',expected:explicitFixtures.expectedCaptures,actual:data.caught});
 data.conservativeHullContacts=touched.filter(r=>!exactPart(r.first.part)).map(r=>({case:r.case,part:r.first.part,gap:r.first.skin.all.gap}));
 data.gate={floorBodyTolerance:.005,exactFirstContactGapTolerance:.002,conservativeHullPositiveGaps:'reported separately; not exact triangle contacts',failures};
 await write('collision-matrix',data);console.log(JSON.stringify({...data,records:undefined,gate:{...data.gate,failures:failures.length}}));
 if(process.argv.includes('--check')&&failures.length)process.exitCode=1;
}
if(mode==='trajectory'){
 await setup();const records=[],failures=[];
 for(const c of cases){const shot=new Shot(c.aim,c.stats,c.stats,c.direction,c.seed);let samples=0,minimum={gap:Infinity},maxContactsPerStep=0,contactsThisStep=0;const reflect=shot.reflect.bind(shot);
  shot.reflect=(...args)=>{contactsThisStep++;return reflect(...args);};
  for(let frame=0;frame<3600&&!shot.result;frame++){
   contactsThisStep=0;shot.step(1/120);maxContactsPerStep=Math.max(maxContactsPerStep,contactsThisStep);
   // Dynamic joint bounds include recovery feet and outfield keeper motion.
   // 40cm expands the rig joints for skin, boot overhang and the11cm sphere.
   const p=shot.pose,points=[p.hip,p.shoulder,...p.hips,...p.knees,...p.feet,...p.shoulders,...p.elbows,...p.hands,{x:p.hip.x+.7*p.up.x,y:p.hip.y+.7*p.up.y,z:p.hip.z+.7*p.up.z}];
   if(['x','y','z'].some(axis=>shot.ball[axis]<Math.min(...points.map(q=>q[axis]))-.4||shot.ball[axis]>Math.max(...points.map(q=>q[axis]))+.4))continue;
   const geo=geometry(shot.pose),near=distances(shot.ball,geo).all;samples++;
   if(near.gap<minimum.gap)minimum={...near,time:shot.t,ball:{...shot.ball},part:shot.contactPart,caught:!!shot.caught};
  }
  const record={case:c,samples,minimum,maxContactsPerStep,settled:!!shot.result,result:shot.result,caught:!!shot.caught};records.push(record);
  if(!shot.result||minimum.gap<-.005)failures.push(record);
 }
 const data={cases:records.length,samples:records.reduce((n,r)=>n+r.samples,0),physicsHz:120,geometryHz:120,nearRegion:{method:'all articulated joint bounds plus head extent',padding:.4},minimumGap:Math.min(...records.map(r=>r.minimum.gap)),maxContactsPerStep:Math.max(...records.map(r=>r.maxContactsPerStep)),gate:{bodyTolerance:.005,failures},records};
 await write('near-keeper-trajectory',data);console.log(JSON.stringify({...data,records:undefined,gate:{...data.gate,failures:failures.length}}));
 if(process.argv.includes('--check')&&failures.length)process.exitCode=1;
}
if(mode==='performance'){
 function bench(){const near=[],all=[],construct=[],outcome={touched:0,caught:0,goals:0,reboundGoals:0,unsettled:0};const totalStart=performance.now();for(const c of cases){let at=performance.now();const s=new Shot(c.aim,c.stats,c.stats,c.direction,c.seed);construct.push(performance.now()-at);for(let n=0;n<3600&&!s.result;n++){const isNear=s.ball.z<1.5&&s.ball.z>-.4;at=performance.now();s.step(1/120);const ms=performance.now()-at;all.push(ms);if(isNear)near.push(ms);}outcome.touched+=+s.touched;outcome.caught+=+s.caught;outcome.goals+=+!!s.result?.goal;outcome.reboundGoals+=+(s.touched&&!!s.result?.goal);outcome.unsettled+=+!s.result;}return{...outcome,totalMs:performance.now()-totalStart,constructMs:summary(construct),allStepMs:summary(all),nearGoalStepMs:summary(near)}}
 bench();const runs=[bench(),bench(),bench()];await write('performance',{cases:cases.length,runs});console.log(JSON.stringify({cases:cases.length,runs}));
}
if(mode==='hold'){
 await setup();const special=[[-1,.3,2,3],[-1,2.1,1.5,2],[1,.3,2,3],[1,2.1,1.5,1]].map(([direction,y,x,seed])=>({aim:{x:direction*x,y,power:.55},direction,seed,stats:{...stats,speed:95,reach:95}}));
 const records=[],cohortChanges=[];for(const c of [...cases,...(explicitFixtures?[]:special)]){const shot=new Shot(c.aim,c.stats,c.stats,c.direction,c.seed);while(!shot.result&&shot.t<30)shot.step(1/120);if(typeof c.expectedCaught==='boolean'&&!!shot.caught!==c.expectedCaught)cohortChanges.push({reason:'Pinned catch outcome changed',id:c.id,expected:c.expectedCaught,actual:!!shot.caught});if(!shot.caught)continue;
 const at=(after)=>{return keeperGather(shot.pose,shot.poseAt((shot.animationTime??shot.t)+after),shot.ball,shot.contactPart,after/HOLD_DURATION)};
 let previous,maxBallStep={distance:0},maxElbowStep={distance:0},maxHandAngle={angle:0},minSkin={y:Infinity},minGap={gap:Infinity},maxGloveGap={gap:-Infinity};const samples=[],dur=2.8;
 const init=at(0),captureJump=V(init.ball).distanceTo(V(shot.ball));for(let f=0;f<=dur*240;f++){const after=f/240,now=at(after);actor.pose(now.pose);const hands=['handL','handR'].map(n=>actor.root.getObjectByName(n).getWorldQuaternion(new T.Quaternion()).normalize());if(previous){const distance=V(now.ball).distanceTo(V(previous.ball));if(distance>maxBallStep.distance)maxBallStep={distance,after,previous:previous.ball,current:now.ball};now.pose.elbows.forEach((elbow,i)=>{const step=V(elbow).distanceTo(V(previous.pose.elbows[i]));if(step>maxElbowStep.distance)maxElbowStep={distance:step,after,index:i};});hands.forEach((h,i)=>{const angle=h.angleTo(previous.hands[i]);if(angle>maxHandAngle.angle)maxHandAngle={angle,after,hand:i}});}previous={...now,hands};
 if(f%4===0){const geo=geometry(now.pose),skin=skinMin(geo),d=distances(now.ball,geo),glove=Math.min(d.handL.gap,d.handR.gap);if(skin.y<minSkin.y)minSkin={...skin,after};if(d.all.gap<minGap.gap)minGap={...d.all,after};if(glove>maxGloveGap.gap)maxGloveGap={gap:glove,after};samples.push({after,ball:now.ball,skinMinimum:skin.y,allGap:d.all.gap,leftGloveGap:d.handL.gap,rightGloveGap:d.handR.gap});}}
 // Check the worst 240 Hz interval at 1/96000 s. A large step persisting as
 // the time step shrinks is a branch discontinuity, rather than fast motion.
 let microPrevious,maxMicro={distance:0};for(let i=0;i<=800;i++){const after=Math.max(0,(maxBallStep.after??0)-1/240)+i/96000;if(after>(maxBallStep.after??0)+1/240)break;const now=at(after);if(microPrevious){const distance=V(now.ball).distanceTo(V(microPrevious));if(distance>maxMicro.distance)maxMicro={distance,after};}microPrevious=now.ball;}
 let previousHand,maxHandMicro={angle:0};
 const handStart=Math.max(0,(maxHandAngle.after??0)-1/240);
 for(let i=0;i<=800;i++){
  const after=handStart+i/96000;if(after>(maxHandAngle.after??0)+1/240)break;
  const now=at(after),rotation=keeperHandRotation(now.pose,maxHandAngle.hand??0).normalize();
  if(previousHand){const angle=rotation.angleTo(previousHand);if(angle>maxHandMicro.angle)maxHandMicro={angle,after};}previousHand=rotation;
 }
 let previousElbow,maxElbowMicro={distance:0};
 const elbowStart=Math.max(0,(maxElbowStep.after??0)-1/240);
 for(let i=0;i<=800;i++){
  const after=elbowStart+i/96000;if(after>(maxElbowStep.after??0)+1/240)break;
  const elbow=at(after).pose.elbows[maxElbowStep.index??0];
  if(previousElbow){const distance=V(elbow).distanceTo(V(previousElbow));if(distance>maxElbowMicro.distance)maxElbowMicro={distance,after};}previousElbow=elbow;
 }
 const record={case:c,actualDirection:shot.direction,t:shot.t,animationTime:shot.animationTime,part:shot.contactPart,captureJump,maxBallStep,maxElbowStep,maxMicro,maxHandAngle,maxHandMicro,maxElbowMicro,minSkin,minGap,maxGloveGap,samples};records.push(record);console.log(JSON.stringify({...record,samples:undefined}));}
 const failures=records.filter(r=>![r.captureJump,r.maxBallStep.distance,r.maxElbowStep.distance,r.maxMicro.distance,r.maxHandAngle.angle,r.maxHandMicro.angle,r.maxElbowMicro.distance,r.minGap.gap,r.minSkin.y,r.maxGloveGap.gap].every(Number.isFinite)||r.captureJump>1e-8||r.maxElbowStep.distance>=.04||r.maxElbowMicro.distance>Math.max(.00005,r.maxElbowStep.distance*.01)||r.maxMicro.distance>Math.max(.00005,r.maxBallStep.distance*.01)||r.maxHandMicro.angle>Math.max(.0005,r.maxHandAngle.angle*.01)||r.minGap.gap<-.005||r.minSkin.y<-.005||r.maxGloveGap.gap>.002).map(r=>({case:r.case,captureJump:r.captureJump,maxBallStep:r.maxBallStep,maxElbowStep:r.maxElbowStep,maxMicro:r.maxMicro,maxHandAngle:r.maxHandAngle,maxHandMicro:r.maxHandMicro,maxElbowMicro:r.maxElbowMicro,bodyGap:r.minGap.gap,skinMinimum:r.minSkin.y,gloveGap:r.maxGloveGap.gap}));
 failures.push(...cohortChanges);
 if(explicitFixtures&&records.length!==explicitFixtures.expectedCaptures)failures.push({reason:'Explicit caught cohort changed',expected:explicitFixtures.expectedCaptures,actual:records.length});
 await write('actual-holding-240hz',{hz:240,geometryHz:60,duration:2.8,records,gate:{cases:records.length,bodyFloorTolerance:.005,gloveTolerance:.002,elbowStepTolerance:.04,ballStepPolicy:'reported speed; continuity uses timestep refinement rather than a blanket displacement cap',microstepRatio:.01,ballMicroFloor:.00005,handMicroFloorRadians:.0005,continuityScope:'240Hz displacement plus96000Hz refinement near measured worst intervals; not a global velocity or acceleration bound',failures}});
 if(process.argv.includes('--check')&&failures.length){console.error(JSON.stringify({heldClearanceFailures:failures},null,2));process.exitCode=1;}
}
if(mode==='ground'){
 await setup();const specs=[];for(const d of[-1,0,1])for(const h of[.3,1.2,2.3])specs.push({label:{d,h,speed:85,reach:85,stretch:0},fn:t=>goalkeeperPose(stats,d,t,h),duration:4});for(const speed of[50,99])for(const d of[-1,1])for(const h of[.3,2.3])for(const stretch of[0,1])specs.push({label:{d,h,speed,reach:speed,stretch},fn:t=>goalkeeperPose({speed,reach:speed,stretch},d,t,h),duration:4});specs.push({label:'warmup',fn:keeperWarmupPose,duration:12});for(const d of[-1,1])specs.push({label:{motion:'held',d},fn:t=>holdingPose(goalkeeperPose(stats,d,t,2)).pose,duration:4});
 const records=[];for(const spec of specs){let worst={y:Infinity};for(let f=0;f<=spec.duration*60;f++){const t=f/60,skin=skinMin(geometry(spec.fn(t)));if(skin.y<worst.y)worst={...skin,t};}const row={label:spec.label,hz:60,...worst};records.push(row);console.log(JSON.stringify(row));}await write('ground-skin',{records});
}

if(JSON.stringify(await hashes())!==JSON.stringify(sourceSha256))throw Error("Source changed during audit; results are invalid, rerun on a frozen checkout");

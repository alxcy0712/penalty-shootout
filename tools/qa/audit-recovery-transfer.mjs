// Production-skin recovery support audit. Geometric contact is not force balance.
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Vector3,Triangle} from 'three';
import {goalkeeperPose} from '../../src/anatomy.js';
import {keeperHandRotation} from '../../src/keeper-contact.js';
import {Shot} from '../../src/engine.js';
import {loadCharacter} from '../../tests/helpers/load-character.js';

const patchCache=new WeakMap();
export function bootPatches(actor,pose){
 let patches=patchCache.get(actor);
 if(!patches){patches=[];actor.root.traverse(mesh=>{
  if(!mesh.isSkinnedMesh||mesh.material.name!=='Boots')return;
  const rest=Array.from({length:mesh.geometry.attributes.position.count},(_,i)=>new Vector3().fromBufferAttribute(mesh.geometry.attributes.position,i).applyMatrix4(mesh.bindMatrix));
  for(const side of['L','R'])for(const region of['heel','forefoot']){
   const faces=[];
   for(let f=0;f<mesh.geometry.index.count;f+=3){const ids=[0,1,2].map(k=>mesh.geometry.index.getX(f+k)),points=ids.map(i=>rest[i]);
    if(!points.every(p=>p.y<.033&&(side==='L'?p.x<0:p.x>0)))continue;
    const center=new Triangle(...points).getMidpoint(new Vector3());
    if(region==='heel'?center.z<.015:center.z>.11)faces.push(ids);
   }
   if(!faces.length)throw Error('No original bottom boot triangles for '+side+'/'+region);
   patches.push({mesh,side,region,faces});
  }
 });patchCache.set(actor,patches);}
 actor.pose(pose);actor.root.updateMatrixWorld(true);
 return patches.map(({mesh,side,region,faces})=>{
  mesh.skeleton.update();let minimum=Infinity,maximum=-Infinity,area=0,mean=0;const normal=new Vector3();
  for(const ids of faces){const points=ids.map(i=>mesh.applyBoneTransform(i,new Vector3().fromBufferAttribute(mesh.geometry.attributes.position,i)).applyMatrix4(mesh.matrixWorld)),triangle=new Triangle(...points),a=triangle.getArea();
   minimum=Math.min(minimum,...points.map(p=>p.y));maximum=Math.max(maximum,...points.map(p=>p.y));area+=a;mean+=triangle.getMidpoint(new Vector3()).y*a;normal.addScaledVector(triangle.getNormal(new Vector3()),a);
  }
  normal.normalize();return{side,region,triangles:faces.length,minimum,maximum,mean:mean/area,normal:normal.toArray(),tilt:Math.acos(Math.max(-1,Math.min(1,-normal.y))),sideRoll:Math.abs(Math.atan2(normal.x,-normal.y))};
 });
}
export function recoveryOrigin(height,stretch=0){
 const high=Math.max(0,Math.min(1,(height-.35)/1.7)),vy=.7+high*(2.1+1.1*stretch);
 return .13+(vy+Math.sqrt(vy*vy+2*9.81*(.83-.305)))/9.81+.28;
}
export function wristContinuity(){
 const records=[],failures=[];let maximumFrame={angle:0},maximumRefined={angle:0};
 for(const ability of[61,97])for(const direction of[-1,1])for(const height of[.3,1.2,2.3])for(const stretch of[0,.5,1]){
  const stats={speed:ability,reach:ability,stretch},origin=recoveryOrigin(height,stretch),record={ability,direction,height,stretch,frameSamples:0,refinedSamples:0,maximumFrame:0,maximumRefined:0};
  for(const[hz,start,end,kind]of[[240,0,4,'Frame'],[2000,origin+.50,origin+1.50,'Refined']]){
   let previous;
   for(let i=Math.ceil(start*hz);i<=Math.floor(end*hz);i++){
    const time=i/hz,pose=goalkeeperPose(stats,direction,time,height),rotations=[0,1].map(k=>keeperHandRotation(pose,k));record[kind==='Frame'?'frameSamples':'refinedSamples']++;
    if(previous)for(let k=0;k<2;k++){const angle=rotations[k].angleTo(previous[k]);record['maximum'+kind]=Math.max(record['maximum'+kind],angle);const detail={angle,ability,direction,height,stretch,time,hand:k};if(kind==='Frame'&&angle>maximumFrame.angle)maximumFrame=detail;if(kind==='Refined'&&angle>maximumRefined.angle)maximumRefined=detail;}
    previous=rotations;
   }
  }
  if(record.maximumFrame>=.16)failures.push({kind:'existing240HzHandGate',...record});
  if(record.maximumRefined>=.16*240/2000)failures.push({kind:'rateScaledRefinement',...record});
  records.push(record);
 }
 return {cases:records.length,maximumFrame,maximumRefined,records,failures};
}
export function parrySupport(actor){
 const stats={accuracy:90,power:90,touch:90,composure:90,speed:85,reach:90,handling:95},shot=new Shot({x:2.5,power:.65,y:1.3},stats,stats,1,23);
 for(let n=0;n<6000&&!shot.result;n++)shot.step(1/120,shot.playbackRate());
 if(!shot.result||shot.caught)throw Error('Pinned long-parry support fixture changed outcome');
 const records=[];
 for(const after of[.001,.01,.025,.05,.10,.15,.20]){
  const time=shot.animationTime+after,pose=shot.poseAt(time),patches=bootPatches(actor,pose),minima={};
  actor.root.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;mesh.skeleton.update();const{position,skinIndex,skinWeight}=mesh.geometry.attributes;
   for(let i=0;i<position.count;i++){let weight=0,bone;for(let k=0;k<4;k++)if(skinWeight.getComponent(i,k)>weight){weight=skinWeight.getComponent(i,k);bone=mesh.skeleton.bones[skinIndex.getComponent(i,k)].name;}
    const point=mesh.applyBoneTransform(i,new Vector3().fromBufferAttribute(position,i)).applyMatrix4(mesh.matrixWorld);minima[bone]=Math.min(minima[bone]??Infinity,point.y);
   }
  });
  records.push({after,time,wrist:pose.hands[1],brace:pose.torso.braceR,feet:pose.feet,skinMinimum:Math.min(...Object.values(minima)),partMinimum:minima,patches});
 }
 return records;
}
export async function recoveryTransferAudit(){
 const actor=await loadCharacter(true),support=[],failures=[];
 for(const ability of[61,97])for(const direction of[-1,1])for(const height of[.3,1.2,2.3])for(const phase of[.7,.9,1.1,1.35,1.7]){
  const pose=goalkeeperPose({speed:ability,reach:ability},direction,recoveryOrigin(height)+phase,height),patches=bootPatches(actor,pose);
  const record={ability,direction,height,phase,hip:pose.hip,feet:pose.feet,patches};support.push(record);
  if(patches.some(p=>p.minimum<-.005))failures.push({kind:'bootPatchFloor',...record});
  if(phase>=1.1&&patches.some(p=>p.sideRoll>.01||p.minimum<0||p.minimum>.010))failures.push({kind:'settledBootPatch',...record});
  if(phase===.7&&patches.filter(p=>p.side===(direction>0?'R':'L')).some(p=>p.sideRoll>.01||p.minimum<0||p.minimum>.010))failures.push({kind:'firstBootBeforeSecond',...record});
 }
 const continuity=wristContinuity(),parry=parrySupport(actor);failures.push(...continuity.failures);
 for(const r of parry){if(r.skinMinimum<-.005)failures.push({kind:'parrySkinFloor',...r});if(r.brace>.5&&r.wrist.y<.03)failures.push({kind:'taggedWristMinimum',...r});}
 const first=parry[0];if(first.brace<.999||first.wrist.y>=.065||first.partMinimum.handR<0||first.partMinimum.handR>.009||Math.min(first.partMinimum.footL,first.partMinimum.footR)>.009)failures.push({kind:'pinnedRealBrace',...first});
 return{status:failures.length?'failed':'passed',scope:'36 ability/direction/height/stretch paths at240 Hz, unloading at2000 Hz; actual CPU-skinned bottom boot regions and exact tagged parry support. Original bottom triangles include low stud geometry; no force/pressure or continuous collision proof.',continuity,support,parry,failures};
}
const main=process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href;
if(main){
 const args=process.argv.slice(2),at=args.indexOf('--out'),out=resolve(at>=0?args[at+1]:'/tmp/recovery-transfer-audit.json'),root=new URL('../../',import.meta.url);
 const files=(await readdir(new URL('src/',root))).filter(f=>f.endsWith('.js')).sort();
 const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(new URL('src/'+f,root))).digest('hex')])));
 const sourceHashes=await hashes(),report=await recoveryTransferAudit(),after=await hashes();if(JSON.stringify(after)!==JSON.stringify(sourceHashes))throw Error('Runtime changed during audit; rerun on frozen source');
 await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify({...report,sourceHashes},null,2)+'\n');console.log(JSON.stringify({out,status:report.status,cases:report.continuity.cases,maximumFrame:report.continuity.maximumFrame,maximumRefined:report.continuity.maximumRefined,failures:report.failures}));if(args.includes('--check')&&report.failures.length)process.exitCode=1;
}

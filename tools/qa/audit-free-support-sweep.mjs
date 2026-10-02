// Expanded deterministic free-save skin/support sweep. Geometric support is not force balance.
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {Vector3,Triangle} from 'three';
import {keeperHandRotation} from '../../src/keeper-contact.js';
import {keeperContactData} from '../../src/keeper-contact-data.js';
import {goalkeeperPose,body} from '../../src/anatomy.js';
import {loadCharacter,skinMinimum} from '../../tests/helpers/load-character.js';
const out=resolve(process.argv[2]??'/tmp/penalty-ten-rounds/round-4');await mkdir(out,{recursive:true});
const files=[...(await readdir(new URL('../../src/',import.meta.url))).filter(f=>f.endsWith('.js')).sort().map(f=>'src/'+f),'assets/characters/keeper-prototype.glb','tests/helpers/load-character.js','tools/qa/audit-free-support-sweep.mjs'];
const hash=async()=>Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(new URL('../../'+f,import.meta.url))).digest('hex')]))),sourceHashes=await hash();
const actor=await loadCharacter(true),records=[],failures=[],distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);let skinSamples=0,jointSamples=0;
for(const ability of [61,79,97])for(const direction of [-1,0,1])for(const height of [.31,1.19,2.29]){
 const stats={speed:ability,reach:ability},record={ability,direction,height,minimumSkin:Infinity,maxSupportDrift:0,maxBraceBlendWristTravel:0,maxBoneError:0,maxJointStep:0,braceSamples:0,settledSupportSamples:0,unloadingSamples:0,minimumBootAtUnloading:Infinity,maximumBootAtUnloading:-Infinity,minimumGloveAtUnloading:Infinity,maximumGloveAtUnloading:-Infinity,minimumPalmAtUnloading:Infinity,maximumPalmAtUnloading:-Infinity,maximumPalmMeanAtUnloading:-Infinity,maximumBothBootsAtUnloading:-Infinity},planted={},tagStart={};let previous;
 const vy=.7+Math.max(0,Math.min(1,(height-.35)/1.7))*2.1,landing=.13+(vy+Math.sqrt(vy*vy+2*9.81*(.83-.305)))/9.81;
 for(let f=0;f<=480;f++){
  const time=f/120,p=goalkeeperPose(stats,direction,time,height);jointSamples++;
  for(let i=0;i<2;i++){
   for(const [a,b,length]of [[p.hips[i],p.knees[i],body.thigh],[p.knees[i],p.feet[i],body.shin],[p.shoulders[i],p.elbows[i],body.upperArm],[p.elbows[i],p.hands[i],body.forearm]])record.maxBoneError=Math.max(record.maxBoneError,Math.abs(distance(a,b)-length));
   if((p.torso?.[i?'braceR':'braceL']??0)>.999){record.braceSamples++;tagStart[i]??={...p.hands[i]};record.maxBraceBlendWristTravel=Math.max(record.maxBraceBlendWristTravel,distance(tagStart[i],p.hands[i]));}
   // The existing full-contact interval precedes unloading; brace is an orientation blend, not a contact flag.
   if(direction!==0&&i===(direction>0?1:0)&&time>=landing+.30&&time<=landing+.70){record.settledSupportSamples++;if(planted[i])record.maxSupportDrift=Math.max(record.maxSupportDrift,distance(planted[i],p.hands[i]));else planted[i]={...p.hands[i]};}
  }
  if(previous)for(const key of ['hands','elbows','knees','feet'])for(let i=0;i<2;i++)record.maxJointStep=Math.max(record.maxJointStep,distance(previous[key][i],p[key][i]));
  if(f%4===0){actor.pose(p);record.minimumSkin=Math.min(record.minimumSkin,skinMinimum(actor.root));skinSamples++;
   const supportIndex=direction>0?1:0;if(direction!==0&&(p.torso?.[supportIndex?'braceR':'braceL']??0)>.999&&p.hands[supportIndex].y>.045){
    const point=new Vector3();let boot=Infinity,glove=Infinity;const boots=[Infinity,Infinity];actor.root.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;const{position,skinIndex,skinWeight}=mesh.geometry.attributes;for(let j=0;j<position.count;j++){let w=0,g=0;const fw=[0,0];for(let k=0;k<4;k++){const bone=mesh.skeleton.bones[skinIndex.getComponent(j,k)].name;if(/^foot[LR]$/.test(bone)){w+=skinWeight.getComponent(j,k);fw[bone==='footR'?1:0]+=skinWeight.getComponent(j,k);}if(bone===(supportIndex?'handR':'handL'))g+=skinWeight.getComponent(j,k);}if(w<.9&&g<.9)continue;point.fromBufferAttribute(position,j);mesh.applyBoneTransform(j,point).applyMatrix4(mesh.matrixWorld);if(w>=.9)boot=Math.min(boot,point.y);if(g>=.9)glove=Math.min(glove,point.y);for(let b=0;b<2;b++)if(fw[b]>=.9)boots[b]=Math.min(boots[b],point.y);}});record.unloadingSamples++;record.maximumBothBootsAtUnloading=Math.max(record.maximumBothBootsAtUnloading,...boots);
    const surface=keeperContactData.hulls[supportIndex?'handR':'handL'].surface,rotation=keeperHandRotation(p,supportIndex),wrist=new Vector3().copy(p.hands[supportIndex]);let palm=Infinity,area=0,mean=0;
    for(let q=0;q<surface.indices.length;q+=3){const local=surface.indices.slice(q,q+3).map(i=>new Vector3().fromArray(surface.vertices[i])),tri=new Triangle(...local),center=tri.getMidpoint(new Vector3()),normal=tri.getNormal(new Vector3());if(center.y<=.055||center.y>=.125||Math.abs(center.x-(supportIndex?-.018:.018))>=.04||center.z<=.004||normal.z<=.5)continue;const posed=local.map(v=>v.applyQuaternion(rotation).add(wrist)),triangle=new Triangle(...posed),a=triangle.getArea();palm=Math.min(palm,...posed.map(v=>v.y));area+=a;mean+=triangle.getMidpoint(new Vector3()).y*a;}
    if(!(area>0)||![palm,mean/area,boot,glove,...boots].every(Number.isFinite))failures.push({kind:'invalid-support-sampling',ability,direction,height,time,area,palm,boot,glove});
    record.minimumPalmAtUnloading=Math.min(record.minimumPalmAtUnloading,palm);record.maximumPalmAtUnloading=Math.max(record.maximumPalmAtUnloading,palm);record.maximumPalmMeanAtUnloading=Math.max(record.maximumPalmMeanAtUnloading,mean/area);
    record.minimumGloveAtUnloading=Math.min(record.minimumGloveAtUnloading,glove);record.maximumGloveAtUnloading=Math.max(record.maximumGloveAtUnloading,glove);record.minimumBootAtUnloading=Math.min(record.minimumBootAtUnloading,boot);record.maximumBootAtUnloading=Math.max(record.maximumBootAtUnloading,boot);if(boot>.009)failures.push({kind:'no-grounded-boot-at-palm-unload',ability,direction,height,time,boot});
   }
  }
  previous=p;
 }
 let microPrevious=goalkeeperPose(stats,direction,0,height);record.maxMillisecondStep=0;for(let ms=1;ms<=4000;ms++){const p=goalkeeperPose(stats,direction,ms/1000,height);for(const key of ['hands','elbows','knees','feet'])for(let i=0;i<2;i++)record.maxMillisecondStep=Math.max(record.maxMillisecondStep,distance(microPrevious[key][i],p[key][i]));microPrevious=p;}if(record.maxMillisecondStep>=.022)failures.push({kind:'existing-millisecond-continuity-gate',...record});
 const expected=goalkeeperPose(stats,direction,1.137,height);for(const hz of [30,60,120]){for(let f=0;f<=4*hz;f++)goalkeeperPose(stats,direction,f/hz,height);assert.deepEqual(goalkeeperPose(stats,direction,1.137,height),expected);}
 if(!Number.isFinite(record.minimumSkin)||record.minimumSkin<-.005)failures.push({kind:'floor',...record});
 if(direction!==0&&record.unloadingSamples<1)failures.push({kind:'missing-unloading-window',...record});
 if(direction!==0&&record.settledSupportSamples<40)failures.push({kind:'missing-settled-support-window',...record});
 if(record.maxSupportDrift>1e-8)failures.push({kind:'support-drift',...record});
 if(record.maxBoneError>1e-8)failures.push({kind:'bone-length',...record});
 records.push(record);
}
assert.deepEqual(await hash(),sourceHashes);const report={status:failures.length?'failed':'passed',sourceHashes,cases:records.length,skinSamples,jointSamples,records,failures,scope:'120Hz joint and30Hz actual-skin free-save paths, fixed brace position and limb lengths. No load-force, full triangle-crossing, browser or device proof.'};await writeFile(out+'/free-support-summary.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({out,status:report.status,cases:records.length,skinSamples,jointSamples,failures}));if(failures.length)process.exitCode=1;

#!/usr/bin/env node
// ARTIFACT_DIR=/tmp/striker-recovery node tools/qa/audit-striker-recovery.mjs
// Independent published-2314f3c clock/control, evaluated on the current skin.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {loadCharacter,skinSurfaceDistance} from '../../tests/helpers/load-character.js';
import {RECOVERY_BASELINE_COMMIT,RECOVERY_BASELINE_CLIPS,sampleRecoveryBaseline} from '../../tests/helpers/recovery-baseline.js';
import {penaltyStyles} from '../../src/anatomy.js';
import {recoveryAfterTime,RECOVERY_SOURCE_TAIL} from '../../src/striker-recovery-clock.js';
import {makeBootSamples,samplePoints} from './audit-runup-onset.mjs';

export function recoveryClipFingerprint(clip){
  const hash=createHash('sha256');hash.update(clip.name);hash.update(String(clip.duration));
  for(const track of clip.tracks){hash.update(track.name);hash.update(String(track.getInterpolation()));hash.update(new Uint8Array(track.times.buffer,track.times.byteOffset,track.times.byteLength));hash.update(new Uint8Array(track.values.buffer,track.values.byteOffset,track.values.byteLength));}
  return hash.digest('hex');
}
export function recoverySkin(actor){
  actor.root.updateMatrixWorld(true);const values=[],point=new THREE.Vector3();
  actor.root.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;mesh.skeleton.update();for(let i=0;i<mesh.geometry.attributes.position.count;i++){point.fromBufferAttribute(mesh.geometry.attributes.position,i);mesh.applyBoneTransform(i,point).applyMatrix4(mesh.matrixWorld);values.push(point.x,point.y,point.z);}});
  return values;
}
export function recoverySkinError(a,b){
  if(a.length!==b.length)throw Error('Cannot compare skins with different vertex counts');
  let maximum=0;for(let i=0;i<a.length;i+=3)maximum=Math.max(maximum,Math.hypot(a[i]-b[i],a[i+1]-b[i+1],a[i+2]-b[i+2]));return maximum;
}
function points(actor,boots){
  actor.root.updateMatrixWorld(true);const result=samplePoints(actor,boots);
  for(const name of ['handL','handR'])result[name]=actor.root.getObjectByName(name).getWorldPosition(new THREE.Vector3());return result;
}
export async function auditStrikerRecovery(){
  const actor=await loadCharacter(),baseline=await loadCharacter(),boots=makeBootSamples(actor),baseBoots=makeBootSamples(baseline),records=[];
  const clipFingerprints=Object.fromEntries(actor.actions.filter(a=>a.getClip().name in RECOVERY_BASELINE_CLIPS).map(a=>[a.getClip().name,recoveryClipFingerprint(a.getClip())]));
  for(const [styleIndex,style]of penaltyStyles.entries()){
    const contact=style.capture?.contactSeconds??1.8467,duration=style.capture?.durationSeconds??3.5,end=duration-contact,start=end-RECOVERY_SOURCE_TAIL,finish=end+RECOVERY_SOURCE_TAIL,options={style,targetX:0,power:.7};
    let earlySkinError=0,tailSkinError=0,minimumSkinY=Infinity,endpointSkinError=0,maxClockSpeed=0,minClockSpeed=Infinity,previousClock;
    for(const phase of [0,.01,.12,.4,.7,.9,1]){
      actor.kick(phase,null,options);sampleRecoveryBaseline(baseline,phase,null,options);
      earlySkinError=Math.max(earlySkinError,recoverySkinError(recoverySkin(actor),recoverySkin(baseline)));
    }
    for(const after of [0,.02,.10,.22,.40,.60,1,start]){
      actor.kick(1,after,options);sampleRecoveryBaseline(baseline,1,after,options);
      earlySkinError=Math.max(earlySkinError,recoverySkinError(recoverySkin(actor),recoverySkin(baseline)));
    }
    actor.kick(1,0,options);const contactError=Math.abs(skinSurfaceDistance(actor.root,new THREE.Vector3(0,.11,11),'Boots')-.11);
    for(let frame=0;frame<=Math.ceil((finish-start+.05)*240);frame++){
      const after=start+frame/240,mapped=recoveryAfterTime(after,contact,duration);
      if(previousClock!==undefined){const speed=(mapped-previousClock)*240;minClockSpeed=Math.min(minClockSpeed,speed);maxClockSpeed=Math.max(maxClockSpeed,speed);}previousClock=mapped;
      actor.kick(1,after,options);sampleRecoveryBaseline(baseline,1,mapped,options);
      if(frame%4===0){const skin=recoverySkin(actor);tailSkinError=Math.max(tailSkinError,recoverySkinError(skin,recoverySkin(baseline)));for(let i=1;i<skin.length;i+=3)minimumSkinY=Math.min(minimumSkinY,skin[i]);}
    }
    actor.kick(1,finish,options);sampleRecoveryBaseline(baseline,1,end,options);
    endpointSkinError=recoverySkinError(recoverySkin(actor),recoverySkin(baseline));
    const finishSpeeds={};
    for(const hz of [30,60,120]){
      actor.kick(1,finish-1/hz,options);const a=points(actor,boots);actor.kick(1,finish,options);const b=points(actor,boots);
      sampleRecoveryBaseline(baseline,1,end-1/hz,options);const c=points(baseline,baseBoots);sampleRecoveryBaseline(baseline,1,end,options);const d=points(baseline,baseBoots);
      finishSpeeds[hz]=Object.fromEntries(Object.keys(a).map(name=>[name,{baseline:c[name].distanceTo(d[name])*hz,candidate:a[name].distanceTo(b[name])*hz}]));
    }
    records.push({styleIndex,name:style.name,sourceContact:contact,sourceDuration:duration,startAfter:start,baselineEndAfter:end,candidateEndAfter:finish,earlySkinError,tailSkinError,endpointSkinError,minimumSkinY,contactError,minClockSpeed,maxClockSpeed,finishSpeeds});
  }
  return {baselineCommit:RECOVERY_BASELINE_COMMIT,baselineMethod:'Independent frozen clock and kick adapter from published 2314f3c, on the current decoded skin with shared deformation helpers. The adapter never calls current GameCharacter.kick or gameKickTime. Source fingerprints are frozen independently.',scope:'Offline actual CPU-skinned geometry, not browser screenshots or mobile/GPU timings.',tailSourceSeconds:RECOVERY_SOURCE_TAIL,clipFingerprints,expectedClipFingerprints:RECOVERY_BASELINE_CLIPS,records};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const report=await auditStrikerRecovery();report.hashes={};
  for(const name of ['src/game-character.js','src/striker-recovery-clock.js','src/striker-kick-style.js','src/striker-arm-clearance.js','tests/helpers/recovery-baseline.js','assets/characters/striker-mocap.glb','assets/characters/mocap-variants/cmu-10_03-kick.glb'])report.hashes[name]=createHash('sha256').update(await readFile(new URL('../../'+name,import.meta.url))).digest('hex');
  const out=resolve(process.env.ARTIFACT_DIR??'validation/artifacts/striker-recovery');await mkdir(out,{recursive:true});await writeFile(join(out,'recovery-audit.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({output:join(out,'recovery-audit.json'),...report},null,2));
}

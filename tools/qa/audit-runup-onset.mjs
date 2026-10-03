#!/usr/bin/env node
// Evaluate an early clock remap on the unchanged production skeleton/skin.
// ARTIFACT_DIR=/tmp/runup-onset node tools/qa/audit-runup-onset.mjs
// Frozen pre-onset clock vs current production runtime; no asset modifications.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {loadCharacter,skinSurfaceDistance} from '../../tests/helpers/load-character.js';
import {penaltyStyles} from '../../src/anatomy.js';
import {gameKickTime} from '../../src/game-character.js';

import {RUNUP_ONSET_WINDOW,runupOnsetTime,runupHeading} from '../../src/striker-runup-style.js';
export const ONSET_WINDOW=RUNUP_ONSET_WINDOW;
export const onsetElapsedTime=runupOnsetTime;

// Intentional frozen baseline (1b1230e): the former positive-start game clock.
// Keep calibration/profile values here frozen: comparing the new runtime
// against itself could otherwise hide a source-clock regression.
const BASELINE_CONTACT=1.8467,BASELINE_STRIKE_DURATION=.35;
const BASELINE_PROFILES={
  direct:{start:1.08,pace:[[0,1],[.60,1],[.88,1],[1,null]]},
  measured:{start:.96,pace:[[0,.55],[.28,.72],[.62,1.35],[.88,1.60],[1,null]]},
  stutter:{start:1,pace:[[0,1.5],[.22,1.5],[.36,.20],[.48,.20],[.69,1.6],[.88,1.2],[1,null]]},
};
export function baselineClipTime(elapsed,style){
  if(style.capture)return THREE.MathUtils.clamp(elapsed,0,style.capture.contactSeconds);
  if(elapsed>=style.duration)return BASELINE_CONTACT;
  const profile=BASELINE_PROFILES[style.motion??(style.steps>=6?'stutter':style.side>=.3?'measured':'direct')],duration=THREE.MathUtils.clamp(style.duration,.8,3);
  const approach=duration-BASELINE_STRIKE_DURATION,end=BASELINE_CONTACT-BASELINE_STRIKE_DURATION;
  if(elapsed>=approach)return end+(elapsed-approach);
  let area=0,terminalArea=0;
  for(let i=1;i<profile.pace.length;i++){
    const [q0,v0]=profile.pace[i-1],[q1,v1]=profile.pace[i];
    area+=(q1-q0)*(v0+(v1??0))/2;if(v1===null)terminalArea=(q1-q0)/2;
  }
  const scale=((end-profile.start)/approach-terminalArea)/area,q=Math.max(0,elapsed)/approach;let value=profile.start;
  for(let i=1;i<profile.pace.length;i++){
    const [q0,v0]=profile.pace[i-1],[q1,v1]=profile.pace[i],u=THREE.MathUtils.clamp((q-q0)/(q1-q0),0,1),a=v0*scale,b=v1===null?1:v1*scale;
    value+=approach*(q1-q0)*(a*u+(b-a)*u**4*(2.5-3*u+u*u));if(q<=q1)break;
  }
  return value;
}
export function onsetClipTime(elapsed,style){return gameKickTime(elapsed/style.duration,null,style);}
export function setOnsetPose(actor,elapsed,style,window=0){
  if(window){actor.kick(elapsed/style.duration,null,{style});}
  else{
    const clip=style.capture?.clipName??'CMU_10_01_Runup_Kick_Recovery',index=actor.actions.findIndex(a=>a.getClip().name===clip);
    actor.capture(baselineClipTime(elapsed,style),index);
    actor.root.position.set(0,0,11);actor.root.rotation.set(0,style.capture?Math.PI+(style.capture.heading??0):runupHeading(style),0);
  }
  actor.root.updateMatrixWorld(true);
}
export function makeBootSamples(actor){
  const groups={bootL:[],bootR:[]};
  actor.root.traverse(mesh=>{
    if(!mesh.isSkinnedMesh||mesh.material.name!=='Boots')return;
    const {skinIndex,skinWeight}=mesh.geometry.attributes;
    for(let i=0;i<skinIndex.count;i++){
      const weights={L:0,R:0};
      for(let j=0;j<4;j++){
        const name=mesh.skeleton.bones[skinIndex.getComponent(i,j)].name;
        if(/^(foot|toe)[LR]$/.test(name))weights[name.at(-1)]+=skinWeight.getComponent(i,j);
      }
      const side=weights.L>weights.R?'L':'R';
      if(weights[side]>.5)groups['boot'+side].push([mesh,i]);
    }
  });
  if(!groups.bootL.length||!groups.bootR.length)throw Error('Missing production boot vertices');
  return groups;
}
export function samplePoints(actor,boots){
  const points={pelvis:actor.root.getObjectByName('pelvis').getWorldPosition(new THREE.Vector3())};
  const p=new THREE.Vector3();
  for(const [key,vertices]of Object.entries(boots)){
    const center=new THREE.Vector3();
    for(const [mesh,index]of vertices){
      p.fromBufferAttribute(mesh.geometry.attributes.position,index);
      mesh.applyBoneTransform(index,p).applyMatrix4(mesh.matrixWorld);center.add(p);
    }
    points[key]=center.multiplyScalar(1/vertices.length);
  }
  return points;
}
function sequenceMetrics(samples,dt){
  return Object.fromEntries(Object.keys(samples[0]).map(key=>{
    let previousV=new THREE.Vector3(),peakAcceleration=0,peakSpeed=0;const speeds=[];
    for(let i=1;i<samples.length;i++){
      const velocity=samples[i][key].clone().sub(samples[i-1][key]).multiplyScalar(1/dt);
      const speed=velocity.length();speeds.push(speed);peakSpeed=Math.max(peakSpeed,speed);
      peakAcceleration=Math.max(peakAcceleration,velocity.distanceTo(previousV)/dt);previousV=velocity;
    }
    return[key,{firstFrameSpeed:speeds[0],peakSpeed,peakAcceleration,displacement:samples.at(-1)[key].distanceTo(samples[0][key]),speeds}];
  }));
}
export async function auditOnset(window=ONSET_WINDOW){
  const actor=await loadCharacter(),boots=makeBootSamples(actor),ball=new THREE.Vector3(0,.11,11),records=[];
  for(const [styleIndex,style]of penaltyStyles.entries()){
    const modes={};
    for(const [name,w]of[['baseline',0],['candidate',window]]){
      const byHz={};
      for(const hz of[30,60,120,240]){
        const frames=[];
        for(let f=0;f<=Math.round(.2*hz);f++){setOnsetPose(actor,f/hz,style,w);frames.push(samplePoints(actor,boots));}
        byHz[hz]=sequenceMetrics(frames,1/hz);
      }
      setOnsetPose(actor,0,style,w);const initial=samplePoints(actor,boots);
      setOnsetPose(actor,.001,style,w);const epsilon=samplePoints(actor,boots);
      const onsetSpeed=Object.fromEntries(Object.keys(initial).map(k=>[k,epsilon[k].distanceTo(initial[k])/.001]));
      modes[name]={byHz,onsetProbeSeconds:.001,onsetSpeed};
    }
    let maxPoseDifference=0,maxSourceLag=0,lateDifference=0;
    const samples=[];
    for(let f=0;f<=48;f++){
      const time=f/240;setOnsetPose(actor,time,style);const before=samplePoints(actor,boots);
      setOnsetPose(actor,time,style,window);const after=samplePoints(actor,boots);
      const delta=Object.fromEntries(Object.keys(before).map(k=>[k,after[k].distanceTo(before[k])]));
      maxPoseDifference=Math.max(maxPoseDifference,...Object.values(delta));
      const baselineSource=baselineClipTime(time,style),candidateSource=onsetClipTime(time,style,window);
      maxSourceLag=Math.max(maxSourceLag,baselineSource-candidateSource);samples.push({time,baselineSource,candidateSource,delta});
    }
    for(const remaining of[.35,.25,.125,.05,0]){
      const time=style.duration-remaining;lateDifference=Math.max(lateDifference,Math.abs(onsetClipTime(time,style,window)-baselineClipTime(time,style)));
    }
    actor.kick(1,0,{style});const actualBootContactError=Math.abs(skinSurfaceDistance(actor.root,ball,'Boots')-.11);
    records.push({styleIndex,name:style.name,window,modes,maxPoseDifference,maxSourceLag,lateDifference,actualBootContactError,samples});
  }
  return {baselineCommit:'1b1230ec27125ad020e0688b080c977c7b02f76c',method:'CPU production skeleton pelvis and mean actual boot-skin vertex world positions. First .2 seconds, finite differences including frozen previous velocity. No browser, real device or GPU timing claim.',window,bootVertices:Object.fromEntries(Object.entries(boots).map(([k,v])=>[k,v.length])),records};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const out=resolve(process.env.ARTIFACT_DIR??'validation/artifacts/runup-onset'),window=ONSET_WINDOW;await mkdir(out,{recursive:true});
  const result=await auditOnset(window);result.hashes={};
  for(const file of['src/game-character.js','src/striker-runup-style.js','src/striker-captures.js','tools/qa/audit-runup-onset.mjs','tools/qa/export-runup-onset.mjs','tests/runup-onset.test.js','assets/characters/striker-mocap.glb','assets/characters/mocap-variants/cmu-10_03-kick.glb'])result.hashes[file]=createHash('sha256').update(await readFile(new URL('../../'+file,import.meta.url))).digest('hex');
  await writeFile(join(out,'onset-audit.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result.records.map(r=>({style:r.name,window,maxPoseDifference:r.maxPoseDifference,maxSourceLag:r.maxSourceLag,lateDifference:r.lateDifference,actualBootContactError:r.actualBootContactError,baselineOnset:r.modes.baseline.onsetSpeed,candidateOnset:r.modes.candidate.onsetSpeed,at60Hz:Object.fromEntries(['baseline','candidate'].map(mode=>[mode,Object.fromEntries(Object.entries(r.modes[mode].byHz[60]).map(([k,v])=>[k,{...v,speeds:undefined}]))]))})),null,2));
}

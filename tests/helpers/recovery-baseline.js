// Independent sampling adapter frozen from published commit
// 2314f3c8c94b5f213d3c5fbf397a0dc529b19428:
// src/game-character.js and src/striker-runup-style.js.
// Never call current GameCharacter.kick/gameKickTime here: doing so would
// retime the baseline a second time and conceal integration regressions.
// Apply the unchanged arm/finish/shoulder helpers to the current decoded skin
// so intentional mesh edits do not masquerade as motion changes. Fingerprints
// below independently identify both original decoded CMU animation tracks.
import * as THREE from 'three';
import {createStrikerKickStyle} from '../../src/striker-kick-style.js';
import {createStrikerArmClearance} from '../../src/striker-arm-clearance.js';
import {updateKeeperShoulderSupport} from '../../src/keeper-skin-pose.js';

export const RECOVERY_BASELINE_COMMIT='2314f3c8c94b5f213d3c5fbf397a0dc529b19428';
export const RECOVERY_BASELINE_CLIPS={
  CMU_10_01_Runup_Kick_Recovery:'b7a07805c45e4c94f9e4d605e787918891adf024d2e23fd471829bc3b4596e5d',
  CMU_10_03_Kick:'c4f028ab75c87a1f2541d4d02af7223f5ea565d56d6f8d0f5b40e1935d62dabc',
};
const clamp=THREE.MathUtils.clamp,integral=x=>x**4*(2.5-3*x+x*x);
const profiles={direct:{start:1.08,bend:.19,pace:[[0,1],[.60,1],[.88,1],[1,null]]},measured:{start:.96,bend:0,pace:[[0,.55],[.28,.72],[.62,1.35],[.88,1.60],[1,null]]},stutter:{start:1,bend:.10,pace:[[0,1.5],[.22,1.5],[.36,.20],[.48,.20],[.69,1.6],[.88,1.2],[1,null]]}};
const profile=style=>profiles[typeof style==='string'?style:style?.motion??(style?.steps>=6?'stutter':style?.side>=.3?'measured':'direct')]??profiles.direct;
function onset(elapsed){
  if(elapsed<=0)return 0;if(elapsed>=.2)return elapsed;
  const ramp=.02,tail=.2/3,peak=(.2-tail/2)/(.2-(ramp+tail)/2),settle=.2-tail;
  if(elapsed<ramp)return ramp*peak*integral(elapsed/ramp);
  if(elapsed<settle)return peak*(elapsed-ramp/2);
  return peak*(elapsed-ramp/2)+tail*(1-peak)*integral((elapsed-settle)/tail);
}
function runupTime(phase,style){
  if(phase>=1)return 1.8467;
  const p=profile(style),duration=clamp(style?.duration??1.55,.8,3),elapsed=onset(clamp(phase,0,1)*duration),approach=duration-.35,end=1.8467-.35;
  if(elapsed>=approach)return end+(elapsed-approach);
  let area=0,terminalArea=0;
  for(let i=1;i<p.pace.length;i++){const[q0,v0]=p.pace[i-1],[q1,v1]=p.pace[i];area+=(q1-q0)*(v0+(v1??0))/2;if(v1===null)terminalArea=(q1-q0)/2;}
  const scale=((end-p.start)/approach-terminalArea)/area,q=elapsed/approach;let value=p.start;
  for(let i=1;i<p.pace.length;i++){const[q0,v0]=p.pace[i-1],[q1,v1]=p.pace[i],u=clamp((q-q0)/(q1-q0),0,1),a=v0*scale,b=v1===null?1:v1*scale;value+=approach*(q1-q0)*(a*u+(b-a)*integral(u));if(q<=q1)break;}
  return value;
}
export function baselineKickTime(runup,after=null,style=null){
  if(style?.capture){const c=style.capture;return after===null?onset(c.contactSeconds*clamp(runup,0,1)):Math.min(c.durationSeconds,c.contactSeconds+Math.max(0,after));}
  return after===null?(style?runupTime(runup,style):1.8467*clamp(runup,0,1)):Math.min(3.5,1.8467+Math.max(0,after));
}
export function sampleRecoveryBaseline(actor,runup,after=null,options={}){
  const previousMode=actor.lastMode;actor.lastMode='kick';
  actor.root.position.set(0,0,11);actor.root.rotation.set(0,Math.PI-Math.atan2(clamp(options.targetX??0,-5,5),11),0);
  if(actor.gazeBase)actor.root.getObjectByName('head').quaternion.copy(actor.gazeBase);actor.gazeBase=null;
  actor.armClearance?.restore?.();actor.kickStyle?.restore?.();actor.runupStyle?.restore?.();
  const captured=options.style?.capture,action=(captured?actor.actions.find(a=>a.getClip().name===captured.clipName):null)??actor.actions[0];
  if(previousMode!=='kick'||actor.currentKickAction!==action){actor.mixer.stopAllAction();actor.currentKickAction=action;}
  const compact=!!captured&&action.getClip().name===captured.clipName,legacy=action.getClip().name==='CMU_10_01_Runup_Kick_Recovery',sourceStyle=legacy&&!captured?options.style:null;
  action.play();action.paused=true;action.time=baselineKickTime(runup,after,compact?options.style:sourceStyle);actor.mixer.update(0);
  if(sourceStyle)actor.root.rotation.set(0,Math.PI+profile(sourceStyle).bend,0);
  if(compact)actor.root.rotation.set(0,Math.PI+(captured.heading??0),0);
  if(legacy){actor.kickStyle??=createStrikerKickStyle(actor.root);actor.kickStyle(after,options);}
  actor.armClearance??=createStrikerArmClearance(actor.root);actor.armClearance(action.time,action.getClip().name);
  actor.root.updateMatrixWorld(true);updateKeeperShoulderSupport(actor.root);
}
export function sampleCaptureBaseline(actor,time,index=0){
  actor.lastMode='capture';actor.gazeBase=null;
  actor.armClearance?.restore?.();actor.kickStyle?.restore?.();actor.runupStyle?.restore?.();actor.mixer.stopAllAction();
  actor.root.position.set(0,0,0);actor.root.rotation.set(0,0,0);
  const action=actor.actions[index];action.play();action.paused=true;action.time=clamp(time,0,action.getClip().duration);actor.mixer.update(0);
  actor.root.updateMatrixWorld(true);updateKeeperShoulderSupport(actor.root);
}

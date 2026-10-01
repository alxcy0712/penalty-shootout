import * as THREE from 'three';

const clamp=THREE.MathUtils.clamp;
const integral=x=>x**4*(2.5-3*x+x*x);

export const RUNUP_CONTACT=1.8467;
export const RUNUP_STRIKE_DURATION=.35;

// These are runtime adaptations of the same CMU performance, not new captures.
// Trim its long waiting pose; vary cadence and rigid approach heading. The
// final plant/strike runs at source speed and never pauses for a late feint.
export const runupProfiles={
  direct:{start:1.08,bend:.19,pace:[[0,1],[.60,1],[.88,1],[1,null]]},
  measured:{start:.96,bend:0,pace:[[0,.55],[.28,.72],[.62,1.35],[.88,1.60],[1,null]]},
  stutter:{start:1.00,bend:.10,pace:[[0,1.5],[.22,1.5],[.36,.20],[.48,.20],[.69,1.6],[.88,1.2],[1,null]]},
};

export function runupProfile(style){
  const name=typeof style==='string'?style:style?.motion??(style?.steps>=6?'stutter':style?.side>=.3?'measured':'direct');
  return runupProfiles[name]??runupProfiles.direct;
}

export function runupClipTime(phase,style){
  if(phase>=1)return RUNUP_CONTACT;
  const profile=runupProfile(style),duration=clamp(style?.duration??1.55,.8,3);
  const elapsed=clamp(phase,0,1)*duration,approach=duration-RUNUP_STRIKE_DURATION;
  const end=RUNUP_CONTACT-RUNUP_STRIKE_DURATION;
  if(elapsed>=approach)return end+(elapsed-approach);
  // Integrate strictly positive, C2 pace transitions. The endpoint is solved
  // analytically, so cadence changes cannot change the ball-release event.
  let area=0,terminalArea=0;
  for(let i=1;i<profile.pace.length;i++){
    const [q0,v0]=profile.pace[i-1],[q1,v1]=profile.pace[i];
    area+=(q1-q0)*(v0+(v1??0))/2;
    if(v1===null)terminalArea=(q1-q0)/2;
  }
  const scale=((end-profile.start)/approach-terminalArea)/area;
  const q=elapsed/approach;let value=profile.start;
  for(let i=1;i<profile.pace.length;i++){
    const [q0,v0]=profile.pace[i-1],[q1,v1]=profile.pace[i];
    const u=clamp((q-q0)/(q1-q0),0,1),a=v0*scale,b=v1===null?1:v1*scale;
    value+=approach*(q1-q0)*(a*u+(b-a)*integral(u));
    if(q<=q1)break;
  }
  return value;
}

// A whole captured performance can enter along a preset line without changing
// any joint deformation. Rotate rigidly around the ball, not differentially per
// ankle/pelvis: the latter introduced knee and ankle folds at extreme aims.
// Override the caller's target rotation for explicit styles. Direction controls
// ball physics, while the body keeps a stable run-up heading (as a side-foot
// taker can). Keep this heading through recovery: neither commitment nor contact
// may teleport the stance or rotate a planted support.
export function runupHeading(style){
  return Math.PI+runupProfile(style).bend;
}

export function createStrikerRunupStyle(root){
  return (_phase,_after,{style}={})=>{
    if(style)root.rotation.set(0,runupHeading(style),0);
  };
}

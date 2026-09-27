import * as THREE from 'three';
import {limb, body} from './anatomy.js';

const vector=p=>new THREE.Vector3().copy(p);
const ease=x=>{x=THREE.MathUtils.clamp(x,0,1);return x*x*x*(x*(x*6-15)+10);};

export function readKeeperVisualPose(root) {
  root.updateWorldMatrix(true,true);
  const point=name=>root.worldToLocal(root.getObjectByName(name).getWorldPosition(new THREE.Vector3()));
  const hip=point('pelvis'),shoulders=['L','R'].map(s=>point('upper_arm'+s));
  const shoulder=shoulders[0].clone().add(shoulders[1]).multiplyScalar(.5);
  const up=shoulder.clone().sub(hip).normalize(),right=shoulders[1].clone().sub(shoulders[0]).normalize();
  const forward=right.clone().cross(up).normalize();
  return {hip,shoulder,head:point('head'),up,right,forward,roll:Math.atan2(-up.x,up.y),shoulders,
    hips:['L','R'].map(s=>point('thigh'+s)),knees:['L','R'].map(s=>point('shin'+s)),feet:['L','R'].map(s=>point('foot'+s)),
    elbows:['L','R'].map(s=>point('forearm'+s)),hands:['L','R'].map(s=>point('hand'+s))};
}

// Blend physical targets and bend poles, then solve fixed bone lengths. This
// avoids sending the legs through unrelated local rotation paths during recovery.
export function blendKeeperVisualPose(from,to,weight) {
  if(weight>=1)return to;
  const w=ease(weight),mix=(a,b)=>vector(a).lerp(vector(b),w);
  const hip=mix(from.hip,to.hip),up=mix(from.up,to.up).normalize();
  const right=mix(from.right,to.right).normalize(),forward=right.clone().cross(up).normalize();
  right.crossVectors(up,forward).normalize();
  const shoulder=hip.clone().addScaledVector(up,body.torso);
  const pose={hip,shoulder,head:shoulder.clone().addScaledVector(up,.245),up,right,forward,roll:Math.atan2(-up.x,up.y),shoulders:[],hips:[],knees:[],feet:[],elbows:[],hands:[]};
  for(let i=0;i<2;i++){
    const sign=i?1:-1,sr=shoulder.clone().add(mix(vector(from.shoulders[i]).sub(vector(from.shoulder)),vector(to.shoulders[i]).sub(vector(to.shoulder)))),hr=hip.clone().addScaledVector(right,sign*body.hipWidth/2);
    const arm=limb(sr,mix(from.hands[i],to.hands[i]),mix(from.elbows[i],to.elbows[i]),body.upperArm,body.forearm);
    const leg=limb(hr,mix(from.feet[i],to.feet[i]),mix(from.knees[i],to.knees[i]),body.thigh,body.shin);
    pose.shoulders.push(sr);pose.hips.push(hr);pose.hands.push(arm.end);pose.elbows.push(arm.joint);pose.feet.push(leg.end);pose.knees.push(leg.joint);
  }
  return pose;
}

// Visual-only recovery correction. Match collision poses remain unchanged.
export function repairKeeperRecoveryPose(pose,elapsed) {
  const p=structuredClone(pose),up=vector(p.up),right=vector(p.right),forward=vector(p.forward);
  const ready=ease((elapsed-1.2)/.9);
  for(let i=0;i<2;i++){
    const sign=i?1:-1,sr=vector(p.shoulders[i]);
    const resting=sr.clone().addScaledVector(up,-.54).addScaledVector(right,sign*.015).addScaledVector(forward,.10);
    const hand=vector(p.hands[i]).lerp(resting,ready);
    const lateral=hand.clone().sub(vector(p.hip)).dot(right)*sign;
    if(lateral<.23)hand.addScaledVector(right,sign*(.23-lateral));
    const depth=hand.clone().sub(sr).dot(forward);
    const clearance=THREE.MathUtils.lerp(.26,.10,ready);
    if(depth<clearance)hand.addScaledVector(forward,clearance-depth);
    const drop=hand.clone().sub(sr).dot(up);
    if(drop>-.16)hand.addScaledVector(up,-.16-drop);
    // Keep the recovery arm in front of the torso; each elbow stays on its side.
    const pole=sr.clone().addScaledVector(right,sign*THREE.MathUtils.lerp(.40,.015,ready)).addScaledVector(up,-.30).addScaledVector(forward,THREE.MathUtils.lerp(-.20,-.18,ready));
    const arm=limb(sr,hand,pole,body.upperArm,body.forearm);
    p.hands[i]=arm.end;p.elbows[i]=arm.joint;
  }
  return p;
}

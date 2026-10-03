import * as THREE from 'three';

export const ARM_CLEARANCE_SOURCE='CMU_10_01_Runup_Kick_Recovery';
export const ARM_CLEARANCE_COMPACT_SOURCE='CMU_10_03_Kick';
const smooth=x=>{x=THREE.MathUtils.clamp(x,0,1);return x*x*x*(10+x*(-15+6*x));};
const flexionKeys=[[2.08,0],[2.20,.50],[2.40,.50],[2.50,0]];
const protractionKeys=[[1.30,0],[1.43,.15],[1.55,.15],[1.68,0]];

// Separately measured right-arm clearance windows with shoulder support enabled.
// 10_01 uses short shoulder flexion; 10_03 uses small clavicular protraction,
// counter-rotating the upper arm to retain the captured arm directions.
// Native clip seconds are essential: run-up styles have different game clocks.
// This clears visible forearm/shirt crossings, not every internal garment seam.
function sampleAngle(time,keys){
  if(time<=keys[0][0]||time>=keys.at(-1)[0])return 0;
  for(let i=1;i<keys.length;i++)if(time<=keys[i][0]){
    const [start,a]=keys[i-1],[end,b]=keys[i];return -THREE.MathUtils.clamp(a+(b-a)*smooth((time-start)/(end-start)),Math.min(a,b),Math.max(a,b));
  }
  return 0;
}
export function strikerArmClearanceAngle(time,source){return source===ARM_CLEARANCE_SOURCE?sampleAngle(time,flexionKeys):0;}
export function strikerArmProtractionAngle(time,source){return source===ARM_CLEARANCE_COMPACT_SOURCE?sampleAngle(time,protractionKeys):0;}

export function createStrikerArmClearance(root){
  const chest=root.getObjectByName('chest'),arm=root.getObjectByName('upper_armR'),clavicle=root.getObjectByName('clavicleR');
  if(!chest||!arm||!clavicle)return ()=>{};
  const saved=[arm,clavicle].map(bone=>({bone,quaternion:new THREE.Quaternion()}));
  const chestRotation=new THREE.Quaternion(),parentRotation=new THREE.Quaternion(),originalArmRotation=new THREE.Quaternion(),swing=new THREE.Quaternion(),axis=new THREE.Vector3();
  let modified=false;
  const rotation=(bone,out)=>{out.identity();for(let current=bone;current&&current!==root;current=current.parent)out.premultiply(current.quaternion);return out.normalize();};
  const apply=(time,source)=>{
    const angle=strikerArmClearanceAngle(time,source),protraction=strikerArmProtractionAngle(time,source);if(!angle&&!protraction)return;
    for(const state of saved)state.quaternion.copy(state.bone.quaternion);modified=true;
    rotation(chest,chestRotation);
    if(protraction){
      rotation(arm,originalArmRotation);rotation(clavicle.parent,parentRotation).invert();
      axis.set(0,1,0).applyQuaternion(chestRotation).applyQuaternion(parentRotation).normalize();
      clavicle.quaternion.premultiply(swing.setFromAxisAngle(axis,protraction)).normalize();
      // Protract the shoulder without swinging the recorded elbow/wrist path.
      rotation(arm.parent,parentRotation).invert();arm.quaternion.copy(parentRotation).multiply(originalArmRotation).normalize();
    }
    if(angle){
      rotation(arm.parent,parentRotation).invert();axis.set(1,0,0).applyQuaternion(chestRotation).applyQuaternion(parentRotation).normalize();
      arm.quaternion.premultiply(swing.setFromAxisAngle(axis,angle)).normalize();
    }
  };
  // Restore before sampling: AnimationMixer may skip an unchanged timestamp.
  apply.restore=()=>{if(modified)for(const state of saved)state.bone.quaternion.copy(state.quaternion);modified=false;};
  return apply;
}

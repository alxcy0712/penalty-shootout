import * as THREE from 'three';

const smooth=x=>{x=THREE.MathUtils.clamp(x,0,1);return x*x*(3-2*x);};

// The CMU clip remains the base performance. These small, contact-zero offsets
// distinguish a driven follow-through from a short chip without relabelling
// procedural adaptations as separately captured kicks.
export function kickStyleOffset(after,{power=.7,shotType='normal'}={}) {
  if(after===null||after<=0||after>=.40)return {y:0,z:0};
  const weight=smooth(after/.10)*(1-smooth((after-.18)/.22));
  const strength=THREE.MathUtils.clamp(power,0,1)-.7;
  const low=shotType==='low',chip=shotType==='chip';
  return {y:weight*((low?-.13:chip?.055:0)+strength*.045),z:weight*((chip?-.20:low?.015:0)+strength*.11)};
}

export function createStrikerKickStyle(root) {
  const pelvis=root.getObjectByName('pelvis');
  const legs=['L','R'].map(side=>({thigh:root.getObjectByName('thigh'+side),shin:root.getObjectByName('shin'+side),foot:root.getObjectByName('foot'+side),hip:new THREE.Vector3(),knee:new THREE.Vector3(),ankle:new THREE.Vector3(),thighRotation:new THREE.Quaternion(),shinRotation:new THREE.Quaternion(),footRotation:new THREE.Quaternion()}));
  if(!pelvis||legs.some(leg=>!leg.thigh||!leg.shin||!leg.foot))return ()=>{};
  const axis=new THREE.Vector3(),pole=new THREE.Vector3(),nextKnee=new THREE.Vector3(),oldDirection=new THREE.Vector3(),newDirection=new THREE.Vector3();
  const target=new THREE.Vector3(),pelvisPoint=new THREE.Vector3();
  const parentRotation=new THREE.Quaternion(),swing=new THREE.Quaternion(),temporaryRotation=new THREE.Quaternion();
  const relativeMatrix=new THREE.Matrix4(),worldPoint=new THREE.Vector3();
  const rootMatrix=(bone,out)=>{out.identity();for(let current=bone;current&&current!==root;current=current.parent){current.updateMatrix();out.premultiply(current.matrix);}return out;};
  const position=(bone,out)=>out.setFromMatrixPosition(rootMatrix(bone,relativeMatrix));
  // Compose within the character hierarchy. Decomposing world matrices then
  // cancelling a camera/display transform introduces avoidable IK roundoff.
  const rotation=(bone,out)=>{out.identity();for(let current=bone;current&&current!==root;current=current.parent)out.premultiply(current.quaternion);return out.normalize();};
  const set=(bone,start,q)=>{
    worldPoint.copy(start).applyMatrix4(rootMatrix(bone.parent,relativeMatrix).invert());bone.position.copy(worldPoint);
    rotation(bone.parent,parentRotation).invert();bone.quaternion.copy(parentRotation.multiply(q)).normalize();bone.updateMatrix();
  };
  const saved=[pelvis,...legs.flatMap(leg=>[leg.thigh,leg.shin,leg.foot])].map(bone=>({bone,position:new THREE.Vector3(),quaternion:new THREE.Quaternion(),scale:new THREE.Vector3()}));
  let modified=false;
  function solve(leg,target){
    const {thigh,shin,foot,hip,knee,ankle,thighRotation,shinRotation,footRotation}=leg;
    const a=hip.distanceTo(knee),b=knee.distanceTo(ankle);
    axis.copy(target).sub(hip);const distance=THREE.MathUtils.clamp(axis.length(),Math.abs(a-b)+.01,a+b-.008);axis.normalize();target.copy(hip).addScaledVector(axis,distance);
    pole.copy(knee).sub(hip);pole.addScaledVector(axis,-pole.dot(axis));
    if(pole.lengthSq()<1e-10)pole.set(0,0,1).addScaledVector(axis,-axis.z);
    pole.normalize();const along=(a*a-b*b+distance*distance)/(2*distance),radius=Math.sqrt(Math.max(0,a*a-along*along));
    nextKnee.copy(hip).addScaledVector(axis,along).addScaledVector(pole,radius);
    oldDirection.copy(knee).sub(hip).normalize();newDirection.copy(nextKnee).sub(hip).normalize();swing.setFromUnitVectors(oldDirection,newDirection);thighRotation.premultiply(swing);
    oldDirection.copy(ankle).sub(knee).normalize();newDirection.copy(target).sub(nextKnee).normalize();swing.setFromUnitVectors(oldDirection,newDirection);shinRotation.premultiply(swing);
    set(thigh,hip,thighRotation);set(shin,nextKnee,shinRotation);set(foot,target,footRotation);
  }
  const apply=(after,options)=>{
    const offset=kickStyleOffset(after,options),settle=after===null?0:smooth((after-1.15)/.50);
    if(Math.abs(offset.y)+Math.abs(offset.z)+settle<1e-9)return;
    for(const state of saved){state.position.copy(state.bone.position);state.quaternion.copy(state.bone.quaternion);state.scale.copy(state.bone.scale);}modified=true;
    root.updateWorldMatrix(true,true);
    for(const leg of legs){position(leg.thigh,leg.hip);position(leg.shin,leg.knee);position(leg.foot,leg.ankle);rotation(leg.thigh,leg.thighRotation);rotation(leg.shin,leg.shinRotation);rotation(leg.foot,leg.footRotation);}
    if(settle){
      // The captured crop ends during the trailing step. Finish that step rather
      // than leaving a boot suspended forever when the source clip clamps.
      const drop=.085*settle;position(pelvis,pelvisPoint);pelvisPoint.y-=drop;
      const pelvisRotation=rotation(pelvis,new THREE.Quaternion());set(pelvis,pelvisPoint,pelvisRotation);
      for(const [i,leg] of legs.entries()){
        target.copy(leg.ankle);if(i===1){
          target.y=THREE.MathUtils.lerp(target.y,.075,settle);
          oldDirection.set(0,1,0).applyQuaternion(leg.footRotation);
          newDirection.copy(oldDirection);newDirection.y=0;newDirection.normalize();
          swing.setFromUnitVectors(oldDirection,newDirection);
          temporaryRotation.copy(leg.footRotation).premultiply(swing);
          leg.footRotation.slerp(temporaryRotation,settle);
        }
        leg.hip.y-=drop;leg.knee.y-=drop;leg.ankle.y-=drop;solve(leg,target);
      }
    }else {target.copy(legs[0].ankle);target.y+=offset.y;target.z+=offset.z;solve(legs[0],target);}
  };
  // AnimationMixer skips unchanged property values on a repeated timestamp.
  // Restore the clip pose so a paused frame cannot accumulate the overlay.
  apply.restore=()=>{if(!modified)return;for(const state of saved){state.bone.position.copy(state.position);state.bone.quaternion.copy(state.quaternion);state.bone.scale.copy(state.scale);}root.updateWorldMatrix(true,true);modified=false;};
  return apply;
}

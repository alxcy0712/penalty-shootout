import * as THREE from 'three';
import {body,limb} from './anatomy.js';

const smooth=t=>{t=THREE.MathUtils.clamp(t,0,1);return t*t*t*(t*(t*6-15)+10);};
const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});

// Retain captured arm counter-swing while the shared IK supplies the actual
// approach, plant and shot-specific leg arc. Coordinates face the game ball.
export function createStrikerMotion(root){
  const arms=['R','L'].map(side=>['upper_arm','forearm','hand'].map(name=>root.getObjectByName(name+side)));
  const inverse=new THREE.Matrix4(),point=new THREE.Vector3();
  const position=bone=>{
    bone.getWorldPosition(point).applyMatrix4(inverse);
    return {x:-point.x,y:point.y,z:-point.z};
  };
  return (pose,runup,after,duration,sourceTime)=>{
    root.updateWorldMatrix(true,true);inverse.copy(root.matrixWorld).invert();
    const phase=after===null?THREE.MathUtils.clamp((runup*duration-duration+.55)/.55,0,1):1;
    const weight=.42*smooth((sourceTime-.55)/.75)*(after===null?1:1-smooth((after-.35)/.8));
    const result={...pose,hands:[],elbows:[],feet:pose.feet.map(p=>({...p})),knees:pose.knees.map(p=>({...p}))};
    for(let i=0;i<2;i++){
      const [shoulder,elbow,wrist]=arms[i].map(position),target=pose.shoulders[i];
      const offset=p=>({x:target.x+p.x-shoulder.x,y:target.y+p.y-shoulder.y,z:target.z+p.z-shoulder.z});
      const arm=limb(target,mix(pose.hands[i],offset(wrist),weight),mix(pose.elbows[i],offset(elbow),weight),body.upperArm,body.forearm);
      result.hands.push(arm.end);result.elbows.push(arm.joint);
    }
    // The GLB boot extends 23 cm from the ankle; fit its toe to the near ball
    // surface, then release that fitting as the swinging foot settles.
    const fit=.19*smooth((phase-.77)/.23)*(after===null?1:1-smooth((after-.30)/.42));
    const yaw=pose.feetYaw?.[1]??0;
    result.feet[1].x+=Math.sin(yaw)*fit;result.feet[1].z+=Math.cos(yaw)*fit;
    const leg=limb(pose.hips[1],result.feet[1],pose.knees[1],body.thigh,body.shin);
    result.knees[1]=leg.joint;result.feet[1]=leg.end;
    return result;
  };
}

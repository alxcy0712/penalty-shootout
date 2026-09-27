import * as THREE from 'three';
import {readKeeperVisualPose,blendKeeperVisualPose,repairKeeperRecoveryPose} from './keeper-visual-pose.js';
import {createKeeperArmRoll} from './keeper-arm-roll.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {goalkeeperPose,limb,body} from './anatomy.js';
import {createKeeperSkinPose} from './keeper-skin-pose.js';

// Captured dive followed by authored recovery. Match rules never sample this track.
export function createKeeperRecovery(root, mixer, clip) {
  mixer.stopAllAction();
  const captureRoot=clone(root),captureMixer=new THREE.AnimationMixer(captureRoot);
  const action=captureMixer.clipAction(clip), applyPose=createKeeperSkinPose(root);
  const bones=[];root.traverse(o=>{if(o.isBone)bones.push(o);});
  const relaxArms=createKeeperArmRoll(root);
  const captureBones=bones.map(b=>captureRoot.getObjectByName(b.name));
  const hip=new THREE.Vector3();
  function captured(t){action.enabled=true;action.play();action.paused=true;action.time=t;captureMixer.update(0);bones.forEach((bone,i)=>{bone.position.copy(captureBones[i].position);bone.quaternion.copy(captureBones[i].quaternion);});root.updateWorldMatrix(true,true);}
  captured(clip.duration);
  const end=readKeeperVisualPose(root);
  hip.copy(end.hip);
  const direction=hip.x<0?-1:1, stats={speed:85,reach:85};
  const origin=goalkeeperPose(stats,direction,1.05,2).hip;
  const offset=new THREE.Vector3(hip.x-origin.x,0,hip.z-origin.z);
  const p=new THREE.Vector3();
  const probes=[];
  root.traverse(mesh=>{
    if(!mesh.isSkinnedMesh)return;
    const groups=new Map(),skin=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight;
    for(let i=0;i<skin.count;i++){
      let slot=0;for(let k=1;k<4;k++)if(weights.getComponent(i,k)>weights.getComponent(i,slot))slot=k;
      const joint=skin.getComponent(i,slot),v=new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,i);
      if(!groups.has(joint))groups.set(joint,[]);
      groups.get(joint).push({i,v});
    }
    const selected=new Set();
    for(const group of groups.values())for(const axis of ['x','y','z'])for(const sign of [-1,1])selected.add(group.reduce((a,b)=>a.v[axis]*sign>b.v[axis]*sign?a:b).i);
    for(const i of selected)probes.push({mesh,i});
  });
  const liftDirection=new THREE.Vector3(), inverse=new THREE.Matrix4();
  function clearFloor(grounded=0){
    let min=Infinity;root.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update();});
    for(const {mesh,i} of probes){p.fromBufferAttribute(mesh.geometry.attributes.position,i);mesh.applyBoneTransform(i,p);p.applyMatrix4(mesh.matrixWorld);min=Math.min(min,p.y);}
    if(min<.006||grounded>0){const base=root.getObjectByName('root');inverse.copy(base.parent.matrixWorld).invert();liftDirection.set(0,1,0).transformDirection(inverse);base.position.addScaledVector(liftDirection,(.006-min)*(min<.006?1:grounded));root.updateWorldMatrix(true,true);}
  }

  return {
    duration:clip.duration+2.8,
    sample(time){
      if(time<=clip.duration){captured(Math.max(0,time));applyPose(readKeeperVisualPose(root));relaxArms();clearFloor();return '实拍扑救';}
      const elapsed=Math.min(2.8,time-clip.duration);
      // Sampling is independent of playback direction and frame history.
      captured(clip.duration);
      const pose=goalkeeperPose(stats,direction,1.05+elapsed,2);
      for(const key of ['hip','shoulder','head','hips','shoulders','knees','feet','elbows','hands']){
        for(const point of Array.isArray(pose[key])?pose[key]:[pose[key]]){point.x+=offset.x;point.z+=offset.z;}
      }
      const corrected=repairKeeperRecoveryPose(pose,elapsed);
      const blended=blendKeeperVisualPose(end,corrected,elapsed/.55);
      // Keep the legs long through side landing; bring the feet underneath only
      // as the torso starts to rise, avoiding a simultaneous airborne tuck.
      const tuck=THREE.MathUtils.smootherstep(elapsed,.45,1.1);
      for(let i=0;i<2;i++){
        const foot=new THREE.Vector3().copy(end.feet[i]).lerp(new THREE.Vector3().copy(corrected.feet[i]),tuck);
        foot.z-=.35*Math.sin(Math.PI*tuck);
        const pole=new THREE.Vector3().copy(blended.hips[i]).addScaledVector(new THREE.Vector3().copy(blended.forward),.65).addScaledVector(new THREE.Vector3().copy(blended.right),i?.07:-.07);
        pole.y+=.60*(1-THREE.MathUtils.smoothstep(blended.hips[i].y,.15,.55));
        pole.lerp(new THREE.Vector3().copy(end.knees[i]),1-THREE.MathUtils.smootherstep(elapsed,0,.35));
        const leg=limb(blended.hips[i],foot,pole,body.thigh,body.shin);
        blended.knees[i]=leg.joint;blended.feet[i]=leg.end;
      }
      applyPose(blended);
      root.updateWorldMatrix(true,true);
      relaxArms();
      clearFloor(THREE.MathUtils.smootherstep(elapsed,0,.35));
      return elapsed<.55?'落地缓冲 · 动捕衔接':elapsed<1.8?'收腿 · 撑地起身':'恢复预备';
    },
    stop(){action.stop();captureMixer.uncacheRoot(captureRoot);},
  };
}

import * as THREE from 'three';
import {updateKeeperShoulderSupport} from './keeper-skin-pose.js';

// Keep the shoulder's body-relative orientation and carry its roll through the
// elbow. Rebuilding shoulder roll from the elbow plane flips the upper-arm skin
// when the elbow straightens or changes bend direction.
export function createKeeperArmRoll(root) {
  const binds=new Map();
  root.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.bones.forEach((b,i)=>{
    if(!binds.has(b.name))binds.set(b.name,new THREE.Quaternion().setFromRotationMatrix(o.skeleton.boneInverses[i].clone().invert()).normalize());
  });});
  const arms=['L','R'].map(side=>{
    const relative=binds.get(`forearm${side}`).clone().invert().multiply(binds.get(`hand${side}`));
    // Keep the authored palm roll, with zero wrist flexion or sideways bend.
    const wristRoll=new THREE.Quaternion(0,relative.y,0,relative.w).normalize();
    return {forearm:root.getObjectByName(`forearm${side}`),hand:root.getObjectByName(`hand${side}`),wristRoll};
  });
  const axis=new THREE.Vector3(0,1,0),direction=new THREE.Vector3();
  const wrist=new THREE.Vector3();
  return () => {
    root.updateWorldMatrix(true,true);
    for(const {forearm,hand,wristRoll} of arms){
      hand.getWorldPosition(wrist);
      direction.copy(axis).applyQuaternion(forearm.quaternion).normalize();
      forearm.quaternion.setFromUnitVectors(axis,direction);
      forearm.updateWorldMatrix(false,true);
      // Preserve the contact point even for clips with translated child bones.
      hand.position.copy(forearm.worldToLocal(wrist));
      hand.quaternion.copy(wristRoll);
      hand.updateWorldMatrix(false,true);
    }
    updateKeeperShoulderSupport(root);
  };
}

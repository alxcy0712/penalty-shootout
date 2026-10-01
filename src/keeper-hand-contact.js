import * as THREE from 'three';
import {keeperHandRotation} from './keeper-contact.js';

// The same bind-surface-aware hand orientation is used for rendering and ball
// collision. Only wrist rotation changes; the physical wrist stays fixed.
export function createKeeperHandContact(root) {
  const hands=['L','R'].map(side=>root.getObjectByName(`hand${side}`));
  const rootRotation=new THREE.Quaternion(),parentRotation=new THREE.Quaternion();
  return pose=>{
    if(!pose)return;
    root.updateWorldMatrix(true,true);root.getWorldQuaternion(rootRotation);
    for(let i=0;i<2;i++){
      const hand=hands[i];if(!hand)continue;
      hand.parent.getWorldQuaternion(parentRotation).invert();
      hand.quaternion.copy(parentRotation).multiply(rootRotation).multiply(keeperHandRotation(pose,i));
      hand.updateWorldMatrix(false,true);
    }
  };
}

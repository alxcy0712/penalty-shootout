import * as THREE from 'three';
import {keeperHandRotation,keeperArmRotation} from './keeper-contact.js';

// Compose within the character hierarchy. Decomposing world matrices would
// mix display-parent nonuniform scale/shear into the physical palm frame.
function rootRotation(bone,root,out){
  out.identity();for(let current=bone;current&&current!==root;current=current.parent)out.premultiply(current.quaternion);return out.normalize();
}

// Rendering and ball collision share these root-local arm and palm frames.
// The supplied physical wrist is retained while settled forearm roll changes.
export function createKeeperHandContact(root) {
  const hands=['L','R'].map(side=>root.getObjectByName(`hand${side}`));
  const parentRotation=new THREE.Quaternion(),wrist=new THREE.Vector3(),inverseForearm=new THREE.Matrix4();
  // Only the authoritative pose pipeline may skip this hierarchy refresh.
  return (pose,worldCurrent=false)=>{
    if(!pose)return;
    if(!worldCurrent)root.updateWorldMatrix(true,true);
    for(let i=0;i<2;i++){
      const hand=hands[i];if(!hand)continue;
      const forearm=hand.parent,settled=pose.grip?.weight>0;
      if(settled){
        // Preserve the wrist in its upper-arm parent's coordinates; no world
        // decomposition or extra full-hierarchy refresh is needed.
        wrist.copy(hand.position).applyMatrix4(forearm.matrix);
        forearm.quaternion.copy(rootRotation(forearm.parent,root,parentRotation).invert()).multiply(keeperArmRotation(pose,i,true));
        forearm.updateMatrix();hand.position.copy(wrist.applyMatrix4(inverseForearm.copy(forearm.matrix).invert()));
      }
      hand.quaternion.copy(rootRotation(forearm,root,parentRotation).invert()).multiply(keeperHandRotation(pose,i));
      if(settled)forearm.updateWorldMatrix(false,true);else hand.updateWorldMatrix(false,true);
    }
  };
}

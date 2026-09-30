import * as THREE from 'three';

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
  const wrist=new THREE.Vector3(),normal=new THREE.Vector3(),fingers=new THREE.Vector3(),across=new THREE.Vector3();
  const matrix=new THREE.Matrix4(),orientation=new THREE.Quaternion(),parentRotation=new THREE.Quaternion();
  function turn(forearm,hand,weight){
    normal.transformDirection(root.matrixWorld);fingers.transformDirection(root.matrixWorld);
    fingers.addScaledVector(normal,-fingers.dot(normal)).normalize();across.crossVectors(fingers,normal).normalize();
    orientation.setFromRotationMatrix(matrix.makeBasis(across,fingers,normal));
    forearm.getWorldQuaternion(parentRotation);orientation.premultiply(parentRotation.invert());
    hand.quaternion.slerp(orientation,weight);
  }
  return (pose=null) => {
    root.updateWorldMatrix(true,true);
    for(const [i,{forearm,hand,wristRoll}] of arms.entries()){
      hand.getWorldPosition(wrist);
      direction.copy(axis).applyQuaternion(forearm.quaternion).normalize();
      forearm.quaternion.setFromUnitVectors(axis,direction);
      forearm.updateWorldMatrix(false,true);
      // Preserve the contact point even for clips with translated child bones.
      hand.position.copy(forearm.worldToLocal(wrist));
      hand.quaternion.copy(wristRoll);
      if(pose){
        const support=1-THREE.MathUtils.smoothstep(pose.hands[i].y,.10,.24),grip=pose.grip?.weight??0;
        if(support>0){
          normal.set(0,1,0);fingers.copy(pose.forward).setY(0);turn(forearm,hand,support);
        }
        if(grip>0){
          normal.copy(pose.grip.center).sub(pose.hands[i]);fingers.copy(pose.up);turn(forearm,hand,grip);
        }
      }
      hand.updateWorldMatrix(false,true);
    }
  };
}

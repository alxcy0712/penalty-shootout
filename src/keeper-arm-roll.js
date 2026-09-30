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
  const wrist=new THREE.Vector3(),elbow=new THREE.Vector3(),up=new THREE.Vector3(),right=new THREE.Vector3(),back=new THREE.Vector3();
  const forwardAxis=new THREE.Vector3(1,0,0),sideAxis=new THREE.Vector3(0,0,1);
  const matrix=new THREE.Matrix4(),bodyRotation=new THREE.Quaternion(),orientation=new THREE.Quaternion(),turn=new THREE.Quaternion(),parentRotation=new THREE.Quaternion();
  return (pose=null) => {
    root.updateWorldMatrix(true,true);
    if(pose){
      up.copy(pose.up).transformDirection(root.matrixWorld);right.copy(pose.right).transformDirection(root.matrixWorld);
      back.crossVectors(right,up).normalize();right.crossVectors(up,back).normalize();
      bodyRotation.setFromRotationMatrix(matrix.makeBasis(right,up,back));
    }
    for(const [i,{forearm,hand,wristRoll}] of arms.entries()){
      hand.getWorldPosition(wrist);
      direction.copy(axis).applyQuaternion(forearm.quaternion).normalize();
      forearm.quaternion.setFromUnitVectors(axis,direction);
      forearm.updateWorldMatrix(false,true);
      // Preserve the contact point even for clips with translated child bones.
      hand.position.copy(wrist);forearm.worldToLocal(hand.position);
      hand.quaternion.copy(wristRoll);
      if(pose){
        const support=1-THREE.MathUtils.smoothstep(pose.hands[i].y,.10,.24),grip=pose.grip?.weight??0;
        forearm.getWorldPosition(elbow);direction.copy(wrist).sub(elbow).normalize();
        // A small forward wrist flex keeps palm roll defined on lateral reaches.
        const side=i?-1:1,reach=Math.atan2(Math.max(.35,direction.dot(back)),direction.dot(up));
        let flex=THREE.MathUtils.lerp(reach,Math.atan2(pose.up.y,pose.up.z),support);
        let spread=Math.asin(THREE.MathUtils.clamp(direction.dot(right),-1,1))*(1-support);
        const palmRoll=side*Math.PI/2-direction.dot(right)*reach;
        let roll=THREE.MathUtils.lerp(palmRoll,side*Math.PI+Math.atan2(pose.up.x,pose.up.y),support);
        // Explicit anatomical angles retain a consistent turn direction through
        // support and grip, including orientations on either side of 180 degrees.
        flex*=1-grip;spread=THREE.MathUtils.lerp(spread,-side*Math.atan2(.045,.115),grip);
        roll=THREE.MathUtils.lerp(roll,side*Math.PI/2,grip);
        orientation.copy(bodyRotation).multiply(turn.setFromAxisAngle(forwardAxis,flex));
        orientation.multiply(turn.setFromAxisAngle(sideAxis,-spread)).multiply(turn.setFromAxisAngle(axis,roll));
        forearm.getWorldQuaternion(parentRotation);hand.quaternion.copy(orientation).premultiply(parentRotation.invert());
      }
      hand.updateWorldMatrix(false,true);
    }
  };
}

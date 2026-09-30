import * as THREE from 'three';

// Captured clips carry a straight wrist; physical keeper poses orient the palms
// toward the incoming ball, the turf on support, and the ball during a grip.
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
  const fingers=new THREE.Vector3(),across=new THREE.Vector3(),vertical=new THREE.Vector3(0,1,0);
  const matrix=new THREE.Matrix4(),bodyRotation=new THREE.Quaternion(),floorRotation=new THREE.Quaternion(),orientation=new THREE.Quaternion(),turn=new THREE.Quaternion(),wristLimit=new THREE.Quaternion(),parentRotation=new THREE.Quaternion();
  const forwardAxis=new THREE.Vector3(1,0,0),sideAxis=new THREE.Vector3(0,0,1);
  return (pose=null) => {
    root.updateWorldMatrix(true,true);
    if(pose){
      up.copy(pose.up).transformDirection(root.matrixWorld);right.copy(pose.right).transformDirection(root.matrixWorld);
      back.crossVectors(right,up).normalize();right.crossVectors(up,back).normalize();
      bodyRotation.setFromRotationMatrix(matrix.makeBasis(right,up,back));
      fingers.copy(back);fingers.y=0;fingers.normalize();across.crossVectors(vertical,fingers).normalize();
      floorRotation.setFromRotationMatrix(matrix.makeBasis(across,vertical,fingers));
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
        const support=1-THREE.MathUtils.smoothstep(pose.hands[i].y,.10,.50),grip=pose.grip?.weight??0;
        forearm.getWorldPosition(elbow);direction.copy(wrist).sub(elbow).normalize();
        const side=i?-1:1;
        let flex=Math.atan2(Math.max(.35,direction.dot(back)),Math.max(.15,direction.dot(up)+.6));
        let spread=Math.asin(THREE.MathUtils.clamp(direction.dot(right)*.85,-1,1));
        let roll=Math.atan2(Math.sin(flex)*Math.sin(spread)+side*.25*Math.cos(spread),Math.cos(flex));
        // Interpolate anatomical angles through support and grip. This selects
        // one continuous wrist path even when the two palm frames oppose.
        flex=THREE.MathUtils.lerp(THREE.MathUtils.lerp(flex,Math.PI/2,support),0,grip);
        spread=THREE.MathUtils.lerp(-spread*(1-support),side*Math.atan2(.045,.115),grip);
        roll=THREE.MathUtils.lerp(roll*(1-support),side*Math.PI/2,grip);
        orientation.copy(bodyRotation).slerp(floorRotation,support*(1-grip)).multiply(turn.setFromAxisAngle(forwardAxis,flex));
        orientation.multiply(turn.setFromAxisAngle(sideAxis,spread)).multiply(turn.setFromAxisAngle(axis,roll));
        // Tilt the fingers forward around the palm normal while wrapping the ball.
        orientation.multiply(turn.setFromAxisAngle(sideAxis,side*Math.PI/4*grip));
        fingers.copy(axis).applyQuaternion(orientation);
        const bend=fingers.angleTo(direction);
        if(bend>Math.PI/2){
          turn.setFromUnitVectors(fingers,direction);wristLimit.identity().slerp(turn,1-Math.PI/(2*bend));
          orientation.premultiply(wristLimit);
        }
        forearm.getWorldQuaternion(parentRotation);hand.quaternion.copy(orientation).premultiply(parentRotation.invert());
      }
      hand.updateWorldMatrix(false,true);
    }
  };
}

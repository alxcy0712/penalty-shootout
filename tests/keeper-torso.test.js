import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {goalkeeperPose,limb,body,holdingPose,blendKeeperPose,placeKeeperPose} from '../src/anatomy.js';
import {keeperTorsoFrames} from '../src/keeper-torso.js';
import {keeperBodyRotation,keeperArmRotation,keeperSurfaceContacts,keeperGather,keeperHandRotation} from '../src/keeper-contact.js';
import {keeperContactData} from '../src/keeper-contact-data.js';
import {Shot} from '../src/engine.js';
import {loadCharacter,skinSurfaceDistance} from './helpers/load-character.js';
const stats={speed:85,reach:85},vector=p=>new THREE.Vector3().copy(p);
function articulated(direction,time,height){
  const pose=goalkeeperPose(stats,direction,time,height);
  pose.torso={curl:.13,twist:direction*.065,sideBend:direction*.025,headCurl:.055};
  const frames=keeperTorsoFrames(pose);pose.shoulder=frames.shoulder;pose.head=frames.headPoint;
  for(const i of [0,1]){
    const root=vector(pose.shoulder).addScaledVector(vector(frames.chest.right),(i?1:-1)*body.shoulderWidth/2).addScaledVector(vector(frames.chest.back),.06);
    const pole=root.clone().addScaledVector(vector(frames.chest.right),(i?1:-1)*.4).addScaledVector(vector(frames.chest.back),.3);
    const arm=limb(root,pose.hands[i],pole,body.upperArm,body.forearm);
    pose.shoulders[i]={x:root.x,y:root.y,z:root.z};pose.elbows[i]=arm.joint;pose.hands[i]=arm.end;
  }
  return pose;
}

test('zero torso input retains the legacy landmarks and frame while active chain keeps fixed lengths',()=>{
  for(const direction of [-1,0,1])for(const t of [0,.35,.7,1.4,2.4,3.4]){
    const pose=goalkeeperPose(stats,direction,t,1.2),zero={...pose,torso:{curl:0,twist:0,sideBend:0,headCurl:0}},frames=keeperTorsoFrames(zero);
    for(const [name,distance] of [['pelvis',0],['spine',.19],['chest',.43],['neck',.51],['head',.63]])assert.ok(vector(frames[name].position).distanceTo(vector(pose.hip).addScaledVector(vector(pose.up),distance))<1e-12);
    for(const name of ['spine','chest','neck','head'])assert.ok(keeperBodyRotation(zero).angleTo(keeperBodyRotation(zero,name))<1e-7);
    const active=keeperTorsoFrames({...pose,torso:{curl:.13,twist:.065,sideBend:.025,headCurl:.055}});
    for(const [a,b,length] of [['pelvis','spine',.19],['spine','chest',.24],['chest','neck',.08],['neck','head',.12]])assert.ok(Math.abs(vector(active[a].position).distanceTo(vector(active[b].position))-length)<1e-12);
    assert.ok(vector(active.chest.up).angleTo(vector(active.pelvis.up))>.10,'chest really flexes relative to pelvis');
  }
});

test('articulated torso, arm and head contact frames match the rendered bones under a rotated parent',async()=>{
  const actor=await loadCharacter(true),parent=new THREE.Group();parent.position.set(2,.4,-3);parent.rotation.set(.13,.7,-.09);parent.scale.setScalar(1.2);parent.add(actor.root);
  for(const direction of [-1,1])for(const t of [.45,.9,1.6,2.5]){
    const pose=articulated(direction,t,1.2),snapshot=structuredClone(pose),frames=keeperTorsoFrames(pose);actor.pose(pose);
    const rootQ=actor.root.getWorldQuaternion(new THREE.Quaternion());
    for(const name of ['pelvis','spine','chest','neck','head']){
      const bone=actor.root.getObjectByName(name),position=bone.getWorldPosition(new THREE.Vector3()),rotation=bone.getWorldQuaternion(new THREE.Quaternion()).normalize();
      assert.ok(position.distanceTo(actor.root.localToWorld(vector(frames[name].position)))<1e-6,`${name} shared origin`);
      assert.ok(rotation.angleTo(rootQ.clone().multiply(keeperBodyRotation(pose,name)).normalize())<1e-6,`${name} shared rotation`);
    }
    for(const i of [0,1])for(const [name,position,rotation] of [[`upper_arm${i?'R':'L'}`,pose.shoulders[i],keeperArmRotation(pose,i)],[`forearm${i?'R':'L'}`,pose.elbows[i],keeperArmRotation(pose,i,true)]]){
      const bone=actor.root.getObjectByName(name);assert.ok(bone.getWorldPosition(new THREE.Vector3()).distanceTo(actor.root.localToWorld(vector(position)))<1e-6);
      assert.ok(bone.getWorldQuaternion(new THREE.Quaternion()).normalize().angleTo(rootQ.clone().multiply(rotation).normalize())<1e-5,`${name} chest-relative roll ${direction}/${t}: ${bone.getWorldQuaternion(new THREE.Quaternion()).normalize().angleTo(rootQ.clone().multiply(rotation).normalize())}`);
    }
    const expected=actor.root.getObjectByName('head').matrixWorld.toArray();actor.pose(articulated(-direction,.3,2.3));actor.pose(pose);
    assert.deepEqual(actor.root.getObjectByName('head').matrixWorld.toArray(),expected,'random-access sampling has no accumulated curl');
    assert.deepEqual(pose,snapshot,'skin/contact cannot mutate the physical pose');
  }
});

test('articulated chest distinguishes 2 mm skin contacts and near misses with bounded collision geometry',async()=>{
  const actor=await loadCharacter(true);let checked=0;
  assert.ok(keeperContactData.hulls.torso.vertices.length<120,'candidate hull stays a small fixed set');
  assert.ok(keeperContactData.torsoPatch.vertices.length<900,'exact fallback is central torso only');
  for(const direction of [-1,1])for(const t of [.5,1.3,2.3]){
    const pose=articulated(direction,t,1.2);actor.pose(pose);actor.root.updateMatrixWorld(true);
    const front=vector(keeperTorsoFrames(pose).chest.back);
    actor.root.traverse(mesh=>{
      if(!mesh.isSkinnedMesh)return;mesh.skeleton.update();const positions=mesh.geometry.attributes.position,indices=mesh.geometry.index;
      for(let face=0;face<indices.count;face+=3){
        const ids=[0,1,2].map(k=>indices.getX(face+k)),rest=ids.map(i=>new THREE.Vector3().fromBufferAttribute(positions,i));
        if(!rest.every(p=>p.y>1.14&&p.y<1.32&&Math.abs(p.x)<.085&&p.z>.08)||face%9)continue;
        const points=ids.map(i=>mesh.applyBoneTransform(i,new THREE.Vector3().fromBufferAttribute(positions,i)).applyMatrix4(mesh.matrixWorld));
        const triangle=new THREE.Triangle(...points),normal=triangle.getNormal(new THREE.Vector3());if(normal.dot(front)<.8)continue;
        const middle=triangle.getMidpoint(new THREE.Vector3()),sample=offset=>{const center=middle.clone().addScaledVector(normal,.11+offset);return keeperSurfaceContacts(pose,center,center,.11).find(contact=>contact.part==='torso');};
        const near=middle.clone().addScaledVector(normal,.112);
        // A neighbouring cloth triangle can be nearer than this face's plane;
        // only call a 2 mm offset a miss if it is a real whole-skin miss.
        if(skinSurfaceDistance(actor.root,near)<.11199)continue;
        const hit=sample(-.002);assert.ok(hit,`torso covers its bent skin ${direction}/${t}/${face}`);
        assert.equal(sample(.002),undefined,`torso preserves the visible miss ${direction}/${t}/${face}`);
        assert.ok(skinSurfaceDistance(actor.root,hit.hit.q)<2e-6,'candidate resolves to actual weighted skin, not rigid proxy');checked++;
      }
    });
  }
  assert.ok(checked>=12,`samples actual central torso triangles: ${checked}`);
});


test('landing articulation survives placement, holding and blending and stays out of maximum reach',()=>{
  for(const direction of [-1,1])for(const height of [.3,1.2,2.3]){
    const source=goalkeeperPose(stats,direction,1.2,height),frames=keeperTorsoFrames(source),offset={x:.7,y:0,z:-.4};
    assert.ok(source.torso?.curl>0,'landing/recovery has a real shared torso descriptor');
    const placed=placeKeeperPose(source,offset),moved=keeperTorsoFrames(placed);
    assert.deepEqual(placed.torso,source.torso);
    for(const name of ['pelvis','spine','chest','neck','head'])assert.ok(vector(moved[name].position).distanceTo(vector(frames[name].position).add(vector(offset)))<1e-10,'translation carries the entire articulated chain');
    const held=holdingPose(source,.7).pose;assert.deepEqual(held.torso,source.torso);assert.deepEqual(keeperTorsoFrames(held),frames);
    const reach=goalkeeperPose(stats,direction,.3,height),blend=blendKeeperPose(source,reach,.3),weight=.3*.3*(3-2*.3);
    for(const key of ['curl','twist','sideBend','headCurl'])assert.ok(Math.abs((blend.torso?.[key]??0)-((source.torso?.[key]??0)*(1-weight)+(reach.torso?.[key]??0)*weight))<1e-12,'pose blending blends articulation rather than resetting it');
    for(const time of [0,.13,.3,4]){
      const pose=goalkeeperPose(stats,direction,time,height);assert.ok(Math.abs(pose.torso?.curl??0)<1e-10,'early reach and final stance preserve original extension');
    }
  }
});


test('capture-aware elbows keep a continuous grounded branch through the complete grasp and get-up',()=>{
  const recipes=[[-1,.3,-2,3,.55,95],[1,.3,2,3,.55,95],[-1,2.1,-1.5,2,.55,95],[1,2.1,1.5,1,.55,95],[0,.2,-1.5,42,.12,85],[0,.2,1.5,42,.12,85],[0,1.2,-1.5,42,.5,85],[0,1.2,1.5,42,.5,85],[-1,1.2,-3.3,42,.5,85],[1,1.2,3.3,42,.5,85]];
  for(const [direction,height,x,seed,power,speed] of recipes){
    const ability={accuracy:90,power:90,touch:90,composure:90,speed,reach:speed,handling:95},shot=new Shot({x,y:height,power},ability,ability,direction,seed);
    for(let frame=0;frame<3600&&!shot.result;frame++)shot.step(1/120);assert.ok(shot.caught);
    const sample=time=>keeperGather(shot.pose,shot.poseAt(shot.t+time),shot.ball,shot.contactPart,time/.44);let previous;
    for(let frame=0;frame<=672;frame++){
      const time=frame/240,result=sample(time),pose=result.pose;
      for(const i of [0,1]){
        if(previous)assert.ok(vector(pose.elbows[i]).distanceTo(vector(previous.elbows[i]))<.04,`no ground-branch elbow switch: ${direction}/${height}/${time}/${i}`);
        if(previous&&Math.abs(x)===3.3&&time>=1&&time<=1.4)assert.ok(vector(pose.elbows[i]).sub(pose.hip).distanceTo(vector(previous.elbows[i]).sub(previous.hip))*240<4,'wide mid-save get-up avoids the former 16 m/s body-relative elbow spike');
        assert.ok(pose.elbows[i].y>=.075-1e-8);
        assert.ok(Math.abs(vector(pose.elbows[i]).distanceTo(vector(pose.shoulders[i]))-.29)<1e-6);
        assert.ok(Math.abs(vector(pose.elbows[i]).distanceTo(vector(pose.hands[i]))-.27)<1e-6);
      }
      previous=pose;
    }
    const expected=sample(.158);sample(2);assert.deepEqual(sample(.158),expected,'ground branch is source-anchored, not playback-history-dependent');
  }
});


test('a catch beginning on a braced glove keeps its exact source orientation when free support is removed',()=>{
  for(const direction of [-1,1]){
    const source=goalkeeperPose(stats,direction,1.3,.3),index=direction<0?0:1,name=`hand${index?'R':'L'}`;
    const middle=vector(source.hands[index]).add(new THREE.Vector3(0,0,.095));
    const hit=keeperSurfaceContacts(source,middle.clone().add(new THREE.Vector3(0,.5,0)),middle.clone().add(new THREE.Vector3(0,-.2,0)),.11).find(contact=>contact.part===name);
    assert.ok(hit,'the braced glove has a real swept skin contact');
    const captured={x:hit.hit.p.x,y:hit.hit.p.y,z:hit.hit.p.z},current={...source,torso:{...source.torso,braceL:0,braceR:0}};
    assert.deepEqual(keeperGather(source,current,captured,name,0).ball,captured);
    const first=keeperGather(source,current,captured,name,1e-7);
    assert.ok(vector(first.ball).distanceTo(vector(captured))<1e-6,'removing the free brace does not rotate the captured sphere');
    assert.ok(keeperHandRotation(first.pose,index).angleTo(keeperHandRotation(source,index))<1e-5,'the exact braced source frame is preserved at capture');
  }
});

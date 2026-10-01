import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Shot} from '../src/engine.js';
import {keeperGather,keeperHandRotation} from '../src/keeper-contact.js';
import {keeperContactData} from '../src/keeper-contact-data.js';
import {loadCharacter,skinMinimum} from './helpers/load-character.js';

const stats={accuracy:90,power:90,touch:90,composure:90,speed:95,reach:95,handling:95};
const surfaces=['L','R'].map(side=>{const data=keeperContactData.hulls['hand'+side].surface,vertices=data.vertices.map(p=>new THREE.Vector3().fromArray(p)),faces=[];for(let i=0;i<data.indices.length;i+=3){const tri=new THREE.Triangle(...data.indices.slice(i,i+3).map(k=>vertices[k]));if(tri.getArea()>1e-12)faces.push(tri);}return faces;});
const captures=[[-1,.3,-2,3],[1,.3,2,3],[-1,2.1,-1.5,2],[1,2.1,1.5,1]].map(([direction,y,x,seed])=>{const shot=new Shot({x,y,power:.55},stats,stats,direction,seed);for(let i=0;i<3600&&!shot.result;i++)shot.step(1/120);assert.ok(shot.caught,`real catch ${direction}/${y}`);return shot;});
// Slow central scoops and the fast wrong-footed catch exercise paths not covered
// by the four wide-dive recipes. Their physical speed is checked by continuity,
// rather than mislabelling smooth travel as a branch discontinuity.
const additionalCaptures=[[-1.5,.2,.12,0],[1.5,.2,.12,0],[-1.5,1.2,.5,0]].map(([x,y,power,direction])=>{
  const ability={...stats,speed:85,reach:85},shot=new Shot({x,y,power},ability,ability,direction,42);
  for(let i=0;i<3600&&!shot.result;i++)shot.step(1/120);assert.ok(shot.caught);return shot;
});
const allCaptures=[...captures,...additionalCaptures];
const sample=(shot,time)=>keeperGather(shot.pose,shot.poseAt(shot.t+time),shot.ball,shot.contactPart,time/.44);
const vector=p=>new THREE.Vector3().copy(p);
function clearance(point,pose,index){const local=vector(point).sub(pose.hands[index]).applyQuaternion(keeperHandRotation(pose,index).invert()),near=new THREE.Vector3();let distance=Infinity;for(const tri of surfaces[index]){tri.closestPointToPoint(local,near);distance=Math.min(distance,near.distanceTo(local));}return distance-.11;}

test('capture-aware gather keeps the ball tangent to a glove without crossing the other palm',()=>{
  for(const shot of captures){let previous;
    for(let frame=0;frame<=240;frame++){
      const time=frame/240,result=sample(shot,time),ball=vector(result.ball),gaps=[0,1].map(i=>clearance(ball,result.pose,i));
      assert.ok(ball.toArray().every(Number.isFinite));assert.ok(ball.y>=.11);
      assert.ok(Math.min(...gaps)>=-.00001,'neither true glove surface penetrates the ball');
      assert.ok(Math.min(...gaps)<.00001,'the ball never floats away from both palms');
      for(let i=0;i<2;i++){
        assert.ok(Math.abs(vector(result.pose.shoulders[i]).distanceTo(vector(result.pose.elbows[i]))-.29)<1e-6);
        assert.ok(Math.abs(vector(result.pose.elbows[i]).distanceTo(vector(result.pose.hands[i]))-.27)<1e-6);
      }
      if(previous)assert.ok(ball.distanceTo(previous)<.04,'no large ball branch switch at 240Hz');
      previous=ball;
    }
  }
});

test('gather is position and first-derivative continuous at its boundaries and through the transfer',()=>{
  const epsilon=1e-5;
  for(const shot of allCaptures){
    assert.ok(vector(sample(shot,0).ball).distanceTo(vector(shot.ball))<1e-12,'capture begins at the actual physical contact');
    for(const time of [.44,...Array.from({length:400},(_,i)=>(i+1)*.002)]){
      const before=vector(sample(shot,time-epsilon).ball),at=vector(sample(shot,time).ball),after=vector(sample(shot,time+epsilon).ball);
      const incoming=at.clone().sub(before).multiplyScalar(1/epsilon),outgoing=after.sub(at).multiplyScalar(1/epsilon);
      assert.ok(incoming.distanceTo(outgoing)<.03,`velocity discontinuity at ${time}`);
    }
    const index=shot.contactPart==='handR'?1:0,offset=(state)=>vector(state.ball).sub(state.pose.hands[index]).applyQuaternion(keeperHandRotation(state.pose,index).invert());
    const initial=offset(sample(shot,0)),first=offset(sample(shot,.0001));
    assert.ok(first.distanceTo(initial)/.0001<.01,'capture starts without slipping across the grasping palm');
    const expected=sample(shot,.23);sample(shot,.8);const repeated=sample(shot,.23);
    assert.deepEqual(repeated,expected,'arbitrary-time scrubbing has no hidden history');
  }
});

test('coupled grasp matches the actual skinned hand transforms and keeps the complete mesh clear of turf',async()=>{
  const actor=await loadCharacter(true);
  for(const shot of captures)for(let frame=0;frame<=60;frame++){
    const result=sample(shot,frame/60);actor.pose(result.pose);actor.root.updateWorldMatrix(true,true);
    for(const [i,side] of ['L','R'].entries()){
      const hand=actor.root.getObjectByName('hand'+side);
      assert.ok(hand.getWorldPosition(new THREE.Vector3()).distanceTo(vector(result.pose.hands[i]))<1e-6);
      assert.ok(hand.getWorldQuaternion(new THREE.Quaternion()).normalize().angleTo(keeperHandRotation(result.pose,i))<1e-5);
    }
    if(frame%3===0)assert.ok(skinMinimum(actor.root)>-.005);
  }
});

test('the secured ball clears the full visible body throughout landing and get-up',async()=>{
  const actor=await loadCharacter(true),meshes=[];actor.root.traverse(mesh=>{if(mesh.isSkinnedMesh)meshes.push(mesh);});
  const triangle=new THREE.Triangle(),closest=new THREE.Vector3();let worst=Infinity,at;
  for(const shot of allCaptures)for(let frame=0;frame<=168;frame++){
    const time=frame/60,result=sample(shot,time),ball=vector(result.ball);actor.pose(result.pose);actor.root.updateWorldMatrix(true,true);
    for(const mesh of meshes){
      mesh.skeleton.update();const vertices=[];
      for(let i=0;i<mesh.geometry.attributes.position.count;i++){const p=new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,i);mesh.applyBoneTransform(i,p).applyMatrix4(mesh.matrixWorld);vertices.push(p);}
      const index=mesh.geometry.index;
      for(let i=0;i<index.count;i+=3){
        triangle.set(vertices[index.getX(i)],vertices[index.getX(i+1)],vertices[index.getX(i+2)]);if(triangle.getArea()<1e-12)continue;
        triangle.closestPointToPoint(ball,closest);const distance=ball.distanceTo(closest);
        if(distance<worst){worst=distance;at=`${shot.direction}/${shot.target.y}/${time}/${mesh.material.name}`;}
      }
    }
  }
  assert.ok(worst>=.105,`ball penetrates visible body: clearance ${worst-.11} at ${at}`);
});

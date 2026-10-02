import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {loadCharacter} from './helpers/load-character.js';
import {GameCharacter} from '../src/game-character.js';
import {goalkeeperPose} from '../src/anatomy.js';
import {Shot} from '../src/engine.js';
import {keeperGather,keeperHandRotation} from '../src/keeper-contact.js';
import {createKeeperHandContact} from '../src/keeper-hand-contact.js';
import {keeperContactData} from '../src/keeper-contact-data.js';

const stats={accuracy:90,power:90,touch:90,composure:90,speed:85,reach:85,handling:95};
function transforms(actor){const result=[];actor.root.traverse(o=>result.push([o.name,o.position.toArray(),o.quaternion.toArray(),o.scale.toArray(),o.matrix.toArray(),o.matrixWorld.toArray()]));return result;}
function skin(actor){const result=[],point=new THREE.Vector3();actor.root.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;mesh.skeleton.update();for(let i=0;i<mesh.geometry.attributes.position.count;i++){point.fromBufferAttribute(mesh.geometry.attributes.position,i);mesh.applyBoneTransform(i,point).applyMatrix4(mesh.matrixWorld);result.push(point.toArray());}});return result;}

test('keeper pose reuses current hierarchy with exact transforms and skin under dirty nonuniform parents',async()=>{
 const fast=await loadCharacter(true),reference=await loadCharacter(true),roll=reference.relax,contact=createKeeperHandContact(reference.root);
 // Reference follows the public standalone helpers, which always refresh.
 reference.relax=()=>roll();reference.handContact=pose=>contact(pose);
 const actors=[fast,reference],parents=actors.map(actor=>{const outer=new THREE.Group(),inner=new THREE.Group();outer.add(inner);inner.add(actor.root);return{outer,inner};});
 const times=[0,.18,.5,1.1,2.1,.44,.44,3.8,.18,0];
 for(const mode of[0,1,2])for(const direction of[-1,1])for(const time of times){
  const pose=goalkeeperPose(stats,direction,time,mode===0?.3:mode===1?1.2:2.3),original=structuredClone(pose);
  for(let i=0;i<actors.length;i++){
   const{outer,inner}=parents[i];outer.position.set(mode*2,.2*mode,-mode);outer.rotation.set(.11*mode,.43*mode,-.07*mode);outer.scale.set(1+mode*.3,1-mode*.12,1+mode*.07);inner.rotation.set(-.02*mode,.19*mode,.08*mode);inner.scale.set(1-mode*.08,1+mode*.05,1-mode*.03);
   actors[i].root.position.set(3,4,5);actors[i].root.rotation.set(.2,.4,.6);actors[i].root.scale.set(1+mode*.07,1-mode*.04,1+mode*.11);actors[i].pose(pose);
  }
  assert.deepEqual(transforms(fast),transforms(reference),'matrix state is current immediately after pose');
  assert.deepEqual(skin(fast),skin(reference),'all actual skinned vertices are identical');assert.deepEqual(pose,original);
 }
 const original=THREE.Object3D.prototype.updateWorldMatrix,counts=new Map([[fast.root,0],[reference.root,0]]);
 THREE.Object3D.prototype.updateWorldMatrix=function(parents,children){if(children&&counts.has(this))counts.set(this,counts.get(this)+1);return original.call(this,parents,children);};
 try{for(const actor of actors)actor.pose(goalkeeperPose(stats,1,.5,1.2));}finally{THREE.Object3D.prototype.updateWorldMatrix=original;}
 assert.equal(counts.get(fast.root),1);assert.equal(counts.get(reference.root),3);
});

test('keeper reuse keeps standalone refresh and pre-load fallback behavior',async()=>{
 const a=await loadCharacter(true),b=await loadCharacter(true),pose=goalkeeperPose(stats,-1,.55,1.2);a.pose(pose);b.pose(pose);
 const refreshes=new Map([[a.root,0],[b.root,0]]);for(const actor of[a,b]){const original=actor.root.updateWorldMatrix;actor.root.updateWorldMatrix=function(parents,children){if(children)refreshes.set(this,refreshes.get(this)+1);return original.call(this,parents,children);};}
 for(let i=0;i<4;i++){
  for(const actor of[a,b]){actor.root.rotation.set(.05*i,.3*i,.02*i);actor.root.position.set(i,.2*i,-i);actor.relax();actor.handContact(pose);}
  assert.deepEqual(transforms(a),transforms(b));
 }
 for(const actor of[a,b])assert.equal(refreshes.get(actor.root),8,'both standalone helpers refresh each of four calls');
 const actor=Object.create(GameCharacter.prototype),calls=[];actor.fallback={pose:p=>calls.push(p)};actor.pose(pose);assert.equal(actor.lastPose,pose);assert.deepEqual(calls,[pose]);
});

const surfaces=['L','R'].map(side=>{const data=keeperContactData.hulls['hand'+side].surface,vertices=data.vertices.map(p=>new THREE.Vector3().fromArray(p)),faces=[];for(let i=0;i<data.indices.length;i+=3){const tri=new THREE.Triangle(...data.indices.slice(i,i+3).map(j=>vertices[j]));if(tri.getArea()>1e-12)faces.push(tri);}return faces;});
function clearance(ball,pose,index){const point=new THREE.Vector3().copy(ball).sub(pose.hands[index]).applyQuaternion(keeperHandRotation(pose,index).invert()),closest=new THREE.Vector3();let gap=Infinity;for(const triangle of surfaces[index]){triangle.closestPointToPoint(point,closest);gap=Math.min(gap,closest.distanceTo(point));}return gap-.11;}
function transformPose(source,angle,offset){const result=structuredClone(source),q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),angle),transform=(p,position)=>{const v=new THREE.Vector3().copy(p).applyQuaternion(q);if(position)v.add(offset);return{x:v.x,y:v.y,z:v.z};};for(const key of['hip','shoulder','head'])result[key]=transform(source[key],true);for(const key of['up','right','forward'])result[key]=transform(source[key],false);for(const key of['shoulders','hips','elbows','hands','knees','feet'])result[key]=source[key].map(p=>transform(p,true));return result;}

test('secured palm reuse stays attached through mirrored, rotated and repeated capture sampling',()=>{
 for(const[x,y,power,direction]of[[-3.3,1.2,.5,-1],[3.3,1.2,.5,1],[-1.5,1.2,.5,0],[1.5,1.2,.5,0],[-1.5,.2,.12,0],[1.5,.2,.12,0]]){
  const shot=new Shot({x,y,power},stats,stats,direction,42);while(!shot.result&&shot.t<30)shot.step(1/120);assert.equal(shot.caught,true);
  for(const angle of[0,.7,-1.9]){
   const offset=new THREE.Vector3(1.7,0,-.4),q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),angle),source=transformPose(shot.pose,angle,offset),point=new THREE.Vector3().copy(shot.ball).applyQuaternion(q).add(offset),ball={x:point.x,y:point.y,z:point.z},unchanged=structuredClone(source);
   const sample=time=>keeperGather(source,transformPose(shot.poseAt((shot.animationTime??shot.t)+time),angle,offset),ball,shot.contactPart,time/.44);
   assert.deepEqual(sample(0).ball,ball);const expected=sample(.44);
   for(const time of[0,.2,.44-1e-6,.44,.44+1e-6,.6,1.2,2.1,.44,.2,.44]){
    const state=sample(time),gaps=[0,1].map(i=>clearance(state.ball,state.pose,i));assert.ok(Math.min(...gaps)>=-1e-5);assert.ok(Math.min(...gaps)<1e-5);
    if(time===.44)assert.deepEqual(state,expected);
   }
   assert.deepEqual(source,unchanged,'sampling does not cache into or modify the input pose');
  }
 }
});

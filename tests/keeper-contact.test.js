import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {goalkeeperPose,holdingPose} from '../src/anatomy.js';
import {Shot} from '../src/engine.js';
import {keeperContactData} from '../src/keeper-contact-data.js';
import {keeperArmRotation,keeperHandRotation,keeperBodyRotation,keeperShoulderSupportRotation,keeperSurfaceContacts} from '../src/keeper-contact.js';
import {loadCharacter} from './helpers/load-character.js';
const stats={accuracy:90,power:90,touch:90,composure:90,speed:85,reach:85,handling:95};
const vector=p=>new THREE.Vector3().copy(p);

function deformedTriangles(actor){
  const triangles=[];actor.root.updateWorldMatrix(true,true);
  actor.root.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;mesh.skeleton.update();const p=mesh.geometry.attributes.position,vertices=[];
    for(let i=0;i<p.count;i++){const point=new THREE.Vector3().fromBufferAttribute(p,i);mesh.applyBoneTransform(i,point).applyMatrix4(mesh.matrixWorld);vertices.push(point);}
    const indices=mesh.geometry.index;for(let i=0;i<indices.count;i+=3)triangles.push(new THREE.Triangle(...[0,1,2].map(k=>vertices[indices.getX(i+k)])));
  });return triangles;
}
function distanceToSkin(point,triangles){const q=new THREE.Vector3();let distance=Infinity;for(const triangle of triangles){triangle.closestPointToPoint(point,q);const d=q.distanceTo(point);if(Number.isFinite(d))distance=Math.min(distance,d);}return distance;}

test('generated collision surfaces are tied to the shipped keeper asset',async()=>{
  const bytes=await readFile(new URL('../assets/characters/keeper-prototype.glb',import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),keeperContactData.source.sha256,'regenerate collision surfaces after changing the skin');
  const skinPose=await readFile(new URL('../src/keeper-skin-pose.js',import.meta.url));assert.equal(createHash('sha256').update(skinPose).digest('hex'),keeperContactData.source.skinPoseSha256,'regenerate collision surfaces after changing runtime shoulder weights');
  const weights=await readFile(new URL('../src/keeper-skin-weights.js',import.meta.url));assert.equal(createHash('sha256').update(weights).digest('hex'),keeperContactData.source.skinWeightsSha256,'regenerate collision surfaces after smoothing weights');
});

test('shared collision frames match actual deformed wrist and forearm bones under a rotated parent',async()=>{
  const actor=await loadCharacter(true),parent=new THREE.Group();parent.position.set(2,.4,-3);parent.rotation.set(.13,.7,-.09);parent.add(actor.root);
  const rootQ=new THREE.Quaternion(),actual=new THREE.Quaternion(),actualPosition=new THREE.Vector3();
  for(const direction of [-1,0,1])for(const height of [.3,1.2,2.3])for(const t of [0,.17,.35,.7,1.3,2.3,3.4]){
    const pose=goalkeeperPose(stats,direction,t,height);actor.pose(pose);actor.root.getWorldQuaternion(rootQ);
    for(const i of [0,1])for(const [name,rotation,position]of[[`shoulder_support${i?'R':'L'}`,keeperShoulderSupportRotation(pose,i),pose.shoulders[i]],[`upper_arm${i?'R':'L'}`,keeperArmRotation(pose,i),pose.shoulders[i]],[`forearm${i?'R':'L'}`,keeperArmRotation(pose,i,true),pose.elbows[i]],[`hand${i?'R':'L'}`,keeperHandRotation(pose,i),pose.hands[i]]]){
      const bone=actor.root.getObjectByName(name);bone.getWorldQuaternion(actual).normalize();assert.ok(actual.angleTo(rootQ.clone().multiply(rotation).normalize())<1e-5,`${name} frame at ${direction}/${height}/${t}`);
      bone.getWorldPosition(actualPosition);assert.ok(actualPosition.distanceTo(actor.root.localToWorld(vector(position)))<1e-6,`${name} contact point is unchanged`);
    }
  }
});

test('central open palms and holding fingers stay on their own side instead of crossing',()=>{
  for(const height of [1,1.2,1.4]){
    const pose=goalkeeperPose(stats,0,.5,height),tips=pose.hands.map((wrist,i)=>new THREE.Vector3(0,.19,0).applyQuaternion(keeperHandRotation(pose,i)).add(vector(wrist)));
    assert.ok(tips[1].x-tips[0].x>.10,'central fingertips remain separated');
  }
  const pose=holdingPose(goalkeeperPose(stats,0,.5,1.2)).pose;
  for(const i of [0,1]){
    const finger=new THREE.Vector3(0,1,0).applyQuaternion(keeperHandRotation(pose,i));
    assert.ok(finger.dot(vector(pose.up))>.8,'secured fingers point along the body rather than through the ball');
  }
});

test('side saves present the palm toward the incoming ball without changing finger reach',()=>{
  for(const direction of [-1,1])for(const height of [1.2,2.3])for(const time of [.4,.55,.7]){
    const pose=goalkeeperPose(stats,direction,time,height);
    for(const index of [0,1])assert.ok(new THREE.Vector3(0,0,1).applyQuaternion(keeperHandRotation(pose,index)).z>.90,'palm faces the shot, rather than the glove back or edge');
  }
});

test('moving-surface initial overlaps resolve to the skin instead of freezing inside the glove',()=>{
  const pose=goalkeeperPose(stats,0,.5,1.2),rotation=keeperHandRotation(pose,0),position=pose.hands[0],tip=keeperContactData.hulls.handL.vertices.reduce((a,b)=>a[1]>b[1]?a:b);
  const start=new THREE.Vector3(tip[0],tip[1]+.105,tip[2]).applyQuaternion(rotation).add(vector(position));
  const hit=keeperSurfaceContacts(pose,start,start,.11).find(c=>c.part==='handL')?.hit;
  assert.ok(hit);assert.equal(hit.time,0);assert.ok(Math.abs(hit.p.distanceTo(hit.q)-.11)<1e-6);assert.ok(hit.p.distanceTo(start)<.012,'minimum overlap correction, without a large ball teleport');
});

test('finger, forearm and chest grazing contacts separate a 2 mm hit from a 2 mm near miss',()=>{
  const pose=goalkeeperPose(stats,0,.5,1.2);
  for(const [name,position,rotation]of[['handL',pose.hands[0],keeperHandRotation(pose,0)],['forearmL',pose.elbows[0],keeperArmRotation(pose,0,true)],['torso',pose.hip,keeperBodyRotation(pose)]]){
    const hull=keeperContactData.hulls[name],tip=hull.vertices.reduce((best,p)=>p[1]>best[1]?p:best),radius=.11;
    // Sweep along local Z at the extremal local-Y surface. An exact hull's
    // rounded edge must not behave like inflated planar half-spaces.
    const sample=offset=>{const start=new THREE.Vector3(tip[0],tip[1]+radius+offset,tip[2]+.4).applyQuaternion(rotation).add(vector(position));const end=new THREE.Vector3(tip[0],tip[1]+radius+offset,tip[2]-.4).applyQuaternion(rotation).add(vector(position));return keeperSurfaceContacts(pose,start,end,radius).find(hit=>hit.part===name);};
    assert.ok(sample(-.002),`${name} grazing edge is covered`);assert.equal(sample(.002),undefined,`${name} visible near miss stays a miss`);
  }
});

test('first contacts agree with visible triangles across height, speed and selected direction',async()=>{
  const actor=await loadCharacter(true);let touched=0,worstGap=-Infinity,worstDepth=Infinity;
  for(const x of [-3.3,-1.5,0,1.5,3.3])for(const y of [.2,1.2,2.2])for(const power of [.12,.5,.9])for(const direction of [-1,0,1]){
    const shot=new Shot({x,y,power},stats,stats,direction,42),reflect=shot.reflect.bind(shot);let impact;
    shot.reflect=(hit,r,e)=>{impact={...hit.p};return reflect(hit,r,e);};
    for(let n=0;n<1000&&!shot.result;n++){
      shot.step(1/120);if(!shot.touched)continue;touched++;
      actor.pose(shot.pose);const gap=distanceToSkin(vector(shot.caught?shot.ball:impact),deformedTriangles(actor))-.11;
      worstGap=Math.max(worstGap,gap);worstDepth=Math.min(worstDepth,gap);break;
    }
  }
  assert.ok(touched>=45,'audit covers representative contacts rather than passing through everything');
  assert.ok(worstGap<.012,`ghost contact gap ${(worstGap*100).toFixed(2)} cm`);
  assert.ok(worstDepth>-.018,`late contact depth ${(worstDepth*100).toFixed(2)} cm`);
});

test('surface contact can rebound into a goal and cannot erase a completed crossing',()=>{
  let reboundGoals=0;
  for(const x of [-3.3,-1.5,0,1.5,3.3])for(const y of [.2,1.2,2.2])for(const direction of [-1,0,1]){
    const shot=new Shot({x,y,power:.7},stats,stats,direction,42);for(let n=0;n<1800&&!shot.result;n++)shot.step(1/120);
    if(shot.result?.goal&&shot.touched)reboundGoals++;
  }
  assert.ok(reboundGoals>0,'a parry is not automatically scored as a save');
  const shot=new Shot({x:0,y:1,power:.5},stats,stats,0,1);shot.ball={x:0,y:1,z:-.12};shot.velocity={x:0,y:0,z:-1};shot.step(1/120);assert.equal(shot.result.goal,true);
});

test('handling still changes possession chances without changing physical coverage',()=>{
  const counts=[];
  for(const handling of [40,99]){let caught=0,touched=0;for(let seed=1;seed<=80;seed++){const shot=new Shot({x:0,y:1.2,power:.5},stats,{...stats,handling},0,seed);for(let n=0;n<1000&&!shot.result;n++)shot.step(1/120);caught+=Number(shot.caught);touched+=Number(shot.touched);}counts.push({caught,touched});}
  assert.equal(counts[0].touched,counts[1].touched);assert.ok(counts[1].caught>counts[0].caught+20,'handling remains a meaningful ability rather than guaranteed catching');
});

test('glove contact quality stays finite across exact mesh seam and fingertip triangles',()=>{
  for(const direction of [-1,0,1])for(const height of [.3,1.2,2.3]){
    const pose=goalkeeperPose(stats,direction,.5,height);
    for(const i of [0,1]){const wrist=vector(pose.hands[i]);for(const offset of [-.06,0,.06]){const a=wrist.clone().add(new THREE.Vector3(offset,.09,.4)),b=wrist.clone().add(new THREE.Vector3(offset,.09,-.4));for(const contact of keeperSurfaceContacts(pose,a,b,.11))assert.ok(Number.isFinite(contact.quality)&&contact.quality>=0&&contact.quality<=1,'degenerate source triangles cannot turn handling into NaN');}}
  }
});

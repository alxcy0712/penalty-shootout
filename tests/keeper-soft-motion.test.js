import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {goalkeeperPose,blendKeeperPose,placeKeeperPose,holdingPose} from '../src/anatomy.js';
import {keeperTorsoFrames} from '../src/keeper-torso.js';
const stats={speed:85,reach:85},distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const fixture=JSON.parse(await readFile(new URL('fixtures/keeper-reach-before-softening.json',import.meta.url)));
test('soft recovery preserves authored hip, boots and leading save-hand reach before landing',()=>{
 for(const r of fixture.records){const p=goalkeeperPose(stats,r.direction,r.time,r.height);assert.ok(distance(p.hip,r.hip)<1e-10);for(const key of['feet','hands','elbows'])p[key].forEach((f,i)=>assert.ok(distance(f,r[key][i])<1e-10));assert.ok(distance(p.hands[r.direction>0?1:0],r.leadingHand)<1e-10);assert.equal(p.torso.curl,0);}
});
test('landing folds arms and articulates the chest instead of retaining the flight silhouette',()=>{
 for(const direction of[-1,1])for(const height of[.3,1.2,2.3]){
  const high=Math.max(0,Math.min(1,(height-.35)/1.7)),vy=.7+high*2.1,landing=.13+(vy+Math.sqrt(vy*vy+2*9.81*(.83-.305)))/9.81;
  const p=goalkeeperPose(stats,direction,landing+.24,height),frames=keeperTorsoFrames(p);
  assert.ok(p.torso.curl>.11);assert.ok(distance(frames.chest.up,p.up)>.06);for(let i=0;i<2;i++)assert.ok(distance(p.hands[i],p.shoulders[i])<.46);
  const settled=goalkeeperPose(stats,direction,4,height);assert.equal(settled.torso.curl,0);assert.equal(settled.torso.armRelax,0);
 }
});
test('articulation survives translation, interpolation and secure-ball pose without mutable history',()=>{
 const p=goalkeeperPose(stats,1,1.05,1.2),q=goalkeeperPose(stats,1,1.8,1.2),moved=placeKeeperPose(p,{x:2,y:0,z:-.3});assert.deepEqual(moved.torso,p.torso);
 const mixed=blendKeeperPose(p,q,.5,false);for(const k of['curl','twist','sideBend','headCurl','armRelax'])assert.ok(Math.abs(mixed.torso[k]-(p.torso[k]+q.torso[k])/2)<1e-12);
 assert.deepEqual(holdingPose(p,.8).pose.torso,p.torso);
 for(const hz of[30,60,120]){for(let i=0;i<3*hz;i++)goalkeeperPose(stats,-1,i/hz,2.3);assert.deepEqual(goalkeeperPose(stats,1,1.05,1.2),p);}
});

test('only the explicitly bracing wrist has a lower joint-center floor; other phases stay protected',()=>{
 const permitted=(p,key,index,y)=>y>=((key==='hands'&&(p.torso?.[index?'braceR':'braceL']??0)>.5)?.03:.065);
 for(const direction of[-1,1])for(const height of[.3,1.2,2.3])for(let frame=0;frame<=480;frame++){
  const p=goalkeeperPose(stats,direction,frame/120,height);
  assert.ok(!((p.torso.braceL??0)>0&&(p.torso.braceR??0)>0),'one anatomical support hand only');
  for(const key of['hands','feet','knees','elbows'])p[key].forEach((joint,index)=>assert.ok(permitted(p,key,index,joint.y)));
  const index=direction>0?1:0;assert.equal(permitted(p,'hands',index,.02),false,'a tag cannot excuse an arbitrarily low wrist');assert.equal(permitted(p,'elbows',index,.04),false,'the exception never applies to elbows');
 }
 const ready=goalkeeperPose(stats,1,0,1.2);assert.equal(permitted(ready,'hands',1,.04),false,'the pre-shot pose has no floor exception');
});

test('real bracing glove contacts turf before body lift while its wrist stays planted',async()=>{
 const THREE=await import('three'),{loadCharacter}=await import('./helpers/load-character.js'),{keeperHandRotation}=await import('../src/keeper-contact.js'),{keeperContactData}=await import('../src/keeper-contact-data.js');
 const actor=await loadCharacter(true),point=new THREE.Vector3();
 for(const direction of[-1,1])for(const height of[.3,1.2,2.3]){
  const high=Math.max(0,Math.min(1,(height-.35)/1.7)),vy=.7+high*2.1,landing=.13+(vy+Math.sqrt(vy*vy+2*9.81*(.83-.305)))/9.81,index=direction>0?1:0,side=index?'R':'L';let planted;
  for(const after of[.3,.5,.7]){
   const p=goalkeeperPose(stats,direction,landing+after,height);assert.ok(p.torso['brace'+side]>.999);assert.ok(Math.abs(p.hands[index].y-.035)<1e-8);
   if(planted)assert.ok(distance(p.hands[index],planted)<1e-8,'weight transfer must not slide the planted wrist');planted=p.hands[index];
   actor.pose(p);actor.root.updateMatrixWorld(true);let minimum=Infinity;
   actor.root.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;mesh.skeleton.update();const {position,skinIndex,skinWeight}=mesh.geometry.attributes;for(let i=0;i<position.count;i++){let weight=0;for(let k=0;k<4;k++)if(mesh.skeleton.bones[skinIndex.getComponent(i,k)].name==='hand'+side)weight+=skinWeight.getComponent(i,k);if(weight<.9)continue;point.fromBufferAttribute(position,i);mesh.applyBoneTransform(i,point).applyMatrix4(mesh.matrixWorld);minimum=Math.min(minimum,point.y);}});
   assert.ok(minimum>=-.0001&&minimum<.009,`real glove skin must support, not float or penetrate: ${minimum}`);
   // The old keeperPalmCenter helper is an anatomical point inside the glove,
   // not its surface. Check calibrated, non-fingertip palm triangles instead.
   const surface=keeperContactData.hulls['hand'+side].surface,rotation=keeperHandRotation(p,index),wrist=new THREE.Vector3().copy(p.hands[index]);let palmArea=0;
   for(let i=0;i<surface.indices.length;i+=3){const local=surface.indices.slice(i,i+3).map(v=>new THREE.Vector3().fromArray(surface.vertices[v])),center=local[0].clone().add(local[1]).add(local[2]).multiplyScalar(1/3);if(center.y<.035||center.y>.135||Math.abs(center.x)>.09)continue;const triangle=new THREE.Triangle(...local.map(v=>v.applyQuaternion(rotation).add(wrist))),normal=triangle.getNormal(new THREE.Vector3()),height=triangle.getMidpoint(new THREE.Vector3()).y;if(height<.02&&normal.y<-.3)palmArea+=triangle.getArea();}
   assert.ok(palmArea>.0008,`a real palm patch, not only fingertips, supports: ${palmArea} m²`);
  }
 }
});

test('zero-time holding preserves the complete source pose including a low planted wrist',()=>{
 for(const direction of[-1,0,1])for(const time of[0,.2,.8,1.1,1.7,2.3]){
  const source=goalkeeperPose(stats,direction,time,.3),start=holdingPose(source,0),first=holdingPose(source,1e-5);
  assert.deepEqual(start.pose,source);assert.equal(start.pose,source,'no floor correction or metadata injection at zero blend');
  for(const key of['hands','elbows'])source[key].forEach((point,i)=>assert.ok(distance(point,first.pose[key][i])<1e-7,'the first infinitesimal step cannot jump off the support'));
  if(source.torso)assert.deepEqual(source.torso,JSON.parse(JSON.stringify(source.torso)),'new articulation fields must serialize without negative-zero changes');
 }
});

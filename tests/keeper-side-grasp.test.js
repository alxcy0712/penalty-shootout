import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3,Triangle,Box3} from 'three';
import {Shot} from '../src/engine.js';
import {keeperGather} from '../src/keeper-contact.js';
import {loadCharacter} from './helpers/load-character.js';

const stats={accuracy:90,power:90,touch:90,composure:90,speed:99,reach:99,handling:95};
const shot=new Shot({x:.3,y:.18,power:.52},stats,stats,0,101);
for(let frame=0;frame<3600&&!shot.result;frame++)shot.step(1/120);
assert.ok(shot.caught,'the lower-side regression must remain an actual physical catch');
const V=p=>new Vector3().copy(p),sample=t=>keeperGather(shot.pose,shot.poseAt((shot.animationTime??shot.t)+t),shot.ball,shot.contactPart,t/.44);

test('a lower-side catching elbow follows a continuous fixed-length arc from the exact capture',()=>{
  const source=structuredClone(shot.pose),contact={...shot.ball},start=sample(0);assert.deepEqual(start.pose,source);assert.deepEqual(start.ball,contact);
  let previous;
  for(let frame=0;frame<=672;frame++){
    const result=sample(frame/240);
    for(let arm=0;arm<2;arm++){
      const {shoulders,elbows,hands}=result.pose;
      assert.ok(Math.abs(V(shoulders[arm]).distanceTo(V(elbows[arm]))-.29)<1e-10);
      assert.ok(Math.abs(V(elbows[arm]).distanceTo(V(hands[arm]))-.27)<1e-10);
      if(previous)assert.ok(V(elbows[arm]).distanceTo(V(previous.pose.elbows[arm]))<.04,'no jump between disconnected feasible elbow arcs');
    }
    previous=result;
  }
  const times=[.18,.2,.219,.220833333,.333333333,.44,.7],expected=times.map(sample);
  for(let i=times.length-1;i>=0;i--)assert.deepEqual(sample(times[i]),expected[i],'the arc must not depend on playback history');
  for(const t of times)for(let arm=0;arm<2;arm++){
    const left=V(sample(t-1e-6).pose.elbows[arm]),right=V(sample(t+1e-6).pose.elbows[arm]);
    assert.ok(left.distanceTo(right)<.00005,'shrinking time steps cannot retain a branch jump');
  }
  assert.deepEqual(shot.pose,source,'capture mapping never mutates the incoming pose');
  assert.deepEqual(shot.ball,contact,'capture mapping never mutates the physical contact');
});

const lowReaches=[64,65,66].map(speed=>{
  const abilities={...stats,speed,reach:speed},capture=new Shot({x:-3.3,y:.18,power:.54},abilities,abilities,-1,101);
  for(let frame=0;frame<3600&&!capture.result;frame++)capture.step(1/120);
  assert.ok(capture.caught,'the low-side regression must remain an actual physical catch');
  return t=>keeperGather(capture.pose,capture.poseAt((capture.animationTime??capture.t)+t),capture.ball,capture.contactPart,t/.44);
});

test('low side reaches keep a continuous elbow branch as new feasible arcs appear',()=>{
  for(const at of lowReaches){
    let previous;
    for(let frame=0;frame<=672;frame++){
      const result=at(frame/240);
      for(let arm=0;arm<2;arm++){
        const {shoulders,elbows,hands}=result.pose;
        assert.ok(Math.abs(V(shoulders[arm]).distanceTo(V(elbows[arm]))-.29)<1e-10);
        assert.ok(Math.abs(V(elbows[arm]).distanceTo(V(hands[arm]))-.27)<1e-10);
        if(previous)assert.ok(V(elbows[arm]).distanceTo(V(previous.pose.elbows[arm]))<.04);
      }
      previous=result;
    }
    // The former ~.30 m component jump survives arbitrarily small time steps.
    // Refine its exact interval instead of accepting only the 240 Hz samples.
    for(const hz of[240,960,3840,15360,96000]){
      let previous,maxStep=0;
      for(let frame=Math.floor(.238*hz);frame<=Math.ceil(.241*hz);frame++){
        const elbows=at(frame/hz).pose.elbows;
        if(previous)for(let arm=0;arm<2;arm++)maxStep=Math.max(maxStep,V(elbows[arm]).distanceTo(V(previous[arm])));
        previous=elbows;
      }
      assert.ok(maxStep<.04*240/hz,`elbow step must shrink with time step at ${hz} Hz: ${maxStep}`);
    }
  }
});

test('the lower-side catching forearm clears the actual shirt, ball and turf together',async()=>{
  const actor=await loadCharacter(true),meshes=[];actor.root.traverse(m=>{if(m.isSkinnedMesh)meshes.push(m);});
  const faces=[];
  for(const [mi,mesh]of meshes.entries()){
    const {skinIndex,skinWeight}=mesh.geometry.attributes,indices=mesh.geometry.index;
    for(let f=0;f<indices.count;f+=3){
      const ids=[indices.getX(f),indices.getX(f+1),indices.getX(f+2)],weights={};
      for(const id of ids)for(let k=0;k<4;k++){
        const name=mesh.skeleton.bones[skinIndex.getComponent(id,k)].name;
        weights[name]=(weights[name]??0)+skinWeight.getComponent(id,k)/3;
      }
      const region=Object.keys(weights).sort((a,b)=>weights[b]-weights[a])[0];
      faces.push({mi,ids,region});
    }
  }
  const triangle=new Triangle(),closest=new Vector3();
  const crosses=(a,b)=>{
    if(!a.box.intersectsBox(b.box))return false;
    const da=a.points.map(p=>b.normal.dot(p.clone().sub(b.points[0]))),db=b.points.map(p=>a.normal.dot(p.clone().sub(a.points[0])));
    if(Math.min(...da)>=-1e-8||Math.max(...da)<=1e-8||Math.min(...db)>=-1e-8||Math.max(...db)<=1e-8)return false;
    const direction=new Vector3().crossVectors(a.normal,b.normal);if(direction.lengthSq()<1e-12)return false;direction.normalize();
    const interval=(points,distances)=>{const hits=[];for(let i=0;i<3;i++){const j=(i+1)%3;if(Math.abs(distances[i])<1e-10)hits.push(direction.dot(points[i]));else if(distances[i]*distances[j]<0)hits.push(direction.dot(points[i].clone().lerp(points[j],distances[i]/(distances[i]-distances[j]))));}return [Math.min(...hits),Math.max(...hits)];};
    const x=interval(a.points,da),y=interval(b.points,db);return Math.min(x[1],y[1])-Math.max(x[0],y[0])>1e-5;
  };
  const checks=[[sample,[.15,.18,.2,.216666667,.225,.25,.3,1/3,.4,.5,.6,.7,.88,1.2,2.8]],...lowReaches.map(at=>[at,[.1,.18,.22,.233333333,.23959,.24,.25,.3,.44,.88,1.2]])];
  for(const [at,times]of checks)for(const t of times){
    const result=at(t),ball=V(result.ball);actor.pose(result.pose);actor.root.updateMatrixWorld(true);
    const vertices=meshes.map(mesh=>{mesh.skeleton.update();const position=mesh.geometry.attributes.position;return Array.from({length:position.count},(_,i)=>mesh.applyBoneTransform(i,new Vector3().fromBufferAttribute(position,i)).applyMatrix4(mesh.matrixWorld));});
    let floor=Infinity,bodyGap=Infinity,gloveGap=Infinity;const forearms=[],shirt=[];
    for(const points of vertices)for(const point of points)floor=Math.min(floor,point.y);
    for(const face of faces){
      const points=face.ids.map(id=>vertices[face.mi][id]);triangle.set(...points);if(triangle.getArea()<1e-12)continue;
      triangle.closestPointToPoint(ball,closest);const gap=closest.distanceTo(ball)-.11;
      bodyGap=Math.min(bodyGap,gap);if(/^hand[LR]$/.test(face.region))gloveGap=Math.min(gloveGap,gap);
      if(/^forearm[LR]$/.test(face.region)||['chest','spine'].includes(face.region)){
        const surface={points,box:new Box3().setFromPoints(points),normal:triangle.getNormal(new Vector3())};
        if(/^forearm/.test(face.region))forearms.push(surface);else shirt.push(surface);
      }
    }
    assert.ok(floor>=-.005,`skin below turf at ${t}: ${floor}`);
    assert.ok(bodyGap>=-.005,`ball inside body at ${t}: ${bodyGap}`);
    assert.ok(gloveGap<=.002,`ball separated from both gloves at ${t}: ${gloveGap}`);
    for(const arm of forearms)for(const torso of shirt)assert.ok(!crosses(arm,torso),`forearm crosses torso at ${t}`);
  }
});

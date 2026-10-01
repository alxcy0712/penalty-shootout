import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {loadCharacter,skinMinimum,skinSurfaceDistance} from './helpers/load-character.js';
import {goalkeeperPose,holdingPose} from '../src/anatomy.js';
import {kickStyleOffset} from '../src/striker-kick-style.js';

const point=(actor,name)=>actor.root.getObjectByName(name).getWorldPosition(new THREE.Vector3());

test('procedural keeper gloves stay above turf throughout left/right low/high saves and get-up',async()=>{
  const actor=await loadCharacter(true);let minimum=Infinity;
  for(const direction of [-1,0,1])for(const height of [.3,1.2,2.3])for(let i=0;i<=120;i++){
    const pose=goalkeeperPose({speed:85,reach:85},direction,i/30,height);actor.pose(pose);
    for(const [index,side] of ['L','R'].entries())assert.ok(point(actor,'hand'+side).distanceTo(new THREE.Vector3().copy(pose.hands[index]))<1e-6,'contact correction leaves physical wrists fixed');
    minimum=Math.min(minimum,skinMinimum(actor.root));
  }
  assert.ok(minimum>-.005,`entire skin clearance ${minimum}m, not just joint centres`);
});

test('grounded hand correction is deterministic and continuous through landing, support and release',async()=>{
  const actor=await loadCharacter(true);let maximum=0;
  for(const direction of [-1,1])for(const height of [.3,1.2,2.3]){
    let previous;
    for(let i=0;i<=960;i++){
      const pose=goalkeeperPose({speed:85,reach:85},direction,i/240,height);actor.pose(pose);
      const quaternions=['L','R'].map(side=>actor.root.getObjectByName('hand'+side).getWorldQuaternion(new THREE.Quaternion()).normalize());
      if(previous)for(let k=0;k<2;k++)maximum=Math.max(maximum,quaternions[k].angleTo(previous[k]));
      actor.pose(pose);for(let k=0;k<2;k++)assert.ok(actor.root.getObjectByName('hand'+['L','R'][k]).getWorldQuaternion(new THREE.Quaternion()).normalize().angleTo(quaternions[k])<1e-6,'scrubbing must not accumulate wrist rotation');
      previous=quaternions;
    }
  }
  assert.ok(maximum<.16,`wrist rotation step at 240Hz ${maximum}`);
  for(const direction of [-1,1])for(let i=0;i<=120;i++){
    actor.pose(holdingPose(goalkeeperPose({speed:85,reach:85},direction,i/30,2)).pose);
    assert.ok(skinMinimum(actor.root)>-.005,'holding preserves whole-skin clearance');
  }
});

test('shot styles preserve exact contact and support while giving low shots and chips distinct follow-through',async()=>{
  const actor=await loadCharacter();const ball=new THREE.Vector3(0,.11,11);let minimum=Infinity;
  for(const targetX of [-4.5,0,4.5])for(const power of [.2,.7,1])for(const shotType of ['normal','low','chip']){
    const options={targetX,power,shotType};actor.kick(1,0,options);actor.root.updateWorldMatrix(true,true);
    const toe=actor.root.getObjectByName('footL').localToWorld(new THREE.Vector3(0,.23,0));
    assert.ok(Math.abs(skinSurfaceDistance(actor.root,ball,'Boots')-.11)<.002,'actual aimed shoe surface meets the ball within 2 mm');
    const support=point(actor,'footR');let previous;
    for(let i=0;i<=36;i++){
      const after=i/60;actor.kick(1,after,options);actor.root.updateWorldMatrix(true,true);
      assert.ok(point(actor,'footR').distanceTo(support)<.005,'style overlay never moves the support foot');
      const foot=point(actor,'footL');if(previous)assert.ok(foot.distanceTo(previous)<.20,'continuous follow-through');previous=foot;
      if(i%6===0)minimum=Math.min(minimum,skinMinimum(actor.root));
      for(const [a,b] of [['thighL','shinL'],['shinL','footL']])assert.ok(Math.abs(point(actor,a).distanceTo(point(actor,b))-.43)<.008,'fixed kicking-leg lengths');
      actor.kick(1,after,options);assert.ok(point(actor,'footL').distanceTo(foot)<1e-6,'repeated sampling does not accumulate IK offsets');
    }
  }
  assert.ok(minimum>-.02,`adapted kick skin clearance ${minimum}`);
  const samples={};for(const shotType of ['normal','low','chip']){actor.kick(1,.20,{shotType});samples[shotType]=point(actor,'footL');}
  assert.ok(samples.low.y<samples.normal.y-.09,'low-shot swing stays lower');
  assert.ok(samples.chip.distanceTo(samples.normal)>.12,'chip is visibly shorter');
  for(const shotType of ['normal','low','chip'])for(const after of [0,.60,1.5])assert.deepEqual(kickStyleOffset(after,{shotType}),{y:0,z:0},'contact and final settle retain source motion');
});

test('cropped mocap resolves its trailing step into a grounded stable finish',async()=>{
  const actor=await loadCharacter();let previous,minimum=Infinity;
  for(let i=0;i<=480;i++){
    const after=1+i/240;actor.kick(1,after);actor.root.updateWorldMatrix(true,true);
    const points=['pelvis','shinL','shinR','footL','footR'].map(name=>point(actor,name));
    if(previous)points.forEach((p,j)=>assert.ok(p.distanceTo(previous[j])<.025,'settling does not pop'));
    previous=points;if(i%8===0)minimum=Math.min(minimum,skinMinimum(actor.root));
    if(after>=1.65)for(const name of ['footL','footR'])assert.ok(point(actor,name).y<.085,'both boots return to the ground');
  }
  assert.ok(minimum>-.02,`finish skin clearance ${minimum}`);
  const before=['pelvis','footL','footR'].map(name=>point(actor,name));actor.kick(1,8);actor.root.updateWorldMatrix(true,true);
  before.forEach((p,j)=>assert.ok(p.distanceTo(point(actor,['pelvis','footL','footR'][j]))<1e-6,'finished stance remains stable'));
});

test('repeated gaze calls do not accumulate onto a paused mocap head',async()=>{
  const actor=await loadCharacter(),target=new THREE.Vector3(4,1,7);actor.kick(.7);
  const head=actor.root.getObjectByName('head'),base=head.quaternion.clone().normalize();
  for(let i=0;i<240;i++){actor.kick(.7);actor.lookAt(target,1/60);assert.ok(head.quaternion.clone().normalize().angleTo(base)<.40,'gaze stays within neck limits');}
  const expected=head.quaternion.clone().normalize();actor.lookAt(target,0);
  assert.ok(head.quaternion.clone().normalize().angleTo(expected)<1e-6,'zero dt cannot compound gaze');
});

test('keeper cross-body reach stays in front of the chest with a continuous elbow bend plane',()=>{
  let smallest=Infinity,largest=0;
  for(const direction of [-1,0,1])for(const height of [.3,1.2,2.3]){
    let previous;
    for(let frame=0;frame<=960;frame++){
      const pose=goalkeeperPose({speed:85,reach:85},direction,frame/240,height);
      const right=new THREE.Vector3().copy(pose.right).normalize(),up=new THREE.Vector3().copy(pose.up).normalize(),forward=new THREE.Vector3().crossVectors(right,up).normalize();
      const axes=[];
      for(let i=0;i<2;i++){
        axes.push(new THREE.Vector3().copy(pose.elbows[i]).sub(pose.shoulders[i]).normalize(),new THREE.Vector3().copy(pose.hands[i]).sub(pose.elbows[i]).normalize());
        for(const weight of [0,.25,.5,.75,1]){
          const point=new THREE.Vector3().copy(pose.elbows[i]).lerp(pose.hands[i],weight).sub(pose.hip),along=point.dot(up);
          if(along>.10&&along<.43)smallest=Math.min(smallest,(point.dot(right)/.19)**2+(point.dot(forward)/.105)**2);
        }
      }
      if(previous)axes.forEach((axis,i)=>largest=Math.max(largest,axis.angleTo(previous[i])));previous=axes;
    }
  }
  assert.ok(smallest>1.2,`elbow/forearm centre must not enter torso core; normalized clearance ${smallest}`);
  assert.ok(largest<.15,`elbow bend plane rotates too quickly at 240Hz: ${largest}`);
});

test('a partially initialized model failure restores the latest fallback pose',async()=>{
  const {GameCharacter}=await import('../src/game-character.js');
  const previousDocument=globalThis.document,previousWarn=console.warn;
  globalThis.document={createElement:()=>({width:256,height:256,getContext:()=>({clearRect(){},fillText(){}})})};console.warn=()=>{};
  try{
    class BrokenCharacter extends GameCharacter {async load(){await Promise.resolve();this.root=new THREE.Group();this.group.add(this.root);this.fallback.group.visible=false;throw new Error('malformed rig');}}
    const actor=new BrokenCharacter(new THREE.Scene(),'#88beca',true),pose=goalkeeperPose({speed:85,reach:85},1,.25,1.2);actor.pose(pose);
    assert.equal(await actor.ready,false);assert.equal(actor.root,null);assert.equal(actor.group.children.length,1);assert.equal(actor.fallback.group.visible,true);
    assert.ok(actor.fallback.trunk.position.distanceTo(new THREE.Vector3().copy(pose.hip))<1e-8);
    actor.pose(goalkeeperPose({speed:85,reach:85},-1,2.1,1.2));assert.ok(actor.fallback.trunk.position.toArray().every(Number.isFinite));
  }finally{globalThis.document=previousDocument;console.warn=previousWarn;}
});

test('gathering remains continuous across capture times before, during and after landing',()=>{
  for(const direction of [-1,0,1])for(const height of [.3,1.2,2.3])for(const capture of [.15,.3,.45,.6,.8,1.1]){
    let previous=goalkeeperPose({speed:85,reach:85},direction,capture,height);
    for(let ms=1;ms<=440;ms++){
      const source=goalkeeperPose({speed:85,reach:85},direction,capture+ms/1000,height),pose=holdingPose(source,ms/440).pose;
      for(let i=0;i<2;i++){
        const a=new THREE.Vector3().copy(previous.elbows[i]),b=new THREE.Vector3().copy(pose.elbows[i]);
        assert.ok(a.distanceTo(b)<.022,'a gathering elbow must not switch IK branches');
        const sourceFloor=(source.torso?.[i?'braceR':'braceL']??0)>.5?Math.min(.075,Math.max(.03,source.hands[i].y)):.075;
        const wristFloor=sourceFloor+(.075-sourceFloor)*pose.grip.weight;
        assert.ok(pose.elbows[i].y>=.075-1e-8&&pose.hands[i].y>=wristFloor-1e-8,'only the tagged bracing wrist may lift continuously from its lower support height');
        assert.ok(Math.abs(b.distanceTo(new THREE.Vector3().copy(pose.shoulders[i]))-.29)<1e-8);
        assert.ok(Math.abs(b.distanceTo(new THREE.Vector3().copy(pose.hands[i]))-.27)<1e-8);
      }
      previous=pose;
    }
  }
});

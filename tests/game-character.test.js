import test from 'node:test';
import assert from 'node:assert/strict';
import {gameKickTime,KICK_CONTACT} from '../src/game-character.js';
import {penaltyStyles} from '../src/anatomy.js';

test('all runup durations keep a steady mocap tempo and align contact with ball release',()=>{
  for(const style of penaltyStyles){
    assert.equal(gameKickTime(style.duration/style.duration),KICK_CONTACT);
    assert.equal(gameKickTime(1,0),KICK_CONTACT);
    assert.ok(Math.abs(gameKickTime((style.duration-.0001)/style.duration)-gameKickTime(1,0))<.001);
    for(const phase of [.1,.3,.5,.7,.9])assert.ok(Math.abs(gameKickTime(phase)-KICK_CONTACT*phase)<1e-12,'runup retains uniform capture playback');
  }
  assert.equal(gameKickTime(0),0);assert.equal(gameKickTime(1,10),3.5);
});

import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {GameCharacter} from '../src/game-character.js';
import {createKeeperSkinPose} from '../src/keeper-skin-pose.js';
import {createKeeperArmRoll} from '../src/keeper-arm-roll.js';
import {strikerRunupPose,goalkeeperPose,holdingPose,keeperWarmupPose,keeperPreparation,keeperHesitationPose,blendKeeperPose,HOLD_DURATION} from '../src/anatomy.js';
import {Shot} from '../src/engine.js';

async function character(asset,keeper){
  const bytes=await readFile(new URL(`../assets/characters/${asset}.glb`,import.meta.url));
  const length=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+length));
  for(const m of json.materials){delete m.pbrMetallicRoughness?.baseColorTexture;delete m.pbrMetallicRoughness?.metallicRoughnessTexture;delete m.normalTexture;}
  bytes.fill(32,20,20+length);bytes.write(JSON.stringify(json),20);
  await MeshoptDecoder.ready;
  const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const c=Object.create(GameCharacter.prototype);c.root=gltf.scene;c.keeper=keeper;
  c.mixer=new THREE.AnimationMixer(c.root);c.actions=gltf.animations.map(clip=>c.mixer.clipAction(clip).setLoop(THREE.LoopOnce,1));
  c.apply=createKeeperSkinPose(c.root);c.relax=createKeeperArmRoll(c.root);return c;
}

test('game mocap reaches the actual penalty ball and repeated pose/gaze stays stable',async()=>{
  const c=await character('striker-mocap',false),ball=new THREE.Vector3(0,.11,11);
  let previous;
  for(let i=0;i<100;i++){
    c.pose(strikerRunupPose(0,1,0,.7,0));c.kick(1,0);c.lookAt(ball,1/60);
    const point=c.root.getObjectByName('footL').localToWorld(new THREE.Vector3(0,.23,0));
    assert.ok(Math.abs(point.distanceTo(ball)-.11)<.02,'shoe meets game ball');
    if(previous)assert.ok(point.distanceTo(previous)<1e-6,'mixer resets do not move the contact');previous=point;
    assert.ok(c.root.getObjectByName('head').quaternion.toArray().every(Number.isFinite));
  }
});

function strike(c,time,style,power=.7,x=0,type='normal'){
  const after=time>=style.duration?time-style.duration:null,runup=after===null?time/style.duration:0;
  c.pose(strikerRunupPose(0,after===null?runup:1,after??-1,power,x,style,type));
  c.kick(runup,after);c.root.updateWorldMatrix(true,true);
}
const joint=(c,name)=>c.root.getObjectByName(name).getWorldPosition(new THREE.Vector3());
function floor(c){
  let minimum=Infinity,lowest;
  const point=new THREE.Vector3();
  c.root.traverse(mesh=>{
    if(!mesh.isSkinnedMesh)return;mesh.skeleton.update();
    for(let i=0;i<mesh.geometry.attributes.position.count;i++){
      point.fromBufferAttribute(mesh.geometry.attributes.position,i);mesh.applyBoneTransform(i,point);point.applyMatrix4(mesh.matrixWorld);
      if(point.y<minimum){minimum=point.y;lowest=mesh.material.name;}
    }
  });
  return {minimum,lowest};
}

test('rendered runup, strike and recovery retain every bone of the full CMU capture',async()=>{
  const c=await character('striker-mocap',false),reference=await character('striker-mocap',false);
  reference.root.position.set(0,0,11);reference.root.rotation.y=Math.PI;
  for(const style of penaltyStyles)for(const type of ['normal','low','chip'])for(const sourceTime of [0,.18,.43,.65,1.1,1.47,1.7,1.85,2,2.4,2.85,3.3,3.5]){
    const time=sourceTime<KICK_CONTACT?style.duration*sourceTime/KICK_CONTACT:style.duration+sourceTime-KICK_CONTACT;
    strike(c,time,style,.7,3.5,type);
    const action=reference.actions[0];action.play();action.paused=true;action.time=sourceTime;reference.mixer.update(0);
    reference.root.updateWorldMatrix(true,true);
    c.root.traverse(bone=>{
      if(!bone.isBone)return;
      const captured=reference.root.getObjectByName(bone.name);
      assert.ok(bone.getWorldPosition(new THREE.Vector3()).distanceTo(captured.getWorldPosition(new THREE.Vector3()))<1e-5,`${style.name}/${type}/${sourceTime}: ${bone.name} retains captured position`);
      assert.ok(bone.quaternion.clone().normalize().angleTo(captured.quaternion.clone().normalize())<1e-5,`${bone.name} retains captured rotation`);
    });
  }
});

test('full-body mocap stays continuous when game runup resets at ball release',async()=>{
  const c=await character('striker-mocap',false),bones=[];
  c.root.traverse(bone=>{if(bone.isBone)bones.push(bone.name);});
  for(const style of penaltyStyles)for(const power of [.2,.7,1])for(const x of [-3.5,0,3.5])for(const type of ['normal','low','chip']){
    strike(c,style.duration-.0001,style,power,x,type);const before=bones.map(name=>joint(c,name));
    strike(c,style.duration,style,power,x,type);const at=bones.map(name=>joint(c,name));
    strike(c,style.duration+.0001,style,power,x,type);
    for(const [i,name] of bones.entries())assert.ok(at[i].distanceTo(before[i])<.005&&joint(c,name).distanceTo(at[i])<.005,`${name} stays continuous through release`);
  }
});

test('actual match skins clear the turf across approach, strikes, dives, landings and held-ball recovery',async()=>{
  const striker=await character('striker-mocap',false),keeper=await character('keeper-prototype',true);
  for(const style of penaltyStyles)for(const type of ['normal','low','chip'])for(const time of [0,.4,style.duration-.55,style.duration-.1,style.duration,style.duration+.1,style.duration+.4,style.duration+1.1]){
    strike(striker,time,style,.7,0,type);const {minimum,lowest}=floor(striker);
    assert.ok(minimum>=-.014,`${style.name}/${type}/${time}: ${lowest} reaches ${minimum} m`);
  }
  for(const direction of [-1,0,1])for(const height of [.35,2])for(let frame=0;frame<=40;frame++){
    const time=frame/10,p=goalkeeperPose({speed:85,reach:85},direction,time,height);
    for(const pose of [p,holdingPose(p).pose]){
      keeper.pose(pose);keeper.root.updateWorldMatrix(true,true);const {minimum,lowest}=floor(keeper);
      assert.ok(minimum>=-.014,`${direction}/${height}/${time}: ${lowest} reaches ${minimum} m`);
    }
  }
});

test('keeper palms face the secured ball while the wrists retain the collision contacts',async()=>{
  const c=await character('keeper-prototype',true);
  for(const direction of [-1,0,1])for(const time of [.4,.9,1.5,2.4]){
    const hold=holdingPose(goalkeeperPose({speed:85,reach:85},direction,time,1.2));c.pose(hold.pose);
    for(const [i,side] of ['L','R'].entries()){
      const hand=c.root.getObjectByName('hand'+side),position=hand.getWorldPosition(new THREE.Vector3());
      const palm=new THREE.Vector3(0,0,1).applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion()));
      const toward=new THREE.Vector3().copy(hold.center).sub(position).normalize();
      assert.ok(position.distanceTo(new THREE.Vector3().copy(hold.pose.hands[i]))<1e-6);
      assert.ok(palm.dot(toward)>.999,'palm wraps around the secured ball');
    }
  }
});

test('low catches blend continuously from the planted palm into the ball grip',async()=>{
  const c=await character('keeper-prototype',true);
  for(const direction of [-1,0,1])for(const time of [.35,.8,1.4,2.2]){
    const p=goalkeeperPose({speed:85,reach:85},direction,time,.35);
    c.pose(holdingPose(p,0).pose);const start=['L','R'].map(side=>c.root.getObjectByName('hand'+side).quaternion.clone());
    c.pose(holdingPose(p,.001).pose);
    for(const [i,side] of ['L','R'].entries())assert.ok(c.root.getObjectByName('hand'+side).quaternion.angleTo(start[i])<.001,'early grip preserves planted palm orientation');
  }
});

test('keeper skins stay connected, clear the ground and avoid bone flips through all save phases',async()=>{
  const c=await character('keeper-prototype',true),bones=[];
  c.root.traverse(bone=>{if(bone.isBone)bones.push(bone);});
  const anchors=[['upper_arm','shoulders'],['forearm','elbows'],['hand','hands'],['thigh','hips'],['shin','knees'],['foot','feet']]
    .flatMap(([name,key])=>['L','R'].map((side,index)=>({bone:bones.findIndex(b=>b.name===name+side),key,index})));
  const paths=[['warmup',keeperWarmupPose,12]];
  for(const speed of [50,99])for(const direction of [-1,0,1])for(const height of [.3,1.2,2.3])for(const stretch of [0,1]){
    const stats={speed,reach:99,stretch},dive=t=>goalkeeperPose(stats,direction,t,height);
    const ready=keeperPreparation(stats,direction,.8,.8,height),origin=dive(.10),previous=dive(.099);
    const saves=[
      ['dive',dive],['hold',t=>holdingPose(dive(t)).pose],['gather',t=>holdingPose(dive(t),t/HOLD_DURATION).pose],
      ['prepare',t=>t<.8?keeperPreparation(stats,direction,t,.8,height):blendKeeperPose(ready,dive(t-.8),(t-.8)/.13)],
      ['hesitate',t=>t<.10?dive(t):keeperHesitationPose(origin,direction,t-.10,previous)],
    ];
    for(const [path,poseAt] of saves)paths.push([`${speed}/${direction}/${height}/${stretch}/${path}`,poseAt,4]);
  }
  const catchStats={accuracy:90,power:90,touch:90,composure:90,speed:80,reach:80,handling:95};
  for(const seed of [16,18,59,87,95,134]){
    const shot=new Shot({x:Math.sin(seed)*3.3,power:(seed%10)/10,y:.3+(seed%7)/3},catchStats,catchStats,seed%3-1,seed);
    for(let frame=0;frame<3600&&!shot.result;frame++)shot.step(1/120);
    assert.ok(shot.caught,`catch ${seed} reaches the gather`);
    paths.push([`catch/${seed}`,t=>holdingPose(shot.poseAt(shot.t+t),t/HOLD_DURATION).pose,4]);
  }
  for(const [path,poseAt,duration] of paths){
    let last;
    for(let frame=0;frame<=duration*120;frame++){
      const time=frame/120,label=`${path}/${time}`,pose=poseAt(time);
      c.pose(pose);c.root.updateWorldMatrix(true,true);
      const current=bones.map(bone=>({position:bone.getWorldPosition(new THREE.Vector3()),rotation:bone.getWorldQuaternion(new THREE.Quaternion())}));
      for(const [i,bone] of bones.entries()){
        assert.ok(bone.matrixWorld.elements.every(Number.isFinite),`${label}: ${bone.name} remains finite`);
        assert.ok(bone.scale.toArray().every(value=>Math.abs(value-1)<1e-5),`${label}: ${bone.name} preserves scale`);
        if(last){
          assert.ok(current[i].rotation.angleTo(last[i].rotation)<.65,`${label}: ${bone.name} rotates continuously`);
          assert.ok(current[i].position.distanceTo(last[i].position)<.14,`${label}: ${bone.name} moves continuously`);
        }
      }
      for(const {bone,key,index} of anchors){
        const actual=current[bone].position,expected=pose[key][index];
        assert.ok(Math.hypot(actual.x-expected.x,actual.y-expected.y,actual.z-expected.z)<1e-5,`${label}: ${bones[bone].name} matches the physical joint`);
      }
      if(frame%12===0){const {minimum,lowest}=floor(c);assert.ok(minimum>=-.014,`${label}: ${lowest} clears turf (${minimum} m)`);}
      last=current;
    }
  }
});

test('game goalkeeper skin preserves physical endpoints in both directions',async()=>{
  const c=await character('keeper-prototype',true);
  for(const direction of [-1,1])for(let t=0;t<3.8;t+=.08){
    const p=goalkeeperPose({reach:80,speed:80},direction,t,2),before=structuredClone(p);
    c.pose(p);c.lookAt(new THREE.Vector3(0,1,5),1/60);c.root.updateWorldMatrix(true,true);
    for(const [i,side] of ['L','R'].entries())for(const [bone,key] of [['hand','hands'],['forearm','elbows'],['shin','knees'],['foot','feet']]){
      const actual=c.root.getObjectByName(bone+side).getWorldPosition(new THREE.Vector3());
      assert.ok(actual.distanceTo(new THREE.Vector3().copy(p[key][i]))<.001,`${bone+side} matches collision rig`);
    }
    assert.deepEqual(p,before,'visual animation preserves physics data');
  }
});


test('match and motion lab keep the same mesh and local bone pose with team-specific kits under different cameras',async()=>{
  for(const [asset,keeper] of [['keeper-prototype',true],['striker-mocap',false]]){
    const game=await character(asset,keeper),lab=await character(asset,keeper);
    const display=new THREE.Group();display.position.set(3,0,-11);display.rotation.y=Math.PI/2;display.add(lab.root);
    game.fallback={setColor(){}};lab.fallback={setColor(){}};
    game.setColor('#e9a068',1);lab.setColor('#b9efd7',11);
    const materials=root=>{const result=[];root.traverse(o=>{if(o.isMesh)result.push([o.geometry.attributes.position.count,o.material.name,o.material.name==='Kit'?null:o.material.color?.getHex()]);});return result;};
    assert.deepEqual(materials(game.root),materials(lab.root),'team colors preserve geometry and non-kit materials');
    for(const [actor,color] of [[game,'#e9a068'],[lab,'#b9efd7']])actor.root.traverse(o=>{if(o.isMesh&&o.material.name==='Kit')assert.equal(o.material.color.getHex(),new THREE.Color(color).getHex());});
    for(const t of [0,.18,.43,.62,1.47,1.85,2.4,3.33]){
      const pose=keeper?goalkeeperPose({reach:85,speed:85},1,t,2):strikerRunupPose(t,Math.min(1,t/KICK_CONTACT),t>=KICK_CONTACT?t-KICK_CONTACT:-1,.7,0);
      for(const actor of [game,lab]){
        actor.pose(pose);
        if(!keeper)actor.kick(Math.min(1,t/KICK_CONTACT),t>=KICK_CONTACT?t-KICK_CONTACT:null);
        actor.root.updateWorldMatrix(true,true);
      }
      game.root.traverse(bone=>{
        if(!bone.isBone)return;
        const reference=lab.root.getObjectByName(bone.name);
        const a=game.root.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
        const b=lab.root.worldToLocal(reference.getWorldPosition(new THREE.Vector3()));
        assert.ok(a.distanceTo(b)<1e-5,`${asset} ${bone.name} matches lab at ${t}`);
        assert.ok(bone.quaternion.clone().normalize().angleTo(reference.quaternion.clone().normalize())<1e-5,`${asset} ${bone.name} matches lab rotation at ${t}`);
      });
    }
  }
});

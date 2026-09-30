import test from 'node:test';
import assert from 'node:assert/strict';
import {gameKickTime,KICK_CONTACT} from '../src/game-character.js';
import {penaltyStyles} from '../src/anatomy.js';

test('all existing runup durations align mocap contact with ball release',()=>{
  for(const style of penaltyStyles){
    assert.equal(gameKickTime(style.duration/style.duration,null,style.duration),KICK_CONTACT);
    assert.equal(gameKickTime(1,0),KICK_CONTACT);
    assert.ok(Math.abs(gameKickTime((style.duration-.0001)/style.duration,null,style.duration)-gameKickTime(1,0))<.001);
    const gather=style.duration-.55,dt=.00001;
    const speed=(gameKickTime((gather+dt)/style.duration,null,style.duration)-gameKickTime((gather-dt)/style.duration,null,style.duration))/(2*dt);
    assert.ok(Math.abs(speed-1)<.001,'captured counter-swing joins the plant at native speed');
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
import {createStrikerMotion} from '../src/striker-motion.js';
import {strikerRunupPose,goalkeeperPose,holdingPose,body} from '../src/anatomy.js';

async function character(asset,keeper){
  const bytes=await readFile(new URL(`../assets/characters/${asset}.glb`,import.meta.url));
  const length=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+length));
  for(const m of json.materials){delete m.pbrMetallicRoughness?.baseColorTexture;delete m.pbrMetallicRoughness?.metallicRoughnessTexture;delete m.normalTexture;}
  bytes.fill(32,20,20+length);bytes.write(JSON.stringify(json),20);
  await MeshoptDecoder.ready;
  const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const c=Object.create(GameCharacter.prototype);c.root=gltf.scene;c.keeper=keeper;
  c.mixer=new THREE.AnimationMixer(c.root);c.actions=gltf.animations.map(clip=>c.mixer.clipAction(clip).setLoop(THREE.LoopOnce,1));
  c.apply=createKeeperSkinPose(c.root);c.relax=createKeeperArmRoll(c.root);if(!keeper)c.strikerMotion=createStrikerMotion(c.root);return c;
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
  c.kick(runup,after,style.duration);c.root.updateWorldMatrix(true,true);
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

test('rendered strikes retain support, shot-specific arcs and continuity when game runup resets at release',async()=>{
  const c=await character('striker-mocap',false),ball=new THREE.Vector3(0,.11,11),arcs={};
  for(const style of penaltyStyles)for(const power of [.2,.7,1])for(const x of [-3.5,0,3.5])for(const type of ['normal','low','chip']){
    const dt=.0001;
    strike(c,style.duration-dt,style,power,x,type);const before=joint(c,'footL');
    strike(c,style.duration,style,power,x,type);const at=joint(c,'footL'),support=joint(c,'footR');
    const tip=c.root.getObjectByName('footL').localToWorld(new THREE.Vector3(0,.23,0));
    assert.ok(Math.abs(tip.distanceTo(ball)-.11)<.02,`${style.name}/${power}/${x}/${type}: toe meets the near ball surface`);
    strike(c,style.duration+dt,style,power,x,type);const after=joint(c,'footL');
    assert.ok(at.distanceTo(before)<.005&&after.distanceTo(at)<.005,'ball release retains the striking ankle');
    assert.ok(before.clone().add(after).addScaledVector(at,-2).length()/dt<.05,'incoming and outgoing foot velocity join');
    for(const elapsed of [.04,.10,.22,.45,.70]){
      strike(c,style.duration+elapsed,style,power,x,type);
      assert.ok(joint(c,'footR').distanceTo(support)<1e-6,'support foot remains fixed through follow-through');
      for(const side of ['L','R'])for(const [a,b,length] of [['upper_arm','forearm',body.upperArm],['forearm','hand',body.forearm],['thigh','shin',body.thigh],['shin','foot',body.shin]])
        assert.ok(Math.abs(joint(c,a+side).distanceTo(joint(c,b+side))-length)<1e-5,'adapted limbs retain their lengths');
      if(style===penaltyStyles[0]&&power===.7&&x===0&&elapsed===.10)arcs[type]=joint(c,'footL');
    }
  }
  assert.ok(arcs.normal.y-arcs.low.y>.1,'low drives keep a lower follow-through');
  assert.ok(arcs.chip.z-arcs.normal.z>.15,'chips finish with a shorter swing');
  const starts=penaltyStyles.map(style=>{strike(c,0,style);return joint(c,'pelvis');});
  assert.ok(starts[0].distanceTo(starts[1])>.2&&starts[0].distanceTo(starts[2])>.1,'runup styles retain distinct approaches');
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
        assert.ok(bone.quaternion.clone().normalize().angleTo(reference.quaternion.clone().normalize())<1e-5);
      });
    }
  }
});

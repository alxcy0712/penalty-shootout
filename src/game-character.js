import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
import {Player} from './character.js';
import {createKeeperSkinPose} from './keeper-skin-pose.js';
import {createKeeperArmRoll} from './keeper-arm-roll.js';
import {createKeeperHandContact} from './keeper-hand-contact.js';
import {createStrikerKickStyle} from './striker-kick-style.js';

// The source annotation rounds contact to 1.85 s. The fitted visible boot
// reaches the 11 cm ball at 1.8467 s; align release to the actual skin.
export const KICK_CONTACT=1.8467;
export function gameKickTime(runup,after=null){return after===null?KICK_CONTACT*THREE.MathUtils.clamp(runup,0,1):Math.min(3.5,KICK_CONTACT+Math.max(0,after));}

const assets=new Map();
function loadAsset(url){
  if(!assets.has(url))assets.set(url,new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url).catch(error=>{assets.delete(url);throw error;}));
  return assets.get(url);
}

export class GameCharacter {
  constructor(scene,color,keeper=false){
    this.group=new THREE.Group();scene.add(this.group);this.keeper=keeper;
    this.fallback=new Player(this.group,color,keeper);this.color=color;this.number=keeper?1:11;
    this.ready=this.load().catch(error=>{
      this.root?.removeFromParent();this.root=null;this.mixer?.stopAllAction();
      this.fallback.group.visible=true;if(this.lastPose)this.fallback.pose(this.lastPose);
      console.warn('人物资源加载失败，使用程序模型',error);return false;
    });
  }
  async load(){
    const url=this.keeper?new URL('../assets/characters/keeper-prototype.glb',import.meta.url):new URL('../assets/characters/striker-mocap.glb',import.meta.url);
    const gltf=await loadAsset(url.href);
    const root=cloneSkeleton(gltf.scene);
    const required=['pelvis','spine','chest','neck','head',...['L','R'].flatMap(side=>['clavicle','upper_arm','forearm','hand','thigh','shin','foot','toe'].map(name=>name+side))];
    if(required.some(name=>!root.getObjectByName(name))||(!this.keeper&&!gltf.animations.length))throw new Error('人物资产缺少必要骨骼或射门片段');
    this.root=root;
    // Each character owns its kit; skeletons and materials cannot leak between teams.
    const materials=new Map();
    this.root.traverse(o=>{if(o.isMesh){const copy=m=>{if(!materials.has(m))materials.set(m,m.clone());return materials.get(m);};o.material=Array.isArray(o.material)?o.material.map(copy):copy(o.material);}});
    this.group.add(this.root);
    this.root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;if(o.isSkinnedMesh)o.frustumCulled=false;}});
    this.apply=createKeeperSkinPose(this.root,{shoulderSupport:this.keeper});this.relax=createKeeperArmRoll(this.root);
    if(!this.keeper)this.kickStyle=createStrikerKickStyle(this.root);
    this.mixer=new THREE.AnimationMixer(this.root);
    this.actions=gltf.animations.map(c=>{const a=this.mixer.clipAction(c);a.setLoop(THREE.LoopOnce,1);a.clampWhenFinished=true;a.paused=true;return a;});
    const number=this.fallback.number.clone();number.material=this.fallback.number.material.clone();
    let skeleton;this.root.traverse(o=>{if(o.isSkinnedMesh)skeleton??=o.skeleton;});
    const index=skeleton.bones.findIndex(b=>b.name==='chest'),inverse=skeleton.boneInverses[index];
    number.position.set(0,1.345,-.18).applyMatrix4(inverse);number.quaternion.setFromRotationMatrix(inverse);number.rotateY(Math.PI);number.scale.set(.7,.5,1);skeleton.bones[index].add(number);
    this.fallback.group.visible=false;this.setColor(this.color,this.number);
    if(this.lastMode==='kick'&&this.lastKick)this.kick(...this.lastKick);
    else if(this.lastPose)this.pose(this.lastPose);
    return true;
  }
  setColor(color,number=11){
    this.color=color;this.number=number;this.fallback.setColor(color,number);
    this.root?.traverse(o=>{if(o.isMesh&&o.material.name==='Kit')o.material.color.set(color);});
  }
  pose(p){
    this.lastPose=p;this.lastMode='pose';this.gazeBase=null;
    if(!this.root){this.fallback.pose(p);return;}
    this.mixer.stopAllAction();this.root.position.set(0,0,0);this.root.rotation.set(0,0,0);
    let target=p;
    if(!this.keeper){
      target={...p,right:{x:-p.right.x,y:-p.right.y,z:-p.right.z}};
      for(const key of ['shoulders','hips','elbows','hands','knees','feet'])target[key]=[p[key][1],p[key][0]];
    }
    this.apply(target);this.relax();
    if(this.keeper){this.handContact??=createKeeperHandContact(this.root);this.handContact(target);}
  }
  kick(runup,after=null,options={}){
    this.lastMode='kick';this.lastKick=[runup,after,options];
    if(options.pose)this.lastPose=options.pose;
    if(!this.root){if(this.lastPose)this.fallback.pose(this.lastPose);return;}
    const angle=Math.atan2(THREE.MathUtils.clamp(options.targetX??0,-5,5),11);
    // Rotate the complete approach around the ball, preserving the planted
    // support foot and the contact surface for left, centre and right shots.
    this.root.position.set(0,0,11);this.root.rotation.set(0,Math.PI-angle,0);
    if(this.gazeBase)this.root.getObjectByName('head').quaternion.copy(this.gazeBase);
    this.gazeBase=null;
    this.kickStyle?.restore?.();
    const action=this.actions[0];action.play();action.paused=true;action.time=gameKickTime(runup,after);this.mixer.update(0);
    this.kickStyle??=createStrikerKickStyle(this.root);this.kickStyle(after,options);
  }
  lookAt(target,dt){
    if(!this.root){this.fallback.lookAt(target,dt);return;}
    const head=this.root.getObjectByName('head');
    this.gazeBase??=head.quaternion.clone();head.quaternion.copy(this.gazeBase);head.updateWorldMatrix(true,false);
    const local=head.worldToLocal(new THREE.Vector3().copy(target));
    const blend=1-Math.exp(-Math.max(0,dt)*12);
    this.yaw=(this.yaw??0)+(THREE.MathUtils.clamp(Math.atan2(local.x,local.z),-.35,.35)-(this.yaw??0))*blend;
    this.pitch=(this.pitch??0)+(THREE.MathUtils.clamp(-Math.atan2(local.y,Math.hypot(local.x,local.z)),-.18,.18)-(this.pitch??0))*blend;
    head.rotateY(this.yaw);head.rotateX(this.pitch);
  }
}

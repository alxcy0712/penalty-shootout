import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
import {Player} from './character.js';
import {createKeeperSkinPose,updateKeeperShoulderSupport} from './keeper-skin-pose.js';
import {createKeeperArmRoll} from './keeper-arm-roll.js';
import {createKeeperHandContact} from './keeper-hand-contact.js';
import {createStrikerKickStyle} from './striker-kick-style.js';
import {createStrikerArmClearance} from './striker-arm-clearance.js';
import {RUNUP_CONTACT,runupClipTime,createStrikerRunupStyle} from './striker-runup-style.js';

// The source annotation rounds contact to 1.85 s. The fitted visible boot
// reaches the 11 cm ball at 1.8467 s; align release to the actual skin.
export const KICK_CONTACT=RUNUP_CONTACT;
export function gameKickTime(runup,after=null,style=null){
  if(style?.capture){const clip=style.capture;return after===null?clip.contactSeconds*THREE.MathUtils.clamp(runup,0,1):Math.min(clip.durationSeconds,clip.contactSeconds+Math.max(0,after));}
  return after===null?(style?runupClipTime(runup,style):KICK_CONTACT*THREE.MathUtils.clamp(runup,0,1)):Math.min(3.5,KICK_CONTACT+Math.max(0,after));}

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
    const [gltf,extra]=await Promise.all([loadAsset(url.href),this.keeper?Promise.resolve([]):loadAsset(new URL('../assets/characters/mocap-variants/cmu-10_03-kick.glb',import.meta.url).href).then(asset=>asset.animations).catch(error=>{console.warn('紧凑射门片段加载失败，使用基础动作',error);return [];})]);
    if(!this.keeper)this.variantReady=extra.some(clip=>clip.name==='CMU_10_03_Kick');
    const root=cloneSkeleton(gltf.scene);
    const required=['pelvis','spine','chest','neck','head',...['L','R'].flatMap(side=>['clavicle','upper_arm','forearm','hand','thigh','shin','foot','toe'].map(name=>name+side))];
    if(required.some(name=>!root.getObjectByName(name))||(!this.keeper&&!gltf.animations.length))throw new Error('人物资产缺少必要骨骼或射门片段');
    this.root=root;
    // Each character owns its kit; skeletons and materials cannot leak between teams.
    const materials=new Map();
    this.root.traverse(o=>{if(o.isMesh){const copy=m=>{if(!materials.has(m))materials.set(m,m.clone());return materials.get(m);};o.material=Array.isArray(o.material)?o.material.map(copy):copy(o.material);}});
    this.group.add(this.root);
    this.root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;if(o.isSkinnedMesh)o.frustumCulled=false;}});
    this.apply=createKeeperSkinPose(this.root,{shoulderSupport:true});this.relax=createKeeperArmRoll(this.root);
    if(!this.keeper)this.kickStyle=createStrikerKickStyle(this.root);
    this.mixer=new THREE.AnimationMixer(this.root);
    this.actions=[...gltf.animations,...extra].map(c=>{const a=this.mixer.clipAction(c);a.setLoop(THREE.LoopOnce,1);a.clampWhenFinished=true;a.paused=true;return a;});
    const number=this.fallback.number.clone();number.material=this.fallback.number.material.clone();
    let skeleton;this.root.traverse(o=>{if(o.isSkinnedMesh)skeleton??=o.skeleton;});
    const index=skeleton.bones.findIndex(b=>b.name==='chest'),inverse=skeleton.boneInverses[index];
    number.position.set(0,1.345,-.18).applyMatrix4(inverse);number.quaternion.setFromRotationMatrix(inverse);number.rotateY(Math.PI);number.scale.set(.7,.5,1);skeleton.bones[index].add(number);
    this.fallback.group.visible=false;this.setColor(this.color,this.number);
    if(this.lastMode==='capture'&&this.lastCapture)this.capture(...this.lastCapture);
    else if(this.lastMode==='kick'&&this.lastKick)this.kick(...this.lastKick);
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
    this.armClearance?.restore?.();this.kickStyle?.restore?.();this.runupStyle?.restore?.();
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
    const previousMode=this.lastMode;this.lastMode='kick';this.lastKick=[runup,after,options];
    if(options.pose)this.lastPose=options.pose;
    if(!this.root){if(this.lastPose)this.fallback.pose(this.lastPose);return;}
    const angle=Math.atan2(THREE.MathUtils.clamp(options.targetX??0,-5,5),11);
    // Rotate the complete approach around the ball, preserving the planted
    // support foot and the contact surface for left, centre and right shots.
    this.root.position.set(0,0,11);this.root.rotation.set(0,Math.PI-angle,0);
    if(this.gazeBase)this.root.getObjectByName('head').quaternion.copy(this.gazeBase);
    this.gazeBase=null;
    this.armClearance?.restore?.();
    this.kickStyle?.restore?.();
    this.runupStyle?.restore?.();
    const captured=options.style?.capture;
    const action=(captured?this.actions.find(action=>action.getClip().name===captured.clipName):null)??this.actions[0];
    if(previousMode!=='kick'||this.currentKickAction!==action){this.mixer.stopAllAction();this.currentKickAction=action;}
    const isCompact=!!captured&&action.getClip().name===captured.clipName;
    // The crop, contact and spatial adaptation were audited for CMU 10_01.
    // A new captured source must use its own calibration, never these constants.
    const legacy=action.getClip().name==='CMU_10_01_Runup_Kick_Recovery';
    const sourceStyle=legacy&&!captured?options.style:null;
    action.play();action.paused=true;action.time=gameKickTime(runup,after,isCompact?options.style:sourceStyle);this.mixer.update(0);
    this.runupStyle??=createStrikerRunupStyle(this.root);this.runupStyle(runup,after,{...options,style:sourceStyle});
    if(isCompact)this.root.rotation.set(0,Math.PI+(captured.heading??0),0);
    if(legacy){this.kickStyle??=createStrikerKickStyle(this.root);this.kickStyle(after,options);}
    this.armClearance??=createStrikerArmClearance(this.root);this.armClearance(action.time,action.getClip().name);
    this.root.updateMatrixWorld(true);updateKeeperShoulderSupport(this.root);
  }
  capture(time,index=0){
    this.lastMode='capture';this.lastCapture=[time,index];this.gazeBase=null;
    if(!this.root||!this.actions?.[index]){if(this.lastPose)this.fallback?.pose(this.lastPose);return false;}
    this.armClearance?.restore?.();this.kickStyle?.restore?.();this.runupStyle?.restore?.();this.mixer.stopAllAction();
    this.root.position.set(0,0,0);this.root.rotation.set(0,0,0);
    const action=this.actions[index];action.play();action.paused=true;action.time=THREE.MathUtils.clamp(time,0,action.getClip().duration);this.mixer.update(0);this.root.updateMatrixWorld(true);updateKeeperShoulderSupport(this.root);return true;
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

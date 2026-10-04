import * as THREE from 'three';
import {recoveryAfterTime} from './striker-recovery-clock.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
import {Player} from './character.js';
import {createCharacterAssetCache,assetError} from './character-asset-cache.js';
import {disposeCharacterAsset,disposeCharacterRuntime} from './character-resources.js';
import {createKeeperSkinPose,updateKeeperShoulderSupport} from './keeper-skin-pose.js';
import {createKeeperArmRoll} from './keeper-arm-roll.js';
import {createKeeperHandContact} from './keeper-hand-contact.js';
import {createKeeperFingerGrip} from './keeper-finger-grip.js';
import {createStrikerKickStyle} from './striker-kick-style.js';
import {createStrikerArmClearance} from './striker-arm-clearance.js';
import {RUNUP_CONTACT,runupClipTime,runupOnsetTime,createStrikerRunupStyle} from './striker-runup-style.js';

// The source annotation rounds contact to 1.85 s. The fitted visible boot
// reaches the 11 cm ball at 1.8467 s; align release to the actual skin.
export const KICK_CONTACT=RUNUP_CONTACT;
// Keep the same source clock for the mixer and its calibrated finish overlay.
// Raw/native playback retains its original timing for capture inspection.
export function gameKickAfterTime(after,style=null){
  if(after===null||!style)return after;
  return recoveryAfterTime(after,style.capture?.contactSeconds??KICK_CONTACT,style.capture?.durationSeconds??3.5);
}
export function gameKickTime(runup,after=null,style=null){
  after=gameKickAfterTime(after,style);
  if(style?.capture){const clip=style.capture;return after===null?runupOnsetTime(clip.contactSeconds*THREE.MathUtils.clamp(runup,0,1)):Math.min(clip.durationSeconds,clip.contactSeconds+Math.max(0,after));}
  return after===null?(style?runupClipTime(runup,style):KICK_CONTACT*THREE.MathUtils.clamp(runup,0,1)):Math.min(3.5,KICK_CONTACT+Math.max(0,after));}

const characterAssets=createCharacterAssetCache({
  load:(url,{signal})=>{
    // A private manager cancels this request without aborting other characters'
    // sources. Older browsers/decoder work still rely on the stale-result guard.
    const manager=new THREE.LoadingManager(),abort=()=>manager.abort();
    signal.addEventListener('abort',abort,{once:true});
    return new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder).loadAsync(url).finally(()=>signal.removeEventListener('abort',abort));
  },
  dispose:disposeCharacterAsset
});
const keeperUrl=new URL('../assets/characters/keeper-prototype.glb',import.meta.url).href;
const strikerUrl=new URL('../assets/characters/striker-mocap.glb',import.meta.url).href;
const primaryUrl=keeper=>keeper?keeperUrl:strikerUrl;
const compactUrl=new URL('../assets/characters/mocap-variants/cmu-10_03-kick.glb',import.meta.url).href;
const failureInfo=(error,asset)=>Object.freeze({asset,code:error?.code??'load',message:error?.code==='timeout'?'人物资源加载超时':error?.code==='busy'?'上次人物资源仍在处理，请稍后重试':'人物资源加载失败'});
const runtimeFields=['root','mixer','actions','apply','relax','fingerGrip','kickStyle','handContact','armClearance',
  'runupStyle','currentKickAction','gazeBase','variantReady','lastMode','lastKick','lastCapture','lastPose'];

export class GameCharacter {
  constructor(scene,color,keeper=false,{assetCache=characterAssets,fallbackFactory=(group,color,keeper)=>new Player(group,color,keeper)}={}){
    this.group=new THREE.Group();scene.add(this.group);this.keeper=keeper;
    this.fallback=fallbackFactory(this.group,color,keeper);this.color=color;this.number=keeper?1:11;
    this._assetCache=assetCache;
    if(this.load===GameCharacter.prototype.load)this.load();else this._loadLegacyOverride();
  }
  _ensureAssetLifecycle(){
    if(this._assetListeners)return;
    this._assetCache??=characterAssets;this._assetListeners=new Set();this._assetGeneration=0;
    this.assetStatus=Object.freeze({state:'loading',attempt:0,usingFallback:!this.root,error:null,optionalFailures:Object.freeze([]),canRetry:false});
  }
  _setAssetStatus(state,{error=null,optionalFailures=[]}={}){
    this.assetStatus=Object.freeze({state,attempt:this._assetGeneration,usingFallback:!this.root,error,
      optionalFailures:Object.freeze([...optionalFailures]),canRetry:state==='error'||state==='degraded'});
    for(const listener of [...this._assetListeners]){
      try{listener(this.assetStatus);}catch(error){console.warn('人物资源状态监听失败',error);}
    }
  }
  subscribeAssets(listener){
    this._ensureAssetLifecycle();this._assetListeners.add(listener);listener(this.assetStatus);
    return ()=>this._assetListeners.delete(listener);
  }
  load(){
    this._ensureAssetLifecycle();
    if(this._disposed)return Promise.resolve(false);
    if(this._loadPromise)return this._loadPromise;
    if(this.assetStatus.state==='ready')return this.ready;
    const generation=++this._assetGeneration;
    this.ready=this._loadPromise=Promise.resolve().then(()=>this._loadAssetAttempt(generation)).finally(()=>{
      if(generation===this._assetGeneration)this._loadPromise=null;
    });
    this._setAssetStatus('loading');return this.ready;
  }
  // Older integrations override load() directly. Keep their constructor failure
  // recovery without wrapping the default path or changing its promise identity.
  _loadLegacyOverride(){
    this._ensureAssetLifecycle();
    if(this._disposed)return Promise.resolve(false);
    if(this._legacyLoadPromise)return this._legacyLoadPromise;
    if(this.assetStatus.state==='ready')return this.ready;
    const previous=this._runtime,bindings=Object.fromEntries(runtimeFields.slice(0,-4).map(key=>[key,this[key]]));
    const recover=error=>{
      if(this._runtime!==previous)disposeCharacterRuntime(this._runtime);
      if(this.root!==bindings.root)this.root?.removeFromParent();
      if(this.mixer!==bindings.mixer){this.mixer?.stopAllAction();if(this.root)this.mixer?.uncacheRoot(this.root);}
      if(this._disposed){this.root=null;return false;}
      if(previous?.disposed){
        for(const key of Object.keys(bindings))this[key]=null;this.actions=[];this._runtime=null;
      }else{Object.assign(this,bindings);this.root??=null;this._runtime=previous;}
      this.fallback.group.visible=!this.root;
      if(!this.root&&this.lastPose)this.fallback.pose(this.lastPose);
      this._setAssetStatus('error',{error:failureInfo(error,'primary')});return false;
    };
    this._assetGeneration++;
    this.ready=this._legacyLoadPromise=Promise.resolve().then(()=>{
      if(this._disposed)return false;
      const result=this.load();
      // An override may delegate to super.load(), which sets ready itself.
      this.ready=this._legacyLoadPromise;return result;
    }).then(result=>{
      if(this._disposed)return recover(assetError('disposed','人物已释放'));
      if(this.assetStatus.state==='loading')this._setAssetStatus(result===false?'error':'ready');
      return result;
    },recover).finally(()=>{this._legacyLoadPromise=null;});
    this._setAssetStatus('loading');return this.ready;
  }
  retryAssets(){return this.load===GameCharacter.prototype.load?this.load():this._loadLegacyOverride();}
  async _loadAssetAttempt(generation){
    let primary,compact,runtime,previousFields;
    const url=primaryUrl(this.keeper),current=()=>!this._disposed&&generation===this._assetGeneration;
    try{
      if(!current())return false;
      // Both requests settle within the cache deadline, even if the network or
      // decoder never responds. No partially initialized skin becomes visible.
      [primary,compact]=await Promise.allSettled([
        this._assetCache.acquire(url),
        this.keeper?Promise.resolve(null):this._assetCache.acquire(compactUrl)
      ]);
      const leases=[primary,compact].filter(result=>result.status==='fulfilled'&&result.value).map(result=>result.value);
      if(!current()){for(const lease of leases)lease.release();return false;}
      if(primary.status==='rejected'){for(const lease of leases)lease.release();throw primary.reason;}
      const optionalFailures=[];
      let extra=[];
      if(!this.keeper){
        if(compact.status==='fulfilled'&&compact.value.asset.animations?.some(clip=>clip.name==='CMU_10_03_Kick'))extra=compact.value.asset.animations;
        else{
          const error=compact.status==='rejected'?compact.reason:assetError('invalid','紧凑射门片段缺失');
          optionalFailures.push(failureInfo(error,'compact'));
          if(compact.status==='fulfilled')this._assetCache.invalidate(compactUrl,compact.value.asset);
        }
      }
      try{runtime=this._createRuntime(primary.value.asset,extra,leases);}catch(error){
        this._assetCache.invalidate(url,primary.value.asset);throw error;
      }
      // Prepare first, then replace exactly one root. Keep all remembered motion
      // inputs and colors; helpers bind to the new skeleton on each generation.
      const previous=this._runtime;
      previousFields=Object.fromEntries(runtimeFields.map(key=>[key,this[key]]));
      Object.assign(this,{root:runtime.root,mixer:runtime.mixer,actions:runtime.actions,apply:runtime.apply,
        relax:runtime.relax,fingerGrip:runtime.fingerGrip,kickStyle:runtime.kickStyle,
        handContact:null,armClearance:null,runupStyle:null,currentKickAction:null,gazeBase:null,
        variantReady:extra.some(clip=>clip.name==='CMU_10_03_Kick')});
      // Replay under the real parent transform, but keep the candidate hidden
      // until it succeeds. A failed replay can restore every previous binding.
      const visible=runtime.root.visible;runtime.root.visible=false;this.group.add(runtime.root);
      this.setColor(this.color,this.number);
      if(this.lastMode==='capture'&&this.lastCapture)this.capture(...this.lastCapture);
      else if(this.lastMode==='kick'&&this.lastKick)this.kick(...this.lastKick);
      else if(this.lastPose)this.pose(this.lastPose);
      if(!current()){disposeCharacterRuntime(runtime);return false;}
      this._runtime=runtime;runtime.root.visible=visible;disposeCharacterRuntime(previous);
      this.fallback.group.visible=false;
      this._setAssetStatus(optionalFailures.length?'degraded':'ready',{optionalFailures});
      return true;
    }catch(error){
      disposeCharacterRuntime(runtime);
      if(!current())return false;
      if(previousFields)Object.assign(this,previousFields);
      this.fallback.group.visible=!this.root;
      if(!this.root&&this.lastPose)this.fallback.pose(this.lastPose);
      this._setAssetStatus('error',{error:failureInfo(error,'primary')});return false;
    }
  }
  _createRuntime(gltf,extra,leases){
    const runtime={leases,materials:new Set(),skeletons:new Set(),geometries:new Set()};
    const sourceGeometries=new Set();
    const collect=()=>runtime.root?.traverse(object=>{
      if(object.isSkinnedMesh)runtime.skeletons.add(object.skeleton);
      if(object.geometry&&!sourceGeometries.has(object.geometry)&&object.geometry!==this.fallback.number.geometry)runtime.geometries.add(object.geometry);
    });
    try{
      const root=runtime.root=cloneSkeleton(gltf.scene);
      root.traverse(object=>{if(object.geometry)sourceGeometries.add(object.geometry);});collect();
      const required=['pelvis','spine','chest','neck','head',...['L','R'].flatMap(side=>['clavicle','upper_arm','forearm','hand','thigh','shin','foot','toe'].map(name=>name+side))];
      const skeleton=[...runtime.skeletons][0],index=skeleton?.bones.findIndex(b=>b.name==='chest');
      if(required.some(name=>!root.getObjectByName(name))||!skeleton||index<0||(!this.keeper&&!gltf.animations?.length))throw assetError('invalid','人物资产缺少必要骨骼或射门片段');
      // Geometry and textures stay cache-owned. Every cloned material and
      // skeleton is owned by this runtime, including its jersey number.
      const materials=new Map();
      root.traverse(object=>{if(object.isMesh){
        const copy=material=>{if(!materials.has(material)){const clone=material.clone();materials.set(material,clone);runtime.materials.add(clone);}return materials.get(material);};
        object.material=Array.isArray(object.material)?object.material.map(copy):copy(object.material);
        object.castShadow=true;object.receiveShadow=true;if(object.isSkinnedMesh)object.frustumCulled=false;
      }});
      runtime.apply=createKeeperSkinPose(root,{shoulderSupport:true});collect();runtime.relax=createKeeperArmRoll(root);
      if(this.keeper){runtime.fingerGrip=createKeeperFingerGrip(root);collect();}
      else runtime.kickStyle=createStrikerKickStyle(root);
      runtime.mixer=new THREE.AnimationMixer(root);
      runtime.actions=[...gltf.animations,...extra].map(clip=>{const action=runtime.mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.paused=true;return action;});
      const number=this.fallback.number.clone();number.material=this.fallback.number.material.clone();runtime.materials.add(number.material);
      const inverse=skeleton.boneInverses[index];
      number.position.set(0,1.345,-.18).applyMatrix4(inverse);number.quaternion.setFromRotationMatrix(inverse);number.rotateY(Math.PI);number.scale.set(.7,.5,1);skeleton.bones[index].add(number);
      return runtime;
    }catch(error){collect();disposeCharacterRuntime(runtime);throw error;}
  }
  dispose(){
    this._ensureAssetLifecycle();if(this._disposed)return;
    this._disposed=true;this._assetGeneration++;
    disposeCharacterRuntime(this._runtime);this._runtime=null;this.root=null;this.mixer=null;this.actions=[];
    this.apply=this.relax=this.fingerGrip=this.kickStyle=this.handContact=this.armClearance=this.runupStyle=this.currentKickAction=this.gazeBase=null;
    this.fallback.dispose?.();this.group.removeFromParent();this._setAssetStatus('disposed');this._assetListeners.clear();
  }
  setColor(color,number=11){
    if(this._disposed)return;
    this.color=color;this.number=number;this.fallback.setColor(color,number);
    this.root?.traverse(o=>{if(o.isMesh&&o.material.name==='Kit')o.material.color.set(color);});
  }
  pose(p){
    if(this._disposed)return;
    this.lastPose=p;this.lastMode='pose';this.gazeBase=null;
    if(!this.root){this.fallback.pose(p);return;}
    this.armClearance?.restore?.();this.kickStyle?.restore?.();this.runupStyle?.restore?.();
    this.mixer.stopAllAction();this.root.position.set(0,0,0);this.root.rotation.set(0,0,0);
    let target=p;
    if(!this.keeper){
      target={...p,right:{x:-p.right.x,y:-p.right.y,z:-p.right.z}};
      for(const key of ['shoulders','hips','elbows','hands','knees','feet'])target[key]=[p[key][1],p[key][0]];
    }
    this.apply(target);this.relax(true);
    if(this.keeper){
      this.handContact??=createKeeperHandContact(this.root);this.handContact(target,true);
      this.fingerGrip??=createKeeperFingerGrip(this.root);this.fingerGrip(target);
    }
  }
  kick(runup,after=null,options={}){
    if(this._disposed)return;
    this.fingerGrip?.(null);
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
    if(legacy){this.kickStyle??=createStrikerKickStyle(this.root);this.kickStyle(gameKickAfterTime(after,sourceStyle),options);}
    this.armClearance??=createStrikerArmClearance(this.root);this.armClearance(action.time,action.getClip().name);
    this.root.updateMatrixWorld(true);updateKeeperShoulderSupport(this.root);
  }
  capture(time,index=0){
    if(this._disposed)return false;
    this.fingerGrip?.(null);
    this.lastMode='capture';this.lastCapture=[time,index];this.gazeBase=null;
    if(!this.root||!this.actions?.[index]){if(this.lastPose)this.fallback?.pose(this.lastPose);return false;}
    this.armClearance?.restore?.();this.kickStyle?.restore?.();this.runupStyle?.restore?.();this.mixer.stopAllAction();
    this.root.position.set(0,0,0);this.root.rotation.set(0,0,0);
    const action=this.actions[index];action.play();action.paused=true;action.time=THREE.MathUtils.clamp(time,0,action.getClip().duration);this.mixer.update(0);this.root.updateMatrixWorld(true);updateKeeperShoulderSupport(this.root);return true;
  }
  lookAt(target,dt){
    if(this._disposed)return;
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

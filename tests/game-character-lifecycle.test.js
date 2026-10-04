import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {GameCharacter} from '../src/game-character.js';
import {createCharacterAssetCache} from '../src/character-asset-cache.js';
import {disposeCharacterAsset} from '../src/character-resources.js';
import {penaltyStyles,strikerRunupPose,goalkeeperPose} from '../src/anatomy.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
async function readAsset(name){
  const bytes=await readFile(new URL(`../assets/characters/${name}.glb`,import.meta.url));
  const len=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+len));
  for(const material of json.materials??[]){delete material.pbrMetallicRoughness?.baseColorTexture;delete material.pbrMetallicRoughness?.metallicRoughnessTexture;delete material.normalTexture;}
  bytes.fill(32,20,20+len);bytes.write(JSON.stringify(json),20);await MeshoptDecoder.ready;
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
}
function fallbackFactory(parent){
  const group=new THREE.Group(),number=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshBasicMaterial());parent.add(group);group.add(number);
  return {group,number,setColor(color,number){this.color=color;this.jerseyNumber=number;},pose(p){this.lastPose=p;},lookAt(){},dispose(){this.disposeCount=(this.disposeCount??0)+1;number.material.dispose();number.geometry.dispose();group.removeFromParent();}};
}
const makeActor=(assetCache,keeper=false)=>new GameCharacter(new THREE.Scene(),'#b9efd7',keeper,{assetCache,fallbackFactory});
const isCompact=url=>url.includes('mocap-variants');

test('primary failure visibly preserves fallback and the latest pose, then deduped retry installs one actor',async()=>{
  const source=await readAsset('striker-mocap'),extra=await readAsset('mocap-variants/cmu-10_03-kick'),first=deferred();let primaries=0;
  const cache=createCharacterAssetCache({load:url=>isCompact(url)?extra:++primaries===1?first.promise:source});
  const actor=makeActor(cache),states=[],unsubscribe=actor.subscribeAssets(status=>states.push(status));
  const pose=strikerRunupPose(0,1,0,.7,0);actor.pose(pose);actor.setColor('#e9a068',17);
  assert.equal(actor.assetStatus.state,'loading');assert.equal(actor.retryAssets(),actor.ready);
  first.reject(new Error('simulated network failure'));assert.equal(await actor.ready,false);
  assert.equal(actor.assetStatus.state,'error');assert.equal(actor.assetStatus.usingFallback,true);assert.equal(actor.assetStatus.canRetry,true);
  assert.equal(actor.fallback.lastPose,pose);assert.equal(actor.fallback.group.visible,true);assert.equal(actor.group.children.length,1);
  const retry=actor.retryAssets();assert.equal(retry,actor.retryAssets());assert.equal(retry,actor.load());assert.equal(await retry,true);
  assert.equal(primaries,2);assert.equal(actor.assetStatus.state,'ready');assert.equal(actor.assetStatus.attempt,2);assert.equal(actor.assetStatus.usingFallback,false);
  assert.equal(actor.group.children.length,2);assert.equal(actor.fallback.group.visible,false);assert.equal(actor.lastMode,'pose');
  actor.root.traverse(object=>{if(object.isMesh&&object.material.name==='Kit')assert.equal(object.material.color.getHexString(),'e9a068');});
  assert.equal(actor.fallback.jerseyNumber,17);assert.deepEqual(states.map(state=>state.state),['loading','error','loading','ready']);
  assert.ok(states.every(Object.isFrozen));assert.ok(Object.isFrozen(actor.assetStatus.optionalFailures));
  unsubscribe();actor.dispose();assert.equal(states.length,4);assert.equal(actor.assetStatus.state,'disposed');cache.dispose();
});

test('legacy load overrides recover synchronous partial failure and can retry by delegating to the base loader',async()=>{
  const source=await readAsset('keeper-prototype');let attempts=0;
  const cache=createCharacterAssetCache({load:()=>source});
  class LegacyCharacter extends GameCharacter {
    load(){
      if(++attempts===1){this.root=new THREE.Group();this.group.add(this.root);this.fallback.group.visible=false;throw new Error('legacy synchronous rig failure');}
      return super.load();
    }
  }
  const actor=new LegacyCharacter(new THREE.Scene(),'#b9efd7',true,{assetCache:cache,fallbackFactory});
  const pose=goalkeeperPose({reach:80,speed:80},1,.5,2);actor.pose(pose);
  assert.equal(await actor.ready,false);assert.equal(actor.root,null);assert.equal(actor.group.children.length,1);
  assert.equal(actor.assetStatus.state,'error');assert.equal(actor.fallback.group.visible,true);assert.equal(actor.fallback.lastPose,pose);
  const retry=actor.retryAssets();assert.equal(retry,actor.retryAssets());assert.equal(retry,actor.ready);
  assert.equal(await retry,true);assert.equal(actor.ready,retry);assert.equal(actor.assetStatus.state,'ready');assert.equal(actor.group.children.length,2);
  actor.dispose();cache.dispose();
});

test('optional compact failure is degraded and retry preserves the last kick, source isolation, and ownership',async()=>{
  const source=await readAsset('striker-mocap'),extra=await readAsset('mocap-variants/cmu-10_03-kick');let compactLoads=0,primaryLoads=0,sourceDisposals=0;
  source.scene.traverse(object=>{if(object.geometry)object.geometry.addEventListener('dispose',()=>sourceDisposals++);});
  const cache=createCharacterAssetCache({load:url=>{if(!isCompact(url)){primaryLoads++;return source;}if(++compactLoads===1)throw new Error('optional offline');return extra;},dispose:disposeCharacterAsset});
  const actor=makeActor(cache);actor.kick(.5,null,{style:penaltyStyles[3]});assert.equal(await actor.ready,true);
  assert.equal(actor.assetStatus.state,'degraded');assert.equal(actor.assetStatus.optionalFailures[0].asset,'compact');assert.equal(actor.variantReady,false);
  const previous=actor.root,owned=actor._runtime;let ownedDisposals=0;
  for(const resource of [...owned.materials,...owned.geometries])resource.addEventListener('dispose',()=>ownedDisposals++);
  const second=makeActor(cache);assert.equal(await second.ready,true);assert.equal(primaryLoads,1);
  assert.equal(await actor.retryAssets(),true);assert.equal(actor.assetStatus.state,'ready');assert.equal(actor.variantReady,true);
  assert.equal(actor.currentKickAction.getClip().name,'CMU_10_03_Kick');assert.equal(actor.currentKickAction.time,1.125*.5);
  assert.equal(actor.lastMode,'kick');assert.equal(previous.parent,null);assert.equal(actor.group.children.length,2);
  assert.equal(ownedDisposals,owned.materials.size+owned.geometries.size);assert.equal(sourceDisposals,0);
  actor.dispose();actor.dispose();assert.equal(actor.fallback.disposeCount,1);assert.equal(sourceDisposals,0);assert.ok(second.root.parent);
  second.kick(.6);cache.dispose();assert.equal(sourceDisposals,0,'cache shutdown also respects the other live actor');
  second.dispose();assert.ok(sourceDisposals>0,'source resources are released only after cache retirement and final actor release');
});

test('missing optional clip retries its source, and the last capture is replayed after replacement',async()=>{
  const source=await readAsset('striker-mocap'),extra=await readAsset('mocap-variants/cmu-10_03-kick');let loads=0;
  const cache=createCharacterAssetCache({load:url=>isCompact(url)?++loads===1?{animations:[]}:extra:source});
  const actor=makeActor(cache);actor.capture(.77,0);assert.equal(await actor.ready,true);
  assert.equal(actor.assetStatus.state,'degraded');assert.equal(actor.assetStatus.optionalFailures[0].code,'invalid');
  assert.equal(await actor.retryAssets(),true);assert.equal(loads,2);assert.equal(actor.lastMode,'capture');assert.equal(actor.actions[0].time,.77);
  actor.dispose();cache.dispose();
});

test('failed candidate replay retains the previous good skin, mixer, motion bindings, and visibility',async()=>{
  const source=await readAsset('striker-mocap'),extra=await readAsset('mocap-variants/cmu-10_03-kick');let loads=0;
  const cache=createCharacterAssetCache({load:url=>isCompact(url)?++loads===1?Promise.reject(new Error('optional offline')):extra:source});
  const actor=makeActor(cache);actor.kick(.45,null,{style:penaltyStyles[3]});assert.equal(await actor.ready,true);
  const previous={root:actor.root,mixer:actor.mixer,actions:actor.actions,kickStyle:actor.kickStyle,runupStyle:actor.runupStyle,currentKickAction:actor.currentKickAction,lastKick:actor.lastKick};
  let oldDisposals=0;for(const geometry of actor._runtime.geometries)geometry.addEventListener('dispose',()=>oldDisposals++);
  const original=actor.kick;actor.kick=function(...args){original.apply(this,args);throw new Error('injected replay failure');};
  assert.equal(await actor.retryAssets(),false);assert.equal(actor.assetStatus.state,'error');assert.equal(actor.assetStatus.usingFallback,false);
  for(const [key,value] of Object.entries(previous))assert.equal(actor[key],value,key);
  assert.equal(actor.root.parent,actor.group);assert.equal(actor.root.visible,true);assert.equal(actor.fallback.group.visible,false);
  assert.equal(actor.group.children.length,2);assert.equal(oldDisposals,0);
  actor.kick=original;assert.equal(await actor.retryAssets(),true);assert.notEqual(actor.root,previous.root);assert.ok(oldDisposals>0);
  actor.dispose();cache.dispose();
});

test('dispose during loading suppresses late roots and notifications without destroying shared cached source',async()=>{
  const source=await readAsset('keeper-prototype'),pending=deferred();let loads=0,sourceDisposals=0;
  const cache=createCharacterAssetCache({load:()=>{loads++;return pending.promise;},dispose:()=>sourceDisposals++});
  const actor=makeActor(cache,true),states=[];actor.subscribeAssets(status=>states.push(status.state));await flush();
  actor.dispose();pending.resolve(source);assert.equal(await actor.ready,false);
  assert.equal(actor.root,null);assert.equal(actor.group.parent,null);assert.equal(actor.group.children.length,0);assert.deepEqual(states,['loading','disposed']);
  assert.equal(sourceDisposals,0);assert.equal(await actor.retryAssets(),false);assert.equal(loads,1);
  const next=makeActor(cache,true);assert.equal(await next.ready,true);assert.equal(loads,1);next.dispose();cache.dispose();assert.equal(sourceDisposals,1);
});

test('deadline settles a stalled actor; late primary success is discarded after a successful retry',async()=>{
  const source=await readAsset('keeper-prototype'),late=deferred(),timers=new Set(),discarded=[];let loads=0;
  const cache=createCharacterAssetCache({load:()=>++loads===1?late.promise:source,dispose:asset=>discarded.push(asset),
    setTimer(fn){timers.add(fn);return fn;},clearTimer(fn){timers.delete(fn);}});
  const actor=makeActor(cache,true);await flush();for(const fn of [...timers])fn();assert.equal(await actor.ready,false);
  assert.equal(actor.assetStatus.error.code,'timeout');assert.equal(actor.assetStatus.state,'error');
  assert.equal(await actor.retryAssets(),true);const root=actor.root;late.resolve({id:'stale'});await flush();
  assert.deepEqual(discarded,[{id:'stale'}]);assert.equal(actor.root,root);assert.equal(actor.group.children.length,2);assert.equal(actor.assetStatus.state,'ready');
  actor.dispose();cache.dispose();
});

test('invalid primary retries and real keeper setup retains calibrated palms with owned glove/shoulder resources',async()=>{
  const source=await readAsset('keeper-prototype');let loads=0;
  const cache=createCharacterAssetCache({load:()=>++loads===1?{scene:new THREE.Group(),animations:[]}:source});
  const actor=makeActor(cache,true),pose=goalkeeperPose({reach:80,speed:80},1,.5,2);actor.pose(pose);
  assert.equal(await actor.ready,false);assert.equal(actor.assetStatus.error.code,'invalid');
  assert.equal(await actor.retryAssets(),true);assert.equal(loads,2);actor.root.updateMatrixWorld(true);
  for(const [i,side] of ['L','R'].entries()){
    const point=actor.root.getObjectByName(`hand${side}`).getWorldPosition(new THREE.Vector3());
    assert.ok(point.distanceTo(new THREE.Vector3().copy(pose.hands[i]))<.001);
  }
  const sourceGeometries=new Set();source.scene.traverse(object=>{if(object.geometry)sourceGeometries.add(object.geometry);});
  assert.ok(actor._runtime.geometries.size>sourceGeometries.size,'tracks shoulder geometry replaced again by finger grip');
  assert.ok([...actor._runtime.geometries].every(geometry=>!sourceGeometries.has(geometry)));
  const before=actor.fingerGrip.diagnostics();assert.deepEqual(before.map(item=>item.vertices),[626,627]);
  assert.deepEqual(before.map(item=>item.thumbVertices),[115,115]);actor.dispose();cache.dispose();
});

test('legacy post-super failure never resurrects a previously disposed runtime',async()=>{
  const source=await readAsset('striker-mocap'),extra=await readAsset('mocap-variants/cmu-10_03-kick');let fail=false,optional=0;
  const cache=createCharacterAssetCache({load:url=>isCompact(url)?++optional===1?Promise.reject(Error('optional offline')):extra:source});
  class Legacy extends GameCharacter{async load(){const result=await super.load();if(fail)throw Error('legacy post-install failure');return result;}}
  const actor=new Legacy(new THREE.Scene(),'#88beca',false,{assetCache:cache,fallbackFactory});
  assert.equal(await actor.ready,true);const old=actor._runtime;fail=true;
  assert.equal(await actor.retryAssets(),false);assert.equal(old.disposed,true);
  assert.equal(actor.root,null);assert.equal(actor._runtime,null);assert.equal(actor.fallback.group.visible,true);
  assert.equal(actor.group.children.length,1);actor.dispose();cache.dispose();
});

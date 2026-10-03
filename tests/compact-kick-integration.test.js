import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {loadCharacter,skinSurfaceDistance} from './helpers/load-character.js';
import {penaltyStyles} from '../src/anatomy.js';
import {COMPACT_KICK} from '../src/striker-captures.js';
import {gameKickTime} from '../src/game-character.js';
import {strikerArmProtractionAngle} from '../src/striker-arm-clearance.js';
const style=penaltyStyles.find(style=>style.capture?.clipName===COMPACT_KICK.clipName);
const point=(a,name)=>a.root.getObjectByName(name).getWorldPosition(new THREE.Vector3());
test('compact game clock agrees with the independently calibrated capture metadata',async()=>{
  const meta=JSON.parse(await readFile(new URL('../assets/characters/mocap-variants/cmu-10_03-kick.json',import.meta.url)));
  for(const key of['clipName','contactSeconds','durationSeconds','supportPlantSeconds','supportReleaseSeconds'])assert.equal(COMPACT_KICK[key],meta[key]);
  assert.equal(style.duration,meta.contactSeconds);assert.equal(gameKickTime(1,null,style),meta.contactSeconds);assert.equal(gameKickTime(1,0,style),meta.contactSeconds);assert.equal(gameKickTime(1,10,style),meta.durationSeconds);
});
test('switching real sources restores prior overlays and isolates source-specific clearance',async()=>{
  const actor=await loadCharacter(),source=await loadCharacter(),index=source.actions.findIndex(a=>a.getClip().name===COMPACT_KICK.clipName);
  for(const t of[0,.016,.075,.133,.3,.8,1,1.125,1.18,1.4,1.5,2,2.5]){
    actor.kick(1,.30,{style:penaltyStyles[2],shotType:'chip'});
    actor.kick(Math.min(1,t/style.duration),t>=style.duration?t-style.duration:null,{style,targetX:5,power:.2,shotType:'chip'});
    const sourceTime=gameKickTime(Math.min(1,t/style.duration),t>=style.duration?t-style.duration:null,style);
    source.capture(sourceTime,index);
    assert.equal(actor.currentKickAction.getClip().name,COMPACT_KICK.clipName);
    const corrected=strikerArmProtractionAngle(sourceTime,COMPACT_KICK.clipName)!==0;
    actor.root.traverse(b=>{if(!b.isBone)return;const ref=source.root.getObjectByName(b.name);
      if(!(corrected&&b.name==='shoulder_supportR'))assert.ok(b.position.distanceTo(ref.position)<1e-8,'all captured local positions remain unchanged');
      if(!(corrected&&['clavicleR','upper_armR','shoulder_supportR'].includes(b.name)))b.quaternion.toArray().forEach((v,i)=>assert.ok(Math.abs(v-ref.quaternion.toArray()[i])<1e-8,'new capture must not inherit10_01 follow-through or cadence'));
    });
    actor.kick(.4,null,{style:penaltyStyles[0]});assert.equal(actor.currentKickAction.getClip().name,'CMU_10_01_Runup_Kick_Recovery');
  }
});
test('the real compact technique keeps neutral aiming, exact game-ball contact and a grounded finish',async()=>{
  const actor=await loadCharacter();let neutral;
  for(const targetX of[-5,0,5]){
    actor.kick(0,null,{style,targetX});const start=point(actor,'pelvis');neutral??=start.clone();assert.ok(start.distanceTo(neutral)<1e-8);
    for(const shotType of['normal','low','chip']){actor.kick(1,0,{style,targetX,shotType});assert.ok(Math.abs(skinSurfaceDistance(actor.root,new THREE.Vector3(0,.11,11),'Boots')-.11)<.002);}
    actor.kick(1,10,{style,targetX});for(const side of['L','R'])assert.ok(point(actor,'foot'+side).y<.08);
  }
});

test('compact technique heading aligns its captured swing with the centre of the aim cone',async()=>{
  const actor=await loadCharacter();actor.kick(1-.001/style.duration,null,{style});const before=point(actor,'footL');actor.kick(1,0,{style});const swing=point(actor,'footL').sub(before);swing.y=0;swing.normalize();
  for(const x of[-5,0,5])assert.ok(swing.dot(new THREE.Vector3(x,0,-11).normalize())>.9);
});

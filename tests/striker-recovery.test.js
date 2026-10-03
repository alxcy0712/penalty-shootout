import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {penaltyStyles} from '../src/anatomy.js';
import {gameKickTime,gameKickAfterTime} from '../src/game-character.js';
import {recoveryAfterTime,RECOVERY_SOURCE_TAIL} from '../src/striker-recovery-clock.js';
import {loadCharacter} from './helpers/load-character.js';
import {RECOVERY_BASELINE_CLIPS,baselineKickTime,sampleRecoveryBaseline,sampleCaptureBaseline} from './helpers/recovery-baseline.js';
import {auditStrikerRecovery,recoverySkin,recoverySkinError} from '../tools/qa/audit-striker-recovery.mjs';

const source=style=>({contact:style.capture?.contactSeconds??1.8467,duration:style.capture?.durationSeconds??3.5});
const sameSkin=(a,b,label)=>assert.ok(recoverySkinError(recoverySkin(a),recoverySkin(b))<1e-7,label);

test('late recovery retains the source interval and enters/exits with continuous bounded pace',()=>{
  assert.equal(RECOVERY_SOURCE_TAIL,.25);
  for(const style of penaltyStyles){
    const {contact,duration}=source(style),end=duration-contact,start=end-.25,finish=end+.25;
    for(let after=0;after<=start;after+=.001){assert.equal(recoveryAfterTime(after,contact,duration),after);assert.equal(gameKickTime(1,after,style),baselineKickTime(1,after,style));}
    assert.equal(recoveryAfterTime(finish,contact,duration),end);assert.equal(recoveryAfterTime(finish+9,contact,duration),end);
    const h=.0001,f=t=>recoveryAfterTime(t,contact,duration),speed=t=>(f(t+h)-f(t-h))/(2*h),acceleration=t=>(f(t+h)-2*f(t)+f(t-h))/(h*h);
    assert.ok(Math.abs(speed(start)-1)<1e-8);assert.ok(Math.abs(acceleration(start))<1e-5);
    assert.ok(Math.abs(speed(finish))<1e-8);assert.ok(Math.abs(acceleration(finish))<1e-5);
    let previous=f(start);for(let i=1;i<=480;i++){const value=f(start+i/480),pace=(value-previous)*480;assert.ok(pace>=-1e-10&&pace<=1+1e-10,'no reversal or catch-up speed');previous=value;}
    assert.equal(gameKickAfterTime(null,style),null);
  }
});

test('actual styled runtime preserves contact, source skin path and endpoint while settling at 30/60/120Hz',async()=>{
  const report=await auditStrikerRecovery();assert.deepEqual(report.clipFingerprints,RECOVERY_BASELINE_CLIPS,'both decoded CMU sources remain the published captures');
  for(const record of report.records){
    assert.ok(record.earlySkinError<1e-7,'preparation/run-up/contact/early follow-through unchanged');
    assert.ok(record.tailSkinError<1e-7,'mixer and legacy finishing IK use the same retimed clock');
    assert.ok(record.endpointSkinError<1e-7,'same complete final skin, without blending to another pose');
    assert.ok(record.contactError<.002,'actual boot surface still touches the ball');
    assert.ok(record.minimumSkinY>-.005,'real skin stays above the existing turf gate');
    assert.ok(record.minClockSpeed>=-1e-10&&record.maxClockSpeed<=1+1e-10);
    for(const [hz,points]of Object.entries(record.finishSpeeds))for(const [name,speed]of Object.entries(points)){
      assert.ok(speed.candidate<.003,`${record.name} ${name} ${hz}Hz residual speed ${speed.candidate}`);
      assert.ok(speed.candidate<speed.baseline*.02,`${record.name} ${name}: eliminate at least 98% of the final abrupt stop`);
    }
  }
});

test('aim freeze and planted support remain unchanged through both captured strikes',async()=>{
  const actor=await loadCharacter(),baseline=await loadCharacter();
  for(const style of penaltyStyles){
    actor.kick(0,null,{style,targetX:0});const prepared=recoverySkin(actor);
    for(const targetX of [-5,5,0]){actor.kick(0,null,{style,targetX});assert.ok(recoverySkinError(prepared,recoverySkin(actor))<1e-7,'aim does not move preparation');}
    const {contact}=source(style),plant=style.capture?.supportPlantSeconds??1.65,release=style.capture?.supportReleaseSeconds??2.44;let support;
    for(let at=plant;at<=release;at+=1/120){
      const after=at>=contact?at-contact:null,phase=(style.duration-(contact-at))/style.duration;
      actor.kick(phase,after,{style});sampleRecoveryBaseline(baseline,phase,after,{style});
      const point=actor.root.getObjectByName('footR').getWorldPosition(new THREE.Vector3());support??=point.clone();
      assert.ok(point.distanceTo(support)<.001,'support stays planted');
      assert.ok(point.distanceTo(baseline.root.getObjectByName('footR').getWorldPosition(new THREE.Vector3()))<1e-8,'same baseline support trajectory');
    }
  }
});

test('recovery can be scrubbed repeatedly, including normal/low/chip finish overlays',async()=>{
  const actor=await loadCharacter(),baseline=await loadCharacter();
  for(const style of penaltyStyles){
    const {contact,duration}=source(style),end=duration-contact;
    for(const shotType of ['normal','low','chip'])for(const targetX of [-5,5])for(const after of [end-.12,end+.08,end+.25]){
      const options={style,shotType,targetX,power:shotType==='chip'?.2:1};
      actor.kick(1,after,options);const expected=recoverySkin(actor);
      for(const other of [0,end+.25,end-.4])actor.kick(1,other,options);
      actor.kick(1,after,options);assert.ok(recoverySkinError(expected,recoverySkin(actor))<1e-7,'history cannot accumulate finish corrections');
      sampleRecoveryBaseline(baseline,1,recoveryAfterTime(after,contact,duration),options);sameSkin(actor,baseline,'shot-style overlay follows the exact baseline skin path');
    }
  }
});

test('unstyled and native capture inspection retain their original timing and skin after styled playback',async()=>{
  const actor=await loadCharacter(),baseline=await loadCharacter();
  for(const after of [0,.2,1.2,1.55,1.8,3]){
    assert.equal(gameKickAfterTime(after),after);assert.equal(gameKickTime(1,after),baselineKickTime(1,after));
    actor.kick(1,2,{style:penaltyStyles[0]});actor.kick(1,after,{targetX:4});sampleRecoveryBaseline(baseline,1,after,{targetX:4});sameSkin(actor,baseline,'unstyled playback unchanged');
  }
  for(const name of Object.keys(RECOVERY_BASELINE_CLIPS)){
    const index=actor.actions.findIndex(a=>a.getClip().name===name),duration=actor.actions[index].getClip().duration;
    for(const time of [0,.75,duration-.1,duration]){
      actor.kick(1,2,{style:penaltyStyles[3]});actor.capture(time,index);sampleCaptureBaseline(baseline,time,index);
      assert.equal(actor.actions[index].time,time);sameSkin(actor,baseline,'raw native capture bypasses recovery retiming');
    }
  }
});

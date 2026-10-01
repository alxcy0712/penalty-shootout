import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {penaltyStyles} from '../src/anatomy.js';
import {gameKickTime} from '../src/game-character.js';
import {loadCharacter,skinSurfaceDistance} from './helpers/load-character.js';
import {onsetElapsedTime,ONSET_WINDOW,setOnsetPose,makeBootSamples,samplePoints,auditOnset,baselineClipTime} from '../tools/qa/audit-runup-onset.mjs';

const near=(a,b,tolerance=1e-9,message='values agree')=>assert.ok(Math.abs(a-b)<tolerance,`${message}: ${a}, ${b}`);
const pointsEqual=(a,b,tolerance=1e-8)=>Object.keys(a).forEach(key=>assert.ok(a[key].distanceTo(b[key])<tolerance,key));

test('early elapsed-clock remap is positive, bounded C2 and returns exactly before every final plant',()=>{
  const h=1e-6,window=ONSET_WINDOW,ramp=.02,tail=window/3,peak=(window-tail/2)/(window-(ramp+tail)/2);
  assert.equal(onsetElapsedTime(-2),0);assert.equal(onsetElapsedTime(0),0);
  assert.equal(onsetElapsedTime(window),window);assert.equal(onsetElapsedTime(.3),.3);
  near(onsetElapsedTime(h)/h,0,1e-8,'zero initial clock velocity');
  near((onsetElapsedTime(2*h)-2*onsetElapsedTime(h))/(h*h),0,.00001,'zero initial clock acceleration');
  let previous=0;
  for(let i=1;i<=4000;i++){
    const t=i*window/4000,value=onsetElapsedTime(t),v=(value-previous)/(window/4000);
    assert.ok(value>previous,'strictly moving after release');assert.ok(value<=t+1e-12,'never jump ahead of old clock');
    assert.ok(v<1.064,'catch-up limited to 6.4%');previous=value;
  }
  near(peak,50/47);
  for(const t of[ramp,window-tail,window]){
    const before=(onsetElapsedTime(t)-onsetElapsedTime(t-h))/h,after=(onsetElapsedTime(t+h)-onsetElapsedTime(t))/h;
    near(before,after,1e-6,'no clock velocity discontinuity');
    const accBefore=(onsetElapsedTime(t)-2*onsetElapsedTime(t-h)+onsetElapsedTime(t-2*h))/(h*h);
    const accAfter=(onsetElapsedTime(t+2*h)-2*onsetElapsedTime(t+h)+onsetElapsedTime(t))/(h*h);
    near(accBefore,accAfter,.001,'no clock acceleration discontinuity');
  }
  for(const style of penaltyStyles)for(let i=0;i<=100;i++){
    const elapsed=window+(style.duration-window)*i/100;
    assert.equal(onsetElapsedTime(elapsed),elapsed,'elapsed clock is exactly identical from .2 s onward');
    near(gameKickTime(elapsed/style.duration,null,style),baselineClipTime(elapsed,style),1e-12,'source clock is unchanged after the onset window');
  }
  for(const style of penaltyStyles)for(const remaining of[.35,.2,.125,0]){
    const elapsed=style.duration-remaining;assert.equal(onsetElapsedTime(elapsed),elapsed);
    near(gameKickTime(elapsed/style.duration,null,style),baselineClipTime(elapsed,style),1e-12);
  }
});

test('all four real skins soften static-to-moving onset without unbounded catch-up',async()=>{
  const {records}=await auditOnset();
  for(const record of records){
    assert.equal(record.lateDifference,0);assert.ok(record.actualBootContactError<.002);
    for(const key of['pelvis','bootL','bootR']){
      const before=record.modes.baseline.byHz[60][key],after=record.modes.candidate.byHz[60][key];
      assert.ok(after.firstFrameSpeed<before.firstFrameSpeed*.85,`${record.name} ${key}: actual initial world speed reduced`);
      const fineBefore=record.modes.baseline.byHz[240][key],fineAfter=record.modes.candidate.byHz[240][key];
      assert.ok(fineAfter.peakSpeed<=fineBefore.peakSpeed*1.065,`${record.name} ${key}: early high-Hz speed increase stays under 6.5%`);
    }
  }
});

test('prepared poses stay frozen across aim and frame histories; timestamp evaluation agrees at 30/60/120 Hz',async()=>{
  const actor=await loadCharacter(),boots=makeBootSamples(actor);
  for(const style of penaltyStyles){
    setOnsetPose(actor,0,style,ONSET_WINDOW);const prepared=samplePoints(actor,boots);
    for(const aim of[-5,5,0,-2,3]){actor.kick(0,null,{style,targetX:aim});pointsEqual(samplePoints(actor,boots),prepared);}
    for(const time of[.016,.031,.051,.089,.14,.2,.36,style.duration-.35,style.duration]){
      setOnsetPose(actor,time,style,ONSET_WINDOW);const expected=samplePoints(actor,boots);
      for(const hz of[30,60,120]){
        for(let frame=0;frame/hz<time;frame++)setOnsetPose(actor,frame/hz,style,ONSET_WINDOW);
        setOnsetPose(actor,time,style,ONSET_WINDOW);pointsEqual(samplePoints(actor,boots),expected);
      }
      for(const other of[.51,0,.89,.005])setOnsetPose(actor,other,style,ONSET_WINDOW);
      setOnsetPose(actor,time,style,ONSET_WINDOW);pointsEqual(samplePoints(actor,boots),expected);
    }
  }
});

test('onset only retimes the original skin path; native capture and unstyled playback are unchanged',async()=>{
  const actor=await loadCharacter(),source=await loadCharacter();
  const skinPoints=root=>{const result=[];root.updateMatrixWorld(true);root.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;mesh.skeleton.update();for(let i=0;i<mesh.geometry.attributes.position.count;i++)result.push(mesh.applyBoneTransform(i,new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,i)).applyMatrix4(mesh.matrixWorld));});return result;};
  for(const style of penaltyStyles)for(const time of[0,.008,.02,.045,.075,.133333,.187,.2]){
    setOnsetPose(actor,time,style,ONSET_WINDOW);setOnsetPose(source,onsetElapsedTime(time),style);
    const expected=skinPoints(source.root),actual=skinPoints(actor.root);assert.equal(actual.length,expected.length);
    actual.forEach((p,i)=>assert.ok(p.distanceTo(expected[i])<1e-7,'identical captured skin at retimed source timestamp'));
  }
  for(const time of[0,.016,.035,.13,.2,.75]){
    actor.capture(time,0);assert.equal(actor.actions[0].time,time,'raw capture never receives the game onset remap');
    actor.kick(time/1.8467,null,{});near(actor.currentKickAction.time,time,1e-12,'unstyled/native playback unchanged');
  }
});

test('compact 1.0 s support plant and 1.125 s contact remain unchanged, with sub-mm support drift',async()=>{
  const style=penaltyStyles.find(s=>s.capture),actor=await loadCharacter(),source=await loadCharacter();
  assert.equal(gameKickTime(1/style.duration,null,style),1);
  assert.equal(gameKickTime(1,null,style),1.125);assert.equal(gameKickTime(1,0,style),1.125);
  actor.kick(1/style.duration,null,{style});const support=actor.root.getObjectByName('footR').getWorldPosition(new THREE.Vector3());
  for(let frame=0;frame<=35;frame++){
    const time=1+frame/120,after=time>=style.duration?time-style.duration:null;
    actor.kick(Math.min(1,time/style.duration),after,{style});
    assert.ok(actor.root.getObjectByName('footR').getWorldPosition(new THREE.Vector3()).distanceTo(support)<.001);
    if(after===null){setOnsetPose(source,time,style);for(const name of['pelvis','footL','footR'])assert.ok(actor.root.getObjectByName(name).getWorldPosition(new THREE.Vector3()).distanceTo(source.root.getObjectByName(name).getWorldPosition(new THREE.Vector3()))<1e-8);}
  }
  actor.kick(1,0,{style});assert.ok(Math.abs(skinSurfaceDistance(actor.root,new THREE.Vector3(0,.11,11),'Boots')-.11)<.002);
});

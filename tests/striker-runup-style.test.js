import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {penaltyStyles as allPenaltyStyles} from '../src/anatomy.js';
const penaltyStyles=allPenaltyStyles.filter(style=>!style.capture);
import {gameKickTime,gameKickAfterTime,KICK_CONTACT} from '../src/game-character.js';
import {runupClipTime,runupProfile,runupHeading,RUNUP_STRIKE_DURATION} from '../src/striker-runup-style.js';
import {loadCharacter,skinMinimum,skinSurfaceDistance} from './helpers/load-character.js';

const names=['pelvis','shinL','shinR','footL','footR','handL','handR'];
const point=(actor,name)=>actor.root.getObjectByName(name).getWorldPosition(new THREE.Vector3());
const sample=(actor,phase,after,options)=>{actor.kick(phase,after,options);actor.root.updateWorldMatrix(true,true);return names.map(name=>point(actor,name));};

test('run-up clocks are positive C2 cadence curves with exact release and an unchanged terminal strike clock',()=>{
  for(const style of penaltyStyles){
    const profile=runupProfile(style),duration=style.duration,approach=duration-RUNUP_STRIKE_DURATION;
    assert.equal(runupClipTime(0,style),profile.start,'crop waiting preparation, not the moving approach');
    assert.equal(gameKickTime(1,null,style),KICK_CONTACT);
    assert.equal(gameKickTime(1,0,style),KICK_CONTACT);
    let before=runupClipTime(0,style);
    for(let frame=1;frame<=1800;frame++){
      const now=runupClipTime(frame/1800,style),speed=(now-before)/(duration/1800);
      assert.ok(speed>0&&speed<1.01,`zero-slope onset must move forward immediately, without reversal ${style.name}: ${speed}`);before=now;
    }
    const time=t=>runupClipTime(t/duration,style),h=1e-5;
    for(const [q] of profile.pace.slice(1)){
      const t=q*approach,left=(time(t)-time(t-h))/h,right=(time(t+h)-time(t))/h;
      assert.ok(Math.abs(left-right)<.0001,'pace boundary has no velocity jump');
    }
    for(const remaining of [0,.05,.15,.30,.35])assert.ok(Math.abs(time(duration-remaining)-(KICK_CONTACT-remaining))<1e-12,'source-speed final plant/strike');
  }
});

test('direct, measured and early-stutter cadences have distinct rhythms',()=>{
  const [direct,measured,stutter]=penaltyStyles;
  const speed=(style,q)=>{const time=q*(style.duration-RUNUP_STRIKE_DURATION),h=.0001;return(runupClipTime((time+h)/style.duration,style)-runupClipTime((time-h)/style.duration,style))/(2*h);};
  assert.ok(Math.abs(speed(direct,.2)-speed(direct,.5))<.001,'direct approach remains steady before acceleration into plant');
  assert.ok(speed(measured,.7)>speed(measured,.1)*2,'measured approach accelerates');
  assert.ok(speed(stutter,.42)<speed(stutter,.18)*.2,'stutter visibly checks early pace');
  assert.ok(speed(stutter,.42)>.025,'stutter never stops');
  assert.ok(speed(stutter,.70)>speed(stutter,.42)*5,'stutter resumes before the strike');
});

test('style paths differ visibly, preserve a neutral initial aim and never accumulate on repeated scrubs',async()=>{
  const actor=await loadCharacter(),starts=[];
  for(const style of penaltyStyles){
    const initial=sample(actor,0,null,{style,targetX:0});starts.push(initial[0]);
    for(const targetX of [-5,5]){
      const aimed=sample(actor,0,null,{style,targetX});
      aimed.forEach((p,i)=>assert.ok(p.distanceTo(initial[i])<.00001,'committing aim cannot teleport the waiting stance'));
    }
    for(const phase of [.13,.42,.65,.87,1]){
      const expected=sample(actor,phase,null,{style,targetX:4.5});
      for(let repeat=0;repeat<8;repeat++)sample(actor,phase,null,{style,targetX:4.5}).forEach((p,i)=>assert.ok(p.distanceTo(expected[i])<1e-6,'repeated same-frame evaluation is deterministic'));
    }
  }
  for(let i=0;i<starts.length;i++)for(let j=i+1;j<starts.length;j++)assert.ok(starts[i].distanceTo(starts[j])>.13,'different approach lanes, not just renamed clips');
});

test('all styled approaches retain contact, planted support, fixed lower limbs, skin clearance and continuous motion',async()=>{
  const actor=await loadCharacter(),ball=new THREE.Vector3(0,.11,11);let minimum=Infinity,largestStep=0;
  for(const style of penaltyStyles)for(const targetX of [-4.5,0,4.5]){
    const options={style,targetX};let previous;
    const frames=Math.ceil(style.duration*240);
    for(let frame=0;frame<=frames;frame++){
      const phase=frame/frames,points=sample(actor,phase,null,options);
      if(previous)points.forEach((p,i)=>largestStep=Math.max(largestStep,p.distanceTo(previous[i])));previous=points;
      for(const side of ['L','R'])for(const [a,b] of [['thigh','shin'],['shin','foot']])assert.ok(Math.abs(point(actor,a+side).distanceTo(point(actor,b+side))-.43)<.001,'retargeted legs cannot stretch');
      if(frame%4===0)for(const side of ['L','R']){
        const other=side==='L'?'R':'L',ankle=point(actor,'foot'+side),toe=actor.root.getObjectByName('foot'+side).localToWorld(new THREE.Vector3(0,.23,0));
        const calf=new THREE.Line3(point(actor,'shin'+other),point(actor,'foot'+other));
        for(let step=0;step<=10;step++){
          const boot=ankle.clone().lerp(toe,step/10),closest=calf.closestPointToPoint(boot,true,new THREE.Vector3());
          assert.ok(boot.distanceTo(closest)>.20,'opposite boot/calf centre lines keep a generous clearance margin');
        }
      }
      if(frame%24===0)minimum=Math.min(minimum,skinMinimum(actor.root));
    }
    const before=sample(actor,1,null,options),contact=sample(actor,1,0,options);
    before.forEach((p,i)=>assert.ok(p.distanceTo(contact[i])<.00015,'no source/style jump at release'));
    assert.ok(Math.abs(skinSurfaceDistance(actor.root,ball,'Boots')-.11)<.002,'actual shoe surface meets ball within 2 mm');
    const support=point(actor,'footR');
    for(let elapsed=1.65;elapsed<2.44;elapsed+=1/120){
      const after=elapsed>KICK_CONTACT?elapsed-KICK_CONTACT:null,phase=(style.duration-(KICK_CONTACT-elapsed))/style.duration;
      sample(actor,phase,after,options);assert.ok(point(actor,'footR').distanceTo(support)<.001,'under 1 mm support drift from plant through follow-through');
    }
  }
  assert.ok(minimum>-.005,`whole actual skin remains above turf: ${minimum}`);
  assert.ok(largestStep<.065,`no joint pops at 240 Hz: ${largestStep}`);
});

test('the moving approach has no 100 ms frozen windows, including the early cadence check',async()=>{
  const actor=await loadCharacter();
  for(const style of penaltyStyles)for(let t=.1;t<style.duration-RUNUP_STRIKE_DURATION;t+=.025){
    const before=sample(actor,(t-.1)/style.duration,null,{style}),after=sample(actor,t/style.duration,null,{style});
    assert.ok(Math.max(...after.map((p,i)=>p.distanceTo(before[i])))>.006,'motion remains visible after kick begins');
  }
});

test('rigid approach headings leave captured planted boot trajectories and all local skin deformation intact',async()=>{
  const source=await loadCharacter(),actor=await loadCharacter(),up=new THREE.Vector3(0,1,0);
  for(const style of penaltyStyles)for(const targetX of [-4.5,0,4.5])for(let phase=0;phase<=1;phase+=.025){
    sample(source,runupClipTime(phase,style)/KICK_CONTACT,null,{targetX});sample(actor,phase,null,{style,targetX});
    for(const side of ['L','R']){
      const local=source.root.worldToLocal(point(source,'foot'+side)),angle=runupHeading(style)-source.root.rotation.y;
      const expected=local.clone().applyAxisAngle(up,angle);source.root.localToWorld(expected);
      assert.ok(point(actor,'foot'+side).distanceTo(expected)<.000001,'rigid heading preserves the captured boot path without foot sliding');
    }
    actor.root.traverse(bone=>{
      if(!bone.isBone)return;const reference=source.root.getObjectByName(bone.name);
      assert.ok(bone.position.distanceTo(reference.position)<1e-9,'do not alter source joint locations');
      bone.quaternion.toArray().forEach((v,i)=>assert.ok(Math.abs(v-reference.quaternion.toArray()[i])<1e-9,'do not introduce differential rotations or new skin folds'));
    });
  }
});

test('raw capture mode restores overlays and new sources do not inherit CMU 10_01 run-up calibration',async()=>{
  const actor=await loadCharacter(),reference=await loadCharacter();
  sample(actor,.72,null,{style:penaltyStyles[0],targetX:4});
  assert.equal(actor.capture(.8),true);assert.equal(reference.capture(.8),true);
  names.forEach(name=>assert.ok(point(actor,name).distanceTo(point(reference,name))<1e-6,'capture view is unmodified source'));
  actor.actions[0].getClip().name='CMU_OTHER_SOURCE';
  sample(actor,.3,null,{style:penaltyStyles[2]});sample(reference,.3,null,{});
  names.forEach(name=>assert.ok(point(actor,name).distanceTo(point(reference,name))<1e-6,'unknown capture cannot accidentally use style crop or path'));
});

test('preset headings preserve shot-type and finishing deformation at the same source timestamp',async()=>{
  const source=await loadCharacter(),actor=await loadCharacter();
  for(const style of penaltyStyles)for(const targetX of [-5,5])for(const shotType of ['normal','low','chip'])for(const power of [.2,1])for(const after of [0,.08,.2,.6,1.3,1.7]){
    // Styled finishes now decelerate their source clock; compare the native
    // control at that same timestamp, retaining the exact joint thresholds.
    const options={targetX,shotType,power};sample(source,1,gameKickAfterTime(after,style),options);sample(actor,1,after,{...options,style});
    actor.root.traverse(bone=>{
      if(!bone.isBone)return;const reference=source.root.getObjectByName(bone.name);
      assert.ok(bone.position.distanceTo(reference.position)<1e-9,'rigid heading cannot alter existing follow-through IK');
      bone.quaternion.toArray().forEach((v,i)=>assert.ok(Math.abs(v-reference.quaternion.toArray()[i])<1e-9,'retain every source/style local rotation through recovery'));
    });
  }
});

test('fixed technique headings strike forward within a plausible inside/outside-foot aim cone',async()=>{
  const actor=await loadCharacter();let worst=1;
  for(const style of penaltyStyles){
    sample(actor,1-.001/style.duration,null,{style,targetX:0});const before=point(actor,'footL');
    sample(actor,1,0,{style,targetX:0});const swing=point(actor,'footL').sub(before);swing.y=0;swing.normalize();
    for(const x of[-5,0,5])worst=Math.min(worst,swing.dot(new THREE.Vector3(x,0,-11).normalize()));
  }
  // This checks broad directional plausibility, not a foot/ball impulse model.
  // A side-foot contact can redirect within this cone without turning the stance.
  assert.ok(worst>.80,`horizontal boot travel/launch alignment ${worst}`);
});

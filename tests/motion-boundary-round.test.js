import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {body,goalkeeperPose,keeperRunupPreparation,penaltyStyles} from '../src/anatomy.js';
import {gameKickTime} from '../src/game-character.js';
import {loadCharacter,skinMinimum,skinSurfaceDistance} from './helpers/load-character.js';
import {recoverySkin,recoverySkinError} from '../tools/qa/audit-striker-recovery.mjs';

const stats={speed:85,reach:85};
const pointKeys=['hip','shoulder','head','shoulders','hips','hands','elbows','knees','feet'];
const points=pose=>pointKeys.flatMap(key=>Array.isArray(pose[key])?pose[key]:[pose[key]]);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const maxPointError=(a,b)=>Math.max(...points(a).map((p,i)=>distance(p,points(b)[i])));
const epsilon=1e-6;

test('all styled shots preserve the complete skin at the run-up/contact seam, including mixed-mode re-entry',async t=>{
  const actor=await loadCharacter(),ball=new THREE.Vector3(0,.11,11);
  let combinations=0,skinSamples=0,maxSeam=0,maxRepeat=0,maxContactError=0,maxNeighbourStep=0;
  const sample=(phase,after,options)=>{actor.kick(phase,after,options);skinSamples++;return recoverySkin(actor);};
  for(const style of penaltyStyles)for(const shotType of ['normal','low','chip'])for(const targetX of [-5,0,5])for(const power of [.2,1]){
    combinations++;
    const options={style,shotType,targetX,power};
    const before=sample(1-epsilon/style.duration,null,options),atRunup=sample(1,null,options),atRelease=sample(1,0,options),after=sample(1,epsilon,options);
    const seam=recoverySkinError(atRunup,atRelease);
    maxSeam=Math.max(maxSeam,seam);
    maxNeighbourStep=Math.max(maxNeighbourStep,recoverySkinError(before,atRelease),recoverySkinError(atRelease,after));
    assert.ok(seam<1e-8,`${style.name}/${shotType}: release changes neither pose nor heading`);
    assert.ok(recoverySkinError(before,atRelease)<.0001&&recoverySkinError(atRelease,after)<.0001,'microscopic contact interval cannot teleport the skin');
    sample(1,0,options);
    const contactError=Math.abs(skinSurfaceDistance(actor.root,ball,'Boots')-.11);
    maxContactError=Math.max(maxContactError,contactError);
    assert.ok(contactError<.002,'the real boot retains the captured ball contact');
    for(const perturb of [
      ()=>actor.kick(1,.2,{style:penaltyStyles[(penaltyStyles.indexOf(style)+1)%penaltyStyles.length],shotType:'chip',power:.2}),
      ()=>actor.capture(.4,0),
      ()=>actor.pose(goalkeeperPose(stats,0,.2,.3)),
      ()=>{actor.kick(1,0,options);actor.lookAt(new THREE.Vector3(-4,2,8),1/30);},
    ]){
      perturb();
      const error=recoverySkinError(atRelease,sample(1,0,options));maxRepeat=Math.max(maxRepeat,error);
      assert.ok(error<1e-7,'a repeated contact timestamp restores the complete captured skin after mode/style/gaze changes');
    }
  }
  t.diagnostic(JSON.stringify({round:1,gate:'contact',combinations,skinSamples,maxSeam,maxRepeat,maxContactError,maxNeighbourStep}));
});

test('clocks cross the final strike/contact branch at source speed and remain clamped through repeated extremes',t=>{
  let boundarySamples=0,maxVelocityDifference=0;
  for(const style of penaltyStyles){
    const sourceContact=style.capture?.contactSeconds??1.8467,sourceDuration=style.capture?.durationSeconds??3.5;
    const clock=time=>time<=style.duration?gameKickTime(time/style.duration,null,style):gameKickTime(1,time-style.duration,style);
    for(const boundary of [style.duration-.35,style.duration]){
      const before=clock(boundary-epsilon),at=clock(boundary),after=clock(boundary+epsilon);boundarySamples+=3;
      const incoming=(at-before)/epsilon,outgoing=(after-at)/epsilon;
      maxVelocityDifference=Math.max(maxVelocityDifference,Math.abs(incoming-outgoing));
      assert.ok(Math.abs(incoming-1)<1e-6&&Math.abs(outgoing-1)<1e-6,'final plant and contact keep native source pace on both sides');
    }
    for(const repeat of [0,1,2]){
      assert.equal(gameKickTime(-1,null,style),gameKickTime(0,null,style));
      assert.equal(gameKickTime(2,null,style),sourceContact);
      assert.equal(gameKickTime(1,-2,style),sourceContact);
      assert.equal(gameKickTime(1,20,style),sourceDuration);
    }
  }
  t.diagnostic(JSON.stringify({round:1,gate:'contact-clock',boundarySamples,clampAssertions:48,maxVelocityDifference}));
});

test('mirrored keeper set steps preserve smooth support swaps and bounded authored transfer onset/release',async t=>{
  const actor=await loadCharacter(true),boundaries=[0,.04,.08,.08+.82/4,.08+.82/2,.08+3*.82/4,.90,.94,1];
  let poseSamples=0,skinSamples=0,maxMirrorError=0,maxStep=0,maxSupportVelocitySeam=0,maxTransferVelocitySeam=0,minimumSkinY=Infinity;
  for(const leadSide of [-1,1])for(const boundary of boundaries){
    const poses=[-epsilon,0,epsilon].map(offset=>{poseSamples++;return keeperRunupPreparation(stats,boundary+offset,leadSide);});
    const [before,at,after]=poses.map(points);
    for(let i=0;i<at.length;i++){
      maxStep=Math.max(maxStep,distance(before[i],at[i]),distance(at[i],after[i]));
      const velocitySeam=Math.hypot(after[i].x-2*at[i].x+before[i].x,after[i].y-2*at[i].y+before[i].y,after[i].z-2*at[i].z+before[i].z)/epsilon;
      // The existing clamped sinusoidal transfer has a small derivative seam
      // at .08/.90 (0.005262 m per phase), with no position discontinuity.
      // Keep this explicit; do not relax the actual support-swap boundaries.
      if(boundary===.08||boundary===.90)maxTransferVelocitySeam=Math.max(maxTransferVelocitySeam,velocitySeam);
      else maxSupportVelocitySeam=Math.max(maxSupportVelocitySeam,velocitySeam);
    }
    const opposite=keeperRunupPreparation(stats,boundary,-leadSide);poseSamples++;
    const mirrored=structuredClone(poses[1]);
    for(const key of pointKeys){const list=Array.isArray(mirrored[key])?mirrored[key].reverse():[mirrored[key]];for(const point of list)point.x*=-1;}
    maxMirrorError=Math.max(maxMirrorError,maxPointError(mirrored,opposite));
    for(const pose of poses){actor.pose(pose);skinSamples++;minimumSkinY=Math.min(minimumSkinY,skinMinimum(actor.root));}
    if(boundary===0||boundary===1)assert.deepEqual(poses[1],goalkeeperPose(stats,0,0,1),'preparation endpoint is exactly the live collision stance');
  }
  assert.ok(maxMirrorError<1e-9,'support order mirrors the complete pose');
  assert.ok(maxStep<.00001&&maxSupportVelocitySeam<.003,'support swaps stay position/velocity continuous');
  assert.ok(maxTransferVelocitySeam<.006,'authored transfer onset/release stays below 0.006 m per phase');
  assert.ok(minimumSkinY>-.003,'real skin respects the pre-shot floor');
  t.diagnostic(JSON.stringify({round:1,gate:'keeper-preparation',boundaries:boundaries.length,poseSamples,skinSamples,maxMirrorError,maxStep,maxSupportVelocitySeam,maxTransferVelocitySeam,minimumSkinY}));
});

test('both keeper directions retain skin continuity and repeatability at launch, landing, brace and get-up boundaries',async t=>{
  const actor=await loadCharacter(true);
  let boundaries=0,skinSamples=0,maxSkinStep=0,maxRepeatError=0,minimumSkinY=Infinity,maxBoneLengthError=0;
  for(const direction of [-1,1])for(const height of [.3,1.2,2.3]){
    const high=Math.max(0,Math.min(1,(height-.35)/1.7)),vy=.7+high*2.1;
    const landing=.13+(vy+Math.sqrt(vy*vy+2*9.81*(.83-.305)))/9.81;
    // Authored branch boundaries, independent of frame grids. Probe just before,
    // at and after each boundary so an off-grid discontinuity cannot be missed.
    const times=[.08,.13,.30,.31,.32,.42,landing-.06,landing+.06,landing+.20,landing+.28,landing+.28+.30,landing+.28+.70,landing+.28+.80,landing+.28+.84,landing+.28+1.60];
    for(const time of times){
      boundaries++;
      const poses=[-epsilon,0,epsilon].map(offset=>goalkeeperPose(stats,direction,time+offset,height));
      const skins=poses.map(pose=>{
        actor.pose(pose);skinSamples++;const skin=recoverySkin(actor);
        for(let i=1;i<skin.length;i+=3)minimumSkinY=Math.min(minimumSkinY,skin[i]);
        for(let side=0;side<2;side++)for(const [a,b,length]of [['shoulders','elbows',body.upperArm],['elbows','hands',body.forearm],['hips','knees',body.thigh],['knees','feet',body.shin]])maxBoneLengthError=Math.max(maxBoneLengthError,Math.abs(distance(pose[a][side],pose[b][side])-length));
        return skin;
      });
      maxSkinStep=Math.max(maxSkinStep,recoverySkinError(skins[0],skins[1]),recoverySkinError(skins[1],skins[2]));
      actor.pose(goalkeeperPose(stats,-direction,3.8,2.3));
      actor.pose(keeperRunupPreparation(stats,.49,-direction));
      actor.pose(poses[1]);skinSamples++;
      maxRepeatError=Math.max(maxRepeatError,recoverySkinError(skins[1],recoverySkin(actor)));
    }
  }
  assert.ok(maxSkinStep<.0001,`phase boundary skin step ${maxSkinStep}m`);
  assert.ok(maxRepeatError<1e-7,'landing/recovery skin cannot depend on prior direction or preparation');
  assert.ok(maxBoneLengthError<1e-9,'phase transitions preserve anatomical segment lengths');
  assert.ok(minimumSkinY>-.005,'production skin stays above the existing turf gate');
  t.diagnostic(JSON.stringify({round:1,gate:'keeper-phase',boundaries,skinSamples,maxSkinStep,maxRepeatError,maxBoneLengthError,minimumSkinY}));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Shot} from '../src/engine.js';
import {body,goalkeeperPose,HOLD_DURATION} from '../src/anatomy.js';
import {keeperGather} from '../src/keeper-contact.js';
import {keeperResultRecovery} from '../src/keeper-result-recovery.js';

const baseline=JSON.parse(await readFile(new URL('../validation/model-motion-ten/recovery-origin-baseline.json',import.meta.url)));
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function simulate(recipe){
  const shot=new Shot(recipe.aim,recipe.stats,recipe.stats,recipe.direction,recipe.seed),hash=createHash('sha256');
  for(let i=0;i<3600&&!shot.result;i++){
    shot.step(1/120,shot.playbackRate());
    hash.update(JSON.stringify({t:shot.t,at:shot.animationTime,ball:shot.ball,velocity:shot.velocity,pose:shot.pose,result:shot.result}));
  }
  assert.ok(shot.result,'fixture must reach a real result');
  return {shot,liveTrajectorySha256:hash.digest('hex')};
}
const runs=baseline.records.map(record=>({...simulate(record.recipe),record}));
const sample=(shot,elapsed)=>shot.poseAt((shot.animationTime??shot.t)+elapsed);
const displayed=(shot,elapsed)=>{const pose=sample(shot,elapsed);return shot.caught?keeperGather(shot.pose,pose,shot.ball,shot.contactPart,elapsed/HOLD_DURATION):{pose,ball:shot.ball};};
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);

test('all 76 existing and 24 fresh paths preserve live physics, physical capture and exact presented result origin',()=>{
  assert.equal(runs.length,100);assert.equal(runs.filter(r=>r.shot.caught).length,85);
  for(const {shot,record,liveTrajectorySha256}of runs){
    assert.equal(liveTrajectorySha256,record.liveTrajectorySha256,record.id+' live trajectory');
    assert.deepEqual(shot.result,record.result);assert.equal(shot.caught,record.caught);
    assert.equal(sha(shot.pose),record.terminalPhysicsPoseSha256,record.id+' terminal physics pose');
    assert.equal(sha(sample(shot,0)),record.presentedSourcePoseSha256,record.id+' presented source');
    if(shot.caught){assert.equal(sample(shot,0),shot.pose);assert.deepEqual(displayed(shot,0).ball,shot.ball);}
    else assert.deepEqual(sample(shot,0),shot.livePoseAt(shot.animationTime),'free result begins at the preceding presentation clock');
  }
});

test('low results finish their support and rise while both completed compressed free recoveries retain their exact supported source',()=>{
  let settled=0;
  for(const {shot,record}of runs){
    const source=sample(shot,0),start=shot.caught?HOLD_DURATION:.12;
    for(const time of[0,start/2,start-1e-8])assert.deepEqual(sample(shot,time),source,'source remains exact during initial result hold');
    const final=sample(shot,4);
    if(record.compressed){
      settled++;assert.deepEqual(final,source,'already complete authored recovery does not restart');
      assert.equal(final.torso.soleL,1);assert.equal(final.torso.soleR,1);
      final.feet.forEach(foot=>assert.ok(Math.abs(foot.y-.0655)<1e-12,'retain calibrated unrolled sole height'));
    }else{
      assert.ok(final.hip.y>.75,'the low result leaves its indefinite squat');
      final.feet.forEach((foot,i)=>{assert.ok(Math.abs(foot.y-.075)<1e-12);assert.ok(Math.hypot(foot.x-source.feet[i].x,foot.z-source.feet[i].z)<1e-12,'plant does not slide');});
    }
    assert.deepEqual(sample(shot,20),final,'bounded settled endpoint');
  }
  assert.equal(settled,2);
});

test('flat soles alone cannot suppress an unfinished torso and arm rise',()=>{
  const stats={speed:85,reach:85},height=1.2,high=Math.max(0,Math.min(1,(height-.35)/1.7)),vy=.7+high*2.1;
  const origin=.13+(vy+Math.sqrt(vy*vy+2*9.81*(.83-.305)))/9.81+.28;
  for(const direction of[-1,1]){
    for(const phase of[1.05,1.35,1.59]){
      const pose=goalkeeperPose(stats,direction,origin+phase,height);
      assert.equal(pose.torso.soleL,1);assert.equal(pose.torso.soleR,1);assert.ok(pose.torso.armRelax>0);
      assert.notDeepEqual(keeperResultRecovery(pose,4,false),pose,'still-rising body cannot be classified as complete');
    }
    const complete=goalkeeperPose(stats,direction,origin+1.7,height);
    assert.deepEqual(keeperResultRecovery(complete,4,false),complete,'completed recovery retains its exact pose and support metadata');
    for(const channel of['curl','twist','sideBend','headCurl','armRelax','braceL','braceR']){
      const active=structuredClone(complete);active.torso[channel]=.001;
      assert.notEqual(keeperResultRecovery(active,4,false),active,channel+' independently prevents premature completion');
    }
  }
});

test('result boundaries retain fixed limbs and deterministic serialized sampling after 30/60/120 Hz histories',()=>{
  for(const {shot,record}of runs){
    const saved=JSON.stringify(shot),restored=Shot.restore(JSON.parse(saved));
    const raised=shot.pose.feet.filter(foot=>foot.y>.075001).length,start=shot.caught?HOLD_DURATION:.12;
    const edges=[0,start,start+.18,start+raised*.18,start+raised*.18+1.1];
    for(const edge of edges){
      const states=[Math.max(0,edge-1e-6),edge,edge+1e-6].map(time=>displayed(shot,time));
      for(const state of states)for(let i=0;i<2;i++)for(const[a,b,length]of[['shoulders','elbows',body.upperArm],['elbows','hands',body.forearm],['hips','knees',body.thigh],['knees','feet',body.shin]])assert.ok(Math.abs(distance(state.pose[a][i],state.pose[b][i])-length)<1e-8);
      for(const part of['hands','elbows','feet','knees'])for(let i=0;i<2;i++)assert.ok(distance(states[0].pose[part][i],states[2].pose[part][i])<1e-5,record.id+' phase boundary');
    }
    // JSON persistence canonicalizes negative zero without changing geometry.
    for(const elapsed of[4,.44,1.3,.12,2,0])assert.equal(sha(displayed(restored,elapsed)),sha(displayed(shot,elapsed)));
    assert.equal(JSON.stringify(shot),saved,'sampling never mutates shot/result state');
  }
  const representatives=runs.filter(r=>r.record.compressed||['7044422678976841','bacae84b7af9d845','2c8228fd6cf2fda2','2fc1a7164d3470cb'].includes(r.record.id));
  for(const {shot}of representatives){
    const checkpoints=[0,.12,.396,.44,.704,1.1,1.7,4],expected=checkpoints.map(time=>displayed(shot,time));
    for(const hz of[30,60,120]){for(let frame=0;frame<=4*hz;frame++)displayed(shot,frame/hz);for(let i=checkpoints.length-1;i>=0;i--)assert.deepEqual(displayed(shot,checkpoints[i]),expected[i]);}
  }
});

test('terminal hesitation and lateral recovery preserve their original result paths',()=>{
  for(const control of baseline.controls){
    const {shot}=simulate(control.recipe);assert.equal(shot.direction,control.direction);assert.equal(!!shot.hesitation,control.hesitation);assert.deepEqual(shot.result,control.result);
    for(const {elapsed,poseSha256}of control.samples)assert.equal(sha(sample(shot,elapsed)),poseSha256,control.recipe.kind+' exact existing path');
  }
});

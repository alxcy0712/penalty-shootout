import test from 'node:test';
import assert from 'node:assert/strict';
import {Match,Shot} from '../src/engine.js';
import {mainHarness} from './helpers/main-harness.js';

const schedules={
  '30 Hz':[1/30],
  '60 Hz':[1/60],
  '120 Hz':[1/120],
  'irregular RAF':[1/120,.041,1/60,.083,.012,.027],
};
const json=value=>JSON.parse(JSON.stringify(value));
function nearTree(actual,expected,path='value'){
  if(typeof expected==='number'){
    assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<1e-7,`${path}: ${actual} versus ${expected}`);return;
  }
  if(expected===null||typeof expected!=='object'){assert.equal(actual,expected,path);return;}
  assert.deepEqual(Object.keys(actual),Object.keys(expected),`${path} keys`);
  for(const key of Object.keys(expected))nearTree(actual[key],expected[key],`${path}.${key}`);
}
function driver(h,schedule){
  let frame=0;
  return {
    tick(){h.tick(schedule[frame++%schedule.length]);},
    advance(seconds){
      const deadline=h.now+seconds*1000;
      while(deadline-h.now>1e-8)h.tick(Math.min(schedule[frame++%schedule.length],(deadline-h.now)/1000));
    },
    until(phase){
      const start=h.now;
      while(h.context.state.phase!==phase&&h.now-start<40000)this.tick();
      assert.equal(h.context.state.phase,phase,`reaches ${phase} within 40 seconds of active simulated time`);
    },
  };
}
function assertReady(h){
  const {context,s}=h,state=context.state;
  assert.equal(state.phase,'ready');assert.equal(state.shot,null);assert.equal(state.aim,null);
  assert.equal(state.turnTime,0);assert.equal(state.runup,0);assert.equal(context.pointer,null);
  assert.equal(s.currentShot,null);assert.equal(s.currentResult,null);assert.equal(s.aftermath,null);
  assert.equal(s.trail.visible,false);assert.equal(s.drawnKick.runup,0);assert.equal(s.drawnKick.after,null);
  assert.equal(s.cameraAngle,state.match.turn?Math.PI:0);
  assert.deepEqual(s.ball.position.toArray(),[0,.11,11]);
}
function roundTrip(h,d,counts){
  const {context,s}=h,before=json(context.state),oldMatch=context.state.match,oldShot=context.state.shot;
  const oldMatchValue=json(oldMatch),oldShotValue=oldShot?json(oldShot):null;
  h.click('home');d.tick();assert.equal(s.mode,'hero');assert.equal(context.pointer,null);
  assert.deepEqual(json(h.saved.state),before);
  h.elapse(37);h.click('resume-save');
  assert.ok(context.state.match instanceof Match);assert.notEqual(context.state.match,oldMatch);
  if(oldShot){assert.ok(context.state.shot instanceof Shot);assert.notEqual(context.state.shot,oldShot);}
  assert.deepEqual(json(context.state),before,'serialized input, physical state and match survive a complete Home round trip');
  d.tick();assert.equal(s.mode,'game');assert.equal(s.cameraAngle,before.match.turn?Math.PI:0);
  assert.equal(s.currentShot,context.state.shot);
  h.click('close');assert.deepEqual(json(oldMatch),oldMatchValue);
  if(oldShot)assert.deepEqual(json(oldShot),oldShotValue);
  counts.restores++;counts.phases.add(before.phase);
}
function commitAttack(h,d,index,afterLock=()=>{}){
  const {context}=h;
  if(context.state.match.mode==='simple'){
    d.advance(.14+(index%4)*.12);h.click('lock');afterLock();
    d.advance(.31+(index%3)*.18);h.click('shoot');
  }else{
    const el=h.gesture,id=index+11,side=index%2?-1:1,endX=195+side*(48+(index%3)*15),endY=85+(index%4)*20;
    el.emit('pointerdown',{pointerId:id,timeStamp:h.now});
    el.emit('pointermove',{pointerId:id,clientX:endX,clientY:endY,timeStamp:h.now+70});
    el.emit('pointerup',{pointerId:id,clientX:endX,clientY:endY,timeStamp:h.now+140});
  }
  assert.equal(context.state.phase,'runup');
}
const physicalOutcome=shot=>json({
  t:shot.t,result:shot.result,ball:shot.ball,velocity:shot.velocity,target:shot.target,
  touched:shot.touched,caught:shot.caught,post:shot.post,contactPart:shot.contactPart,
});
function playTurn(h,d,index,counts,restore){
  const {context}=h;assertReady(h);
  if(restore)roundTrip(h,d,counts);
  h.click('ready');
  if(restore)roundTrip(h,d,counts);
  if(context.state.match.turn===0){commitAttack(h,d,index,()=>{if(restore)roundTrip(h,d,counts);});d.advance(.24);}
  else{h.click('dive',{dir:String(index%3-1)});d.advance(.24);}
  if(restore)roundTrip(h,d,counts);
  d.until('flight');
  if(restore)roundTrip(h,d,counts);
  d.until('result');counts.shots++;
  const match=context.state.match,shot=context.state.shot,outcome=physicalOutcome(shot);
  assert.ok(shot.result);assert.equal(match.teams.flatMap(team=>team.kicks).length,match.serial);
  for(const team of match.teams)assert.equal(team.goals,team.kicks.filter(kick=>kick.goal).length);
  if(restore)roundTrip(h,d,counts);
  // Extra visible result frames must never append another record or evolve the
  // settled physical shot, even while Stadium continues the presentation.
  const history=json(context.state.match.teams.map(team=>team.kicks));d.advance(.11);
  assert.deepEqual(json(context.state.match.teams.map(team=>team.kicks)),history);
  assert.deepEqual(physicalOutcome(context.state.shot),outcome);
  h.click('next');h.click('next');d.tick();
  assert.equal(context.state.phase,context.state.match.winner===null?'ready':'finish');
  return outcome;
}
function completeMatch(h,d,counts,restore){
  const outcomes=[];
  while(h.context.state.phase!=='finish'&&outcomes.length<80){
    const index=h.context.state.match.serial-1;
    outcomes.push(playTurn(h,d,index,counts,restore&&index%2===0));
  }
  assert.equal(h.context.state.phase,'finish','a full seeded match terminates');
  const match=h.context.state.match;
  assert.ok(match.winner===0||match.winner===1);assert.ok(match.teams[match.winner].goals>match.teams[1-match.winner].goals);
  assert.equal(match.serial,match.teams.flatMap(team=>team.kicks).length);
  const completed=json(match);h.click('next');h.click('next');d.tick();assert.deepEqual(json(match),completed);
  return {match:completed,outcomes};
}

// These are complete matches through the application's event/frame loop, not
// h.finish() injections. Render uploads, DOM and storage remain controlled stubs.
for(const mode of ['simple','advanced'])test(`${mode}: six complete matches with repeated rematches and restores agree across RAF schedules`,async t=>{
  let reference;
  for(const [label,schedule] of Object.entries(schedules))await t.test(label,()=>{
    const h=mainHarness(mode),d=driver(h,schedule),counts={shots:0,restores:0,phases:new Set()},archive=[],transcript=[];
    d.tick();
    for(let game=0;game<6;game++){
      if(game){
        const old=h.context.state.match,roster=json(old.teams.map(team=>({players:team.players,order:team.order})));
        archive.push({match:old,snapshot:json(old)});
        h.click('rematch');h.click('first',{first:String(game%2)});d.tick();assertReady(h);
        assert.notEqual(h.context.state.match,old);assert.equal(h.context.state.match.serial,1);
        assert.deepEqual(json(h.context.state.match.teams.map(team=>({players:team.players,order:team.order}))),roster);
        assert.deepEqual(json(h.context.state.match.teams.map(team=>team.kicks)),[[],[]]);
      }
      transcript.push(completeMatch(h,d,counts,true));
      for(const previous of archive)assert.deepEqual(json(previous.match),previous.snapshot,'later matches leave every prior score/history unchanged');
      // Saving/restoring the finished state must preserve the winner and final
      // shot, and the next rematch must still start with an empty score sheet.
      roundTrip(h,d,counts);assert.equal(h.context.state.phase,'finish');
    }
    assert.ok(counts.shots>=36);assert.ok(counts.restores>=72);
    for(const phase of ['ready','aim','guard','runup','flight','result','finish',...(mode==='simple'?['power']:[])])assert.ok(counts.phases.has(phase),`restored ${phase}`);
    if(reference)nearTree(transcript,reference,`${mode}/${label}`);else reference=transcript;
    t.diagnostic(`${label}: 6 complete matches, ${counts.shots} real shots, ${counts.restores} Home/save/restore cycles`);
  });
});

for(const mode of ['simple','advanced'])test(`${mode}: two fresh applications restored from one mid-flight save remain independent through the final whistle`,()=>{
  const source=mainHarness(mode),sourceDriver=driver(source,schedules['60 Hz']);sourceDriver.tick();source.click('ready');
  commitAttack(source,sourceDriver,0);sourceDriver.until('flight');sourceDriver.advance(.1);source.emitWindow('pagehide');
  const saved=JSON.stringify(source.saved),sourceValue=json(source.context.state);
  const branches=[schedules['30 Hz'],schedules['irregular RAF']].map(schedule=>{
    const h=mainHarness(mode);h.context.localStorage.setItem('match',saved);h.click('resume-save');
    assert.equal(h.context.paused,true);assert.equal(h.context.state.phase,'flight');
    const d=driver(h,schedule);h.click('close');return {h,d};
  });
  const sibling=json(branches[1].h.context.state),transcripts=[];
  for(const [index,{h,d}] of branches.entries()){
    d.until('result');const first=physicalOutcome(h.context.state.shot);h.click('next');d.tick();
    transcripts.push({first,remaining:completeMatch(h,d,{shots:0,restores:0,phases:new Set()},false)});
    assert.deepEqual(json(source.context.state),sourceValue,'restored execution cannot change the source application');
    if(index===0)assert.deepEqual(json(branches[1].h.context.state),sibling,'one application cannot advance the other');
  }
  nearTree(transcripts[1],transcripts[0],`${mode}/independent applications`);
});

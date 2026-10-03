import test from 'node:test';
import assert from 'node:assert/strict';
import {Shot} from '../src/engine.js';
import {loadCharacter} from './helpers/load-character.js';
import {mainHarness} from './helpers/main-harness.js';

const schedules={
  '30 Hz':[1/30],
  '60 Hz':[1/60],
  '120 Hz':[1/120],
  'irregular frames':[1/120,.041,1/60,.083,.012,.027],
};
const json=value=>JSON.parse(JSON.stringify(value));
const near=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<1e-10,`${message}: ${actual} versus ${expected}`);
function commitDrag(h,id=1){
  h.gesture.emit('pointerdown',{pointerId:id,timeStamp:h.now});
  h.gesture.emit('pointermove',{pointerId:id,clientX:270,clientY:90,timeStamp:h.now+50});
  h.gesture.emit('pointerup',{pointerId:id,clientX:270,clientY:90,timeStamp:h.now+100});
}

// Actual main event handlers, Match/Shot, fixed stepping and Stadium presentation.
// DOM, storage, RAF scheduling and WebGL uploads are controlled stubs, not device QA.
for(const [label,schedule] of Object.entries(schedules)){
  test(`${label}: Ready before first returning RAF excludes suspended hidden time`,()=>{
    for(const mode of ['simple','advanced'])for(const turn of [0,1]){
      const h=mainHarness(mode,turn),{context}=h;h.tick(schedule[0]);
      h.hide(true);assert.equal(context.paused,false);const elapsed=context.elapsed;
      h.elapse(600);h.hide(false);h.click('ready');h.tick(schedule[0]);
      assert.equal(context.state.phase,turn?'guard':'aim','hidden time cannot expire a newly started turn');
      near(context.state.turnTime,schedule[0],'only visible input time is counted');
      near(context.elapsed-elapsed,schedule[0],'presentation excludes suspended time');
    }
  });

  test(`${label}: Close before first returning RAF preserves active aim, guard and runup clocks`,()=>{
    for(const phase of ['aim','guard','runup']){
      const h=mainHarness('advanced',phase==='guard'?1:0),{context}=h;
      h.click('ready');if(phase==='runup')commitDrag(h);h.tick(schedule[0]);
      const before=json(context.state),elapsed=context.elapsed;
      h.hide(true);assert.equal(context.paused,true);assert.equal(context.pointer,null);
      h.elapse(600);h.hide(false);h.click('close');
      assert.deepEqual(json(context.state),before,'resume itself changes no physical or input state');
      h.tick(schedule[0]);assert.equal(context.state.phase,phase);
      near(context.elapsed-elapsed,schedule[0],'active elapsed excludes pause');
      near(context.state.turnTime-before.turnTime,phase==='runup'?0:schedule[0],'input resumes immediately');
      near(context.state.runup-before.runup,phase==='runup'?schedule[0]:0,'runup resumes immediately');
    }
  });
}

for(const cancel of ['pointercancel','lostpointercapture'])test(`${cancel} from an unrelated or retired touch cannot cancel the current drag`,()=>{
  const h=mainHarness(),{context}=h;h.click('ready');const el=h.gesture;
  el.emit('pointerdown',{pointerId:1});el.emit('pointermove',{pointerId:1,clientX:270,clientY:90,timeStamp:100});
  const aim=context.state.aim,owner=context.pointer;
  el.emit('pointerdown',{pointerId:2});el.emit('pointermove',{pointerId:2,clientX:70,clientY:70});el.emit('pointerup',{pointerId:2});
  el.emit(cancel,{pointerId:2});assert.equal(context.pointer,owner);assert.equal(context.state.aim,aim);
  el.emit(cancel,{pointerId:1});assert.equal(context.pointer,null);assert.equal(context.state.aim,null);
  el.emit('pointerdown',{pointerId:3});el.emit('pointermove',{pointerId:3,clientX:270,clientY:90,timeStamp:200});
  const nextOwner=context.pointer,nextAim=context.state.aim;
  el.emit(cancel,{pointerId:1});el.emit('pointerup',{pointerId:1});
  assert.equal(context.pointer,nextOwner);assert.equal(context.state.aim,nextAim);
  el.emit('pointerup',{pointerId:3,clientX:270,clientY:90,timeStamp:300});assert.equal(context.state.phase,'runup');
  const committed=context.state.aim;el.emit(cancel,{pointerId:3});el.emit('pointerup',{pointerId:3});assert.equal(context.state.aim,committed);
});

function poseSnapshot(actor,stage){
  const {runup,after,options}=stage.drawnKick;actor.kick(runup,after,options);actor.root.updateMatrixWorld(true);
  const matrices=[];actor.root.traverse(node=>{if(node.isBone)matrices.push(...node.matrixWorld.elements);});
  return matrices;
}
function reboundBoundary(){
  const stats={accuracy:90,power:90,touch:90,composure:90,speed:65,reach:65,handling:95};
  const shot=new Shot({x:.3,y:2.24,power:.15},stats,stats,0,101);
  for(let step=0;step<3600&&!shot.touched;step++)shot.step(1/120);
  assert.ok(shot.touched&&!shot.caught&&!shot.result);assert.equal(shot.contactPart,'handL');
  assert.ok(shot.handlingUntil.handL>shot.t);assert.equal(shot.handlingUntil.handR,undefined);
  return shot;
}
function installRebound(h,raw){
  const shot=raw?Shot.restore(structuredClone(raw)):reboundBoundary();
  Object.assign(h.context.state,{phase:'flight',shot,aim:shot.aim});
  h.context.accumulator=1/960;return shot;
}

for(const [label,schedule] of Object.entries(schedules)){
  test(`${label}: complete touch drag keeps loaded striker stationary until one committed release`,async()=>{
    const h=mainHarness(),{context,s}=h,actor=await loadCharacter(false);h.click('ready');h.tick(schedule[0]);
    const standing=poseSnapshot(actor,s);h.gesture.emit('pointerdown');
    for(let frame=0;frame<30;frame++){
      const x=frame%2?100:280,y=90+frame%4*20;
      h.gesture.emit('pointermove',{clientX:x,clientY:y,timeStamp:h.now});h.tick(schedule[frame%schedule.length]);
      assert.equal(context.state.phase,'aim');assert.ok(context.state.aim);assert.equal(s.drawnKick.runup,0);
      assert.deepEqual(poseSnapshot(actor,s),standing,'all loaded striker bones keep the waiting pose');
    }
    const oldEl=h.gesture;oldEl.emit('pointerup',{clientX:270,clientY:90,timeStamp:h.now});
    assert.equal(context.state.phase,'runup');const aim=context.state.aim;assert.equal(aim.timeout,undefined);
    oldEl.emit('pointerup',{clientX:80,clientY:40});oldEl.emit('pointercancel');oldEl.emit('lostpointercapture');
    assert.equal(context.state.aim,aim);h.tick(schedule[0]);assert.ok(s.drawnKick.runup>0);
    assert.notDeepEqual(poseSnapshot(actor,s),standing,'the first active frame after release starts moving');
    let frames=0;while(context.state.phase==='runup'&&frames++<600)h.tick(schedule[frames%schedule.length]);
    assert.equal(context.state.phase,'flight');const shot=context.state.shot;
    oldEl.emit('pointerup');h.gesture.emit('pointerdown');h.gesture.emit('pointerup');assert.equal(context.state.shot,shot);
  });

  test(`${label}: held timeout stays stationary and visible unheld timeouts still fire on schedule`,()=>{
    for(const held of [false,true]){
      const h=mainHarness(),{context,s}=h;h.click('ready');
      if(held){h.gesture.emit('pointerdown');h.gesture.emit('pointermove',{clientX:270,clientY:90});}
      let frame=0,activeTime=0;
      while(activeTime<10+1e-8){const dt=schedule[frame++%schedule.length];h.tick(dt);activeTime+=dt;if(activeTime<10-1e-9)assert.equal(context.state.phase,'aim');}
      if(held){
        assert.equal(context.state.phase,'aim');assert.equal(s.drawnKick.runup,0);assert.equal(s.drawnKick.options.targetX,0);
        h.gesture.emit('pointerup',{clientX:270,clientY:90,timeStamp:h.now});
      }
      assert.equal(context.state.phase,'runup');assert.equal(context.state.aim.timeout,true);
    }
    const h=mainHarness('advanced',1),{context}=h;h.click('ready');let frame=0,activeTime=0;
    while(activeTime<3+1e-8){const dt=schedule[frame++%schedule.length];h.tick(dt);activeTime+=dt;if(activeTime<3-1e-9)assert.equal(context.state.phase,'guard');}
    assert.equal(context.state.phase,'flight');assert.ok(context.state.shot);
  });

  test(`${label}: pause, hidden and saved home resume preserve per-glove rebound state exactly`,()=>{
    for(const interruption of ['pause','hidden','home']){
      const h=mainHarness(),{context}=h,source=installRebound(h),raw=json(source),map=source.handlingUntil;
      const before=json(context.state),elapsed=context.elapsed,accumulator=context.accumulator;
      if(interruption==='hidden')h.hide(true);else h.click('pause');
      assert.equal(context.paused,true);assert.deepEqual(json(context.state),before);
      assert.equal(context.state.shot.handlingUntil,map);
      if(interruption==='home'){
        h.click('home');h.click('home');assert.equal(context.state.phase,'home');assert.deepEqual(json(h.saved.state),before);
        h.elapse(600);h.click('resume-save');h.click('resume-save');assert.equal(context.paused,true);
        assert.notEqual(context.state.shot,source);assert.notEqual(context.state.shot.handlingUntil,map);
      }else{h.elapse(600);if(interruption==='hidden')h.hide(false);}
      assert.deepEqual(json(context.state),before);assert.equal(context.elapsed,elapsed);assert.equal(context.accumulator,accumulator);
      h.click('close');assert.deepEqual(json(context.state),before);
      const control=mainHarness();installRebound(control,raw);
      for(let frame=0;frame<30&&context.state.phase==='flight';frame++){
        const dt=schedule[frame%schedule.length];h.tick(dt);control.tick(dt);
        assert.deepEqual(json(context.state.shot),json(control.context.state.shot),'resumed physics matches uninterrupted fixed steps');
      }
      assert.equal(context.state.phase,'result');assert.ok(context.state.shot.caught);assert.equal(context.state.shot.contactPart,'handR');
      assert.ok(context.state.shot.handlingUntil.handR>0);assert.equal(context.state.match.teams[0].kicks.length,1);
      const result=json(context.state.shot),newMap=context.state.shot.handlingUntil;
      h.click('pause');h.elapse(30);h.click('close');h.tick(schedule[0]);
      assert.deepEqual(json(context.state.shot),result);assert.equal(context.state.shot.handlingUntil,newMap);
      assert.equal(context.state.match.teams[0].kicks.length,1,'a resumed result records only once');
    }
  });

  test(`${label}: repeated Next, Home, restore and rematch keep a single clean round`,()=>{
    const h=mainHarness(),{context,s}=h;
    for(let round=0;round<4;round++){
      h.finish();h.tick(schedule[round%schedule.length]);const serial=context.state.match.serial;
      h.click('next');h.click('next');h.click('next');assert.equal(context.state.match.serial,serial+1);
      h.tick(schedule[round%schedule.length]);assert.equal(context.state.phase,'ready');assert.equal(context.state.shot,null);assert.equal(s.currentShot,null);
      assert.equal(s.cameraAngle,context.state.match.turn?Math.PI:0);
      const saved=json(context.state);h.click('home');h.click('home');h.tick(schedule[0]);h.click('resume-save');
      assert.deepEqual(json(context.state),saved);h.tick(schedule[0]);assert.equal(s.currentShot,null);
      assert.equal(s.cameraAngle,context.state.match.turn?Math.PI:0);
    }
    const old=context.state.match,rosters=json(old.teams.map(team=>team.players));
    h.click('rematch');h.click('rematch');h.click('confirm-new');h.click('first',{first:'0'});h.tick(schedule[0]);
    assert.notEqual(context.state.match,old);assert.equal(context.state.phase,'ready');assert.equal(context.state.match.serial,1);
    assert.deepEqual(json(context.state.match.teams.map(team=>team.players)),rosters);
    assert.deepEqual(json(context.state.match.teams.map(team=>team.kicks.length)),[0,0]);
    assert.equal(context.state.shot,null);assert.equal(s.currentShot,null);assert.equal(s.drawnKick.runup,0);
    h.click('ready');h.click('next');h.tick(schedule[0]);assert.equal(context.state.phase,'aim');assert.equal(context.state.match.serial,1);
  });
}

test('visible long frames retain the full input clock and committed runup timing',()=>{
  const aim=mainHarness();aim.click('ready');aim.tick(9.75);assert.equal(aim.context.state.phase,'aim');
  near(aim.context.state.turnTime,9.75,'visible input uses wall time even when presentation dt is capped');
  aim.tick(.26);assert.equal(aim.context.state.phase,'runup');assert.equal(aim.context.state.aim.timeout,true);
  const runup=mainHarness();runup.click('ready');commitDrag(runup);runup.tick(5);assert.equal(runup.context.state.phase,'flight');
  const guard=mainHarness('advanced',1);guard.click('ready');guard.tick(3.01);assert.equal(guard.context.state.phase,'flight');
  const simple=mainHarness('simple');simple.click('ready');simple.tick(600);assert.equal(simple.context.state.phase,'aim');
  near(simple.context.state.turnTime,600,'simple aiming remains unlimited');
});

test('blur cancels an in-progress touch, saves it paused and resumes before the next RAF',()=>{
  const h=mainHarness(),{context,s}=h;h.click('ready');h.tick(.12);
  const el=h.gesture;el.emit('pointerdown');el.emit('pointermove',{clientX:270,clientY:90});
  h.emitWindow('blur');assert.equal(context.paused,true);assert.equal(context.pointer,null);
  const before=json(context.state);assert.deepEqual(json(h.saved.state),before);
  h.elapse(30);el.emit('pointerup',{clientX:270,clientY:90});assert.deepEqual(json(context.state),before);
  h.click('close');h.tick(1/120);assert.equal(context.state.phase,'aim');assert.equal(s.drawnKick.runup,0);
  near(context.state.turnTime,.12+1/120,'blur excludes inactive time without delaying new input');
  commitDrag(h,3);assert.equal(context.state.phase,'runup');
});

test('pagehide persists a rebound and a new application restores both physical state and glove ownership',()=>{
  const old=mainHarness();const shot=installRebound(old);old.emitWindow('pagehide');
  const saved=json(old.saved),raw=json(shot),fresh=mainHarness();fresh.context.localStorage.setItem('match',JSON.stringify(saved));
  fresh.click('resume-save');assert.equal(fresh.context.paused,true);assert.deepEqual(json(fresh.context.state.shot),raw);
  assert.notEqual(fresh.context.state.shot.handlingUntil,shot.handlingUntil);
  const control=mainHarness();installRebound(control,raw);control.context.accumulator=0;
  fresh.elapse(600);fresh.click('close');
  for(let frame=0;frame<30&&fresh.context.state.phase==='flight';frame++){
    fresh.tick(1/120);control.tick(1/120);assert.deepEqual(json(fresh.context.state.shot),json(control.context.state.shot));
  }
  assert.equal(fresh.context.state.phase,'result');assert.equal(fresh.context.state.shot.contactPart,'handR');
  assert.deepEqual(json(shot),raw,'replaying the new application cannot mutate the original saved instance');
});

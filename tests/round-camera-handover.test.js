import test from 'node:test';
import assert from 'node:assert/strict';
import {mainHarness as harness} from './helpers/main-harness.js';

function assertRole(s,mode,turn){
  assert.equal(s.cameraAngle,turn?Math.PI:0,'camera switches roles on the first display frame');
  const expected=turn?[0,7.5,-5.8]:mode==='advanced'?[0,4.8,25.259562841530055]:[0,6,30];
  s.camera.position.toArray().forEach((value,i)=>assert.ok(Math.abs(value-expected[i])<1e-10));
  assert.equal(s.camera.fov,turn?74:mode==='advanced'?43:36);
}
const projection=s=>[...s.camera.position.toArray(),...s.camera.quaternion.toArray(),s.camera.fov,...s.camera.projectionMatrix.elements];
function dirtyResult(s){s.netDirty=true;s.net.geometry.attributes.position.array[0]=.8;s.trailCount=7;s.aftermath={previousRound:true};}
function assertReset(s){
  assert.equal(s.currentShot,null);assert.equal(s.currentResult,null);assert.equal(s.resultElapsed,0);assert.equal(s.aftermath,null);
  assert.equal(s.trailCount,0);assert.equal(s.trail.visible,false);assert.equal(s.netDirty,false);assert.ok(s.net.geometry.attributes.position.array.every(value=>value===0));
  assert.deepEqual(s.ball.position.toArray(),[0,.11,11]);assert.equal(s.drawnKeeper,s.waitingKeeperPose);assert.equal(s.drawnKick.runup,0);assert.equal(s.drawnKick.after,null);
}

for(const mode of ['simple','advanced'])for(const hz of [30,60,120])test(`${mode} Next cuts to each new role on its first ${hz} Hz frame`,()=>{
  const h=harness(mode),{context,s}=h,dt=1/hz;
  for(const turn of [1,0]){
    h.finish();h.tick(dt);dirtyResult(s);h.click('next');
    assert.equal(context.state.phase,'ready');assert.equal(context.state.turnTime,0);assert.equal(context.state.shot,null);
    h.tick(dt);assertRole(s,mode,turn);assertReset(s);
    assert.deepEqual(s.strikerColor,[context.state.match.teams[turn].color,context.state.match.teams[turn].players[context.state.match.kicker].number]);
    assert.deepEqual(s.keeperColor,[turn?'#83b8f4':'#f1c75b',1]);
    const view=projection(s);for(let i=0;i<5;i++){h.tick(dt);assert.deepEqual(projection(s),view,'there is no residual settling after the cut');}
  }
});

test('ready, drag preview, cancellation and committed runup work immediately with a stable next-round projection',()=>{
  const h=harness('advanced',1),{context,s}=h;h.finish();h.tick();h.click('next');h.click('ready');
  assert.equal(context.state.phase,'aim');
  h.gesture.emit('pointerdown');h.gesture.emit('pointermove',{clientX:280,clientY:90,timeStamp:100});h.tick();
  assertRole(s,'advanced',0);assert.ok(context.state.aim);assert.equal(s.drawnKick.runup,0);assert.equal(s.drawnKick.options.targetX,0);
  const view=projection(s);
  for(const cancel of ['pointercancel','lostpointercapture']){
    h.gesture.emit(cancel);assert.equal(context.state.aim,null);h.gesture.emit('pointerup');assert.equal(context.state.phase,'aim');
    h.gesture.emit('pointerdown');h.gesture.emit('pointermove',{clientX:100,clientY:120,timeStamp:200});h.tick();assert.deepEqual(projection(s),view);
  }
  h.gesture.emit('pointerup',{clientX:100,clientY:120,timeStamp:300});assert.equal(context.state.phase,'runup');h.tick();
  assert.ok(s.drawnKick.runup>0);assert.deepEqual(projection(s),view);
});

test('repeated Next advances once and cannot clear or restart the new round',()=>{
  const h=harness(),{context,s}=h;h.finish();h.tick();const serial=context.state.match.serial;
  h.click('next');h.click('next');h.click('next');assert.equal(context.state.match.serial,serial+1);h.tick();
  const resetCount=s.netResets,view=projection(s);h.click('ready');h.click('next');h.tick();
  assert.equal(context.state.phase,'guard');assert.equal(context.state.match.serial,serial+1);assert.equal(s.netResets,resetCount);assert.deepEqual(projection(s),view);
});

test('a same-turn serial change clears old presentation even when paused',()=>{
  const h=harness(),{context,s}=h;h.finish();h.tick();dirtyResult(s);const resets=s.netResets;
  context.state.match.serial+=2;context.beginTurn();context.paused=true;const draws=s.draws;h.tick();
  assert.equal(s.draws,draws+1);assert.equal(s.netResets,resets+1);assertRole(s,'advanced',0);assertReset(s);
  h.tick();assert.equal(s.draws,draws+1,'a static paused round remains cheap');
});

for(const action of ['new','rematch'])test(`${action} replaces a same-role/same-serial match without stale presentation`,()=>{
  const h=harness(),{context,s}=h;h.finish();h.tick();dirtyResult(s);
  const old=context.state.match,oldSerial=old.serial;h.click(action);h.click('first',{first:'0'});
  assert.notEqual(context.state.match,old);assert.equal(context.state.match.serial,oldSerial);context.paused=true;h.tick();
  assertReset(s);assertRole(s,'advanced',0);
});

test('pause before the first next-round draw still presents that role, then holds it',()=>{
  const h=harness(),{context,s}=h;h.finish();h.tick();dirtyResult(s);h.click('next');h.click('pause');
  assert.equal(context.paused,true);const draws=s.draws;h.tick();assert.equal(s.draws,draws+1);assertRole(s,'advanced',1);assertReset(s);
  const view=projection(s),resets=s.netResets;h.tick();assert.equal(s.draws,draws+1);assert.deepEqual(projection(s),view);
  s.needsRender=true;h.tick();assert.deepEqual(projection(s),view);assert.equal(s.netResets,resets);
  h.click('close');h.click('ready');h.tick();assert.equal(context.state.phase,'guard');assert.equal(s.netResets,resets);assert.deepEqual(projection(s),view);
});

test('finish preserves the final shot and does not perform a new-round reset',()=>{
  const h=harness(),{context,s}=h;const shot=h.finish();h.tick();context.state.match.winner=0;
  const view=projection(s),serial=context.state.match.serial,resets=s.netResets;h.click('next');h.tick();
  assert.equal(context.state.phase,'finish');assert.equal(context.state.shot,shot);assert.equal(s.currentShot,shot);assert.equal(s.currentResult,shot.result);
  assert.equal(context.state.match.serial,serial);assert.equal(s.netResets,resets);assert.ok(s.resultElapsed>0);assert.deepEqual(projection(s),view);
});

test('home and resume restore the saved role immediately without old round effects',()=>{
  const h=harness('advanced',1),{context,s}=h;h.tick();assertRole(s,'advanced',1);
  h.click('ready');h.gesture.emit('pointerdown');h.gesture.emit('pointermove',{clientX:260,timeStamp:100});
  h.click('home');assert.equal(context.pointer,null);h.tick();assert.equal(s.mode,'hero');const homeView=projection(s);
  dirtyResult(s);h.click('resume-save');assert.equal(context.state.phase,'guard');assert.equal(context.paused,true);h.tick();
  assert.equal(s.mode,'game');assertRole(s,'advanced',1);assert.notDeepEqual(projection(s),homeView);assertReset(s);
  const resets=s.netResets,view=projection(s);h.click('close');h.tick();assert.equal(s.netResets,resets);assert.deepEqual(projection(s),view);
});

test('reduced motion uses the same immediate handover and stable gameplay projection',()=>{
  for(const mode of ['simple','advanced']){
    const h=harness(mode),{s}=h;s.reducedMotion.matches=true;
    for(const turn of [1,0]){
      h.finish();h.tick();h.click('next');h.tick();assertRole(s,mode,turn);assertReset(s);assert.equal(s.rain.visible,false);
      const view=projection(s);h.click('ready');for(let i=0;i<5;i++){h.tick();assert.deepEqual(projection(s),view);}
    }
  }
});

test('resize during pause updates the static framing without advancing the turn or restarting presentation',()=>{
  const h=harness(),{context,s}=h;h.click('ready');h.tick();h.gesture.emit('pointerdown');h.gesture.emit('pointermove',{clientX:280,clientY:90,timeStamp:100});h.tick();h.click('pause');
  const turnTime=context.state.turnTime,resets=s.netResets,elapsed=context.elapsed,aim=context.state.aim,original=projection(s);
  for(const [width,height] of [[844,390],[320,900]]){
    const draws=s.draws;h.resize(width,height);h.tick(5);
    assert.equal(s.draws,draws+1);assert.deepEqual(s.bufferSize,[width,height,1]);assert.equal(s.camera.aspect,width/height);assert.equal(s.camera.fov,43);
    assert.equal(s.cameraAngle,0);assert.equal(s.camera.position.x,0);assert.equal(s.camera.position.y,4.8);
    assert.equal(s.netResets,resets);assert.equal(context.state.turnTime,turnTime);assert.equal(context.elapsed,elapsed);assert.equal(context.state.aim,aim);
    assert.equal(s.drawnKick.runup,0);assert.equal(s.drawnKick.options.targetX,0);assert.notDeepEqual(projection(s),original);
    const resized=projection(s);h.tick();assert.equal(s.draws,draws+1);assert.deepEqual(projection(s),resized);
  }
  const view=projection(s);h.click('close');for(let i=0;i<5;i++){h.tick();assert.deepEqual(projection(s),view);}
  assert.equal(context.state.phase,'aim');assert.equal(s.netResets,resets);
});

test('hidden time between Next and its first draw cannot delay the cut or consume input time on resume',()=>{
  const h=harness('advanced',1),{context,s}=h;h.finish();h.tick();h.click('next');h.click('ready');
  h.gesture.emit('pointerdown');h.gesture.emit('pointermove',{clientX:280,clientY:90,timeStamp:100});h.hide(true);
  assert.equal(context.paused,true);assert.equal(context.pointer,null);const draws=s.draws;h.tick(60);
  assert.equal(s.draws,draws);assert.equal(context.state.turnTime,0);assert.equal(context.state.phase,'aim');
  h.hide(false);h.tick();assert.equal(s.draws,draws+1);assertRole(s,'advanced',0);assert.equal(context.state.turnTime,0);assert.equal(s.drawnKick.runup,0);
  const view=projection(s),resets=s.netResets;h.gesture.emit('pointerup',{clientX:280,clientY:90,timeStamp:60100});assert.equal(context.state.phase,'aim');
  h.click('close');h.tick();assert.equal(context.state.phase,'aim');assert.ok(context.state.turnTime>0&&context.state.turnTime<.02);
  assert.deepEqual(projection(s),view);assert.equal(s.netResets,resets);
});

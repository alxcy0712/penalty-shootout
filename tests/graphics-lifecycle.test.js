import test from 'node:test';
import assert from 'node:assert/strict';
import {createGraphicsLifecycle} from '../src/graphics-lifecycle.js';
import {mainHarness} from './helpers/main-harness.js';

test('lost/restored/timeout duplicates are bounded and need explicit resume',()=>{
  const callbacks=new Map(),timers=new Map(),events=[];let id=0,prevented=0;
  const canvas={addEventListener:(n,f)=>callbacks.set(n,f),removeEventListener:n=>callbacks.delete(n)};
  const c=createGraphicsLifecycle({canvas,onChange:s=>events.push(s),setTimer:f=>{timers.set(++id,f);return id;},clearTimer:i=>timers.delete(i)});
  callbacks.get('webglcontextrestored')();assert.equal(c.status.state,'ready');
  const loss=()=>callbacks.get('webglcontextlost')({preventDefault(){prevented++;}});
  loss();loss();assert.equal(prevented,2);assert.equal(events.length,1);assert.equal(timers.size,1);assert.equal(c.resume(),false);
  const expired=[...timers.values()][0];timers.clear();expired();assert.equal(c.status.state,'failed');
  callbacks.get('webglcontextrestored')();assert.equal(c.status.state,'restoring');assert.equal(c.status.blocked,true);assert.equal(c.resume(),false);assert.equal(c.rendered(),true);
  assert.equal(c.resume(),true);assert.equal(c.resume(),false);
  loss();c.dispose();assert.equal(callbacks.size,0);assert.equal(timers.size,0);
});

for(const phase of ['ready','aim','runup','flight','result'])test(`actual main freezes ${phase} during context loss and retains one loop contract`,()=>{
  const h=mainHarness('advanced');h.context.state.phase=phase;
  if(phase==='flight'){h.context.state.aim={x:2,y:1,power:.7};h.context.release();}
  if(phase==='result')h.finish();
  h.tick();const before=JSON.stringify(h.context.state),elapsed=h.context.elapsed,draws=h.s.draws;
  h.s.renderer.domElement.emit('webglcontextlost');
  for(let i=0;i<10;i++)h.tick(.5);
  assert.equal(JSON.stringify(h.context.state),before);assert.equal(h.context.elapsed,elapsed);assert.equal(h.s.draws,draws);
  h.click('ready');assert.equal(JSON.stringify(h.context.state),before);
  h.s.renderer.domElement.emit('webglcontextrestored');h.tick(.5);
  assert.equal(JSON.stringify(h.context.state),before,'restored waits for acknowledgement');
  h.click('graphics-resume');h.tick(1/120);assert.equal(h.context.graphics.status.state,'ready');
  assert.ok(h.context.elapsed-elapsed<.02,'no accumulated missing wall time');
});

test('context recovery keeps independent user pause and retires stale drag',()=>{
  const h=mainHarness('advanced');h.click('ready');const old=h.gesture;old.emit('pointerdown');
  h.s.renderer.domElement.emit('webglcontextlost');assert.equal(h.context.pointer,null);
  old.emit('pointerup',{clientY:60});assert.equal(h.context.state.phase,'aim');
  h.click('pause');assert.equal(h.context.paused,true);
  h.s.renderer.domElement.emit('webglcontextrestored');h.tick(0);h.click('graphics-resume');h.tick(.3);
  assert.equal(h.context.paused,true);assert.equal(h.context.state.turnTime,0);
  h.click('close');h.tick(.01);assert.ok(h.context.state.turnTime<.02);
});

test('failed restore draw keeps game frozen and RAF alive; unsolicited restore cannot unlock it early',()=>{
  const h=mainHarness('advanced');h.click('ready');h.tick(.01);
  h.s.renderer.domElement.emit('webglcontextlost');h.s.renderer.domElement.emit('webglcontextrestored');
  const before=JSON.stringify(h.context.state),draw=h.s.renderer.render;
  h.s.renderer.render=()=>{throw Error('injected driver upload failure');};
  h.tick(.5);assert.equal(h.context.graphics.status.state,'failed');assert.equal(JSON.stringify(h.context.state),before);
  h.click('graphics-resume');h.tick(.5);assert.equal(JSON.stringify(h.context.state),before);
  assert.match(h.element('#runtime-status').innerHTML,/刷新/);
  h.s.renderer.render=draw;h.s.renderer.domElement.emit('webglcontextrestored');h.tick(.01);
  assert.equal(h.context.graphics.status.state,'restored');h.click('graphics-resume');h.tick(.01);
  assert.equal(h.context.graphics.status.state,'ready');
});

test('lost context during calibration cancels input, preserves draft and completed samples',()=>{
  const h=mainHarness('advanced');h.click('calibration');h.click('auto-calibrate');
  h.context.calibration.samples=[120];const draft=JSON.stringify(h.context.calibration.profile),pad=h.element('#calibration-pad');
  pad.emit('pointerdown');h.s.renderer.domElement.emit('webglcontextlost');pad.emit('pointerup',{clientY:100});
  assert.equal(h.context.pointer,null);assert.equal(JSON.stringify(h.context.calibration.profile),draft);
  assert.deepEqual(Array.from(h.context.calibration.samples),[120]);h.context.graphics.dispose();
});

test('asset loading prevents next action, and degraded retry is limited to stable boundaries',()=>{
  const h=mainHarness('advanced');let retries=0;
  h.s.keeper.assetStatus={state:'loading'};h.context.runtimeStatusChanged();
  h.click('ready');h.tick(2);assert.equal(h.context.state.phase,'ready');assert.equal(h.context.state.turnTime,0);
  assert.match(h.element('#runtime-status').innerHTML,/正在加载/);
  h.s.keeper.assetStatus={state:'error'};h.s.keeper.retryAssets=()=>{retries++;h.s.keeper.assetStatus={state:'loading'};h.context.runtimeStatusChanged();};
  h.context.runtimeStatusChanged();assert.match(h.element('#runtime-status').innerHTML,/简化模型/);
  h.click('retry-assets');h.click('retry-assets');assert.equal(retries,1);
  h.s.keeper.assetStatus={state:'ready'};h.context.runtimeStatusChanged();h.click('ready');
  h.s.striker.assetStatus={state:'degraded'};h.s.striker.retryAssets=()=>{retries++;};
  h.click('retry-assets');assert.equal(retries,1,'cannot change skin/motion during active aim');
  assert.equal(h.context.state.phase,'aim');
});

test('pagehide/pageshow retires interaction and excludes BFCache wall time',()=>{
  const h=mainHarness('advanced');h.click('ready');h.tick(.01);const time=h.context.state.turnTime;
  h.gesture.emit('pointerdown');h.emitWindow('pagehide');assert.equal(h.context.pointer,null);
  h.elapse(20);h.emitWindow('pageshow');h.tick(.01);
  assert.equal(h.context.state.turnTime,time);assert.equal(h.context.paused,true);
  h.click('close');h.tick(.01);assert.ok(h.context.state.turnTime-time<.02);
});

test('failed retry with retained skin does not claim procedural fallback',()=>{
  const h=mainHarness();h.s.keeper.assetStatus={state:'error',usingFallback:false};h.context.runtimeStatusChanged();
  assert.match(h.element('#runtime-status').innerHTML,/保留此前/);assert.doesNotMatch(h.element('#runtime-status').innerHTML,/简化模型/);
});

test('graphics deadline configuration cannot silently disable interruption feedback',()=>{
  for(const timeoutMs of [0,-1,NaN,Infinity])assert.throws(()=>createGraphicsLifecycle({timeoutMs}),RangeError);
});

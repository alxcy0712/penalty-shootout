import test from 'node:test';
import assert from 'node:assert/strict';
import {FrameProfile} from '../src/frame-profile.js';
import {mainHarness} from './helpers/main-harness.js';

function profiledMain(){
  const h=mainHarness(),reports=[],profile=new FrameProfile();
  const summary=profile.summary.bind(profile);profile.summary=now=>{const result=summary(now);if(result)reports.push(result);return result;};
  Object.assign(h.s,{frameProfile:profile,profile:{textContent:''},currentPixelRatio:1,profileAntialias:false,geometryCount:0});
  h.s.renderer.domElement={width:390,height:844};
  h.s.renderer.info={render:{calls:1,triangles:1},memory:{geometries:0,textures:0},reset(){}};
  return {...h,profile,reports};
}

test('actual main feeds raw foreground rAF stalls, independently of the simulation dt cap',()=>{
  const h=profiledMain();h.tick(.016);h.tick(.3);h.tick(3);
  const summary=h.reports.at(-1);
  assert.equal(summary.intervals.count,2);assert.equal(summary.intervals.meanMs,1650);
  assert.equal(summary.intervals.maxMs,3000);assert.equal(summary.intervals.over250,2);
  assert.ok(h.context.elapsed<1,'simulation remains capped without capping diagnostics');
});

test('actual pause and close events reset the sample baseline even with no intervening RAF',()=>{
  const h=profiledMain();h.tick(.016);h.tick(.016);
  h.context.showPause();h.elapse(8);h.context.closeModal();h.tick(.016);h.tick(.016);
  const count=h.reports.reduce((sum,s)=>sum+s.intervals.count,0)+h.profile.intervals.count;
  assert.equal(count,2);
  for(const report of h.reports)assert.ok(report.intervals.maxMs===null||report.intervals.maxMs===16);
  assert.equal(h.profile.intervals.maxMs,16);
  assert.equal(h.reports.at(-1).durationMs.idle,8000);
});

test('actual hidden and visible events do not turn an unobserved background period into a stall',()=>{
  const h=profiledMain();h.tick(.016);h.tick(.016);h.hide(true);h.elapse(10);h.hide(false);h.tick(.016);h.tick(.016);
  const report=h.reports.at(-1);
  assert.equal(report.durationMs.hidden,10000);assert.equal(report.intervals.maxMs,16);
  assert.equal(h.profile.intervals.maxMs,16);assert.equal(h.context.paused,false);
});

test('actual main refreshes sustained paused summaries while Stadium deliberately skips renders',()=>{
  const h=profiledMain();h.tick(.016);h.tick(.016);h.context.showPause();const draws=h.s.draws;
  for(let i=0;i<140;i++)h.tick(1/60);
  assert.equal(h.s.draws,draws);assert.equal(h.profile.state,'idle');
  assert.equal(h.reports.at(-1).intervals.count,0);assert.equal(h.reports.at(-1).renderCount,0);
  assert.match(h.s.profile.textContent,/主动闲置/);assert.match(h.s.profile.textContent,/FPS —/);
});

test('profile remains usable before a zero-size container establishes its first drawing-buffer DPR',()=>{
  const h=profiledMain();delete h.s.currentPixelRatio;
  h.hide(true);assert.doesNotThrow(()=>h.tick(.016));
  assert.match(h.s.profile.textContent,/DPR 未知/);
  h.hide(false);h.s.currentPixelRatio=1.7;h.tick(1.1);
  assert.match(h.s.profile.textContent,/DPR 1\.70/);
});

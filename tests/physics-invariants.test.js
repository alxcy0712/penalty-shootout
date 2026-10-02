import test from 'node:test';
import assert from 'node:assert/strict';
import {Shot} from '../src/engine.js';
import {auditShot,auditBoundaries,boundaryCases,capsuleEntry} from '../tools/qa/audit-physics-invariants.mjs';

test('physical audit independently resolves finite capsule entries',()=>{
  const a={x:0,y:0,z:0},b={x:0,y:2,z:0};
  assert.ok(Math.abs(capsuleEntry({x:0,y:1,z:1},{x:0,y:1,z:-1},a,b,.2)-.4)<1e-12);
  assert.equal(capsuleEntry({x:1,y:1,z:1},{x:1,y:1,z:-1},a,b,.2),Infinity);
  assert.equal(capsuleEntry({x:0,y:1,z:.1},{x:0,y:1,z:1},a,b,.2),0);
  assert.ok(Math.abs(capsuleEntry({x:0,y:3,z:0},{x:0,y:1,z:0},a,b,.2)-.4)<1e-12,'finite endpoint sphere');
});

test('fifteen retained post, keeper and whole-ball boundaries choose the first physical event',()=>{
  const records=auditBoundaries();assert.equal(records.length,15);
  for(const record of records)assert.deepEqual(record.failures,[],record.id);
  for(const record of records.filter(r=>r.id.startsWith('keeper-before-post'))){
    assert.equal(record.counts.keeperResolutions,1);assert.equal(record.counts.postResolutions,0);
    assert.equal(record.firstEvent.type,'keeper');assert.equal(record.lastPhysicalEvent.type,'keeper');
  }
  for(const record of records.filter(r=>r.id.startsWith('unobstructed-post'))){
    assert.equal(record.counts.postResolutions,1);assert.equal(record.counts.keeperResolutions,0);
  }
});

test('the audit detects an omitted post event from independent segment geometry',()=>{
  const {recipe,shot}=boundaryCases().find(c=>c.recipe.id==='endpoint-post-1-inside');
  // Deliberately replace the step with silent free flight. The audit must fail
  // even though no reflect/contact hook runs and all coordinates stay finite.
  shot.step=dt=>{shot.t+=dt;shot.previous={...shot.ball};shot.velocity.y-=9.81*dt;for(const key of['x','y','z'])shot.ball[key]+=shot.velocity[key]*dt;};
  const record=auditShot(recipe,{shot,maxSteps:1,stopAfterSteps:true});
  assert.equal(record.counts.postResolutions,0);
  assert.ok(record.failures.some(f=>f.invariant==='expected-post-contact-emitted'));
});

test('the reflection audit rejects an energy-adding resolver rather than recording its output',()=>{
  const {recipe,shot}=boundaryCases()[0],original=shot.reflect.bind(shot);
  shot.reflect=(...args)=>{original(...args);for(const key of['x','y','z'])shot.velocity[key]*=10;};
  const record=auditShot(recipe,{shot,maxSteps:1,stopAfterSteps:true});
  assert.ok(record.failures.some(f=>f.invariant==='reflection-energy-nonincreasing'));
});

test('a real failed-first-palm capture passes cooldown, terminal-state and catch invariants',()=>{
  const stats={accuracy:90,power:90,touch:90,composure:90,speed:65,reach:65,handling:95};
  const recipe={id:'two-glove-cooldown',aim:{x:.3,y:2.24,power:.15},stats,direction:0,seed:101,expectedCaught:true};
  const record=auditShot(recipe,{shot:new Shot(recipe.aim,stats,stats,0,101)});
  assert.deepEqual(record.failures,[]);assert.equal(record.counts.handlingRolls,2);
  assert.equal(record.firstEvent.part,'handL');assert.equal(record.lastPhysicalEvent.part,'handR');
  assert.equal(record.lastEvent.type,'result');assert.ok(record.terminated);
});

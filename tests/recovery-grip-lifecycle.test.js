import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Shot} from '../src/engine.js';
import {loadCharacter} from './helpers/load-character.js';
import {mainHarness} from './helpers/main-harness.js';

const baseline=JSON.parse(await readFile(new URL('../validation/model-motion-ten/recovery-origin-baseline.json',import.meta.url)));
const recipes=[...[-1,1].map(direction=>baseline.records.find(r=>r.recipe.direction===direction&&r.recipe.aim.x===0&&r.recipe.aim.power===.2&&r.recipe.stats.reach===90)),...baseline.records.filter(r=>r.compressed)];
assert.equal(recipes.length,4);assert.ok(recipes.every(Boolean));
const schedules={'30Hz':[1/30],'60Hz':[1/60],'120Hz':[1/120],irregular:[1/144,.019,.041,.007,.083]};
const camera=s=>[...s.camera.position.toArray(),...s.camera.quaternion.toArray(),...s.camera.projectionMatrix.elements];

// Actual main actions/RAF and Stadium with the loaded production keeper.
// DOM, storage and renderer submission remain controlled stubs, not device QA.
for(const [label,schedule]of Object.entries(schedules))test(`${label}: recovered catches and compressed results reset the real glove before the next held touch`,async()=>{
 for(const record of recipes){
  const recipe=record.recipe,h=mainHarness('advanced',1),actor=await loadCharacter(true);
  let glove;actor.root.traverse(m=>{if(m.isSkinnedMesh&&m.material.name==='Socks')glove=m;});
  const sourcePosition=Array.from(glove.geometry.attributes.position.array),sourceNormal=Array.from(glove.geometry.attributes.normal.array);
  const draw=h.s.keeper.pose;h.s.keeper.pose=p=>{draw(p);actor.pose(p);};
  const shot=new Shot(recipe.aim,recipe.stats,recipe.stats,recipe.direction,recipe.seed);
  while(!shot.result&&shot.t<30)shot.step(1/120,shot.playbackRate());assert.ok(shot.result);
  h.context.state.match.record(shot.result);Object.assign(h.context.state,{phase:'result',shot,aim:recipe.aim});h.context.render();
  h.tick(schedule[0]);assert.equal(h.s.resultElapsed,0);
  let frame=0;while(h.s.resultElapsed<.85)h.tick(schedule[frame++%schedule.length]);
  if(shot.caught)assert.ok(actor.fingerGrip.diagnostics().every(d=>d.amount===1&&d.thumbAmount===1));
  const pose=JSON.stringify(h.s.drawnKeeper),position=Array.from(glove.geometry.attributes.position.array),clock=h.s.resultElapsed;
  h.context.showPause();h.s.needsRender=true;h.tick(60);
  assert.equal(h.s.resultElapsed,clock);assert.equal(JSON.stringify(h.s.drawnKeeper),pose);
  assert.deepEqual(Array.from(glove.geometry.attributes.position.array),position);
  h.click('close');while(h.s.resultElapsed<4)h.tick(schedule[frame++%schedule.length]);
  assert.ok(h.s.drawnKeeper.hip.y>.75,'recovery finishes in the actual presentation caller');
  if(record.compressed)assert.ok(h.s.drawnKeeper.feet.every(p=>Math.abs(p.y-.0655)<1e-12),'completed unrolled support is retained');
  const serial=h.context.state.match.serial;h.click('next');h.click('next');h.tick(schedule[0]);
  assert.equal(h.context.state.match.serial,serial+1);assert.equal(h.s.resultElapsed,0);assert.equal(h.s.currentShot,null);
  assert.deepEqual(Array.from(glove.geometry.attributes.position.array),sourcePosition,'every distal finger and thumb resets');
  assert.deepEqual(Array.from(glove.geometry.attributes.normal.array),sourceNormal);
  h.click('ready');const view=camera(h.s);
  h.gesture.emit('pointerdown',{pointerId:8,timeStamp:h.now});
  h.gesture.emit('pointermove',{pointerId:8,clientX:280,clientY:90,timeStamp:h.now+50});
  h.tick(schedule[0]);assert.equal(h.context.state.phase,'aim');assert.equal(h.s.drawnKick.runup,0);
  assert.deepEqual(camera(h.s),view);assert.deepEqual(Array.from(glove.geometry.attributes.position.array),sourcePosition);
  h.gesture.emit('pointerup',{pointerId:8,clientX:280,clientY:90,timeStamp:h.now+100});h.tick(schedule[0]);
  assert.equal(h.context.state.phase,'runup');assert.ok(h.s.drawnKick.runup>0);
 }
});

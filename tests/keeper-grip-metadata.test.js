import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Shot} from '../src/engine.js';
import {keeperGather} from '../src/keeper-contact.js';
import {HOLD_DURATION} from '../src/anatomy.js';

test('finger skin receives the exact reach-limited sphere for every pinned catch',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../validation/ten-rounds/union-fixtures.json',import.meta.url)));
 let captures=0,reachLimited=0;
 for(const recipe of manifest.fixtures.filter(r=>r.expectedCaught)){
  const shot=new Shot(recipe.aim,recipe.stats,recipe.stats,recipe.direction,recipe.seed);
  for(let i=0;i<3600&&!shot.result;i++)shot.step(1/120);
  assert.equal(shot.caught,true,recipe.id);captures++;
  const start=keeperGather(shot.pose,shot.pose,shot.ball,shot.contactPart,0);
  assert.deepEqual(start.pose,shot.pose,'exact source pose at capture');
  for(const t of[1/240,.1,.3,.44,.9,1.5,2.8]){
   const current=shot.poseAt((shot.animationTime??shot.t)+t),source=JSON.stringify(current);
   const held=keeperGather(shot.pose,current,shot.ball,shot.contactPart,t/HOLD_DURATION);
   assert.deepEqual(held.pose.grip.ball,held.ball,recipe.id+' '+t);
   assert.equal(held.pose.grip.captureBlend,t/HOLD_DURATION,'authored closure uses absolute capture progress');
   assert.notEqual(held.pose.grip.ball,held.ball,'returned sphere and metadata own their values');
   assert.equal(JSON.stringify(current),source,'skin metadata cannot mutate caller pose');
   if(Math.hypot(held.ball.x-held.center.x,held.ball.y-held.center.y,held.ball.z-held.center.z)>.001)reachLimited++;
  }
 }
 assert.equal(captures,manifest.expectedCaptures);assert.ok(reachLimited>0,'cover cases where nominal centre is insufficient');
});

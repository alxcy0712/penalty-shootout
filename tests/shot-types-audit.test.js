import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Match,Shot,Random} from '../src/engine.js';

test('mixed shot types stay finite, settle and restore deterministically across player abilities',()=>{
  const rng=new Random(921);
  for(const mode of ['simple','advanced'])for(const type of ['normal','low','chip'])for(let seed=1;seed<=30;seed++){
    const match=new Match(mode,seed);match.start(seed%2);
    const shot=match.shoot({x:rng.range(-4.2,4.2),y:rng.range(.1,2.7),power:(seed-1)/29,curve:rng.range(-1,1),low:type==='low',chip:type==='chip'},seed%3-1);
    for(let frame=0;frame<20&&!shot.result;frame++)shot.step(1/120);
    const restored=Shot.restore(JSON.parse(JSON.stringify(shot)));
    for(let frame=0;frame<120*60&&!shot.result;frame++){
      shot.step(1/120);restored.step(1/120);
      for(const point of [shot.ball,shot.velocity,shot.pose.hip,...shot.pose.feet,...shot.pose.hands])for(const axis of ['x','y','z'])assert.ok(Number.isFinite(point[axis]));
      assert.ok(shot.ball.y>=.11-1e-8,`${mode}/${type}/${seed}: ball y=${shot.ball.y}, touched=${shot.touched}, post=${shot.post}`);
    }
    assert.ok(shot.result,`${mode}/${type}/${seed} must settle`);
    assert.deepEqual(restored.result,shot.result);
    match.record(shot.result);assert.equal(match.record(shot.result),false);
    assert.equal(match.teams[match.turn].kicks.length,1);
  }
});

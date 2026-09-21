import {test} from 'node:test';
import assert from 'node:assert/strict';
import {homeAnimation} from '../src/home-animation.js';
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
test('home camera moves continuously through the orbit and loop boundary',()=>{
  let previous=homeAnimation(0);
  for(let ms=1;ms<=40000;ms++){
    const frame=homeAnimation(ms/1000);
    assert.ok(distance(frame.camera,previous.camera)<.01);
    assert.ok(distance(frame.target,previous.target)<.01);
    assert.ok(Math.abs(frame.warmupTime-previous.warmupTime)<.004);
    previous=frame;
  }
  assert.ok(homeAnimation(9).target.z>11);
  assert.equal(homeAnimation(0).strikerVisible,false);
  assert.equal(homeAnimation(9).strikerVisible,true);
});
test('home striker runs up before contact and the ball leaves continuously',()=>{
  assert.ok(homeAnimation(8).striker.hip.z>homeAnimation(10).striker.hip.z);
  assert.deepEqual(homeAnimation(10).ball,{x:0,y:.11,z:11});
  let previous=homeAnimation(10.014);
  for(let ms=10015;ms<14000;ms++){
    const frame=homeAnimation(ms/1000);
    assert.ok(distance(frame.ball,previous.ball)<.025);
    for(const part of ['feet','hands'])for(let i=0;i<2;i++)assert.ok(distance(frame.striker[part][i],previous.striker[part][i])<.03);
    previous=frame;
  }
  assert.ok(homeAnimation(12).ball.z<0);
});

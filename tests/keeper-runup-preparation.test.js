import test from 'node:test';
import assert from 'node:assert/strict';
import {keeperRunupPreparation,goalkeeperPose} from '../src/anatomy.js';
import {loadCharacter,skinMinimum} from './helpers/load-character.js';
const stats={speed:85,reach:85};
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
test('neutral source-informed set steps end at the exact match collision stance',()=>{
  for(const side of[-1,1])for(const p of[0,1])assert.deepEqual(keeperRunupPreparation(stats,p,side),goalkeeperPose(stats,0,0,1));
  const left=keeperRunupPreparation(stats,.25,-1),right=keeperRunupPreparation(stats,.25,1);
  assert.ok(Math.abs(left.hip.x+right.hip.x)<1e-9);
  assert.ok(left.feet[0].z>.04,'same-side foot steps forward');
  assert.ok(right.feet[1].z>.04,'mirrored same-side foot steps forward');
});
test('pre-shot set steps keep fixed bones, a planted support and dense skin ground clearance',async()=>{
  const actor=await loadCharacter(true);let minimum=Infinity,maxStep=0,maxSupportDrift=0;
  for(const side of[-1,1]){
    let previous;
    for(let frame=0;frame<=480;frame++){
      const p=keeperRunupPreparation(stats,frame/480,side);
      for(let i=0;i<2;i++)for(const[a,b,l]of[['hips','knees',.43],['knees','feet',.43],['shoulders','elbows',.29],['elbows','hands',.27]])assert.ok(Math.abs(distance(p[a][i],p[b][i])-l)<1e-9);
      assert.ok(p.feet.some(foot=>Math.abs(foot.y-.075)<1e-8),'one grounded support each frame');
      if(previous){for(const key of['feet','hands','knees','elbows'])for(let i=0;i<2;i++)maxStep=Math.max(maxStep,distance(p[key][i],previous[key][i]));for(let i=0;i<2;i++)if(p.feet[i].y===.075&&previous.feet[i].y===.075)maxSupportDrift=Math.max(maxSupportDrift,distance(p.feet[i],previous.feet[i]));}
      if(frame%4===0){actor.pose(p);minimum=Math.min(minimum,skinMinimum(actor.root));}previous=p;
    }
  }
  console.log({minimum,maxStep,maxSupportDrift});assert.ok(minimum>-.003);assert.ok(maxStep<.015);assert.ok(maxSupportDrift<1e-8);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {penaltyStyles} from '../src/anatomy.js';
import {loadCharacter,skinSurfaceDistance} from './helpers/load-character.js';
import {recoverySkin,recoverySkinError} from '../tools/qa/audit-striker-recovery.mjs';

test('both captures retain identical whole-skin checkpoints after complete cadence-varied kick cycles',async t=>{
 const actor=await loadCharacter(),ball=new Vector3(0,.11,11),cadences=[[1/30],[1/60],[1/120],[1/144,.019,.041,.007,.083]];
 let cycles=0,updates=0,skinSamples=0,maxRepeatError=0,maxContactError=0,minimumSkin=Infinity;
 for(const [index,style]of penaltyStyles.entries())for(const shotType of ['normal','low','chip']){
  const options={style,shotType,targetX:index%2?-3.11:2.73,power:shotType==='chip'?.38:.73},times=[0,.173,style.duration-.231,style.duration,style.duration+.217,style.duration+.683,style.duration+1.371,style.duration+3];
  const apply=time=>actor.kick(Math.min(1,time/style.duration),time>style.duration?time-style.duration:null,options);
  const sample=time=>{apply(time);return recoverySkin(actor);};
  const expected=times.map(sample);
  for(const cadence of cadences){
   cycles++;let time=0,frame=0;
   while(time<times.at(-1)){apply(time);updates++;time+=cadence[frame++%cadence.length];}
   for(let i=times.length-1;i>=0;i--){const actual=sample(times[i]);skinSamples++;maxRepeatError=Math.max(maxRepeatError,recoverySkinError(expected[i],actual));for(let v=1;v<actual.length;v+=3)minimumSkin=Math.min(minimumSkin,actual[v]);}
   sample(style.duration);maxContactError=Math.max(maxContactError,Math.abs(skinSurfaceDistance(actor.root,ball,'Boots')-.11));
  }
 }
 assert.ok(maxRepeatError<1e-7,'cadence/history cannot alter exact evaluated captured skin');
 assert.ok(maxContactError<.002,'all repeated contacts stay on the real boot');
 assert.ok(minimumSkin>=-.005,'whole-skin checkpoints retain the existing turf gate');
 t.diagnostic(JSON.stringify({round:6,cycles,updates,skinSamples,maxRepeatError,maxContactError,minimumSkin,cadences}));
});

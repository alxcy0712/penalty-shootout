import test from 'node:test';
import assert from 'node:assert/strict';
import {ballContactShadow,drawContactShadow} from '../src/contact-shadow.js';
test('ball contact shadow softens and fades with separation without changing ground contact',()=>{
 assert.deepEqual(ballContactShadow(.11),{scale:1,opacity:.27});
 assert.deepEqual(ballContactShadow(-1),ballContactShadow(.11));
 let old=ballContactShadow(.11);
 for(let y=.12;y<=10;y+=.03){const next=ballContactShadow(y);assert.ok(next.scale>=old.scale&&next.scale<=5.16);assert.ok(next.opacity<old.opacity&&next.opacity>=0);old=next;}
 assert.ok(ballContactShadow(2).opacity<.03);
});
test('contact texture uses smooth transparent perimeter in a single tiny existing draw',()=>{
 const stops=[];let area;
 const ctx={createRadialGradient:(...args)=>{assert.deepEqual(args,[32,32,0,32,32,32]);return {addColorStop:(...stop)=>stops.push(stop)};},fillRect:(...args)=>area=args};
 drawContactShadow(ctx,64);assert.equal(stops.at(-1)[1],'rgba(0,0,0,0)');assert.deepEqual(area,[0,0,64,64]);
});

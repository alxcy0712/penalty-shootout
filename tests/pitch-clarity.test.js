import test from 'node:test';import assert from 'node:assert/strict';
import {pitchMarkingGeometry,PITCH_LINE_WIDTH} from '../src/pitch-markings.js';
import {configurePitchFiltering,renderPixelRatio} from '../src/rendering.js';
test('pitch sampling is hardware-capped at two and safe without anisotropy support',()=>{
 for(const [max,expected] of[[0,1],[1,1],[2,2],[16,2],[NaN,1]]){const texture={generateMipmaps:true,minFilter:1008};assert.equal(configurePitchFiltering(texture,{capabilities:{getMaxAnisotropy:()=>max}}),expected);assert.equal(texture.generateMipmaps,true);assert.equal(texture.minFilter,1008);}
 assert.equal(configurePitchFiltering({},{}),1);
});
test('paint ribbons have fixed width, positive upward normals and tiny bounded geometry',()=>{
 const geometry=pitchMarkingGeometry(),position=geometry.attributes.position,normal=geometry.attributes.normal;
 assert.equal(position.count/3,140);assert.equal(PITCH_LINE_WIDTH,.08);assert.equal(geometry.attributes.uv.count,position.count);
 for(let i=0;i<position.count;i++){assert.ok(Number.isFinite(position.getX(i)+position.getZ(i)));assert.ok(Math.abs(position.getY(i)-.007)<1e-8);assert.ok(normal.getY(i)>.9999);}
 assert.ok(Math.abs(Math.abs(position.getX(0)-position.getX(2))-PITCH_LINE_WIDTH)<1e-5);geometry.dispose();
});
test('default drawing-buffer cap remains unchanged for high-density phones',()=>{
 assert.equal(renderPixelRatio(390,844,3),1.7);assert.equal(renderPixelRatio(430,932,2),1.7);assert.ok(3840*2160*renderPixelRatio(3840,2160,3)**2<=3000000.0001);
});

test('drawing buffer is resized once only when logical size or effective DPR changes',async()=>{
 const {resizeDrawingBuffer}=await import('../src/rendering.js');const calls=[],renderer={setDrawingBufferSize:(...args)=>calls.push(args)};
 assert.equal(resizeDrawingBuffer(renderer,390,844,1.7),true);assert.deepEqual(calls,[[390,844,1.7]]);
 for(let i=0;i<100;i++)assert.equal(resizeDrawingBuffer(renderer,390,844,1.7),false);
 assert.equal(resizeDrawingBuffer(renderer,844,390,1.7),true);assert.equal(resizeDrawingBuffer(renderer,844,390,1),true);
 for(const args of[[0,10,1],[10,-1,1],[10,10,NaN],[Infinity,10,1]])assert.equal(resizeDrawingBuffer(renderer,...args),false);
 assert.equal(calls.length,3);
});

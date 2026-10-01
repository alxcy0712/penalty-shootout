import test from 'node:test';
import * as THREE from 'three';
import {KICK_CONTACT} from '../src/game-character.js';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const script=new URL('../tools/qa/export-character-poses.mjs',import.meta.url).pathname;

test('offline QA exporter documents its interface and rejects invalid motion recipes',()=>{
  assert.match(execFileSync(process.execPath,[script,'--help'],{encoding:'utf8'}),/gather/);
  assert.throws(()=>execFileSync(process.execPath,[script,'--motion','not-a-motion'],{stdio:'pipe'}),/Invalid/);
});

test('offline gather and kick exports include the actual ball, real mesh and reproducibility hashes',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'penalty-poses-'));
  try{
    for(const [actor,args] of [['keeper',['--motion','gather','--direction','1','--height','.3','--duration','.025','--fps','120']],['striker',['--actor','striker','--time',String(KICK_CONTACT)]]]){
      const out=join(directory,actor);execFileSync(process.execPath,[script,'--out',out,...args],{stdio:'pipe'});
      const meta=JSON.parse(await readFile(join(out,'poses.json'),'utf8')),bytes=await readFile(join(out,'poses.bin'));
      assert.equal(bytes.length,meta.frames*meta.components*4);assert.ok(meta.meshes.some(m=>m.role==='ball'));
      assert.ok(meta.meshes.filter(m=>m.role==='character').length>=6);
      assert.equal(meta.ballCenters.length,meta.frames);assert.ok(meta.ballCenters.flat().every(Number.isFinite));
      assert.match(meta.sha256['src/game-character.js'],/^[a-f0-9]{64}$/);
      assert.match(meta.sha256['tools/qa/export-character-poses.mjs'],/^[a-f0-9]{64}$/);
      if(actor==='keeper'){assert.equal(meta.frames,4);assert.ok(meta.capture.time>0);assert.match(meta.capture.contactPart,/^hand[LR]$/);}
      else {
        assert.ok(Math.abs(meta.ballCenters[0][2]-.11)<.01,'the contact ball uses the match radius/height');
        const floats=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),ball=new THREE.Vector3().fromArray(meta.ballCenters[0]),near=new THREE.Vector3();let gap=Infinity;
        for(const mesh of meta.meshes.filter(m=>m.role==='character'))for(const ids of mesh.faces){
          const triangle=new THREE.Triangle(...ids.map(i=>new THREE.Vector3().fromArray(floats,mesh.offset+i*3)));triangle.closestPointToPoint(ball,near);const distance=near.distanceTo(ball);if(Number.isFinite(distance))gap=Math.min(gap,distance);
        }
        assert.ok(Math.abs(gap-.11)<.002,'exported shoe contacts ball; attached root transform is applied exactly once');
      }
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});

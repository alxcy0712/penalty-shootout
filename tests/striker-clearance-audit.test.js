import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const tool=fileURLToPath(new URL('../tools/qa/audit-striker-clearance.mjs',import.meta.url));

test('clearance audit documents native/game clocks and rejects invalid sampling requests',()=>{
  const help=spawnSync(process.execPath,[tool,'--help'],{encoding:'utf8'});
  assert.equal(help.status,0);assert.match(help.stdout,/121 CMU10_01/);assert.match(help.stdout,/61 CMU10_03/);
  for(const override of [{FPS:'0'},{FPS:'invalid'},{SOURCES:'unknown'}]){
    const result=spawnSync(process.execPath,[tool],{env:{...process.env,...override},encoding:'utf8'});
    assert.notEqual(result.status,0);assert.match(result.stderr,/Invalid FPS or SOURCES/);
  }
});

test('paired clearance audit runs outside the repo and records hashes, timings and explicit residual seams',async()=>{
  const out=await mkdtemp(join(tmpdir(),'striker-clearance-'));
  try{
    const result=spawnSync(process.execPath,[tool],{cwd:out,env:{...process.env,ARTIFACT_DIR:out,FPS:'10',SOURCES:'10_01,10_03'},encoding:'utf8',timeout:60000});
    assert.equal(result.status,0,result.stderr);
    const records=JSON.parse(await readFile(join(out,'arm-clearance.json'),'utf8')),meta=JSON.parse(await readFile(join(out,'metadata.json'),'utf8'));
    assert.equal(records.length,20);assert.equal(meta.samples,20);
    assert.match(meta.hashes['src/striker-arm-clearance.js'],/^[a-f0-9]{64}$/);
    assert.match(meta.hashes['assets/characters/mocap-variants/cmu-10_03-kick.glb'],/^[a-f0-9]{64}$/);
    for(const record of records){
      assert.ok(Number.isFinite(record.nativeTime)&&Number.isFinite(record.gameTime));
      assert.equal(record.gameTimes.length,record.take==='10_01'?3:1);
      assert.equal(record.after.forearm.count,0);
      assert.ok(Number.isFinite(record.before.upper.max)&&Number.isFinite(record.after.upper.max));
      assert.ok(Number.isFinite(record.difference.upper.maxAddedSeparation));
    }
    assert.ok(records.some(record=>record.before.forearm.count>0),'raw comparisons exercise source crossings');
    assert.ok(records.some(record=>record.after.upper.count>0),'report internal garment seams instead of hiding them');
  }finally{await rm(out,{recursive:true,force:true});}
});

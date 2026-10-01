import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
test('every CMU source inventory entry matches the exact checked-in source bytes',async()=>{
  const base=new URL('../assets/characters/mocap/cmu-soccer/',import.meta.url);
  for(const row of JSON.parse(await readFile(new URL('inventory.json',base),'utf8'))){const bytes=await readFile(new URL(row.file,base));assert.equal(bytes.length,row.bytes,row.file);assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256,row.file);}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const root=new URL('../assets/characters/',import.meta.url),report=JSON.parse(await readFile(new URL('model-refinement.json',root)));
test('refined production meshes retain explicit mobile asset budgets and reproducible identities',async()=>{
  for(const name of['keeper-prototype','striker-mocap']){
    const bytes=await readFile(new URL(name+'.glb',root)),meta=JSON.parse(await readFile(new URL(name+'.json',root))),doc=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),report.models[name].sha256);
    const tris=doc.meshes.flatMap(m=>m.primitives).reduce((n,p)=>n+doc.accessors[p.indices].count/3,0);
    assert.equal(tris,meta.triangles);assert.ok(tris<=18000);assert.equal(bytes.length,meta.glbBytes);assert.ok(bytes.length<=450000);
    assert.equal(doc.materials.length,6);assert.equal(doc.textures.length,2);assert.equal(doc.skins[0].joints.length,22);
    for(const p of doc.meshes.flatMap(m=>m.primitives)){assert.equal(doc.accessors[p.attributes.WEIGHTS_0].type,'VEC4');assert.ok(p.attributes.COLOR_0!==undefined,'gear detail uses vertex color without extra materials');}
    assert.ok(meta.blender.startsWith('4.3'));assert.ok((await readFile(new URL(name+'.blend',root))).length>1000000,'editable Blender artifact accompanies each game model');
  }
});

test('compressed editable Blender files decode to the exact validated source bytes',async()=>{
  const originals={
    'keeper-prototype':'745e472568ec12e08d06d5efab74472846b9325d37a176061f4aa801603ba62a',
    'striker-mocap':'c49271d3e519e5e2069f34e06f31195d747b75d92a5590599e55f4f356a50eed',
  };
  for(const [name,sha] of Object.entries(originals)){
    const packed=await readFile(new URL(name+'.blend',root));
    assert.ok(packed.length<2000000,'lossless editable source stays within transfer budget');
    const original=gunzipSync(packed);
    assert.equal(original.subarray(0,7).toString(),'BLENDER');
    assert.equal(createHash('sha256').update(original).digest('hex'),sha);
  }
});

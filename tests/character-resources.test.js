import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createCharacterAssetCache} from '../src/character-asset-cache.js';
import {disposeCharacterAsset,disposeCharacterRuntime} from '../src/character-resources.js';

test('source cache closes each shared bitmap once after its last lease, and actors never close source images',async()=>{
  let closed=0,textureDisposals=0,materialDisposals=0,geometryDisposals=0;
  const bitmap={width:1,height:1,close(){closed++;}},diffuse=new THREE.Texture(bitmap),normal=new THREE.Texture(bitmap);
  const material=new THREE.MeshStandardMaterial({map:diffuse,normalMap:normal}),geometry=new THREE.PlaneGeometry(),scene=new THREE.Group();
  scene.add(new THREE.Mesh(geometry,material),new THREE.Mesh(geometry,material));
  for(const texture of [diffuse,normal])texture.addEventListener('dispose',()=>textureDisposals++);
  material.addEventListener('dispose',()=>materialDisposals++);geometry.addEventListener('dispose',()=>geometryDisposals++);
  const cache=createCharacterAssetCache({load:()=>({scene}),dispose:disposeCharacterAsset}),first=await cache.acquire('/source.glb'),second=await cache.acquire('/source.glb');
  const clone=material.clone(),runtime={root:new THREE.Group(),materials:new Set([clone]),leases:[first]};
  cache.dispose();disposeCharacterRuntime(runtime);disposeCharacterRuntime(runtime);
  assert.equal(closed,0);assert.equal(textureDisposals,0);assert.equal(materialDisposals,0);assert.equal(geometryDisposals,0);
  second.release();assert.equal(closed,1);assert.equal(textureDisposals,2);assert.equal(materialDisposals,1);assert.equal(geometryDisposals,1);
});

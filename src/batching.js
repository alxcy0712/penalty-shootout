import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Bake rigid details once. Each independently animated group keeps its transform.
export function batchRigidGroup(group) {
  group.updateWorldMatrix(true,true);
  const inverse=new THREE.Matrix4().copy(group.matrixWorld).invert(),buckets=new Map(),originals=[];
  group.traverse(object=>{
    if(!object.isMesh||object.isSkinnedMesh||object.isInstancedMesh||Array.isArray(object.material))return;
    const key=`${object.material.uuid}:${object.castShadow}:${object.receiveShadow}`;
    if(!buckets.has(key))buckets.set(key,{material:object.material,cast:object.castShadow,receive:object.receiveShadow,geometry:[]});
    const geometry=object.geometry.clone();geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,object.matrixWorld));
    buckets.get(key).geometry.push(geometry);originals.push(object);
  });
  for(const bucket of buckets.values()){
    const geometry=mergeGeometries(bucket.geometry,false);
    if(!geometry)throw new Error('Rigid geometry attributes must match');
    for(const source of bucket.geometry)source.dispose();
    const object=new THREE.Mesh(geometry,bucket.material);object.castShadow=bucket.cast;object.receiveShadow=bucket.receive;group.add(object);
  }
  for(const object of originals)object.removeFromParent();
  const empty=[];group.traverse(object=>{if(object!==group&&object.isGroup)empty.push(object);});for(const object of empty.reverse())if(!object.children.length)object.removeFromParent();
  // Original geometry may be shared by another character, so it stays owned by its creator.
}

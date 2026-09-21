import {test} from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';import {batchRigidGroup} from '../src/batching.js';
function vertices(group){group.updateWorldMatrix(true,true);const result=[],v=new THREE.Vector3();group.traverse(o=>{if(!o.isMesh)return;const position=o.geometry.attributes.position,index=o.geometry.index;for(let i=0;i<(index?.count??position.count);i++){v.fromBufferAttribute(position,index?index.getX(i):i).applyMatrix4(o.matrixWorld);result.push(`${o.material.uuid}:${v.toArray().map(n=>n.toFixed(4)).join(',')}`);}});return result.sort();}
test('rigid batches preserve world geometry, materials, and later group motion',()=>{
 const root=new THREE.Group();root.rotation.y=.42;root.position.set(2,1,3);const nested=new THREE.Group();nested.rotation.x=.3;root.add(nested);const material=new THREE.MeshStandardMaterial();
 for(let i=0;i<5;i++){const box=new THREE.Mesh(new THREE.BoxGeometry(.2,.4,.1),material);box.position.set(i*.12,i*.06,.03);box.rotation.z=i*.1;nested.add(box);}
 const before=vertices(root);batchRigidGroup(root);assert.deepEqual(vertices(root),before);assert.equal(root.children.length,1);assert.equal(root.children[0].geometry.index.count,5*36);
 root.rotation.y=.9;assert.notDeepEqual(vertices(root),before);
});

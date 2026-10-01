// Rebuild physics hulls from the shipped skin, in metres. Rendering and physics
// share these bind-space surfaces; no runtime GLTF loading is needed by Shot.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import * as THREE from 'three';
import {ConvexGeometry} from 'three/addons/geometries/ConvexGeometry.js';
import {createKeeperSkinPose} from '../src/keeper-skin-pose.js';
const bytes=await readFile(new URL('../assets/characters/keeper-prototype.glb',import.meta.url)),sha256=createHash('sha256').update(bytes).digest('hex');
const jsonLength=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+jsonLength));
for(const material of json.materials){delete material.pbrMetallicRoughness?.baseColorTexture;delete material.pbrMetallicRoughness?.metallicRoughnessTexture;delete material.normalTexture;}
bytes.fill(32,20,20+jsonLength);bytes.write(JSON.stringify(json),20);await MeshoptDecoder.ready;
const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
createKeeperSkinPose(gltf.scene,{shoulderSupport:true});
const skinPoseSha256=createHash('sha256').update(await readFile(new URL('../src/keeper-skin-pose.js',import.meta.url))).digest('hex');
const names=['hand','forearm','upper_arm','thigh','shin','foot'],groups={torso:[],head:[],...Object.fromEntries(names.flatMap(name=>['L','R'].map(side=>[name+side,[]])))},binds={},surfaces={handL:[],handR:[]},patch={vertices:[],weights:[],indices:[]},inverseBinds={};
gltf.scene.traverse(mesh=>{
  if(!mesh.isSkinnedMesh)return;
  const {position,skinIndex,skinWeight}=mesh.geometry.attributes;
  mesh.skeleton.bones.forEach((bone,i)=>{if(!binds[bone.name]){binds[bone.name]=new THREE.Quaternion().setFromRotationMatrix(mesh.skeleton.boneInverses[i].clone().invert()).normalize().toArray();inverseBinds[bone.name]=mesh.skeleton.boneInverses[i].toArray();}});
  const vertexWeights=[],points=[];
  for(let i=0;i<position.count;i++){
    const weights={};for(let k=0;k<4;k++){const name=mesh.skeleton.bones[skinIndex.getComponent(i,k)].name;weights[name]=(weights[name]??0)+skinWeight.getComponent(i,k);}
    const point=new THREE.Vector3().fromBufferAttribute(position,i).applyMatrix4(mesh.bindMatrix);vertexWeights.push(weights);points.push(point);
    // Rigid cores exclude blended shoulders/elbows, which retain their exact
    // weighted triangles in the dynamic patch below.
    // Other limbs use dominant-bone hulls; the rigid glove also retains exact
    // triangles below, so the thumb notch is never filled by its convex hull.
    if((weights.pelvis??0)+(weights.spine??0)+(weights.chest??0)+(weights.neck??0)>.98 && point.y<1.49)groups.torso.push(point.clone().sub(new THREE.Vector3(0,.92,0)));
    for(const name of Object.keys(groups).filter(n=>n!=='torso'))if((weights[name]??0)>((name.startsWith('hand')||name.startsWith('upper_arm')||name.startsWith('forearm'))?.98:.5)){const index=mesh.skeleton.bones.findIndex(b=>b.name===name),local=point.clone().applyMatrix4(mesh.skeleton.boneInverses[index]);if(name.startsWith('upper_arm')&&local.y<.015)continue;groups[name].push(local);}
  }
  const patchVertex=new Map(),indices=mesh.geometry.index;
  const isDeforming=weights=>Object.entries(weights).some(([name,weight])=>weight>.01&&/^(upper_arm|forearm|clavicle|shoulder_support)/.test(name))&&(Math.max(...Object.values(weights))<.99||Object.keys(weights).some(name=>name.startsWith('clavicle')||name.startsWith('shoulder_support')));
  for(let face=0;face<indices.count;face+=3){
    const ids=[indices.getX(face),indices.getX(face+1),indices.getX(face+2)];if(!ids.some(i=>isDeforming(vertexWeights[i])))continue;
    for(const index of ids){let id=patchVertex.get(index);if(id===undefined){id=patch.vertices.length;patchVertex.set(index,id);patch.vertices.push(points[index].toArray());patch.weights.push(Object.entries(vertexWeights[index]).filter(([,w])=>w>1e-8));}patch.indices.push(id);}
  }
  for(const side of ['L','R']){const name=`hand${side}`,boneIndex=mesh.skeleton.bones.findIndex(b=>b.name===name),inverse=mesh.skeleton.boneInverses[boneIndex],indices=mesh.geometry.index;
    for(let face=0;face<indices.count;face+=3){const triangle=[];let accepted=true;for(let corner=0;corner<3;corner++){const index=indices.getX(face+corner);let weight=0;for(let k=0;k<4;k++)if(skinIndex.getComponent(index,k)===boneIndex)weight+=skinWeight.getComponent(index,k);if(weight<.98){accepted=false;break;}triangle.push(new THREE.Vector3().fromBufferAttribute(position,index).applyMatrix4(mesh.bindMatrix).applyMatrix4(inverse));}if(accepted)surfaces[name].push(...triangle);}
  }
});
const hulls={};for(const [name,points] of Object.entries(groups)){
  const geometry=new ConvexGeometry(points),p=geometry.attributes.position,vertices=[],indices=[],seen=new Map();
  for(let i=0;i<p.count;i++){const v=[p.getX(i),p.getY(i),p.getZ(i)].map(x=>+x.toFixed(6)),key=v.join(',');let index=seen.get(key);if(index===undefined){index=vertices.length;seen.set(key,index);vertices.push(v);}indices.push(index);}
  hulls[name]={vertices,indices};
  if(surfaces[name]){const vertices=[],indices=[],seen=new Map();for(const point of surfaces[name]){const v=point.toArray().map(x=>+x.toFixed(6)),key=v.join(',');let index=seen.get(key);if(index===undefined){index=vertices.length;seen.set(key,index);vertices.push(v);}indices.push(index);}hulls[name].surface={vertices,indices};}
  console.log(name,points.length,vertices.length,indices.length/3);
}
// Micrometre coordinates and eight-digit weights keep the generated download
// compact; the precision is substantially below the millimetre contact gates.
patch.vertices=patch.vertices.map(p=>p.map(n=>+n.toFixed(6)));
patch.weights=patch.weights.map(list=>list.map(([name,w])=>[name,+w.toFixed(8)]));
for(const [name,matrix] of Object.entries(inverseBinds))inverseBinds[name]=matrix.map(n=>+n.toFixed(9));
await writeFile(new URL('../src/keeper-contact-data.js',import.meta.url),'// Generated by tools/generate-keeper-contact.mjs from keeper-prototype.glb.\nexport const keeperContactData='+JSON.stringify({source:{asset:'keeper-prototype.glb',sha256,skinPoseSha256,skinWeightsSha256:createHash('sha256').update(await readFile(new URL('../src/keeper-skin-weights.js',import.meta.url))).digest('hex')},hulls,binds,patch:{...patch,inverseBinds}})+';\n');

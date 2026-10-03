// Sample distinct, attributed CMU takes without changing production assets.
// node tools/mocap/sample-cmu-variants.mjs --take 10_03 --out /tmp/cmu-10_03.json
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {BVHLoader} from 'three/addons/loaders/BVHLoader.js';
const root=fileURLToPath(new URL('../../',import.meta.url)),args={};
for(let i=2;i<process.argv.length;i+=2)args[process.argv[i].replace(/^--/,'')]=process.argv[i+1];
// Pin the calibration mesh for byte-exact rebuilds; defaults to the current model.
const modelPath=path.resolve(args.model??path.join(root,'assets/characters/striker-mocap.glb'));
if(args.finalize){await finalizeVariant(args);process.exit(0);}
const recipes={
 '10_03':{start:1/20,end:2.55,contactSource:1.175,plantSource:1.05,releaseSource:1.34,lockStartSource:.96,lockEndSource:1.48,approachStartSeconds:0},
 '10_05':{start:.8,end:3.6,contactSource:2.52,plantSource:2.40,releaseSource:2.70,lockStartSource:2.27,lockEndSource:2.87,approachStartSeconds:.12},
};
const take=args.take??'10_03',recipe=recipes[take];if(!recipe)throw Error('Supported candidates: 10_03, 10_05');
const source=`assets/characters/mocap/cmu-soccer/${take}.soccer-kick-ball.bvh`,bytes=fs.readFileSync(path.join(root,source)),{skeleton,clip}=new BVHLoader().parse(bytes.toString('utf8'));
const sourceRoot=skeleton.bones[0],mixer=new THREE.AnimationMixer(sourceRoot),action=mixer.clipAction(clip).setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
const fps=120,frames=[],point=new THREE.Vector3();
for(let frame=0;frame<=Math.floor((recipe.end-recipe.start)*fps+1e-5);frame++){
 mixer.setTime(recipe.start+frame/fps);sourceRoot.updateMatrixWorld(true);const points={};
 for(const bone of skeleton.bones){const name=bone.name==='ENDSITE'?`${bone.parent.name}End`:bone.name;points[name]=point.setFromMatrixPosition(bone.matrixWorld).toArray();}
 frames.push(points);
}
const output=path.resolve(args.out??`/tmp/penalty-cmu-${take}.json`),data={take,source,sourceSha256:createHash('sha256').update(bytes).digest('hex'),sourceDurationSeconds:clip.duration,start:recipe.start,fps,frames,recipe,license:'CMU motion terms; cgspeed/Bruce Hahne Daz-friendly converted skeleton; no standalone resale; see mocap/cmu-soccer/README.md'};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(data));console.log(JSON.stringify({output,source,frames:frames.length,duration:(frames.length-1)/fps,contactSeconds:recipe.contactSource-recipe.start,sourceSha256:data.sourceSha256}));
// Export the original bind geometry for an offline preview in older Blender.
// No .blend compatibility guess, no importer bone-axis heuristic, no production write.
const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
const {MeshoptDecoder}=await import('three/addons/libs/meshopt_decoder.module.js');
const glbPath=modelPath,glb=Buffer.from(fs.readFileSync(glbPath)),jsonSize=glb.readUInt32LE(12),gltfJson=JSON.parse(glb.subarray(20,20+jsonSize));
const boneNames=gltfJson.skins[0].joints.map(index=>gltfJson.nodes[index].name);
for(const m of gltfJson.materials){delete m.pbrMetallicRoughness?.baseColorTexture;delete m.pbrMetallicRoughness?.metallicRoughnessTexture;delete m.normalTexture;}
glb.fill(32,20,20+jsonSize);glb.write(JSON.stringify(gltfJson),20);await MeshoptDecoder.ready;
const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.byteLength),'');
const meshes=[];gltf.scene.updateMatrixWorld(true);
gltf.scene.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;const {position,skinIndex,skinWeight}=mesh.geometry.attributes,vertices=[],weights=[],faces=[];
 for(let i=0;i<position.count;i++){const p=new THREE.Vector3().fromBufferAttribute(position,i).applyMatrix4(mesh.bindMatrix);vertices.push([p.x,-p.z,p.y]);weights.push(Array.from({length:4},(_,k)=>[boneNames[skinIndex.getComponent(i,k)],skinWeight.getComponent(i,k)]).filter(([,w])=>w>0));}
 for(let i=0;i<mesh.geometry.index.count;i+=3)faces.push([0,1,2].map(k=>mesh.geometry.index.getX(i+k)));
 meshes.push({name:mesh.name,material:mesh.material.name,color:mesh.material.color.toArray(),vertices,weights,faces});
});
const rigOut=path.resolve(args['rig-out']??'/tmp/penalty-variant-rig.json');fs.writeFileSync(rigOut,JSON.stringify({source:args.model??'assets/characters/striker-mocap.glb',sourceSha256:createHash('sha256').update(fs.readFileSync(glbPath)).digest('hex'),bones:boneNames,meshes}));console.log('Original bind preview geometry:',rigOut);

async function finalizeVariant(options){
 const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js'),{MeshoptDecoder}=await import('three/addons/libs/meshopt_decoder.module.js');await MeshoptDecoder.ready;
 const load=async file=>{const bytes=Buffer.from(fs.readFileSync(file)),length=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+length));for(const mat of json.materials??[]){delete mat.pbrMetallicRoughness?.baseColorTexture;delete mat.pbrMetallicRoughness?.metallicRoughnessTexture;delete mat.normalTexture;}bytes.fill(32,20,20+length);bytes.write(JSON.stringify(json),20);return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),'');};
 const rawPath=path.resolve(options.finalize),meta=JSON.parse(fs.readFileSync(options.meta??rawPath.replace(/\.glb$/,'.json'),'utf8'));
 const candidate=await load(rawPath),production=await load(modelPath);
 let sourceSkeleton,targetSkeleton;candidate.scene.traverse(m=>{if(m.isSkinnedMesh)sourceSkeleton??=m.skeleton});production.scene.traverse(m=>{if(m.isSkinnedMesh)targetSkeleton??=m.skeleton});
 let bindError=0;for(let i=0;i<sourceSkeleton.bones.length;i++){const bone=sourceSkeleton.bones[i],j=targetSkeleton.bones.findIndex(b=>b.name===bone.name);if(j<0)throw Error('Missing production bone '+bone.name);bindError=Math.max(bindError,...sourceSkeleton.boneInverses[i].elements.map((v,k)=>Math.abs(v-targetSkeleton.boneInverses[j].elements[k])));}
 if(sourceSkeleton.bones.length!==22||bindError>5e-6)throw Error('Candidate does not preserve production bind rig: '+bindError);
 const clip=candidate.animations.find(a=>a.name===meta.clipName);if(!clip)throw Error('Missing candidate clip');
 const mixer=new THREE.AnimationMixer(production.scene),action=mixer.clipAction(clip).setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
 const set=t=>{mixer.setTime(Math.max(0,Math.min(clip.duration,t)));production.scene.updateMatrixWorld(true);};
 set(meta.contactSeconds-.004);const before=production.scene.getObjectByName('footL').getWorldPosition(new THREE.Vector3());
 set(meta.contactSeconds+.004);const forward=production.scene.getObjectByName('footL').getWorldPosition(new THREE.Vector3()).sub(before);forward.y=0;forward.normalize();set(meta.contactSeconds);
 const triangles=[];
 production.scene.traverse(mesh=>{if(!mesh.isSkinnedMesh||mesh.material.name!=='Boots')return;mesh.skeleton.update();const {position,skinIndex,skinWeight}=mesh.geometry.attributes,vertices=[],valid=[];
  for(let i=0;i<position.count;i++){vertices.push(mesh.applyBoneTransform(i,new THREE.Vector3().fromBufferAttribute(position,i)).applyMatrix4(mesh.matrixWorld));let weight=0;for(let k=0;k<4;k++)if(['footL','toeL'].includes(mesh.skeleton.bones[skinIndex.getComponent(i,k)].name))weight+=skinWeight.getComponent(i,k);valid.push(weight>.8);}
  const ix=mesh.geometry.index;for(let i=0;i<ix.count;i+=3){const ids=[0,1,2].map(k=>ix.getX(i+k));if(ids.every(k=>valid[k])){const tri=new THREE.Triangle(...ids.map(k=>vertices[k]));if(tri.getArea()>1e-12)triangles.push(tri);}}
 });
 const ball=new THREE.Vector3(0,.11,0),near=new THREE.Vector3();
 const distance=shift=>{const center=ball.clone().addScaledVector(forward,-shift);let best=Infinity;for(const tri of triangles){tri.closestPointToPoint(center,near);best=Math.min(best,near.distanceTo(center));}return best;};
 let lo=-.3,hi=null;for(let v=-.295;v<=.300001;v+=.005){if(distance(v)<=.11){hi=v;break;}lo=v;}if(hi===null)throw Error('No physical shoe contact found near authored event');
 for(let i=0;i<45;i++){const mid=(lo+hi)/2;if(distance(mid)>.11)lo=mid;else hi=mid;}
 const shift=forward.clone().multiplyScalar((lo+hi)/2);
 const localShift=shift.clone().applyQuaternion(production.scene.getObjectByName('pelvis').parent.getWorldQuaternion(new THREE.Quaternion()).invert());
 const bytes=fs.readFileSync(rawPath),jsonLength=bytes.readUInt32LE(12),original=JSON.parse(bytes.subarray(20,20+jsonLength)),bin=bytes.subarray(28+jsonLength);
 const typeSize={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};
 const readAccessor=index=>{const a=original.accessors[index],view=original.bufferViews[a.bufferView],size=typeSize[a.type];if(a.componentType!==5126)throw Error('Expected float animation data');const data=new Float32Array(a.count*size),dv=new DataView(bin.buffer,bin.byteOffset,bin.byteLength),stride=view.byteStride??size*4;for(let i=0;i<a.count;i++)for(let k=0;k<size;k++)data[i*size+k]=dv.getFloat32((view.byteOffset??0)+(a.byteOffset??0)+i*stride+k*4,true);return data;};
 const output={asset:{version:'2.0',generator:'Penalty Night distinct CMU retarget pipeline'},scene:original.scene??0,scenes:original.scenes,nodes:original.nodes.map(({mesh,skin,weights,...node})=>node),buffers:[],bufferViews:[],accessors:[],animations:[]},chunks=[],map=new Map();let byteLength=0;
 function accessor(index,offset=false){const key=index+':'+offset;if(map.has(key))return map.get(key);const data=readAccessor(index),old=original.accessors[index];if(offset)for(let i=0;i<data.length;i+=3){data[i]+=localShift.x;data[i+1]+=localShift.y;data[i+2]+=localShift.z;}const view=output.bufferViews.length;output.bufferViews.push({buffer:0,byteOffset:byteLength,byteLength:data.byteLength});chunks.push(Buffer.from(data.buffer));byteLength+=data.byteLength;const id=output.accessors.length,a={bufferView:view,componentType:5126,count:old.count,type:old.type};if(old.type==='SCALAR'){a.min=[Math.min(...data)];a.max=[Math.max(...data)];}output.accessors.push(a);map.set(key,id);return id;}
 for(const animation of original.animations){if(animation.name!==meta.clipName)continue;const next={name:animation.name,samplers:[],channels:[]};for(const channel of animation.channels){const sampler=animation.samplers[channel.sampler],offset=original.nodes[channel.target.node].name==='pelvis'&&channel.target.path==='translation';const index=next.samplers.length;next.samplers.push({input:accessor(sampler.input),output:accessor(sampler.output,offset),interpolation:sampler.interpolation??'LINEAR'});next.channels.push({...channel,sampler:index});}output.animations.push(next);}
 output.buffers=[{byteLength}];const json=Buffer.from(JSON.stringify(output)),jpad=Buffer.alloc((4-json.length%4)%4,32),binary=Buffer.concat(chunks),bpad=Buffer.alloc((4-binary.length%4)%4),header=Buffer.alloc(12),jh=Buffer.alloc(8),bh=Buffer.alloc(8);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(12+8+json.length+jpad.length+8+binary.length+bpad.length,8);jh.writeUInt32LE(json.length+jpad.length);jh.writeUInt32LE(0x4e4f534a,4);bh.writeUInt32LE(binary.length+bpad.length);bh.writeUInt32LE(0x004e4942,4);
 const outDir=path.resolve(options.outdir??'/tmp/penalty-mocap-variants');fs.mkdirSync(outDir,{recursive:true});const name=`cmu-${meta.take}-kick`,asset=path.join(outDir,name+'.glb');fs.writeFileSync(asset,Buffer.concat([header,jh,json,jpad,bh,binary,bpad]));
 delete meta.previewGlb;meta.asset=name+'.glb';meta.bytes=fs.statSync(asset).size;meta.sha256=createHash('sha256').update(fs.readFileSync(asset)).digest('hex');meta.bindMatrixMaxError=bindError;meta.ballPosition=[0,.11,0];meta.contactCalibration={method:'selected low swing event; translate whole captured root horizontally until real kicking-boot triangles touch radius 0.11 ball',translation:shift.toArray(),surfaceError:distance((lo+hi)/2)-.11,capturedBallTrack:false};meta.adaptations.push('measured true shoe surface contact alignment');meta.productionAssetSha256=createHash('sha256').update(fs.readFileSync(modelPath)).digest('hex');meta.pipeline={sample:'tools/mocap/sample-cmu-variants.mjs',retarget:'tools/blender/create_mocap_variants.py',blender:'4.3-compatible reconstruction of original bind rig; source 5.x Blend remains untouched'};
 const inventory=JSON.parse(fs.readFileSync(path.join(root,'assets/characters/mocap/cmu-soccer/inventory.json'),'utf8')).find(item=>item.file.startsWith(meta.take+'.'));
 meta.sourceInventoryNote={currentInventorySha256:inventory?.sha256,actualRepositorySha256:meta.sourceSha256,actualRepositoryBytes:fs.statSync(path.join(root,meta.source)).size,currentInventoryMatches:inventory?.sha256===meta.sourceSha256,explanation:'The legacy inventory differed from the supplied BVH; use the current recorded and actual hashes without assuming the historical cause. The raw BVH was not changed by this pipeline.'};
 meta.startsInMotion=true;meta.preparationHint='This real take begins mid-approach after the conversion initialization frame; freeze a prepared pose or crossfade into the start rather than looping this clip as idle.';
 fs.writeFileSync(path.join(outDir,name+'.json'),JSON.stringify(meta,null,2)+'\n');console.log(JSON.stringify(meta,null,2));
}

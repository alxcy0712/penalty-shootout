#!/usr/bin/env node
// Export A/B CPU-skinned production geometry; simplified offline materials.
// ARTIFACT_DIR=/tmp/runup-onset node tools/qa/export-runup-onset.mjs
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import * as THREE from 'three';
import {loadCharacter} from '../../tests/helpers/load-character.js';
import {penaltyStyles} from '../../src/anatomy.js';
import {setOnsetPose,ONSET_WINDOW} from './audit-runup-onset.mjs';
const out=resolve(process.env.ARTIFACT_DIR??'/tmp/runup-onset'),window=ONSET_WINDOW,ramp=.02;
const times=(process.env.EXPORT_TIMES??'0,.0166666667,.0333333333,.0666666667,.125,.2').split(',').map(Number),actor=await loadCharacter(),meshes=[];
actor.root.traverse(m=>{if(m.isSkinnedMesh)meshes.push(m);});
for(const [styleIndex,style]of penaltyStyles.entries()){
  const path=join(out,'style-'+styleIndex);await mkdir(path,{recursive:true});
  const meta={format:'penalty-character-cpu-skin-v1',note:'Left: baseline. Right: candidate. CPU skin and simplified offline materials; not browser/WebGL or device proof.',recipe:{styleIndex,style:style.name,window,ramp,times},frames:times.length,fps:60,components:0,meshes:[]};
  for(const mode of['baseline','candidate'])for(const mesh of meshes){
    const g=mesh.geometry,faces=[];for(let i=0;i<g.index.count;i+=3)faces.push([g.index.getX(i),g.index.getX(i+1),g.index.getX(i+2)]);
    meta.meshes.push({name:mode+'_'+mesh.name,role:'character',material:mesh.material.name,color:mesh.material.color.toArray(),count:g.attributes.position.count,offset:meta.components,faces,vertexColors:g.attributes.color?Array.from({length:g.attributes.color.count},(_,i)=>{const a=g.attributes.color;return[a.getX(i),a.getY(i),a.getZ(i),a.itemSize===4?a.getW(i):1];}):undefined});
    meta.components+=g.attributes.position.count*3;
  }
  setOnsetPose(actor,0,style);const centre=actor.root.getObjectByName('pelvis').getWorldPosition(new THREE.Vector3());
  const data=new Float32Array(meta.components*times.length),point=new THREE.Vector3(),angle=.8,cos=Math.cos(angle),sin=Math.sin(angle);let cursor=0;
  for(const time of times)for(const [mode,w]of[['baseline',0],['candidate',window]]){
    setOnsetPose(actor,time,style,w);
    for(const mesh of meshes){mesh.skeleton.update();for(let i=0;i<mesh.geometry.attributes.position.count;i++){
      point.fromBufferAttribute(mesh.geometry.attributes.position,i);mesh.applyBoneTransform(i,point).applyMatrix4(mesh.matrixWorld);
      const x=point.x-centre.x,y=point.z-centre.z;
      data[cursor++]=cos*x-sin*y+(mode==='baseline'?-.75:.75);data[cursor++]=sin*x+cos*y;data[cursor++]=point.y;
    }}
  }
  await writeFile(join(path,'poses.bin'),new Uint8Array(data.buffer));await writeFile(join(path,'poses.json'),JSON.stringify(meta));
  console.log(JSON.stringify({styleIndex,path,frames:times.length,bytes:data.byteLength}));
}

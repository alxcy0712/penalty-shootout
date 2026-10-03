// Actual CPU-skinned glove patch/floor diagnostics; does not simulate load or balance.
import * as THREE from 'three';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadCharacter} from '../../tests/helpers/load-character.js';
import {goalkeeperPose} from '../../src/anatomy.js';
const root=new URL('../../',import.meta.url),out=process.env.ARTIFACT_DIR??'/tmp/keeper-support-probe';await mkdir(out,{recursive:true});
const files=['src/anatomy.js','src/keeper-contact.js','src/keeper-torso.js','src/keeper-skin-pose.js','assets/characters/keeper-prototype.glb'];
const hash=async()=>Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(new URL(f,root))).digest('hex')])));const hashes=await hash();
const c=await loadCharacter(true),meshes=[];c.root.traverse(m=>{if(m.isSkinnedMesh)meshes.push(m)});const tmp=new THREE.Vector3(),refs=[],patches=[[],[]];
for(const [mi,m]of meshes.entries()){
 const {position,skinIndex,skinWeight}=m.geometry.attributes,vs=[];
 for(let i=0;i<position.count;i++){
  let w=0,b=0;for(let k=0;k<4;k++)if(skinWeight.getComponent(i,k)>w){w=skinWeight.getComponent(i,k);b=skinIndex.getComponent(i,k)}
  const role=m.skeleton.bones[b].name;const local=new THREE.Vector3().fromBufferAttribute(position,i).applyMatrix4(m.bindMatrix).applyMatrix4(m.skeleton.boneInverses[b]);vs.push({role,w,local});
 }
 refs.push(vs);
 for(let f=0;f<m.geometry.index.count;f+=3){const ids=[0,1,2].map(k=>m.geometry.index.getX(f+k)),v=ids.map(i=>vs[i]);for(let side=0;side<2;side++){
  const role=side?'handR':'handL';if(!v.every(x=>x.role===role&&x.w>.9))continue;
  const center=v.reduce((s,x)=>s.add(x.local),new THREE.Vector3()).multiplyScalar(1/3),normal=new THREE.Vector3().crossVectors(v[1].local.clone().sub(v[0].local),v[2].local.clone().sub(v[0].local)).normalize();
  // A central palm patch, excluding fingertips, thumb tip and wrist cuff.
  if(center.y>.055&&center.y<.125&&Math.abs(center.x-(side?-.018:.018))<.04&&center.z>.004&&normal.z>.5)patches[side].push({mi,ids});
 }}
}
if(patches.some(p=>!p.length))throw Error('No actual central palm patch selected');
const times=process.env.TIMES?.split(',').map(Number)??[.6,.7,.8,.9,1,1.1,1.2,1.3,1.4,1.5,1.6,1.7,1.8,1.9,2,2.1];const records=[];
for(const d of[-1,1])for(const h of[.3,1.2,2.3])for(const t of times){const pose=goalkeeperPose({speed:85,reach:85},d,t,h);c.pose(pose);c.root.updateMatrixWorld(true);const mins={},points=meshes.map((m,mi)=>{m.skeleton.update();return refs[mi].map((ref,i)=>{const p=new THREE.Vector3().fromBufferAttribute(m.geometry.attributes.position,i);m.applyBoneTransform(i,p).applyMatrix4(m.matrixWorld);mins[ref.role]=Math.min(mins[ref.role]??Infinity,p.y);return p})});
 const hands=patches.map((patch,side)=>{let area=0,height=0,min=Infinity,max=-Infinity;const norm=new THREE.Vector3();for(const {mi,ids}of patch){const [a,b,c]=ids.map(i=>points[mi][i]),n=new THREE.Vector3().crossVectors(b.clone().sub(a),c.clone().sub(a)),weight=n.length()/2;if(weight<1e-14)continue;area+=weight;height+=(a.y+b.y+c.y)/3*weight;norm.add(n);min=Math.min(min,a.y,b.y,c.y);max=Math.max(max,a.y,b.y,c.y)}norm.normalize();return{side:side?'R':'L',brace:pose.torso?.[side?'braceR':'braceL']??0,wristY:pose.hands[side].y,gloveMinY:mins[side?'handR':'handL'],palmMinY:min,palmMaxY:max,palmMeanY:height/area,palmNormalDown:-norm.y,palmTiltDegrees:THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(-norm.y,-1,1)))};});records.push({d,h,t,hands,partMinY:mins});}
const hashesAfter=await hash();if(JSON.stringify(hashes)!==JSON.stringify(hashesAfter))throw Error('Source changed during support probe');
const result={note:'Actual skinned central-palm triangles, excluding fingertips/thumb tip/cuff. Heights are relative to nominal y=0. Proximity/orientation diagnostic only, not force or balance simulation.',hashes,patchFaces:patches.map(p=>p.length),records};await writeFile(out+'/support-patch.json',JSON.stringify(result,null,2));const full=records.flatMap(r=>r.hands.filter(h=>h.brace>.99).map(h=>({d:r.d,height:r.h,t:r.t,...h})));console.log(JSON.stringify({out,patchFaces:result.patchFaces,fullBraceSamples:full.length,minPalmY:Math.min(...full.map(h=>h.palmMinY)),maxPalmY:Math.max(...full.map(h=>h.palmMinY)),maxMeanY:Math.max(...full.map(h=>h.palmMeanY)),maxTilt:Math.max(...full.map(h=>h.palmTiltDegrees)),worst:full.toSorted((a,b)=>b.palmMinY-a.palmMinY).slice(0,4)},null,2));

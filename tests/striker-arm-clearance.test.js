import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {loadCharacter} from './helpers/load-character.js';
import {ARM_CLEARANCE_SOURCE,ARM_CLEARANCE_COMPACT_SOURCE,createStrikerArmClearance,strikerArmClearanceAngle,strikerArmProtractionAngle} from '../src/striker-arm-clearance.js';
import {updateKeeperShoulderSupport} from '../src/keeper-skin-pose.js';

const point=(root,name)=>root.getObjectByName(name).getWorldPosition(new THREE.Vector3());

test('arm clearance is source-specific, bounded and C2 through its narrow native-time window',()=>{
  for(let t=0;t<=3.6;t+=.001){
    const angle=strikerArmClearanceAngle(t,ARM_CLEARANCE_SOURCE);
    assert.ok(angle<=0&&angle>=-.5);
    const protraction=strikerArmProtractionAngle(t,ARM_CLEARANCE_COMPACT_SOURCE);
    assert.ok(protraction<=0&&protraction>=-.15);
    assert.equal(strikerArmClearanceAngle(t,ARM_CLEARANCE_COMPACT_SOURCE),0,'compact source uses its separate protraction calibration');
    assert.equal(strikerArmProtractionAngle(t,ARM_CLEARANCE_SOURCE),0);
    assert.equal(strikerArmClearanceAngle(t,'unmeasured_capture'),0);
    assert.equal(strikerArmProtractionAngle(t,'unmeasured_capture'),0);
    if(t<=2.08||t>=2.50)assert.equal(angle,0);
    if(t<=1.30||t>=1.68)assert.equal(protraction,0);
  }
  const h=1e-6;
  for(const [f,joins] of [[t=>strikerArmClearanceAngle(t,ARM_CLEARANCE_SOURCE),[2.08,2.20,2.40,2.50]],[t=>strikerArmProtractionAngle(t,ARM_CLEARANCE_COMPACT_SOURCE),[1.30,1.43,1.55,1.68]]])for(const t of joins){
    assert.ok(Math.abs((f(t)-f(t-h))/h-(f(t+h)-f(t))/h)<1e-5,'no correction velocity jump');
    assert.ok(Math.abs((f(t+h)-2*f(t)+f(t-h))/(h*h))<.05,'zero correction acceleration at each join');
  }
});

test('arm correction preserves every unrelated channel, fixed segment lengths and deterministic scrubbing',async()=>{
  const actor=await loadCharacter(),root=actor.root,apply=createStrikerArmClearance(root);let maxStep=0;
  for(const source of [ARM_CLEARANCE_SOURCE,ARM_CLEARANCE_COMPACT_SOURCE]){let previous;
  const index=actor.actions.findIndex(action=>action.getClip().name===source);
  for(let frame=0;frame<=720;frame++){
    const time=frame/240;apply.restore();actor.capture(time,index);root.updateMatrixWorld(true);
    const untouched=['pelvis','chest','head','upper_armL','forearmL','handL','thighL','shinL','footL','thighR','shinR','footR'].map(name=>[name,point(root,name)]);
    const shoulder=point(root,'upper_armR'),elbow=point(root,'forearmR'),hand=point(root,'handR'),lengths=[shoulder.distanceTo(elbow),elbow.distanceTo(hand)];
    const localLengths=['upper_armR','forearmR','handR'].map(name=>root.getObjectByName(name).position.length());
    const directions=[elbow.clone().sub(shoulder).normalize(),hand.clone().sub(elbow).normalize()];
    apply(time,source);root.updateMatrixWorld(true);
    for(const [name,before] of untouched)assert.ok(point(root,name).distanceTo(before)<1e-9,`${name} cannot move`);
    ['upper_armR','forearmR','handR'].forEach((name,i)=>assert.equal(root.getObjectByName(name).position.length(),localLengths[i],'clavicle and arm local segment lengths are unchanged'));
    // Meshopt source quaternions have ~1e-5 normalization error; inherited
    // matrices introduce micrometre-scale world-length differences on rotation.
    assert.ok(Math.abs(point(root,'upper_armR').distanceTo(point(root,'forearmR'))-lengths[0])<.00005);
    assert.ok(Math.abs(point(root,'forearmR').distanceTo(point(root,'handR'))-lengths[1])<.00005);
    if(source===ARM_CLEARANCE_COMPACT_SOURCE){
      const current=[point(root,'forearmR').sub(point(root,'upper_armR')).normalize(),point(root,'handR').sub(point(root,'forearmR')).normalize()];
      current.forEach((v,i)=>assert.ok(v.angleTo(directions[i])<.0002,'compact protraction preserves captured global arm directions within source quaternion precision'));
    }
    const points=['forearmR','handR'].map(name=>point(root,name));
    if(previous)points.forEach((p,i)=>maxStep=Math.max(maxStep,p.distanceTo(previous[i])));previous=points;
    for(let repeat=0;repeat<3;repeat++){
      apply.restore();apply(time,source);root.updateMatrixWorld(true);
      points.forEach((p,i)=>assert.ok(p.distanceTo(point(root,['forearmR','handR'][i]))<1e-9,'paused samples never accumulate correction'));
    }
  }
  }
  assert.ok(maxStep<.06,`no arm pops at240Hz: ${maxStep}`);
});

// Same strict transverse-triangle criterion used by offline QA. This measures
// actual deformed forearm/shirt surfaces, not joint or capsule clearance.
function surfaceAudit(root){
  const meshes=[],forearm=[],torso=[];root.traverse(mesh=>{if(mesh.isSkinnedMesh)meshes.push(mesh);});
  for(const mesh of meshes){
    const {skinIndex,skinWeight}=mesh.geometry.attributes,idx=mesh.geometry.index;
    for(let i=0;i<idx.count;i+=3){
      const ids=[idx.getX(i),idx.getX(i+1),idx.getX(i+2)],weights={};
      for(const v of ids)for(let k=0;k<4;k++){const name=mesh.skeleton.bones[skinIndex.getComponent(v,k)].name;weights[name]=(weights[name]??0)+skinWeight.getComponent(v,k)/3;}
      const region=Object.entries(weights).sort((a,b)=>b[1]-a[1])[0][0],triangle={mesh,ids};
      if(region==='forearmR')forearm.push(triangle);else if(region==='spine'||region==='chest')torso.push(triangle);
    }
  }
  const segment=(p,d,axis)=>{const values=[];for(let i=0;i<3;i++){const j=(i+1)%3;if(Math.abs(d[i])<1e-10)values.push(axis.dot(p[i]));else if(d[i]*d[j]<0)values.push(axis.dot(p[i].clone().lerp(p[j],d[i]/(d[i]-d[j]))));if(values.length===2)break;}return values.sort((a,b)=>a-b);};
  return ()=>{
    root.updateMatrixWorld(true);const positions=new Map();
    for(const mesh of meshes){mesh.skeleton.update();const p=[];for(let i=0;i<mesh.geometry.attributes.position.count;i++)p.push(mesh.applyBoneTransform(i,new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,i)).applyMatrix4(mesh.matrixWorld));positions.set(mesh,p);}
    const prepare=tri=>{const p=tri.ids.map(i=>positions.get(tri.mesh)[i]),n=new THREE.Vector3().crossVectors(p[1].clone().sub(p[0]),p[2].clone().sub(p[0])).normalize();return {p,n,plane:n.dot(p[0]),min:new THREE.Vector3(...[0,1,2].map(i=>Math.min(...p.map(v=>v.getComponent(i))))),max:new THREE.Vector3(...[0,1,2].map(i=>Math.max(...p.map(v=>v.getComponent(i)))))};};
    const body=torso.map(prepare);let count=0;
    for(const a of forearm.map(prepare))for(const b of body){
      if(a.min.x>b.max.x||b.min.x>a.max.x||a.min.y>b.max.y||b.min.y>a.max.y||a.min.z>b.max.z||b.min.z>a.max.z)continue;
      const da=a.p.map(p=>b.n.dot(p)-b.plane),db=b.p.map(p=>a.n.dot(p)-a.plane);
      if(Math.min(...da)>=-1e-8||Math.max(...da)<=1e-8||Math.min(...db)>=-1e-8||Math.max(...db)<=1e-8)continue;
      const axis=new THREE.Vector3().crossVectors(a.n,b.n);if(axis.lengthSq()<1e-12)continue;axis.normalize();
      const aa=segment(a.p,da,axis),bb=segment(b.p,db,axis);
      if(aa.length===2&&bb.length===2&&Math.min(aa[1],bb[1])-Math.max(aa[0],bb[0])>1e-5)count++;
    }
    return count;
  };
}

test('real forearm triangles clear the shirt across onset, worst crossing and recovery',async()=>{
  const actor=await loadCharacter(),apply=createStrikerArmClearance(actor.root),crossings=surfaceAudit(actor.root);let before=0;
  for(const [source,times] of [[ARM_CLEARANCE_SOURCE,[2,2.05,2.08,2.10,2.14,2.15,2.1967,2.22,2.25,2.30,2.35,2.40,2.45,2.47,2.50,2.52,2.55]],[ARM_CLEARANCE_COMPACT_SOURCE,[1.3,1.35,1.4,1.42,1.45,1.48,1.5,1.53,1.55,1.58,1.62,1.68]]])for(const t of times){
    apply.restore();actor.capture(t,actor.actions.findIndex(action=>action.getClip().name===source));before+=crossings();apply(t,source);
    actor.root.updateMatrixWorld(true);updateKeeperShoulderSupport(actor.root);
    assert.equal(crossings(),0,`${source} forearm/shirt triangle crossing at native${t}`);
  }
  assert.ok(before>200,'test must exercise the original crossing, not an empty surface set');
});

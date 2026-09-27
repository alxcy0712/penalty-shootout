import {test as nodeTest} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';

const asset = "keeper-prototype";
const test = nodeTest;
const metadata = JSON.parse(await readFile(new URL(`../assets/characters/${asset}.json`, import.meta.url), 'utf8'));
const bytes = await readFile(new URL(`../assets/characters/${asset}.glb`, import.meta.url));
// Node verifies actual skinning/animations while the browser verifies decoded textures.
const geometryBytes = Buffer.from(bytes);
const jsonLength = geometryBytes.readUInt32LE(12);
const manifest = JSON.parse(geometryBytes.subarray(20, 20 + jsonLength).toString());
const geometryManifest = structuredClone(manifest);
for (const material of geometryManifest.materials) {
  delete material.pbrMetallicRoughness?.baseColorTexture;
  delete material.pbrMetallicRoughness?.metallicRoughnessTexture;
  delete material.normalTexture;
}
geometryBytes.fill(32, 20, 20 + jsonLength);
geometryBytes.write(JSON.stringify(geometryManifest), 20);
await MeshoptDecoder.ready;
const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(
  geometryBytes.buffer.slice(geometryBytes.byteOffset, geometryBytes.byteOffset + geometryBytes.byteLength),
  'file:///',
);
const bones = [];
const skinnedMeshes = [];
const materials = new Set();
let triangleCount = 0;
gltf.scene.traverse(object => {
  if (object.isBone) bones.push(object.name);
  if (!object.isMesh) return;
  if (object.isSkinnedMesh) skinnedMeshes.push(object);
  triangleCount += object.geometry.index
    ? object.geometry.index.count / 3
    : object.geometry.attributes.position.count / 3;
  for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
    materials.add(material);
  }
});

const mixer = new THREE.AnimationMixer(gltf.scene);
function worldPosition(name) {
  const point = new THREE.Vector3();
  gltf.scene.getObjectByName(name).getWorldPosition(point);
  return point;
}

test('keeper captures preserve limb lengths, floor clearance and continuity', () => {
  assert.equal(gltf.animations.length, 2);
  assert.ok(bytes.length <= metadata.budgets.glbBytes);
  for (const clip of gltf.animations) {
    mixer.stopAllAction();
    const action=mixer.clipAction(clip); action.play(); action.paused=true;
    let minimum=Infinity, maxStep=0, previous;
    for(let frame=0;frame<=Math.ceil(clip.duration*120);frame++) {
      action.time=Math.min(frame/120,clip.duration);mixer.update(0);gltf.scene.updateWorldMatrix(true,true);
      const points=bones.map(worldPosition);
      for(const p of points) assert.ok(p.toArray().every(Number.isFinite));
      if(previous) points.forEach((p,i)=>maxStep=Math.max(maxStep,p.distanceTo(previous[i])));
      previous=points;
      for(const side of ['L','R']) for(const [a,b,length] of [['upper_arm','forearm',.29],['forearm','hand',.27],['thigh','shin',.43],['shin','foot',.43]])
        assert.ok(Math.abs(worldPosition(a+side).distanceTo(worldPosition(b+side))-length)<.008);
      for(const mesh of skinnedMeshes) {
        mesh.skeleton.update();
        for(let i=0;i<mesh.geometry.attributes.position.count;i++) {
          const p=new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,i);
          mesh.applyBoneTransform(i,p);p.applyMatrix4(mesh.matrixWorld);minimum=Math.min(minimum,p.y);
        }
      }
    }
    console.log({clip:clip.name,duration:clip.duration,minimum,maxStep});
    assert.ok(minimum>-.02, 'skin floor clearance');
    assert.ok(maxStep<.1, 'joint continuity at 120 Hz');
  }
});

test('procedural goalkeeper skin keeps physical wrist, knee and ankle targets unchanged', async () => {
  const {createKeeperSkinPose}=await import('../src/keeper-skin-pose.js');
  const {goalkeeperPose,holdingPose,keeperWarmupPose,keeperHesitationPose,keeperPreparation}=await import('../src/anatomy.js');
  mixer.stopAllAction();
  const apply=createKeeperSkinPose(gltf.scene),stats={speed:85,reach:85};
  for(const d of [-1,1])for(let frame=0;frame<=180;frame++) {
    const t=frame/60;
    const poses=[goalkeeperPose(stats,d,t,2),goalkeeperPose(stats,d,t,.35),keeperWarmupPose(t),keeperPreparation(stats,d,Math.min(t,.8),.8,1.2),holdingPose(goalkeeperPose(stats,d,t,2)).pose,keeperHesitationPose(goalkeeperPose(stats,d,.1,1.2),d,t,goalkeeperPose(stats,d,.099,1.2))];
    for(const p of poses){
      const before=structuredClone(p);apply(p);gltf.scene.updateWorldMatrix(true,true);
      assert.deepEqual(p,before,'visual adapter preserves physics pose');
      for(let i=0;i<2;i++)for(const [bone,key] of [['hand','hands'],['forearm','elbows'],['shin','knees'],['foot','feet']]) {
        assert.ok(worldPosition(bone+(i?'R':'L')).distanceTo(new THREE.Vector3().copy(p[key][i]))<1e-5,`${bone} matches ${key}`);
      }
    }
  }
});

test('captured dive recovery is seekable, continuous and preserves limb lengths', async () => {
  const {createKeeperRecovery}=await import('../src/keeper-recovery.js');
  for(const clip of gltf.animations){
    mixer.stopAllAction();
    const recovery=createKeeperRecovery(gltf.scene,mixer,clip);
    let previous, previousRotations, maxTurn=0, maxStep=0,minY=Infinity, worst;
    for(let frame=0;frame<=Math.ceil(recovery.duration*120);frame++){
      const t=Math.min(recovery.duration,frame/120);recovery.sample(t);
      const points=bones.map(worldPosition);
      const rotations=['upper_armL','forearmL','handL','upper_armR','forearmR','handR'].map(n=>gltf.scene.getObjectByName(n).getWorldQuaternion(new THREE.Quaternion()).normalize());
      if(previousRotations)rotations.forEach((q,i)=>maxTurn=Math.max(maxTurn,q.angleTo(previousRotations[i])));
      previousRotations=rotations;
      if(previous)points.forEach((p,i)=>{const step=p.distanceTo(previous[i]);if(step>maxStep){maxStep=step;worst={t,bone:bones[i]};}});
      previous=points;
      for(const side of ['L','R'])for(const [a,b,length] of [['upper_arm','forearm',.29],['forearm','hand',.27],['thigh','shin',.43],['shin','foot',.43]])assert.ok(Math.abs(worldPosition(a+side).distanceTo(worldPosition(b+side))-length)<.008,`${a} at ${t}`);
      if(frame%4===0)for(const mesh of skinnedMeshes){mesh.skeleton.update();for(let v=0;v<mesh.geometry.attributes.position.count;v++){
        const p=new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,v);mesh.applyBoneTransform(v,p);p.applyMatrix4(mesh.matrixWorld);minY=Math.min(minY,p.y);
      }}
    }
    console.log({chain:clip.name,maxStep,maxTurn,minY,worst});
    assert.ok(maxTurn<Math.PI/3,'arms have no sudden axial flips at 120 Hz');
    assert.ok(maxStep<.12,'no transition jumps');
    assert.ok(minY>-.025,'recovery skin clears floor');
    recovery.sample(clip.duration+.27);const expected=bones.map(worldPosition);
    recovery.sample(.2);recovery.sample(clip.duration+.27);bones.map(worldPosition).forEach((p,i)=>assert.ok(p.distanceTo(expected[i])<1e-6));
    recovery.stop();
  }
});

test('catch replay preserves real shot result and continuous ball pickup on both sides', async () => {
  const {createKeeperCatchReplay}=await import('../src/keeper-catch-replay.js');
  const {HOLD_DURATION}=await import('../src/anatomy.js');
  for(const d of [-1,1]){
    const replay=createKeeperCatchReplay(d);
    assert.equal(replay.caught,true);assert.equal(replay.result.saved,true);assert.equal(replay.result.goal,false);
    const a=replay.sample(replay.contact-1e-6),b=replay.sample(replay.contact);
    assert.ok(new THREE.Vector3().copy(a.ball).distanceTo(new THREE.Vector3().copy(b.ball))<.001,'no ball teleport on contact');
    for(let t=replay.contact+HOLD_DURATION;t<replay.duration;t+=1/120){
      const {pose,ball}=replay.sample(t);
      assert.ok(new THREE.Vector3().copy(ball).distanceTo(new THREE.Vector3().copy(pose.grip.center))<1e-8);
    }
    const expected=replay.sample(.7);replay.sample(2);assert.deepEqual(replay.sample(.7),expected,'scrubbing preserves deterministic contact');
  }
});

test('arm correction preserves contacts, shoulder roll and a straight wrist on every frame', async () => {
  const {createKeeperArmRoll}=await import('../src/keeper-arm-roll.js');
  const {createKeeperSkinPose}=await import('../src/keeper-skin-pose.js');
  const {goalkeeperPose,keeperWarmupPose,holdingPose}=await import('../src/anatomy.js');
  const correct=createKeeperArmRoll(gltf.scene),apply=createKeeperSkinPose(gltf.scene);
  const names=['upper_armL','forearmL','handL','upper_armR','forearmR','handR'];
  function verify(){
    gltf.scene.updateWorldMatrix(true,true);
    const before=names.map(worldPosition);
    const shoulders=['L','R'].map(side=>gltf.scene.getObjectByName('upper_arm'+side).quaternion.clone());
    correct();
    names.forEach((n,i)=>assert.ok(worldPosition(n).distanceTo(before[i])<1e-6,'arm joints retain their targets'));
    for(const [i,side] of ['L','R'].entries()){
      const upper=gltf.scene.getObjectByName('upper_arm'+side),forearm=gltf.scene.getObjectByName('forearm'+side),hand=gltf.scene.getObjectByName('hand'+side);
      assert.ok(upper.quaternion.clone().normalize().angleTo(shoulders[i].clone().normalize())<1e-4,'elbow correction preserves shoulder roll');
      const axis=new THREE.Vector3(0,1,0),direction=axis.clone().applyQuaternion(forearm.quaternion);
      assert.ok(forearm.quaternion.angleTo(new THREE.Quaternion().setFromUnitVectors(axis,direction))<1e-4,'forearm carries pure hinge swing');
      assert.ok(axis.clone().applyQuaternion(hand.quaternion).distanceTo(axis)<1e-4,'wrist extends along the forearm');
    }
    const expected=names.map(n=>gltf.scene.getObjectByName(n).quaternion.clone());correct();
    names.forEach((n,i)=>assert.ok(gltf.scene.getObjectByName(n).quaternion.clone().normalize().angleTo(expected[i].clone().normalize())<1e-4,'correction is idempotent'));
  }
  for(const clip of gltf.animations){
    mixer.stopAllAction();const action=mixer.clipAction(clip);action.play();action.paused=true;
    for(let f=0;f<=Math.floor(clip.duration*120);f++){action.time=f/120;mixer.update(0);verify();}
  }
  mixer.stopAllAction();
  for(const d of [-1,1])for(let f=0;f<=480;f++){
    const t=f/120,p=goalkeeperPose({speed:85,reach:85},d,t,2);
    for(const pose of [p,holdingPose(p).pose,keeperWarmupPose(t)]){apply(pose);verify();}
  }
});

test('reported recovery frames keep arms outside torso and finish with relaxed elbows', async () => {
  const {createKeeperRecovery}=await import('../src/keeper-recovery.js');
  const {readKeeperVisualPose}=await import('../src/keeper-visual-pose.js');
  for(const clip of gltf.animations){
    const recovery=createKeeperRecovery(gltf.scene,mixer,clip);
    for(const time of [.64,.67,.70,1.28,1.31,1.34,1.94,1.97,2,3.51,3.54,3.57]){
      recovery.sample(time);const pose=readKeeperVisualPose(gltf.scene);
      for(let i=0;i<2;i++){
        const points=[pose.shoulders[i],pose.elbows[i],pose.hands[i]];
        for(let segment=0;segment<2;segment++)for(let n=2;n<10;n++){
          const v=points[segment].clone().lerp(points[segment+1],n/10).sub(pose.hip);
          const y=v.dot(pose.up),x=v.dot(pose.right),z=v.dot(pose.forward);
          if(y>.06&&y<.43)assert.ok((x/.16)**2+(z/.115)**2>.95,`arm avoids torso at ${clip.name}/${time}`);
        }
        if(time>3.5){
          const upper=pose.elbows[i].clone().sub(pose.shoulders[i]).normalize();
          assert.ok(upper.dot(pose.up)<-.8,`standing upper arms lower naturally ${clip.name} ${time}: ${upper.dot(pose.up)}`);
          assert.ok(pose.hands[i].clone().sub(pose.hip).dot(pose.up)<.05,'standing wrists rest near hips');
        }
      }
    }
    recovery.stop();
  }
});

test('reported 0.18, 0.43, 1.47 and 3.33 second poses preserve natural limb placement', async () => {
  const {createKeeperRecovery}=await import('../src/keeper-recovery.js');
  const {readKeeperVisualPose}=await import('../src/keeper-visual-pose.js');
  for(const clip of gltf.animations){
    mixer.stopAllAction();
    const action=mixer.clipAction(clip);action.play();action.paused=true;
    const captured=[.18,.43].map(time=>{
      action.time=time;mixer.update(0);
      const p=readKeeperVisualPose(gltf.scene);
      return p.elbows.map((elbow,i)=>elbow.clone().sub(p.shoulders[i]));
    });
    const recovery=createKeeperRecovery(gltf.scene,mixer,clip);
    for(const [index,time] of [.18,.43].entries()){
      recovery.sample(time);const p=readKeeperVisualPose(gltf.scene);
      p.elbows.forEach((elbow,i)=>assert.ok(elbow.clone().sub(p.shoulders[i]).distanceTo(captured[index][i])<1e-4,`capture elbow direction survives retargeting ${elbow.clone().sub(p.shoulders[i]).distanceTo(captured[index][i])}`));
    }
    recovery.sample(1.47);let p=readKeeperVisualPose(gltf.scene);
    p.feet.forEach((foot,i)=>assert.ok(foot.distanceTo(p.hips[i])>.38,'side landing keeps legs extended before tucking'));
    recovery.sample(3.33);p=readKeeperVisualPose(gltf.scene);
    p.elbows.forEach((elbow,i)=>{
      assert.ok(Math.abs(elbow.clone().sub(p.shoulders[i]).dot(p.right))<.065,'standing elbows stay beneath shoulders');
      const forearm=p.hands[i].clone().sub(elbow).normalize();
      assert.ok(forearm.dot(p.up)<-.85,'relaxed forearms point down');
    });
    recovery.stop();
  }
});

test('outer shoulder skin follows the upper arm instead of remaining on the chest', () => {
  let checked=0;
  for(const mesh of skinnedMeshes){
    const {position,skinIndex,skinWeight}=mesh.geometry.attributes;
    for(let i=0;i<position.count;i++){
      const x=position.getX(i),y=position.getY(i);
      if(Math.abs(x)<.205||Math.abs(x)>.25||y<1.35||y>1.49)continue;
      const side=x<0?'L':'R';let shoulderWeight=0,armWeight=0;
      for(let k=0;k<4;k++){
        const name=mesh.skeleton.bones[skinIndex.getComponent(i,k)].name,w=skinWeight.getComponent(i,k);
        if(['chest','clavicle'+side,'upper_arm'+side].includes(name))shoulderWeight+=w;
        if(name==='upper_arm'+side)armWeight+=w;
      }
      if(shoulderWeight<.5)continue;
      assert.ok(armWeight/shoulderWeight>.98,'shoulder cap moves with the raised arm');checked++;
    }
  }
  assert.ok(checked>10,'checks actual shoulder surface vertices');
});

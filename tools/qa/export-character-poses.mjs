#!/usr/bin/env node
// CPU-skin the production character for reproducible offline geometry review.
// node tools/qa/export-character-poses.mjs --out /tmp/keeper-qa --time 2.1 --direction -1 --height 1.2
// node tools/qa/export-character-poses.mjs --out /tmp/keeper-sequence --duration 3.5 --fps 24
import {readFile,writeFile,mkdir,appendFile,readdir} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {GameCharacter,KICK_CONTACT} from '../../src/game-character.js';
import {createKeeperSkinPose} from '../../src/keeper-skin-pose.js';
import {createKeeperArmRoll} from '../../src/keeper-arm-roll.js';
import {goalkeeperPose,keeperWarmupPose,holdingPose,HOLD_DURATION} from '../../src/anatomy.js';
import {Shot} from '../../src/engine.js';
import {keeperGather} from '../../src/keeper-contact.js';
if(process.argv.includes('--help')){
  console.log(`Export the production character's real deformed mesh for offline QA.
Arguments are --name value pairs:
  --out DIR                 output poses.json + poses.bin
  --actor keeper|striker     default keeper
  --motion dive|warmup|hold|gather (keeper), kick (striker)
  --time SECONDS             first frame (gather: time after a real catch)
  --duration SECONDS --fps N export a sequence; defaults 0 / 24
  --direction -1|0|1 --height METRES --speed N --reach N
  --target X --power 0..1 --type normal|low|chip --seed N
  --ball true|false          default true for striker, hold and gather
Gather requires a real physics catch and exports its actual anchored ball.
Example: --motion gather --direction 1 --height .3 --duration .8 --fps 120 --out /tmp/gather`);process.exit(0);
}
const args={};for(let i=2;i<process.argv.length;i+=2){if(!process.argv[i].startsWith('--')||process.argv[i+1]===undefined)throw Error('Arguments must be --name value pairs');args[process.argv[i].slice(2)]=process.argv[i+1];}
const root=fileURLToPath(new URL('../../',import.meta.url)),out=resolve(args.out??'validation/artifacts/pose-review');await mkdir(out,{recursive:true});
const keeper=(args.actor??'keeper')==='keeper',motion=args.motion??(keeper?'dive':'kick'),gather=motion==='gather';
const fps=Number(args.fps??24),start=Number(args.time??0),duration=Number(args.duration??0),direction=Number(args.direction??-1),height=Number(args.height??1.2),speed=Number(args.speed??(gather?95:85)),reach=Number(args.reach??(gather?95:85)),power=Number(args.power??(gather?.55:.7)),targetX=Number(args.target??(gather?direction*(height>1.2?1.5:2):0)),shotType=args.type??'normal',seed=Number(args.seed??(gather?(height>1.2?(direction<0?2:1):3):42));
const showBall=args.ball===undefined?(!keeper||motion==='hold'||gather):args.ball==='true';
if(!['keeper','striker'].includes(args.actor??'keeper')||!(keeper?['dive','warmup','hold','gather']:['kick']).includes(motion)||![fps,start,duration,direction,height,speed,reach,power,targetX,seed].every(Number.isFinite)||fps<=0||duration<0||![-1,0,1].includes(direction))throw Error('Invalid actor, motion, direction or numeric arguments');
const stats={accuracy:90,power:90,touch:90,composure:90,speed,reach,handling:95};
let capture=null,ballFrames=null;
if(gather){
  capture=new Shot({x:targetX,y:height,power},stats,stats,direction,seed);
  for(let i=0;i<3600&&!capture.result;i++)capture.step(1/120);
  if(!capture.caught)throw Error('This recipe did not produce a catch; choose a caught seed/target instead of fabricating a gather');
}else if(!keeper&&showBall){
  const shot=new Shot({x:targetX,power,low:shotType==='low',chip:shotType==='chip'},stats,stats,0,seed);ballFrames=[{...shot.ball}];
  for(let i=0;i<720&&!shot.result;i++){shot.step(1/120);ballFrames.push({...shot.ball});}
}
const asset=`assets/characters/${keeper?'keeper-prototype':'striker-mocap'}.glb`,sourceBytes=await readFile(join(root,asset)),bytes=Buffer.from(sourceBytes),length=bytes.readUInt32LE(12),manifest=JSON.parse(bytes.subarray(20,20+length));
// These are geometry QA renders. Browser texture decoding, shader output and
// real-device performance remain separate checks; no screenshot claim is made.
for(const m of manifest.materials){delete m.pbrMetallicRoughness?.baseColorTexture;delete m.pbrMetallicRoughness?.metallicRoughnessTexture;delete m.normalTexture;}
bytes.fill(32,20,20+length);bytes.write(JSON.stringify(manifest),20);await MeshoptDecoder.ready;
const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const actor=Object.create(GameCharacter.prototype);actor.root=gltf.scene;actor.keeper=keeper;actor.mixer=new THREE.AnimationMixer(actor.root);actor.actions=gltf.animations.map(clip=>{const a=actor.mixer.clipAction(clip).setLoop(THREE.LoopOnce,1);a.clampWhenFinished=true;return a;});actor.apply=createKeeperSkinPose(actor.root,{shoulderSupport:keeper});actor.relax=createKeeperArmRoll(actor.root);
const meshes=[];actor.root.traverse(m=>{if(m.isSkinnedMesh)meshes.push(m)});
const sphere=showBall?new THREE.SphereGeometry(.11,20,12):null;
if(sphere){const ball=new THREE.Mesh(sphere,new THREE.MeshStandardMaterial({color:'#f0f2e9'}));ball.name='MatchBall';ball.material.name='Ball';meshes.push(ball);}
const frameCount=duration?Math.round(duration*fps)+1:1,meta={format:'penalty-character-cpu-skin-v1',createdAt:new Date().toISOString(),note:'Offline CPU-skinned geometry with simplified materials; not a browser screenshot or real-device test. Keeper translation is centered as in motion-lab.',recipe:{actor:keeper?'keeper':'striker',motion,start,duration,fps,direction,height,speed,reach,power,targetX,shotType,seed,showBall},frames:frameCount,fps,components:0,meshes:[],sha256:{}};
if(capture)meta.capture={time:capture.t,point:capture.ball,contactPart:capture.contactPart,seed};
meta.ballCenters=[];
for(const m of meshes){const faces=[];for(let i=0;i<m.geometry.index.count;i+=3)faces.push([m.geometry.index.getX(i),m.geometry.index.getX(i+1),m.geometry.index.getX(i+2)]);meta.meshes.push({name:m.name,role:m.isSkinnedMesh?'character':'ball',material:m.material.name,color:m.material.color.toArray(),count:m.geometry.attributes.position.count,offset:meta.components,faces});meta.components+=m.geometry.attributes.position.count*3;}
for(const file of[asset,...(await readdir(join(root,'src'))).filter(name=>name.endsWith('.js')).sort().map(name=>'src/'+name),'tools/qa/export-character-poses.mjs','tools/qa/render-character-poses.py'])meta.sha256[file]=createHash('sha256').update(await readFile(join(root,file))).digest('hex');
const binary=join(out,'poses.bin');await writeFile(binary,'');const frame=new Float32Array(meta.components),point=new THREE.Vector3();
for(let f=0;f<frameCount;f++){
  const time=start+f/fps;let pose,shiftX=0,shiftZ=0,ball=null;
  if(keeper){
    if(gather){const held=keeperGather(capture.pose,capture.poseAt(capture.t+time),capture.ball,capture.contactPart,time/HOLD_DURATION);pose=held.pose;ball=held.ball;}
    else{pose=motion==='warmup'?keeperWarmupPose(time):goalkeeperPose({speed,reach,stretch:Number(args.stretch??0)},direction,time,height);if(motion==='hold'){const held=holdingPose(pose);pose=held.pose;ball=held.center;}}
    actor.pose(pose);shiftX=pose.hip.x;
  }else{
    actor.kick(Math.min(1,time/KICK_CONTACT),time>=KICK_CONTACT?time-KICK_CONTACT:null,{power,targetX,shotType});shiftZ=11;
    if(ballFrames){const at=Math.max(0,time-KICK_CONTACT)*120,index=Math.min(Math.floor(at),ballFrames.length-1),a=ballFrames[index],b=ballFrames[Math.min(index+1,ballFrames.length-1)],mix=at-Math.floor(at);ball={x:a.x+(b.x-a.x)*mix,y:a.y+(b.y-a.y)*mix,z:a.z+(b.z-a.z)*mix};}
  }
  // Match WebGLRenderer: SkinnedMesh.updateMatrixWorld refreshes attached
  // bindMatrixInverse; updateWorldMatrix alone double-applies a moved rig.
  actor.root.updateMatrixWorld(true);let cursor=0;
  for(const mesh of meshes){
    if(mesh.isSkinnedMesh)mesh.skeleton.update();
    for(let i=0;i<mesh.geometry.attributes.position.count;i++){
      point.fromBufferAttribute(mesh.geometry.attributes.position,i);
      if(mesh.isSkinnedMesh)mesh.applyBoneTransform(i,point).applyMatrix4(mesh.matrixWorld);else point.add(ball??{x:0,y:.11,z:0});
      frame[cursor++]=point.x-shiftX;frame[cursor++]=point.z-shiftZ;frame[cursor++]=point.y;
    }
  }
  meta.ballCenters.push(ball?[ball.x-shiftX,ball.z-shiftZ,ball.y]:null);
  await appendFile(binary,new Uint8Array(frame.buffer));
}
for(const [file,hash] of Object.entries(meta.sha256))if(createHash('sha256').update(await readFile(join(root,file))).digest('hex')!==hash)throw Error('Source changed during export; retry on a frozen checkout: '+file);
meta.endTime=start+(frameCount-1)/fps;
await writeFile(join(out,'poses.json'),JSON.stringify(meta,null,2));console.log(JSON.stringify({output:out,frames:frameCount,binaryBytes:frameCount*meta.components*4,metadata:relative(process.cwd(),join(out,'poses.json'))}));

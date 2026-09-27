import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {renderPixelRatio} from './rendering.js';
import {readKeeperVisualPose} from './keeper-visual-pose.js';
import {createKeeperArmRoll} from './keeper-arm-roll.js';
import {createKeeperCatchReplay} from './keeper-catch-replay.js';
import {createKeeperRecovery} from './keeper-recovery.js';
import {createKeeperSkinPose} from './keeper-skin-pose.js';
import {goalkeeperPose, keeperWarmupPose, keeperPreparation, keeperHesitationPose, holdingPose, blendKeeperPose} from './anatomy.js';

const $ = id => document.getElementById(id);
const stage = $('stage'), renderer = new THREE.WebGLRenderer({antialias:true});
stage.append(renderer.domElement);
renderer.domElement.setAttribute('aria-label', '门将扑救与其他动作预览');
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#172625');
scene.add(new THREE.HemisphereLight('#e6f1ee', '#45624d', 2));
const light = new THREE.DirectionalLight('white', 3); light.position.set(2,6,4); scene.add(light);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(20,20),new THREE.MeshStandardMaterial({color:'#314d43'}));
ground.rotation.x=-Math.PI/2; ground.position.y=-.012; scene.add(ground, new THREE.GridHelper(20,40,'#638477','#426354'));
const ball = new THREE.Mesh(new THREE.SphereGeometry(.11,20,14),new THREE.MeshStandardMaterial({color:'#e6ede4'}));
ball.visible=false; scene.add(ball);
const camera = new THREE.PerspectiveCamera(36,1,.1,60);
const stats={speed:85,reach:85};
const target = new THREE.Vector3(0,.85,0), hipPosition = new THREE.Vector3();
let model, mixer, applyPose, relaxArms, action, clips, recovery, catchReplay, time=0, duration=1, playing=false, last=null, request=0;
let samples=[], animationSamples=[], lastMetrics=-Infinity, loadMs=0;
function schedule(){if(!request&&!document.hidden)request=requestAnimationFrame(frame);}
function resize(){const w=stage.clientWidth,h=stage.clientHeight;renderer.setPixelRatio(renderPixelRatio(w,h,devicePixelRatio));renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();schedule();}
const resizeObserver = new ResizeObserver(resize);resizeObserver.observe(stage);
function select(){
  recovery?.stop();recovery=null;catchReplay=null;
  mixer.stopAllAction(); action=null; time=0; playing=false; $('play').textContent='播放';
  const chain=$('motion').value.startsWith('chain:');
  const clip=clips.find(c=>c.name===$('motion').value.replace('chain:',''));
  if(chain){recovery=createKeeperRecovery(model,mixer,clip);duration=recovery.duration;}
  else if(clip){action=mixer.clipAction(clip);action.play();action.paused=true;duration=clip.duration;}
  else if($('motion').value==='catch'){catchReplay=createKeeperCatchReplay(Number($('direction').value));duration=catchReplay.duration;}
  else duration=$('motion').value==='warmup'?8:3;
  $('direction').disabled=!!clip; $('time').max=duration;
  $('status').textContent=chain?'完整动作链：实拍扑救 → 程序落地起身；衔接待视觉验收。':clip?'实拍重建：镜头跟随髋部，保留世界位移；片段终点停止。':'程序动作：沿用现有物理姿态，检查新模型关节映射；动作质量继续验收。';
  samples=[];animationSamples=[];last=null;schedule();
}
function procedural(){
  const mode=$('motion').value,d=Number($('direction').value);
  let p;
  if(mode==='catch'){const replay=catchReplay.sample(time);p=replay.pose;ball.position.copy(replay.ball);$('status').textContent=replay.phase+` · 接触 ${catchReplay.contact.toFixed(3)} 秒 · 原物理判定`;}
  else if(mode==='warmup')p=keeperWarmupPose(time);
  else if(mode==='prepare'){const ready=keeperPreparation(stats,d,Math.min(time,.8),.8,1.2);p=time<.8?ready:blendKeeperPose(ready,goalkeeperPose(stats,d,time-.8,1.2),(time-.8)/.13);}
  else if(mode==='hesitate')p=time<.1?goalkeeperPose(stats,d,time,1.2):keeperHesitationPose(goalkeeperPose(stats,d,.1,1.2),d,time-.1,goalkeeperPose(stats,d,.099,1.2));
  else p=goalkeeperPose(stats,d,time+(mode==='recover'?.85:0),2);
  if(mode==='hold'){const held=holdingPose(p);p=held.pose;ball.position.copy(held.center);}
  applyPose(p);relaxArms();
  target.set(p.hip.x,.85,p.hip.z);
}
function frame(now){
  request=0;
  if(playing&&last!==null){const dt=now-last;time=Math.min(duration,time+dt/1000*Number($('speed').value));samples.push(dt);if(samples.length>600)samples.shift();}
  last=now;
  if(time>=duration)playing=false;
  $('play').textContent=playing?'暂停':time>=duration?'重播':'播放';
  const start=performance.now();
  if(model){if(recovery){$('status').textContent=recovery.sample(time)+' · 实拍＋程序衔接';model.getObjectByName('pelvis').getWorldPosition(hipPosition);target.set(hipPosition.x,.85,hipPosition.z);}else if(action){action.time=time;mixer.update(0);applyPose(readKeeperVisualPose(model));relaxArms();model.updateWorldMatrix(true,true);model.getObjectByName('pelvis').getWorldPosition(hipPosition);target.set(hipPosition.x,.85,hipPosition.z);}else procedural();}
  ball.visible=!!model&&['hold','catch'].includes($('motion').value);
  animationSamples.push(performance.now()-start);if(animationSamples.length>600)animationSamples.shift();
  const distance= Math.max(4.8, 6/camera.aspect), view=$('view').value;
  camera.position.set(view==='side'?distance:view==='oblique'?distance*.65:0,2.1,view==='side'?0:distance);
  camera.position.x+=target.x;camera.position.z+=target.z;
  camera.lookAt(target);
  renderer.render(scene,camera);
  $('time').value=time;$('time-label').value=`${time.toFixed(2)} 秒`;
  if(now-lastMetrics>400||!playing){
    const sorted=[...samples].sort((a,b)=>a-b), median=sorted[Math.floor(sorted.length*.5)]??0,p95=sorted[Math.floor(sorted.length*.95)]??0;
    const avg=animationSamples.reduce((a,b)=>a+b,0)/animationSamples.length;
    $('metrics').textContent=`GLB 389 KiB · 22 骨骼 · ${renderer.info.render.triangles.toLocaleString()} 场景三角形 · ${renderer.info.render.calls} 绘制 · ${stage.clientWidth}×${stage.clientHeight} / DPR ${renderer.getPixelRatio().toFixed(2)} · 加载 ${loadMs.toFixed(0)} ms · 帧中位/P95 ${median.toFixed(1)}/${p95.toFixed(1)} ms · 动画均值 ${avg.toFixed(2)} ms`;
    lastMetrics=now;
  }
  if(playing)schedule();
}
$('motion').onchange=()=>model&&select();
$('view').onchange=schedule;
$('direction').onchange=()=>{if($('motion').value==='catch')select();else schedule();};
$('time').oninput=()=>{time=Number($('time').value);last=null;schedule();};
$('play').onclick=()=>{if(time>=duration)time=0;playing=!playing;last=null;$('play').textContent=playing?'暂停':'播放';schedule();};
$('speed').onchange=()=>{last=null;schedule();};
document.addEventListener('visibilitychange',()=>{last=null;if(document.hidden){cancelAnimationFrame(request);request=0;}else schedule();});
const started=performance.now();
try {
  const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(new URL('../assets/characters/keeper-prototype.glb',import.meta.url).href);
  model=gltf.scene;model.traverse(o=>{if(o.isSkinnedMesh)o.frustumCulled=false;});scene.add(model);mixer=new THREE.AnimationMixer(model);clips=gltf.animations;applyPose=createKeeperSkinPose(model);relaxArms=createKeeperArmRoll(model);
  loadMs=performance.now()-started;$('play').disabled=false;select();
} catch(error){$('status').textContent=`模型加载失败：${error.message}`;}
window.addEventListener('pagehide',event=>{
  if(event.persisted)return;
  resizeObserver.disconnect();
  cancelAnimationFrame(request);recovery?.stop();mixer?.stopAllAction();if(model)mixer.uncacheRoot(model);
  const geometries=new Set(),materials=new Set(),textures=new Set();
  scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}});
  geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());renderer.dispose();
});

import * as THREE from 'three';
import { GameCharacter, KICK_CONTACT } from './game-character.js';
import { strikerRunupPose, penaltyStyles, goalkeeperPose, holdingPose, HOLD_DURATION, keeperHesitationPose, keeperWarmupPose, keeperPreparation, blendKeeperPose, limb, body } from './anatomy.js';
import { Shot } from './engine.js';
import { keeperGather } from './keeper-contact.js';
import { renderPixelRatio } from './rendering.js';
import { INSPECTION_FPS, advancePlayback, stepFrame, motionInfo, viewportLayout, frameDistance, clamp } from './motion-lab-state.js';

const byId = id => document.getElementById(id);
const select = byId('motion-action'), slider = byId('timeline'), button = byId('play-pause');
const shotDirection = byId('shot-direction'), keeperDirection = byId('keeper-direction');
const shotPower = byId('shot-power'), shotType = byId('shot-type'), faceView = byId('face-view');
const speedControl = byId('playback-speed'), loopControl = byId('loop-playback');
const viewControl = byId('view-mode'), zoomControl = byId('view-zoom'), motionPhase = byId('motion-phase');
const stage = byId('render-stage'), wireframeControl = byId('wireframe'), skeletonControl = byId('skeleton');
const ballControl = byId('show-ball'), renderError = byId('render-error');
const viewNames = { front: '正面', side: '侧面', 'three-quarter': '斜侧面', back: '背面', split: '正面 / 侧面' };
let info, disposed = false, last = null, frameRequest = 0, stageWidth = 1, stageHeight = 1;
let state = { time: 0, duration: 4, playing: false, speed: 1, loop: loopControl.checked };

const scene = new THREE.Scene();
scene.background = new THREE.Color('#1d342b');
scene.add(new THREE.HemisphereLight('#e6f1ee', '#45624d', 2));
const light = new THREE.DirectionalLight('#ffffff', 3);
light.position.set(2, 6, 4); scene.add(light);
const rim = new THREE.DirectionalLight('#b6d8c7', 1.5);
rim.position.set(-3, 3, -2); scene.add(rim);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(50, 50), new THREE.MeshStandardMaterial({ color: '#314d43', roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -.016; scene.add(ground);
const grid = new THREE.GridHelper(40, 80, '#789784', '#456650');
grid.position.y = -.012; scene.add(grid);
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setScissorTest(true);
  renderer.domElement.setAttribute('aria-label', '游戏共享模型的实时三维预览');
  renderer.domElement.setAttribute('role', 'img');
  stage.appendChild(renderer.domElement);
  renderer.domElement.addEventListener('webglcontextlost', event => {
    event.preventDefault(); state.playing = false; syncPlayback();
    renderError.textContent = '三维画面暂时中断，正在等待图形上下文恢复。时间轴仍可操作。';
    renderError.hidden = false;
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => { renderError.hidden = true; requestFrame(); });
} catch (error) {
  console.error('动作检查页无法创建三维画面', error);
  renderError.textContent = '此浏览器未能启用 WebGL。请启用硬件加速后重新打开；动作时间轴仍可检查。';
  renderError.hidden = false;
}
const pairs = { kick: [], keeper: [] };
const ballGeometry = new THREE.SphereGeometry(.11, 24, 16);
const ballMaterial = new THREE.MeshStandardMaterial({ color: '#edf3e8', roughness: .6 });
for (const type of Object.keys(pairs)) for (let i = 0; i < 2; i++) {
  const display = new THREE.Group(); scene.add(display);
  const player = new GameCharacter(display, type === 'keeper' ? '#88beca' : '#b9efd7', type === 'keeper');
  player.display = display;
  if (type === 'kick') player.group.position.z = -11;
  player.labBall = new THREE.Mesh(ballGeometry, ballMaterial); display.add(player.labBall);
  pairs[type].push(player);
}
const camera = new THREE.PerspectiveCamera(35, 1, .01, 100);
const bounds = new THREE.Box3(), point = new THREE.Vector3(), center = new THREE.Vector3(), size = new THREE.Vector3();
const fallbackLinks = [
  ['hip', 'shoulder'], ['shoulder', 'head'],
  ['shoulder', 'shoulders', 0], ['shoulder', 'shoulders', 1],
  ['shoulders', 'elbows', 0], ['shoulders', 'elbows', 1],
  ['elbows', 'hands', 0], ['elbows', 'hands', 1],
  ['hip', 'hips', 0], ['hip', 'hips', 1],
  ['hips', 'knees', 0], ['hips', 'knees', 1], ['knees', 'feet', 0], ['knees', 'feet', 1],
];

const catchStats={accuracy:90,power:90,touch:90,composure:90,speed:80,reach:80,handling:95},catchReplay=new Shot({x:Math.sin(59)*3.3,power:.9,y:1.3},catchStats,catchStats,1,59);
for(let n=0;n<3600&&!catchReplay.result;n++)catchReplay.step(1/120);
let ballReplay=null;
function shotBall(time){
  const key=shotDirection.value+'/'+shotPower.value+'/'+shotType.value;
  if(ballReplay?.key!==key){
    const shot=new Shot({x:Number(shotDirection.value),power:Number(shotPower.value),low:shotType.value==='low',chip:shotType.value==='chip'},catchStats,catchStats,0,42),points=[{...shot.ball}];
    for(let n=0;n<480&&!shot.result;n++){shot.step(1/120);points.push({...shot.ball});}
    ballReplay={key,points};
  }
  const frame=Math.max(0,time)*120,index=Math.min(Math.floor(frame),ballReplay.points.length-1),a=ballReplay.points[index],b=ballReplay.points[Math.min(index+1,ballReplay.points.length-1)],q=frame-Math.floor(frame);
  return {x:a.x+(b.x-a.x)*q,y:a.y+(b.y-a.y)*q,z:a.z+(b.z-a.z)*q-11};
}
let trackingReplay;
function trackingFrame(time,direction){
  if(trackingReplay?.direction!==direction){
    const shot=new Shot({x:direction*1.2,power:.12,y:.2},catchStats,catchStats,0,42),frames=[];
    for(let n=0;n<=720;n++){
      if(n&&!shot.result)shot.step(1/120);
      const after=Math.max(0,n/120-shot.t),raw=shot.result?shot.poseAt(shot.t+after):shot.pose;
      const held=shot.caught?keeperGather(shot.pose,raw,shot.ball,shot.contactPart,after/HOLD_DURATION):null,pose=held?.pose??raw;
      const ball={...shot.ball};
      if(held)Object.assign(ball,held.ball);
      frames.push({pose,ball});
    }
    trackingReplay={direction,frames};
  }
  const cursor=Math.min(720,time*120),index=Math.floor(cursor),weight=cursor-index,a=trackingReplay.frames[index],b=trackingReplay.frames[Math.min(720,index+1)];
  const mix=(a,b)=>({x:a.x+(b.x-a.x)*weight,y:a.y+(b.y-a.y)*weight,z:a.z+(b.z-a.z)*weight});
  const pose=structuredClone(blendKeeperPose(a.pose,b.pose,weight,false));
  for(let i=0;i<2;i++){const arm=limb(pose.shoulders[i],mix(a.pose.hands[i],b.pose.hands[i]),mix(a.pose.elbows[i],b.pose.elbows[i]),body.upperArm,body.forearm);pose.hands[i]=arm.end;pose.elbows[i]=arm.joint;}
  if(a.pose.grip&&b.pose.grip)pose.grip={center:mix(a.pose.grip.center,b.pose.grip.center),weight:a.pose.grip.weight+(b.pose.grip.weight-a.pose.grip.weight)*weight};
  return {pose,ball:mix(a.ball,b.ball)};
}

function requestFrame() {
  if (!disposed && !frameRequest && !document.hidden) frameRequest = requestAnimationFrame(frame);
}
function advance(now) {
  if (last !== null) Object.assign(state, advancePlayback(state, Math.max(0, now - last) / 1000));
  last = now;
}
function syncPlayback() {
  button.textContent = state.playing ? '暂停' : '播放';
  button.setAttribute('aria-pressed', String(state.playing));
  slider.value = state.time;
  slider.setAttribute('aria-valuetext', `${state.time.toFixed(3)} 秒，共 ${state.duration.toFixed(3)} 秒`);
  byId('time-output').innerHTML = `${state.time.toFixed(3)} <small>/ ${state.duration.toFixed(3)} 秒</small>`;
  byId('frame-output').textContent = `帧 ${String(Math.round(state.time * INSPECTION_FPS)).padStart(3, '0')} / ${Math.round(state.duration * INSPECTION_FPS)} · 60 fps 检查步长`;
}
function seek(time) {
  state.time = clamp(time, 0, state.duration); state.playing = false;
  last = null; syncPlayback(); requestFrame();
}
function togglePlayback() {
  advance(performance.now());
  if (state.time >= state.duration) state.time = 0;
  state.playing = !state.playing; syncPlayback(); requestFrame();
}
function configureMotion() {
  info = motionInfo(select.value, KICK_CONTACT, penaltyStyles.map(style => style.duration), HOLD_DURATION);
  state.time = 0; state.duration = info.duration; last = null; slider.max = info.duration;
  byId('shot-settings').hidden = !info.striker;
  byId('keeper-settings').hidden = info.striker;
  byId('source-label').textContent = info.striker
    ? 'CMU 射门动捕 · 与比赛共用 GameCharacter'
    : '游戏程序姿态 · 蒙皮骨骼与碰撞骨架一致';
  byId('render-caption').textContent = info.striker ? '射手 · CMU 动捕 + 游戏动作参数' : '门将 · 游戏程序动作 + 物理骨架';
  byId('contact-jump').hidden = !info.striker;
  byId('phase-jumps').replaceChildren(); byId('timeline-markers').replaceChildren();
  for (const marker of info.markers) {
    const jump = document.createElement('button');
    jump.type = 'button'; jump.textContent = marker.label;
    jump.dataset.contact = String(!!marker.contact);
    jump.title = `${marker.label} · ${marker.time.toFixed(3)} 秒`;
    jump.setAttribute('aria-label', `跳到${marker.label}，${marker.time.toFixed(3)} 秒`);
    jump.addEventListener('click', () => seek(marker.time));
    byId('phase-jumps').appendChild(jump);
    const tick = document.createElement('span');
    tick.className = `timeline-tick${marker.contact ? ' contact' : ''}`;
    tick.style.left = `${marker.time / info.duration * 100}%`;
    byId('timeline-markers').appendChild(tick);
  }
  syncPlayback(); requestFrame();
}
function resize() {
  stageWidth = Math.max(1, Math.round(stage.clientWidth));
  stageHeight = Math.max(1, Math.round(stage.clientHeight));
  renderer?.setPixelRatio(renderPixelRatio(stageWidth, stageHeight, window.devicePixelRatio));
  renderer?.setSize(stageWidth, stageHeight, false);
  updateViewLabels(); requestFrame();
}
function updateViewLabels() {
  byId('view-label').textContent = `${viewNames[viewControl.value]} · ${faceView.checked ? '面部' : '全身'}`;
  byId('zoom-output').textContent = `${Math.round(Number(zoomControl.value) * 100)}%`;
  const layer = byId('viewport-labels'); layer.replaceChildren();
  const viewports = viewportLayout(stageWidth, stageHeight, viewControl.value === 'split');
  for (const view of viewports) {
    const label = document.createElement('span'); label.className = 'viewport-label';
    label.style.left = `${view.x + 12}px`; label.style.top = `${stageHeight - view.y - view.height + 12}px`;
    label.textContent = viewports.length > 1 ? view.side ? 'SIDE / 侧面' : 'FRONT / 正面' : `${viewNames[viewControl.value]} / ${faceView.checked ? '面部近景' : '全身检查'}`;
    layer.appendChild(label);
  }
  if (viewports.length > 1) {
    const divider = document.createElement('span'), vertical = viewports[1].x > 0;
    divider.className = `viewport-divider ${vertical ? 'vertical' : 'horizontal'}`;
    divider.style[vertical ? 'left' : 'top'] = `${vertical ? viewports[1].x : viewports[0].height}px`;
    layer.appendChild(divider);
  }
}
function setWireframe(player) {
  if (player.labWireframe === wireframeControl.checked) return;
  player.labWireframe = wireframeControl.checked;
  player.group.traverse(object => {
    for (const material of object.material ? Array.isArray(object.material) ? object.material : [object.material] : []) {
      if ('wireframe' in material) material.wireframe = wireframeControl.checked;
    }
  });
}
function createSkeleton(player) {
  if (player.root) {
    const helper = new THREE.SkeletonHelper(player.root);
    helper.material.depthTest = false; helper.material.transparent = true; helper.material.opacity = .9;
    helper.renderOrder = 20; scene.add(helper); player.labSkeleton = helper;
  } else {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(fallbackLinks.length * 6), 3));
    const helper = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#efcd77', depthTest: false }));
    helper.frustumCulled = false; helper.renderOrder = 20;
    player.group.add(helper); player.labSkeleton = helper; player.labFallbackSkeleton = true;
  }
}
function updateSkeleton(player, pose) {
  if (!player.labSkeleton) return;
  player.labSkeleton.visible = skeletonControl.checked;
  if (!player.labFallbackSkeleton || !skeletonControl.checked) return;
  const position = player.labSkeleton.geometry.attributes.position;
  fallbackLinks.forEach(([a, b, index], i) => {
    const from = Array.isArray(pose[a]) ? pose[a][index] : pose[a];
    const to = Array.isArray(pose[b]) ? pose[b][index] : pose[b];
    position.setXYZ(i * 2, from.x, from.y, from.z); position.setXYZ(i * 2 + 1, to.x, to.y, to.z);
  });
  position.needsUpdate = true;
}
function frameCharacter(player, pose, aspect) {
  player.display.updateWorldMatrix(true, true);
  bounds.makeEmpty();
  if (player.root) player.root.traverse(object => {
    if (object.isBone) bounds.expandByPoint(object.getWorldPosition(point));
  });
  if (bounds.isEmpty()) for (const key of ['head', 'hip', 'shoulder', 'hands', 'elbows', 'knees', 'feet']) {
    for (const p of Array.isArray(pose[key]) ? pose[key] : [pose[key]]) bounds.expandByPoint(player.group.localToWorld(point.copy(p)));
  }
  bounds.expandByScalar(.2); bounds.getCenter(center); bounds.getSize(size);
  let distance;
  if (faceView.checked) {
    (player.root?.getObjectByName('head') ?? player.fallback.head).getWorldPosition(center);
    distance = frameDistance(.4, .48, .28, aspect, 35, Number(zoomControl.value));
  } else {
    distance = frameDistance(Math.max(1.4, size.x), Math.max(2.15, size.y), size.z, aspect, 35, Number(zoomControl.value));
  }
  camera.aspect = aspect; camera.updateProjectionMatrix();
  camera.position.copy(center).add(new THREE.Vector3(0, faceView.checked ? .02 : distance * .045, distance));
  camera.lookAt(center);
}
function renderCharacter(type, pose) {
  if (!renderer) return;
  const views = viewportLayout(stageWidth, stageHeight, viewControl.value === 'split');
  for (const view of views) {
    for (const pair of Object.values(pairs)) for (const player of pair) {
      player.display.visible = false;
      if (player.labSkeleton) player.labSkeleton.visible = false;
    }
    const player = pairs[type][view.side ? 1 : 0];
    player.display.visible = true;
    const mode = views.length > 1 ? view.side ? 'side' : 'front' : viewControl.value;
    const turn = { front: 0, side: -Math.PI / 2, 'three-quarter': -Math.PI / 4, back: Math.PI }[mode];
    player.display.rotation.y = (type === 'kick' ? Math.PI : 0) + turn;
    updateSkeleton(player, pose);
    frameCharacter(player, pose, view.width / view.height);
    renderer.setViewport(view.x, view.y, view.width, view.height);
    renderer.setScissor(view.x, view.y, view.width, view.height);
    renderer.render(scene, camera);
  }
}
function frame(now) {
  frameRequest = 0; advance(now); syncPlayback();
  const t = state.time, direction = Number(keeperDirection.value), power = Number(shotPower.value);
  let phaseText, p, kickContact = KICK_CONTACT, ballPosition = { x: 0, y: .11, z: 0 };
    if(select.value==='kick'||select.value.startsWith('runup')){const style=penaltyStyles[Number(select.value.slice(-1))],contact=style?.duration??KICK_CONTACT;kickContact=contact;phaseText=t<contact-.55?'助跑':t<contact-.21?'落支撑脚':t<contact?'摆腿触球':t<contact+.22?'顺势随摆':t<contact+.85?'落脚收势':'完成';ballPosition=shotBall(t-contact);p=style?strikerRunupPose(t,Math.min(1,t/style.duration),t>=style.duration?t-style.duration:-1,power,+shotDirection.value,style,shotType.value):strikerRunupPose(t,Math.min(1,t/contact),t>=contact?t-contact:-1,power,+shotDirection.value,penaltyStyles[0],shotType.value);}
  else {phaseText=select.value==='hesitate'?(t<.10?'判断启动':t<.32?'错边刹住 · 半扑':t<.65?'重心倾斜':t<1?'站稳恢复':'完成'):(t<.13?'压低重心 · 蹬地':t<.55?'展体伸臂':t<1?'落地缓冲':'收势起身');if(['dive','stretch','low','center','center-low','hold'].includes(select.value))p=goalkeeperPose({speed:85,reach:85,stretch:select.value==='stretch'?1:0},select.value.startsWith('center')?0:direction,t,select.value==='center-low'?.3:select.value==='low'?.35:select.value==='center'?1.65:2);
    if(select.value==='warmup'){p=keeperWarmupPose(t);phaseText='呼吸 · 重心转移 · 交错伸臂';}
    if(select.value.startsWith('center'))phaseText=t<.1?'预备反应':select.value==='center-low'?'下蹲迎球 · 双手封堵':'抬手迎球 · 屈膝缓冲';
    if(select.value==='recover'){p=goalkeeperPose({speed:85,reach:85},direction,t+.85,2);phaseText=t<.5?'侧卧缓冲':t<.95?'先落支撑脚':t<1.6?'撑地转身 · 重心上移':'收手站稳';}
    if(select.value==='prepare'){const ready=keeperPreparation({speed:85,reach:85},direction,Math.min(t,.8),.8,1.2);p=t<.8?ready:blendKeeperPose(ready,goalkeeperPose({speed:85,reach:85},direction,t-.8,1.2),(t-.8)/.13);phaseText=t<.8?'侧步调整 · 压低重心':'蹬地衔接扑救';}
    if(select.value==='tracking'){const replay=trackingFrame(t,direction);p=replay.pose;ballPosition=replay.ball;phaseText='实际来球 · 交替步伐 · 接球收势';}
    if(select.value==='hesitate'){const origin=goalkeeperPose({speed:85,reach:85},direction,.10,1.2),previous=goalkeeperPose({speed:85,reach:85},direction,.099,1.2);p=t<.10?goalkeeperPose({speed:85,reach:85},direction,t,1.2):keeperHesitationPose(origin,direction,t-.10,previous);}
    if(select.value==='hold'){phaseText='双手包球 · 随身体起身';const hold=holdingPose(p);p=hold.pose;ballPosition=hold.center;}
    if(select.value==='gather'){phaseText=t<HOLD_DURATION?'缓冲收球 · 手腕合拢':'抱球保持';const raw=catchReplay.poseAt(catchReplay.t+t),hold=keeperGather(catchReplay.pose,raw,catchReplay.ball,catchReplay.contactPart,t/HOLD_DURATION);p=hold.pose;ballPosition=hold.ball;}const shift=p.hip.x;if(['hold','gather','tracking'].includes(select.value))ballPosition.x-=shift;if(p.grip&&p.grip.center!==ballPosition)p.grip.center.x-=shift;for(const key of ['hip','shoulder','head','shoulders','hips','hands','elbows','feet','knees']){if(Array.isArray(p[key]))p[key].forEach(v=>v.x-=shift);else p[key].x-=shift;}}
  const type = info.striker ? 'kick' : 'keeper';
  for (const player of pairs[type]) {
    if (type === 'kick') player.kick(Math.min(1, t / kickContact), t >= kickContact ? t - kickContact : null, {
      power, targetX: Number(shotDirection.value), shotType: shotType.value, pose: p,
    });
    else player.pose(p);
    player.labBall.visible = ballControl.checked && (type === 'kick' || ['hold', 'gather', 'tracking'].includes(select.value));
    player.labBall.position.set(ballPosition.x, ballPosition.y, ballPosition.z);
    setWireframe(player);
  }
  if (motionPhase.textContent !== phaseText) motionPhase.textContent = phaseText;
  renderCharacter(type, p);
  if (state.playing) requestFrame();
}

slider.addEventListener('input', () => seek(Number(slider.value)));
select.addEventListener('change', configureMotion);
button.addEventListener('click', togglePlayback);
byId('restart').addEventListener('click', () => seek(0));
byId('previous-frame').addEventListener('click', () => seek(stepFrame(state.time, -1, state.duration)));
byId('next-frame').addEventListener('click', () => seek(stepFrame(state.time, 1, state.duration)));
byId('contact-jump').addEventListener('click', () => { if (info.contact !== null) seek(info.contact); });
speedControl.addEventListener('change', () => { advance(performance.now()); state.speed = Number(speedControl.value); requestFrame(); });
loopControl.addEventListener('change', () => { advance(performance.now()); state.loop = loopControl.checked; requestFrame(); });
for (const control of [shotDirection, keeperDirection, shotPower, shotType, wireframeControl, skeletonControl, ballControl]) control.addEventListener('change', requestFrame);
for (const control of [viewControl, faceView]) control.addEventListener('change', () => { updateViewLabels(); requestFrame(); });
zoomControl.addEventListener('input', () => { updateViewLabels(); requestFrame(); });
byId('show-grid').addEventListener('change', event => { grid.visible = event.target.checked; requestFrame(); });
byId('reset-view').addEventListener('click', () => {
  viewControl.value = 'front'; faceView.checked = false; zoomControl.value = 1;
  updateViewLabels(); requestFrame();
});
document.addEventListener('keydown', event => {
  // Native controls retain their own arrow, space, Home, and End behavior.
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input,select,textarea,button,a,summary,[contenteditable="true"]')) return;
  if (event.code === 'Space') { event.preventDefault(); if (!event.repeat) togglePlayback(); }
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault(); seek(stepFrame(state.time, event.key === 'ArrowRight' ? 1 : -1, state.duration, event.shiftKey ? 10 : 1));
  } else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); seek(event.key === 'Home' ? 0 : state.duration); }
  else if (event.key.toLowerCase() === 'k' && info.contact !== null) { event.preventDefault(); seek(info.contact); }
});
document.addEventListener('visibilitychange', () => {
  // Background time is intentionally excluded; resume the same motion frame.
  last = null;
  if (document.hidden) { cancelAnimationFrame(frameRequest); frameRequest = 0; }
  else requestFrame();
});
const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(stage);
window.addEventListener('resize', resize);
window.addEventListener('pageshow', () => { last = null; resize(); });
window.addEventListener('pagehide', event => {
  if (event.persisted) { cancelAnimationFrame(frameRequest); frameRequest = 0; last = null; return; }
  disposed = true; cancelAnimationFrame(frameRequest); resizeObserver.disconnect();
  Promise.all(Object.values(pairs).flat().map(player => player.ready)).then(() => {
    const resources = new Set();
    scene.traverse(object => {
      if (object.geometry) resources.add(object.geometry);
      for (const material of object.material ? Array.isArray(object.material) ? object.material : [object.material] : []) {
        resources.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
      }
      if (object.isSkinnedMesh) resources.add(object.skeleton);
    });
    for (const player of Object.values(pairs).flat()) {
      player.mixer?.stopAllAction(); if (player.root) player.mixer?.uncacheRoot(player.root);
    }
    for (const resource of resources) resource.dispose(); renderer?.dispose();
  });
});
Promise.all(Object.values(pairs).flat().map(player => player.ready)).then(loaded => {
  if (disposed) return;
  byId('asset-status').textContent = loaded.every(Boolean) ? '● 蒙皮模型已就绪' : '部分资源加载失败 · 程序模型备用';
  for (const player of Object.values(pairs).flat()) { createSkeleton(player); player.labWireframe = undefined; }
  requestFrame();
});
configureMotion(); resize();

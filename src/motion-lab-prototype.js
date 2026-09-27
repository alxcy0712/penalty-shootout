import * as THREE from 'three';
import {Player} from './character.js';
import {penaltyStyles, strikerRunupPose} from './anatomy.js';
import {Shot} from './engine.js';
import {renderPixelRatio} from './rendering.js';
import {loadStrikerPrototype} from './character-prototype-preview.js';

const idleDuration = 0.35;
let duration = 3.55;
let contact = 1.90;
const stats = {accuracy: 90, power: 90, touch: 90, composure: 90, speed: 80, reach: 80, handling: 95};
const scene = new THREE.Scene();
scene.background = new THREE.Color('#172625');
const renderer = new THREE.WebGLRenderer({antialias: true, powerPreference: 'high-performance'});
renderer.setPixelRatio(renderPixelRatio(innerWidth, innerHeight, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.domElement.setAttribute('aria-label', '人物射门动画对比画布');
document.body.appendChild(renderer.domElement);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
scene.add(new THREE.HemisphereLight('#e6f1ee', '#45624d', 2));
const keyLight = new THREE.DirectionalLight('#ffffff', 3);
keyLight.position.set(2, 6, 4);
scene.add(keyLight);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({color: '#314d43'}));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.014;
scene.add(floor);
scene.add(new THREE.GridHelper(30, 60, '#638477', '#426354'));

const oldPlayer = new Player(scene, '#b9efd7');
oldPlayer.group.position.x = -1.15;
oldPlayer.group.rotation.y = Math.PI;
const ballGeometry = new THREE.SphereGeometry(0.11, 20, 14);
const ballMaterial = new THREE.MeshStandardMaterial({color: '#e6ede4', roughness: 0.6});
const oldBall = new THREE.Mesh(ballGeometry, ballMaterial);
const newBall = new THREE.Mesh(ballGeometry, ballMaterial);
oldPlayer.group.add(oldBall);
scene.add(newBall);

const camera = new THREE.PerspectiveCamera(31, innerWidth / innerHeight, 0.1, 60);
const slider = document.querySelector('#time');
const output = document.querySelector('#time-readout');
const phase = document.querySelector('#phase');
const metrics = document.querySelector('#metrics');
const metricsToggle = document.querySelector('#metrics-toggle');
metrics.hidden = innerWidth < 700 || innerHeight < 500;
metricsToggle.setAttribute('aria-expanded', String(!metrics.hidden));
metricsToggle.addEventListener('click', () => {
  metrics.hidden = !metrics.hidden;
  metricsToggle.setAttribute('aria-expanded', String(!metrics.hidden));
});
const playButton = document.querySelector('#play');
const directionControl = document.querySelector('#direction');
const powerControl = document.querySelector('#power');
const typeControl = document.querySelector('#shot-type');
const speedControl = document.querySelector('#speed');
const requestedVersion = new URLSearchParams(location.search).get('asset');
const version = ['baseline', 'refined', 'quaternius', 'mocap'].includes(requestedVersion) ? requestedVersion : 'quaternius';
document.querySelector('#asset-version').value = version;
document.querySelector('#labels span:last-child').textContent = version === 'mocap' ? '真人动捕 · CMU 10_01' : version === 'quaternius' ? '修改后 · 身体与发力修正' : '自制骨骼原型 · 11号';
let prototype = null;
let beforePrototype = null;
const cameraControl = document.querySelector('#camera-view');
let playing = false;
let playhead = 0;
let playbackSpeed = Number(speedControl.value);
let lastFrame = null;
let renderRequest = 0;
let lastStatsUpdate = 0;
const frameSamples = [];
let frameSampleCursor = 0;
let shotSimulationMs = 0;
let shotReplay = null;
let oldAnimationMs = 0;
let renderSubmitMs = 0;

function makeShot() {
  const key = `${directionControl.value}/${powerControl.value}/${typeControl.value}`;
  if (shotReplay?.key === key) return shotReplay;
  const started = performance.now();
  const shot = new Shot({
    x: Number(directionControl.value),
    power: Number(powerControl.value),
    low: typeControl.value === 'low',
    chip: typeControl.value === 'chip',
  }, stats, stats, 0, 42);
  const points = [{...shot.ball}];
  for (let i = 0; i < 480 && !shot.result; i++) {
    shot.step(1 / 120);
    points.push({...shot.ball});
  }
  shotSimulationMs = performance.now() - started;
  shotReplay = {key, points};
  return shotReplay;
}

function ballAt(time) {
  const points = makeShot().points;
  const cursor = Math.max(0, time) * 120;
  const index = Math.min(Math.floor(cursor), points.length - 1);
  const a = points[index];
  const b = points[Math.min(index + 1, points.length - 1)];
  const q = cursor - Math.floor(cursor);
  return {
    x: a.x + (b.x - a.x) * q,
    y: a.y + (b.y - a.y) * q,
    z: a.z + (b.z - a.z) * q - 11,
  };
}

function setPoseTime(time) {
  const oldStarted = performance.now();
  const comparisonTime = version === 'mocap' ? (time + 1.9 - contact) : time;
  beforePrototype?.setTime(comparisonTime, {direction: Number(directionControl.value), power: Number(powerControl.value), type: typeControl.value});
  const motionTime = Math.max(0, time - idleDuration);
  if (!beforePrototype) {
    const style = penaltyStyles[0];
    const pose = strikerRunupPose(
      motionTime,
      Math.min(1, motionTime / style.duration),
      motionTime >= style.duration ? motionTime - style.duration : -1,
      Number(powerControl.value),
      Number(directionControl.value),
      style,
      typeControl.value,
    );
    for (const key of ['hip', 'shoulder', 'head', 'shoulders', 'hips', 'hands', 'elbows', 'feet', 'knees']) {
      if (Array.isArray(pose[key])) pose[key].forEach(point => point.z -= 11);
      else pose[key].z -= 11;
    }
    oldPlayer.pose(pose);
  }
  oldAnimationMs = performance.now() - oldStarted;
  const ball = ballAt(time - contact);
  if (beforePrototype) oldBall.position.set(-(innerHeight > innerWidth ? .72 : 1.15)-ball.x,ball.y,-ball.z);
  else oldBall.position.set(ball.x, ball.y, ball.z);
  oldBall.visible = cameraControl.value !== 'side';
  // The mirrored comparison actor stands in the opposite lane and faces the
  // other way, so reflect the physical shot around the center line.
  const separation = innerHeight > innerWidth ? 0.72 : 1.15;
  newBall.position.set(separation - ball.x, ball.y, -ball.z);
  if (prototype) prototype.setTime(time, {
    direction: Number(directionControl.value),
    power: Number(powerControl.value),
    type: typeControl.value,
  });
  if (version === 'mocap') return time < .8 ? '动捕 · 重心预备' : time < 1.5 ? '动捕 · 助跑与摆臂' : time < contact ? '动捕 · 支撑与摆腿' : time < contact + .4 ? '动捕 · 触球随摆' : '动捕 · 恢复平衡';
  if (time < idleDuration) return '待机呼吸';
  return time < idleDuration + 0.18 ? '重心预备' : time < idleDuration + 0.91 ? '助跑与交替落脚' : time < idleDuration + 1.22 ? '摆动腿后摆 · 支撑脚找位' : time < contact ? '支撑脚锁定 · 髋躯干带动摆腿' : time < contact + 0.19 ? '触球 · 摆腿随摆' : time < idleDuration + 2.75 ? '惯性制动 · 恢复平衡' : '收势';
}

function cameraLayout() {
  const portrait = innerHeight > innerWidth;
  const separation = portrait ? 0.72 : 1.15;
  oldPlayer.group.position.x = -separation;
  if (prototype) prototype.root.position.x = separation;
  if (beforePrototype) beforePrototype.root.position.x = -separation;
  const side = cameraControl.value === 'side';
  oldPlayer.group.visible = !beforePrototype && !side;
  if (beforePrototype) beforePrototype.root.visible = !side;
  document.querySelector('#labels').hidden = side;
  camera.fov = portrait ? 37 : 31;
  camera.position.set(0, 1.72, portrait ? 8.4 : 6.2);
  camera.lookAt(0, 0.91, -0.05);
  if (version === 'mocap' && portrait) {
    camera.fov = 40;
    camera.position.set(.3, 1.72, 10.2);
    camera.lookAt(.3, .91, -.05);
  }
  if (cameraControl.value === 'oblique') {
    camera.position.set(3.7,2.15,5.6);
    camera.lookAt(0,.95,-.40);
  } else if (side) {
    camera.position.set(separation+(portrait ? 7.2 : 4.8),1.65,-.65);
    camera.lookAt(separation,.95,-.65);
  }
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function updateMetrics(now) {
  if (!prototype || now - lastStatsUpdate < 350) return;
  lastStatsUpdate = now;
  const deviceMemory = performance.memory?.usedJSHeapSize;
  metrics.textContent = [
    `原型 GLB ${(prototype.stats.bytes / 1024).toFixed(1)} KB · 加载 ${prototype.stats.loadMs.toFixed(1)} ms · 解码 ${prototype.stats.parseMs.toFixed(1)} ms`,
    `${prototype.stats.triangles.toLocaleString()} triangles · ${prototype.stats.bones} bones · ${prototype.stats.materials} mats · ${prototype.stats.meshes} meshes`,
    `渲染 ${renderer.info.render.calls} calls · ${renderer.info.render.triangles.toLocaleString()} tris · 动作 ${prototype.stats.animationMs.toFixed(2)} ms`,
    `对照角色更新 ${oldAnimationMs.toFixed(2)} ms · 渲染提交 ${renderSubmitMs.toFixed(2)} ms（非 GPU 时间）`,
    `球路预演 ${shotSimulationMs.toFixed(2)} ms / ${shotReplay?.points.length ?? 0} 步（缓存）`,
    frameSamples.length ? `帧间隔 P50/P95 ${percentile(frameSamples, 0.50).toFixed(1)}/${percentile(frameSamples, 0.95).toFixed(1)} ms · >33 ms ${frameSamples.filter(value => value > 33.3).length}` : '帧时间：播放时采样',
    `${innerWidth}×${innerHeight} · DPR ${devicePixelRatio} · 渲染比 ${renderer.getPixelRatio().toFixed(2)}`,
    `WebGL ${renderer.info.memory.geometries} geom / ${renderer.info.memory.textures} tex · JS heap ${deviceMemory ? `${(deviceMemory / 1048576).toFixed(0)} MB` : '不可用'}`,
  ].join('\n');
}

function draw(now) {
  renderRequest = 0;
  if (playing && lastFrame !== null) {
    const delta = Math.max(0, now - lastFrame);
    playhead = Math.min(duration, playhead + delta / 1000 * playbackSpeed);
    if (frameSamples.length < 240) frameSamples.push(delta);
    else frameSamples[frameSampleCursor++ % 240] = delta;
    if (playhead >= duration) {
      playing = false;
      playButton.textContent = '播放';
    }
  }
  lastFrame = now;
  slider.value = String(playhead);
  output.value = `${playhead.toFixed(2)} 秒`;
  phase.textContent = setPoseTime(playhead);
  cameraLayout();
  const renderStarted = performance.now();
  renderer.render(scene, camera);
  renderSubmitMs = performance.now() - renderStarted;
  updateMetrics(now);
  if (playing) requestRender();
}

function requestRender() {
  if (!renderRequest) renderRequest = requestAnimationFrame(draw);
}

async function loadPrototype() {
  try {
    prototype = await loadStrikerPrototype(scene, '#b9efd7', version);
    prototype.root.position.x = innerHeight > innerWidth ? 0.72 : 1.15;
    prototype.stats.framesPerSecond = prototype.metadata.framesPerSecond;
    duration = prototype.metadata.durationSeconds;
    contact = prototype.metadata.contactSeconds;
    slider.max = String(duration);
    if (version === 'mocap') document.querySelector('footer').textContent = '两侧同速、触球对齐；左侧起点偏移 0.05 秒。球路共用原物理，动捕为常规射门。';
    if (['quaternius', 'mocap'].includes(version)) {
      beforePrototype = await loadStrikerPrototype(scene, '#b9efd7', version === 'mocap' ? 'quaternius' : 'before');
      document.querySelector('#labels span:first-child').textContent = version === 'mocap' ? '之前 · 程序动作' : '修改前 · 同一 CC0 人物';
      oldPlayer.group.remove(oldBall);
      scene.add(oldBall);
    }
    lastStatsUpdate = -Infinity;
    metrics.textContent = `已加载：${prototype.stats.triangles.toLocaleString()} triangles · ${prototype.stats.bones} bones · ${(prototype.stats.bytes / 1024).toFixed(1)} KB`;
    requestRender();
  } catch (error) {
    metrics.dataset.error = 'true';
    metrics.textContent = `原型加载失败：${error.message}`;
    console.error(error);
    requestRender();
  }
}

cameraControl.addEventListener('change', () => { cameraLayout(); requestRender(); });

slider.addEventListener('input', () => {
  playhead = Number(slider.value);
  lastStatsUpdate = -Infinity;
  requestRender();
});
document.querySelector('#asset-version').addEventListener('change', event => {
  const url = new URL(location.href);
  url.searchParams.set('asset', event.target.value);
  location.href = url.href;
});
playButton.addEventListener('click', () => {
  if (playhead >= duration) playhead = 0;
  playing = !playing;
  if (playing) {
    frameSamples.length = 0;
    frameSampleCursor = 0;
    lastStatsUpdate = -Infinity;
  }
  lastFrame = null;
  playButton.textContent = playing ? '暂停' : '播放';
  requestRender();
});
speedControl.addEventListener('change', () => {
  playbackSpeed = Number(speedControl.value);
});
for (const control of [directionControl, powerControl, typeControl]) control.addEventListener('change', () => {
  shotReplay = null;
  lastStatsUpdate = -Infinity;
  requestRender();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (renderRequest) cancelAnimationFrame(renderRequest);
    renderRequest = 0;
    lastFrame = null;
  } else requestRender();
});
window.addEventListener('resize', () => {
  renderer.setPixelRatio(renderPixelRatio(innerWidth, innerHeight, devicePixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  cameraLayout();
  requestRender();
});
window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  playing = false;
  if (renderRequest) cancelAnimationFrame(renderRequest);
  prototype?.dispose();
  beforePrototype?.dispose();
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  scene.traverse(object => {
    if (!object.geometry) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture) textures.add(value);
      }
    }
  });
  geometries.add(ballGeometry);
  materials.add(ballMaterial);
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
  renderer.dispose();
});

cameraLayout();
loadPrototype();
requestRender();

import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';

const MODEL_URL = new URL('../assets/characters/striker-prototype-refined.glb', import.meta.url);
const META_URL = new URL('../assets/characters/striker-prototype-refined.json', import.meta.url);
const BASELINE_URL = new URL('../assets/characters/striker-prototype.glb', import.meta.url);
const BASELINE_META_URL = new URL('../assets/characters/striker-prototype.json', import.meta.url);
const QUATERNIUS_URL = new URL('../assets/characters/striker-quaternius.glb', import.meta.url);
const QUATERNIUS_META_URL = new URL('../assets/characters/striker-quaternius.json', import.meta.url);

const MOCAP_URL = new URL('../assets/characters/striker-mocap.glb', import.meta.url);
const MOCAP_META_URL = new URL('../assets/characters/striker-mocap.json', import.meta.url);

const BEFORE_URL = new URL('../assets/characters/striker-quaternius-v2.glb', import.meta.url);
const BEFORE_META_URL = new URL('../assets/characters/striker-quaternius-v2.json', import.meta.url);

export function attachJerseyNumber(root, number, anchor = [0, 1.345, 0.128]) {
  let skeleton;
  root.traverse(object => { if (object.isSkinnedMesh) skeleton ??= object.skeleton; });
  const index = skeleton.bones.findIndex(bone => bone.name === 'chest');
  const inverseBind = skeleton.boneInverses[index];
  number.position.fromArray(anchor).applyMatrix4(inverseBind);
  number.quaternion.setFromRotationMatrix(inverseBind);
  skeleton.bones[index].add(number);
}

export async function loadStrikerPrototype(scene, color = '#b9efd7', version = 'refined') {
  const modelURL = version === 'mocap' ? MOCAP_URL : version === 'before' ? BEFORE_URL : version === 'quaternius' ? QUATERNIUS_URL : version === 'baseline' ? BASELINE_URL : MODEL_URL;
  const metaURL = version === 'mocap' ? MOCAP_META_URL : version === 'before' ? BEFORE_META_URL : version === 'quaternius' ? QUATERNIUS_META_URL : version === 'baseline' ? BASELINE_META_URL : META_URL;
  const started = performance.now();
  const [modelResponse, metaResponse] = await Promise.all([fetch(modelURL), fetch(metaURL)]);
  if (!modelResponse.ok || !metaResponse.ok) throw new Error('原型模型资源加载失败');
  const modelBytes = await modelResponse.arrayBuffer();
  const metadata = await metaResponse.json();
  const fetchedAt = performance.now();
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(modelBytes, modelURL.href);
  const loadedAt = performance.now();
  const root = gltf.scene;
  root.position.x = 1.15;
  root.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    if (object.material?.name?.toLowerCase().includes('kit')) {
      object.material = object.material.clone();
      object.material.color.set(color);
    }
  });
  scene.add(root);

  const clip = gltf.animations[0];
  if (!clip) throw new Error('原型模型没有动画片段');
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  action.paused = true;

  const chest = root.getObjectByName('chest');
  const torsoPitchAxis = new THREE.Vector3(1, 0, 0);
  const torsoYawAxis = new THREE.Vector3(0, 1, 0);
  const additiveRotation = new THREE.Quaternion();
  const numberCanvas = document.createElement('canvas');
  numberCanvas.width = 256;
  numberCanvas.height = 128;
  const context = numberCanvas.getContext('2d');
  context.fillStyle = '#19352e';
  context.font = 'bold 100px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('11', 128, 68);
  const numberTexture = new THREE.CanvasTexture(numberCanvas);
  numberTexture.colorSpace = THREE.SRGBColorSpace;
  const number = new THREE.Mesh(
    new THREE.PlaneGeometry(0.12, 0.08),
    new THREE.MeshBasicMaterial({map: numberTexture, transparent: true, depthWrite: false, side: THREE.DoubleSide}),
  );
  attachJerseyNumber(root, number, ['quaternius', 'before', 'mocap'].includes(version) ? [0, 1.345, .18] : undefined);

  let animationMs = 0;
  const setTime = (time, shot = {}) => {
    const start = performance.now();
    action.time = THREE.MathUtils.clamp(time, 0, clip.duration);
    mixer.update(0);
    const direction = Number(shot.direction ?? 0);
    const power = Number(shot.power ?? 0.7);
    const type = shot.type ?? 'normal';
    const contactBlend = version === 'mocap' ? 0 : THREE.MathUtils.smoothstep(time, 1.56, 1.81)
      * (1 - THREE.MathUtils.smoothstep(time, 2.10, 2.36));
    root.rotation.y = 0;
    const typeLean = type === 'low' ? 0.055 : type === 'chip' ? -0.035 : 0;
    if (chest) chest.quaternion.multiply(additiveRotation.setFromAxisAngle(
      torsoPitchAxis,
      contactBlend * (typeLean + (power - 0.7) * 0.05),
    ));
    if (chest) chest.quaternion.multiply(additiveRotation.setFromAxisAngle(torsoYawAxis, -direction * 0.04 * contactBlend));
    root.updateWorldMatrix(true, true);
    animationMs = performance.now() - start;
  };
  setTime(0);

  let triangles = 0;
  let meshCount = 0;
  const materials = new Set();
  root.traverse(object => {
    if (!object.isMesh || object === number) return;
    meshCount++;
    triangles += object.geometry.index
      ? object.geometry.index.count / 3
      : object.geometry.attributes.position.count / 3;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });

  return {
    root,
    clip,
    metadata,
    stats: {
      bytes: modelBytes.byteLength,
      loadMs: fetchedAt - started,
      parseMs: loadedAt - fetchedAt,
      animationMs: 0,
      triangles,
      meshes: meshCount,
      materials: materials.size,
      bones: metadata.bones,
    },
    setTime(time, shot = {}) {
      setTime(time, shot);
      this.stats.animationMs = animationMs;
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      number.removeFromParent();
      const geometries = new Set();
      const materials = new Set();
      const skeletons = new Set();
      root.traverse(object => {
        if (!object.isMesh) return;
        geometries.add(object.geometry);
        if (object.skeleton) skeletons.add(object.skeleton);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          materials.add(material);
        }
      });
      for (const skeleton of skeletons) skeleton.dispose();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) { material.map?.dispose(); material.dispose(); }
      scene.remove(root, number);
      number.geometry.dispose();
      number.material.map.dispose();
      number.material.dispose();
    },
  };
}

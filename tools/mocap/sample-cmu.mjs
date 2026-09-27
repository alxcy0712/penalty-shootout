// Sample the attributed BVH through the same Three.js parser used by the app.
import fs from 'node:fs';
import * as THREE from 'three';
import {BVHLoader} from 'three/addons/loaders/BVHLoader.js';
const source = 'assets/characters/mocap/cmu-soccer/10_01.soccer-kick-ball.bvh';
const {skeleton, clip} = new BVHLoader().parse(fs.readFileSync(source, 'utf8'));
const root = skeleton.bones[0];
const mixer = new THREE.AnimationMixer(root);
const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
action.clampWhenFinished = true;
action.play();
const frames = [];
const position = new THREE.Vector3();
for (let i = 0; i <= 210; i++) {
  mixer.setTime(3.15 + i / 60);
  root.updateMatrixWorld(true);
  const points = {};
  for (const bone of skeleton.bones) {
    const name = bone.name === 'ENDSITE' ? `${bone.parent.name}End` : bone.name;
    points[name] = position.setFromMatrixPosition(bone.matrixWorld).toArray();
  }
  frames.push(points);
}
fs.writeFileSync('/tmp/penalty-cmu-samples.json', JSON.stringify({source, start: 3.15, fps: 60, frames}));
console.log('Sampled', frames.length, 'frames at native speed');

import {test} from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';import {Player} from '../src/character.js';import {goalkeeperPose,strikerPose,holdingPose} from '../src/anatomy.js';
// Texture text painting is irrelevant to vertex placement; use a minimal canvas
// stand-in to inspect the actual model geometry without a browser renderer.
globalThis.document={createElement:()=>({width:256,height:256,getContext:()=>({clearRect(){},fillText(){}})})};
test('rendered characters clear the grass and landed keepers retain ground support',()=>{
 const point=new THREE.Vector3(),keeper=new Player(new THREE.Scene(),'#e8ac73',true),striker=new Player(new THREE.Scene(),'#b9efd7');
 const inspect=(player,pose,label,grounded=false)=>{let minimum=Infinity;player.pose(pose);player.group.updateMatrixWorld(true);player.group.traverse(object=>{if(!object.isMesh)return;const positions=object.geometry.attributes.position;for(let i=0;i<positions.count;i++){point.fromBufferAttribute(positions,i).applyMatrix4(object.matrixWorld);minimum=Math.min(minimum,point.y);assert.ok(point.y>=-.0140001,`${label}: mesh penetrates pitch at ${point.y}`);if(label.startsWith('keeper')&&point.y>=0&&point.y<=2.44)for(const postX of[-3.66,3.66])assert.ok(Math.hypot(point.x-postX,point.z)>=.06,`${label}: model intersects goalpost`);}});if(grounded)assert.ok(minimum<=.002,`${label}: entire body floats at ${minimum} m`);};
 for(const direction of[-1,1])for(const height of[.3,1.2,2.3])for(let n=0;n<=180;n+=2)inspect(keeper,goalkeeperPose({speed:85,reach:85},direction,n/60,height),`keeper ${direction}/${height}/${n}`,n>=60);
 for(const direction of[-1,1])for(const t of[.3,.5,.8,1.2,1.5,1.8,2.2,2.8])inspect(keeper,holdingPose(goalkeeperPose({speed:85,reach:85},direction,t,1.2)).pose,`held ${direction}/${t}`);
 for(const x of[-4.5,0,4.5])for(const power of[0,1])for(let n=0;n<=120;n++){const t=n/120;inspect(striker,strikerPose(t,Math.min(t/.55,1),t>=.55?t-.55:-1,power,x),`striker ${x}/${power}/${n}`);}
});
test('standing boots contact the grass instead of hovering over it',()=>{
 const point=new THREE.Vector3();for(const keeper of[false,true]){const player=new Player(new THREE.Scene(),'#b9efd7',keeper);player.pose(keeper?goalkeeperPose({speed:85,reach:85}):strikerPose(0,0));player.group.updateMatrixWorld(true);for(const foot of player.feet){let minimum=Infinity;foot.traverse(object=>{if(!object.isMesh)return;const positions=object.geometry.attributes.position;for(let i=0;i<positions.count;i++){point.fromBufferAttribute(positions,i).applyMatrix4(object.matrixWorld);minimum=Math.min(minimum,point.y);}});assert.ok(Math.abs(minimum+.014)<1e-6);}}
});
test('boots rotate continuously through lift-off, contact and goalkeeper recovery',()=>{
 const striker=new Player(new THREE.Scene(),'#b9efd7'),keeper=new Player(new THREE.Scene(),'#e8ac73',true);
 const scan=(player,sample,label)=>{
  player.pose(sample(0));const previous=player.feet.map(foot=>foot.quaternion.clone());
  for(let n=1;n<=3500;n++){
   player.pose(sample(n/1000));
   for(let i=0;i<2;i++){
    const angle=previous[i].angleTo(player.feet[i].quaternion);
    assert.ok(angle<.05,`${label}: foot ${i} rotated ${angle} radians within 1 ms at ${n} ms`);
    previous[i].copy(player.feet[i].quaternion);
   }
  }
 };
 for(const x of[-4.5,0,4.5])for(const power of[0,.5,1])scan(striker,t=>strikerPose(t,Math.min(t/.55,1),t>=.55?t-.55:-1,power,x),`shot ${x}/${power}`);
 for(const direction of[-1,1])for(const height of[.3,1.2,2.3])scan(keeper,t=>goalkeeperPose({speed:85,reach:85},direction,t,height),`dive ${direction}/${height}`);
});

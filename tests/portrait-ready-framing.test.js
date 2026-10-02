import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Stadium} from '../src/scene.js';
import {keeperPose} from '../src/engine.js';
import {advancedAttackRadius} from '../src/rendering.js';
import {loadCharacter} from './helpers/load-character.js';

function stage(width,height,striker,keeper){
 const object=()=>new THREE.Object3D(),geometry=()=>new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(new Float32Array(99),3));
 const s=Object.assign(Object.create(Stadium.prototype),{mode:'game',viewWidth:width,viewHeight:height,needsRender:true,netTime:0,cameraAngle:0,camera:new THREE.PerspectiveCamera(45,width/height,.1,140),cameraFocus:new THREE.Vector3(),scene:new THREE.Scene(),reducedMotion:{matches:false},striker,keeper,
  ball:new THREE.Mesh(new THREE.SphereGeometry(.111,20,12)),ballShadow:Object.assign(object(),{material:{}}),ballShadowState:{},trail:Object.assign(object(),{geometry:geometry()}),trailCount:0,trailBuffer:new Float32Array(21),aim:object(),arc:Object.assign(object(),{geometry:geometry()}),arcBuffer:new Float32Array(99),rain:object(),
  waitingKeeperPose:keeperPose({reach:80,speed:80},0,0,1),renderer:{render(scene,camera){scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);}}});
 s.buildGoal();s.scene.add(striker.group,keeper.group,s.ball);return s;
}
function screenBounds(root,camera,width,height){
 root.updateMatrixWorld(true);let bounds={left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity},point=new THREE.Vector3();
 root.traverse(m=>{if(!m.isMesh&&!m.isLine)return;const positions=m.geometry.attributes.position;if(m.isSkinnedMesh)m.skeleton.update();for(let i=0;i<positions.count;i++){
  point.fromBufferAttribute(positions,i);if(m.isSkinnedMesh)m.applyBoneTransform(i,point);point.applyMatrix4(m.matrixWorld).project(camera);
  assert.ok(point.z>-1&&point.z<1,'ready geometry stays within the camera depth range');
  const x=(point.x+1)*width/2,y=(1-point.y)*height/2;bounds.left=Math.min(bounds.left,x);bounds.right=Math.max(bounds.right,x);bounds.top=Math.min(bounds.top,y);bounds.bottom=Math.max(bounds.bottom,y);
 }});return bounds;
}

test('all four real ready skins, keeper, ball and goal fit advanced portrait with a stable margin',async()=>{
 const striker=await loadCharacter(),keeper=await loadCharacter(true);
 for(const actor of[striker,keeper]){actor.group=new THREE.Group();actor.group.add(actor.root);actor.setColor=()=>{};}
 for(const[width,height]of[[320,700],[390,844],[320,900],[430,932],[844,390]]){
  const s=stage(width,height,striker,keeper);
  for(let style=0;style<4;style++){
   const match={turn:0,kicker:0,serial:style+1,mode:'advanced',teams:[{color:'#fff',players:[{number:8+style}]},{color:'#fff',players:[{number:1}]}]};
   s.update(1/60,0,null,0,null,match,null,1);
   for(const [name,root]of[['striker',striker.root],['keeper',keeper.root],['goal and ball',s.scene]]){
    const b=screenBounds(root,s.camera,width,height);assert.ok(b.left>=12&&b.right<=width-12,`${width}x${height} style${style} ${name}: ${JSON.stringify(b)}`);
    assert.ok(b.top>=0&&b.bottom<=height,`${name} must be vertically visible`);
   }
   assert.equal(s.camera.fov,43,'extra visibility does not widen the aiming lens');
   const before=s.camera.projectionMatrix.elements.slice(),position=s.camera.position.clone();
   s.update(1/60,.2,null,0,{x:2,power:.8,y:1.2},match,null,1);
   assert.deepEqual(s.camera.projectionMatrix.elements,before);assert.deepEqual(s.camera.position,position,'preview cannot move the framing');
  }
 }
});

test('static attack framing stays within the existing17–25m camera range and retains landscape',()=>{
 assert.equal(advancedAttackRadius(844,390),17);
 for(const w of[240,320,390,430,844,1920])for(const h of[390,700,844,900,1080]){const radius=advancedAttackRadius(w,h);assert.ok(Number.isFinite(radius)&&radius>=17&&radius<=25);}
});

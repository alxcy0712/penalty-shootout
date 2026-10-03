import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Stadium} from '../src/scene.js';
import {Shot,keeperPose} from '../src/engine.js';

const stats={accuracy:90,power:90,touch:90,composure:90,speed:85,reach:85,handling:95,number:11};
function completedShot(){const shot=new Shot({x:0,y:.2,power:.5},stats,stats,0,42);while(!shot.result&&shot.t<30)shot.step(1/120);assert.equal(shot.caught,true);return shot;}
function stage(){
 const object=()=>new THREE.Object3D(),position=new THREE.BufferAttribute(new Float32Array(99),3),geometry=new THREE.BufferGeometry();geometry.setAttribute('position',position);
 const value=Object.assign(Object.create(Stadium.prototype),{mode:'game',viewWidth:390,viewHeight:844,viewKey:null,needsRender:true,netTime:0,cameraAngle:0,camera:new THREE.PerspectiveCamera(),cameraFocus:new THREE.Vector3(),scene:new THREE.Scene(),reducedMotion:{matches:false},
  keeper:{pose(p){value.drawnPose=p;value.poseCalls++;},setColor(){}},striker:{group:object(),setColor(){},kick(){}},poseCalls:0,
  ball:object(),ballShadow:Object.assign(object(),{material:{}}),ballShadowState:{},trail:Object.assign(object(),{geometry:new THREE.BufferGeometry()}),trailCount:0,trailBuffer:new Float32Array(21),
  aim:object(),arc:Object.assign(object(),{geometry}),arcBuffer:new Float32Array(99),net:{geometry},netMotion:{update(){return false;},reset(){return false;}},rain:object(),renderer:{render(){}},
  waitingKeeperPose:keeperPose(stats,0,0,1)});
 value.match={turn:0,kicker:0,mode:'advanced',teams:[{color:'#fff',players:[stats]},{color:'#fff',players:[stats]}]};
 value.frame=(dt,shot)=>value.update(dt,0,shot,0,null,value.match,null,1);
 return value;
}
function maxDifference(a,b){let d=0;for(const key of ['hip','shoulder','head', 'up'])for(const axis of ['x','y','z'])d=Math.max(d,Math.abs(a[key][axis]-b[key][axis]));for(const key of ['hands','elbows','feet','knees'])for(let i=0;i<2;i++)for(const axis of ['x','y','z'])d=Math.max(d,Math.abs(a[key][i][axis]-b[key][i][axis]));return d;}

test('actual Stadium result caller completes a low central catch at 30/60/120 Hz',()=>{
 const poses=[];
 for(const hz of [30,60,120]){const s=stage(),shot=completedShot();for(let i=0;i<hz*4;i++)s.frame(1/hz,shot);assert.ok(s.drawnPose.hip.y>.75,'result drawing must leave the indefinite 30 cm squat');assert.ok(s.drawnPose.feet.every(p=>Math.abs(p.y-.075)<1e-8),'standing boots remain planted');assert.ok(s.ball.position.y>.8,'secured ball follows the standing keeper');poses.push(s.drawnPose);}
 assert.ok(maxDifference(poses[0],poses[1])<1e-8);assert.ok(maxDifference(poses[1],poses[2])<1e-8);
});

test('pause, forced redraw, a new shot and ready reset cannot carry a stale result clock',()=>{
 const s=stage(),first=completedShot();for(let i=0;i<30;i++)s.frame(1/60,first);const time=s.resultElapsed,pose=s.drawnPose,calls=s.poseCalls;
 for(let i=0;i<100;i++)s.frame(0,first);assert.equal(s.resultElapsed,time);assert.equal(s.poseCalls,calls);assert.equal(s.drawnPose,pose);
 s.needsRender=true;s.frame(0,first);assert.equal(s.resultElapsed,time);assert.equal(maxDifference(s.drawnPose,pose),0);
 const next=completedShot();s.frame(1/60,next);assert.equal(s.resultElapsed,0);assert.ok(s.drawnPose.hip.y<.31,'new catch starts at its own source pose');
 s.match.turn=1;s.frame(1/60,null);assert.equal(s.drawnPose,s.waitingKeeperPose);assert.deepEqual(s.ball.position.toArray(),[0,.11,11]);
});

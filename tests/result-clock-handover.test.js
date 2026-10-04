import {updateFrameProfile} from '../src/frame-profile.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {Stadium} from '../src/scene.js';
import {Shot,clamp,keeperPose} from '../src/engine.js';
import {penaltyStyle} from '../src/anatomy.js';
import {committedKickAim} from '../src/shot-input-state.js';
import {gameKickTime} from '../src/game-character.js';

const stats={accuracy:90,power:90,touch:90,composure:90,curve:90,speed:85,reach:85,handling:99,number:4};
const main=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
const frameSource=main.slice(main.indexOf('function runupDuration('),main.indexOf("document.addEventListener('visibilitychange'"));
const releaseSource=main.match(/function release[^\n]+/)[0];

// Keep the real main frame, fixed-step accumulator and Stadium presentation.
// Only the renderer, DOM and character mesh upload are replaced.
function harness(){
  const object=()=>new THREE.Object3D();
  const geometry=size=>new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(new Float32Array(size),3));
  const stage=Object.assign(Object.create(Stadium.prototype),{
    mode:'game',viewWidth:390,viewHeight:844,needsRender:true,netTime:0,cameraAngle:0,
    camera:new THREE.PerspectiveCamera(),cameraFocus:new THREE.Vector3(),scene:new THREE.Scene(),reducedMotion:{matches:false},
    keeper:{pose(p){stage.drawnPose=p;stage.poseCalls++;},setColor(){}},poseCalls:0,
    striker:{group:object(),setColor(){},kick(runup,after,options){stage.drawnKick={runup,after,options};}},
    ball:object(),ballShadow:Object.assign(object(),{material:{}}),ballShadowState:{},
    trail:Object.assign(object(),{geometry:geometry(21)}),trailCount:0,trailBuffer:new Float32Array(21),
    aim:object(),arc:Object.assign(object(),{geometry:geometry(99)}),arcBuffer:new Float32Array(99),
    net:{geometry:geometry(99)},netMotion:{update(){return false;},reset(){return false;}},rain:object(),renderer:{render(){}},
    waitingKeeperPose:keeperPose(stats,0,0,1),
  });
  const match={turn:0,kicker:0,mode:'advanced',aiDive:0,record(){},
    teams:[{color:'#fff',players:[stats]},{color:'#fff',players:[stats]}],
    shoot(aim,direction){return new Shot(aim,stats,stats,direction,1);}};
  const aim={x:0,power:.8,low:true};
  const context={state:{phase:'flight',shot:match.shoot(aim,0),match,aim,turnTime:0,runup:0},
    updateFrameProfile,graphics:null,runtimeBlocked:()=>false,paused:false,pointer:null,frameTime:0,elapsed:0,accumulator:0,saveClock:0,
    committedKickAim,clamp,penaltyStyle,document:{hidden:false},requestAnimationFrame(){},save(){},sound(){},$:()=>null,stage,
    active:()=>['runup','flight'].includes(context.state.phase),transition(phase){context.state.phase=phase;}};
  vm.createContext(context);vm.runInContext(releaseSource+'\n'+frameSource,context);
  return {context,stage,tick(dt){context.frame(context.frameTime+dt*1000);}};
}

for(const hz of [30,60,120])test(`real ${hz} Hz match presents capture once without adding the flight frame twice`,()=>{
  const {context,stage,tick}=harness(),dt=1/hz;let previousClock=0;
  for(let frame=0;frame<hz*2&&context.state.phase!=='result';frame++){
    previousClock=stage.drawnKick?.after??0;tick(dt);
  }
  const shot=context.state.shot;
  assert.equal(context.state.phase,'result');assert.equal(shot.caught,true);
  assert.equal(stage.resultElapsed,0,'first result draw must be the capture origin');
  assert.deepEqual(stage.ball.position.toArray(),[shot.ball.x,shot.ball.y,shot.ball.z]);
  assert.deepEqual(stage.drawnPose,shot.pose,'visible gloves and limbs start at the physical catch');
  assert.equal(stage.drawnKick.after,shot.animationTime,'striker continues at the event time, without an extra dt');
  assert.ok(stage.drawnKick.after>=previousClock,'handover cannot rewind the striker');
  assert.ok(stage.drawnKick.after-previousClock<=dt+1/120+1e-10,'only the existing fixed-step interpolation lag is allowed');

  const captured=stage.drawnPose,draws=stage.poseCalls;
  context.paused=true;
  for(let i=0;i<3;i++)tick(dt);
  assert.equal(stage.resultElapsed,0);assert.equal(stage.poseCalls,draws);assert.equal(stage.drawnPose,captured);
  stage.needsRender=true;tick(dt);
  assert.deepEqual(stage.drawnPose,shot.pose);assert.equal(stage.resultElapsed,0,'forced paused redraw cannot advance the event');

  context.paused=false;tick(dt);
  assert.ok(Math.abs(stage.resultElapsed-dt)<1e-12,'next result frame contributes exactly its own interval');
  assert.ok(Math.abs(stage.drawnKick.after-shot.animationTime-dt)<1e-12);
  context.paused=true;stage.needsRender=true;const held=stage.drawnPose,ball=stage.ball.position.clone();tick(dt);
  assert.deepEqual(stage.drawnPose,held);assert.deepEqual(stage.ball.position,ball);
});

test('actual runup release and result handover use the same committed striker clock',()=>{
  for(const hz of [30,60,120]){
    const {context,stage,tick}=harness(),style=penaltyStyle(stats),dt=1/hz;
    context.state.phase='runup';context.state.shot=null;context.state.runup=style.duration-dt;
    // A tiny rounding tolerance enters release in the same display frame.
    tick(dt+1e-10);
    assert.equal(context.state.phase,'flight');
    assert.equal(context.state.shot.animationTime??0,0,'release does not fabricate a physics step');
    assert.equal(stage.drawnKick.after,0);
    assert.equal(gameKickTime(1,null,style),gameKickTime(0,stage.drawnKick.after,style),'runup and released shot share the exact boot-contact sample');
  }
});

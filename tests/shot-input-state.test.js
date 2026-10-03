import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {committedKickAim} from '../src/shot-input-state.js';
import {gestureInput,clamp} from '../src/engine.js';
import {penaltyStyle} from '../src/anatomy.js';
import {loadCharacter} from './helpers/load-character.js';
import * as calibrationApi from '../src/calibration.js';
import * as gestureSessionApi from '../src/gesture-session.js';

const source=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
class Element {
  listeners={};style={};captured=false;
  addEventListener(type,cb){this.listeners[type]=cb;}
  getBoundingClientRect(){return {left:0,top:0,width:390,height:300};}
  setPointerCapture(){this.captured=true;}
  hasPointerCapture(){return this.captured;}
  releasePointerCapture(){this.captured=false;this.emit('lostpointercapture');}
  setAttribute(){}
  emit(type,extra={}){this.listeners[type]?.({pointerId:1,pointerType:'touch',button:0,clientX:195,clientY:260,timeStamp:0,preventDefault(){},...extra});}
}
function harness(){
  const el=new Element(),ui=new Element(),frames=[];
  const context={state:{phase:'aim',match:{mode:'advanced',turn:0,kicker:0,teams:[{players:[{number:11}]}]},turnTime:0,runup:0,aim:null},
    paused:false,pointer:null,settings:calibrationApi.normalizePreferences({touch:2}),activeDevice:'touch',calibration:null,frameTime:0,elapsed:0,accumulator:0,saveClock:0,
    ...calibrationApi,...gestureSessionApi,
    committedKickAim,gestureInput,clamp,penaltyStyle,document:{hidden:false},requestAnimationFrame(){},active:()=>true,save(){},toast(){},
    $:selector=>['#indicator','#timer'].includes(selector)?null:ui,
    stage:{update(...args){frames.push(args);}},transition:phase=>{context.state.phase=phase;},release(){throw Error('Unexpected release');}};
  vm.createContext(context);
  vm.runInContext(source.match(/function shotInput[^\n]+/)[0]+'\n'+source.match(/function launch[^\n]+/)[0]+'\n'+source.slice(source.indexOf('function cancelGesture('),source.indexOf("document.addEventListener('visibilitychange'")),context);
  context.bindGesture(el,false);
  return {el,context,frames,tick(time){context.frame(time);return frames.at(-1);}};
}

test('real touch handlers preview aim without moving loaded striker until release',async()=>{
  const {el,context,tick}=harness(),actor=await loadCharacter(false);
  const pose=args=>{const aim=args[6]??{};actor.kick(args[3],null,{targetX:aim.x??0,power:aim.power??.7,style:penaltyStyle(context.state.match.teams[0].players[0])});actor.root.updateMatrixWorld(true);return actor.root.getObjectByName('pelvis').matrixWorld.elements.slice();};
  const before=pose(tick(16));el.emit('pointerdown');
  for(const [x,y] of [[90,210],[310,130],[130,170],[280,80]]){
    el.emit('pointermove',{clientX:x,clientY:y,timeStamp:100});const frame=tick(context.frameTime+100);
    assert.equal(context.state.phase,'aim');assert.ok(context.state.aim,'trajectory preview changes');assert.equal(frame[6],null);assert.deepEqual(pose(frame),before,'root and pelvis stay fixed throughout finger changes');
  }
  el.emit('pointerup',{clientX:280,clientY:80,timeStamp:600});
  assert.equal(context.state.phase,'runup');const frame=tick(context.frameTime+100);
  assert.ok(frame[3]>0);assert.equal(frame[6],context.state.aim);assert.notDeepEqual(pose(frame),before,'released shot begins running');
  const aim=context.state.aim;el.emit('pointerup',{clientX:50,clientY:20});assert.equal(context.state.aim,aim,'duplicate up cannot relaunch');
});
for(const cancel of ['pointercancel','lostpointercapture'])test(`${cancel} cancels aim and leaves striker waiting`,()=>{
  const {el,context,tick}=harness();el.emit('pointerdown');el.emit('pointermove',{clientX:80,clientY:100});el.emit(cancel);el.emit('pointerup',{clientX:80,clientY:100});
  assert.equal(context.state.phase,'aim');assert.equal(context.state.aim,null);assert.equal(tick(50)[6],null);
});
test('preview gating retains committed AI and simple-mode shots',()=>{
  const aim={x:3,power:.8},match={aiAim:aim};
  for(const phase of ['ready','aim','power','home'])assert.equal(committedKickAim({phase,aim,match}),null);
  for(const phase of ['guard','runup','flight','result'])assert.equal(committedKickAim({phase,aim,match}),aim);
});

test('holding beyond the clock keeps the player stationary until release',()=>{
  const {el,context,tick}=harness();el.emit('pointerdown');el.emit('pointermove',{clientX:90,clientY:120});
  const frame=tick(11000);assert.equal(context.state.phase,'aim');assert.equal(frame[3],0);assert.equal(frame[6],null);
  el.emit('pointerup',{clientX:90,clientY:120});assert.equal(context.state.phase,'runup');assert.equal(context.state.aim.timeout,true);
});
test('an untouched expired clock still commits the existing timeout shot',()=>{
  const {context,tick}=harness();tick(10000);assert.equal(context.state.phase,'runup');assert.equal(context.state.aim.timeout,true);
});

test('second finger and invalid short drag cannot start a shot',()=>{
  const {el,context,tick}=harness();el.emit('pointerdown');el.emit('pointermove',{pointerId:2,clientX:80,clientY:20});el.emit('pointerup',{pointerId:2,clientX:80,clientY:20});
  assert.equal(context.state.phase,'aim');assert.equal(context.state.aim,null);el.emit('pointerup');assert.equal(context.state.phase,'aim');assert.equal(tick(100)[3],0);
});

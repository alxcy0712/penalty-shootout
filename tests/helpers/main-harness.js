import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {Stadium} from '../../src/scene.js';
import {Match,Shot,clamp,gestureInput,directionMeter,powerMeter,keeperPose} from '../../src/engine.js';
import {penaltyStyle} from '../../src/anatomy.js';
import {committedKickAim} from '../../src/shot-input-state.js';

const main=await readFile(new URL('../../src/main.js',import.meta.url),'utf8');
const oneLine=name=>main.match(new RegExp(`function ${name}[^\\n]+`))[0];
const actions=main.slice(main.indexOf('function newMatch('),main.indexOf("document.addEventListener('visibilitychange'"));
const visibility=main.split('\n').find(line=>line.startsWith("document.addEventListener('visibilitychange'"));

class Element {
  listeners={};style={};captures=new Set();classList={toggle(){}};
  addEventListener(type,callback){this.listeners[type]=callback;}
  getBoundingClientRect(){return {left:0,top:0,width:390,height:300};}
  setPointerCapture(id){this.captures.add(id);}
  hasPointerCapture(id){return this.captures.has(id);}
  releasePointerCapture(id){this.captures.delete(id);this.emit('lostpointercapture',{pointerId:id});}
  setAttribute(){}focus(){}
  emit(type,extra={}){this.listeners[type]?.({pointerId:1,pointerType:'touch',button:0,clientX:195,clientY:260,timeStamp:0,preventDefault(){},...extra});}
}

// Preserve the actual application actions, frame loop, Match and Stadium.
// Replace only DOM/renderer plumbing and character mesh uploads.
export function mainHarness(mode='advanced',turn=0){
  const object=()=>new THREE.Object3D();
  const geometry=size=>new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(new Float32Array(size),3));
  const s=Object.assign(Object.create(Stadium.prototype),{
    mode:'game',viewWidth:390,viewHeight:844,needsRender:true,netTime:0,cameraAngle:0,
    camera:new THREE.PerspectiveCamera(45,390/844),cameraFocus:new THREE.Vector3(),scene:new THREE.Scene(),reducedMotion:{matches:false},
    keeper:{pose(p){s.drawnKeeper=p;s.poseCalls++;},setColor(...args){s.keeperColor=args;}},poseCalls:0,
    striker:{group:object(),pose(p){s.drawnStriker=p;},kick(runup,after,options){s.drawnKick={runup,after,options};},setColor(...args){s.strikerColor=args;}},
    ball:object(),ballShadow:Object.assign(object(),{material:{}}),ballShadowState:{},
    trail:Object.assign(object(),{geometry:geometry(21)}),trailCount:0,trailBuffer:new Float32Array(21),
    aim:object(),arc:Object.assign(object(),{geometry:geometry(99)}),arcBuffer:new Float32Array(99),
    net:{geometry:geometry(99)},netResets:0,netDirty:false,
    netMotion:{update(array){if(s.netDirty)array[0]=.8;return s.netDirty;},reset(array){s.netResets++;const dirty=s.netDirty;s.netDirty=false;array.fill(0);return dirty;}},
    rain:object(),renderer:{render(){s.draws++;},setDrawingBufferSize(width,height,ratio){s.bufferSize=[width,height,ratio];}},draws:0,
    waitingKeeperPose:keeperPose({reach:80,speed:80},0,0,1),
  });
  const m=new Match(mode,73);m.start(turn);
  const listeners={},windowListeners={},ui=new Map(),storage=new Map();let clock=0,seed=100;
  const context={state:{phase:'ready',match:m,shot:null,turnTime:0,runup:0,dir:0,aim:null},
    paused:false,pointer:null,settings:{mode,touch:2,mouse:2},activeDevice:'touch',autoCalibrate:false,calibration:[],
    frameTime:0,elapsed:0,accumulator:0,saveClock:0,modal:null,modalTrigger:null,STORAGE:'match',storageOk:true,
    Match,Shot,clamp,gestureInput,directionMeter,powerMeter,penaltyStyle,committedKickAim,stage:s,
    document:{hidden:false,addEventListener(type,callback){listeners[type]=callback;},querySelectorAll(){return[];}},
    performance:{now:()=>clock},requestAnimationFrame(){},sound(){},toast(){},icon:()=>'',seed:()=>seed++,
    active:()=>['aim','power','guard','runup','flight'].includes(context.state.phase),
    $:selector=>{if(['#indicator','#timer'].includes(selector))return null;if(!ui.has(selector))ui.set(selector,new Element());return ui.get(selector);},
    localStorage:{getItem:key=>storage.get(key)??null,setItem(key,value){storage.set(key,value);},removeItem(key){storage.delete(key);}},
    window:{addEventListener(type,callback){windowListeners[type]=callback;}},
    sheet(title,body,type){context.modal=type;},
    render(){s.setMode(context.state.phase==='home'?'hero':'game');ui.set('#gesture',new Element());context.bindGesture(ui.get('#gesture'),false);},
  };
  vm.createContext(context);
  vm.runInContext(['read','save','clearSave','transition','closeModal','showPause','shotInput'].map(oneLine).join('\n')+'\n'+actions+'\n'+visibility+'\n'+main.split('\n').filter(line=>line.startsWith("window.addEventListener('blur'")||line.startsWith("window.addEventListener('pagehide'")).join('\n'),context);
  context.render();
  return {context,s,
    click(action,data={}){const button={disabled:false,dataset:{action,...data}};listeners.click({target:{closest:()=>button}});},
    get gesture(){return ui.get('#gesture');},
    tick(dt=1/60){clock+=dt*1000;context.frame(clock);},
    elapse(dt){clock+=dt*1000;},
    get now(){return clock;},
    get saved(){return context.read(context.STORAGE);},
    emitWindow(type){windowListeners[type]?.();},
    hide(hidden){context.document.hidden=hidden;listeners.visibilitychange();},
    resize(width,height){
      s.container={getBoundingClientRect:()=>({width,height})};const previous=globalThis.window;globalThis.window={devicePixelRatio:1};
      try{s.resize();}finally{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
    },
    finish(){const match=context.state.match,aim={x:2.5,y:1,power:.7};const shot=match.shoot(aim,-1);while(!shot.result&&shot.t<30)shot.step(1/120);assert.ok(shot.result);match.record(shot.result);Object.assign(context.state,{phase:'result',shot,aim});context.render();return shot;},
  };
}

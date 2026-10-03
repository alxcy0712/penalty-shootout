import test from 'node:test';
import assert from 'node:assert/strict';
import {mainHarness} from './helpers/main-harness.js';
import {DEFAULT_FULL_TRAVEL_PX} from '../src/calibration.js';

const json=value=>JSON.parse(JSON.stringify(value));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-12,`${a} vs ${b}`);
const fresh=()=>mainHarness('advanced',0,{preferences:{mode:'advanced'}});
function stroke(el,{pointerType='touch',pointerId=1,x=180,y=160,travel=120}={}){
  el.emit('pointerdown',{pointerType,pointerId,clientX:x,clientY:y,timeStamp:0});
  el.emit('pointermove',{pointerType,pointerId,clientX:x,clientY:y-travel,timeStamp:80});
  el.emit('pointerup',{pointerType,pointerId,clientX:x,clientY:y-travel,timeStamp:120});
}
function diagonalStroke(el,travel){
  el.emit('pointerdown',{clientX:180,clientY:160,timeStamp:0});
  el.emit('pointerup',{clientX:200,clientY:160-travel,timeStamp:120});
}
function calibrate(h,device='touch'){
  h.click('calibration');if(device!=='touch')h.click('device',{device});h.click('auto-calibrate');
  const el=h.element('#calibration-pad');el.getBoundingClientRect=()=>({left:0,top:0,width:320,height:185});
  for(let i=0;i<3;i++)stroke(el,{pointerType:device});
  return el;
}

for(const [width,height] of [[320,365],[390,509],[430,597]])test(`real calibration and gameplay handlers agree at ${width}×${height}`,()=>{
  const h=fresh(),{context}=h;
  calibrate(h);
  near(context.calibration.profile.fullTravelPx,139.05882352941177);
  assert.equal(context.settings.devices.touch.fullTravelPx,DEFAULT_FULL_TRAVEL_PX,'completed trial remains a draft');
  assert.equal(h.element('#calibration-message').textContent,'120 像素 · 力度 85%');
  h.click('save-calibrate');h.click('ready');
  h.gesture.getBoundingClientRect=()=>({left:0,top:0,width,height});stroke(h.gesture);
  assert.equal(context.state.phase,'runup');near(context.state.aim.power,.85);
  assert.equal(context.settings.devices.mouse.fullTravelPx,DEFAULT_FULL_TRAVEL_PX);
});

test('switch, reset and close discard drafts; pen saves only the selected device',()=>{
  const h=mainHarness(),before=json(h.context.settings);
  h.click('calibration');h.element('#threshold').emit('input',{target:{value:'160'}});
  assert.deepEqual(json(h.context.settings),before);h.click('device',{device:'pen'});
  assert.equal(h.context.calibration.device,'pen');assert.equal(h.context.settings.devices.touch.unit,'legacy-height');
  stroke(h.element('#calibration-pad'),{pointerType:'touch'});assert.equal(h.context.pointer,null,'a finger cannot silently calibrate the pen tab');
  h.click('reset-calibrate');h.click('close');assert.deepEqual(json(h.context.settings),before);
  calibrate(h,'pen');h.click('save-calibrate');
  assert.equal(h.context.settings.devices.pen.unit,'css-px');near(h.context.settings.devices.pen.fullTravelPx,139.05882352941177);
  assert.deepEqual(json(h.context.settings.devices.touch),before.devices.touch);assert.deepEqual(json(h.context.settings.devices.mouse),before.devices.mouse);
  assert.deepEqual(JSON.parse(h.storage.get('preferences')),json(h.context.settings));
});

test('short play area exposes default reachability limitation and 120px calibration remedies it',()=>{
  const h=fresh();h.gesture.getBoundingClientRect=()=>({left:0,top:0,width:320,height:253});
  h.context.updateCalibrationReachability();
  const warning=h.element('#calibration-reachability');assert.equal(warning.hidden,false);assert.match(warning.innerHTML,/378\.5 像素.*253 像素/);
  calibrate(h);h.click('save-calibrate');h.gesture.getBoundingClientRect=()=>({left:0,top:0,width:320,height:253});
  h.context.updateCalibrationReachability();assert.equal(warning.hidden,true);
  assert.equal(h.context.state.turnTime,0,'pre-round calibration never consumes the turn clock');
});

for(const event of ['pointermove','pointerup'])for(const change of [{top:80},{left:80},{width:350},{height:250}])test(`${event} cancels changed geometry ${JSON.stringify(change)} without a phantom shot`,()=>{
  const h=fresh();h.click('ready');const el=h.gesture;
  el.emit('pointerdown');el.emit('pointermove',{clientY:140,timeStamp:60});assert.ok(h.context.state.aim);
  el.getBoundingClientRect=()=>({left:0,top:0,width:390,height:300,...change});
  el.emit(event,{clientY:140,timeStamp:120});el.emit('pointerup',{clientY:140,timeStamp:140});
  assert.equal(h.context.pointer,null);assert.equal(h.context.state.aim,null);assert.equal(h.context.state.phase,'aim');
  assert.equal(h.element('#power-fill').style.width,'0%');assert.match(h.toasts.at(-1),/重新划动/);
  stroke(el,{pointerId:2});assert.equal(h.context.state.phase,'runup');
});

test('original stationary screen-coordinate shift reproduction cannot create a shot',()=>{
  const h=fresh();h.click('ready');const el=h.gesture;el.emit('pointerdown');
  el.getBoundingClientRect=()=>({left:0,top:80,width:390,height:300});el.emit('pointerup');
  assert.equal(h.context.state.phase,'aim');assert.equal(h.context.state.aim,null);assert.equal(h.context.state.shot,null);
});

test('window resize invalidates a held pointer even if its element rect has not yet updated',()=>{
  const h=fresh();h.click('ready');const el=h.gesture;el.emit('pointerdown');el.emit('pointermove',{clientY:140});
  h.emitWindow('resize');assert.equal(h.context.pointer,null);assert.equal(h.context.state.aim,null);assert.equal(el.captures.size,0);
  el.emit('pointerup',{clientY:140});assert.equal(h.context.state.phase,'aim');stroke(el,{pointerId:2});assert.equal(h.context.state.phase,'runup');
});

test('active gesture keeps the device profile it owned on pointerdown',()=>{
  const h=fresh();h.click('ready');const el=h.gesture;el.emit('pointerdown');
  h.context.settings.devices.touch.fullTravelPx=150;h.context.activeDevice='pen';
  el.emit('pointerup',{clientY:140,timeStamp:120});near(h.context.state.aim.power,108/(DEFAULT_FULL_TRAVEL_PX-12));
});

for(const [travel,percent] of [[18,33],[1600,100]])test(`bounded ${travel}px calibration reports measured power instead of promising 85%`,()=>{
  const h=fresh();h.click('calibration');h.click('auto-calibrate');
  for(let i=0;i<3;i++)stroke(h.element('#calibration-pad'),{travel});
  assert.match(h.element('#calibration-note').textContent,new RegExp(`可调范围.*${percent}%`));
  assert.doesNotMatch(h.element('#calibration-note').textContent,/85%/);
});

for(const travel of [12,13,14,15,16,17])test(`${travel}px upward diagonal does not count as an automatic calibration sample`,()=>{
  const h=fresh();h.click('calibration');h.click('auto-calibrate');
  const before=json(h.context.calibration.profile);
  for(let i=0;i<3;i++)diagonalStroke(h.element('#calibration-pad'),travel);
  assert.equal(h.context.calibration.samples.length,0);
  assert.equal(h.context.calibration.automatic,true);
  assert.deepEqual(json(h.context.calibration.profile),before);
  assert.match(h.element('#calibration-note').textContent,/至少 18 像素.*0\/3/);
});

test('mixed valid and short diagonal strokes use only three valid upward samples',()=>{
  const h=fresh();h.click('calibration');h.click('auto-calibrate');const el=h.element('#calibration-pad');
  stroke(el,{travel:120});diagonalStroke(el,13);
  assert.deepEqual(json(h.context.calibration.samples),[120]);
  stroke(el,{travel:140});diagonalStroke(el,17);
  assert.deepEqual(json(h.context.calibration.samples),[120,140]);
  stroke(el,{travel:130});assert.equal(h.context.calibration.automatic,false);
  near(h.context.calibration.profile.fullTravelPx,12+(130-12)/.85);
});

test('saving or cancelling after invalid samples keeps finite, uncorrupted settings',()=>{
  for(const action of ['save-calibrate','close']){
    const h=fresh(),before=json(h.context.settings);h.click('calibration');h.click('auto-calibrate');
    for(let i=0;i<3;i++)diagonalStroke(h.element('#calibration-pad'),13);
    h.click(action);assert.equal(h.context.calibration,null);assert.deepEqual(json(h.context.settings),before);
    if(action==='close')assert.equal(h.storage.has('preferences'),false);
    else assert.deepEqual(JSON.parse(h.storage.get('preferences')),before);
  }
});

test('failed profile derivation preserves both the previous draft and completed samples',()=>{
  const h=fresh();h.click('calibration');h.click('auto-calibrate');const el=h.element('#calibration-pad');
  stroke(el,{travel:120});stroke(el,{travel:140});const before=json(h.context.calibration);
  h.context.calibratedProfile=()=>null;stroke(el,{travel:130});
  assert.deepEqual(json(h.context.calibration),before);
  assert.match(h.element('#calibration-note').textContent,/原设置保持不变/);
});

for(const interruption of ['blur','hidden'])test(`${interruption} retires calibration pointer and preserves its draft and completed samples`,()=>{
  const h=fresh();h.click('calibration');h.click('auto-calibrate');const el=h.element('#calibration-pad');
  stroke(el);const before=json(h.context.calibration),stateBefore=json(h.context.state),paused=h.context.paused;
  el.emit('pointerdown');el.emit('pointermove',{clientY:140,timeStamp:60});assert.ok(h.context.pointer);
  if(interruption==='blur')h.emitWindow('blur');else h.hide(true);
  assert.equal(h.context.pointer,null);assert.equal(el.captures.size,0);assert.equal(h.context.paused,paused);
  assert.deepEqual(json(h.context.calibration),before);assert.deepEqual(json(h.context.state),stateBefore);
  if(interruption==='hidden')h.hide(false);
  el.emit('pointerup',{clientY:140,timeStamp:120});assert.deepEqual(json(h.context.calibration),before);
  stroke(el,{pointerId:2,travel:130});assert.equal(h.context.calibration.samples.length,2);
});

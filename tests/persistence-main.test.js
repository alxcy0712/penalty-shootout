import test from 'node:test';
import assert from 'node:assert/strict';
import {mainHarness} from './helpers/main-harness.js';

const json=value=>JSON.parse(JSON.stringify(value));
const fail=()=>{throw new Error('QuotaExceededError');};

test('main pause and exit disclose a failed write; successful retry restores truthful status',()=>{
  const h=mainHarness(),{context}=h,setItem=context.localStorage.setItem;
  context.localStorage.setItem=fail;h.click('pause');
  assert.equal(context.persistence.match.status.write.ok,false);
  assert.match(context.sheetContent,/仅在本页保留/);assert.doesNotMatch(context.sheetContent,/已保存|已经保留/);
  assert.equal(h.element('#persistence-status').hidden,false);
  h.click('exit-confirm');assert.match(context.sheetContent,/关闭或刷新页面可能丢失/);
  context.localStorage.setItem=setItem;h.click('close');h.click('pause');
  assert.equal(context.persistence.match.status.write.ok,true);assert.match(context.sheetContent,/进度已保存/);
  assert.equal(h.element('#persistence-status').hidden,true);
});

test('settings and match failures remain independent through reads and successful writes',()=>{
  const h=mainHarness(),{context}=h,setItem=context.localStorage.setItem;
  context.localStorage.setItem=(key,value)=>key==='preferences'?fail():setItem(key,value);
  assert.equal(context.storeSettings().ok,false);assert.equal(context.save().ok,true);
  context.read('preferences');context.updatePersistenceFeedback();
  assert.match(h.element('#persistence-status').textContent,/设置未保存/);
  context.localStorage.setItem=(key,value)=>key==='match'?fail():setItem(key,value);
  assert.equal(context.save().ok,false);assert.equal(context.storeSettings().ok,true);
  context.read('match');context.updatePersistenceFeedback();
  assert.match(h.element('#persistence-status').textContent,/进度仅在本页/);
});

test('failed flight save → Home → resume preserves exact current physical state in this page',()=>{
  const h=mainHarness(),{context}=h;h.click('ready');
  h.gesture.emit('pointerdown');h.gesture.emit('pointerup',{clientX:250,clientY:120,timeStamp:100});
  while(context.state.phase==='runup')h.tick(.1);
  h.tick(.05);const before=json(context.state),shot=context.state.shot,match=context.state.match;
  context.localStorage.setItem=fail;h.click('home');h.click('home');
  assert.equal(context.state.phase,'home');assert.equal(context.pageResumeState.shot,shot);
  h.click('resume-save');assert.deepEqual(json(context.state),before);assert.notEqual(context.state.shot,shot);assert.notEqual(context.state.match,match);
  assert.equal(context.paused,true);assert.match(context.sheetContent,/仅在本页保留/);
});

test('only an unserializable latest live state uses the explicitly page-only identity fallback',()=>{
  const h=mainHarness(),{context}=h;
  context.state.pageOnly=context.state;
  const original=context.state,match=context.state.match;
  h.click('home');assert.equal(context.persistence.match.status.write.status,'serialize-failed');
  assert.equal(h.storage.has('match'),false);h.click('resume-save');
  assert.equal(context.state,original);assert.equal(context.state.match,match);
  assert.equal(context.state.pageOnly,original);assert.equal(context.state.phase,'ready');
  assert.match(h.element('#persistence-status').textContent,/进度仅在本页/);
});

test('unfinished replacement needs one explicit confirmation; cancel and stale confirm preserve bytes',()=>{
  const h=mainHarness(),{context}=h;context.save();h.click('home');const before=h.storage.get('match'),old=context.state.match;
  h.click('new');assert.equal(context.modal,'replace-save');assert.equal(h.storage.get('match'),before);
  h.click('close');h.click('confirm-new');assert.equal(h.storage.get('match'),before);assert.equal(context.state.match,old);
  h.click('new');h.click('confirm-new');const replacement=context.state.match,replaced=h.storage.get('match');
  assert.notEqual(replacement,old);assert.notEqual(replaced,before);h.click('confirm-new');
  assert.equal(context.state.match,replacement);assert.equal(h.storage.get('match'),replaced);
});

for(const value of ['{bad JSON',JSON.stringify({version:90,state:{future:true}}),JSON.stringify({version:1,state:{}})])test(`unreadable or unsupported save is kept through restore/new/cancel: ${value}`,()=>{
  const h=mainHarness('advanced',0,{storage:[['match',value]]}),{context}=h;
  context.state.phase='home';h.click('resume-save');assert.equal(context.state.phase,'home');assert.equal(h.storage.get('match'),value);
  h.click('new');assert.equal(context.modal,'replace-save');assert.match(context.sheetContent,/无法确认原进度/);
  h.click('close');assert.equal(h.storage.get('match'),value);
});

test('unavailable storage requires replacement warning while fresh missing storage does not',()=>{
  const h=mainHarness();h.context.localStorage.getItem=fail;h.click('new');assert.equal(h.context.modal,'replace-save');
  assert.match(h.context.sheetContent,/无法确认原进度/);
  const fresh=mainHarness();fresh.click('new');assert.equal(fresh.context.state.phase,'lineup');assert.equal(fresh.context.modal,null);
});

test('future preferences are never overwritten by automatic mode/sound or calibration writes',()=>{
  const raw={version:9,mode:'advanced',devices:{future:{secret:1}}},text=JSON.stringify(raw);
  const h=mainHarness('advanced',0,{preferences:raw,storage:[['preferences',text]]}),{context}=h;
  context.settings.mode='simple';assert.equal(context.storeSettings().status,'unsupported');assert.equal(h.storage.get('preferences'),text);
  h.click('calibration');assert.match(context.sheetContent,/无法识别这些设置/);h.click('reset-calibrate');h.click('save-calibrate');
  assert.equal(h.storage.get('preferences'),text);assert.match(h.toasts.at(-1),/仅在本页生效/);
});

test('successful explicit replacement clears a prior corrupt-read banner',()=>{
  const h=mainHarness('advanced',0,{storage:[['match','{bad JSON']]});
  h.context.read('match');h.context.updatePersistenceFeedback();assert.equal(h.element('#persistence-status').hidden,false);
  h.click('new');h.click('confirm-new');
  assert.equal(h.context.persistence.match.status.read.status,'corrupt','operation outcomes remain independent');
  assert.equal(h.context.persistence.match.status.write.ok,true);
  assert.equal(h.element('#persistence-status').hidden,true,'successful replacement resolves the visible match problem');
});

test('successful settings retry resolves only its own warning',()=>{
  const h=mainHarness(),write=h.context.localStorage.setItem;
  h.context.localStorage.setItem=fail;h.context.storeSettings();
  assert.equal(h.element('#persistence-status').hidden,false);
  h.context.localStorage.setItem=write;h.context.storeSettings();
  assert.equal(h.element('#persistence-status').hidden,true);
});

test('a future per-device version is also preserved instead of silently migrated',()=>{
  const raw={version:2,devices:{pen:{version:8,unit:'future',calibration:[1,2,3]}}},text=JSON.stringify(raw);
  const h=mainHarness('advanced',0,{preferences:raw,storage:[['preferences',text]]});
  assert.equal(h.context.storeSettings().status,'unsupported');assert.equal(h.storage.get('preferences'),text);
});

test('malformed optional flight state cannot resume or overwrite the archived bytes',()=>{
  const source=mainHarness();source.click('ready');
  source.gesture.emit('pointerdown');source.gesture.emit('pointerup',{clientY:120,timeStamp:100});
  while(source.context.state.phase==='runup')source.tick(.1);
  const state=json(source.context.state);state.shot.footStep={};
  const value=JSON.stringify({version:1,state});
  const h=mainHarness('advanced',0,{storage:[['match',value]]});h.context.state.phase='home';
  h.click('resume-save');
  assert.equal(h.context.state.phase,'home');assert.equal(h.storage.get('match'),value);
  assert.equal(h.context.persistence.match.status.write,null);assert.doesNotThrow(()=>h.tick());
});

function savedFlightFixture(){
  const source=mainHarness();source.click('ready');
  source.gesture.emit('pointerdown');source.gesture.emit('pointerup',{clientY:120,timeStamp:100});
  while(source.context.state.phase==='runup')source.tick(.1);
  return {version:1,state:json(source.context.state)};
}

const unsafeSaveFields=[
  {path:['state','match'],key:'next',value:null},
  {path:['state','match'],key:'shoot',value:null},
  {path:['state','shot'],key:'step',value:null},
  {path:['state','shot'],key:'dive',value:null},
  {path:['state','shot'],key:'poseAt',value:null},
  ...[[],['state'],['state','match'],['state','shot'],['state','match','teams',0,'players',0],['state','shot','aim']]
    .flatMap(path=>['__proto__','constructor','prototype'].map(key=>({path,key,value:{unexpected:'data'}}))),
];

for(const {path,key,value} of unsafeSaveFields)test(`fresh disk save cannot restore assignment key ${[...path,key].join('.')}`,()=>{
  const raw=savedFlightFixture();
  const target=path.reduce((object,part)=>object[part],raw);
  // Define an own JSON property, avoiding the JavaScript __proto__ setter.
  Object.defineProperty(target,key,{value,enumerable:true,configurable:true,writable:true});
  const bytes=JSON.stringify(raw);
  const h=mainHarness('advanced',0,{storage:[['match',bytes]]}),{context}=h;
  context.state.phase='home';
  const previousState=context.state,previousMatch=context.state.match;
  let restored=0;
  context.Match={restore(){restored++;throw new Error('Unsafe Match.restore must not run');}};
  context.Shot={restore(){restored++;throw new Error('Unsafe Shot.restore must not run');}};
  assert.equal(context.persistence.match.readSession().status,'missing');
  h.click('resume-save');
  assert.equal(restored,0,'reject the raw payload before engine callbacks');
  assert.equal(context.state,previousState);assert.equal(context.state.match,previousMatch);
  assert.equal(context.state.phase,'home');assert.equal(context.paused,false);
  assert.equal(context.persistence.match.status.write,null);
  assert.equal(context.persistence.match.readSession().status,'missing');
  assert.equal(h.storage.get('match'),bytes);assert.doesNotThrow(()=>h.tick());
  assert.equal(h.storage.get('match'),bytes,'the next frame cannot overwrite an unresumed save');
});

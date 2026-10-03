import test from 'node:test';
import assert from 'node:assert/strict';
import {mainHarness} from './helpers/main-harness.js';

const schedules={
  '30 Hz':[1/30],
  '60 Hz':[1/60],
  '120 Hz':[1/120],
  'irregular RAF':[1/120,.041,1/60,.083,.012,.027],
};
const json=value=>JSON.parse(JSON.stringify(value));
const near=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<1e-9,`${message}: ${actual} versus ${expected}`);
function hold(h,id=7){
  const el=h.gesture;
  el.emit('pointerdown',{pointerId:id,timeStamp:h.now});
  el.emit('pointermove',{pointerId:id,clientX:260,clientY:100,timeStamp:h.now+60});
  return el;
}
function release(h,el=h.gesture,id=7){
  el.emit('pointerup',{pointerId:id,clientX:260,clientY:100,timeStamp:h.now+120});
}

// Actual application handlers, Match/Shot and Stadium; controlled DOM and RAF.
// Changing the bounds below models layout updates, not a browser's rotation API.
for(const [label,schedule] of Object.entries(schedules)){
  test(`${label}: a defending touch owns direction while another touch or mouse is active`,()=>{
    const h=mainHarness('advanced',1),{context}=h;h.click('ready');h.tick(schedule[0]);
    const el=h.gesture;
    el.emit('pointerdown',{pointerId:7,timeStamp:h.now});
    el.emit('pointermove',{pointerId:7,clientX:120,timeStamp:h.now+20});
    assert.equal(context.state.dir,1);
    const owner=context.pointer;
    for(const pointerType of ['touch','mouse','pen']){
      el.emit('pointerdown',{pointerId:9,pointerType,clientX:320});
      el.emit('pointermove',{pointerId:9,pointerType,clientX:350});
      el.emit('pointerup',{pointerId:9,pointerType,clientX:350});
      el.emit('pointercancel',{pointerId:9,pointerType});
      assert.equal(context.pointer,owner);assert.equal(context.state.dir,1);
      assert.equal(context.activeDevice,'touch','an ignored device cannot change the active touch calibration');
    }
    el.emit('pointermove',{pointerId:7,clientX:100,timeStamp:h.now+40});
    assert.equal(context.state.dir,1,'continued movement in one direction does not toggle back to center');
    el.emit('pointermove',{pointerId:7,clientX:310,timeStamp:h.now+60});
    assert.equal(context.state.dir,-1,'the owning finger can reverse its pre-shot choice');
    el.emit('pointerup',{pointerId:7,clientX:310,timeStamp:h.now+80});
    assert.equal(context.pointer,null);assert.equal(context.state.dir,-1);
    let frame=0;while(context.state.phase==='guard'&&frame<500)h.tick(schedule[frame++%schedule.length]);
    assert.equal(context.state.phase,'flight');assert.equal(context.state.shot.direction,-1);
    const shot=context.state.shot,before=json(shot);
    el.emit('pointermove',{pointerId:7,clientX:80});el.emit('pointerup',{pointerId:7,clientX:80});
    assert.equal(context.state.shot,shot);assert.deepEqual(json(shot),before,'retired guard handlers do not change a committed dive');
  });

  test(`${label}: portrait and landscape bounds can change during a held touch without committing`,()=>{
    const h=mainHarness(),{context,s}=h;h.click('ready');const el=hold(h),owner=context.pointer;
    for(const [index,[width,height,left,top]] of [[844,390,32,15],[320,900,8,30],[390,844,0,0]].entries()){
      h.resize(width,height);
      const rect={left,top,width:Math.min(width,500),height:Math.min(height,300)};
      el.getBoundingClientRect=()=>rect;
      el.emit('pointermove',{pointerId:7,clientX:left+rect.width*.64,clientY:top+rect.height*.32,timeStamp:h.now+20});
      h.tick(schedule[index%schedule.length]);
      assert.equal(context.pointer,owner);assert.equal(context.state.phase,'aim');
      assert.equal(context.state.shot,null);assert.equal(s.currentShot,null);assert.equal(s.drawnKick.runup,0);
      assert.ok(context.state.aim);assert.ok(Number.isFinite(context.state.aim.x));
      assert.ok(context.state.aim.power>=0&&context.state.aim.power<=1);
      assert.equal(s.camera.aspect,width/height);assert.deepEqual(s.bufferSize,[width,height,1]);
      assert.ok(s.camera.projectionMatrix.elements.every(Number.isFinite));
    }
    release(h,el);assert.equal(context.state.phase,'runup');assert.equal(context.pointer,null);
    const committed=json(context.state.aim);
    el.emit('pointerup',{pointerId:7,clientX:10,clientY:10});
    h.tick(schedule[0]);assert.ok(s.drawnKick.runup>0);assert.deepEqual(json(context.state.aim),committed);
  });

  test(`${label}: hidden pause rejects extra fingers and resumes a fresh drag after the old release`,()=>{
    for(const turn of [0,1]){
      const h=mainHarness('advanced',turn),{context,s}=h;h.click('ready');h.tick(schedule[0]);
      const el=hold(h),before=json(context.state),elapsed=context.elapsed;
      h.hide(true);assert.equal(context.paused,true);assert.equal(context.pointer,null);
      h.elapse(90);h.hide(false);
      for(const pointerId of [7,8]){
        el.emit('pointerdown',{pointerId});el.emit('pointermove',{pointerId,clientX:80,clientY:40});
        el.emit('pointerup',{pointerId,clientX:80,clientY:40});el.emit('lostpointercapture',{pointerId});
      }
      assert.deepEqual(json(context.state),before);assert.equal(context.elapsed,elapsed);
      h.click('close');h.tick(schedule[0]);
      assert.equal(context.state.phase,turn?'guard':'aim');
      near(context.state.turnTime,before.turnTime+schedule[0],'only the next visible frame consumes input time');
      if(!turn)assert.equal(s.drawnKick.runup,0);
      // Old pointer 7 has ended before pointer 8 begins on the same element.
      hold(h,8);assert.equal(context.pointer.id,8);release(h,el,8);
      assert.equal(context.pointer,null);assert.equal(context.state.phase,turn?'guard':'runup');
      assert.equal(context.state.shot,null);
    }
  });
}

for(const mode of ['simple','advanced'])test(`held touch → Home → ${mode} game isolates retired handlers even when the pointer ID is reused`,()=>{
  const h=mainHarness(),{context,s}=h;h.click('ready');const retired=hold(h);
  h.click('home');h.tick();assert.equal(context.pointer,null);assert.equal(s.mode,'hero');
  // Preference storage is outside this harness. Keep the real mode action and
  // render while replacing only its unrelated storage side effect.
  context.storeSettings=()=>{};h.click('mode',{mode});h.click('new');
  if(mode==='advanced')h.click('coin');
  h.click('first',{first:'0'});h.click('ready');h.tick();
  const current=h.gesture;assert.notEqual(current,retired);assert.equal(context.state.match.mode,mode);
  if(mode==='advanced')hold(h);
  const owner=context.pointer,before=json(context.state);
  for(const event of ['pointermove','pointerup','pointercancel','lostpointercapture'])retired.emit(event,{pointerId:7,clientX:70,clientY:20,timeStamp:h.now});
  assert.equal(context.pointer,owner);assert.deepEqual(json(context.state),before);
  assert.equal(s.currentShot,null);assert.equal(s.drawnKick.runup,0);
  if(mode==='advanced')release(h,current);
  else{current.emit('pointerdown',{pointerId:7});release(h,current);assert.equal(context.state.phase,'aim');h.click('lock');h.click('shoot');}
  assert.equal(context.state.phase,'runup');assert.equal(context.pointer,null);
  assert.equal(context.state.match.serial,1);assert.deepEqual(json(context.state.match.teams.map(team=>team.kicks)),[[],[]]);
});

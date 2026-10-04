// Supplemental real-main event probe, separate from the authoritative release
// gates. Node callback plumbing only; not a native-browser scheduler test.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {mainHarness} from '../tests/helpers/main-harness.js';
const h=mainHarness('advanced');let scheduled=0,ticks=0;
h.context.requestAnimationFrame=()=>scheduled++;
const tick=()=>{const before=scheduled;h.tick(1/120);ticks++;assert.equal(scheduled,before+1);};
h.click('ready');
for(let cycle=0;cycle<50;cycle++){
  const start=scheduled;h.s.renderer.domElement.emit('webglcontextlost');h.s.renderer.domElement.emit('webglcontextlost');assert.equal(scheduled,start);
  tick();const before=scheduled;h.s.renderer.domElement.emit('webglcontextrestored');assert.equal(scheduled,before);
  tick();h.click('graphics-resume');assert.equal(scheduled,before+1);tick();
  h.emitWindow('pagehide');const hidden=scheduled;h.elapse(.5);h.emitWindow('pageshow');assert.equal(scheduled,hidden);h.click('close');tick();
}
const hashes={};
for(const path of ['src/main.js','src/graphics-lifecycle.js','tests/helpers/main-harness.js','docs/reproduce-a2-loop.mjs'])hashes[path]=createHash('sha256').update(await readFile(new URL('../'+path,import.meta.url))).digest('hex');
console.log(JSON.stringify({cycles:50,ticks,scheduled,extraCallbacksFromLifecycleEvents:0,state:h.context.state.phase,hashes,scope:'Actual main handler/RAF functions in Node DOM/renderer harness; no native browser scheduler claim'},null,2));

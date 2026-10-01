import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as Three from 'three';
import * as anatomy from '../src/anatomy.js';
import * as controls from '../src/motion-lab-state.js';
import { KICK_CONTACT } from '../src/game-character.js';
import { Shot } from '../src/engine.js';
import { keeperGather } from '../src/keeper-contact.js';
import { renderPixelRatio, resizeDrawingBuffer } from '../src/rendering.js';

const html = await readFile(new URL('../motion-lab.html', import.meta.url), 'utf8');
const source = await readFile(new URL('../src/motion-lab-runtime.js', import.meta.url), 'utf8');
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.listeners = new Map(); this.children = []; this.style = {}; this.dataset = {}; this.attributes = {}; this.checked = false; this.hidden = false; this._value = ''; this.textContent = ''; this.clientWidth = 390; this.clientHeight = 420; }
  get value() { return this._value; } set value(value) { this._value = String(value); }
  addEventListener(type, callback) { const callbacks = this.listeners.get(type) ?? []; callbacks.push(callback); this.listeners.set(type, callbacks); }
  emit(type, event = {}) { for (const listener of this.listeners.get(type) ?? []) listener({ target: this, ...event }); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  closest(selector) { return selector.split(',').some(tag => tag === this.tagName) ? this : null; }
}
async function setup() {
  const elements = new Map();
  for (const match of html.matchAll(/<([a-z-]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const element = new Element(match[1]); element.hidden = /\bhidden\b/.test(match[0]); element.checked = /\bchecked\b/.test(match[0]);
    element.value = /\bvalue="([^"]*)"/.exec(match[0])?.[1] ?? '';
    elements.set(match[2], element);
  }
  for (const [id, value] of Object.entries({ 'motion-action': 'kick', 'shot-direction': '0', 'keeper-direction': '1', 'shot-power': '.7', 'shot-type': 'normal', 'view-mode': 'front', 'playback-speed': '1' })) elements.get(id).value = value;
  const document = new Element('document'); document.hidden = false;
  document.getElementById = id => { assert.ok(elements.has(id), `DOM has #${id}`); return elements.get(id); };
  document.createElement = tag => new Element(tag);
  const window = new Element('window'); window.devicePixelRatio = 1;
  let clock = 0, frameId = 0; const frames = new Map(), actors = [], renders = [];
  class Character {
    constructor(display, color, keeper) {
      this.group = new Three.Group(); display.add(this.group); this.keeper = keeper;
      this.fallback = { head: new Three.Group() }; this.group.add(this.fallback.head);
      this.ready = Promise.resolve(true); actors.push(this);
    }
    capture(time,index) { this.lastCapture={time,index}; }
    pose(pose) { this.lastPose = pose; this.poseCalls = (this.poseCalls ?? 0) + 1; }
    kick(runup, after, options) { this.lastKick = { runup, after, options }; this.lastPose = options.pose; }
  }
  class Renderer {
    constructor() { this.domElement = new Element('canvas'); }
    setScissorTest() {} setPixelRatio() {} setSize() {} setDrawingBufferSize() {} setScissor() {} dispose() {}
    setViewport(x, y, width, height) { this.viewport = { x, y, width, height }; }
    render(scene, camera) { renders.push({ viewport: this.viewport, aspect: camera.aspect, position: camera.position.clone() }); }
  }
  const context = { ...anatomy, ...controls, THREE: { ...Three, WebGLRenderer: Renderer }, GameCharacter: Character, keeperGather, KICK_CONTACT, Shot, renderPixelRatio, resizeDrawingBuffer,
    document, window, console, structuredClone, ResizeObserver: class { observe() {} disconnect() {} },
    performance: { now: () => clock }, requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; }, cancelAnimationFrame: id => frames.delete(id) };
  vm.runInNewContext(source.replace(/^import .*;\n/gm, ''), context, { filename: 'motion-lab-runtime.js' });
  await Promise.resolve(); await Promise.resolve();
  const render = (time = clock) => {
    clock = time; const entry = frames.entries().next().value;
    assert.ok(entry, 'a render was requested'); frames.delete(entry[0]); entry[1](time);
  };
  render();
  return { elements, document, window, actors, renders, frames, render, get: id => elements.get(id), change(id, value) { const element = elements.get(id); element.value = value; element.emit('change'); }, click(id) { elements.get(id).emit('click'); }, scrub(time) { elements.get('timeline').value = time; elements.get('timeline').emit('input'); }, key(key, options = {}) { const event = { key, code: key === ' ' ? 'Space' : key, target: elements.get('render-stage'), preventDefault() { this.prevented = true; }, ...options }; document.emit('keydown', event); return event; } };
}

test('inspector has labelled controls, all existing actions, and no absolute page header', async () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'unique control IDs');
  for (const match of html.matchAll(/<select id="([^"]+)"/g)) assert.ok(html.includes(`for="${match[1]}"`), `${match[1]} is labelled`);
  for (const action of ['kick', 'runup0', 'runup1', 'runup2', 'runup3', 'dive', 'hesitate', 'stretch', 'low', 'prepare', 'tracking', 'recover', 'hold', 'warmup', 'center', 'center-low', 'gather', 'set', 'capture0', 'capture1']) assert.ok(html.includes(`value="${action}"`));
  assert.ok(source.includes("from './game-character.js'"));
  assert.ok(source.includes('shotType: shotType.value, pose: p'));
  const css = await readFile(new URL('../src/motion-lab-inspector.css', import.meta.url), 'utf8');
  assert.ok(css.includes('@media(max-width:470px)'));
  assert.ok(css.includes('@media(max-height:560px) and (min-width:620px)'));
  assert.ok(css.includes('height:calc(100svh - 58px);min-height:0'), 'short landscape resets desktop height floor');
  assert.ok(css.includes('grid-template-columns:minmax(0,1fr)'));
  assert.ok(!/\.app-header\{[^}]*position:absolute/.test(css));
});
test('play, pause, contact, frame navigation, replay end, and loop work through UI handlers', async () => {
  const ui = await setup();
  assert.equal(ui.get('play-pause').attributes['aria-pressed'], 'false');
  ui.click('contact-jump'); ui.render(); assert.equal(Number(ui.get('timeline').value), KICK_CONTACT);
  ui.click('next-frame'); ui.render(); assert.equal(Number(ui.get('timeline').value), 111 / 60);
  ui.click('previous-frame'); ui.render(); assert.equal(Number(ui.get('timeline').value), 110 / 60);
  ui.click('play-pause'); ui.render(1000); ui.render(1500);
  assert.equal(Number(ui.get('timeline').value), 110 / 60 + 1.5);
  ui.click('play-pause'); ui.render(3000); assert.equal(ui.get('play-pause').attributes['aria-pressed'], 'false');
  ui.scrub(3.95); ui.render(3000); ui.click('play-pause'); ui.render(3200);
  assert.ok(Math.abs(Number(ui.get('timeline').value) - .15) < 1e-6, 'loop keeps the overrun');
  ui.get('loop-playback').checked = false; ui.get('loop-playback').emit('change');
  ui.scrub(3.95); ui.render(3200); ui.click('play-pause'); ui.render(3400);
  assert.equal(Number(ui.get('timeline').value), 4); assert.equal(ui.get('play-pause').textContent, '播放');
  ui.click('play-pause'); ui.render(3400); assert.equal(Number(ui.get('timeline').value), 0);
});
test('all action endpoints, keeper directions, shot types, and shared kick options render in the controller', async () => {
  const ui = await setup();
  for (const action of ['kick', 'runup0', 'runup1', 'runup2', 'runup3', 'dive', 'hesitate', 'stretch', 'low', 'prepare', 'tracking', 'recover', 'hold', 'warmup', 'center', 'center-low', 'gather', 'set', 'capture0', 'capture1']) {
    ui.change('motion-action', action); ui.render();
    assert.equal(ui.get('contact-jump').hidden, !action.startsWith('runup') && action !== 'kick');
    for (const direction of [-1, 1]) {
      ui.change('keeper-direction', direction);
      for (const time of [0, .1, .55, 1.85, Number(ui.get('timeline').max)]) { ui.scrub(time); ui.render(); }
    }
  }
  ui.change('motion-action', 'kick'); ui.change('shot-power', 1); ui.change('shot-direction', -3.5); ui.change('shot-type', 'chip'); ui.click('contact-jump'); ui.render();
  for (const actor of ui.actors.filter(actor => !actor.keeper)) {
    assert.equal(actor.lastKick.options.power, 1); assert.equal(actor.lastKick.options.targetX, -3.5); assert.equal(actor.lastKick.options.shotType, 'chip');
    assert.ok(actor.lastKick.options.pose); assert.equal(actor.poseCalls, undefined, 'striker avoids redundant procedural posing');
  }
});
test('portrait split views, overlays, close-up, reset, and keyboard preserve control semantics', async () => {
  const ui = await setup();
  ui.change('view-mode', 'split'); ui.get('skeleton').checked = true; ui.get('skeleton').emit('change'); ui.render();
  assert.equal(ui.renders.at(-1).viewport.y, 0); assert.equal(ui.renders.at(-2).viewport.y, 210);
  assert.equal(ui.get('viewport-labels').children.length, 3);
  ui.get('face-view').checked = true; ui.get('face-view').emit('change'); ui.get('view-zoom').value = 1.8; ui.get('view-zoom').emit('input'); ui.render();
  assert.ok(ui.get('view-label').textContent.includes('面部')); assert.equal(ui.get('zoom-output').textContent, '180%');
  ui.click('reset-view'); ui.render(); assert.equal(ui.get('view-mode').value, 'front'); assert.equal(ui.get('face-view').checked, false); assert.equal(ui.get('view-zoom').value, '1');
  ui.key('k'); ui.render(); assert.equal(Number(ui.get('timeline').value), KICK_CONTACT);
  ui.key('ArrowRight', { shiftKey: true }); ui.render(); assert.equal(Number(ui.get('timeline').value), 120 / 60);
  ui.key('Home'); ui.render(); assert.equal(Number(ui.get('timeline').value), 0);
  ui.key('End', { target: ui.get('timeline') }); assert.equal(Number(ui.get('timeline').value), 0, 'range retains native keyboard semantics');
});
test('hidden tabs and back-forward cache resume without consuming background time', async () => {
  const ui = await setup(); ui.click('play-pause'); ui.render(100); ui.render(500);
  const before = Number(ui.get('timeline').value);
  ui.document.hidden = true; ui.document.emit('visibilitychange'); assert.equal(ui.frames.size, 0);
  ui.document.hidden = false; ui.document.emit('visibilitychange'); ui.render(100000);
  assert.equal(Number(ui.get('timeline').value), before);
  ui.window.emit('pagehide', { persisted: true }); assert.equal(ui.frames.size, 0);
  ui.window.emit('pageshow'); ui.render(200000); assert.equal(Number(ui.get('timeline').value), before);
});

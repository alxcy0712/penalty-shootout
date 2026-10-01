import test from 'node:test';
import assert from 'node:assert/strict';
import { advancePlayback, stepFrame, motionInfo, viewportLayout, frameDistance } from '../src/motion-lab-state.js';
import { KICK_CONTACT } from '../src/game-character.js';
import { penaltyStyles, HOLD_DURATION } from '../src/anatomy.js';

const playback = (overrides = {}) => ({ time: 0, duration: 4, playing: true, speed: 1, loop: false, ...overrides });
test('motion lab playback preserves slow frames and stops exactly at the end', () => {
  assert.deepEqual(advancePlayback(playback(), 2.17), { time: 2.17, playing: true });
  assert.deepEqual(advancePlayback(playback({ time: 3.9 }), .2), { time: 4, playing: false });
  assert.deepEqual(advancePlayback(playback({ playing: false, time: 2 }), 100), { time: 2, playing: false });
  assert.deepEqual(advancePlayback(playback({ speed: .25 }), 2), { time: .5, playing: true });
});
test('motion lab looping preserves overrun even across multiple complete loops', () => {
  const wrapped = advancePlayback(playback({ time: 3.9, loop: true }), .2);
  assert.ok(Math.abs(wrapped.time - .1) < 1e-12); assert.equal(wrapped.playing, true);
  assert.deepEqual(advancePlayback(playback({ loop: true }), 12), { time: 0, playing: true });
  assert.deepEqual(advancePlayback(playback({ time: 1.25, loop: true }), 13), { time: 2.25, playing: true });
});
test('frame stepping reaches adjacent frame boundaries without sticking or overshooting', () => {
  assert.equal(stepFrame(0, -1, 4), 0);
  assert.equal(stepFrame(4, 1, 4), 4);
  assert.equal(stepFrame(1 / 60, 1, 4), 2 / 60);
  assert.equal(stepFrame(2 / 60, -1, 4), 1 / 60);
  assert.equal(stepFrame(.025, 1, 4), 2 / 60);
  assert.equal(stepFrame(.025, -1, 4), 1 / 60);
  assert.equal(stepFrame(1.85, -1, 4), 110 / 60);
  assert.equal(stepFrame(1.85, 1, 4), 112 / 60);
  assert.equal(stepFrame(1.85, 1, 4, 10), 121 / 60);
  let time = 0;
  for (let i = 0; i < 240; i++) time = stepFrame(time, 1, 4);
  assert.equal(time, 4);
  for (let i = 0; i < 240; i++) time = stepFrame(time, -1, 4);
  assert.equal(time, 0);
});
test('contact navigation uses actual shared animation constants and each runup duration', () => {
  for (const [action, expected] of [['kick', KICK_CONTACT], ...penaltyStyles.map((style, i) => [`runup${i}`, style.duration])]) {
    const info = motionInfo(action, KICK_CONTACT, penaltyStyles.map(style => style.duration), HOLD_DURATION);
    assert.equal(info.striker, true); assert.equal(info.contact, expected);
    assert.equal(info.markers.find(marker => marker.contact).time, expected);
    assert.ok(info.markers.every(marker => marker.time >= 0 && marker.time <= info.duration));
  }
});
test('all keeper actions have meaningful in-bounds phase navigation without a false contact label', () => {
  for (const action of ['dive', 'hesitate', 'stretch', 'low', 'prepare', 'tracking', 'recover', 'hold', 'warmup', 'center', 'center-low', 'gather']) {
    const info = motionInfo(action, KICK_CONTACT, penaltyStyles.map(style => style.duration), HOLD_DURATION);
    assert.equal(info.striker, false); assert.equal(info.contact, null);
    assert.ok(info.markers.every(marker => marker.time >= 0 && marker.time <= info.duration && !marker.contact));
    assert.equal(info.duration, action === 'warmup' ? 12 : action === 'tracking' ? 6 : 4);
  }
});
test('single/split viewports fill their stage without overlap at desktop and phone sizes', () => {
  for (const [width, height] of [[1200, 600], [390, 480], [375, 301], [300, 650], [1, 1]]) {
    assert.deepEqual(viewportLayout(width, height, false), [{ x: 0, y: 0, width, height, side: false }]);
    const [a, b] = viewportLayout(width, height, true);
    assert.equal(a.width * a.height + b.width * b.height, width * height);
    assert.ok(a.x + a.width <= width && b.x + b.width <= width);
    assert.ok(a.y + a.height <= height && b.y + b.height <= height);
    assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
  }
  assert.ok(viewportLayout(390, 480, true)[0].y > 0, 'portrait split is stacked');
  assert.ok(viewportLayout(1200, 600, true)[1].x > 0, 'landscape split is side by side');
});
test('camera fit keeps full body and outstretched arms within narrow and wide viewports', () => {
  for (const aspect of [.4, .8, 1, 2.5]) for (const [width, height, depth] of [[1.4, 2.15, .6], [3.5, 1.4, .8], [.4, .48, .28]]) {
    const distance = frameDistance(width, height, depth, aspect, 35);
    const halfHeight = (distance - depth / 2) * Math.tan(35 * Math.PI / 360);
    assert.ok(halfHeight * 2 > height);
    assert.ok(halfHeight * aspect * 2 > width);
    assert.equal(frameDistance(width, height, depth, aspect, 35, 2), distance / 2);
  }
});

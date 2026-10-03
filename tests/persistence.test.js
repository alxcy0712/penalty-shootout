import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPersistence, serializeMatchSave, inspectMatchSave, restoreMatchSave} from '../src/persistence.js';
import {Match, Shot} from '../src/engine.js';

const json = value => JSON.parse(JSON.stringify(value));
function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  const calls = [];
  return {
    data, calls,
    getItem(key) { calls.push(['get', key]); return data.get(key) ?? null; },
    setItem(key, value) { calls.push(['set', key]); data.set(key, value); },
    removeItem(key) { calls.push(['remove', key]); data.delete(key); },
  };
}
const persistence = storage => createPersistence({getStorage: () => storage, matchKey: 'match', preferencesKey: 'preferences'});
function savedState(mode = 'advanced', phase = 'ready') {
  const match = new Match(mode, 73);
  match.aiFirst = match.rng.int(0, 1);
  if (!['lineup', 'coin'].includes(phase)) match.start(0);
  const state = {phase, match, shot: null, turnTime: 0, lockedX: 0, dir: 0, runup: 0, aim: null};
  if (['runup', 'flight', 'result', 'finish'].includes(phase)) state.aim = {x: 2.5, power: .72};
  if (['flight', 'result', 'finish'].includes(phase)) {
    state.shot = match.shoot(state.aim, -1);
    if (phase === 'flight') for (let i = 0; i < 20; i++) state.shot.step(1 / 120);
    else {
      while (!state.shot.result && state.shot.t < 30) state.shot.step(1 / 120);
      assert.ok(state.shot.result);
      match.record(state.shot.result);
      if (phase === 'finish') match.winner = 0;
    }
  }
  return state;
}
const restore = value => restoreMatchSave(value, {restoreMatch: raw => Match.restore(raw), restoreShot: raw => Shot.restore(raw)});

test('storage access is lazy; denied storage getters and absent storage are structured failures', () => {
  let calls = 0;
  const denied = createPersistence({getStorage() { calls++; throw new DOMException('denied', 'SecurityError'); }});
  assert.equal(calls, 0);
  for (const channel of [denied.match, denied.preferences]) {
    for (const operation of ['read', 'write', 'remove']) {
      const outcome = channel[operation]({example: true});
      assert.equal(outcome.ok, false);
      assert.equal(outcome.status, 'unavailable');
      assert.equal(outcome.error.name, 'SecurityError');
    }
  }
  for (const missing of [null, undefined, {}]) {
    const p = persistence(missing);
    assert.equal(p.match.read().status, 'unavailable');
    assert.equal(p.match.write({}).status, 'unavailable');
    assert.equal(p.match.remove().status, 'unavailable');
  }
});

test('read distinguishes absent, corrupt, loaded, and access failure without deleting bytes', () => {
  const storage = fakeStorage(), channel = persistence(storage).match;
  assert.deepEqual(channel.read(), {ok: true, status: 'missing'});
  storage.data.set('match', '{unfinished');
  assert.equal(channel.read().status, 'corrupt');
  assert.equal(storage.data.get('match'), '{unfinished');
  storage.data.set('match', 'null');
  assert.deepEqual(channel.read(), {ok: true, status: 'loaded', value: null});
  storage.getItem = () => { throw new Error('read rejected'); };
  assert.equal(channel.read().status, 'read-failed');
  assert.equal(storage.calls.some(([operation]) => operation === 'remove'), false);
});

test('match and preferences results are independent, and successful write retries recover', () => {
  const storage = fakeStorage(), p = persistence(storage), setItem = storage.setItem;
  storage.setItem = (key, value) => {
    if (key === 'match') throw new DOMException('full', 'QuotaExceededError');
    setItem.call(storage, key, value);
  };
  const failed = p.match.write({version: 1});
  assert.equal(failed.status, 'write-failed');
  assert.equal(failed.error.name, 'QuotaExceededError');
  assert.equal(p.preferences.write({sound: true}).status, 'saved');
  assert.equal(p.match.read().status, 'missing');
  assert.equal(p.match.status.write, failed, 'read cannot make a failed write look saved');
  assert.equal(p.preferences.status.write.ok, true);
  storage.setItem = setItem;
  assert.deepEqual(p.match.write({version: 1}), {ok: true, status: 'saved'});
  assert.equal(p.match.status.write.ok, true);
  assert.equal(p.match.status.write.error, undefined);
});

test('failed replacement preserves stored bytes and keeps latest serializable snapshot in this page', () => {
  const old = serializeMatchSave(savedState('simple'));
  const storage = fakeStorage({match: old}), channel = persistence(storage).match;
  assert.equal(channel.readSession().status, 'missing');
  const current = savedState('advanced', 'flight');
  storage.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
  const failed = channel.write(current, serializeMatchSave);
  assert.equal(failed.ok, false);
  assert.equal(storage.data.get('match'), old);
  assert.deepEqual(channel.read().value, JSON.parse(old), 'disk read stays explicit');
  const session = channel.readSession();
  assert.equal(session.persisted, false);
  assert.deepEqual(session.value, json({version: 1, state: current}));
  current.shot.ball.x = 900;
  session.value.state.shot.ball.x = 901;
  assert.notEqual(channel.readSession().value.state.shot.ball.x, 900);
  assert.notEqual(channel.readSession().value.state.shot.ball.x, 901);
  storage.setItem = (key, value) => storage.data.set(key, value);
  assert.equal(channel.write(session.value).ok, true);
  assert.equal(channel.readSession().persisted, true);
});

test('serialization failures never access storage or replace the previous session snapshot', () => {
  const storage = fakeStorage(), channel = persistence(storage).match;
  channel.write({retained: true});
  const beforeCalls = storage.calls.length, before = storage.data.get('match');
  const circular = {}; circular.self = circular;
  for (const [value, serializer] of [
    [circular, JSON.stringify], [undefined, JSON.stringify], [1n, JSON.stringify],
    [{}, () => { throw new Error('serializer failed'); }], [{}, () => '{invalid'],
  ]) {
    assert.equal(channel.write(value, serializer).status, 'serialize-failed');
    assert.equal(storage.data.get('match'), before);
    assert.equal(storage.calls.length, beforeCalls);
    assert.deepEqual(channel.readSession(), {ok: true, status: 'loaded', value: {retained: true}, persisted: true});
  }
});

test('canceling an overwrite needs no write: inspection and restore leave disk and session snapshots untouched', () => {
  const storage = fakeStorage(), channel = persistence(storage).match;
  channel.write(savedState('advanced', 'flight'), serializeMatchSave);
  const before = storage.data.get('match'), snapshot = channel.readSession();
  assert.equal(inspectMatchSave(channel.read().value).status, 'resumable');
  assert.equal(restore(snapshot.value).ok, true);
  assert.equal(storage.data.get('match'), before);
  assert.deepEqual(channel.readSession(), snapshot);
  assert.equal(storage.calls.filter(([operation]) => operation === 'set').length, 1);
});

test('deletion reports failure independently, retains both snapshots, and can retry successfully', () => {
  const storage = fakeStorage(), channel = persistence(storage).match;
  channel.write({saved: true});
  const before = storage.data.get('match'), removeItem = storage.removeItem;
  storage.removeItem = () => { throw new Error('remove rejected'); };
  assert.equal(channel.remove().status, 'remove-failed');
  assert.equal(storage.data.get('match'), before);
  assert.equal(channel.readSession().status, 'loaded');
  assert.equal(channel.status.write.status, 'saved');
  storage.removeItem = removeItem;
  assert.deepEqual(channel.remove(), {ok: true, status: 'removed'});
  assert.deepEqual(channel.read(), {ok: true, status: 'missing'});
  assert.deepEqual(channel.readSession(), {ok: true, status: 'missing'});
  assert.equal(channel.status.remove.error, undefined);
});

test('v1 envelopes and all saved game phases round-trip without selecting or losing physical fields', () => {
  for (const mode of ['simple', 'advanced']) for (const phase of ['lineup', 'coin', 'ready', 'aim', 'power', 'guard', 'runup', 'flight', 'result', 'finish']) {
    const state = savedState(mode, phase), encoded = serializeMatchSave(state);
    assert.equal(encoded, JSON.stringify({version: 1, state}));
    const payload = JSON.parse(encoded), before = json(payload), outcome = restore(payload);
    assert.equal(inspectMatchSave(payload).status, phase === 'finish' ? 'finished' : 'resumable', `${mode}/${phase}`);
    assert.equal(outcome.ok, true, `${mode}/${phase}: ${outcome.reason ?? outcome.error}`);
    assert.equal(outcome.state.match instanceof Match, true);
    if (state.shot) assert.equal(outcome.state.shot instanceof Shot, true);
    assert.deepEqual(json(outcome.state), json(state));
    assert.deepEqual(payload, before, 'restoration does not migrate the source snapshot in place');
  }
});

test('a restored mid-flight v1 shot retains deterministic physics and outcome', () => {
  const original = savedState('advanced', 'flight'), restored = restore(JSON.parse(serializeMatchSave(original))).state;
  for (let i = 0; i < 4000 && !original.shot.result; i++) {
    original.shot.step(1 / 120);
    restored.shot.step(1 / 120);
  }
  assert.ok(original.shot.result);
  assert.deepEqual(json(restored.shot), json(original.shot));
  original.match.record(original.shot.result);
  restored.match.record(restored.shot.result);
  assert.deepEqual(json(restored.match), json(original.match));
});

test('legacy v1 optional fields are migrated by the engine without rewriting the source payload', () => {
  const payload = JSON.parse(serializeMatchSave(savedState('simple', 'flight')));
  for (const team of payload.state.match.teams) for (const player of team.players) {
    delete player.curve;
    player.accuracy = 76;
  }
  delete payload.state.shot.keeperPressure;
  delete payload.state.shot.handlingUntil;
  delete payload.state.shot.trackingFeet;
  delete payload.state.shot.pose.shoulders;
  const before = json(payload), outcome = restore(payload);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.state.match.teams[0].players[0].curve, 75);
  assert.equal(outcome.state.match.teams[0].players[0].accuracy, 75);
  assert.equal(outcome.state.shot.keeperPressure, 1);
  assert.ok(outcome.state.shot.pose.shoulders);
  assert.deepEqual(payload, before);
});

test('parsed JSON is not proof of a valid match; unsupported and malformed saves stay untouched', () => {
  const valid = JSON.parse(serializeMatchSave(savedState('advanced', 'flight')));
  const malformed = [null, [], {}, {version: 2, state: valid.state}, {version: 1, state: null}];
  for (const mutate of [
    value => { value.state.phase = 'home'; },
    value => { value.state.match.teams = []; },
    value => { value.state.match.teams[0].order[0] = 99; },
    value => { value.state.match.rng = null; },
    value => { value.state.match.turn = 3; },
    value => { value.state.turnTime = null; },
    value => { value.state.shot = null; },
    value => { value.state.shot.ball.x = null; },
    value => { value.state.shot.pose.hands = []; },
    value => { value.state.shot.keeper.handling = '95'; },
    value => { value.state.phase = 'result'; },
    value => { value.state.phase = 'runup'; value.state.aim = null; },
  ]) { const payload = json(valid); mutate(payload); malformed.push(payload); }
  for (const payload of malformed) {
    const bytes = JSON.stringify(payload), storage = fakeStorage({match: bytes}), channel = persistence(storage).match;
    const loaded = channel.read();
    assert.equal(loaded.ok, true);
    assert.equal(inspectMatchSave(loaded.value).ok, false);
    assert.equal(restore(loaded.value).ok, false);
    assert.equal(storage.data.get('match'), bytes);
    assert.equal(storage.calls.some(([operation]) => operation === 'remove'), false);
  }
  assert.equal(inspectMatchSave({version: 2, state: valid.state}).status, 'unsupported');
});

test('finished last-kick results are distinguished from unfinished games before the finish screen', () => {
  const payload = JSON.parse(serializeMatchSave(savedState('advanced', 'result')));
  assert.equal(inspectMatchSave(payload).status, 'resumable');
  payload.state.match.winner = 1;
  assert.deepEqual(inspectMatchSave(payload), {ok: true, status: 'finished'});
  assert.equal(restore(payload).kind, 'finished');
});

test('engine restoration failures and invalid restoration returns cannot mutate the snapshot', () => {
  const payload = JSON.parse(serializeMatchSave(savedState('simple', 'flight'))), before = json(payload);
  const failed = restoreMatchSave(payload, {
    restoreMatch(raw) { raw.teams[0].players[0].name = 'mutated'; return Match.restore(raw); },
    restoreShot() { throw new Error('cannot migrate shot'); },
  });
  assert.equal(failed.status, 'restore-failed');
  assert.deepEqual(payload, before);
  assert.equal(restoreMatchSave(payload, {restoreMatch: () => null, restoreShot: raw => Shot.restore(raw)}).status, 'restore-failed');
});

test('malformed optional runtime structures are rejected before engine restoration or a replacement write', () => {
  const valid = JSON.parse(serializeMatchSave(savedState('advanced', 'flight')));
  const mutations = {
    'empty foot step': shot => { shot.footStep = {}; },
    'invalid foot index': shot => { shot.footStep = {index: 2, from: shot.trackingFeet[0], to: shot.trackingFeet[1], at: shot.t}; },
    'missing step origin': shot => { shot.footStep = {index: 0, to: shot.trackingFeet[1], at: shot.t}; },
    'missing step destination': shot => { shot.footStep = {index: 0, from: shot.trackingFeet[0], at: shot.t}; },
    'invalid step clock': shot => { shot.footStep = {index: 0, from: shot.trackingFeet[0], to: shot.trackingFeet[1], at: null}; },
    'missing tracking offset': shot => { delete shot.keeperOffset; },
    'missing tracking velocity': shot => { delete shot.keeperVelocity; },
    'missing next foot': shot => { delete shot.nextFoot; },
    'invalid next foot': shot => { shot.nextFoot = 3; },
    'invalid launch feet': shot => { shot.launchFeet = {}; },
    'empty hesitation': shot => { shot.hesitation = {}; },
    'missing hesitation origin': shot => { shot.hesitation = {at: shot.t, direction: 1}; },
    'invalid hesitation direction': shot => { shot.hesitation = {at: shot.t, direction: 0, pose: shot.pose}; },
    'invalid hesitation time': shot => { shot.hesitation = {at: null, direction: 1, pose: shot.pose}; },
    'invalid hesitation previous pose': shot => { shot.hesitation = {at: shot.t, direction: 1, pose: shot.pose, previous: {}}; },
    'invalid previous pose': shot => { shot.previousPose = {}; },
    'missing cached shoulders': shot => { delete shot.previousPose.shoulders; },
    'missing current hips': shot => { delete shot.pose.hips; },
    'missing pose up': shot => { delete shot.pose.up; },
    'invalid pose right': shot => { shot.pose.right = null; },
    'missing pose forward': shot => { delete shot.pose.forward; },
    'missing pose roll': shot => { delete shot.pose.roll; },
    'invalid torso channel': shot => { shot.pose.torso = {curl: []}; },
    'invalid grip rotation': shot => { shot.pose.grip = {center: shot.ball, weight: 1, handRotations: [[0, 0, 0, 1]]}; },
    'invalid animation clock': shot => { shot.animationTime = {}; },
    'invalid previous clock': shot => { shot.previousAnimationTime = '0'; },
    'invalid dive delay': shot => { shot.diveDelay = []; },
    'missing recovery clock': shot => { shot.recoveryOrigin = shot.pose; delete shot.recoveryAt; },
    'missing clearance height': shot => { shot.clearanceAt = shot.t; delete shot.clearanceHeight; },
    'invalid handling cooldown': shot => { shot.handlingUntil = {handL: {}}; },
  };
  for (const [label, mutate] of Object.entries(mutations)) {
    const payload = json(valid); mutate(payload.state.shot);
    const bytes = JSON.stringify(payload), storage = fakeStorage({match: bytes}), channel = persistence(storage).match;
    const saved = channel.read().value;
    let engineCalls = 0;
    const restored = restoreMatchSave(saved, {
      restoreMatch(raw) { engineCalls++; return Match.restore(raw); },
      restoreShot(raw) { engineCalls++; return Shot.restore(raw); },
    });
    assert.equal(inspectMatchSave(saved).status, 'invalid', label);
    assert.equal(restored.status, 'invalid', label);
    assert.equal(engineCalls, 0, `${label}: never promote malformed data into a live match`);
    assert.equal(storage.data.get('match'), bytes, label);
    assert.equal(storage.calls.some(([operation]) => operation === 'set' || operation === 'remove'), false, label);
    assert.equal(channel.readSession().status, 'missing', label);
  }
});

test('valid optional runtime state and absent legacy groups still restore and step deterministically', () => {
  const state = savedState('advanced', 'flight');
  state.shot = state.match.shoot(state.aim, 0);
  const valid = JSON.parse(serializeMatchSave(state));
  const variants = {
    'active support step': shot => {
      shot.footStep = {index: 0, from: {...shot.trackingFeet[0]}, to: {...shot.trackingFeet[0], x: -.25}, at: shot.t};
    },
    'hesitation with previous frame': shot => {
      shot.hesitation = {at: shot.t, direction: 1, pose: json(shot.pose), previous: json(shot.pose)};
    },
    'older hesitation without previous frame': shot => {
      shot.hesitation = {at: shot.t, direction: 1, pose: json(shot.pose)};
    },
    'recovery origin and clocks': shot => {
      shot.recoveryOrigin = json(shot.pose); shot.recoveryAt = shot.t;
      shot.previousPose = json(shot.pose); shot.previousAnimationTime = shot.t; shot.animationTime = shot.t;
    },
    'legacy absent groups and current shoulders': shot => {
      for (const key of ['trackingFeet', 'keeperOffset', 'keeperVelocity', 'nextFoot', 'launchFeet', 'footStep',
        'previousPose', 'animationTime', 'previousAnimationTime', 'keeperPressure', 'handlingUntil']) delete shot[key];
      delete shot.pose.shoulders; delete shot.pose.hips;
    },
  };
  for (const [label, prepare] of Object.entries(variants)) {
    const payload = json(valid); prepare(payload.state.shot);
    const before = json(payload), outcome = restore(payload);
    assert.equal(inspectMatchSave(payload).status, 'resumable', label);
    assert.equal(outcome.ok, true, label);
    const reference = Shot.restore(json(payload.state.shot));
    for (let i = 0; i < 30; i++) {
      outcome.state.shot.step(1 / 120);
      reference.step(1 / 120);
    }
    assert.deepEqual(json(outcome.state.shot), json(reference), label);
    assert.deepEqual(payload, before, label);
  }
});

test('power-phase restore requires the locked direction used by Shoot', () => {
  const payload = JSON.parse(serializeMatchSave(savedState('simple', 'power')));
  assert.equal(inspectMatchSave(payload).status, 'resumable');
  delete payload.state.lockedX;
  assert.deepEqual(inspectMatchSave(payload), {ok: false, status: 'invalid', reason: 'input'});
  assert.equal(restore(payload).ok, false);
  payload.state.phase = 'ready';
  assert.equal(inspectMatchSave(payload).status, 'resumable', 'older snapshots need no unused locked direction');
});

test('unknown v1 class-root data cannot overwrite methods or pass into engine assignment', () => {
  const valid = JSON.parse(serializeMatchSave(savedState('advanced', 'flight')));
  for (const [root, key] of [['match', 'next'], ['match', 'shoot'], ['match', 'futureRule'],
    ['shot', 'step'], ['shot', 'poseAt'], ['shot', 'futurePhysics']]) {
    const payload = json(valid); payload.state[root][key] = null;
    const bytes = JSON.stringify(payload), storage = fakeStorage({match: bytes}), channel = persistence(storage).match;
    let engineCalls = 0;
    const loaded = channel.read().value, outcome = restoreMatchSave(loaded, {
      restoreMatch(raw) { engineCalls++; return Match.restore(raw); },
      restoreShot(raw) { engineCalls++; return Shot.restore(raw); },
    });
    assert.deepEqual(inspectMatchSave(loaded), {ok: false, status: 'unsupported', reason: `${root}-fields`}, `${root}.${key}`);
    assert.equal(outcome.status, 'unsupported');
    assert.equal(engineCalls, 0, 'unchecked data never reaches Object.assign in engine restoration');
    assert.equal(storage.data.get('match'), bytes);
    assert.equal(channel.readSession().status, 'missing');
    assert.equal(storage.calls.some(([operation]) => operation !== 'get'), false);
  }
});

test('reserved assignment keys at every nested level reject before callbacks and preserve raw bytes', () => {
  const valid = JSON.parse(serializeMatchSave(savedState('advanced', 'flight')));
  const targets = [payload => payload, payload => payload.state, payload => payload.state.match,
    payload => payload.state.shot, payload => payload.state.match.teams[0].players[0],
    payload => payload.state.shot.handlingUntil = {}, payload => payload.state.shot.pose.up];
  for (const key of ['__proto__', 'constructor', 'prototype']) for (const target of targets) {
    const payload = json(valid);
    Object.defineProperty(target(payload), key, {value: {}, enumerable: true});
    const bytes = JSON.stringify(payload), storage = fakeStorage({match: bytes}), channel = persistence(storage).match;
    const loaded = channel.read().value;
    let engineCalls = 0;
    const outcome = restoreMatchSave(loaded, {
      restoreMatch() { engineCalls++; }, restoreShot() { engineCalls++; },
    });
    assert.deepEqual(outcome, {ok: false, status: 'invalid', reason: 'assignment-key'});
    assert.equal(engineCalls, 0);
    assert.equal(storage.data.get('match'), bytes);
    assert.equal(storage.calls.some(([operation]) => operation !== 'get'), false);
  }
});

test('nested assignment-key scan is iterative and handles a page-only reference cycle', () => {
  const payload = JSON.parse(serializeMatchSave(savedState()));
  let node = payload.state.extra = {};
  for (let i = 0; i < 15000; i++) node = node.child = {};
  Object.defineProperty(node, '__proto__', {value: {}, enumerable: true});
  assert.deepEqual(inspectMatchSave(payload), {ok: false, status: 'invalid', reason: 'assignment-key'});
  delete payload.state.extra;
  payload.state.pageOnly = payload.state;
  assert.equal(inspectMatchSave(payload).status, 'resumable');
});

test('v1 root schema includes every data field assigned by the current engine', async () => {
  const source = await readFile(new URL('../src/engine.js', import.meta.url), 'utf8');
  const valid = JSON.parse(serializeMatchSave(savedState('advanced', 'flight')));
  for (const [root, start, end] of [['match', 'export class Match', 'const v ='], ['shot', 'export class Shot', 'export function gestureInput']]) {
    const body = source.slice(source.indexOf(start), source.indexOf(end));
    const assigned = new Set([...body.matchAll(/this\.([A-Za-z_$][\w$]*)\s*(?:=(?!=)|\?\?=|\+=|\+\+|-=|\*=|\/=)/g)].map(match => match[1]));
    assert.ok(assigned.size > 10, 'audit must identify the engine class assignments');
    for (const key of assigned) {
      const payload = json(valid);
      if (!(key in payload.state[root])) payload.state[root][key] = null;
      assert.notEqual(inspectMatchSave(payload).status, 'unsupported', `${root}.${key} requires a persistence schema update`);
    }
  }
});

test('restoration detects future callable prototype collisions without a method-name blacklist', () => {
  const payload = JSON.parse(serializeMatchSave(savedState('advanced', 'flight')));
  // Model a future class method accidentally colliding with an established data
  // field. The production check must discover it from the actual prototype.
  const outcome = restoreMatchSave(payload, {
    restoreMatch(raw) {
      const restored = Match.restore(raw), prototype = Object.create(Match.prototype);
      prototype.seed = function futureMethod() {};
      return Object.setPrototypeOf(restored, prototype);
    },
    restoreShot: raw => Shot.restore(raw),
  });
  assert.equal(outcome.status, 'restore-failed');
  assert.match(outcome.error.message, /shadows an engine method/);
});

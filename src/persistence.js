// Keep storage availability and the result of each operation separate. Reading a
// key successfully says nothing about whether the latest write was persisted.
export function createPersistence({getStorage = () => globalThis.localStorage,
  matchKey = 'penalty-night-v1', preferencesKey = 'penalty-preferences-v1'} = {}) {
  return {
    match: createChannel(matchKey, getStorage),
    preferences: createChannel(preferencesKey, getStorage),
  };
}

function createChannel(key, getStorage) {
  const status = {read: null, write: null, remove: null};
  let session = null;
  const record = (operation, result) => (status[operation] = result);
  function storageFor(operation) {
    try {
      const storage = getStorage();
      const method = {read: 'getItem', write: 'setItem', remove: 'removeItem'}[operation];
      if (!storage || typeof storage[method] !== 'function') {
        return {ok: false, status: 'unavailable'};
      }
      return {ok: true, storage};
    } catch (error) {
      return {ok: false, status: 'unavailable', error};
    }
  }
  return {
    get status() { return {...status}; },
    read() {
      const access = storageFor('read');
      if (!access.ok) return record('read', access);
      let text;
      try { text = access.storage.getItem(key); }
      catch (error) { return record('read', {ok: false, status: 'read-failed', error}); }
      if (text === null) return record('read', {ok: true, status: 'missing'});
      try { return record('read', {ok: true, status: 'loaded', value: JSON.parse(text)}); }
      catch (error) { return record('read', {ok: false, status: 'corrupt', error}); }
    },
    // Only writes establish a session snapshot. Reads always report the actual
    // stored value, including corrupt/unsupported data, and never erase it.
    readSession() {
      if (!session) return {ok: true, status: 'missing'};
      return {ok: true, status: 'loaded', value: JSON.parse(session.text), persisted: session.persisted};
    },
    write(value, serialize = JSON.stringify) {
      let text;
      try {
        text = serialize(value);
        if (typeof text !== 'string') throw new TypeError('Serialization must return JSON text');
        // A serializer returning undefined or invalid JSON must not replace a
        // readable stored match, or establish an unusable session fallback.
        JSON.parse(text);
      } catch (error) {
        return record('write', {ok: false, status: 'serialize-failed', error});
      }
      session = {text, persisted: false};
      const access = storageFor('write');
      if (!access.ok) return record('write', access);
      try {
        // A single native Storage.setItem preserves its previous value if it
        // fails. No remove-before-write or temporary-key transaction is used.
        access.storage.setItem(key, text);
        session.persisted = true;
        return record('write', {ok: true, status: 'saved'});
      } catch (error) {
        return record('write', {ok: false, status: 'write-failed', error});
      }
    },
    remove() {
      const access = storageFor('remove');
      if (!access.ok) return record('remove', access);
      try {
        access.storage.removeItem(key);
        session = null;
        return record('remove', {ok: true, status: 'removed'});
      } catch (error) {
        return record('remove', {ok: false, status: 'remove-failed', error});
      }
    },
  };
}

// This is deliberately the existing v1 wire format. Do not select or rebuild
// physical Shot fields here: doing so loses contact/rebound/animation state.
export function serializeMatchSave(state) {
  return JSON.stringify({version: 1, state});
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = Number.isFinite;
const integer = (value, min, max = Number.MAX_SAFE_INTEGER) => Number.isInteger(value) && value >= min && value <= max;
const side = value => value === 0 || value === 1;
const direction = value => value === -1 || value === 0 || value === 1;
const vector = value => object(value) && ['x', 'y', 'z'].every(key => finite(value[key]));
const pair = value => Array.isArray(value) && value.length === 2 && value.every(vector);
const rng = value => object(value) && integer(value.state, 0, 0xffffffff);
const phases = new Set(['lineup', 'coin', 'ready', 'aim', 'power', 'guard', 'runup', 'flight', 'result', 'finish']);
const pregame = new Set(['lineup', 'coin']);
const shotPhases = new Set(['flight', 'result', 'finish']);
// Version 1 stores every engine-owned data field, including optional transient
// state. Reject unknown fields rather than assigning them onto engine classes
// or silently discarding data from a newer build using the same version.
const matchFields = new Set(['mode', 'seed', 'rng', 'teams', 'coinWinner', 'end', 'first', 'turn', 'winner',
  'serial', 'kicker', 'aiDive', 'aiAim', 'shotSeed', 'recorded', 'aiFirst']);
const shotFields = new Set(['rng', 'attacker', 'keeper', 'keeperPressure', 'direction', 'diveAt', 't',
  'ball', 'previous', 'touched', 'post', 'contactUntil', 'handlingUntil', 'postUntil', 'result', 'caught',
  'velocity', 'spin', 'aim', 'actualPower', 'target', 'launchSpeed', 'reactionHeight', 'keeperOffset',
  'keeperVelocity', 'trackingFeet', 'nextFoot', 'diveHeight', 'stretch', 'diveDelay', 'diveVelocity', 'pose',
  'diveOrigin', 'clearanceAt', 'clearanceHeight', 'hesitation', 'recoveryOrigin', 'recoveryAt', 'footStep',
  'launchFeet', 'previousPose', 'previousAnimationTime', 'animationTime', 'contactPart']);
const assignmentKeys = new Set(['__proto__', 'prototype', 'constructor']);
function hasUnsafeAssignmentKey(root) {
  const pending = [root], seen = new Set();
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    for (const key of Object.keys(value)) {
      if (assignmentKeys.has(key)) return true;
      pending.push(value[key]);
    }
  }
  return false;
}
function shadowsPrototypeMethod(value) {
  const keys = Object.keys(value);
  for (let prototype = Object.getPrototypeOf(value); prototype; prototype = Object.getPrototypeOf(prototype)) {
    if (keys.some(key => typeof Object.getOwnPropertyDescriptor(prototype, key)?.value === 'function')) return true;
  }
  return false;
}
const attributes = ['accuracy', 'power', 'composure', 'touch', 'speed', 'reach', 'handling'];
const stats = value => object(value) && attributes.every(key => finite(value[key]) && value[key] >= 1 && value[key] <= 99)
  && (value.curve === undefined || (finite(value.curve) && value.curve >= 1 && value.curve <= 99));
const aim = value => object(value) && finite(value.x) && finite(value.power)
  && ['y', 'curve'].every(key => value[key] === undefined || finite(value[key]));
const result = value => object(value) && typeof value.goal === 'boolean' && typeof value.saved === 'boolean'
  && typeof value.post === 'boolean' && typeof value.reason === 'string' && finite(value.speed);
function team(value) {
  if (!object(value) || !['name', 'short', 'color'].every(key => typeof value[key] === 'string')) return false;
  if (!Array.isArray(value.players) || value.players.length !== 11 || !value.players.every(player => stats(player)
    && integer(player.number, 1) && typeof player.name === 'string' && typeof player.position === 'string')) return false;
  if (!Array.isArray(value.order) || value.order.length !== 11 || new Set(value.order).size !== 11
    || !value.order.every(index => integer(index, 0, 10))) return false;
  return Array.isArray(value.kicks) && value.kicks.every(result) && integer(value.goals, 0, value.kicks.length);
}
const optionalNumbers = (value, keys) => keys.every(key => value[key] === undefined || finite(value[key]));
function pose(value, legacyCurrent = false) {
  if (!object(value) || !['hip', 'shoulder', 'head', 'up', 'right', 'forward'].every(key => vector(value[key]))
    || !finite(value.roll) || !['hands', 'elbows', 'knees', 'feet'].every(key => pair(value[key]))) return false;
  // Only the current pose has a missing-shoulders migration in Shot.restore.
  // Cached interpolation/recovery poses are consumed directly by the renderer.
  if (!(legacyCurrent && value.shoulders === undefined)
    && !['shoulders', 'hips'].every(key => pair(value[key]))) return false;
  if (value.hips !== undefined && !pair(value.hips)) return false;
  if (value.torso != null && (!object(value.torso) || !optionalNumbers(value.torso,
    ['curl', 'twist', 'sideBend', 'headCurl', 'armRelax', 'braceL', 'braceR', 'soleL', 'soleR']))) return false;
  if (value.grip != null) {
    const grip = value.grip;
    if (!object(grip) || !vector(grip.center) || !finite(grip.weight)
      || !optionalNumbers(grip, ['captureBlend']) || (grip.ball !== undefined && !vector(grip.ball))) return false;
    if (grip.handRotations !== undefined && (!Array.isArray(grip.handRotations) || grip.handRotations.length !== 2
      || !grip.handRotations.every(rotation => Array.isArray(rotation) && rotation.length === 4 && rotation.every(finite)))) return false;
  }
  return true;
}
function optionalShotState(value) {
  if (!optionalNumbers(value, ['keeperPressure', 'reactionHeight', 'diveHeight', 'diveDelay', 'diveVelocity', 'stretch',
    'animationTime', 'previousAnimationTime', 'recoveryAt', 'clearanceAt', 'clearanceHeight'])) return false;
  if (!['keeperOffset', 'keeperVelocity'].every(key => value[key] === undefined || vector(value[key]))) return false;
  if (value.nextFoot !== undefined && !side(value.nextFoot)) return false;
  if (value.trackingFeet != null && (!pair(value.trackingFeet) || !vector(value.keeperOffset)
    || !vector(value.keeperVelocity) || !side(value.nextFoot))) return false;
  if (value.launchFeet != null && !pair(value.launchFeet)) return false;
  if (value.footStep != null) {
    const step = value.footStep;
    if (!object(step) || !pair(value.trackingFeet) || !side(step.index)
      || !vector(step.from) || !vector(step.to) || !finite(step.at)) return false;
  }
  if (value.hesitation != null) {
    const hesitation = value.hesitation;
    if (!object(hesitation) || !finite(hesitation.at) || ![-1, 1].includes(hesitation.direction)
      || !pose(hesitation.pose) || (hesitation.previous != null && !pose(hesitation.previous))) return false;
  }
  if (!['previousPose', 'diveOrigin', 'recoveryOrigin'].every(key => value[key] == null || pose(value[key]))) return false;
  if (value.recoveryOrigin != null && !finite(value.recoveryAt)) return false;
  if (value.clearanceAt !== undefined && !finite(value.clearanceHeight)) return false;
  if (value.handlingUntil != null && (!object(value.handlingUntil) || !Object.values(value.handlingUntil).every(finite))) return false;
  return value.contactPart == null || typeof value.contactPart === 'string';
}
function shot(value) {
  if (!object(value) || !rng(value.rng) || !stats(value.attacker) || !stats(value.keeper)
    || !aim(value.aim) || !object(value.target) || !finite(value.target.x) || !finite(value.target.y)) return false;
  if (!['ball', 'previous', 'velocity'].every(key => vector(value[key])) || !direction(value.direction)
    || !finite(value.t) || value.t < 0 || !(value.diveAt === null || finite(value.diveAt))) return false;
  if (!['actualPower', 'launchSpeed', 'spin', 'contactUntil', 'postUntil'].every(key => finite(value[key]))
    || !['touched', 'post', 'caught'].every(key => typeof value[key] === 'boolean')) return false;
  if (value.result !== null && !result(value.result)) return false;
  // Absent legacy groups keep the engine's defaults; present groups must be
  // coherent before restore, pause-save, or the next physics/rendering frame.
  if (value.pose != null && !pose(value.pose, true)) return false;
  return optionalShotState(value);
}

// A classification is a structural guard, not proof that engine restoration or
// rendering will succeed. The caller must also handle restore-failed safely.
export function inspectMatchSave(value) {
  if (!object(value)) return {ok: false, status: 'invalid', reason: 'envelope'};
  if (value.version !== 1) return {ok: false, status: value.version === undefined ? 'invalid' : 'unsupported', reason: 'version'};
  const state = value.state, match = state?.match;
  if (!object(state) || !phases.has(state.phase)) return {ok: false, status: 'invalid', reason: 'phase'};
  if (hasUnsafeAssignmentKey(value)) return {ok: false, status: 'invalid', reason: 'assignment-key'};
  if (object(match) && Object.keys(match).some(key => !matchFields.has(key))) return {ok: false, status: 'unsupported', reason: 'match-fields'};
  if (object(state.shot) && Object.keys(state.shot).some(key => !shotFields.has(key))) return {ok: false, status: 'unsupported', reason: 'shot-fields'};
  if (!object(match) || !['simple', 'advanced'].includes(match.mode) || !rng(match.rng)
    || !Array.isArray(match.teams) || match.teams.length !== 2 || !match.teams.every(team)
    || !side(match.turn) || !side(match.first) || !side(match.coinWinner) || !side(match.end)
    || !(match.winner === null || side(match.winner)) || !integer(match.serial, 0)) {
    return {ok: false, status: 'invalid', reason: 'match'};
  }
  if (!finite(state.turnTime) || state.turnTime < 0 || !finite(state.runup) || state.runup < 0
    || !direction(state.dir) || (state.lockedX !== undefined && !finite(state.lockedX))
    || (state.phase === 'power' && !finite(state.lockedX))
    || (state.aim != null && !aim(state.aim))) return {ok: false, status: 'invalid', reason: 'input'};
  if (pregame.has(state.phase)) {
    if (match.coinWinner === 1 && !side(match.aiFirst)) return {ok: false, status: 'invalid', reason: 'coin'};
  } else if (!integer(match.kicker, 0, 10) || !integer(match.serial, 1) || !rng({state: match.shotSeed})
    || !direction(match.aiDive) || !aim(match.aiAim) || typeof match.recorded !== 'boolean') {
    return {ok: false, status: 'invalid', reason: 'turn'};
  }
  if ((state.phase === 'runup' && !aim(state.aim)) || ((shotPhases.has(state.phase) || state.shot != null) && !shot(state.shot))) return {ok: false, status: 'invalid', reason: 'shot'};
  if (['result', 'finish'].includes(state.phase) && (!result(state.shot?.result) || !match.recorded)
    || state.phase === 'finish' && !side(match.winner)) return {ok: false, status: 'invalid', reason: 'result'};
  return {ok: true, status: side(match.winner) ? 'finished' : 'resumable'};
}

export function restoreMatchSave(value, {restoreMatch, restoreShot}) {
  const inspection = inspectMatchSave(value);
  if (!inspection.ok) return inspection;
  try {
    // Match.restore migrates player attributes in place. Work on a JSON clone so
    // failure cannot partly mutate a saved snapshot or the current live match.
    const state = JSON.parse(JSON.stringify(value.state));
    state.match = restoreMatch(state.match);
    if (state.shot) state.shot = restoreShot(state.shot);
    if (!inspectMatchSave({version: 1, state}).ok) throw new TypeError('Restoration returned an invalid match');
    if (shadowsPrototypeMethod(state.match) || state.shot && shadowsPrototypeMethod(state.shot)) {
      throw new TypeError('Restored data shadows an engine method');
    }
    return {ok: true, status: 'restored', kind: inspection.status, state};
  } catch (error) {
    return {ok: false, status: 'restore-failed', error};
  }
}

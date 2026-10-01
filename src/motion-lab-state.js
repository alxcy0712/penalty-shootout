// Inspection playback is independent of renderer cadence. Frame stepping uses
// a 60 Hz inspection grid; the gameplay ball still uses its own 120 Hz physics.
export const INSPECTION_FPS = 60;
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function advancePlayback({ time, duration, playing, speed, loop }, elapsed) {
  if (!playing || elapsed <= 0) return { time, playing };
  const next = time + elapsed * speed;
  if (next < duration) return { time: next, playing: true };
  return loop && duration > 0
    ? { time: next % duration, playing: true }
    : { time: duration, playing: false };
}

export function stepFrame(time, direction, duration, count = 1) {
  const tick = time * INSPECTION_FPS;
  const next = direction > 0
    ? Math.floor(tick + 1e-7) + count
    : Math.ceil(tick - 1e-7) - count;
  return clamp(next / INSPECTION_FPS, 0, duration);
}

export function motionInfo(action, contact, runupDurations, holdDuration) {
  const striker = action === 'kick' || action.startsWith('runup');
  const impact = action.startsWith('runup') ? runupDurations[Number(action.slice(-1))] : contact;
  const duration = action === 'warmup' ? 12 : action === 'tracking' ? 6 : 4;
  let markers;
  if (striker) markers = [
    { time: 0, label: '开始' },
    { time: impact - .55, label: '落支撑脚' },
    { time: impact, label: '触球', contact: true },
    { time: impact + .22, label: '随摆' },
    { time: impact + .85, label: '收势' },
  ];
  else if (action === 'warmup') markers = [
    { time: 0, label: '开始' }, { time: 3, label: '热身 3 秒' },
    { time: 6, label: '热身 6 秒' }, { time: 9, label: '热身 9 秒' },
  ];
  else if (action === 'gather') markers = [
    { time: 0, label: '接球起点' }, { time: holdDuration / 2, label: '收球中段' },
    { time: holdDuration, label: '抱球' },
  ];
  else if (action === 'prepare') markers = [
    { time: 0, label: '开始' }, { time: .8, label: '蹬地衔接' },
    { time: 1.35, label: '展体' }, { time: 2.3, label: '收势' },
  ];
  else if (action === 'hesitate') markers = [
    { time: 0, label: '开始' }, { time: .1, label: '错边刹停' },
    { time: .32, label: '半扑' }, { time: .65, label: '恢复' },
  ];
  else if (action === 'recover') markers = [
    { time: 0, label: '落地' }, { time: .5, label: '支撑脚' },
    { time: .95, label: '撑地起身' }, { time: 1.6, label: '站稳' },
  ];
  else if (action === 'tracking') markers = [
    { time: 0, label: '开始' }, { time: 1, label: '追球 1 秒' },
    { time: 2, label: '追球 2 秒' }, { time: 3, label: '回放 3 秒' },
  ];
  else markers = [
    { time: 0, label: '开始' }, { time: .13, label: '蹬地' },
    { time: .55, label: '展体' }, { time: 1, label: '缓冲' },
  ];
  return { striker, contact: striker ? impact : null, duration, markers };
}

export function viewportLayout(width, height, split) {
  if (!split) return [{ x: 0, y: 0, width, height, side: false }];
  // Keep both actors full-size on portrait displays instead of squeezing them
  // into narrow columns. Coordinates use WebGL's bottom-left origin.
  if (width < height * .95) {
    const bottom = Math.floor(height / 2);
    return [
      { x: 0, y: bottom, width, height: height - bottom, side: false },
      { x: 0, y: 0, width, height: bottom, side: true },
    ];
  }
  const left = Math.floor(width / 2);
  return [
    { x: 0, y: 0, width: left, height, side: false },
    { x: left, y: 0, width: width - left, height, side: true },
  ];
}

export function frameDistance(width, height, depth, aspect, fov, zoom = 1) {
  const tangent = Math.tan(fov * Math.PI / 360);
  return (Math.max(height / 2 / tangent, width / 2 / tangent / Math.max(.01, aspect)) + depth / 2) * 1.18 / zoom;
}

// A gesture owns its coordinate frame, device, and profile until it ends.
const RECT_KEYS = ['left', 'top', 'width', 'height'];
const validRect = rect => rect && RECT_KEYS.every(key => Number.isFinite(rect[key])) && rect.width > 0 && rect.height > 0;
const validEvent = event => [event.clientX, event.clientY, event.timeStamp].every(Number.isFinite);
export function createGestureSession(event, rect, options) {
  if (!validRect(rect) || !validEvent(event)) return null;
  const r = Object.fromEntries(RECT_KEYS.map(key => [key, rect[key]]));
  return {...options, profile: {...options.profile}, id: event.pointerId, r,
    points: [{x: event.clientX - r.left, y: event.clientY - r.top, t: event.timeStamp}]};
}

// Compare both position and size on every pointer event; no per-frame reads.
export function appendGesturePoint(session, event, rect) {
  if (!validRect(rect) || !validEvent(event) || RECT_KEYS.some(key => session.r[key] !== rect[key])) return false;
  session.points.push({x: event.clientX - session.r.left, y: event.clientY - session.r.top, t: event.timeStamp});
  return true;
}

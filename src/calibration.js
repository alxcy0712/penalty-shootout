import {clamp, gestureInput} from './engine.js';

export const DEVICES = ['mouse', 'touch', 'pen'];
export const DEADZONE_PX = 12;
// Existing threshold 2 on the audited 390 × 844 viewport (509px play area).
// This retains that representative default without tying future power to layout.
export const REFERENCE_HEIGHT_PX = 509;
export const DEFAULT_FULL_TRAVEL_PX = DEADZONE_PX + REFERENCE_HEIGHT_PX * .72;
export const MIN_FULL_TRAVEL_PX = 30;
export const MAX_FULL_TRAVEL_PX = 1500;
const finite = value => typeof value === 'number' && Number.isFinite(value);
export const inputDevice = device => DEVICES.includes(device) ? device : 'mouse';
export const defaultCalibration = () => ({version: 1, unit: 'css-px', fullTravelPx: DEFAULT_FULL_TRAVEL_PX});
export function preferencesRequireNewerVersion(raw) {
  if (!raw || typeof raw !== 'object') return false;
  if (raw.version !== undefined && raw.version !== 2) return true;
  return raw.version === 2 && DEVICES.some(device => {
    const profile = raw.devices?.[device];
    return profile && ((profile.version !== undefined && profile.version !== 1)
      || (profile.version === 1 && !['css-px', 'legacy-height'].includes(profile.unit)));
  });
}

export function validCalibration(raw) {
  if (!raw || raw.version !== 1) return null;
  if (raw.unit === 'css-px' && finite(raw.fullTravelPx) && raw.fullTravelPx >= MIN_FULL_TRAVEL_PX && raw.fullTravelPx <= MAX_FULL_TRAVEL_PX)
    return {version: 1, unit: 'css-px', fullTravelPx: raw.fullTravelPx};
  if (raw.unit === 'legacy-height' && finite(raw.threshold) && raw.threshold >= .5 && raw.threshold <= 4)
    return {version: 1, unit: 'legacy-height', threshold: raw.threshold};
  return null;
}

// Reading never writes or silently converts a saved height-relative threshold.
export function normalizePreferences(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const devices = Object.fromEntries(DEVICES.map(device => {
    const legacy = source.version === undefined && finite(source[device])
      ? validCalibration({version: 1, unit: 'legacy-height', threshold: source[device]}) : null;
    return [device, (source.version === 2 ? validCalibration(source.devices?.[device]) : legacy) || defaultCalibration()];
  }));
  return {version: 2, mode: source.mode === 'advanced' ? 'advanced' : 'simple', sound: typeof source.sound === 'boolean' ? source.sound : true, devices};
}

export const deviceCalibration = (settings, device) => validCalibration(settings.devices?.[inputDevice(device)]) || defaultCalibration();
export const needsRecalibration = settings => DEVICES.some(device => deviceCalibration(settings, device).unit === 'legacy-height');

// A draft is a separate object; opening, switching tabs, and closing cannot save it.
export function calibrationDraft(settings, device) {
  const profile = deviceCalibration(settings, device);
  const legacy = profile.unit === 'legacy-height';
  return {device: inputDevice(device), profile: legacy
    ? {version: 1, unit: 'css-px', fullTravelPx: DEADZONE_PX + REFERENCE_HEIGHT_PX * .72 * profile.threshold / 2}
    : {...profile}, legacy, samples: [], automatic: false};
}

export function calibratedProfile(samples) {
  if (samples.length !== 3 || samples.some(value => !validCalibrationTravel(value))) return null;
  const median = [...samples].sort((a, b) => a - b)[1];
  return {version: 1, unit: 'css-px', fullTravelPx: clamp(DEADZONE_PX + (median - DEADZONE_PX) / .85, MIN_FULL_TRAVEL_PX, MAX_FULL_TRAVEL_PX)};
}

export const validCalibrationTravel = value => finite(value) && value >= 18;
export const cssTravelPower = (travelPx, profile) => clamp((travelPx - DEADZONE_PX) / (profile.fullTravelPx - DEADZONE_PX), 0, 1);

// Physics/replay's gestureInput is unchanged. Aim height, lateral aim, curve and
// speed retain its viewport normalization. Only adjustable power uses CSS px.
// Legacy profiles call the exact old mapping until the user explicitly saves.
export function calibratedGestureInput(points, rect, profile) {
  if (!Array.isArray(points) || points.some(p => !finite(p.x) || !finite(p.y) || !finite(p.t))) return null;
  if (!rect || !finite(rect.width) || !finite(rect.height)) return null;
  const calibration = validCalibration(profile) || defaultCalibration();
  const input = gestureInput(points, rect.width, rect.height, calibration.unit === 'legacy-height' ? calibration.threshold : 2, true);
  if (!input) return null;
  const travelPx = points[0].y - points.at(-1).y;
  return {...input, travelPx, power: calibration.unit === 'css-px'
    ? cssTravelPower(travelPx, calibration)
    : input.power};
}

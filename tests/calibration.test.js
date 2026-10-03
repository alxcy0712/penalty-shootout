import test from 'node:test';
import assert from 'node:assert/strict';
import {gestureInput} from '../src/engine.js';
import {DEADZONE_PX, DEFAULT_FULL_TRAVEL_PX, defaultCalibration, normalizePreferences, deviceCalibration, calibrationDraft, calibratedProfile, calibratedGestureInput, inputDevice} from '../src/calibration.js';
import {createGestureSession, appendGesturePoint} from '../src/gesture-session.js';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-12,`${a} vs ${b}`);
const points=[{x:195,y:160,t:0},{x:225,y:100,t:60},{x:195,y:40,t:120}];

test('three-stroke median gives identical 85% CSS-pixel power in calibration and target viewports',()=>{
  const profile=calibratedProfile([115,120,125]);
  near(profile.fullTravelPx,12+108/.85);
  for(const [width,height] of [[320,185],[320,365],[390,509],[430,597]]){
    const actual=calibratedGestureInput(points,{width,height},profile);
    near(actual.power,.85);assert.equal(actual.travelPx,120);
    const legacy=gestureInput(points,width,height,2,true);
    for(const key of ['x','y','curve','speed','distance'])assert.equal(actual[key],legacy[key],`${key} keeps existing viewport normalization`);
  }
  assert.notEqual(calibratedGestureInput(points,{width:320,height:185},profile).y,calibratedGestureInput(points,{width:390,height:509},profile).y);
});

test('documented default exactly preserves representative 509px gameplay power',()=>{
  near(DEFAULT_FULL_TRAVEL_PX,378.48);
  for(const travel of [18,40,120,250,400]){
    const path=[{x:195,y:500,t:0},{x:210,y:500-travel,t:100}];
    near(calibratedGestureInput(path,{width:390,height:509},defaultCalibration()).power,gestureInput(path,390,509,2,true).power);
  }
});

test('legacy per-device profiles remain behavior-compatible until explicit draft commit',()=>{
  const raw={mode:'advanced',sound:false,mouse:.5,touch:1.9,pen:4},before=JSON.stringify(raw);
  const settings=normalizePreferences(raw);
  assert.equal(settings.mode,'advanced');assert.equal(settings.sound,false);
  for(const device of ['mouse','touch','pen'])for(const height of [185,365,509]){
    const actual=calibratedGestureInput(points,{width:390,height},deviceCalibration(settings,device));
    const expected=gestureInput(points,390,height,raw[device],true);
    for(const key of Object.keys(expected))assert.equal(actual[key],expected[key]);
  }
  const draft=calibrationDraft(settings,'touch');draft.profile.fullTravelPx=140;
  assert.equal(settings.devices.touch.unit,'legacy-height');assert.equal(settings.devices.touch.threshold,1.9);
  assert.equal(JSON.stringify(raw),before);
  assert.deepEqual(normalizePreferences(JSON.parse(JSON.stringify(settings))),settings,'versioned legacy adapters survive a preference save');
});

test('invalid settings and input remain finite; profiles and devices are independent',()=>{
  for(const value of [NaN,Infinity,-1,'150',null]){
    const settings=normalizePreferences({version:2,devices:{touch:{version:1,unit:'css-px',fullTravelPx:value}}});
    assert.equal(settings.devices.touch.fullTravelPx,DEFAULT_FULL_TRAVEL_PX);
    settings.devices.touch.fullTravelPx=180;assert.equal(settings.devices.mouse.fullTravelPx,DEFAULT_FULL_TRAVEL_PX);
  }
  assert.equal(inputDevice('__proto__'),'mouse');
  assert.equal(calibratedGestureInput([{x:0,y:0,t:0},{x:0,y:NaN,t:1}],{width:390,height:300},defaultCalibration()),null);
  assert.equal(calibratedGestureInput(points,{width:Infinity,height:300},defaultCalibration()),null);
  assert.equal(calibratedGestureInput([{x:0,y:20,t:0},{x:0,y:20-DEADZONE_PX,t:10}],{width:390,height:300},defaultCalibration()),null);
  assert.equal(calibratedProfile([120,Infinity,130]),null);
});

test('session copies device, profile and rectangle and rejects position or size changes',()=>{
  const event={pointerId:4,clientX:150,clientY:200,timeStamp:0};
  const rect={left:10,top:20,width:300,height:400},profile=defaultCalibration();
  const session=createGestureSession(event,rect,{device:'touch',profile});
  profile.fullTravelPx=99;rect.left=70;
  assert.equal(session.profile.fullTravelPx,DEFAULT_FULL_TRAVEL_PX);assert.equal(session.r.left,10);
  for(const key of ['left','top','width','height'])assert.equal(appendGesturePoint(session,{...event,timeStamp:1},{...session.r,[key]:session.r[key]+1}),false);
  assert.equal(session.points.length,1);
  assert.equal(appendGesturePoint(session,{...event,clientY:80,timeStamp:100},{...session.r}),true);
  assert.deepEqual(session.points.at(-1),{x:140,y:60,t:100});
});

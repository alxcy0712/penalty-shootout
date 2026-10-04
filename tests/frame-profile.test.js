import test from 'node:test';
import assert from 'node:assert/strict';
import {FrameProfile,PROFILE_HISTOGRAM_BUCKETS,formatFrameProfile,updateFrameProfile} from '../src/frame-profile.js';

const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
const start=()=>{const profile=new FrameProfile();profile.setState({},0);profile.summary(0);profile.frame(0);return profile;};
const stageFor=profile=>({frameProfile:profile,mode:'game',currentPixelRatio:1.5,profileAntialias:true,geometryCount:10,
  profile:{textContent:''},renderer:{domElement:{width:390,height:844},info:{render:{calls:9,triangles:99},memory:{geometries:10,textures:4}}}});

test('all finite positive foreground intervals include 250 ms, 300 ms and seconds-long stalls',()=>{
  const p=start();for(const time of [16,266,566,3566])p.frame(time);
  const s=p.summary(3566),f=s.intervals;
  assert.equal(f.count,4);near(f.meanMs,3566/4);assert.equal(f.maxMs,3000);
  assert.deepEqual([f.over50,f.over100,f.over250],[3,3,2]);
  assert.equal(f.p95UpperMs,3000);assert.equal(f.p99UpperMs,3000);
});

test('explicit hidden and resume events exclude a background gap even without a background callback',()=>{
  const p=start();p.frame(16);p.setState({hidden:true},20);p.setState({hidden:false},10020);p.frame(10021);p.frame(10037);
  const s=p.summary(10037);
  assert.equal(s.intervals.count,2);assert.equal(s.intervals.maxMs,16);
  assert.equal(s.durationMs.hidden,10000);assert.equal(s.frames.hidden,0);
  assert.equal(s.transitions.hidden,1);assert.equal(s.transitions.active,1);
});

test('suspended and hidden reasons retain separate ownership until both end',()=>{
  const p=start();p.frame(16);p.setState({suspended:true},20);p.frame(200);
  p.setState({hidden:true},220);p.frame(400);p.setState({suspended:false},500);
  p.frame(800);p.setState({hidden:false},1000);p.frame(1001);p.frame(1017);
  const s=p.summary(1017);
  assert.equal(s.intervals.count,2);assert.equal(s.intervals.maxMs,16);
  assert.equal(s.durationMs.suspended,200);assert.equal(s.durationMs.hidden,780);
  assert.equal(s.frames.suspended,1);assert.equal(s.frames.hidden,2);
});

test('repeated, backward and non-finite timestamps do not distort the valid frame baseline',()=>{
  const p=start();for(const time of [16,16,8,NaN,Infinity,-Infinity,32])p.frame(time);
  const s=p.summary(1000);
  assert.equal(s.intervals.count,2);assert.equal(s.intervals.meanMs,16);
  assert.equal(s.nonIncreasingTimestamps,2);assert.equal(s.invalidTimestamps,3);
});

test('sustained intentional idle and one-off redraws do not become animation FPS samples',()=>{
  const p=start();p.frame(16);p.setState({idle:true},20);
  for(let now=32;now<=12000;now+=16)p.frame(now);
  p.recordRender(4);const during=p.summary(12000);
  assert.equal(during.state,'idle');assert.equal(during.intervals.count,1);
  assert.equal(during.frames.idle,749);assert.equal(during.durationMs.idle,11980);
  assert.equal(during.renderCount,1);assert.equal(during.cpuMeanMs,4);
  p.frame(13000);const later=p.summary(13000);assert.equal(later.intervals.count,0);assert.equal(later.intervals.meanMs,null);
  p.setState({idle:false},14000);p.frame(14001);p.frame(14017);const resumed=p.summary(15000);
  assert.equal(resumed.intervals.count,1);assert.equal(resumed.intervals.maxMs,16);
});

test('redundant state reports do not reset active sampling',()=>{
  const p=start();p.setState({hidden:false,idle:false,suspended:false},15);p.frame(16);
  p.setState({idle:false},32);p.frame(32);const s=p.summary(1000);
  assert.equal(s.intervals.count,2);assert.equal(s.intervals.meanMs,16);
  assert.deepEqual(s.transitions,{active:0,hidden:0,suspended:0,idle:0});
});

test('histogram storage stays fixed and every sample contributes beyond its bucket count',()=>{
  const p=start(),count=100000;let stamp=0;
  for(let i=1;i<=count;i++){stamp+=i===1?4000:1;p.frame(stamp);}
  assert.equal(p.intervals.buckets.length,PROFILE_HISTOGRAM_BUCKETS);
  assert.equal(p.intervals.buckets.reduce((sum,n)=>sum+n,0),count);
  const s=p.summary(stamp);assert.equal(s.intervals.count,count);assert.equal(s.intervals.maxMs,4000);
  near(s.intervals.meanMs,(count-1+4000)/count);assert.equal(s.intervals.over250,1);
  assert.ok(s.intervals.p95UpperMs>=1&&s.intervals.p95UpperMs<1.045);
  assert.equal(p.intervals.buckets.length,PROFILE_HISTOGRAM_BUCKETS);assert.equal(p.intervals.buckets.reduce((sum,n)=>sum+n,0),0);
});

test('histogram percentiles are honest upper bounds with all observations represented',()=>{
  const p=start(),values=[];let stamp=0;
  for(let i=1;i<=200;i++){const ms=i*2.7;values.push(ms);stamp+=ms;p.frame(stamp);}
  const s=p.summary(stamp);
  for(const [fraction,key] of [[.95,'p95UpperMs'],[.99,'p99UpperMs']]){
    const exact=values[Math.ceil(values.length*fraction)-1];
    assert.ok(s.intervals[key]>=exact);assert.ok(s.intervals[key]<=exact*2**(1/16));
  }
});

test('extreme finite intervals are retained in the bounded overflow bucket',()=>{
  const p=start();p.frame(Number.MAX_VALUE);const s=p.summary(1000);
  assert.equal(s.intervals.count,1);assert.equal(s.intervals.meanMs,Number.MAX_VALUE);
  assert.equal(s.intervals.maxMs,Number.MAX_VALUE);assert.equal(s.intervals.p99UpperMs,Number.MAX_VALUE);
  assert.doesNotMatch(formatFrameProfile(s,stageFor(p)),/Infinity/);
});

test('report windows throttle to one second and preserve an interval spanning their boundary',()=>{
  const p=start();p.frame(500);assert.equal(p.summary(999),null);
  const first=p.summary(1000);assert.equal(first.intervals.count,1);assert.equal(first.intervals.meanMs,500);
  assert.equal(p.summary(1000),null);p.frame(1200);p.frame(1800);
  const second=p.summary(2000);assert.equal(second.intervals.count,2);assert.equal(second.intervals.meanMs,650);
  const empty=p.summary(3000);assert.equal(empty.intervals.count,0);assert.equal(empty.intervals.p95UpperMs,null);
  assert.equal(empty.windowMs,1000);assert.equal(empty.durationMs.active,1000);
});

test('CPU submission is independent of intervals, accepts zero, and excludes invalid values',()=>{
  const p=start();for(const cpu of [0,2,4,NaN,-1,Infinity])p.recordRender(cpu);
  const s=p.summary(1000);assert.equal(s.intervals.count,0);assert.equal(s.renderCount,6);assert.equal(s.cpuCount,3);
  assert.equal(s.cpuMeanMs,2);assert.equal(s.cpuMaxMs,4);assert.equal(s.invalidCpuSamples,3);
});

test('summary output clears stale FPS during idle and writes DOM at most once per second',()=>{
  const p=new FrameProfile(),stage=stageFor(p);let writes=0,text='';
  Object.defineProperty(stage.profile,'textContent',{get:()=>text,set:value=>{text=value;writes++;}});
  updateFrameProfile(stage,0);p.frame(0);p.frame(16);updateFrameProfile(stage,999);assert.equal(writes,1);
  updateFrameProfile(stage,1000);assert.equal(writes,2);assert.match(text,/FPS 62.5/);
  p.setState({idle:true},1000);p.frame(2000);updateFrameProfile(stage,2000);
  assert.equal(writes,3);assert.match(text,/主动闲置/);assert.match(text,/FPS —/);assert.match(text,/rAF 样本 0/);
  assert.match(text,/非 GPU 时间/);assert.match(text,/最近绘制含阴影 9/);
});

test('profile output labels percentile bounds, raw rAF source and reporting window',()=>{
  const p=start();p.frame(16);p.frame(316);const text=formatFrameProfile(p.summary(1000),stageFor(p));
  assert.match(text,/P95≤/);assert.match(text,/P99≤/);assert.match(text,/前台 rAF FPS/);
  assert.match(text,/窗口 1.0 s/);assert.match(text,/长帧 >50\/>100\/>250 ms 1\/1\/1/);
  assert.match(text,/CPU 更新\+提交/);
});

test('diagnostics are absent and do no work without the opt-in profile',()=>{
  assert.equal(updateFrameProfile(null,1000),null);assert.equal(updateFrameProfile({},1000),null);
  assert.equal(updateFrameProfile({frameProfile:{summary(){throw new Error('must not sample');}}},1000),null);
  assert.throws(()=>new FrameProfile({intervalMs:100}),RangeError);
});

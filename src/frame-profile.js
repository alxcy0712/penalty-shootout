// Opt-in diagnostics only. The caller supplies the browser rAF timestamp for
// frame intervals; performance.now() is used for state durations/CPU submission.
// They share a document time origin but are deliberately never subtracted from
// each other. A state transition discards only the cross-transition interval.
export const PROFILE_INTERVAL_MS=1000;
export const PROFILE_HISTOGRAM_BUCKETS=2048;
// Fixed 16 KiB storage. In the ordinary rAF range each percentile bin is at
// most 2**(1/16)-1 (~4.43%) wide; labels explicitly show upper bounds, not
// exact order statistics. Underflow/overflow remain counted, without a cap.
const BINS_PER_OCTAVE=16, ZERO_BUCKET=256;
const STATES=['active','hidden','suspended','idle'];
const effectiveState=flags=>flags.hidden?'hidden':flags.suspended?'suspended':flags.idle?'idle':'active';
const emptyStates=()=>Object.fromEntries(STATES.map(state=>[state,0]));

class IntervalStats {
  constructor(){this.buckets=new Float64Array(PROFILE_HISTOGRAM_BUCKETS);this.reset();}
  reset(){this.buckets.fill(0);this.count=0;this.meanMs=0;this.maxMs=0;this.over50=0;this.over100=0;this.over250=0;}
  add(ms){
    this.count++;this.meanMs+=(ms-this.meanMs)/this.count;this.maxMs=Math.max(this.maxMs,ms);
    if(ms>50)this.over50++;if(ms>100)this.over100++;if(ms>250)this.over250++;
    const bucket=Math.max(0,Math.min(this.buckets.length-1,Math.floor(Math.log2(ms)*BINS_PER_OCTAVE)+ZERO_BUCKET));
    this.buckets[bucket]++;
  }
  percentileUpperBound(fraction){
    if(!this.count)return null;
    const rank=Math.ceil(this.count*fraction);let count=0;
    for(let bucket=0;bucket<this.buckets.length;bucket++){
      count+=this.buckets[bucket];
      if(count>=rank){
        // Overflow has no finite bin edge. The observed maximum is still an
        // exact finite upper bound, so even arbitrarily long stalls survive.
        const edge=bucket===this.buckets.length-1?this.maxMs:2**((bucket+1-ZERO_BUCKET)/BINS_PER_OCTAVE);
        return Math.min(this.maxMs,edge);
      }
    }
    return this.maxMs;
  }
  snapshot(){return {count:this.count,meanMs:this.count?this.meanMs:null,maxMs:this.count?this.maxMs:null,
    p95UpperMs:this.percentileUpperBound(.95),p99UpperMs:this.percentileUpperBound(.99),
    over50:this.over50,over100:this.over100,over250:this.over250};}
}

export class FrameProfile {
  constructor({intervalMs=PROFILE_INTERVAL_MS}={}){
    if(!Number.isFinite(intervalMs)||intervalMs<PROFILE_INTERVAL_MS)throw new RangeError('Profile summaries must be at least one second apart');
    this.intervalMs=intervalMs;this.intervals=new IntervalStats();this.flags={hidden:false,suspended:false,idle:false};
    this.state='active';this.lastFrame=null;this.lastStateTime=null;this.windowStarted=null;this.lastSummary=null;
    this.resetWindow();
  }
  resetWindow(){
    this.intervals.reset();this.frames=emptyStates();this.durationMs=emptyStates();this.transitions=emptyStates();
    this.renderCount=0;this.cpuCount=0;this.cpuMeanMs=0;this.cpuMaxMs=0;this.invalidTimestamps=0;this.nonIncreasingTimestamps=0;this.invalidCpuSamples=0;
  }
  accountTime(now){
    if(!Number.isFinite(now))return;
    if(this.windowStarted===null)this.windowStarted=now;
    if(this.lastStateTime!==null&&now>this.lastStateTime)this.durationMs[this.state]+=now-this.lastStateTime;
    if(this.lastStateTime===null||now>this.lastStateTime)this.lastStateTime=now;
  }
  // Partial flag updates let visibility and graphics lifecycle keep ownership
  // of their own reasons. Hidden takes precedence over suspended, then idle.
  setState(flags,now){
    this.accountTime(now);let changed=false;
    for(const key of ['hidden','suspended','idle'])if(key in flags&&this.flags[key]!==!!flags[key]){this.flags[key]=!!flags[key];changed=true;}
    if(changed){
      const state=effectiveState(this.flags);
      if(state!==this.state)this.transitions[state]++;
      this.state=state;this.lastFrame=null;
    }
  }
  frame(rafTimestamp){
    if(!Number.isFinite(rafTimestamp)){this.invalidTimestamps++;return;}
    this.frames[this.state]++;
    if(this.state!=='active'){this.lastFrame=null;return;}
    if(this.lastFrame!==null){
      const interval=rafTimestamp-this.lastFrame;
      // Repeated/backward callbacks neither create a frame nor move the
      // baseline backward. No magnitude threshold may discard a valid stall.
      if(interval<=0){this.nonIncreasingTimestamps++;return;}
      if(Number.isFinite(interval))this.intervals.add(interval);
      else this.invalidTimestamps++;
    }
    this.lastFrame=rafTimestamp;
  }
  recordRender(cpuSubmissionMs){
    this.renderCount++;
    if(!Number.isFinite(cpuSubmissionMs)||cpuSubmissionMs<0){this.invalidCpuSamples++;return;}
    this.cpuCount++;this.cpuMeanMs+=(cpuSubmissionMs-this.cpuMeanMs)/this.cpuCount;this.cpuMaxMs=Math.max(this.cpuMaxMs,cpuSubmissionMs);
  }
  // Consume one reporting window at most once/second. Intervals belong to the
  // window containing their ending callback, including a stall crossing the
  // boundary. The frame baseline survives reporting; lifecycle changes reset it.
  summary(now){
    if(!Number.isFinite(now))return null;
    this.accountTime(now);
    if(this.lastSummary!==null&&now-this.lastSummary<this.intervalMs)return null;
    const result={state:this.state,windowMs:Math.max(0,now-this.windowStarted),intervals:this.intervals.snapshot(),
      frames:{...this.frames},durationMs:{...this.durationMs},transitions:{...this.transitions},
      renderCount:this.renderCount,cpuCount:this.cpuCount,cpuMeanMs:this.cpuCount?this.cpuMeanMs:null,cpuMaxMs:this.cpuCount?this.cpuMaxMs:null,
      invalidTimestamps:this.invalidTimestamps,nonIncreasingTimestamps:this.nonIncreasingTimestamps,invalidCpuSamples:this.invalidCpuSamples};
    this.lastSummary=now;this.windowStarted=now;this.resetWindow();return result;
  }
}

const ms=value=>value===null?'—':value.toFixed(2);
const stateLabel={active:'前台动画',hidden:'后台',suspended:'图形中断',idle:'主动闲置'};
export function formatFrameProfile(summary,stage){
  const {intervals,frames,durationMs}=summary,info=stage.renderer.info;
  const upper=value=>value===null?'—':(value<Number.MAX_VALUE/100?Math.ceil(value*100)/100:value).toFixed(2);
  const fps=intervals.count?(1000/intervals.meanMs).toFixed(1):'—';
  return `${stage.mode==='hero'?`首页镜头 ${((stage.homeTime??0)%20).toFixed(1)} s\n`:''}`+
    `画布 ${stage.renderer.domElement.width}×${stage.renderer.domElement.height} · DPR ${(Number.isFinite(stage.currentPixelRatio)?stage.currentPixelRatio.toFixed(2):'未知')} · MSAA ${stage.profileAntialias===null?'未知':stage.profileAntialias?'开启':'未启用'}\n`+
    `${stateLabel[summary.state]} · 窗口 ${(summary.windowMs/1000).toFixed(1)} s · rAF 样本 ${intervals.count}\n`+
    `前台 rAF FPS ${fps} · 间隔均值 ${ms(intervals.meanMs)} ms\n`+
    `P95≤${upper(intervals.p95UpperMs)} / P99≤${upper(intervals.p99UpperMs)} · 最大 ${ms(intervals.maxMs)} ms\n`+
    `长帧 >50/>100/>250 ms ${intervals.over50}/${intervals.over100}/${intervals.over250}\n`+
    `后台/中断/闲置 ${(durationMs.hidden/1000).toFixed(1)}/${(durationMs.suspended/1000).toFixed(1)}/${(durationMs.idle/1000).toFixed(1)} s · 跳过 rAF ${frames.hidden}/${frames.suspended}/${frames.idle}\n`+
    `CPU 更新+提交 ${ms(summary.cpuMeanMs)} ms · 绘制 ${summary.renderCount} 次 · 非 GPU 时间\n`+
    `最近绘制含阴影 ${info.render.calls} · 三角形 ${info.render.triangles}\n`+
    `几何体 ${info.memory.geometries}/${stage.geometryCount} · 纹理 ${info.memory.textures}`;
}

// Kept outside Stadium.update so an intentional no-render frame still clears
// stale FPS and displays the idle/hidden/suspended state at the same low rate.
export function updateFrameProfile(stage,now){
  if(!stage?.profile||!stage.frameProfile)return null;
  const summary=stage.frameProfile.summary(now);
  if(summary)stage.profile.textContent=formatFrameProfile(summary,stage);
  return summary;
}

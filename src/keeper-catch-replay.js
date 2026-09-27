import {Shot} from './engine.js';
import {blendKeeperPose, holdingPose, HOLD_DURATION} from './anatomy.js';

// Record an actual successful simulation, then replay its contact and hold events.
// The renderer consumes these positions; it never changes the shot result.
export function createKeeperCatchReplay(direction=1) {
  const stats={accuracy:90,power:90,touch:90,composure:90,speed:80,reach:80,handling:95};
  const shot=new Shot({x:Math.sin(59)*3.3*direction,power:.9,y:1.3},stats,stats,direction,59);
  const frames=[{pose:structuredClone(shot.pose),ball:{...shot.ball}}];
  for(let n=0;n<3600&&!shot.result;n++){
    shot.step(1/120);frames.push({pose:structuredClone(shot.pose),ball:{...shot.ball}});
  }
  const start=Math.max(0,shot.t-.45),contact=shot.t-start;
  return {
    contact,duration:contact+3,caught:shot.caught,result:shot.result,
    sample(time){
      const t=Math.max(0,time)+start;
      if(t<shot.t){
        const cursor=Math.min(frames.length-1,t*120),i=Math.floor(cursor),q=cursor-i;
        const a=frames[i],b=frames[Math.min(i+1,frames.length-1)];
        return {pose:blendKeeperPose(a.pose,b.pose,q,false),ball:Object.fromEntries(['x','y','z'].map(k=>[k,a.ball[k]+(b.ball[k]-a.ball[k])*q])),phase:'来球 · 物理回放'};
      }
      const elapsed=t-shot.t,raw=shot.poseAt(t),held=holdingPose(raw,elapsed/HOLD_DURATION);
      const ball={};
      for(const key of ['x','y','z']){
        const from=shot.ball[key]+held.pose.shoulder[key]-shot.pose.shoulder[key];
        ball[key]=from+(held.center[key]-from)*held.weight;
      }
      return {pose:held.pose,ball,phase:elapsed<HOLD_DURATION?'接触 · 缓冲收球':'抱球 · 恢复平衡'};
    },
  };
}

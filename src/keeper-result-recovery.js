import {body,HOLD_DURATION,goalkeeperPose,supportedKeeperPose,blendKeeperPose} from './anatomy.js';

const smooth=value=>{const q=Math.max(0,Math.min(1,value));return q*q*q*(q*(q*6-15)+10);};
const quietTorsoChannels=['curl','twist','sideBend','headCurl','armRelax','braceL','braceR'];
// At elapsed zero the set stance is independent of player statistics. This is
// an immutable authored reference, not a previous-frame or cross-rig cache.
const ready=goalkeeperPose({speed:99},0,0,1);
const vector=(a,b)=>({x:b.x-a.x,y:b.y-a.y,z:b.z-a.z});
const lerp=(a,b,q)=>({x:a.x+(b.x-a.x)*q,y:a.y+(b.y-a.y)*q,z:a.z+(b.z-a.z)*q});
function segment(from,to,q){
  const a=Math.hypot(from.x,from.y,from.z),b=Math.hypot(to.x,to.y,to.z);
  const angle=Math.acos(Math.max(-1,Math.min(1,(from.x*to.x+from.y*to.y+from.z*to.z)/(a*b))));
  if(angle<1e-6)return lerp(from,to,q);
  const sine=Math.sin(angle),left=Math.sin((1-q)*angle)/sine,right=Math.sin(q*angle)/sine;
  return {x:from.x*left+to.x*right,y:from.y*left+to.y*right,z:from.z*left+to.z*right};
}
function risePose(from,to,q){
  if(q<=0)return from;if(q>=1)return to;
  const pose=blendKeeperPose(from,to,q,false);
  // Carry the actual captured segment rotations into the set stance. Feeding
  // constrained wrists back through a new elbow pole would jump at onset.
  for(let i=0;i<2;i++){
    const root=lerp(from.shoulders[i],to.shoulders[i],q);
    const upper=segment(vector(from.shoulders[i],from.elbows[i]),vector(to.shoulders[i],to.elbows[i]),q);
    const lower=segment(vector(from.elbows[i],from.hands[i]),vector(to.elbows[i],to.hands[i]),q);
    pose.shoulders[i]=root;pose.elbows[i]={x:root.x+upper.x,y:root.y+upper.y,z:root.z+upper.z};
    pose.hands[i]={x:pose.elbows[i].x+lower.x,y:pose.elbows[i].y+lower.y,z:pose.elbows[i].z+lower.z};
  }
  return pose;
}

// An authored result-only return to the existing set stance: secure the ball,
// finish any interrupted support step, then extend the knees under the torso.
// Sampling depends only on the captured pose and clock, never earlier frames.
export function keeperResultRecovery(source,elapsed,caught){
  // Both sole phases finish before the body rise. Only the fully released
  // torso/arm channels together identify the authored free-recovery endpoint.
  // Retain its calibrated low ankles, flat soles and supported final frame.
  const torso=source.torso;
  if(torso?.soleL===1&&torso.soleR===1&&
    quietTorsoChannels.every(key=>torso[key]===0))return source;
  const after=elapsed-(caught?HOLD_DURATION:.12);
  if(after<=0)return source;
  const feet=source.feet.map(foot=>({...foot,y:.075}));
  const x=(feet[0].x+feet[1].x)/2,z=(feet[0].z+feet[1].z)/2;
  // Leave a small extension margin for the rig's changing hip axis. A wide
  // captured stance must lower the hip rather than lift an unreachable boot.
  const reach=body.thigh+body.shin-.025;
  const standingY=Math.min(.83,...feet.map((foot,i)=>.075+Math.sqrt(Math.max(0,reach*reach-(foot.x-x-(i?1:-1)*body.hipWidth/2)**2-(foot.z-z)**2))));
  const standing=supportedKeeperPose(ready,{x,y:standingY,z},feet);
  const raised=source.feet.map((foot,i)=>({i,y:foot.y})).filter(foot=>foot.y>.075001).sort((a,b)=>a.y-b.y);
  if(after>=raised.length*.18+1.1)return standing;
  if(!raised.length)return risePose(source,standing,smooth(after/1.1));

  // Land the lower boot first while bringing the pelvis over the support
  // midpoint. The other boot follows before any rise; planted boots never slide.
  const settleDuration=raised.length*.18,settle=smooth(after/settleDuration);
  const supports=source.feet.map(foot=>({...foot}));
  raised.forEach(({i},order)=>{supports[i].y+=(.075-supports[i].y)*smooth((after-order*.18)/.18);});
  const supportY=Math.min(source.hip.y,standingY-.09);
  const supported=supportedKeeperPose(source,{x:source.hip.x+(x-source.hip.x)*settle,y:source.hip.y+(supportY-source.hip.y)*settle,z:source.hip.z+(z-source.hip.z)*settle},supports);
  if(after<=settleDuration)return supported;
  return risePose(supported,standing,smooth((after-settleDuration)/1.1));
}

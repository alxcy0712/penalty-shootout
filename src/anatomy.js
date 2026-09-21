// Metres, right-handed coordinates. Both rendering and collisions consume this rig.
export const body = { thigh:.43, shin:.43, upperArm:.29, forearm:.27, torso:.49, shoulderWidth:.39, hipWidth:.25 };
export const HOLD_DURATION=.36;
const v=(x=0,y=0,z=0)=>({x,y,z});
const add=(a,b)=>v(a.x+b.x,a.y+b.y,a.z+b.z);
const sub=(a,b)=>v(a.x-b.x,a.y-b.y,a.z-b.z);
const mul=(a,s)=>v(a.x*s,a.y*s,a.z*s);
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const len=a=>Math.hypot(a.x,a.y,a.z);
const unit=a=>mul(a,1/(len(a)||1));
const clip=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=x=>{x=clip(x,0,1);return x*x*(3-2*x);};
const lerp=(a,b,t)=>add(a,mul(sub(b,a),t));
// Two-bone IK: fixed lengths, reachable targets and an explicit anatomical bend pole.
export function limb(root,target,pole,a,b) {
  const delta=sub(target,root),direction=len(delta)>1e-6?unit(delta):v(0,-1,0);
  const distance=clip(len(delta),Math.abs(a-b)+.025,a+b-.008);
  const end=add(root,mul(direction,distance));
  let perpendicular=sub(sub(pole,root),mul(direction,dot(sub(pole,root),direction)));
  if(len(perpendicular)<1e-5)perpendicular=sub(v(0,0,1),mul(direction,direction.z));
  const along=(a*a-b*b+distance*distance)/(2*distance);
  const center=add(root,mul(direction,along)),radius=Math.sqrt(Math.max(0,a*a-along*along));
  let joint=add(center,mul(unit(perpendicular),radius));
  // Project onto the nearest allowed arc of the joint's IK circle. This preserves
  // the original bend direction until actual contact and avoids a pole flip.
  if(joint.y<.075){
    const upward=unit(sub(v(0,1,0),mul(direction,direction.y)));
    const bend=unit(perpendicular),cosine=clip((.075-center.y)/(radius*upward.y||1),-1,1);
    let sideways=sub(bend,mul(upward,dot(bend,upward)));
    if(len(sideways)<1e-6)sideways=v(direction.z,0,-direction.x);
    joint=add(center,mul(add(mul(upward,cosine),mul(unit(sideways),Math.sqrt(1-cosine*cosine))),radius));
  }
  return {joint,end};
}
function rig(hip,up,feet,hands,facing=-1,roll=0,yaw=0,armTuck=0) {
  up=unit(up);let right=unit(v(up.y,-up.x,0));
  const rotate=p=>v(p.x*Math.cos(yaw)+p.z*Math.sin(yaw),p.y,-p.x*Math.sin(yaw)+p.z*Math.cos(yaw));
  up=rotate(up);right=rotate(right);const forward=rotate(v(0,0,facing));
  const shoulder=add(hip,mul(up,body.torso));
  const p={hip,shoulder,head:add(shoulder,mul(up,.245)),up,right,forward,roll,shoulders:[],hips:[],elbows:[],knees:[],hands:[],feet:[]};
  for(let i=0;i<2;i++){
    const sign=i?1:-1;
    const sr=add(shoulder,mul(right,sign*body.shoulderWidth/2)),hr=add(hip,mul(right,sign*body.hipWidth/2));
    const kneePole=add(hr,add(mul(forward,.65),mul(right,sign*.07)));
    // As the hip approaches the turf, fold the knee above it to avoid a ground-side IK flip.
    kneePole.y+=.60*(1-smooth((hr.y-.15)/.40));
    const leg=limb(hr,feet[i],kneePole,body.thigh,body.shin);
    const armPole=add(sr,add(mul(right,sign*(.45-.33*armTuck)),mul(forward,-.35)));
    armPole.y+=.15*(1-smooth((sr.y-.25)/.65));
    armPole.y-=.45*smooth((hands[i].y-sr.y)/.35)*smooth((up.y-.55)/.35);
    const arm=limb(sr,hands[i],armPole,body.upperArm,body.forearm);
    p.shoulders.push(sr);p.hips.push(hr);p.knees.push(leg.joint);p.feet.push(leg.end);p.elbows.push(arm.joint);p.hands.push(arm.end);
  }
  return p;
}
// The final 0.55 seconds share the same plant and ball-contact animation.
export const penaltyStyles=[
  {name:'短步直线',duration:1.55,distance:1.35,side:0,steps:4},
  {name:'斜向助跑',duration:1.75,distance:1.65,side:.55,steps:4},
  {name:'碎步调整',duration:1.8,distance:1.3,side:.15,steps:6},
];
export function penaltyStyle(player){return penaltyStyles[(player?.number??0)%penaltyStyles.length];}
export function strikerRunupPose(time,phase,after,power,targetX,style=penaltyStyles[0]){
  const elapsed=clip(phase,0,1)*style.duration,approach=style.duration-.55;
  if(after>=0||elapsed>=approach)return strikerPose(time,clip((elapsed-approach)/.55,0,1),after,power,targetX,.7);
  const clock=elapsed/approach,q=.7*clock+.3*clock*clock,step=Math.min(style.steps-1,Math.floor(q*style.steps)),u=q*style.steps-step;
  const base=[v(-.36,.075,11.82),v(-.03,.075,12.05)];
  const offset=progress=>v(style.side*(1-progress),0,style.distance*(1-progress));
  const planted=(i,step)=>{const last=step-1-((step-1-i+2)%2);return add(base[i],offset(last<0?0:Math.min(style.steps,last+2)/style.steps));};
  const feet=base.map((foot,i)=>{
    const from=planted(i,step);
    if(step%2!==i)return from;
    const to=add(foot,offset(Math.min(1,(step+2)/style.steps)));
    const ease=u*u*u*(u*(u*6-15)+10);
    const result=lerp(from,to,ease);result.y+=Math.pow(Math.sin(Math.PI*u),4)*.12;return result;
  });
  // Both feet finish at the original gather stance; alternate fixed supports.
  const centerAt=n=>mul(add(planted(0,n),planted(1,n)),.5);
  const from=centerAt(step),to=centerAt(step+1);
  // Shared tangents carry the pelvis through each footfall without a speed jump.
  const incoming=step===0?v():mul(sub(to,centerAt(step-1)),.5);
  const outgoing=step===style.steps-1?v(0,0,-.7*approach/(style.steps*1.3)):mul(sub(centerAt(step+2),from),.5);
  const center=add(add(mul(from,2*u*u*u-3*u*u+1),mul(to,-2*u*u*u+3*u*u)),add(mul(incoming,u*u*u-2*u*u+u),mul(outgoing,u*u*u-u*u)));
  const activity=Math.pow(Math.sin(Math.PI*q),2);
  const hip=v(center.x-.035,.85-.035*activity-.025*Math.pow(Math.sin(Math.PI*u),4)+Math.sin(time*1.8)*.008,center.z+.085);
  for(let i=0;i<2;i++){
    const horizontal=Math.hypot(feet[i].x-hip.x-(i?1:-1)*body.hipWidth/2,feet[i].z-hip.z);
    const ceiling=feet[i].y+Math.sqrt(Math.max(.1,Math.pow(.84-.035*activity,2)-horizontal*horizontal));
    // Ease into the leg-reach constraint; a hard minimum snaps the knee velocity.
    const width=.08*activity+1e-9,blend=Math.max(width-Math.abs(hip.y-ceiling),0)/width;
    hip.y=Math.min(hip.y,ceiling)-blend*blend*width/4;
  }
  const up=v(-.035+style.side*.08*activity,1,-.10-.16*activity),shoulder=add(hip,mul(unit(up),body.torso)),swing=Math.sin((q*style.steps-.5)*Math.PI)*.24*activity;
  const hands=[add(shoulder,v(-.28+.09*activity,-.46+.16*activity,.08-.20*activity+swing)),add(shoulder,v(.28-.09*activity,-.46+.16*activity,-.07-.12*activity-swing))];
  return rig(hip,up,feet,hands,-1,0,0,activity);
}
export function strikerPose(time=0,phase=0,after=-1,power=.7,targetX=0,approachSpeed=0) {
  const footSpeed=5+13*clip(power,0,1),followDistance=.36+.16*clip(power,0,1),followDuration=3*followDistance/footSpeed;
  const angle=Math.atan2(clip(targetX,-5,5),11),dx=Math.sin(angle),dz=Math.cos(angle),contact=v(-.15*dx,.115,11+.15*dz);
  // phase 0..1: gather -> plant -> swing. Contact at phase 1 / after 0.
  const q=smooth(phase),plantTime=.62,step=smooth(phase/plantTime),drive=smooth((phase-plantTime)/(1-plantTime));
  const breath=Math.sin(time*1.8)*.008*(1-smooth(phase/.16));
  const z=12.02-.54*step-.14*drive-approachSpeed*.55*phase*(1-phase)**4;
  let hip=v(-.23,.85-.17*step+.15*drive+breath,z),up=v(-.035,1,-.10-.10*q);
  // Right foot supports the approach. The left foot lands before the right lifts.
  const feet=[lerp(v(-.36,.075,11.82),v(-.28,.075,11.02),step),v(-.03,.075,12.05)];
  feet[0].y+=Math.sin(Math.PI*step)*.12;
  const backswing=smooth((phase-plantTime)/.15);
  feet[1]=lerp(v(-.03,.075,12.05),v(-.03,.30,12.14),backswing);
  if(phase>.77){
    const back=v(-.03,.30,12.14),u=clip((phase-.77)/.23,0,1);
    const tangent=u*u*(u-1)*footSpeed*.55*.23;
    feet[1]=lerp(back,contact,smooth(u));feet[1].x+=dx*tangent;feet[1].z-=dz*tangent;
  }
  if(after>=0){
    const follow=smooth(after/.22),settle=smooth((after-followDuration-.12)/.6);
    hip=v(-.23,.83-.035*Math.sin(Math.PI*follow),11.34-.12*follow);
    feet[0]=v(-.28,.075,11.02);
    const swing=clip(after/followDuration,0,1);
    const travel=followDistance*(1-Math.pow(1-swing,3));
    feet[1]=lerp(v(contact.x+.03*smooth(swing)+dx*travel,.115+.365*smooth(swing),contact.z-dz*travel),v(.10+dx*.14,.075,10.88),settle);
    up=v(-.035-.025*follow,1,-.2+.13*settle);
  }
  const shoulder=add(hip,mul(unit(up),body.torso));
  const balance=smooth(phase/.6)*(after>=0?1-smooth((after-.15)/.75):1);
  const hands=[add(shoulder,v(-.28-.32*balance,-.46+.24*balance,.08)),add(shoulder,v(.28+.02*balance,-.46+.03*balance,-.07+.15*balance))];
  const yaw=(.22-angle*.5)*smooth(phase)*(after>=0?1-smooth(after/.82):1);
  const pose=rig(hip,up,feet,hands,-1,0,yaw);
  pose.feetYaw=[0,-angle*smooth((phase-.62)/.15)*(after>=0?1-smooth((after-.2)/.7):1)];
  return pose;
}
// Lobby-only warm-up: grounded weight shifts, a small squat and arm stretches.
export function keeperWarmupPose(time){
  const breath=Math.sin(time*1.7),shift=Math.sin(time*.65),stretch=smooth((Math.sin(time*.55)-.15)/.85),load=smooth((Math.sin(time*.55+Math.PI)-.2)/.8);
  const hip=v(.085*shift,.85+.012*breath-.10*load,.04),up=v(-.045*shift,1,.09+.10*load);
  const hands=[-1,1].map(side=>v(hip.x+side*(.26+.24*stretch),.98+.44*stretch+.012*breath,.30+.07*load));
  return rig(hip,up,[v(-.30,.075,.04),v(.30,.075,.04)],hands,1,0,0,.55);
}

export function goalkeeperPose(stats,direction=0,elapsed=0,height=1) {
  const t=Math.max(0,elapsed),sign=direction||1;
  if(!direction){
    const response=clip(stats.speed/99,0,1),delay=.06+.12*(1-response),duration=.18+.12*(1-response);
    const reach=smooth((t-delay)/duration),low=1-smooth((height-.3)/.65),hip=v(0,.83-.53*low*reach,.04),up=v(0,1,.08+.46*low*reach),y=1.05+(clip(height-.12*low,.16,1.9)-1.05)*reach,width=.35-.255*reach;
    return rig(hip,up,[v(-.30,.075,.04),v(.30,.075,.04)],[v(-width,y,.30),v(width,y,.30)],1);
  }
  const stretch=clip(stats.stretch??0,0,1),push=.13,air=Math.max(0,t-push),high=clip((height-.35)/1.7,0,1),vy=.7+high*(2.1+1.1*stretch);
  const launchY=.83,landY=.27;
  const landing=(vy+Math.sqrt(vy*vy+2*9.81*(launchY-landY)))/9.81;
  const velocity=stats.diveVelocity??(3.2+clip(stats.speed/99,0,1)*1.1+.9*stretch);
  const launchX=.16;
  let x,y,angle;
  if(t<push){const q=t/push;x=launchX*q*q+(velocity*push-2*launchX)*q**8*(q-1);y=.83-.06*Math.sin(Math.PI*q)**2+vy*push*q*q*(q-1);angle=.22*smooth(q);}
  else {const flight=Math.min(air,landing),slide=Math.max(0,air-landing);x=launchX+velocity*flight+velocity*.16*(1-Math.exp(-slide/ .16));y=Math.max(landY,launchY+vy*flight-4.905*flight*flight);angle=.22+(Math.PI/2-.22)*smooth(flight/Math.min(.42,landing));}
  const forwardTravel=.42*smooth(t/.42);
  const up=v(sign*Math.sin(angle),Math.cos(angle),.04),hip=v(sign*x,y,.04+forwardTravel);
  const right=v(Math.cos(angle),-sign*Math.sin(angle),0);
  const shoulder=add(hip,mul(unit(up),body.torso));
  const extension=smooth((t-.08)/.24),armReach=.28+.25*extension*(.85+.15*stats.reach/99);
  const hands=[-1,1].map((s,i)=>{
    const target=add(shoulder,v(sign*armReach,clip(height-shoulder.y,-.34,.40)+(i? .08:-.04),.21));
    const root=add(shoulder,mul(right,s*body.shoulderWidth/2));
    const extended=add(root,mul(unit(v(sign,clip(height-root.y,-.8,1.1),.16)),body.upperArm+body.forearm-.01));
    return lerp(v(s*.35,1.05,.30+forwardTravel),lerp(target,extended,stretch*smooth(air/.22)*(1-smooth((air-landing)/.18))),smooth(t/.30));
  });
  const feet=[-1,1].map(s=>{
    if(t<push)return v(s*.30,.075,.04);
    const airborne=add(add(hip,mul(unit(up),-.67)),add(mul(right,s*.16),v(0,.06,.10+s*.07)));
    return lerp(v(s*.30,.075,.04),airborne,smooth(air/.17));
  });
  // At ground contact use the side of the thigh and forearm as support, feet clear turf.
  feet.forEach(f=>f.y=Math.max(.075,f.y));
  const recoveryTime=t-push-landing-.45;
  if(recoveryTime>0){
    // Keep the shoulder down while tucking the feet; transfer weight only after
    // the feet arrive. The curved ankle path avoids folding the heel into the hip.
    const tuck=smooth(recoveryTime/.40),bodyTuck=smooth((recoveryTime-.40)/.48),rise=smooth((recoveryTime-.88)/.85);
    const baseX=sign*(launchX+velocity*landing+velocity*.16);
    const crouchUp=unit(v(sign*.8,.6,.16));
    const liftedHip=v(hip.x,.27+.10*bodyTuck+.46*rise,hip.z);
    const recoveryUp=lerp(lerp(up,crouchUp,bodyTuck),v(0,1,.08),rise);
    const planted=[v(baseX-.28,.075,hip.z),v(baseX+.28,.075,hip.z)];
    const support=[v(baseX+sign*.43,.09,hip.z+.19),v(baseX+sign*.25,.12,hip.z+.28)];
    const resting=[v(baseX-.35,1.05,hip.z+.26),v(baseX+.35,1.05,hip.z+.26)];
    const handRelease=smooth((recoveryTime-1.00)/.65);
    const tuckedFeet=feet.map((f,i)=>{const target=lerp(f,planted[i],tuck);target.z+=.24*Math.sin(Math.PI*tuck);return target;});
    return rig(liftedHip,recoveryUp,tuckedFeet,hands.map((h,i)=>lerp(lerp(h,support[i],bodyTuck),resting[i],handRelease)),1,sign*angle*(1-bodyTuck));
  }
  return rig(hip,up,feet,hands,1,sign*angle);
}

// A wrong-footed keeper brakes while the feet are still supporting the body.
export function keeperHesitationPose(origin,direction,elapsed){
  const hip=v(origin.hip.x+direction*.07,.68,origin.hip.z);
  const hands=[-1,1].map(side=>v(hip.x+side*.22,.94,hip.z+.25));
  const brace=rig(hip,v(direction*.12,1,.15),origin.feet,hands,1);
  const stand=rig(v(hip.x,.80,hip.z),v(0,1,.08),origin.feet,[-1,1].map(side=>v(hip.x+side*.32,1.05,hip.z+.26)),1);
  const stopped=blendKeeperPose(origin,brace,elapsed/.16);
  return blendKeeperPose(stopped,stand,(elapsed-.55)/.35);
}

// Translate the same rig used for visible animation and ball collisions.
export function placeKeeperPose(pose,offset,feet=null,velocity=null){
  // Let the torso follow lateral weight transfer while the planted foot holds.
  const up=velocity?add(pose.up,v(clip(velocity.x/3,-1,1)*.065,0,0)):pose.up;
  return rig(add(pose.hip,offset),up,feet??pose.feet.map(p=>add(p,offset)),pose.hands.map(p=>add(p,offset)),1,pose.roll);
}

// A short side-step loads the legs while a slow ball is still approaching.
export function keeperPreparation(stats,direction,elapsed,delay,height=1){
  const base=goalkeeperPose(stats,direction,0,height),strength=smooth(delay/.3);
  const lead=smooth(elapsed/.18)*strength,follow=smooth((elapsed-.18)/.18)*strength;
  const shift=direction*.10*(lead+follow)/2,crouch=.09*smooth(elapsed/.24)*strength;
  const feet=base.feet.map((foot,i)=>{
    const first=(direction>0?i===1:i===0),progress=first?lead:follow;
    const phase=clip((elapsed-(first?0:.18))/.18,0,1);
    return add(foot,v(direction*.10*progress,.035*Math.sin(Math.PI*phase)**2*strength,0));
  });
  return rig(add(base.hip,v(shift,-crouch,0)),base.up,feet,base.hands.map(hand=>add(hand,v(shift,-crouch,.035*smooth(elapsed/.24)*strength))),1);
}

// Late lateral input begins from the keeper's actual central reach. Re-solve IK
// through the grounded push-off, completing the transition before takeoff.
export function blendKeeperPose(from,to,weight,ease=true){
  if(weight<=0)return from;if(weight>=1)return to;
  const t=ease?smooth(weight):weight;
  return rig(lerp(from.hip,to.hip,t),lerp(from.up,to.up,t),from.feet.map((p,i)=>lerp(p,to.feet[i],t)),from.hands.map((p,i)=>lerp(p,to.hands[i],t)),1,from.roll+(to.roll-from.roll)*t);
}

// A secured ball is brought into the torso with both hands, keeping arm lengths.
export function holdingPose(source,blend=1){
  blend=smooth(blend);const p={...source,hands:[],elbows:[]};
  const center=add(add(p.shoulder,mul(p.up,-.17)),mul(p.forward,.26));center.y=Math.max(.15,center.y);
  for(let i=0;i<2;i++){
    const sign=i?1:-1,target=add(add(center,mul(p.right,sign*.115)),mul(p.up,-.045));
    const hand=lerp(source.hands[i],target,blend),holdPole=add(p.shoulders[i],add(mul(p.right,sign*.35),mul(p.forward,-.3)));
    const pole=lerp(source.elbows[i],holdPole,blend);
    // Lift the bend plane clear of the turf while a sideways keeper gathers in.
    pole.y+=.9*Math.sin(Math.PI*blend)*(1-Math.max(0,p.up.y));
    const arm=limb(p.shoulders[i],hand,pole,body.upperArm,body.forearm);p.hands.push(arm.end);p.elbows.push(arm.joint);
  }
  return {pose:p,center};
}

export function neckAngles(relative,facing=1){
  const forward=relative.z*facing,attention=smooth((forward+.4)/.7);
  return {yaw:clip(Math.atan2(relative.x*facing,Math.max(.15,forward)),-.55,.55)*attention,pitch:clip(Math.atan2(-relative.y,Math.hypot(relative.x,relative.z)),-.25,.50)*facing*attention};
}

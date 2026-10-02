import {keeperSurfaceContacts,keeperPalmCenter} from './keeper-contact.js';
import {goalkeeperPose,blendKeeperPose,keeperPreparation,placeKeeperPose,keeperHesitationPose} from './anatomy.js';
import {keeperResultRecovery} from './keeper-result-recovery.js';
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const GOAL = { half: 3.66, height: 2.44, distance: 11, radius: .11, postRadius: .06 };
export class Random {
  constructor(seed = Date.now()) { this.state = seed >>> 0 || 1; }
  next() { let t = this.state += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); this.state >>>= 0; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  spread(scale) { return (this.next() - this.next()) * scale; }
}
const aliases = ['弧光', '雾屿', '远帆', '青砾', '流萤', '白栎', '逐浪', '星隙', '晴岚', '风棱', '云岬'];
export function createTeams(rng, mode) {
  const base = Array.from({length: 11}, (_, i) => {
    const position = i === 0 ? '门将' : i < 5 ? '后卫' : i < 8 ? '中场' : '前锋';
    const accuracy = rng.int(position === '前锋' ? 77 : position === '门将' ? 52 : 65, 94);
    return { position, accuracy, power: rng.int(65, 94), composure: rng.int(62, 96), touch: rng.int(65, 94), curve: rng.int(55, 94), speed: rng.int(72, 94), reach: rng.int(72, 94), handling: rng.int(90, 99) };
  });
  return ['雾港弧光', '暮原流星'].map((name, team) => ({
    name, short: team ? '暮原' : '雾港', color: team ? '#ef936a' : '#b9efd7',
    players: base.map((p, i) => {
      const result = { ...p, id: `${team}-${i}`, number: i === 0 ? 1 : i + 3, name: `${aliases[(i + team * 4) % 11]}${team ? '·乙' : '·甲'}` };
      for (const k of ['accuracy', 'power', 'composure', 'touch', 'curve', 'speed', 'reach']) result[k] = mode === 'simple' ? 75 : clamp(p[k] + (team ? rng.int(-3, 3) : 0), 1, 99);
      result.handling = mode === 'simple' ? 95 : clamp(p.handling + (team ? rng.int(-2, 2) : 0), 90, 99);
      return result;
    }), order: [8, 9, 10, 5, 6, 7, 1, 2, 3, 4, 0], goals: 0, kicks: []
  }));
}
export function winnerOf(teams) {
  const [a, b] = teams;
  if (a.kicks.length <= 5 && b.kicks.length <= 5) {
    if (a.goals > b.goals + 5 - b.kicks.length) return 0;
    if (b.goals > a.goals + 5 - a.kicks.length) return 1;
  }
  if (a.kicks.length >= 5 && a.kicks.length === b.kicks.length && a.goals !== b.goals) return a.goals > b.goals ? 0 : 1;
  return null;
}
export class Match {
  constructor(mode, seed = Date.now()) {
    this.mode = mode; this.seed = seed; this.rng = new Random(seed); this.teams = createTeams(this.rng, mode);
    this.coinWinner = this.rng.int(0, 1); this.end = this.rng.int(0, 1); this.first = 0; this.turn = 0; this.winner = null; this.serial = 0;
  }
  start(first) { this.first = first; this.turn = first; this.prepare(); }
  prepare() {
    const side = this.teams[this.turn];
    this.kicker = side.order[side.kicks.length % 11]; this.serial++;
    // Decisions are committed before this turn's human input is enabled.
    this.aiDive = this.rng.int(-1, 1);
    const lane = this.rng.int(-1, 1);
    this.aiAim = { x: lane === 0 ? this.rng.range(-.45, .45) : lane * this.rng.range(1.6, 3.5), power: this.rng.range(.43, .98), y: this.rng.range(.28, 2.35) };
    this.shotSeed = this.rng.int(1, 0x7fffffff); this.recorded = false;
  }
  pressure() { return this.teams[0].kicks.length >= 5 ? .95 : Math.max(...this.teams.map(t => t.kicks.length)) >= 4 ? .8 : .3; }
  shoot(aim, dive) {
    const attacker = this.teams[this.turn].players[this.kicker];
    const keeper = this.teams[1 - this.turn].players[0];
    return new Shot(aim, attacker, keeper, dive, this.shotSeed, this.pressure());
  }
  record(result) {
    if (this.recorded) return false;
    this.recorded = true;
    const t = this.teams[this.turn];
    t.kicks.push({ ...result, player: this.kicker, number: t.players[this.kicker].number, serial: this.serial });
    if (result.goal) t.goals++;
    this.winner = winnerOf(this.teams); return true;
  }
  next() { if (!this.recorded || this.winner !== null) return false; this.turn = 1 - this.turn; this.prepare(); return true; }
  static restore(raw) { for(const team of raw.teams)for(const player of team.players){player.curve??=raw.mode==='simple'?75:76;if(raw.mode==='simple')for(const key of ['accuracy','power','composure','touch','curve','speed','reach'])if(player[key]===76)player[key]=75;} const m = Object.assign(Object.create(Match.prototype), raw); m.rng = new Random(raw.rng.state); return m; }
}
const v = (x=0, y=0, z=0) => ({x,y,z});
const add = (a,b) => v(a.x+b.x,a.y+b.y,a.z+b.z);
const sub = (a,b) => v(a.x-b.x,a.y-b.y,a.z-b.z);
const mul = (a,s) => v(a.x*s,a.y*s,a.z*s);
const dot = (a,b) => a.x*b.x+a.y*b.y+a.z*b.z;
const len = a => Math.sqrt(dot(a,a));
function nearest(p,a,b) { const ab=sub(b,a); return add(a,mul(ab,clamp(dot(sub(p,a),ab)/(dot(ab,ab)||1),0,1))); }
function sweptDistance(p0,p1,a,b,radius=0) {
  // Minimise distance between the short ball segment and a capsule axis.
  let lo=0, hi=1;
  for(let i=0;i<12;i++) {
    const t1=(2*lo+hi)/3,t2=(lo+2*hi)/3;
    const p=add(p0,mul(sub(p1,p0),t1)),q=add(p0,mul(sub(p1,p0),t2));
    if(len(sub(p,nearest(p,a,b))) < len(sub(q,nearest(q,a,b)))) hi=t2; else lo=t1;
  }
  let time=(lo+hi)/2,p=add(p0,mul(sub(p1,p0),time)),q=nearest(p,a,b);
  const distance=len(sub(p,q));
  if(radius && distance<radius){
    // Find first surface entry, before the ball crosses the capsule axis.
    let start=0,end=time;
    if(len(sub(p0,nearest(p0,a,b)))<radius)end=0;
    else for(let i=0;i<18;i++){const mid=(start+end)/2,point=add(p0,mul(sub(p1,p0),mid));if(len(sub(point,nearest(point,a,b)))<radius)end=mid;else start=mid;}
    time=end;p=add(p0,mul(sub(p1,p0),time));q=nearest(p,a,b);
  }
  return { distance, p, q, time };
}
// A nearly downward plane has no stable intersection with the floor. Query
// finite collision surfaces from four outside floor points instead of amplifying a tiny
// horizontal normal into a long teleport. This fallback is used only when the
// planar correction would exceed a ball radius.
function keeperFloorEscape(pose,center,radius,padding=.005){
  const points=[pose.hip,pose.shoulder,pose.head??pose.shoulder,...pose.hands,...pose.elbows,...pose.knees,...pose.feet];
  const extent=Math.max(...points.flatMap(p=>[Math.abs(p.x-center.x),Math.abs(p.z-center.z)]))+radius+.30;
  if(!keeperSurfaceContacts(pose,center,center,radius).length)return {point:center};
  let best=null,distance=Infinity;
  for(const axis of ['x','z'])for(const side of [-1,1]){
    const start={...center,[axis]:center[axis]+side*extent};let first=null;
    for(const contact of keeperSurfaceContacts(pose,start,center,radius))if(!first||contact.hit.time<first.hit.time)first=contact;
    if(!first)continue;
    if(first.hit.time<=0)continue;
    const point={...first.hit.p,[axis]:first.hit.p[axis]+side*padding},offset=sub(point,center),squared=dot(offset,offset);
    if(squared<distance){const normal=sub(first.hit.p,first.hit.q),length=len(normal);best={point,part:first.part,normal:length>1e-8?mul(normal,1/length):null};distance=squared;}
  }
  return best;
}
export const keeperPose = goalkeeperPose;
export class Shot {
  constructor(aim, attacker, keeper, direction, seed, pressure=.3) {
    this.rng=new Random(seed); this.attacker=attacker; this.keeper=keeper;
    this.keeperPressure=1-pressure*(1-keeper.composure/99)*.12;
    this.direction=direction; this.diveAt=direction ? 0 : null; this.t=0; this.ball=v(0,.11,11); this.previous={...this.ball};
    this.touched=false; this.post=false; this.contactUntil=0; this.handlingUntil={}; this.postUntil=0; this.result=null; this.caught=false;
    const stress=1+pressure*(1-attacker.composure/99)*.9;
    const power=aim.timeout ? 0 : clamp(aim.power+this.rng.spread(.075*(1-attacker.touch/99)*stress),0,1);
    const control=(attacker.accuracy+attacker.touch*2+attacker.composure+attacker.power)/5/99;
    const strain=Math.pow(clamp((power-.65)/.35,0,1),2);
    const error=(.025+.45*(1-attacker.accuracy/99))*stress*(1+Math.max(0,power-.8)*2.5);
    const mishit=!aim.timeout && this.rng.next()<strain*(.025+(1-control)*.65);
    const x=aim.timeout ? 0 : aim.x+this.rng.spread(error);
    const verticalError=this.rng.spread(error*.7),mishitLift=mishit?.7+this.rng.next()*(1-control)*5:0;
    const speed=aim.chip?8+7*power*(.65+.35*attacker.power/99):4.8+27.2*power*(.65+.35*attacker.power/99);
    const flight=11/speed;
    const y=aim.timeout ? .16 : (aim.low?.11:aim.chip?.11+(2.5+4.5*power)*flight-4.905*flight*flight:(aim.y ?? (.28+power*2.0)))+verticalError+mishitLift;
    const lift=aim.chip?1:clamp((power-.22)/.20,0,1);
    this.velocity=v(x/flight, aim.timeout ? 0 : aim.low ? clamp((verticalError+mishitLift)/flight,0,9)*lift : clamp((y-.11+4.905*flight*flight)/flight,0,9)*lift, -speed);
    this.spin=aim.low||aim.chip?0:clamp(aim.curve??0,-1,1)*(attacker.curve??76)/99*9*power*lift;
    this.velocity.x-=this.spin*flight*.5;
    this.aim={...aim}; this.actualPower=power; this.target={x,y}; this.launchSpeed=speed;
    this.reactionHeight=clamp(.11+this.velocity.y*flight-4.905*flight*flight,.3,2.3);
    this.keeperOffset=v();this.keeperVelocity=v();this.trackingFeet=[v(-.3,.075,.04),v(.3,.075,.04)];this.nextFoot=direction<0?0:1;
    if(direction)this.planDive();
    this.pose=keeperPose(keeper,direction,0,1);
  }
  dive(direction) { if(this.result || this.diveAt!==null || !direction) return false; this.diveOrigin=this.pose;this.diveHeight=this.reactionHeight??this.target.y;this.direction=direction; this.diveAt=this.t;this.planDive(); return true; }
  planDive(){
    // Read the approaching ball, then commit a reachable dive and its timing.
    let ball={...this.ball},velocity={...this.velocity},arrival=0;
    const dt=1/120;
    while(ball.z>.65&&arrival<8){
      if(ball.y>.12)velocity.x+=(this.spin??0)*dt;
      velocity.y-=9.81*dt;ball=add(ball,mul(velocity,dt));arrival+=dt;
      if(ball.y<.11){ball.y=.11;if(velocity.y<-.8){velocity.y*=-.33;velocity.x*=.78;velocity.z*=.78;}else{velocity.y=0;const f=Math.max(0,1-.8*dt/(Math.hypot(velocity.x,velocity.z)||1));velocity.x*=f;velocity.z*=f;}}
    }
    ball=sub(ball,this.keeperOffset??v());
    this.diveHeight=clamp(ball.y,.3,2.3);
    this.stretch=clamp((Math.abs(ball.x)-1.8)/1.5,0,1)*(this.keeper.reach/99);
    const maxDiveSpeed=3.2+this.keeper.speed/99*1.1+.9*this.stretch;
    let best=Infinity,bestTime=0,bestSpeed=maxDiveSpeed;
    for(let time=.16;time<=Math.min(arrival,.85);time+=.025)for(let speed=1.5;speed<=maxDiveSpeed;speed+=.2){
      const pose=keeperPose({...this.keeper,diveVelocity:speed,stretch:this.stretch},this.direction,time,this.diveHeight);
      const distance=Math.min(...pose.hands.map((hand,i)=>len(sub(ball,this.launchSpeed>=15?keeperPalmCenter(pose,i):hand))),len(sub(ball,nearest(ball,pose.hip,pose.shoulder))))+.015*(arrival-time);
      if(distance<best){best=distance;bestTime=time;bestSpeed=speed;}
    }
    this.diveDelay=this.launchSpeed>=23||(this.launchSpeed>=15&&Math.abs(ball.x)<.8)?0:Math.max(0,arrival-bestTime);this.diveVelocity=bestSpeed;
  }
  poseAt(time,height=this.reactionHeight??this.target.y){
    if(this.hesitation)return keeperHesitationPose(this.hesitation.pose,this.hesitation.direction,time-this.hesitation.at,this.hesitation.previous);
    if(this.result&&!this.direction&&!this.recoveryOrigin&&this.pose?.shoulders)
      return keeperResultRecovery(this.pose,time-(this.animationTime??this.t),this.caught);
    const stats={...this.keeper,speed:this.keeper.speed*this.keeperPressure,reach:this.keeper.reach*this.keeperPressure,diveVelocity:this.diveVelocity,stretch:this.stretch};
    const elapsed=this.diveAt===null?time:time-this.diveAt,delay=this.direction?(this.diveDelay??0):0;
    let targetHeight=clamp(this.direction?(this.diveHeight??height):height,.3,2.3);
    if(!this.direction&&this.clearanceAt!==undefined){
      const q=clamp((time-this.clearanceAt-.15)/.55,0,1),blend=q*q*(3-2*q);
      targetHeight=this.clearanceHeight+(1-this.clearanceHeight)*blend;
    }
    let pose=keeperPose(stats,this.direction,Math.max(0,elapsed-delay),targetHeight);
    if(this.direction&&delay>0){
      const ready=keeperPreparation(stats,this.direction,Math.min(elapsed,delay),delay,targetHeight);
      pose=elapsed<delay?ready:blendKeeperPose(ready,pose,(elapsed-delay)/.13);
    }
    const offset=this.keeperOffset??v();
    let feet=null;
    if(this.trackingFeet&&(!this.direction||elapsed<delay))feet=this.trackingFeet;
    pose=placeKeeperPose(pose,offset,feet,feet?this.keeperVelocity:null);
    if(this.recoveryOrigin)pose=blendKeeperPose(this.recoveryOrigin,pose,(time-this.recoveryAt)/.3);
    return this.diveOrigin?blendKeeperPose(this.diveOrigin,pose,elapsed/.12):pose;
  }

  isClearance(){
    // After contact spin is disabled. These regions are beyond every collider,
    // and ground friction can reduce speed but cannot reverse horizontal travel.
    return (this.touched||this.post)&&!this.caught&&((this.ball.z>(this.keeperOffset?.z??0)+3&&this.velocity.z>=0)||(Math.abs(this.ball.x)>Math.abs(this.keeperOffset?.x??0)+8&&this.ball.x*this.velocity.x>0&&this.ball.z>0));
  }
  playbackRate(){return !this.result&&this.isClearance()?8:1;}
  trackKeeper(dt){
    if(!this.trackingFeet)return; // Saved matches from before tracking was introduced.
    if((this.touched||this.post)&&((this.ball.z>1.2&&this.velocity.z>=0)||this.isClearance())){
      if(this.clearanceAt===undefined){this.clearanceAt=this.t;this.clearanceHeight=this.reactionHeight;}
      this.keeperVelocity=mul(this.keeperVelocity,Math.exp(-dt*12));
      this.stepFeet();
      return;
    }
    if(this.hesitation){
      if(this.t-this.hesitation.at<.95)return;
      this.recoveryOrigin=this.pose;this.recoveryAt=this.t;
      this.keeperOffset=v(this.pose.hip.x,0,this.pose.hip.z-.04);
      this.trackingFeet=this.pose.feet.map(p=>({...p}));this.keeperVelocity=v();this.footStep=null;
      this.hesitation=null;this.direction=0;this.diveAt=null;this.diveOrigin=null;this.launchFeet=null;
    }
    const elapsed=this.diveAt===null?0:this.t-this.diveAt-(this.diveDelay??0);
    const ballTime=this.ball.z/Math.max(1,-this.velocity.z);
    const observedX=this.ball.x+this.velocity.x*ballTime-this.keeperOffset.x;
    const recognition=.09+.04*(1-this.keeper.speed/99);
    if(this.direction&&this.t-this.diveAt>=recognition&&elapsed<=.13&&ballTime<.7&&this.velocity.z<-15&&observedX*this.direction<-1.1&&!this.touched){
      const pose=this.poseAt(this.t),previous=this.poseAt(this.t-.001);
      this.hesitation={at:this.t,pose,previous,direction:this.direction};
      this.keeperVelocity=v();this.footStep=null;
      return;
    }
    if(this.direction&&elapsed>=3.35&&!this.caught){
      this.recoveryOrigin=this.pose;this.recoveryAt=this.t;
      this.keeperOffset=v(this.pose.hip.x,0,this.pose.hip.z-.04);
      this.trackingFeet=this.pose.feet.map(p=>({...p}));this.keeperVelocity=v();this.footStep=null;
      this.direction=0;this.diveAt=null;this.diveOrigin=null;this.launchFeet=null;
    }
    const arrival=this.ball.z/Math.max(1,-this.velocity.z);
    const nearX=this.ball.x+this.velocity.x*arrival;
    if(this.direction&&this.launchSpeed<15&&elapsed<0&&this.t>.3&&Math.abs(nearX-this.keeperOffset.x)<Math.max(.55,arrival*(1.4+1.6*this.keeper.speed/99)*.7)){
      this.recoveryOrigin=this.pose;this.recoveryAt=this.t;
      this.direction=0;this.diveAt=null;this.diveOrigin=null;this.launchFeet=null;
    }
    if(this.direction&&elapsed>=0){
      if(!this.launchFeet){
        this.launchFeet=this.trackingFeet.map(p=>({...p}));this.diveOrigin=this.pose;
        // Re-read the reachable ball position from the actual takeoff position.
        this.planDive();this.diveAt=this.t;this.diveDelay=0;
      }
      return;
    }
    const reaction=.14+.16*(1-this.keeper.speed/99);
    // Finish a committed stride while contact suspends new tracking decisions.
    // Its clock keeps advancing, so skipping it would teleport the foot on resume.
    if(this.t<reaction||this.t<this.contactUntil||this.ball.z<.4){this.stepFeet();return;}
    const flight=this.ball.z/Math.max(1,-this.velocity.z);
    const targetX=clamp(this.ball.x+this.velocity.x*flight,-3.05,3.05);
    const targetZ=this.launchSpeed<15?.12:0;
    const maxSpeed=1.4+1.6*this.keeper.speed/99,acceleration=4+4*this.keeper.speed/99;
    for(const axis of ['x','z']){
      const target=axis==='x'?targetX:targetZ,distance=target-this.keeperOffset[axis];
      const desired=clamp(distance*4,-maxSpeed,maxSpeed);
      this.keeperVelocity[axis]+=clamp(desired-this.keeperVelocity[axis],-acceleration*dt,acceleration*dt);
      this.keeperOffset[axis]+=this.keeperVelocity[axis]*dt;
    }
    const pace=Math.hypot(this.keeperVelocity.x,this.keeperVelocity.z);
    if(!this.footStep){
      const i=this.nextFoot,foot=this.trackingFeet[i],target=v(this.keeperOffset.x+(i?.3:-.3)+this.keeperVelocity.x*.12,.075,.04+this.keeperOffset.z+this.keeperVelocity.z*.12);
      if(Math.hypot(target.x-foot.x,target.z-foot.z)>.045){this.footStep={index:i,from:{...foot},to:target,at:this.t};this.nextFoot=1-i;}
    }
    this.stepFeet();
    // A central stance can react into a dive once lateral movement is insufficient.
    if(!this.direction&&this.t>reaction+.12&&flight<.65&&Math.abs(targetX-this.keeperOffset.x)>Math.max(.8,flight*maxSpeed*.9)&&pace>0){
      this.dive(Math.sign(targetX-this.keeperOffset.x));
    }
  }
  stepFeet(){
    if(this.footStep){
      const step=this.footStep,q=clamp((this.t-step.at)/.16,0,1),blend=q*q*q*(q*(q*6-15)+10);
      this.trackingFeet[step.index]=add(step.from,mul(sub(step.to,step.from),blend));
      this.trackingFeet[step.index].y+=.035*Math.sin(Math.PI*q)**2;
      if(q===1)this.footStep=null;
    }
  }
  finish(goal, reason) { if(!this.result) this.result={goal, saved:!goal&&this.touched, post:this.post, reason, power:this.actualPower, speed:Math.round(this.launchSpeed*3.6), target:this.target}; }
  step(dt,playbackRate=1) {
    if(this.result) return;
    this.previousPose=this.pose;this.previousAnimationTime=this.animationTime??this.t;
    this.animationTime=this.previousAnimationTime+dt/playbackRate;
    this.t+=dt;
    const flight=Math.max(0,this.ball.z / Math.max(1,-this.velocity.z));
    const projectedY=this.ball.y+this.velocity.y*flight-4.905*flight*flight;
    const reachStep=(2.5+2*this.keeper.speed/99)*dt;
    this.reactionHeight??=clamp(projectedY,.3,2.3);
    this.reactionHeight+=clamp(clamp(projectedY,.3,2.3)-this.reactionHeight,-reachStep,reachStep);
    this.trackKeeper(dt);
    this.pose=this.poseAt(this.t);
    this.previous={...this.ball};
    if(!this.touched&&!this.post&&this.ball.y>GOAL.radius+.01)this.velocity.x+=(this.spin??0)*dt;
    this.velocity.y-=9.81*dt;
    this.ball=add(this.ball,mul(this.velocity,dt));
    // Simultaneous contact retries consume no extra time or ground friction.
    let groundResolved=false;
    if(this.ball.y<GOAL.radius) {
      groundResolved=true;
      this.ball.y=GOAL.radius;
      if(this.velocity.y<-.8) { this.velocity.y*=-.33; this.velocity.x*=.78; this.velocity.z*=.78; }
      else { this.velocity.y=0; const friction=Math.max(0,1-.8*dt/(Math.hypot(this.velocity.x,this.velocity.z)||1)); this.velocity.x*=friction;this.velocity.z*=friction; }
    }
    if(this.t>this.postUntil && Math.min(Math.abs(this.ball.z),Math.abs(this.previous.z))<.5) {
      const x=GOAL.half+GOAL.postRadius,y=GOAL.height+GOAL.postRadius,z=GOAL.postRadius;
      const posts=[[v(-x,0,z),v(-x,y,z)],[v(x,0,z),v(x,y,z)],[v(-x,y,z),v(x,y,z)]];
      for(const [a,b] of posts) {
        const hit=sweptDistance(this.previous,this.ball,a,b,GOAL.radius+GOAL.postRadius);
        if(hit.distance<GOAL.radius+GOAL.postRadius) { this.reflect(hit,GOAL.radius+GOAL.postRadius,.72); this.post=true; this.postUntil=this.t+.04; break; }
      }
    }
    const crossing=this.previous.z>=-GOAL.radius&&this.ball.z<-GOAL.radius?(-GOAL.radius-this.previous.z)/(this.ball.z-this.previous.z):Infinity;
    let crossingPoint=Number.isFinite(crossing)?add(this.previous,mul(sub(this.ball,this.previous),crossing)):null;
    // Include every limb: a recovering boot may extend ahead of both palms.
    // The shipped extremities extend less than .25 m beyond these rig points.
    const p=this.pose,keeperFront=Math.max(p.hip.z,p.shoulder.z,p.head?.z??p.shoulder.z,p.hips[0].z,p.hips[1].z,p.shoulders[0].z,p.shoulders[1].z,p.hands[0].z,p.hands[1].z,p.elbows[0].z,p.elbows[1].z,p.knees[0].z,p.knees[1].z,p.feet[0].z,p.feet[1].z)+GOAL.radius+.25;
    if(Math.min(this.ball.z,this.previous.z)<keeperFront && Math.max(this.ball.z,this.previous.z)>-.4) {
      // Resolve calibrated skin surfaces in time order. A capsule extending
      // beyond a wrist/elbow can otherwise block a ball before the glove does.
      let sweepStart=this.previous;
      // Initial overlap consumes no flight time. Re-sweep its remaining motion
      // so tangential rebounds do not stick to a moving limb. Four resolutions
      // bound simultaneous-contact work; a normal impact ends this fixed step.
      for(let resolution=0;resolution<4;resolution++){
        const currentCrossing=sweepStart.z>=-GOAL.radius&&this.ball.z<-GOAL.radius?(-GOAL.radius-sweepStart.z)/(this.ball.z-sweepStart.z):Infinity;
        // Keep the last actual segment for goal-mouth edge classification.
        crossingPoint=Number.isFinite(currentCrossing)?add(sweepStart,mul(sub(this.ball,sweepStart),currentCrossing)):null;
        let contact=null;
        for(const surface of keeperSurfaceContacts(p,sweepStart,this.ball,GOAL.radius))if(surface.hit.time<currentCrossing&&(!contact||surface.hit.time<contact.hit.time))contact=surface;
        if(contact){
          crossingPoint=null;
          const {hit,r,type}=contact;
          {
            // A parry's handling cooldown must never make the keeper transparent:
            // the rebound can meet the same glove, the other palm or a leg before
            // it expires. Resolve the earliest surface every step; only suppress
            // another possession roll on a glove that just failed to secure it.
            const canHandle=this.t>(this.handlingUntil[contact.part]??0);
            this.contactPart=contact.part;this.touched=true; this.contactUntil=this.t+.09;
            if(type==='hand'&&canHandle)this.handlingUntil[contact.part]=this.contactUntil;
            const quality=clamp(contact.quality,.05,1);
            const secure=(this.keeper.handling/100)*(.64+.36*quality)*(1-Math.max(0,this.launchSpeed-23)*.013)*this.keeperPressure;
            let capture=type==='hand'&&canHandle&&this.rng.next()<secure,capturePoint=hit.p;
            if(capture&&capturePoint.y<GOAL.radius-1e-9){
              // A moving glove's overlap correction can fall below the turf.
              // Its true floor intersection must still touch that same palm.
              const grounded=keeperFloorEscape(p,{...capturePoint,y:GOAL.radius},GOAL.radius,0);
              capture=grounded?.part===contact.part;if(capture)capturePoint=grounded.point;
            }
            // A time-zero correction from one moving palm can enter another
            // surface. Possession starts only after the shared sphere is clear.
            if(capture&&hit.time===0)capture=!keeperSurfaceContacts(p,capturePoint,capturePoint,GOAL.radius).some(surface=>Math.hypot(surface.hit.p.x-capturePoint.x,surface.hit.p.y-capturePoint.y,surface.hit.p.z-capturePoint.z)>1e-6);
            if(capture){this.caught=true;this.ball={...capturePoint,y:Math.max(GOAL.radius,capturePoint.y)};this.velocity=v();this.finish(false,'门将稳稳抱住了球');}
            else this.reflect(hit,r+.11, type==='hand'?.34:.5);
          }
        }
        if(!contact||this.caught||contact.hit.time>0||resolution===3)break;
        sweepStart={...this.ball};
        this.ball=add(this.ball,mul(this.velocity,dt));
        if(this.ball.y<GOAL.radius){
          this.ball.y=GOAL.radius;
          if(groundResolved){this.velocity.y=Math.max(0,this.velocity.y);}
          else if(this.velocity.y<-.8){this.velocity.y*=-.33;this.velocity.x*=.78;this.velocity.z*=.78;}
          else{this.velocity.y=0;const friction=Math.max(0,1-.8*dt/(Math.hypot(this.velocity.x,this.velocity.z)||1));this.velocity.x*=friction;this.velocity.z*=friction;}
          groundResolved=true;
        }
      }
    }
    if(this.result) return;
    if(this.ball.z < -GOAL.radius) {
      const crossed=crossingPoint??this.ball;
      if(Math.abs(crossed.x)<=GOAL.half-GOAL.radius && crossed.y<=GOAL.height-GOAL.radius) this.finish(true,this.touched?'碰到门将后，足球仍滚入球门':this.post?'击中门框后入网':'足球越过门线');
      else this.finish(false,this.touched?'门将将球挡出底线':this.post?'击中门框后出界':crossed.y>GOAL.height-GOAL.radius?'射门高出横梁':'射门偏出球门');
    } else if(Math.abs(this.ball.x)>34+GOAL.radius || this.ball.z>105+GOAL.radius) this.finish(false,this.touched?'门将将球挡出':'足球出界');
    else if(this.ball.y<=.111 && len(this.velocity)<.06) {this.velocity=v();this.finish(false,this.touched?'门将挡出，足球停止运动':'力量不足，足球停在门前');}
  }
  reflect(hit,radius,restitution) {
    let normal=sub(hit.p,hit.q); const length=len(normal);
    normal=length>1e-5?mul(normal,1/length):v(0,0,1);
    let resolved=add(hit.q,mul(normal,radius+.005));
    const lift=GOAL.radius-resolved.y;
    if(lift>0){
      resolved.y=GOAL.radius;
      const horizontal=normal.x*normal.x+normal.z*normal.z;
      if(normal.y<0){
        const distance=horizontal>1e-12?-lift*normal.y/Math.sqrt(horizontal):Infinity;
        if(distance<=radius){
          // Raising only Y re-enters a downward-facing surface. The horizontal
          // shift keeps its separating plane while satisfying the floor.
          const shift=-lift*normal.y/horizontal;
          resolved.x+=normal.x*shift;resolved.z+=normal.z*shift;
        }else{
          const escape=keeperFloorEscape(this.pose,{...hit.p,y:GOAL.radius},radius);
          if(escape){resolved=escape.point;if(escape.normal)normal=escape.normal;}
        }
      }
    }
    const d=dot(this.velocity,normal);
    if(d<0) this.velocity=sub(this.velocity,mul(normal,(1+restitution)*d));
    this.ball=resolved;
  }
  static restore(raw) {const s=Object.assign(Object.create(Shot.prototype),raw);s.rng=new Random(raw.rng.state);s.keeperPressure??=1;s.handlingUntil={...raw.handlingUntil};if(!raw.handlingUntil&&/^hand[LR]$/.test(s.contactPart))s.handlingUntil[s.contactPart]=s.contactUntil??0;if(s.direction)s.diveHeight??=s.reactionHeight??s.target.y;if(!s.pose?.shoulders)s.pose=s.poseAt(s.t);return s;}
}
export function gestureInput(points, width, height, threshold, adjustable=false) {
  if(points.length<2 || width<=0 || height<=0) return null;
  const first=points[0], last=points.at(-1), dx=last.x-first.x, dy=last.y-first.y;
  if(dy>-12 || Math.hypot(dx,dy)<18) return null;
  const moving=points.findIndex(p=>Math.hypot(p.x-first.x,p.y-first.y)>5);
  const start=points[Math.max(0,moving-1)];
  const duration=Math.max(.025,(last.t-start.t)/1000);
  const speed=Math.hypot(last.x-start.x,last.y-start.y)/width/duration;
  let bend=0;for(const point of points){const progress=clamp((first.y-point.y)/(-dy),0,1);if(progress>.15&&progress<.85){const offset=point.x-(first.x+dx*progress);if(Math.abs(offset)>Math.abs(bend))bend=offset;}}
  return {distance:(-dy-12)/(height*.72)*2,curve:adjustable?(clamp(-bend/(width*.16),-1,1)||0):0,x:clamp(dx/(width*.34),-1.15,1.15)*3.66,y:clamp((-dy-12)/(height*.5),.08,1.15)*2.44,power:clamp(adjustable?(-dy-12)/(height*.72)*(2/threshold):speed/threshold,0,1),speed};
}

// Tangent-mapped triangular phase: continuous position, rapid corner turnarounds.
export function directionMeter(time){
  const phase=((time/2.4+.25)%1+1)%1;
  const triangle=phase<.5?phase*4-1:3-phase*4;
  return 4.6*Math.tan(triangle*1.1)/Math.tan(1.1);
}

// Constant phase, accelerating charge; the peak reverses immediately.
export function powerMeter(time){
  const phase=((time/2.4)%1+1)%1;
  return Math.pow(phase<.5?phase*2:2-phase*2,1.5);
}

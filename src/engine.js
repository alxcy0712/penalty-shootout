import {goalkeeperPose,blendKeeperPose} from './anatomy.js';
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const GOAL = { half: 3.66, height: 2.44, distance: 11, radius: .11 };
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
    return { position, accuracy, power: rng.int(65, 94), composure: rng.int(62, 96), touch: rng.int(65, 94), speed: rng.int(72, 94), reach: rng.int(72, 94), handling: rng.int(90, 99) };
  });
  return ['雾港弧光', '暮原流星'].map((name, team) => ({
    name, short: team ? '暮原' : '雾港', color: team ? '#ef936a' : '#b9efd7',
    players: base.map((p, i) => {
      const result = { ...p, id: `${team}-${i}`, number: i === 0 ? 1 : i + 3, name: `${aliases[(i + team * 4) % 11]}${team ? '·乙' : '·甲'}` };
      for (const k of ['accuracy', 'power', 'composure', 'touch', 'speed', 'reach']) result[k] = mode === 'simple' ? 76 : clamp(p[k] + (team ? rng.int(-3, 3) : 0), 1, 99);
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
  static restore(raw) { const m = Object.assign(Object.create(Match.prototype), raw); m.rng = new Random(raw.rng.state); return m; }
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
export const keeperPose = goalkeeperPose;
export class Shot {
  constructor(aim, attacker, keeper, direction, seed, pressure=.3) {
    this.rng=new Random(seed); this.attacker=attacker; this.keeper=keeper;
    this.keeperPressure=1-pressure*(1-keeper.composure/99)*.12;
    this.direction=direction; this.diveAt=direction ? 0 : null; this.t=0; this.ball=v(0,.11,11); this.previous={...this.ball};
    this.touched=false; this.post=false; this.contactUntil=0; this.postUntil=0; this.result=null; this.caught=false;
    const stress=1+pressure*(1-attacker.composure/99)*.9;
    const power=aim.timeout ? 0 : clamp(aim.power+this.rng.spread(.075*(1-attacker.touch/99)*stress),0,1);
    const error=(.025+.45*(1-attacker.accuracy/99))*stress*(1+Math.max(0,power-.8)*2.5);
    const x=aim.timeout ? 0 : aim.x+this.rng.spread(error);
    const y=aim.timeout ? .16 : (aim.y ?? (.28+power*2.0))+this.rng.spread(error*.7);
    const speed=8+24*power*(.65+.35*attacker.power/99);
    const flight=11/speed;
    const lift=clamp((power-.22)/.20,0,1);
    this.velocity=v(x/flight, aim.timeout ? 0 : clamp((y-.11+4.905*flight*flight)/flight,0,9)*lift, -speed);
    this.aim={...aim}; this.actualPower=power; this.target={x,y}; this.launchSpeed=speed;
    this.reactionHeight=clamp(.11+this.velocity.y*flight-4.905*flight*flight,.3,2.3);
    if(direction)this.diveHeight=this.reactionHeight;
    this.pose=keeperPose(keeper,direction,0,1);
  }
  dive(direction) { if(this.result || this.diveAt!==null || !direction) return false; this.diveOrigin=this.pose;this.diveHeight=this.reactionHeight??this.target.y;this.direction=direction; this.diveAt=this.t; return true; }
  poseAt(time,height=this.reactionHeight??this.target.y){
    const pose=keeperPose({...this.keeper,speed:this.keeper.speed*this.keeperPressure,reach:this.keeper.reach*this.keeperPressure},this.direction,this.diveAt===null?time:time-this.diveAt,clamp(this.direction?(this.diveHeight??height):height,.3,2.3));
    return this.diveOrigin?blendKeeperPose(this.diveOrigin,pose,(time-this.diveAt)/.12):pose;
  }
  finish(goal, reason) { if(!this.result) this.result={goal, saved:!goal&&this.touched, post:this.post, reason, power:this.actualPower, speed:Math.round(this.launchSpeed*3.6), target:this.target}; }
  step(dt) {
    if(this.result) return;
    this.t+=dt;
    const flight=Math.max(0,this.ball.z / Math.max(1,-this.velocity.z));
    const projectedY=this.ball.y+this.velocity.y*flight-4.905*flight*flight;
    const reachStep=(2.5+2*this.keeper.speed/99)*dt;
    this.reactionHeight??=clamp(projectedY,.3,2.3);
    this.reactionHeight+=clamp(clamp(projectedY,.3,2.3)-this.reactionHeight,-reachStep,reachStep);
    this.pose=this.poseAt(this.t);
    this.previous={...this.ball};
    this.velocity.y-=9.81*dt;
    this.ball=add(this.ball,mul(this.velocity,dt));
    if(this.ball.y<GOAL.radius) {
      this.ball.y=GOAL.radius;
      if(this.velocity.y<-.8) { this.velocity.y*=-.33; this.velocity.x*=.78; this.velocity.z*=.78; }
      else { this.velocity.y=0; const friction=Math.max(0,1-3.5*dt/(Math.hypot(this.velocity.x,this.velocity.z)||1)); this.velocity.x*=friction;this.velocity.z*=friction; }
    }
    if(this.t>this.postUntil && Math.min(Math.abs(this.ball.z),Math.abs(this.previous.z))<.5) {
      const posts=[[v(-3.66,0,0),v(-3.66,2.44,0)],[v(3.66,0,0),v(3.66,2.44,0)],[v(-3.66,2.44,0),v(3.66,2.44,0)]];
      for(const [a,b] of posts) {
        const hit=sweptDistance(this.previous,this.ball,a,b,.175);
        if(hit.distance<.175) { this.reflect(hit,.175,.72); this.post=true; this.postUntil=this.t+.04; break; }
      }
    }
    const p=this.pose,keeperFront=Math.max(p.hip.z,p.shoulder.z,p.hands[0].z,p.hands[1].z)+.30;
    if(this.t>this.contactUntil && Math.min(this.ball.z,this.previous.z)<keeperFront && Math.max(this.ball.z,this.previous.z)>-.4) {
      const parts=[[p.hip,p.shoulder,.19,'body'],[p.head,p.head,.12,'body']];
      for(let i=0;i<2;i++) {
        const wristDirection=sub(p.hands[i],p.elbows[i]),fingers=add(p.hands[i],mul(wristDirection,.12/(len(wristDirection)||1)));
        parts.push([p.shoulders[i],p.elbows[i],.08,'body'],[p.elbows[i],p.hands[i],.065,'body'],[p.hands[i],fingers,.058,'hand'],[p.hips[i],p.knees[i],.105,'body'],[p.knees[i],p.feet[i],.075,'body'],[v(p.feet[i].x,p.feet[i].y-.02,p.feet[i].z-.04),v(p.feet[i].x,p.feet[i].y-.02,p.feet[i].z+.14),.06,'body']);
      }
      // Resolve the first visible surface, not whichever body part is listed first.
      let contact=null;
      for(const [a,b,r,type] of parts){
        const hit=sweptDistance(this.previous,this.ball,a,b,r+GOAL.radius);
        if(hit.distance<r+GOAL.radius && (!contact || hit.time<contact.hit.time))contact={hit,r,type};
      }
      if(contact){
        const {hit,r,type}=contact;
        {
          this.touched=true; this.contactUntil=this.t+.09;
          const quality=clamp(1-hit.distance/(r+.11),.05,1);
          const secure=(this.keeper.handling/100)*(.64+.36*quality)*(1-Math.max(0,this.launchSpeed-23)*.013)*this.keeperPressure;
          if(type==='hand' && this.rng.next()<secure) {this.caught=true;this.ball={...hit.p};this.velocity=v();this.finish(false,'门将稳稳抱住了球');}
          else this.reflect(hit,r+.11, type==='hand'?.34:.5);
        }
      }
    }
    if(this.result) return;
    if(this.ball.z < -GOAL.radius) {
      if(Math.abs(this.ball.x)<GOAL.half-GOAL.radius && this.ball.y<GOAL.height-GOAL.radius) this.finish(true,this.touched?'碰到门将后，足球仍滚入球门':this.post?'击中门框后入网':'足球越过门线');
      else this.finish(false,this.touched?'门将将球挡出底线':this.post?'击中门框后出界':this.ball.y>=GOAL.height-GOAL.radius?'射门高出横梁':'射门偏出球门');
    } else if(Math.abs(this.ball.x)>34 || this.ball.z>55) this.finish(false,this.touched?'门将将球挡出':'足球出界');
    else if(this.ball.y<=.111 && len(this.velocity)<.22) this.finish(false,this.touched?'门将挡出，足球停止运动':'力量不足，足球停在门前');
  }
  reflect(hit,radius,restitution) {
    let normal=sub(hit.p,hit.q); const length=len(normal);
    normal=length>1e-5?mul(normal,1/length):v(0,0,1);
    const d=dot(this.velocity,normal);
    if(d<0) this.velocity=sub(this.velocity,mul(normal,(1+restitution)*d));
    this.ball=add(hit.q,mul(normal,radius+.005));
  }
  static restore(raw) {const s=Object.assign(Object.create(Shot.prototype),raw);s.rng=new Random(raw.rng.state);s.keeperPressure??=1;if(s.direction)s.diveHeight??=s.reactionHeight??s.target.y;if(!s.pose?.shoulders)s.pose=s.poseAt(s.t);return s;}
}
export function gestureInput(points, width, height, threshold) {
  if(points.length<2 || width<=0 || height<=0) return null;
  const first=points[0], last=points.at(-1), dx=last.x-first.x, dy=last.y-first.y;
  if(dy>-12 || Math.hypot(dx,dy)<18) return null;
  const moving=points.findIndex(p=>Math.hypot(p.x-first.x,p.y-first.y)>5);
  const start=points[Math.max(0,moving-1)];
  const duration=Math.max(.025,(last.t-start.t)/1000);
  const speed=Math.hypot(last.x-start.x,last.y-start.y)/width/duration;
  return {x:clamp(dx/(width*.34),-1.15,1.15)*3.66,y:clamp((-dy-12)/(height*.5),.08,1.15)*2.44,power:clamp(speed/threshold,0,1),speed};
}

// Tangent-mapped triangular phase: continuous position, rapid corner turnarounds.
export function directionMeter(time){
  const phase=((time/2.8+.25)%1+1)%1;
  const triangle=phase<.5?phase*4-1:3-phase*4;
  return 3.75*Math.tan(triangle*1.05)/Math.tan(1.05);
}

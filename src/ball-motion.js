// Visual continuation after a valid goal; this never changes the recorded result.
export class GoalBall {
  constructor(position,velocity){this.position={...position};this.velocity={...velocity};this.accumulator=0;this.netHits=0;this.lastImpactSpeed=0;this.sleeping=false;this.time=0;this.lastNetImpact=null;this._impact={surface:null,position:{x:0,y:0,z:0},normal:{x:0,y:0,z:0},speed:0,time:0};}
  advance(seconds,onImpact){
    if(this.sleeping)return;
    this.accumulator+=Math.max(0,seconds);
    while(this.accumulator>=1/120){this.step(1/120,onImpact);this.accumulator-=1/120;if(this.sleeping){this.accumulator=0;break;}}
  }
  step(dt,onImpact){
    this.time+=dt;
    const p=this.position,v=this.velocity;v.y-=9.81*dt;p.x+=v.x*dt;p.y+=v.y*dt;p.z+=v.z*dt;
    if(p.y<.11){p.y=.11;if(v.y<-.6)v.y*=-.26;else v.y=0;const speed=Math.hypot(v.x,v.z),friction=Math.max(0,1-4*dt/(speed||1));v.x*=friction;v.z*=friction;}
    if(p.z<-1.78){p.z=-1.78;if(v.z<0){this.lastImpactSpeed=Math.abs(v.z);this.recordNetImpact('back',0,0,-1,onImpact);v.z*=-.13;v.x*=.72;v.y*=.72;this.netHits++;}}
    if(p.z<0){
      if(Math.abs(p.x)>3.61){p.x=Math.sign(p.x)*3.61;if(p.x*v.x>0){this.lastImpactSpeed=Math.abs(v.x);this.recordNetImpact('side',Math.sign(p.x),0,0,onImpact);v.x*=-.15;this.netHits++;}}
      const roof=2.39+(p.z-.06)*(.4/1.76);if(p.y>roof){p.y=roof;if(v.y>0){this.lastImpactSpeed=v.y;const slope=.4/1.76,length=Math.hypot(1,slope);this.recordNetImpact('roof',0,1/length,-slope/length,onImpact);v.y*=-.15;this.netHits++;}}
    }
    if(p.y===.11&&Math.hypot(v.x,v.y,v.z)<.06){v.x=v.y=v.z=0;this.sleeping=true;}
  }
  // Visual-only metadata captured at each collision, before a later fixed step
  // moves the ball away. Reuse one record; consumers copy values synchronously.
  recordNetImpact(surface,nx,ny,nz,onImpact){
    const impact=this._impact,p=this.position;
    impact.surface=surface;impact.position.x=p.x;impact.position.y=p.y;impact.position.z=p.z;
    impact.normal.x=nx;impact.normal.y=ny;impact.normal.z=nz;impact.speed=this.lastImpactSpeed;impact.time=this.time;
    this.lastNetImpact=impact;if(onImpact)onImpact(impact);
  }
}

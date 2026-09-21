// Visual continuation after a valid goal; this never changes the recorded result.
export class GoalBall {
  constructor(position,velocity){this.position={...position};this.velocity={...velocity};this.accumulator=0;this.netHits=0;this.lastImpactSpeed=0;this.sleeping=false;}
  advance(seconds){
    if(this.sleeping)return;
    this.accumulator+=Math.max(0,seconds);
    while(this.accumulator>=1/120){this.step(1/120);this.accumulator-=1/120;if(this.sleeping){this.accumulator=0;break;}}
  }
  step(dt){
    const p=this.position,v=this.velocity;v.y-=9.81*dt;p.x+=v.x*dt;p.y+=v.y*dt;p.z+=v.z*dt;
    if(p.y<.11){p.y=.11;if(v.y<-.6)v.y*=-.26;else v.y=0;const speed=Math.hypot(v.x,v.z),friction=Math.max(0,1-4*dt/(speed||1));v.x*=friction;v.z*=friction;}
    if(p.z<-1.78){p.z=-1.78;if(v.z<0){this.lastImpactSpeed=Math.abs(v.z);v.z*=-.13;v.x*=.72;v.y*=.72;this.netHits++;}}
    if(p.z<0){
      if(Math.abs(p.x)>3.53){p.x=Math.sign(p.x)*3.53;if(p.x*v.x>0){this.lastImpactSpeed=Math.abs(v.x);v.x*=-.15;this.netHits++;}}
      const roof=2.33+.17*p.z;if(p.y>roof){p.y=roof;if(v.y>0){this.lastImpactSpeed=v.y;v.y*=-.15;this.netHits++;}}
    }
    if(p.y===.11&&Math.hypot(v.x,v.y,v.z)<.06){v.x=v.y=v.z=0;this.sleeping=true;}
  }
}

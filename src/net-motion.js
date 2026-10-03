// A bounded visual response for the existing coarse LineSegments net. No geometry,
// material, temporary vectors or position buffers are created during animation.
// This mesh has vertices only at line ends: rear seams retain a little compliance,
// while the front frame, grass and frame corners are fixed. Fully fixing every
// seam would fix every vertex and requires subdividing the authored net instead.
export const NET_RESPONSE_DURATION=1.65;
export const NET_MAX_DISPLACEMENT=.20;
const MAX_IMPULSES=8;
const smooth=value=>{const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);};

export class GoalNetMotion {
  constructor(rest,{half=3.72,backHeight=2.1,backTopZ=-1.7}={}){
    if(!(rest instanceof Float32Array)||rest.length%3)throw new TypeError('Net rest positions must be a Float32Array of xyz triples');
    this.rest=rest;this.weights=new Float32Array(rest.length/3);this.count=0;this.next=0;this.dirty=false;this.lastTime=NaN;this.latestEnd=-Infinity;
    for(let vertex=0,i=0;i<rest.length;i+=3,vertex++){
      const x=rest[i],y=rest[i+1],z=rest[i+2];
      if(!Number.isFinite(x+y+z))throw new TypeError('Net rest positions must be finite');
      // Strong attachment at front/ground; only a small yielding motion at rear
      // seams. The rear corners themselves remain exactly attached to the frame.
      const side=smooth((half-Math.abs(x))/.65),rearSeam=smooth(Math.abs(y-backHeight)/.48+Math.abs(z-backTopZ)/.4);
      const corner=smooth(Math.hypot((half-Math.abs(x))/.45,(y-backHeight)/.4,(z-backTopZ)/.4));
      this.weights[vertex]=y<=.025||z>=-.025||corner<1e-10?0:smooth(y/.38)*smooth(-z/.35)*(.24+.76*side)*(.28+.72*rearSeam)*corner;
    }
    this.impulses=Array.from({length:MAX_IMPULSES},()=>({time:Infinity,nx:0,ny:0,nz:0,strength:0,distance:new Float32Array(this.weights.length),gain:new Float32Array(this.weights.length)}));
  }
  // Copies a reusable GoalBall impact record. Time is absolute on the scene's
  // pause-aware clock (or use the ball's own fixed-step clock for isolated tests).
  impact(impact,time=impact?.time){
    const p=impact?.position,n=impact?.normal,speed=impact?.speed;
    if(!p||!n||!Number.isFinite(time)||!Number.isFinite(speed)||speed<=0||!Number.isFinite(p.x)||!Number.isFinite(p.y)||!Number.isFinite(p.z)||!Number.isFinite(n.x)||!Number.isFinite(n.y)||!Number.isFinite(n.z))return false;
    const length=Math.hypot(n.x,n.y,n.z);if(length<1e-8)return false;
    const pulse=this.impulses[this.next];this.next=(this.next+1)%MAX_IMPULSES;this.count=Math.min(MAX_IMPULSES,this.count+1);
    pulse.time=time;pulse.nx=n.x/length;pulse.ny=n.y/length;pulse.nz=n.z/length;pulse.strength=Math.min(1,speed/22)*.24;
    for(let vertex=0,i=0;i<this.rest.length;i+=3,vertex++){
      const distance=Math.hypot(this.rest[i]-p.x,this.rest[i+1]-p.y,this.rest[i+2]-p.z);
      pulse.distance[vertex]=distance;
      pulse.gain[vertex]=this.weights[vertex]*Math.exp(-distance*.95)*pulse.strength;
    }
    this.latestEnd=Math.max(this.latestEnd,time+NET_RESPONSE_DURATION);this.lastTime=NaN;return true;
  }
  // Sampling is analytic and frame-rate independent, including backwards seeks
  // within the retained eight-impact history. Return true only when an upload is
  // needed. At rest the exact original Float32 values are copied once, then skipped.
  update(positions,time){
    if(positions===this.rest||positions.length!==this.rest.length)throw new TypeError('Net output must be a separate, equally sized position buffer');
    if(!Number.isFinite(time)||time===this.lastTime)return false;
    this.lastTime=time;
    let active=false;
    if(time<this.latestEnd)for(let j=0;j<this.count;j++){const age=time-this.impulses[j].time;if(age>0&&age<NET_RESPONSE_DURATION){active=true;break;}}
    if(!active){if(!this.dirty)return false;positions.set(this.rest);this.dirty=false;return true;}
    for(let vertex=0,i=0;i<this.rest.length;i+=3,vertex++){
      let dx=0,dy=0,dz=0;
      if(this.weights[vertex]>0)for(let j=0;j<this.count;j++){
        const pulse=this.impulses[j],age=time-pulse.time,travel=age-pulse.distance[vertex]/10;
        if(age<=0||age>=NET_RESPONSE_DURATION||travel<=0)continue;
        // Smooth wave arrival, outward first deflection and smaller damped recoil.
        // A C1 fade provides a smooth finite-lifetime return to rest, reaching
        // zero before the stored impulse expires.
        const tail=1-smooth((age-1.2)/(NET_RESPONSE_DURATION-1.2));
        const amount=pulse.gain[vertex]*(1-Math.exp(-travel*35))*Math.sin(travel*18)*Math.exp(-travel*4.8)*tail;
        dx+=pulse.nx*amount;dy+=pulse.ny*amount;dz+=pulse.nz*amount;
      }
      // Smoothly limit overlapping hits rather than clipping individual axes.
      const scale=NET_MAX_DISPLACEMENT/Math.sqrt(NET_MAX_DISPLACEMENT*NET_MAX_DISPLACEMENT+dx*dx+dy*dy+dz*dz);
      positions[i]=this.rest[i]+dx*scale;positions[i+1]=this.rest[i+1]+dy*scale;positions[i+2]=this.rest[i+2]+dz*scale;
    }
    this.dirty=true;return true;
  }
  reset(positions){
    const changed=this.dirty;if(changed&&positions)positions.set(this.rest);
    this.count=0;this.next=0;this.latestEnd=-Infinity;this.lastTime=NaN;this.dirty=changed&&!positions;return changed;
  }
}

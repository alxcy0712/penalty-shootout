import {test} from 'node:test';
import assert from 'node:assert/strict';
import {body,strikerRunupPose,penaltyStyles,penaltyStyle,strikerPose,goalkeeperPose,holdingPose,neckAngles,HOLD_DURATION,keeperHesitationPose,keeperWarmupPose} from '../src/anatomy.js';
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
function check(p){for(let i=0;i<2;i++)for(const[a,b,length]of[[p.shoulders[i],p.elbows[i],body.upperArm],[p.elbows[i],p.hands[i],body.forearm],[p.hips[i],p.knees[i],body.thigh],[p.knees[i],p.feet[i],body.shin]])assert.ok(Math.abs(distance(a,b)-length)<1e-8);}
test('anatomical segment lengths remain fixed during shots, dives and recovery',()=>{for(let n=0;n<=600;n++){let t=n/120;check(strikerPose(t,Math.min(1,t/.55),t>.55?t-.55:-1));for(const direction of[-1,0,1])for(const height of[.3,1.2,2.3])check(goalkeeperPose({reach:85,speed:85},direction,t,height));}});
test('planted striking foot stays on turf from contact through follow-through',()=>{const origin=strikerPose(0,1,0).feet[0];for(let n=0;n<100;n++){const foot=strikerPose(0,1,n/120).feet[0];assert.ok(distance(origin,foot)<1e-8);assert.ok(Math.abs(foot.y-.075)<1e-8);}});
test('keeper airborne pelvis accelerates under gravity',()=>{const stats={reach:85,speed:85},dt=.001;for(const t of[.20,.25,.30]){const a=goalkeeperPose(stats,1,t-dt,2).hip,b=goalkeeperPose(stats,1,t,2).hip,c=goalkeeperPose(stats,1,t+dt,2).hip;assert.ok(Math.abs((a.y-2*b.y+c.y)/(dt*dt)+9.81)<1e-5);}});
test('dive and get-up keep joint centres above the playing surface',()=>{for(const d of[-1,1])for(const h of[.3,1.2,2.3])for(let n=0;n<=600;n++){const p=goalkeeperPose({reach:99,speed:99},d,n/120,h);for(const key of['hands','feet','knees','elbows'])p[key].forEach((point,index)=>{const braced=key==='hands'&&(p.torso?.[index?'braceR':'braceL']??0)>.5;assert.ok(point.y>=(braced?.03:.065),`${key} crossed its phase-specific joint floor`);});}});
test('kicking contact is continuous and boot toe reaches the ball',()=>{const a=strikerPose(0,1,-1),b=strikerPose(0,1,0);assert.ok(distance(a.feet[1],b.feet[1])<.01);assert.ok(distance({x:b.feet[1].x,y:b.feet[1].y,z:b.feet[1].z-.14},{x:0,y:.11,z:11})<.02);});
test('no joint teleports at backswing, takeoff or recovery transitions',()=>{
  const evaluate=[t=>strikerPose(t,Math.min(t/.55,1),t>=.55?t-.55:-1)];
  for(const direction of[-1,1])for(const height of[.3,1.2,2.3])evaluate.push(t=>goalkeeperPose({speed:85,reach:85},direction,t,height));
  for(const pose of evaluate){let previous=pose(0);for(let i=1;i<=3600;i++){const current=pose(i/1000);for(const key of['hands','elbows','feet','knees'])current[key].forEach((point,j)=>assert.ok(distance(point,previous[key][j])<.022,`${key} jumps at ${i}ms`));previous=current;}}
});
test('foot travels through contact continuously and responds to shot power',()=>{
  for(const power of[0,.5,1]){const dt=.00001;const before=strikerPose(0,1-dt/.55,-1,power).feet[1],at=strikerPose(0,1,0,power).feet[1],after=strikerPose(0,1,dt,power).feet[1];const inSpeed=(before.z-at.z)/dt,outSpeed=(at.z-after.z)/dt;assert.ok(Math.abs(inSpeed-(5+13*power))<.02);assert.ok(Math.abs(inSpeed-outSpeed)<.02);}
});
test('the body follows the kicking foot through impact before settling',()=>{
  const contact=strikerPose(0,1,0,.7,0),follow=strikerPose(0,1,.2,.7,0),settled=strikerPose(0,1,1.2,.7,0);
  assert.ok(distance(contact.hands[0],follow.hands[0])>.07);
  assert.ok(Math.abs(contact.right.z-follow.right.z)>.08);
  assert.ok(Math.abs(settled.feet[1].y-.075)<.01);
});
test('correct high-ball reads fully extend toward the chosen side',()=>{
  for(const direction of[-1,1]){
    const pose=goalkeeperPose({speed:85,reach:85},direction,.30,2);
    const reach=Math.max(...pose.hands.map(hand=>(hand.x-pose.hip.x)*direction));
    assert.ok(reach>.8,`${direction} reach ${reach}`);
    assert.ok(pose.hip.x*direction>.8);
  }
});
test('wrong-way recognition produces a readable grounded half-dive and recovery',()=>{
  for(const direction of[-1,1]){
    const origin=goalkeeperPose({speed:85,reach:85},direction,.1,1.2);
    const brace=keeperHesitationPose(origin,direction,.22),recovered=keeperHesitationPose(origin,direction,.95);
    assert.ok((brace.hip.x-origin.hip.x)*direction>.14);
    assert.ok(brace.up.x*direction>.2);
    assert.ok(Math.abs(brace.hands[0].y-brace.hands[1].y)>.06);
    for(let i=0;i<2;i++)assert.ok(distance(brace.feet[i],origin.feet[i])<1e-8);
    assert.ok(Math.abs(recovered.up.x)<1e-8);
  }
});
test('the pelvis carries momentum through impact and the swinging foot immediately returns to the turf',()=>{
  const dt=.00001;
  for(const power of[0,.5,1])for(const x of[-4.5,0,4.5]){
    const before=strikerPose(0,1-dt/.55,-1,power,x),at=strikerPose(0,1,0,power,x),after=strikerPose(0,1,dt,power,x);
    const incoming=(at.hip.z-before.hip.z)/dt,outgoing=(after.hip.z-at.hip.z)/dt;
    assert.ok(outgoing<-.6);assert.ok(Math.abs(incoming-outgoing)<.005);
    const apex=3*(.36+.16*power)/(5+13*power);
    const peak=strikerPose(0,1,apex,power,x).feet[1];
    for(const elapsed of[.025,.05,.10]){
      const foot=strikerPose(0,1,apex+elapsed,power,x).feet[1];
      assert.ok(foot.y<peak.y-.001);assert.ok(distance(foot,peak)>.001);
    }
    const settled=strikerPose(0,1,1.2,power,x);assert.ok(Math.abs(settled.feet[1].y-.075)<1e-8);
  }
});
test('wrong-way braking inherits the incoming motion before settling on planted feet',()=>{
  const dt=.00001;
  for(const direction of[-1,1]){
    const stats={speed:85,reach:85},origin=goalkeeperPose(stats,direction,.1,1.2),previous=goalkeeperPose(stats,direction,.099,1.2);
    const start=keeperHesitationPose(origin,direction,0,previous),next=keeperHesitationPose(origin,direction,dt,previous);
    for(const key of['hip','up','hands','elbows','knees','feet']){
      const list=p=>Array.isArray(p[key])?p[key]:[p[key]];
      list(origin).forEach((point,i)=>{
        assert.ok(distance(point,list(start)[i])<1e-8);
        const jump=Math.hypot(...['x','y','z'].map(k=>(list(next)[i][k]-point[k])/dt-(point[k]-list(previous)[i][k])/.001));
        assert.ok(jump<.04,`${direction}/${key}: velocity jump ${jump}`);
      });
    }
    for(let n=0;n<=95;n++){const pose=keeperHesitationPose(origin,direction,n/100,previous);check(pose);for(let i=0;i<2;i++)assert.ok(distance(pose.feet[i],origin.feet[i])<1e-8);}
  }
});
test('keeper landing absorbs vertical speed continuously',()=>{
  const dt=.00001,stats={speed:85,reach:85};
  for(const height of[.3,1.2,2.3])for(const stretch of[0,1]){
    let previousVelocity=null;
    for(let t=.40;t<1.15;t+=.001){
      const before=goalkeeperPose({...stats,stretch},1,t-dt,height),after=goalkeeperPose({...stats,stretch},1,t+dt,height);
      const velocity=(after.hip.y-before.hip.y)/(2*dt);
      if(previousVelocity!==null)assert.ok(Math.abs(velocity-previousVelocity)<.15,`landing velocity jumps at ${height}/${stretch}/${t}`);
      previousVelocity=velocity;
    }
  }
});
test('left and right shots align the striking foot and preserve impact velocity and support',()=>{
  const dt=.00001;
  for(const x of[-4.5,-2,0,2,4.5])for(const power of[0,.5,1]){
    const before=strikerPose(0,1-dt/.55,-1,power,x),at=strikerPose(0,1,0,power,x),after=strikerPose(0,1,dt,power,x);
    const incoming={x:(at.feet[1].x-before.feet[1].x)/dt,z:(at.feet[1].z-before.feet[1].z)/dt};
    const outgoing={x:(after.feet[1].x-at.feet[1].x)/dt,z:(after.feet[1].z-at.feet[1].z)/dt};
    assert.ok(Math.abs(incoming.x/-incoming.z-x/11)<.002);
    assert.ok(Math.hypot(incoming.x-outgoing.x,incoming.z-outgoing.z)<.03);
    const yaw=at.feetYaw[1],toe={x:at.feet[1].x-.14*Math.sin(yaw),y:at.feet[1].y,z:at.feet[1].z-.14*Math.cos(yaw)};
    assert.ok(distance(toe,{x:0,y:.11,z:11})<.02);
    for(let n=0;n<=120;n++){const t=n/120,p=strikerPose(t,Math.min(t/.55,1),t>=.55?t-.55:-1,power,x);check(p);if(t>=.55)assert.ok(distance(p.feet[0],{x:-.28,y:.075,z:11.02})<1e-8);}
  }
});

test('secured-ball arm pose keeps bone lengths and brings both hands around the ball',()=>{for(const direction of[-1,0,1])for(let n=0;n<180;n++){const p=goalkeeperPose({speed:85,reach:85},direction,n/60,1.2),hold=holdingPose(p);check(hold.pose);assert.ok(hold.center.y>=.15);for(const hand of hold.pose.hands)assert.ok(distance(hand,hold.center)<.19);}});
test('the catch-to-hold transition preserves the original elbow bend at its start',()=>{
  for(const direction of[-1,0,1])for(const height of[.3,1.2,2.3])for(let n=0;n<180;n++){
    const source=goalkeeperPose({speed:85,reach:85},direction,n/60,height),start=holdingPose(source,0).pose,first=holdingPose(source,.001/HOLD_DURATION).pose;
    check(start);check(first);
    for(let i=0;i<2;i++){
      assert.ok(distance(source.elbows[i],start.elbows[i])<1e-7);
      assert.ok(distance(source.hands[i],start.hands[i])<1e-7);
      assert.ok(distance(source.elbows[i],first.elbows[i])<.005);
    }
  }
});

test('ball tracking stays within neck limits and releases attention behind the player',()=>{for(const facing of[-1,1])for(const x of[-10,0,10])for(const y of[-3,0,3])for(const z of[-10,0,10]){const a=neckAngles({x,y,z},facing);assert.ok(Math.abs(a.yaw)<=.55);assert.ok(Math.abs(a.pitch)<=.5);if(z*facing<-.4)assert.equal(Math.abs(a.yaw)+Math.abs(a.pitch),0);}});

test('approach always has a planted support foot and the new plant never slides',()=>{for(const power of[0,.5,1])for(let n=0;n<=1000;n++){const phase=n/1000,p=strikerPose(0,phase,-1,power);assert.ok(p.feet.some(f=>Math.abs(f.y-.075)<.001),`unsupported at ${phase}`);if(phase>=.62)assert.ok(distance(p.feet[0],{x:-.28,y:.075,z:11.02})<1e-8);else assert.ok(distance(p.feet[1],{x:-.03,y:.075,z:12.05})<1e-8);}});

test('individual runups keep fixed bones and join the striking pose continuously',()=>{
  for(const style of penaltyStyles){
    let previous=null;
    for(let ms=0;ms<=style.duration*1000+500;ms++){
      const t=ms/1000,p=strikerRunupPose(t,Math.min(1,t/style.duration),t>=style.duration?t-style.duration:-1,.7,2,style);check(p);
      for(const f of p.feet)assert.ok(f.y>=.074);
      assert.ok(p.feet.some(f=>Math.abs(f.y-.075)<.001),`${style.name}/${ms}/support`);
      if(previous)for(const key of ['hip','hands','feet','knees','elbows']){
        const a=Array.isArray(p[key])?p[key]:[p[key]],b=Array.isArray(previous[key])?previous[key]:[previous[key]];
        a.forEach((point,i)=>assert.ok(distance(point,b[i])<.03,`${style.name}/${ms}/${key}`));
      }
      previous=p;
    }
    const contact=strikerRunupPose(0,1,0,.7,2,style);assert.deepEqual(contact,strikerPose(0,1,0,.7,2));
  }
  assert.equal(penaltyStyle({number:8}),penaltyStyle(JSON.parse('{"number":8}')));
  assert.equal(new Set([8,9,10].map(number=>penaltyStyle({number}).name)).size,3);
});
test('runup pelvis keeps moving through intermediate footfalls',()=>{
  for(const style of penaltyStyles)for(let step=1;step<style.steps;step++){
    const q=step/style.steps,clock=(-.7+Math.sqrt(.49+1.2*q))/.6,t=clock*(style.duration-.55);
    const pose=at=>strikerRunupPose(at,at/style.duration,-1,.7,0,style);
    for(const at of[t-.002,t+.001])assert.ok((pose(at).hip.z-pose(at+.001).hip.z)/.001>.15,`${style.name}/${step}`);
  }
});
test('runup joints have continuous velocity at footfalls and the final gather',()=>{
  const dt=.00001;
  for(const style of penaltyStyles){
    const sample=t=>strikerRunupPose(t,t/style.duration,-1,.7,0,style);
    for(let step=1;step<=style.steps;step++){
      const q=step/style.steps,clock=(-.7+Math.sqrt(.49+1.2*q))/.6,t=clock*(style.duration-.55);
      const before=sample(t-dt),at=sample(t),after=sample(t+dt);
      for(const key of ['hip','knees','hands','feet']){
        const list=p=>Array.isArray(p[key])?p[key]:[p[key]],a=list(before),b=list(at),c=list(after);
        for(let i=0;i<a.length;i++){
          const jump=Math.hypot(...['x','y','z'].map(k=>(c[i][k]-2*b[i][k]+a[i][k])/dt));
          assert.ok(jump<.05,`${style.name}/${step}/${key}: velocity jump ${jump}`);
        }
      }
    }
  }
});
test('runups keep a steady body height and carry the loaded stance into the strike',()=>{
  const dt=1/240;
  for(const style of penaltyStyles)for(const offset of[0,4,8]){
    const end=style.duration-.55,sample=t=>strikerRunupPose(offset+t,t/style.duration,-1,.7,0,style);
    for(let t=dt;t<end-dt;t+=.001){
      const before=sample(t-dt).hip,at=sample(t).hip,after=sample(t+dt).hip;
      assert.ok(at.y>.73,`${style.name}: hip collapses at ${t}`);
      assert.ok(Math.abs(after.y-before.y)/(2*dt)<.8,`${style.name}: abrupt vertical movement at ${t}`);
      assert.ok(Math.abs(after.y-2*at.y+before.y)/(dt*dt)<35,`${style.name}: body jolts at ${t}`);
      if(t>end*.85)assert.ok(at.y<.82,`${style.name}: stands up before the plant`);
    }
  }
});
test('runup footfalls preserve pelvis acceleration and keep each support foot fixed',()=>{
  const dt=.0001;
  for(const style of penaltyStyles){
    const sample=t=>strikerRunupPose(t,t/style.duration,-1,.7,0,style),time=q=>(-.7+Math.sqrt(.49+1.2*q))/.6*(style.duration-.55);
    for(let step=1;step<style.steps;step++){
      const t=time(step/style.steps),a=sample(t-2*dt).hip,b=sample(t-dt).hip,c=sample(t).hip,d=sample(t+dt).hip,e=sample(t+2*dt).hip;
      const jump=Math.hypot(...['x','y','z'].map(key=>((e[key]-2*d[key]+c[key])-(c[key]-2*b[key]+a[key]))/(dt*dt)));
      assert.ok(jump<.1,`${style.name}/${step}: acceleration changes abruptly`);
    }
    for(let step=0;step<style.steps;step++){
      const support=1-step%2,foot=sample(time((step+.05)/style.steps)).feet[support];
      for(let u=.1;u<1;u+=.05)assert.ok(distance(sample(time((step+u)/style.steps)).feet[support],foot)<1e-8,`${style.name}/${step}: support foot slides`);
    }
  }
});

test('lobby warmup keeps feet planted while shifting weight and stretching arms',()=>{
 const first=keeperWarmupPose(0);let min=Infinity,max=-Infinity;
 for(let n=0;n<=2400;n++){const pose=keeperWarmupPose(n/100);check(pose);for(let i=0;i<2;i++)assert.ok(distance(pose.feet[i],first.feet[i])<1e-8);min=Math.min(min,pose.hands[0].y);max=Math.max(max,pose.hands[0].y);}
 assert.ok(max-min>.35);
});

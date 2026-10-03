import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {Shot,keeperPose} from '../src/engine.js';
import {keeperGather} from '../src/keeper-contact.js';
import {loadCharacter,skinSurfaceDistance} from './helpers/load-character.js';

const stats={accuracy:90,power:90,touch:90,composure:90,speed:65,reach:65,handling:95};
const lowShot=()=>new Shot({x:.3,y:2.24,power:.15},stats,stats,0,101);
function finish(shot){for(let frame=0;frame<3600&&!shot.result;frame++)shot.step(1/120);assert.ok(shot.result,'shot settles within thirty seconds');return shot;}

test('a failed low catch reaches the other glove before entering the body',async()=>{
  const shot=lowShot(),impacts=[],draws=[],reflect=shot.reflect.bind(shot),next=shot.rng.next.bind(shot.rng);
  shot.reflect=(hit,radius,restitution)=>{impacts.push({time:shot.t,part:shot.contactPart});return reflect(hit,radius,restitution);};
  shot.rng.next=()=>{draws.push({time:shot.t,part:shot.contactPart});return next();};
  finish(shot);
  assert.ok(shot.caught);assert.equal(shot.contactPart,'handR');
  assert.ok(impacts.length>=1&&impacts.every(p=>p.part==='handL'),'the first palm deflects before the other palm intercepts');
  assert.deepEqual(draws.map(p=>p.part),['handL','handR'],'the second collision on the first palm gets no extra possession roll');
  assert.ok(shot.t-impacts[0].time<.025,'the other palm intercepts the rebound before it reaches the thigh');
  const actor=await loadCharacter(true);actor.pose(shot.pose);
  const gap=skinSurfaceDistance(actor.root,new Vector3().copy(shot.ball))-.11;
  assert.ok(gap>-.002&&gap<.002,`the real captured sphere touches the visible skin: ${gap} m`);
  const start=keeperGather(shot.pose,shot.poseAt(shot.t),shot.ball,shot.contactPart,0);
  assert.deepEqual(start.pose,shot.pose);assert.deepEqual({...start.ball},shot.ball,'the corrected source needs no gather-frame jump');
});

test('body contacts remain solid while either glove is waiting to retry handling',()=>{
  const shot=lowShot(),pose=keeperPose(stats,0,.5,1.2);
  shot.t=1;shot.pose=pose;shot.poseAt=()=>pose;shot.trackKeeper=()=>{};
  shot.ball={x:0,y:1,z:.4};shot.velocity={x:0,y:9.81/120,z:-24};
  shot.contactPart='handL';shot.contactUntil=2;shot.handlingUntil={handL:2,handR:2};
  shot.rng.next=()=>{throw Error('a body contact must not reroll handling');};
  shot.step(1/120);
  assert.equal(shot.contactPart,'torso');assert.ok(shot.touched);assert.equal(shot.caught,false);
  assert.ok(shot.velocity.z>0,'the torso reflects the approaching rebound');
  assert.ok(shot.ball.z>.29,'the sphere is resolved at the torso front');
});

test('the opposite central low recipe also starts its gather on the actual visible skin',async()=>{
  const shot=finish(new Shot({x:-.3,y:2.24,power:.15},stats,stats,0,101));
  assert.ok(shot.caught,'the mirrored recipe is evaluated with its own seeded trajectory');
  const actor=await loadCharacter(true);actor.pose(shot.pose);
  const gap=skinSurfaceDistance(actor.root,new Vector3().copy(shot.ball))-.11;
  assert.ok(gap>-.002&&gap<.002,`the opposite captured sphere touches the visible skin: ${gap} m`);
  const start=keeperGather(shot.pose,shot.poseAt(shot.t),shot.ball,shot.contactPart,0);
  assert.deepEqual(start.pose,shot.pose);assert.deepEqual({...start.ball},shot.ball);
});

test('per-glove cooldowns survive restoration, including a legacy rebound save',()=>{
  const shot=lowShot();while(!shot.touched)shot.step(1/120);
  assert.equal(shot.caught,false);assert.equal(shot.contactPart,'handL');
  const raw=JSON.parse(JSON.stringify(shot)),restored=Shot.restore(structuredClone(raw)),legacy=structuredClone(raw);
  const shared=structuredClone(raw),first=Shot.restore(shared),second=Shot.restore(shared),savedCooldown={...shared.handlingUntil};
  finish(first);
  assert.notDeepEqual(first.handlingUntil,savedCooldown,'the advanced replay records the other palm');
  assert.deepEqual(second.handlingUntil,savedCooldown,'two restores from one snapshot own separate cooldown maps');
  assert.deepEqual(shared.handlingUntil,savedCooldown,'advancing a restored shot leaves the supplied cooldown snapshot unchanged');
  delete legacy.handlingUntil;const upgraded=Shot.restore(legacy);
  assert.deepEqual(upgraded.handlingUntil,shot.handlingUntil);
  finish(shot);finish(restored);finish(upgraded);
  const outcome=s=>({result:s.result,t:s.t,ball:s.ball,part:s.contactPart,handlingUntil:s.handlingUntil,randomState:s.rng.state});
  assert.deepEqual(outcome(restored),outcome(shot));assert.deepEqual(outcome(upgraded),outcome(shot));
  const oldNewShot=JSON.parse(JSON.stringify(lowShot()));delete oldNewShot.handlingUntil;
  assert.deepEqual(Shot.restore(oldNewShot).handlingUntil,{});
});

test('the complete fresh matrix has bounded contacts and cannot reroll the same glove during cooldown',()=>{
  let index=0,shots=0,contacts=0;
  for(const seed of [101,907])for(const x of [-3.25,-1.4,-.3,.3,1.4,3.25])for(const y of [.18,1.16,2.24])for(const power of [.15,.52,.86])for(const direction of [0,Math.sign(x)]){
    const ability=[65,85,99][index++%3],attributes={...stats,speed:ability,reach:ability};
    const shot=new Shot({x,y,power},attributes,attributes,direction,seed),next=shot.rng.next.bind(shot.rng),reflect=shot.reflect.bind(shot),lastRoll={};let frameContacts=0;
    shot.rng.next=()=>{const previous=lastRoll[shot.contactPart];if(previous!==undefined)assert.ok(shot.t-previous>=.09-1e-9,'each glove waits before another possession attempt');lastRoll[shot.contactPart]=shot.t;return next();};
    shot.reflect=(...args)=>{frameContacts++;contacts++;return reflect(...args);};
    for(let frame=0;frame<3600&&!shot.result;frame++){
      frameContacts=0;shot.step(1/120);assert.ok(frameContacts<=4,'at most four physical resolutions per fixed step');
      assert.ok(Object.values(shot.ball).every(Number.isFinite));
    }
    assert.ok(shot.result,`fresh fixture ${index} settles within thirty seconds`);shots++;
  }
  assert.equal(shots,216);assert.ok(contacts>20,'the full matrix includes real rebounds');
});


test('initial-overlap correction retains the fast shin graze remaining travel without penetrating skin',async()=>{
  const attributes={...stats,speed:99,reach:99},shot=new Shot({x:-.3,y:.18,power:.86},attributes,attributes,-1,101),actor=await loadCharacter(true);
  while(!shot.touched)shot.step(1/120);
  const impactTime=shot.t,impact=new Vector3().copy(shot.ball);shot.step(1/120);
  assert.ok(new Vector3().copy(shot.ball).distanceTo(impact)>.15,'the fast grazing rebound consumes its remaining tangential flight instead of sticking to the moving shin');
  assert.ok(Math.hypot(...Object.values(shot.velocity))>20,'the test exercises a fast physical rebound');
  while(!shot.result&&shot.t<1){actor.pose(shot.pose);const gap=skinSurfaceDistance(actor.root,new Vector3().copy(shot.ball))-.11;assert.ok(gap>-.002,'the moving surface is still solid throughout departure');shot.step(1/120);}
  assert.ok(shot.result&&shot.t-impactTime<.06,'the unobstructed rebound departs the keeper promptly');
});

test('re-sweeps classify either goal-mouth edge using the final corrected segment',()=>{
  for(const side of [-1,1])for(const edge of [-.001,.001]){
    const shot=lowShot(),pose=keeperPose(stats,0,.5,1.2),point={x:pose.feet[0].x,y:.11,z:pose.feet[0].z+.1};
    shot.pose=pose;shot.poseAt=()=>pose;shot.trackKeeper=()=>{};shot.ball=point;shot.velocity={x:0,y:0,z:-80};
    const fraction=(.3+.11)/(.5),velocityX=side*.48,correctedX=side*(3.55+edge)-velocityX/120*fraction;let resolutions=0;
    shot.reflect=()=>{resolutions++;shot.ball={x:correctedX,y:1,z:.3};shot.velocity={x:velocityX,y:0,z:-60};};
    shot.step(1/120);
    assert.equal(resolutions,1);assert.ok(shot.result);assert.equal(shot.result.goal,edge<0,'goal classification uses the actual crossing after the correction');
  }
});

test('simultaneous overlap retries apply sliding ground friction once per fixed step',()=>{
  const shot=lowShot(),pose=keeperPose(stats,0,.5,1.2),point={x:pose.feet[0].x,y:.11,z:pose.feet[0].z+.1};
  shot.pose=pose;shot.poseAt=()=>pose;shot.trackKeeper=()=>{};shot.ball=point;shot.velocity={x:1,y:0,z:0};let resolutions=0;
  shot.reflect=()=>{resolutions++;shot.ball={...point};shot.velocity.y=-.1;};
  shot.step(1/120);
  assert.equal(resolutions,4,'the synthetic simultaneous contact reaches the bounded solver limit');
  assert.ok(Math.abs(shot.velocity.x-(1-.8/120))<1e-12,'contact retries do not consume another full time step of sliding friction');
});

test('near-vertical floor contacts exit the finite surface without unbounded projection',async()=>{
  const {Quaternion,Triangle}=await import('three');
  const {keeperContactData}=await import('../src/keeper-contact-data.js');
  const {keeperHandRotation,keeperSurfaceContacts}=await import('../src/keeper-contact.js');
  const surface=keeperContactData.hulls.handL.surface,triangles=[];
  for(let i=0;i<surface.indices.length;i+=3)triangles.push(new Triangle(...surface.indices.slice(i,i+3).map(j=>new Vector3().fromArray(surface.vertices[j]))));
  const triangle=triangles.toSorted((a,b)=>b.getArea()-a.getArea())[0],localNormal=triangle.getNormal(new Vector3()),localPoint=triangle.getMidpoint(new Vector3());
  for(const horizontal of[0,1e-8,1e-6,1e-4,.01]){
    const shot=lowShot(),pose=keeperPose(stats,0,.5,1.2),normal=new Vector3(horizontal,-Math.sqrt(1-horizontal*horizontal),0),rotation=new Quaternion().setFromUnitVectors(localNormal,normal),point=localPoint.clone().applyQuaternion(rotation);
    pose.hands[0]={...pose.hands[0],y:.108-normal.y*.11-point.y};
    pose.grip={handRotations:[rotation.toArray(),keeperHandRotation(pose,1).toArray()]};point.add(pose.hands[0]);
    const initial=point.clone().addScaledVector(normal,.11);shot.pose=pose;shot.contactPart='handL';shot.velocity={x:0,y:1,z:0};shot.ball={...initial};
    shot.reflect({p:initial,q:point},.11,.34);
    assert.ok(Object.values(shot.ball).every(Number.isFinite));assert.ok(shot.ball.y>=.11-1e-10);
    assert.ok(initial.distanceTo(new Vector3().copy(shot.ball))<.05,'the finite glove edge is nearby even when its tangent plane has no stable floor intersection');
    assert.deepEqual(keeperSurfaceContacts(pose,shot.ball,shot.ball,.11),[],'the bounded correction clears the actual contact geometry');
  }
});


test('overlapping moving palms cannot freeze possession inside the opposite glove',async()=>{
  const attributes={...stats,speed:85,reach:85,handling:99},shot=new Shot({x:0,y:1,power:.4},attributes,attributes,0,1),actor=await loadCharacter(true);
  for(let frame=0;frame<3600&&!shot.result;frame++){
    shot.step(1/120);
    if(shot.ball.z>3||shot.ball.z<-.5||Math.abs(shot.ball.x-shot.pose.hip.x)>2)continue;
    actor.pose(shot.pose);
    const gap=skinSurfaceDistance(actor.root,new Vector3().copy(shot.ball))-.11;
    assert.ok(gap>=-.005,`both moving gloves remain outside the ball at ${shot.t}: ${gap} m`);
  }
  assert.ok(shot.result);
});

test('a committed tracking stride finishes continuously through contact cooldown',()=>{
  const attributes={...stats,speed:85,reach:90},shot=new Shot({x:-3.4,y:.2,power:.1},attributes,attributes,0,42);
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
  let cooldownFootTravel=0,sawCommittedContact=false;
  for(let ms=1;ms<5000&&!shot.result;ms++){
    const previous=shot.pose,step=shot.footStep,cooling=shot.t<shot.contactUntil;
    shot.step(.001);
    for(const part of ['hands','elbows','knees','feet'])for(let i=0;i<2;i++)
      assert.ok(distance(previous[part][i],shot.pose[part][i])<.022,`${part} stays continuous at ${ms} ms`);
    if(cooling&&step&&!shot.direction){
      sawCommittedContact=true;cooldownFootTravel+=distance(previous.feet[step.index],shot.pose.feet[step.index]);
    }
  }
  assert.ok(shot.result&&shot.touched,'the rolling corner recipe exercises a complete real rebound');
  assert.ok(sawCommittedContact&&cooldownFootTravel>.02,'the already moving foot completes its stride while new tracking decisions wait');
});

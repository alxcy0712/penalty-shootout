import {test} from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';import {Shot,GOAL} from '../src/engine.js';import {Player} from '../src/character.js';import {goalkeeperPose,strikerRunupPose,penaltyStyles,strikerPose,holdingPose,keeperPreparation,keeperHesitationPose,keeperWarmupPose} from '../src/anatomy.js';
// Texture text painting is irrelevant to vertex placement; use a minimal canvas
// stand-in to inspect the actual model geometry without a browser renderer.
globalThis.document={createElement:()=>({width:256,height:256,getContext:()=>({clearRect(){},fillText(){}})})};
test('animated limb lighting matches geometry normals across bends and material seams',()=>{
 const player=new Player(new THREE.Scene(),'#b9efd7',true),a=new THREE.Vector3(),b=new THREE.Vector3();
 for(const sample of[t=>keeperWarmupPose(t),t=>goalkeeperPose({speed:85,reach:85},1,t,2),t=>goalkeeperPose({speed:85,reach:85},-1,t,.3),t=>strikerPose(t,Math.min(1,t/.55),t>=.55?t-.55:-1)])for(const t of[0,.1,.3,.55,.8,1.5,2.5]){
  player.pose(sample(t));
  for(const limb of player.limbs){
   const reference=limb.geometry.clone();reference.computeVertexNormals();
   const expected=reference.attributes.normal,actual=limb.geometry.attributes.normal;
   for(let row=0;row<=32;row++){const first=row*17,last=first+16;a.fromBufferAttribute(expected,first);b.fromBufferAttribute(expected,last);a.add(b).normalize();expected.setXYZ(first,a.x,a.y,a.z);expected.setXYZ(last,a.x,a.y,a.z);}
   for(let i=0;i<actual.array.length;i++)assert.ok(Math.abs(actual.array[i]-expected.array[i])<1e-5);
   reference.dispose();
  }
 }
});
test('resting limbs avoid buffer uploads and resume correctly when a reused pose changes',()=>{
 const player=new Player(new THREE.Scene(),'#b9efd7',true),fresh=new Player(new THREE.Scene(),'#b9efd7',true),pose=keeperWarmupPose(0);
 player.pose(pose);const versions=player.limbs.map(limb=>[limb.geometry.attributes.position.version,limb.geometry.attributes.normal.version]);
 player.pose(structuredClone(pose));
 assert.deepEqual(player.limbs.map(limb=>[limb.geometry.attributes.position.version,limb.geometry.attributes.normal.version]),versions);
 Object.assign(pose,keeperWarmupPose(.5));player.pose(pose);fresh.pose(pose);
 for(let i=0;i<player.limbs.length;i++)for(const attribute of['position','normal'])assert.deepEqual(player.limbs[i].geometry.attributes[attribute].array,fresh.limbs[i].geometry.attributes[attribute].array);
});
test('inspection views share deformation and retain identical moving hands and boots',()=>{
 const front=new Player(new THREE.Scene(),'#b9efd7',true),side=new Player(new THREE.Scene(),'#e8ac73',true);
 for(const t of[0,.1,.3,.7,1.4,2.5]){
  front.pose(holdingPose(goalkeeperPose({speed:85,reach:85},1,t,1.2)).pose);side.copyPose(front);
  for(let i=0;i<4;i++)assert.equal(side.limbs[i].geometry,front.limbs[i].geometry);
  for(const part of['hands','feet'])for(let i=0;i<2;i++){
   assert.ok(side[part][i].position.equals(front[part][i].position));
   assert.ok(side[part][i].quaternion.equals(front[part][i].quaternion));
  }
  assert.ok(side.trunk.position.equals(front.trunk.position));
  assert.ok(side.trunk.quaternion.equals(front.trunk.quaternion));
 }
 assert.notEqual(side.shirt,front.shirt);
});
test('rendered characters clear the grass and landed keepers retain ground support',()=>{
 const point=new THREE.Vector3(),keeper=new Player(new THREE.Scene(),'#e8ac73',true),striker=new Player(new THREE.Scene(),'#b9efd7');
 const inspect=(player,pose,label,grounded=false)=>{let minimum=Infinity;player.pose(pose);player.group.updateMatrixWorld(true);player.group.traverse(object=>{if(!object.isMesh)return;const positions=object.geometry.attributes.position;for(let i=0;i<positions.count;i++){point.fromBufferAttribute(positions,i).applyMatrix4(object.matrixWorld);minimum=Math.min(minimum,point.y);assert.ok(point.y>=-.0140001,`${label}: mesh penetrates pitch at ${point.y}`);if(label.startsWith('keeper')&&point.y>=0&&point.y<=GOAL.height+GOAL.postRadius)for(const postX of[-(GOAL.half+GOAL.postRadius),GOAL.half+GOAL.postRadius])assert.ok(Math.hypot(point.x-postX,point.z-GOAL.postRadius)>=GOAL.postRadius,`${label}: model intersects goalpost`);}});if(grounded)assert.ok(minimum<=.002,`${label}: entire body floats at ${minimum} m`);};
 for(let n=0;n<=240;n++)inspect(keeper,keeperWarmupPose(n/10),`warmup ${n}`,true);
 for(const direction of[-1,1])for(const height of[.3,1.2,2.3])for(let n=0;n<=180;n+=2)inspect(keeper,goalkeeperPose({speed:85,reach:85},direction,n/60,height),`keeper ${direction}/${height}/${n}`,n>=60);
 for(const direction of[-1,1])for(const height of[.3,1.2,2.3])for(let n=0;n<=180;n+=6)inspect(keeper,goalkeeperPose({speed:85,reach:85,diveVelocity:1.5},direction,n/60,height),`keeper short ${direction}/${height}/${n}`,n>=60);
 for(const direction of[-1,1])for(let n=0;n<=36;n++)inspect(keeper,keeperPreparation({speed:85,reach:85},direction,n/100,2,.3),`keeper preparation ${direction}/${n}`);
 for(const direction of[-1,1])for(const height of[.3,1.2,2.3])for(let n=0;n<=210;n+=3)inspect(keeper,goalkeeperPose({speed:95,reach:95,stretch:1},direction,n/60,height),`keeper stretch ${direction}/${height}/${n}`,n>=80);
 const stats={accuracy:90,power:90,touch:90,composure:90,speed:85,reach:90,handling:95};
 for(const x of[-3.3,-1,1,3.3])for(const power of[.1,.55]){const shot=new Shot({x,power,y:power>.5?2.1:.2},stats,stats,power>.5?Math.sign(x):0,42);for(let n=0;n<600&&!shot.result;n++){shot.step(1/120);if(n%6===0)inspect(keeper,shot.pose,`keeper tracking ${x}/${power}/${n}`);}}
 for(const direction of[-1,1])for(let n=0;n<=150;n+=3)inspect(keeper,keeperHesitationPose(goalkeeperPose({speed:85,reach:85},direction,.1,1.4),direction,n/100),`keeper hesitation ${direction}/${n}`,true);
 for(const direction of[-1,1])for(const t of[.3,.5,.8,1.2,1.5,1.8,2.2,2.8])inspect(keeper,holdingPose(goalkeeperPose({speed:85,reach:85},direction,t,1.2)).pose,`held ${direction}/${t}`);
 for(const height of[.3,1.2,2.3])for(let n=0;n<=36;n++){const pose=goalkeeperPose({speed:85,reach:85},0,n/30,height);inspect(keeper,pose,`central ${height}/${n}`,true);inspect(keeper,holdingPose(pose).pose,`central hold ${height}/${n}`,true);}
 for(const style of penaltyStyles)for(let t=0;t<style.duration+.5;t+=1/60)inspect(striker,strikerRunupPose(t,Math.min(1,t/style.duration),t>=style.duration?t-style.duration:-1,.7,2,style),`runup ${style.name}/${t}`,true);
 for(const x of[-4.5,0,4.5])for(const power of[0,1])for(let n=0;n<=120;n++){const t=n/120;inspect(striker,strikerPose(t,Math.min(t/.55,1),t>=.55?t-.55:-1,power,x),`striker ${x}/${power}/${n}`);}
 for(const shotType of['low','chip'])for(const x of[-4.5,0,4.5])for(const power of[0,1])for(let n=0;n<=96;n++){const t=n/60;inspect(striker,strikerPose(t,Math.min(t/.55,1),t>=.55?t-.55:-1,power,x,0,shotType),`${shotType} ${x}/${power}/${n}`,true);}
});
test('standing boots contact the grass instead of hovering over it',()=>{
 const point=new THREE.Vector3();for(const keeper of[false,true]){const player=new Player(new THREE.Scene(),'#b9efd7',keeper);player.pose(keeper?goalkeeperPose({speed:85,reach:85}):strikerPose(0,0));player.group.updateMatrixWorld(true);for(const foot of player.feet){let minimum=Infinity;foot.traverse(object=>{if(!object.isMesh)return;const positions=object.geometry.attributes.position;for(let i=0;i<positions.count;i++){point.fromBufferAttribute(positions,i).applyMatrix4(object.matrixWorld);minimum=Math.min(minimum,point.y);}});assert.ok(Math.abs(minimum+.014)<1e-6);}}
});
test('holding wrists face the ball and turn continuously while gathering it',()=>{
 const player=new Player(new THREE.Scene(),'#b9efd7',true),source=goalkeeperPose({speed:85,reach:85},0,.3,1.2),normal=new THREE.Vector3(),towardBall=new THREE.Vector3();
 let previous;
 for(let frame=0;frame<=120;frame++){
  const hold=holdingPose(source,frame/120);player.pose(hold.pose);
  if(previous)for(let i=0;i<2;i++)assert.ok(previous[i].angleTo(player.hands[i].quaternion)<.06);
  previous=player.hands.map(hand=>hand.quaternion.clone());
  if(frame===120)for(let i=0;i<2;i++){
   normal.set(0,0,1).applyQuaternion(player.hands[i].quaternion);
   towardBall.set(hold.center.x,hold.center.y,hold.center.z).sub(player.hands[i].position).normalize();
   assert.ok(normal.dot(towardBall)>.99);
  }
 }
});
test('boots rotate continuously through lift-off, contact and goalkeeper recovery',()=>{
 const striker=new Player(new THREE.Scene(),'#b9efd7'),keeper=new Player(new THREE.Scene(),'#e8ac73',true);
 const scan=(player,sample,label)=>{
  player.pose(sample(0));const previous=player.feet.map(foot=>foot.quaternion.clone());
  for(let n=1;n<=3500;n++){
   player.pose(sample(n/1000));
   for(let i=0;i<2;i++){
    const angle=previous[i].angleTo(player.feet[i].quaternion);
    assert.ok(angle<.05,`${label}: foot ${i} rotated ${angle} radians within 1 ms at ${n} ms`);
    previous[i].copy(player.feet[i].quaternion);
   }
  }
 };
 for(const x of[-4.5,0,4.5])for(const power of[0,.5,1])scan(striker,t=>strikerPose(t,Math.min(t/.55,1),t>=.55?t-.55:-1,power,x),`shot ${x}/${power}`);
 for(const direction of[-1,1])for(const height of[.3,1.2,2.3])scan(keeper,t=>goalkeeperPose({speed:85,reach:85},direction,t,height),`dive ${direction}/${height}`);
});

test('continuous limb surfaces retain material seams and deform around the same joints',()=>{
 const player=new Player(new THREE.Scene(),'#b9efd7',true);
 assert.equal(player.limbs.length,4);
 for(const object of player.limbs){assert.ok(object.geometry.groups.length<=3);assert.equal(object.geometry.attributes.position.count,561);}
 let previous;
 for(let n=0;n<200;n++){
  player.pose(keeperWarmupPose(n/100));
  const points=player.limbs.map(o=>Array.from(o.geometry.attributes.position.array));
  if(previous)for(let k=0;k<points.length;k++)for(let i=0;i<points[k].length;i++)assert.ok(Math.abs(points[k][i]-previous[k][i])<.025);
  previous=points;
 }
});

test('flexed elbow and knee surfaces keep outward faces without inverted folds',()=>{
 const player=new Player(new THREE.Scene(),'#b9efd7',true);
 const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),ab=new THREE.Vector3(),ac=new THREE.Vector3(),normal=new THREE.Vector3(),radial=new THREE.Vector3();
 const centers=Array.from({length:33},()=>new THREE.Vector3());
 const samples=[t=>strikerPose(t,Math.min(t/.55,1),t>=.55?t-.55:-1)];
 for(const direction of[-1,1])for(const height of[.3,1.2,2.3])samples.push(t=>goalkeeperPose({speed:85,reach:85},direction,t,height));
 for(const sample of samples)for(let frame=0;frame<=105;frame++){
  player.pose(sample(frame/30));
  for(const limb of player.limbs){
   const position=limb.geometry.attributes.position,indices=limb.geometry.index.array;
   for(let row=0;row<=32;row++){centers[row].set(0,0,0);for(let side=0;side<16;side++)centers[row].add(a.fromBufferAttribute(position,row*17+side));centers[row].multiplyScalar(1/16);}
   for(let i=0;i<indices.length;i+=3){
    a.fromBufferAttribute(position,indices[i]);b.fromBufferAttribute(position,indices[i+1]);c.fromBufferAttribute(position,indices[i+2]);
    normal.crossVectors(ab.subVectors(b,a),ac.subVectors(c,a)).normalize();
    radial.copy(a).add(b).add(c).sub(centers[Math.floor(indices[i]/17)]).sub(centers[Math.floor(indices[i+1]/17)]).sub(centers[Math.floor(indices[i+2]/17)]).normalize();
    assert.ok(Number.isFinite(a.x+a.y+a.z));
    assert.ok(normal.dot(radial)>-.1,`inside-out limb triangle ${i/3} at ${frame/30}s`);
   }
  }
 }
});

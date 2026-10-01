import {Vector3,Quaternion,Matrix4,Box3,Triangle,MathUtils} from 'three';
import {holdingPose,limb,body as keeperBody} from './anatomy.js';
import {keeperContactData} from './keeper-contact-data.js';
import {keeperShoulderFraction} from './keeper-skin-pose.js';

const axis=new Vector3(0,1,0),basis=new Matrix4();
const binds=Object.fromEntries(Object.entries(keeperContactData.binds).map(([name,q])=>[name,new Quaternion().fromArray(q)]));
const wristRoll=['L','R'].map(side=>{const q=binds[`forearm${side}`].clone().invert().multiply(binds[`hand${side}`]);return new Quaternion(0,q.y,0,q.w).normalize();});
const gloveCorners=['L','R'].map(side=>keeperContactData.hulls[`hand${side}`].vertices.map(p=>new Vector3().fromArray(p)));

export function keeperBodyRotation(pose){
  const up=new Vector3().copy(pose.up).normalize(),back=new Vector3().crossVectors(pose.right,up).normalize(),right=new Vector3().crossVectors(up,back).normalize();
  return new Quaternion().setFromRotationMatrix(basis.makeBasis(right,up,back));
}
// Match the skin's chest-front shoulder frame and the wrist roll carried through
// its elbow. Pure pose input keeps replays, collision and random-access scrubbing
// deterministic; there is no history-dependent smoothing or hidden contact pad.
export function keeperArmRotation(pose,index,forearm=false){
  const body=keeperBodyRotation(pose),side=index?'R':'L',back=new Vector3(0,0,1).applyQuaternion(body);
  const upper=body.clone().multiply(binds[`upper_arm${side}`]);
  const rest=axis.clone().applyQuaternion(upper),direction=new Vector3().subVectors(pose.elbows[index],pose.shoulders[index]).normalize();
  upper.premultiply(new Quaternion().setFromUnitVectors(rest,back));
  upper.premultiply(new Quaternion().setFromUnitVectors(back,direction));
  if(!forearm)return upper.normalize();
  const end=new Vector3().subVectors(pose.hands[index],pose.elbows[index]).normalize();
  const local=end.applyQuaternion(upper.clone().invert());
  return upper.multiply(new Quaternion().setFromUnitVectors(axis,local)).normalize();
}
export function keeperShoulderSupportRotation(pose,index){
  const side=index?'R':'L',body=keeperBodyRotation(pose);
  const clavicle=segmentRotation(body,`clavicle${side}`,pose.shoulder,pose.shoulders[index]);
  const rest=binds[`clavicle${side}`].clone().invert().multiply(binds[`upper_arm${side}`]);
  const arm=keeperArmRotation(pose,index),up=new Vector3(0,1,0).applyQuaternion(body.clone().multiply(binds.chest)),elevation=new Vector3(0,1,0).applyQuaternion(arm).dot(up);
  return clavicle.multiply(rest).slerp(arm,keeperShoulderFraction(elevation)).normalize();
}
export function keeperHandRotation(pose,index){
  if(pose.grip?.handRotations)return new Quaternion().fromArray(pose.grip.handRotations[index]);
  const original=keeperArmRotation(pose,index,true).multiply(wristRoll[index]).normalize();
  const forearm=axis.clone().applyQuaternion(original);
  const separation=new Vector3().subVectors(pose.hands[1],pose.hands[0]),distance=separation.length();
  // Close central catches need open, parallel fingers, rather than continuing
  // two inward-pointing forearms through one another. Do not alter a low scoop
  // or the authored roll of a stretched side dive.
  const middle=new Vector3().addVectors(pose.hands[0],pose.hands[1]).multiplyScalar(.5).sub(pose.shoulder);
  const central=1-MathUtils.smoothstep(Math.abs(middle.dot(pose.right)),.02,.95);
  const raised=MathUtils.smoothstep(middle.dot(pose.up),-.60,-.10);
  const open=central*(1-MathUtils.smoothstep(distance,.27,.80));
  if(open>0){const target=keeperBodyRotation(pose).multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI/2*(1-raised)));original.slerp(target,open);}
  // Carry the palm-facing chest frame to the finger direction with a minimal
  // swing. This removes arbitrary bind pronation in side saves without the
  // projected-front singularity when the fingers themselves point forward.
  const fingers=axis.clone().applyQuaternion(original),body=keeperBodyRotation(pose),up=axis.clone().applyQuaternion(body);
  const facing=MathUtils.smoothstep(pose.hands[index].y,.26,.55)*MathUtils.smoothstep(fingers.dot(up),-.95,-.55);
  if(facing>0){const target=body.premultiply(new Quaternion().setFromUnitVectors(up,fingers));original.slerp(target,facing);}
  if(pose.grip?.weight){
    const normal=new Vector3().copy(pose.right).multiplyScalar(index?-1:1).addScaledVector(pose.up,.3).normalize(),fingers=new Vector3().copy(pose.up).addScaledVector(normal,-dot(pose.up,normal)).normalize(),across=new Vector3().crossVectors(fingers,normal).normalize();
    original.slerp(new Quaternion().setFromRotationMatrix(basis.makeBasis(across,fingers,normal)),pose.grip.weight);
  }
  forearm.copy(axis).applyQuaternion(original);
  const wrist=pose.hands[index],corners=gloveCorners[index];
  if(wrist.y>.34)return original;
  const minimum=q=>{const yx=2*(q.x*q.y+q.z*q.w),yy=1-2*(q.x*q.x+q.z*q.z),yz=2*(q.y*q.z-q.x*q.w);let min=Infinity;for(const p of corners)min=Math.min(min,p.x*yx+p.y*yy+p.z*yz+wrist.y);return min;};
  if(forearm.y>=-.03||minimum(original)>=.018)return original;
  // No hard horizontal-length switch: that switch visibly snapped a low palm
  // during release. The anatomical frame supplies the limit only at vertical.
  const flat=new Vector3(forearm.x,0,forearm.z);
  if(flat.lengthSq()<1e-12){flat.set(0,0,1).applyQuaternion(original);flat.y=0;}
  flat.normalize();
  const target=original.clone().premultiply(new Quaternion().setFromUnitVectors(forearm,flat));
  let low=0,high=1;for(let i=0;i<14;i++){const mid=(low+high)/2;if(minimum(original.clone().slerp(target,mid))<.018)low=mid;else high=mid;}
  return original.slerp(target,high);
}

export function keeperPalmCenter(pose,index){return new Vector3(index?-.018:.018,.095,.012).applyQuaternion(keeperHandRotation(pose,index)).add(pose.hands[index]);}

function buildSurface(data){
  const vertices=data.vertices.map(p=>new Vector3().fromArray(p)),faces=[],edges=[],edgeKeys=new Set();
  for(let i=0;i<data.indices.length;i+=3){const ids=data.indices.slice(i,i+3),[a,b,c]=ids.map(i=>vertices[i]),normal=new Vector3().subVectors(b,a).cross(new Vector3().subVectors(c,a));if(normal.lengthSq()<1e-18)continue;faces.push({triangle:new Triangle(a,b,c),normal:normal.normalize()});
    for(const [a,b] of [[ids[0],ids[1]],[ids[1],ids[2]],[ids[2],ids[0]]]){const key=[Math.min(a,b),Math.max(a,b)].join(',');if(!edgeKeys.has(key)){edgeKeys.add(key);const start=vertices[a],axis=new Vector3().subVectors(vertices[b],start);edges.push({start,end:vertices[b],axis,inverseLength:1/axis.lengthSq()});}}
  }
  return {vertices,faces,edges,box:new Box3().setFromPoints(vertices),exact:data.surface?buildSurface(data.surface):null};
}
const hulls=Object.fromEntries(Object.entries(keeperContactData.hulls).map(([name,data])=>[name,buildSurface(data)]));
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const pointAt=(p,v,t)=>p.clone().addScaledVector(v,t);
function firstQuadratic(a,b,c){
  if(c<=0)return 0;if(a<1e-14)return Infinity;
  const d=b*b-a*c;if(d<0)return Infinity;
  const t=(-b-Math.sqrt(d))/a;return t>=0&&t<=1?t:Infinity;
}
function hullDistance(point,hull){
  const closest=new Vector3(),offset=new Vector3();let distance=Infinity,inside=true;
  for(const {triangle,normal} of hull.faces){inside&&=dot(offset.subVectors(point,triangle.a),normal)<=0;triangle.closestPointToPoint(point,closest);const d=closest.distanceToSquared(point);if(Number.isFinite(d))distance=Math.min(distance,d);}
  return inside?0:Math.sqrt(distance);
}
function sweepHull(p0,p1,radius,hull){
  const delta=new Vector3().subVectors(p1,p0);
  if(Math.max(p0.x,p1.x)<hull.box.min.x-radius||Math.min(p0.x,p1.x)>hull.box.max.x+radius||Math.max(p0.y,p1.y)<hull.box.min.y-radius||Math.min(p0.y,p1.y)>hull.box.max.y+radius||Math.max(p0.z,p1.z)<hull.box.min.z-radius||Math.min(p0.z,p1.z)>hull.box.max.z+radius)return null;
  let time=Infinity,closest=null,closestNormal=null,inside=true,initialDistance=Infinity;
  const scratch=new Vector3(),point=new Vector3();
  // Face interiors cover the flat surface; edge capsules supply the spherical
  // Minkowski rounding. Inflating plane bounds alone causes ghost corner saves.
  for(const {triangle,normal} of hull.faces){
    const d=dot(scratch.subVectors(p0,triangle.a),normal);inside&&=d<=0;
    triangle.closestPointToPoint(p0,point);const distance=point.distanceToSquared(p0);
    if(distance<initialDistance){initialDistance=distance;closest=point.clone();closestNormal=normal;}
    const speed=dot(delta,normal);if(speed>=-1e-12)continue;
    const t=(radius-d)/speed;if(t<0||t>1||t>=time)continue;
    point.copy(p0).addScaledVector(delta,t).addScaledVector(normal,-radius);
    if(triangle.containsPoint(point)){time=t;}
  }
  if((inside&&!hull.open)||initialDistance<radius*radius){
    // A moving hand can enter the ball between fixed physics samples. Resolve
    // that initial overlap to the current visible surface before catch/reflect,
    // rather than freezing a caught ball several centimetres inside the glove.
    const normal=new Vector3().subVectors(p0,closest).normalize();
    if((inside&&!hull.open)||normal.dot(closestNormal)<0)normal.negate();
    if(normal.lengthSq()<1e-12)normal.copy(delta).normalize().negate();
    return {time:0,p:closest.clone().addScaledVector(normal,radius),q:closest,distance:Math.sqrt(initialDistance)};
  }
  const m=new Vector3(),perpendicular=new Vector3(),velocity=new Vector3();
  for(const {start,axis:ab,inverseLength} of hull.edges){
    m.subVectors(p0,start);
    const md=dot(m,ab)*inverseLength,vd=dot(delta,ab)*inverseLength;
    perpendicular.copy(m).addScaledVector(ab,-md);velocity.copy(delta).addScaledVector(ab,-vd);
    const t=firstQuadratic(velocity.lengthSq(),dot(perpendicular,velocity),perpendicular.lengthSq()-radius*radius);
    if(t<time&&md+vd*t>=0&&md+vd*t<=1)time=t;
  }
  for(const vertex of hull.vertices){m.subVectors(p0,vertex);time=Math.min(time,firstQuadratic(delta.lengthSq(),dot(m,delta),m.lengthSq()-radius*radius));}
  if(!Number.isFinite(time))return null;
  const p=pointAt(p0,delta,time);let distance=Infinity,q;
  for(const {triangle} of hull.faces){triangle.closestPointToPoint(p,point);const d=point.distanceToSquared(p);if(d<distance){distance=d;q=point.clone();}}
  return {time,p,q,distance:Math.sqrt(distance)};
}
function segmentRotation(body,name,start,end){
  const rotation=body.clone().multiply(binds[name]);
  const rest=axis.clone().applyQuaternion(rotation),direction=new Vector3().subVectors(end,start).normalize();
  return rotation.premultiply(new Quaternion().setFromUnitVectors(rest,direction)).normalize();
}
// The shoulder and elbow blends are not rigid convex shapes. Keep their
// original weighted triangles and evaluate those same GPU skin transforms only
// when the ball overlaps the upper-body broad phase.
const patchData=keeperContactData.patch;
const patchSurface=patchData?buildSurface(patchData):null;
if(patchSurface)patchSurface.open=true;
const patchNames=patchData?Object.keys(patchData.inverseBinds):[];
const patchInfluences=patchData?.vertices.map((position,index)=>patchData.weights[index].map(([name,weight])=>({bone:patchNames.indexOf(name),weight,point:new Vector3().fromArray(position).applyMatrix4(new Matrix4().fromArray(patchData.inverseBinds[name]))})))??[];
const patchPoint=new Vector3(),patchBounds=new Box3();let patchPose=null;
function deformContactPatch(pose,body){
  if(patchPose===pose)return patchSurface;patchPose=pose;
  const frames={root:{position:new Vector3(),rotation:new Quaternion()}};
  for(const [name,distance]of[['pelvis',0],['spine',.19],['chest',.43],['neck',.51],['head',.63]])frames[name]={position:new Vector3().copy(pose.hip).addScaledVector(pose.up,distance),rotation:body.clone().multiply(binds[name])};
  for(const [i,side]of ['L','R'].entries()){
    frames[`clavicle${side}`]={position:pose.shoulder,rotation:segmentRotation(body,`clavicle${side}`,pose.shoulder,pose.shoulders[i])};
    frames[`upper_arm${side}`]={position:pose.shoulders[i],rotation:keeperArmRotation(pose,i)};
    frames[`shoulder_support${side}`]={position:pose.shoulders[i],rotation:keeperShoulderSupportRotation(pose,i)};
    frames[`forearm${side}`]={position:pose.elbows[i],rotation:keeperArmRotation(pose,i,true)};
    frames[`hand${side}`]={position:pose.hands[i],rotation:keeperHandRotation(pose,i)};
    const toe={x:pose.feet[i].x,y:pose.feet[i].y-.005,z:pose.feet[i].z+.16};
    for(const [name,start,end] of [['thigh',pose.hips[i],pose.knees[i]],['shin',pose.knees[i],pose.feet[i]],['foot',pose.feet[i],toe],['toe',toe,{x:toe.x,y:toe.y-.005,z:toe.z+.09}]])frames[name+side]={position:start,rotation:segmentRotation(body,name+side,start,end)};
  }
  const palette=patchNames.map(name=>frames[name]);patchSurface.box.makeEmpty();
  patchSurface.vertices.forEach((point,index)=>{point.set(0,0,0);for(const influence of patchInfluences[index]){const frame=palette[influence.bone];patchPoint.copy(influence.point).applyQuaternion(frame.rotation).add(frame.position);point.addScaledVector(patchPoint,influence.weight);}patchSurface.box.expandByPoint(point);});
  for(const face of patchSurface.faces)face.triangle.getNormal(face.normal);
  for(const edge of patchSurface.edges){edge.axis.subVectors(edge.end,edge.start);edge.inverseLength=edge.axis.lengthSq()>1e-18?1/edge.axis.lengthSq():0;}
  return patchSurface;
}
function possiblePatchContact(pose,start,end,radius){
  patchBounds.makeEmpty();for(const point of [pose.hip,pose.shoulder,...pose.shoulders,...pose.elbows,...pose.hands])patchBounds.expandByPoint(point);patchBounds.expandByScalar(radius+.22);
  return !(Math.max(start.x,end.x)<patchBounds.min.x||Math.min(start.x,end.x)>patchBounds.max.x||Math.max(start.y,end.y)<patchBounds.min.y||Math.min(start.y,end.y)>patchBounds.max.y||Math.max(start.z,end.z)<patchBounds.min.z||Math.min(start.z,end.z)>patchBounds.max.z);
}

export function keeperSurfaceContacts(pose,start,end,radius){
  const body=keeperBodyRotation(pose),parts=[{name:'torso',position:pose.hip,rotation:body,type:'body'},{name:'head',position:new Vector3().copy(pose.hip).addScaledVector(pose.up,.63),rotation:body,type:'body'}],contacts=[];
  for(const [i,side] of ['L','R'].entries()){
    parts.push({name:`hand${side}`,position:pose.hands[i],rotation:keeperHandRotation(pose,i),type:'hand'});
    parts.push({name:`upper_arm${side}`,position:pose.shoulders[i],rotation:keeperArmRotation(pose,i),type:'body'});

    parts.push({name:`forearm${side}`,position:pose.elbows[i],rotation:keeperArmRotation(pose,i,true),type:'body'});
    for(const [name,a,b] of [['thigh',pose.hips[i],pose.knees[i]],['shin',pose.knees[i],pose.feet[i]],['foot',pose.feet[i],{x:pose.feet[i].x,y:pose.feet[i].y-.005,z:pose.feet[i].z+.16}]])parts.push({name:name+side,position:a,rotation:segmentRotation(body,name+side,a,b),type:'body'});
  }
  for(const part of parts){
    const position=new Vector3().copy(part.position),inverse=part.rotation.clone().invert(),a=new Vector3().copy(start).sub(position).applyQuaternion(inverse),b=new Vector3().copy(end).sub(position).applyQuaternion(inverse);
    const hull=hulls[part.name];let hit=sweepHull(a,b,radius,hull);if(!hit)continue;
    // Convex broad-phase bounds cannot fill the empty notch beside a thumb.
    // Only possible glove hits pay for the original skin's exact triangles.
    if(hull.exact){hit=sweepHull(a,b,radius,hull.exact);if(!hit)continue;}
    // Keep handling quality's original meaning: depth of the closest approach
    // during this physics interval, now measured against the actual glove.
    // Surface entry alone is always R away and would make every catch a graze.
    let minimum=radius;
    if(part.type==='hand')for(let sample=0;sample<=4;sample++)minimum=Math.min(minimum,hullDistance(a.clone().lerp(b,hit.time+(1-hit.time)*sample/4),hull.exact??hull));
    hit.p.applyQuaternion(part.rotation).add(position);hit.q.applyQuaternion(part.rotation).add(position);
    contacts.push({hit,r:0,type:part.type,part:part.name,quality:1-minimum/radius});
  }
  if(patchSurface&&possiblePatchContact(pose,start,end,radius)){
    const hit=sweepHull(new Vector3().copy(start),new Vector3().copy(end),radius,deformContactPatch(pose,body));
    if(hit)contacts.push({hit,r:0,type:'body',part:'skin',quality:0});
  }
  return contacts;
}

function closestOnSurface(point,surface){
  const q=new Vector3(),closest=new Vector3();let best=Infinity,normal;
  for(const face of surface.faces){face.triangle.closestPointToPoint(point,q);const distance=q.distanceToSquared(point);if(distance<best){best=distance;closest.copy(q);normal=face.normal;}}
  const direction=new Vector3().subVectors(point,closest),distance=Math.sqrt(best);
  if(direction.lengthSq()<1e-16)direction.copy(normal);else direction.multiplyScalar(1/distance);
  // An inward local normal means the queried centre is inside that skin patch.
  const signed=direction.dot(normal)<0?-distance:distance;
  if(signed<0)direction.negate();
  return {point:closest,normal:direction,distance:signed};
}

// A catch is attached to the actual contacted palm, including its rotation.
// sourcePose/capturePoint stay at the capture frame; heldPose is the current
// holdingPose(...).pose. `blend` is holdingPose(...).weight (already eased). Older saves may
// omit contactPart: the nearest real glove determines the attachment then.
export function keeperHeldBall(sourcePose,heldPose,capturePoint,contactPart,blend=heldPose.grip?.weight??0){
  const radius=.11,source=vectorCopy(capturePoint),parts=['L','R'].map((side,index)=>({index,name:`hand${side}`,position:vectorCopy(heldPose.hands[index]),rotation:keeperHandRotation(heldPose,index),surface:hulls[`hand${side}`].exact}));
  let index=contactPart==='handR'?1:contactPart==='handL'?0:-1;
  if(index<0){let best=Infinity;for(const i of [0,1]){const local=source.clone().sub(sourcePose.hands[i]).applyQuaternion(keeperHandRotation(sourcePose,i).invert()),distance=closestOnSurface(local,parts[i].surface).distance;if(distance<best){best=distance;index=i;}}}
  const sourceRotation=keeperHandRotation(sourcePose,index),offset=source.clone().sub(sourcePose.hands[index]).applyQuaternion(sourceRotation.invert());
  const active=parts[index];
  if(heldPose.grip?.center){
    const target=vectorCopy(heldPose.grip.center).sub(active.position).applyQuaternion(active.rotation.clone().invert()),weight=MathUtils.smoothstep(blend,.35,1),length=offset.length(),targetLength=target.length();
    const direction=offset.clone().normalize(),goal=target.clone().normalize(),turn=new Quaternion().setFromUnitVectors(direction,goal);
    offset.copy(direction).applyQuaternion(new Quaternion().slerp(turn,weight)).multiplyScalar(MathUtils.lerp(length,targetLength,weight));
  }
  const ball=offset.applyQuaternion(active.rotation).add(active.position);
  for(const part of parts)part.inverse=part.rotation.clone().invert();
  const sample=part=>{
    const local=ball.clone().sub(part.position).applyQuaternion(part.inverse),hit=closestOnSurface(local,part.surface);
    return {point:hit.point.applyQuaternion(part.rotation).add(part.position),normal:hit.normal.applyQuaternion(part.rotation),distance:hit.distance};
  };
  // Alternating surface constraints leave the primary palm tangent and keep
  // the second glove out of the ball. No extra collision radius is introduced.
  for(let iteration=0;iteration<8;iteration++){
    const attached=sample(active);ball.copy(attached.point).addScaledVector(attached.normal,radius);
    const other=sample(parts[1-index]);if(other.distance>=radius-.0002)break;
    ball.copy(other.point).addScaledVector(other.normal,radius);
  }
  ball.y=Math.max(radius,ball.y);
  return {x:ball.x,y:ball.y,z:ball.z};
}
function vectorCopy(point){return new Vector3().copy(point);}

function captureHand(sourcePose,capturePoint,contactPart){
  if(contactPart==='handL')return 0;if(contactPart==='handR')return 1;
  let index=0,best=Infinity;
  for(let i=0;i<2;i++){const local=vectorCopy(capturePoint).sub(sourcePose.hands[i]).applyQuaternion(keeperHandRotation(sourcePose,i).invert()),distance=Math.abs(closestOnSurface(local,hulls[`hand${i?'R':'L'}`].exact).distance-.11);if(distance<best){best=distance;index=i;}}
  return index;
}
// The radius-offset glove is star shaped from its wrist: the ball radius is
// larger than the palm thickness. A fixed ray on its front hemisphere gives a
// continuous skin attachment, including fingertips, without a nearest-face
// side switch. All distances use the original glove triangles.
function gloveRayOffset(direction,index){
  const surface=hulls[`hand${index?'R':'L'}`].exact,radius=.11,point=new Vector3();let distance=0;
  // Exact ray exit from the radius-offset triangles: flat faces, rounded
  // edges and rounded vertices. This replaces 24 full-mesh distance searches
  // per wrist and retains the same smooth outer attachment envelope.
  for(const {triangle,normal} of surface.faces){
    const speed=direction.dot(normal);if(Math.abs(speed)<1e-10)continue;
    const plane=triangle.a.dot(normal);
    for(const sign of [-1,1]){
      const t=(plane+sign*radius)/speed;if(t<=distance)continue;
      point.copy(direction).multiplyScalar(t).addScaledVector(normal,-sign*radius);
      if(triangle.containsPoint(point))distance=t;
    }
  }
  for(const {start,axis:edge,inverseLength} of surface.edges){
    const md=-start.dot(edge)*inverseLength,vd=direction.dot(edge)*inverseLength;
    const mx=-start.x-edge.x*md,my=-start.y-edge.y*md,mz=-start.z-edge.z*md;
    const vx=direction.x-edge.x*vd,vy=direction.y-edge.y*vd,vz=direction.z-edge.z*vd;
    const a=vx*vx+vy*vy+vz*vz,b=mx*vx+my*vy+mz*vz,c=mx*mx+my*my+mz*mz-radius*radius,disc=b*b-a*c;
    if(a<1e-12||disc<0)continue;
    const t=(-b+Math.sqrt(disc))/a,along=md+vd*t;
    if(t>distance&&along>=0&&along<=1)distance=t;
  }
  for(const vertex of surface.vertices){
    const along=direction.dot(vertex),disc=along*along+radius*radius-vertex.lengthSq();
    if(disc>=0)distance=Math.max(distance,along+Math.sqrt(disc));
  }
  return direction.clone().multiplyScalar(distance);
}
// A secured ball rests on the palm above the wrist cuff. A wrist-centred ray
// can be tangent to the rigid glove but penetrate its blended cuff seam.
const heldPalmOffsets=[0,1].map(index=>gloveRayOffset(new Vector3(0,.55,1).normalize(),index));
function unitArc(from,to,weight){
  const direction=from.clone().normalize(),turn=new Quaternion().setFromUnitVectors(direction,to.clone().normalize());
  return direction.applyQuaternion(new Quaternion().slerp(turn,weight));
}

// Capture-aware gathering moves both physical wrists around the ball. Changing
// the ball alone cannot resolve a trailing glove moving through the caught
// sphere. This pure function is identical during play, replay and random-access
// scrubbing; it never depends on the previous rendered frame.
export function keeperGather(sourcePose,currentPose,capturePoint,contactPart,blend=1){
  const held=holdingPose(currentPose,blend),weight=held.weight,pose=held.pose,index=captureHand(sourcePose,capturePoint,contactPart),other=1-index;
  if(blend<=0)return {...held,pose:currentPose,ball:{...capturePoint}};
  const sourceQ=[0,1].map(i=>keeperHandRotation(sourcePose,i)),rawQ=[0,1].map(i=>keeperHandRotation(currentPose,i));
  const rotations=[0,1].map(i=>rawQ[i].clone().slerp(keeperHandRotation(holdingPose(currentPose).pose,i),weight));
  const sourceOffset=vectorCopy(capturePoint).sub(sourcePose.hands[index]).applyQuaternion(sourceQ[index].clone().invert());
  const rawBall=sourceOffset.clone().applyQuaternion(rawQ[index]).add(currentPose.hands[index]);
  const ball=rawBall.clone().lerp(vectorCopy(held.center),weight);
  ball.y=Math.max(.11,ball.y);
  const finalOffsets=heldPalmOffsets;
  const activeDirection=unitArc(sourceOffset,finalOffsets[index],weight),activeOffset=gloveRayOffset(activeDirection,index);
  const wrist=ball.clone().sub(activeOffset.clone().applyQuaternion(rotations[index]));
  const activeArm=limb(pose.shoulders[index],wrist,held.pose.elbows[index],keeperBody.upperArm,keeperBody.forearm);
  pose.hands[index]=activeArm.end;pose.elbows[index]=activeArm.joint;
  // A reach limit moves the whole grasp, never a glove through a fixed ball.
  ball.add(vectorCopy(activeArm.end).sub(wrist));
  const rawOtherOffset=rawBall.clone().sub(currentPose.hands[other]).applyQuaternion(rawQ[other].clone().invert());
  const otherDirection=unitArc(rawOtherOffset,finalOffsets[other],weight),minimum=gloveRayOffset(otherDirection,other),length=MathUtils.lerp(rawOtherOffset.length(),minimum.length(),weight);
  const otherOffset=otherDirection.multiplyScalar(Math.max(minimum.length(),length));
  const otherWrist=ball.clone().sub(otherOffset.applyQuaternion(rotations[other]));
  const otherArm=limb(pose.shoulders[other],otherWrist,held.pose.elbows[other],keeperBody.upperArm,keeperBody.forearm);
  pose.hands[other]=otherArm.end;pose.elbows[other]=otherArm.joint;
  pose.grip={...pose.grip,handRotations:rotations.map(q=>q.toArray())};
  return {...held,pose,ball:{x:ball.x,y:ball.y,z:ball.z}};
}

import {Vector3,Quaternion,Matrix4,Box3,Triangle,MathUtils} from 'three';
import {holdingPose,limb,body as keeperBody} from './anatomy.js';
import {keeperContactData} from './keeper-contact-data.js';
import {keeperShoulderFraction} from './keeper-skin-pose.js';
import {keeperTorsoFrames,hasKeeperTorsoArticulation} from './keeper-torso.js';

const axis=new Vector3(0,1,0),basis=new Matrix4();
const binds=Object.fromEntries(Object.entries(keeperContactData.binds).map(([name,q])=>[name,new Quaternion().fromArray(q)]));
const wristRoll=['L','R'].map(side=>{const q=binds[`forearm${side}`].clone().invert().multiply(binds[`hand${side}`]);return new Quaternion(0,q.y,0,q.w).normalize();});
const gloveCorners=['L','R'].map(side=>keeperContactData.hulls[`hand${side}`].vertices.map(p=>new Vector3().fromArray(p)));

export function keeperBodyRotation(pose,part='pelvis',torso=null){
  if(part!=='pelvis'&&hasKeeperTorsoArticulation(pose)){const frame=(torso??keeperTorsoFrames(pose))[part];return new Quaternion().setFromRotationMatrix(basis.makeBasis(new Vector3().copy(frame.right),new Vector3().copy(frame.up),new Vector3().copy(frame.back)));}
  const up=new Vector3().copy(pose.up).normalize(),back=new Vector3().crossVectors(pose.right,up).normalize(),right=new Vector3().crossVectors(up,back).normalize();
  return new Quaternion().setFromRotationMatrix(basis.makeBasis(right,up,back));
}
// Match the skin's chest-front shoulder frame and the wrist roll carried through
// its elbow. Pure pose input keeps replays, collision and random-access scrubbing
// deterministic; there is no history-dependent smoothing or hidden contact pad.
export function keeperArmRotation(pose,index,forearm=false,torso=null){
  const body=keeperBodyRotation(pose,'chest',torso),side=index?'R':'L',back=new Vector3(0,0,1).applyQuaternion(body);
  const upper=body.clone().multiply(binds[`upper_arm${side}`]);
  const rest=axis.clone().applyQuaternion(upper),direction=new Vector3().subVectors(pose.elbows[index],pose.shoulders[index]).normalize();
  upper.premultiply(new Quaternion().setFromUnitVectors(rest,back));
  upper.premultiply(new Quaternion().setFromUnitVectors(back,direction));
  if(!forearm)return upper.normalize();
  const end=new Vector3().subVectors(pose.hands[index],pose.elbows[index]).normalize();
  const local=end.applyQuaternion(upper.clone().invert());
  return upper.multiply(new Quaternion().setFromUnitVectors(axis,local)).normalize();
}
export function keeperShoulderSupportRotation(pose,index,torso=null){
  const side=index?'R':'L',body=keeperBodyRotation(pose,'chest',torso);
  const clavicle=segmentRotation(body,`clavicle${side}`,pose.shoulder,pose.shoulders[index]);
  const rest=binds[`clavicle${side}`].clone().invert().multiply(binds[`upper_arm${side}`]);
  const arm=keeperArmRotation(pose,index,false,torso),up=new Vector3(0,1,0).applyQuaternion(body.clone().multiply(binds.chest)),elevation=new Vector3(0,1,0).applyQuaternion(arm).dot(up);
  return clavicle.multiply(rest).slerp(arm,keeperShoulderFraction(elevation)).normalize();
}
export function keeperHandRotation(pose,index,torso=null){
  if(pose.grip?.handRotations)return new Quaternion().fromArray(pose.grip.handRotations[index]);
  torso??=hasKeeperTorsoArticulation(pose)?keeperTorsoFrames(pose):null;
  const original=keeperArmRotation(pose,index,true,torso).multiply(wristRoll[index]).normalize();
  const forearm=axis.clone().applyQuaternion(original);
  const separation=new Vector3().subVectors(pose.hands[1],pose.hands[0]),distance=separation.length();
  // Close central catches need open, parallel fingers, rather than continuing
  // two inward-pointing forearms through one another. Do not alter a low scoop
  // or the authored roll of a stretched side dive.
  const middle=new Vector3().addVectors(pose.hands[0],pose.hands[1]).multiplyScalar(.5).sub(pose.shoulder);
  const central=1-MathUtils.smoothstep(Math.abs(middle.dot(pose.right)),.02,.95);
  const raised=MathUtils.smoothstep(middle.dot(pose.up),-.60,-.10);
  const open=central*(1-MathUtils.smoothstep(distance,.27,.80));
  if(open>0){const target=keeperBodyRotation(pose,'chest',torso).multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI/2*(1-raised)));original.slerp(target,open);}
  // Carry the palm-facing chest frame to the finger direction with a minimal
  // swing. This removes arbitrary bind pronation in side saves without the
  // projected-front singularity when the fingers themselves point forward.
  const fingers=axis.clone().applyQuaternion(original),body=keeperBodyRotation(pose,'chest',torso),up=axis.clone().applyQuaternion(body);
  const facing=MathUtils.smoothstep(pose.hands[index].y,.26,.55)*MathUtils.smoothstep(fingers.dot(up),-.95,-.55);
  if(facing>0){const target=body.premultiply(new Quaternion().setFromUnitVectors(up,fingers));original.slerp(target,facing);}
  if(pose.grip?.weight){
    const normal=new Vector3().copy(pose.right).multiplyScalar(index?-1:1).addScaledVector(pose.up,.3).normalize(),fingers=new Vector3().copy(pose.up).addScaledVector(normal,-dot(pose.up,normal)).normalize(),across=new Vector3().crossVectors(fingers,normal).normalize();
    original.slerp(new Quaternion().setFromRotationMatrix(basis.makeBasis(across,fingers,normal)),pose.grip.weight);
  }
  const wrist=pose.hands[index],corners=gloveCorners[index];
  const brace=pose.grip?.weight?0:MathUtils.clamp(pose.torso?.[index?'braceR':'braceL']??0,0,1)*(1-MathUtils.smoothstep(wrist.y,.12,.22)*MathUtils.smoothstep(pose.up.y,.25,.60));
  if(wrist.y>.34&&!brace)return original;
  const minimum=q=>{const yx=2*(q.x*q.y+q.z*q.w),yy=1-2*(q.x*q.x+q.z*q.z),yz=2*(q.y*q.z-q.x*q.w);let min=Infinity;for(const p of corners)min=Math.min(min,p.x*yx+p.y*yy+p.z*yz+wrist.y);return min;};
  const floor=MathUtils.lerp(.018,.005,brace);let braceTarget=null;
  if(brace){
    // Fit the real glove, including its protruding thumb. A modest side-specific
    // roll keeps the palm near horizontal while pitch may tilt either way.
    const forward=new Vector3(pose.forward.x,0,pose.forward.z).normalize(),down=new Vector3(0,-1,0),across=new Vector3().crossVectors(forward,down).normalize();
    const flat=new Quaternion().setFromRotationMatrix(basis.makeBasis(across,forward,down)).multiply(new Quaternion().setFromAxisAngle(axis,index?-.20:.20));
    const pitchAxis=new Vector3(1,0,0),pitched=angle=>flat.clone().multiply(new Quaternion().setFromAxisAngle(pitchAxis,angle));
    let low=-Math.PI/2,high=Math.PI/2;
    if(minimum(pitched(high))>=floor)low=high;
    else for(let i=0;i<16;i++){const mid=(low+high)/2;if(minimum(pitched(mid))<floor)high=mid;else low=mid;}
    braceTarget=pitched(low);
    // Separate the palm-facing turn from the wrist pitch. Directly slerping
    // to steep downward fingers crosses a 180-degree arc as the arm releases.
    original.slerp(flat,brace).multiply(new Quaternion().setFromAxisAngle(pitchAxis,low*brace));
  }
  forearm.copy(axis).applyQuaternion(original);
  if((!brace&&forearm.y>=-.03)||minimum(original)>=floor)return original;
  if(braceTarget){
    let low=0,high=1;for(let i=0;i<16;i++){const mid=(low+high)/2;if(minimum(original.clone().slerp(braceTarget,mid))<floor)low=mid;else high=mid;}
    return original.slerp(braceTarget,high);
  }
  // No hard horizontal-length switch: that switch visibly snapped a low palm
  // during release. The anatomical frame supplies the limit only at vertical.
  const flat=new Vector3(forearm.x,0,forearm.z);
  if(flat.lengthSq()<1e-12){flat.set(0,0,1).applyQuaternion(original);flat.y=0;}
  flat.normalize();
  const target=original.clone().premultiply(new Quaternion().setFromUnitVectors(forearm,flat));
  let low=0,high=1;for(let i=0;i<14;i++){const mid=(low+high)/2;if(minimum(original.clone().slerp(target,mid))<floor)low=mid;else high=mid;}
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
function contactFrames(pose,body,torso=keeperTorsoFrames(pose)){
  const chest=keeperBodyRotation(pose,'chest',torso);
  const frames={root:{position:new Vector3(),rotation:new Quaternion()}};
  for(const name of ['pelvis','spine','chest','neck','head'])frames[name]={position:torso[name].position,rotation:keeperBodyRotation(pose,name,torso).multiply(binds[name])};
  for(const [i,side]of ['L','R'].entries()){
    frames[`clavicle${side}`]={position:pose.shoulder,rotation:segmentRotation(chest,`clavicle${side}`,pose.shoulder,pose.shoulders[i])};
    frames[`upper_arm${side}`]={position:pose.shoulders[i],rotation:keeperArmRotation(pose,i,false,torso)};
    frames[`shoulder_support${side}`]={position:pose.shoulders[i],rotation:keeperShoulderSupportRotation(pose,i,torso)};
    frames[`forearm${side}`]={position:pose.elbows[i],rotation:keeperArmRotation(pose,i,true,torso)};
    frames[`hand${side}`]={position:pose.hands[i],rotation:keeperHandRotation(pose,i,torso)};
    const toe={x:pose.feet[i].x,y:pose.feet[i].y-.005,z:pose.feet[i].z+.16};
    for(const [name,start,end] of [['thigh',pose.hips[i],pose.knees[i]],['shin',pose.knees[i],pose.feet[i]],['foot',pose.feet[i],toe],['toe',toe,{x:toe.x,y:toe.y-.005,z:toe.z+.09}]])frames[name+side]={position:start,rotation:segmentRotation(body,name+side,start,end)};
  }
  return frames;
}
function deformSurface(surface,influences,frames){
  const palette=patchNames.map(name=>frames[name]);surface.box.makeEmpty();
  surface.vertices.forEach((point,index)=>{point.set(0,0,0);for(const influence of influences[index]){const frame=palette[influence.bone];patchPoint.copy(influence.point).applyQuaternion(frame.rotation).add(frame.position);point.addScaledVector(patchPoint,influence.weight);}surface.box.expandByPoint(point);});
  for(const face of surface.faces)face.triangle.getNormal(face.normal);
  for(const edge of surface.edges){edge.axis.subVectors(edge.end,edge.start);edge.inverseLength=edge.axis.lengthSq()>1e-18?1/edge.axis.lengthSq():0;}
  return surface;
}
function deformContactPatch(pose,body,frames=null){
  if(patchPose===pose)return patchSurface;patchPose=pose;
  return deformSurface(patchSurface,patchInfluences,frames??contactFrames(pose,body));
}
const torsoHullData=keeperContactData.hulls.torso;
const torsoHull=buildSurface(torsoHullData),torsoExact=keeperContactData.torsoPatch?buildSurface(keeperContactData.torsoPatch):null;
if(torsoExact)torsoExact.open=true;
const influencesFor=(vertices,weights,offset=0)=>vertices.map((point,index)=>weights[index].map(([name,weight])=>({bone:patchNames.indexOf(name),weight,point:new Vector3().fromArray(point).add(new Vector3(0,offset,0)).applyMatrix4(new Matrix4().fromArray(patchData.inverseBinds[name]))})));
const torsoHullInfluences=torsoHullData.weights?influencesFor(torsoHullData.vertices,torsoHullData.weights,.92):[];
const torsoExactInfluences=torsoExact?influencesFor(keeperContactData.torsoPatch.vertices,keeperContactData.torsoPatch.weights):[];
let torsoPose=null,torsoFrames=null,torsoExactPose=null;
function torsoContact(pose,start,end,radius,body,torso){
  // The shared chain bounds each angle. This segment box is deliberately
  // conservative; only nearby balls incur the small weighted hull transforms.
  patchBounds.makeEmpty().expandByPoint(pose.hip).expandByPoint(pose.shoulder).expandByScalar(radius+.24);
  if(Math.max(start.x,end.x)<patchBounds.min.x||Math.min(start.x,end.x)>patchBounds.max.x||Math.max(start.y,end.y)<patchBounds.min.y||Math.min(start.y,end.y)>patchBounds.max.y||Math.max(start.z,end.z)<patchBounds.min.z||Math.min(start.z,end.z)>patchBounds.max.z)return null;
  if(torsoPose!==pose){torsoPose=pose;torsoFrames=contactFrames(pose,body,torso);deformSurface(torsoHull,torsoHullInfluences,torsoFrames);}
  // Skin blends may bow a few millimetres outside a triangle of the small
  // deformed hull. This margin selects candidates only; the exact skin below
  // always tests the original ball radius, preserving millimetre near misses.
  const a=new Vector3().copy(start),b=new Vector3().copy(end),candidate=sweepHull(a,b,radius+.006,torsoHull);if(!candidate)return null;
  if(!torsoExact)return candidate;
  if(torsoExactPose!==pose){torsoExactPose=pose;deformSurface(torsoExact,torsoExactInfluences,torsoFrames);}
  return sweepHull(a,b,radius,torsoExact);
}
function possiblePatchContact(pose,start,end,radius){
  patchBounds.makeEmpty();for(const point of [pose.hip,pose.shoulder,...pose.shoulders,...pose.elbows,...pose.hands])patchBounds.expandByPoint(point);patchBounds.expandByScalar(radius+.22);
  return !(Math.max(start.x,end.x)<patchBounds.min.x||Math.min(start.x,end.x)>patchBounds.max.x||Math.max(start.y,end.y)<patchBounds.min.y||Math.min(start.y,end.y)>patchBounds.max.y||Math.max(start.z,end.z)<patchBounds.min.z||Math.min(start.z,end.z)>patchBounds.max.z);
}

export function keeperSurfaceContacts(pose,start,end,radius){
  const body=keeperBodyRotation(pose),articulated=hasKeeperTorsoArticulation(pose),torso=articulated?keeperTorsoFrames(pose):null,head=torso?.head;
  const parts=[{name:'head',position:head?.position??new Vector3().copy(pose.hip).addScaledVector(pose.up,.63),rotation:articulated?keeperBodyRotation(pose,'head',torso):body,type:'body'}],contacts=[];
  if(!articulated)parts.unshift({name:'torso',position:pose.hip,rotation:body,type:'body'});
  else {const hit=torsoContact(pose,start,end,radius,body,torso);if(hit)contacts.push({hit,r:0,type:'body',part:'torso',quality:0});}
  for(const [i,side] of ['L','R'].entries()){
    parts.push({name:`hand${side}`,position:pose.hands[i],rotation:keeperHandRotation(pose,i,torso),type:'hand'});
    parts.push({name:`upper_arm${side}`,position:pose.shoulders[i],rotation:keeperArmRotation(pose,i,false,torso),type:'body'});

    parts.push({name:`forearm${side}`,position:pose.elbows[i],rotation:keeperArmRotation(pose,i,true,torso),type:'body'});
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
    const hit=sweepHull(new Vector3().copy(start),new Vector3().copy(end),radius,deformContactPatch(pose,body,articulated&&torsoPose===pose?torsoFrames:null));
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

// Transport the held arm's bend with the changed shoulder-to-wrist axis.
// Reusing its old elbow as a spatial pole can cross the new IK axis and flip
// between two grounded branches while the captured ball itself stays smooth.
// Select the capture-side arc from immutable source input, then release it
// through the upward arc as the keeper stands, without an angular seam jump.
function graspArm(root,target,referenceHand,referenceElbow,sourcePose,currentPose,index,weight){
  const from=vectorCopy(referenceHand).sub(root).normalize(),to=vectorCopy(target).sub(root).normalize();
  const bend=vectorCopy(referenceElbow).sub(root);bend.addScaledVector(from,-bend.dot(from)).normalize();
  bend.applyQuaternion(new Quaternion().setFromUnitVectors(from,to));
  const result=limb(root,target,vectorCopy(root).add(bend),keeperBody.upperArm,keeperBody.forearm);
  const direction=vectorCopy(result.end).sub(root),length=direction.length();direction.multiplyScalar(1/length);
  const reach=(keeperBody.upperArm**2-keeperBody.forearm**2+length*length)/(2*length),radius=Math.sqrt(Math.max(0,keeperBody.upperArm**2-reach*reach));
  const center=vectorCopy(root).addScaledVector(direction,reach),upward=new Vector3(0,1,0).addScaledVector(direction,-direction.y),vertical=upward.length();
  if(vertical<1e-6)return result;upward.multiplyScalar(1/vertical);
  const side=new Vector3().crossVectors(direction,upward).normalize();
  const sourceAxis=vectorCopy(sourcePose.hands[index]).sub(sourcePose.shoulders[index]).normalize(),sourceUp=new Vector3(0,1,0).addScaledVector(sourceAxis,-sourceAxis.y).normalize();
  const sourceSide=new Vector3().crossVectors(sourceAxis,sourceUp),sourceBend=vectorCopy(sourcePose.elbows[index]).sub(sourcePose.shoulders[index]);
  const sign=Math.sign(sourceBend.dot(sourceSide))||1;
  const limit=Math.acos(MathUtils.clamp((.075-center.y)/(radius*vertical),-1,1));
  const rawMagnitude=Math.acos(MathUtils.clamp(bend.dot(upward),-1,1)),rounding=.08*weight;
  // acos is an absolute angle at the up/down poles. Round its two cusps so a
  // source-anchored bend can pass a pole with continuous velocity.
  const nearPole=Math.min(rawMagnitude,Math.PI-rawMagnitude),rounded=rounding?nearPole*MathUtils.smoothstep(nearPole,0,rounding):nearPole;
  const magnitude=rawMagnitude<Math.PI/2?rounded:Math.PI-rounded,release=MathUtils.smoothstep(currentPose.up.y,.25,.75)*weight;
  // Collapse the downward angular seam through the upper arc before releasing
  // the source-side anchor. atan2 alone would jump by 2π at that seam.
  const desired=Math.atan2(bend.dot(side),bend.dot(upward))*(1-MathUtils.smoothstep(-bend.dot(upward),.65,.98));
  // During capture, reserve up to .3 rad around the downward bend seam so the
  // elbow absorbs the turn instead of reaching that pole and reversing. The
  // rounded margin vanishes at the exact source frame and fully secured hold.
  const swingLimit=Math.PI-.3*4*weight*(1-weight),softness=.12*4*weight*(1-weight),gap=magnitude-swingLimit;
  const absorbed=Math.min(magnitude,swingLimit)-(softness&&Math.abs(gap)<softness?(softness-Math.abs(gap))**2/(4*softness):0);
  const signedAngle=MathUtils.lerp(sign*absorbed,desired,release),branch=Math.sign(signedAngle)||sign;
  let angle=Math.abs(signedAngle);
  const width=.06*weight;
  if(width&&Math.abs(angle-limit)<width)angle-=((angle-limit+width)**2)/(4*width);else angle=Math.min(angle,limit);
  angle=Math.max(0,angle);
  const joint=center.addScaledVector(upward,radius*Math.cos(angle)).addScaledVector(side,radius*Math.sin(angle)*branch);
  result.joint={x:joint.x,y:joint.y,z:joint.z};
  return result;
}

// Bend only the elbow around its two-bone IK circle when a held sphere comes
// close to the forearm. A smooth risk envelope and a nonzero Cartesian blend
// avoid threshold pops and the antipodal angle branch during capture. Once the
// grasp has settled, reflect a ball-facing circle component into the away
// hemisphere. A small bias alone cannot escape an almost antipodal bend during
// get-up. This geometric fold preserves the wrists, lengths and palm attachment.
function graspElbow(root,wrist,elbow,ball,weight,settled){
  const a=vectorCopy(elbow),b=vectorCopy(wrist),segment=b.clone().sub(a),relative=vectorCopy(ball).sub(a);
  const along=MathUtils.clamp(relative.dot(segment)/segment.lengthSq(),0,1);
  const distance=relative.addScaledVector(segment,-along).length();
  const risk=(1-MathUtils.smoothstep(distance,.145,.175))*weight;if(risk<=0)return elbow;
  const direction=b.clone().sub(root),length=direction.length();direction.multiplyScalar(1/length);
  const reach=(keeperBody.upperArm**2-keeperBody.forearm**2+length*length)/(2*length);
  const center=vectorCopy(root).addScaledVector(direction,reach),bend=a.sub(center).normalize();
  const away=center.clone().sub(ball);away.addScaledVector(direction,-away.dot(direction));
  if(away.lengthSq()<1e-12)return elbow;
  const awayLength=away.length();away.normalize();
  const toward=-bend.dot(away),fold=2*Math.max(0,toward)*MathUtils.smoothstep(toward,0,.1)*weight*settled;
  // Near the shoulder-wrist axis, elbow azimuth barely changes clearance.
  // Use a ball-radius-scaled gradient instead of amplifying that nearly zero
  // direction into a full-strength turn as the ball crosses the axis.
  const bias=.8*risk*awayLength/Math.hypot(awayLength,.11),width=.08*weight*settled,delta=Math.abs(fold-bias);
  // Smooth maximum keeps the original capture bias exactly until settlement,
  // without a derivative kink where the geometric constraint takes over.
  const correction=Math.max(fold,bias)+(width&&delta<width?(width-delta)**2/(4*width):0);
  const pole=center.clone().add(bend.addScaledVector(away,correction).normalize());
  return limb(root,wrist,pole,keeperBody.upperArm,keeperBody.forearm).joint;
}

// The trailing forearm starts settling before it reaches the shirt. Segment
// distance to the shared pelvis/chest axis supplies a bounded capsule envelope:
// fully active at 23 cm, inactive beyond 30 cm. Distant reaching arms keep their
// source motion, rather than being forced into a premature holding branch.
function graspTorsoProximity(pose,index,torso){
 const p=vectorCopy(pose.elbows[index]),q=vectorCopy(torso.pelvis.position),u=vectorCopy(pose.hands[index]).sub(p),v=vectorCopy(torso.chest.position).sub(q),w=p.clone().sub(q),a=u.lengthSq(),b=u.dot(v),c=v.lengthSq(),d=u.dot(w),e=v.dot(w),D=a*c-b*b;
 let sn,sd=D,tn,td=D;if(D<1e-12){sn=0;sd=1;tn=e;td=c;}else{sn=b*e-c*d;tn=a*e-b*d;if(sn<0){sn=0;tn=e;td=c;}else if(sn>sd){sn=sd;tn=e+b;td=c;}}
 if(tn<0){tn=0;if(-d<0)sn=0;else if(-d>a)sn=sd;else{sn=-d;sd=a;}}else if(tn>td){tn=td;if(-d+b<0)sn=0;else if(-d+b>a)sn=sd;else{sn=-d+b;sd=a;}}
 const distance=w.addScaledVector(u,Math.abs(sn)<1e-12?0:sn/sd).addScaledVector(v,Math.abs(tn)<1e-12?0:-tn/td).length();return 1-MathUtils.smoothstep(distance,.23,.30);
}
// Fixed shoulder/wrist endpoints leave one elbow circle. Intersect its allowed
// angular arcs against torso support, turf and ball clearance simultaneously;
// then choose the nearest circular arc with an inward-rounded boundary. This is
// a constant-size analytic solve, not iterative body/ball pushes or mesh scans.
function graspFeasibleElbow(pose,index,ball,settled,torso){
  if(settled<=0)return pose.elbows[index];
  const root=vectorCopy(pose.shoulders[index]),wrist=vectorCopy(pose.hands[index]),original=vectorCopy(pose.elbows[index]),direction=wrist.clone().sub(root),length=direction.length();direction.multiplyScalar(1/length);
  const reach=(keeperBody.upperArm**2-keeperBody.forearm**2+length*length)/(2*length),radius=Math.sqrt(Math.max(0,keeperBody.upperArm**2-reach*reach)),center=root.clone().addScaledVector(direction,reach);
  if(radius<1e-7)return pose.elbows[index];
  const front=vectorCopy(torso.chest.back),u=front.clone().addScaledVector(direction,-front.dot(direction));if(u.lengthSq()<1e-10)return pose.elbows[index];u.normalize();const v=new Vector3().crossVectors(direction,u),bend=original.clone().sub(center).normalize();
  // Outward/front support of the matched torso hull (about 15 cm) plus the
  // 6.3 cm forearm envelope and a small margin. The side component avoids an
  // infinite frontal plane incorrectly excluding an arm beside the ribcage.
  const normal=front.clone().addScaledVector(vectorCopy(torso.chest.right),index?.65:-.65).normalize(),frontOffset=Math.max(...['pelvis','spine','chest'].map(name=>dot(torso[name].position,normal)))+.215;
  // Tapered forearm: ball radius .11 + wrist radius .018 gives base .128;
  // radius grows another .045 toward the .063 elbow. Squared distance along
  // this cone reduces to one linear bound on the elbow-circle point.
  const relative=vectorCopy(ball).sub(wrist),base=.128,taper=.045,remaining=relative.lengthSq()-base*base,axisSquare=keeperBody.forearm**2-taper*taper,maximum=(remaining<=axisSquare?Math.sqrt(Math.max(0,remaining*axisSquare)):(remaining+axisSquare)/2)-base*taper;
  const constraints=[[normal,frontOffset],[new Vector3(0,1,0),.075],[relative.clone().negate(),-maximum-relative.dot(wrist)]];
  let arcs=[[-Math.PI,Math.PI]];
  for(const [normal,offset]of constraints){const a=radius*normal.dot(u),b=radius*normal.dot(v),h=Math.hypot(a,b),threshold=offset-normal.dot(center);if(h<1e-10){if(threshold>0)arcs=[];continue;}const ratio=threshold/h;if(ratio<=-1)continue;if(ratio>1){arcs=[];break;}const phase=Math.atan2(b,a),half=Math.acos(MathUtils.clamp(ratio,-1,1)),next=[];for(const [low,high]of arcs)for(let turn=-1;turn<=1;turn++){const lo=Math.max(low,phase-half+turn*2*Math.PI),hi=Math.min(high,phase+half+turn*2*Math.PI);if(hi>=lo)next.push([lo,hi]);}arcs=next;}
  // An overconstrained input keeps the original fixed-length branch. Dedicated
  // QA instruments this fallback; every sampled production capture must have
  // a feasible arc, instead of accepting a relaxed clearance threshold.
  if(!arcs.length)return pose.elbows[index];
  const raw=Math.atan2(bend.dot(v),bend.dot(u)),preferred=raw;
  let best,score=Infinity;for(const arc of arcs)for(let wrap=-1;wrap<=1;wrap++){const shifted=arc.map(a=>a+wrap*2*Math.PI),projected=MathUtils.clamp(preferred,...shifted),distance=Math.abs(projected-preferred);if(distance<score){score=distance;best=shifted;}}
  const [lo,hi]=best,width=Math.min(.06,(hi-lo)/4);let goal=preferred;
  const softMax=(x,b)=>{const delta=Math.abs(x-b);return Math.max(x,b)+(width&&delta<width?(width-delta)**2/(4*width):0);};
  goal=softMax(goal,lo);goal=-softMax(-goal,-hi);
  const turn=Math.atan2(Math.sin(goal-raw),Math.cos(goal-raw)),angle=raw+turn*settled;
  const e=center.addScaledVector(u,radius*Math.cos(angle)).addScaledVector(v,radius*Math.sin(angle));return {x:e.x,y:e.y,z:e.z};
}

// Capture-aware gathering moves both physical wrists around the ball. Changing
// the ball alone cannot resolve a trailing glove moving through the caught
// sphere. This pure function is identical during play, replay and random-access
// scrubbing; it never depends on the previous rendered frame.
export function keeperGather(sourcePose,currentPose,capturePoint,contactPart,blend=1){
  const held=holdingPose(currentPose,blend),weight=held.weight,pose=held.pose,index=captureHand(sourcePose,capturePoint,contactPart),other=1-index;
  if(blend<=0)return {...held,pose:currentPose,ball:{...capturePoint}};
  // Finish the physical catch first; settle the supporting forearms over the
  // following gather-length interval, and only once landing absorption begins.
  const elbowSettle=MathUtils.smoothstep(blend,1,2)*(currentPose.torso?.armRelax??0);
  // Lift the whole grasp toward the upper chest while side-lying legs tuck.
  // It is a bounded pose-space target, not a ball-only projection: both wrist
  // IK solves below follow this centre and preserve the original glove contact.
  // Upright reaches and the exact capture frame retain their authored target.
  const tuckLift=.11*(1-MathUtils.smoothstep(currentPose.up.y,.35,.95))*(currentPose.torso?.armRelax??0);
  held.center={...held.center,y:held.center.y+tuckLift};pose.grip={...pose.grip,center:held.center};
  const referenceHands=pose.hands.map(vectorCopy),referenceElbows=pose.elbows.map(vectorCopy);
  // Free support is not part of a captured grasp. Carry any orientation that
  // was already present at capture as a fixed local offset, then blend it into
  // the held palms; subsequent free-recovery brace weights cannot rotate a ball.
  const unbraced=p=>({...p,torso:{...p.torso,braceL:0,braceR:0}}),sourceFree=unbraced(sourcePose),currentFree=unbraced(currentPose);
  const sourceTorso=keeperTorsoFrames(sourcePose),currentTorso=keeperTorsoFrames(currentPose),completeHold=holdingPose(currentPose).pose;
  const sourceQ=[0,1].map(i=>keeperHandRotation(sourcePose,i,sourceTorso));
  const rawQ=[0,1].map(i=>keeperHandRotation(currentFree,i,currentTorso).multiply(keeperHandRotation(sourceFree,i,sourceTorso).invert().multiply(sourceQ[i])));
  const rotations=[0,1].map(i=>rawQ[i].clone().slerp(keeperHandRotation(completeHold,i,currentTorso),weight));
  const sourceOffset=vectorCopy(capturePoint).sub(sourcePose.hands[index]).applyQuaternion(sourceQ[index].clone().invert());
  const rawBall=sourceOffset.clone().applyQuaternion(rawQ[index]).add(currentPose.hands[index]);
  const ball=rawBall.clone().lerp(vectorCopy(held.center),weight);
  ball.y=Math.max(.11,ball.y);
  // At full settlement the ray is the fixed calibrated palm ray. Reuse the
  // module-local offset, rebuilt whenever this contact-data module is loaded.
  // Transition frames still evaluate their actual ray against the glove skin.
  const finalOffsets=heldPalmOffsets;
  const activeDirection=unitArc(sourceOffset,finalOffsets[index],weight),activeOffset=weight===1?finalOffsets[index]:gloveRayOffset(activeDirection,index);
  const wrist=ball.clone().sub(activeOffset.clone().applyQuaternion(rotations[index]));
  const activeArm=graspArm(pose.shoulders[index],wrist,referenceHands[index],referenceElbows[index],sourcePose,currentPose,index,weight);
  pose.hands[index]=activeArm.end;pose.elbows[index]=activeArm.joint;
  // A reach limit moves the whole grasp, never a glove through a fixed ball.
  ball.add(vectorCopy(activeArm.end).sub(wrist));
  pose.elbows[index]=graspElbow(pose.shoulders[index],pose.hands[index],pose.elbows[index],ball,weight,elbowSettle);
  const rawOtherOffset=rawBall.clone().sub(currentPose.hands[other]).applyQuaternion(rawQ[other].clone().invert());
  const otherDirection=unitArc(rawOtherOffset,finalOffsets[other],weight),minimum=weight===1?finalOffsets[other]:gloveRayOffset(otherDirection,other),length=MathUtils.lerp(rawOtherOffset.length(),minimum.length(),weight);
  const otherOffset=otherDirection.multiplyScalar(Math.max(minimum.length(),length));
  const otherWrist=ball.clone().sub(otherOffset.applyQuaternion(rotations[other]));
  const otherArm=graspArm(pose.shoulders[other],otherWrist,referenceHands[other],referenceElbows[other],sourcePose,currentPose,other,weight);
  pose.hands[other]=otherArm.end;pose.elbows[other]=graspElbow(pose.shoulders[other],otherArm.end,otherArm.joint,ball,weight,elbowSettle);
  // The catching arm keeps its incoming arc until secure. The trailing arm
  // can settle sooner as it approaches the torso; all envelopes vanish at the
  // exact source capture. Only elbows move here: wrists and ball stay coupled.
  const constraintSettle=MathUtils.smoothstep(blend,0,.6),torso=currentTorso;
  for(let i=0;i<2;i++){
    const settle=i===index?elbowSettle:elbowSettle+(1-elbowSettle)*constraintSettle*graspTorsoProximity(pose,i,torso);
    pose.elbows[i]=graspFeasibleElbow(pose,i,ball,settle,torso);
  }
  pose.grip={...pose.grip,handRotations:rotations.map(q=>q.toArray())};
  return {...held,pose,ball:{x:ball.x,y:ball.y,z:ball.z}};
}

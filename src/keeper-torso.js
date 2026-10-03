// Small analytic torso chain shared by IK, GPU skin posing and ball contact.
// Angles are pose inputs, never accumulated state: reverse scrubbing, blends,
// planted extremities and translated keepers use exactly the same deformation.
const v=(x=0,y=0,z=0)=>({x,y,z});
const add=(a,b,s=1)=>v(a.x+b.x*s,a.y+b.y*s,a.z+b.z*s);
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a,b)=>v(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x);
const unit=a=>{const n=Math.hypot(a.x,a.y,a.z)||1;return v(a.x/n,a.y/n,a.z/n);};
const bounded=(value,limit)=>Math.max(-limit,Math.min(limit,Number.isFinite(value)?value:0));
function turn(point,axis,angle){
  if(!angle)return point;
  const c=Math.cos(angle),s=Math.sin(angle),a=dot(point,axis)*(1-c),b=cross(axis,point);
  return v(point.x*c+b.x*s+axis.x*a,point.y*c+b.y*s+axis.y*a,point.z*c+b.z*s+axis.z*a);
}
function orient(base,curl,twist,sideBend){
  let {right,up,back}=base;
  up=turn(up,right,curl);back=turn(back,right,curl);
  right=turn(right,up,twist);back=turn(back,up,twist);
  right=turn(right,back,sideBend);up=turn(up,back,sideBend);
  return {right,up,back};
}
export function hasKeeperTorsoArticulation(pose){
  const t=pose.torso;return !!t&&['curl','twist','sideBend','headCurl'].some(key=>Number.isFinite(t[key])&&t[key]!==0);
}
export function keeperTorsoFrames(pose){
  const up=unit(pose.up),back=unit(cross(pose.right,up)),right=unit(cross(up,back));
  const pelvis={position:pose.hip,right,up,back},t=pose.torso??{};
  const curl=bounded(t.curl,.18),twist=bounded(t.twist,.12),sideBend=bounded(t.sideBend,.12),headCurl=bounded(t.headCurl,.15);
  // Preserve the exact legacy landmarks when articulation is absent. In the
  // active chain, fixed .19/.24/.08/.12 m segments replace the old rigid rod.
  if(!curl&&!twist&&!sideBend&&!headCurl){
    const at=distance=>add(pose.hip,pose.up,distance);
    return {pelvis,spine:{...pelvis,position:at(.19)},chest:{...pelvis,position:at(.43)},neck:{...pelvis,position:at(.51)},head:{...pelvis,position:at(.63)},shoulder:at(.49),headPoint:at(.735)};
  }
  const spine={position:add(pose.hip,up,.19),...orient(pelvis,curl*.45,twist*.45,sideBend*.45)};
  const chest={position:add(spine.position,spine.up,.24),...orient(pelvis,curl,twist,sideBend)};
  const neck={position:add(chest.position,chest.up,.08),...orient(chest,headCurl*.5,0,0)};
  const head={position:add(neck.position,neck.up,.12),...orient(chest,headCurl,0,0)};
  return {pelvis,spine,chest,neck,head,shoulder:add(chest.position,chest.up,.06),headPoint:add(head.position,head.up,.105)};
}

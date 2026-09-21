import {neckAngles} from './anatomy.js';
import {batchRigidGroup} from './batching.js';
import * as THREE from 'three';
const set=(target,p)=>target.set(p.x,p.y,p.z);
const sphere=new THREE.SphereGeometry(1,24,16);
const mat=(color,roughness=.78)=>new THREE.MeshStandardMaterial({color,roughness});
function mesh(g,m,parent){const o=new THREE.Mesh(g,m);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;}
function ellipsoid(parent,m,x,y,z,sx,sy,sz){const o=mesh(sphere,m,parent);o.position.set(x,y,z);o.scale.set(sx,sy,sz);return o;}
// Elliptical ring lofts preserve human contours rather than round cylinder torsos.
function loft(rings,segments=24,fold=0){const positions=[],uv=[],indices=[];for(let j=0;j<rings.length;j++){const[y,w,d,z=0]=rings[j];for(let i=0;i<=segments;i++){const a=i/segments*Math.PI*2;const ripple=fold*Math.sin(a*6+y*17)*Math.sin(Math.PI*j/(rings.length-1));positions.push(Math.cos(a)*(w+ripple),y,Math.sin(a)*(d+ripple)+z);uv.push(i/segments,j/(rings.length-1));}}for(let j=0;j<rings.length-1;j++)for(let i=0;i<segments;i++){const a=j*(segments+1)+i,b=a+segments+1;indices.push(a,b,a+1,b,b+1,a+1);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g;}
function hairCap(){
  const positions=[],uv=[],indices=[],segments=32,rows=16;
  for(let j=0;j<=rows;j++)for(let i=0;i<=segments;i++){
    const a=i/segments*Math.PI*2,front=Math.sin(a),edge=.02+.075*Math.max(0,front)-.085*Math.max(0,-front);
    const theta=j/rows*Math.acos((edge-.043)/.127);
    positions.push(.099*Math.cos(a)*Math.sin(theta),.043+.127*Math.cos(theta),-.004+.10*Math.sin(a)*Math.sin(theta));uv.push(i/segments,j/rows);
  }
  for(let j=0;j<rows;j++)for(let i=0;i<segments;i++){const a=j*(segments+1)+i,b=a+segments+1;indices.push(a,a+1,b,b,a+1,b+1);}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}
// A continuous sleeve of vertices bends around each joint, with no separate joint ball.
function articulatedLimb(parent,materials,leg=false){
  const rows=32,sides=16,positions=new Float32Array((rows+1)*(sides+1)*3),indices=[];
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
  for(let row=0;row<rows;row++){
    const start=indices.length;
    for(let side=0;side<sides;side++){const a=row*(sides+1)+side,b=a+sides+1;indices.push(a,a+1,b,b,a+1,b+1);}
    const materialIndex=leg?(row<13?1:row>=19?2:0):(row<9?1:0),previous=geometry.groups.at(-1);
    if(previous?.materialIndex===materialIndex)previous.count+=sides*6;else geometry.addGroup(start,sides*6,materialIndex);
  }
  const uv=[];for(let row=0;row<=rows;row++)for(let side=0;side<=sides;side++)uv.push(side/sides,row/rows);geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geometry.setIndex(indices);const object=mesh(geometry,materials,parent);object.frustumCulled=false;
  object.userData.leg=leg;return object;
}
const limbUpper=new THREE.Vector3(),limbLower=new THREE.Vector3(),limbTangent=new THREE.Vector3(),limbAcross=new THREE.Vector3(),limbNormal=new THREE.Vector3(),limbCenter=new THREE.Vector3();
function bendLimb(object,root,joint,end){
  const leg=object.userData.leg,rows=32,sides=16,upper=leg?.43:.29,lower=leg?.43:.27,total=upper+lower,blend=.065;
  limbUpper.set(joint.x-root.x,joint.y-root.y,joint.z-root.z).normalize();limbLower.set(end.x-joint.x,end.y-joint.y,end.z-joint.z).normalize();
  const bendPlane=new THREE.Vector3().crossVectors(limbUpper,limbLower).normalize();
  const profile=leg?[[0,.117],[.24,.111],[.40,.091],[.50,.069],[.59,.064],[.72,.074],[.85,.056],[1,.047]]:[[0,.080],[.23,.077],[.40,.063],[.52,.052],[.68,.053],[.84,.045],[1,.036]];
  const attr=object.geometry.attributes.position;
  for(let row=0;row<=rows;row++){
    const t=row/rows,d=t*total;
    if(d<upper-blend){limbCenter.set(root.x,root.y,root.z).addScaledVector(limbUpper,d);limbTangent.copy(limbUpper);}
    else if(d>upper+blend){limbCenter.set(joint.x,joint.y,joint.z).addScaledVector(limbLower,d-upper);limbTangent.copy(limbLower);}
    else{const q=(d-upper+blend)/(2*blend);limbCenter.set(joint.x,joint.y,joint.z).addScaledVector(limbUpper,-blend*(1-q)**2).addScaledVector(limbLower,blend*q*q);limbTangent.copy(limbUpper).multiplyScalar(1-q).addScaledVector(limbLower,q).normalize();}
    limbAcross.copy(bendPlane);limbNormal.crossVectors(limbTangent,limbAcross).normalize();
    let i=1;while(profile[i][0]<t)i++;const [a,r0]=profile[i-1],[b,r1]=profile[i],q=(t-a)/(b-a),radius=r0+(r1-r0)*q*q*(3-2*q);
    for(let side=0;side<=sides;side++){const angle=side/sides*Math.PI*2,c=Math.cos(angle)*radius,s=Math.sin(angle)*radius*.92;attr.setXYZ(row*(sides+1)+side,limbCenter.x+limbAcross.x*c+limbNormal.x*s,Math.max(-.014,limbCenter.y+limbAcross.y*c+limbNormal.y*s),limbCenter.z+limbAcross.z*c+limbNormal.z*s);}
  }
  attr.needsUpdate=true;object.geometry.computeVertexNormals();
  const normals=object.geometry.attributes.normal;for(let row=0;row<=rows;row++){const a=row*(sides+1),b=a+sides;limbNormal.fromBufferAttribute(normals,a);limbAcross.fromBufferAttribute(normals,b);limbNormal.add(limbAcross).normalize();normals.setXYZ(a,limbNormal.x,limbNormal.y,limbNormal.z);normals.setXYZ(b,limbNormal.x,limbNormal.y,limbNormal.z);}
}
let fabricNormal;
function clothNormal(){
  if(fabricNormal)return fabricNormal;
  const size=64,data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){const i=(y*size+x)*4;data[i]=128+Math.round(Math.sin(x*Math.PI/2)*24);data[i+1]=128+Math.round(Math.sin(y*Math.PI/2)*24);data[i+2]=252;data[i+3]=255;}
  fabricNormal=new THREE.DataTexture(data,size,size);fabricNormal.wrapS=fabricNormal.wrapT=THREE.RepeatWrapping;fabricNormal.repeat.set(12,12);fabricNormal.needsUpdate=true;return fabricNormal;
}
function supportedSoleOffset(height,q,requested){
  const nx=2*(q.x*q.y+q.z*q.w),ny=1-2*(q.x*q.x+q.z*q.z),nz=2*(q.y*q.z-q.x*q.w);
  const upper=-.043*nz-Math.hypot(.069*nx,.049*ny,.142*nz);
  const sole=-.028*ny-.045*nz-Math.hypot(.070*nx,.022*ny,.143*nz);
  const studs=-.043*Math.abs(nx)-.055*ny+Math.min(-.13*nz,.045*nz)-.009*Math.abs(ny)-.009*Math.hypot(nx,nz);
  const laces=.045*ny+Math.min(-.025*nz,-.076*nz)-.028*Math.abs(nx)-.0025*Math.abs(ny)-.0045*Math.abs(nz);
  return Math.max(0,Math.min(requested,(height+Math.min(upper,sole,studs,laces)+.014)/Math.max(.01,ny)));
}
export class Player {
  constructor(scene,color,gloves=false){
    this.group=new THREE.Group();scene.add(this.group);this.gloves=gloves;
    this.tempA=new THREE.Vector3();this.tempB=new THREE.Vector3();this.tempC=new THREE.Vector3();this.tempD=new THREE.Vector3();this.yAxis=new THREE.Vector3(0,1,0);this.tempMatrix=new THREE.Matrix4();this.tempRotation=new THREE.Quaternion();
    this.skin=mat('#af7857',.65);this.shirt=mat(color);this.shorts=mat('#182b2c');this.sock=mat('#dce7dc');this.boot=mat('#172020',.45);this.trim=mat('#375b52');this.white=mat('#e8ece4');
    for(const cloth of [this.shirt,this.shorts,this.sock]){cloth.normalMap=clothNormal();cloth.normalScale.set(.22,.22);}
    this.trunk=new THREE.Group();this.group.add(this.trunk);
    this.torso=mesh(loft([[0,.145,.105],[.018,.151,.109],[.045,.148,.106],[.08,.155,.115],[.13,.153,.110],[.20,.163,.112],[.27,.184,.118],[.34,.205,.12],[.40,.210,.111],[.44,.207,.10],[.475,.188,.092],[.505,.10,.069],[.52,.073,.064]],24,.004),this.shirt,this.trunk);
    this.pelvis=mesh(loft([[-.13,.13,.105],[0,.165,.12],[.06,.148,.108]]),this.shorts,this.trunk);
    ellipsoid(this.trunk,this.skin,0,.53,0,.063,.085,.061);
    const collar=mesh(new THREE.TorusGeometry(.073,.012,8,32),this.trim,this.trunk);collar.rotation.x=Math.PI/2;collar.position.y=.518;
    for(const sign of[-1,1]){const seam=mesh(new THREE.BoxGeometry(.008,.34,.012),this.trim,this.trunk);seam.position.set(sign*.161,.18,.102);}
    this.head=new THREE.Group();this.trunk.add(this.head);this.head.position.y=.735;this.head.scale.setScalar(.9);
    const face=new THREE.Group();this.head.add(face);face.rotation.y=gloves?0:Math.PI;
    mesh(loft([[-.14,.045,.050],[-.125,.058,.060],[-.105,.072,.065],[-.070,.082,.078],[-.04,.090,.084],[.005,.095,.085],[.035,.095,.084],[.070,.090,.081],[.105,.082,.073],[.135,.062,.060],[.15,.04,.046],[.158,.002,.002]]),this.skin,face);
    // Reuse paired facial materials so the rigid face still batches by material.
    const hairMaterial=mat('#26211e'),earInset=mat('#85533d'),eyeWhite=mat('#e0d6c8'),iris=mat('#352d27',.45),browMaterial=mat('#3b2b23'),nostril=mat('#744733');
    mesh(hairCap(),hairMaterial,face);
    for(const sign of[-1,1]){
      ellipsoid(face,this.skin,sign*.093,-.005,-.003,.015,.032,.018);
      ellipsoid(face,earInset,sign*.101,-.005,.006,.007,.018,.009);
      ellipsoid(face,eyeWhite,sign*.034,.025,.078,.017,.007,.005);
      ellipsoid(face,iris,sign*.034,.026,.083,.0045,.0045,.0025);
      for(const upper of[false,true]){
        const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(sign*.034-.016,.025,.079),new THREE.Vector3(sign*.034,.025+(upper?.006:-.005),.083),new THREE.Vector3(sign*.034+.016,.025,.079)]);
        mesh(new THREE.TubeGeometry(curve,8,.0018,5,false),this.skin,face);
      }
      const browCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(sign*.017,.043,.081),new THREE.Vector3(sign*.034,.048,.080),new THREE.Vector3(sign*.052,.045,.073)]);
      mesh(new THREE.TubeGeometry(browCurve,8,.003,5,false),browMaterial,face);
    }
    mesh(loft([[-.027,.008,.005,.088],[-.020,.012,.010,.091],[-.010,.014,.013,.094],[.004,.010,.010,.087],[.022,.007,.005,.081],[.035,.003,.003,.077]],20),this.skin,face);
    for(const sign of[-1,1])ellipsoid(face,this.skin,sign*.013,-.019,.091,.006,.005,.006);
    const lip=mat('#885645');
    ellipsoid(face,lip,0,-.064,.081,.025,.002,.002);
    ellipsoid(face,nostril,0,-.0665,.082,.024,.001,.0015);
    ellipsoid(face,this.skin,0,-.069,.081,.025,.0025,.002);
    for(const sign of[-1,1])ellipsoid(face,nostril,sign*.009,-.020,.096,.004,.0025,.002);
    this.limbs=[];this.hands=[];this.feet=[];this.shoulderCaps=[];
    for(let i=0;i<2;i++){
      this.shoulderCaps.push(ellipsoid(this.group,this.shirt,0,0,0,.075,.061,.070));
      this.limbs.push(articulatedLimb(this.group,[this.skin,this.shirt]),articulatedLimb(this.group,[this.skin,this.shorts,this.sock],true));
      const h=new THREE.Group();this.group.add(h);this.hands.push(h);const hm=gloves?this.white:this.skin;
      ellipsoid(h,hm,0,.025,0,.044,.057,.024);
      for(let f=0;f<4;f++){
        const length=[.067,.078,.073,.056][f],base=new THREE.Group();h.add(base);base.position.set((f-1.5)*.020,.060,.003);base.rotation.x=gloves?.08:.35;
        ellipsoid(base,hm,0,length*.24,0,.010,length*.27,.011);
        const tip=new THREE.Group();base.add(tip);tip.position.y=length*.45;tip.rotation.x=gloves?.16:.55;
        ellipsoid(tip,hm,0,length*.24,0,.009,length*.28,.010);
        if(gloves)ellipsoid(base,this.trim,0,length*.18,-.010,.007,length*.19,.003);
      }
      const thumb=ellipsoid(h,hm,i?-.049:.049,.018,.014,.016,.034,.016);thumb.rotation.z=i?.5:-.5;
      if(gloves){const cuff=mesh(new THREE.CylinderGeometry(.045,.043,.05,20),this.trim,h);cuff.position.y=-.035;ellipsoid(h,this.shirt,0,.033,-.025,.031,.035,.006);}
      const shoe=new THREE.Group();this.group.add(shoe);this.feet.push(shoe);
      ellipsoid(shoe,this.boot,0,0,-.043,.069,.049,.142);
      ellipsoid(shoe,this.trim,0,-.028,-.045,.070,.022,.143);
      for(let j=0;j<4;j++){const lace=mesh(new THREE.BoxGeometry(.056,.005,.009),this.white,shoe);lace.position.set(0,.045,-.025-j*.017);}
      for(const x of[-.043,.043])for(const z of[-.13,-.065,.045]){const stud=mesh(new THREE.CylinderGeometry(.009,.007,.018,8),this.white,shoe);stud.position.set(x,-.055,z);}
    }
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;this.numberTexture=new THREE.CanvasTexture(canvas);this.numberTexture.colorSpace=THREE.SRGBColorSpace;
    this.number=mesh(new THREE.PlaneGeometry(.17,.20),new THREE.MeshStandardMaterial({map:this.numberTexture,transparent:true,roughness:.8,depthWrite:false}),this.trunk);this.number.position.set(0,.28,gloves?-.124:.124);if(gloves)this.number.rotation.y=Math.PI;
    batchRigidGroup(this.head);
    for(const group of [...this.hands,...this.feet])batchRigidGroup(group);
    this.setColor(color,11);
  }
  setColor(color,number=11){this.shirt.color.set(color);const c=this.numberTexture.image.getContext('2d');c.clearRect(0,0,256,256);c.fillStyle='#19352e';c.font='bold 185px sans-serif';c.textAlign='center';c.fillText(String(number),128,199);this.numberTexture.needsUpdate=true;}
  lookAt(target,dt){
    this.group.updateWorldMatrix(true,false);this.tempMatrix.copy(this.group.matrixWorld).invert();
    const relative=set(this.tempA,target).applyMatrix4(this.tempMatrix).sub(this.trunk.position);
    relative.applyQuaternion(this.tempRotation.copy(this.trunk.quaternion).invert()).sub(this.head.position);
    const angles=neckAngles(relative,this.gloves?1:-1),weight=1-Math.exp(-Math.max(0,dt)*12);
    this.head.rotation.x+=(angles.pitch-this.head.rotation.x)*weight;
    this.head.rotation.y+=(angles.yaw-this.head.rotation.y)*weight;
  }
  pose(p){
    set(this.trunk.position,p.hip);const right=set(this.tempA,p.right),up=set(this.tempB,p.up),back=this.tempC.crossVectors(right,up).normalize();this.trunk.quaternion.setFromRotationMatrix(this.tempMatrix.makeBasis(right,up,back));
    for(let i=0;i<2;i++){
      set(this.shoulderCaps[i].position,p.shoulders[i]);this.shoulderCaps[i].position.addScaledVector(p.up,-.026);this.shoulderCaps[i].quaternion.copy(this.trunk.quaternion);
      bendLimb(this.limbs[i*2],p.shoulders[i],p.elbows[i],p.hands[i]);
      bendLimb(this.limbs[i*2+1],p.hips[i],p.knees[i],p.feet[i]);
      set(this.hands[i].position,p.hands[i]);set(this.tempA,p.hands[i]).sub(set(this.tempB,p.elbows[i])).normalize();this.hands[i].quaternion.setFromUnitVectors(this.yAxis,this.tempA);
      // Wrist dorsiflexion flattens the palm as it becomes a ground support.
      const support=1-THREE.MathUtils.smoothstep(p.hands[i].y,.10,.24);
      if(support>0){const fingers=set(this.tempA,p.forward).setY(0).normalize(),normal=this.yAxis,across=this.tempB.crossVectors(fingers,normal);const planted=this.tempRotation.setFromRotationMatrix(this.tempMatrix.makeBasis(across,fingers,normal));this.hands[i].quaternion.slerp(planted,support);}
      set(this.feet[i].position,p.feet[i]);const tilt=THREE.MathUtils.smoothstep(p.feet[i].y,.085,.19)*THREE.MathUtils.clamp(Math.atan2(p.feet[i].z-p.knees[i].z,p.knees[i].y-p.feet[i].y)*.45,-.65,.65);this.feet[i].rotation.set(tilt,p.feetYaw?.[i]??(this.gloves?Math.PI:0),-(p.roll||0)*.7);
      const soleOffset=supportedSoleOffset(p.feet[i].y,this.feet[i].quaternion,.025*(1-THREE.MathUtils.smoothstep(Math.abs(p.roll||0),0,.35)));this.tempA.set(0,-soleOffset,0).applyQuaternion(this.feet[i].quaternion);this.feet[i].position.add(this.tempA);
    }
  }
}

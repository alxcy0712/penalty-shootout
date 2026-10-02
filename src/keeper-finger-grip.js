import * as THREE from 'three';

// Authored bend for the production keeper glove. These are local hand metres.
// Distal four fingers bend from their knuckles; the palm and cuff never move.
// Geometry is cloned per actor so replay actors cannot change each other's grip.
const START=.105, CURVATURE=18, AXIS_Z=.002, RADIUS=.11, SKIN_GAP=.00035;
const ease=t=>{t=Math.max(0,Math.min(1,t));return t*t*t*(10+t*(-15+6*t));};
export function keeperFingerCloseWeight(pose){return pose?.grip?.ball?ease(((pose.grip.captureBlend??pose.grip.weight)-.90)/.70):0;}
export function createKeeperFingerGrip(root){
  const states=[],v=new THREE.Vector3(),n=new THREE.Vector3();
  root.traverse(mesh=>{
    if(!mesh.isSkinnedMesh||mesh.material.name!=='Socks')return;
    const original=mesh.geometry, geometry=original.clone();mesh.geometry=geometry;
    const position=geometry.attributes.position,normal=geometry.attributes.normal,skin=geometry.attributes.skinIndex,weights=geometry.attributes.skinWeight;
    position.setUsage(THREE.DynamicDrawUsage);normal.setUsage(THREE.DynamicDrawUsage);
    for(const side of ['L','R']){
      const boneIndex=mesh.skeleton.bones.findIndex(b=>b.name===`hand${side}`);if(boneIndex<0)continue;
      const toHand=mesh.skeleton.boneInverses[boneIndex].clone().multiply(mesh.bindMatrix),fromHand=toHand.clone().invert(),toNormal=new THREE.Matrix3().getNormalMatrix(toHand),fromNormal=new THREE.Matrix3().getNormalMatrix(fromHand);
      const entries=[],local=new Map();
      for(let i=0;i<position.count;i++){
        let pure=false;for(let j=0;j<4;j++)if(skin.array[i*4+j]===boneIndex&&weights.array[i*4+j]===1)pure=true;
        if(!pure)continue;
        v.fromBufferAttribute(position,i).applyMatrix4(toHand);local.set(i,{p:v.clone(),d:new THREE.Vector3()});
        if(v.y<=START||Math.abs(v.x)>.055)continue;
        const y=v.y-START,z=v.z-AXIS_Z,angle=CURVATURE*y,s=Math.sin(angle),c=Math.cos(angle);
        const bent=new THREE.Vector3(v.x,START+s/CURVATURE-z*s,AXIS_Z+(1-c)/CURVATURE+z*c);
        local.get(i).d.copy(bent).sub(v);
        const base=new THREE.Vector3().fromBufferAttribute(position,i),target=bent.applyMatrix4(fromHand);
        n.fromBufferAttribute(normal,i).applyMatrix3(toNormal).normalize();
        const ny=n.y/(1-CURVATURE*z),nz=n.z;n.set(n.x,ny*c-nz*s,ny*s+nz*c).normalize().applyMatrix3(fromNormal).normalize();
        entries.push({i,handBase:local.get(i).p,handDelta:local.get(i).d,base,delta:target.sub(base),normal:new THREE.Vector3().fromBufferAttribute(normal,i),targetNormal:n.clone()});
      }
      if(!entries.length)continue;
      const changed=new Set(entries.map(e=>e.i)),faces=[],idx=geometry.index.array;
      for(let i=0;i<idx.length;i+=3){const face=[idx[i],idx[i+1],idx[i+2]];if(face.some(i=>changed.has(i))){if(!face.every(i=>local.has(i)))throw new Error('Finger grip requires exact single-hand weights on every touched triangle');faces.push(face.map(i=>local.get(i)));}}
      const minimum=Math.min(...entries.map(e=>e.i)),maximum=Math.max(...entries.map(e=>e.i));
      const guards=makeGuards(faces);
      states.push({guards,rangeStart:minimum*3,rangeCount:(maximum-minimum+1)*3,mesh,position,normal,bone:mesh.skeleton.bones[boneIndex],entries,triangleCount:faces.length,amount:-1, inverse:new THREE.Matrix4(),handRoot:new THREE.Matrix4()});
    }
  });
  const ballLocal=new THREE.Vector3();
  const dirty=(attribute,start,count)=>{let lo=start,hi=start+count;for(const range of attribute.updateRanges){lo=Math.min(lo,range.start);hi=Math.max(hi,range.start+range.count);}attribute.clearUpdateRanges();attribute.addUpdateRange(lo,hi-lo);attribute.needsUpdate=true;};
  const apply=(pose)=>{
    const desired=keeperFingerCloseWeight(pose);
    for(const state of states){let amount=0;
      if(desired){state.inverse.copy(state.bone.matrixWorld).invert().multiply(root.matrixWorld);ballLocal.copy(pose.grip.ball).applyMatrix4(state.inverse);
        // The swept guards cover every moved triangle at every morph
        // fraction. Solve the first intersection with each expanded sphere;
        // no mesh scan, iteration, previous-frame cache, or vertex-only test.
        amount=desired;let fade=1;
        for(const g of state.guards){
          const x=g.a[0]-ballLocal.x,y=g.a[1]-ballLocal.y,z=g.a[2]-ballLocal.z;
          const square=x*x+y*y+z*z,clear=Math.sqrt(square)-g.radius;
          fade=Math.min(fade,ease(clear/.001));
          if(clear<=0){amount=0;break;}
          const along=x*g.d[0]+y*g.d[1]+z*g.d[2];
          if(along>=0||g.speed<1e-16)continue;
          const disc=along*along-g.speed*(square-g.radius*g.radius);
          if(disc>0)amount=Math.min(amount,(-along-Math.sqrt(disc))/g.speed);
        }
        amount=Math.max(0,amount)*fade;
        // Linear vertex halfspaces also protect the turf. Each moved vertex
        // and every triangle interior stay above the existing 5mm target;
        // an already lower source point may never move lower through curl.
        state.handRoot.copy(state.inverse).invert();const e=state.handRoot.elements;
        for(const entry of state.entries){const p=entry.handBase,d=entry.handDelta,height=e[1]*p.x+e[5]*p.y+e[9]*p.z+e[13],down=e[1]*d.x+e[5]*d.y+e[9]*d.z;if(down<0)amount=Math.min(amount,Math.max(0,(height-Math.min(.005,height))/-down));}
      }
      if(amount===state.amount)continue;
      for(const e of state.entries){v.copy(e.base).addScaledVector(e.delta,amount);state.position.setXYZ(e.i,v.x,v.y,v.z);n.copy(e.normal);if(amount)n.lerp(e.targetNormal,amount).normalize();state.normal.setXYZ(e.i,n.x,n.y,n.z);}
      dirty(state.position,state.rangeStart,state.rangeCount);dirty(state.normal,state.rangeStart,state.rangeCount);state.amount=amount;
    }

  };
  apply.diagnostics=()=>states.map(s=>({side:s.bone.name,vertices:s.entries.length,triangles:s.triangleCount,guards:s.guards.length,amount:s.amount,uploadSpanBytes:s.rangeCount*4*2}));
  return apply;
}

// A sphere encloses each endpoint cluster. Convexity of Euclidean distance
// proves that the linearly moving sphere with max(endpoint radii) encloses
// every point of every intermediate triangle. Recursively split only until
// the calibrated held sphere has a useful clearance; this affects efficiency,
// never safety. In the current GLB this produces fewer than 100 guards per hand.
function makeGuards(faces){
  const guards=[],reference=[0,.0765422885373497,.13916779734063595];
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],sub=(a,b)=>a.map((v,i)=>v-b[i]),length=a=>Math.sqrt(dot(a,a));
  const initial=faces.map(face=>face.map(v=>({a:v.p.toArray(),b:v.p.clone().add(v.d).toArray()})));
  function split(faces,depth=0){
    const vertices=faces.flat(),a=[],b=[];
    for(let i=0;i<3;i++){a[i]=(Math.min(...vertices.map(v=>v.a[i]))+Math.max(...vertices.map(v=>v.a[i])))/2;b[i]=(Math.min(...vertices.map(v=>v.b[i]))+Math.max(...vertices.map(v=>v.b[i])))/2;}
    const radius=Math.max(...vertices.map(v=>Math.max(length(sub(v.a,a)),length(sub(v.b,b))))),d=sub(b,a),speed=dot(d,d),off=sub(a,reference),t=Math.max(0,Math.min(1,-dot(off,d)/(speed||1)));
    const margin=length(off.map((v,i)=>v+t*d[i]))-RADIUS-radius;
    if(margin>.0015||depth>=16){guards.push({a,d,speed,radius:radius+RADIUS+SKIN_GAP});return;}
    if(faces.length===1){
      const [x,y,z]=faces[0],mid=(u,v)=>({a:u.a.map((x,i)=>(x+v.a[i])/2),b:u.b.map((x,i)=>(x+v.b[i])/2)}),xy=mid(x,y),yz=mid(y,z),zx=mid(z,x);
      for(const face of[[x,xy,zx],[xy,y,yz],[zx,yz,z],[xy,yz,zx]])split([face],depth+1);return;
    }
    const centroids=faces.map(face=>({face,center:[0,1,2].map(i=>face.reduce((sum,v)=>sum+v.a[i],0)/3)})),extent=[0,1,2].map(i=>Math.max(...centroids.map(v=>v.center[i]))-Math.min(...centroids.map(v=>v.center[i]))),axis=extent.indexOf(Math.max(...extent));
    centroids.sort((a,b)=>a.center[axis]-b.center[axis]);const middle=Math.floor(centroids.length/2);split(centroids.slice(0,middle).map(x=>x.face),depth+1);split(centroids.slice(middle).map(x=>x.face),depth+1);
  }
  split(initial);return guards;
}

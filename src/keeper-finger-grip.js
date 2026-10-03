import * as THREE from 'three';

// Authored bend for the production keeper glove. These are local hand metres.
// The four fingers retain their knuckle bend. A separately limited authored
// distal thumb-tip cup leaves the calibrated palm, thumb base and cuff exact.
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
      const entries=[],thumbEntries=[],local=new Map();
      const sign=side==='L'?1:-1,thumbO=new THREE.Vector3(sign*.067,.081,.041),thumbT=new THREE.Vector3(sign*.5402161296864605,.8003201921280896,.26010406244162915),thumbN=new THREE.Vector3(sign*-.5023094763024581,.0586832468755778,.8626943065494812),thumbB=new THREE.Vector3().crossVectors(thumbT,thumbN),thumbK=8;
      const thumbPlane=new THREE.Vector3(sign*.615,.072,-.785).normalize();
      for(let i=0;i<position.count;i++){
        let pure=false;for(let j=0;j<4;j++)if(skin.array[i*4+j]===boneIndex&&weights.array[i*4+j]===1)pure=true;
        if(!pure)continue;
        v.fromBufferAttribute(position,i).applyMatrix4(toHand);local.set(i,{p:v.clone(),d:new THREE.Vector3()});
        let bent,isThumb=false;
        n.fromBufferAttribute(normal,i).applyMatrix3(toNormal).normalize();
        if(v.y>START&&Math.abs(v.x)<=.055){
          const y=v.y-START,z=v.z-AXIS_Z,angle=CURVATURE*y,s=Math.sin(angle),c=Math.cos(angle);
          bent=new THREE.Vector3(v.x,START+s/CURVATURE-z*s,AXIS_Z+(1-c)/CURVATURE+z*c);
          const ny=n.y/(1-CURVATURE*z),nz=n.z;n.set(n.x,ny*c-nz*s,ny*s+nz*c).normalize();
        }else{
          if(sign*v.x<=.058)continue;
          const off=v.clone().sub(thumbO),y=off.dot(thumbT),z=off.dot(thumbN),x=off.dot(thumbB);
          if(y<=0)continue;
          isThumb=true;
          const angle=thumbK*y,s=Math.sin(angle),c=Math.cos(angle);
          bent=thumbO.clone().addScaledVector(thumbT,s/thumbK-z*s).addScaledVector(thumbN,(1-c)/thumbK+z*c).addScaledVector(thumbB,x);
          const ny=n.dot(thumbT)/(1-thumbK*z),nz=n.dot(thumbN),nx=n.dot(thumbB);
          n.copy(thumbT).multiplyScalar(ny*c-nz*s).addScaledVector(thumbN,ny*s+nz*c).addScaledVector(thumbB,nx).normalize();
        }
        local.get(i).d.copy(bent).sub(v);
        const base=new THREE.Vector3().fromBufferAttribute(position,i),target=bent.applyMatrix4(fromHand);
        n.applyMatrix3(fromNormal).normalize();
        (isThumb?thumbEntries:entries).push({i,handBase:local.get(i).p,handDelta:local.get(i).d,base,delta:target.sub(base),normal:new THREE.Vector3().fromBufferAttribute(normal,i),targetNormal:n.clone()});
      }
      if(!entries.length)continue;
      const changed=new Set(entries.map(e=>e.i)),faces=[],idx=geometry.index.array;
      for(let i=0;i<idx.length;i+=3){const face=[idx[i],idx[i+1],idx[i+2]];if(face.some(i=>changed.has(i))){if(!face.every(i=>local.has(i)))throw new Error('Finger grip requires exact single-hand weights on every touched triangle');faces.push(face.map(i=>local.get(i)));}}
      const thumbChanged=new Set(thumbEntries.map(e=>e.i)),thumbFaces=[];
      for(let i=0;i<idx.length;i+=3){const face=[idx[i],idx[i+1],idx[i+2]];if(face.some(i=>thumbChanged.has(i))){if(!face.every(i=>local.has(i)))throw new Error('Thumb grip requires exact single-hand weights on every touched triangle');thumbFaces.push(face.map(i=>local.get(i)));}}
      let thumbSupport=Infinity;
      for(const face of thumbFaces)for(const vertex of face)thumbSupport=Math.min(thumbSupport,thumbPlane.dot(vertex.p),thumbPlane.dot(vertex.p)+thumbPlane.dot(vertex.d));
      const fingerBox=new THREE.Box3();
      for(const entry of entries){fingerBox.expandByPoint(entry.handBase);fingerBox.expandByPoint(entry.handBase.clone().add(entry.handDelta));}
      const fingerCenter=fingerBox.getCenter(new THREE.Vector3()),fingerExtent=fingerBox.getSize(new THREE.Vector3()).multiplyScalar(.5);
      const thumbBox=new THREE.Box3();
      for(const entry of thumbEntries){thumbBox.expandByPoint(entry.handBase);thumbBox.expandByPoint(entry.handBase.clone().add(entry.handDelta));}
      const thumbCenter=thumbBox.getCenter(new THREE.Vector3()),thumbExtent=thumbBox.getSize(new THREE.Vector3()).multiplyScalar(.5);
      const minimum=Math.min(...entries.map(e=>e.i),...thumbEntries.map(e=>e.i)),maximum=Math.max(...entries.map(e=>e.i),...thumbEntries.map(e=>e.i));
      const guards=makeGuards(faces);
      states.push({fingerCenter,fingerExtent,thumbCenter,thumbExtent,thumbEntries,thumbPlane,thumbSupport,thumbTriangleCount:thumbFaces.length,thumbAmount:-1,guards,rangeStart:minimum*3,rangeCount:(maximum-minimum+1)*3,mesh,position,normal,bone:mesh.skeleton.bones[boneIndex],entries,triangleCount:faces.length,amount:-1, inverse:new THREE.Matrix4(),handRoot:new THREE.Matrix4()});
    }
  });
  const ballLocal=new THREE.Vector3();
  const dirty=(attribute,start,count)=>{let lo=start,hi=start+count;for(const range of attribute.updateRanges){lo=Math.min(lo,range.start);hi=Math.max(hi,range.start+range.count);}attribute.clearUpdateRanges();attribute.addUpdateRange(lo,hi-lo);attribute.needsUpdate=true;};
  const apply=(pose)=>{
    const desired=keeperFingerCloseWeight(pose);
    for(const state of states){let amount=0,thumbAmount=0;
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
        // One authored support halfspace encloses all thumb-face endpoints;
        // convexity covers the entire linear morph, including face interiors.
        // It never contributes a limit to the existing four-finger amount.
        thumbAmount=desired*ease((state.thumbSupport-state.thumbPlane.dot(ballLocal)-RADIUS-SKIN_GAP)/.001);
        // Swept endpoint boxes skip provably inactive floor work. The unchanged
        // exact vertex halfspaces handle every uncertain case. Each moved vertex
        // and every triangle interior stay above the existing 5mm target;
        // an already lower source point may never move lower through curl.
        state.handRoot.copy(state.inverse).invert();const e=state.handRoot.elements;
        const fc=state.fingerCenter,fe=state.fingerExtent;
        const fingerFloor=e[1]*fc.x+e[5]*fc.y+e[9]*fc.z+e[13]-Math.abs(e[1])*fe.x-Math.abs(e[5])*fe.y-Math.abs(e[9])*fe.z;
        if(fingerFloor<.0050001)for(const entry of state.entries){const p=entry.handBase,d=entry.handDelta,height=e[1]*p.x+e[5]*p.y+e[9]*p.z+e[13],down=e[1]*d.x+e[5]*d.y+e[9]*d.z;if(down<0)amount=Math.min(amount,Math.max(0,(height-Math.min(.005,height))/-down));}
        const tc=state.thumbCenter,te=state.thumbExtent;
        const thumbFloor=e[1]*tc.x+e[5]*tc.y+e[9]*tc.z+e[13]-Math.abs(e[1])*te.x-Math.abs(e[5])*te.y-Math.abs(e[9])*te.z;
        // A box around both endpoint sets encloses every linear thumb morph.
        // Scan exact vertex halfspaces only when that conservative box cannot
        // prove the existing 5mm floor target for the whole morph.
        if(thumbFloor<.0050001)for(const entry of state.thumbEntries){const p=entry.handBase,d=entry.handDelta,height=e[1]*p.x+e[5]*p.y+e[9]*p.z+e[13],down=e[1]*d.x+e[5]*d.y+e[9]*d.z;if(down<0)thumbAmount=Math.min(thumbAmount,Math.max(0,(height-Math.min(.005,height))/-down));}
      }
      if(amount===state.amount&&thumbAmount===state.thumbAmount)continue;
      if(amount!==state.amount)for(const e of state.entries){v.copy(e.base).addScaledVector(e.delta,amount);state.position.setXYZ(e.i,v.x,v.y,v.z);n.copy(e.normal);if(amount)n.lerp(e.targetNormal,amount).normalize();state.normal.setXYZ(e.i,n.x,n.y,n.z);}
      if(thumbAmount!==state.thumbAmount)for(const e of state.thumbEntries){v.copy(e.base).addScaledVector(e.delta,thumbAmount);state.position.setXYZ(e.i,v.x,v.y,v.z);n.copy(e.normal);if(thumbAmount)n.lerp(e.targetNormal,thumbAmount).normalize();state.normal.setXYZ(e.i,n.x,n.y,n.z);}
      state.thumbAmount=thumbAmount;
      dirty(state.position,state.rangeStart,state.rangeCount);dirty(state.normal,state.rangeStart,state.rangeCount);state.amount=amount;
    }

  };
  apply.diagnostics=()=>states.map(s=>({side:s.bone.name,vertices:s.entries.length,triangles:s.triangleCount,guards:s.guards.length,amount:s.amount,thumbVertices:s.thumbEntries.length,thumbTriangles:s.thumbTriangleCount,thumbPlanes:1,thumbAmount:s.thumbAmount,uploadSpanBytes:s.rangeCount*4*2}));
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

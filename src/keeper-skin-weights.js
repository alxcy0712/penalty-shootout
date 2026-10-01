import * as THREE from 'three';

// The GLB separates kit and skin into material primitives. Smoothing each
// primitive independently tears their shared boundary. Weld bind positions
// first, then smooth one shared topological field and copy it to every primitive.
export function smoothedKeeperWeights(root) {
  const meshes=[];root.traverse(mesh=>{if(mesh.isSkinnedMesh)meshes.push(mesh);});
  const skeleton=meshes[0].skeleton,names=skeleton.bones.map(bone=>bone.name),count=names.length;
  const ids=new Map(),vertices=[],lookup=new WeakMap(),point=new THREE.Vector3();
  for(const mesh of meshes){
    const {position,skinIndex,skinWeight}=mesh.geometry.attributes,map=[];
    for(let v=0;v<position.count;v++){
      point.fromBufferAttribute(position,v).applyMatrix4(mesh.bindMatrix);
      const key=point.toArray().map(value=>Math.round(value*1e6)).join(',');
      let id=ids.get(key);if(id===undefined){id=vertices.length;ids.set(key,id);vertices.push({point:point.clone(),weights:new Float64Array(count),copies:0,neighbors:new Set()});}
      map.push(id);const item=vertices[id];item.copies++;
      for(let k=0;k<4;k++){const name=mesh.skeleton.bones[skinIndex.getComponent(v,k)].name;item.weights[names.indexOf(name)]+=skinWeight.getComponent(v,k);}
    }
    const index=mesh.geometry.index;
    for(let t=0;t<index.count;t+=3){const tri=[map[index.getX(t)],map[index.getX(t+1)],map[index.getX(t+2)]];for(let k=0;k<3;k++){const a=tri[k],b=tri[(k+1)%3];if(a!==b){vertices[a].neighbors.add(b);vertices[b].neighbors.add(a);}}}
    lookup.set(mesh,map);
  }
  const elbows=['L','R'].map(side=>{
    const arm=names.indexOf('upper_arm'+side),forearm=names.indexOf('forearm'+side),upper=skeleton.boneInverses[arm].clone().invert(),lower=skeleton.boneInverses[forearm].clone().invert();
    return {arm,forearm,position:new THREE.Vector3().setFromMatrixPosition(lower),axis:new THREE.Vector3(0,1,0).transformDirection(upper).add(new THREE.Vector3(0,1,0).transformDirection(lower)).normalize()};
  });
  let field=new Float64Array(vertices.length*count);const mask=new Float32Array(vertices.length);
  vertices.forEach((item,v)=>{
    for(let b=0;b<count;b++)field[v*count+b]=item.weights[b]/item.copies;
    const x=Math.abs(item.point.x),y=item.point.y;
    mask[v]=THREE.MathUtils.smoothstep(x,.08,.14)*(1-THREE.MathUtils.smoothstep(x,.27,.36))*THREE.MathUtils.smoothstep(y,1.18,1.25)*(1-THREE.MathUtils.smoothstep(y,1.47,1.53));
    for(const elbow of elbows){
      if(field[v*count+elbow.arm]+field[v*count+elbow.forearm]<.8)continue;
      const along=point.copy(item.point).sub(elbow.position).dot(elbow.axis),strength=.9*(1-THREE.MathUtils.smoothstep(Math.abs(along),.025,.12));
      mask[v]=1-(1-mask[v])*(1-strength);
    }
  });
  for(let iteration=0;iteration<8;iteration++){
    const next=field.slice();
    vertices.forEach((item,v)=>{if(!mask[v]||!item.neighbors.size)return;const mix=.5*mask[v];for(let b=0;b<count;b++){let average=0;for(const neighbor of item.neighbors)average+=field[neighbor*count+b];next[v*count+b]=field[v*count+b]*(1-mix)+average/item.neighbors.size*mix;}});
    field=next;
  }
  return {names,field,count,lookup};
}

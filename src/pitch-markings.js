import * as THREE from 'three';
// Physical-width paint remains perspective-correct instead of collapsing to a
// one-drawing-buffer-pixel GL line. Seven old line draws merge into the existing
// goal-line material; 140 small triangles replace the line segments.
export const PITCH_LINE_WIDTH=.08;
export function pitchMarkingGeometry(){
 const positions=[],uv=[];
 function strip(path){
  const edges=path.slice(1).map((point,i)=>{const dx=point[0]-path[i][0],dz=point[1]-path[i][1],length=Math.hypot(dx,dz);return[-dz/length,dx/length];});
  const sides=path.map((point,i)=>{const a=edges[Math.max(0,i-1)],b=edges[Math.min(i,edges.length-1)],nx=a[0]+b[0],nz=a[1]+b[1],length=Math.hypot(nx,nz),x=nx/length,z=nz/length,scale=PITCH_LINE_WIDTH*.5/(x*b[0]+z*b[1]);return[[point[0]+x*scale,.007,point[1]+z*scale],[point[0]-x*scale,.007,point[1]-z*scale]];});
  for(let i=0;i<sides.length-1;i++)for(const [row,side] of[[i,0],[i+1,0],[i,1],[i,1],[i+1,0],[i+1,1]]){positions.push(...sides[row][side]);uv.push(side,row/(sides.length-1));}
 }
 strip([[-20.16,0],[-20.16,16.5],[20.16,16.5],[20.16,0]]);
 strip([[-9.16,0],[-9.16,5.5],[9.16,5.5],[9.16,0]]);
 strip(Array.from({length:65},(_,i)=>{const t=.68+i/64*(Math.PI-1.36);return[Math.cos(t)*9.15,11+Math.sin(t)*9.15];}));
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.computeVertexNormals();geometry.setIndex(Array.from({length:positions.length/3},(_,i)=>i));return geometry;
}

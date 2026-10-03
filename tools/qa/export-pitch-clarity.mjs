// CPU projection only: does not evaluate rasterizer/MSAA/anisotropic sampling.
import * as THREE from 'three';import {writeFile} from 'node:fs/promises';
import {pitchMarkingGeometry} from '../../src/pitch-markings.js';import {renderPixelRatio} from '../../src/rendering.js';
const width=Number(process.argv[3])||390,height=Number(process.argv[4])||844,dpr=renderPixelRatio(width,height,3),camera=new THREE.PerspectiveCamera(43,width/height,.1,140);camera.position.set(0,4.8,22);camera.lookAt(0,.7,5);camera.updateMatrixWorld(true);
const project=p=>{const v=new THREE.Vector3(...p).project(camera);return[(v.x+1)*width/2,(1-v.y)*height/2];};
const segments=[[-20.16,0,-20.16,16.5],[20.16,0,20.16,16.5],[-20.16,16.5,20.16,16.5],[-9.16,0,-9.16,5.5],[9.16,0,9.16,5.5],[-9.16,5.5,9.16,5.5]].map(([x,z,a,b])=>[project([x,.007,z]),project([a,.007,b])]);
let last;for(let i=0;i<=64;i++){const t=.68+i/64*(Math.PI-1.36),p=project([Math.cos(t)*9.15,.008,11+Math.sin(t)*9.15]);if(last)segments.push([last,p]);last=p;}
const geometry=pitchMarkingGeometry(),attribute=geometry.attributes.position,triangles=[];for(let i=0;i<attribute.count;i+=3)triangles.push([0,1,2].map(k=>project([attribute.getX(i+k),attribute.getY(i+k),attribute.getZ(i+k)])));
const widths=[0,5.5,11,16.5].map(z=>{const a=project([-.04,.007,z]),b=project([.04,.007,z]),c=project([0,.007,z-.04]),d=project([0,.007,z+.04]);return{z,acrossPitchBufferPixels:Math.hypot(a[0]-b[0],a[1]-b[1])*dpr,alongPitchBufferPixels:Math.hypot(c[0]-d[0],c[1]-d[1])*dpr};});
const out=process.argv[2]??'/tmp/pitch-clarity.json';await writeFile(out,JSON.stringify({scope:'CPU camera projection at unchangedDPR; no WebGL/MSAA/AF quality or performance claim',width,height,dpr,segments,triangles,widths},null,2));console.log(out);

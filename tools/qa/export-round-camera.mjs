#!/usr/bin/env node
// Read-only offline QA: actual Stadium.update, actual skin, actual Three camera.
// No WebGL/browser screenshot or render-quality/performance claim is made.
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import * as THREE from 'three';
import {loadCharacter} from './load-review-character.mjs';
import {Shot,keeperPose} from '../../src/engine.js';

const root=fileURLToPath(new URL('../../',import.meta.url));
const out=resolve(process.argv[2]??'/tmp/round-camera-review');
const baseline=process.argv[3]??'d6fcbfc';
const hash=x=>createHash('sha256').update(x).digest('hex');
const current=await readFile(join(root,'src/scene.js'),'utf8');
const before=execFileSync('git',['show',`${baseline}:src/scene.js`],{cwd:root,encoding:'utf8'});
const sources={baseline:before,candidate:current};
const sha256={};
for(const file of [...(await readdir(join(root,'src'))).filter(x=>x.endsWith('.js')).map(x=>'src/'+x),'assets/characters/keeper-prototype.glb','assets/characters/striker-mocap.glb','assets/characters/mocap-variants/cmu-10_03-kick.glb','tools/qa/export-round-camera.mjs','tools/qa/render-round-camera.py'])sha256[file]=hash(await readFile(join(root,file)));
await mkdir(out,{recursive:true});
// Canvas content is excluded from this geometry diagnostic. BuildField still
// executes its real production geometry builder; only its texture is omitted.
globalThis.document={createElement(){return {width:0,height:0,getContext(){return {fillRect(){}};}};}};
async function sourceModule(source){
  const rewritten=source.replace(/from (['"])([^'"]+)\1/g,(_,quote,spec)=>`from ${quote}${spec.startsWith('.')?new URL(spec,new URL('../../src/scene.js',import.meta.url)).href:import.meta.resolve(spec)}${quote}`).replace('function footballGeometry()', 'export function footballGeometry()');
  return import(`data:text/javascript;base64,${Buffer.from(rewritten).toString('base64')}`);
}
const modules={baseline:await sourceModule(before),candidate:await sourceModule(current)};
const stats={accuracy:90,power:90,touch:90,composure:90,speed:85,reach:85,handling:95,number:11};
function completedShot(){const shot=new Shot({x:0,y:.2,power:.5},stats,stats,0,42);while(!shot.result&&shot.t<30)shot.step(1/120);if(!shot.caught)throw Error('Expected real central catch');return shot;}
async function makeStage(module,width,height,mode,turn){
  const keeper=await loadCharacter(true),striker=await loadCharacter(false);
  const object=()=>new THREE.Object3D();
  for(const actor of [keeper,striker]){actor.group=new THREE.Group();actor.group.add(actor.root);actor.fallback={setColor(){}};}
  const arcGeometry=new THREE.BufferGeometry();arcGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(99),3));
  const stage=Object.assign(Object.create(module.Stadium.prototype),{
    mode:'game',viewWidth:width,viewHeight:height,viewKey:null,needsRender:true,netTime:0,
    cameraAngle:turn?Math.PI:0,camera:new THREE.PerspectiveCamera(45,width/height,.1,140),cameraFocus:new THREE.Vector3(),scene:new THREE.Scene(),reducedMotion:{matches:false},keeper,striker,
    ball:new THREE.Mesh(module.footballGeometry(),new THREE.MeshStandardMaterial({vertexColors:true,color:'#ffffff',side:THREE.DoubleSide})),
    ballShadow:Object.assign(object(),{material:{}}),ballShadowState:{},trail:Object.assign(object(),{geometry:new THREE.BufferGeometry()}),trailCount:0,trailBuffer:new Float32Array(21),
    aim:object(),arc:Object.assign(object(),{geometry:arcGeometry}),arcBuffer:new Float32Array(99),rain:object(),
    renderer:{capabilities:{getMaxAnisotropy(){return 1;}},render(scene,camera){scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);stage.draws++;}},draws:0,
    waitingKeeperPose:keeperPose({reach:80,speed:80},0,0,1)
  });
  stage.buildField();stage.scene.traverse(m=>{if(m.isMesh)m.userData.role='field';});stage.buildGoal();
  stage.scene.add(keeper.group,striker.group,stage.ball);
  keeper.root.traverse(m=>{if(m.isMesh)m.userData.role='keeper';});
  striker.root.traverse(m=>{if(m.isMesh)m.userData.role='striker';});
  stage.ball.userData.role='ball';
  stage.scene.traverse(m=>{if((m.isMesh||m.isLineSegments)&&!m.userData.role)m.userData.role=m===stage.net?'net':'goal';});
  stage.match={turn,kicker:0,serial:1,mode,teams:[{color:'#b9efd7',players:[stats]},{color:'#ed9a9a',players:[stats]}]};
  return stage;
}
function geometry(stage){
  const meshes=[],chunks=[];let offset=0;
  stage.scene.updateMatrixWorld(true);
  stage.scene.traverse(m=>{
    if(!(m.isMesh||m.isLineSegments)||!m.visible)return;
    const a=m.geometry.attributes.position;if(!a)return;
    const positions=new Float32Array(a.count*3),point=new THREE.Vector3();
    if(m.isSkinnedMesh)m.skeleton.update();
    for(let i=0;i<a.count;i++){point.fromBufferAttribute(a,i);if(m.isSkinnedMesh)m.applyBoneTransform(i,point);point.applyMatrix4(m.matrixWorld);point.toArray(positions,i*3);}
    const step=m.isLineSegments?2:3,index=m.geometry.index,indices=[];
    for(let i=0;i<(index?.count??a.count);i+=step)indices.push(Array.from({length:step},(_,k)=>index?index.getX(i+k):i+k));
    const color=m.material.color?.toArray()??[.5,.5,.5];
    const vertexColors=m.geometry.attributes.color;
    const colors=vertexColors&&m.material.vertexColors?indices.map(face=>face.reduce((sum,i)=>sum.map((x,k)=>x+vertexColors.array[i*vertexColors.itemSize+k]/step),[0,0,0])):null;
    meshes.push({name:m.name||m.userData.role,role:m.userData.role,offset,count:a.count,primitive:step===2?'lines':'triangles',color,opacity:m.material.opacity??1,colors,indices});
    chunks.push(Buffer.from(positions.buffer));offset+=positions.length;
  });
  return {meshes,bytes:Buffer.concat(chunks)};
}
if(process.argv.includes('--probe')){
  const probes=[];
  for(const [width,height] of [[390,844],[320,700],[320,900],[430,932],[844,390]]){
    const actors=[];
    for(let style=0;style<4;style++){
      const stage=await makeStage(modules.candidate,width,height,'advanced',0);
      stage.match.teams[0].players=[{...stats,number:8+style}];stage.update(1/60,0,null,0,null,stage.match);
      const g=geometry(stage),points={};
      for(const role of ['striker','keeper','ball','goal']){
        points[role]=[];
        for(const m of g.meshes.filter(m=>m.role===role)){
          const p=new Float32Array(g.bytes.buffer,g.bytes.byteOffset+m.offset*4,m.count*3);
          for(let i=0;i<p.length;i+=3)points[role].push(new THREE.Vector3(p[i],p[i+1],p[i+2]));
        }
      }
      actors.push({stage,style,number:8+style,points});
    }
    function measure(actor,radius=17,fov=43){
      const c=actor.stage.camera;c.position.z=5+radius;c.fov=fov;c.lookAt(actor.stage.cameraFocus);c.updateProjectionMatrix();c.updateMatrixWorld(true);
      const bounds={};
      for(const [role,points] of Object.entries(actor.points)){
        const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
        for(const p of points){const q=p.clone().project(c),v=[(q.x+1)*width/2,(1-q.y)*height/2,q.z];for(let k=0;k<3;k++){min[k]=Math.min(min[k],v[k]);max[k]=Math.max(max[k],v[k]);}}
        bounds[role]={min,max,withinCanvas:min[0]>=0&&min[1]>=0&&max[0]<=width&&max[1]<=height&&min[2]>=-1&&max[2]<=1};
      }
      return {style:actor.style,number:actor.number,radius,fov,bounds,allInside:Object.values(bounds).every(b=>b.withinCanvas),allInside12px:Object.values(bounds).every(b=>b.min[0]>=12&&b.min[1]>=12&&b.max[0]<=width-12&&b.max[1]<=height-12)};
    }
    const currentBounds=actors.map(a=>measure(a,a.stage.camera.position.z-5,a.stage.camera.fov));
    function firstSafe(kind,margin){
      for(let i=0;i<=80;i++){
        const radius=kind==='radius'?17+i*.125:17,fov=kind==='fov'?43+i*.25:43,results=actors.map(a=>measure(a,radius,fov));
        if(results.every(r=>margin?r.allInside12px:r.allInside))return {radius,fov,margin,results};
      }
      return null;
    }
    const proposedRadius=Math.min(25,Math.max(17,10.5+4.3*height/(width-24)));
    const alternateRadius=Math.min(25,Math.max(17,7+5.75*height/(width-24)));
    const reserveRadius=Math.min(25,Math.max(17,7.25+5.75*height/(width-24)));
    probes.push({width,height,current:currentBounds,proposedFit:{radius:proposedRadius,results:actors.map(a=>measure(a,proposedRadius))},alternateFit:{radius:alternateRadius,results:actors.map(a=>measure(a,alternateRadius))},reserveFit:{radius:reserveRadius,results:actors.map(a=>measure(a,reserveRadius))},radiusZeroMargin:firstSafe('radius',0),radius12px:firstSafe('radius',12),fovZeroMargin:firstSafe('fov',0),fov12px:firstSafe('fov',12)});
  }
  await writeFile(join(out,'framing-probes.json'),JSON.stringify({note:'Hypothetical static attack-camera adjustments only; production runtime was not modified. Bounds use all real CPU-skinned vertices plus real goal meshes.',candidateSceneSha256:hash(current),probes},null,2));
  console.log(JSON.stringify(probes.map(p=>({...p,current:p.current.map(r=>({style:r.style,number:r.number,bounds:r.bounds})),radiusZeroMargin:p.radiusZeroMargin&&{radius:p.radiusZeroMargin.radius,fov:p.radiusZeroMargin.fov},radius12px:p.radius12px&&{radius:p.radius12px.radius,fov:p.radius12px.fov},fovZeroMargin:p.fovZeroMargin&&{radius:p.fovZeroMargin.radius,fov:p.fovZeroMargin.fov},fov12px:p.fov12px&&{radius:p.fov12px.radius,fov:p.fov12px.fov}})),null,2));process.exit(0);
}
const frames=[],geometries={},blobs=new Map();
async function snapshot(stage,{version,mode,width,height,direction,time,index,phase}){
  const g=geometry(stage),id=hash(Buffer.concat([g.bytes,Buffer.from(JSON.stringify(g.meshes))])).slice(0,16);
  if(!blobs.has(id)){blobs.set(id,true);await writeFile(join(out,`geometry-${id}.bin`),g.bytes);geometries[id]={file:`geometry-${id}.bin`,meshes:g.meshes};}
  const c=stage.camera,viewProjection=new THREE.Matrix4().multiplyMatrices(c.projectionMatrix,c.matrixWorldInverse);
  const project=p=>{const q=new THREE.Vector3(...p).project(c);return[(q.x+1)*width/2,(1-q.y)*height/2,q.z];};
  const bounds={};
  for(const role of ['striker','keeper','ball','goal']){
    const points=[];for(const m of g.meshes.filter(m=>m.role===role)){const p=new Float32Array(g.bytes.buffer,g.bytes.byteOffset+m.offset*4,m.count*3);for(let i=0;i<p.length;i+=3)points.push(project([p[i],p[i+1],p[i+2]]));}
    bounds[role]={min:[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),max:[0,1,2].map(k=>Math.max(...points.map(p=>p[k])))};
    bounds[role].withinCanvas=bounds[role].min[0]>=0&&bounds[role].min[1]>=0&&bounds[role].max[0]<=width&&bounds[role].max[1]<=height&&bounds[role].min[2]>=-1&&bounds[role].max[2]<=1;
  }
  frames.push({version,mode,width,height,direction,time,index,phase,style:stage.match.teams[stage.match.turn].players[stage.match.kicker].number%4,geometry:id,camera:{position:c.position.toArray(),target:stage.cameraFocus.toArray(),angle:stage.cameraAngle,fov:c.fov,projection:c.projectionMatrix.toArray(),worldInverse:c.matrixWorldInverse.toArray(),viewProjection:viewProjection.toArray()},ball:stage.ball.position.toArray(),screenBounds:bounds,goalCorners:[[-3.72,0,.06],[3.72,0,.06],[-3.72,2.5,.06],[3.72,2.5,.06]].map(project),state:{currentShot:!!stage.currentShot,currentResult:!!stage.currentResult,resultElapsed:stage.resultElapsed,trailCount:stage.trailCount,trailVisible:stage.trail.visible}});
}
const paused=[],cameraWork=[];
for(const version of ['baseline','candidate'])for(const mode of ['advanced','classic'])for(const [width,height] of [[390,844],[844,390]])for(const turn of [0,1]){
  const direction=turn?'defend-to-attack':'attack-to-defend';
  const stage=await makeStage(modules[version],width,height,mode,turn),shot=completedShot();
  stage.update(1/60,0,shot,0,null,stage.match);
  for(let i=0;i<120;i++)stage.update(1/60,(i+1)/60,shot,0,null,stage.match);
  await snapshot(stage,{version,mode,width,height,direction,time:-1/60,index:-1,phase:'previous-result'});
  let projectionUpdates=0,distance=0,firstDrawDisplacement=0;const previousPosition=stage.camera.position.clone();
  const updateProjection=stage.camera.updateProjectionMatrix.bind(stage.camera);
  stage.camera.updateProjectionMatrix=()=>{projectionUpdates++;return updateProjection();};
  stage.match.turn=1-turn;stage.match.serial++;
  for(let i=0;i<=78;i++){
    stage.update(1/60,2+(i+1)/60,null,0,null,stage.match);
    const stepDistance=stage.camera.position.distanceTo(previousPosition);distance+=stepDistance;if(i===0)firstDrawDisplacement=stepDistance;previousPosition.copy(stage.camera.position);
    if([0,12,36,78].includes(i))await snapshot(stage,{version,mode,width,height,direction,time:i/60,index:[0,12,36,78].indexOf(i),phase:'next-ready'});
  }
  cameraWork.push({version,mode,width,height,direction,draws:79,projectionUpdates,firstDrawDisplacementMeters:firstDrawDisplacement,afterFirstDrawDistanceMeters:distance-firstDrawDisplacement,totalDistanceMeters:distance,definition:'First draw is measured from previous role endpoint; subsequent travel excludes that first move and spans the following1.3s. Candidate first displacement is an intentional hard cut, not animated travel.'});
  const beforeDraw=stage.draws;stage.match.turn=turn;stage.match.serial++;stage.update(0,4,null,0,null,stage.match);
  paused.push({version,mode,width,height,direction,drawOccurred:stage.draws>beforeDraw,cameraAngle:stage.cameraAngle,expectedAngle:turn?Math.PI:0});
}
for(const [file,value] of Object.entries(sha256))if(hash(await readFile(join(root,file)))!==value)throw Error('Source changed while exporting: '+file);
const note='CPU projection diagnostic of production CPU-skinned mesh, actual Stadium.update camera, football geometry, goal and pitch geometry. Simplified solid materials; omits textures, lighting, shadows, crowd, UI and WebGL. This does not establish actual GPU rendering, browser behavior or performance.';
const data={format:'penalty-round-camera-v1',note,baseline,candidateSceneSha256:hash(current),baselineSceneSha256:hash(before),sha256,sampling:{hz:60,firstDrawSeconds:1/60,laterTimesAreRelativeToFirstDraw:true,relativeSeconds:[0,.2,.6,1.3]},geometries,frames,paused,cameraWork};
await writeFile(join(out,'comparison.json'),JSON.stringify(data));
let framingProbeResults;
try{
  const probe=JSON.parse(await readFile(join(out,'framing-probes.json'),'utf8'));
  if(probe.candidateSceneSha256===hash(current))framingProbeResults=probe.probes.map(p=>({width:p.width,height:p.height,productionRadius:p.current[0].radius,productionFov:p.current[0].fov,allStylesInside12px:p.current.every(r=>r.allInside12px),minimumEdgeMarginPixels:Math.min(...p.current.flatMap(r=>Object.values(r.bounds).flatMap(b=>[b.min[0],b.min[1],p.width-b.max[0],p.height-b.max[1]]))),styles:p.current.map(r=>({style:r.style,number:r.number,bounds:r.bounds}))}));
}catch{}
const manifest={...data,geometries:undefined,frames:frames.map(({camera,...f})=>({...f,camera:{position:camera.position,target:camera.target,angle:camera.angle,fov:camera.fov}})),artifactsRoot:out,framingProbeResults};
await mkdir(join(root,'validation/round-camera'),{recursive:true});
await writeFile(join(root,'validation/round-camera/manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({out,frameCount:frames.length,geometryCount:blobs.size,candidateSceneSha256:hash(current),paused}));

import {ballContactShadow,drawContactShadow} from './contact-shadow.js';
import {homeAnimation} from './home-animation.js';
import {GoalBall} from './ball-motion.js';
import {GoalNetMotion} from './net-motion.js';
import {batchRigidGroup} from './batching.js';
import {GameCharacter} from './game-character.js';
import {keeperGather} from './keeper-contact.js';
import {renderPixelRatio,configurePitchFiltering,resizeDrawingBuffer,advancedAttackRadius} from './rendering.js';
import {pitchMarkingGeometry} from './pitch-markings.js';
import {strikerRunupPose,penaltyStyle,holdingPose,HOLD_DURATION,blendKeeperPose,keeperWarmupPose,keeperRunupPreparation} from './anatomy.js';
import * as THREE from 'three';
import {keeperPose, clamp, GOAL} from './engine.js';

const vec = p => new THREE.Vector3(p.x,p.y,p.z);
const material = (color, roughness=.8) => new THREE.MeshStandardMaterial({color,roughness});
const unitSphere = new THREE.SphereGeometry(1,12,8);
const unitBone = new THREE.CylinderGeometry(1,1,1,10);
function mesh(geo,mat,parent,x=0,y=0,z=0) {
  const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
}
function lineBetween(parent,a,b,mat,r=.035) {
  const m=mesh(unitBone,mat,parent);const p=vec(a),q=vec(b);m.position.copy(p).add(q).multiplyScalar(.5);m.scale.set(r,p.distanceTo(q),r);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),q.sub(p).normalize());return m;
}
function texture(draw,w=256,h=w) {
  const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}
function footballGeometry() {
  const ico=new THREE.IcosahedronGeometry(1,0).getAttribute('position'),vertices=[],faces=[];
  for(let i=0;i<ico.count;i+=3){const face=[];for(let j=0;j<3;j++){const p=new THREE.Vector3().fromBufferAttribute(ico,i+j);let id=vertices.findIndex(q=>q.distanceTo(p)<.001);if(id<0){id=vertices.length;vertices.push(p);}face.push(id);}faces.push(face);}
  const edge=(a,b)=>vertices[a].clone().multiplyScalar(2).add(vertices[b]).normalize().multiplyScalar(.11);
  const positions=[],colors=[];
  function panel(points,black){const center=points.reduce((s,p)=>s.add(p),new THREE.Vector3()).normalize().multiplyScalar(.111);for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];for(const p of[center,a,b]){positions.push(p.x,p.y,p.z);colors.push(...(black?[.035,.055,.06]:[.91,.94,.88]));}}}
  for(const [a,b,c]of faces)panel([edge(a,b),edge(b,a),edge(b,c),edge(c,b),edge(c,a),edge(a,c)],false);
  for(let a=0;a<vertices.length;a++){const adjacent=new Set();for(const f of faces)if(f.includes(a))for(const id of f)if(id!==a)adjacent.add(id);const n=vertices[a].clone().normalize(),u=new THREE.Vector3(0,1,0).cross(n).normalize();if(u.length()<.1)u.set(1,0,0);const w=n.clone().cross(u);const points=[...adjacent].map(b=>edge(a,b));points.sort((p,q)=>Math.atan2(p.dot(w),p.dot(u))-Math.atan2(q.dot(w),q.dot(u)));panel(points,true);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeVertexNormals();return g;
}
export class Stadium {
  constructor(container) {
    this.container=container;this.needsRender=true;this.reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#0a1b20');this.scene.fog=new THREE.FogExp2('#0a1b20',.019);
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.12;
    container.appendChild(this.renderer.domElement);this.camera=new THREE.PerspectiveCamera(45,1,.1,140);
    this.scene.add(new THREE.HemisphereLight('#b8d9e6','#174533',2.1));
    const sun=new THREE.DirectionalLight('#e9eee1',3);sun.position.set(-8,16,12);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-16,right:16,top:20,bottom:-10,near:1,far:50});sun.shadow.bias=-.0007;this.scene.add(sun);
    const rim=new THREE.DirectionalLight('#87c2dc',1.7);rim.position.set(8,8,-9);this.scene.add(rim);
    this.buildField();this.buildGoal();this.buildStands();
    const architecture=new THREE.Group();for(const object of [...this.scene.children])if(object.isMesh&&!object.isInstancedMesh)architecture.add(object);this.scene.add(architecture);batchRigidGroup(architecture);
    this.waitingKeeperPose=keeperPose({reach:80,speed:80},0,0,1);this.keeper=new GameCharacter(this.scene,'#f1c75b',true);this.striker=new GameCharacter(this.scene,'#b9efd7');
    Promise.all([this.striker.ready,this.keeper.ready]).then(()=>{this.needsRender=true;});
    this.ball=mesh(footballGeometry(),new THREE.MeshStandardMaterial({vertexColors:true,roughness:.65,side:THREE.DoubleSide}),this.scene,0,.11,11);
    this.aim=new THREE.Group();const aimMaterial=new THREE.MeshBasicMaterial({color:'#b9efd7',transparent:true,opacity:.8,depthTest:false});
    this.aim.add(new THREE.Mesh(new THREE.RingGeometry(.15,.18,40),aimMaterial));
    for(const [w,h]of[[.48,.025],[.025,.48]])this.aim.add(new THREE.Mesh(new THREE.PlaneGeometry(w,h),aimMaterial));this.aim.position.set(0,1,.35);this.scene.add(this.aim);
    this.arcBuffer=new Float32Array(33*3);const arcGeometry=new THREE.BufferGeometry();arcGeometry.setAttribute('position',new THREE.BufferAttribute(this.arcBuffer,3).setUsage(THREE.DynamicDrawUsage));this.arc=new THREE.Line(arcGeometry,new THREE.LineBasicMaterial({color:'#b9efd7',transparent:true,opacity:.65}));this.arc.frustumCulled=false;this.scene.add(this.arc);
    this.cameraAngle=0;this.cameraFocus=new THREE.Vector3(0,.6,5);
    this.ballShadow=mesh(new THREE.CircleGeometry(.18,24),new THREE.MeshBasicMaterial({map:texture(drawContactShadow,64),transparent:true,opacity:.27,depthWrite:false}),this.scene);this.ballShadowState={};this.ballShadow.castShadow=false;this.ballShadow.receiveShadow=false;this.ballShadow.rotation.x=-Math.PI/2;
    this.trailBuffer=new Float32Array(21);const trailGeometry=new THREE.BufferGeometry();trailGeometry.setAttribute('position',new THREE.BufferAttribute(this.trailBuffer,3).setUsage(THREE.DynamicDrawUsage));trailGeometry.setDrawRange(0,0);
    this.trail=new THREE.Line(trailGeometry,new THREE.LineBasicMaterial({color:'#d3efe4',transparent:true,opacity:.4}));this.scene.add(this.trail);this.trail.frustumCulled=false;this.trailCount=0;
    const geometrySet=new Set();this.scene.traverse(object=>{if(object.geometry)geometrySet.add(object.geometry.uuid);});this.geometryCount=geometrySet.size;
    if(new URLSearchParams(location.search).has('profile')){
      this.renderer.info.autoReset=false;this.profileAntialias=this.renderer.getContextAttributes?.()?.antialias??null;
      this.profile=document.createElement('output');this.profile.id='render-profile';this.profile.style.cssText='position:fixed;bottom:8px;left:8px;z-index:10000;pointer-events:none;padding:10px;background:#071713;color:#d9ffe6;font:12px monospace;white-space:pre';document.body.appendChild(this.profile);this.profileFrames=[];this.profileCosts=[];this.profileUpdated=0;
    }
    this.mode='hero';this.netTime=0;this.onNetImpact=impact=>this.netMotion.impact(impact,this.goalNetStartedAt+impact.time);this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);window.addEventListener?.('resize',()=>this.resize());this.resize();
  }
  buildField() {
    const pitch=texture((c,w,h)=>{c.fillStyle='#255349';c.fillRect(0,0,w,h);for(let j=0;j<12;j++){c.fillStyle=j%2?'#2a5b4e':'#245247';c.fillRect(0,j*h/12,w,h/12);}let seed=4;for(let i=0;i<20000;i++){seed=(seed*16807)%2147483647;const x=seed%w;seed=(seed*16807)%2147483647;const y=seed%h;c.fillStyle=i%2?'#ffffff08':'#00000009';c.fillRect(x,y,1,2);}},1024);
    pitch.wrapS=pitch.wrapT=THREE.RepeatWrapping;configurePitchFiltering(pitch,this.renderer);
    const plane=mesh(new THREE.PlaneGeometry(68,123),new THREE.MeshStandardMaterial({map:pitch,roughness:.96}),this.scene,0,-.014,43.5);plane.rotation.x=-Math.PI/2;plane.castShadow=false;
    const white=new THREE.MeshBasicMaterial({color:'#9bbab0',transparent:true,opacity:.72});
    const goalLine=mesh(new THREE.PlaneGeometry(68,GOAL.postRadius*2),white,this.scene,0,.007,GOAL.postRadius);goalLine.rotation.x=-Math.PI/2;goalLine.castShadow=false;
    mesh(pitchMarkingGeometry(),white,this.scene).castShadow=false;
    const spot=mesh(new THREE.CircleGeometry(.10,24),material('#c1d6cc'),this.scene,0,.009,11);spot.rotation.x=-Math.PI/2;spot.castShadow=false;

  }
  buildGoal() {
    const postX=GOAL.half+GOAL.postRadius,barY=GOAL.height+GOAL.postRadius;
    const mat=material('#d6e2dc',.48),plinth=material('#738f81');
    for(const x of[-postX,postX])lineBetween(this.scene,{x,y:0,z:GOAL.postRadius},{x,y:barY,z:GOAL.postRadius},mat,.06);
    lineBetween(this.scene,{x:-postX,y:barY,z:GOAL.postRadius},{x:postX,y:barY,z:GOAL.postRadius},mat,.06);
    for(const x of[-postX,postX]){lineBetween(this.scene,{x,y:barY,z:GOAL.postRadius},{x,y:2.1,z:-1.7},mat,.025);lineBetween(this.scene,{x,y:0,z:GOAL.postRadius},{x,y:0,z:-2},mat,.025);}
    for(const x of[-postX,postX]){lineBetween(this.scene,{x,y:0,z:-2},{x,y:2.1,z:-1.7},mat,.022);mesh(new THREE.BoxGeometry(.15,.045,.3),plinth,this.scene,x,.018,-2);}
    lineBetween(this.scene,{x:-postX,y:2.1,z:-1.7},{x:postX,y:2.1,z:-1.7},mat,.025);
    const points=[];const add=(a,b)=>points.push(...a,...b);
    for(let x=-postX;x<=postX+.01;x+=.245){add([x,0,-2],[x,2.1,-1.7]);add([x,2.1,-1.7],[x,barY,GOAL.postRadius]);}
    for(let y=0;y<=2.11;y+=.175)add([-postX,y,-2+y/2.1*.3],[postX,y,-2+y/2.1*.3]);
    for(const x of[-postX,postX]){for(let z=-2;z<=0;z+=.22)add([x,0,z],[x,barY+z*.17,z]);for(let y=.17;y<2.3;y+=.17)add([x,y,0],[x,Math.min(y,2.1),-1.7]);}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(points,3));this.net=new THREE.LineSegments(geo,new THREE.LineBasicMaterial({color:'#c0d2cc',transparent:true,opacity:.32}));this.scene.add(this.net);this.netOriginal=new Float32Array(points);this.netMotion=new GoalNetMotion(this.netOriginal,{half:postX});
  }
  buildStands() {
    const seats=material('#193039'), rail=material('#243b40'),lampHousing=material('#2e474a'),lampFace=new THREE.MeshBasicMaterial({color:'#daeee7'});
    for(let row=0;row<5;row++)mesh(new THREE.BoxGeometry(66,.8,1.25),row%2?seats:rail,this.scene,0,.5+row*.7,-7-row*1.2);
    const seatsGeo=new THREE.BoxGeometry(.23,.34,.25);const crowd=new THREE.InstancedMesh(seatsGeo,material('#3a545b'),440);const dummy=new THREE.Object3D();
    for(let i=0;i<440;i++){dummy.position.set((i%88-44)*.61,.99+Math.floor(i/88)*.7,-7-Math.floor(i/88)*1.2);dummy.updateMatrix();crowd.setMatrixAt(i,dummy.matrix);crowd.setColorAt(i,new THREE.Color(['#557b7b','#79958d','#a98c77','#244650'][i*13%4]));}this.scene.add(crowd);
    const heads=new THREE.InstancedMesh(new THREE.SphereGeometry(.1,6,5),material('#887c6a'),440);for(let i=0;i<440;i++){dummy.position.set((i%88-44)*.61,1.25+Math.floor(i/88)*.7,-7-Math.floor(i/88)*1.2);dummy.updateMatrix();heads.setMatrixAt(i,dummy.matrix);}this.scene.add(heads);
    const board=mesh(new THREE.BoxGeometry(54,.65,.15),material('#162c30'),this.scene,0,.35,-4);
    const stripe=material('#a0d7c3');for(let x=-24;x<25;x+=8)mesh(new THREE.BoxGeometry(3,.04,.02),stripe,this.scene,x,.6,board.position.z+.1);
    const glowTexture=texture((c,w,h)=>{const g=c.createRadialGradient(w/2,h/2,0,w/2,h/2,w/2);g.addColorStop(0,'#eaffee90');g.addColorStop(.2,'#daffee25');g.addColorStop(1,'#ffffff00');c.fillStyle=g;c.fillRect(0,0,w,h);});
    for(const x of[-13,13]) {
      lineBetween(this.scene,{x,y:0,z:-6},{x,y:13,z:-6},rail,.09);
      const panel=mesh(new THREE.BoxGeometry(2.2,.65,.25),lampHousing,this.scene,x,13,-6);
      for(let i=0;i<6;i++)mesh(new THREE.BoxGeometry(.22,.22,.05),lampFace,this.scene,x-.8+i*.32,13,-5.84).castShadow=false;
      const s=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTexture,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));s.position.set(x,13,-5.7);s.scale.set(5,5,1);this.scene.add(s);
    }
    const vertices=[];for(let i=0;i<140;i++){const x=Math.sin(i*72.3)*23,z=Math.cos(i*53.1)*20,y=(i*1.39)%15;vertices.push(x,y,z,x-.05,y-.3,z+.03);}const rainGeo=new THREE.BufferGeometry();rainGeo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));this.rain=new THREE.LineSegments(rainGeo,new THREE.LineBasicMaterial({color:'#b9d7d4',transparent:true,opacity:.12}));this.scene.add(this.rain);
  }
  resize() {
    const {width,height}=this.container.getBoundingClientRect();if(!width||!height)return;
    this.viewWidth=width;this.viewHeight=height;this.needsRender=true;this.currentPixelRatio=renderPixelRatio(width,height,window.devicePixelRatio);resizeDrawingBuffer(this.renderer,width,height,this.currentPixelRatio);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();
  }
  setMode(mode) {if(this.mode!==mode){this.resetPresentation();this.needsRender=true;if(mode==='hero'){this.homeTime=0;this.presentedMatch=null;}}this.mode=mode;}
  resetPresentation(){this.currentShot=null;this.currentResult=null;this.resultElapsed=0;this.aftermath=null;this.trailCount=0;this.resetNet();}
  resetNet(){if(this.netMotion.reset(this.net.geometry.attributes.position.array))this.net.geometry.attributes.position.needsUpdate=true;}
  update(dt,time,shot=null,runup=0,aim=null,match=null,kickAim=null,alpha=1) {
    const cpuStart=this.profile?performance.now():0,hero=this.mode==='hero';
    // Next replaces the participants immediately. Treat that as a broadcast
    // cut, not a continuous orbit around actors that have already reset.
    // Observe identity before the paused-frame shortcut: Next then Pause may
    // happen between animation frames, but the new ready view must still draw.
    if(!hero&&match&&(this.presentedMatch!==match||this.presentedSerial!==match.serial||this.presentedTurn!==match.turn)){
      this.presentedMatch=match;this.presentedSerial=match.serial;this.presentedTurn=match.turn;
      this.resetPresentation();this.colorsKey=null;this.needsRender=true;
    }
    if(hero)this.presentedMatch=null;
    if(dt===0&&!this.needsRender){this.profileLast=null;return;}
    this.netTime+=Math.max(0,dt);
    const w=this.viewWidth,h=this.viewHeight,viewKey=`${this.mode}:${match?.mode}:${w}:${h}`;
    if(this.viewKey!==viewKey){
      this.viewKey=viewKey;this.camera.fov=hero?45:match?.mode==='advanced'?43:36;
      this.camera.setViewOffset(w,h,0,hero?0:Math.max(0,(710-h)*.28),w,h);
      this.camera.updateProjectionMatrix();
    }
    this.cameraAngle=match?.turn===1?Math.PI:0;
    if(hero)this.homeTime=(this.homeTime??0)+dt;
    const home=hero?homeAnimation(this.reducedMotion.matches?0:this.homeTime):null;
    if(home){this.camera.position.copy(home.camera);this.camera.lookAt(home.target.x,home.target.y,home.target.z);}
    else {
      const defending=match?.turn===1?1:0;
      const advanced=match?.mode==='advanced',attackRadius=advanced?advancedAttackRadius(w,h):25,radius=attackRadius+(10.8-attackRadius)*defending,attackHeight=advanced?4.8:6,attackFocus=advanced?5:6;
      const fov=(match?.mode==='advanced'?43:36)*(1-defending)+74*defending;if(Math.abs(this.camera.fov-fov)>.01){this.camera.fov=fov;this.camera.updateProjectionMatrix();}
      this.camera.position.set(0,attackHeight+(7.5-attackHeight)*defending,5+(defending?-radius:radius));
      this.cameraFocus.set(0,.7,attackFocus+(2.5-attackFocus)*defending);this.camera.lookAt(this.cameraFocus);
    }
    if(match?.kicker!==undefined && this.colorsKey!==`${match.turn}-${match.kicker}`){this.colorsKey=`${match.turn}-${match.kicker}`;this.striker.setColor(match.teams[match.turn].color,match.teams[match.turn].players[match.kicker].number);this.keeper.setColor(match.turn?'#83b8f4':'#f1c75b',1);}
    const style=penaltyStyle(match?.teams[match.turn]?.players[match.kicker]);
    this.striker.group.visible=!home||home.strikerVisible;this.ball.visible=!home||home.ballVisible;
    let strikerPose=home?home.striker:!shot?strikerRunupPose(time,runup,-1,kickAim?.power??.7,kickAim?.x??0,style,kickAim?.chip?'chip':kickAim?.low?'low':'normal'):null;
    let kickAfter=null;
    if(shot){
      if(this.currentShot!==shot){this.resetNet();this.currentShot=shot;this.currentResult=null;this.resultElapsed=0;this.trailCount=0;this.aftermath=null;}
      // Physics already advanced to contact on the first result frame. Start
      // here exactly; adding this frame again skips the capture/gather seam.
      if(shot.result){if(this.currentResult===shot.result)this.resultElapsed+=dt;else this.currentResult=shot.result;}
      const currentTime=shot.animationTime??shot.t;
      const animationTime=shot.result?currentTime:(shot.previousAnimationTime??currentTime)+(currentTime-(shot.previousAnimationTime??currentTime))*alpha;
      kickAfter=animationTime+(shot.result?this.resultElapsed:0);
      let pose=shot.result||currentTime<shot.t-.001?shot.poseAt(animationTime+this.resultElapsed):shot.previousPose?blendKeeperPose(shot.previousPose,shot.pose,alpha,false):shot.pose;
      let held=null;if(shot.caught){held=keeperGather(shot.pose,pose,shot.ball,shot.contactPart,this.resultElapsed/HOLD_DURATION);pose=held.pose;}
      this.keeper.pose(pose);this.ball.position.copy(shot.ball);
      if(!shot.result)this.ball.position.set(shot.previous.x+(shot.ball.x-shot.previous.x)*alpha,shot.previous.y+(shot.ball.y-shot.previous.y)*alpha,shot.previous.z+(shot.ball.z-shot.previous.z)*alpha);
      if(shot.result?.goal){
        if(!this.aftermath){this.aftermath=new GoalBall(shot.ball,shot.velocity);this.goalNetStartedAt=this.netTime-dt;}this.aftermath.advance(dt,this.onNetImpact);this.ball.position.set(this.aftermath.position.x,this.aftermath.position.y,this.aftermath.position.z);
      }
      if(held)this.ball.position.copy(held.ball);
      if(this.aftermath&&!this.aftermath.sleeping){this.ball.rotation.x+=dt*this.aftermath.velocity.z/.11;this.ball.rotation.z-=dt*this.aftermath.velocity.x/.11;}else if(!shot.result){this.ball.rotation.x-=dt*shot.launchSpeed*2;this.ball.rotation.z+=dt*shot.velocity.x;}
      if(!shot.result){if(this.trailCount===7)this.trailBuffer.copyWithin(0,3);else this.trailCount++;this.ball.position.toArray(this.trailBuffer,(this.trailCount-1)*3);this.trail.geometry.attributes.position.needsUpdate=true;this.trail.geometry.setDrawRange(0,this.trailCount);}
      strikerPose=strikerRunupPose(time,1,animationTime+(shot.result?this.resultElapsed:0),shot.aim.power,shot.aim.x,style,shot.aim.chip?'chip':shot.aim.low?'low':'normal');
    }else{this.keeper.pose(home?keeperWarmupPose(home.warmupTime):runup>0?keeperRunupPreparation(match?.teams[1-match.turn]?.players[0]??{reach:80,speed:80},runup,(match?.kicker??0)%2?1:-1):this.waitingKeeperPose);this.ball.position.copy(home?home.ball:{x:0,y:.11,z:11});if(home)this.ball.rotation.x-=dt*12;this.trail.visible=false;}
    if(home)this.striker.pose(strikerPose);
    else {const aim=shot?.aim??kickAim??{};this.striker.kick(runup,kickAfter,{pose:strikerPose,power:aim.power??.7,targetX:aim.x??0,shotType:aim.chip?'chip':aim.low?'low':'normal',style});}
    // Keep the authored head pose, as in motion-lab.html.
    this.trail.visible=!!shot&&!shot.result;this.aim.visible=!!aim&&match?.mode!=='advanced';
    this.arc.visible=!!aim&&match?.mode==='advanced';
    if(this.arc.visible){
      const power=aim.power??.5,player=match.teams[match.turn].players[match.kicker],speed=aim.chip?8+7*power*(.65+.35*player.power/99):4.8+27.2*power*(.65+.35*player.power/99),flight=11/speed,lift=aim.chip?1:clamp((power-.22)/.20,0,1),vy=aim.low?0:aim.chip?2.5+4.5*power:clamp(((aim.y??1.2)-.11+4.905*flight*flight)/flight,0,9)*lift,spin=aim.low||aim.chip?0:(aim.curve??0)*(player.curve??76)/99*9*power*lift;
      for(let i=0;i<=32;i++){const q=i/32*.78,t=q*flight;this.arcBuffer[i*3]=aim.x*q+spin*.5*t*(t-flight);this.arcBuffer[i*3+1]=Math.max(.12,.11+vy*t-4.905*t*t);this.arcBuffer[i*3+2]=11*(1-q);}
      this.arc.geometry.attributes.position.needsUpdate=true;
    }
    if(aim)this.aim.position.set(clamp(aim.x,-4.2,4.2),clamp(aim.y??1.2,.2,2.8),.42);
    this.ballShadow.visible=this.ball.visible;
    const shadow=ballContactShadow(this.ball.position.y,.11,this.ballShadowState);this.ballShadow.position.set(this.ball.position.x,.018,this.ball.position.z);this.ballShadow.scale.setScalar(shadow.scale);this.ballShadow.material.opacity=shadow.opacity;
    const netPositions=this.net.geometry.attributes.position;
    if(this.netMotion.update(netPositions.array,this.netTime))netPositions.needsUpdate=true;
    const reduced=this.reducedMotion.matches;this.rain.visible=!reduced;if(!reduced)this.rain.position.y=-(time*.8%3);
    // Include the existing shadow pass in profile counters, not only the main pass.
    if(this.profile)this.renderer.info.reset();this.renderer.render(this.scene,this.camera);this.needsRender=false;
    if(this.profile){
      const stamp=performance.now(),interval=stamp-(this.profileLast??stamp);this.profileLast=stamp;
      if(interval>0&&interval<250){this.profileFrames.push(interval);this.profileCosts.push(stamp-cpuStart);}
      if(stamp-this.profileUpdated>1000&&this.profileFrames.length){const mean=this.profileFrames.reduce((a,b)=>a+b,0)/this.profileFrames.length,cost=this.profileCosts.reduce((a,b)=>a+b,0)/this.profileCosts.length;this.profileFrames.sort((a,b)=>a-b);const p95=this.profileFrames[Math.ceil(this.profileFrames.length*.95)-1];this.profile.textContent=`${hero?`首页镜头 ${(this.homeTime%20).toFixed(1)} s\n`:''}画布 ${this.renderer.domElement.width}×${this.renderer.domElement.height} · DPR ${this.currentPixelRatio.toFixed(2)} · MSAA ${this.profileAntialias===null?'未知':this.profileAntialias?'开启':'未启用'}\nFPS ${(1000/mean).toFixed(1)} · CPU 提交 ${cost.toFixed(2)} ms\n帧耗时 均值 ${mean.toFixed(2)} / P95 ${p95.toFixed(2)} ms\n绘制含阴影 ${this.renderer.info.render.calls} · 三角形 ${this.renderer.info.render.triangles}\n几何体 ${this.renderer.info.memory.geometries}/${this.geometryCount} · 纹理 ${this.renderer.info.memory.textures}`;this.profileFrames.length=0;this.profileCosts.length=0;this.profileUpdated=stamp;}
    }
  }
}

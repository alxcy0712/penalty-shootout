// Read the actual goal builder without creating a renderer. Offline numerical
// snapshots are not WebGL captures; no source geometry is duplicated here.
import * as THREE from 'three';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {GOAL} from '../../src/engine.js';
import {GoalNetMotion} from '../../src/net-motion.js';
const source=await readFile(new URL('../../src/scene.js',import.meta.url),'utf8');
const start=source.indexOf('  buildGoal() {'),end=source.indexOf('  buildStands() {',start);
if(start<0||end<0)throw new Error('Goal builder extraction failed');
const body=source.slice(start,end).replace('  buildGoal() {','').trim().slice(0,-1);
const actor={scene:new THREE.Scene()};
new Function('THREE','GOAL','GoalNetMotion','material','mesh','lineBetween',body).call(actor,THREE,GOAL,GoalNetMotion,()=>({}),()=>({}),()=>{});
const rest=actor.netOriginal,cases={};
for(const [name,p,n] of [['back',[0,1.2,-1.78],[0,0,-1]],['left',[-3.61,1.2,-1],[ -1,0,0]],['right',[3.61,1.2,-1],[1,0,0]],['roof',[0,2.14,-1],[0,1,-.4/1.76]]]){
 const length=Math.hypot(...n),impact={surface:name,position:Object.fromEntries(['x','y','z'].map((k,i)=>[k,p[i]])),normal:Object.fromEntries(['x','y','z'].map((k,i)=>[k,n[i]/length])),speed:22,time:0};
 const motion=new GoalNetMotion(rest),out=new Float32Array(rest);motion.impact(impact);const snapshots={},peak={meters:0,time:0,vertex:0};
 for(let frame=0;frame<=198;frame++){const t=frame/120;motion.update(out,t);for(let i=0;i<rest.length;i+=3){const distance=Math.hypot(out[i]-rest[i],out[i+1]-rest[i+1],out[i+2]-rest[i+2]);if(distance>peak.meters)Object.assign(peak,{meters:distance,time:t,vertex:i/3});}}
 for(const t of[0,.15,.35,1.65]){motion.update(out,t);snapshots[t]=Array.from(out);}
 cases[name]={impact,peak,snapshots};
}
const report={description:'Actual scene.js line coordinates and analytic runtime net response. Numerical/offline evidence, not a WebGL capture.',sceneSha256:createHash('sha256').update(source).digest('hex'),vertices:rest.length/3,rest:Array.from(rest),cases};
const out=process.argv[2]??'/tmp/goal-net-response-snapshots.json';await writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(out);

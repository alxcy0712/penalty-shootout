// Reproducible CPU comparison, including pose construction and real Shot work.
// Usage: node tools/qa/benchmark-keeper-torso.mjs [output-directory] [baseline-ref]
import {performance} from 'node:perf_hooks';
import {readFile,writeFile,mkdir,mkdtemp,symlink,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Shot as After} from '../../src/engine.js';
import {goalkeeperPose} from '../../src/anatomy.js';
import {keeperSurfaceContacts,keeperGather,keeperHandRotation} from '../../src/keeper-contact.js';
import {keeperContactData} from '../../src/keeper-contact-data.js';
const root=fileURLToPath(new URL('../../',import.meta.url)),out=resolve(process.argv[2]??'validation/artifacts/keeper-torso'),baseline=process.argv[3]??'1b1230e';
const temporary=await mkdtemp(resolve(tmpdir(),'keeper-torso-benchmark-'));
try{
  const files=execFileSync('git',['ls-tree','-r','--name-only',baseline,'src'],{cwd:root,encoding:'utf8'}).trim().split('\n');
  for(const file of files){const target=resolve(temporary,file);await mkdir(dirname(target),{recursive:true});await writeFile(target,execFileSync('git',['show',`${baseline}:${file}`],{cwd:root,maxBuffer:16*1024*1024}));}
  await writeFile(resolve(temporary,'package.json'),' {"type":"module"}\n');await symlink(resolve(root,'node_modules'),resolve(temporary,'node_modules'),'dir');
  const {Shot:Before}=await import(pathToFileURL(resolve(temporary,'src/engine.js')).href);
  const {keeperGather:beforeGather,keeperHandRotation:beforeHand}=await import(pathToFileURL(resolve(temporary,'src/keeper-contact.js')).href);
  const {goalkeeperPose:beforePose}=await import(pathToFileURL(resolve(temporary,'src/anatomy.js')).href);
  const stats={accuracy:90,power:90,touch:90,composure:90,speed:85,reach:85,handling:95},cases=[];
  for(const x of[-3.3,-1.5,0,1.5,3.3])for(const y of[.2,1.2,2.2])for(const power of[.12,.5,.9])for(const direction of[-1,0,1])cases.push({aim:{x,y,power},direction,seed:42});
  const quantile=(x,q)=>x.toSorted((a,b)=>a-b)[Math.min(x.length-1,Math.floor(x.length*q))];
  const summary=x=>({n:x.length,p50:quantile(x,.5),p95:quantile(x,.95),p99:quantile(x,.99),max:Math.max(...x)});
  function batch(Shot){
    const near=[],construct=[],result={cases:cases.length,touched:0,saved:0,caught:0,goals:0,reboundGoals:0,steps:0},starts=performance.now();
    for(const c of cases){
      const start=performance.now(),shot=new Shot(c.aim,stats,stats,c.direction,c.seed);construct.push(performance.now()-start);
      for(let i=0;i<3600&&!shot.result;i++){const before=performance.now(),nearGoal=shot.ball.z<1.5&&shot.ball.z>-.4;shot.step(1/120);if(nearGoal)near.push(performance.now()-before);result.steps++;}
      if(!shot.result)throw Error('unsettled shot');
      result.touched+=Number(shot.touched);result.saved+=Number(shot.result.saved);result.caught+=Number(shot.caught);result.goals+=Number(shot.result.goal);result.reboundGoals+=Number(shot.result.goal&&shot.touched);
    }
    return {...result,totalMs:performance.now()-starts,nearGoalStepMs:summary(near),constructMs:summary(construct)};
  }
  function query(articulated,near){
    const times=[];
    for(let i=0;i<1000;i++){
      const started=performance.now(),pose=goalkeeperPose(stats,i%2?1:-1,.9+(i%40)/60,1.2);
      pose.torso=articulated?{curl:.13,twist:.06,headCurl:.055}:null;
      const start={x:pose.hip.x,y:pose.hip.y+.2,z:near?pose.hip.z+.2:6},end={...start,z:start.z-.15};
      keeperSurfaceContacts(pose,start,end,.11);times.push(performance.now()-started);
    }
    return summary(times);
  }
  function gatherBatch(Shot,gather){
    const recipes=[[-1,.3,-2,3,.55,95],[1,.3,2,3,.55,95],[-1,2.1,-1.5,2,.55,95],[1,2.1,1.5,1,.55,95],[0,.2,-1.5,42,.12,85],[0,.2,1.5,42,.12,85],[0,1.2,-1.5,42,.5,85],[0,1.2,1.5,42,.5,85],[-1,1.2,-3.3,42,.5,85],[1,1.2,3.3,42,.5,85]],samples=[];
    for(const [direction,y,x,seed,power,speed] of recipes){
      const ability={...stats,speed,reach:speed},shot=new Shot({x,y,power},ability,ability,direction,seed);
      for(let i=0;i<3600&&!shot.result;i++)shot.step(1/120);if(!shot.caught)throw Error('Gather benchmark recipe no longer catches');
      for(let frame=0;frame<=168;frame++){
        const time=frame/60,started=performance.now(),result=gather(shot.pose,shot.poseAt(shot.t+time),shot.ball,shot.contactPart,time/.44);
        if(!Number.isFinite(result.ball.x))throw Error('Nonfinite grasp');samples.push(performance.now()-started);
      }
    }
    return {totalMs:samples.reduce((a,b)=>a+b,0),sampleMs:summary(samples)};
  }
  function supportBatch(poseAt,handRotation){
    const samples=[];
    for(const direction of [-1,1])for(const height of [.3,1.2,2.3])for(let frame=0;frame<=240;frame++){
      const started=performance.now(),pose=poseAt(stats,direction,frame/60,height),a=handRotation(pose,0),b=handRotation(pose,1);
      if(!Number.isFinite(a.w+b.w))throw Error('Nonfinite support rotation');samples.push(performance.now()-started);
    }
    return {totalMs:samples.reduce((a,b)=>a+b,0),sampleMs:summary(samples)};
  }
  const sourceHashes={};for(const name of ['anatomy.js','engine.js','keeper-torso.js','keeper-skin-pose.js','keeper-contact.js','keeper-contact-data.js'])sourceHashes[name]=createHash('sha256').update(await readFile(resolve(root,'src',name))).digest('hex');
  batch(Before);batch(After);const before=[],after=[];for(let i=0;i<5;i++){before.push(batch(Before));after.push(batch(After));}
  gatherBatch(Before,beforeGather);gatherBatch(After,keeperGather);const gatherBefore=[],gatherAfter=[];for(let i=0;i<5;i++){gatherBefore.push(gatherBatch(Before,beforeGather));gatherAfter.push(gatherBatch(After,keeperGather));}
  supportBatch(beforePose,beforeHand);supportBatch(goalkeeperPose,keeperHandRotation);const supportBefore=[],supportAfter=[];for(let i=0;i<5;i++){supportBefore.push(supportBatch(beforePose,beforeHand));supportAfter.push(supportBatch(goalkeeperPose,keeperHandRotation));}
  const queries={rigidFar:query(false,false),articulatedFar:query(true,false),rigidNear:query(false,true),articulatedNear:query(true,true)};
  const report={baseline,sourceHashes,scope:'Five interleaved 135-shot seed-42 batches after warmup. The full revision comparison includes anatomy and asset/contact changes, not torso-only attribution. Support batches include all six 4-second free-save paths at 60Hz, pose construction and both skin-aware hand rotations, but not full rendering. Grasp batches cover ten real captures through 2.8s at 60Hz and include poseAt, both glove constraints and elbow IK. Query probes include full pose creation, analytic frames and broad/narrow phases; synthetic angle overrides isolate contact-query cost and are not choreography validation. Milliseconds on this Node cloud CPU, not a browser/mobile guarantee.',geometry:{torsoHullVertices:keeperContactData.hulls.torso.vertices.length,torsoHullFaces:keeperContactData.hulls.torso.indices.length/3,torsoExactVertices:keeperContactData.torsoPatch.vertices.length,torsoExactFaces:keeperContactData.torsoPatch.indices.length/3},before,after,gatherBefore,gatherAfter,supportBefore,supportAfter,queries};
  await mkdir(out,{recursive:true});await writeFile(resolve(out,'benchmark.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await rm(temporary,{recursive:true,force:true});}

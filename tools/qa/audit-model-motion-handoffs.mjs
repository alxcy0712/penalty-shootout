// Fresh whole-skin checkpoints for the 2026-10-03 model/motion iteration.
// node tools/qa/audit-model-motion-handoffs.mjs runup|finish OUTPUT.json
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {Vector3} from 'three';
import {penaltyStyles,keeperWarmupPose} from '../../src/anatomy.js';
import {gameKickTime} from '../../src/game-character.js';
import {loadCharacter,skinMinimum,skinSurfaceDistance} from '../../tests/helpers/load-character.js';
import {recoverySkin,recoverySkinError} from './audit-striker-recovery.mjs';

const mode=process.argv[2],out=resolve(process.argv[3]??`validation/artifacts/${mode}-handoffs.json`);
assert.ok(['runup','finish'].includes(mode));
const root=new URL('../../',import.meta.url),files=[...(await readdir(new URL('src/',root))).filter(f=>f.endsWith('.js')).map(f=>'src/'+f),
 'assets/characters/striker-mocap.glb','assets/characters/mocap-variants/cmu-10_03-kick.glb',
 'tests/helpers/load-character.js','tools/qa/audit-striker-recovery.mjs','tools/qa/audit-model-motion-handoffs.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.sort().map(async f=>[f,createHash('sha256').update(await readFile(new URL(f,root))).digest('hex')])));
const sourceHashes=await hashes(),actor=await loadCharacter(false),ball=new Vector3(0,.11,11),records=[];
const at=(t,style,options)=>actor.kick(Math.min(1,Math.max(0,t/style.duration)),t>=style.duration?t-style.duration:null,{style,...options});
const skin=()=>recoverySkin(actor),error=(a,b)=>recoverySkinError(a,b);
let maxRepeat=0,maxFrozen=0,maxBoundaryStep=0,maxContactError=0,minimumSkin=Infinity,skinSamples=0,updates=0;
const sample=()=>{skinSamples++;return skin();};
for(const [styleIndex,style]of penaltyStyles.entries()){
 if(mode==='runup'){
  at(0,style,{targetX:0});const ready=sample();
  for(const targetX of[-4.8,-2.1,-.35,.35,2.1,4.8]){
   at(0,style,{targetX});updates++;maxFrozen=Math.max(maxFrozen,error(ready,sample()));
  }
  // Fresh off-grid times around the onset and cadence joins, then the strike.
  const times=[.0037,.01999,.02001,.073,.133323,.133343,.19999,.20001,
   style.duration-.35001,style.duration-.34999,style.duration-.000001,style.duration];
  for(const time of times){
   const options={targetX:2.1,power:.63,shotType:'normal'};at(time,style,options);const expected=sample();
   minimumSkin=Math.min(minimumSkin,skinMinimum(actor.root));
   for(const schedule of[[1/30],[1/60],[1/120],[1/144,.023,.011,.049]]){
    let elapsed=0,index=0;at(0,style,options);
    while(elapsed<time){elapsed=Math.min(time,elapsed+schedule[index++%schedule.length]);at(elapsed,style,options);updates++;}
    maxRepeat=Math.max(maxRepeat,error(expected,sample()));
   }
   actor.capture(.417,style.capture?1:0);actor.pose(keeperWarmupPose(1.237));at(time,style,options);updates+=3;
   maxRepeat=Math.max(maxRepeat,error(expected,sample()));
  }
  const h=1e-6;
  for(const time of[.02,.2,style.duration-.35,style.duration]){
   at(time-h,style,{});const a=sample();at(time+h,style,{});maxBoundaryStep=Math.max(maxBoundaryStep,error(a,sample()));
  }
  records.push({styleIndex,name:style.name,times,sourceContact:gameKickTime(1,0,style)});
 }else{
  const contact=style.capture?.contactSeconds??1.8467,duration=style.capture?.durationSeconds??3.5;
  for(const targetX of[-4.8,-.35,3.7])for(const shotType of['normal','low','chip'])for(const power of[.15,.63,.96]){
   const options={targetX,shotType,power},finish=style.duration+duration-contact+.25;
   at(style.duration,style,options);maxContactError=Math.max(maxContactError,Math.abs(skinSurfaceDistance(actor.root,ball,'Boots')-.11));
   at(finish,style,options);const end=sample();
   for(const time of[style.duration-1e-6,style.duration,style.duration+1e-6,style.duration+.173,finish-.173,finish-.00001,finish,finish+3]){
    at(time,style,options);updates++;const expected=sample();minimumSkin=Math.min(minimumSkin,skinMinimum(actor.root));
    actor.capture(.731,style.capture?1:0);actor.pose(keeperWarmupPose(2.071));at(0,penaltyStyles[(styleIndex+1)%4],{});at(time,style,options);updates+=4;
    maxRepeat=Math.max(maxRepeat,error(expected,sample()));
    if(time>=finish)maxFrozen=Math.max(maxFrozen,error(end,expected));
   }
   at(style.duration-1e-6,style,options);const before=sample();at(style.duration+1e-6,style,options);maxBoundaryStep=Math.max(maxBoundaryStep,error(before,sample()));
   records.push({styleIndex,name:style.name,targetX,shotType,power,finish});
  }
 }
}
assert.deepEqual(await hashes(),sourceHashes,'sources changed during audit');
const gates={coverage:records.length===(mode==='runup'?4:108)&&skinSamples>0&&updates>0,finite:[maxRepeat,maxFrozen,maxBoundaryStep,maxContactError,minimumSkin].every(Number.isFinite),repeat:maxRepeat<1e-7,frozen:maxFrozen<1e-7,boundary:maxBoundaryStep<.0001,floor:minimumSkin>=-.005,contact:mode!=='finish'||maxContactError<.002};
const report={mode,sourceHashes,records,updates,skinSamples,maxRepeat,maxFrozen,maxBoundaryStep,maxContactError,minimumSkin,gates,
 scope:'Fresh timestamp and mixed-mode production-skin checks. Whole-skin coordinate equality, actual boot contact/floor. No browser, GPU, force-balance or continuous-time proof.'};
await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,sourceHashes:undefined,records:records.length}));
if(Object.values(gates).some(ok=>!ok))process.exitCode=1;

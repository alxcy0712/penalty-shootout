import fs from 'node:fs';
import {prepareKeeperCapture} from '../../src/keeper-capture.js';
const clips=[];
for(const name of ['N05D','O05E']) {
  const data=JSON.parse(fs.readFileSync(`assets/characters/mocap/keeper-research/${name}.json`));
  const capture=prepareKeeperCapture(data), frames=[];
  for(let i=0;i<data.frames.length;i++) {
    const pose=capture.sample(i/120);
    frames.push(Object.fromEntries(Object.entries(pose).map(([key,value])=>[key,Array.isArray(value)?value.map(v=>v.toArray()):value?.isVector3?value.toArray():value])));
  }
  clips.push({name,fps:120,frames});
}
fs.writeFileSync('/tmp/penalty-keeper-poses.json',JSON.stringify(clips));
console.log(clips.map(c=>({name:c.name,frames:c.frames.length})));

import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3,Quaternion,Euler,Triangle} from 'three';
import {keeperPose} from '../src/engine.js';
import {keeperSurfaceContacts,keeperHandRotation,keeperContactQuality} from '../src/keeper-contact.js';

const stats={accuracy:90,power:90,touch:90,composure:90,speed:85,reach:85,handling:95};
const geometry=contacts=>contacts.map(({quality,...contact})=>contact);
function sample(pose,index=0){const q=keeperHandRotation(pose,index),point=z=>new Vector3(0,.095,z).applyQuaternion(q).add(pose.hands[index]);return {start:point(.4),end:point(-.4)};}
function turned(source){
  const pose=structuredClone(source),q=new Quaternion().setFromEuler(new Euler(.12,.63,-.19)),offset=new Vector3(1.2,.2,-.5),turn=p=>new Vector3().copy(p).applyQuaternion(q);
  for(const name of ['hip','shoulder','head'])pose[name]=turn(pose[name]).add(offset);
  for(const name of ['up','right','forward'])pose[name]=turn(pose[name]);
  for(const name of ['hands','elbows','shoulders','hips','knees','feet'])pose[name]=pose[name].map(p=>turn(p).add(offset));
  return pose;
}

test('geometry-only queries preserve every hit and leave the eager public quality unchanged',()=>{
  let gloveHits=0,positiveQuality=0;
  for(const direction of [-1,0,1])for(const time of [.1,.5,1.2])for(const custom of [false,true]){
    const source=keeperPose(stats,direction,time,1.2),pose=custom?turned(source):source;
    for(const index of [0,1]){
      const {start,end}=sample(pose,index),eager=keeperSurfaceContacts(pose,start,end,.11),plain=keeperSurfaceContacts(pose,start,end,.11,false);
      assert.deepEqual(geometry(plain),geometry(eager));
      for(const c of eager)if(c.type==='hand'){gloveHits++;positiveQuality+=+(c.quality>0);}
      assert.deepEqual(keeperSurfaceContacts(pose,start,end,.11),eager,'geometry-only work cannot pollute the following public query');
    }
  }
  assert.ok(gloveHits>=36);assert.ok(positiveQuality>0,'the test actually distinguishes real handling quality from omitted quality');
});

test('geometry-only queries preserve stationary overlaps and repeated/interleaved pose queries',()=>{
  const poses=[keeperPose(stats,0,.5,1.2),keeperPose(stats,-1,.65,.3),turned(keeperPose(stats,1,.7,1.2))];
  for(const pose of poses)for(const index of [0,1]){
    const center=new Vector3(0,.095,.012).applyQuaternion(keeperHandRotation(pose,index)).add(pose.hands[index]);
    const eager=keeperSurfaceContacts(pose,center,center,.11);assert.ok(eager.some(c=>c.part===`hand${index?'R':'L'}`));
    for(const other of poses){const {start,end}=sample(other,index);keeperSurfaceContacts(other,start,end,.11,false);}
    assert.deepEqual(geometry(keeperSurfaceContacts(pose,center,center,.11,false)),geometry(eager));
    assert.deepEqual(keeperSurfaceContacts(pose,center,center,.11),eager);
  }
});

test('deferred contacts retain exact eager quality through mirrored and interleaved poses',()=>{
  let hands=0;
  for(const direction of [-1,0,1])for(const time of [.1,.5,1.2])for(const custom of [false,true]){
    const source=keeperPose(stats,direction,time,1.2),pose=custom?turned(source):source;
    for(const index of [0,1]){
      const {start,end}=sample(pose,index),eager=keeperSurfaceContacts(pose,start,end,.11),deferred=keeperSurfaceContacts(pose,start,end,.11,'deferred');
      assert.deepEqual(geometry(deferred),geometry(eager));
      const other=keeperPose(stats,-direction,time+.13,.3),probe=sample(other,1-index);keeperSurfaceContacts(other,probe.start,probe.end,.11);
      for(const [i,contact]of deferred.entries()){
        assert.equal(keeperContactQuality(contact),eager[i].quality);assert.deepEqual(contact,eager[i]);
        assert.deepEqual(Object.keys(contact),['hit','r','type','part','quality'],'private samples do not change the public record shape');
        hands+=+(contact.type==='hand');
      }
    }
  }
  assert.ok(hands>=36);
});

test('deferred quality owns its inputs even if caller vectors, pose and hit records change',()=>{
  const pose=keeperPose(stats,0,.5,1.2),{start,end}=sample(pose),eager=keeperSurfaceContacts(pose,start,end,.11),deferred=keeperSurfaceContacts(pose,start,end,.11,'deferred');
  assert.ok(deferred.some(c=>c.type==='hand'));
  start.set(100,200,300);end.set(-300,-200,-100);pose.hands[0].x+=12;pose.up.x+=.3;
  for(const contact of deferred){contact.hit.time=.983;contact.hit.p.set(8,9,10);contact.hit.q.set(3,4,5);}
  const other=turned(keeperPose(stats,1,.9,.3)),probe=sample(other,1);keeperSurfaceContacts(other,probe.start,probe.end,.11);
  for(const [index,contact]of deferred.entries())assert.equal(keeperContactQuality(contact),eager[index].quality,'quality must use the owned original endpoints/time and static glove mesh');
});

test('reading deferred quality again reuses only that contact result',()=>{
  const pose=keeperPose(stats,0,.5,1.2),{start,end}=sample(pose),contact=keeperSurfaceContacts(pose,start,end,.11,'deferred').find(c=>c.type==='hand');
  assert.ok(contact);const original=Triangle.prototype.closestPointToPoint;let calls=0;
  Triangle.prototype.closestPointToPoint=function(...args){calls++;return original.apply(this,args);};
  try{
    const quality=keeperContactQuality(contact),firstCalls=calls;assert.ok(firstCalls>0);assert.equal(keeperContactQuality(contact),quality);assert.equal(calls,firstCalls,'a consumed deferred record does not rescan triangles');
  }finally{Triangle.prototype.closestPointToPoint=original;}
  const eager=keeperSurfaceContacts(pose,start,end,.11).find(c=>c.part===contact.part);assert.deepEqual(contact,eager);
});

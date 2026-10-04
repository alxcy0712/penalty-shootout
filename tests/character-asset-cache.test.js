import test from 'node:test';
import assert from 'node:assert/strict';
import {createCharacterAssetCache,CHARACTER_ASSET_TIMEOUT_MS} from '../src/character-asset-cache.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function timers(){
  const pending=new Map();let id=0;
  return {pending,setTimer(fn,ms){pending.set(++id,{fn,ms});return id;},clearTimer(id){pending.delete(id);},expire(){for(const {fn} of [...pending.values()])fn();}};
}

test('concurrent source loads dedupe and retired resources wait for every actor lease',async()=>{
  const clock=timers(),source=deferred(),disposed=[];let loads=0;
  const cache=createCharacterAssetCache({...clock,load:()=>{loads++;return source.promise;},dispose:asset=>disposed.push(asset)});
  const first=cache.acquire('/same.glb'),second=cache.acquire('/same.glb');await flush();
  assert.equal(loads,1);assert.equal(clock.pending.size,1);
  assert.equal([...clock.pending.values()][0].ms,CHARACTER_ASSET_TIMEOUT_MS);
  const asset={scene:'shared'};source.resolve(asset);const [a,b]=await Promise.all([first,second]);
  assert.equal(clock.pending.size,0);assert.notEqual(a,b);assert.equal(a.asset,b.asset);
  cache.invalidate('/same.glb',asset);a.release();a.release();assert.deepEqual(disposed,[]);
  b.release();assert.deepEqual(disposed,[asset]);cache.dispose();assert.deepEqual(disposed,[asset]);
});

test('timeout evicts one request; its late success cannot overwrite the retry and is disposed once',async()=>{
  const clock=timers(),old=deferred(),fresh=deferred(),disposed=[],signals=[];let loads=0;
  const cache=createCharacterAssetCache({...clock,load:(_url,{signal})=>{signals.push(signal);return ++loads===1?old.promise:fresh.promise;},dispose:asset=>disposed.push(asset)});
  const expired=cache.acquire('/retry.glb');await flush();clock.expire();
  await assert.rejects(expired,{code:'timeout'});
  assert.equal(signals[0].aborted,true);
  const retry=cache.acquire('/retry.glb');await flush();assert.equal(loads,2);
  const current={id:'new'};fresh.resolve(current);const lease=await retry;
  assert.equal(signals[1].aborted,false);
  const stale={id:'late'};old.resolve(stale);await flush();assert.deepEqual(disposed,[stale]);
  const shared=await cache.acquire('/retry.glb');assert.equal(shared.asset,current);assert.equal(loads,2);
  cache.dispose();assert.deepEqual(disposed,[stale]);lease.release();assert.deepEqual(disposed,[stale]);
  shared.release();assert.deepEqual(disposed,[stale,current]);
});

test('synchronous failure is bounded and retryable; cache disposal cancels pending requests',async()=>{
  const clock=timers(),late=deferred(),disposed=[];let loads=0;
  const cache=createCharacterAssetCache({...clock,load:()=>{if(++loads===1)throw new Error('decode failed');return late.promise;},dispose:asset=>disposed.push(asset)});
  await assert.rejects(cache.acquire('/broken.glb'),/decode failed/);assert.equal(clock.pending.size,0);
  const pending=cache.acquire('/broken.glb');await flush();cache.dispose();
  await assert.rejects(pending,{code:'cancelled'});assert.equal(clock.pending.size,0);
  await assert.rejects(cache.acquire('/broken.glb'),{code:'disposed'});
  const asset={id:'arrived after disposal'};late.resolve(asset);await flush();assert.deepEqual(disposed,[asset]);
});

test('immediate cache disposal prevents the scheduled loader from starting at all',async()=>{
  const clock=timers();let loads=0;
  const cache=createCharacterAssetCache({...clock,load:()=>{loads++;return {};}});
  const request=cache.acquire('/never-start.glb');cache.dispose();
  await assert.rejects(request,{code:'cancelled'});await flush();
  assert.equal(loads,0);assert.equal(clock.pending.size,0);
});

test('invalidating an old lease cannot evict a newer source generation',async()=>{
  const clock=timers();let id=0;
  const cache=createCharacterAssetCache({...clock,load:()=>({id:++id})});
  const old=await cache.acquire('/asset.glb');cache.invalidate('/asset.glb',old.asset);
  const current=await cache.acquire('/asset.glb');cache.invalidate('/asset.glb',old.asset);
  const shared=await cache.acquire('/asset.glb');assert.equal(current.asset,shared.asset);assert.equal(id,2);
  old.release();current.release();shared.release();cache.dispose();
});

test('unsupported cancellation cannot accumulate more than two unsettled source jobs',async()=>{
  const clock=timers(),jobs=[],discarded=[];
  const cache=createCharacterAssetCache({...clock,load:()=>{const job=deferred();jobs.push(job);return job.promise;},dispose:asset=>discarded.push(asset)});
  for(let i=0;i<2;i++){
    const request=cache.acquire('/stalled.glb');await flush();clock.expire();await assert.rejects(request,{code:'timeout'});
  }
  for(let i=0;i<10;i++)await assert.rejects(cache.acquire('/stalled.glb'),{code:'busy'});
  assert.equal(jobs.length,2);assert.equal(clock.pending.size,0);
  jobs[0].resolve({id:'first late'});await flush();assert.deepEqual(discarded,[{id:'first late'}]);
  const recovery=cache.acquire('/stalled.glb');await flush();assert.equal(jobs.length,3);
  jobs[2].resolve({id:'recovered'});const lease=await recovery;assert.equal(lease.asset.id,'recovered');
  cache.dispose();lease.release();jobs[1].resolve({id:'second late'});await flush();assert.equal(discarded.length,3);
});

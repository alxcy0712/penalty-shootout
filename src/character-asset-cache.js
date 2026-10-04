// Sources belong to this cache. Characters lease their shared geometry/textures
// and own only their skeleton/material clones. A failed request is never cached.
export const CHARACTER_ASSET_TIMEOUT_MS=15000;
export const CHARACTER_ASSET_MAX_PENDING=2;

export function assetError(code,message){return Object.assign(new Error(message),{code});}

export function createCharacterAssetCache({load,dispose=()=>{},timeoutMs=CHARACTER_ASSET_TIMEOUT_MS,
  maxPending=CHARACTER_ASSET_MAX_PENDING,setTimer=setTimeout,clearTimer=clearTimeout}={}){
  if(typeof load!=='function')throw new TypeError('An asset loader is required');
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new RangeError('Asset timeout must be positive');
  if(!Number.isInteger(maxPending)||maxPending<1)throw new RangeError('Pending asset limit must be positive');
  const entries=new Map(),pending=new Map();let closed=false;
  const destroy=entry=>{
    if(entry.asset&&entry.retired&&!entry.references){
      const asset=entry.asset;entry.asset=null;dispose(asset);
    }
  };
  const retire=entry=>{
    entry.retired=true;
    if(entries.get(entry.key)===entry)entries.delete(entry.key);
    if(entry.status==='loading')entry.fail(assetError('cancelled','人物资源请求已结束'));
    destroy(entry);
  };
  function request(key){
    const entry={key,status:'loading',references:0,retired:false,asset:null};
    const controller=new AbortController();
    pending.set(key,(pending.get(key)??0)+1);
    entries.set(key,entry);
    entry.promise=new Promise((resolve,reject)=>{
      let timer;
      entry.fail=error=>{
        if(entry.status!=='loading')return;
        entry.status='error';entry.retired=true;clearTimer(timer);
        controller.abort();
        if(entries.get(key)===entry)entries.delete(key);
        reject(error);
      };
      timer=setTimer(()=>entry.fail(assetError('timeout','人物资源加载超时，请重试')),timeoutMs);
      // Catch synchronous loader errors too. Retired/expired completions can
      // neither overwrite a newer cache entry nor reach a character instance.
      Promise.resolve().then(()=>{
        if(controller.signal.aborted)throw assetError('cancelled','人物资源请求已结束');
        return load(key,{signal:controller.signal});
      }).then(asset=>{
        if(entry.status!=='loading'){dispose(asset);return;}
        clearTimer(timer);entry.asset=asset;entry.status='ready';resolve(asset);
      },entry.fail).finally(()=>{
        const remaining=pending.get(key)-1;
        if(remaining)pending.set(key,remaining);else pending.delete(key);
      });
    });
    return entry;
  }
  return {
    acquire(url){
      if(closed)return Promise.reject(assetError('disposed','人物资源缓存已释放'));
      const key=String(url);
      // Network cancellation is best-effort and synchronous decode cannot be
      // interrupted. Do not accumulate unlimited orphan jobs on manual retry.
      if(!entries.has(key)&&(pending.get(key)??0)>=maxPending)return Promise.reject(assetError('busy','上次人物资源仍在处理，请稍后重试'));
      const entry=entries.get(key)??request(key);
      return entry.promise.then(asset=>{
        if(entry.retired||closed)throw assetError('cancelled','人物资源请求已结束');
        entry.references++;let released=false;
        return {asset,release(){if(released)return;released=true;entry.references--;destroy(entry);}};
      });
    },
    // Retire only the generation a caller actually inspected. Existing actors
    // retain its sources until their leases are released.
    invalidate(url,asset){
      const entry=entries.get(String(url));
      if(entry&&(!asset||entry.asset===asset))retire(entry);
    },
    dispose(){
      if(closed)return;closed=true;
      for(const entry of [...entries.values()])retire(entry);
    }
  };
}

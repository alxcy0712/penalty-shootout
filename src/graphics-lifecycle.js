// Application lock only. WebGLRenderer owns its context/resource restoration.
// A restored event never starts another animation loop or changes user pause.
export function createGraphicsLifecycle({canvas,onChange=()=>{},setTimer=setTimeout,clearTimer=clearTimeout,timeoutMs=15000}={}){
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new RangeError('Graphics recovery timeout must be positive');
  let state='ready',generation=0,timer=null,disposed=false;
  let current=Object.freeze({state,generation,blocked:false,canRender:true});
  const snapshot=()=>current;
  const publish=()=>{current=Object.freeze({state,generation,blocked:state!=='ready',canRender:state==='ready'||state==='restoring'||state==='restored'});onChange(current);};
  const clear=()=>{if(timer!==null){clearTimer(timer);timer=null;}};
  function lost(event){
    event?.preventDefault?.();
    if(disposed||state==='lost'||state==='failed')return;
    clear();generation++;state='lost';publish();
    const token=generation;
    timer=setTimer(()=>{timer=null;if(!disposed&&token===generation&&state==='lost'){state='failed';publish();}},timeoutMs);
  }
  function restored(){
    if(disposed||!['lost','failed'].includes(state))return;
    clear();state='restoring';publish();
  }
  canvas?.addEventListener?.('webglcontextlost',lost,false);
  canvas?.addEventListener?.('webglcontextrestored',restored,false);
  return {
    get status(){return snapshot();},
    rendered(){if(disposed||state!=='restoring')return false;state='restored';publish();return true;},
    fail(){if(disposed)return;clear();state='failed';publish();},
    resume(){if(disposed||state!=='restored')return false;state='ready';publish();return true;},
    dispose(){if(disposed)return;disposed=true;clear();canvas?.removeEventListener?.('webglcontextlost',lost,false);canvas?.removeEventListener?.('webglcontextrestored',restored,false);},
  };
}

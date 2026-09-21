import './style.css';
import {penaltyStyle} from './anatomy.js';
import {Match, Shot, Random, clamp, gestureInput, directionMeter, powerMeter} from './engine.js';
import {Stadium} from './scene.js';

const icons={ball:'<circle cx="12" cy="12" r="9"/><path d="m12 7 4 3-1.5 4.5h-5L8 10zM12 3v4m8 1-4 2m2 9-3.5-4.5M6 19l3.5-4.5M4 8l4 2"/>',arrow:'<path d="M4 12h15m-6-6 6 6-6 6"/>',back:'<path d="m14 6-6 6 6 6"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',gear:'<circle cx="12" cy="12" r="3"/><path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 2 3h4l1-3 3-1 2-3-2-2 1-3-3-2-2-3z"/>',help:'<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 4 3c-1 0-1 1-1 2m0 2v1"/>',pause:'<path d="M9 5v14M15 5v14"/>',sound:'<path d="m4 9 5 0 5-4v14l-5-4H4zM17 8q6 4 0 8"/>',mute:'<path d="m4 9 5 0 5-4v14l-5-4H4zM17 9l5 6m0-6-5 6"/>',shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',hand:'<path d="M8 12V5a2 2 0 0 1 4 0v6-4a2 2 0 0 1 4 0v5-2a2 2 0 0 1 4 0v5c0 5-4 7-7 6L6 17l-3-4q0-3 3-1l2 2"/>',cup:'<path d="M7 3h10v7a5 5 0 0 1-10 0zM7 5H3v3q0 5 5 5m9-8h4v3q0 5-5 5M12 15v5m-5 1h10"/>',up:'<path d="m6 14 6-6 6 6"/>',down:'<path d="m6 10 6 6 6-6"/>',check:'<path d="m5 12 4 4L19 6"/>'};
const icon=(name,cls='')=>`<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.ball}</svg>`;
const $=s=>document.querySelector(s);
const STORAGE='penalty-night-v1', PREF='penalty-preferences-v1';
let storageOk=true;
function read(key){try{return JSON.parse(localStorage.getItem(key));}catch{return null;}}
const settings={mode:'simple',sound:true,mouse:2,touch:2,pen:2,...(read(PREF)||{})};
let state={phase:'home',match:null,shot:null,turnTime:0,lockedX:0,dir:0,runup:0,aim:null};
let paused=false, modal=null, stage, renderError=null, frameTime=0, elapsed=0, accumulator=0, saveClock=0, pointer=null, activeDevice='ontouchstart' in window?'touch':'mouse', calibration=[], autoCalibrate=false;
let audioCtx=null,modalTrigger=null;
function sound(kind){
  if(!settings.sound)return;
  try{audioCtx??=new (window.AudioContext||window.webkitAudioContext)();audioCtx.resume();const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.connect(g);g.connect(audioCtx.destination);const t=audioCtx.currentTime;o.type=kind==='kick'?'triangle':'sine';o.frequency.setValueAtTime(kind==='goal'?520:kind==='kick'?130:kind==='save'?220:380,t);o.frequency.exponentialRampToValueAtTime(kind==='goal'?1040:70,t+.16);g.gain.setValueAtTime(.07,t);g.gain.exponentialRampToValueAtTime(.001,t+.22);o.start(t);o.stop(t+.23);}catch{}
}
function storeSettings(){try{localStorage.setItem(PREF,JSON.stringify(settings));}catch{storageOk=false;}}
function save(){if(!state.match||state.phase==='home')return;try{localStorage.setItem(STORAGE,JSON.stringify({version:1,state}));}catch{storageOk=false;}}
function clearSave(){try{localStorage.removeItem(STORAGE);}catch{}}
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>{$('#toast').classList.remove('visible');$('#toast').textContent='';},2600);}
const active=()=>['aim','power','guard','runup','flight'].includes(state.phase);
function transition(phase){state.phase=phase;pointer=null;render();save();}
function seed(){const a=new Uint32Array(1);crypto.getRandomValues(a);return a[0];}

$('#app').innerHTML=`<div class="desktop-hint"><span class="tiny-line"></span> 十一码之夜 <span class="tiny-line"></span></div><div class="phone"><div id="stadium" aria-label="原创三维足球场"></div><div class="vignette"></div><header id="header"></header><div id="screen"></div><div id="modal-root"></div><div id="toast" role="status"></div></div><p class="desktop-note">鼠标按住拖动，即可模拟手指滑动</p>`;
try{stage=new Stadium($('#stadium'));}catch(err){renderError=err;$('#stadium').innerHTML='<div class="graphics-error">图形加载失败<br><small>请启用浏览器硬件加速后重试</small><button class="secondary" data-action="reload">重试加载</button></div>';}

function header(){
  const home=state.phase==='home';
  $('#header').innerHTML=`<div class="brand">${home?icon('ball'):`<button class="icon-btn" data-action="pause" aria-label="暂停比赛">${icon('pause')}</button>`}<span>${home?'点球大战':'十一<span class="brand-light">码之夜</span>'}</span></div><div class="header-actions">${!home&&state.match?`<button class="icon-btn" data-action="roster" aria-label="查看球队能力">${icon('shield')}</button>`:''}<button class="icon-btn" data-action="sound" aria-label="${settings.sound?'关闭':'打开'}声音">${icon(settings.sound?'sound':'mute')}</button><button class="icon-btn" data-action="${home?'rules':'pause'}" aria-label="${home?'游戏规则':'比赛菜单'}">${icon(home?'help':'gear')}</button></div>`;
}
function render(){
  header();stage?.setMode(state.phase==='home'?'hero':'game');
  const s=$('#screen');
  if(state.phase==='home'){
    s.innerHTML=`<section class="home"><div class="home-copy"><div class="eyebrow"><span></span> 今夜，站上罚球点</div><h1>十一<span>码之夜</span></h1><p>一脚定局。<br>把胜负，交给你的下一次选择。</p></div><div class="home-bottom"><div class="stadium-note"><span class="live-dot"></span> 雾港球场 <span>夜场 · 微雨</span></div><div class="mode-label">选择你的比赛方式 <span>01 / 02</span></div><div class="mode-grid"><button class="mode-card ${settings.mode==='simple'?'selected':''}" data-action="mode" data-mode="simple" aria-pressed="${settings.mode==='simple'}"><div>${icon('ball')}<span class="mode-radio"></span></div><strong>简洁版</strong><small>两次点击，一脚决胜</small><span class="mode-tag">轻松上手 · 射门不限时</span></button><button class="mode-card ${settings.mode==='advanced'?'selected':''}" data-action="mode" data-mode="advanced" aria-pressed="${settings.mode==='advanced'}"><div>${icon('hand')}<span class="mode-radio"></span></div><strong>高级版</strong><small>指尖划动，掌控球路</small><span class="mode-tag">原创球队 · 球员能力</span></button></div><button class="primary start" data-action="new" ${renderError?'disabled':''}>走上球场 ${icon('arrow')}</button><div class="home-links"><button class="text-btn" data-action="calibration">${icon('gear')} 力度校准</button>${read(STORAGE)?'<button class="text-btn" data-action="resume-save">继续上次比赛 →</button>':'<span>五轮决胜 · 攻守交替</span>'}</div></div></section>`;
    return;
  }
  if(state.phase==='lineup'){
    s.innerHTML=`<section class="lineup"><div class="eyebrow">为今晚的比赛，排好顺序</div><h1>你的首发阵容</h1><p class="muted">雾港弧光 · 4–3–3 · 拖动右侧手柄调整主罚顺序</p><div class="squad-list">${rosterRows(0,true)}</div><div class="lineup-bottom"><button class="primary" data-action="coin">阵容就绪 ${icon('arrow')}</button><button class="text-btn" data-action="home">返回首页</button></div></section>`;bindLineup();return;
  }
  if(state.phase==='coin'){
    const m=state.match;
    s.innerHTML=`<section class="coin-screen"><div class="coin">${icon('ball')}</div><div class="eyebrow">${m.end?'南侧':'北侧'}球门 · 双方就位</div><h1>${m.coinWinner===0?'你赢得了掷币':'对手赢得了掷币'}</h1><p>${m.coinWinner===0?'选择先罚，或把压力交给对手。':'暮原流星选择'+(m.aiFirst===1?'先罚。':'后罚。')}</p><div class="coin-actions">${m.coinWinner===0?'<button class="primary" data-action="first" data-first="0">我们先罚</button><button class="secondary" data-action="first" data-first="1">我们后罚</button>':`<button class="primary" data-action="first" data-first="${m.aiFirst}">进入球场 ${icon('arrow')}</button>`}</div></section>`;return;
  }
  if(state.phase==='finish'){renderFinish();return;}
  const m=state.match, own=m.turn===0, t=m.teams[m.turn], p=t.players[m.kicker];
  s.innerHTML=`<section class="game ${m.mode==='advanced'?'advanced':''} ${own?'':'keeper-view'}"><div class="scoreboard"><div class="score-team"><span class="team-symbol mint">${icon('shield')}</span><strong>雾港弧光</strong><small>你的球队</small>${kickDots(m.teams[0])}</div><div class="score-center"><div class="round-label">${m.serial>10?'突然死亡':'常规五轮'}</div><div class="score">${m.teams[0].goals}<span>:</span>${m.teams[1].goals}</div><small>第 ${Math.floor((m.serial-1)/2)+1} 轮</small></div><div class="score-team"><span class="team-symbol peach">${icon('shield')}</span><strong>暮原流星</strong><small>对手球队</small>${kickDots(m.teams[1])}</div></div><div class="role-pill ${own?'':'defending'}">${icon(own?'ball':'hand')} ${own?'你来射门':'你来守门'}<span id="timer">${state.phase==='ready'?'准备':own?(m.mode==='simple'?'不限时':'10.0 秒'):'3.0 秒'}</span></div><div id="gesture" aria-label="${own?'向上划动射门':'向左或向右划动扑救'}"><svg id="gesture-line" aria-hidden="true"><path/></svg><div class="gesture-origin">${icon(own?'ball':'hand')}</div></div><div id="floating-result" aria-live="polite"></div><div class="game-bottom"><button class="player-strip" data-action="player" data-team="${m.turn}" data-player="${m.kicker}"><span class="jersey">${p.number.toString().padStart(2,'0')}</span><span><strong>${p.name}</strong><small>${p.position} · 本轮主罚</small></span>${m.mode==='advanced'?`<div class="mini-stats"><span>准度<b>${p.accuracy}</b></span><span>脚力<b>${p.power}</b></span></div>`:`<span class="small-note">${own?'你的下一脚':'保持专注'}</span>`}</button><div class="control-panel" id="controls">${controls()}</div><div class="match-footer"><button class="text-btn" data-action="roster">${icon('shield')} 球队</button><span id="status-note">${storageOk?'每一脚，都有可能':'进度仅保留在当前页面'}</span><button class="text-btn" data-action="rules">规则 ${icon('help')}</button></div></div></section>`;
  $('#gesture').classList.toggle('enabled',m.mode==='advanced'&&['aim','guard','flight'].includes(state.phase)&&(!own||state.phase==='aim'));
  bindGesture($('#gesture'),false);
  if(state.phase==='result')resultOverlay();
}
function kickDots(team){const shown=team.kicks.length>5?team.kicks.slice(-5):team.kicks;return `<div class="kick-dots" aria-label="${team.goals} 球，已罚 ${team.kicks.length} 次">${Array.from({length:5},(_,i)=>`<span class="dot ${shown[i]?(shown[i].goal?'hit':'miss'):''}">${shown[i]?(shown[i].goal?'✓':'×'):''}</span>`).join('')}</div>`;}
function shotTypeChoice(){return `<div class="shot-type" role="group" aria-label="射门方式"><button data-action="shot-type" data-low="false" aria-pressed="${!state.lowShot&&!state.chipShot}">常规</button><button data-action="shot-type" data-low="true" aria-pressed="${!!state.lowShot}">低平</button><button data-action="shot-type" data-low="chip" aria-pressed="${!!state.chipShot}">勺子</button></div>`;}
function shotInput(points,r){const input=gestureInput(points,r.width,r.height,settings[activeDevice]||2,true);return input?{...input,low:!!state.lowShot,chip:!!state.chipShot}:null;}
function controls(){
  const {phase,match:m}=state,own=m.turn===0;
  if(phase==='ready')return `<div class="panel-title"><h2>${own?'把握你的这一脚':'读懂对手的下一脚'}</h2><span class="step">${own?'进攻':'防守'}</span></div><p>${own?(m.mode==='simple'?'先锁定方向，再选择力度。慢慢来。':'向上拖动调力度，回拉减力，弯划踢出弧线。'):'提前预判方向，门将根据来球时间起扑。'}</p>${own?shotTypeChoice():''}<button class="primary" data-action="ready">准备好了 ${icon('arrow')}</button>`;
  if(phase==='aim'&&m.mode==='simple')return `<div class="panel-title"><h2>选择射门方向</h2><span class="step">01 / 02</span></div><div class="meter direction"><span class="meter-center"></span><i id="indicator"></i></div><div class="meter-labels"><span>打偏 · 左路</span><span>中路</span><span>右路 · 打偏</span></div><button class="primary" data-action="lock">锁定方向 ${icon('arrow')}</button>`;
  if(phase==='power')return `<div class="panel-title"><h2>控制出脚力度</h2>${shotTypeChoice()}</div><div class="meter power"><i id="indicator"></i></div><div class="meter-labels"><span>轻推</span><span>稳健</span><span>满力 · 打飞风险</span></div><button class="primary" data-action="shoot">射门 ${icon('ball')}</button>`;
  if(phase==='aim')return `<div class="panel-title"><h2>向上划动，完成射门</h2>${shotTypeChoice()}</div><p>${state.chipShot?'力度越大，挑得越高；回拉降低弧顶。':state.lowShot?'贴地出球；拖远加力，回拉减力。':'拖远加力，回拉减力；弯划搓出弧线。'}</p><div class="gesture-power"><span id="power-fill"></span></div><div class="meter-labels"><span>轻推</span><strong id="power-value">等待你的手势</strong><span>大力</span></div>`;
  if(phase==='guard'||(phase==='flight'&&!own))return `<div class="panel-title"><h2>${phase==='flight'?'足球已经出脚':'对手准备射门'}</h2><span class="step" id="guard-choice">${state.dir===0?'中路待命':state.dir>0?'预判左路':'预判右路'}</span></div><p>${m.mode==='advanced'?'左右划动或点按选择方向，中路可取消。':'点击预判方向，再次点击可回到中路。'}</p><div class="guard-buttons"><button class="secondary ${state.dir>0?'chosen':''}" data-action="dive" data-dir="-1" aria-pressed="${state.dir>0}">← 扑左</button><button class="center-btn" data-action="dive" data-dir="0" aria-pressed="${state.dir===0}" aria-label="回到中路">中路</button><button class="secondary ${state.dir<0?'chosen':''}" data-action="dive" data-dir="1" aria-pressed="${state.dir<0}">扑右 →</button></div>`;
  if(phase==='result'){const r=state.shot.result;return `<div class="panel-title"><h2>${r.goal?'射门得分':r.saved?'成功扑救':'射门未进'}</h2><span class="step">${r.speed} km/h</span></div><p>${r.reason}</p><button class="primary" data-action="next">${m.winner!==null?'查看赛果':'下一球'} ${icon('arrow')}</button><button class="text-btn full" data-action="home">返回首页</button>`;}
  return `<div class="panel-title"><h2>${phase==='runup'?'助跑，出脚…':'目光跟随足球'}</h2><span class="step">${own?'进攻':'防守'}</span></div><p>胜负，就在这一瞬间。</p><div class="waiting-line"><span></span></div>`;
}
function resultOverlay(){const r=state.shot.result,good=state.match.turn===0?r.goal:!r.goal;$('#floating-result').innerHTML=`<div class="shot-banner ${good?'good':'bad'}"><span>${r.goal?'进球！':r.saved?'扑出！':r.post?'击中门框':'射门未进'}</span><small>${good?'漂亮的一球':'下一脚，找回节奏'}</small></div>`;}
function bindLineup(){
  const list=$('.lineup .squad-list');let drag=null,frame=0;
  const sync=()=>{[...list.children].forEach((row,i)=>row.querySelector('.order').textContent=String(i+1).padStart(2,'0'));};
  const commit=()=>{state.match.teams[0].order=[...list.children].map(row=>Number(row.dataset.playerIndex));save();};
  const move=()=>{
    if(!drag)return;
    const bounds=list.getBoundingClientRect();
    const edge=42;
    list.scrollTop+=drag.y<bounds.top+edge?-Math.min(10,(bounds.top+edge-drag.y)/4):drag.y>bounds.bottom-edge?Math.min(10,(drag.y-bounds.bottom+edge)/4):0;
    const others=[...list.children].filter(row=>row!==drag.row);
    const next=others.find(row=>{const r=row.getBoundingClientRect();return drag.y<r.top+r.height/2;});
    if(drag.row.nextElementSibling!==(next??null)){list.insertBefore(drag.row,next??null);sync();}
    frame=requestAnimationFrame(move);
  };
  const end=(cancel=false)=>{
    if(!drag)return;
    cancelAnimationFrame(frame);
    const {row,id,original}=drag;drag=null;
    row.classList.remove('dragging');list.classList.remove('reordering');
    if(cancel){original.forEach(item=>list.append(item));sync();}else commit();
    if(list.hasPointerCapture(id))list.releasePointerCapture(id);
    row.querySelector('.reorder-handle').focus({preventScroll:true});
  };
  list.addEventListener('pointerdown',e=>{
    const handle=e.target.closest('.reorder-handle');if(!handle||e.button!==0||drag)return;
    e.preventDefault();
    drag={row:handle.closest('.squad-row'),id:e.pointerId,y:e.clientY,original:[...list.children]};
    list.setPointerCapture(e.pointerId);drag.row.classList.add('dragging');list.classList.add('reordering');
    frame=requestAnimationFrame(move);
  });
  list.addEventListener('pointermove',e=>{if(drag&&e.pointerId===drag.id)drag.y=e.clientY;});
  list.addEventListener('pointerup',e=>{if(drag&&e.pointerId===drag.id)end();});
  list.addEventListener('pointercancel',()=>end(true));
  list.addEventListener('lostpointercapture',()=>end(true));
  list.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&drag){e.stopPropagation();end(true);return;}
    const handle=e.target.closest('.reorder-handle');if(!handle||!['ArrowUp','ArrowDown'].includes(e.key)||drag)return;
    e.preventDefault();const row=handle.closest('.squad-row');
    if(e.key==='ArrowUp'&&row.previousElementSibling)list.insertBefore(row,row.previousElementSibling);
    if(e.key==='ArrowDown'&&row.nextElementSibling)list.insertBefore(row.nextElementSibling,row);
    sync();commit();handle.focus({preventScroll:true});row.scrollIntoView({block:'nearest'});
  });
}
function rosterRows(team,edit=false){return state.match.teams[team].order.map((index,i)=>{const p=state.match.teams[team].players[index];return `<div class="squad-row" data-player-index="${index}"><span class="order">${String(i+1).padStart(2,'0')}</span><button class="player-name" data-action="player" data-team="${team}" data-player="${index}"><span class="position-badge ${p.position==='门将'?'gk':''}">${p.position}</span><strong>${p.name}</strong><small>准度 ${p.accuracy} · 心理 ${p.composure}</small></button><span class="rating">${Math.round((p.accuracy+p.power+p.composure)/3)}</span>${edit?`<button class="icon-btn reorder-handle" aria-label="拖动调整${p.name}的顺序，也可按上下方向键">⠿</button>`:''}</div>`;}).join('');}
function renderFinish(){
  const m=state.match,won=m.winner===0,shots=m.teams[0].kicks,saves=m.teams[1].kicks.filter(k=>k.saved).length;
  $('#screen').innerHTML=`<section class="finish"><div class="finish-top"><div class="trophy">${icon(won?'cup':'shield')}</div><div class="eyebrow">全场结束 · ${m.mode==='simple'?'简洁版':'高级版'}</div><h1>${won?'这一夜，属于你':'下一场，再见'}</h1><p>${won?'稳住每一脚，把胜利留在雾港。':'每一次站上罚球点，都是新的开始。'}</p><div class="final-score"><span>雾港弧光</span><strong>${m.teams[0].goals}<i>:</i>${m.teams[1].goals}</strong><span>暮原流星</span></div></div><div class="finish-stats"><div><strong>${shots.filter(k=>k.goal).length}</strong><span>进球</span></div><div><strong>${saves}</strong><span>成功扑救</span></div><div><strong>${shots.length}</strong><span>主罚次数</span></div></div><div class="history"><div class="mode-label">每一脚的故事 <span>比赛记录</span></div>${Array.from({length:Math.max(...m.teams.map(t=>t.kicks.length))},(_,i)=>`<div class="history-row"><span>第 ${i+1} 轮</span>${m.teams.map(t=>{const k=t.kicks[i];return `<span class="${k?.goal?'scored':''}">${k?(k.goal?'✓ 进球':k.saved?'× 被扑':'× 射失'):'—'}</span>`;}).join('')}</div>`).join('')}</div><div class="finish-actions"><button class="primary" data-action="rematch">再赛一场 ${icon('arrow')}</button><div class="two-links"><button class="text-btn" data-action="home">返回首页</button>${m.mode==='advanced'?'<button class="text-btn" data-action="new">重新组队</button>':''}</div></div></section>`;
}
function sheet(title,body,type='info'){
  if(!modal)modalTrigger=document.activeElement;
  $('#header').inert=true;$('#screen').inert=true;
  modal=type;const root=$('#modal-root');root.innerHTML=`<div class="modal-backdrop"><section class="sheet" role="dialog" aria-modal="true" aria-label="${title}"><div class="sheet-header"><h2>${title}</h2><button class="icon-btn" data-action="close" aria-label="关闭">${icon('close')}</button></div><div class="sheet-content">${body}</div></section></div>`;root.querySelector('button')?.focus();
}
function closeModal(){frameTime=performance.now();paused=false;modal=null;$('#modal-root').innerHTML='';$('#header').inert=false;$('#screen').inert=false;pointer=null;autoCalibrate=false;if(modalTrigger?.isConnected)modalTrigger.focus({preventScroll:true});modalTrigger=null;}
function showRules(){if(active()){paused=true;}sheet('比赛规则',`<div class="rule-intro">五轮之间，攻守交替。<br>每一次选择都算数。</div><div class="rule"><b>01</b><p><strong>五轮决胜</strong>双方交替主罚，无法追平时提前结束。五轮平局后进入突然死亡，同轮一进一失决定胜负。</p></div><div class="rule"><b>02</b><p><strong>全员轮换</strong>11 人各罚一次后才能重复，包括门将。每脚仅一次射门，门框及门将反弹仍继续判定。</p></div><div class="rule"><b>03</b><p><strong>两种操作</strong>简洁版先选方向、再选力度，射门不限时。高级版滑动射门，10 秒超时自动中路轻射。</p></div><div class="rule"><b>04</b><p><strong>提前预判</strong>AI 在 3 秒后出脚。可提前选扑救方向，根据球速起扑；未预选可以在球飞行中作出一次侧扑。</p></div><p class="fine-print">操作时限、AI 节奏和专职门将限制为本游戏设定。模拟合法点球流程，全部球队及人物均为原创虚构。</p>`,active()?'pause':'info');}
function showPause(){if(state.phase==='home')return;paused=true;save();sheet('中场片刻',`<p class="sheet-lead">比赛已暂停，你的进度已经保留。</p><button class="primary full" data-action="close">继续比赛 ${icon('arrow')}</button>${['ready','result','lineup','coin','finish'].includes(state.phase)?'<button class="secondary full" data-action="calibration">力度校准</button>':''}<button class="secondary full" data-action="rules">比赛规则</button><button class="text-btn full" data-action="exit-confirm">返回首页</button>`,'pause');}
function showCalibration(){
  if(active()){toast('请在回合间隙调整力度');return;}
  const device=activeDevice==='touch'?'touch':activeDevice==='pen'?'pen':'mouse';
  sheet('找到你的出脚手感',`<p class="sheet-lead">轻轻划，还是用力划。让力度跟上你的习惯。</p><div class="device-tabs"><button data-action="device" data-device="mouse" class="${device==='mouse'?'active':''}">鼠标</button><button data-action="device" data-device="touch" class="${device==='touch'?'active':''}">触屏</button></div><label class="setting-label" for="threshold">满力度拖动距离 <strong id="threshold-label">${settings[device].toFixed(1)} × 基准距离</strong></label><input id="threshold" type="range" min="0.5" max="4" step="0.1" value="${settings[device]}"><div class="meter-labels"><span>轻划也有力</span><span>更大控制空间</span></div><div id="calibration-pad" class="calibration-pad"><span>${icon('hand')}</span><strong id="calibration-message">从这里向上划动</strong><small>按住鼠标左键拖动，也可以试滑</small><div class="gesture-power"><span id="calibration-fill"></span></div></div><div class="calibration-controls"><button class="secondary" data-action="auto-calibrate">三次校准</button><button class="secondary" data-action="reset-calibrate">恢复默认</button></div><p id="calibration-note" class="fine-print">比赛中按住拖动可反复调整力度；此设置改变拖动灵敏度，球员脚力决定球速。</p><button class="primary full" data-action="save-calibrate">保存设置 ${icon('check')}</button>`,'calibration');
  bindGesture($('#calibration-pad'),true);
  $('#threshold').addEventListener('input',e=>{settings[activeDevice]=Number(e.target.value);$('#threshold-label').textContent=`${Number(e.target.value).toFixed(1)} × 基准距离`;});
}
function showPlayer(team,index){const p=state.match.teams[team].players[index];if(active())paused=true;sheet(`${p.name} · ${p.position}`,`<div class="player-heading"><span class="jersey large">${p.number}</span><p>${state.match.teams[team].name}<small>原创球员 · ${penaltyStyle(p).name} · ${p.position==='门将'?'守门及主罚资格':'主罚资格'}</small></p></div>${[['射门精确度','accuracy'],['脚力','power'],['触球稳定性','touch'],...(state.match.mode==='advanced'?[['弧线能力','curve']]:[]),['心理承受能力','composure'],...(index===0?[['扑救速度','speed'],['扑救范围','reach'],['接球稳健性','handling']]:[])].map(([label,key])=>`<div class="attribute"><label>${label}<strong>${p[key]}</strong></label><div><span style="width:${p[key]}%"></span></div></div>`).join('')}<p class="fine-print">精确度控制落点误差，脚力影响球速，大力射门更依赖稳定性与综合能力，弧线能力影响旋转幅度。门将稳健性影响触球后的抱稳表现。</p>`,active()?'pause':'info');}
function newMatch(rematch=false){
  const old=state.match;closeModal();paused=false;
  const match=new Match(settings.mode,seed());
  if(rematch&&old){match.teams=old.teams.map(t=>({...t,goals:0,kicks:[]}));}
  match.aiFirst=match.rng.int(0,1);
  state={phase:settings.mode==='advanced'&&!rematch?'lineup':'coin',match,shot:null,turnTime:0,lockedX:0,dir:0,runup:0,aim:null};render();save();
}
function beginTurn(){state.lowShot=false;state.chipShot=false;state.turnTime=0;state.dir=0;state.runup=0;state.shot=null;state.aim=null;transition('ready');}
function launch(aim){if(state.phase==='runup'||state.phase==='flight'||state.phase==='result')return;state.aim=aim;state.runup=0;transition('runup');}
function release(){accumulator=0;const m=state.match;state.shot=m.shoot(state.aim,m.turn===0?m.aiDive:state.dir);sound('kick');transition('flight');}
function chooseDive(dir){
  if(!['guard','flight'].includes(state.phase)||state.match.turn!==1||paused)return;
  if(state.phase==='flight'){if(state.shot.dive(dir)){state.dir=dir;sound('tap');save();}else return;}
  else state.dir=state.dir===dir?0:dir;
  $('#guard-choice').textContent=state.dir===0?'中路待命':`${state.phase==='flight'?'扑向':'预判'}${state.dir>0?'左':'右'}路`;
  document.querySelectorAll('[data-action="dive"]').forEach(b=>{const selected=-Number(b.dataset.dir)===state.dir;b.classList.toggle('chosen',selected&&state.dir!==0);b.setAttribute('aria-pressed',String(selected));});
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-action]');if(!b||b.disabled)return;const a=b.dataset.action;
  if(['new','ready','first','shoot','lock','next'].includes(a))sound('tap');
  if(a==='mode'){settings.mode=b.dataset.mode;storeSettings();render();$(`[data-action="mode"][data-mode="${settings.mode}"]`).focus({preventScroll:true});}
  if(a==='new')newMatch();
  if(a==='rematch')newMatch(true);
  if(a==='coin')transition('coin');
  if(a==='first'){state.match.start(Number(b.dataset.first));beginTurn();}
  if(a==='ready'){state.turnTime=0;transition(state.match.turn===0?'aim':'guard');}
  if(a==='lock'&&state.phase==='aim'){state.lockedX=directionValue();transition('power');}
  if(a==='shoot'&&state.phase==='power')launch({x:state.lockedX,power:powerValue(),low:!!state.lowShot,chip:!!state.chipShot});
  if(a==='shot-type'&&['ready','aim','power'].includes(state.phase)&&state.match.turn===0){state.lowShot=b.dataset.low==='true';state.chipShot=b.dataset.low==='chip';if(state.aim){state.aim.low=state.lowShot;state.aim.chip=state.chipShot;}$('#controls').innerHTML=controls();$(`[data-action="shot-type"][data-low="${b.dataset.low}"]`).focus({preventScroll:true});save();}
  if(a==='dive')chooseDive(-Number(b.dataset.dir));
  if(a==='next'&&state.phase==='result'){if(state.match.winner!==null)transition('finish');else{state.match.next();beginTurn();}}
  if(a==='sound'){settings.sound=!settings.sound;storeSettings();header();if(settings.sound)sound('tap');}
  if(a==='rules')showRules();
  if(a==='pause')showPause();
  if(a==='close')closeModal();
  if(a==='player')showPlayer(Number(b.dataset.team),Number(b.dataset.player));
  if(a==='roster'){if(active())paused=true;sheet('双方球队',`<h3>雾港弧光 · 主罚顺序</h3>${rosterRows(0)}<h3>暮原流星 · 主罚顺序</h3>${rosterRows(1)}`,active()?'pause':'info');}
  if(a==='calibration'){showCalibration();}
  if(a==='device'){activeDevice=b.dataset.device;autoCalibrate=false;showCalibration();}
  if(a==='auto-calibrate'){calibration=[];autoCalibrate=true;$('#calibration-note').textContent='请用舒适、有力的手势试滑 3 次（0/3）。';}
  if(a==='reset-calibrate'){settings[activeDevice]=2;showCalibration();}
  if(a==='save-calibrate'){storeSettings();paused=false;closeModal();toast(storageOk?'力度设置已保存':'本次设置仅在当前页面保留');}
  if(a==='exit-confirm')sheet('结束这次比赛？','<p class="sheet-lead">返回首页会保留当前进度，可以稍后继续。</p><button class="primary full" data-action="home">返回首页</button><button class="secondary full" data-action="close">继续比赛</button>','pause');
  if(a==='home'){save();closeModal();paused=false;state.phase='home';state.shot=null;render();}
  if(a==='resume-save'){const saved=read(STORAGE);try{if(saved?.version!==1)throw Error();state=saved.state;state.match=Match.restore(state.match);if(state.shot)state.shot=Shot.restore(state.shot);settings.mode=state.match.mode;render();if(active())showPause();}catch{clearSave();state.phase='home';render();toast('旧进度无法恢复，请开始新比赛');}}
  if(a==='reload')location.reload();
});
function directionValue(){return directionMeter(state.turnTime);}
function powerValue(){return powerMeter(state.turnTime);}
function bindGesture(el,calibrate){
  if(!el)return;
  el.addEventListener('pointerdown',e=>{
    if((e.pointerType==='mouse'&&e.button!==0)||pointer)return;
    if(!calibrate&&(paused||state.match?.mode!=='advanced'||!['aim','guard','flight'].includes(state.phase)))return;
    if(!calibrate&&state.phase==='flight'&&state.match.turn===0)return;
    if(!calibrate)activeDevice=e.pointerType||'mouse';
    const r=el.getBoundingClientRect();pointer={id:e.pointerId,points:[{x:e.clientX-r.left,y:e.clientY-r.top,t:e.timeStamp}],r,el,calibrate};el.setPointerCapture(e.pointerId);e.preventDefault();
  });
  el.addEventListener('pointermove',e=>{
    if(pointer?.id!==e.pointerId||pointer.el!==el)return;
    const r=el.getBoundingClientRect();pointer.points.push({x:e.clientX-r.left,y:e.clientY-r.top,t:e.timeStamp});
    if(calibrate)return;
    if(state.match.turn===1){const delta=e.clientX-r.left-pointer.points[0].x;if(Math.abs(delta)>18){const dir=delta<0?1:-1;if(state.dir!==dir)chooseDive(dir);pointer.guardSelected=true;}return;}
    const line=$('#gesture-line path');if(line)line.setAttribute('d','');
    if(state.match.turn===0){const input=shotInput(pointer.points,r);state.aim=input;if(input){$('#power-fill').style.width=`${input.power*100}%`;$('#power-value').textContent=`力度 ${Math.round(input.power*100)}% · ${input.chip?'勺子点球':input.low?'低平球':Math.abs(input.curve)>.15?'弧线':'直射'}`;}else{$('#power-fill').style.width='0%';$('#power-value').textContent='向上拖动';}}
  });
  el.addEventListener('pointerup',e=>{
    if(pointer?.id!==e.pointerId||pointer.el!==el)return;
    const data=pointer;pointer=null;const r=el.getBoundingClientRect();data.points.push({x:e.clientX-r.left,y:e.clientY-r.top,t:e.timeStamp});
    if(el.hasPointerCapture(e.pointerId))el.releasePointerCapture(e.pointerId);
    const input=calibrate?gestureInput(data.points,r.width,r.height,settings[activeDevice]||2,true):shotInput(data.points,r);
    if(calibrate){
      if(!input){$('#calibration-message').textContent='请向上划动一小段距离';return;}
      $('#calibration-fill').style.width=`${input.power*100}%`;$('#calibration-message').textContent=`${input.distance.toFixed(2)} × 基准距离 · 力度 ${Math.round(input.power*100)}%`;
      if(autoCalibrate){calibration.push(input.distance);$('#calibration-note').textContent=`有效试滑 ${calibration.length}/3`;if(calibration.length===3){const median=calibration.sort((a,b)=>a-b)[1];settings[activeDevice]=Math.round(clamp(median/.85,.5,4)*10)/10;autoCalibrate=false;$('#threshold').value=settings[activeDevice];$('#threshold-label').textContent=`${settings[activeDevice].toFixed(1)} × 基准距离`;$('#calibration-note').textContent='校准完成，舒适的有力划动约对应 85% 力度。点击保存即可。';}}return;
    }
    $('#gesture-line path')?.setAttribute('d','');
    if(paused)return;
    if(state.match.turn===1){const delta=data.points.at(-1).x-data.points[0].x;if(!data.guardSelected&&Math.abs(delta)>18)chooseDive(delta<0?1:-1);return;}
    if(state.phase!=='aim')return;
    if(state.turnTime>=10){launch({x:0,power:0,timeout:true});toast('操作超时，自动轻射中路');return;}
    if(input)launch(input);else toast('向上划动一段距离，再松手射门');
  });
  const cancel=()=>{if(pointer?.el===el){pointer=null;$('#gesture-line path')?.setAttribute('d','');state.aim=null;}};
  el.addEventListener('pointercancel',cancel);el.addEventListener('lostpointercapture',cancel);
}
function runupDuration(){return penaltyStyle(state.match?.teams[state.match.turn]?.players[state.match.kicker]).duration;}
function frame(now){
  if(document.hidden){frameTime=now;requestAnimationFrame(frame);return;}
  const realDt=Math.max(0,(now-frameTime)/1000||.016),dt=Math.min(.25,realDt);frameTime=now;if(!paused)elapsed+=dt;
  if(!paused&&active()){
    let flightDt=dt;
    if(['aim','power','guard'].includes(state.phase))state.turnTime+=realDt;
    if(state.phase==='aim'&&state.match.mode==='advanced'&&state.turnTime>=10){pointer=null;launch({x:0,power:0,timeout:true});toast('操作超时，自动轻射中路');}
    if(state.phase==='guard'&&state.turnTime>=3){flightDt=Math.min(dt,state.turnTime-3);state.aim=state.match.aiAim;release();}
    if(state.phase==='runup'){state.runup+=realDt;if(state.runup>=runupDuration()){flightDt=Math.min(dt,state.runup-runupDuration());release();}}
    if(state.phase==='flight'){
      const rate=state.shot.playbackRate();accumulator+=flightDt*rate;while(accumulator>=1/120&&!state.shot.result){state.shot.step(1/120,rate);accumulator-=1/120;}
      if(state.shot.result){accumulator=0;state.match.record(state.shot.result);sound(state.shot.result.goal?'goal':'save');transition('result');}
    }
    saveClock+=dt;if(saveClock>1){saveClock=0;save();}
  }
  const ind=$('#indicator');if(ind)ind.style.left=`${state.phase==='aim'?(directionValue()/4.6+1)*50:powerValue()*100}%`;
  const timer=$('#timer');if(timer&&state.phase!=='ready'){
    const attack=state.match.turn===0;
    const timerText=state.phase==='flight'&&state.shot.playbackRate()>1?'尾段快进':state.phase==='runup'?'助跑中':['flight','result'].includes(state.phase)?'已出脚':attack?(state.match.mode==='simple'?'不限时':`${Math.max(0,10-state.turnTime).toFixed(1)} 秒`):`${Math.max(0,3-state.turnTime).toFixed(1)} 秒`;
    if(timer.textContent!==timerText)timer.textContent=timerText;
    timer.classList.toggle('urgent',attack&&state.match.mode==='advanced'&&state.phase==='aim'&&state.turnTime>7);
  }
  let aim=null;
  if(state.phase==='aim')aim=state.match?.mode==='simple'?{x:directionValue(),y:1.2}:state.aim;
  if(state.phase==='power')aim={x:state.lockedX,y:state.lowShot?.11:.28+powerValue()*2,low:!!state.lowShot,chip:!!state.chipShot,power:powerValue()};
  stage?.update(paused?0:dt,elapsed,state.shot,state.phase==='runup'?state.runup/runupDuration():state.phase==='guard'?clamp((state.turnTime-(3-runupDuration()))/runupDuration(),0,1):0,aim,state.match&&state.phase!=='home'?state.match:null,state.phase==='guard'?state.match.aiAim:state.aim,clamp(accumulator*120,0,1));
  requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange',()=>{if(document.hidden&&active()&&!paused){pointer=null;showPause();}});
window.addEventListener('blur',()=>{if(active()&&!paused){pointer=null;showPause();}});
window.addEventListener('pagehide',save);
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(modal)closeModal();else showPause();}if(e.key==='Tab'&&modal){const focusable=[...$('#modal-root').querySelectorAll('button:not(:disabled),input')];if(!focusable.length)return;const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
if(new URLSearchParams(location.search).has('debug'))window.penaltyDebug={get state(){return state;},get settings(){return settings;},Match,Shot};
render();requestAnimationFrame(frame);

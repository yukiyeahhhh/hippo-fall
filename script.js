
window.onerror=function(msg,src,line,col,err){
  document.body.innerHTML='<div style="padding:20px;font-family:monospace;color:#c00;background:#fff"><b>⚠ JS Error (line '+line+')</b><br>'+msg+'<br><br>'+(err&&err.stack?err.stack:'')+'</div>';
  return true;
};

// ─ 定数 ─
let COLS=5,ROWS=8;
const DANGER_ROW=1;
const WAVE_INTERVAL=10;     // 波の初期間隔（手数）
let _dpWaveInterval=10,_dpBlockRate=0.35; // デバッグパネル用パラメータ

// ─ ステージ設定（盤面常に7×10固定） ─
const BOARD_COLS=7,BOARD_ROWS=10; // 全ステージ共通
// 難易度は「ギミック出現量」で調整（進行するほどクルミ/貝殻を絞る＝救済を減らす）。波スピード・瓦礫量は触らない
// rWalnut/rShell＝瓦礫落下での出現確率、wWalnut/wShell＝せりあがり波での混入確率
const STAGE_CONFIG=[
  null,
  {goal:1, rWalnut:1.00, rShell:0.35, wWalnut:0.15, wShell:0.05}, // Stage 1
  {goal:2, rWalnut:1.00, rShell:0.30, wWalnut:0.13, wShell:0.04}, // Stage 2
  {goal:2, rWalnut:0.80, rShell:0.22, wWalnut:0.10, wShell:0.03}, // Stage 3
  {goal:3, rWalnut:0.60, rShell:0.15, wWalnut:0.07, wShell:0.02}, // Stage 4
  {goal:3, rWalnut:0.45, rShell:0.10, wWalnut:0.05, wShell:0.015},// Stage 5（エンドレスもこれ）
];
const TOTAL_STAGES=5;
const ANIMALS=[null,{emo:'🐹',nm:'ハムスター',cls:'t1'},{emo:'🐿️',nm:'リス',cls:'t2'},{emo:'🦆',nm:'アヒル',cls:'t3'},{emo:'🦦',nm:'カワウソ',cls:'t4'},{emo:'🦛',nm:'コビトカバ',cls:'t5'}];
// ギミック（おじゃまブロック同様、重力で積む障害物。合体不可・カバの全破壊で一緒に消える）
const GIMMICKS={walnut:{emo:'🌰',nm:'クルミ',cls:'walnut'},shell:{emo:'🦪',nm:'貝殻',cls:'shell'}};
const MAX_TIER=5,MAX_CHAIN=9;
const LS_KEY='animalDrop_roguelite_v2';

// ─ DOM要素 ─
const gridEl=document.getElementById('grid'),tilesEl=document.getElementById('tiles');
const cnowEl=document.getElementById('cnow'),cnextEl=document.getElementById('cnext');
const boardEl=document.getElementById('board'),overlay=document.getElementById('overlay');
const riseCountEl=document.getElementById('riseCount');
let bgCells=[];
for(let i=0;i<COLS*ROWS;i++){const d=document.createElement('div');d.className='bg';const row=Math.floor(i/COLS);if(row===0)d.classList.add('dz0');else if(row===1)d.classList.add('dz1');gridEl.appendChild(d);bgCells.push(d);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// ─ 状態変数 ─
let grid,tiles,uid,current,next,maxChain,activeDropId=0,gameVersion=0,busy=false;
let totalDrops=0;
let waveCount=0; // これまでに来た波の回数
let survivedDrops=0; // 生き残った手数
let dropsUntilWave=10; // 次の波までの手数
let currentWaveInterval=10; // 現在の波間隔
let nextWaveNoBlocks=false; // リス「ひとやすみ」：次の1回の波はブロックを出さない
const LS_LOG_KEY='animalDrop_gamelog_v1';
function loadGameLog(){try{return JSON.parse(localStorage.getItem(LS_LOG_KEY)||'[]');}catch(e){return[];}}
function saveGameLog(){try{localStorage.setItem(LS_LOG_KEY,JSON.stringify(gameLog));}catch(e){}}
const gameLog=loadGameLog();

// ─ アクティブスキル（進化で獲得・盤面外スロット） ─
// charge＝そのスキル元の動物が1回できるたびに溜まる量。作りにくい動物ほど一発が太い
// （リス+12.5%＝8回／アヒル+20%＝5回／カワウソ+50%＝2回。素合体だけだとアヒル以上は遠い＝クルミ前提）
let activeSkills={
  squirrel:   {emoji:'🐿️', name:'ひとやすみ', gauge:0, fromTier:2, charge:0.125},
  duck_march: {emoji:'🦆', name:'あつまれ',   gauge:0, fromTier:3, charge:0.20},
  refresh:    {emoji:'🦦', name:'おてだま',   gauge:0, fromTier:4, charge:0.50}
};
let aiming=null; // 照準モード {key, picks:[ids]}。アヒル/カワウソが対象選択を待つ状態

// ─ ステージ進行 ─
let gamePaused=false;   // カットイン等の演出中フラグ
// ─ ステージ ─
let currentStage=1;
let hippoMade=0;     // 現ステージで作ったカバ数
let hippoGoal=1;     // 現ステージの目標カバ数

// ─ ユーティリティ ─
function getSpeedLevel(){return waveCount;} // 波数を進行度として使う
function isClearable(id){if(!id||!tiles[id])return false;return !tiles[id].rock;}

// ─ LocalStorage ─
function loadHistory(){try{return JSON.parse(localStorage.getItem(LS_KEY)||'[]');}catch(e){return[];}}
function saveHistory(e){let h=loadHistory();h.unshift(e);h=h.sort((a,b)=>(b.stage||0)-(a.stage||0)||(b.maxChain||0)-(a.maxChain||0)).slice(0,5);try{localStorage.setItem(LS_KEY,JSON.stringify(h));}catch(e){}return h;}
function renderHistory(h){const el=document.getElementById('historyList');if(!el)return;el.innerHTML=h.slice(0,5).map((e,i)=>{const m=['🥇','🥈','🥉','4.','5.'][i];const d=new Date(e.date);const ds=`${d.getMonth()+1}/${d.getDate()}`;const stageStr=e.stage?`Stage${e.stage}`:'?';return`<li><span class="history-rank">${m}</span><span>${stageStr}</span><span>最大${e.maxChain}チェイン</span><span>${ds}</span></li>`;}).join('');}

// ─ 共有 AudioContext ─
let _audioCtx=null;
function getCtx(){if(!_audioCtx)try{_audioCtx=new(window.AudioContext||window.webkitAudioContext)();}catch(e){}if(_audioCtx&&_audioCtx.state==='suspended')_audioCtx.resume();return _audioCtx;}
let _sfxVol=1.5;
function tone(freq,type,dur,vol=0.28,t=0){const c=getCtx();if(!c)return;const o=c.createOscillator(),g=c.createGain();o.type=type;o.frequency.value=freq;const v=Math.min(vol*_sfxVol,2.0);g.gain.setValueAtTime(v,c.currentTime+t);g.gain.exponentialRampToValueAtTime(0.001,c.currentTime+t+dur);o.connect(g);g.connect(c.destination);o.start(c.currentTime+t);o.stop(c.currentTime+t+dur+0.05);}

// ─ SFX ─
const SFX={
  drop(){tone(100,'sine',0.07,0.72);},
  merge(tier){tone(220+tier*55,'sine',0.13,0.22);tone(220+tier*55+35,'sine',0.08,0.13,0.07);},
  bigmerge(tier){for(let i=0;i<3;i++)tone(260+tier*70+i*45,'sine',0.11,0.18,i*0.07);},
  rowclear(){tone(80,'sawtooth',0.22,0.32);for(let i=0;i<4;i++)tone(110+i*80,'sine',0.14,0.18,0.06+i*0.07);},
  itemSpawn(){for(let i=0;i<4;i++)tone(380+i*140,'sine',0.08,0.16,i*0.05);},
  itemHamster(){tone(700,'sawtooth',0.18,0.18);const c=getCtx();if(!c)return;const o=c.createOscillator(),g=c.createGain();o.type='sawtooth';o.frequency.setValueAtTime(650,c.currentTime);o.frequency.exponentialRampToValueAtTime(180,c.currentTime+0.22);g.gain.setValueAtTime(0.18,c.currentTime);g.gain.exponentialRampToValueAtTime(0.001,c.currentTime+0.25);o.connect(g);g.connect(c.destination);o.start(c.currentTime);o.stop(c.currentTime+0.28);},
  itemSquirrel(){[320,480,640,800,960,1120].forEach((f,i)=>tone(f,'sine',0.1,0.18,i*0.045));},
  itemDuck(){for(let i=0;i<5;i++)tone(600-i*80,'sine',0.12,0.14,i*0.055);tone(180,'sine',0.3,0.12,0.1);},
  itemOtter(){tone(90,'sawtooth',0.08,0.35);[250,190,130].forEach((f,i)=>tone(f,'sawtooth',0.06,0.2,0.04+i*0.05));},
  itemHippo(lv){if(lv>=2){tone(40,'sawtooth',0.5,0.55);for(let i=0;i<6;i++)tone(220-i*25,'square',0.18,0.22,i*0.07);}else{tone(60,'sawtooth',0.35,0.42);for(let i=0;i<3;i++)tone(160-i*22,'square',0.13,0.18,0.05+i*0.07);}},
  rise(){tone(150,'sawtooth',0.09,0.16);tone(190,'sawtooth',0.07,0.13,0.1);},
  gameover(){[400,340,280,200].forEach((f,i)=>tone(f,'sawtooth',0.22,0.2,i*0.13));},
  draft(){[0,1,2,3,4].forEach(i=>tone(520+i*140,'sine',0.10,0.13,i*0.058));tone(1100,'sine',0.13,0.25,0.32);},
  chain(n){for(let i=0;i<Math.min(n,5);i++)tone(280+i*110,'square',0.08,0.12,i*0.06);},
};

// ─ BGM（ホンワカ合成） ─
const MUSIC=(()=>{
  let mGain,seqTimer,running=false,step=0,nextBeat=0,paused=false;
  const hz=s=>261.63*Math.pow(2,s/12);

  const N_MEL=[
    [19,.09], null,   [16,.08], null,
    [12,.09], null,   [16,.08], null,
  ];
  const N_BAS=[
    [-12,.07], null, null, null,
    [-5,.07],  null, null, null,
  ];
  const N_DECO=[
    null, [24,.035], null, null,
    null, null, [21,.035], null,
  ];

  function noteW(semit,vol,time,dur){
    const c=getCtx();if(!c)return;
    const o=c.createOscillator(),g=c.createGain();
    o.type='sine';o.frequency.value=hz(semit);
    o.detune.value=(Math.random()-.5)*4;
    g.gain.setValueAtTime(0,time);
    g.gain.linearRampToValueAtTime(vol,time+0.014);
    g.gain.exponentialRampToValueAtTime(0.0001,time+dur);
    o.connect(g);g.connect(mGain);o.start(time);o.stop(time+dur+0.04);
    const o2=c.createOscillator(),g2=c.createGain();
    o2.type='sine';o2.frequency.value=hz(semit+7);
    g2.gain.setValueAtTime(0,time);
    g2.gain.linearRampToValueAtTime(vol*.09,time+0.02);
    g2.gain.exponentialRampToValueAtTime(0.0001,time+dur*.45);
    o2.connect(g2);g2.connect(mGain);o2.start(time);o2.stop(time+dur*.5);
  }

  function sched(){
    if(!running)return;
    const c=getCtx();if(!c)return;
    const beat=60/75;
    while(nextBeat<c.currentTime+0.2){
      const i=step%8;
      if(N_MEL[i]) noteW(N_MEL[i][0],N_MEL[i][1],nextBeat,beat*.68);
      if(N_BAS[i]) noteW(N_BAS[i][0],N_BAS[i][1],nextBeat,beat*.85);
      if(N_DECO[i])noteW(N_DECO[i][0],N_DECO[i][1],nextBeat,beat*.5);
      step++;nextBeat+=beat;
    }
    seqTimer=setTimeout(sched,25);
  }

  function init(){
    const c=getCtx();if(!c)return false;
    if(!mGain){
      mGain=c.createGain();mGain.gain.value=0;
      const dly=c.createDelay(.3);dly.delayTime.value=.2;
      const df=c.createGain();df.gain.value=.09;
      mGain.connect(c.destination);mGain.connect(dly);dly.connect(df);df.connect(c.destination);
    }
    return true;
  }
  return{
    start(){
      if(!init()||running)return;
      running=true;step=0;
      nextBeat=getCtx().currentTime+.3;
      mGain.gain.setValueAtTime(0,getCtx().currentTime);
      mGain.gain.linearRampToValueAtTime(.38,getCtx().currentTime+2);
      sched();
    },
    pause(){
      // レベルアップ時の一時停止（音量をほぼ0に）
      if(mGain)mGain.gain.setTargetAtTime(0.02,getCtx().currentTime,.2);
      paused=true;
    },
    resumeFromPause(){
      if(mGain)mGain.gain.setTargetAtTime(.38,getCtx().currentTime,.3);
      paused=false;
    },
    stop(){running=false;clearTimeout(seqTimer);if(mGain)mGain.gain.setTargetAtTime(0,getCtx().currentTime,.5);},
    resume(){init();}
  };
})();

// ─ BGM（MP3ファイル再生） ─
const BGM=(()=>{
  const TRACKS=[
    {id:'auto',    label:'🔄 ステージ連動',          src:null},
    {id:'original',label:'🎹 オリジナル（合成音）',   src:null},
    {id:'bgm01',   label:'01 Slow Morning at the Glade',       src:'assets/bgm/bgm01.mp3'},
    {id:'bgm02',   label:'02 The Window Seat',                  src:'assets/bgm/bgm02.mp3'},
    {id:'bgm03',   label:'03 The Copper Pendulum',              src:'assets/bgm/bgm03.mp3'},
    {id:'bgm04',   label:'04 Midday at the Village Square',      src:'assets/bgm/bgm04.mp3'},
    {id:'bgm05',   label:'05 Under the Twilit Pines',           src:'assets/bgm/bgm05.mp3'},
    {id:'bgm06',   label:'06 Where the Tea Steeped',            src:'assets/bgm/bgm06.mp3'},
    {id:'dew',     label:'🌼 Dew on the Marigolds（タイトル用）', src:'assets/bgm/dew.mp3'},
    {id:'off',     label:'🔇 BGMオフ',                         src:null},
  ];
  function stageToId(stage){
    if(stage<=1)return 'bgm01';
    if(stage<=2)return 'bgm02';
    if(stage<=3)return 'bgm03';
    if(stage<=4)return 'bgm04';
    if(stage<=5)return 'bgm05';
    return 'bgm06'; // エンドレス
  }
  const LS_BGM='animalDrop_bgm_v1';
  let sel='auto';
  let vol=0.5;
  const audio=new Audio();
  audio.loop=true;
  let playingId=null;
  try{const s=JSON.parse(localStorage.getItem(LS_BGM)||'{}');sel=s.sel||'auto';vol=s.vol??0.5;_sfxVol=s.sfxVol??1.5;}catch(e){}
  function save(){try{localStorage.setItem(LS_BGM,JSON.stringify({sel,vol,sfxVol:_sfxVol}));}catch(e){}}
  function stopAudio(){audio.pause();audio.src='';playingId=null;}
  function playMp3(id){
    const t=TRACKS.find(t=>t.id===id);if(!t||!t.src)return;
    if(playingId===id&&!audio.paused)return;
    // pauseせずsrcを変更：audio要素をplaying状態に保つことでiOS Safariのautoplay制限を回避
    audio.src=t.src;
    audio.volume=vol;
    audio.play().catch(()=>{});
    playingId=id;
  }
  function applyNow(stage){
    const effectiveId=(sel==='auto')?stageToId(stage??currentStage??1):sel;
    if(effectiveId==='off'){stopAudio();MUSIC.stop();return;}
    if(effectiveId==='original'){stopAudio();MUSIC.start();return;}
    MUSIC.stop();playMp3(effectiveId);
  }
  return{
    tracks:TRACKS,
    getSel(){return sel;},
    getVol(){return vol;},
    getSfxVol(){return _sfxVol;},
    setSel(id,stage){sel=id;save();applyNow(stage);},
    setVol(v){vol=v;save();audio.volume=vol;},
    setSfxVol(v){_sfxVol=v;save();},
    onStageChange(stage){if(sel==='auto')applyNow(stage);},
    start(stage){applyNow(stage);},
    stop(){stopAudio();MUSIC.stop();},
    pause(){audio.pause();},
    resumeFromPause(){if(audio.src)audio.play().catch(()=>{});},
  };
})();

// ── killカウント ──
function addKill(tier){
  if(!tier||tier<1||tier>MAX_TIER)return;
  const prevTotal=getTotalKills();
  killCounts[tier]=(killCounts[tier]||0)+1;
  const newTotal=getTotalKills();
  updateLevelUI();
}
function updateStageUI(){
  const isEndless=currentStage>TOTAL_STAGES;
  // 上部ゴール表示
  const gb=document.getElementById('goalFill');
  if(gb)gb.style.width=isEndless?100:Math.min(100,hippoMade/hippoGoal*100)+'%';
  const gc=document.getElementById('goalCount');
  if(gc)gc.textContent=isEndless?'累計 '+hippoMade+'匹':hippoMade+'/'+hippoGoal;
  const gl=document.getElementById('goalLabel');
  if(gl)gl.innerHTML=isEndless?'🎮 <b>ENDLESS</b> ／ カバ累計':'STAGE <b id="stageNum">'+currentStage+'</b> ／ カバ作成';
  const sn=document.getElementById('stageNum');
  if(sn)sn.textContent=isEndless?'∞':currentStage;
  // サイドパネルのステージ情報
  const ssn=document.getElementById('ssNum');
  if(ssn){ssn.textContent=isEndless?'∞':currentStage+'/'+TOTAL_STAGES;ssn.style.fontSize=isEndless?'28px':'22px';}
  const ssc=document.getElementById('ssCount');
  if(ssc)ssc.textContent=isEndless?'累計 '+hippoMade+'匹':hippoMade+'/'+hippoGoal;
}
function getStageGoal(stage){
  if(stage>=1&&stage<=TOTAL_STAGES)return STAGE_CONFIG[stage].goal;
  return STAGE_CONFIG[TOTAL_STAGES].goal; // エンドレスは最終ステージと同じ目標数
}
// 現在ステージのギミック出現設定（エンドレスは最終ステージと同じ）
function curStageCfg(){return STAGE_CONFIG[Math.min(currentStage,TOTAL_STAGES)];}
// updateLevelUI互換シム（既存呼び出し対応用）
function updateLevelUI(){updateStageUI();}
function toggleLogPanel(){
  const p=document.getElementById('logPanel');if(!p)return;
  const show=p.classList.toggle('show');
  if(show){history.pushState({modal:'log'},'');renderLogPanel();}
}
function renderLogPanel(){
  const el=document.getElementById('logPanelList');if(!el)return;
  el.innerHTML='';
  if(!gameLog||gameLog.length===0){
    const d=document.createElement('div');d.className='log-empty';d.textContent='まだ記録がないよ';el.appendChild(d);return;
  }
  const typeIcon={chain:'🔥',warn:'🔺',item:'✨',toast:'💬',cutin:'🎬',stage:'📌'};
  for(let i=0;i<gameLog.length;i++){
    const e=gameLog[i];
    const row=document.createElement('div');row.className='log-entry log-'+(e.type||'');
    const ico=document.createElement('span');ico.className='log-ico';ico.textContent=typeIcon[e.type]||'•';
    const txt=document.createElement('span');txt.className='log-txt';txt.textContent=e.txt||'';
    const drop=document.createElement('span');drop.className='log-drop';drop.textContent=(e.drop||0)+'手';
    row.appendChild(ico);row.appendChild(txt);row.appendChild(drop);
    el.appendChild(row);
  }
}
function getTotalKills(){return Object.values(killCounts).reduce((a,b)=>a+b,0);}
function getWaveRows(){return 1;} // 常に1段固定
function getRockChance(){
  return typeof _dpBlockRate!=='undefined'?_dpBlockRate:0.35;
}
function rollTier(){const r=Math.random()*100;return r<70?1:r<95?2:3;} // ハム70%、リス25%、アヒル5%、カワウソ0%
function rollRiseTier(){const r=Math.random();return r<.45?1:r<.73?2:r<.89?3:4;} // フラット
function updateAtmosphere(){document.body.className=currentStage>TOTAL_STAGES?'endless':currentStage>1?'s'+currentStage:'';}
function updateRiseCounter(){
  riseCountEl.textContent='🔺 次のせりあがりまで：あと'+Math.max(0,dropsUntilWave)+'手';
  riseCountEl.classList.toggle('warn',dropsUntilWave<=3);
}
function updateQueue(){cnowEl.className='e t'+current;cnowEl.textContent='';cnextEl.className='e t'+next;cnextEl.textContent='';}

// ─ 波間隔 ─
function resetWaveInterval(){
  const base=typeof _dpWaveInterval!=='undefined'?_dpWaveInterval:WAVE_INTERVAL;
  currentWaveInterval=base;
  dropsUntilWave=base;
}

// ─ アクティブスキル操作（ヘルパ） ─
function addSkillGauge(key,amount){
  const s=activeSkills[key];if(!s)return;
  if(s.gauge>=1)return; // 満タン時は無視（破棄メッセージなし）
  const prev=s.gauge;
  s.gauge=Math.min(1,s.gauge+amount);
  if(prev<1&&s.gauge>=1)floatEl('item',s.emoji+' '+s.name+' MAX！');
  updateSkillSlotsUI();
}
function addActiveSkill(key){const s=activeSkills[key];if(s)addSkillGauge(key,s.charge);}

// ─ UI更新（プレースホルダ：フェーズCで本実装） ─
function updateSkillSlotsUI(){
  for(const key of Object.keys(activeSkills)){
    const el=document.getElementById('slot-'+key);
    if(!el)continue;
    const s=activeSkills[key];
    const ready=s.gauge>=1;
    const lct=el.querySelector('.lct');
    if(lct)lct.textContent=ready?'使える!':Math.round(s.gauge*100)+'%';
    const bar=el.querySelector('.scbf');
    if(bar)bar.style.width=(s.gauge*100)+'%';
    el.style.opacity=s.gauge>0?'1':'.4';
    el.classList.toggle('skill-ready',ready);
    el.classList.toggle('skill-aiming',!!aiming&&aiming.key===key);
  }
}
// ─ カットイン演出（基盤） ─
const CUTIN_IMAGES={
  'リスのひとやすみ！':    'assets/cutin_squirrel.webp',
  'アヒルのあつまれ！':    'assets/cutin_duck_march.webp',
  'カワウソのおてだま！':  'assets/cutin_refresh.webp',
  'コビトカバ誕生！':      'assets/cutin_hippo_born.webp',
};
(()=>{Object.values(CUTIN_IMAGES).forEach(src=>{const i=new Image();i.src=src;});})();
async function showCutin(title, message, duration=2200){
  pushLog('cutin','🎬 '+title);
  gamePaused=true;
  const el=document.getElementById('cutinOverlay');
  const img=document.getElementById('cutinImg');
  const src=CUTIN_IMAGES[title]||'';
  img.src=src;
  document.getElementById('cutinTitle').textContent=title;
  document.getElementById('cutinMessage').textContent=message;
  el.classList.add('show');
  await sleep(duration);
  el.classList.remove('show');
  img.src='';
  gamePaused=false;
}

// ─ アクティブスキル発動 ─
function activateSkill(key){
  if(overlay.classList.contains('show'))return;
  const s=activeSkills[key];if(!s)return;
  // 照準中にスキルを押したら一旦キャンセル（同じスキルならそのまま終了＝やめる）
  if(aiming){const cur=aiming.key;cancelAiming();if(cur===key)return;}
  if(busy||gamePaused||s.gauge<1)return;
  // 照準系（対象選択が要る）
  if(key==='duck_march'){startAiming('duck_march','🦆 あつまれ：集めたい動物をタップ（もう一度🦆でやめる）');return;}
  if(key==='refresh'){startAiming('refresh','🦦 おてだま：入れ替える2匹をタップ（もう一度🦦でやめる）');return;}
  // 即時系（リス）
  s.gauge=0;updateSkillSlotsUI();
  busy=true;
  (async()=>{
    try{
      if(key==='squirrel')await applySquirrelRest();
      await finishSkillResolve();
    }finally{busy=false;}
  })();
}

// スキルで盤面を動かした後の共通処理（重力→連鎖→カバ全破壊→クリア判定→詰み判定）
async function finishSkillResolve(){
  applyGravity();render();await sleep(200);
  const born=await resolveBoard();
  if(born)await handleHippoBorn();
  await checkStageClear();
  if(isDanger()){endGame('💥','ブロックがあふれちゃった…');return;}
  checkClose();
}

// ─ 照準モード（アヒル/カワウソ共通） ─
function startAiming(key,msg){
  aiming={key,picks:[]};
  showAimBanner(msg);
  boardEl.classList.add('aiming');
  updateSkillSlotsUI();
}
function cancelAiming(){
  if(!aiming)return;
  for(const id of aiming.picks){if(tiles[id]){const el=document.getElementById('tile-'+id);if(el)el.classList.remove('aim-pick');}}
  aiming=null;hideAimBanner();boardEl.classList.remove('aiming');updateSkillSlotsUI();
}
function showAimBanner(msg){const b=document.getElementById('aimBanner');if(b){b.textContent=msg;b.classList.add('show');}}
function hideAimBanner(){const b=document.getElementById('aimBanner');if(b)b.classList.remove('show');}
// 照準モード中の盤面タップ
function handleAimTap(row,col){
  if(busy||!aiming)return;
  const id=grid[row]?.[col];
  if(!id||!tiles[id]||tiles[id].rock){floatEl('toast','動物をタップしてね');return;}
  if(aiming.key==='duck_march'){
    const tier=tiles[id].tier;
    cancelAiming();
    activeSkills.duck_march.gauge=0;updateSkillSlotsUI();
    busy=true;
    (async()=>{try{await runDuckMarch(tier,col);await finishSkillResolve();}finally{busy=false;}})();
  }else if(aiming.key==='refresh'){
    // 既に選んだ動物を再タップ→選択解除
    if(aiming.picks.includes(id)){
      aiming.picks=aiming.picks.filter(x=>x!==id);
      const el=document.getElementById('tile-'+id);if(el)el.classList.remove('aim-pick');
      return;
    }
    aiming.picks.push(id);
    const el=document.getElementById('tile-'+id);if(el)el.classList.add('aim-pick');
    if(aiming.picks.length>=2){
      const[a,b]=aiming.picks;
      cancelAiming();
      activeSkills.refresh.gauge=0;updateSkillSlotsUI();
      busy=true;
      (async()=>{try{await runOtterSwap(a,b);await finishSkillResolve();}finally{busy=false;}})();
    }
  }
}
// ─ アクティブスキル効果 ─

// 🐿️ リスのひとやすみ：せりあがり手数を満タンに巻き戻し、次の1回の波はブロックなし（破壊も降下もしない＝時間稼ぎ）
async function applySquirrelRest(){
  SFX.itemSquirrel();await showCutin('リスのひとやすみ！','');
  resetWaveInterval(); // せりあがり手数を満タンに巻き戻す
  nextWaveNoBlocks=true; // 次の1回の波は動物だけ
  updateRiseCounter();
  floatEl('item','🐿️ せりあがりリセット！');
  await sleep(500);
}

// 🦆 アヒルのあつまれ：指定tierの動物が全員、タップした列にドサッと集合する→縦に並んで自動合体
// その列が埋まったら近い列へあふれる（＝混んだ盤面ほど集まりきらない＝仕様の「入る分だけ」）
async function runDuckMarch(tier,anchorCol){
  SFX.itemDuck();await showCutin('アヒルのあつまれ！','');
  const members=[];
  for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++){const id=grid[r][c];if(id&&tiles[id]&&!tiles[id].rock&&tiles[id].tier===tier)members.push(id);}
  if(members.length<2){floatEl('toast','🦆 集める仲間がいない');return;}
  // 集合先の列＝タップした列
  const lc=anchorCol;
  // 全メンバーを一旦外し、残りを重力で下詰めにする（他の動物は押しのけず自然に落ちるだけ）
  for(const id of members){const t=tiles[id];grid[t.r][t.c]=0;}
  applyGravity();
  // タップした列から近い順に、各列の空き（重力後は上側に連続）へ下から積む
  const cols=[...Array(COLS).keys()].sort((a,b)=>Math.abs(a-lc)-Math.abs(b-lc)||a-b);
  const slots=[];
  for(const c of cols)for(let r=ROWS-1;r>=0;r--){if(!grid[r][c])slots.push({r,c});}
  let placed=0;
  for(const id of members){
    const cell=slots[placed];if(!cell)break; // 入りきらない分はそのまま消える前提だが盤面外には出ない
    const t=tiles[id];t.r=cell.r;t.c=cell.c;grid[cell.r][cell.c]=id;t.skillHit=true;placed++;
  }
  render();floatEl('item','🦆 あつまれ！');
  await sleep(450);
}

// 🦦 カワウソのおてだま：選んだ動物2匹の位置を入れ替える（入替後に自動合体）
async function runOtterSwap(idA,idB){
  SFX.itemOtter();await showCutin('カワウソのおてだま！','');
  const A=tiles[idA],B=tiles[idB];
  if(!A||!B||A.rock||B.rock){floatEl('toast','🦦 入れ替えできなかった');return;}
  const ar=A.r,ac=A.c,br=B.r,bc=B.c;
  grid[ar][ac]=idB;grid[br][bc]=idA;
  A.r=br;A.c=bc;B.r=ar;B.c=ac;
  A.skillHit=true;B.skillHit=true;
  render();floatEl('item','🦦 おてだま！');
  await sleep(400);
}

// ─ 発破職人：ブロック跡地にハムスタースポーン ─
function spawnHamsterAt(r,c){
  if(grid[r][c])return; // 既に何かあれば諦める
  const id=uid++;
  const t={id,tier:1,r,c,spawn:true};
  tiles[id]=t;grid[r][c]=id;paint(t);
}

// ─ カバ誕生：盤面を全破壊 → 瓦礫が落ちて新しい初期盤面（コアループの心臓） ─
async function handleHippoBorn(){
  await obliterateBoard();
  // このカバでステージクリアするなら盤面は作らない（クリア演出が次盤面を用意する）
  if(currentStage<=TOTAL_STAGES && hippoMade>=hippoGoal)return;
  // 同ステージ継続：瓦礫で新しい初期盤面 → A案連鎖
  const born=await dropRubble();
  if(born)await handleHippoBorn(); // 瓦礫の偶発連鎖で再びカバが出たら、また全破壊
}

// 盤面の全タイル（動物・ブロック）を消し飛ばす
async function obliterateBoard(){
  SFX.rowclear();SFX.bigmerge(5);burst();burst();shake();
  bgCells.forEach(d=>{d.style.background='rgba(255,140,0,.6)';setTimeout(()=>{d.style.background='';},420);});
  for(const id of Object.keys(tiles))removeFade(Number(id));
  grid=Array.from({length:ROWS},()=>Array(COLS).fill(0));
  await sleep(460);
}

// 瓦礫を上から落として新しい初期盤面を作る。偶発的な3揃いはそのまま連鎖（A案・ジャックポット歓迎）
async function dropRubble(){
  await spawnRubble(planRubble(false),true);
  return await resolveBoard();
}

// ─ ステージクリア判定：エンドレス中（TOTAL_STAGES超過）は進行しない ─
async function checkStageClear(){
  if(currentStage<=TOTAL_STAGES && hippoMade>=hippoGoal){
    await showStageClearAndAdvance();
  }
}

// ─ ステージクリア演出＆次ステージへ ─
async function showStageClearAndAdvance(){
  gamePaused=true;
  MUSIC.pause();
  await sleep(200);
  // ステージクリア演出
  const f=document.createElement('div');
  f.className='levelup-pop';
  f.innerHTML=`<span class="lu-emo">🌟</span><span class="lu-txt">ステージ ${currentStage} クリア！</span>`;
  boardEl.appendChild(f);
  SFX.bigmerge(5);burst();burst();burst();
  await sleep(1600);
  f.remove();

  // ─ ステージ5クリア → ゲームクリア演出 → エンドレスへ ─
  if(currentStage>=TOTAL_STAGES){
    const gc=document.createElement('div');
    gc.className='levelup-pop';
    gc.innerHTML='<span class="lu-emo">🏆</span><span class="lu-txt">ぜんぶクリア！大成功！</span>';
    boardEl.appendChild(gc);
    SFX.bigmerge(5);burst();burst();burst();burst();
    await sleep(2000);
    gc.remove();
  }

  // ─ スキルゲージのリセット（溜め防止） ─
  for(const k of Object.keys(activeSkills))activeSkills[k].gauge=0;

  // 次ステージへ移行
  currentStage++;
  hippoMade=0;
  hippoGoal=getStageGoal(currentStage);
  updateAtmosphere();
  updateStageUI();updateSkillSlotsUI();

  // ステージ開始演出 → そのあと瓦礫が落ちてくる
  const g=document.createElement('div');
  g.className='levelup-pop';
  const isEndless=currentStage>TOTAL_STAGES;
  g.innerHTML=`<span class="lu-emo">${isEndless?'♾️':'🌊'}</span><span class="lu-txt">${isEndless?'ENDLESS MODE':'STAGE '+currentStage+'/'+TOTAL_STAGES}</span>`;
  boardEl.appendChild(g);
  await sleep(1100);
  g.remove();
  await setupStage(currentStage);
  gamePaused=false;
  BGM.onStageChange(currentStage);MUSIC.resumeFromPause();
}

// ─ ボードサイズ動的変更 ─
function rebuildBoard(newCols,newRows){
  if(newCols===COLS&&newRows===ROWS)return;
  // グリッドデータを拡張
  for(let r=grid.length;r<newRows;r++)grid.push(Array(newCols).fill(0));
  for(let r=0;r<grid.length;r++){while(grid[r].length<newCols)grid[r].push(0);}
  COLS=newCols;ROWS=newRows;
  // bgCells再構築
  gridEl.innerHTML='';
  bgCells=[];
  for(let i=0;i<COLS*ROWS;i++){
    const d=document.createElement('div');d.className='bg';
    const row=Math.floor(i/COLS);
    if(row===0)d.classList.add('dz0');else if(row===1)d.classList.add('dz1');
    gridEl.appendChild(d);bgCells.push(d);
  }
  // CSSグリッドを更新
  gridEl.style.gridTemplateColumns=`repeat(${COLS},1fr)`;
  gridEl.style.gridTemplateRows=`repeat(${ROWS},1fr)`;
  // 既存タイル要素を削除して再描画（サイズが変わるため）
  tilesEl.innerHTML='';
  const dl=document.createElement('div');dl.className='danger-line';dl.id='dangerLine';tilesEl.appendChild(dl);
  const lb=document.createElement('div');lb.className='danger-label';lb.id='dangerLabel';lb.textContent='⚠ DANGER';tilesEl.appendChild(lb);
  requestAnimationFrame(()=>{const d=document.getElementById('dangerLine'),l=document.getElementById('dangerLabel');if(d)d.style.top=topOf(DANGER_ROW);if(l)l.style.top=topOf(DANGER_ROW);});
  applyGravity();render();
}

// ─ 瓦礫ジェネレーター：新しい初期盤面（開始時・カバ全破壊後・ステージ移行で共通） ─
const RUBBLE_H_MIN=2, RUBBLE_H_MAX=5;   // 列ごとの瓦礫の高さレンジ（凸凹に積む）
const RUBBLE_BLOCK_RATIO=0.22;          // 瓦礫マスのうちおじゃまブロックの割合
// 瓦礫の動物Tier分布：T1 45% / T2 30% / T3 18% / T4 7%（T4は1盤面1〜2匹）
function rollRubbleTier(){const r=Math.random();return r<0.45?1:r<0.75?2:r<0.93?3:4;}

// 瓦礫の配置を決める（grid/tilesには触れない）。avoidMatches=trueなら3つ揃いを作らない＝開始時用
function planRubble(avoidMatches){
  const plan=Array.from({length:ROWS},()=>Array(COLS).fill(null));
  const tAt=(r,c)=>{const cell=plan[r]?.[c];return(cell&&!cell.rock)?cell.tier:0;};
  // (r,c)にtierを置いたら何個つながるか（3で打ち切り）
  const conn=(sr,sc,t)=>{const seen=new Set([sr*100+sc]),q=[[sr,sc]];let n=1;while(q.length){const[cr,cc]=q.pop();for(const[dr,dc]of[[1,0],[-1,0],[0,1],[0,-1]]){const nr=cr+dr,nc=cc+dc,k=nr*100+nc;if(nr<0||nr>=ROWS||nc<0||nc>=COLS||seen.has(k))continue;if(tAt(nr,nc)===t){seen.add(k);q.push([nr,nc]);if(++n>=3)return n;}}}return n;};
  for(let c=0;c<COLS;c++){
    const h=RUBBLE_H_MIN+Math.floor(Math.random()*(RUBBLE_H_MAX-RUBBLE_H_MIN+1));
    for(let r=ROWS-1;r>ROWS-1-h&&r>=0;r--){
      if(Math.random()<RUBBLE_BLOCK_RATIO){plan[r][c]={rock:true};continue;}
      let tier=rollRubbleTier();
      if(avoidMatches&&conn(r,c,tier)>=3){const alt=[1,2,3,4].filter(t=>t!==tier&&conn(r,c,t)<3);if(alt.length)tier=alt[Math.floor(Math.random()*alt.length)];}
      plan[r][c]={tier};
    }
  }
  // ギミックを混ぜる：🌰クルミ1個確定、🦪貝殻35%で1個。
  // 生成直後に割れないよう、トリガー動物の隣は避けて置く（クルミはリス、貝殻はカワウソの隣を避ける）
  const nbHasTier=(r,c,t)=>{for(const[dr,dc]of[[1,0],[-1,0],[0,1],[0,-1]]){const cell=plan[r+dr]?.[c+dc];if(cell&&!cell.rock&&!cell.gimmick&&cell.tier===t)return true;}return false;};
  const filled=[];
  for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++)if(plan[r][c])filled.push([r,c]);
  for(let i=filled.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[filled[i],filled[j]]=[filled[j],filled[i]];}
  const placeGimmick=(kind,trig)=>{
    let cell=filled.find(([r,c])=>plan[r][c]&&!plan[r][c].gimmick&&!nbHasTier(r,c,trig));
    if(!cell)cell=filled.find(([r,c])=>plan[r][c]&&!plan[r][c].gimmick);
    if(cell)plan[cell[0]][cell[1]]={gimmick:kind};
  };
  const cfg=curStageCfg();
  if(Math.random()<cfg.rWalnut)placeGimmick('walnut',2);
  if(Math.random()<cfg.rShell)placeGimmick('shell',4);
  return plan;
}

// 配置planからタイルを生成。animate=trueなら盤面の上から「ドサドサ」落としてくる
async function spawnRubble(plan,animate){
  const made=[];
  for(let c=0;c<COLS;c++)for(let r=0;r<ROWS;r++){
    const cell=plan[r][c];if(!cell||grid[r][c])continue;
    const id=uid++;
    const startR=animate?r-ROWS:r; // 盤面の高さぶん上から落とす（列の積み形を保ったまま降下）
    const t=cell.gimmick?{id,tier:0,r:startR,c,gimmick:cell.gimmick}:cell.rock?{id,tier:0,r:startR,c,rock:true,hp:1}:{id,tier:cell.tier,r:startR,c};
    tiles[id]=t;grid[r][c]=id;paint(t);
    made.push({id,finalR:r});
  }
  if(animate){
    await sleep(40); // 上の位置を確定させてから落とす（CSSトランジションで降下）
    SFX.rise();shake();
    for(const m of made){if(tiles[m.id])tiles[m.id].r=m.finalR;}
    render();
    await sleep(440);
  }else render();
}

// ─ 初期盤面セットアップ（瓦礫を上から落として組む。開始盤面は3揃いを作らず連鎖もしない＝静かに考えるスタート） ─
async function setupStage(stage){
  busy=true;cancelAiming();
  grid=Array.from({length:ROWS},()=>Array(COLS).fill(0));
  tiles={};uid=1;activeDropId=0;
  tilesEl.innerHTML='';
  const dl=document.createElement('div');dl.className='danger-line';dl.id='dangerLine';tilesEl.appendChild(dl);
  const lb=document.createElement('div');lb.className='danger-label';lb.id='dangerLabel';lb.textContent='⚠ DANGER';tilesEl.appendChild(lb);
  requestAnimationFrame(()=>{const d=document.getElementById('dangerLine'),l=document.getElementById('dangerLabel');if(d)d.style.top=topOf(DANGER_ROW);if(l)l.style.top=topOf(DANGER_ROW);});
  resetWaveInterval();
  nextWaveNoBlocks=false;
  await spawnRubble(planRubble(true),true);
  busy=false;
}
function spawnBlockAt(r,c){
  if(grid[r][c])return;
  const id=uid++;
  const t={id,tier:0,r,c,rock:true,spawn:true,hp:1};
  tiles[id]=t;grid[r][c]=id;paint(t);
}
function spawnGimmickAt(r,c,kind){
  if(grid[r][c])return;
  const id=uid++;
  const t={id,tier:0,r,c,gimmick:kind,spawn:true};
  tiles[id]=t;grid[r][c]=id;paint(t);
}
function spawnAnimalAt(r,c,tier){
  if(grid[r][c])return;
  const id=uid++;
  const t={id,tier,r,c,spawn:true};
  tiles[id]=t;grid[r][c]=id;paint(t);
}

// ─ 既存のスタブを上書き ─

// ─ newGame ─
function newGame(){
  // ボードサイズを7×10固定
  COLS=BOARD_COLS;ROWS=BOARD_ROWS;
  grid=Array.from({length:ROWS},()=>Array(COLS).fill(0));
  tiles={};uid=1;maxChain=0;waveCount=0;survivedDrops=0;resetWaveInterval();activeDropId=0;gameVersion++;busy=false;
  gameLog.length=0;saveGameLog();pushLog('stage','🏁 ゲームスタート');
  // スキル・進行のリセット
  for(const k of Object.keys(activeSkills))activeSkills[k].gauge=0;
  gamePaused=false;
  currentStage=1;hippoMade=0;hippoGoal=getStageGoal(1);
  updateAtmosphere();
  updateSkillSlotsUI();updateStageUI();
  killCounts={1:0,2:0,3:0,4:0,5:0};totalDrops=0;updateLevelUI();
  current=rollTier();next=rollTier();
  // bgCellsをStage1の5×8でリビルド
  gridEl.innerHTML='';bgCells=[];
  for(let i=0;i<COLS*ROWS;i++){const d=document.createElement('div');d.className='bg';const row=Math.floor(i/COLS);if(row===0)d.classList.add('dz0');else if(row===1)d.classList.add('dz1');gridEl.appendChild(d);bgCells.push(d);}
  gridEl.style.gridTemplateColumns=`repeat(${COLS},1fr)`;
  gridEl.style.gridTemplateRows=`repeat(${ROWS},1fr)`;
  tilesEl.innerHTML='';
  const dl=document.createElement('div');dl.className='danger-line';dl.id='dangerLine';tilesEl.appendChild(dl);
  const lb=document.createElement('div');lb.className='danger-label';lb.id='dangerLabel';lb.textContent='⚠ DANGER';tilesEl.appendChild(lb);
  overlay.classList.remove('show','cleared');boardEl.classList.remove('close','shake');
  document.body.className='';
  updateQueue();updateRiseCounter();
  requestAnimationFrame(()=>{const dl=document.getElementById('dangerLine'),lb=document.getElementById('dangerLabel');if(dl)dl.style.top=topOf(DANGER_ROW);if(lb)lb.style.top=topOf(DANGER_ROW);});
  BGM.start(currentStage);
  setupStage(currentStage); // 開始盤面も瓦礫ジェネレーターで作る
}

// ─ タイル描画 ─
function leftOf(c){return`calc(${c} * ((100% - var(--gap)*${COLS-1})/${COLS} + var(--gap)))`;}
function topOf(r){return`calc(${r} * ((100% - var(--gap)*${ROWS-1})/${ROWS} + var(--gap)))`;}
function isDanger(){for(const id in tiles)if(tiles[id].r<DANGER_ROW)return true;return false;}
function checkClose(){let c=false;for(const id in tiles)if(tiles[id].r===DANGER_ROW)c=true;boardEl.classList.toggle('close',c);}
function emptyCount(){let n=0;for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++)if(!grid[r][c])n++;return n;}
function isSpecial(t){return t&&(t.rock||t.gimmick);}
// アイテム・カバ効果での消去：全tier対象、スコア付与、カバ誘発
function clearWithBonuses(targets/*[[r,c],...]*/, bgFlash=false){
  // BFSで消去対象を収集（カバを踏んだら即その行を展開）
  const toClear=new Set(),hippoRows=new Set();
  function add(r,c){
    const id=grid[r][c];if(!id||!tiles[id]||toClear.has(id)||tiles[id].rock)return; // 岩はclearWithBonusesでは消さない
    toClear.add(id);
    if(tiles[id].tier===MAX_TIER&&!hippoRows.has(r)){
      hippoRows.add(r);
      for(let cc=0;cc<COLS;cc++)add(r,cc); // カバの行を全列展開
    }
  }
  for(const[r,c]of targets)add(r,c);
  // 消去前に座標を記録（tiles削除前）
  const clearedCells=[];
  for(const id of toClear){if(!tiles[id])continue;clearedCells.push({r:tiles[id].r,c:tiles[id].c,rock:!!tiles[id].rock});}
  for(const id of toClear){if(!tiles[id])continue;const{r,c}=tiles[id];grid[r][c]=0;removeFade(id);}

  if(hippoRows.size>0){
    SFX.rowclear();burst();
    if(hippoRows.size>=2){burst();shake();}
    floatEl('chain',hippoRows.size>=2?`🦛💥 ${hippoRows.size}行クリア！`:'🦛💥 行クリア！');
    // 光らせる
    bgCells.forEach((d,i)=>{if(hippoRows.has(Math.floor(i/COLS))){d.style.background='rgba(255,140,0,.65)';setTimeout(()=>{d.style.background='';},380);}});
  }
  return hippoRows.size;
}
function ensureEl(t){let el=document.getElementById('tile-'+t.id);if(!el){el=document.createElement('div');el.id='tile-'+t.id;el.className='tile';el.innerHTML='<div class="inner"><span class="emo"></span><span class="nm"></span></div>';el.style.width=`calc((100% - var(--gap)*${COLS-1})/${COLS})`;el.style.height=`calc((100% - var(--gap)*${ROWS-1})/${ROWS})`;el.style.transition='none';el.style.left=leftOf(t.c);el.style.top=topOf(t.r);tilesEl.insertBefore(el,tilesEl.firstChild);void el.offsetWidth;el.style.transition='';}return el;}
function paint(t){
  const el=ensureEl(t);
  if(t.gimmick){
    const g=GIMMICKS[t.gimmick];
    el.classList.remove('t1','t2','t3','t4','t5','rock');
    el.classList.add('gimmick',g.cls);
    el.querySelector('.emo').textContent=g.emo;el.querySelector('.nm').textContent=g.nm;
  }
  else if(t.rock){
    el.classList.remove('t1','t2','t3','t4','t5');
    el.classList.add('rock');
    el.querySelector('.emo').textContent='⬛';el.querySelector('.nm').textContent='ブロック';
  }
  else{const a=ANIMALS[t.tier];el.classList.remove('t1','t2','t3','t4','t5','rock');el.classList.add(a.cls);el.querySelector('.emo').textContent='';el.querySelector('.nm').textContent=a.nm;}
  el.style.left=leftOf(t.c);el.style.top=topOf(t.r);
  const inner=el.querySelector('.inner');
  if(t.skillHit){inner.style.animation='none';void inner.offsetWidth;inner.style.animation='skill-hit .6s ease';t.skillHit=false;}
  else if(t.bump){inner.style.animation='none';void inner.offsetWidth;inner.style.animation='bump .27s ease';t.bump=false;}
  if(t.spawn){inner.style.animation='none';void inner.offsetWidth;inner.style.animation='pop .2s ease';t.spawn=false;}
}
function render(){for(const id in tiles)paint(tiles[id]);}
function removeFade(id){const el=document.getElementById('tile-'+id);if(el){el.classList.add('gone');setTimeout(()=>el.remove(),170);}delete tiles[id];}

// ─ findComponents・gravity・survivor ─
function findComponents(){
  const seen=Array.from({length:ROWS},()=>Array(COLS).fill(false)),comps=[];
  const range=1;
  for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++){
    if(seen[r][c]||!grid[r][c])continue;
    const id=grid[r][c];if(tiles[id]&&isSpecial(tiles[id])){seen[r][c]=true;continue;}
    const tier=tiles[id]?tiles[id].tier:0,cells=[],stack=[[r,c]];seen[r][c]=true;
    while(stack.length){const[cr,cc]=stack.pop();cells.push({r:cr,c:cc});
      for(const[dr,dc]of[[1,0],[-1,0],[0,1],[0,-1]]){
        for(let step=1;step<=range;step++){
          const nr=cr+dr*step,nc=cc+dc*step;
          if(nr<0||nr>=ROWS||nc<0||nc>=COLS)break;
          // 途中に別の動物がいても止まらない（フィーバー中は貫通）
          if(!seen[nr][nc]&&grid[nr][nc]&&!isSpecial(tiles[grid[nr][nc]])&&tiles[grid[nr][nc]]&&tiles[grid[nr][nc]].tier===tier){
            seen[nr][nc]=true;stack.push([nr,nc]);break;
          }
        }
      }
    }
    if(cells.length>=3)comps.push({tier,cells});
  }
  return comps;
}
function pickSurvivor(cells){if(activeDropId){for(const c of cells){if(grid[c.r][c.c]===activeDropId)return c;}}let b=cells[0];for(const c of cells){if(c.r<b.r||(c.r===b.r&&c.c<b.c))b=c;}return b;}
function tiersJump(size){return size>=5?2:1;} // 飛び級進化：5個以上同時合体で+2段階
function applyGravity(){for(let c=0;c<COLS;c++){const stack=[];for(let r=ROWS-1;r>=0;r--)if(grid[r][c])stack.push(grid[r][c]);for(let r=0;r<ROWS;r++)grid[r][c]=0;for(let i=0;i<stack.length;i++){const r=ROWS-1-i;grid[r][c]=stack[i];tiles[stack[i]].r=r;tiles[stack[i]].c=c;}}}

// 4方向の隣にtierの動物がいるか（ギミックの割れ判定用）
function adjacentHasTier(r,c,tier){
  for(const[dr,dc]of[[1,0],[-1,0],[0,1],[0,-1]]){
    const nr=r+dr,nc=c+dc;if(nr<0||nr>=ROWS||nc<0||nc>=COLS)continue;
    const id=grid[nr][nc];
    if(id&&tiles[id]&&!tiles[id].rock&&!tiles[id].gimmick&&tiles[id].tier===tier)return true;
  }
  return false;
}
// 進化でそのtierになったときのスキルチャージ
function chargeForTier(t){if(t===2)addActiveSkill('squirrel');else if(t===3)addActiveSkill('duck_march');else if(t===4)addActiveSkill('refresh');}
// 割れる条件を満たしたギミックを処理。割れたらtrue（盤面が変わったので再収束する）
async function breakReadyGimmicks(){
  const walnuts=[],shells=[];
  for(const id in tiles){const t=tiles[id];if(!t)continue;
    if(t.gimmick==='walnut'&&adjacentHasTier(t.r,t.c,2))walnuts.push(id);
    else if(t.gimmick==='shell'&&adjacentHasTier(t.r,t.c,4))shells.push(id);
  }
  if(walnuts.length===0&&shells.length===0)return false;
  // 🌰クルミ：消滅＋3スキル各+50%（合体は起こさない＝チャージと空マス化のみ）
  for(const id of walnuts){const t=tiles[id];grid[t.r][t.c]=0;removeFade(Number(id));for(const k of Object.keys(activeSkills))addSkillGauge(k,0.5);}
  if(walnuts.length){SFX.itemSpawn();floatEl('item','🌰 クルミ！ スキル+50%');burst();}
  // 🦪貝殻：消滅＋周囲8マスの動物が一斉に+1進化（カバ誕生まで繋がり得る）
  const bumped=new Set();
  for(const id of shells){
    const st=tiles[id],sr=st.r,sc=st.c;grid[sr][sc]=0;removeFade(Number(id));
    for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){
      if(!dr&&!dc)continue;const nr=sr+dr,nc=sc+dc;if(nr<0||nr>=ROWS||nc<0||nc>=COLS)continue;
      const aid=grid[nr][nc];
      if(aid&&tiles[aid]&&!tiles[aid].rock&&!tiles[aid].gimmick&&!bumped.has(aid)&&tiles[aid].tier<MAX_TIER){
        tiles[aid].tier++;tiles[aid].skillHit=true;bumped.add(aid);chargeForTier(tiles[aid].tier);
      }
    }
  }
  if(shells.length){SFX.itemOtter();floatEl('item','🦪 貝殻！ まわりが進化！');burst();shake();}
  render();await sleep(350);
  applyGravity();render();await sleep(150);
  return true;
}
// 盤面にいるカバ(T5)を誕生演出（合体・貝殻どちらでできても）。消去は呼び出し元のhandleHippoBornが担う
async function birthAnyHippos(){
  const births=[];
  for(const id in tiles){const t=tiles[id];if(t&&!t.rock&&!t.gimmick&&t.tier>=MAX_TIER)births.push(id);}
  if(births.length===0)return false;
  for(const id of births){const el=document.getElementById('tile-'+id);if(el)el.classList.add('hippo-born');hippoMade++;addKill(MAX_TIER);}
  render();updateStageUI();
  SFX.itemHippo(2);await showCutin('コビトカバ誕生！','');
  floatEl('toast','🦛 コビトカバ誕生！');SFX.bigmerge(5);burst();burst();shake();
  await sleep(900);
  return true;
}

// ─ resolveBoard：合体・ギミック・カバ誕生を盤面が落ち着くまで処理。カバが出たらtrueを返す ─
async function resolveBoard(){
  let chain=0,bornHippo=false;
  while(true){
    const comps=findComponents();
    if(comps.length===0){
      if(await breakReadyGimmicks())continue; // ギミックが割れた→盤面変化、再収束
      if(await birthAnyHippos())bornHippo=true; // 貝殻等で生まれたカバを拾う
      break;
    }
    chain++;
    let bigLeap=false;
    const removeSet=new Set(),survBumps=[];
    for(const cp of comps){
      if(cp.tier>=MAX_TIER)continue;
      const surv=pickSurvivor(cp.cells),sid=grid[surv.r][surv.c];
      const size=cp.cells.length,prev=cp.tier,newTier=Math.min(prev+tiersJump(size),MAX_TIER),rise=newTier-prev;
      for(const cell of cp.cells){
        if(cell.r===surv.r&&cell.c===surv.c)continue;
        const cid=grid[cell.r][cell.c];grid[cell.r][cell.c]=0;
        tiles[cid].r=surv.r;tiles[cid].c=surv.c;
        removeSet.add(cid);addKill(cp.tier);
      }
      survBumps.push({id:sid,tier:newTier});
      chargeForTier(newTier);
      if(rise>=2)bigLeap=true;
    }
    render();await sleep(205);
    removeSet.forEach(id=>{if(id)removeFade(id);});
    survBumps.forEach(b=>{if(tiles[b.id]){tiles[b.id].tier=b.tier;tiles[b.id].bump=true;}});
    render();
    if(bigLeap){floatEl('chain','✨ 大進化！');SFX.bigmerge(3);burst();shake();}
    else if(chain>=2){floatEl('chain','🔥 '+chain+'チェイン！');SFX.chain(chain);if(chain>=3)shake();}
    else{const nb=survBumps[0];if(nb&&tiles[nb.id])SFX.merge(tiles[nb.id].tier||2);}
    maxChain=Math.max(maxChain,chain);updateStageUI();
    // カバ判定（合体でT5になった）→ 見せ場のあと全破壊へ
    if(await birthAnyHippos()){bornHippo=true;break;}
    await sleep(140);applyGravity();render();await sleep(210);
  }
  return bornHippo;
}

// ─ drop ─
async function drop(col){
  if(busy||gamePaused||overlay.classList.contains('show'))return;
  let landR=-1;for(let r=ROWS-1;r>=0;r--){if(!grid[r][col]){landR=r;break;}}
  if(landR<0){bgCells.filter((_,i)=>i%COLS===col).forEach(d=>{d.style.background='rgba(224,54,74,.45)';setTimeout(()=>{d.style.background='';},300);});return;}
  busy=true;const gv=gameVersion;
  try{
    const id=uid++;const t={id,tier:current,r:-1,c:col};activeDropId=id;
    tiles[id]=t;paint(t);await sleep(25);if(gameVersion!==gv)return;
    t.r=landR;grid[landR][col]=id;paint(t);SFX.drop();await sleep(200);if(gameVersion!==gv)return;
    const born=await resolveBoard();if(gameVersion!==gv)return;
    activeDropId=0;
    if(born)await handleHippoBorn();if(gameVersion!==gv)return;
    await checkStageClear();if(gameVersion!==gv)return;
    if(isDanger()){endGame('💥','ブロックがあふれちゃった…');return;}
    const wasClose=Object.values(tiles).some(t=>t.r<=DANGER_ROW);
    checkClose();
    totalDrops++;survivedDrops++;dropsUntilWave--;
    // 波判定
    if(dropsUntilWave<=0){
      dropsUntilWave=currentWaveInterval;
      await riseStep();if(gameVersion!==gv)return;
      if(isDanger()||emptyCount()===0){endGame('💥','ブロックがあふれちゃった…');return;}
      checkClose();
      if(wasClose&&!Object.values(tiles).some(t=>t.r<=DANGER_ROW+1))floatEl('toast','耐えた！💦');
    }
    updateRiseCounter();updateStageUI();
    current=next;next=rollTier();updateQueue();
  }catch(e){console.error(e);}
  finally{busy=false;}
}

// ─ riseStep ─
async function doOneRise(){
  // リス「ひとやすみ」の効果中はこの波だけブロックを出さない（動物だけ。ギミックも出さない）
  const noBlocks=nextWaveNoBlocks;nextWaveNoBlocks=false;
  // この波に混ぜるギミック：🌰クルミ15%・🦪貝殻5%（それぞれ最大1個）
  const gimCols={};
  if(!noBlocks){
    const cfg=curStageCfg();
    const free=[...Array(COLS).keys()];
    if(Math.random()<cfg.wWalnut){gimCols[free.splice(Math.floor(Math.random()*free.length),1)[0]]='walnut';}
    if(Math.random()<cfg.wShell&&free.length){gimCols[free.splice(Math.floor(Math.random()*free.length),1)[0]]='shell';}
  }
  // 波システム：全列一気に1行せり上がる
  for(let c=0;c<COLS;c++){
    if(grid[0][c])removeFade(grid[0][c]);
    for(let r=0;r<ROWS-1;r++){
      grid[r][c]=grid[r+1][c];
      if(grid[r][c])tiles[grid[r][c]].r=r;
    }
    grid[ROWS-1][c]=0;
    const id=uid++;let t;
    if(gimCols[c])t={id,tier:0,r:ROWS-1,c,spawn:true,gimmick:gimCols[c]};
    else{const isRock=noBlocks?false:Math.random()<getRockChance();t={id,tier:isRock?0:rollRiseTier(),r:ROWS-1,c,spawn:true,rock:isRock,hp:1};}
    tiles[id]=t;grid[ROWS-1][c]=id;
  }
}
async function riseStep(){
  waveCount++;updateAtmosphere();
  SFX.rise();floatEl('warn','🔺 ブロックがせりあがった！');await sleep(440);
  await doOneRise();
  applyGravity();render();
  await sleep(200);
  const born=await resolveBoard();
  if(born)await handleHippoBorn();
  await checkStageClear();
}

// ─ ゲームログ ─
function pushLog(type,txt){
  gameLog.unshift({type,txt,drop:totalDrops,ts:Date.now()});
  if(gameLog.length>150)gameLog.length=150;
  saveGameLog();
}

// フローティングメッセージキュー（重なり防止）
const _floatQueue=[];let _floatRunning=false;
function floatEl(type,txt){
  if(type!=='pts')pushLog(type,txt);
  _floatQueue.push({type,txt});
  if(!_floatRunning)_drainFloatQueue();
}
function _drainFloatQueue(){
  if(_floatQueue.length===0){_floatRunning=false;return;}
  _floatRunning=true;
  const{type,txt}=_floatQueue.shift();
  const f=document.createElement('div');
  f.className='float '+type;f.textContent=txt;
  boardEl.appendChild(f);
  setTimeout(()=>{f.remove();_drainFloatQueue();},type==='chain'||type==='warn'?520:type==='item'?700:380);
}
function shake(){boardEl.classList.remove('shake');void boardEl.offsetWidth;boardEl.classList.add('shake');setTimeout(()=>boardEl.classList.remove('shake'),360);}
function burst(){const ico=['✨','💫','⭐','🦛'];for(let i=0;i<8;i++){const p=document.createElement('div');p.className='particle';const ang=Math.random()*6.28,dist=42+Math.random()*55;p.style.left=(35+Math.random()*30)+'%';p.style.top=(30+Math.random()*30)+'%';p.style.setProperty('--tx',(Math.cos(ang)*dist)+'px');p.style.setProperty('--ty',(Math.sin(ang)*dist)+'px');p.textContent=ico[i%4];boardEl.appendChild(p);setTimeout(()=>p.remove(),620);}}


function clearGame(){
  const entry={stage:currentStage,maxChain,date:Date.now(),cleared:true};
  const history=saveHistory(entry);
  document.getElementById('ovEmo').textContent='🎉';
  document.getElementById('ovTitle').textContent='生き残った！🏁';
  document.getElementById('finscore').textContent=currentStage;
  document.getElementById('finmsg').textContent=`カバ${hippoMade}体作成 ／ 最大${maxChain}チェイン`;
  renderHistory(history);
  overlay.classList.add('show','cleared');
  boardEl.classList.remove('close');
  // クリア用ボタン表示切替
  const rb=document.getElementById('retryBtns');if(rb)rb.style.display='none';
  const cb=document.getElementById('clearOkBtn');if(cb)cb.style.display='block';
  BGM.start(currentStage);burst();burst();burst();shake();
}
// ─ このステージからやり直す ─
function retryStage(){
  overlay.classList.remove('show','cleared');
  boardEl.classList.remove('close','shake');
  document.body.className='';
  gameVersion++;busy=false;
  // ボードのみリセット（ステージ・スコア・ひらめきは維持）
  grid=Array.from({length:ROWS},()=>Array(COLS).fill(0));
  tiles={};uid=1;activeDropId=0;
  waveCount=0;survivedDrops=0;resetWaveInterval(); // やり直し時は波間隔もリセット
  // スキルゲージはリセット
  for(const k of Object.keys(activeSkills))activeSkills[k].gauge=0;
  // ステージ進捗はリセット（ステージ番号・スコアは維持）
  hippoMade=0;hippoGoal=getStageGoal(currentStage);
  gamePaused=false;
  // bgCellsを再構築（COLS/ROWSは維持）
  gridEl.innerHTML='';bgCells=[];
  for(let i=0;i<COLS*ROWS;i++){const d=document.createElement('div');d.className='bg';const row=Math.floor(i/COLS);if(row===0)d.classList.add('dz0');else if(row===1)d.classList.add('dz1');gridEl.appendChild(d);bgCells.push(d);}
  gridEl.style.gridTemplateColumns=`repeat(${COLS},1fr)`;
  gridEl.style.gridTemplateRows=`repeat(${ROWS},1fr)`;
  tilesEl.innerHTML='';
  const dl=document.createElement('div');dl.className='danger-line';dl.id='dangerLine';tilesEl.appendChild(dl);
  const lb=document.createElement('div');lb.className='danger-label';lb.id='dangerLabel';lb.textContent='⚠ DANGER';tilesEl.appendChild(lb);
  current=rollTier();next=rollTier();
  updateSkillSlotsUI();updateStageUI();
  updateQueue();updateRiseCounter();
  requestAnimationFrame(()=>{const d=document.getElementById('dangerLine'),l=document.getElementById('dangerLabel');if(d)d.style.top=topOf(DANGER_ROW);if(l)l.style.top=topOf(DANGER_ROW);});
  BGM.start(currentStage);
  setupStage(currentStage);
  floatEl('toast','🔄 ステージ '+currentStage+' やり直し！');
}

function endGame(emo,title){
  cancelAiming();
  const entry={stage:currentStage,maxChain,date:Date.now()};
  const history=saveHistory(entry);
  document.getElementById('ovEmo').textContent=emo;document.getElementById('ovTitle').textContent=title;
  document.getElementById('finscore').textContent=currentStage;
  document.getElementById('finmsg').textContent=`最大${maxChain}チェイン ／ カバ${hippoMade}体`;
  renderHistory(history);
  BGM.stop();SFX.gameover();overlay.classList.add('show');boardEl.classList.remove('close');
  // ゲームオーバー用ボタン表示切替
  const rb=document.getElementById('retryBtns');if(rb)rb.style.display='flex';
  const cb=document.getElementById('clearOkBtn');if(cb)cb.style.display='none';
}

// ─ 入力 ─
function cellFromXY(cx,cy){const rect=boardEl.getBoundingClientRect(),pad=parseFloat(getComputedStyle(boardEl).paddingLeft),iW=rect.width-2*pad,iH=rect.height-2*pad;return{col:Math.max(0,Math.min(COLS-1,Math.floor((cx-rect.left-pad)/iW*COLS))),row:Math.max(0,Math.min(ROWS-1,Math.floor((cy-rect.top-pad)/iH*ROWS)))};}
boardEl.addEventListener('click',e=>{
  BGM.start(currentStage);
  if(overlay.classList.contains('show')||gamePaused)return;
  const{col,row}=cellFromXY(e.clientX,e.clientY);
  if(aiming){handleAimTap(row,col);return;}
  if(!busy)drop(col);
});
boardEl.addEventListener('pointermove',e=>{if(busy||aiming)return;const{col}=cellFromXY(e.clientX,e.clientY);bgCells.forEach((d,i)=>d.classList.toggle('aim',i%COLS===col&&!d.classList.contains('dz0')&&!d.classList.contains('dz1')));});
boardEl.addEventListener('pointerleave',()=>bgCells.forEach(d=>d.classList.remove('aim')));
document.getElementById('ovBtn').onclick=newGame;
document.getElementById('retryStageBtn').onclick=retryStage;
document.getElementById('clearOkBtn').onclick=newGame;
function showRestartModal(){history.pushState({modal:'restart'},'');document.getElementById('restartModal').classList.add('show');}
function hideRestartModal(){document.getElementById('restartModal').classList.remove('show');}
function confirmRetryStage(){hideRestartModal();retryStage();}
function confirmNewGame(){hideRestartModal();newGame();}
function showTitleModal(){history.pushState({modal:'title'},'');document.getElementById('titleModal').classList.add('show');}
function hideTitleModal(){document.getElementById('titleModal').classList.remove('show');}
function goToTitle(){location.href='index.html';}
document.getElementById('shareBtn').addEventListener('click',()=>{const txt=`🐹どうぶつポトン🦛\nStage${currentStage}到達！\nカバ${hippoMade}体 ／ 最大${maxChain}チェイン\n#どうぶつポトン`;if(navigator.share){navigator.share({text:txt}).catch(()=>{});}else{navigator.clipboard.writeText(txt).then(()=>{const b=document.getElementById('shareBtn');b.textContent='コピー済み✓';setTimeout(()=>{b.textContent='シェア📤';},2000);}).catch(()=>{});}});
function toggleHelp(){
  const p=document.getElementById('helpPanel');
  const open=p.classList.toggle('show');
  if(open)history.pushState({modal:'help'},'');
}
function renderBgmPanel(){
  const list=document.getElementById('bgmTrackList');if(!list)return;
  const sel=BGM.getSel();
  list.innerHTML='';
  BGM.tracks.forEach(t=>{
    const b=document.createElement('button');
    b.className='bgm-track-btn'+(t.id===sel?' active':'');
    b.textContent=t.label;
    b.onclick=()=>{BGM.setSel(t.id,currentStage);renderBgmPanel();};
    list.appendChild(b);
  });
  const bs=document.getElementById('bgmVolSlider'),bl=document.getElementById('bgmVolLabel');
  if(bs){bs.value=Math.round(BGM.getVol()*100);bl.textContent=bs.value+'%';}
  const ss=document.getElementById('sfxVolSlider'),sl=document.getElementById('sfxVolLabel');
  if(ss){ss.value=Math.round(BGM.getSfxVol()*100);sl.textContent=ss.value+'%';}
}
function onBgmVol(v){BGM.setVol(v/100);document.getElementById('bgmVolLabel').textContent=v+'%';}
function onSfxVol(v){BGM.setSfxVol(v/100);document.getElementById('sfxVolLabel').textContent=v+'%';}
function toggleMusic(){
  const p=document.getElementById('musicPanel');
  const open=p.style.display!=='block';
  p.style.display=open?'block':'none';
  if(open){history.pushState({modal:'music'},'');renderBgmPanel();}
}
function toggleDebug(){
  const p=document.getElementById('debugPanel');
  const open=p.style.display!=='block';
  p.style.display=open?'block':'none';
  if(open)history.pushState({modal:'debug'},'');
}
// スマホ戻るボタン：開いているモーダルを閉じる。何も開いていなければタイトル確認
window.addEventListener('popstate',()=>{
  const mp=document.getElementById('musicPanel');
  if(mp?.style.display==='block'){mp.style.display='none';return;}
  const dp=document.getElementById('debugPanel');
  if(dp?.style.display==='block'){dp.style.display='none';return;}
  const panels=['logPanel','helpPanel'];
  for(const id of panels){const el=document.getElementById(id);if(el?.classList.contains('show')){el.classList.remove('show');return;}}
  if(document.getElementById('restartModal')?.classList.contains('show')){hideRestartModal();return;}
  if(document.getElementById('titleModal')?.classList.contains('show')){hideTitleModal();return;}
  // 何も開いていない → タイトルへ戻る確認
  showTitleModal();
});
// 戻るボタンをゲーム内で受け取れるよう初期状態を積む
history.pushState({modal:'game'},'');
try{newGame();}catch(e){window.onerror(e.message,'',0,0,e);}
// タイトル画面の「あそびかた」から来た場合は自動でヘルプを開く
if(new URLSearchParams(location.search).get('help')==='1')toggleHelp();
// ページ離脱・リロード時の確認（ゲームオーバー後は不要）
window.addEventListener('beforeunload',e=>{
  if(overlay.classList.contains('show'))return;
  e.preventDefault();e.returnValue='';
});

// ─ デバッグパネル ─
function setParam(key,val){
  if(key==='waveInterval'){_dpWaveInterval=val;document.getElementById('dp-waveInterval').textContent=val+'手';}
  if(key==='rockRate'){_dpBlockRate=val;document.getElementById('dp-blockRate').textContent=Math.round(val*100)+'%';}
  event.target.closest('.dp-row')?.querySelectorAll('.dp-btn').forEach(b=>b.classList.remove('on'));
  event.target.classList.add('on');
}
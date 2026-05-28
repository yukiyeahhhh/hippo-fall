
window.onerror=function(msg,src,line,col,err){
  document.body.innerHTML='<div style="padding:20px;font-family:monospace;color:#c00;background:#fff"><b>⚠ JS Error (line '+line+')</b><br>'+msg+'<br><br>'+(err&&err.stack?err.stack:'')+'</div>';
  return true;
};

// ─ 定数 ─
let COLS=5,ROWS=8;
const DANGER_ROW=1;
const WAVE_INTERVAL=10;     // 波の初期間隔（手数）
let _dpWaveInterval=10,_dpRockRate=0.35; // デバッグパネル用パラメータ
const WAVE_INTERVAL_MIN=5;  // 波の最小間隔（カバ作成で加速、この値より短くならない）

// ─ ステージ設定（盤面常に7×10固定） ─
const BOARD_COLS=7,BOARD_ROWS=10; // 全ステージ共通
const STAGE_CONFIG=[
  null,
  {goal:1, mixRows:2, rockRatio:0.25}, // Stage 1: 下2行, 岩25%
  {goal:2, mixRows:3, rockRatio:0.35}, // Stage 2: 下3行, 岩35%
  {goal:2, mixRows:4, rockRatio:0.50}, // Stage 3: 下4行, 岩50%
  {goal:3, mixRows:5, rockRatio:0.62}, // Stage 4: 下5行, 岩62%
  {goal:3, mixRows:6, rockRatio:0.72}, // Stage 5: 下6行, 岩72%
];
const TOTAL_STAGES=5;
const ANIMALS=[null,{emo:'🐹',nm:'ハムスター',cls:'t1'},{emo:'🐿️',nm:'リス',cls:'t2'},{emo:'🦆',nm:'アヒル',cls:'t3'},{emo:'🦦',nm:'カワウソ',cls:'t4'},{emo:'🦛',nm:'コビトカバ',cls:'t5'}];
const MAX_TIER=5,MAX_CHAIN=9;
const SCORE_TABLE=[0,0,4,14,45,150];
const POP_SCORE=400,NEIGHBOR_SCORE=25;
const LS_KEY='animalDrop_roguelite_v2';

// ─ DOM要素 ─
const gridEl=document.getElementById('grid'),tilesEl=document.getElementById('tiles');
const scoreEl=document.getElementById('score'),bestEl=document.getElementById('best');
const cnowEl=document.getElementById('cnow'),cnextEl=document.getElementById('cnext');
const boardEl=document.getElementById('board'),overlay=document.getElementById('overlay');
const riseCountEl=document.getElementById('riseCount');
let bgCells=[];
for(let i=0;i<COLS*ROWS;i++){const d=document.createElement('div');d.className='bg';const row=Math.floor(i/COLS);if(row===0)d.classList.add('dz0');else if(row===1)d.classList.add('dz1');gridEl.appendChild(d);bgCells.push(d);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// ─ 状態変数 ─
let grid,tiles,uid,score,best=0,current,next,maxChain,activeDropId=0,gameVersion=0,busy=false;
let totalDrops=0;
let waveCount=0; // これまでに来た波の回数
let survivedDrops=0; // 生き残った手数
let dropsUntilWave=10; // 次の波までの手数
let currentWaveInterval=10; // 現在の波間隔（カバ作成で短縮される）

// ─ アクティブスキル（進化で獲得・盤面外スロット） ─
const SKILL_GAUGE_PER_EVOLVE=1/3; // 進化1回でゲージが33%溜まる（3回で100%）
const HIPPO_PER_DRAFT=1;    // ドラフト1回に必要なカバ作成数（1=毎回、2=2匹ごと）
let activeSkills={
  duck_march: {emoji:'🦆', name:'大行進',       gauge:0, fromTier:3},
  refresh:    {emoji:'🦦', name:'リフレッシュ', gauge:0, fromTier:4}
};

// ─ ピッケル ─
let pickaxeGauge=0;       // 0〜1（次のストックまでの進捗）
const PICKAXE_MERGE_GAIN=0.04;   // 合体1回ごとの蓄積
const PICKAXE_CHAIN_GAIN=0.04;   // チェーン1段ごとのボーナス係数（chain*chain*0.04）
const PICKAXE_WAVE_GAIN=0.30;    // 波1回やり過ごすたびに

// ─ コビトカバのチカラ＆ステージ進行 ─
let artifactCounts={};  // {id: 取得回数} スタック式
let gamePaused=false;   // ドラフトモーダル表示中フラグ
let pendingDraftCount=0; // ドラフトキュー
let hippoMeter=0;        // カバ作成数カウンター（HIPPO_PER_DRAFTでドラフト）
let nextForceDuck=false; // 次のドロップを強制アヒルにするフラグ
// ─ ステージ ─
let currentStage=1;
let hippoMade=0;     // 現ステージで作ったカバ数
let hippoGoal=1;     // 現ステージの目標カバ数

// ─ ユーティリティ ─
function getSpeedLevel(){return waveCount;} // 波数を進行度として使う
function isClearable(id){if(!id||!tiles[id])return false;return !tiles[id].rock;}

// ─ LocalStorage ─
function loadHistory(){try{return JSON.parse(localStorage.getItem(LS_KEY)||'[]');}catch(e){return[];}}
function saveHistory(e){let h=loadHistory();h.unshift(e);h=h.sort((a,b)=>b.score-a.score).slice(0,5);try{localStorage.setItem(LS_KEY,JSON.stringify(h));}catch(e){}return h;}
function getBestScore(){const h=loadHistory();return h.length?h[0].score:0;}
function renderHistory(h){const el=document.getElementById('historyList');if(!el)return;el.innerHTML=h.slice(0,5).map((e,i)=>{const m=['🥇','🥈','🥉','4.','5.'][i];const d=new Date(e.date);const ds=`${d.getMonth()+1}/${d.getDate()}`;return`<li><span class="history-rank">${m}</span><span>${e.score.toLocaleString()}点</span><span>最大${e.maxChain}チェイン</span><span>${ds}</span></li>`;}).join('');}

// ─ 共有 AudioContext ─
let _audioCtx=null;
function getCtx(){if(!_audioCtx)try{_audioCtx=new(window.AudioContext||window.webkitAudioContext)();}catch(e){}if(_audioCtx&&_audioCtx.state==='suspended')_audioCtx.resume();return _audioCtx;}
function tone(freq,type,dur,vol=0.28,t=0){const c=getCtx();if(!c)return;const o=c.createOscillator(),g=c.createGain();o.type=type;o.frequency.value=freq;g.gain.setValueAtTime(vol,c.currentTime+t);g.gain.exponentialRampToValueAtTime(0.001,c.currentTime+t+dur);o.connect(g);g.connect(c.destination);o.start(c.currentTime+t);o.stop(c.currentTime+t+dur+0.05);}

// ─ SFX ─
const SFX={
  drop(){tone(100,'sine',0.07,0.18);},
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
  if(ssn)ssn.textContent=isEndless?'ENDLESS':currentStage+'/'+TOTAL_STAGES;
  const ssc=document.getElementById('ssCount');
  if(ssc)ssc.textContent=isEndless?'累計 '+hippoMade+'匹':hippoMade+'/'+hippoGoal;
}
function getStageGoal(stage){
  if(stage>=1&&stage<=TOTAL_STAGES)return STAGE_CONFIG[stage].goal;
  return STAGE_CONFIG[TOTAL_STAGES].goal; // エンドレスは最終ステージと同じ目標数
}
// updateLevelUI互換シム（既存呼び出し対応用）
function updateLevelUI(){updateStageUI();}
function updateChikaraListUI(){
  const el=document.getElementById('chikara-list');
  if(!el)return;
  const entries=Object.entries(artifactCounts);
  if(entries.length===0){
    el.innerHTML='<div class="chikara-none">なし</div>';
    return;
  }
  el.innerHTML=entries.map(([id,count])=>{
    const a=ARTIFACTS_BY_ID[id];
    if(!a)return'';
    const descTxt=typeof a.desc==='function'?a.desc(count):a.desc;return`<div class="chikara-item" title="${descTxt}"><span class="ci-emo">${a.emoji}</span><span class="ci-name">${a.name}</span><span class="ci-lv">Lv.${count}</span></div>`;
  }).join('');
}
function updateHippoMeterUI(){
  const fill=document.getElementById('hmFill');
  const lbl=document.getElementById('hmLabel');
  if(fill)fill.style.width=Math.min(100,hippoMeter/HIPPO_PER_DRAFT*100)+'%';
  if(lbl)lbl.textContent='コビトカバがひらめくまで：あと'+Math.max(0,HIPPO_PER_DRAFT-hippoMeter)+'匹';
}
function getTotalKills(){return Object.values(killCounts).reduce((a,b)=>a+b,0);}
function getWaveRows(){return 1;} // 常に1段固定
function getRockChance(){
  const mx=typeof _dpRockRate!=="undefined"?_dpRockRate:0.35;
  // ベース10% + 波の進行で+6%/level + エンドレスステージで+5%/stage
  const endlessBonus=currentStage>TOTAL_STAGES?(currentStage-TOTAL_STAGES)*0.05:0;
  return Math.min(mx+endlessBonus,0.10+getSpeedLevel()*0.06+endlessBonus);
} // 序盤10%→終盤35%上限、エンドレスで上限上昇
function rollTier(){if(nextForceDuck){nextForceDuck=false;return 3;}const r=Math.random()*100;return r<70?1:r<95?2:3;} // ハム70%、リス25%、アヒル5%、カワウソ0%
function rollRiseTier(){const r=Math.random();return r<.45?1:r<.73?2:r<.89?3:4;} // フラット
function updateAtmosphere(){const lvl=getSpeedLevel();document.body.className=lvl>=5?'s4':lvl>=3?'s3':lvl>=1?'s2':'';}
function updateRiseCounter(){
  const base=typeof _dpWaveInterval!=='undefined'?_dpWaveInterval:WAVE_INTERVAL;
  const accel=currentWaveInterval<base; // 加速中かどうか
  const accelMark=accel?` ⚡${currentWaveInterval}手ごと`:'';
  riseCountEl.textContent='⬆️ 次のせりあがりまで：あと'+Math.max(0,dropsUntilWave)+'手'+accelMark;
  riseCountEl.classList.toggle('warn',dropsUntilWave<=3);
}
function updateQueue(){cnowEl.textContent=ANIMALS[current].emo;cnextEl.textContent=ANIMALS[next].emo;}

// ─ コビトカバのチカラ 一覧（スタック式） ─
const ARTIFACTS=[
  {id:'kouzan', emoji:'🔨', name:'思わぬ掘り出し物', maxLevel:4,
   desc:(count)=>{
     const n=5+Math.min(count-1,3); // Lv1=5, Lv2=6, Lv3=7, Lv4+=8
     const tier=Math.min(count,4);  // Lv1=ハム, Lv2=リス, Lv3=アヒル, Lv4+=カワウソ
     const emo=['','🐹','🐿️','🦆','🦦'][tier];
     return `ハンマー後、${emo}が${n}匹でてきた！`;
   },
   onPickaxe:(count,positions)=>{
     const n=5+Math.min(count-1,3);
     const tier=Math.min(count,4);
     const emo=['','🐹','🐿️','🦆','🦦'][tier];
     let placed=0;
     const spawnFn=(r,c)=>{if(grid[r][c])return;const id=uid++;const t={id,tier,r,c,spawn:true};tiles[id]=t;grid[r][c]=id;paint(t);};
     for(const[r,c]of positions){if(placed>=n)break;if(!grid[r][c]){spawnFn(r,c);placed++;}}
     for(let rr=ROWS-1;rr>=0&&placed<n;rr--)for(let cc=0;cc<COLS&&placed<n;cc++){if(!grid[rr][cc]){spawnFn(rr,cc);placed++;}}
     if(placed>0)floatEl('item',`🔨 思わぬ掘り出し物！ ${emo}×${placed}`);
   }},
  {id:'eco_cycle', emoji:'♻️', name:'エコサイクル', maxLevel:5,
   desc:(count)=>`おたすけアクション使用時、ハンマーゲージ +${Math.round(15*count)}%`,
   onActiveSkill:(count)=>{ addPickaxeProgress(0.15*count); }},
  {id:'kawuso_ongaeshi', emoji:'🦦', name:'カワウソの恩返し', maxLevel:5,
   desc:(count)=>`カワウソができたとき、おじゃまブロックを${count}個壊す`,
   onMerge:(count,newTier)=>{ if(newTier===4)destroyRandomRocks(count); }},
  {id:'harikiri_bonus', emoji:'🦛', name:'はりきりボーナス', maxLevel:5,
   desc:(count)=>`4匹以上いっきに合体！おたすけゲージが各+${Math.round(30*count)}%`,
   onBigMerge:(count,size)=>{
     if(size<4)return;
     addSkillGauge('duck_march',0.30*count);
     addSkillGauge('refresh',0.30*count);
   }},
  {id:'naminori_ahiru', emoji:'🦆', name:'ひょっこりアヒル', maxLevel:5,
   desc:(count)=>`せりあがりのとき、いちばん上の動物${count}匹がアヒルになる`,
   onWave:(count)=>{ convertTopToAhiru(count); }},
];

// ─ ドラフトフォールバックボーナス（ひらめきが全部MAX時） ─
const FALLBACK_BONUSES=[
  {id:'bonus_score',  emoji:'⭐', name:'スコアボーナス',
   desc:()=>'スコア +5000！',
   apply:()=>{ addScore(5000);floatEl('chain','⭐ スコア +5000！'); }},
  {id:'bonus_hammer', emoji:'🔨', name:'ハンマーゲージ即MAX',
   desc:()=>'ハンマーゲージが即座に100%になる！',
   apply:()=>{ pickaxeGauge=1;updatePickaxeUI();floatEl('item','🔨 ハンマー MAX！'); }},
  {id:'bonus_ahiru',  emoji:'🦆', name:'おたすけゲージ即MAX',
   desc:()=>'アヒルとカワウソのおたすけゲージが即座に100%になる！',
   apply:()=>{ for(const k of Object.keys(activeSkills))activeSkills[k].gauge=1;updateSkillSlotsUI();floatEl('item','🎁 おたすけ全部MAX！'); }},
];
const ARTIFACTS_BY_ID=Object.fromEntries(ARTIFACTS.map(a=>[a.id,a]));

// チカラフック：count（取得回数）を第1引数として渡す
function fireArtifactHook(hookName,...args){
  for(const[id,count]of Object.entries(artifactCounts)){
    const a=ARTIFACTS_BY_ID[id];
    if(a&&typeof a[hookName]==='function')a[hookName](count,...args);
  }
}

// ─ 波間隔の加速 ─
function accelerateWave(){
  const base=typeof _dpWaveInterval!=='undefined'?_dpWaveInterval:WAVE_INTERVAL;
  currentWaveInterval=Math.max(WAVE_INTERVAL_MIN,currentWaveInterval-1);
  // 既に現在の待機カウントが新しい間隔より大きければ上限を揃える
  if(dropsUntilWave>currentWaveInterval)dropsUntilWave=currentWaveInterval;
  updateRiseCounter();
}
function resetWaveInterval(){
  const base=typeof _dpWaveInterval!=='undefined'?_dpWaveInterval:WAVE_INTERVAL;
  currentWaveInterval=base;
  dropsUntilWave=base;
}

// ─ ピッケルゲージ操作（ヘルパ） ─
function addPickaxeProgress(amount){
  if(pickaxeGauge>=1)return; // 満タン時はオーバーフローしない
  const prev=pickaxeGauge;
  pickaxeGauge=Math.min(1,pickaxeGauge+amount);
  if(prev<1&&pickaxeGauge>=1)floatEl('item','🔨 ハンマー MAX！');
  updatePickaxeUI();
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
function addActiveSkill(key){addSkillGauge(key,SKILL_GAUGE_PER_EVOLVE);}

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
  }
}
function updatePickaxeUI(){
  const fill=document.getElementById('pickaxeFill');
  const btn=document.getElementById('pickaxeBtn');
  if(fill)fill.style.width=(pickaxeGauge*100)+'%';
  if(btn)btn.disabled=pickaxeGauge<1||gamePaused;
}
// ─ カットイン演出（基盤） ─
async function showCutin(title, message, duration=1500){
  gamePaused=true;
  const el=document.getElementById('cutinOverlay');
  document.getElementById('cutinTitle').textContent=title;
  document.getElementById('cutinMessage').textContent=message;
  el.classList.add('show');
  await sleep(duration);
  el.classList.remove('show');
  gamePaused=false;
}

// ─ アクティブスキル発動（即時・チャージ制） ─
function activateSkill(key){
  if(busy||gamePaused||overlay.classList.contains('show'))return;
  const s=activeSkills[key];if(!s||s.gauge<1)return;
  s.gauge=0;
  updateSkillSlotsUI();
  fireArtifactHook('onActiveSkill');
  busy=true;
  (async()=>{
    try{
      if(key==='duck_march')await applyDuckMarch();
      else if(key==='refresh')await applyBoardRefresh();
      applyGravity();render();await sleep(200);
      await resolveBoard();
      await processDraftQueue();
      if(isDanger()){endGame('⚠️','ラインオーバー！');return;}
      checkClose();
    }finally{busy=false;}
  })();
}
// ─ アクティブスキル効果 ─

// 🦆 アヒルの大行進：ランダムな動物2〜3匹をアヒルに変換
async function applyDuckMarch(){
  await showCutin('おたすけ行動！','アヒルの大行進！');
  const candidates=[];
  for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++){
    const id=grid[r][c];
    if(id&&tiles[id]&&!tiles[id].rock&&tiles[id].tier!==3)candidates.push(id);
  }
  if(candidates.length===0){floatEl('toast','🦆 変換対象なし');return;}
  // シャッフルして2〜3匹選ぶ
  for(let i=candidates.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}
  const n=Math.min(candidates.length,2+Math.floor(Math.random()*2)); // 2 or 3
  for(let i=0;i<n;i++){tiles[candidates[i]].tier=3;tiles[candidates[i]].bump=true;}
  render();SFX.itemDuck();floatEl('item','🦆 大行進！ '+n+'匹がアヒルに！');
  await sleep(260);
}

// 🦦 盤面リフレッシュ：岩はそのまま、動物の位置だけシャッフル
async function applyBoardRefresh(){
  await showCutin('おたすけ行動！','ぐるぐるシャッフル！');
  const positions=[],tiers=[];
  for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++){
    const id=grid[r][c];
    if(id&&tiles[id]&&!tiles[id].rock){positions.push({r,c,id});tiers.push(tiles[id].tier);}
  }
  if(positions.length<=1){floatEl('toast','🦦 動物が少ない');return;}
  // tiersをシャッフル
  for(let i=tiers.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[tiers[i],tiers[j]]=[tiers[j],tiers[i]];}
  for(let i=0;i<positions.length;i++){tiles[positions[i].id].tier=tiers[i];tiles[positions[i].id].bump=true;}
  render();SFX.itemHamster();floatEl('item','🦦 ぐるぐるシャッフル！');
  await sleep(260);
}

// ⚡ 落雷：ランダムにN個の岩を破壊
function destroyRandomRocks(n){
  const rockIds=Object.keys(tiles).filter(id=>tiles[id]&&tiles[id].rock);
  if(rockIds.length===0)return;
  for(let i=rockIds.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[rockIds[i],rockIds[j]]=[rockIds[j],rockIds[i]];}
  const toDestroy=rockIds.slice(0,Math.min(n,rockIds.length));
  for(const id of toDestroy){
    if(!tiles[id])continue;
    const{r,c}=tiles[id];
    grid[r][c]=0;removeFade(id);
    fireArtifactHook('onRockBreak',r,c);
  }
  if(toDestroy.length>0){render();floatEl('item','⚡ 落雷！ 岩×'+toDestroy.length+'破壊！');}
}

// 🌊 波乗り：各列の最上段の動物をN匹まで1段進化
function convertTopToAhiru(n){
  // 最上段（rowが最小）にいる動物をN匹アヒル(tier3)に変換
  const candidates=[];
  for(let c=0;c<COLS;c++){
    for(let r=0;r<ROWS;r++){
      const id=grid[r][c];
      if(id&&tiles[id]&&!tiles[id].rock&&tiles[id].tier!==3){
        candidates.push({id,r});break;
      }
    }
  }
  candidates.sort((a,b)=>a.r-b.r);
  const toConvert=candidates.slice(0,Math.min(n,candidates.length));
  for(const{id}of toConvert){tiles[id].tier=3;tiles[id].bump=true;}
  if(toConvert.length>0){render();floatEl('item','🦆 ひょっこりアヒル！ '+toConvert.length+'匹→🦆');}
}
// ─ ピッケル発動 ─
async function usePickaxe(){
  if(pickaxeGauge<1||busy||gamePaused)return;
  busy=true;
  try{
    pickaxeGauge=0;updatePickaxeUI();
    const rockIds=Object.keys(tiles).filter(id=>tiles[id]&&tiles[id].rock);
    if(rockIds.length===0){floatEl('toast','おじゃまブロックがないよ！');return;}
    let count=0;
    const positions=[];
    for(const id of rockIds){
      if(!tiles[id])continue;
      const{r,c}=tiles[id];
      positions.push([r,c]);
      grid[r][c]=0;removeFade(id);count++;
    }
    SFX.itemOtter();floatEl('item','🔨 ハンマー発動！ おじゃまブロック×'+count);burst();burst();shake();
    // onPickaxeフック（鉱山の奇跡など）
    fireArtifactHook('onPickaxe',positions);
    await sleep(220);applyGravity();render();await sleep(200);
    await resolveBoard();
    await processDraftQueue();
    if(isDanger()){endGame('⚠️','ラインオーバー！');return;}
    checkClose();
  }finally{busy=false;}
}

// ─ 発破職人：岩跡地にハムスタースポーン ─
function spawnHamsterAt(r,c){
  if(grid[r][c])return; // 既に何かあれば諦める
  const id=uid++;
  const t={id,tier:1,r,c,spawn:true};
  tiles[id]=t;grid[r][c]=id;paint(t);
}

// ─ ドラフトモーダル（Promise化） ─
function showDraftModal(){
  return new Promise(resolve=>{
    // maxLevelに達していない能力のみ抽選対象
    const pool=ARTIFACTS.filter(a=>{
      const lv=artifactCounts[a.id]||0;
      return lv<(a.maxLevel||5);
    });
    // プールが空またはカード3枚未満ならフォールバックで補充
    const picks=[];const usedIdx=new Set();
    if(pool.length>0){
      while(picks.length<Math.min(3,pool.length)){
        const i=Math.floor(Math.random()*pool.length);
        if(usedIdx.has(i))continue;
        usedIdx.add(i);picks.push(pool[i]);
      }
    }
    if(picks.length<3){
      // フォールバックボーナスで補充
      const fbPool=[...FALLBACK_BONUSES];
      for(let i=fbPool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[fbPool[i],fbPool[j]]=[fbPool[j],fbPool[i]];}
      for(const fb of fbPool){if(picks.length>=3)break;picks.push({...fb,_isFallback:true});}
    }
    if(picks.length===0){floatEl('toast','✨ ひらめきなし');resolve();return;}
    gamePaused=true;
    MUSIC.pause();
    updatePickaxeUI();
    const cardsEl=document.getElementById('draftCards');
    cardsEl.innerHTML=picks.map(a=>{const isFb=!!a._isFallback;const cnt=isFb?0:(artifactCounts[a.id]||0);const nextCnt=cnt+1;const badge=cnt>0?`<span class="dc-stack">×${cnt}</span>`:'';const descTxt=typeof a.desc==='function'?a.desc(nextCnt):a.desc;const maxBadge=(!isFb&&(a.maxLevel||5)===nextCnt)?`<span class="dc-stack" style="background:#7c3aed">MAX!</span>`:'';return`<div class="draft-card" data-id="${a.id}"><div class="dc-emo">${a.emoji}</div><div class="dc-body"><div class="dc-name">${a.name}${badge}${maxBadge}</div><div class="dc-desc">${descTxt}</div></div></div>`;}).join('');
    cardsEl.querySelectorAll('.draft-card').forEach(card=>{
      card.addEventListener('click',()=>{
        const id=card.dataset.id;
        // フォールバックボーナスは artifactCounts に積まない
        const fb=FALLBACK_BONUSES.find(f=>f.id===id);
        if(fb){
          if(typeof fb.apply==='function')fb.apply();
        }else{
          artifactCounts[id]=(artifactCounts[id]||0)+1;
        }
        const a=ARTIFACTS_BY_ID[id]||FALLBACK_BONUSES.find(f=>f.id===id);
        document.getElementById('draftOverlay').classList.remove('show');
        gamePaused=false;
        MUSIC.resumeFromPause();
        updatePickaxeUI();
        if(!fb)floatEl('item',a.emoji+' '+a.name+' 獲得！');
        SFX.itemSpawn();
        updateChikaraListUI();
        resolve();
      },{once:true});
    });
    document.getElementById('draftOverlay').classList.add('show');
  });
}

// ─ resolveBoard外でカバになったタイルを演出付きで処理 ─
async function processPendingHippos(){
  // pendingHippoフラグが立っているタイルを収集
  const pending=Object.keys(tiles).filter(id=>tiles[id]&&tiles[id].pendingHippo&&tiles[id].tier===MAX_TIER);
  if(pending.length===0)return;
  for(const id of pending){
    if(!tiles[id])continue;
    tiles[id].pendingHippo=false;
    const el=document.getElementById('tile-'+id);
    if(el)el.classList.add('hippo-born');
  }
  render();
  floatEl('toast','🦛 コビトカバ誕生！');SFX.bigmerge(5);burst();shake();
  await sleep(900);
  for(const id of pending){
    if(!tiles[id])continue;
    // グリッド全体からIDを検索して削除
    for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++){if(grid[r][c]===Number(id))grid[r][c]=0;}
    removeFade(Number(id));
    hippoMade++;
    accelerateWave(); // カバ1匹ごとに波間隔を短縮
    hippoMeter++;if(hippoMeter>=HIPPO_PER_DRAFT){hippoMeter=0;pendingDraftCount++;}
    updateHippoMeterUI();updateStageUI();
  }
  applyGravity();render();
}

// ─ ドラフトキュー処理：保留分を順番に発火、終わったらステージクリア判定 ─
async function processDraftQueue(){
  while(pendingDraftCount>0){
    pendingDraftCount--;
    await sleep(200);
    await showDraftModal();
    updateStageUI();
  }
  // ステージクリア判定：エンドレス中（TOTAL_STAGES超過）は進行しない
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
  f.innerHTML=`<span class="lu-emo">🌟</span><span class="lu-txt">STAGE ${currentStage}/${TOTAL_STAGES} CLEAR!</span>`;
  boardEl.appendChild(f);
  SFX.bigmerge(5);burst();burst();burst();
  await sleep(1600);
  f.remove();

  // ─ ステージ5クリア → ゲームクリア演出 → エンドレスへ ─
  if(currentStage>=TOTAL_STAGES){
    const gc=document.createElement('div');
    gc.className='levelup-pop';
    gc.innerHTML='<span class="lu-emo">🏆</span><span class="lu-txt">GAME CLEAR!</span>';
    boardEl.appendChild(gc);
    SFX.bigmerge(5);burst();burst();burst();burst();
    await sleep(2000);
    gc.remove();
  }

  // ─ アイテム・ゲージのリセット（スキル溜め防止） ─
  pickaxeGauge=0;
  for(const k of Object.keys(activeSkills))activeSkills[k].gauge=0;

  // 次ステージへ移行
  currentStage++;
  hippoMade=0;
  hippoGoal=getStageGoal(currentStage);
  setupStage(currentStage);
  updateStageUI();updatePickaxeUI();updateSkillSlotsUI();updateHippoMeterUI();

  // ステージ開始演出
  const g=document.createElement('div');
  g.className='levelup-pop';
  const isEndless=currentStage>TOTAL_STAGES;
  g.innerHTML=`<span class="lu-emo">${isEndless?'♾️':'🌊'}</span><span class="lu-txt">${isEndless?'ENDLESS MODE':'STAGE '+currentStage+'/'+TOTAL_STAGES}</span>`;
  boardEl.appendChild(g);
  await sleep(1200);
  g.remove();
  gamePaused=false;
  MUSIC.resumeFromPause();
  updatePickaxeUI();
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

// ─ ステージごとの初期配置ギミック ─
function setupStage(stage){
  // 波カウントリセット（ステージ移行時は加速もリセット）
  resetWaveInterval();
  // 7×10固定（rebuildBoardで差分のみ対応）
  rebuildBoard(BOARD_COLS,BOARD_ROWS);
  const cfg=stage<=TOTAL_STAGES?STAGE_CONFIG[stage]:STAGE_CONFIG[TOTAL_STAGES];
  if(!cfg){render();return;}
  // 入り乱れ配置：下mixRows行に岩・動物・空マスをランダム生成
  const{mixRows,rockRatio}=cfg;
  const startR=ROWS-mixRows;
  for(let r=startR;r<ROWS;r++){
    for(let c=0;c<COLS;c++){
      if(grid[r][c])continue;
      const roll=Math.random();
      if(roll<rockRatio){
        spawnRockAt(r,c);
      }else if(roll<rockRatio+0.55){
        // 動物（ハムスターかリスをランダムに）
        spawnAnimalAt(r,c,Math.random()<0.7?1:2);
      }
      // 残りは空マス
    }
  }
  render();
  // 配置後に3揃いが出来ていたら自動解消（非同期で安全に処理）
  setTimeout(async()=>{
    if(busy)return;busy=true;
    try{await resolveBoard();}finally{busy=false;}
    render();
  },100);
}
function spawnRockAt(r,c){
  if(grid[r][c])return;
  const id=uid++;
  const t={id,tier:0,r,c,rock:true,spawn:true,hp:1};
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
  tiles={};uid=1;score=0;maxChain=0;waveCount=0;survivedDrops=0;resetWaveInterval();activeDropId=0;gameVersion++;busy=false;
  // 新システムのリセット
  for(const k of Object.keys(activeSkills))activeSkills[k].gauge=0;
  pickaxeGauge=0;
  artifactCounts={};gamePaused=false;pendingDraftCount=0;
  hippoMeter=0;nextForceDuck=false;
  currentStage=1;hippoMade=0;hippoGoal=getStageGoal(1);
  updateSkillSlotsUI();updatePickaxeUI();updateStageUI();updateHippoMeterUI();updateChikaraListUI();
  killCounts={1:0,2:0,3:0,4:0,5:0};totalDrops=0;updateLevelUI();
  best=getBestScore();bestEl.textContent=best.toLocaleString()||0;
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
  scoreEl.textContent='0';updateQueue();updateRiseCounter();
  requestAnimationFrame(()=>{const dl=document.getElementById('dangerLine'),lb=document.getElementById('dangerLabel');if(dl)dl.style.top=topOf(DANGER_ROW);if(lb)lb.style.top=topOf(DANGER_ROW);});
  MUSIC.stop();setTimeout(()=>MUSIC.start(),300);

}

// ─ タイル描画 ─
function leftOf(c){return`calc(${c} * ((100% - var(--gap)*${COLS-1})/${COLS} + var(--gap)))`;}
function topOf(r){return`calc(${r} * ((100% - var(--gap)*${ROWS-1})/${ROWS} + var(--gap)))`;}
function isDanger(){for(const id in tiles)if(tiles[id].r<DANGER_ROW)return true;return false;}
function checkClose(){let c=false;for(const id in tiles)if(tiles[id].r===DANGER_ROW)c=true;boardEl.classList.toggle('close',c);}
function emptyCount(){let n=0;for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++)if(!grid[r][c])n++;return n;}
function isSpecial(t){return t&&t.rock;}
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
  // スコア計算（消した動物のtier分）
  let pts=0;
  for(const id of toClear)if(tiles[id]&&tiles[id].tier>0)pts+=SCORE_TABLE[tiles[id].tier]||0;
  // 消去前に座標を記録（tiles削除前）
  const clearedCells=[];
  for(const id of toClear){if(!tiles[id])continue;clearedCells.push({r:tiles[id].r,c:tiles[id].c,rock:!!tiles[id].rock});}
  for(const id of toClear){if(!tiles[id])continue;const{r,c}=tiles[id];grid[r][c]=0;removeFade(id);}
  if(pts>0)addScore(pts);

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
  if(t.rock){
    el.classList.remove('t1','t2','t3','t4','t5');
    el.classList.add('rock');
    el.querySelector('.emo').textContent='🪨';el.querySelector('.nm').textContent='がんせき';
  }
  else{const a=ANIMALS[t.tier];el.classList.remove('t1','t2','t3','t4','t5','rock');el.classList.add(a.cls);el.querySelector('.emo').textContent=a.emo;el.querySelector('.nm').textContent=a.nm;}
  el.style.left=leftOf(t.c);el.style.top=topOf(t.r);
  const inner=el.querySelector('.inner');
  if(t.bump){inner.style.animation='none';void inner.offsetWidth;inner.style.animation='bump .27s ease';t.bump=false;}
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
function tiersJump(size){return 1;} // 合体数に関わらず常に+1段階
function applyGravity(){for(let c=0;c<COLS;c++){const stack=[];for(let r=ROWS-1;r>=0;r--)if(grid[r][c])stack.push(grid[r][c]);for(let r=0;r<ROWS;r++)grid[r][c]=0;for(let i=0;i<stack.length;i++){const r=ROWS-1-i;grid[r][c]=stack[i];tiles[stack[i]].r=r;tiles[stack[i]].c=c;}}}

// ─ resolveBoard ─
async function resolveBoard(){
  let chain=0;
  while(true){
    const comps=findComponents();if(comps.length===0)break;
    chain++;const mult=Math.min(chain,MAX_CHAIN);
    let waveScore=0,createdHippo=false,bigLeap=false,superLeap=false;
    const removeSet=new Set(),survBumps=[];
    const hippoBirths=[]; // 今チェーンで誕生したカバ：{r,c}
    for(const cp of comps){
      if(cp.tier>=MAX_TIER)continue; // カバの連結成分はそもそも作られないが念のため
      const surv=pickSurvivor(cp.cells),sid=grid[surv.r][surv.c];
      const size=cp.cells.length,prev=cp.tier,newTier=Math.min(prev+1,MAX_TIER),rise=newTier-prev;
      // 生存セル以外をremoveSetへ
      for(const cell of cp.cells){
        if(cell.r===surv.r&&cell.c===surv.c)continue;
        const cid=grid[cell.r][cell.c];grid[cell.r][cell.c]=0;
        tiles[cid].r=surv.r;tiles[cid].c=surv.c;
        removeSet.add(cid);addKill(cp.tier);
      }
      survBumps.push({id:sid,tier:newTier});
      waveScore+=SCORE_TABLE[newTier]+(size>=3?size*8:0);
      // ─ アクティブスキル獲得（4個同時=+2, 5個以上=+3 ボーナス） ─
      const chargeBonus=size>=5?3:size>=4?2:1;
      let skillKey=null;
      if(newTier===3)skillKey='duck_march';
      else if(newTier===4)skillKey='refresh';
      if(skillKey){
        for(let i=0;i<chargeBonus;i++)addActiveSkill(skillKey);
      }
      // ─ ピッケル微蓄積（合体1回ごと） ─
      addPickaxeProgress(PICKAXE_MERGE_GAIN);
      // ─ 大量同時消し（4個以上）でonBigMergeフック ─
      if(size>=4)fireArtifactHook('onBigMerge',size);
      // ─ onMergeフック ─
      fireArtifactHook('onMerge',newTier);
      // カバ誕生：IDフラグで管理して演出後に確実削除
      if(newTier===MAX_TIER&&prev<MAX_TIER){
        createdHippo=true;
        hippoBirths.push(sid); // IDのみ保持（座標は使わない）
        tiles[sid].pendingHippo=true; // 削除待ちフラグ
        addKill(MAX_TIER);
      }
      else if(rise>=3)superLeap=true;else if(rise>=2)bigLeap=true;
    }
    render();await sleep(205);
    removeSet.forEach(id=>{if(id)removeFade(id);});
    // カバ以外を先に進化
    survBumps.forEach(b=>{
      if(tiles[b.id]?.pendingHippo)return; // カバは後で処理
      tiles[b.id].tier=b.tier;tiles[b.id].bump=true;
    });
    render();addScore(waveScore*mult);
    // ─ 通常エフェクト ─
    if(superLeap){floatEl('chain','⚡ 超進化！');SFX.bigmerge(4);burst();burst();shake();}
    else if(bigLeap){floatEl('chain','✨ 大進化！');SFX.bigmerge(3);burst();shake();}
    else if(chain>=2){floatEl('chain','🔥 '+chain+'チェイン！');SFX.chain(chain);if(chain>=3)shake();}
    else if(survBumps.filter(b=>!tiles[b.id]?.pendingHippo).length>0){const nb=survBumps.find(b=>!tiles[b.id]?.pendingHippo);SFX.merge(nb?tiles[nb.id]?.tier||2:2);}
    // ─ カバ誕生演出（0.9秒見せ場）─ IDベース・座標に依存しない ─
    if(hippoBirths.length>0){
      // カバタイルにアニメーションクラスを付与
      for(const sid of hippoBirths){
        if(!tiles[sid])continue;
        tiles[sid].tier=MAX_TIER;tiles[sid].bump=false;
        const el=document.getElementById('tile-'+sid);
        if(el)el.classList.add('hippo-born');
      }
      render();
      floatEl('toast','🦛 コビトカバ誕生！');SFX.bigmerge(5);burst();burst();shake();
      await sleep(900); // 見せ場
      // IDで追跡して確実に削除
      for(const sid of hippoBirths){
        const t=tiles[sid];
        if(!t)continue;
        if(grid[t.r]&&grid[t.r][t.c]===sid)grid[t.r][t.c]=0; // 座標が生きていれば消す
        // 念のため全グリッドからIDを検索して削除
        for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++){if(grid[r][c]===sid)grid[r][c]=0;}
        removeFade(sid);
        hippoMade++;
        accelerateWave(); // カバ1匹ごとに波間隔を短縮
        hippoMeter++;if(hippoMeter>=HIPPO_PER_DRAFT){hippoMeter=0;pendingDraftCount++;}
        updateHippoMeterUI();updateStageUI();
      }
      render();
    }
    // ─ チェーンボーナス（ピッケル＆onChainフック） ─
    addPickaxeProgress(chain*chain*PICKAXE_CHAIN_GAIN);
    fireArtifactHook('onChain',chain);
    maxChain=Math.max(maxChain,chain);
    updateStageUI();
    await sleep(160);applyGravity();render();await sleep(225);
  }
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
    await resolveBoard();if(gameVersion!==gv)return;
    activeDropId=0;
    // ─ カバ誕生で溜まったドラフトをキュー処理 ─
    await processDraftQueue();if(gameVersion!==gv)return;
    if(isDanger()){endGame('⚠️','ラインオーバー！');return;}
    const wasClose=Object.values(tiles).some(t=>t.r<=DANGER_ROW);
    checkClose();
    totalDrops++;survivedDrops++;dropsUntilWave--;
    // 波判定
    if(dropsUntilWave<=0){
      dropsUntilWave=currentWaveInterval; // 加速済みの間隔でリセット
      await riseStep();if(gameVersion!==gv)return;
      if(isDanger()||emptyCount()===0){endGame('😵','波にのまれた！');return;}
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
  // 波システム：全列一気に1行せり上がる
  for(let c=0;c<COLS;c++){
    if(grid[0][c])removeFade(grid[0][c]);
    for(let r=0;r<ROWS-1;r++){
      grid[r][c]=grid[r+1][c];
      if(grid[r][c])tiles[grid[r][c]].r=r;
    }
    grid[ROWS-1][c]=0;
    const isRock=Math.random()<getRockChance();
    const id=uid++;
    const t={id,tier:isRock?0:rollRiseTier(),r:ROWS-1,c,spawn:true,rock:isRock,hp:1};
    tiles[id]=t;grid[ROWS-1][c]=id;
  }
}
async function riseStep(){
  waveCount++;updateAtmosphere();
  SFX.rise();floatEl('warn','⬆️ ブロックがせりあがった！');await sleep(440);
  await doOneRise();
  render();
  await sleep(200);
  await resolveBoard();
  // ─ 波を1回やり過ごした報酬（波乗り等でカバが生まれる可能性あり） ─
  addPickaxeProgress(PICKAXE_WAVE_GAIN);
  fireArtifactHook('onWave');
  // 波乗り等でpendingHippoになったタイルを演出処理
  await processPendingHippos();
  await processDraftQueue();
}

// ─ スコア・エフェクト ─
function addScore(add){if(add<=0)return;score+=add;scoreEl.textContent=score.toLocaleString();floatEl('pts','+'+add);if(score>best){best=score;bestEl.textContent=best.toLocaleString();}}
// フローティングメッセージキュー（重なり防止）
const _floatQueue=[];let _floatRunning=false;
function floatEl(type,txt){
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
  setTimeout(()=>{f.remove();_drainFloatQueue();},type==='chain'||type==='warn'?520:380);
}
function shake(){boardEl.classList.remove('shake');void boardEl.offsetWidth;boardEl.classList.add('shake');setTimeout(()=>boardEl.classList.remove('shake'),360);}
function burst(){const ico=['✨','💫','⭐','🦛'];for(let i=0;i<8;i++){const p=document.createElement('div');p.className='particle';const ang=Math.random()*6.28,dist=42+Math.random()*55;p.style.left=(35+Math.random()*30)+'%';p.style.top=(30+Math.random()*30)+'%';p.style.setProperty('--tx',(Math.cos(ang)*dist)+'px');p.style.setProperty('--ty',(Math.sin(ang)*dist)+'px');p.textContent=ico[i%4];boardEl.appendChild(p);setTimeout(()=>p.remove(),620);}}


function clearGame(){
  const entry={score,maxChain,totalDrops,date:Date.now(),cleared:true};
  const history=saveHistory(entry);
  const isNew=score>0&&score>=getBestScore();
  if(isNew)best=score;bestEl.textContent=best.toLocaleString();
  document.getElementById('ovEmo').textContent='🎉';
  document.getElementById('ovTitle').textContent='生き残った！🏁';
  document.getElementById('finscore').textContent=score.toLocaleString();
  document.getElementById('finmsg').textContent=`Stage ${currentStage} ／ カバ${hippoMade}体作成 ／ 最大${maxChain}チェイン`+(isNew?' 🏆':'');
  renderHistory(history);
  overlay.classList.add('show','cleared');
  boardEl.classList.remove('close');
  // クリア用ボタン表示切替
  const rb=document.getElementById('retryBtns');if(rb)rb.style.display='none';
  const cb=document.getElementById('clearOkBtn');if(cb)cb.style.display='block';
  MUSIC.stop();burst();burst();burst();shake();
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
  // ゲージ・スキルはリセット
  pickaxeGauge=0;
  for(const k of Object.keys(activeSkills))activeSkills[k].gauge=0;
  pendingDraftCount=0;hippoMeter=0;nextForceDuck=false;
  // ステージ進捗はリセット（ステージ番号・ひらめき・スコアは維持）
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
  updateSkillSlotsUI();updatePickaxeUI();updateStageUI();updateHippoMeterUI();updateChikaraListUI();
  scoreEl.textContent=score.toLocaleString();updateQueue();updateRiseCounter();
  requestAnimationFrame(()=>{const d=document.getElementById('dangerLine'),l=document.getElementById('dangerLabel');if(d)d.style.top=topOf(DANGER_ROW);if(l)l.style.top=topOf(DANGER_ROW);});
  MUSIC.stop();setTimeout(()=>MUSIC.start(),300);
  setupStage(currentStage);
  floatEl('toast','🔄 ステージ '+currentStage+' やり直し！');
}

function endGame(emo,title){
  const entry={score,maxChain,date:Date.now()};
  const history=saveHistory(entry);
  const isNew=score>0&&score>=getBestScore();
  if(isNew)best=score;bestEl.textContent=best.toLocaleString();
  document.getElementById('ovEmo').textContent=emo;document.getElementById('ovTitle').textContent=title;
  document.getElementById('finscore').textContent=score.toLocaleString();
  document.getElementById('finmsg').textContent=isNew?'🎉 自己ベスト更新！':'ベスト '+best.toLocaleString()+' ／ 最大 '+maxChain+'チェイン';
  renderHistory(history);
  MUSIC.stop();SFX.gameover();overlay.classList.add('show');boardEl.classList.remove('close');
  // ゲームオーバー用ボタン表示切替
  const rb=document.getElementById('retryBtns');if(rb)rb.style.display='flex';
  const cb=document.getElementById('clearOkBtn');if(cb)cb.style.display='none';
}

// ─ 入力 ─
function cellFromXY(cx,cy){const rect=boardEl.getBoundingClientRect(),pad=parseFloat(getComputedStyle(boardEl).paddingLeft),iW=rect.width-2*pad,iH=rect.height-2*pad;return{col:Math.max(0,Math.min(COLS-1,Math.floor((cx-rect.left-pad)/iW*COLS))),row:Math.max(0,Math.min(ROWS-1,Math.floor((cy-rect.top-pad)/iH*ROWS)))};}
boardEl.addEventListener('click',e=>{
  MUSIC.resume();
  if(overlay.classList.contains('show')||gamePaused)return;
  const{col}=cellFromXY(e.clientX,e.clientY);
  if(!busy)drop(col);
});
boardEl.addEventListener('pointermove',e=>{if(busy)return;const{col}=cellFromXY(e.clientX,e.clientY);bgCells.forEach((d,i)=>d.classList.toggle('aim',i%COLS===col&&!d.classList.contains('dz0')&&!d.classList.contains('dz1')));});
boardEl.addEventListener('pointerleave',()=>bgCells.forEach(d=>d.classList.remove('aim')));
document.getElementById('ovBtn').onclick=newGame;
document.getElementById('retryStageBtn').onclick=retryStage;
document.getElementById('clearOkBtn').onclick=newGame;
document.getElementById('restart').onclick=newGame;
document.getElementById('shareBtn').addEventListener('click',()=>{const txt=`🐹どうぶつポトン🦛\nスコア: ${score.toLocaleString()}点\n最大${maxChain}チェイン\n#どうぶつポトン`;if(navigator.share){navigator.share({text:txt}).catch(()=>{});}else{navigator.clipboard.writeText(txt).then(()=>{const b=document.getElementById('shareBtn');b.textContent='コピー済み✓';setTimeout(()=>{b.textContent='シェア📤';},2000);}).catch(()=>{});}});
function toggleHelp(){document.getElementById('helpPanel').classList.toggle('show');}
try{newGame();}catch(e){window.onerror(e.message,'',0,0,e);}

// ─ デバッグパネル ─
function toggleDebug(){const b=document.getElementById('debugBody');const t=document.getElementById('debugToggle');const open=b.style.display==='block';b.style.display=open?'none':'block';t.textContent=open?'⚙️':'✕';}
function setParam(key,val){
  if(key==='waveInterval'){_dpWaveInterval=val;document.getElementById('dp-waveInterval').textContent=val+'手';}
  if(key==='rockRate'){_dpRockRate=val;document.getElementById('dp-rockRate').textContent=Math.round(val*100)+'%';}
  event.target.closest('.dp-row')?.querySelectorAll('.dp-btn').forEach(b=>b.classList.remove('on'));
  event.target.classList.add('on');
}
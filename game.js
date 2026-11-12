import {createScene,HOME_FEEDING_MS,HOME_CELEBRATION_START,homeFeedingProgress} from './scene.js';
import {createRun,step,eat,rescue,interact,scoreRun,serializeRun,restoreRun,DIFFICULTIES} from './rules.js';
import {WORLD,getWorld,laneAt} from './world.js';
import {insideHazard} from './hazards.js';
import {createProfile,ACHIEVEMENTS} from './profile.js';
import {createAudio} from './audio.js';
import {tr,getLanguage,setLanguage,initLanguage,applyLanguage} from './i18n.js';
import {createBooth} from './booth.js';
import {
 screenToWorld,worldToScreenAxes,viewToWorld,worldToViewAxes,
 FIRST_PERSON_PITCH,wrapViewYaw,clampViewPitch,
} from './controls.js';

const cache=new Map();
const $=id=>{if(!cache.has(id))cache.set(id,document.getElementById(id));return cache.get(id);};
const profile=createProfile(),audio=createAudio(),booth=createBooth();
initLanguage(profile.data.settings.language);
let boothMode=document.documentElement.dataset?.booth==='true';
const activeWorld=()=>getWorld(boothMode?'booth':'normal');
let settings={...profile.data.settings},difficulty=boothMode?booth.data.settings.difficulty:'normal',state=createRun(difficulty,{species:settings.species,mode:boothMode?'booth':'normal'});
let mode='intro',paused=false,scene,last=0,hudClock=0,saveClock=0,lastFood=0,lastStage=0,lastMessage='',lastWind=false,toastUntil=0,returnToPause=false,tutorial=false;
const keys=new Set(),touch=new Set();let slideHeld=false;
let menuView='overhead',lookDrag=null;
let resultView=null,resultElapsed=null,lastToast='';
let boothEntry=null,boothPhase='ready',practiceTime=0,practiceMoved=false,practiceCaught=false,practiceStart={x:0,z:5},lastActivity=0,idleDeadline=0,idleWasPaused=false,returnDeadline=0;
const boothSpeciesOrder=['gentoo','adelie','chinstrap'];
let boothSpecies=null;
let boardRuleset=2;
const map=$('route-map').getContext('2d');
const text=(id,value)=>{const el=$(id),v=tr(String(value));if(el.textContent!==v)el.textContent=v;};
const formatTime=s=>`${Math.floor(s/60).toString().padStart(2,'0')}:${Math.floor(s%60).toString().padStart(2,'0')}`;
function formatResultTime(seconds){
 const tenths=Math.round(seconds*10);
 return `${formatTime(Math.floor(tenths/10))}.${tenths%10}`;
}
const touchPointer=globalThis.matchMedia?.('(pointer: coarse), (hover: none)');
const showsTouchControls=()=>!!touchPointer?.matches||$('world').clientWidth<=560;
const clearInput=()=>{keys.clear();touch.clear();slideHeld=false;lookDrag=null;};
const unlockAudio=()=>{audio.unlock();};
const firstPerson=()=>state.view==='first';
const moveInView=(horizontal,vertical)=>firstPerson()?viewToWorld(horizontal,vertical,state.viewYaw):screenToWorld(horizontal,vertical);
const relativeToView=(x,z)=>firstPerson()?worldToViewAxes(x,z,state.viewYaw):worldToScreenAxes(x,z);
function syncViewControls(){
 document.body.classList.toggle('first-person',mode==='playing'&&firstPerson());
 const switchLabel=firstPerson()?'切换到俯视':'切换到第一人称';
 text('pause-view',switchLabel);
 document.querySelectorAll('[data-view]').forEach(button=>{
  const selected=button.dataset.view===menuView;
  button.classList.toggle('selected',selected);
  button.setAttribute('aria-pressed',String(selected));
 });
}
function facePassage(){
 const lookAhead=12,target=laneAt(state.z+lookAhead,activeWorld());
 state.viewYaw=Math.atan2(target.x-state.x,lookAhead);
 state.viewPitch=FIRST_PERSON_PITCH;
}
function togglePauseView(){
 if(boothMode||mode!=='playing'||!paused||!$('pause-dialog').open)return;
 state.view=firstPerson()?'overhead':'first';
 menuView=state.view;
 if(firstPerson())facePassage();
 clearInput();syncViewControls();updateHud();checkpoint();
}
function selectedSpecies(){
 if(!boothMode)return settings.species;
 return boothSpecies??boothSpeciesOrder[booth.getSummary().participants%boothSpeciesOrder.length];
}
function toast(message,seconds=4){lastToast=message;text('toast',message);toastUntil=performance.now()+seconds*1000;$('toast').classList.add('visible');}
function safeRestore(snapshot){try{return restoreRun(snapshot);}catch{return null;}}
function checkpoint(){
 if(boothMode)return false;
 if(mode!=='playing'||state.status!=='playing')return false;
 try{const snapshot=serializeRun(state);profile.setCheckpoint(snapshot);text('autosave',profile.available?'已保存到本机':'当前浏览器无法保存');return profile.available;}catch{text('autosave','本次旅程暂时无法保存');return false;}
}
function refreshMenu(){
 const saved=boothMode?null:safeRestore(profile.getCheckpoint());$('continue').classList.toggle('hidden',!saved);
 if(saved){const chapter=WORLD.chapters[saved.stage];$('continue').innerHTML='';const label=document.createElement('span');label.textContent=tr(`继续 · ${chapter.title}`);const arrow=document.createElement('span');arrow.textContent='↗';$('continue').append(label,arrow);}
 text('save-note',profile.available?'本机自动保存 · 1.10':'此浏览器无法保存 · 当前页面仍可完整游玩');
 if(boothMode){text('save-note','每位玩家重新开始 · 今日成绩保存在本机');text('booth-banner',`摊位体验 · ${DIFFICULTIES[difficulty].label}难度 · ${booth.data.settings.duration} 秒`);}
 text('show-board',boothMode?'今日排行榜':'旅程记录');
 document.querySelectorAll('[data-difficulty]').forEach(b=>{const selected=b.dataset.difficulty===difficulty;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));});
 const species=selectedSpecies();
 if(mode==='intro')state.species=species;
 document.querySelectorAll('[data-species]').forEach(button=>{
  const selected=button.dataset.species===species;
  button.classList.toggle('selected',selected);
  button.setAttribute('aria-pressed',String(selected));
 });
 syncViewControls();
}
function closeAll(){resultElapsed=null;$('home-feeding').classList.add('hidden');document.querySelectorAll('dialog[open]').forEach(d=>d.close());returnToPause=false;}
function applySettings(){
 settings={...profile.data.settings};audio.setEnabled(settings.sound);audio.setVolume(settings.volume);scene?.setOptions?.({quality:settings.quality,reducedMotion:settings.reducedMotion});
 document.body.classList.toggle('reduced-motion',settings.reducedMotion);text('sound',`声音：${settings.sound?'开':'关'}`);$('sound').setAttribute('aria-pressed',String(settings.sound));
 $('setting-sound').checked=settings.sound;$('setting-volume').value=Math.round(settings.volume*100);$('setting-quality').value=settings.quality;$('setting-motion').checked=settings.reducedMotion;
 $('setting-language').value=getLanguage();
 $('booth-difficulty').value=booth.data.settings.difficulty;$('booth-duration').value=booth.data.settings.duration;$('booth-quality').value=settings.quality;
 if(mode==='intro')state.species=selectedSpecies();
}
function launch(saved=null){
 if(boothMode){launchBoothPractice();return;}
 closeAll();clearInput();unlockAudio();resultView=null;state=saved||createRun(difficulty,{species:settings.species,view:menuView});
 menuView=state.view;
 if(!saved&&firstPerson())facePassage();
 if(!state.runId)state.runId=`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
 difficulty=state.difficulty;mode='playing';paused=false;lastFood=state.food;lastStage=state.stage;lastMessage=state.message;lastWind=!!state.windWarning;saveClock=0;hudClock=0;last=performance.now();
 document.body.classList.add('playing');$('intro').classList.add('hidden');$('scene-caption').classList.add('hidden');$('hud').classList.remove('hidden');$('pause').classList.remove('hidden');
 tutorial=!saved&&!settings.tutorialSeen;$('tutorial').classList.toggle('hidden',!tutorial);syncViewControls();updateHud();checkpoint();
 toast(saved?'旅程已接续 · 你的食物、状态与救援记录都还在':'幼鸟在等你 · 至少带 4 条鱼回家，也留些补给给自己',6);audio.cue('stage');
}
function requestStart(){if(!boothMode&&safeRestore(profile.getCheckpoint()))$('replace-dialog').showModal();else launch();}
function home(){
 boothSpecies=null;menuView='overhead';
 if(mode==='playing')checkpoint();if(boothMode&&boothEntry)booth.abandonRun(boothEntry.runId);boothEntry=null;boothPhase='ready';returnDeadline=idleDeadline=0;closeAll();clearInput();mode='intro';paused=false;if(boothMode)difficulty=booth.data.settings.difficulty;state=createRun(difficulty,{species:settings.species,mode:boothMode?'booth':'normal'});
 document.body.classList.remove('playing','polluted','cold','has-oil');$('intro').classList.remove('hidden');$('scene-caption').classList.remove('hidden');$('hud').classList.add('hidden');$('pause').classList.add('hidden');refreshMenu();
 $('booth-result').classList.add('hidden');$('booth-clear-confirm').classList.add('hidden');markActivity();
}
function pause(){if(mode!=='playing'||paused)return;paused=true;clearInput();const saved=checkpoint();text('pause-copy',boothMode?'已暂停。工作人员可以继续这局，或返回开始页。':saved?'旅程已暂停并保存，体温和体力不会流失。':'旅程已暂停。此浏览器暂不能保存，关闭页面会失去进度。');$('pause-dialog').showModal();}
function resume(){if(mode!=='playing')return;closeAll();paused=false;clearInput();last=performance.now();unlockAudio();}
function openPanel(id){
 if(mode==='playing'){if(!paused)pause();$('pause-dialog').close();returnToPause=true;}
 if(id==='settings-dialog')applySettings();$(id).showModal();
}
function closePanel(dialog){dialog.close();if(dialog.id==='booth-staff-dialog'&&$('result-dialog').open)returnDeadline=performance.now()+12000;if(returnToPause&&mode==='playing'){returnToPause=false;$('pause-dialog').showModal();}}

function drawMap(){
 const world=activeWorld(),w=190,h=130,scale=.9,origin={x:95,y:firstPerson()?84:110};
 const point=(x,z)=>{const p=relativeToView(x-state.x,z-state.z);return {x:origin.x+p.x*scale,y:origin.y-p.y*scale};};
 map.clearRect(0,0,w,h);map.fillStyle='#99c6cc';map.fillRect(0,0,w,h);map.save();map.beginPath();map.rect(10,3,170,124);map.clip();
 const right=moveInView(1,0),up=moveInView(0,1);map.save();map.translate(origin.x,origin.y);map.transform(right.x*scale,-up.x*scale,right.z*scale,-up.z*scale,0,0);map.translate(-state.x,-state.z);
 map.save();map.beginPath();
 world.lane.forEach((knot,index)=>map[index?'lineTo':'moveTo'](knot.x-knot.halfWidth,knot.z));
 for(let index=world.lane.length-1;index>=0;index--){
  const knot=world.lane[index];map.lineTo(knot.x+knot.halfWidth,knot.z);
 }
 map.closePath();map.clip();
 map.fillStyle='#41374b';for(const o of state.oilPatches){map.beginPath();map.ellipse(o.x,o.z,o.rx,o.rz,0,0,7);map.fill();}
 for(const item of state.nets){
  map.strokeStyle='#a95c35';map.beginPath();map.ellipse(item.x,item.z,item.rx,item.rz,0,0,7);map.stroke();
 }
 for(const item of state.plastics){
  map.fillStyle='#ecf5ee';map.fillRect(item.x-1,item.z-1,2,2);
 }
 map.restore();
 map.fillStyle='#e9f1e9';for(const i of world.ice){if(i.type==='rect')map.fillRect(i.x-i.width/2,i.z-i.length/2,i.width,i.length);else{map.beginPath();map.ellipse(i.x,i.z,i.rx,i.rz,0,0,7);map.fill();}}
 map.fillStyle='#6a8790';for(const o of world.obstacles){map.beginPath();map.ellipse(o.x,o.z,o.rx,o.rz,0,0,7);map.fill();}
 map.strokeStyle='#476e7d';map.lineWidth=1.6;
 for(const side of [-1,1]){
  map.beginPath();
  world.lane.forEach((knot,index)=>map[index?'lineTo':'moveTo'](knot.x+side*knot.halfWidth,knot.z));
  map.stroke();
 }
 map.strokeStyle='#376171';map.lineWidth=1;map.setLineDash([3,5]);map.beginPath();
 world.lane.forEach((knot,index)=>map[index?'lineTo':'moveTo'](knot.x,knot.z));
 map.stroke();map.setLineDash([]);
 for(const item of state.visitors){
  map.strokeStyle=item.blocked?'#b54b39':'#28765e';
  map.beginPath();map.moveTo(item.x-item.rx,item.z);map.lineTo(item.x+item.rx,item.z);map.stroke();
 }
 map.restore();
 for(const f of state.fish){if(!f.active||f.polluted)continue;const p=point(f.x,f.z);map.fillStyle='#b77b24';map.beginPath();map.arc(p.x,p.y,2,0,7);map.fill();}
 map.strokeStyle='#d45e32';map.lineWidth=2;for(const r of state.rescues){if(r.used)continue;const p=point(r.x,r.z);map.beginPath();map.moveTo(p.x-3,p.y);map.lineTo(p.x+3,p.y);map.moveTo(p.x,p.y-3);map.lineTo(p.x,p.y+3);map.stroke();}
 for(const s of state.signals||[]){const p=point(s.x,s.z);map.fillStyle=s.reported?'#8daf99':'#247858';map.fillRect(p.x-2.5,p.y-2.5,5,5);}
 const goal=point(world.goal.x,world.goal.z),gx=Math.max(20,Math.min(170,goal.x)),gy=Math.max(15,Math.min(116,goal.y));
 map.fillStyle='#173e4c';map.font='9px sans-serif';map.textAlign='center';map.fillText(tr('家'),gx,gy-5);
 if(goal.x!==gx||goal.y!==gy){const angle=Math.atan2(goal.y-origin.y,goal.x-origin.x);map.save();map.translate(gx,gy+1);map.rotate(angle);map.beginPath();map.moveTo(4,0);map.lineTo(-3,-3);map.lineTo(-3,3);map.closePath();map.fill();map.restore();}
 map.fillStyle='#fff8d6';map.strokeStyle='#194c57';map.lineWidth=1.5;map.beginPath();map.arc(origin.x,origin.y,4,0,7);map.fill();map.stroke();map.restore();
}
function updateHud(){
 const WORLD=activeWorld();
 const touchLayout=showsTouchControls();
 const c=WORLD.chapters[state.stage]||WORLD.chapters[0];text('chapter-index',c.tag);text('chapter-name',c.title);text('chapter-description',c.description);
 for(const key of ['temperature','energy','oil']){const val=Math.max(0,Math.min(100,state[key]));$(key).value=val;text(key+'-text',Math.ceil(val)+(key==='oil'?'%':''));$(key+'-text').classList.toggle('low',key==='oil'?val>50:val<25);}
 const temperatureLevel=state.temperature<25?'critical':state.temperature<45?'low':'';
 $('temperature-stat').dataset.level=temperatureLevel;
 text('temperature-state',temperatureLevel==='critical'?'过低':temperatureLevel==='low'?'偏低':'');
 text('insulation',Math.round(state.insulation)+'%');text('food',state.food);text('capacity',state.maxFood);text('required-food',state.requiredFood);text('time',formatTime(state.time));
 text('terrain',state.terrain==='water'?'海水 · 游泳':state.slide?'冰面 · 滑行':'冰面 · 行走');text('distance',Math.round(Math.max(0,WORLD.goal.z-state.z))+' m');
 $('route-progress').style.width=`${Math.min(100,state.z/WORLD.goal.z*100)}%`;
 $('eat').disabled=state.food===0||state.energy>=99||!!state.treatment;
 $('rescue').disabled=!!state.treatment||!state.rescues.some(r=>!r.used&&Math.hypot(r.x-state.x,r.z-state.z)<5);
 $('signal').disabled=!!state.treatment||!(state.signals||[]).some(s=>!s.reported&&Math.hypot(s.x-state.x,s.z-state.z)<5.5);
 document.body.classList.toggle('polluted',state.oil>30);document.body.classList.toggle('cold',state.temperature<30);
 document.body.classList.toggle('has-oil',state.oil>=1);
 const wind=state.wind||0,stage=state.stage,reported=state.signals.filter(s=>s.reported).length;
 text('mission-food',`${state.food>=state.requiredFood?'✓':'○'} 为幼鸟留下 ${state.requiredFood} 条鱼`);$('mission-food').classList.toggle('done',state.food>=state.requiredFood);
 text('mission-signal',`${reported?'✓':'○'} 呼叫同伴救援 ${reported}/${state.signals.length}（可选）`);$('mission-signal').classList.toggle('done',reported>0);
 text('environment-label',['清洁海域','潮水','泄漏仍在扩散','登陆口','雪地风势'][stage]);
 text('environment-value',stage<2?'储备食物':stage===2?`${Math.round(state.spread*100)}% 扩散进程`:stage===3?(state.visitors[0].blocked?'游客经过':'向导让行'):state.windWarning?'阵风将至':wind>.4?'强风中':'短暂平静');
 text('environment-detail',['','塑料漂近时，鱼群会向边缘散开。','留意浮标，水下有网。','等向导让行，再从登陆口通过。',''][stage]);
 $('environment-progress').style.width=(stage===2?state.spread*100:stage===4?wind*100:stage===3?reported/state.signals.length*100:0)+'%';
 text('current-note','');
 updateContextHint(touchLayout);
 $('treatment').classList.toggle('hidden',!state.treatment);
 if(state.treatment){
  const progress=1-state.treatment.remaining/state.treatment.duration;
  $('treatment-progress').value=Math.min(1,progress);
  text('treatment-stage',progress<.55?'清理羽毛':progress<.85?'保暖恢复':'检查羽毛');
 }
 if(tutorial&&!boothMode){
  const movement=firstPerson()?firstPersonInstructions(touchLayout)
   :touchLayout?'按方向键移动。冰上按住滑行。':'按画面方向移动。冰上按住空格滑行。';
  text('tutorial-copy',state.food>0?'多捕几条给自己吃，留 4 条回巢。':state.terrain==='water'?'靠近金色小鱼就能捕到。':movement);
  if(state.stage>0)dismissTutorial();
 }
 if(boothMode)updateBoothHud(touchLayout);
 drawMap();
}

const nearLanding=()=>state.visitors.find(item=>Math.abs(item.z-state.z)<item.rz+6);
const firstPersonInstructions=touchLayout=>touchLayout?'方向键移动 · 拖动右侧转头':'WASD 移动 · 左右方向键转头';
function hazardAhead(item){
 const offset=relativeToView(item.x-state.x,item.z-state.z);
 const radius=Math.max(item.rx,item.rz);
 return offset.y>0&&offset.y-radius<12&&Math.abs(offset.x)<radius+2;
}
function netEscapeControl(touchLayout){
 const {escapeX,escapeZ}=state.snag;
 const vector=relativeToView(escapeX,escapeZ);
 const index=Math.abs(vector.x)>Math.abs(vector.y)?(vector.x>0?0:1):(vector.y>0?2:3);
 return firstPerson()&&!touchLayout?['D','A','W','S'][index]:['→','←','↑','↓'][index];
}
function updateContextHint(touchLayout){
 let hint='',kind='',progress=0;
 const crossing=nearLanding();
 if(state.snag){
  const control=netEscapeControl(touchLayout);
  hint=firstPerson()?`缠网了 · 按住 ${control} 脱网`:`缠网了 · 按住 ${control} 退出来`;
  kind='snag';
  progress=Math.max(state.snag.progress/DIFFICULTIES[state.difficulty].netRelease,state.snag.elapsed/4.3);
 }else if(state.inOil){hint='沾油了 · 尽快离开油污';kind='danger';}
 else if(crossing&&crossing.blocked){
  hint=`游客经过 · 等 ${Math.ceil(crossing.remaining)} 秒`;
  kind='crossing';progress=crossing.progress;
 }else if(crossing){hint='向导让行 · 可以通过';kind='clear';}
 else if(firstPerson()&&state.nets.some(hazardAhead)){hint='渔网在前方';kind='caution';}
 else if(firstPerson()&&(state.oilWarning||state.oilPatches.some(hazardAhead))){hint='油污在前方';kind='caution';}
 else if(state.nets.some(item=>insideHazard(state.x,state.z,item,3.8))){hint='浮标下有渔网 · 从网边游过';kind='caution';}
 else if(state.windWarning||state.wind>.55){hint='阵风 · 到岩石后避风';kind='caution';}
 else if(state.plastics.some(item=>insideHazard(state.x,state.z,item,1.5)))hint='塑料漂过来了 · 看鱼群往哪游';
 else if(!$('signal').disabled)hint=touchLayout?'靠近同伴 · 点求助报告位置':boothMode?'受困企鹅就在附近，按 R 互动求助。':'发现受困企鹅 · 按 F 向专业救援队报告位置';
 else if(state.inShelter)hint='背风处 · 停下休息，恢复体温与体力';
 else if(!$('rescue').disabled)hint=touchLayout?'已到营地，点清理按钮接受照护。':'靠近救援站 · 按 R 接受清理与保暖';
 else if(state.temperature<45){hint=state.terrain==='water'?'体温偏低 · 尽快上冰':'体温偏低 · 找背风处';kind=state.temperature<25?'danger':'caution';}
 else if(state.energy<42)hint=state.food===0?'体力偏低 · 找鱼补给':state.food<=state.requiredFood?'体力偏低 · 吃鱼后记得补足 4 条':touchLayout?'体力偏低 · 点吃鱼补给':'体力偏低 · 按 E 吃鱼';
 else if(state.oil>35)hint='羽毛保温受损 · 尽早前往橙色救援营地';
 const panel=$('context-panel'),meter=$('context-progress');
 text('context-hint',hint);
 panel.dataset.kind=kind;
 const active=!!hint&&!state.treatment&&!tutorial&&mode==='playing';
 panel.classList.toggle('visible',active);
 const hasProgress=active&&(kind==='snag'||kind==='crossing');
 meter.classList.toggle('hidden',!hasProgress);
 if(hasProgress){
  meter.value=Math.min(1,progress);
  meter.setAttribute('aria-label',tr(kind==='snag'?'脱网进度':'游客通过进度'));
 }
}
function dismissTutorial(){if(boothMode){startBoothChallenge();return;}tutorial=false;$('tutorial').classList.add('hidden');profile.saveSettings({tutorialSeen:true});settings={...profile.data.settings};}
function finish(){
 mode='result';clearInput();$('pause').classList.add('hidden');$('tutorial').classList.add('hidden');
 syncViewControls();
 $('context-panel').classList.remove('visible');$('toast').classList.remove('visible');$('treatment').classList.add('hidden');
 const won=state.status==='won',result={...scoreRun(state),runId:state.runId,date:new Date().toLocaleDateString(getLanguage()==='en'?'en-GB':'zh-CN')};state.won=won;
 let recorded;if(boothMode){recorded=booth.recordRun({...result,...boothEntry});boothPhase='result';}else{profile.clearCheckpoint();recorded=profile.recordRun(result);}
 resultView={result,recorded};renderResult(result,recorded);
 resultElapsed=0;
 if(won){$('hud').classList.add('hidden');updateFeedingCount();}
 audio.cue(won?'win':'lose');
}
function updateFeedingCount(){
 const {total,served,celebrating}=homeFeedingProgress(state.food,resultElapsed);
 text('home-feeding',`喂鱼 ${served} / ${total}`);
 $('home-feeding').classList.toggle('hidden',celebrating);
}
function showResult(now){
 resultElapsed=null;
 $('home-feeding').classList.add('hidden');
 if(boothMode)returnDeadline=now+12000;
 $('result-dialog').showModal();
}
function renderResult(result,recorded){
 const won=state.status==='won';
 text('result-eyebrow',won?'★'.repeat(result.rating||1):'');
 text('result-title',won?'到家了':state.lostReason==='time'?'时间到了':state.temperature<=0?'体温过低':'体力耗尽');
 const distance=Math.round(Math.hypot(state.goal.x-state.x,state.goal.z-state.z));
 const missingFish=Math.max(0,state.requiredFood-state.food);
 text('result-copy',won?'幼鸟可以开饭了。':distance>5?`离巢穴还有 ${distance} 米。`:missingFish?`还差 ${missingFish} 条鱼。`:'已经到巢穴附近了。');
 text('result-food-label',won?'带回的鱼':'携带的鱼');
 text('result-food',state.food);text('result-time',formatResultTime(state.time));text('result-oil',Math.round(state.maxOil)+'%');
 text('impact-copy',result.netSnags||result.visitorWait?`渔网缠住 ${result.netSnags} 次 · 登陆等候 ${result.visitorWait} 秒`:'');
 $('impact-copy').classList.toggle('hidden',!(result.netSnags||result.visitorWait));
 text('impact-energy',`接触油污 ${Math.round(state.exposureSeconds)} 秒 · 专业照护 ${state.rescuesUsed} 次`);text('impact-fish',`自己吃掉 ${state.fishEaten} 条鱼 · 报告同伴 ${result.signalsReported||0} 处`);
 $('earned').replaceChildren();for(const a of recorded.newAchievements||[]){const badge=document.createElement('span');badge.className='earned-badge';badge.textContent='✦ '+tr(a.title);$('earned').append(badge);}
 text('save-status',!recorded.saved?'浏览器未允许保存，成绩和勋章仅在当前页面保留。':won?`归巢已记入本机记录${recorded.rank?' · 本难度第 '+recorded.rank+' 名':''}`:'这段旅程已记入统计，未完成的旅程不参与排名。');
 if(boothMode){
  $('booth-result').classList.remove('hidden');text('booth-result-number',`玩家 ${participantNumber()}`);text('booth-result-rank',recorded.rank?`今日同难度第 ${recorded.rank} 名`:'本次体验已结束');
  text('save-status',booth.available?'今日成绩保存在这台设备。':'浏览器无法保存，今日成绩只在当前页面保留。');
 }
}
function showBoard(diff=difficulty){
 document.querySelectorAll('[data-board]').forEach(b=>{b.classList.toggle('selected',b.dataset.board===diff);b.setAttribute('aria-pressed',String(b.dataset.board===diff));});
 const stats=profile.data.stats;text('profile-summary',`旅程结算 ${stats.runs} 次 · 平安归巢 ${stats.wins} 次 · 带回 ${stats.totalFish} 条鱼`);
 if(boothMode)text('profile-summary',`今日排行榜 · ${booth.data.settings.duration} 秒场次`);
 const fetchRecords=version=>boothMode?booth.getRecords(diff,booth.data.settings.duration,version):profile.getRecords(diff,version);
 const list=fetchRecords(boardRuleset);$('board-content').replaceChildren();
 $('board-version').classList.toggle('hidden',boardRuleset===2&&!fetchRecords(1).length);
 text('board-version',boardRuleset===2?'查看旧版成绩':'返回当前榜单');
 if(!list.length){const p=document.createElement('p');p.className='board-empty';p.textContent=tr('还没有归巢成绩。');$('board-content').append(p);}
 else $('board-content').append(scoreTable(list,boothMode));
 $('achievements').replaceChildren();for(const a of ACHIEVEMENTS){const earned=profile.data.achievements.includes(a.id),el=document.createElement('div'),title=document.createElement('b'),copy=document.createElement('p');el.className='achievement'+(earned?' earned':'');title.textContent=(earned?'✦ ':'○ ')+tr(a.title);copy.textContent=tr(a.description);el.append(title,copy);$('achievements').append(el);}
 $('achievements').classList.toggle('hidden',boothMode);
 if(!$('board-dialog').open)$('board-dialog').showModal();
}
function action(kind){
 if(mode!=='playing'||paused)return;
 const fn={eat,rescue,signal:interact}[kind],succeeded=fn(state);
 if(succeeded){audio.cue(kind);if(kind==='rescue')clearInput();checkpoint();}
 lastFood=state.food;lastMessage=state.message;
 if(state.treatment)$('toast').classList.remove('visible');
 else toast(state.message);
 updateHud();
}
function markActivity(){lastActivity=performance.now();}
function participantNumber(){return boothEntry?String(boothEntry.number).padStart(4,'0'):'—';}
function syncBoothLayout(){
 document.body.classList.toggle('booth',boothMode);text('quit',boothMode?'结束本局，返回开始页':'保存旅程，返回首页');
 text('dismiss-tutorial',boothMode?'明白了':'明白了 ×');$('booth-practice-progress').classList.toggle('hidden',!boothMode);$('booth-practice-hint').classList.toggle('hidden',!boothMode);$('booth-practice-skip').classList.toggle('hidden',!boothMode);
}
function setBoothMode(value){
 if(!boothMode&&mode==='playing')checkpoint();if(boothMode&&boothEntry)booth.abandonRun(boothEntry.runId);
 closeAll();mode='intro';boothMode=value;boothEntry=null;difficulty=boothMode?booth.data.settings.difficulty:'normal';syncBoothLayout();
 scene?.dispose();scene=createScene($('world'),{...settings,world:activeWorld()});home();applySettings();
}
function prepareBoothRun(next){
 closeAll();clearInput();state=next;mode='playing';paused=false;resultView=null;lastFood=state.food;lastStage=state.stage;lastMessage=state.message;lastWind=false;last=performance.now();hudClock=saveClock=0;returnDeadline=idleDeadline=0;
 document.body.classList.add('playing');document.body.classList.remove('polluted','cold');$('intro').classList.add('hidden');$('scene-caption').classList.add('hidden');$('hud').classList.remove('hidden');$('pause').classList.remove('hidden');$('booth-result').classList.add('hidden');markActivity();
 if(firstPerson())facePassage();
 syncViewControls();
}
function launchBoothPractice(){
 if(boothEntry)booth.abandonRun(boothEntry.runId);boothEntry=null;boothPhase='practice';practiceTime=0;practiceMoved=practiceCaught=false;
 const species=selectedSpecies();
 const practice=createRun('easy',{species,mode:'booth',view:menuView});
 const startShelf=activeWorld().ice[0];
 practice.z=startShelf.z+startShelf.length/2-2;
 prepareBoothRun(practice);
 const ahead=moveInView(0,1);state.fish[0].x=state.x+ahead.x*7;state.fish[0].z=state.z+ahead.z*7;practiceStart={x:state.x,z:state.z};tutorial=true;$('tutorial').classList.remove('hidden');unlockAudio();updateHud();
 if(!firstPerson())toast('先练习移动和捕鱼。10 秒后开始正式挑战。',5);
}
function startBoothChallenge(){
 if(!boothMode||boothPhase!=='practice')return;const {species,view}=state;boothEntry=booth.beginRun({difficulty});difficulty=boothEntry.difficulty;boothPhase='challenge';
 prepareBoothRun(createRun(difficulty,{species,mode:'booth',view}));state.runId=boothEntry.runId;tutorial=false;$('tutorial').classList.add('hidden');updateHud();toast(`正式开始 · ${DIFFICULTIES[difficulty].label}难度 · 带 4 条鱼回巢 · ${boothEntry.duration} 秒`,5);audio.cue('stage');
}
function boothInteraction(){
 if(!boothMode||mode!=='playing'||paused)return;
 if(state.signals.some(s=>!s.reported&&Math.hypot(s.x-state.x,s.z-state.z)<5.5))action('signal');
 else if(state.rescues.some(r=>!r.used&&Math.hypot(r.x-state.x,r.z-state.z)<5))action('rescue');
 else toast('靠近受困企鹅或橙色营地，再按互动键。');
}
function updateBoothHud(touchLayout){
 const practicing=boothPhase==='practice',seconds=practicing?Math.max(0,Math.ceil(10-practiceTime)):Math.max(0,Math.ceil((boothEntry?.duration||booth.data.settings.duration)-state.time));
 text('booth-countdown',formatTime(seconds));text('booth-food',`${state.food}/4`);text('booth-number',practicing?'练习中':participantNumber());
 $('booth-countdown').classList.toggle('low',!practicing&&seconds<=15);
 const friend=state.signals.some(s=>!s.reported&&Math.hypot(s.x-state.x,s.z-state.z)<5.5),camp=state.rescues.some(r=>!r.used&&Math.hypot(r.x-state.x,r.z-state.z)<5);
 $('booth-interact').disabled=!!state.treatment||(!friend&&!camp);text('booth-interact',touchLayout?(friend?'求助':camp?'清理':'互动'):(friend?'R / F 求助':camp?'R / F 清理':'R / F 互动'));
 if(practicing){
  $('booth-practice-progress').value=practiceTime;practiceMoved ||= Math.hypot(state.x-practiceStart.x,state.z-practiceStart.z)>2;practiceCaught ||= state.food>0;
  text('tutorial-copy',firstPerson()?'向前捕第一条鱼':touchLayout?'按下方方向键移动，按住滑行按钮。靠近金色小鱼就能捕鱼。':'方向键移动，冰上按空格滑行。靠近金色小鱼就能捕鱼。');
  text('booth-practice-hint',`${practiceMoved?'✓':'○'} 移动 · ${practiceCaught?'✓':'○'} 捕到一条鱼`);$('booth-practice-skip').disabled=practiceTime<2;
 }
 text('autosave','摊位体验 · 下一位会从头开始');
 if(state.stage===2)text('current-note','海流会推动油膜，观察前方空隙。');
}
function scoreTable(records,withPlayers){
 const table=document.createElement('table'),head=table.createTHead().insertRow();
 const labels=['名次',...(withPlayers?['玩家编号']:[]),'带回的鱼','结束沾油','用时'];
 for(const label of labels){
  const cell=document.createElement('th');
  cell.setAttribute('scope','col');cell.textContent=tr(label);head.append(cell);
 }
 const body=table.createTBody();
 records.forEach((record,index)=>{
  const row=body.insertRow();
  const player=withPlayers?[String(record.number).padStart(4,'0')]:[];
  for(const value of [index+1,...player,record.food,Math.round(record.oil)+'%',formatResultTime(record.time)])row.insertCell().textContent=value;
 });
 return table;
}
function refreshStaff(){
 applySettings();const s=booth.getSummary();text('booth-today-summary',`今日 ${s.participants} 人体验 · ${s.wins} 人回巢 · 完成率 ${Math.round(s.completionRate)}% · 平均 ${Math.round(s.averageTime)} 秒`);
 const rows=booth.getRecords();$('booth-today-board').replaceChildren();
 if(!rows.length){text('booth-today-board','当前难度和时限还没有回巢成绩。');return;}
 $('booth-today-board').append(scoreTable(rows,true));
}
function openStaff(){if(!boothMode||$('booth-staff-dialog').open)return;if(idleDeadline){$('booth-idle-dialog').close();idleDeadline=0;}openPanel('booth-staff-dialog');refreshStaff();markActivity();}
function continueIdle(){
 $('booth-idle-dialog').close();idleDeadline=0;paused=idleWasPaused;last=performance.now();clearInput();markActivity();
}
function updateBoothLifecycle(now){
 if(!boothMode)return;
 if($('booth-staff-dialog').open)return;
 if(mode==='result'&&returnDeadline){text('booth-return-countdown',`距离下一位 ${Math.max(0,Math.ceil((returnDeadline-now)/1000))} 秒`);if(now>=returnDeadline)home();return;}
 if(mode!=='playing'||document.hidden||$('booth-staff-dialog').open)return;
 if(idleDeadline){text('booth-idle-countdown',`${Math.max(0,Math.ceil((idleDeadline-now)/1000))} 秒后返回开始页`);if(now>=idleDeadline)home();}
 else if(now-lastActivity>=45000){idleWasPaused=paused;paused=true;clearInput();idleDeadline=now+10000;$('booth-idle-dialog').showModal();}
}
function exportBoothRecords(){
 const blob=new Blob(['\uFEFF'+booth.exportCSV()],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`homebound-${booth.getSummary().date}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('booth-mode').onclick=()=>setBoothMode(true);$('booth-exit-normal').onclick=()=>setBoothMode(false);$('booth-staff').onclick=openStaff;
$('booth-interact').onclick=boothInteraction;$('booth-practice-skip').onclick=startBoothChallenge;
$('booth-idle-continue').onclick=continueIdle;$('booth-idle-home').onclick=home;$('booth-next').onclick=home;
$('booth-more-time').onclick=()=>{returnDeadline=Math.max(performance.now()+30000,returnDeadline+30000);};
$('booth-reset-run').onclick=home;$('booth-export').onclick=exportBoothRecords;
$('booth-clear-request').onclick=()=>$('booth-clear-confirm').classList.remove('hidden');$('booth-clear-no').onclick=()=>$('booth-clear-confirm').classList.add('hidden');
$('booth-clear-yes').onclick=()=>{home();booth.resetToday();openStaff();};
for(const id of ['booth-difficulty','booth-duration'])$(id).onchange=()=>{booth.saveSettings({difficulty:$('booth-difficulty').value,duration:Number($('booth-duration').value)});if(mode==='intro')difficulty=booth.data.settings.difficulty;refreshStaff();refreshMenu();};
$('booth-quality').onchange=()=>{profile.saveSettings({quality:$('booth-quality').value});applySettings();};
$('booth-idle-dialog').addEventListener('cancel',e=>{e.preventDefault();continueIdle();});
addEventListener('pointerdown',markActivity);addEventListener('focus',markActivity);
function changeLanguage(value){
 setLanguage(value);profile.saveSettings({language:getLanguage()});applyLanguage();applySettings();scene?.setLanguage?.(getLanguage());refreshMenu();
 if(mode!=='intro'){updateHud();text('autosave',profile.available?'已保存到本机':'当前浏览器无法保存');}if(lastToast)text('toast',lastToast);
 if(paused)text('pause-copy',boothMode?'已暂停。工作人员可以继续这局，或返回开始页。':profile.available?'旅程已暂停并保存，体温和体力不会流失。':'旅程已暂停。此浏览器暂不能保存，关闭页面会失去进度。');
 if(resultView&&mode==='result'){renderResult(resultView.result,resultView.recorded);if(state.won&&resultElapsed!==null)updateFeedingCount();}
 if($('board-dialog').open){const selected=document.querySelector('[data-board][aria-pressed="true"]');showBoard(selected?.dataset.board||difficulty);}
 if($('booth-staff-dialog').open)refreshStaff();
}
$('language').onclick=()=>changeLanguage(getLanguage()==='en'?'zh':'en');
$('setting-language').onchange=()=>changeLanguage($('setting-language').value);

$('start').onclick=requestStart;$('confirm-start').onclick=()=>{profile.clearCheckpoint();launch();};
$('continue').onclick=()=>{const saved=safeRestore(profile.getCheckpoint());if(saved)launch(saved);else{profile.clearCheckpoint();refreshMenu();toast('保存的旅程无法读取，请重新出发。');}};
$('again').onclick=()=>launch();$('home').onclick=home;$('quit').onclick=home;$('pause').onclick=pause;$('resume').onclick=resume;
$('pause-view').onclick=togglePauseView;
$('show-help').onclick=()=>openPanel('help-dialog');$('show-journal').onclick=()=>openPanel('journal-dialog');$('show-board').onclick=()=>{boardRuleset=2;showBoard();};$('show-settings').onclick=()=>openPanel('settings-dialog');$('pause-help').onclick=()=>openPanel('help-dialog');$('pause-settings').onclick=()=>openPanel('settings-dialog');$('dismiss-tutorial').onclick=dismissTutorial;
$('board-version').onclick=()=>{
 boardRuleset=boardRuleset===2?1:2;
 showBoard(document.querySelector('[data-board][aria-pressed="true"]')?.dataset.board||difficulty);
};
$('sound').onclick=()=>{unlockAudio();profile.saveSettings({sound:!settings.sound});applySettings();audio.cue('ui');};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('此浏览器未允许全屏，可使用浏览器的全屏按钮。');}};
$('setting-sound').onchange=()=>{unlockAudio();profile.saveSettings({sound:$('setting-sound').checked});applySettings();};
$('setting-volume').oninput=()=>{profile.saveSettings({volume:Number($('setting-volume').value)/100});applySettings();};
$('setting-quality').onchange=()=>{profile.saveSettings({quality:$('setting-quality').value});applySettings();};$('setting-motion').onchange=()=>{profile.saveSettings({reducedMotion:$('setting-motion').checked});applySettings();};
for(const kind of ['eat','rescue','signal'])$(kind).onclick=()=>action(kind);
document.querySelectorAll('[data-difficulty]').forEach(b=>b.addEventListener('click',()=>{difficulty=b.dataset.difficulty;refreshMenu();markActivity();}));
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{
 if(mode!=='intro')return;
 menuView=button.dataset.view==='first'?'first':'overhead';
 syncViewControls();
}));
document.querySelectorAll('[data-species]').forEach(button=>button.addEventListener('click',()=>{
 if(mode!=='intro')return;
 if(boothMode)boothSpecies=button.dataset.species;
 else{
  profile.saveSettings({species:button.dataset.species});
  applySettings();
 }
 refreshMenu();
}));
document.querySelectorAll('[data-board]').forEach(b=>b.addEventListener('click',()=>showBoard(b.dataset.board)));
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>closePanel(b.closest('dialog'))));
for(const id of ['help-dialog','settings-dialog','journal-dialog','board-dialog','replace-dialog','booth-staff-dialog'])$(id).addEventListener('cancel',e=>{e.preventDefault();closePanel($(id));});
$('pause-dialog').addEventListener('cancel',e=>{e.preventDefault();resume();});$('result-dialog').addEventListener('cancel',e=>{e.preventDefault();home();});
$('slide').addEventListener('pointerdown',e=>{e.preventDefault();slideHeld=true;$('slide').setPointerCapture(e.pointerId);});for(const ev of ['pointerup','pointercancel','lostpointercapture'])$('slide').addEventListener(ev,()=>slideHeld=false);
document.querySelectorAll('[data-move]').forEach(b=>{b.addEventListener('pointerdown',e=>{e.preventDefault();touch.add(b.dataset.move);b.setPointerCapture(e.pointerId);});for(const ev of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(ev,()=>touch.delete(b.dataset.move));});
const viewSurface=$('world');
viewSurface.addEventListener('pointerdown',event=>{
 if(!firstPerson()||mode!=='playing'||paused||lookDrag||event.button!==0)return;
 if(event.pointerType==='touch'){
  const bounds=viewSurface.getBoundingClientRect();
  if(event.clientX<bounds.left+bounds.width/2)return;
 }
 event.preventDefault();
 lookDrag={id:event.pointerId,x:event.clientX,y:event.clientY};
 viewSurface.setPointerCapture(event.pointerId);
 markActivity();
});
viewSurface.addEventListener('pointermove',event=>{
 if(lookDrag?.id!==event.pointerId)return;
 const sensitivity=event.pointerType==='touch'?.007:.005;
 state.viewYaw=wrapViewYaw(state.viewYaw-(event.clientX-lookDrag.x)*sensitivity);
 state.viewPitch=clampViewPitch(state.viewPitch-(event.clientY-lookDrag.y)*sensitivity);
 lookDrag.x=event.clientX;lookDrag.y=event.clientY;
 markActivity();
});
for(const name of ['pointerup','pointercancel','lostpointercapture']){
 viewSurface.addEventListener(name,event=>{if(lookDrag?.id===event.pointerId)lookDrag=null;});
}
addEventListener('keydown',e=>{
 markActivity();if(boothMode&&e.key.toLowerCase()==='f8'){e.preventDefault();openStaff();return;}
 const k=e.key.toLowerCase();if(mode!=='playing')return;
 if(paused){if((k==='p'||k==='escape')&&$('pause-dialog').open){e.preventDefault();resume();}return;}
 if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(k))e.preventDefault();if(e.repeat)return;
 if(k==='p'||k==='escape'){e.preventDefault();pause();return;}keys.add(k);if(k==='e')action('eat');if(boothMode&&(k==='r'||k==='f'))boothInteraction();else{if(k==='r')action('rescue');if(k==='f')action('signal');}
});
addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));addEventListener('blur',()=>{clearInput();pause();});
addEventListener('pagehide',()=>{checkpoint();audio.update({...state,paused:true},0);});document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInput();pause();audio.update({...state,paused:true},0);}});
function movementInput(elapsed){
 const first=firstPerson();
 const leftArrow=keys.has('arrowleft'),rightArrow=keys.has('arrowright');
 if(first&&leftArrow!==rightArrow){
  state.viewYaw=wrapViewYaw(state.viewYaw+(leftArrow?1:-1)*1.95*elapsed);
 }
 const horizontal=Number(keys.has('d')||touch.has('right')||(!first&&rightArrow))
  -Number(keys.has('a')||touch.has('left')||(!first&&leftArrow));
 const vertical=Number(keys.has('w')||keys.has('arrowup')||touch.has('up'))
  -Number(keys.has('s')||keys.has('arrowdown')||touch.has('down'));
 return {...moveInView(horizontal,vertical),slide:keys.has(' ')||slideHeld};
}
function loop(now){
 requestAnimationFrame(loop);const elapsed=Math.max(0,(now-last)/1000),dt=Math.min(.05,elapsed);last=now;
 if(mode==='playing'&&!paused){
  if(keys.size||touch.size||slideHeld)markActivity();
  const simulationTime=Math.min(.25,elapsed);
  const input=movementInput(simulationTime);
  const beforeSnag=!!state.snag,wasInOil=state.inOil,wasInWater=state.terrain==='water';
  const beforeLanding=nearLanding(),wasBlocked=beforeLanding?.blocked;
  const deadline=boothMode&&boothPhase==='challenge'?boothEntry.duration:Infinity;
  let remaining=Math.min(simulationTime,deadline-state.time);
  while(remaining>0&&state.status==='playing'){const slice=Math.min(.025,remaining);step(state,input,slice);remaining-=slice;}
  if(boothMode&&boothPhase==='practice'){
   practiceTime+=simulationTime;state.energy=state.temperature=100;
   if(practiceTime>=10){startBoothChallenge();return;}
  }
  if(state.status==='playing'&&state.time>=deadline-1e-8){
   state.time=deadline;state.status='lost';state.lostReason='time';
   state.moving=state.slide=false;state.speed=state.vx=state.vz=0;
  }
  const snagChanged=beforeSnag!==!!state.snag,enteredOil=!wasInOil&&state.inOil;
  if(snagChanged)audio.cue(state.snag?'snag':'release');
  if(enteredOil)audio.cue('oil');
  if(!wasInWater&&state.terrain==='water'&&state.moving)audio.cue('splash');
  if(wasBlocked&&beforeLanding&&!beforeLanding.blocked)audio.cue('landing');
  const caughtFish=state.food>lastFood;
  if(caughtFish)audio.cue('fish');
  lastFood=state.food;
  if(state.stage!==lastStage){lastStage=state.stage;audio.cue('stage');checkpoint();}
  if(state.windWarning&&!lastWind)audio.cue('gust');lastWind=!!state.windWarning;
  if(state.message&&state.message!==lastMessage){
   lastMessage=state.message;
   if(state.status==='playing'){
    const message=caughtFish&&boothPhase==='practice'?'捕到了 · 可以开始挑战':state.message;
    toast(message,Math.min(5,Math.max(1,state.messageUntil-state.time)));
   }
  }
  hudClock+=dt;saveClock+=simulationTime;
  if(hudClock>=.1||snagChanged||enteredOil){hudClock=0;updateHud();}
  if(saveClock>=5){saveClock=0;checkpoint();}
  if(state.status!=='playing'){updateHud();finish();}
 }
 if(now>toastUntil)$('toast').classList.remove('visible');
 updateBoothLifecycle(now);
 const resultPending=mode==='result'&&resultElapsed!==null;
 const homecoming=mode==='result'&&state.won;
 const resultDuration=homecoming?HOME_FEEDING_MS/1000:.5;
 if(resultPending&&!document.hidden&&(!$('booth-staff-dialog').open||!boothMode)){
  const before=resultElapsed;
  resultElapsed=Math.min(resultDuration,resultElapsed+Math.min(.1,elapsed));
  if(homecoming){
   updateFeedingCount();
   if(before<HOME_CELEBRATION_START&&resultElapsed>=HOME_CELEBRATION_START)audio.cue('celebrate');
  }
 }
 const visual={...state,view:mode==='playing'?state.view:'overhead',preview:mode==='intro',paused:paused||document.hidden};
 if(homecoming)visual.homeFeedingTime=resultElapsed??resultDuration;
 scene.render(visual,paused?0:dt);audio.update(visual,dt);
 if(resultPending&&resultElapsed>=resultDuration-1e-8)showResult(now);
}
try{syncBoothLayout();scene=createScene($('world'),{...settings,world:activeWorld()});applySettings();refreshMenu();addEventListener('resize',()=>scene.resize());requestAnimationFrame(loop);}catch(err){console.error(err);$('error').classList.remove('hidden');$('start').disabled=true;$('continue').disabled=true;}


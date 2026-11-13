import {WORLD,BOOTH_WORLD,getWorld,stageAt,laneAt,terrainAt} from './world.js';
import {initHazards,updateHazards,updateFish,blockLanding,catchNet,workFree} from './hazards.js';
import {FIRST_PERSON_PITCH,wrapViewYaw,clampViewPitch} from './controls.js';
export {WORLD,BOOTH_WORLD,getWorld,terrainAt};
export const worldFor=s=>getWorld(s?.mode);
export const SPECIES_RULESET=3;
export const DIFFICULTIES=Object.freeze({
 easy:Object.freeze({label:'低',subtitle:'从容归巢',energyDrain:.43,cold:.36,oilRate:10,oilDrift:.84,fishEnergy:37,rescueWarmth:56,debrisDrift:.75,netWidth:.83,netCost:4,netRelease:.65,visitorCrossing:.76,storm:.9}),
 normal:Object.freeze({label:'中',subtitle:'海峡冒险',energyDrain:.83,cold:.55,oilRate:16,oilDrift:1,fishEnergy:32,rescueWarmth:47,debrisDrift:1,netWidth:1,netCost:8,netRelease:.9,visitorCrossing:1,storm:1.4}),
 hard:Object.freeze({label:'高',subtitle:'逆风远行',energyDrain:1.06,cold:.68,oilRate:22,oilDrift:1.18,fishEnergy:28,rescueWarmth:40,debrisDrift:1.24,netWidth:1.11,netCost:13,netRelease:1.2,visitorCrossing:1.26,storm:1.85}),
});
const SPECIES_TRAITS={gentoo:{swimSpeed:1.12},adelie:{waterCold:.85},chinstrap:{slideSteering:1.25}};
const SPECIES=Object.keys(SPECIES_TRAITS);
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const inside=(x,z,p,margin=0)=>((x-p.x)/(p.rx+margin))**2+((z-p.z)/(p.rz+margin))**2<=1;
export function isBlocked(x,z,world=WORLD){
 const lane=laneAt(z,world);
 return Math.abs(x-lane.x)>lane.halfWidth||world.obstacles.some(p=>inside(x,z,p,.6));
}
function tell(s,message,seconds=4){s.message=message;s.messageUntil=s.time+seconds;}
export function createRun(difficulty='normal',options={}){
 const key=Object.hasOwn(DIFFICULTIES,difficulty)?difficulty:'normal',world=getWorld(options.mode);
 const state={
 version:WORLD.version,rankingRuleset:SPECIES_RULESET,mode:options.mode==='booth'?'booth':'normal',difficulty:key,species:SPECIES.includes(options?.species)?options.species:'gentoo',
 view:options.view==='first'?'first':'overhead',viewYaw:0,viewPitch:FIRST_PERSON_PITCH,
 x:0,z:5,vx:0,vz:0,heading:0,time:0,stage:0,checkpoint:0,terrain:'ice',
 temperature:100,energy:100,oil:0,insulation:100,food:0,requiredFood:4,maxFood:10,
 slide:false,moving:false,speed:0,status:'playing',won:false,
 fish:world.fish.map(f=>({...f,active:true,polluted:false,pollutionTime:0,fleeing:false})),
 oilPatches:world.oilPatches.map(p=>({...p})),
 rescues:world.rescues.map(p=>({...p,used:false})),shelters:world.shelters.map(p=>({...p})),
 signals:world.signals.map(p=>({...p,reported:false,reportedAt:null,careProgress:0})),signalsReported:0,nearSignal:-1,
 goal:{...world.goal},nearRescue:-1,inShelter:false,treatment:null,
 current:{x:1,z:0},spread:0,wind:0,windWarning:false,oilWarning:false,
 caught:0,oilContacts:0,rescuesUsed:0,inOil:false,exposureSeconds:0,oilEnergyCost:0,oilColdCost:0,fishEaten:0,maxOil:0,
 lostReason:'',message:'带 4 条鱼回巢。多捕的可以补充体力。',messageUntil:8,
 _goalHintUntil:0,_oilWarned:false,_fishWarned:false,_windWarned:false,_lowFoodWarned:false,
 };
 initHazards(state,world);
 environment(state,DIFFICULTIES[key],0);
 return state;
}
export function eat(s){
 if(s.status!=='playing'||s.treatment)return false;
 if(s.food<=0){tell(s,'还没有鱼。游近金色小鱼，便能捕到食物。');return false;}
 if(s.energy>=99){tell(s,'体力充足，把鱼留给等待你的幼鸟吧。');return false;}
 s.food--;s.fishEaten++;s.energy=Math.min(100,s.energy+DIFFICULTIES[s.difficulty].fishEnergy);
 tell(s,`吃掉 1 条鱼恢复体力，还为幼鸟留着 ${s.food} 条。`);return true;
}
export function rescue(s){
 if(s.status!=='playing'||s.treatment)return false;
 const campIndex=s.rescues.findIndex(c=>distance(s,c)<5),camp=s.rescues[campIndex];
 if(!camp){tell(s,'靠近橙色营地，再请求专业人员清理。');return false;}
 if(camp.used){tell(s,'这个营地的救援物资已用完。海岸还有其他营地。');return false;}
 if(s.oil<1&&s.temperature>85&&s.energy>85){tell(s,'目前状态很好，先把有限的救援物资留在这里。');return false;}
 camp.used=true;s.rescuesUsed++;s.maxOil=Math.max(s.maxOil,s.oil);
 s.treatment={remaining:5,duration:5,campIndex,startOil:s.oil,startTemperature:s.temperature,startEnergy:s.energy};
 s.vx=s.vz=s.speed=0;s.moving=s.slide=false;tell(s,'正在照护。',5);return true;
}
export function interact(s){
 if(s.status!=='playing'||s.treatment)return false;
 const friend=s.signals.find(p=>distance(s,p)<5.5);
 if(!friend){tell(s,'靠近带定位标记的受困企鹅，按 F 发出救援信号。');return false;}
 if(friend.reported){tell(s,'定位已发送，专业救援人员正在接应。继续你的归巢旅程。');return false;}
 friend.reported=true;friend.reportedAt=s.time;friend.careProgress=0;s.signalsReported++;tell(s,'位置已发送，救援队正在赶来。',5);return true;
}
function environment(s,config,dt){
 const world=worldFor(s),scale=world.zScale||1;
 for(const friend of s.signals)friend.careProgress=friend.reported?(Number.isFinite(friend.reportedAt)?clamp((s.time-friend.reportedAt)/5,0,1):1):0;
 s.spread=clamp(s.time/240,0,1);
 const tide=s.time*.13,dx=Math.cos(tide),dz=Math.cos(tide*.65)*.2,length=Math.hypot(dx,dz);
 s.current.x=dx/length;s.current.z=dz/length;
 for(const p of s.oilPatches){
  p.x=p.baseX+Math.sin(tide)*3.2*config.oilDrift+Math.sin(tide*.55+p.phase)*.6;
  p.z=p.baseZ+Math.sin(tide*.65)*2.8*scale;p.rx=p.baseRx*(1+s.spread*.22);p.rz=p.baseRz*(1+s.spread*.22);
 }
 updateHazards(s,world,config,dt);
 updateFish(s,world,config,dt);
 const cycle=s.time%24;s.windWarning=s.stage===4&&cycle>=7&&cycle<10;
 s.wind=s.stage===4&&cycle>=10&&cycle<20?Math.sin((cycle-10)/10*Math.PI):0;
 s.insulation=clamp(100-s.oil*.82,18,100);
}
function contacts(s){
 const touching=s.terrain==='water'&&s.oilPatches.some(p=>inside(s.x,s.z,p));
 s.nearRescue=s.rescues.findIndex(c=>distance(s,c)<5);
 s.nearSignal=s.signals.findIndex(c=>distance(s,c)<5.5);
 s.inShelter=s.terrain==='ice'&&s.shelters.some(p=>distance(s,p)<4.5)&&!touching;
 return touching;
}
export function step(s,input={},elapsed=0){
 if(s.status!=='playing')return s;
 const dt=Number.isFinite(elapsed)?clamp(elapsed,0,.05):0;if(!dt)return s;
 const config=DIFFICULTIES[s.difficulty],world=worldFor(s);s.time+=dt;environment(s,config,dt);
 if(s.treatment){
  const t=s.treatment;t.remaining=Math.max(0,t.remaining-dt);const progress=1-t.remaining/t.duration;
  s.oil=t.startOil*(1-progress);s.insulation=100-s.oil*.82;
  s.temperature=Math.min(100,t.startTemperature+progress*config.rescueWarmth);s.energy=Math.min(100,t.startEnergy+progress*30);
  if(t.remaining<1e-8){s.oil=0;s.insulation=100;s.treatment=null;s.inOil=false;tell(s,'照护完成，可以出发了。',4);}
  return s;
 }
 let ix=Number.isFinite(input.x)?clamp(input.x,-1,1):0,iz=Number.isFinite(input.z)?clamp(input.z,-1,1):0;
 let inputLength=Math.hypot(ix,iz);
 if(inputLength>1){ix/=inputLength;iz/=inputLength;inputLength=1;}
 if(s.snag){workFree(s,ix,iz,config,dt);ix=iz=inputLength=0;s.vx=s.vz=0;}
 const intent=inputLength>.05;s.terrain=terrainAt(s.x,s.z,world);contacts(s);
 const sliding=(Boolean(input.slide)||(!intent&&s.slide))&&s.terrain==='ice';
 // Older resumable runs still use the physics and leaderboard they started with.
 const traits=s.rankingRuleset===SPECIES_RULESET?SPECIES_TRAITS[s.species]:undefined;
 const topSpeed=s.terrain==='water'?4.6*(traits?.swimSpeed??1):sliding?7.3:3.9;
 const speed=topSpeed*(1-s.oil*.003)*(s.energy<20?.8:1)*(1-(s.inShelter?0:s.wind)*.27);
 let responseRate=intent?(sliding?3.5:9):(sliding||s.slide?3:12);
 if(traits?.slideSteering&&sliding&&intent&&s.moving){
  // Ignore small alignment changes so a straight slide accelerates the same way for everyone.
  const aligned=ix*s.vx+iz*s.vz>=inputLength*s.speed*.995;
  if(!aligned)responseRate*=traits.slideSteering;
 }
 const response=1-Math.exp(-responseRate*dt);
 s.vx+=(ix*speed-s.vx)*response;s.vz+=(iz*speed-s.vz)*response;
 if(!intent&&Math.hypot(s.vx,s.vz)<.035)s.vx=s.vz=0;
 const b=world.bounds,previousX=s.x,previousZ=s.z,nx=clamp(s.x+s.vx*dt,b.minX,b.maxX);
 let nz=clamp(s.z+s.vz*dt,b.minZ,b.maxZ);
 if(blockLanding(s,nz)){nz=s.z;s.vz=0;}
 // Sliding along the free axis gives predictable contact without corner tunneling.
 if(!isBlocked(nx,nz,world)){s.x=nx;s.z=nz;}else if(!isBlocked(nx,s.z,world)){s.x=nx;s.vz=0;}else if(!isBlocked(s.x,nz,world)){s.z=nz;s.vx=0;}else{s.vx=s.vz=0;}
 if((s.x===b.minX&&s.vx<0)||(s.x===b.maxX&&s.vx>0))s.vx=0;
 if((s.z===b.minZ&&s.vz<0)||(s.z===b.maxZ&&s.vz>0))s.vz=0;
 s.speed=Math.hypot(s.vx,s.vz);s.moving=s.speed>.035;if(s.moving)s.heading=Math.atan2(s.vx,s.vz);
 s.terrain=terrainAt(s.x,s.z,world);s.slide=sliding&&s.terrain==='ice'&&s.moving;
 if(catchNet(s,previousX,previousZ,config)){s.speed=0;s.moving=false;}
 const previousStage=s.stage;s.stage=stageAt(s.z,world);s.checkpoint=Math.max(s.checkpoint,s.stage);
 if(s.stage!==previousStage){tell(s,world.chapters[s.stage].title+'：'+world.chapters[s.stage].description,8);}
 const touchingOil=contacts(s);
 s.oilWarning=!touchingOil&&s.terrain==='water'&&s.oilPatches.some(p=>inside(s.x,s.z,p,3));
 if(s.oilWarning&&!s._oilWarned){tell(s,'等油膜露出空隙再走。');s._oilWarned=true;}
 if(touchingOil){s.exposureSeconds+=dt;s.oil=Math.min(100,s.oil+dt*config.oilRate);if(!s.inOil){s.oilContacts++;tell(s,'羽毛沾油，保温能力下降！更多体力将用于保暖，救援站可以清理。',6);}}
 s.inOil=touchingOil;s.maxOil=Math.max(s.maxOil,s.oil);s.insulation=clamp(100-s.oil*.82,18,100);
 if(s.windWarning&&!s._windWarned){tell(s,'阵风即将到来。背风石能挡风保暖，风停后再赶路。',5);s._windWarned=true;}if(!s.windWarning)s._windWarned=false;
 const effort=s.moving?(s.slide?1.08:s.terrain==='water'?1.2:1):.35;
 const extraEnergy=s.oil*.012*(s.inShelter?.3:1),extraCold=s.oil*.018*(s.inShelter?.3:1);
 s.oilEnergyCost+=extraEnergy*dt;s.oilColdCost+=extraCold*dt;
 s.energy=Math.max(0,s.energy-(config.energyDrain*effort+extraEnergy+(s.temperature<30?.2:0))*dt);
 const exposure=s.terrain==='water'?1.4*(traits?.waterCold??1):s.stage===4&&!s.inShelter?1.25:.5;
 const windChill=s.inShelter?0:s.wind*config.storm;
 const warming=s.inShelter?(s.moving?.45:3):0;
 s.temperature=clamp(s.temperature+(warming-config.cold*exposure-extraCold-windChill)*dt,0,100);
 if(s.inShelter&&!s.moving)s.energy=Math.min(100,s.energy+dt*1.5);
 for(const f of s.fish){
  if(f.active&&f.polluted&&distance(s,f)<5&&!s._fishWarned){tell(s,'油污覆盖的水域暂时无法捕鱼。鱼群会寻找附近的清洁水面。',5);s._fishWarned=true;}
  if(s.terrain==='water'&&f.active&&!f.polluted&&s.food<s.maxFood&&distance(s,f)<2.2){f.active=false;s.food++;s.caught++;tell(s,s.food>=s.requiredFood?`已带上 ${s.food} 条鱼。吃鱼能恢复体力，记得留 4 条给幼鸟。`:`捕到鱼了！再带回 ${s.requiredFood-s.food} 条，就够幼鸟吃了。`,3);}
 }
 if(s.stage===4&&s.food<4&&!s._lowFoodWarned){tell(s,'即将离开捕鱼水域：还没有足够的晚餐。先返回海岸补足 4 条鱼。',7);s._lowFoodWarned=true;}
 if(s.energy<=0||s.temperature<=0){
  s.status='lost';s.lostReason=s.temperature<=0?'体温过低':'体力耗尽';s.moving=s.slide=false;s.vx=s.vz=s.speed=0;
  tell(s,s.temperature<=0?'体温过低，救援人员接手了旅程。下次尽早清理油污，再利用背风处保暖。':'体力耗尽，救援人员接手了旅程。沾油后保暖消耗更大，记得吃鱼和请求救援。',100);
 }else if(distance(s,s.goal)<5){
  if(s.food>=s.requiredFood){s.status='won';s.won=true;s.moving=s.slide=false;s.vx=s.vz=s.speed=0;tell(s,'你回来了！幼鸟终于等到了这顿晚餐。',100);}
  else if(s.time>s._goalHintUntil){tell(s,`巢穴就在眼前，但还缺 ${s.requiredFood-s.food} 条鱼。沿原路返回清洁水域捕鱼。`,6);s._goalHintUntil=s.time+7;}
 }
 return s;
}
export function scoreRun(s){
 const guardian=s.won&&s.signalsReported>0&&s.food>=6&&s.oil<15;
 const ending=guardian?'guardian':s.won&&s.oil<50&&s.temperature>=25?'home':'survivor';
 const rating=!s.won?0:guardian?3:ending==='home'?2:1;
 return {ruleset:s.rankingRuleset,food:s.food,oil:Math.round(s.oil),time:Math.round(s.time*10)/10,score:s.won?Math.max(0,Math.round(s.food*1000+(100-s.oil)*5+s.signalsReported*600+Math.max(0,900-s.time))):0,difficulty:s.difficulty,species:s.species,won:s.won,exposureSeconds:Math.round(s.exposureSeconds),oilEnergyCost:Math.round(s.oilEnergyCost),oilColdCost:Math.round(s.oilColdCost),fishEaten:s.fishEaten,maxOil:Math.round(s.maxOil),rescuesUsed:s.rescuesUsed,signalsReported:s.signalsReported,totalSignals:s.signals.length,netSnags:s.netSnags,visitorWait:Math.round(s.visitorWait),ending,rating};
}

const NUMERIC={x:[-26,26],z:[0,640],vx:[-8,8],vz:[-8,8],heading:[-Math.PI,Math.PI],time:[0,7200],temperature:[0,100],energy:[0,100],oil:[0,100],food:[0,10],checkpoint:[0,4],caught:[0,24],oilContacts:[0,100000],rescuesUsed:[0,3],exposureSeconds:[0,7200],oilEnergyCost:[0,100000],oilColdCost:[0,100000],fishEaten:[0,24],maxOil:[0,100]};
const FLAGS=['slide','inOil','_oilWarned','_fishWarned','_windWarned','_lowFoodWarned'];
export function serializeRun(s){
 if(s.status!=='playing'||s.mode==='booth')return null;
 const run={difficulty:s.difficulty,species:s.species,rankingRuleset:s.rankingRuleset};
 if(s.view==='first')run.camera={view:'first',yaw:wrapViewYaw(s.viewYaw),pitch:clampViewPitch(s.viewPitch)};
 if(typeof s.runId==='string'&&s.runId.length<=100)run.runId=s.runId;
 for(const key of Object.keys(NUMERIC))run[key]=s[key];for(const key of FLAGS)run[key]=s[key];
 run.fish=s.fish.map(({id,x,z,active,pollutionTime,fleeing})=>({id,x,z,active,pollutionTime:pollutionTime||0,fleeing:!!fleeing}));
 run.rescues=s.rescues.map(r=>r.used);run.signals=s.signals.map(r=>r.reported);run.signalTimes=s.signals.map(r=>r.reported&&Number.isFinite(r.reportedAt)?r.reportedAt:null);
 run.treatment=s.treatment?{...s.treatment}:null;
 run.netSnags=s.netSnags;run.visitorWait=s.visitorWait;run.netGrace=s.netGrace;
 run.snag=s.snag?{...s.snag}:null;
 return {version:WORLD.version,savedAt:Date.now(),run};
}
function restoreHazards(s,r){
 if(!Number.isInteger(r.netSnags)||r.netSnags<0||r.netSnags>10000||
    !Number.isFinite(r.visitorWait)||r.visitorWait<0||r.visitorWait>s.time||
    !Number.isFinite(r.netGrace)||r.netGrace<0||r.netGrace>.6)return false;
 s.netSnags=r.netSnags;s.visitorWait=r.visitorWait;s.netGrace=r.netGrace;
 if(r.snag===null)return true;
 const snag=r.snag;
 if(!snag||!Number.isInteger(snag.index)||!s.nets[snag.index]||
    !['x','z','escapeX','escapeZ','elapsed','progress'].every(key=>Number.isFinite(snag[key]))||
    Math.abs(Math.hypot(snag.escapeX,snag.escapeZ)-1)>.01||
    snag.elapsed<0||snag.elapsed>=4.3||snag.progress<0||snag.progress>snag.elapsed||
    Math.hypot(s.x-snag.x,s.z-snag.z)>.5||isBlocked(snag.x,snag.z)||
    !r.netSnags||r.treatment)return false;
 const {index,x,z,escapeX,escapeZ,elapsed,progress}=snag;
 s.snag={index,x,z,escapeX,escapeZ,elapsed,progress};
 return true;
}
function placeLegacySave(s){
 if(!isBlocked(s.x,s.z))return;
 const lane=laneAt(s.z),margin=.4;
 const edge=clamp(s.x,lane.x-lane.halfWidth+margin,lane.x+lane.halfWidth-margin);
 const candidates=[edge,lane.x,...[-.5,.5,-.85,.85].map(offset=>lane.x+offset*lane.halfWidth)];
 const safe=candidates.find(x=>!isBlocked(x,s.z));
 if(safe!==undefined){s.x=safe;s.vx=s.vz=0;}
}
export function restoreRun(raw){
 try{
  const data=typeof raw==='string'?JSON.parse(raw):raw;
  if(!data||![1,WORLD.version].includes(data.version)||!Number.isFinite(data.savedAt)||!data.run)return null;
  const legacy=data.version===1;
  const r=data.run;if(r.mode==='booth')return null;if(!Object.hasOwn(DIFFICULTIES,r.difficulty)||!SPECIES.includes(r.species))return null;
  const s=createRun(r.difficulty,{species:r.species,view:r.camera?.view});
  if(s.view==='first'){
   s.viewYaw=wrapViewYaw(r.camera.yaw);
   s.viewPitch=clampViewPitch(r.camera.pitch);
  }
  if(!legacy&&r.rankingRuleset!==undefined&&![1,2,SPECIES_RULESET].includes(r.rankingRuleset))return null;
  s.rankingRuleset=legacy?1:r.rankingRuleset??2;
  if(r.runId!==undefined){if(typeof r.runId!=='string'||r.runId.length>100)return null;s.runId=r.runId;}
  for(const [key,[lo,hi]]of Object.entries(NUMERIC)){if(!Number.isFinite(r[key])||r[key]<lo||r[key]>hi)return null;s[key]=r[key];}
  for(const key of ['food','checkpoint','caught','oilContacts','rescuesUsed','fishEaten'])if(!Number.isInteger(s[key]))return null;
  if(s.energy<=0||s.temperature<=0||s.maxOil<s.oil||s.checkpoint<stageAt(s.z)||(!legacy&&isBlocked(s.x,s.z)))return null;
  for(const key of FLAGS){if(typeof r[key]!=='boolean')return null;s[key]=r[key];}
  if(!Array.isArray(r.fish)||r.fish.length!==WORLD.fish.length)return null;
  for(let i=0;i<r.fish.length;i++){
   const f=r.fish[i];if(!f||f.id!==i||typeof f.active!=='boolean'||typeof f.fleeing!=='boolean'||!Number.isFinite(f.x)||f.x< -26||f.x>26||!Number.isFinite(f.z)||f.z<0||f.z>640||!Number.isFinite(f.pollutionTime)||f.pollutionTime<0||f.pollutionTime>7200)return null;
   s.fish[i].active=f.active;
   if(!legacy)Object.assign(s.fish[i],{x:f.x,z:f.z,pollutionTime:f.pollutionTime,fleeing:f.fleeing});
  }
  if(s.fish.filter(f=>!f.active).length!==s.caught||s.caught-s.fishEaten!==s.food)return null;
  for(const [key,source,field] of [['rescues',s.rescues,'used'],['signals',s.signals,'reported']]){
   if(!Array.isArray(r[key])||r[key].length!==source.length||r[key].some(v=>typeof v!=='boolean'))return null;
   source.forEach((o,i)=>o[field]=r[key][i]);
  }
  if(s.rescues.filter(c=>c.used).length!==s.rescuesUsed)return null;
  if(r.signalTimes!==undefined){
   if(!Array.isArray(r.signalTimes)||r.signalTimes.length!==s.signals.length)return null;
   for(let i=0;i<s.signals.length;i++){const at=r.signalTimes[i];if(at!==null&&(!Number.isFinite(at)||at<0||at>s.time||!s.signals[i].reported))return null;s.signals[i].reportedAt=at;}
  }
  s.signalsReported=s.signals.filter(c=>c.reported).length;
  if(!legacy&&!restoreHazards(s,r))return null;
  if(r.treatment!==null){
   const t=r.treatment;if(!t||t.duration!==5||!Number.isFinite(t.remaining)||t.remaining<=0||t.remaining>5||!Number.isInteger(t.campIndex)||t.campIndex<0||t.campIndex>=s.rescues.length||!s.rescues[t.campIndex].used||(!legacy&&distance(s,s.rescues[t.campIndex])>=5))return null;
   for(const k of ['startOil','startTemperature','startEnergy'])if(!Number.isFinite(t[k])||t[k]<0||t[k]>100)return null;
   s.treatment={remaining:t.remaining,duration:5,campIndex:t.campIndex,startOil:t.startOil,startTemperature:t.startTemperature,startEnergy:t.startEnergy};
   if(legacy){const camp=s.rescues[t.campIndex];s.x=camp.x;s.z=camp.z;s.checkpoint=Math.max(s.checkpoint,stageAt(s.z));}
  }
  if(legacy)placeLegacySave(s);
  if(isBlocked(s.x,s.z))return null;
  s.stage=stageAt(s.z);s.terrain=terrainAt(s.x,s.z);s.speed=Math.hypot(s.vx,s.vz);s.moving=s.speed>.035;
  environment(s,DIFFICULTIES[s.difficulty],0);contacts(s);
  tell(s,'欢迎回来。旅程已经恢复，幼鸟仍在等你。',6);return s;
 }catch{return null;}
}



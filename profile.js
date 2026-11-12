// This profile remains on the current browser/device. No network or identifiers leave it.
export const PROFILE_KEY = 'homebound-profile-v1';
export const DEFAULT_SETTINGS = Object.freeze({ sound:false, volume:.45, quality:'medium', reducedMotion:false, species:'gentoo', tutorialSeen:false, language:'zh' });
export const ACHIEVEMENTS = Object.freeze([
  {id:'first-home',title:'第一次归来',description:'带着足够的食物，完成一次归巢。'},
  {id:'clean-return',title:'洁净的羽毛',description:'整段旅程最高沾油不超过 1%，并平安归巢。'},
  {id:'help-wildlife',title:'让救援看见它',description:'向专业救援人员报告一只受困企鹅的位置。'},
  {id:'full-table',title:'丰盛的晚餐',description:'带回至少 8 条鱼，给幼鸟充足的食物。'},
  {id:'hard-return',title:'逆风归来',description:'完成一次高难度归巢。'},
  {id:'all-levels',title:'熟悉每一种海况',description:'分别完成低、中、高三档难度。'},
].map(Object.freeze));
const difficulties=['easy','normal','hard'];
const achievementIds=new Set(ACHIEVEMENTS.map(a=>a.id));
const finite=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const copy=value=>JSON.parse(JSON.stringify(value));
const sortRecords=(a,b)=>b.food-a.food||a.oil-b.oil||a.time-b.time;
const emptyStats=()=>({runs:0,wins:0,totalFish:0,signalsReported:0,winsByDifficulty:{easy:0,normal:0,hard:0}});
const blank=()=>({version:1,settings:{...DEFAULT_SETTINGS},records:[],achievements:[],checkpoint:null,stats:emptyStats(),recentRunIds:[]});
function settingsFrom(input,base=DEFAULT_SETTINGS){
  const out={...base};if(!input||typeof input!=='object')return out;
  for(const k of ['sound','reducedMotion','tutorialSeen'])if(typeof input[k]==='boolean')out[k]=input[k];
  if(typeof input.volume==='number'&&Number.isFinite(input.volume))out.volume=Math.min(1,Math.max(0,input.volume));
  if(['high','medium','low'].includes(input.quality))out.quality=input.quality;
  if(['gentoo','adelie','chinstrap'].includes(input.species))out.species=input.species;
  if(['zh','en'].includes(input.language))out.language=input.language;
  return out;
}
function validRecord(r){
  if(!r||typeof r!=='object'||!difficulties.includes(r.difficulty)||typeof r.won!=='boolean'||!finite(r.food,0,10)||!Number.isInteger(r.food)||!finite(r.oil,0,100)||!finite(r.time,0,86400))return null;
  const result={ruleset:r.ruleset===2?2:1,difficulty:r.difficulty,food:r.food,oil:r.oil,time:r.time,won:r.won};
  for(const [name,max] of [['signalsReported',100],['totalSignals',100],['maxOil',100],['fishEaten',10000],['rescuesUsed',100],['exposureSeconds',86400],['oilEnergyCost',1000000],['oilColdCost',1000000],['score',1000000]]){
    result[name]=finite(r[name],0,max)?r[name]:(name==='maxOil'?r.oil:0);
  }
  result.ending=['guardian','home','survivor'].includes(r.ending)?r.ending:'home';
  result.rating=Number.isInteger(r.rating)&&finite(r.rating,1,3)?r.rating:1;
  if(typeof r.runId==='string'&&r.runId.length>0&&r.runId.length<=160)result.runId=r.runId;
  if(typeof r.date==='string'&&r.date.length<=40)result.date=r.date;
  return result;
}
function capRecords(records){
  const counts=new Map();
  return records.sort(sortRecords).filter(r=>{
    const key=r.difficulty+':'+r.ruleset,count=(counts.get(key)||0)+1;
    counts.set(key,count);return count<=10;
  });
}
// Storage validation stops malformed structures; rules.restoreRun validates game-specific fields.
function checkpointFrom(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||
     (value.version!==1&&(value.version!==2||!value.run||!Number.isFinite(value.savedAt))))return null;
  let nodes=0;
  const seen=new Set();
  function safe(v,depth){
    if(depth>16||++nodes>15000)return false;
    if(v===null||typeof v==='boolean')return true;
    if(typeof v==='number')return Number.isFinite(v);
    if(typeof v==='string')return v.length<=5000;
    if(typeof v!=='object'||seen.has(v))return false;
    if(!Array.isArray(v)&&Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null)return false;
    seen.add(v);
    const entries=Object.entries(v);
    const result=entries.every(([k,item])=>!['__proto__','constructor','prototype'].includes(k)&&safe(item,depth+1));
    seen.delete(v);return result;
  }
  try{if(!safe(value,0))return null;const json=JSON.stringify(value);return json.length<=300000?JSON.parse(json):null;}catch{return null;}
}
function loadData(raw){
  const data=blank();if(!raw||raw.version!==1)return data;
  data.settings=settingsFrom(raw.settings);
  data.records=capRecords((Array.isArray(raw.records)?raw.records.slice(0,300):[]).map(validRecord).filter(r=>r?.won));
  data.achievements=[...new Set((Array.isArray(raw.achievements)?raw.achievements:[]).filter(id=>achievementIds.has(id)))];
  data.checkpoint=checkpointFrom(raw.checkpoint);
  for(const k of ['runs','wins','totalFish','signalsReported'])if(Number.isInteger(raw.stats?.[k])&&finite(raw.stats[k],0,10000000))data.stats[k]=raw.stats[k];
  data.stats.wins=Math.min(data.stats.runs,data.stats.wins);
  for(const d of difficulties)if(Number.isInteger(raw.stats?.winsByDifficulty?.[d])&&finite(raw.stats.winsByDifficulty[d],0,data.stats.wins))data.stats.winsByDifficulty[d]=raw.stats.winsByDifficulty[d];
  data.recentRunIds=(Array.isArray(raw.recentRunIds)?raw.recentRunIds:[]).filter(id=>typeof id==='string'&&id.length>0&&id.length<=160).slice(-100);
  return data;
}

export function createProfile(storage){
  let data=blank(),available=true;
  if(arguments.length===0){try{storage=globalThis.localStorage;}catch{storage=null;}}
  if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function')available=false;
  else{try{const raw=storage.getItem(PROFILE_KEY);if(raw)data=loadData(JSON.parse(raw));}catch{available=false;}}
  function persist(){
    if(!storage){available=false;return false;}
    try{storage.setItem(PROFILE_KEY,JSON.stringify(data));available=true;return true;}catch{available=false;return false;}
  }
  return {
    get data(){return data;},get available(){return available;},
    saveSettings(partial){data.settings=settingsFrom(partial,data.settings);return persist();},
    getRecords(difficulty,ruleset){return data.records.filter(r=>r.difficulty===difficulty&&(ruleset===undefined||r.ruleset===ruleset)).sort(sortRecords).map(copy);},
    setCheckpoint(snapshot){
      if(snapshot===null){data.checkpoint=null;return persist();}
      const checked=checkpointFrom(snapshot);if(!checked)return false;
      data.checkpoint=checked;return persist();
    },
    getCheckpoint(){return data.checkpoint?copy(data.checkpoint):null;},
    clearCheckpoint(){data.checkpoint=null;return persist();},
    resetRecords(){data.records=[];data.achievements=[];data.stats=emptyStats();data.recentRunIds=[];return persist();},
    recordRun(input){
      const r=validRecord({...input,ruleset:input?.ruleset??2});
      if(!r)return {newAchievements:[],saved:false,rank:null,invalid:true};
      if(r.runId&&data.recentRunIds.includes(r.runId)){
        const index=data.records.filter(v=>v.difficulty===r.difficulty&&v.ruleset===r.ruleset).sort(sortRecords).findIndex(v=>v.runId===r.runId);
        return {newAchievements:[],saved:available,rank:index<0?null:index+1,duplicate:true};
      }
      r.date??=new Date().toISOString().slice(0,10);
      data.stats.runs++;data.stats.signalsReported+=r.signalsReported;
      if(r.runId)data.recentRunIds=[...data.recentRunIds,r.runId].slice(-100);
      if(r.won){data.stats.wins++;data.stats.totalFish+=r.food;data.stats.winsByDifficulty[r.difficulty]++;data.records=capRecords([...data.records,r]);}
      const earned={
        'first-home':r.won,'clean-return':r.won&&r.maxOil<=1,'help-wildlife':r.signalsReported>0,
        'full-table':r.won&&r.food>=8,'hard-return':r.won&&r.difficulty==='hard',
        'all-levels':difficulties.every(d=>data.stats.winsByDifficulty[d]>0),
      };
      const newAchievements=ACHIEVEMENTS.filter(a=>earned[a.id]&&!data.achievements.includes(a.id));
      data.achievements.push(...newAchievements.map(a=>a.id));
      const ranked=data.records.filter(v=>v.difficulty===r.difficulty&&v.ruleset===r.ruleset).sort(sortRecords),index=ranked.indexOf(r);
      return {newAchievements:newAchievements.map(a=>({...a})),saved:persist(),rank:index<0?null:index+1};
    },
  };
}

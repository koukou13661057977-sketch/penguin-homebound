// Booth data is independent of the regular game's saves and achievements.
export const BOOTH_KEY='homebound-booth-v1';
export const BOOTH_DEFAULTS=Object.freeze({difficulty:'normal',duration:105});
const difficulties=['easy','normal','hard'],durations=[90,105,120];
const clone=value=>JSON.parse(JSON.stringify(value));
const finite=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
const integer=(value,min,max)=>Number.isInteger(value)&&finite(value,min,max);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const rankOrder=(a,b)=>b.food-a.food||a.oil-b.oil||a.time-b.time||a.number-b.number;
const emptyDay=date=>({date,nextNumber:1,participants:0,finished:0,wins:0,totalTime:0,records:[],pending:[],completedIds:[]});
const blank=()=>({version:1,settings:{...BOOTH_DEFAULTS},days:[]});
function validDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(value+'T12:00:00');
 return !Number.isNaN(date.getTime())&&date.getFullYear()===Number(value.slice(0,4))&&date.getMonth()+1===Number(value.slice(5,7))&&date.getDate()===Number(value.slice(8,10));
}
function localDate(value){
 const date=new Date(value);if(Number.isNaN(date.getTime()))throw new TypeError('Invalid booth clock');
 return `${date.getFullYear().toString().padStart(4,'0')}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function settingsFrom(value,base=BOOTH_DEFAULTS){
 const result={...base};if(!object(value))return result;
 if(difficulties.includes(value.difficulty))result.difficulty=value.difficulty;
 if(durations.includes(value.duration))result.duration=value.duration;
 return result;
}
function entryFrom(value,date){
 if(!object(value)||value.date!==date||!validDate(value.date)||!integer(value.number,1,9999999)||!difficulties.includes(value.difficulty)||!durations.includes(value.duration))return null;
 if(value.runId!==`booth-${date}-${value.number}`)return null;
 return {runId:value.runId,number:value.number,date,difficulty:value.difficulty,duration:value.duration,ruleset:value.ruleset===2?2:1};
}
function resultFrom(value,date){
 const entry=entryFrom(value,date);if(!entry||typeof value.won!=='boolean'||!integer(value.food,0,10)||!finite(value.oil,0,100)||!finite(value.time,0,entry.duration+1))return null;
 if(value.won&&value.food<4)return null;
 const result={...entry,won:value.won,food:value.food,oil:value.oil,time:value.time};
 for(const [key,max]of [['signalsReported',2],['maxOil',100],['oilEnergyCost',10000]]){
  if(value[key]!==undefined&&!finite(value[key],0,max))return null;
  result[key]=value[key]??(key==='maxOil'?value.oil:0);
 }
 if(!Number.isInteger(result.signalsReported)||result.maxOil<result.oil)return null;
 return result;
}
function topRecords(records){
 const seen=new Set(),counts=new Map();
 return records.filter(r=>r.won).sort(rankOrder).filter(r=>{
  if(seen.has(r.runId))return false;seen.add(r.runId);
  const group=`${r.difficulty}-${r.duration}-${r.ruleset}`,count=(counts.get(group)||0)+1;counts.set(group,count);return count<=10;
 });
}
function dayFrom(raw){
 if(!object(raw)||!validDate(raw.date))return null;
 const day=emptyDay(raw.date);
 for(const key of ['participants','finished','wins'])if(integer(raw[key],0,10000000))day[key]=raw[key];
 day.finished=Math.min(day.finished,day.participants);day.wins=Math.min(day.wins,day.finished);
 if(finite(raw.totalTime,0,day.finished*121))day.totalTime=raw.totalTime;
 day.records=topRecords((Array.isArray(raw.records)?raw.records.slice(0,300):[]).map(r=>resultFrom(r,day.date)).filter(Boolean));
 const pendingSeen=new Set();
 day.pending=(Array.isArray(raw.pending)?raw.pending.slice(-32):[]).map(r=>entryFrom(r,day.date)).filter(r=>r&&!pendingSeen.has(r.runId)&&pendingSeen.add(r.runId));
 day.completedIds=[...new Set((Array.isArray(raw.completedIds)?raw.completedIds:[]).filter(id=>typeof id==='string'&&new RegExp(`^booth-${day.date}-[1-9][0-9]{0,6}$`).test(id)))].slice(-512);
 day.pending=day.pending.filter(r=>!day.completedIds.includes(r.runId));
 const knownNumber=Math.max(0,...day.records.map(r=>r.number),...day.pending.map(r=>r.number),...day.completedIds.map(id=>Number(id.split('-').at(-1))));
 day.nextNumber=Math.max(integer(raw.nextNumber,1,10000000)?raw.nextNumber:1,knownNumber+1);
 return day;
}

export function createBooth(storage,options={}){
 const clock=typeof options.now==='function'?options.now:()=>Date.now();
 let data=blank(),available=true;
 if(storage===undefined){try{storage=globalThis.localStorage;}catch{storage=null;}}
 if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function')available=false;
 else try{
  const source=storage.getItem(BOOTH_KEY),raw=source?JSON.parse(source):null;
  if(raw?.version===1){
   data.settings=settingsFrom(raw.settings);const seen=new Set();
   data.days=(Array.isArray(raw.days)?raw.days.slice(-32):[]).map(dayFrom).filter(day=>day&&!seen.has(day.date)&&seen.add(day.date));
  }
 }catch{available=false;}
 function today(){return localDate(clock());}
 function prune(current){
  const own=data.days.find(day=>day.date===current),others=data.days.filter(day=>day!==own).sort((a,b)=>b.date.localeCompare(a.date));
  data.days=[...(own?[own]:[]),...others].slice(0,7).sort((a,b)=>a.date.localeCompare(b.date));
 }
 function dayFor(date,create=false){
  let day=data.days.find(value=>value.date===date);
  if(!day&&create){day=emptyDay(date);data.days.push(day);}prune(today());return day;
 }
 function persist(){
  if(!storage){available=false;return false;}
  try{storage.setItem(BOOTH_KEY,JSON.stringify(data));available=true;return true;}catch{available=false;return false;}
 }
 function summary(day){
  return {date:day.date,participants:day.participants,finished:day.finished,wins:day.wins,completionRate:day.participants?day.wins/day.participants*100:0,averageTime:day.finished?day.totalTime/day.finished:0};
 }
 function records(day,difficulty,duration,ruleset=2){return day.records.filter(r=>r.difficulty===difficulty&&r.duration===duration&&r.ruleset===ruleset).sort(rankOrder);}
 prune(today());
 return {
  get data(){return clone(data);},get available(){return available;},
  saveSettings(partial){data.settings=settingsFrom(partial,data.settings);return persist();},
  beginRun(options={}){
   const date=today(),day=dayFor(date,true);
   if(day.nextNumber>9999999)throw new RangeError('Daily participant limit reached');
   const entry={runId:`booth-${date}-${day.nextNumber}`,number:day.nextNumber++,date,...settingsFrom(options,data.settings),ruleset:2};
   day.participants++;day.pending=[...day.pending,entry].slice(-32);persist();return clone(entry);
  },
  abandonRun(runId){
   const days=runId?data.days:[dayFor(today())].filter(Boolean);let changed=false;
   for(const day of days){const before=day.pending.length;day.pending=runId?day.pending.filter(r=>r.runId!==runId):[];changed||=day.pending.length!==before;}
   return changed?persist():false;
  },
  recordRun(input){
   const result=resultFrom(input,input?.date);if(!result)return {saved:false,rank:null,invalid:true};
   const day=dayFor(result.date);if(!day)return {saved:false,rank:null,invalid:true};
   if(day.completedIds.includes(result.runId)){
    const index=records(day,result.difficulty,result.duration,result.ruleset).findIndex(r=>r.runId===result.runId);
    return {saved:available,rank:index<0?null:index+1,duplicate:true};
   }
   const entry=day.pending.find(r=>r.runId===result.runId);
   if(!entry||entry.number!==result.number||entry.difficulty!==result.difficulty||entry.duration!==result.duration||entry.ruleset!==result.ruleset)return {saved:false,rank:null,invalid:true};
   day.pending=day.pending.filter(r=>r.runId!==result.runId);day.completedIds=[...day.completedIds,result.runId].slice(-512);
   day.finished++;day.totalTime+=result.time;if(result.won)day.wins++;
   day.records=topRecords([...day.records,result]);
   const index=records(day,result.difficulty,result.duration,result.ruleset).findIndex(r=>r.runId===result.runId);
   return {saved:persist(),rank:index<0?null:index+1};
  },
  getRecords(difficulty=data.settings.difficulty,duration=data.settings.duration,ruleset=2){
   const day=dayFor(today());return day?records(day,difficulty,duration,ruleset).map(clone):[];
  },
  getSummary(){return summary(dayFor(today())||emptyDay(today()));},
  resetToday(){
   const date=today(),day=dayFor(date,true),nextNumber=day.nextNumber,completedIds=day.completedIds;
   Object.assign(day,emptyDay(date),{nextNumber,completedIds});return persist();
  },
  exportCSV(){
   const header=['date','participant','difficulty','duration_seconds','rank','fish_delivered','final_oil_percent','time_seconds','rescue_reports','max_oil_percent','extra_energy','ruleset'];
   const day=dayFor(today()),rows=[header];
   if(day)for(const difficulty of difficulties)for(const duration of durations)for(const ruleset of [2,1]){
    records(day,difficulty,duration,ruleset).forEach((r,index)=>rows.push([r.date,String(r.number).padStart(4,'0'),difficulty,duration,index+1,r.food,r.oil,r.time.toFixed(2),r.signalsReported,r.maxOil,r.oilEnergyCost.toFixed(2),r.ruleset]));
   }
   return rows.map(row=>row.join(',')).join('\r\n')+'\r\n';
  },
 };
}

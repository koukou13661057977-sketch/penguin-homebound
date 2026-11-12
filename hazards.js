import {FISH_CLEARANCE,waterClearanceAt} from './world.js';

const cycleAt = (item,time) => (time+item.phase)%item.period;
const driftAt = (item,time) => Math.sin(cycleAt(item,time)/item.period*2*Math.PI)*item.drift;
const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
export const insideHazard = (x,z,item,margin=0) =>
 ((x-item.x)/(item.rx+margin))**2+((z-item.z)/(item.rz+margin))**2<=1;

export function initHazards(state,world){
 state.plastics=world.plasticZones.map(item=>({...item}));
 state.nets=world.nets.map(item=>({...item}));
 state.visitors=world.visitors.map(item=>({...item,blocked:false,progress:0,remaining:0}));
 state.snag=null;
 state.netSnags=0;
 state.netGrace=0;
 state.visitorWait=0;
}

export function updateHazards(state,world,config,dt){
 state.netGrace=Math.max(0,state.netGrace-dt);
 world.plasticZones.forEach((source,index)=>{
  const plastic=state.plastics[index];
  plastic.x=source.x+driftAt(source,state.time)*config.debrisDrift;
 });
 world.nets.forEach((source,index)=>{
  const net=state.nets[index];
  net.x=source.x+driftAt(source,state.time);
  net.rx=source.rx*config.netWidth;
 });
 for(const group of state.visitors){
  const cycle=cycleAt(group,state.time);
  const closed=group.closedFor*config.visitorCrossing;
  group.blocked=cycle<closed;
  group.progress=Math.min(1,cycle/closed);
  group.remaining=group.blocked?closed-cycle:0;
  const distance=Math.abs(state.z-group.z);
  if(group.blocked&&distance>=group.rz&&distance<group.rz+1)state.visitorWait+=dt;
 }
}

function plasticAvoidance(origin,world,config,time){
 const zone=world.plasticZones.find(item=>item.fishIds.includes(origin.id));
 if(!zone)return 0;
 const plasticX=zone.x+driftAt(zone,time)*config.debrisDrift;
 return clamp(1-Math.abs(plasticX-origin.x)/(zone.rx+2),0,1);
}

const fishFits=(x,z,world)=>waterClearanceAt(x,z,world,FISH_CLEARANCE);
const swimDirections=Array.from({length:8},(_,i)=>[Math.cos(i*Math.PI/4),Math.sin(i*Math.PI/4)]);
function oilDistance(x,z,patches){
 let nearest=Infinity;
 for(const p of patches)nearest=Math.min(nearest,((x-p.x)/p.rx)**2+((z-p.z)/p.rz)**2);
 return nearest;
}

function moveFish(fish,dx,dz,world){
 if(fishFits(fish.x+dx,fish.z+dz,world)){
  fish.x+=dx;
  fish.z+=dz;
 }else if(dx&&fishFits(fish.x+dx,fish.z,world)){
  fish.x+=dx;
  dz=0;
 }else if(dz&&fishFits(fish.x,fish.z+dz,world)){
  fish.z+=dz;
  dx=0;
 }else return;
 if(dx||dz)fish.heading=Math.atan2(dx,dz);
}

function fleeOil(fish,patches,world,dt){
 let best=oilDistance(fish.x,fish.z,patches),dx=0,dz=0;
 const distance=dt*2.6;
 for(const [ux,uz] of swimDirections){
  const x=fish.x+ux*distance,z=fish.z+uz*distance;
  const score=oilDistance(x,z,patches);
  if(score<=best||!fishFits(x,z,world))continue;
  best=score;dx=ux*distance;dz=uz*distance;
 }
 if(dx||dz)moveFish(fish,dx,dz,world);
}

export function updateFish(state,world,config,dt){
 const time=state.time,before=time-dt,patches=state.oilPatches;
 for(const fish of state.fish){
  if(!fish.active)continue;
  const origin=world.fish[fish.id];
  // Older checkpoints may still contain fish positions from the former ice shelf layout.
  if(!dt&&!fishFits(fish.x,fish.z,world)){fish.x=origin.x;fish.z=origin.z;}
  const coverage=oilDistance(fish.x,fish.z,patches);
  const polluted=coverage<=1;
  fish.pollutionTime=polluted?fish.pollutionTime+dt:0;
  fish.fleeing=fish.pollutionTime>6||(fish.fleeing&&coverage<2);
  if(dt&&fish.fleeing)fleeOil(fish,patches,world,dt);
  else if(dt){
   const phase=fish.id*2.399;
   const sway=.82*(Math.sin(time*2.2+phase)-Math.sin(before*2.2+phase));
   const kick=.34*(Math.sin(time*2.7+phase)-Math.sin(before*2.7+phase));
   const avoidance=plasticAvoidance(origin,world,config,time)-plasticAvoidance(origin,world,config,before);
   moveFish(fish,sway+Math.sign(origin.x)*avoidance*3,kick+avoidance*3*(world.zScale||1),world);
  }
  fish.polluted=patches.some(p=>insideHazard(fish.x,fish.z,p));
 }
}

export function blockLanding(state,nextZ){
 return state.visitors.some(item=>item.blocked&&
  Math.abs(state.z-item.z)>=item.rz&&Math.abs(nextZ-item.z)<item.rz);
}

export function catchNet(state,previousX,previousZ,config){
 if(state.snag||state.netGrace>0||state.terrain!=='water')return false;
 const index=state.nets.findIndex(item=>insideHazard(state.x,state.z,item));
 if(index<0)return false;
 const net=state.nets[index];
 const dx=previousX-net.x,dz=previousZ-net.z;
 const length=Math.hypot(dx,dz);
 state.snag={index,escapeX:length>.01?dx/length:0,escapeZ:length>.01?dz/length:-1,
  x:previousX,z:previousZ,elapsed:0,progress:0};
 state.netSnags++;
 state.energy=Math.max(0,state.energy-config.netCost);
 state.vx=state.vz=0;
 return true;
}

export function workFree(state,ix,iz,config,dt){
 const snag=state.snag;
 snag.elapsed+=dt;
 const retreat=ix*snag.escapeX+iz*snag.escapeZ;
 if(retreat>.35)snag.progress+=dt;
 if(snag.progress<config.netRelease&&snag.elapsed<4.3)return false;
 state.x=snag.x;
 state.z=snag.z;
 state.netGrace=.6;
 state.snag=null;
 return true;
}

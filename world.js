// One continuous coastal passage, shared by physics, the scene and the chart.
const iceShelf = (from, to) => ({type:'rect', x:0, z:(from+to)/2, width:29, length:to-from});
const oil = (x,z,rx,rz,phase) => ({x,z,rx,rz,baseX:x,baseZ:z,baseRx:rx,baseRz:rz,phase});

export const WORLD = Object.freeze({
 version:2,
 bounds:{minX:-26,maxX:26,minZ:0,maxZ:640},
 goal:{x:0,z:620},
 chapters:[
  {id:'departure',tag:'01 / ICE BAY',title:'清洁冰湾',start:0,end:80,description:'滑下冰坡，带上第一批鱼。'},
  {id:'feeding',tag:'02 / DRIFTING PLASTIC',title:'漂流觅食湾',start:80,end:180,description:'塑料漂过时，留意鱼群的动向。'},
  {id:'spill',tag:'03 / OIL CHANNEL',title:'漏油海峡',start:180,end:350,description:'看清油膜的空隙，留意浮标下的渔网。'},
  {id:'rescue',tag:'04 / THE LANDING',title:'登陆海岸',start:350,end:460,description:'跟着向导的手势通过登陆口。'},
  {id:'home',tag:'05 / SNOW RIDGE',title:'风雪归途',start:460,end:641,description:'过了雪脊就是家。留四条鱼给幼鸟。'},
 ],
 lane:[[0,0,13],[55,0,12],[100,-2,10],[150,2,10],[195,0,8.5],[246,-1,8],[280,1,8],[335,0,8],[390,0,8],[445,0,9],[485,-2,10],[535,2,10],[580,-1,10],[640,0,11]]
   .map(([z,x,halfWidth])=>({z,x,halfWidth})),
 ice:[
  iceShelf(0,44),iceShelf(70,92),iceShelf(149,180),
  {type:'ellipse',x:-4,z:112,rx:4,rz:9},
  {type:'ellipse',x:4,z:132,rx:4,rz:8},
  iceShelf(240,257),iceShelf(314,332),iceShelf(352,455),iceShelf(460,640),
 ],
 obstacles:[
  {x:-11,z:20,rx:2.8,rz:4,height:3},{x:10,z:30,rx:3,rz:5,height:3.5},
  {x:-9,z:76,rx:3,rz:4,height:2.5},{x:9,z:146,rx:3,rz:5,height:3},
  {x:7,z:196,rx:2.4,rz:5,height:3},{x:-7,z:252,rx:2.6,rz:5,height:3},
  {x:7,z:328,rx:2.8,rz:5,height:3.5},{x:-7,z:370,rx:2.5,rz:5,height:3.5},
  {x:5,z:474,rx:3.5,rz:6,height:4.5},{x:-5,z:519,rx:3.5,rz:7,height:4},
  {x:5,z:560,rx:3.2,rz:6,height:4.5},{x:-5,z:591,rx:3.3,rz:6,height:3.5},
 ],
 rescues:[{x:-5,z:246},{x:-4,z:325},{x:5,z:398}],
 shelters:[{x:0,z:20},{x:-5,z:80},{x:5,z:165},{x:4,z:247},{x:-3,z:321},
  {x:4,z:375},{x:-4,z:439},{x:-4,z:490},{x:4,z:542},{x:-3,z:578}],
 signals:[{id:'channel-friend',x:4,z:321,cause:'net'},{id:'coast-friend',x:-4,z:430,cause:'oil'}],
 fish:[[0,47],[1,64],[-.7,67],[2.2,94.8],[-6,100],[3,113],[5,121.6],[-4,144],[-1.8,146.4],[1.2,183],[-3,187],[6,205],
  [-6,224],[2,237.4],[4,260],[-4,274],[3,295],[-2,308],[-2,340],[2,348],[-5,338],[4,335],[0,457.5],[-4,457.5]]
  .map(([x,z],id)=>({id,x,z})),
 oilPatches:[oil(-4.8,211,4.1,8,0),oil(5.4,231,4.2,8,1.4),oil(-5,277,3.7,7,3.2),oil(5,305,4.2,7,4.8),oil(-5,344,4.1,6,2.2)],
 plasticZones:[
  {id:'tide-line',x:0,z:122.5,rx:5.5,rz:13,drift:4.4,period:17,phase:4,fishIds:[5,6]},
  {id:'debris-pool',x:1,z:145,rx:4.7,rz:10,drift:3.8,period:20,phase:9,fishIds:[7,8]},
 ],
 nets:[
  {id:'lost-net',x:0,z:264,rx:6.3,rz:3.7,drift:3.2,period:18,phase:4},
  {id:'net-tail',x:-3,z:292,rx:4.2,rz:3,drift:2.1,period:16,phase:9},
 ],
 visitors:[{id:'landing',x:0,z:390,rx:8.5,rz:3.4,period:15,closedFor:4.1,phase:7}],
});

const BOOTH_SCALE=.61;
const compact = object => {
 const scaled = {...object,z:object.z*BOOTH_SCALE};
 for(const key of ['baseZ','rz','baseRz','length']) if(key in object) scaled[key]=object[key]*BOOTH_SCALE;
 return scaled;
};
export const BOOTH_WORLD=Object.freeze({
 ...WORLD,mode:'booth',zScale:BOOTH_SCALE,
 bounds:{...WORLD.bounds,maxZ:WORLD.bounds.maxZ*BOOTH_SCALE},
 goal:compact(WORLD.goal),
 chapters:WORLD.chapters.map(chapter=>({...chapter,start:chapter.start*BOOTH_SCALE,end:chapter.end*BOOTH_SCALE})),
 ...Object.fromEntries(['lane','ice','obstacles','rescues','shelters','signals','fish','oilPatches','plasticZones','nets','visitors']
  .map(key=>[key,WORLD[key].map(compact)])),
});

export function getWorld(mode='normal'){return mode==='booth'?BOOTH_WORLD:WORLD;}
export function stageAt(z,world=WORLD){return Math.max(0,world.chapters.findIndex(c=>z>=c.start&&z<c.end));}
export function laneAt(z,world=WORLD){
 const next=world.lane.findIndex(knot=>knot.z>=z);
 if(next<0)return world.lane.at(-1);
 if(next===0)return world.lane[0];
 const a=world.lane[next-1],b=world.lane[next],t=(z-a.z)/(b.z-a.z);
 return {z,x:a.x+(b.x-a.x)*t,halfWidth:a.halfWidth+(b.halfWidth-a.halfWidth)*t};
}

export const FISH_CLEARANCE=1.08;

function intersectsEllipse(x,z,rx,rz,shape){
 const dx=Math.max(0,Math.abs(x-shape.x)-rx),dz=Math.max(0,Math.abs(z-shape.z)-rz);
 return (dx/shape.rx)**2+(dz/shape.rz)**2<=1;
}

function intersectsIce(x,z,rx,rz,world){
 return world.ice.some(shape=>shape.type==='rect'
  ?Math.abs(x-shape.x)<=shape.width/2+rx&&Math.abs(z-shape.z)<=shape.length/2+rz
  :intersectsEllipse(x,z,rx,rz,shape));
}

export function terrainAt(x,z,world=WORLD){return intersectsIce(x,z,0,0,world)?'ice':'water';}

// The footprint is axis-aligned and must fit in the playable water.
export function waterClearanceAt(x,z,world=WORLD,rx=0,rz=rx){
 const low=z-rz,high=z+rz;
 if(low<world.bounds.minZ||high>world.bounds.maxZ||intersectsIce(x,z,rx,rz,world))return false;
 const fits=lane=>Math.abs(x-lane.x)+rx<=lane.halfWidth;
 if(!fits(laneAt(low,world))||!fits(laneAt(high,world)))return false;
 if(world.lane.some(knot=>knot.z>low&&knot.z<high&&!fits(knot)))return false;
 return !world.obstacles.some(shape=>intersectsEllipse(x,z,rx,rz,shape));
}

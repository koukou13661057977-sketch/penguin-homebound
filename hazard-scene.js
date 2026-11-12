import * as THREE from './vendor/three.module.js';
import {laneAt,waterClearanceAt} from './world.js';

export const WATER_LEVEL=-.18;

// Clip surface effects against the same ice and coastline used by movement.
// Doing this per fragment preserves the wet part when a slick reaches a shelf.
export function createWaterClipping(world){
 const number=value=>Number(value).toFixed(5);
 const pair=(x,z)=>`vec2(${number(x)}, ${number(z)})`;
 const lane=knot=>pair(knot.x,knot.halfWidth);
 const bankSteps=world.lane.slice(1).map((end,i)=>{
  const start=world.lane[i];
  return `if (z <= ${number(end.z)}) return mix(${lane(start)}, ${lane(end)}, clamp((z - (${number(start.z)})) / ${number(end.z-start.z)}, 0.0, 1.0));`;
 }).join('\n');
 const ellipse=shape=>`onWaterEllipse(point, ${pair(shape.x,shape.z)}, ${pair(shape.rx,shape.rz)})`;
 const solids=[...world.ice.map(shape=>shape.type==='rect'
  ?`all(lessThanEqual(abs(point - ${pair(shape.x,shape.z)}), ${pair(shape.width/2,shape.length/2)}))`
  :ellipse(shape)),...world.obstacles.map(ellipse)];
 const source=`
 varying vec2 waterSurfacePoint;
 vec2 waterLane(float z) {
  ${bankSteps}
  return ${lane(world.lane.at(-1))};
 }
 bool onWaterEllipse(vec2 point, vec2 center, vec2 radius) {
  vec2 delta = (point - center) / radius;
  return dot(delta, delta) <= 1.0;
 }
 bool onWaterSurface(vec2 point) {
  vec2 bank = waterLane(point.y);
  if (point.y < ${number(world.bounds.minZ)} || point.y > ${number(world.bounds.maxZ)} || abs(point.x - bank.x) > bank.y) return false;
  ${solids.map(solid=>`if (${solid}) return false;`).join('\n')}
  return true;
 }`;
 return material=>{
  material.onBeforeCompile=shader=>{
   shader.vertexShader=shader.vertexShader
    .replace('#include <common>','#include <common>\nvarying vec2 waterSurfacePoint;')
    .replace('#include <project_vertex>','#include <project_vertex>\nwaterSurfacePoint = (modelMatrix * vec4(transformed, 1.0)).xz;');
   shader.fragmentShader=shader.fragmentShader
    .replace('#include <common>',`#include <common>\n${source}`)
    .replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif (!onWaterSurface(waterSurfacePoint)) discard;');
  };
  material.customProgramCacheKey=()=>source;
  return material;
 };
}

export function addPassageBanks(world,chunk){
 const slate=new THREE.MeshStandardMaterial({color:'#578195',roughness:.9});
 const snow=new THREE.MeshStandardMaterial({color:'#c4e0e1',roughness:.8});
 const facet=new THREE.IcosahedronGeometry(1,0);
 for(let i=0;i<world.lane.length-1;i++){
  const a=world.lane[i],b=world.lane[i+1],root=chunk((a.z+b.z)/2,(b.z-a.z)/2+3);
  for(const side of [-1,1]){
   const edge=(knot,y,offset)=>[knot.x+side*(knot.halfWidth+offset),y,knot.z];
   const cliff=new THREE.BufferGeometry();
   cliff.setAttribute('position',new THREE.Float32BufferAttribute([
    ...edge(a,-.32,0),...edge(b,-.32,0),...edge(a,.82,.16),...edge(b,.82,.16),
    ...edge(a,.72,2.9),...edge(b,.72,2.9),
   ],3));
   cliff.setIndex(side>0?[0,1,2,2,1,3,2,3,4,4,3,5]:[0,2,1,2,3,1,2,4,3,4,5,3]);
   cliff.computeVertexNormals();
   cliff.addGroup(0,6,0);cliff.addGroup(6,6,1);
   const wall=new THREE.Mesh(cliff,[slate,snow]);wall.receiveShadow=true;root.add(wall);
   for(let z=a.z+3;z<b.z;z+=8){
    const lane=laneAt(z,world),t=z*2.17+side;
    const rock=new THREE.Mesh(facet,Math.sin(t)>.25?snow:slate);
    rock.position.set(lane.x+side*(lane.halfWidth+1.75),.46,z);
    rock.scale.set(1.42, .65+.45*Math.abs(Math.sin(t)), 2.1+Math.abs(Math.cos(t))*1.3);
    rock.rotation.y=t;rock.receiveShadow=true;root.add(rock);
   }
  }
 }
}

export function addHazardModels(world,scene,label,clipWater,fieldWorkers){
 const mat=(color,extra={})=>new THREE.MeshStandardMaterial({color,roughness:.73,...extra});
 const blue=mat('#235b72'), coral=mat('#f28043'), cream=mat('#fff1cf');
 const bottle=mat('#69d2d0',{roughness:.33}), bottleRib=mat('#3faeae',{roughness:.38});
 const cap=mat('#ee934a'), foil=mat('#e8eef0',{side:THREE.DoubleSide}), fold=mat('#becfd3');
 const rope=mat('#d8a875');
 const gateOpen=mat('#4aaf86',{emissive:'#1f674c',emissiveIntensity:.45});
 const gateClosed=mat('#fa904c',{emissive:'#8e4c25',emissiveIntensity:.45});
 const touristCoats=['#85597a','#377888','#b18b42'];
 const sphere=new THREE.SphereGeometry(1,12,8), box=new THREE.BoxGeometry(1,1,1);
 const cylinder=new THREE.CylinderGeometry(1,1,1,12);
 const flap=new THREE.BufferGeometry();
 flap.setAttribute('position',new THREE.Float32BufferAttribute([
  -.48,0,-.54, .44,.04,-.49, -.55,.02,.39, .48,0,.46, 0,.14,.01,
 ],3));
 flap.setIndex([0,4,1,1,4,3,3,4,2,2,4,0]);flap.computeVertexNormals();
 const fill=clipWater(new THREE.MeshBasicMaterial({color:'#c68557',transparent:true,opacity:.19,depthWrite:false,side:THREE.DoubleSide}));
 const threads=clipWater(new THREE.LineBasicMaterial({color:'#e0b789',transparent:true,opacity:.82}));
 const marker=clipWater(new THREE.MeshBasicMaterial({color:'#e7c396',transparent:true,opacity:.24,depthWrite:false}));
 const disc=new THREE.CircleGeometry(1,40).rotateX(-Math.PI/2);
 function part(parent,geometry,material,x,y,z,sx,sy,sz){
  const object=new THREE.Mesh(geometry,material);
  object.position.set(x,y,z);object.scale.set(sx,sy,sz);object.receiveShadow=true;parent.add(object);
  return object;
 }
 function group(){const node=new THREE.Group();scene.add(node);return node;}
 function title(root,words,color,y,width){
  const sign=label(words,color,width);sign.position.set(0,y,-.7);root.add(sign);return sign;
 }
 const plastics=world.plasticZones.map((_,index)=>{
  const root=group(),pieces=[];
  const plank=part(root,disc,marker,0,.002,0,1,1,1);
  const sign=title(root,'漂浮塑料','#e0fff0',3.9,7);
  for(let i=0;i<10;i++){
   const object=new THREE.Group();root.add(object);
   const angle=i*2.399+index*.62,radius=i===0?0:.35+(i%4)*.13;
   const modelRadius=[.83,.78,.46][i%3];
   pieces.push({object,x:Math.cos(angle)*radius,z:Math.sin(angle)*radius,angle,modelRadius});
   if(i%3===0){
    part(object,cylinder,bottle,0,.18,0,.24,.64,.24);
    part(object,sphere,bottle,0,.43,0,.232,.158,.232);
    part(object,cylinder,bottle,0,.548,0,.13,.14,.13);
    part(object,cylinder,cap,0,.66,0,.115,.19,.115);
    part(object,cylinder,cream,0,.16,0,.244,.20,.244);
    for(const height of [-.077,.3,.373])part(object,cylinder,bottleRib,0,height,0,.246,.036,.246);
    object.rotation.x=1.27;
   }else if(i%3===1){
    part(object,flap,foil,0,.08,0,1,1,1);
    for(const side of [-1,1])part(object,box,foil,side*.24,.08,.54,.093,.028,.22);
    part(object,box,fold,0,.085,.61,.50,.025,.067);
    part(object,box,fold,-.16,.13,-.06,.027,.025,.61).rotation.y=.29;
   }else{
    part(object,flap,cap,0,.08,0,.47,1,.37);
    part(object,box,cream,-.05,.164,-.07,.27,.025,.069).rotation.y=-.12;
    part(object,cylinder,blue,.28,.03,.03,.17,.06,.17);
   }
  }
  return {root,pieces,plank,sign};
 });
 const netGeometry=new THREE.BufferGeometry();
 const segments=[];
 for(let i=-5;i<=5;i++){
  const a=i/6,b=Math.sqrt(1-a*a);
  segments.push(a,.13,-b,a,.13,b,-b,.13,a,b,.13,a);
 }
 const rimPoints=[];
 for(let i=0;i<40;i++){
  const a=i/40*Math.PI*2,b=(i+1)/40*Math.PI*2;
  rimPoints.push(Math.cos(a),.15,Math.sin(a),Math.cos(b),.15,Math.sin(b));
 }
 netGeometry.setAttribute('position',new THREE.Float32BufferAttribute(segments,3));
 const rimGeometry=new THREE.BufferGeometry();
 rimGeometry.setAttribute('position',new THREE.Float32BufferAttribute(rimPoints,3));
 const rimMaterial=clipWater(new THREE.LineBasicMaterial({color:'#ffd097'}));
 const nets=world.nets.map(()=>{
  const root=group(),shape=new THREE.Group();
  root.add(shape);
  part(shape,disc,fill,0,.025,0,1,1,1);
  shape.add(new THREE.LineSegments(netGeometry,threads));
  shape.add(new THREE.LineSegments(rimGeometry,rimMaterial));
  const buoys=Array.from({length:8},(_,i)=>{
   const buoy=new THREE.Group(),color=i%2===0?coral:cream;root.add(buoy);
   part(buoy,sphere,color,0,0,0,1,.87,1);
   part(buoy,sphere,i%2===0?cream:coral,0,.12,0,1,.17,1);
   part(buoy,cylinder,blue,0,.78,0,.22,.31,.22);
   return buoy;
  });
  const sign=title(root,'废弃渔网','#ffe1af',3.65,7.7);
  return {root,shape,buoys,sign};
 });
 const visitors=world.visitors.map(item=>{
  const root=group();root.position.set(item.x,.31,item.z);
  const guide=fieldWorkers.create({role:'guide',coat:'#367a69'});
  guide.root.scale.setScalar(1.55);
  root.add(guide.root);
  const tourists=touristCoats.map((coat,index)=>{
   const actor=fieldWorkers.create({role:'visitor',coat,skin:['#c29474','#94664e','#dda58f'][index]});
   actor.root.scale.setScalar(1.43+index*.06);
   root.add(actor.root);
   return actor;
  });
  const gates=[-1,1].map(side=>{
   const edge=side*item.rx*.95,leafWidth=item.rx*.95;
   part(root,box,blue,edge,.07,-item.rz,.65,.14,.65);
   const post=part(root,cylinder,blue,edge,.52,-item.rz,.19,1.04,.19);
   const closedLamp=part(root,sphere,gateClosed,edge,1.04,-item.rz,.19,.14,.19);
   const openLamp=part(root,sphere,gateOpen,edge,1.04,-item.rz,.19,.14,.19);
   const hinge=new THREE.Group();
   hinge.position.set(edge,.78,-item.rz);root.add(hinge);
   part(hinge,box,coral,-side*leafWidth*.5,0,0,leafWidth,.15,.16);
   for(const fraction of [.20,.40,.60,.80])part(hinge,box,cream,-side*leafWidth*fraction,0,0,.30,.157,.167);
   return {side,hinge,post,closedLamp,openLamp};
  });
  const wait=title(root,'游客经过 · 请稍等','#ffd1a2',6.7,10);
  const open=title(root,'向导让行 · 可以通过','#c9f6d7',6.7,10);
  return {root,guide,tourists,gates,wait,open};
 });
 const snagRing=new THREE.Mesh(new THREE.TorusGeometry(1,.065,6,36),rope);
 snagRing.rotation.x=-1.22;scene.add(snagRing);
 const retreatShape=new THREE.Shape();
 retreatShape.moveTo(-.18,0);retreatShape.lineTo(.18,0);retreatShape.lineTo(.18,-.82);
 retreatShape.lineTo(.46,-.82);retreatShape.lineTo(0,-1.42);retreatShape.lineTo(-.46,-.82);
 retreatShape.lineTo(-.18,-.82);retreatShape.closePath();
 const retreatArrow=new THREE.Mesh(new THREE.ShapeGeometry(retreatShape).rotateX(-Math.PI/2),
  new THREE.MeshBasicMaterial({color:'#ffe3ab',toneMapped:false}));
 scene.add(retreatArrow);
 function placeFloating(object,item,x,z,y,radius){
  const fits=scale=>waterClearanceAt(item.x+x*scale,item.z+z*scale,world,radius);
  let scale=1;
  if(!fits(scale)){
   if(!fits(0)){object.visible=false;return;}
   let high=1;
   scale=0;
   for(let i=0;i<7;i++){
    const middle=(scale+high)*.5;
    if(fits(middle))scale=middle;else high=middle;
   }
  }
  object.visible=true;
  object.position.set(x*scale,y,z*scale);
 }
 return (state,viewZ,time,motion,firstPerson=false)=>{
  plastics.forEach(({root,pieces,plank,sign},index)=>{
   const item=state.plastics?.[index];root.visible=!!item&&Math.abs(item.z-viewZ)<62;
   if(!root.visible)return;
   root.position.set(item.x,WATER_LEVEL+.035,item.z);plank.scale.set(item.rx,1,item.rz);
   sign.position.y=firstPerson?1.74:3.9;sign.visible=waterClearanceAt(item.x,item.z,world);
   pieces.forEach(({object,x,z,angle,modelRadius},i)=>{
    const baseHeight=i%3===0?.015:-.035;
    placeFloating(object,item,x*item.rx,z*item.rz,baseHeight+Math.sin(time*1.7+i)*.045*motion,modelRadius);
    object.rotation.y=angle+time*.32*motion;
   });
  });
  nets.forEach(({root,shape,buoys,sign},index)=>{
   const item=state.nets?.[index];root.visible=!!item&&Math.abs(item.z-viewZ)<64;
   if(!root.visible)return;
   root.position.set(item.x,WATER_LEVEL+.032,item.z);shape.scale.set(item.rx,1,item.rz);
   sign.position.y=firstPerson?1.82:3.65;sign.visible=waterClearanceAt(item.x,item.z,world);
   buoys.forEach((buoy,i)=>{
    buoy.visible=firstPerson||i<5;
    if(!buoy.visible)return;
    const a=i/4*Math.PI;
    const size=firstPerson?.35:.29;
    buoy.scale.set(size,firstPerson?.29:.21,size);
    placeFloating(buoy,item,Math.cos(a)*item.rx,-Math.sin(a)*item.rz,(firstPerson?.24:.18)+Math.sin(time*1.7+i)*.05*motion,size);
   });
  });
  visitors.forEach(({root,guide,tourists,gates,wait,open},index)=>{
   const item=state.visitors?.[index];root.visible=!!item&&Math.abs(item.z-viewZ)<69;
   if(!root.visible)return;
   wait.visible=item.blocked;open.visible=!item.blocked;
   wait.position.y=open.position.y=firstPerson?3.15:6.7;
   for(const {side,hinge,post,closedLamp,openLamp} of gates){
    hinge.rotation.y=item.blocked?0:-side*Math.PI/2;
    const postHeight=firstPerson?1.34:1.04;
    post.position.y=postHeight*.5;post.scale.y=postHeight;
    closedLamp.position.y=openLamp.position.y=postHeight;
    closedLamp.visible=item.blocked;openLamp.visible=!item.blocked;
   }
   guide.root.position.set(-item.rx*.75,0,.24);
   guide.root.rotation.y=item.blocked?2.75:2.12;
   guide.pose({kind:'signal',time,motion,phase:item.blocked?0:2.5});
   tourists.forEach((actor,i)=>{
    actor.root.position.set(item.blocked?(-.95+1.9*item.progress)*item.rx+(i-1)*1.58:item.rx-.1+i*1.20,0,.6+(i%2)*1.26);
    actor.root.rotation.y=item.blocked?1.32:-2.3;
    actor.pose({kind:item.blocked?'walk':'idle',time,motion,phase:i*2.3});
   });
  });
  const snag=state.snag;
  snagRing.visible=!!snag;
  retreatArrow.visible=!!snag&&Number.isFinite(snag.escapeX)&&Number.isFinite(snag.escapeZ);
  if(snagRing.visible)snagRing.position.set(state.x,.37,state.z);
  if(retreatArrow.visible){
   retreatArrow.position.set(state.x+snag.escapeX*1.36,.42,state.z+snag.escapeZ*1.36);
   retreatArrow.rotation.y=Math.atan2(snag.escapeX,snag.escapeZ);
  }
 };
}

import * as THREE from './vendor/three.module.js';
import { getWorld,laneAt,waterClearanceAt,FISH_CLEARANCE } from './world.js';
import { tr, getLanguage } from './i18n.js?v=1.13.0';
import { CAMERA_OFFSET } from './controls.js';
import { createPenguinFactory } from './penguin.js';
import { createFieldWorkerFactory } from './field-worker.js';
import { WATER_LEVEL,createWaterClipping,addPassageBanks,addHazardModels } from './hazard-scene.js';

const PREVIEW_CAMERA_OFFSET=Object.freeze({x:25,y:33,z:-37});
export const HOME_FEEDING_MS=8200;
export const HOME_CELEBRATION_START=5.65;
const HOME_APPROACH=1.25;
const HOME_LAST_TRANSFER=5.5;
const FISH_REACHES_CHICK=.76;

export function homeFeedingProgress(food,elapsedSeconds){
  const total=THREE.MathUtils.clamp(Number.isFinite(food)?Math.floor(food):0,0,10);
  const elapsed=Number.isFinite(elapsedSeconds)?elapsedSeconds:0;
  const turns=THREE.MathUtils.clamp((elapsed-HOME_APPROACH)/(HOME_LAST_TRANSFER-HOME_APPROACH),0,1)*total;
  const index=Math.floor(turns);
  const serving=elapsed>=HOME_APPROACH&&index<total;
  const phase=serving?turns-index:0;
  const delivered=serving&&phase>=FISH_REACHES_CHICK;
  return {total,served:index+Number(delivered),phase,recipient:serving?index%2:-1,
    visible:serving&&!delivered,celebrating:elapsed>=HOME_CELEBRATION_START};
}

function surfaceTexture(paint){
  const canvas=document.createElement('canvas');
  canvas.width=canvas.height=256;
  paint(canvas.getContext('2d'),canvas.width);
  const texture=new THREE.CanvasTexture(canvas);
  texture.colorSpace=THREE.SRGBColorSpace;
  return texture;
}

function paintSea(ctx,size){
  ctx.fillStyle='#e8edef';
  ctx.fillRect(0,0,size,size);
  // Wrap each ripple across tile edges so the pattern remains continuous.
  for(let i=0;i<53;i++){
    const x=(i*97+17)%size,y=4+(i*61+43)%(size-8),length=12+(i*19)%40;
    for(const offset of [-size,0,size]){
      const start=x+offset;
      const glint=ctx.createLinearGradient(start,y,start+length,y);
      glint.addColorStop(0,'rgba(255,255,255,0)');
      glint.addColorStop(.42,i%3?'rgba(255,255,255,.46)':'rgba(119,153,171,.31)');
      glint.addColorStop(1,'rgba(255,255,255,0)');
      ctx.strokeStyle=glint;
      ctx.lineWidth=i%4===0?1.8:1;
      ctx.beginPath();
      ctx.moveTo(start,y);
      ctx.quadraticCurveTo(start+length*.55,y-3,start+length,y);
      ctx.stroke();
    }
  }
}

function paintSlick(ctx,size){
  const center=size/2;
  const oil=ctx.createRadialGradient(106,109,8,center,center,center);
  oil.addColorStop(0,'#233244');
  oil.addColorStop(.78,'#17242f');
  oil.addColorStop(1,'#101b25');
  ctx.fillStyle=oil;
  ctx.fillRect(0,0,size,size);
  for(let i=0;i<11;i++){
    const y=58+i*12;
    const sheen=ctx.createLinearGradient(32,y-12,228,y+31);
    sheen.addColorStop(0,'rgba(99,130,167,0)');
    sheen.addColorStop(.27,'rgba(101,114,171,.46)');
    sheen.addColorStop(.52,'rgba(167,112,154,.5)');
    sheen.addColorStop(.73,'rgba(154,143,91,.45)');
    sheen.addColorStop(1,'rgba(88,151,144,0)');
    ctx.strokeStyle=sheen;
    ctx.lineWidth=i%4===0?5:1.5+i%3;
    ctx.beginPath();
    ctx.moveTo(21+(i%4)*12,y);
    ctx.bezierCurveTo(61,y-28,87,y+26,125,y+8);
    ctx.bezierCurveTo(172,y-17,176,y+31,235-(i%3)*14,y-1);
    ctx.stroke();
  }
  ctx.strokeStyle='rgba(111,143,167,.36)';
  ctx.lineWidth=2;
  ctx.beginPath();
  ctx.arc(center,center,center-2,0,Math.PI*2);
  ctx.stroke();
}

// All geometry, character details and textures are local. Gameplay geometry comes
// from the same map as the simulation; decoration never disguises a safe route.
export function createScene(canvas, options = {}) {
  const WORLD=options.world||getWorld(options.mode),zScale=WORLD.zScale||1;
  const clipWater=createWaterClipping(WORLD);
  const settings = { quality: 'medium', reducedMotion: false, ...options };
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#b8dfe4');
  scene.fog = new THREE.Fog('#b8dfe4', 65, 145);
  const camera = new THREE.OrthographicCamera(-28, 28, 21, -21, .1, 230);
  const eyeCamera = new THREE.PerspectiveCamera(65, 1, .08, 230);
  const hemisphere = new THREE.HemisphereLight('#e6f8ff', '#285567', 2.15);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight('#fff0d6', 3.1);
  sun.position.set(-25, 55, -35); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -28, right: 28, top: 32, bottom: -32, near: 1, far: 140 });
  sun.shadow.bias = -.0008; sun.shadow.normalBias = .045;
  scene.add(sun, sun.target);
  const geo = {
    sphere: new THREE.SphereGeometry(1, 20, 14), small: new THREE.SphereGeometry(1, 12, 8),
    rock: new THREE.IcosahedronGeometry(1, 0), crystal: new THREE.IcosahedronGeometry(1, 1),
    cylinder: new THREE.CylinderGeometry(1, 1, 1, 36), cone: new THREE.ConeGeometry(1, 1, 8),
    box: new THREE.BoxGeometry(1, 1, 1), circle: new THREE.CircleGeometry(1, 48),
    slickRim: new THREE.RingGeometry(.963,1,48).rotateX(-Math.PI/2),
    ring: new THREE.TorusGeometry(1, .08, 6, 32), plane: new THREE.PlaneGeometry(1, 1),
  };
  const material = (color, extra={}) => new THREE.MeshStandardMaterial({ color, roughness: .78, ...extra });
  const basic = (color, opacity=1) => new THREE.MeshBasicMaterial({color, transparent:opacity<1,opacity,depthWrite:opacity===1});
  const seaTexture=surfaceTexture(paintSea);
  seaTexture.wrapS=seaTexture.wrapT=THREE.RepeatWrapping;
  seaTexture.repeat.set(420/17,(WORLD.bounds.maxZ+240)/17);
  const slick=new THREE.MeshBasicMaterial({map:surfaceTexture(paintSlick),toneMapped:false});
  const m = {
    ice:material('#c9e9eb',{roughness:.4}), side:material('#659eb8'), snow:material('#f1f5ea'),
    orange:material('#ed8a40'), white:material('#f8fcf8'), eye:material('#050e13',{roughness:.15}),
    rock:material('#819aa2'), navy:material('#26485a'), fish:material('#ffffff',{vertexColors:true,metalness:.16,roughness:.36}),
    oil:material('#121c28',{metalness:.6,roughness:.22}),
    slick,waterSlick:clipWater(slick.clone()),slickRim:clipWater(basic('#c49bae',.76)),
    foam:clipWater(basic('#bbefea',.32)),glimmer:clipWater(basic('#ffdc8e',.6)),
    contact:basic('#174457',.2), tracks:basic('#6fa8b9',.24),
    water:material('#328b9e',{roughness:.37,metalness:.14,map:seaTexture}),
    safe:basic('#8fcfc2',.3), warm:basic('#e3bb7d',.4), cleanup:basic('#d5fcf5',.62),
    fin:material('#d88b37',{roughness:.51}), gill:material('#a96c32'),
  };
  geo.fishBody=geo.sphere.clone();
  const fishVertices=geo.fishBody.getAttribute('position'),fishColors=new Float32Array(fishVertices.count*3);
  const fishBack=new THREE.Color('#bb782a'),fishSide=new THREE.Color('#f3be57'),fishBelly=new THREE.Color('#fff0bf'),fishTint=new THREE.Color();
  for(let i=0;i<fishVertices.count;i++){
    const x=fishVertices.getX(i),y=fishVertices.getY(i),z=fishVertices.getZ(i);
    fishVertices.setXYZ(i,x*(.30+.05*z),y*(.21+.026*z),z*(z>0?.76:.68));
    const blend=THREE.MathUtils.smoothstep(Math.abs(y),.04,.94);
    fishTint.copy(fishSide).lerp(y>0?fishBack:fishBelly,blend).toArray(fishColors,i*3);
  }
  geo.fishBody.setAttribute('color',new THREE.BufferAttribute(fishColors,3));
  geo.fishBody.computeVertexNormals();
  const roots=[];
  const chunk=(z,span=30)=>{const g=new THREE.Group();scene.add(g);roots.push({g,z,span});return g;};
  function mesh(g,mat,parent,x=0,y=0,z=0,sx=1,sy=1,sz=1,shadow=false){
    const o=new THREE.Mesh(g,mat);o.position.set(x,y,z);o.scale.set(sx,sy,sz);o.receiveShadow=true;o.castShadow=shadow;parent.add(o);return o;
  }
  const box=(mat,p,x,y,z,sx,sy,sz,shadow=false)=>mesh(geo.box,mat,p,x,y,z,sx,sy,sz,shadow);
  const oval=(mat,p,x,y,z,sx,sy,sz,shadow=false)=>mesh(geo.sphere,mat,p,x,y,z,sx,sy,sz,shadow);
  function disc(mat,p,x,y,z,rx,rz){const o=mesh(geo.circle,mat,p,x,y,z,rx,rz,1);o.rotation.x=-Math.PI/2;return o;}
  function line(points,mat,parent){const o=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p))),mat);parent.add(o);return o;}
  let seed=140814;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const labelCache=new Map(),sceneLabels=[];
  function paintLabel(entry,language=getLanguage()){
    const ctx=entry.canvas.getContext('2d'),text=tr(entry.text,language);
    ctx.clearRect(0,0,512,112);ctx.fillStyle='rgba(17,50,60,.83)';ctx.beginPath();ctx.roundRect(3,7,506,98,22);ctx.fill();
    ctx.fillStyle=entry.color;ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='600 36px "Segoe UI","Microsoft YaHei",sans-serif';
    const size=Math.min(36,36*468/Math.max(1,ctx.measureText(text).width));
    ctx.font=`600 ${size}px "Segoe UI","Microsoft YaHei",sans-serif`;ctx.fillText(text,256,57);
    if(entry.material)entry.material.map.needsUpdate=true;
  }
  function label(text,color='#f0f5e8',width=8){
    const key=text+color;
    if(!labelCache.has(key)){
      const c=document.createElement('canvas');c.width=512;c.height=112;
      const entry={text,color,canvas:c};paintLabel(entry);
      const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
      entry.material=new THREE.SpriteMaterial({map:tex,depthWrite:false,transparent:true});labelCache.set(key,entry);
    }
    const sprite=new THREE.Sprite(labelCache.get(key).material);
    sprite.scale.set(width,width*112/512,1);
    sceneLabels.push({sprite,width});
    return sprite;
  }
  // Keep the existing sprite, material and texture when the player switches language.
  function setLanguage(language=getLanguage()){for(const entry of labelCache.values())paintLabel(entry,language);}
  function flag(p,x,z,scale=1){box(m.navy,p,x,2*scale,z,.1,4*scale,.1);const f=box(m.orange,p,x+.65*scale,3.5*scale,z,1.3*scale,.68*scale,.05);return f;}
  const water=mesh(geo.plane,m.water,scene,0,WATER_LEVEL,WORLD.goal.z/2,420,WORLD.bounds.maxZ+240,1);water.rotation.x=-Math.PI/2;
  for(const shape of WORLD.ice){
    const g=chunk(shape.z,shape.type==='rect'?shape.length/2:shape.rz);
    if(shape.type==='rect'){
      box(m.side,g,shape.x,-.38,shape.z,shape.width,.95,shape.length);
      box(m.ice,g,shape.x,.07,shape.z,shape.width,.15,shape.length);
      box(m.snow,g,shape.x,.22,shape.z,shape.width,.14,shape.length);
    }else{
      mesh(geo.cylinder,m.side,g,shape.x,-.35,shape.z,shape.rx,.95,shape.rz);
      mesh(geo.cylinder,m.ice,g,shape.x,.16,shape.z,shape.rx,.24,shape.rz);
      disc(m.snow,g,shape.x,.29,shape.z,shape.rx*.88,shape.rz*.9);
    }
    // Small seams and snow grain stay inside each playable ice shape.
    const radius=shape.rx??shape.width/2,rz=shape.rz??shape.length/2;
    const crackMat=new THREE.LineBasicMaterial({color:'#87b9c6',transparent:true,opacity:.28});
    for(let i=0;i<Math.min(9,Math.ceil(rz/9));i++){
      const x=shape.x+(rand()-.5)*radius,z=shape.z+(rand()-.5)*rz*1.5;
      line([[x,.3,z],[x+.8,.3,z+.6],[x+1.4,.3,z+.3],[x+2.2,.3,z+.9]],crackMat,g);
    }
  }
  // Solid obstacles have the same ellipse footprint as the physics map.
  for(const o of WORLD.obstacles||[]){
    const g=chunk(o.z,o.rz+3),height=o.height??Math.max(2.4,o.rx*.7);
    const base=mesh(geo.cylinder,m.side,g,o.x,height*.2-.2,o.z,o.rx,height*.5,o.rz,true);
    const crown=mesh(geo.rock,m.ice,g,o.x,height*.65,o.z,o.rx*.9,height*.7,o.rz*.9,true);crown.rotation.y=.4;
    mesh(geo.rock,m.snow,g,o.x-.2,height*1.05,o.z,o.rx*.55,height*.3,o.rz*.58,true);
    base.userData.obstacle=true;
  }
  // Decoration is grouped into strips, so only nearby coastline is submitted.
  for(let z=-20;z<WORLD.bounds.maxZ+45;z+=32){
    const g=chunk(z,25);
    for(const side of [-1,1]){
      if(side<0&&z>220*zScale&&z<300*zScale)continue;
      const x=side*(35+rand()*10),height=6+rand()*14;
      const mountain=mesh(geo.rock,m.side,g,x,height*.2-1,z,7+rand()*5,height,11);mountain.rotation.y=rand()*3;
      mesh(geo.rock,m.ice,g,x+side*2,height*.62,z+1,6,height*.64,8);
      mesh(geo.rock,m.snow,g,x+side*2,height*.98,z,4,height*.3,5);
      if(z>460*zScale)mesh(geo.rock,m.white,g,side*31,.2,z+15,4,2,8);
    }
  }
  addPassageBanks(WORLD,chunk);
  const fieldWorkers=createFieldWorkerFactory();
  const animateHazards=addHazardModels(WORLD,scene,label,clipWater,fieldWorkers);
  for(const chapter of WORLD.chapters){
    const z=chapter.start+6,lane=laneAt(z,WORLD),g=chunk(z,5),sign=label(chapter.title,'#e7f1df',9.5);
    sign.position.set(lane.x-lane.halfWidth-1,4.1,z);g.add(sign);
    if(chapter.start>0)for(const side of [-1,1])flag(g,lane.x+side*(lane.halfWidth+.4),z,.66);
  }
  const shipZ=267*zScale,shipRoot=chunk(shipZ,25),ship=new THREE.Group();
  shipRoot.add(ship);ship.position.set(-33,1,shipZ);ship.rotation.z=-.055;
  const profile=new THREE.Shape();
  profile.moveTo(-3.25,-13.2);
  profile.quadraticCurveTo(-4,-12,-4,-9.3);
  profile.lineTo(-4,7.6);
  profile.quadraticCurveTo(-3.6,13.6,0,16.2);
  profile.quadraticCurveTo(3.6,13.6,4,7.6);
  profile.lineTo(4,-9.3);
  profile.quadraticCurveTo(4,-12,3.25,-13.2);
  profile.closePath();
  const hull=new THREE.ExtrudeGeometry(profile,{depth:3,bevelThickness:.17,bevelSize:.14,bevelSegments:1,curveSegments:6});
  hull.rotateX(Math.PI/2);
  mesh(hull,m.navy,ship,0,1.35,0,1,1,1,true);
  box(m.side,ship,0,1.49,2.3,7.35,.19,19.7,true);
  box(m.white,ship,0,2.9,-8,5.8,3,6.2,true);
  box(m.white,ship,0,4.78,-7.55,6.4,.95,4.5,true);
  box(m.navy,ship,0,5.34,-7.55,6.7,.19,4.85,true);
  for(let i=0;i<4;i++)box(m.navy,ship,-2.32+i*1.54,4.83,-5.27,1.22,.48,.055);
  for(const side of [-1,1]){
    box(m.navy,ship,side*3.22,4.83,-7.54,.055,.48,3.54);
    box(m.white,ship,side*3.56,1.98,1.25,.075,.095,14.2);
    box(m.orange,ship,side*4.12,.8,0,.07,.16,19.2);
    for(let i=0;i<4;i++)box(m.white,ship,side*3.56,1.73,-4.5+i*4.25,.10,.52,.10);
    mesh(geo.ring,m.orange,ship,side*2.95,3,-7.4,.38,.38,.42).rotation.y=Math.PI/2;
  }
  for(let i=0;i<4;i++){
    mesh(geo.cylinder,m.side,ship,0,1.94,-2+i*3.85,1.22,.67,1.22,true);
    mesh(geo.cylinder,m.orange,ship,0,2.31,-2+i*3.85,1.11,.17,1.11);
    box(m.navy,ship,1.16,2.03,-2+i*3.85,1.4,.23,.29);
  }
  box(m.navy,ship,1.93,1.82,3.6,.27,.27,12.1);
  box(m.orange,ship,0,6.06,-9.75,.89,1.6,.95,true);box(m.navy,ship,0,6.88,-9.75,.96,.23,1.01);
  box(m.navy,ship,0,6.95,-6.55,.12,3.1,.12);box(m.white,ship,0,7.83,-6.55,1.78,.12,.12);
  box(m.orange,ship,.50,8.14,-6.55,1.0,.43,.055);
  box(m.navy,ship,0,1.65,13.65,1.45,.38,1.03);
  box(m.oil,ship,4.12,.22,5.3,.08,1.13,1.5);
  // Source slick sits outside the game boundary; all playable oil comes from state.
  disc(m.slick,shipRoot,-33,-.06,shipZ+8,6.5,15);
  for(let i=0;i<17;i++){const b=mesh(geo.cylinder,m.orange,shipRoot,-27.1,.1,shipZ-15+i*2,.22,1.75,.22);b.rotation.x=Math.PI/2;box(m.white,shipRoot,-27.1,.24,shipZ-15+i*2,.35,.13,.3);}
  const shipLabel=label('泄漏源 · 围油作业','#ffcf98',12);shipLabel.position.set(-31,10,shipZ);shipRoot.add(shipLabel);

  const penguins=createPenguinFactory();
  const penguin=(options={})=>penguins.createPenguin({quality:'low',...options});
  const penguinSpecies=['adelie','chinstrap','gentoo'];
  const player=penguin({scale:1.3,quality:settings.quality});scene.add(player.root);
  const shadow=disc(m.contact,scene,0,.32,0,1.25,.9);
  const previewChick=penguin({chick:true,scale:.56});scene.add(previewChick.root);
  const wildlife=[];
  const positions=[];for(const ice of WORLD.ice.filter(i=>i.z<180*zScale&&i.type==='ellipse').slice(0,4))positions.push([ice.x,ice.z]);
  positions.push([-8,5]);
  for(const [i,[x,z]]of positions.entries()){const g=chunk(z,5),p=penguin({scale:.68,species:penguinSpecies[i%penguinSpecies.length]});p.root.position.set(x,.31,z);p.root.rotation.y=.6+rand()*4;g.add(p.root);wildlife.push(p);}
  const goal=WORLD.goal;
  const home=chunk(goal.z,25),nest=new THREE.Group();nest.position.set(goal.x,.33,goal.z);home.add(nest);
  for(let i=0;i<20;i++){const a=i/20*Math.PI*2;oval(m.rock,nest,Math.cos(a)*4.5,.12,Math.sin(a)*3.6,.6,.25,.45);}
  const adultSpot=new THREE.Vector3(goal.x-1.65,.31,goal.z-.7);
  const chicks=[penguin({chick:true,scale:.64}),penguin({chick:true,scale:.53})];
  chicks[0].root.position.set(goal.x+1.48,.3,goal.z-1.4);
  chicks[1].root.position.set(goal.x+2.45,.3,goal.z+1.5);
  const chickFeedingHeadings=chicks.map(chick=>{
    home.add(chick.root);
    return Math.atan2(adultSpot.x-chick.root.position.x,adultSpot.z-chick.root.position.z);
  });
  const homeNeighbors=Array.from({length:4},(_,i)=>{
    const neighbor=penguin({scale:.75+rand()*.2,species:penguinSpecies[i%penguinSpecies.length]});
    neighbor.root.position.set(goal.x+(i<2?-1:1)*(7.4+rand()*2),.3,goal.z-3+rand()*14);
    neighbor.root.rotation.y=rand()*6;
    home.add(neighbor.root);
    return neighbor.root;
  });
  const nestLabel=label('你终于回来了','#ffdda7',10);nestLabel.position.set(goal.x,6,goal.z+4);home.add(nestLabel);
  const feedFish=makeFish();
  feedFish.userData.ring.visible=false;
  feedFish.scale.setScalar(.62);
  feedFish.visible=false;
  home.add(feedFish);
  const adultBill=new THREE.Vector3(),chickBill=new THREE.Vector3();

  const fishMeshes=new Map(),oilMeshes=[],rescueMeshes=[],shelterMeshes=[],signalMeshes=[];
  function makeFish(){
    const g=new THREE.Group(),tail=new THREE.Group();g.add(tail);tail.position.z=-.58;
    mesh(geo.fishBody,m.fish,g);
    oval(m.gill,g,0,-.056,.728,.09,.023,.036);
    const dorsal=mesh(geo.cone,m.fin,g,0,.215,-.16,.055,.29,.24);dorsal.rotation.x=-.47;
    for(const side of [-1,1]){
      oval(m.eye,g,side*.23,.065,.42,.053,.06,.057);
      const fluke=mesh(geo.cone,m.fin,tail,side*.145,0,-.21,.14,.31,.052);
      fluke.rotation.set(Math.PI/2,0,-side*.51);
      const fin=oval(m.fin,g,side*.26,-.07,-.04,.16,.034,.24);fin.rotation.y=side*.5;
      const gill=oval(m.gill,g,side*.30,.002,.25,.012,.103,.031);gill.rotation.x=.43;
    }
    const ring=mesh(geo.ring,m.glimmer,g);ring.rotation.x=-Math.PI/2;ring.scale.set(1.3,1.3,.2);
    g.userData={ring,tail};scene.add(g);return g;
  }
  function drawOilPatches(patches,viewZ,firstPerson){
    patches.forEach((patch,index)=>{
      if(!oilMeshes[index]){
        const group=new THREE.Group();scene.add(group);
        const surface=disc(m.waterSlick,group,0,0,0,1,1);
        const rim=mesh(geo.slickRim,m.slickRim,group,0,.012,0);
        const sign=label('油污','#f5d0e0',2.9);sign.position.y=1.5;group.add(sign);
        oilMeshes[index]={group,surface,rim,sign};
      }
      const {group,surface,rim,sign}=oilMeshes[index];
      const distance=Math.abs(patch.z-viewZ);
      group.visible=distance<90;
      if(!group.visible)return;
      group.position.set(patch.x,WATER_LEVEL+.026,patch.z);
      surface.scale.set(patch.rx,patch.rz,1);
      rim.visible=firstPerson;
      rim.scale.set(patch.rx,1,patch.rz);
      sign.visible=firstPerson&&distance>3&&distance<26&&waterClearanceAt(patch.x,patch.z,WORLD);
    });
    for(let index=patches.length;index<oilMeshes.length;index++)oilMeshes[index].group.visible=false;
  }
  function worker(parent,x,z,lookX,lookZ,alternate=false){
    const actor=fieldWorkers.create(alternate?{coat:'#d58238',skin:'#98694f'}:{});
    actor.root.position.set(x,0,z);
    actor.root.rotation.y=Math.atan2(lookX-x,lookZ-z);
    parent.add(actor.root);
    return actor;
  }
  const campSide=camp=>camp.x>=laneAt(camp.z,WORLD).x?1:-1;
  function makeRescue(r){
    const g=chunk(r.z,8);g.position.set(r.x,.3,r.z);
    const hut=new THREE.Group();g.add(hut);
    const side=campSide(r),padX=-side*2.2;
    hut.position.x=side*1.8;
    box(m.navy,hut,0,.16,0,3.5,.26,3.15,true);
    box(m.orange,hut,0,1.04,0,3.12,1.68,2.8,true);
    for(const side of [-1,1]){
      const roof=box(m.white,hut,side*.79,2.06,0,1.92,.14,3.25,true);roof.rotation.z=-side*.48;
      box(m.navy,hut,side*1.57,1.24,-.22,.05,.55,1.16);
      box(m.ice,hut,side*1.60,1.24,-.22,.04,.41,.92);
      box(m.white,hut,side*1.59,1.24,-.22,.05,.045,1.16);
    }
    box(m.navy,hut,0,.94,-1.43,1.02,1.48,.06);box(m.side,hut,.32,.89,-1.48,.06,.15,.06);
    box(m.ice,hut,0,1.28,-1.47,.65,.35,.025);
    box(m.navy,hut,0,.18,-1.65,1.25,.22,.5);
    box(m.side,hut,0,.08,-1.93,1.25,.12,.34);
    box(m.white,hut,0,1.25,1.43,1.13,.22,.04);box(m.white,hut,0,1.25,1.44,.22,.83,.04);
    box(m.navy,hut,-1.06,2.72,.57,.08,1.1,.08);
    box(m.orange,hut,-.73,3.12,.57,.70,.3,.04);
    const supplies=new THREE.Group();supplies.position.set(side*2.12,0,1.58);g.add(supplies);
    box(m.navy,supplies,0,.33,0,1.09,.62,.78,true);
    box(m.side,supplies,0,.65,0,1.12,.12,.81);
    for(const latch of [-1,1]){
      box(m.white,supplies,latch*.28,.58,-.405,.10,.17,.035);
      box(m.navy,supplies,latch*.18,.755,0,.09,.14,.10);
    }
    box(m.navy,supplies,0,.815,0,.4,.065,.10);
    const sign=label(WORLD.mode==='booth'?'救援营地 · 互动':'专业救援 · R','#ffd6a0',8);sign.position.set(0,4.8,0);g.add(sign);
    const used=label('物资已使用','#c2d8d6',8);used.position.copy(sign.position);used.visible=false;g.add(used);
    const staff=[worker(g,padX-side*1.27,-.84,padX,.2),worker(g,padX+side*1.28,-1.3,padX,.2,true)];
    for(const side of [-1,1])box(m.navy,g,padX+side*.68,.19,.20,.14,.38,1.20);
    box(m.side,g,padX,.39,.2,1.87,.20,1.5);
    box(m.white,g,padX,.49,.2,1.69,.08,1.32);
    box(m.orange,g,padX,.535,.65,1.67,.022,.31);
    box(m.white,g,padX,.36,1.57,.81,.69,.71);
    box(m.navy,g,padX,.68,1.57,.85,.08,.74);
    const halo=disc(m.warm,g,padX,.015,.2,2.1,2.1);
    g.userData={sign,used,staff,halo,hut};return g;
  }
  function makeShelter(s){
    const g=chunk(s.z,7);g.position.set(s.x,.3,s.z);
    // Keep the windbreak beside the route so the eye camera can pass the rest area.
    const lane=laneAt(s.z,WORLD),side=s.x>=lane.x?1:-1;
    for(let i=0;i<3;i++)mesh(geo.rock,m.ice,g,side*(2.85+i*.42),1.1,1.3+i*1.3,1.25,2.4,1.05,true);
    disc(m.safe,g,0,.015,0,3.4,2.6);const sign=label('背风处 · 休息','#d0f4e3',8);sign.position.set(0,5.3,1.5);
    sign.visible=!(WORLD.signals||[]).some(friend=>Math.hypot(friend.x-s.x,friend.z-s.z)<8);g.add(sign);return g;
  }
  function makeSignal(s){
    const g=chunk(s.z,10);g.position.set(s.x,.3,s.z);
    const p=penguin({scale:.9,species:s.x<0?'chinstrap':'adelie'});p.setOilOpacity(s.cause==='net'?0:.7);p.root.rotation.y=2.5;g.add(p.root);
    const rope=mesh(geo.ring,m.orange,g,0,.22,0,1.4,1.15,1);rope.rotation.x=-1.25;
    const sign=label(WORLD.mode==='booth'?'受困企鹅 · 互动求助':'发现受困同伴 · F','#ffce9a',11);sign.position.set(0,5.1,0);g.add(sign);
    const done=label('已通知救援人员','#caf1d6',10);done.position.copy(sign.position);done.visible=false;g.add(done);
    const staff=worker(g,2.2,-.8,0,0);staff.root.visible=false;
    const cleaning=disc(m.cleanup,g,0,.025,0,1.5,1.3);cleaning.visible=false;
    const halo=disc(m.warm,g,0,.015,0,3,2.2);g.userData={p,sign,done,staff,halo,cleaning,rope};return g;
  }
  // Reused effects do not allocate geometry during gameplay.
  const wake=new THREE.Group();scene.add(wake);
  const wakeRings=Array.from({length:3},()=>{const o=mesh(geo.ring,m.foam,wake);o.rotation.x=-Math.PI/2;return o;});
  const trails=Array.from({length:48},()=>{const p=disc(m.tracks,scene,0,.305,0,.12,.4);p.visible=false;return p;});
  let trailIndex=0,lastTrailX=-100,lastTrailZ=-100;
  const cleanup=new THREE.Group();scene.add(cleanup);
  for(let i=0;i<14;i++)mesh(geo.small,m.cleanup,cleanup,0,0,0,.08,.08,.08);
  const snowCount=200,snowArray=new Float32Array(snowCount*3);
  for(let i=0;i<snowCount;i++){snowArray[i*3]=(rand()-.5)*64;snowArray[i*3+1]=rand()*20;snowArray[i*3+2]=(rand()-.5)*65;}
  const snowGeo=new THREE.BufferGeometry();snowGeo.setAttribute('position',new THREE.BufferAttribute(snowArray,3));
  const snow=new THREE.Points(snowGeo,new THREE.PointsMaterial({color:'#fffef4',size:.14,transparent:true,opacity:.7,depthWrite:false}));scene.add(snow);
  const currentArrows=[];
  for(let i=0;i<3;i++){
    const g=new THREE.Group();scene.add(g);box(m.foam,g,0,0,0,.13,.03,1.6);
    const tip=mesh(geo.cone,m.foam,g,0,0,1.05,.38,.62,.025);tip.rotation.x=Math.PI/2;currentArrows.push(g);
  }
  const target=new THREE.Vector3(),desired=new THREE.Vector3(),targetColor=new THREE.Color();
  const eyeTarget=new THREE.Vector3(),eyeDirection=new THREE.Vector3(),labelPosition=new THREE.Vector3();
  let t=0,wonTime=0,previousZ=0,smoothHeading=0,firstFrame=true,lastPreview=false,lastSpecies='',halfHeight=21,aspect=1,lastViewHeight=0;
  let lastFirstPerson=false,lastCelebrating=false,eyeHeight=3.05;
  const skyColors=['#b8dfe4','#b2dbe2','#9fbbc5','#c1d9d8','#b5cbd7'];
  const waterColors=['#328b9e','#2d8293','#2b687e','#397d8a','#507588'];
  function setOptions(next={}){
    Object.assign(settings,next);if(!['high','medium','low'].includes(settings.quality))settings.quality='medium';
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,settings.quality==='high'?1.85:settings.quality==='low'?1:1.4));
    renderer.shadowMap.enabled=settings.quality!=='low';
    player.setQuality(settings.quality);
    snow.geometry.setDrawRange(0,settings.quality==='low'?70:settings.quality==='medium'?140:snowCount);
    resize();
  }
  function resize(){
    const w=canvas.clientWidth||window.innerWidth,h=canvas.clientHeight||window.innerHeight;
    renderer.setSize(w,h,false);aspect=w/h;halfHeight=aspect<.9?25:21;lastViewHeight=0;firstFrame=true;
    camera.left=-halfHeight*aspect;camera.right=halfHeight*aspect;camera.top=halfHeight;camera.bottom=-halfHeight;camera.updateProjectionMatrix();
    eyeCamera.aspect=aspect;
    const portraitFov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(Math.PI/6)/aspect));
    eyeCamera.fov=THREE.MathUtils.clamp(portraitFov,65,94);
    eyeCamera.updateProjectionMatrix();
  }
  setOptions(settings);
  function positionEye(state,x,z,sliding,moving,dt){
    const water=state.terrain==='water';
    const height=water?.79:sliding?1.36:3.05;
    const bob=settings.reducedMotion||!moving?0:Math.sin(t*(water?5.5:7))*(sliding?.014:.032);
    eyeHeight=firstFrame||!lastFirstPerson||settings.reducedMotion?height:THREE.MathUtils.lerp(eyeHeight,height,1-Math.exp(-7*dt));
    eyeCamera.position.set(x,eyeHeight+bob,z);
    const yaw=Number.isFinite(state.viewYaw)?state.viewYaw:0;
    const pitch=THREE.MathUtils.clamp(Number.isFinite(state.viewPitch)?state.viewPitch:-.14,-1.49,1.49);
    const horizontal=Math.cos(pitch);
    eyeDirection.set(Math.sin(yaw)*horizontal,Math.sin(pitch),Math.cos(yaw)*horizontal);
    eyeTarget.copy(eyeCamera.position).add(eyeDirection);
    eyeCamera.lookAt(eyeTarget);
  }
  function resizeSceneLabels(firstPerson){
    if(!firstPerson&&!lastFirstPerson)return;
    const viewWidth=2*Math.tan(THREE.MathUtils.degToRad(eyeCamera.fov*.5))*eyeCamera.aspect;
    for(const {sprite,width} of sceneLabels){
      let visibleWidth=width;
      if(firstPerson){
        if(!sprite.visible||sprite.parent?.visible===false)continue;
        sprite.getWorldPosition(labelPosition).sub(eyeCamera.position);
        const depth=labelPosition.dot(eyeDirection);
        if(depth<1.6||depth>30){
          sprite.layers.disable(0);
          continue;
        }
        visibleWidth=Math.min(width,depth*viewWidth*.21);
      }
      sprite.layers.enable(0);
      sprite.scale.set(visibleWidth,visibleWidth*112/512,1);
    }
  }
  function animateHomeFeeding(feeding,won,motion){
    for(const [index,chick] of chicks.entries()){
      const eating=feeding?.recipient===index;
      const reaction=eating?Math.sin(Math.PI*feeding.phase):0;
      const heading=chickFeedingHeadings[index];
      chick.root.rotation.y=heading;
      chick.torso.rotation.x=-reaction*.16;
      chick.root.rotation.z=(Math.sin(t*2+index)*.035+reaction*.055)*motion;
      chick.root.position.y=.3+reaction*.13*motion;
      chick.left.rotation.z=-.25-(won?.15+reaction*.4:0);
      chick.right.rotation.z=.25+(won?.15+reaction*.4:0);
      chick.setBillOpen(reaction*.45);
      if(feeding?.celebrating){
        const elapsed=wonTime-HOME_CELEBRATION_START;
        const beat=elapsed-index*.17;
        const hop=(start,length)=>Math.sin(Math.PI*THREE.MathUtils.clamp((beat-start)/length,0,1));
        const bounce=hop(.17,.48)*.58+hop(.79,.49)*.4;
        const cheer=Math.max(hop(.12,.59),hop(.74,.62),hop(1.54,.48)*.72);
        const faceCamera=Math.atan2(goal.x+11-chick.root.position.x,goal.z-3.6-chick.root.position.z);
        const turn=Math.atan2(Math.sin(faceCamera-heading),Math.cos(faceCamera-heading));
        chick.root.rotation.y=heading+turn*THREE.MathUtils.smoothstep(elapsed,0,.32);
        chick.root.rotation.z=(index===0?1:-1)*(.06+cheer*.12*motion);
        chick.root.position.y=.3+bounce*motion;
        chick.torso.rotation.x=-.14-cheer*.19*motion;
        const flippers=.71+cheer*.53*motion;
        chick.left.rotation.z=-flippers;
        chick.right.rotation.z=flippers;
        chick.setBillOpen(.32+cheer*.63*motion);
      }
    }
    feedFish.visible=feeding?.visible??false;
    if(!feedFish.visible)return;
    player.billTip(adultBill);
    chicks[feeding.recipient].billTip(chickBill);
    const travel=THREE.MathUtils.smoothstep(feeding.phase,.08,FISH_REACHES_CHICK);
    feedFish.position.lerpVectors(adultBill,chickBill,travel);
    feedFish.position.y+=Math.sin(travel*Math.PI)*.43*motion;
    feedFish.rotation.y=Math.atan2(chickBill.x-adultBill.x,chickBill.z-adultBill.z);
    feedFish.userData.tail.rotation.y=Math.sin(t*21)*.25*motion;
  }
  function render(state,delta=.016){
    const dt=Math.max(0,Math.min(.05,Number.isFinite(delta)?delta:0));
    const preview=!!state.preview,won=state.won||state.status==='won',animating=!state.paused||won||preview;
    const firstPerson=state.view==='first'&&!preview&&!won;
    if(animating)t+=dt;
    wonTime=won?(Number.isFinite(state.homeFeedingTime)?state.homeFeedingTime:wonTime+dt):0;
    const feeding=won?homeFeedingProgress(state.food,wonTime):null;
    const celebrating=feeding?.celebrating??false;
    const motion=settings.reducedMotion?0:1,x=state.x||0,z=state.z||0,viewZ=preview?4:z;
    const reset=preview!==lastPreview||Math.abs(z-previousZ)>50;
    if(reset){firstFrame=true;for(const p of trails)p.visible=false;lastTrailX=-100;}
    const species=state.species||'gentoo';if(species!==lastSpecies){player.setSpecies(species);lastSpecies=species;}
    const swim=state.terrain==='water'&&!state.treatment&&!preview&&!won,moving=state.moving&&!state.treatment&&!won&&!preview,sliding=!swim&&state.slide&&moving;
    let heading=preview?2.08:Number.isFinite(state.heading)?state.heading:0;
    if(won){
      const firstOrLast=wonTime<HOME_APPROACH||celebrating?0:Math.max(0,feeding.total-1)%chicks.length;
      const chick=chicks[feeding.recipient>=0?feeding.recipient:firstOrLast];
      const faceChick=Math.atan2(chick.root.position.x-adultSpot.x,chick.root.position.z-adultSpot.z);
      const approach=Math.hypot(x-adultSpot.x,z-adultSpot.z)>.2?Math.atan2(adultSpot.x-x,adultSpot.z-z):faceChick;
      const turn=Math.atan2(Math.sin(faceChick-approach),Math.cos(faceChick-approach));
      heading=approach+turn*THREE.MathUtils.smoothstep(wonTime,.65,HOME_APPROACH);
    }
    if(state.treatment)heading=2.6;
    const angle=Math.atan2(Math.sin(heading-smoothHeading),Math.cos(heading-smoothHeading));smoothHeading+=angle*Math.min(1,dt*12);
    if(firstFrame||won&&dt===0)smoothHeading=heading;
    player.root.visible=!firstPerson;
    player.root.scale.setScalar(preview?2.25:1.25);
    player.root.position.set(preview?0:x,swim?.1+Math.sin(t*3)*.05*motion:.31,preview?4:z);
    if(state.treatment){const camp=state.rescues[state.treatment.campIndex];if(camp)player.root.position.set(camp.x-campSide(camp)*2.2,.61,camp.z+.2);}
    if(won){
      player.root.position.lerp(adultSpot,THREE.MathUtils.smoothstep(wonTime,0,HOME_APPROACH));
    }
    player.root.rotation.y=smoothHeading;
    const feedBend=feeding?.recipient>=0?Math.sin(Math.PI*feeding.phase)*.17:0;
    const tilt=swim||sliding?Math.PI/2:celebrating?.09:feedBend;
    const tiltBlend=won&&dt===0?1:Math.min(1,dt*12);
    player.torso.rotation.x+=(tilt-player.torso.rotation.x)*tiltBlend;
    player.torso.position.z=swim||sliding?-1:0;
    const cold=Math.max(0,(65-(state.insulation??100))/65)*.045+Math.max(0,(35-(state.temperature??100))/35)*.04;
    player.torso.rotation.z=(moving&&!swim&&!sliding?Math.sin(t*10)*.08:0)*motion+Math.sin(t*43)*cold*motion;
    player.torso.position.y=swim||sliding?.2:(moving?Math.abs(Math.sin(t*10))*.07:Math.sin(t*2)*.018)*motion;
    player.left.rotation.z=-.3-(swim?.7+Math.sin(t*9)*.45*motion:moving?Math.sin(t*10)*.2*motion:0);
    player.right.rotation.z=.3+(swim?.7+Math.sin(t*9)*.45*motion:moving?Math.sin(t*10)*.2*motion:0);
    const walking=(moving&&!swim&&!sliding)||(won&&wonTime<HOME_APPROACH);
    player.feet.forEach((f,i)=>f.rotation.x=walking?Math.sin(t*(won?13:10)+i*Math.PI)*.4*motion:0);
    player.setOilOpacity(preview?0:Math.min(.93,(state.oil||0)/85));
    shadow.position.set(player.root.position.x,.315,player.root.position.z);shadow.visible=!swim&&!firstPerson;shadow.scale.set(preview?2.4:1.3,preview?1.6:sliding?1.6:.85,1);
    previewChick.root.visible=preview;previewChick.root.position.set(-3.5,.31,5);previewChick.root.rotation.y=2.4;previewChick.torso.rotation.z=Math.sin(t*2)*.05*motion;
    for(const p of wildlife){p.torso.rotation.z=Math.sin(t*1.7+p.root.position.z)*.045*motion;p.left.rotation.z=-.25+Math.sin(t*2)*.12*motion;}
    wake.position.set(x,-.02,z);wake.visible=swim&&moving;
    for(let i=0;i<wakeRings.length;i++){const o=wakeRings[i],a=(t*.8+i/3)%1;o.scale.set(.6+a*2,.45+a*1.5,.1);o.position.y=i*.003;}
    if(moving&&!swim&&Math.hypot(x-lastTrailX,z-lastTrailZ)>.68){
      for(const side of [-1,1]){const p=trails[trailIndex++%trails.length];p.position.set(x+Math.cos(smoothHeading)*side*.3,.305,z-Math.sin(smoothHeading)*side*.3);p.rotation.set(-Math.PI/2,0,-smoothHeading);p.scale.set(sliding?.1:.16,sliding?.6:.23,1);p.visible=true;}lastTrailX=x;lastTrailZ=z;
    }
    for(const p of trails)if(Math.abs(p.position.z-viewZ)>48)p.visible=false;
    cleanup.visible=!!state.treatment;cleanup.position.copy(player.root.position);
    if(cleanup.visible)cleanup.children.forEach((p,i)=>{const a=t*2.3+i*2.4;p.position.set(Math.cos(a)*(1+i%3*.18),.4+((t*.6+i*.17)%1.8),Math.sin(a)*1.1);});
    for(const f of state.fish||[]){
      if(!fishMeshes.has(f.id))fishMeshes.set(f.id,makeFish());const g=fishMeshes.get(f.id);
      g.visible=f.active!==false&&Math.abs(f.z-viewZ)<80&&waterClearanceAt(f.x,f.z,WORLD,FISH_CLEARANCE);
      if(!g.visible)continue;
      const height=WATER_LEVEL+(f.polluted?-.11:.075+Math.sin(t*4+f.id)*.06*motion);
      g.position.set(f.x,height,f.z);
      g.rotation.y=(f.heading??0)+Math.sin(t*5+f.id)*.1*motion;
      g.scale.setScalar(f.polluted?.65:1);
      g.userData.ring.visible=!f.polluted;g.userData.ring.position.y=WATER_LEVEL+.05-height;
      g.userData.tail.rotation.y=Math.sin(t*10.5+f.id)*.46*motion;
    }
    drawOilPatches(state.oilPatches||[],viewZ,firstPerson);
    (state.rescues||[]).forEach((r,i)=>{
      if(!rescueMeshes[i])rescueMeshes[i]=makeRescue(r);
      const d=rescueMeshes[i].userData,treating=state.treatment?.campIndex===i;
      d.sign.visible=!r.used||treating;d.used.visible=r.used&&!treating;d.halo.visible=!r.used||treating;
      d.staff.forEach((actor,index)=>actor.pose({kind:treating?(index===0?'kneel':'treat'):'idle',time:t,motion,phase:index*1.8}));
      const insideHut=Math.abs(x-r.x-d.hut.position.x)<1.84&&Math.abs(z-r.z)<1.71;
      d.hut.visible=!firstPerson||!insideHut;
    });
    (state.shelters||[]).forEach((s,i)=>{if(!shelterMeshes[i])shelterMeshes[i]=makeShelter(s);});
    (state.signals||[]).forEach((s,i)=>{
      if(!signalMeshes[i])signalMeshes[i]=makeSignal(s);const d=signalMeshes[i].userData;
      const progress=s.reported?(s.careProgress??1):0,working=s.reported&&progress<1;
      d.sign.visible=!s.reported;d.done.visible=!!s.reported;d.staff.root.visible=!!s.reported;d.halo.visible=!s.reported;
      d.p.setOilOpacity(s.cause==='net'?0:.7*(1-progress));d.rope.visible=s.cause==='net'&&progress<1;
      d.p.torso.rotation.z=Math.sin(t*35+i)*.045*(1-progress)*motion;
      if(s.reported){
        d.staff.root.position.x=working?1.5:2.2;
        d.staff.root.rotation.y=Math.atan2(-d.staff.root.position.x,.8);
        d.staff.pose({kind:working?'kneel':'idle',time:t,motion,phase:i*1.9});
      }
      d.cleaning.visible=working;d.cleaning.scale.setScalar(1+Math.sin(t*5)*.12*motion);
    });
    for(const {g,z:cz,span}of roots)g.visible=Math.abs(cz-viewZ)<span+(settings.quality==='low'?68:90);
    animateHazards(state,viewZ,t,motion,firstPerson);
    const late=state.stage===4&&!preview,wind=state.wind||0;snow.visible=late&&!won&&!settings.reducedMotion;snow.position.set(x,0,z);
    if(snow.visible){snow.material.opacity=.24+wind*.5;for(let i=0;i<snowCount;i++){snowArray[i*3]+=dt*(3+wind*16);if(snowArray[i*3]>32)snowArray[i*3]=-32;snowArray[i*3+1]-=dt*(1.4+wind*2);if(snowArray[i*3+1]<0)snowArray[i*3+1]=20;}snowGeo.attributes.position.needsUpdate=true;}
    const stage=preview?0:Math.max(0,Math.min(4,state.stage||0));targetColor.set(skyColors[stage]);scene.background.lerp(targetColor,Math.min(1,dt*1.2));scene.fog.color.copy(scene.background);
    targetColor.set(waterColors[stage]);m.water.color.lerp(targetColor,firstFrame?1:Math.min(1,dt*1.3));
    if(motion&&animating){
      seaTexture.offset.x=(seaTexture.offset.x-(state.current?.x??.45)*dt*.022)%1;
      seaTexture.offset.y=(seaTexture.offset.y+(state.current?.z??.15)*dt*.022)%1;
    }
    currentArrows.forEach((g,i)=>{g.visible=(stage===2||stage===3)&&!preview;g.position.set(-10+i*10,.045,z+8+i*2);g.rotation.y=Math.atan2(state.current?.x||0,state.current?.z||.001);});
    nestLabel.visible=!won;
    for(const neighbor of homeNeighbors)neighbor.visible=!celebrating;
    animateHomeFeeding(feeding,won,motion);
    const narrow=canvas.clientWidth<560,cameraOffset=preview?PREVIEW_CAMERA_OFFSET:CAMERA_OFFSET;
    if(celebrating){target.set(goal.x+1.3,1.32,goal.z+.12);desired.set(goal.x+11,4.4,goal.z-3.6);}
    else if(won){target.set(goal.x+.4,1.35,goal.z+.25);desired.set(goal.x+19,17,goal.z-24);}
    else{target.set(preview?(narrow?12:10):x,0,preview?(narrow?-3:9):z+9);desired.set(target.x+cameraOffset.x,target.y+cameraOffset.y,target.z+cameraOffset.z);}
    const desiredHeight=celebrating?(narrow?5.8:4.8):won?(narrow?10.4:8.3):preview&&!narrow&&aspect>=.95?halfHeight*.81:halfHeight;
    const cut=firstFrame||lastCelebrating!==celebrating||settings.reducedMotion;
    const viewHeight=lastViewHeight&&!cut?THREE.MathUtils.lerp(lastViewHeight,desiredHeight,Math.min(1,dt*3)):desiredHeight;
    if(Math.abs(viewHeight-lastViewHeight)>.001||!lastViewHeight){camera.left=-viewHeight*aspect;camera.right=viewHeight*aspect;camera.top=viewHeight;camera.bottom=-viewHeight;camera.updateProjectionMatrix();lastViewHeight=viewHeight;}
    if(cut)camera.position.copy(desired);else camera.position.lerp(desired,Math.min(1,dt*5));
    if(won)camera.lookAt(target);else camera.lookAt(camera.position.x-cameraOffset.x,camera.position.y-cameraOffset.y,camera.position.z-cameraOffset.z);
    if(firstPerson)positionEye(state,x,z,sliding,moving,dt);
    resizeSceneLabels(firstPerson);
    sun.position.set(player.root.position.x-25,55,player.root.position.z-35);sun.target.position.copy(player.root.position);
    firstFrame=false;previousZ=z;lastPreview=preview;lastFirstPerson=firstPerson;lastCelebrating=celebrating;
    renderer.render(scene,firstPerson?eyeCamera:camera);
  }
  function dispose(){
    const disposed=new Set();
    function release(resource){if(resource&&!disposed.has(resource)){resource.dispose();disposed.add(resource);}}
    function releaseMaterial(mat){release(mat?.map);release(mat);}
    scene.traverse(o=>{
      release(o.geometry);
      if(Array.isArray(o.material))o.material.forEach(releaseMaterial);else releaseMaterial(o.material);
    });
    for(const g of Object.values(geo))release(g);
    for(const mat of Object.values(m))releaseMaterial(mat);
    penguins.dispose(disposed);sun.shadow.map?.dispose();renderer.dispose();
  }
  const getStats=()=>({draws:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,quality:settings.quality,visibleChunks:roots.filter(c=>c.g.visible).length,totalChunks:roots.length});
  return {render,resize,setOptions,setLanguage,getStats,dispose};
}

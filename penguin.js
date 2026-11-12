import * as THREE from './vendor/three.module.js';

// The profiles describe height, half-width, half-depth and forward offset.
// Body, neck and head share one surface, with the markings following its curvature.
const speciesModels = {
  gentoo: {
    profile: [[.13,.002,.002,0],[.25,.38,.35,-.06],[.52,.66,.57,-.05],[.88,.79,.66,-.02],[1.17,.80,.67,0],[1.45,.72,.62,.02],[1.7,.59,.53,.04],[1.9,.49,.45,.08],[2.04,.49,.46,.10],[2.22,.59,.52,.11],[2.42,.60,.53,.10],[2.59,.49,.45,.08],[2.73,.29,.29,.07],[2.80,.002,.002,.06]],
    coat:'#182932', shoulder:'#334750', belly:'#f5efe2', eyeY:2.398, eyeAngle:.93, iris:'#643a2c', eyeSize:.082,
    bill:[2.252,.565,.55,.155,.11,'#dc542b','#9a3020','#ff9c56'],
    flipper:[.70,1.735,1.42,.34,.135], foot:[.325,1.06,'#e69548','#95674e'], tail:1.24,
    bellyMark:[1.035,.865,1.4],
  },
  adelie: {
    profile: [[.12,.002,.002,0],[.24,.40,.36,-.06],[.46,.66,.57,-.05],[.76,.78,.65,-.025],[1.06,.79,.65,0],[1.34,.71,.61,.018],[1.55,.56,.53,.03],[1.71,.48,.46,.06],[1.83,.50,.48,.075],[2.01,.58,.51,.09],[2.18,.57,.50,.077],[2.34,.42,.40,.06],[2.46,.22,.23,.052],[2.50,.002,.002,.04]],
    coat:'#17242e', shoulder:'#344654', belly:'#f5f1e8', eyeY:2.177, eyeAngle:.85, iris:'#4a3228', eyeSize:.085,
    bill:[2.017,.517,.33,.132,.093,'#31383e','#22272b','#6e6760'],
    flipper:[.695,1.565,1.24,.292,.129], foot:[.313,.94,'#d49184','#635056'], tail:.93,
    bellyMark:[.939,.77,1.45],
  },
  chinstrap: {
    profile: [[.12,.002,.002,0],[.23,.34,.32,-.055],[.45,.54,.49,-.05],[.74,.66,.56,-.022],[1.04,.68,.58,0],[1.33,.64,.55,.018],[1.58,.54,.48,.047],[1.79,.43,.405,.075],[1.94,.435,.42,.107],[2.10,.50,.46,.13],[2.27,.525,.465,.12],[2.43,.46,.42,.105],[2.57,.29,.29,.083],[2.64,.002,.002,.062]],
    coat:'#1d303b', shoulder:'#3a4f59', belly:'#fbf5e7', eyeY:2.298, eyeAngle:.93, iris:'#733e32', eyeSize:.077,
    bill:[2.142,.515,.41,.13,.085,'#242d35','#16212a','#626d70'],
    flipper:[.591,1.633,1.39,.277,.104], foot:[.279,.90,'#ce9188','#53424a'], tail:1.12,
    bellyMark:[.981,.82,1.44],
  },
  chick: {
    profile: [[.13,.002,.002,0],[.25,.40,.37,-.06],[.50,.61,.54,-.035],[.86,.72,.60,0],[1.18,.71,.59,.02],[1.47,.61,.53,.04],[1.67,.54,.49,.075],[1.82,.56,.51,.107],[2.04,.62,.55,.117],[2.24,.56,.51,.104],[2.41,.36,.37,.077],[2.50,.002,.002,.062]],
    coat:'#7a8890', shoulder:'#a1afb2', belly:'#dedbd3', eyeY:2.155, eyeAngle:.82, iris:'#3d352f', eyeSize:.10,
    bill:[1.981,.60,.26,.131,.083,'#59616a','#393b42','#86858a'],
    flipper:[.62,1.47,.97,.26,.145], foot:[.29,.73,'#786669','#4b4247'], tail:.65,
    bellyMark:[.97,.79,1.38],
  },
};

const detail = {low:[34,44], medium:[56,64], high:[76,84]};
const forward = new THREE.Vector3(0,0,1);
const tau = 2*Math.PI;
const lerp = THREE.MathUtils.lerp;
const smooth = (value,low,high) => THREE.MathUtils.smoothstep(value,low,high);
const color = hex => new THREE.Color(hex);
const white = color('#fff7e3');
const black = color('#101a24');
const pigment = color('#31323e');
const rgba = (c,a=1) => [c.r,c.g,c.b,a];

function profileSampler(sections){
  const slopes=sections.map((section,index)=>section.slice(1).map((_,axis)=>{
    const i=axis+1,prev=sections[index-1],next=sections[index+1];
    const left=prev?(section[i]-prev[i])/(section[0]-prev[0]):null;
    const right=next?(next[i]-section[i])/(next[0]-section[0]):null;
    return left===null?right:right===null?left:left*right<=0?0:2*left*right/(left+right);
  }));
  return y=>{
    let i=0;
    while(i<sections.length-2&&y>sections[i+1][0])i++;
    const a=sections[i],b=sections[i+1],span=b[0]-a[0];
    const t=THREE.MathUtils.clamp((y-a[0])/span,0,1),t2=t*t,t3=t2*t;
    return a.slice(1).map((value,j)=>(2*t3-3*t2+1)*value+(t3-2*t2+t)*span*slopes[i][j]+(-2*t3+3*t2)*b[j+1]+(t3-t2)*span*slopes[i+1][j]);
  };
}

function surface(rows, columns, sample, {wrap=true, reverse=false}={}){
  const positions=[],colors=[],indices=[],count=columns+(wrap?0:1);
  for(let row=0;row<=rows;row++){
    for(let column=0;column<count;column++){
      const [x,y,z,paint]=sample(row/rows,column/columns);
      positions.push(x,y,z);
      colors.push(...paint);
      if(row===rows||column===columns)continue;
      const a=row*count+column,b=row*count+(column+1)%count,c=a+count,d=b+count;
      if(reverse)indices.push(a,c,b,b,c,d);
      else indices.push(a,b,c,b,d,c);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function merge(parts){
  const position=[],normal=[],paint=[],indices=[];
  for(const geometry of parts){
    const offset=position.length/3;
    position.push(...geometry.attributes.position.array);
    normal.push(...geometry.attributes.normal.array);
    paint.push(...geometry.attributes.color.array);
    for(const index of geometry.index.array)indices.push(index+offset);
    geometry.dispose();
  }
  const combined=new THREE.BufferGeometry();
  combined.setAttribute('position',new THREE.Float32BufferAttribute(position,3));
  combined.setAttribute('normal',new THREE.Float32BufferAttribute(normal,3));
  combined.setAttribute('color',new THREE.Float32BufferAttribute(paint,4));
  combined.setIndex(indices);
  combined.computeBoundingSphere();
  return combined;
}

function ellipsoid(size, location, paint, orientation, segments=10){
  const geometry=new THREE.SphereGeometry(1,segments,7);
  geometry.scale(...size);
  if(orientation)geometry.applyQuaternion(orientation);
  geometry.translate(...location);
  const data=[];
  for(let i=0;i<geometry.attributes.position.count;i++)data.push(...paint);
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(data,4));
  return geometry;
}

function bodySurface(model){
  const profile=profileSampler(model.profile);
  return (y,angle,offset=0)=>{
    const [width,depth,forwardOffset]=profile(y);
    const grain=Math.sin(38*y+Math.cos(angle*19)*.75)*.0022*Math.min(1,width*12);
    return [Math.sin(angle)*(width+offset+grain),y,forwardOffset+Math.cos(angle)*(depth+offset+grain)];
  };
}

function buildBody(model,name,point,rows,sides){
  const dark=color(model.coat),light=color(model.shoulder),belly=color(model.belly),down=color('#4d5a65'),mix=new THREE.Color();
  const [mid,vertical,angular]=model.bellyMark;
  const min=model.profile[0][0],max=model.profile.at(-1)[0];
  return surface(rows,sides,(v,u)=>{
    const y=lerp(min,max,v),angle=(u-.5)*tau,side=Math.abs(angle);
    const grain=.94+.05*Math.cos(38*y+Math.cos(angle*19)*.75)+.025*Math.sin(y*101+angle*37);
    const bib=smooth(1-((y-mid)/vertical)**2-(side/angular)**2,-.065,.055);
    const face=name==='chinstrap'
      ? smooth(y,1.55+side*.10,1.68+side*.10)*(1-smooth(y,2.19+.17*Math.sin(side),2.235+.17*Math.sin(side)))*(1-smooth(side,1.76,1.93))
      : name==='chick'?smooth(1-((y-2.03)/.36)**2-(side/1.32)**2,-.06,.11):0;
    mix.copy(dark).lerp(light,.21+.28*Math.sin(side)**2+.16*smooth(y,.9,2.2));
    if(name==='chick')mix.lerp(down,smooth(y,1.93,2.47)*.58);
    mix.lerp(belly,Math.max(bib,face)).multiplyScalar(grain);
    return [...point(y,angle),rgba(mix)];
  });
}

// Ribbons and rings use the same body profile as the skin and sit just above it.
function headRibbon(point, width, top, bottom, paint){
  return surface(5,48,(v,u)=>{
    const angle=(2*u-1)*width,y=lerp(bottom(Math.abs(angle)),top(Math.abs(angle)),v);
    return [...point(y,angle,.006),paint];
  },{wrap:false});
}

function headMarkings(model,name,point){
  if(name==='gentoo'){
    const band=a=>2.658-.247*smooth(a,.06,1.25)+.030*smooth(a,1.26,1.75);
    const half=a=>(.054+.078*smooth(a,.16,1.10))*(1-.95*smooth(a,1.45,1.94));
    return [headRibbon(point,1.94,a=>band(a)+half(a),a=>band(a)-half(a),rgba(white))];
  }
  if(name==='chinstrap'){
    const band=a=>1.957+.223*(a/1.86)**1.5;
    return [headRibbon(point,1.86,a=>band(a)+.029,a=>band(a)-.027,rgba(black))];
  }
  if(name==='adelie')return [-1,1].map(side=>surface(4,32,(v,u)=>{
    const a=u*tau;
    return [...point(model.eyeY+Math.sin(a)*lerp(.075,.120,v),side*model.eyeAngle+Math.cos(a)*lerp(.160,.246,v),.007),rgba(white)];
  },{reverse:true}));
  return [];
}

function buildEyes(model,point){
  const iris=color(model.iris),dark=color('#060e13'),glint=rgba(color('#fffbeb'));
  const parts=[];
  for(const side of [-1,1]){
    const angle=side*model.eyeAngle,y=model.eyeY;
    const across=new THREE.Vector3(...point(y,angle+.018)).sub(new THREE.Vector3(...point(y,angle-.018)));
    const up=new THREE.Vector3(...point(y+.018,angle)).sub(new THREE.Vector3(...point(y-.018,angle)));
    const normal=across.cross(up).normalize();
    const orientation=new THREE.Quaternion().setFromUnitVectors(forward,normal);
    const base=new THREE.Vector3(...point(y,angle,-.018));
    const local=(x,y,z)=>new THREE.Vector3(x,y,z).applyQuaternion(orientation).add(base).toArray();
    const size=model.eyeSize;
    parts.push(ellipsoid([size*1.19,size*1.08,size*.43],base.toArray(),rgba(black),orientation));
    parts.push(ellipsoid([size*.89,size*.86,size*.36],local(0,0,size*.15),rgba(iris),orientation));
    parts.push(ellipsoid([size*.53,size*.59,size*.13],local(-.003,0,size*.42),rgba(dark),orientation));
    parts.push(ellipsoid([size*.20,size*.20,size*.07],local(-size*.22,size*.27,size*.49),glint,orientation));
  }
  return merge(parts);
}

function buildBill(model,part='both'){
  const [baseY,baseZ,length,baseWidth,depth,upper,lower,ridge]=model.bill;
  const top=color(upper),bottom=color(lower),highlight=color(ridge),shade=new THREE.Color();
  const shell=isUpper=>surface(14,20,(v,u)=>{
    const a=u*tau,width=baseWidth*(.90+.29*Math.sin(Math.PI*v))*(1-v)**.64+.002;
    const thickness=depth*(isUpper?1:.63)*(1-v)**.61+.001;
    const join=baseY-.078*v*v;
    const y=join+(isUpper?1:-1)*(thickness+.006)+Math.cos(a)*thickness;
    shade.copy(isUpper?top:bottom).lerp(highlight,.35*smooth(Math.cos(a),.15,1)*(1-v*.7));
    shade.multiplyScalar(.95+.07*Math.sin(Math.PI*v));
    return [Math.sin(a)*width,y,baseZ+length*v,rgba(shade)];
  },{reverse:true});
  if(part==='lower')return shell(false).translate(0,-baseY,-baseZ);
  const parts=[shell(true)];
  if(part==='both')parts.push(shell(false));
  for(const side of [-1,1]){
    const slot=ellipsoid([.014,.015,length*.084],[side*baseWidth*.90,baseY+depth*1.20,baseZ+length*.22],rgba(bottom));
    parts.push(slot);
  }
  return merge(parts);
}

function buildTail(model){
  const dark=color(model.coat),edges=color(model.shoulder),shade=new THREE.Color();
  return [-2,-1,0,1,2].map(index=>surface(9,12,(v,u)=>{
    const a=tau*u,width=(.083-.014*Math.abs(index))*Math.sin(Math.PI*(.11+v*.88));
    shade.copy(dark).lerp(edges,.34*Math.max(0,Math.cos(a))).multiplyScalar(.91+.11*(1-v));
    return [index*(.055+v*.018)+Math.sin(a)*width,.39-.18*v+Math.cos(a)*width*.73,-.51-(model.tail-.51-Math.abs(index)*.055)*v,rgba(shade)];
  }));
}

const wingProfile=profileSampler([[0,.04,.12,-.078],[.10,.095,.68,-.019],[.24,.126,.98,.071],[.4,.111,1,.158],[.63,.088,.82,.216],[.83,.052,.54,.248],[1,.008,.028,.248]]);
function wingPoint(model,side,t,a,offset=0){
  const [, ,length,chord,thickness]=model.flipper;
  const [width,outline,curve]=wingProfile(t);
  const relief=Math.sin(19*Math.sin(a)+3*t)*.0035*smooth(t,.15,.9);
  return [side*(curve+Math.cos(a)*(width*thickness/.126+offset+relief)),-t*length,.035+.09*Math.sin(t*3)-.32*t*t+Math.sin(a)*(outline*chord+offset)];
}

function buildWing(model,name,side){
  const dark=color(model.coat),edge=color(model.shoulder),light=color(model.belly),shade=new THREE.Color();
  return surface(18,20,(t,u)=>{
    const a=tau*u,inside=1-smooth(Math.cos(a),-.70,name==='chinstrap'?.04:-.19);
    shade.copy(dark).lerp(edge,.30+.26*Math.sin(a)**2).lerp(light,inside*(name==='chick'?.62:.91));
    shade.multiplyScalar(.96+.042*Math.cos(19*Math.sin(a)+3*t));
    return [...wingPoint(model,side,t,a),rgba(shade)];
  },{reverse:side<0});
}

const footOutline=new THREE.CatmullRomCurve3([
  [-.14,-.18],[-.224,.005],[-.244,.20],[-.294,.365],[-.253,.463],[-.17,.435],[-.111,.397],[-.063,.495],[-.005,.548],[.065,.527],[.104,.444],[.15,.395],[.23,.458],[.28,.421],[.258,.311],[.215,.14],[.20,-.02],[.125,-.182],[0,-.222],
].map(([x,z])=>new THREE.Vector3(x,0,z)),true,'catmullrom',.22);

function buildFoot(model){
  const [,scale,tone,sole]=model.foot,skin=color(tone),shadow=color(sole),shade=new THREE.Color();
  const levels=[[.002,-.052],[.79,-.051],[1,-.018],[.99,.016],[.82,.061],[.53,.082],[.002,.090]];
  const web=surface(levels.length-1,44,(v,u)=>{
    const [width,y]=levels[Math.round(v*(levels.length-1))],edge=footOutline.getPointAt(u);
    shade.copy(shadow).lerp(skin,smooth(y,-.048,.07)).multiplyScalar(.95+.07*Math.cos(edge.x*22));
    return [edge.x*width*scale,y*scale,(.08+(edge.z-.08)*width)*scale,rgba(shade)];
  });
  const ankle=ellipsoid([.127*scale,.145*scale,.135*scale],[0,.128*scale,-.036*scale],rgba(skin.clone().lerp(shadow,.22)));
  const parts=[web,ankle];
  for(const [x,z] of [[-.245,.451],[.013,.540],[.239,.448]]){
    parts.push(ellipsoid([.025*scale,.026*scale,.062*scale],[x*scale,.016*scale,(z+.02)*scale],rgba(shadow)));
    parts.push(ellipsoid([.042*scale,.016*scale,.116*scale],[x*.70*scale,.063*scale,(z-.19)*scale],rgba(skin.clone().multiplyScalar(1.06))));
  }
  return merge(parts);
}

function stain(point,center,width,height,phase,reverse=true){
  return surface(9,30,(r,u)=>{
    const a=tau*u,shape=.84+.10*Math.sin(a*3+phase)+.068*Math.cos(a*5+phase)+.042*Math.sin(a*9+phase*.8);
    const x=center[0]+(Math.cos(a)+.24*Math.sin(a))*width*r*shape,y=center[1]+Math.sin(a)*height*r*shape;
    const sheen=.79+.11*Math.sin(y*43+2*Math.sin(x*19)+phase)+.10*Math.cos(13*x+8*y+phase);
    const edge=.76+.06*Math.cos(3*a+phase);
    return [...point(x,y),rgba(pigment.clone().multiplyScalar(sheen),(1-smooth(r,edge,1))*(.94+.05*Math.sin(y*29+x*17+phase)))];
  },{reverse});
}

function buildOil(point,model){
  const skin=(a,y)=>point(y,a,.016);
  const body=merge([
    stain(skin,[-.34,.98],.32,.47,1),stain(skin,[.39,1.30],.38,.29,2),
    stain(skin,[1.02,.69],.39,.35,3),stain(skin,[.07,.53],.37,.21,5),
    stain(skin,[-1.09,.81],.34,.36,4),
    stain(skin,[2.73,.83],.53,.40,5),stain(skin,[2.08,1.3],.33,.27,4),
  ]);
  const wings=[-1,1].map(side=>{
    const onWing=(a,t)=>wingPoint(model,side,t,a,.017);
    return merge([stain(onWing,[1.73,.54],.96,.36,side+2,side>0),stain(onWing,[4.9,.47],.66,.29,side+4,side>0)]);
  });
  return [body,...wings];
}

function buildModel(name,quality){
  const model=speciesModels[name],point=bodySurface(model),[rows,sides]=detail[quality];
  const [x,y]=model.flipper;
  const [foot]=model.foot;
  return {
    body:merge([buildBody(model,name,point,rows,sides),...headMarkings(model,name,point),...buildTail(model)]),
    bill:buildBill(model,name==='chick'?'upper':'both'),
    lowerBill:name==='chick'?buildBill(model,'lower'):null,eyes:buildEyes(model,point),
    wings:[buildWing(model,name,-1),buildWing(model,name,1)],feet:buildFoot(model),oil:buildOil(point,model),
    wingPosition:[x-.084,y,-.055],footPosition:[foot,.058,.17],
  };
}

export function createPenguinFactory(){
  const cached=new Map(),stains=new Set();
  const feathers=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.69});
  const keratin=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.44});
  const eyes=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.19});
  const materials=[feathers,keratin,eyes];
  function template(name,quality){
    const key=`${name}:${quality}`;
    if(!cached.has(key))cached.set(key,buildModel(name,quality));
    return cached.get(key);
  }
  function createPenguin({species='gentoo',scale=1,chick=false,quality='medium'}={}){
    const root=new THREE.Group(),torso=new THREE.Group(),left=new THREE.Group(),right=new THREE.Group();
    root.add(torso);root.scale.setScalar(scale);torso.add(left,right);
    left.rotation.z=-.29;right.rotation.z=.29;
    const feet=[new THREE.Group(),new THREE.Group()];torso.add(...feet);
    const stainMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.28,metalness:.13,transparent:true,opacity:0,visible:false,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2});
    stains.add(stainMat);
    let name=chick?'chick':Object.hasOwn(speciesModels,species)&&species!=='chick'?species:'gentoo';
    let level=Object.hasOwn(detail,quality)?quality:'medium';
    const first=template(name,level);
    const makeMesh=(geometry,material,parent,shadow=true)=>{
      const mesh=new THREE.Mesh(geometry,material);
      mesh.castShadow=shadow;mesh.receiveShadow=true;parent.add(mesh);return mesh;
    };
    const body=makeMesh(first.body,feathers,torso),bill=makeMesh(first.bill,keratin,torso),ocular=makeMesh(first.eyes,eyes,torso,false);
    const jaw=first.lowerBill?makeMesh(first.lowerBill,keratin,torso):null;
    if(jaw)jaw.position.set(0,speciesModels.chick.bill[0],speciesModels.chick.bill[1]);
    const wings=[makeMesh(first.wings[0],feathers,left),makeMesh(first.wings[1],feathers,right)];
    const pads=feet.map(foot=>makeMesh(first.feet,keratin,foot));
    const oil=first.oil.map((geometry,index)=>makeMesh(geometry,stainMat,[torso,left,right][index],false));
    function applyModel(model){
      body.geometry=model.body;bill.geometry=model.bill;ocular.geometry=model.eyes;
      if(jaw)jaw.geometry=model.lowerBill;
      const [x,y,z]=model.wingPosition,[fx,fy,fz]=model.footPosition;
      left.position.set(-x,y,z);right.position.set(x,y,z);
      for(let i=0;i<2;i++){
        const side=i?1:-1;
        wings[i].geometry=model.wings[i];pads[i].geometry=model.feet;
        feet[i].position.set(side*fx,fy,fz);feet[i].rotation.y=side*.12;
      }
      oil.forEach((mesh,i)=>{mesh.geometry=model.oil[i];});
    }
    applyModel(first);
    return {
      root,torso,left,right,feet,stainMat,
      billTip(target){
        const [baseY,baseZ,length]=speciesModels[name].bill;
        return torso.localToWorld(target.set(0,baseY-.078,baseZ+length));
      },
      setBillOpen(amount){
        if(jaw)jaw.rotation.x=THREE.MathUtils.clamp(amount,0,1)*.64;
      },
      setSpecies(next){
        if(chick||next===name||next==='chick'||!Object.hasOwn(speciesModels,next))return;
        name=next;applyModel(template(name,level));
      },
      setQuality(next){
        if(next===level||!Object.hasOwn(detail,next))return;
        level=next;applyModel(template(name,level));
      },
      setOilOpacity(value){
        stainMat.opacity=THREE.MathUtils.clamp(Number.isFinite(value)?value:0,0,1);
        stainMat.visible=stainMat.opacity>.001;
      },
    };
  }
  function dispose(disposed=new Set()){
    for(const {body,bill,lowerBill,eyes,wings,feet,oil} of cached.values()){
      for(const geometry of [body,bill,lowerBill,eyes,...wings,feet,...oil])if(geometry&&!disposed.has(geometry)){
        disposed.add(geometry);geometry.dispose();
      }
    }
    for(const material of [...materials,...stains])if(!disposed.has(material)){
      disposed.add(material);material.dispose();
    }
    cached.clear();stains.clear();
  }
  return {createPenguin,dispose};
}

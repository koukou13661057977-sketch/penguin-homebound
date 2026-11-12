import * as THREE from './vendor/three.module.js';

// Each joint carries one colored mesh, so gear details share the same draw call.
export function createFieldWorkerFactory(){
 const shape={
  box:new THREE.BoxGeometry(1,1,1).toNonIndexed(),
  round:new THREE.SphereGeometry(1,10,7).toNonIndexed(),
  tube:new THREE.CylinderGeometry(1,1,1,10).toNonIndexed(),
  jacket:new THREE.CylinderGeometry(1,.85,1,10).toNonIndexed(),
 };
 const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.77});
 const dark='#263744',sole='#16232d',trim='#687c86',reflective='#ffedb0';
 const cache=new Map();
 const point=new THREE.Vector3(),normal=new THREE.Vector3(),scale=new THREE.Vector3();
 const translation=new THREE.Vector3(),quaternion=new THREE.Quaternion(),rotation=new THREE.Euler();
 const matrix=new THREE.Matrix4(),normals=new THREE.Matrix3(),color=new THREE.Color();

 function geometry(details){
  const positions=[],directions=[],colors=[];
  for(const [name,tint,x,y,z,width,height,depth,rx=0,ry=0,rz=0] of details){
   translation.set(x,y,z);scale.set(width,height,depth);
   quaternion.setFromEuler(rotation.set(rx,ry,rz));
   matrix.compose(translation,quaternion,scale);normals.getNormalMatrix(matrix);color.set(tint);
   const source=shape[name],position=source.getAttribute('position'),direction=source.getAttribute('normal');
   for(let vertex=0;vertex<position.count;vertex++){
    point.fromBufferAttribute(position,vertex).applyMatrix4(matrix);
    normal.fromBufferAttribute(direction,vertex).applyNormalMatrix(normals);
    positions.push(point.x,point.y,point.z);
    directions.push(normal.x,normal.y,normal.z);
    colors.push(color.r,color.g,color.b);
   }
  }
  return new THREE.BufferGeometry()
   .setAttribute('position',new THREE.Float32BufferAttribute(positions,3))
   .setAttribute('normal',new THREE.Float32BufferAttribute(directions,3))
   .setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
 }

 function build(role,coat,skin){
  const rescue=role==='rescue',guide=role==='guide',uniform=rescue||guide;
  const gloves=rescue?'#537f89':'#343d4a',visor='#364c5b';
  const jacket=[
   ['jacket',coat,0,.30,0,.32,.66,.22],
   ['round',coat,0,.51,0,.37,.18,.236],
   ['tube',dark,0,.035,0,.29,.13,.196],
   ['tube',dark,0,.68,0,.16,.12,.138],
   ['box',dark,0,.35,.221,.033,.49,.027],
  ];
  if(uniform){
   jacket.push(['tube',dark,0,.16,0,.31,.075,.215]);
   for(const side of [-1,1]){
    jacket.push(['box',reflective,side*.165,.47,.205,.093,.32,.048,0,side*.22,-side*.12],
     ['box',reflective,side*.158,.24,.208,.20,.058,.043,0,side*.18],
     ['box',dark,side*.161,.11,.20,.15,.092,.045,0,side*.2]);
   }
   jacket.push(['box','#d5eff0',.121,.57,.248,.095,.065,.027],
    ['box',dark,-.218,.40,.236,.103,.139,.061],['box',dark,-.239,.51,.238,.018,.125,.023]);
  }else{
   jacket.push(['round','#4b5b69',0,.35,-.214,.25,.315,.15],
    ['box',dark,0,.255,-.348,.27,.15,.045]);
   for(const side of [-1,1])jacket.push(['box',dark,side*.215,.41,.145,.05,.32,.09,.24,side*.23,-side*.12]);
  }
  const head=[
   ['round',uniform?coat:'#55637c',0,.075,-.042,.208,.245,.203],
   ['round',skin,0,.045,.071,.152,.166,.147],
   ['round',skin,0,.026,.205,.044,.044,.048],
   ['round',rescue?'#ebeff0':dark,0,-.084,.138,.142,.065,.087],
  ];
  if(uniform){
   head.push(['round',reflective,0,.208,.007,.222,.133,.211],
    ['box',dark,0,.164,.192,.332,.036,.11]);
  }else{
   head.push(['tube','#abbac8',0,.166,-.012,.201,.058,.183],
    ['round',coat,0,.293,-.021,.049,.055,.047]);
  }
  for(const side of [-1,1]){
   head.push(['round',dark,side*.074,.092,.185,.068,.039,.028]);
   if(uniform)head.push(['round',visor,side*.074,.093,.207,.058,.032,.02],
    ['round','#a5dce3',side*.088,.105,.223,.024,.01,.006]);
   else head.push(['round','#f4eee4',side*.076,.094,.205,.046,.025,.014],
    ['round',dark,side*.077,.094,.217,.019,.021,.008]);
  }
  const arms=[-1,1].map(side=>{
   const upper=[
    ['round',coat,0,-.061,0,.142,.152,.136],
    ['jacket',coat,0,-.162,0,.115,.273,.117],
   ];
   const lower=[
    ['round',coat,0,-.014,0,.103,.103,.102],
    ['jacket',coat,0,-.105,0,.102,.231,.101],
    ['tube',uniform?reflective:dark,0,-.181,0,.104,.058,.103],
    ['round',gloves,0,-.245,.012,.094,.101,.087],
    ['round',gloves,-side*.07,-.228,.049,.037,.049,.034],
   ];
   if(guide&&side===1)lower.push(['tube','#f28541',0,-.24,.165,.031,.275,.031,Math.PI/2],
    ['tube',reflective,0,-.24,.288,.033,.06,.033,Math.PI/2]);
   return {upper:geometry(upper),lower:geometry(lower)};
  });
  return {
   jacket:geometry(jacket),head:geometry(head),arms,
   thigh:geometry([['jacket',dark,0,-.175,0,.139,.36,.132]]),
   shin:geometry([
    ['round',trim,0,-.029,.062,.135,.10,.10],
    ['tube',dark,0,-.173,0,.116,.33,.117],
    ['round',dark,0,-.329,.08,.137,.114,.191],
    ['box',sole,0,-.411,.067,.258,.061,.352],
    ['box',trim,0,-.338,.197,.22,.035,.08],
   ]),
  };
 }

 function pivot(parent,x,y,z){
  const node=new THREE.Group();node.position.set(x,y,z);parent.add(node);return node;
 }
 function mount(parent,form,castShadow=false){
  const piece=new THREE.Mesh(form,material);
  piece.castShadow=castShadow;piece.receiveShadow=true;parent.add(piece);
 }

 function create({role='rescue',coat='#df632d',skin='#d49a77'}={}){
  const key=`${role}:${coat}:${skin}`;
  if(!cache.has(key))cache.set(key,build(role,coat,skin));
  const model=cache.get(key),root=new THREE.Group(),hips=pivot(root,0,.797,0);
  const torso=pivot(hips,0,0,0),head=pivot(torso,0,.86,0);
  mount(torso,model.jacket,true);mount(head,model.head,true);
  const arms=[],legs=[];
  for(const [i,side] of [-1,1].entries()){
   const shoulder=pivot(torso,side*.322,.55,0),elbow=pivot(shoulder,0,-.29,0);
   mount(shoulder,model.arms[i].upper);mount(elbow,model.arms[i].lower);
   arms.push({shoulder,elbow});
   const hip=pivot(hips,side*.161,0,0),knee=pivot(hip,0,-.36,0);
   mount(hip,model.thigh);mount(knee,model.shin);legs.push({hip,knee});
  }
  function pose({kind='idle',time=0,motion=1,phase=0}={}){
   const walk=kind==='walk',signal=kind==='signal',treat=kind==='treat',kneel=kind==='kneel';
   const working=treat||kneel;
   const gait=walk?Math.sin(time*8+phase)*motion:0;
   const reach=working?Math.sin(time*6+phase)*motion:0;
   hips.position.y=.797-(kneel?.14:treat?.065:0)+Math.abs(gait)*.025;
   torso.rotation.set(kneel?.37:treat?.22:gait*.04,working?reach*.055:0,walk?gait*.043:0);
   head.rotation.set(kneel?.21:treat?.13:0,signal?-.18:Math.sin(time*1.5+phase)*.075*motion,0);
   for(const [i,side] of [-1,1].entries()){
    const {shoulder,elbow}=arms[i],{hip,knee}=legs[i];
    const wave=signal&&side===1;
    shoulder.rotation.set(working?-.94+side*reach*.20:walk?side*gait*.56:wave?-.28:-.08,0,
     wave?1.33:side*(working?.15:.19));
    elbow.rotation.set(working?-.73-side*reach*.12:walk?-.24:wave?-.36:-.18,0,
     wave?.58+Math.sin(time*7+phase)*.34*motion:0);
    hip.rotation.set(kneel?(i===0?-.72:-.42):treat?-.30:side*gait*.49,0,0);
    knee.rotation.x=kneel?(i===0?1.30:.99):treat?.53:Math.max(0,-side*gait)*.49;
   }
  }
  pose();
  return {root,pose};
 }
 return {create};
}

// Face along the coastal passage so pressing Up also follows the world +Z axis.
export const CAMERA_OFFSET=Object.freeze({x:0,y:33,z:-44.65});
const overheadYaw=Math.atan2(0-CAMERA_OFFSET.x,-CAMERA_OFFSET.z);
const finite=value=>Number.isFinite(value)?value:0;

function moveOnBasis(horizontal,vertical,rightX,rightZ,forwardX,forwardZ){
 let x=Math.max(-1,Math.min(1,finite(horizontal))),y=Math.max(-1,Math.min(1,finite(vertical)));
 const magnitude=Math.hypot(x,y);if(magnitude>1){x/=magnitude;y/=magnitude;}
 return {x:rightX*x+forwardX*y,z:rightZ*x+forwardZ*y};
}

export function screenToWorld(horizontal,vertical){
 return viewToWorld(horizontal,vertical,overheadYaw);
}

// A perspective camera looking along +Z has world −X on its right.
export function viewToWorld(horizontal,vertical,yaw=0){
 const angle=finite(yaw),sin=Math.sin(angle),cos=Math.cos(angle);
 return moveOnBasis(horizontal,vertical,-cos,sin,sin,cos);
}

export function worldToViewAxes(x,z,yaw=0){
 x=finite(x);z=finite(z);
 const angle=finite(yaw),sin=Math.sin(angle),cos=Math.cos(angle);
 return {x:-cos*x+sin*z,y:sin*x+cos*z};
}

export const FIRST_PERSON_PITCH=-.16;
export const wrapViewYaw=angle=>Math.atan2(Math.sin(finite(angle)),Math.cos(finite(angle)));
export const clampViewPitch=angle=>Math.max(-.78,Math.min(.45,Number.isFinite(angle)?angle:FIRST_PERSON_PITCH));

export function worldToScreenAxes(x,z){
 return worldToViewAxes(x,z,overheadYaw);
}

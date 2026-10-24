// Fragment sizes on the panoramic canvas. On a 16:3 band, height is what a viewer reads as
// size, so each class has a height range (fraction of canvas height) and a width cap
// (fraction of canvas width). Sharpness wins over a minimum: a fragment is never enlarged
// beyond twice its source pixels, and any fragment held below its range is reported.
export const MAX_WORK_UPSCALE=2,MAX_LAYER_AREA=.58;
export const SIZE_LIMITS={
 people:{height:[.45,.8],width:.34},
 dominant:{height:[.75,1.2],width:.45},
 medium:{height:[.4,.75],width:.25},
 small:{height:[.15,.4],width:.12},
};
// Only archive people supply source pixels; every other fragment carries a tier.
export const sizeClass=m=>m.asset.kind==='source'?'people':(SIZE_LIMITS[m.tier]?m.tier:'medium');
// Field crops are the ground layer: whatever their tier they are at least medium size and may
// grow to landscape size so the canvas can be covered. Objects and details keep their tier.
export function sizeRange(m){
 const cls=sizeClass(m),limits=SIZE_LIMITS[cls];
 if(cls==='people'||m.asset.derived?.boundary!=='field')return limits;
 return {height:[Math.max(limits.height[0],SIZE_LIMITS.medium.height[0]),SIZE_LIMITS.dominant.height[1]],width:SIZE_LIMITS.dominant.width};
}

/** Scales a layer about its centre, keeping its rotation. */
export function resized(layer,factor){
 const width=layer.width*factor,height=layer.height*factor,rad=layer.rotation*Math.PI/180;
 return {...layer,width,height,x:layer.x-((width-layer.width)*Math.cos(rad)-(height-layer.height)*Math.sin(rad))/2,y:layer.y-((width-layer.width)*Math.sin(rad)+(height-layer.height)*Math.cos(rad))/2};
}
function corners(layer){
 const rad=layer.rotation*Math.PI/180,cos=Math.cos(rad),sin=Math.sin(rad),w=layer.width,h=layer.height;
 return {xs:[0,w*cos,-h*sin,w*cos-h*sin].map(v=>layer.x+v),ys:[0,w*sin,h*cos,w*sin+h*cos].map(v=>layer.y+v)};
}
/** Moves a layer so its rotated outline lies entirely inside the canvas. */
export function contained(layer,canvas){
 const {xs,ys}=corners(layer);
 const dx=Math.max(0,-Math.min(...xs))-Math.max(0,Math.max(...xs)-canvas.width),dy=Math.max(0,-Math.min(...ys))-Math.max(0,Math.max(...ys)-canvas.height);
 return dx||dy?{...layer,x:layer.x+dx,y:layer.y+dy}:layer;
}
/**
 * Brings a layer within its class's size range and the shared caps (area, source pixels).
 * `sizes:false` keeps only the shared caps, for projects composed before the panorama.
 */
export function limitLayer(layer,m,canvas,{sizes=true}={}){
 const W=canvas.width,H=canvas.height,a=m.asset;
 const caps=Math.min(Math.sqrt(MAX_LAYER_AREA*W*H/(layer.width*layer.height)),a.width*MAX_WORK_UPSCALE/layer.width,a.height*MAX_WORK_UPSCALE/layer.height);
 if(!sizes)return caps<1?resized(layer,caps):layer;
 const cls=sizeClass(m),{height:[min,max],width:widest}=sizeRange(m);
 let factor=Math.min(Math.max(1,min*H/layer.height),max*H/layer.height);
 factor=Math.min(factor,widest*W/layer.width,caps);
 const next=Math.abs(factor-1)>1e-9?resized(layer,factor):layer;
 return cls==='people'?contained(next,canvas):next;
}
/** Layers outside their size range after limiting: only source resolution can hold one below. */
export function sizeReport(project,materials,canvas){
 const below=[],above=[];
 for(const layer of project.layers){
  const m=materials.find(m=>m.asset.id===layer.assetId);if(!m||!layer.visible)continue;
  const {height:[min,max]}=sizeRange(m),share=layer.height/canvas.height;
  if(share<min-1e-6)below.push(layer.name);else if(share>max+1e-6)above.push(layer.name);
 }
 return {below,above};
}

/** How fragments, people and coverage divide across the three screens of the panorama. */
export function screenBalance(project,materials,coverage){
 const canvas=project.canvas,screens=[0,1,2].map(i=>({screen:i+1,fragments:0,people:0,coverage:coverage?.screens?.[i]??null}));
 if(!canvas)return [];
 for(const layer of project.layers){
  const m=materials.find(m=>m.asset.id===layer.assetId);if(!m||!layer.visible)continue;
  const {xs}=corners(layer),centre=(Math.min(...xs)+Math.max(...xs))/2,screen=screens[Math.min(2,Math.max(0,Math.floor(centre/canvas.width*3)))];
  screen.fragments++;if(sizeClass(m)==='people')screen.people++;
 }
 return screens;
}

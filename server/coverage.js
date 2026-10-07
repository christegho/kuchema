import sharp from 'sharp';
import path from 'node:path';
import {MAX_WORK_UPSCALE} from './compose.js';

export const COMPOSITION_LIMITS={maxLayerArea:.58,minRetention:.25,minVisible:.004};
const canvasArea=1600*1000;

// Measure alpha after occlusion and before it, so a tiny visible sliver cannot
// disguise a whole stack of hidden images. Rectangles alone do not prove coverage.
export async function coverageReader(store,materials,{width=320,height=200}={}){
 const masks=new Map();
 for(const m of materials){const a=m.asset;const image=await sharp(path.join(store.root,'media',`${a.id}.png`)).resize(240,240,{fit:'inside'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});masks.set(a.id,{...image,rootId:m.rootId||a.rootId||a.id});}
 return project=>{
  const W=width,H=height,N=W*H,remaining=new Float32Array(N).fill(1),visible={},footprints={};
  for(const l of [...project.layers].reverse()){
   if(!l.visible||!l.assetId)continue;
   const m=masks.get(l.assetId);if(!m)continue;
   const rad=l.rotation*Math.PI/180,c=Math.cos(rad),s=Math.sin(rad);let pixels=0,footprint=0;
   for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const dx=(x+.5)*1600/W-l.x,dy=(y+.5)*1000/H-l.y;
    const u=(dx*c+dy*s)/l.width,v=(-dx*s+dy*c)/l.height;
    if(u<0||u>=1||v<0||v>=1)continue;
    const alpha=m.data[(Math.floor(v*m.info.height)*m.info.width+Math.floor(u*m.info.width))*4+3]/255*l.opacity;
    const i=y*W+x;pixels+=remaining[i]*alpha;footprint+=alpha;remaining[i]*=1-alpha;
   }
   visible[m.rootId]=(visible[m.rootId]||0)+pixels/N;
   footprints[m.rootId]=(footprints[m.rootId]||0)+footprint/N;
  }
  let filled=0;for(const r of remaining)if(r<.1)filled++;
  const retention=Object.fromEntries(Object.keys(visible).map(id=>[id,footprints[id]?visible[id]/footprints[id]:0]));
  const obscuredIds=Object.keys(visible).filter(id=>retention[id]<COMPOSITION_LIMITS.minRetention||visible[id]<COMPOSITION_LIMITS.minVisible);
  return {coverage:filled/N,visible,footprints,retention,obscuredIds,dominantShare:Math.max(0,...Object.values(visible)),distinctVisible:Object.values(visible).filter(n=>n>=.002).length};
 };
}

function resized(layer,factor){
 const width=layer.width*factor,height=layer.height*factor,rad=layer.rotation*Math.PI/180;
 return {...layer,width,height,x:layer.x-((width-layer.width)*Math.cos(rad)-(height-layer.height)*Math.sin(rad))/2,y:layer.y-((width-layer.width)*Math.sin(rad)+(height-layer.height)*Math.cos(rad))/2};
}
function bounded(layer,asset){
 const factor=Math.min(1,Math.sqrt(COMPOSITION_LIMITS.maxLayerArea*canvasArea/(layer.width*layer.height)),asset.width*MAX_WORK_UPSCALE/layer.width,asset.height*MAX_WORK_UPSCALE/layer.height);
 return factor<1?resized(layer,factor):layer;
}
export async function fillComposition(store,project,materials,count){
 const measure=await coverageReader(store,materials,{width:160,height:100}),changes=[];
 const assets=new Map(materials.map(m=>[m.asset.id,m.asset]));
 const quality=p=>{
  const m=measure(p),hidden=Object.keys(m.visible).reduce((n,id)=>n+Math.max(0,COMPOSITION_LIMITS.minVisible-m.visible[id])*35+Math.max(0,COMPOSITION_LIMITS.minRetention-m.retention[id])*.65,0);
  return {m,score:m.coverage-hidden-(count-m.distinctVisible)*.4-Math.max(0,m.dominantShare-COMPOSITION_LIMITS.maxLayerArea)*5};
 };
 project.layers=project.layers.map(l=>{
  const asset=assets.get(l.assetId);if(!asset)return l;
  const next=bounded(l,asset);
  if(next!==l)changes.push({layerId:l.id,fromWidth:l.width,toWidth:next.width,reason:'Limit each fragment to 58% of the canvas area; share the ground between crops.'});
  return next;
 });
 let current=quality(project);
 // Repair the director's layout, including fully covered canvases with hidden
 // sources. Prefer legibility to filling the last gap with one giant photograph.
 for(let pass=0;pass<7;pass++){
  if(current.m.coverage>=.995&&!current.m.obscuredIds.length)break;
  let improved=false;
  for(let i=0;i<project.layers.length;i++){
   const layer=project.layers[i],asset=assets.get(layer.assetId);if(!asset)continue;
   let best=current,bestLayer=layer;
   const candidates=[.82,.94,1.08,1.18].map(factor=>bounded(resized(layer,factor),asset));
   for(const [dx,dy] of [[-100,0],[100,0],[0,-75],[0,75]])candidates.push({...layer,x:layer.x+dx,y:layer.y+dy});
   for(const candidate of candidates){
    if(candidate.width<10||candidate.height<10)continue;
    const result=quality({...project,layers:project.layers.map((v,j)=>j===i?candidate:v)});
    if(result.score>best.score+.0002){best=result;bestLayer=candidate;}
   }
   if(bestLayer!==layer){project.layers[i]=bestLayer;current=best;improved=true;changes.push({layerId:layer.id,fromWidth:layer.width,toWidth:bestLayer.width,from:[layer.x,layer.y],to:[bestLayer.x,bestLayer.y],reason:'Balance coverage with visible contributions; shrink or move occluding fragments.'});}
  }
  // Move obscured cuts one position forward only within their material group;
  // archive people retain the foreground over generated environments.
  for(let i=0;i<project.layers.length-1;i++){
   const first=project.layers[i],second=project.layers[i+1];
   if(assets.get(first.assetId)?.kind!==assets.get(second.assetId)?.kind)continue;
   const layers=[...project.layers];[layers[i],layers[i+1]]=[second,first];
   const result=quality({...project,layers});
   if(result.score>current.score+.0002){project.layers=layers;current=result;improved=true;changes.push({layerId:first.id,reason:'Bring an obscured fragment forward while preserving people in the foreground.'});}
  }
  if(!improved)break;
 }
 const finalMeasure=await coverageReader(store,materials);
 return {...finalMeasure(project),changes,limits:COMPOSITION_LIMITS};
}

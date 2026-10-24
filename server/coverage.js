import sharp from 'sharp';
import path from 'node:path';
import {LEGACY_CANVAS,canvasOf} from '../shared/canvas.js';
import {MAX_LAYER_AREA,limitLayer,resized} from './scale.js';

export const COMPOSITION_LIMITS={maxLayerArea:MAX_LAYER_AREA,minRetention:.25,minVisible:.004};
// A measuring grid with the canvas's proportions and about `cells` samples (320 × 200 for 1600 × 1000).
const grid=(canvas,cells)=>{const width=Math.round(Math.sqrt(cells*canvas.width/canvas.height));return {width,height:Math.round(cells/width)};};

// Measure alpha after occlusion and before it, so a tiny visible sliver cannot
// disguise a whole stack of hidden images. Rectangles alone do not prove coverage.
export async function coverageReader(store,materials,{canvas=LEGACY_CANVAS,cells=64000}={}){
 const {width,height}=grid(canvas,cells);
 const masks=new Map();
 // Visibility is kept per fragment (several cuts can share one source image) and per source image.
 for(const m of materials){const a=m.asset;const image=await sharp(path.join(store.root,'media',`${a.id}.png`)).resize(240,240,{fit:'inside'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});masks.set(a.id,{...image,key:m.key||m.rootId||a.rootId||a.id,rootId:m.rootId||a.rootId||a.id});}
 return project=>{
  const W=width,H=height,N=W*H,remaining=new Float32Array(N).fill(1),visible={},footprints={},rootVisible={};
  for(const l of [...project.layers].reverse()){
   if(!l.visible||!l.assetId)continue;
   const m=masks.get(l.assetId);if(!m)continue;
   const rad=l.rotation*Math.PI/180,c=Math.cos(rad),s=Math.sin(rad);let pixels=0,footprint=0;
   for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const dx=(x+.5)*canvas.width/W-l.x,dy=(y+.5)*canvas.height/H-l.y;
    const u=(dx*c+dy*s)/l.width,v=(-dx*s+dy*c)/l.height;
    if(u<0||u>=1||v<0||v>=1)continue;
    const alpha=m.data[(Math.floor(v*m.info.height)*m.info.width+Math.floor(u*m.info.width))*4+3]/255*l.opacity;
    const i=y*W+x;pixels+=remaining[i]*alpha;footprint+=alpha;remaining[i]*=1-alpha;
   }
   visible[m.key]=(visible[m.key]||0)+pixels/N;rootVisible[m.rootId]=(rootVisible[m.rootId]||0)+pixels/N;
   footprints[m.key]=(footprints[m.key]||0)+footprint/N;
  }
  let filled=0;for(const r of remaining)if(r<.1)filled++;
  // Coverage of each of the three screens the panorama spans.
  const screens=[0,1,2].map(i=>{const from=Math.floor(i*W/3),to=Math.floor((i+1)*W/3);let n=0;for(let y=0;y<H;y++)for(let x=from;x<to;x++)if(remaining[y*W+x]<.1)n++;return n/((to-from)*H);});
  // The widest uncovered band (a window of columns), so repair can move material onto it.
  const open=new Float32Array(W),span=Math.max(1,Math.round(W/12));let rows=0,count=0;
  for(let x=0;x<W;x++)for(let y=0;y<H;y++)if(remaining[y*W+x]>=.1)open[x]++;
  let best=-1,start=0;for(let x=0,sum=0;x<W;x++){sum+=open[x]-(x>=span?open[x-span]:0);if(x>=span-1&&sum>best){best=sum;start=x-span+1;}}
  for(let x=start;x<start+span;x++)for(let y=0;y<H;y++)if(remaining[y*W+x]>=.1){rows+=y;count++;}
  const gap=count?{x:(start+span/2)*canvas.width/W,y:(rows/count+.5)*canvas.height/H,share:count/N}:null;
  const retention=Object.fromEntries(Object.keys(visible).map(id=>[id,footprints[id]?visible[id]/footprints[id]:0]));
  // A small detail is not obscured just for being small: compare it with its own footprint.
  const obscuredIds=Object.keys(visible).filter(id=>retention[id]<COMPOSITION_LIMITS.minRetention||visible[id]<Math.min(COMPOSITION_LIMITS.minVisible,.4*footprints[id]));
  return {keyedBy:'fragment',coverage:filled/N,screens,gap,visible,footprints,retention,obscuredIds,rootVisible,dominantShare:Math.max(0,...Object.values(visible)),distinctVisible:Object.values(rootVisible).filter(n=>n>=.002).length};
 };
}

export async function fillComposition(store,project,materials){
 const canvas=canvasOf(project),sizes=Boolean(project.canvas),measure=await coverageReader(store,materials,{canvas,cells:16000}),changes=[],count=new Set(materials.map(m=>m.rootId||m.asset.rootId||m.asset.id)).size;
 const fragments=new Map(materials.map(m=>[m.asset.id,m])),assets=new Map(materials.map(m=>[m.asset.id,m.asset]));
 // Every repair stays within the fragment's size range, area and sharpness caps.
 const bounded=(layer,id)=>limitLayer(layer,fragments.get(id),canvas,{sizes});
 // How fragments and people divide across the three screens, by layer centre.
 const centre=l=>{const rad=l.rotation*Math.PI/180;return {x:l.x+(l.width*Math.cos(rad)-l.height*Math.sin(rad))/2,y:l.y+(l.width*Math.sin(rad)+l.height*Math.cos(rad))/2};};
 const isPerson=l=>fragments.get(l.assetId)?.asset.kind==='source';
 const spread=layers=>{const all=[0,0,0],people=[0,0,0];for(const l of layers){if(!fragments.get(l.assetId))continue;const i=Math.min(2,Math.max(0,Math.floor(centre(l).x/canvas.width*3)));all[i]++;if(isPerson(l))people[i]++;}return {all,people};};
 const imbalance=counts=>{const total=counts.reduce((a,b)=>a+b,0);return total<3?0:(Math.max(...counts)-Math.min(...counts))/total;};
 const quality=p=>{
  const m=measure(p),hidden=Object.keys(m.visible).reduce((n,id)=>n+Math.max(0,Math.min(COMPOSITION_LIMITS.minVisible,.4*m.footprints[id])-m.visible[id])*35+Math.max(0,COMPOSITION_LIMITS.minRetention-m.retention[id])*.65,0);
  // On the panorama the least covered screen also counts, so repair fills the emptiest screen first.
  const {all,people}=spread(p.layers);
  return {m,score:m.coverage+(sizes?.3*Math.min(...m.screens)-.15*(imbalance(all)+imbalance(people)):0)-hidden-(count-m.distinctVisible)*.4-Math.max(0,m.dominantShare-COMPOSITION_LIMITS.maxLayerArea)*5};
 };
 project.layers=project.layers.map(l=>{
  if(!assets.get(l.assetId))return l;
  const next=bounded(l,l.assetId);
  if(next!==l)changes.push({layerId:l.id,fromWidth:l.width,toWidth:next.width,reason:'Keep each fragment within its size range and 58% of the canvas area.'});
  return next;
 });
 let current=quality(project);
 // Repair the director's layout, including fully covered canvases with hidden
 // sources. Prefer legibility to filling the last gap with one giant photograph.
 for(let pass=0;pass<(sizes?14:7);pass++){
  if(current.m.coverage>=.995&&!current.m.obscuredIds.length)break;
  let improved=false;
  for(let i=0;i<project.layers.length;i++){
   const layer=project.layers[i],asset=assets.get(layer.assetId);if(!asset)continue;
   let best=current,bestLayer=layer;
   // A large factor asks for the top of the fragment's size range; the limits clamp it.
   const candidates=[.82,.94,1.08,1.18,4].map(factor=>bounded(resized(layer,factor),layer.assetId)),step=[canvas.width/16,canvas.height*.075];
   for(const [dx,dy] of [[-step[0],0],[step[0],0],[0,-step[1]],[0,step[1]]])candidates.push(bounded({...layer,x:layer.x+dx,y:layer.y+dy},layer.assetId));
   // On the panorama, try moving the fragment to the screen that holds the fewest of its kind.
   if(sizes){const counts=spread(project.layers)[isPerson(layer)?'people':'all'],target=counts.indexOf(Math.min(...counts)),{x}=centre(layer);candidates.push(bounded({...layer,x:layer.x+(target+.5)*canvas.width/3-x},layer.assetId));}
   // Try carrying the fragment onto the widest uncovered band, as it is and at its largest.
   const gap=current.m.gap;
   if(gap)for(const base of [layer,bounded(resized(layer,4),layer.assetId)]){const rad=base.rotation*Math.PI/180,cx=base.x+(base.width*Math.cos(rad)-base.height*Math.sin(rad))/2,cy=base.y+(base.width*Math.sin(rad)+base.height*Math.cos(rad))/2;candidates.push(bounded({...base,x:base.x+gap.x-cx,y:base.y+gap.y-cy},layer.assetId));}
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
 const finalMeasure=await coverageReader(store,materials,{canvas});
 return {...finalMeasure(project),changes,limits:COMPOSITION_LIMITS};
}

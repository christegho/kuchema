import sharp from 'sharp';
import path from 'node:path';
import {MAX_WORK_UPSCALE} from './compose.js';

// Sample the real alpha masks. Bounding rectangles would overstate a thin cut's coverage.
export async function coverageReader(store,materials){
 const masks=new Map();
 for(const m of materials){const a=m.asset;const image=await sharp(path.join(store.root,'media',`${a.id}.png`)).resize(240,240,{fit:'inside'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});masks.set(a.id,{...image,rootId:m.rootId||a.rootId||a.id});}
 return project=>{
  const W=320,H=200,N=W*H,remaining=new Float32Array(N).fill(1),visible={};
  for(const l of [...project.layers].reverse()){
   if(!l.visible||!l.assetId)continue;
   const m=masks.get(l.assetId);if(!m)continue;
   const rad=l.rotation*Math.PI/180,c=Math.cos(rad),s=Math.sin(rad);let pixels=0;
   for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const dx=(x+.5)*5-l.x,dy=(y+.5)*5-l.y;
    const u=(dx*c+dy*s)/l.width,v=(-dx*s+dy*c)/l.height;
    if(u<0||u>=1||v<0||v>=1)continue;
    const alpha=m.data[(Math.floor(v*m.info.height)*m.info.width+Math.floor(u*m.info.width))*4+3]/255*l.opacity;
    const i=y*W+x;pixels+=remaining[i]*alpha;remaining[i]*=1-alpha;
   }
   visible[m.rootId]=(visible[m.rootId]||0)+pixels/N;
  }
  let filled=0;for(const r of remaining)if(r<.1)filled++;
  return {coverage:filled/N,visible,distinctVisible:Object.values(visible).filter(n=>n>=.002).length};
 };
}

export async function fillComposition(store,project,materials,count){
 const measure=await coverageReader(store,materials),changes=[];
 const quality=p=>{const m=measure(p);return {m,score:m.coverage-Object.values(m.visible).reduce((n,v)=>n+Math.max(0,.003-v)*180,0)-(count-m.distinctVisible)*.12};};
 let current=quality(project);
 // Local, deterministic adjustments around the VLM's layout; no replacement template.
 for(let pass=0;pass<10&&current.m.coverage<.995;pass++){
  let improved=false;
  for(let i=0;i<project.layers.length;i++){
   const l=project.layers[i],asset=materials.find(m=>m.asset.id===l.assetId)?.asset;if(!asset?.allowCrop)continue;
   let best=current,bestLayer=l;
   for(const factor of [1.08,1.18]){
    let width=Math.min(asset.width*MAX_WORK_UPSCALE,l.width*factor),height=l.height*width/l.width;
    if(height>asset.height*MAX_WORK_UPSCALE){height=asset.height*MAX_WORK_UPSCALE;width=l.width*height/l.height;}
    if(width<=l.width+.5||height<=l.height+.5)continue;
    const angle=l.rotation*Math.PI/180,dx=((width-l.width)*Math.cos(angle)-(height-l.height)*Math.sin(angle))/2,dy=((width-l.width)*Math.sin(angle)+(height-l.height)*Math.cos(angle))/2;
    const candidate={...l,width,height,x:l.x-dx,y:l.y-dy};
    const result=quality({...project,layers:project.layers.map((v,j)=>j===i?candidate:v)});
    if(result.score>best.score+.0002){best=result;bestLayer=candidate;}
   }
   if(bestLayer!==l){project.layers[i]=bestLayer;current=best;improved=true;changes.push({layerId:l.id,fromWidth:l.width,toWidth:bestLayer.width,reason:'Increase actual crop coverage while retaining every source.'});}
  }
  if(!improved)break;
 }
 return {...current.m,changes};
}

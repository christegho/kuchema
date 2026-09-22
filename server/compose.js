import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const HUMAN_TERMS=/\b(person|people|woman|women|man|men|child|children|figure|figures|group|gathering|crowd|family|families|youth|portrait)\b/i;
export const archiveHasPeople=asset=>HUMAN_TERMS.test([asset.title,asset.caption,asset.aiCaption,asset.tags].filter(Boolean).join(' '));
export const MAX_WORK_UPSCALE=2;

export function retrieveArchive(assets,prompt,ids=[]){
  const terms=prompt.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[];
  return assets.filter(a=>a.kind==='source'&&!a.derived&&(!ids.length||ids.includes(a.id))).map(a=>{
    let score=0;for(const [field,weight] of [['locality',10],['caption',6],['tags',4],['title',3],['aiCaption',1]])for(const t of terms)if((a[field]||'').toLowerCase().includes(t))score+=weight;
    return {asset:a,score};
  }).sort((a,b)=>b.score-a.score).slice(0,20);
}

// Layout coordinates are authored by the visual director, then bounded mechanically.
export function assemble(plan,materials,prompt,layout){
  if(!layout)throw new Error('A model-authored layout is required.');
  const layers=layout.layers.map(item=>{
    const m=materials.find(m=>m.key===item.assetId||m.asset.id===item.assetId);
    if(!m)throw new Error('The composition names an unknown fragment.');
    const a=m.asset,scale=Math.min(item.width*1600/a.width,3000/a.height,MAX_WORK_UPSCALE);
    let width=Math.max(10,a.width*scale),height=Math.max(10,a.height*scale);
    const angle=item.rotation*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle);
    let x=item.x*1600-(width*cos-height*sin)/2,y=item.y*1000-(width*sin+height*cos)/2;
    // A no-crop source must stay completely inside the frame, including its rotated corners.
    if(!a.allowCrop){
      const fit=Math.min(1,1600/(width*Math.abs(cos)+height*Math.abs(sin)),1000/(width*Math.abs(sin)+height*Math.abs(cos)));width*=fit;height*=fit;
      const xs=[0,width*cos,-height*sin,width*cos-height*sin],ys=[0,width*sin,height*cos,width*sin+height*cos];
      x=Math.max(-Math.min(...xs),Math.min(1600-Math.max(...xs),x));y=Math.max(-Math.min(...ys),Math.min(1000-Math.max(...ys),y));
    }
    return {id:randomUUID(),assetId:a.id,name:item.name,kind:a.kind,x,y,width,height,rotation:item.rotation,opacity:item.opacity,shape:'rectangle',points:[],crop:{x:0,y:0,zoom:1},visible:true,locked:false,note:item.reason};
  });
  if(materials.some(m=>m.asset.derived)&&!layers.some(l=>materials.some(m=>m.asset.id===l.assetId&&m.asset.derived)))throw new Error('The layout omitted every segmented fragment.');
  return {title:plan.title,brief:prompt,strategy:'atlas',background:layout.background,layers,evidence:{supported:plan.supported||[],uncertain:plan.uncertain||[],rules:[layout.rationale,...(plan.rules||[])]}};
}

const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export async function materialSheet(store,materials,id){
  const cols=4,w=280,h=250,rows=Math.ceil(materials.length/cols),overlays=[];
  for(const [i,m] of materials.entries()){
    const img=await sharp(path.join(store.root,'media',`${m.asset.id}.png`)).resize(w-30,h-65,{fit:'inside',withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});
    const x=i%cols*w,y=Math.floor(i/cols)*h;
    overlays.push({input:img.data,left:x+Math.round((w-img.info.width)/2),top:y+10+Math.round((h-65-img.info.height)/2)});
    const label=Buffer.from(`<svg width="${w}" height="45"><text x="15" y="16" font-family="Arial" font-size="14" fill="#222">${esc(m.key)} · ${m.asset.kind} · ${m.asset.derived?'SAM cut':'whole source'}</text><text x="15" y="35" font-family="Arial" font-size="11" fill="#555">${esc(m.label.slice(0,38))}</text></svg>`);
    overlays.push({input:label,left:x,top:y+h-45});
  }
  const output=path.join(store.root,'media',`${id}.png`);
  await sharp({create:{width:cols*w,height:rows*h,channels:4,background:'#ebeae7'}}).composite(overlays).png().toFile(output);
  const bytes=await sharp(output).jpeg({quality:92}).toBuffer();
  return {url:`/media/${id}.png`,data:`data:image/jpeg;base64,${bytes.toString('base64')}`};
}

export async function renderCollage(store,project,id){
  const factor=1.5,canvasW=2400,canvasH=1500,overlays=[];
  for(const l of project.layers.filter(l=>l.visible&&l.assetId)){
    const w=Math.max(1,Math.round(l.width*factor)),h=Math.max(1,Math.round(l.height*factor));
    let image=sharp(path.join(store.root,'media',`${l.assetId}.png`)).resize(w,h,{fit:'fill'}).ensureAlpha();
    if(l.opacity!==1){const raw=await image.raw().toBuffer({resolveWithObject:true});for(let i=3;i<raw.data.length;i+=4)raw.data[i]=Math.round(raw.data[i]*l.opacity);image=sharp(raw.data,{raw:raw.info});}
    const rotated=await image.rotate(l.rotation,{background:'#00000000'}).png().toBuffer({resolveWithObject:true});
    const angle=l.rotation*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle);
    const left=Math.round(l.x*factor+Math.min(0,w*cos,-h*sin,w*cos-h*sin));
    const top=Math.round(l.y*factor+Math.min(0,w*sin,h*cos,w*sin+h*cos));
    const x=Math.max(0,left),y=Math.max(0,top),rw=Math.min(rotated.info.width-Math.max(0,-left),canvasW-x),rh=Math.min(rotated.info.height-Math.max(0,-top),canvasH-y);
    if(rw<=0||rh<=0)continue;
    const input=await sharp(rotated.data).extract({left:Math.max(0,-left),top:Math.max(0,-top),width:rw,height:rh}).png().toBuffer();
    overlays.push({input,left:x,top:y});
  }
  const output=path.join(store.root,'media',`${id}.png`);
  await sharp({create:{width:canvasW,height:canvasH,channels:4,background:project.background}}).composite(overlays).png().toFile(output);
  return `/media/${id}.png`;
}

import sharp from 'sharp';
import path from 'node:path';

export const TRANSFORMS=['none','print-grain','reproduction','misregistration','posterize','selective-erasure','recolour','water-flow'];
const FALLBACK_PALETTE=['#183f3b','#68764a','#9c6b40','#d6c8a5'];
const rgb=hex=>[1,3,5].map(i=>Number.parseInt(hex.slice(i,i+2),16));
function paletteFrom(value=''){
  const colors=[...String(value).matchAll(/#[0-9a-fA-F]{6}\b/g)].map(match=>match[0]);
  return (colors.length>=2?colors:FALLBACK_PALETTE).slice(0,6).map(rgb);
}
function colourAt(colors,t){
  const position=Math.max(0,Math.min(1,t))*(colors.length-1),left=Math.floor(position),right=Math.min(colors.length-1,left+1),mix=position-left;
  return colors[left].map((channel,index)=>channel*(1-mix)+colors[right][index]*mix);
}
function bilinear(source,width,height,x,y,channel){
  const sx=Math.max(0,Math.min(width-1,x)),sy=Math.max(0,Math.min(height-1,y)),x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(width-1,x0+1),y1=Math.min(height-1,y0+1),fx=sx-x0,fy=sy-y0;
  const at=(px,py)=>source[(py*width+px)*4+channel];
  return at(x0,y0)*(1-fx)*(1-fy)+at(x1,y0)*fx*(1-fy)+at(x0,y1)*(1-fx)*fy+at(x1,y1)*fx*fy;
}
export async function transformImage(store,asset,transform) {
  if(transform.type==='none')return asset;
  if(asset.kind==='source'&&!asset.allowTransform)throw new Error(`Transformation is not permitted for ${asset.title}.`);
  if(!TRANSFORMS.includes(transform.type))throw new Error('Unknown image transformation.');
  const requestedStrength=Math.max(.1,Math.min(1,transform.strength));
  const strength=['reproduction','posterize'].includes(transform.type)?Math.min(.55,requestedStrength):requestedStrength;
  let image=sharp(path.join(store.root,'media',`${asset.id}.png`));
  if(transform.type==='reproduction'){
    // A restrained copy-generation softness. Lanczos resampling and a high JPEG
    // quality retain texture instead of producing obvious block pixels.
    const scale=.94-strength*.22,w=Math.max(96,Math.round(asset.width*scale)),h=Math.max(96,Math.round(asset.height*scale));
    const compressed=await image.resize(w,h,{fit:'fill',kernel:'lanczos3'}).jpeg({quality:Math.round(91-strength*17),chromaSubsampling:'4:4:4'}).toBuffer();
    image=sharp(compressed).resize(asset.width,asset.height,{fit:'fill',kernel:'lanczos3'});
  } else {
    const {data,info}=await image.ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const original=Buffer.from(data),shift=Math.max(1,Math.round(info.width*.008*strength)),colors=paletteFrom(transform.palette);
    for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
      const i=(y*info.width+x)*4;
      if(transform.type==='misregistration'){
        data[i]=original[(y*info.width+Math.max(0,x-shift))*4];
        data[i+2]=original[(y*info.width+Math.min(info.width-1,x+shift))*4+2];
      } else if(transform.type==='posterize'){
        const levels=Math.round(13-strength*5),step=255/(levels-1),amount=strength*.48;
        for(let c=0;c<3;c++){
          const reduced=Math.min(255,Math.round(original[i+c]/step)*step);
          data[i+c]=Math.round(original[i+c]*(1-amount)+reduced*amount);
        }
      } else if(transform.type==='recolour'){
        const luminance=(original[i]*.2126+original[i+1]*.7152+original[i+2]*.0722)/255;
        const mapped=colourAt(colors,luminance),amount=.18+strength*.38;
        for(let c=0;c<3;c++)data[i+c]=Math.round(original[i+c]*(1-amount)+mapped[c]*amount);
      } else if(transform.type==='water-flow'){
        // Smooth refraction-like displacement follows two crossing flow bands.
        // Bilinear sampling retains continuous detail and avoids block pixels.
        const dx=Math.sin(y/info.height*Math.PI*5+x/info.width*Math.PI*1.4)*info.width*.012*strength;
        const dy=Math.sin(x/info.width*Math.PI*4-y/info.height*Math.PI*.7)*info.height*.007*strength;
        for(let c=0;c<3;c++)data[i+c]=Math.round(bilinear(original,info.width,info.height,x+dx,y+dy,c));
      } else if(transform.type==='print-grain'){
        // Deterministic simulated paper/reproduction texture, not a physical process.
        const grain=(((x*73+y*151+(x*y)%197)%101)/100-.5)*34*strength;
        const weave=((x%4===0?1:0)+(y%5===0?1:0))*7*strength;
        for(let c=0;c<3;c++)data[i+c]=Math.max(0,Math.min(255,original[i+c]*.94+12+grain-weave));
      } else if(transform.type==='selective-erasure'){
        const wave=Math.sin(x/info.width*16+y/info.height*7);
        if(wave>1-strength*.5)for(let c=0;c<3;c++)data[i+c]=Math.round(original[i+c]*.25+225*.75);
      }
    }
    image=sharp(data,{raw:info});
  }
  return store.addImage(await image.png().toBuffer(),`${asset.title}-transformed.png`,{
    kind:asset.kind,title:asset.title,caption:asset.caption,locality:asset.locality,contributor:asset.contributor,
    restrictions:asset.restrictions,allowCrop:asset.allowCrop,allowReference:false,allowTransform:asset.allowTransform,
    rootId:asset.rootId||asset.id,derived:{parentId:asset.id,operation:'transform',transform:{...transform,effectiveStrength:strength,simulated:true}},
    ...(asset.generation?{generation:asset.generation}:{})
  });
}

import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

export const TRANSFORM_OPTIONS=[
 {id:'water-flow',label:'Water refraction',description:'Currents visibly bend environmental detail like moving water.',maxStrength:1,defaultEnabled:true},
 {id:'reflection-echo',label:'Reflection echoes',description:'A clear reflected trace suggests water, memory and returning forms.',maxStrength:1,defaultEnabled:false},
 {id:'sediment-wash',label:'Sediment wash',description:'Earth and leaf pigment settles in visible contour bands.',maxStrength:1,defaultEnabled:true},
 {id:'capillary-stain',label:'Capillary staining',description:'Pigment pools along material edges, recalling water absorbed by paper.',maxStrength:1,defaultEnabled:true},
 {id:'contour-etch',label:'Contour impressions',description:'Tonal contours trace terrain and growth across the photograph.',maxStrength:1,defaultEnabled:false},
 {id:'print-grain',label:'Paper grain',description:'A pronounced printed texture connects photographic fragments.',maxStrength:1,defaultEnabled:true},
 {id:'reproduction',label:'Copy softness',description:'Softness and compression suggest a photograph passed between generations.',maxStrength:1,defaultEnabled:false},
 {id:'misregistration',label:'Offset inks',description:'Ink offsets leave a visible trace of assembling and printing.',maxStrength:1,defaultEnabled:false},
 {id:'posterize',label:'Tonal steps',description:'Simplify tones into printed steps while keeping photographic texture.',maxStrength:1,defaultEnabled:false},
 {id:'selective-erasure',label:'Eroded impressions',description:'Uneven fading follows the source texture like weathered printed matter.',maxStrength:1,defaultEnabled:false},
 {id:'recolour',label:'Earth and water palette',description:'A strong wash drawn from observed water, leaves, stone and soil.',maxStrength:1,defaultEnabled:true},
];
export const TRANSFORMS=['none',...TRANSFORM_OPTIONS.map(t=>t.id)];
export const DEFAULT_TRANSFORMS=TRANSFORM_OPTIONS.filter(t=>t.defaultEnabled).map(t=>t.id);
export function permittedTransforms(job){
 return job.transformations?(job.enabledTransforms??DEFAULT_TRANSFORMS).filter(type=>TRANSFORMS.includes(type)&&type!=='none'&&(job.recolouring||type!=='recolour')):[];
}
// Every generated fragment carries one visible treatment; three kinds at most keep the collage coherent.
export const treatmentBudget=generatedCount=>({maxImages:generatedCount,maxTypes:3});
// A fourth kind is folded into the director's strongest chosen kind rather than
// rejected, which would stop a study after its paid plan. Adjustments are saved.
export function restrainTreatments(plan,job){
 const allowed=permittedTransforms(job),budget=treatmentBudget(plan.images.filter(i=>!i.sourceId).length),types=[],adjustments=[];
 for(const item of [...plan.images].sort((a,b)=>b.transform.strength-a.transform.strength)){
  const treatment=item.transform;if(treatment.type==='none')continue;
  if(item.sourceId||!allowed.includes(treatment.type))throw new Error('The plan uses a disabled transformation or transforms an archive person.');
  if(!types.includes(treatment.type)&&types.length>=budget.maxTypes){
   adjustments.push({key:item.key,requested:{...treatment},reason:`Keep the collage to ${budget.maxTypes} treatment kinds: this fragment uses ${types[0]} instead.`});
   treatment.type=types[0];
  }
  const cap=TRANSFORM_OPTIONS.find(t=>t.id===treatment.type).maxStrength;
  if(treatment.strength>cap){adjustments.push({key:item.key,requested:{...treatment},reason:'Clamp the treatment to its maximum strength.'});treatment.strength=cap;}
  if(!types.includes(treatment.type))types.push(treatment.type);
 }
 return adjustments;
}
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
export function assertTransformable(asset,transform){
  if(asset.kind==='source'&&(!asset.allowTransform||asset.archive?.category==='people'))throw new Error(`Transformation is not permitted for ${asset.title}.`);
  if(!TRANSFORMS.includes(transform.type))throw new Error('Unknown image transformation.');
}
/** Applies a treatment to a whole untreated image in memory; nothing is saved. */
export async function treatedImage(store,asset,transform) {
  assertTransformable(asset,transform);
  const requestedStrength=Math.max(.1,Math.min(1,transform.strength));
  const strength=Math.min(TRANSFORM_OPTIONS.find(t=>t.id===transform.type).maxStrength,requestedStrength);
  let image=sharp(path.join(store.root,'media',`${asset.id}.png`));
  if(transform.type==='reproduction'){
    // Copy-generation softness: downsampling and JPEG compression, then back to
    // full size. Lanczos resampling keeps texture rather than block pixels.
    const scale=Math.max(.3,.8-strength*.5),w=Math.max(96,Math.round(asset.width*scale)),h=Math.max(96,Math.round(asset.height*scale));
    const compressed=await image.resize(w,h,{fit:'fill',kernel:'lanczos3'}).jpeg({quality:Math.max(30,Math.round(80-strength*50)),chromaSubsampling:'4:4:4'}).toBuffer();
    // A copied photograph also loses contrast and colour.
    image=sharp(compressed).resize(asset.width,asset.height,{fit:'fill',kernel:'lanczos3'}).modulate({saturation:1-.35*strength}).linear(1-.22*strength,22*strength);
  } else {
    const {data,info}=await image.ensureAlpha().raw().toBuffer({resolveWithObject:true});
    // Texture-scale effects use a cell relative to image size so they survive
    // being reduced into a collage; a 1-pixel pattern would vanish.
    const original=Buffer.from(data),shift=Math.max(1,Math.round(info.width*.013*strength)),colors=paletteFrom(transform.palette),cell=Math.max(1,Math.round(info.width/700));
    for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
      const i=(y*info.width+x)*4;
      const luminance=(original[i]*.2126+original[i+1]*.7152+original[i+2]*.0722)/255;
      if(transform.type==='reflection-echo'){
        const band=Math.max(0,1-Math.abs(y/info.height-.68)/.4),amount=band*strength*.8;
        const sx=x+Math.sin(y/info.height*29)*info.width*.012;
        const sy=info.height*.98-y*.55;
        for(let c=0;c<3;c++)data[i+c]=Math.round(original[i+c]*(1-amount)+bilinear(original,info.width,info.height,sx,sy,c)*amount);
      } else if(transform.type==='sediment-wash'){
        const strata=.5+.5*Math.sin(y/info.height*24+luminance*5+Math.sin(x/info.width*7));
        const pigment=colourAt(colors,.2+luminance*.6),amount=strength*.9*strata;
        for(let c=0;c<3;c++)data[i+c]=Math.round(original[i+c]*(1-amount)+pigment[c]*amount);
      } else if(transform.type==='capillary-stain'){
        const j=(y*info.width+Math.max(0,x-2*cell))*4,k=(Math.max(0,y-2*cell)*info.width+x)*4;
        const edge=Math.min(1,(Math.abs(original[i]-original[j])+Math.abs(original[i+1]-original[k+1]))/80);
        const tide=.5+.5*Math.sin(x/info.width*11+Math.sin(y/info.height*9)*2);
        const amount=Math.min(1,strength*(.3*tide+edge*1.4)),pigment=colourAt(colors,luminance*.4);
        for(let c=0;c<3;c++)data[i+c]=Math.round(original[i+c]*(1-amount)+pigment[c]*amount);
      } else if(transform.type==='contour-etch'){
        const contour=Math.pow(.5+.5*Math.cos(luminance*Math.PI*16),4),amount=contour*strength*.9;
        const pigment=colourAt(colors,.05);
        for(let c=0;c<3;c++)data[i+c]=Math.round(original[i+c]*(1-amount)+pigment[c]*amount);
      } else if(transform.type==='misregistration'){
        data[i]=original[(y*info.width+Math.max(0,x-shift))*4];
        data[i+2]=original[(y*info.width+Math.min(info.width-1,x+shift))*4+2];
      } else if(transform.type==='posterize'){
        // Step luminance only, so tones simplify without neon hue shifts.
        const levels=Math.max(4,Math.round(8-strength*4)),stepped=Math.max(.04,Math.round(luminance*(levels-1))/(levels-1)),amount=Math.min(1,.4+strength*.6);
        const ratio=stepped/Math.max(.04,luminance);
        for(let c=0;c<3;c++)data[i+c]=Math.round(original[i+c]*(1-amount)+Math.min(255,original[i+c]*ratio)*amount);
      } else if(transform.type==='recolour'){
        const mapped=colourAt(colors,luminance),amount=Math.min(.9,.3+strength*.6);
        for(let c=0;c<3;c++)data[i+c]=Math.round(original[i+c]*(1-amount)+mapped[c]*amount);
      } else if(transform.type==='water-flow'){
        // Smooth refraction-like displacement follows two crossing flow bands.
        // Bilinear sampling retains continuous detail and avoids block pixels.
        const dx=Math.sin(y/info.height*Math.PI*5+x/info.width*Math.PI*1.4)*info.width*.045*strength;
        const dy=Math.sin(x/info.width*Math.PI*4-y/info.height*Math.PI*.7)*info.height*.025*strength;
        for(let c=0;c<3;c++)data[i+c]=Math.round(bilinear(original,info.width,info.height,x+dx,y+dy,c));
      } else if(transform.type==='print-grain'){
        // Deterministic simulated paper/reproduction texture, not a physical process.
        const gx=Math.floor(x/cell),gy=Math.floor(y/cell),noise=Math.sin(gx*12.9898+gy*78.233)*43758.5453;
        const grain=(noise-Math.floor(noise)-.5)*90*strength;
        const weave=((gx%4===0?1:0)+(gy%5===0?1:0))*12*strength;
        for(let c=0;c<3;c++)data[i+c]=Math.max(0,Math.min(255,original[i+c]*.94+12+grain-weave));
      } else if(transform.type==='selective-erasure'){
        const wave=.5+.5*Math.sin(x/info.width*13+y/info.height*7+luminance*9);
        const amount=Math.pow(wave,3)*strength*.9,pigment=colourAt(colors,.78);
        for(let c=0;c<3;c++)data[i+c]=Math.round(original[i+c]*(1-amount)+pigment[c]*amount);
      }
    }
    image=sharp(data,{raw:info});
  }
  return {image,strength};
}
const provenance=(transform,strength)=>({...transform,effectiveStrength:strength,simulated:true});
export async function transformImage(store,asset,transform) {
  if(transform.type==='none')return asset;
  const {image,strength}=await treatedImage(store,asset,transform);
  return store.addImage(await image.png().toBuffer(),`${asset.title}-transformed.png`,{
    kind:asset.kind,title:asset.title,caption:asset.caption,locality:asset.locality,contributor:asset.contributor,
    restrictions:asset.restrictions,allowCrop:asset.allowCrop,allowReference:false,allowTransform:asset.allowTransform,
    rootId:asset.rootId||asset.id,derived:{parentId:asset.id,operation:'transform',transform:provenance(transform,strength)},
    ...(asset.generation?{generation:asset.generation}:{})
  });
}
/**
 * Segment → treat → crop. SAM has already cut the untreated image; the whole
 * image is treated so effects keep their scale, then the cut's own crop box and
 * alpha are applied unchanged. Returns PNG bytes and the recorded transform.
 */
export async function treatedCut(store,asset,cut,transform){
  if(!transform||transform.type==='none')return {bytes:await fs.readFile(cut.file),transform:null};
  const {image,strength}=await treatedImage(store,asset,transform);
  const [left,top,right,bottom]=cut.cropBox||[],alpha=await sharp(cut.file).ensureAlpha().extractChannel(3).raw().toBuffer({resolveWithObject:true});
  if(alpha.info.width!==right-left||alpha.info.height!==bottom-top)throw new Error('The cut does not match its recorded crop box.');
  // Chained after any resize, extract crops the treated full-size image.
  const treated=await image.extract({left,top,width:right-left,height:bottom-top}).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const bytes=await sharp(treated.data,{raw:treated.info}).joinChannel(alpha.data,{raw:{width:alpha.info.width,height:alpha.info.height,channels:1}}).png().toBuffer();
  return {bytes,transform:provenance(transform,strength)};
}

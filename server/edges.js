import sharp from 'sharp';
import crypto from 'node:crypto';

// Torn printed-paper edge: the photo is only ever eroded, and a cream paper fringe is laid outside it.
export const TORN_EDGE_VERSION=1;
const PAPER=[239,232,216],PHOTO_ALPHA=224;
export const edgeSeed=text=>crypto.createHash('sha256').update(String(text)).digest().readUInt32BE(0);
export const edgePad=(width,height)=>Math.max(4,Math.min(24,Math.round(Math.max(width,height)*.012)));
function hash(x,y,seed){
 let h=Math.imul(x,0x27d4eb2d)^Math.imul(y,0x165667b1)^seed;
 h=Math.imul(h^h>>>15,0x85ebca6b);h=Math.imul(h^h>>>13,0xc2b2ae35);
 return ((h^h>>>16)>>>0)/4294967296;
}
// Seeded value noise on a lattice of `cell` px, smoothstep-interpolated, in [0,1].
function valueNoise(width,height,cell,seed){
 const gx=Math.ceil(width/cell)+2,gy=Math.ceil(height/cell)+2,lattice=new Float32Array(gx*gy);
 for(let j=0;j<gy;j++)for(let i=0;i<gx;i++)lattice[j*gx+i]=hash(i,j,seed);
 return (x,y)=>{
  const fx=x/cell,fy=y/cell,ix=fx|0,iy=fy|0,k=iy*gx+ix;let tx=fx-ix,ty=fy-iy;tx=tx*tx*(3-2*tx);ty=ty*ty*(3-2*ty);
  const a=lattice[k],b=lattice[k+1],c=lattice[k+gx],d=lattice[k+gx+1];
  return a+(b-a)*tx+(c-a+(d-c-b+a)*tx)*ty;
 };
}
const octaves=(width,height,cell,seed)=>{
 const coarse=valueNoise(width,height,cell,seed),fine=valueNoise(width,height,Math.max(2,cell/4),seed^0x5bd1e995);
 // Value noise clusters near .5; stretch so the full range is used.
 return (x,y)=>Math.max(0,Math.min(1,(coarse(x,y)*.65+fine(x,y)*.35-.5)*2.2+.5));
};
// 4-connected components of mask===value as [start,end,…] spans into `queue`; visited pixels become `seen`.
function components(mask,width,value,seen,queue){
 const n=mask.length,spans=[];let end=0;
 for(let s=0;s<n;s++){
  if(mask[s]!==value)continue;
  const start=end;mask[s]=seen;queue[end++]=s;
  for(let q=start;q<end;q++){
   const i=queue[q],x=i%width;
   if(x>0&&mask[i-1]===value){mask[i-1]=seen;queue[end++]=i-1;}
   if(x<width-1&&mask[i+1]===value){mask[i+1]=seen;queue[end++]=i+1;}
   if(i>=width&&mask[i-width]===value){mask[i-width]=seen;queue[end++]=i-width;}
   if(i<n-width&&mask[i+width]===value){mask[i+width]=seen;queue[end++]=i+width;}
  }
  spans.push(start,end);
 }
 return spans;
}
// Papered, small photo islands read as confetti and small holes as paper specks: islands under
// minArea are dropped (the largest always stays) and holes under minArea revert to the untouched cut.
function tidy(mask,width,minArea){
 const queue=new Int32Array(mask.length);let spans,largest=0;
 const assign=(test,yes,no)=>{for(let j=0;j<spans.length;j+=2){const v=test(j,spans[j+1]-spans[j])?yes:no;for(let q=spans[j];q<spans[j+1];q++)mask[queue[q]]=v;}};
 spans=components(mask,width,0,1,queue);
 for(let j=0;j<spans.length;j+=2)largest=Math.max(largest,spans[j+1]-spans[j]);
 assign((j,area)=>area<Math.min(minArea,largest),255,0);
 // The first background component holds the canvas corner: the outside, never a hole.
 spans=components(mask,width,255,254,queue);
 assign((j,area)=>j>0&&area<minArea,0,255);
 return mask;
}
// Two-pass 5-7 chamfer distance (×5 px, saturating at 255) from the zero pixels of `d`.
function chamfer(d,width,height){
 for(let y=0;y<height;y++)for(let x=0,i=y*width;x<width;x++,i++){
  let v=d[i];if(!v)continue;
  if(x>0&&d[i-1]+5<v)v=d[i-1]+5;
  if(y>0){const u=i-width;if(d[u]+5<v)v=d[u]+5;if(x>0&&d[u-1]+7<v)v=d[u-1]+7;if(x<width-1&&d[u+1]+7<v)v=d[u+1]+7;}
  d[i]=v;
 }
 for(let y=height-1;y>=0;y--)for(let x=width-1,i=y*width+x;x>=0;x--,i--){
  let v=d[i];if(!v)continue;
  if(x<width-1&&d[i+1]+5<v)v=d[i+1]+5;
  if(y<height-1){const u=i+width;if(d[u]+5<v)v=d[u]+5;if(x<width-1&&d[u+1]+7<v)v=d[u+1]+7;if(x>0&&d[u-1]+7<v)v=d[u-1]+7;}
  d[i]=v;
 }
 return d;
}
/**
 * Tears a cut fragment in memory. Returns padded RGBA plus `distance`: 0 on kept photo
 * pixels (exact input RGB and alpha), else 5× the chamfer distance to the photo.
 */
export async function tornLayers(bytes,{seed=0}={}){
 seed>>>=0;
 const meta=await sharp(bytes).metadata(),pad=edgePad(meta.width,meta.height),size=Math.max(meta.width,meta.height);
 const {data:rgba,info}=await sharp(bytes).ensureAlpha().toColourspace('srgb').extend({top:pad,bottom:pad,left:pad,right:pad,background:{r:0,g:0,b:0,alpha:0}}).raw().toBuffer({resolveWithObject:true});
 const W=info.width,H=info.height,n=W*H,alpha=Buffer.alloc(n);
 for(let i=0;i<n;i++)alpha[i]=rgba[i*4+3];
 // Torn scale follows the image: roughness cells ~1% of the long side, erosion up to ~half the pad.
 const sigma=Math.max(.8,pad*.3);
 const blurred=await sharp(alpha,{raw:{width:W,height:H,channels:1}}).blur(sigma).toColourspace('b-w').raw().toBuffer();
 const tear=octaves(W,H,Math.max(4,size*.01),seed),breadth=octaves(W,H,Math.max(8,size*.05),seed^0x9e3779b9);
 const fibre=valueNoise(W,H,Math.max(2,size*.0015),seed^0x85ebca6b),grain=valueNoise(W,H,Math.max(2,size*.002),seed^0xc2b2ae35);
 const low=132,high=246,distance=new Uint8ClampedArray(n);
 for(let y=0,i=0;y<H;y++)for(let x=0;x<W;x++,i++){
  const b=blurred[i];
  distance[i]=alpha[i]>=PHOTO_ALPHA&&(b>=high||b>low&&b>low+(high-low)*tear(x,y))?0:255;
 }
 chamfer(tidy(distance,W,(2.5*pad)**2),W,H);
 for(let y=0,i=0;y<H;y++)for(let x=0;x<W;x++,i++){
  const dv=distance[i];if(!dv)continue;
  const o=i*4,d=dv/5;
  // Fringe 0.25–1× pad wide, mostly thin, with a fibrous outer rim, capped so it stays inside the padding.
  const rim=dv===255?0:Math.min(pad-.5,pad*(.25+.75*breadth(x,y)**2)+(fibre(x,y)-.5)*pad*.25+(hash(x,y,seed^0x27d4eb2d)-.5)*1.2);
  const cover=rim-d+.5;
  if(cover<=0){rgba[o]=rgba[o+1]=rgba[o+2]=rgba[o+3]=0;continue;}
  const shade=(grain(x,y)-.5)*10+(hash(x,y,seed^0x165667b1)-.5)*7-(d<2?4:0);
  // Where the eroded photo lies beneath, its ink bleeds faintly into the first paper pixel.
  const ink=alpha[i]>=PHOTO_ALPHA?Math.max(0,.35-.5*(d-1)):0;
  for(let c=0;c<3;c++)rgba[o+c]=Math.max(0,Math.min(255,Math.round((PAPER[c]+shade)*(1-ink)+rgba[o+c]*ink)));
  rgba[o+3]=cover>=1?255:Math.round(255*cover);
 }
 return {data:rgba,width:W,height:H,pad,distance};
}
export async function tornEdge(bytes,{seed=0}={}){
 const {data,width,height,pad}=await tornLayers(bytes,{seed});
 return {bytes:await sharp(data,{raw:{width,height,channels:4}}).png().toBuffer(),edge:{style:'torn',seed:seed>>>0,pad,version:TORN_EDGE_VERSION}};
}

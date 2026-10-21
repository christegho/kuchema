import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {tornEdge,tornLayers,edgeSeed,edgePad} from '../server/edges.js';

// An ellipse-masked gradient with no cream colours (red stays below 120), so paper is unmistakable.
const W=1000,H=700,CX=500,CY=350,RX=400,RY=270;
async function fragment(){
 const data=Buffer.alloc(W*H*3);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*3;data[i]=20+x%100;data[i+1]=60+y%90;data[i+2]=110+(x+y)%80;}
 const mask=Buffer.from(`<svg width="${W}" height="${H}"><ellipse cx="${CX}" cy="${CY}" rx="${RX}" ry="${RY}" fill="white"/></svg>`);
 return sharp(data,{raw:{width:W,height:H,channels:3}}).ensureAlpha().composite([{input:mask,blend:'dest-in'}]).png().toBuffer();
}
test('torn edges are deterministic per seed and seeds come from a stable hash',async()=>{
 const bytes=await fragment(),[a,b,c]=await Promise.all([tornEdge(bytes,{seed:11}),tornEdge(bytes,{seed:11}),tornEdge(bytes,{seed:12})]);
 assert.ok(a.bytes.equals(b.bytes));assert.ok(!a.bytes.equals(c.bytes));
 const seed=edgeSeed('parent:F01');
 assert.ok(Number.isInteger(seed)&&seed>=0&&seed<2**32);assert.equal(edgeSeed('parent:F01'),seed);assert.notEqual(edgeSeed('parent:F02'),seed);
});
test('the torn image is padded on every side and records its edge',async()=>{
 const {bytes,edge}=await tornEdge(await fragment(),{seed:3}),meta=await sharp(bytes).metadata();
 assert.deepEqual(edge,{style:'torn',seed:3,pad:12,version:1});
 assert.equal(meta.format,'png');assert.equal(meta.width,W+24);assert.equal(meta.height,H+24);assert.equal(meta.channels,4);
 assert.deepEqual([edgePad(100,50),edgePad(1000,800),edgePad(2048,1365),edgePad(4096,2731)],[4,12,24,24]);
});
test('photo pixels are only ever eroded: kept pixels keep their exact colour and alpha',async()=>{
 const bytes=await fragment(),layers=await tornLayers(bytes,{seed:5}),{pad,width,data,distance}=layers;
 const source=await sharp(bytes).ensureAlpha().raw().toBuffer(),output=await sharp((await tornEdge(bytes,{seed:5})).bytes).raw().toBuffer();
 assert.ok(output.equals(data));
 let kept=0,eroded=0,bad=0;
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const i=(y+pad)*width+x+pad,o=i*4,s=(y*W+x)*4;
  if(distance[i]===0&&data[o+3]>0){kept++;if(source[s+3]===0||data[o+3]!==source[s+3]||data[o]!==source[s]||data[o+1]!==source[s+1]||data[o+2]!==source[s+2])bad++;}
  else if(source[s+3]===255)eroded++;
 }
 for(let i=0;i<distance.length;i++){const x=i%width-pad,y=Math.floor(i/width)-pad;if(!distance[i]&&data[i*4+3]&&(x<0||y<0||x>=W||y>=H))bad++;}
 assert.equal(bad,0);assert.ok(kept>Math.PI*RX*RY*.9,`${kept} kept`);assert.ok(eroded>500,`${eroded} eroded`);
});
test('a near-opaque cream fringe lies outside the eroded photo, inside the padding, with a solid interior',async()=>{
 const {pad,width,height,data,distance}=await tornLayers(await fragment(),{seed:9});
 let paper=0,opaque=0,cover=0,beyond=0,stray=0,grey=0,hollow=0;
 for(let y=0,i=0;y<height;y++)for(let x=0;x<width;x++,i++){
  const o=i*4,a=data[o+3];
  if(a&&(x===0||y===0||x===width-1||y===height-1))stray++;
  if(distance[i]===0||!a)continue;
  paper++;cover+=a/255;if(a===255)opaque++;if(distance[i]/5>pad)stray++;
  const u=(x-pad-CX)/RX,v=(y-pad-CY)/RY;if(u*u+v*v>1)beyond++;
  if(distance[i]>=10&&!(data[o]>200&&data[o+1]>190&&data[o+2]>170))grey++;
 }
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const u=(x-pad-CX)/(RX-3*pad),v=(y-pad-CY)/(RY-3*pad),i=y*width+x;
  if(u*u+v*v<=1&&(distance[i]!==0||data[i*4+3]!==255))hollow++;
 }
 assert.ok(paper>2*(RX+RY)*pad*.3,`${paper} paper`);assert.ok(beyond>paper*.2,`${beyond} beyond the cut`);
 // Only the fibrous outermost rim is partly transparent: no halo.
 assert.ok(opaque>paper*.8,`${opaque}/${paper} opaque`);assert.ok(cover>paper*.9,`${cover/paper} mean alpha`);
 assert.equal(stray,0);assert.equal(grey,0);assert.equal(hollow,0);
});
test('transparent and tiny fragments still return a valid padded PNG',async()=>{
 const empty=await sharp({create:{width:50,height:40,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer();
 const blank=await tornEdge(empty,{seed:1}),pixels=await sharp(blank.bytes).raw().toBuffer({resolveWithObject:true});
 assert.equal(pixels.info.width,58);assert.equal(pixels.info.height,48);assert.ok(pixels.data.every((v,i)=>i%4!==3||v===0));
 for(const [w,h] of [[1,1],[6,5]]){
  const {bytes,edge}=await tornEdge(await sharp({create:{width:w,height:h,channels:3,background:'#336699'}}).png().toBuffer(),{seed:2}),meta=await sharp(bytes).metadata();
  assert.equal(edge.pad,4);assert.equal(meta.width,w+8);assert.equal(meta.height,h+8);
 }
});

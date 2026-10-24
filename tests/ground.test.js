import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {canvasGround,DEFAULT_GROUND} from '../shared/ground.js';
import {renderCollage} from '../server/compose.js';

test('the ground is always the pale blue from the centre of paleblue.jpeg, whatever a model or saved project chose',async()=>{
  assert.equal(DEFAULT_GROUND,'#d4e4f4');
  for(const colour of ['#ffffff','#eeeedd','#183f3b','#68764a','#242424','#000000',undefined,'not a colour'])assert.equal(canvasGround(colour),'#d4e4f4');
  // The colour is the mean of the reference's central 2%.
  const meta=await sharp('paleblue.jpeg').metadata(),w=Math.round(meta.width*.02),h=Math.round(meta.height*.02);
  const data=await sharp('paleblue.jpeg').extract({left:Math.round((meta.width-w)/2),top:Math.round((meta.height-h)/2),width:w,height:h}).removeAlpha().raw().toBuffer();
  const mean=[0,1,2].map(c=>{let n=0;for(let i=c;i<data.length;i+=3)n+=data[i];return Math.round(n/(data.length/3));});
  assert.equal('#'+mean.map(v=>v.toString(16).padStart(2,'0')).join(''),DEFAULT_GROUND);
});

test('server exports fill transparent cuts and canvas edges without recolouring photographic whites',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'kuchema-ground-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'media'));
  // A white photographic detail surrounded by a transparent cut boundary.
  await sharp({create:{width:100,height:100,channels:4,background:'#00000000'}})
    .composite([{input:await sharp({create:{width:20,height:20,channels:4,background:'#ffffff'}}).png().toBuffer(),left:40,top:40}])
    .png().toFile(path.join(root,'media','fragment.png'));
  // A project saved before the panorama keeps its 1600 × 1000 canvas and 2400 × 1500 output.
  const project={background:'#ffffff',layers:[{assetId:'fragment',visible:true,x:0,y:0,width:100,height:100,rotation:0,opacity:1}]};
  await renderCollage({root},project,'output');
  const legacy=await sharp(path.join(root,'media','output.png')).metadata();assert.deepEqual([legacy.width,legacy.height],[2400,1500]);
  const pixel=async(left,top)=>'#'+(await sharp(path.join(root,'media','output.png')).extract({left,top,width:1,height:1}).removeAlpha().raw().toBuffer()).toString('hex');
  assert.equal(await pixel(0,0),DEFAULT_GROUND);
  assert.equal(await pixel(2399,1499),DEFAULT_GROUND);
  assert.equal(await pixel(75,75),'#ffffff');
});

test('panoramic masters are exactly 5760 × 1080 PNG, at least 15 MB, on pale blue, without stretching fragments',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'kuchema-panorama-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'media'));
  // A 300 × 100 striped fragment drawn at 600 × 200 must keep its 3:1 proportions.
  await sharp({create:{width:300,height:100,channels:4,background:'#ffffff'}}).composite([{input:await sharp({create:{width:150,height:100,channels:4,background:'#ff0000'}}).png().toBuffer(),left:0,top:0}]).png().toFile(path.join(root,'media','stripe.png'));
  const project={canvas:{width:5760,height:1080},background:'#183f3b',layers:[{assetId:'stripe',visible:true,x:1000,y:400,width:600,height:200,rotation:0,opacity:1}]};
  await renderCollage({root},project,'panorama',{master:true});
  const file=path.join(root,'media','panorama.png'),meta=await sharp(file).metadata();
  assert.deepEqual([meta.width,meta.height,meta.format,meta.channels],[5760,1080,'png',3]);
  // Lossless and uncompressed: the master is always at least 15 MB, and a lighter preview sits beside it.
  assert.ok((await fs.stat(file)).size>=15e6);const preview=await sharp(path.join(root,'media','panorama-preview.jpg')).metadata();assert.deepEqual([preview.width,preview.format],[2880,'jpeg']);
  const pixel=async(left,top)=>'#'+(await sharp(file).extract({left,top,width:1,height:1}).removeAlpha().raw().toBuffer()).toString('hex');
  assert.equal(await pixel(0,0),'#d4e4f4');assert.equal(await pixel(5759,1079),'#d4e4f4');
  assert.equal(await pixel(1299,500),'#ff0000');assert.equal(await pixel(1301,500),'#ffffff');assert.equal(await pixel(1300,601),'#d4e4f4');
});

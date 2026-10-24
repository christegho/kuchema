import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {canvasGround,DEFAULT_GROUND} from '../shared/ground.js';
import {renderCollage} from '../server/compose.js';

test('the ground is always pure black, whatever a model or saved project chose',()=>{
  assert.equal(DEFAULT_GROUND,'#000000');
  for(const colour of ['#ffffff','#eeeedd','#183f3b','#68764a','#242424','#000000',undefined,'not a colour'])assert.equal(canvasGround(colour),'#000000');
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

test('panoramic projects render at exactly 5760 × 1080 on black, as PNG, without stretching fragments',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'kuchema-panorama-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'media'));
  // A 300 × 100 striped fragment drawn at 600 × 200 must keep its 3:1 proportions.
  await sharp({create:{width:300,height:100,channels:4,background:'#ffffff'}}).composite([{input:await sharp({create:{width:150,height:100,channels:4,background:'#ff0000'}}).png().toBuffer(),left:0,top:0}]).png().toFile(path.join(root,'media','stripe.png'));
  const project={canvas:{width:5760,height:1080},background:'#183f3b',layers:[{assetId:'stripe',visible:true,x:1000,y:400,width:600,height:200,rotation:0,opacity:1}]};
  await renderCollage({root},project,'panorama');
  const file=path.join(root,'media','panorama.png'),meta=await sharp(file).metadata();
  assert.deepEqual([meta.width,meta.height,meta.format],[5760,1080,'png']);
  const pixel=async(left,top)=>'#'+(await sharp(file).extract({left,top,width:1,height:1}).removeAlpha().raw().toBuffer()).toString('hex');
  assert.equal(await pixel(0,0),'#000000');assert.equal(await pixel(5759,1079),'#000000');
  assert.equal(await pixel(1299,500),'#ff0000');assert.equal(await pixel(1301,500),'#ffffff');assert.equal(await pixel(1300,601),'#000000');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {canvasGround,DEFAULT_GROUND} from '../shared/ground.js';
import {renderCollage} from '../server/compose.js';

test('white and pale grounds become water green; darker water and earth colours remain',()=>{
  for(const colour of ['#ffffff','#FFFFFF','#f5f5f2','#eeeedd','#e7e5db','#cccccc',undefined])assert.equal(canvasGround(colour),DEFAULT_GROUND);
  for(const colour of [DEFAULT_GROUND,'#68764a','#9c6b40','#242424'])assert.equal(canvasGround(colour),colour);
});

test('server exports fill transparent cuts and canvas edges without recolouring photographic whites',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'kuchema-ground-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'media'));
  // A white photographic detail surrounded by a transparent cut boundary.
  await sharp({create:{width:100,height:100,channels:4,background:'#00000000'}})
    .composite([{input:await sharp({create:{width:20,height:20,channels:4,background:'#ffffff'}}).png().toBuffer(),left:40,top:40}])
    .png().toFile(path.join(root,'media','fragment.png'));
  const project={background:'#ffffff',layers:[{assetId:'fragment',visible:true,x:0,y:0,width:100,height:100,rotation:0,opacity:1}]};
  await renderCollage({root},project,'output');
  const pixel=async(left,top)=>'#'+(await sharp(path.join(root,'media','output.png')).extract({left,top,width:1,height:1}).removeAlpha().raw().toBuffer()).toString('hex');
  assert.equal(await pixel(0,0),DEFAULT_GROUND);
  assert.equal(await pixel(2399,1499),DEFAULT_GROUND);
  assert.equal(await pixel(75,75),'#ffffff');
});

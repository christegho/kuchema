import test from 'node:test';
import assert from 'node:assert/strict';
import {SIZE_LIMITS,limitLayer,sizeReport,sizeRange} from '../server/scale.js';
import {CANVAS,LEGACY_CANVAS} from '../shared/canvas.js';

const W=CANVAS.width,H=CANVAS.height;
// Large sources, so only the size rules (not sharpness) decide.
const person={asset:{kind:'source',width:3000,height:4000}},field={asset:{kind:'generated',width:3100,height:1330,derived:{boundary:'field'}},tier:'small'};
const detail=tier=>({asset:{kind:'generated',width:3000,height:2000,derived:{boundary:'silhouette'}},tier});
const layer=(width,height,x=2000,y=200,rotation=0)=>({x,y,width,height,rotation});
const share=l=>l.height/H,inside=l=>l.x>=-1e-6&&l.y>=-1e-6&&l.x+l.width<=W+1e-6&&l.y+l.height<=H+1e-6;

test('people stand 45–80% of the canvas height and stay entirely inside the frame',()=>{
 for(const [width,height] of [[300,400],[1200,1600],[3000,4000]]){
  const l=limitLayer(layer(width,height),person,CANVAS);
  assert.ok(share(l)>=.45-1e-9&&share(l)<=.8+1e-9,`${height}px → ${share(l)}`);assert.ok(Math.abs(l.width/l.height-.75)<1e-9);
 }
 // A figure placed off the bottom-right corner is moved back inside, not cropped.
 const edge=limitLayer(layer(600,800,5600,700),person,CANVAS);assert.ok(inside(edge));assert.equal(edge.height,800);
 // A wide group is held to a third of the width even if that leaves it below 45% of the height.
 const group=limitLayer(layer(6000,1000),{asset:{kind:'source',width:6000,height:1000}},CANVAS);
 assert.ok(group.width<=W*SIZE_LIMITS.people.width+1e-6);
});

test('small, medium and dominant fragments land in their height ranges within their width caps',()=>{
 for(const tier of ['small','medium','dominant']){
  const {height:[min,max],width:widest}=SIZE_LIMITS[tier];
  for(const height of [40,600,3000]){const l=limitLayer(layer(height*1.5,height),detail(tier),CANVAS);assert.ok(share(l)>=min-1e-9&&share(l)<=max+1e-9,`${tier} ${height}`);assert.ok(l.width<=widest*W+1e-6);}
 }
 // Field crops are ground: even when planned small they reach at least medium size and may grow to landscape size.
 assert.deepEqual(sizeRange(field).height,[SIZE_LIMITS.medium.height[0],SIZE_LIMITS.dominant.height[1]]);
 assert.ok(share(limitLayer(layer(300,130),field,CANVAS))>=.4-1e-9);
});

test('sharpness wins over the minimum: a small source is never enlarged beyond twice its pixels, and is reported',()=>{
 const tiny={asset:{kind:'source',width:150,height:200}},l=limitLayer(layer(150,200),tiny,CANVAS);
 assert.equal(l.height,400);assert.ok(share(l)<.45);
 const report=sizeReport({layers:[{...l,assetId:'a',name:'Small archive figure',visible:true}]},[{...tiny,asset:{...tiny.asset,id:'a'}}],CANVAS);
 assert.deepEqual(report,{below:['Small archive figure'],above:[]});
});

test('the area cap holds, and legacy 1600 × 1000 projects keep only the area and sharpness caps',()=>{
 const huge=limitLayer(layer(5000,1300),{asset:{kind:'generated',width:5000,height:1300,derived:{boundary:'field'}},tier:'dominant'},CANVAS);
 assert.ok(huge.width*huge.height<=.58*W*H+1);
 const legacy=layer(400,300,100,100),kept=limitLayer(legacy,person,LEGACY_CANVAS,{sizes:false});assert.deepEqual(kept,legacy);
 const capped=limitLayer(layer(1600,1600,0,0),person,LEGACY_CANVAS,{sizes:false});assert.ok(capped.width*capped.height<=.58*1600*1000+1);
});

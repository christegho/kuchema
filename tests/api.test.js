import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import sharp from 'sharp';
import { createStore } from '../server/store.js';
import { createApp } from '../server/app.js';

async function fixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'situated-test-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const store=await createStore(dir), app=createApp(store);
  const bytes=await sharp({create:{width:120,height:80,channels:3,background:'#e3b53a'}}).png().toBuffer();
  return {dir,store,app,bytes};
}
const layer=a=>({id:'test-layer',assetId:a.id,name:'Source',kind:a.kind,x:50,y:50,width:240,height:160,rotation:0,opacity:1,shape:'rectangle',points:[],crop:{x:0,y:0,zoom:1},visible:true,locked:false,note:''});
const project=layers=>({title:'Test',brief:'Follow the water',strategy:'atlas',background:'#eeeedd',layers,evidence:null});

test('uploads are normalized, deduplicated, retained and reopened with saved layer provenance',async t=>{
  const {dir,app,bytes}=await fixture(t);
  const first=await request(app).post('/api/archive/upload').attach('images',bytes,'sample.png').expect(200);
  const a=first.body.assets[0];assert.equal(a.allowReference,false);assert.equal(a.width,120);
  const second=await request(app).post('/api/archive/upload').attach('images',bytes,'another-name.png').expect(200);
  assert.equal(second.body.assets[0].id,a.id);
  const p=project([layer(a)]);
  await request(app).put('/api/project').send(p).expect(200);
  const reopened=await createStore(dir);assert.deepEqual(reopened.state.project,p);assert.equal(reopened.state.assets.length,1);
  await request(app).get(a.url).expect(200).expect('Content-Type',/image\/png/);
  const provenance=await request(app).get('/api/provenance').expect(200);
  assert.equal(provenance.body.project.layers[0].assetId,a.id);
  assert.equal(provenance.body.assets[0].original,undefined);
});
test('crop restrictions and source types are enforced on the server',async t=>{
  const {store,app,bytes}=await fixture(t);const a=await store.addImage(bytes,'source.png',{allowCrop:false});
  await request(app).put('/api/project').send(project([{...layer(a),shape:'torn'}])).expect(400);
  await request(app).put('/api/project').send(project([{...layer(a),crop:{x:0,y:0,zoom:2}}])).expect(400);
  await request(app).put('/api/project').send(project([{...layer(a),kind:'generated'}])).expect(400);
  await request(app).put('/api/project').send(project([layer(a)])).expect(200);
});
test('legacy paid endpoints cannot bypass the creation budget',async t=>{
  const {store,app}=await fixture(t);
  const blocked=await request(app).post('/api/ai/generate').send({prompt:'A water study'}).expect(410);
  assert.match(blocked.body.error,/budgeted/);
  await request(app).post('/api/ai/analyze').send({}).expect(410);
  assert.equal(store.state.usage.length,0);
});
test('invalid files, missing source references, invalid geometry and cross-origin changes are rejected',async t=>{
  const {app}=await fixture(t);
  await request(app).post('/api/archive/upload').attach('images',Buffer.from('<svg onload="alert(1)"></svg>'),'bad.svg').expect(400);
  await request(app).put('/api/project').send(project([layer({id:'unknown',kind:'source'})])).expect(400);
  await request(app).put('/api/project').send(project([{...layer({id:'unknown',kind:'source'}),width:-1}])).expect(400);
  await request(app).put('/api/project').set('Origin','https://unrelated.example').send(project([])).expect(403);
  await request(app).get('/media/studio.json').expect(404);
  await request(app).get('/api/unknown').expect(404);
});
test('metadata updates preserve human captions separately from automatic visual notes',async t=>{
  const {store,app,bytes}=await fixture(t);const a=await store.addImage(bytes,'source.png',{aiCaption:'Visible water.'});
  const updated=await request(app).patch(`/api/archive/${a.id}`).send({...a,caption:'This pool is where we meet.',locality:'Contributor-provided locality',allowReference:true}).expect(200);
  assert.equal(updated.body.aiCaption,'Visible water.');assert.equal(updated.body.caption,'This pool is where we meet.');assert.equal(updated.body.allowReference,true);
});
test('brief-derived prompts are returned and an edited system prompt persists',async t=>{
  const {app,store}=await fixture(t);
  const initial=await request(app).get('/api/studio').expect(200);
  assert.match(initial.body.context.defaultPrompt,/water connects land/i);
  assert.match(initial.body.context.systemPrompt,/Kuchema: The Gathering/);
  assert.equal(initial.body.systemPrompt,initial.body.context.systemPrompt);
  await request(app).put('/api/context').send({text:'A contributor account.',systemPrompt:'Keep water, land and collective life in a precise material relation.'}).expect(200);
  assert.equal(store.state.systemPrompt,'Keep water, land and collective life in a precise material relation.');
  const reopened=await request(app).get('/api/studio').expect(200);
  assert.equal(reopened.body.systemPrompt,store.state.systemPrompt);
});
test('failed collage parts expose retry and ignore actions',async t=>{
  const {store}=await fixture(t),calls=[];
  const job={id:'study-1',failedParts:[{key:'F07',status:'failed'}]};store.state.creations=[job];
  const pipeline={status:async()=>({ready:true,activeId:null,maxCost:1}),vision:{close(){}},retryPart:async(id,key)=>{calls.push(['retry',id,key]);return job;},ignorePart:async(id,key)=>{calls.push(['ignore',id,key]);return job;}};
  const app=createApp(store,{pipeline});
  await request(app).post('/api/creations/study-1/failed-parts/F07/retry').expect(200);
  await request(app).post('/api/creations/study-1/failed-parts/F07/ignore').expect(200);
  assert.deepEqual(calls,[['retry','study-1','F07'],['ignore','study-1','F07']]);
});

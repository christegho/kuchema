import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createStore} from '../server/store.js';
import {archiveCategory,archiveCounts,selectOfficialArchive} from '../server/archive.js';

test('recursive official import classifies folders, deduplicates, preserves edits and retires missing sources',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'official-archive-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const dir=path.join(root,'archive'),store=await createStore(path.join(root,'data'));
 const names=['general.JPG','Chikukwa Water Sites/water.png','Chikukwa Water Sites/sacred water sites/sacred.png','people/person.png','collages-style-guide/chipo/collage.png'];
 const bytes=[];
 for(const [i,name] of names.entries()){
  const buffer=await sharp({create:{width:24,height:16,channels:3,background:{r:i*40,g:100,b:150}}}).png().toBuffer();bytes.push(buffer);
  await fs.mkdir(path.dirname(path.join(dir,name)),{recursive:true});await fs.writeFile(path.join(dir,name),buffer);
 }
 const old=await store.addImage(await sharp({create:{width:25,height:17,channels:3,background:'#555'}}).png().toBuffer(),'old-sample.png');
 await fs.writeFile(path.join(dir,'duplicate-person.png'),bytes[3]);
 await fs.writeFile(path.join(dir,'.DS_Store'),'ignored');
 await fs.writeFile(path.join(dir,'broken.jpg'),'not an image');
 const result=await store.importOfficialArchive(dir);
 assert.equal(result.count,5);assert.equal(result.errors.length,1);assert.equal(old.archive,undefined);
 const active=store.state.assets.filter(a=>a.archive?.active);
 assert.deepEqual(active.map(a=>a.archive.category).sort(),['composition','general','people','water','water']);
 const person=active.find(a=>a.archive.category==='people');assert.equal(person.archive.paths.length,2);assert.equal(person.allowCrop,true);assert.equal(person.allowReference,false);
 assert.ok(active.find(a=>a.archive.sacred)?.allowReference);
 assert.equal(active.find(a=>a.archive.category==='composition').allowReference,false);
 assert.ok(active.filter(a=>['general','water'].includes(a.archive.category)).every(a=>a.allowReference&&!a.allowCrop));
 person.allowCrop=false;person.caption='Keep this contributor caption';await store.persist();
 await fs.unlink(path.join(dir,names[1]));await store.importOfficialArchive(dir);
 assert.equal(store.state.assets.length,6);assert.equal(person.allowCrop,false);assert.equal(person.caption,'Keep this contributor caption');
 assert.equal(active.find(a=>a.archive.paths.includes(names[1])).archive.active,false);
 assert.equal((await createStore(store.root)).state.officialArchive.directory,dir);
});

const pool=()=>['general','water','composition','people'].flatMap(category=>Array.from({length:12},(_,i)=>({id:`${category}-${i}`,kind:'source',archive:{active:true,category,sacred:category==='water'&&i%2===0},allowReference:true,allowCrop:true})));
const job=count=>({count,includePeople:true,includeArchive:true,useReferences:true,ids:[]});
test('category sampling is random without replacement, scales across 6–20, and uses every selected reference',()=>{
 const assets=pool();
 assert.equal(archiveCategory('Chikukwa Water Sites/sacred water sites/IMG.JPG'),'water');
 assert.equal(archiveCategory('collages-style-guide/chipo/style.JPG'),'composition');
 assert.notDeepEqual(selectOfficialArchive(assets,job(6),()=>0).selected,selectOfficialArchive(assets,job(6),n=>n-1).selected);
 for(let count=6;count<=20;count++){
  const selection=selectOfficialArchive(assets,job(count)),counts=archiveCounts(count);
  for(const [category,images] of Object.entries(selection.selected)){assert.equal(images.length,counts[category]);assert.equal(new Set(images.map(a=>a.id)).size,images.length);}
  assert.equal(selection.archive.length+selection.generatedCount,count);
  const used=new Set(Object.values(selection.referenceAssignments).flat());
  assert.deepEqual([...used].sort(),[...selection.selected.general,...selection.selected.water].map(a=>a.id).sort());
 }
});
test('official selection excludes legacy/derived sources, respects selection and permission, and requires at least two people',()=>{
 const assets=pool();assets.push({...assets[0],id:'derived',derived:{parentId:'general-0'}});
 const ids=assets.filter(a=>a.archive.category!=='people'||a.id==='people-0'||a.id==='people-1').map(a=>a.id);
 const result=selectOfficialArchive(assets,{...job(6),ids});assert.equal(result.archive.length,2);assert.equal(result.generatedCount,4);
 assert.equal(result.contextArchive.some(a=>a.id==='derived'),false);
 assets.find(a=>a.id==='people-1').allowCrop=false;
 assert.throws(()=>selectOfficialArchive(assets,{...job(6),ids}),/at least 2 people/);
 const noPeople=selectOfficialArchive(assets,{...job(6),includePeople:false,includeArchive:false});
 assert.equal(noPeople.archive.length,0);assert.equal(noPeople.generatedCount,6);
 const noGeneral=assets.map(a=>({...a,allowReference:a.archive.category!=='general'}));
 assert.throws(()=>selectOfficialArchive(noGeneral,job(6)),/at least 2 general/);
});

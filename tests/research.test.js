import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {researchLibrary,selectResearch,researchAssignments,validateResearchPlan,auditResearchParts} from '../server/research.js';
import {projectContext,syncProjectContext,ARCHIVE_IMAGE_RULES} from '../server/context.js';
import {creationInput} from '../server/plan.js';

// R0–R5 are speculative texts (scripts/); R6–R10 are research papers (papers/).
const documents=Array.from({length:11},(_,i)=>({id:`R${i}`,checksum:`hash-${i}`,status:'ready',title:i===8?'Youth river planting':'Water cosmologies',filename:`source-${i}.${i<6?'txt':'pdf'}`,relativePath:`training-data/${i<6?'scripts':'papers'}/source-${i}.${i<6?'txt':'pdf'}`,format:i<6?'txt':'pdf',url:`/api/research/R${i}/file`,passages:[{location:'lines 1–3',excerpt:i===8?'Youth river planting and community restoration protect the banks.':'Water and earth have different relationships in each situated account.'}]}));
async function directory(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kuchema-research-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.mkdir(path.join(dir,'training-data','scripts'),{recursive:true});return dir;}

test('research selection takes 6–10 files with at least three speculative texts and three papers',()=>{
  const isText=id=>Number(id.slice(1))<6;
  for(const researchCount of [6,10]){
    const chosen=selectResearch(documents,{prompt:'Youth river planting',researchCount});
    assert.equal(chosen.length,researchCount);assert.equal(chosen[0].id,'R8');
    assert.equal(new Set(chosen.map(d=>d.id)).size,researchCount);
    assert.ok(chosen.filter(d=>isText(d.id)).length>=3&&chosen.filter(d=>!isText(d.id)).length>=3);
    // Each led slot gets exactly one distinct text; papers lead no image.
    const assigned=researchAssignments(chosen,6,3);assert.deepEqual(Object.keys(assigned),['F04','F05','F06']);
    assert.ok(Object.values(assigned).every(ids=>ids.length===1&&isText(ids[0])));assert.equal(new Set(Object.values(assigned).flat()).size,3);
    // More selected texts lead more images, up to the number generated.
    const texts=chosen.filter(d=>isText(d.id)).length;assert.equal(Object.keys(researchAssignments(chosen,10,6)).length,Math.min(texts,6));
  }
  for(const researchCount of [5,11,6.5])assert.throws(()=>selectResearch(documents,{prompt:'water',researchCount}),/between 6 and 10/);
  assert.throws(()=>selectResearch([documents[0],{...documents[0],id:'copy'}],{prompt:'water',researchCount:6}),/distinct readable/);
  assert.throws(()=>selectResearch(documents,{prompt:'water',researchCount:6,researchIds:['R0']}),/Need 6/);
  assert.throws(()=>selectResearch(documents,{prompt:'water',researchCount:6,researchIds:['R0','R1','R2','R3','R4','R5']}),/at least 3 speculative texts and 3 research papers; this selection has 6 and 0/);
  assert.throws(()=>selectResearch(documents,{prompt:'water',researchCount:6,researchIds:['missing','R0']}),/missing or unreadable/);
  assert.throws(()=>selectResearch(documents,{prompt:'water',researchCount:6,researchIds:['R0','R0']}),/distinct/);
  // The non-disclosure testimony never counts towards the texts that lead images.
  const boundary={...documents[0],id:'B',checksum:'boundary',filename:'water-rituals-for-combatting-pests.txt',relativePath:'training-data/scripts/water-rituals-for-combatting-pests.txt',title:'Youth river planting'};
  const pool=[boundary,documents[0],documents[1],documents[2],...documents.slice(6)],picked=selectResearch(pool,{prompt:'Youth river planting',researchCount:7});
  assert.ok(picked.some(d=>d.id==='B'));assert.ok(!Object.values(researchAssignments(picked,6,3)).flat().includes('B'));
  assert.throws(()=>selectResearch([boundary,documents[0],documents[1],...documents.slice(6)],{prompt:'water',researchCount:6}),/this selection has 2 and 5/);
  assert.throws(()=>researchAssignments(documents,6,2),/3 generated collage parts/);
  assert.equal(creationInput.shape.researchCount.parse(undefined),6);
  for(const count of [5,11])assert.equal(creationInput.shape.researchCount.safeParse(count).success,false);
});

test('archive indexes TXT/PDF with stable provenance, refreshes edits and reports unreadable files',async t=>{
  const dir=await directory(t),folder=path.join(dir,'training-data','scripts');
  await fs.writeFile(path.join(folder,'test.txt'),'\uFEFFWater testimony\r\n\r\n\r\nRiver planting protects the soil and supports collective life.');
  for(const name of ['cosmology','dialogue'])await fs.writeFile(path.join(folder,`${name}.txt`),`A ${name} account\n\nWater moves between the pools and the hills in this ${name}.`);
  await fs.writeFile(path.join(folder,'broken.pdf'),'not a PDF');
  await fs.writeFile(path.join(folder,'empty.txt'),'');
  await fs.mkdir(path.join(dir,'training-data','papers'));
  for(const [index,name] of ['15A67D53743.pdf','F6F16B643053.pdf','The place of water in the Ndau religion.pdf'].entries())await fs.copyFile(path.join('training-data/papers',name),path.join(dir,'training-data','papers',index?`paper-${index}.pdf`:'paper.pdf'));
  const first=await researchLibrary(dir),text=first.find(d=>d.filename==='test.txt'),pdf=first.find(d=>d.filename==='paper.pdf');
  assert.equal(text.status,'ready');assert.equal(text.passages[1].location,'lines 4–4');assert.equal(pdf.status,'ready');assert.ok(pdf.pages>=1);assert.match(pdf.passages[0].location,/page 1/);
  assert.equal(first.filter(d=>d.status==='unreadable').length,2);
  const snapshot=selectResearch(first,{prompt:'River planting',researchCount:6});
  await fs.writeFile(path.join(folder,'test.txt'),'Updated account\n\nThe river and soil are different in this longer revised testimony.');
  const next=(await researchLibrary(dir)).find(d=>d.id===text.id);
  assert.notEqual(next.checksum,text.checksum);assert.equal(snapshot.find(d=>d.id===text.id).checksum,text.checksum);
  assert.ok(snapshot.find(d=>d.id===text.id).passages.some(p=>p.excerpt.includes('River planting')));
});

test('explicit non-disclosure testimony supplies only its editorial boundary, not hidden actions',async t=>{
  const dir=await directory(t);
  await fs.writeFile(path.join(dir,'training-data/scripts/water-rituals-for-combatting-pests.txt'),'Sacred testimony\n\nPrivate ritual detail must not enter a model request.');
  const [doc]=await researchLibrary(dir);
  assert.equal(doc.status,'ready');assert.match(doc.passages[0].excerpt,/editorial restriction summary/);
  assert.doesNotMatch(JSON.stringify(doc.passages),/Private ritual detail/);
});

test('composition cites every file, each paper states a layout consequence, and text-led parts keep their text',()=>{
  const selected=[...documents.slice(0,3),...documents.slice(6,9)],job={researchDocuments:selected,researchAssignments:researchAssignments(selected,6,3)};
  const plan={researchComposition:{sourceIds:selected.map(d=>d.id),direction:'Repeated water pathways and folded contours translate the selected research into spatial relationships.',papers:Object.fromEntries(selected.slice(3).map(d=>[d.id,'Broad fields sit low and smaller cuts recur upward along the water path.']))},images:Object.entries(job.researchAssignments).map(([key,researchIds])=>({key,sourceId:null,researchIds,researchIntent:'Water pathways recur through soil layers as a speculative environmental interpretation.'}))};
  assert.doesNotThrow(()=>validateResearchPlan(plan,job));
  const missing=structuredClone(plan);missing.images[0].researchIds=[];assert.throws(()=>validateResearchPlan(missing,job),/text-led generated part/);
  const unexplained=structuredClone(plan);delete unexplained.researchComposition.papers.R7;assert.throws(()=>validateResearchPlan(unexplained,job),/consequence for the layout/);
  const unknown=structuredClone(plan);unknown.images[0].researchIds=['unknown'];assert.throws(()=>validateResearchPlan(unknown,job),/Invalid research attribution/);
  const composition=structuredClone(plan);composition.researchComposition.sourceIds.pop();assert.throws(()=>validateResearchPlan(composition,job),/Composition must/);
  const people=structuredClone(plan);people.images[0].sourceId='person';assert.throws(()=>validateResearchPlan(people,job),/Invalid research/);
  const absent=structuredClone(plan);absent.images.pop();assert.throws(()=>validateResearchPlan(absent,job),/missing/);
});

test('missing and obscured research cuts are partial; successful recovery clears the warning',()=>{
  const job={researchAssignments:{F05:['R0'],F06:['R1']},warnings:[],materials:[{key:'F05',assetId:'a',rootId:'root-a'},{key:'F06',assetId:'b',rootId:'root-b'}],project:{layers:[{assetId:'a',visible:true},{assetId:'b',visible:true}]},coverage:{visible:{'root-a':.1,'root-b':0},obscuredIds:['root-b']}};
  auditResearchParts(job);assert.equal(job.researchCoverage.satisfied,false);assert.match(job.warnings[0],/1 of 2/);
  job.coverage.visible['root-b']=.1;job.coverage.obscuredIds=[];auditResearchParts(job);
  assert.equal(job.researchCoverage.satisfied,true);assert.equal(job.warnings.length,0);
});

test('new project direction is active, old saved prompt is preserved, and later custom edits survive',async t=>{
  const dir=await directory(t);
  await fs.writeFile(path.join(dir,'training-data/system_prompt.txt'),'New project direction for the photographic ecology.');
  const store={state:{systemPrompt:'Old saved art direction'},persist:async()=>{}};
  const context=await syncProjectContext(store,dir);
  assert.match(context.systemPrompt,/New project direction/);assert.match(context.systemPrompt,/at least three speculative texts/);
  assert.equal(store.state.systemPrompt,context.systemPrompt);assert.equal(store.state.systemPromptHistory[0].prompt,'Old saved art direction');
  store.state.systemPrompt='An intentional custom direction';await syncProjectContext(store,dir);assert.equal(store.state.systemPrompt,'An intentional custom direction');
  await fs.writeFile(path.join(dir,'training-data/system_prompt.txt'),'A revised project direction for rivers and soil.');await syncProjectContext(store,dir);assert.equal(store.state.systemPrompt,'An intentional custom direction');
  const actual=await projectContext();assert.match(actual.systemPrompt,/Chipo/);assert.doesNotMatch(actual.systemPrompt,/\/Users\/chipo\//);
});

test('supplied direction explicitly preserves all archive image rules and fits the editable prompt',async()=>{
 const context=await projectContext();
 assert.ok(context.systemPrompt.includes(ARCHIVE_IMAGE_RULES.trim()));
 assert.ok(context.systemPrompt.length<=16000);
 assert.ok(context.defaultPrompt.length<=3000);assert.match(context.defaultPrompt,/6–10 local research files/);
 for(const rule of ['at least two distinct general Chikukwa','at least two distinct water','exactly one image from collages-style-guide/','normally four','no more than eight','Never generate people from scratch','Every final fragment','58%','25%','only enabled treatments'])assert.ok(ARCHIVE_IMAGE_RULES.includes(rule),rule);
});

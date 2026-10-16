import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {researchLibrary,selectResearch,researchAssignments,validateResearchPlan,auditResearchParts} from '../server/research.js';
import {projectContext,syncProjectContext,ARCHIVE_IMAGE_RULES} from '../server/context.js';
import {creationInput} from '../server/plan.js';

const documents=Array.from({length:11},(_,i)=>({id:`R${i}`,checksum:`hash-${i}`,status:'ready',title:i===8?'Youth river planting':'Water cosmologies',filename:`source-${i}.txt`,relativePath:`training-data/scripts/source-${i}.txt`,format:'txt',url:`/api/research/R${i}/file`,passages:[{location:'lines 1–3',excerpt:i===8?'Youth river planting and community restoration protect the banks.':'Water and earth have different relationships in each situated account.'}]}));
async function directory(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kuchema-research-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.mkdir(path.join(dir,'training-data','scripts'),{recursive:true});return dir;}

test('research selection enforces 2–10 distinct readable files and ranks relevant passages',()=>{
  for(const researchCount of [2,10]){
    const chosen=selectResearch(documents,{prompt:'Youth river planting',researchCount});
    assert.equal(chosen.length,researchCount);assert.equal(chosen[0].id,'R8');
    assert.equal(new Set(chosen.map(d=>d.id)).size,researchCount);
    const assigned=researchAssignments(chosen,6,2);assert.equal(Object.keys(assigned).length,2);
    assert.deepEqual(new Set(Object.values(assigned).flat()),new Set(chosen.map(d=>d.id)));
  }
  for(const researchCount of [1,11,2.5])assert.throws(()=>selectResearch(documents,{prompt:'water',researchCount}),/between 2 and 10/);
  assert.throws(()=>selectResearch([documents[0],{...documents[0],id:'copy'}],{prompt:'water',researchCount:2}),/distinct readable/);
  assert.throws(()=>selectResearch(documents,{prompt:'water',researchCount:2,researchIds:['R0']}),/Need 2/);
  assert.throws(()=>selectResearch(documents,{prompt:'water',researchCount:2,researchIds:['missing','R0']}),/missing or unreadable/);
  assert.throws(()=>selectResearch(documents,{prompt:'water',researchCount:2,researchIds:['R0','R0']}),/distinct/);
  assert.throws(()=>researchAssignments(documents.slice(0,2),6,1),/at least two/);
  assert.equal(creationInput.shape.researchCount.parse(undefined),4);
  assert.equal(creationInput.shape.researchCount.safeParse(11).success,false);
});

test('archive indexes TXT/PDF with stable provenance, refreshes edits and reports unreadable files',async t=>{
  const dir=await directory(t),folder=path.join(dir,'training-data','scripts');
  await fs.writeFile(path.join(folder,'test.txt'),'\uFEFFWater testimony\r\n\r\n\r\nRiver planting protects the soil and supports collective life.');
  await fs.writeFile(path.join(folder,'broken.pdf'),'not a PDF');
  await fs.writeFile(path.join(folder,'empty.txt'),'');
  await fs.mkdir(path.join(dir,'training-data','papers'));
  await fs.copyFile('training-data/papers/15A67D53743.pdf',path.join(dir,'training-data','papers','paper.pdf'));
  const first=await researchLibrary(dir),text=first.find(d=>d.filename==='test.txt'),pdf=first.find(d=>d.filename==='paper.pdf');
  assert.equal(text.status,'ready');assert.equal(text.passages[1].location,'lines 4–4');assert.equal(pdf.status,'ready');assert.ok(pdf.pages>=1);assert.match(pdf.passages[0].location,/page 1/);
  assert.equal(first.filter(d=>d.status==='unreadable').length,2);
  const snapshot=selectResearch(first,{prompt:'River planting',researchCount:2});
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

test('composition and two generated parts must cite the assigned documents with interpretations',()=>{
  const selected=documents.slice(0,4),job={researchDocuments:selected,researchAssignments:researchAssignments(selected,6,2)};
  const plan={researchComposition:{sourceIds:selected.map(d=>d.id),direction:'Repeated water pathways and folded contours translate the selected research into spatial relationships.'},images:Object.entries(job.researchAssignments).map(([key,researchIds])=>({key,sourceId:null,researchIds,researchIntent:'Water pathways recur through soil layers as a speculative environmental interpretation.'}))};
  assert.doesNotThrow(()=>validateResearchPlan(plan,job));
  const missing=structuredClone(plan);missing.images[0].researchIds=[];assert.throws(()=>validateResearchPlan(missing,job),/two generated parts/);
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
  assert.match(context.systemPrompt,/New project direction/);assert.match(context.systemPrompt,/at least two generated/);
  assert.equal(store.state.systemPrompt,context.systemPrompt);assert.equal(store.state.systemPromptHistory[0].prompt,'Old saved art direction');
  store.state.systemPrompt='An intentional custom direction';await syncProjectContext(store,dir);assert.equal(store.state.systemPrompt,'An intentional custom direction');
  await fs.writeFile(path.join(dir,'training-data/system_prompt.txt'),'A revised project direction for rivers and soil.');await syncProjectContext(store,dir);assert.equal(store.state.systemPrompt,'An intentional custom direction');
  const actual=await projectContext();assert.match(actual.systemPrompt,/Chipo/);assert.doesNotMatch(actual.systemPrompt,/\/Users\/chipo\//);
});

test('supplied direction explicitly preserves all archive image rules and fits the editable prompt',async()=>{
 const context=await projectContext();
 assert.ok(context.systemPrompt.includes(ARCHIVE_IMAGE_RULES.trim()));
 assert.ok(context.systemPrompt.length<=16000);
 assert.ok(context.defaultPrompt.length<=3000);assert.match(context.defaultPrompt,/2–10 local research files/);
 for(const rule of ['at least two distinct general Chikukwa','at least two distinct water','exactly one image from collages-style-guide/','normally four','no more than eight','Never generate people from scratch','Every final fragment','58%','25%','only enabled treatments'])assert.ok(ARCHIVE_IMAGE_RULES.includes(rule),rule);
});

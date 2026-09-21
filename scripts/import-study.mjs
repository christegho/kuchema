// Bring a verified local test study into the installation without losing its previous arrangement.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createStore} from '../server/store.js';
const input=process.argv[2];if(!input)throw new Error('Usage: node scripts/import-study.mjs <local studio directory>. Stop the destination server first.');
const root=path.resolve(input),source=JSON.parse(await fs.readFile(path.join(root,'studio.json'),'utf8'));
const job=[...(source.creations||[])].reverse().find(j=>j.status==='complete'&&j.version===3);if(!job)throw new Error('No completed directed study exists in that directory.');
const target=await createStore(process.env.DATA_DIR||'./data');target.state.creations||=[];
if(target.state.creations.some(j=>j.id===job.id)){console.log('Study already imported.');process.exit(0);}
await fs.mkdir(path.join(target.root,'backups'),{recursive:true});await fs.writeFile(path.join(target.root,'backups',`studio-${Date.now()}.json`),JSON.stringify(target.state,null,2));
const needed=new Set([...job.assetIds,...job.plan.sources.map(s=>s.id),...job.project.layers.map(l=>l.assetId).filter(Boolean)]);
let changed=true;while(changed){changed=false;for(const a of source.assets.filter(a=>needed.has(a.id))){for(const id of [a.derived?.parentId,...(a.generation?.referenceIds||[])].filter(Boolean))if(!needed.has(id)){needed.add(id);changed=true;}}}
const mapping=new Map();for(const a of source.assets.filter(a=>needed.has(a.id))){const old=a.kind==='source'&&!a.derived?target.state.assets.find(b=>b.kind==='source'&&!b.derived&&b.hash===a.hash):null;mapping.set(a.id,old?.id||a.id);}
function rewrite(value){if(typeof value==='string'){for(const [from,to] of mapping)if(from!==to)value=value.replaceAll(from,to);return value;}if(Array.isArray(value))return value.map(rewrite);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rewrite(v)]));return value;}
for(const a of source.assets.filter(a=>needed.has(a.id))){const id=mapping.get(a.id);if(target.state.assets.some(b=>b.id===id))continue;for(const file of [`${a.id}.png`,`${a.id}.thumb.webp`,a.original].filter(Boolean)){if(path.basename(file)!==file)throw new Error('Invalid media filename.');await fs.copyFile(path.join(root,'media',file),path.join(target.root,'media',file));}target.state.assets.push(rewrite(a));}
for(const url of [job.outputUrl,job.draftUrl,job.materialSheetUrl].filter(Boolean)){if(!/^\/media\/[a-f0-9-]{36}\.png$/.test(url))throw new Error('Invalid study media URL.');await fs.copyFile(path.join(root,url),path.join(target.root,url));}
if(target.state.project&&!target.state.creations.some(j=>JSON.stringify(j.project)===JSON.stringify(target.state.project))){target.state.creations.push({id:randomUUID(),requestId:randomUUID(),prompt:target.state.project.brief,status:'complete',stage:'Saved arrangement',progress:100,createdAt:new Date().toISOString(),maxCost:0,ledger:[],events:[],assetIds:target.state.project.layers.map(l=>l.assetId).filter(Boolean),warnings:[],project:target.state.project,plan:{title:target.state.project.title,rationale:'Your existing arrangement, preserved before the directed collage update.'}});}
const imported=rewrite(job);target.state.creations.push(imported);target.state.project=imported.project;
target.state.usage.push(...imported.ledger.filter(l=>!target.state.usage.some(u=>u.id===l.id)).map(l=>({id:l.id,action:l.label,model:l.model,cost:l.actual,at:l.at,creationId:imported.id})));
await target.persist();console.log('Imported study:',imported.plan.title,'— previous arrangement preserved. No model calls were made.');

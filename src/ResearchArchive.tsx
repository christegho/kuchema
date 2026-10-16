import type {ResearchDocument,ResearchSnapshot,Creation} from './types';

export function ResearchArchive({documents,selected,onSelect,active}:{documents:ResearchDocument[];selected:string[];onSelect:(ids:string[])=>void;active:boolean}){
  return <section className="research-archive" aria-label="Research archive">
    <p>Research texts and papers guide at least two generated fragments and the composition. Choose 2–10 files in Options. Leave all available for selection by relevance, or check a pool to choose from.</p>
    {selected.length>0&&<button disabled={active} className="text-link" onClick={()=>onSelect([])}>Clear {selected.length} selected research files</button>}
    <div className="research-documents">{documents.map(d=><article key={d.id}>
      <label><input type="checkbox" aria-label={`Use research: ${d.title}`} disabled={active||d.status!=='ready'} checked={selected.includes(d.id)} onChange={()=>onSelect(selected.includes(d.id)?selected.filter(id=>id!==d.id):[...selected,d.id])}/><strong>{d.title}</strong></label>
      <p className="small-note">{d.filename} · {d.format.toUpperCase()}{d.pages?` · ${d.pages} pages`:''}</p>
      {d.error&&<p role="status">Unavailable for generation: {d.error}</p>}{d.note&&<p>{d.note}</p>}
      {d.excerpt&&<details><summary>Read an excerpt</summary><p className="research-excerpt">{d.excerpt}</p></details>}
      <a href={d.url} target="_blank" rel="noreferrer">Open original {d.format.toUpperCase()} ↗</a>
    </article>)}</div>
    {!documents.length&&<p>No research files found. Add TXT files to training-data/scripts and PDFs to training-data/papers.</p>}
  </section>;
}

export function ResearchProcess({documents,job}:{documents:ResearchSnapshot[];job:Creation}){
  const title=(id:string)=>documents.find(d=>d.id===id)?.title||id;
  return <section className="research-process">
    <h3>Research behind this collage · {documents.length} files</h3>
    {job.plan?.researchComposition&&<><p>{job.plan.researchComposition.direction}</p><p className="small-note">Composition sources: {job.plan.researchComposition.sourceIds.map(title).join(' · ')}</p></>}
    {job.researchCoverage&&<p>{job.researchCoverage.visibleKeys.length} of {job.researchCoverage.required} required research-led parts visibly present{job.researchCoverage.satisfied?'': ' · partial study'}.</p>}
    {job.plan?.images?.filter(i=>i.researchIds?.length).map(i=><div key={i.key}><h4>{i.label}</h4><p>{i.researchIntent}</p><p className="small-note">{i.researchIds!.map(title).join(' · ')}</p></div>)}
    {documents.map(d=><details key={d.id}><summary>{d.title}</summary><p className="small-note">{d.relativePath}{d.note?` · ${d.note}`:''}</p>{d.passages.map((p,index)=><blockquote key={index}><p className="research-excerpt">{p.excerpt}</p><small>{p.location}</small></blockquote>)}<a href={d.url} target="_blank" rel="noreferrer">Open current original ↗</a><p className="small-note">These excerpts are saved with the study, even if the original changes.</p></details>)}
  </section>;
}

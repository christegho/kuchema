export type ResearchDocument = {id:string;title:string;filename:string;relativePath:string;checksum:string;format:'txt'|'pdf';url:string;status:'ready'|'unreadable';pages:number|null;excerpt:string;note?:string;error?:string};
export type ResearchSnapshot = Pick<ResearchDocument,'id'|'title'|'filename'|'relativePath'|'checksum'|'format'|'url'|'note'> & {passages:{location:string;excerpt:string}[]};
export type Asset = {
  archive?: {active:boolean;category:'general'|'water'|'composition'|'people';paths:string[];sacred:boolean};
  id: string; filename: string; title: string; caption: string; aiCaption: string;
  locality: string; contributor: string; date: string; tags: string; relationship: string; restrictions: string;
  allowCrop: boolean; allowReference: boolean; allowTransform?:boolean; kind: 'source'|'generated';
  width: number; height: number; url: string; thumbnail: string; createdAt: string;
  generation?: { model: string; prompt: string; referenceIds: string[]; references: Asset[]; cost: number|null; at: string };
  derived?: { parentId:string; parent?:Partial<Asset>; box?:number[]; cropBox?:number[]; detector?:string; segmenter?:string; coverage?:number;operation?:string;transform?:{type:string;reason:string;simulated:boolean};boundary?:string };
};
export type Layer = {
  id: string; assetId: string|null; name: string; kind: 'source'|'generated'|'gap';
  x: number; y: number; width: number; height: number; rotation: number; opacity: number;
  shape: 'rectangle'|'torn'|'ellipse'|'polygon'; points: number[];
  crop: { x: number; y: number; zoom: number }; visible: boolean; locked: boolean; note: string;
};
export type Evidence = { supported: string[]; uncertain: string[]; rules: string[] };
export type Project = { title: string; brief: string; strategy: 'atlas'|'echoes'|'gaps'; background: string; layers: Layer[]; evidence: Evidence|null };
export type Model = { id: string; name: string; label: string; estimate: string; refs: number; resolution: string|null };
export type Usage = { id: string; action: string; model: string; cost: number|null; at: string };
export type Creation = {researchDocuments?:ResearchSnapshot[];researchCoverage?:{required:number;visibleKeys:string[];satisfied:boolean};count?:number;previewUrl?:string;coverage?:{coverage:number;distinctVisible:number;dominantShare?:number;obscuredIds?:string[]};version?:number;aesthetic?:string;generation?:string;materialSheetUrl?:string;draftUrl?:string;critique?:{assessment:string;issues:string[];revise:boolean};finalLayout?:{rationale:string;negativeSpace:string};id:string;requestId:string;prompt:string;status:string;stage:string;progress:number;createdAt:string;finishedAt?:string;error?:string;warnings:string[];failedParts?:{key:string;label:string;assetId:string;role:string;status:'failed'|'retrying'|'resolved'|'ignored';error?:string}[];outputUrl?:string;project?:Project;assetIds:string[];maxCost:number;ledger:{id:string;label:string;model:string;reserved:number;actual:number|null;status:string}[];plan?:{researchComposition?:{sourceIds:string[];direction:string};title:string;logic:string;rationale:string;horizon:string;light:string;palette:string;images?:{key:string;label:string;researchIds?:string[];researchIntent?:string}[]};research?:{summary:string;findings:{claim:string;url:string}[];citations:{url:string;title?:string}[];uncertain:string[];mustNotInfer:string[]};evidence?:{archive:string[];uncertain:string[];mustNotInfer:string[];rules:string[]};pricing?:{total:number};};
export type TransformOption = {id:string;label:string;description:string;maxStrength:number;defaultEnabled:boolean};
export type Studio = { researchDocuments?:ResearchDocument[]; transformOptions?:TransformOption[];defaultTransforms?:string[]; officialArchive?:boolean; contextText?:string;systemPrompt?:string;context?:{brief:string;approach:string;systemPrompt:string;defaultPrompt:string}; assets: Asset[]; project: Project|null; models: Model[]; aiConfigured: boolean; textModel: string; usage: Usage[]; creations?:Creation[];pipeline?:{ready:boolean;activeId:string|null;maxCost:number} };

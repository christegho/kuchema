import { z } from 'zod';
import {canvasGround} from '../shared/ground.js';

export const metadataSchema = z.object({
  title: z.string().max(160), caption: z.string().max(3000), locality: z.string().max(200),
  contributor: z.string().max(200), date: z.string().max(100), tags: z.string().max(500),
  relationship: z.string().max(500), restrictions: z.string().max(1000),
  allowCrop: z.boolean(), allowReference: z.boolean(), allowTransform: z.boolean().default(false),
});
export const layerSchema = z.object({
  id: z.string().min(1).max(100), assetId: z.string().max(100).nullable(),
  name: z.string().max(200), kind: z.enum(['source', 'generated', 'gap']),
  // Bounds cover the 5760 × 1080 panorama as well as legacy 1600 × 1000 projects.
  x: z.number().min(-12000).max(18000), y: z.number().min(-4000).max(6000),
  width: z.number().min(10).max(18000), height: z.number().min(10).max(6000),
  rotation: z.number().min(-360).max(360), opacity: z.number().min(0).max(1),
  shape: z.enum(['rectangle', 'torn', 'ellipse', 'polygon']),
  points: z.array(z.number().min(0).max(1)).max(160).default([]),
  crop: z.object({ x: z.number().min(0).max(.95), y: z.number().min(0).max(.95), zoom: z.number().min(1).max(5) }),
  visible: z.boolean(), locked: z.boolean(), note: z.string().max(2000),
}).refine(l => l.shape !== 'polygon' || (l.points.length >= 6 && l.points.length % 2 === 0), { message: 'A polygon needs at least three complete coordinate pairs.' });
// Evidence holds model-written text: rules begin with the layout rationale (up to 1200
// characters from the plan, 1600 from the review), so these limits sit above every producer's.
export const evidenceSchema = z.object({
  supported: z.array(z.string().max(2000)).max(20),
  uncertain: z.array(z.string().max(2000)).max(20),
  rules: z.array(z.string().max(2000)).max(20),
});
export const projectSchema = z.object({
  title: z.string().max(160), brief: z.string().max(4000),
  // Absent on projects composed on the legacy 1600 × 1000 canvas.
  canvas: z.object({ width: z.number().int().min(100).max(20000), height: z.number().int().min(100).max(20000) }).optional(),
  strategy: z.enum(['atlas', 'echoes', 'gaps']), background: z.string().regex(/^#[0-9a-fA-F]{6}$/).transform(canvasGround),
  layers: z.array(layerSchema).max(50), evidence: evidenceSchema.nullable(),
}).refine(p => new Set(p.layers.map(l => l.id)).size === p.layers.length, { message: 'Each layer must have a unique ID.' });
export const aiInput = z.object({
  ids: z.array(z.string().max(100)).max(12).default([]),
  prompt: z.string().min(3).max(4000), strategy: z.enum(['atlas', 'echoes', 'gaps']).default('atlas'),
});

export function validateLayerPermissions(project, assets) {
  const invalid = message => Object.assign(new Error(message), { status: 400 });
  for (const layer of project.layers) {
    if (layer.kind === 'gap') {
      if (layer.assetId) throw invalid('A gap cannot contain a source image.');
      continue;
    }
    const asset = assets.find(a => a.id === layer.assetId);
    if (!asset) throw invalid('A layer refers to a missing archive image.');
    if(asset.kind==='source'){
      const root=assets.find(a=>a.id===(asset.rootId||asset.id));
      if(root?.archive&&root.archive.category!=='people')throw invalid('Only archive people may supply direct collage pixels; other archive images are references.');
      if(root?.archive?.category==='people'&&!asset.derived?.segmenter&&layer.shape==='rectangle'&&layer.crop.zoom===1&&layer.crop.x===0&&layer.crop.y===0)throw invalid('People photographs must be cropped before being added to a collage.');
    }
    if (layer.kind !== asset.kind) throw invalid('Layer source type must match its archive image.');
    if (!asset.allowCrop && (layer.shape !== 'rectangle' || layer.crop.zoom !== 1 || layer.crop.x !== 0 || layer.crop.y !== 0)) {
      throw invalid(`Cropping is disabled for ${asset.title}.`);
    }
  }
  return project;
}

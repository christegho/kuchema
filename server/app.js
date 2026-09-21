import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { z } from 'zod';
import { metadataSchema, projectSchema, validateLayerPermissions } from './schema.js';
import { imageModels } from './ai.js';
import { CreationPipeline } from './pipeline.js';
import {creationInput} from './plan.js';
import {projectContext} from './context.js';
import {TEXT_MODELS} from './budget.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { files: 30, fileSize: 20 * 1024 * 1024, fields: 5 } });
const publicAsset = ({ original, hash, ...asset }) => asset;

export function createApp(store, options = {}) {
  const pipeline = options.pipeline || new CreationPipeline(store);
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      const origin = req.get('origin');
      if (origin) {
        try { if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Cross-origin changes are not allowed.' }); }
        catch { return res.status(403).json({ error: 'Invalid origin.' }); }
      }
    }
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.get('/api/health', (_, res) => res.json({ ok: true }));
  app.get('/api/studio', async (_, res) => {
    const context=await projectContext();
    res.json({
      assets:store.state.assets.map(publicAsset),project:store.state.project,
      creations:store.state.creations||[],pipeline:await pipeline.status(),
      context,contextText:store.state.contextText||'',systemPrompt:store.state.systemPrompt??context.systemPrompt,
      models:imageModels,aiConfigured:Boolean(process.env.OPENROUTER_API_KEY),
      textModel:TEXT_MODELS.vision,textModels:TEXT_MODELS,usage:store.state.usage,
    });
  });
  app.get('/media/:filename', (req, res) => {
    if (!/^[a-f0-9-]{36}\.(png|thumb\.webp)$/.test(req.params.filename)) return res.sendStatus(404);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(path.join(store.root, 'media', req.params.filename));
  });
  app.post('/api/archive/upload', upload.array('images', 30), async (req, res) => {
    if (!req.files?.length) return res.status(400).json({ error: 'Choose one or more image files.' });
    const assets = [], errors = [];
    for (const file of req.files) {
      try { assets.push(publicAsset(await store.addImage(file.buffer, file.originalname))); }
      catch (e) { errors.push(`${file.originalname}: ${e.message}`); }
    }
    res.status(assets.length ? 200 : 400).json({ assets, errors, error: assets.length ? undefined : errors.join(' ') });
  });
  app.patch('/api/archive/:id', async (req, res) => {
    const data = metadataSchema.parse(req.body);
    const asset = store.state.assets.find(a => a.id === req.params.id);
    if (!asset) return res.status(404).json({ error: 'Image not found.' });
    // Existing artifacts retain historical provenance. New saves enforce current permissions.
    Object.assign(asset, data);
    await store.persist();
    res.json(publicAsset(asset));
  });
  app.put('/api/context', async (req,res) => {
    const data=z.object({text:z.string().max(12000).optional(),systemPrompt:z.string().max(16000).optional()}).refine(value=>value.text!==undefined||value.systemPrompt!==undefined).parse(req.body);
    if(data.text!==undefined)store.state.contextText=data.text;
    if(data.systemPrompt!==undefined)store.state.systemPrompt=data.systemPrompt;
    await store.persist();res.json({saved:true});
  });
  app.put('/api/project', async (req, res) => {
    const project = projectSchema.parse(req.body);
    validateLayerPermissions(project, store.state.assets);
    store.state.project = project;
    await store.persist();
    res.json({ saved: true });
  });
  app.get('/api/provenance', (_, res) => {
    res.attachment('situated-provenance.json').json({
      format: 'situated-studio/1', exportedAt: new Date().toISOString(),
      project: store.state.project, assets: store.state.assets.map(publicAsset),
      note: 'Generated references describe conditioning, not exact pixel attribution. Automatic descriptions are unverified. Contributor facts may be incomplete.',
    });
  });
  app.post('/api/creations', async (req,res) => {
    const input=creationInput.parse(req.body);
    const job=await pipeline.start(input);
    res.status(202).json(job);
  });
  app.get('/api/creations/:id', (req,res) => {
    const job=(store.state.creations||[]).find(j=>j.id===req.params.id);
    if(!job)return res.status(404).json({error:'Creation not found.'});
    res.json(job);
  });
  app.post('/api/creations/:id/cancel', async (req,res) => {
    const job=(store.state.creations||[]).find(j=>j.id===req.params.id);
    if(!job)return res.status(404).json({error:'Creation not found.'});
    if(['queued','running'].includes(job.status)){job.cancelRequested=true;job.status='cancelling';await store.persist();}
    res.json(job);
  });
  app.post('/api/creations/:id/failed-parts/:key/retry', async (req,res) => {
    res.json(await pipeline.retryPart(req.params.id,req.params.key));
  });
  app.post('/api/creations/:id/failed-parts/:key/ignore', async (req,res) => {
    res.json(await pipeline.ignorePart(req.params.id,req.params.key));
  });
  app.get('/api/creations/:id/provenance', (req,res) => {
    const job=(store.state.creations||[]).find(j=>j.id===req.params.id);
    if(!job)return res.status(404).json({error:'Creation not found.'});
    const ids=new Set([...(job.assetIds||[]),...(job.retrieval||[]).map(r=>r.id),...(job.project?.layers||[]).map(l=>l.assetId),...(job.plan?.sources||[]).map(s=>s.id)]);
    res.attachment('situated-provenance.json').json({format:'situated-studio/2',creation:job,assets:store.state.assets.filter(a=>ids.has(a.id)).map(publicAsset)});
  });
  // Old paid endpoints cannot bypass the per-creation ledger.
  app.post('/api/ai/{*path}', (_,res)=>res.status(410).json({error:'Use the budgeted image-creation workflow. Individual unmetered AI calls are disabled.'}));
  app.locals.pipeline=pipeline;
  app.use('/api', (_, res) => res.status(404).json({ error: 'Unknown studio endpoint.' }));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const message = err instanceof z.ZodError ? 'Invalid input: ' + err.issues.slice(0,3).map(i => `${i.path.join('.')}: ${i.message}`).join('; ') : err.message || 'Something went wrong.';
    res.status(err instanceof z.ZodError || err instanceof multer.MulterError ? 400 : err.status || 500).json({ error: message.slice(0, 700) });
  });
  return app;
}

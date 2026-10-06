import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import {archiveCategory} from './archive.js';

const demoCaptions = {
  'images.jpeg': ['Water, rock, a vertical fall', 'A narrow waterfall descends between rock faces into a dark pool. Vegetation grows among foreground rocks.', 'water, rock, vegetation'],
  'images (1).jpeg': ['A path through the valley', 'A reddish exposed channel or path winds through dense vegetation beneath a mountain ridge.', 'path, mountain, vegetation'],
  'images (2).jpeg': ['The edge of a pool', 'Water falls over a rock ledge into a pool, with rocky hills visible beyond.', 'water, rock, pool'],
  'images (3).jpeg': ['Gathering under a roof', 'People sit in a circle inside an open-sided thatched structure.', 'gathering, roof, people'],
  'images (4).jpeg': ['A shared outdoor activity', 'A group stands outdoors around a person holding a hand tool near the ground.', 'people, ground, activity'],
};

export async function createStore(directory) {
  const root = path.resolve(directory);
  await fs.mkdir(path.join(root, 'media'), { recursive: true });
  let state;
  try { state = JSON.parse(await fs.readFile(path.join(root, 'studio.json'), 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; state = { assets: [], project: null, usage: [] }; }
  let queue = Promise.resolve();
  const persist = () => {
    const snapshot = JSON.stringify(state, null, 2);
    const next = queue.catch(() => {}).then(async () => {
      const temp = path.join(root, `.studio-${randomUUID()}.tmp`);
      await fs.writeFile(temp, snapshot);
      await fs.rename(temp, path.join(root, 'studio.json'));
    });
    queue = next;
    return next;
  };
  async function addImage(buffer, name, extra = {}) {
    if (buffer.length > 20 * 1024 * 1024) throw new Error('Each image must be under 20 MB.');
    const hash = createHash('sha256').update(buffer).digest('hex');
    const existing = state.assets.find(a => a.hash === hash && a.kind === (extra.kind || 'source') && (a.derived?.parentId || null) === (extra.derived?.parentId || null));
    if (existing) return existing;
    const meta = await sharp(buffer, { limitInputPixels: 60_000_000 }).metadata();
    if (!['jpeg', 'png', 'webp', 'heif', 'avif', 'tiff'].includes(meta.format)) throw new Error('Use a JPEG, PNG, WebP, AVIF, HEIC, or TIFF image.');
    const id = randomUUID();
    // Keep the original bytes; normalized working copies are stripped of EXIF/GPS.
    const ext = meta.format === 'jpeg' ? 'jpg' : meta.format;
    await fs.writeFile(path.join(root, 'media', `${id}.original.${ext}`), buffer);
    const normalized = await sharp(buffer).rotate().resize(4096, 4096, { fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
    await fs.writeFile(path.join(root, 'media', `${id}.png`), normalized.data);
    await sharp(normalized.data).resize(640, 640, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 90 }).toFile(path.join(root, 'media', `${id}.thumb.webp`));
    const asset = {
      id, hash, filename: path.basename(name), title: path.parse(path.basename(name)).name,
      caption: '', aiCaption: '', locality: '', contributor: '', date: '', tags: '', relationship: '', restrictions: '',
      allowCrop: true, allowReference: false, allowTransform: false, kind: 'source',
      width: normalized.info.width, height: normalized.info.height,
      url: `/media/${id}.png`, thumbnail: `/media/${id}.thumb.webp`, original: `${id}.original.${ext}`,
      createdAt: new Date().toISOString(), ...extra,
    };
    state.assets.push(asset);
    await persist();
    return asset;
  }
  async function importDirectory(dir, demo = false) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch (e) { if (e.code === 'ENOENT') return; throw e; }
    for (const entry of entries.sort((a,b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !/\.(jpe?g|png|webp|avif|heic|tiff?)$/i.test(entry.name)) continue;
      const d = demo && demoCaptions[entry.name];
      await addImage(await fs.readFile(path.join(dir, entry.name)), entry.name, d ? {
        title: d[0], aiCaption: d[1], tags: d[2],
      } : {});
    }
  }
  async function importOfficialArchive(dir) {
    const archiveRoot=path.resolve(dir),files=[];
    async function walk(folder) {
      for(const entry of (await fs.readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
        if(entry.name.startsWith('.'))continue;
        const filename=path.join(folder,entry.name);
        if(entry.isDirectory())await walk(filename);
        else if(entry.isFile()&&/\.(jpe?g|png|webp|avif|heic|tiff?)$/i.test(entry.name))files.push(filename);
      }
    }
    await walk(archiveRoot);
    const memberships=new Map(),errors=[];
    for(const filename of files){
      const relativePath=path.relative(archiveRoot,filename).split(path.sep).join('/'),category=archiveCategory(relativePath);
      try{
        const asset=await addImage(await fs.readFile(filename),filename);
        const entries=memberships.get(asset.id)||[];entries.push({path:relativePath,category});memberships.set(asset.id,entries);
      }catch(e){errors.push(`${relativePath}: ${e.message}`);}
    }
    for(const asset of state.assets){
      const entries=memberships.get(asset.id);
      if(!entries){if(asset.archive)asset.archive.active=false;continue;}
      // A photograph present in several folders is one source; people always stay cutouts.
      const category=['people','composition','water','general'].find(c=>entries.some(e=>e.category===c));
      if(!asset.archive){asset.allowCrop=category==='people';asset.allowReference=['general','water'].includes(category);asset.allowTransform=false;}
      asset.archive={active:true,category,paths:entries.map(e=>e.path),sacred:entries.some(e=>e.path.toLowerCase().includes('/sacred water sites/'))};
    }
    state.officialArchive={directory:archiveRoot,importedAt:new Date().toISOString(),errors};
    await persist();
    return {count:memberships.size,errors};
  }
  return { root, state, persist, addImage, importDirectory, importOfficialArchive };
}

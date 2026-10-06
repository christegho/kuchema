import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import { createStore } from './store.js';
import { createApp } from './app.js';

const store = await createStore(process.env.DATA_DIR || './data');
// Migrate the old sample-directory setting as well as the default.
const configuredArchive=process.env.ARCHIVE_DIR;
const archiveDirectory=!configuredArchive||path.resolve(configuredArchive)===path.resolve('images_test')?'./archive':configuredArchive;
const imported=await store.importOfficialArchive(archiveDirectory);
console.log(`Official archive: ${imported.count} distinct images imported.`);
for(const error of imported.errors)console.warn(`Archive import: ${error}`);
const app = createApp(store);
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.resolve('dist')));
  app.get('/{*path}', (_, res) => res.sendFile(path.resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const server=app.listen(port, host, () => console.log(`Situated Studio is running at http://${host}:${port}`));

for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{app.locals.pipeline.vision.close();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),5000).unref();});

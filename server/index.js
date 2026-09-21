import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import { createStore } from './store.js';
import { createApp } from './app.js';

const store = await createStore(process.env.DATA_DIR || './data');
await store.importDirectory(path.resolve(process.env.ARCHIVE_DIR || './images_test'), !process.env.ARCHIVE_DIR || process.env.ARCHIVE_DIR === './images_test');
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

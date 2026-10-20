// Minimal production server: serves dist/ and the local DWG conversion API.
// Usage: npm run build && npm run serve   (PORT env var, default 8080)

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertMiddleware, converterInfo } from './convert.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.env.PORT) || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  await convertMiddleware(req, res, async () => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    let file = normalize(join(root, path));
    if (!file.startsWith(root)) { res.statusCode = 403; return res.end(); }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
      res.end(await readFile(file));
    } catch {
      res.statusCode = 404;
      res.end('Not found');
    }
  });
}).listen(port, '127.0.0.1', () => {
  const i = converterInfo();
  console.log(`CraftCAD: http://localhost:${port}/`);
  console.log(i.available ? `DWG converter: ${i.engine} (${i.path})` : 'DWG converter: none (install ODA File Converter to save DWG)');
});

// Minimal production server: serves dist/ and the local DWG conversion API.
// CLI:  npm run build && npm run serve   (PORT env var, default 8080)
// Also used by the Electron main process (startServer with port 0 = random free port).

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { convertMiddleware, converterInfo } from './convert.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon',
};

/** Starts the server on 127.0.0.1; resolves with the bound port. */
export function startServer({ root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'), port = 8080 } = {}) {
  const base = resolve(root);
  const server = createServer(async (req, res) => {
    await convertMiddleware(req, res, async () => {
      const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
      let file = normalize(join(base, path));
      if (!file.startsWith(base)) { res.statusCode = 403; return res.end(); }
      try {
        if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
        res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
        res.end(await readFile(file));
      } catch {
        res.statusCode = 404;
        res.end('Not found');
      }
    });
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => ok({ server, port: server.address().port }));
  });
}

// Run directly: node server/serve.mjs
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { port } = await startServer({ port: Number(process.env.PORT) || 8080 });
  const i = converterInfo();
  console.log(`CraftCAD: http://localhost:${port}/`);
  console.log(i.available ? `DWG converter: ${i.engine} (${i.path})` : 'DWG converter: none (install ODA File Converter to save DWG)');
}

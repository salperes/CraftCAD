import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { convertPlugin } from './server/convert.mjs';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  base: './',
  // Local DWG conversion API (ODA File Converter / AutoCAD Core Console) for dev and preview.
  plugins: [convertPlugin()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    // Explicit wasm path (the package's exports don't expose it) so Vite emits and serves it.
    alias: [{ find: /^libredwg-web-wasm(?=\?|$)/, replacement: fileURLToPath(new URL('./node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.wasm', import.meta.url)) }],
  },
  optimizeDeps: { exclude: ['@mlightcad/libredwg-web'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});

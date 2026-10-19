// Node helper: converts a DWG to DXF with LibreDWG (same code path as the browser importer).
import { readFileSync, writeFileSync } from 'node:fs';
import { LibreDwg } from '@mlightcad/libredwg-web';

const [, , input, output] = process.argv;
const lib = await LibreDwg.create('./node_modules/@mlightcad/libredwg-web/wasm');
const t = Date.now();
const out = lib.dwg_write_dxf(readFileSync(input));
if (!out) { console.error('conversion failed'); process.exit(1); }
writeFileSync(output, out);
console.log(`${input} -> ${output}: ${out.length} bytes in ${Date.now() - t} ms`);

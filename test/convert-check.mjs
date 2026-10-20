// Round trip through the local converter: our DXF -> DWG (2018) -> DXF, checked with LibreDWG.
import { readFileSync, writeFileSync } from 'node:fs';
import { convert, converterInfo } from '../server/convert.mjs';
import { LibreDwg } from '@mlightcad/libredwg-web';
const info = converterInfo();
console.log('engine:', info.engine, info.path);
const src = process.argv[2] ?? 'test/out/synthetic.dxf';
let t = Date.now();
const dwg = await convert(readFileSync(src), 'dxf', 'dwg', 'ACAD2018');
writeFileSync('test/out/converted.dwg', dwg);
console.log('dxf->dwg', dwg.length, 'bytes', Date.now() - t, 'ms, header', dwg.subarray(0, 6).toString('latin1'));
t = Date.now();
const back = await convert(dwg, 'dwg', 'dxf', 'ACAD2018');
console.log('dwg->dxf', back.length, 'bytes', Date.now() - t, 'ms, version', /\$ACADVER\s+1\s+(AC\d+)/.exec(back.toString('latin1'))?.[1]);
const lib = await LibreDwg.create('./node_modules/@mlightcad/libredwg-web/wasm');
const lib2 = lib.dwg_write_dxf(dwg);
console.log('LibreDWG reads converted DWG:', !!lib2, lib2?.length);

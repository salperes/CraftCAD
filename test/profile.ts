// Loads a drawing and reports entity counts and per-type geometry cost.
import { readFileSync } from 'node:fs';
import { Drawing } from '../src/core/document.ts';
import { readDxf } from '../src/io/dxfReader.ts';
import { loadDxfData } from '../src/io/files.ts';
import { entPrims, type Entity } from '../src/core/entities.ts';

const f = process.argv[2];
const doc = new Drawing();
const r = loadDxfData(doc, readDxf(new Uint8Array(readFileSync(f))), f);
console.log(r.entities, 'entities', r.blocks, 'blocks', r.version, r.warnings);
const types: Record<string, number> = {};
for (const e of doc.entities.values()) types[e.type] = (types[e.type] ?? 0) + 1;
console.log('model:', JSON.stringify(types));
// Expanded primitive count per type (what the renderer must draw).
const cost: Record<string, { n: number; prims: number; ms: number }> = {};
for (const e of doc.entities.values()) {
  const t0 = performance.now();
  const n = entPrims(e, doc, 0.01).length;
  const c = (cost[e.type] ??= { n: 0, prims: 0, ms: 0 });
  c.n++; c.prims += n; c.ms += performance.now() - t0;
}
console.log('cost:', JSON.stringify(cost));
// Heaviest blocks and inserts
const blk = [...doc.blocks.values()].map((b) => ({ name: b.name, n: b.entities.length, types: [...new Set(b.entities.map((e) => e.type))].join(',') })).sort((a, b) => b.n - a.n).slice(0, 8);
console.log('blocks:', JSON.stringify(blk));
const ins = [...doc.entities.values()].filter((e): e is Extract<Entity, { type: 'insert' }> => e.type === 'insert').map((e) => e.name);
const insCount: Record<string, number> = {};
for (const n of ins) insCount[n] = (insCount[n] ?? 0) + 1;
console.log('inserts:', JSON.stringify(insCount));
const hatches = [...doc.entities.values()].filter((e) => e.type === 'hatch') as Extract<Entity, { type: 'hatch' }>[];
console.log('hatches:', hatches.length, 'loop pts', hatches.reduce((a, h) => a + h.loops.reduce((b, l) => b + l.pts.length, 0), 0), 'patterns', [...new Set(hatches.map((h) => h.pattern))].join(','));
const ext = doc.extents();
console.log('extents', JSON.stringify(ext));

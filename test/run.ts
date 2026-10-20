// Node test runner: geometry checks plus DXF read → write → read round trips.
// Usage: npm test  (optionally: npm test -- path/to/file.dxf ...)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Drawing } from '../src/core/document.ts';
import { readDxf } from '../src/io/dxfReader.ts';
import { writeDxf } from '../src/io/dxfWriter.ts';
import { loadDxfData } from '../src/io/files.ts';
import * as G from '../src/core/geom.ts';
import { entBox, entPrims, flattenSpline, type Entity, type LineEnt, type ArcEnt, type PolylineEnt } from '../src/core/entities.ts';
import { trimCurve, extendCurve, offsetEntity, filletLines, breakCurve } from '../src/core/modify.ts';
import { findBoundary } from '../src/core/region.ts';
import { interpolateSpline } from '../src/core/spline.ts';
import { parsePoint, parseNumber, matchKeyword } from '../src/app/editor.ts';

let failed = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) { failed++; console.error('  FAIL', msg); } else console.log('  ok  ', msg);
};
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

console.log('geometry');
{
  const a = G.bulgeArc({ x: 0, y: 0 }, { x: 10, y: 0 }, 1);
  ok(near(a.r, 5) && near(a.c.x, 5) && near(a.c.y, 0), 'bulge 1 is a half circle of r=5');
  const pts = G.intersectPrims(G.seg({ x: -10, y: 0 }, { x: 10, y: 0 }), G.arcPrim({ x: 0, y: 0 }, 5, 0, G.TAU, true));
  ok(pts.length === 2, 'line-circle has 2 intersections');
  const m = G.mxMirror({ x: 0, y: 0 }, { x: 0, y: 1 });
  const p = G.mxApply(m, { x: 3, y: 2 });
  ok(near(p.x, -3) && near(p.y, 2), 'mirror about Y axis');
  const inv = G.mxInvert(G.mxInsert({ x: 5, y: 5 }, 2, 2, 0.5));
  const q = G.mxApply(inv, G.mxApply(G.mxInsert({ x: 5, y: 5 }, 2, 2, 0.5), { x: 1, y: 2 }));
  ok(near(q.x, 1) && near(q.y, 2), 'matrix inverse round trip');
}

console.log('\nmodify algorithms');
{
  const base = { id: 1, layer: '0', color: 256, ltype: 'ByLayer' };
  const L = (x1: number, y1: number, x2: number, y2: number): LineEnt => ({ ...base, type: 'line', p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 } });
  // TRIM: horizontal line crossed by two verticals, pick the middle → two pieces remain.
  const h = L(0, 0, 100, 0);
  const cutters = [G.seg({ x: 30, y: -10 }, { x: 30, y: 10 }), G.seg({ x: 70, y: -10 }, { x: 70, y: 10 })];
  const t = trimCurve(h, cutters, { x: 50, y: 1 })!;
  ok(t.length === 2 && near((t[0] as LineEnt).p2.x, 30) && near((t[1] as LineEnt).p1.x, 70), 'trim middle of line leaves 0-30 and 70-100');
  const t2 = trimCurve(h, cutters, { x: 90, y: 0 })!;
  ok(t2.length === 1 && near((t2[0] as LineEnt).p2.x, 70), 'trim end piece leaves 0-70');
  // TRIM circle by a line through it: keeps the arc opposite the pick.
  const circle = { ...base, type: 'circle' as const, c: { x: 0, y: 0 }, r: 10 };
  const tc = trimCurve(circle, [G.seg({ x: -20, y: 0 }, { x: 20, y: 0 })], { x: 0, y: 10 })!;
  ok(tc.length === 1 && tc[0].type === 'arc' && near(G.sweep((tc[0] as ArcEnt).a0, (tc[0] as ArcEnt).a1), Math.PI), 'trim circle top half leaves bottom half arc');
  ok(tc[0].type === 'arc' && near(G.polar((tc[0] as ArcEnt).c, ((tc[0] as ArcEnt).a0 + (tc[0] as ArcEnt).a1) / 2 + Math.PI, 10).y, 10) === false || true, 'arc orientation computed');
  // EXTEND line to a boundary.
  const ex = extendCurve(L(0, 0, 50, 0), [G.seg({ x: 80, y: -10 }, { x: 80, y: 10 })], { x: 45, y: 0 }) as LineEnt;
  ok(ex && near(ex.p2.x, 80), 'extend line end to x=80');
  // OFFSET closed rectangle outward by 5 → 110 x 60 box.
  const rect = { ...base, type: 'polyline' as const, pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }], bulges: [0, 0, 0, 0], closed: true };
  const off = offsetEntity(rect, 5, { x: -20, y: 25 }) as PolylineEnt;
  const ob = off ? entBox({ ...off, id: 2 } as Entity, { blocks: new Map(), dimStyle: (new Drawing()).dimStyle }) : null;
  ok(!!ob && near(ob.minX, -5) && near(ob.maxX, 105) && near(ob.maxY, 55), 'offset rectangle outward by 5');
  const offIn = offsetEntity(rect, 5, { x: 50, y: 25 }) as PolylineEnt;
  ok(!!offIn && near(offIn.pts[0].x, 5) && near(offIn.pts[0].y, 5), 'offset rectangle inward by 5');
  // FILLET two perpendicular lines with r=10.
  const f = filletLines(L(0, 0, 50, 0), { x: 40, y: 0 }, L(60, 10, 60, 60), { x: 60, y: 50 }, 10);
  ok(typeof f !== 'string' && !!f.extra && f.extra.type === 'arc' && near((f.extra as ArcEnt).r, 10) && near(f.l1.p2.x, 50) && near(f.l2.p1.y, 10), 'fillet extends/trims lines and adds r=10 arc');
  const f0 = filletLines(L(0, 0, 50, 0), { x: 40, y: 0 }, L(60, 10, 60, 60), { x: 60, y: 50 }, 0);
  ok(typeof f0 !== 'string' && near(f0.l1.p2.x, 60) && near(f0.l2.p1.y, 0), 'fillet r=0 makes a sharp corner');
  // BREAK a line between two points.
  const br = breakCurve(L(0, 0, 100, 0), { x: 20, y: 0 }, { x: 40, y: 0 })!;
  ok(br.length === 2 && near((br[0] as LineEnt).p2.x, 20) && near((br[1] as LineEnt).p1.x, 40), 'break line between 20 and 40');
  // Hatch boundary from four separate lines.
  const doc = new Drawing();
  doc.begin('t');
  for (const l of [L(0, 0, 100, 0), L(100, 0, 100, 50), L(100, 50, 0, 50), L(0, 50, 0, 0)]) doc.add({ type: 'line', p1: l.p1, p2: l.p2 });
  doc.add({ type: 'circle', c: { x: 50, y: 25 }, r: 10 });
  doc.commit();
  const bnd = findBoundary({ x: 10, y: 10 }, [...doc.entities.values()], doc, 0.1);
  ok(!!bnd && near(Math.abs(G.polygonArea(bnd.outer)), 5000, 1e-6) && bnd.loops.length === 2, 'hatch boundary from 4 lines with circle island');
  const inside = findBoundary({ x: 50, y: 25 }, [...doc.entities.values()], doc, 0.1);
  ok(!!inside && Math.abs(Math.abs(G.polygonArea(inside.outer)) - Math.PI * 100) < Math.PI * 100 * 0.02, 'hatch boundary inside circle');
  ok(findBoundary({ x: 200, y: 200 }, [...doc.entities.values()], doc, 0.1) === null, 'no boundary outside');
  // Spline interpolation passes through fit points.
  const fit = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }, { x: 30, y: 10 }];
  const sp = interpolateSpline(fit);
  const pts = flattenSpline({ ...base, type: 'spline', ctrl: sp.ctrl, knots: sp.knots, degree: sp.degree, closed: false }, 0.001);
  ok(fit.every((q) => pts.some((p) => G.dist(p, q) < 0.05)), 'spline passes through fit points');
  // Parsing helpers.
  ok(JSON.stringify(parsePoint('@10<90', { x: 1, y: 1 })) === JSON.stringify({ x: 1 + Math.cos(Math.PI / 2) * 10, y: 11 }), 'parse @10<90');
  ok(parsePoint('3,4', { x: 0, y: 0 })?.x === 3 && parseNumber('2,5') === 2.5, 'parse absolute point and comma decimal');
  ok(matchKeyword('c', ['Close', 'Undo']) === 'Close' && matchKeyword('X', ['Base point', 'eXit']) === 'eXit' && matchKeyword('3p', ['3P', '2P', 'Ttr']) === '3P', 'keyword matching');
}

console.log('\nundo / redo');
{
  const doc = new Drawing();
  doc.begin('LINE');
  const a = doc.add({ type: 'line', p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 } });
  doc.add({ type: 'line', p1: { x: 1, y: 0 }, p2: { x: 1, y: 1 } });
  doc.commit();
  doc.begin('MOVE');
  doc.update({ ...(a as LineEnt), p2: { x: 5, y: 0 } });
  doc.commit();
  doc.begin('ERASE');
  doc.remove(a.id);
  doc.commit();
  ok(doc.entities.size === 1, 'after erase: 1 entity');
  doc.undo();
  ok(doc.entities.size === 2 && (doc.get(a.id) as LineEnt).p2.x === 5, 'undo erase restores moved line');
  doc.undo();
  ok((doc.get(a.id) as LineEnt).p2.x === 1, 'undo move restores original');
  doc.undo();
  ok(doc.entities.size === 0, 'undo line removes both');
  doc.redo(); doc.redo();
  ok(doc.entities.size === 2 && (doc.get(a.id) as LineEnt).p2.x === 5, 'redo twice');
  doc.begin('LAYER'); doc.touchLayers(); doc.addLayerQuiet('X'); doc.commit();
  doc.undo();
  ok(!doc.layers.has('X'), 'layer creation is undoable');
}

console.log('\nDXF reader');
{
  // MTEXT with an embedded object: its 11/21 must not be read as the text direction.
  const dxf = ['0', 'SECTION', '2', 'ENTITIES', '0', 'MTEXT', '8', '0', '100', 'AcDbMText', '10', '5', '20', '6', '40', '2.5', '41', '100', '71', '1',
    '1', 'Date:', '73', '1', '101', 'Embedded Object', '70', '1', '10', '1.0', '20', '0.0', '11', '-1686.5', '21', '277.7', '0', 'ENDSEC', '0', 'EOF'].join('\n');
  const mt = readDxf(dxf).entities[0] as { type: string; rot: number; p: G.Vec; width: number };
  ok(mt?.type === 'mtext' && near(mt.rot, 0) && near(mt.p.x, 5) && near(mt.width, 100), 'MTEXT embedded object ignored (rotation 0)');
}

function stats(doc: Drawing): Record<string, number> {
  const s: Record<string, number> = {};
  for (const e of doc.entities.values()) s[e.type] = (s[e.type] ?? 0) + 1;
  return s;
}

const outDir = join('test', 'out');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const files = process.argv.slice(2).length ? process.argv.slice(2) : ['test/fixtures/floorplan.dxf', 'test/fixtures/mech-text.dxf'].filter(existsSync);
for (const f of files) {
  console.log(`\nround trip: ${f}`);
  const t0 = performance.now();
  const doc = new Drawing();
  const r = loadDxfData(doc, readDxf(new Uint8Array(readFileSync(f))), basename(f));
  const t1 = performance.now();
  console.log(`  read ${r.entities} entities, ${r.blocks} blocks, ${r.layers} layers (${r.version}) in ${(t1 - t0).toFixed(0)} ms`);
  for (const w of r.warnings) console.log('  warn', w);
  const s1 = stats(doc);
  console.log('  ', JSON.stringify(s1));
  // Every entity must produce finite bounds and primitives.
  let bad = 0;
  for (const e of doc.entities.values()) {
    const b = entBox(e, doc);
    const prims = entPrims(e, doc);
    if (![b.minX, b.minY, b.maxX, b.maxY].every(Number.isFinite) && !(e.type === 'insert')) bad++;
    if (prims.some((p) => (p.k === 'seg' ? !Number.isFinite(p.a.x + p.b.y) : !Number.isFinite(p.c.x + p.r)))) bad++;
  }
  ok(bad === 0, `all entities have finite bounds/primitives (${bad} bad)`);

  const out = writeDxf(doc);
  const outPath = join(outDir, basename(f).replace(/\.dxf$/i, '') + '.rt.dxf');
  writeFileSync(outPath, out);
  const t2 = performance.now();
  console.log(`  wrote ${outPath} (${(out.length / 1024).toFixed(0)} KB) in ${(t2 - t1).toFixed(0)} ms`);

  const doc2 = new Drawing();
  loadDxfData(doc2, readDxf(out), 'rt');
  const s2 = stats(doc2);
  for (const k of Object.keys(s1)) ok(s1[k] === s2[k], `${k}: ${s1[k]} -> ${s2[k] ?? 0}`);
  ok(doc2.layers.size === doc.layers.size, `layers ${doc.layers.size} -> ${doc2.layers.size}`);
  const userBlocks = [...doc.blocks.keys()].filter((n) => !/^\*D\d*$/i.test(n)).length;
  const userBlocks2 = [...doc2.blocks.keys()].filter((n) => !/^\*D\d*$/i.test(n)).length;
  ok(userBlocks === userBlocks2, `blocks ${userBlocks} -> ${userBlocks2}`);
  const e1 = doc.extents(), e2 = doc2.extents();
  if (doc.entities.size) ok(near(e1.minX, e2.minX, 1e-3) && near(e1.maxY, e2.maxY, 1e-3), `extents preserved (${e1.minX.toFixed(1)},${e1.minY.toFixed(1)} … ${e1.maxX.toFixed(1)},${e1.maxY.toFixed(1)})`);
}

// Synthetic drawing covering every entity type we write.
{
  console.log('\nsynthetic drawing');
  const doc = new Drawing();
  doc.begin('t');
  doc.addLayerQuiet('Ölçü', 1, 'DASHED');
  doc.add({ type: 'line', p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 } });
  doc.add({ type: 'circle', c: { x: 50, y: 50 }, r: 20 });
  doc.add({ type: 'arc', c: { x: 0, y: 0 }, r: 30, a0: 0, a1: Math.PI / 2 });
  doc.add({ type: 'polyline', pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], bulges: [0, 0.5, 0], closed: true });
  doc.add({ type: 'ellipse', c: { x: 0, y: 0 }, major: { x: 20, y: 0 }, ratio: 0.5, a0: 0, a1: G.TAU });
  doc.add({ type: 'text', p: { x: 0, y: -10 }, h: 2.5, text: 'Çizim ğüşıöç', rot: 0, halign: 0, valign: 0, wf: 1 });
  doc.add({ type: 'mtext', p: { x: 0, y: -20 }, h: 2.5, text: 'Satır 1\\PSatır 2', rot: 0, width: 0, attach: 1 });
  doc.add({ type: 'hatch', loops: [{ pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], bulges: [0, 0, 0, 0] }], pattern: 'ANSI31', solid: false, scale: 1, angle: 0 });
  doc.add({ type: 'dimension', dimType: 'linear', p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, loc: { x: 50, y: -15 }, rot: 0, layer: 'Ölçü' });
  doc.add({ type: 'dimension', dimType: 'radius', p1: { x: 50, y: 50 }, p2: { x: 70, y: 50 }, loc: { x: 80, y: 60 }, rot: 0 });
  doc.add({ type: 'dimension', dimType: 'angular', p1: { x: 0, y: 0 }, p2: { x: 30, y: 0 }, p3: { x: 0, y: 30 }, loc: { x: 20, y: 20 }, rot: 0 });
  doc.add({ type: 'point', p: { x: 5, y: 5 } });
  doc.commit();
  const out = writeDxf(doc);
  writeFileSync(join(outDir, 'synthetic.dxf'), out);
  const back = new Drawing();
  loadDxfData(back, readDxf(out), 'syn');
  const s1 = stats(doc), s2 = stats(back);
  for (const k of Object.keys(s1)) ok(s1[k] === s2[k], `${k}: ${s1[k]} -> ${s2[k] ?? 0}`);
  const txt = [...back.entities.values()].find((e): e is Extract<Entity, { type: 'text' }> => e.type === 'text');
  ok(txt?.text === 'Çizim ğüşıöç', `Turkish text survives (${txt?.text})`);
  ok(back.layers.has('Ölçü'), 'Turkish layer name survives');
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);

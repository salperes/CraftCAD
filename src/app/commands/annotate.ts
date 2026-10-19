// Annotation commands: TEXT, MTEXT, TEXTEDIT, DIMLINEAR, DIMALIGNED, DIMRADIUS,
// DIMDIAMETER, DIMANGULAR, MLEADER.

import { type Vec, dist, angleBetween, polar, sub, fmtNum, deg, lineLine, normAng, sweep, add, mul, norm } from '../../core/geom.ts';
import {
  type NewEntity, type DimEnt, type TextEnt, type MTextEnt, type Entity, MTEXT_LINE_SPACING, arrowPts,
} from '../../core/entities.ts';
import type { Editor } from '../editor.ts';

const isPt = (x: unknown): x is Vec => typeof x === 'object' && x !== null && 'x' in x;

const JUSTIFY: Record<string, [number, number]> = {
  Left: [0, 0], Center: [1, 0], Right: [2, 0], Middle: [4, 0],
  TL: [0, 3], TC: [1, 3], TR: [2, 3], ML: [0, 2], MC: [1, 2], MR: [2, 2], BL: [0, 1], BC: [1, 1], BR: [2, 1],
};

export async function TEXT(ed: Editor): Promise<void> {
  const h = ed.doc.header;
  ed.print(`Current text style:  "Standard"  Text height:  ${fmtNum(h.textsize)}  Annotative:  No  Justify:  Left`);
  let just: [number, number] = [0, 0];
  let r = await ed.getPoint('Specify start point of text or [Justify/Style]:', { keywords: ['Justify', 'Style'] });
  if (r.kind === 'keyword' && r.kw === 'Justify') {
    const j = await ed.getKeyword('Enter an option [Left/Center/Right/Middle/TL/TC/TR/ML/MC/MR/BL/BC/BR]:', Object.keys(JUSTIFY), 'Left');
    just = JUSTIFY[j];
    r = await ed.getPoint('Specify insertion point of text:');
  }
  if (r.kind !== 'point') return;
  const p = r.p;
  const ht = await ed.getDistance(`Specify height <${fmtNum(h.textsize)}>:`, { base: p, def: h.textsize });
  if (typeof ht !== 'number' || ht <= 0) return;
  h.textsize = ht;
  const rot = await ed.getAngle('Specify rotation angle of text <0>:', { base: p, def: 0 });
  if (typeof rot !== 'number') return;
  const s = await ed.ui.editText({ initial: '', multiline: true, at: p, height: ht });
  if (!s) return;
  const lines = s.split('\n');
  const lh = ht * MTEXT_LINE_SPACING;
  lines.forEach((line, i) => {
    if (!line) return;
    const q = polar(p, rot - Math.PI / 2, lh * i);
    ed.doc.add({ type: 'text', p: q, h: ht, text: line, rot, halign: just[0], valign: just[1], wf: 1 });
  });
}

export async function MTEXT(ed: Editor): Promise<void> {
  const h = ed.doc.header;
  ed.print(`Current text style:  "Standard"  Text height:  ${fmtNum(h.textsize)}  Annotative:  No`);
  const a = await ed.point('Specify first corner:');
  if (!isPt(a)) return;
  let ht = h.textsize;
  let rot = 0;
  for (;;) {
    const r = await ed.getPoint('Specify opposite corner or [Height/Justify/Line spacing/Rotation/Style/Width/Columns]:', {
      keywords: ['Height', 'Justify', 'Line spacing', 'Rotation', 'Style', 'Width', 'Columns'],
      preview: (q) => {
        const pts = [a, { x: q.x, y: a.y }, q, { x: a.x, y: q.y }];
        return [{ type: 'polyline', pts, bulges: [0, 0, 0, 0], closed: true }];
      },
    });
    if (r.kind === 'keyword') {
      if (r.kw === 'Height') { const v = await ed.getDistance(`Specify height <${fmtNum(ht)}>:`, { base: a, def: ht }); if (typeof v === 'number' && v > 0) { ht = v; h.textsize = v; } }
      else if (r.kw === 'Rotation') { const v = await ed.getAngle('Specify rotation angle <0>:', { base: a, def: 0 }); if (typeof v === 'number') rot = v; }
      continue;
    }
    if (r.kind !== 'point') return;
    const b = r.p;
    const width = Math.abs(b.x - a.x);
    const tl = { x: Math.min(a.x, b.x), y: Math.max(a.y, b.y) };
    const s = await ed.ui.editText({ initial: '', multiline: true, at: tl, height: ht });
    if (!s) return;
    ed.doc.add({ type: 'mtext', p: tl, h: ht, text: s.replace(/\r?\n/g, '\\P'), rot, width, attach: 1 });
    return;
  }
}

export async function TEXTEDIT(ed: Editor): Promise<void> {
  let ids = ed.takePickfirst().filter((id) => { const e = ed.doc.get(id); return e?.type === 'text' || e?.type === 'mtext'; });
  for (;;) {
    let e: Entity | undefined;
    if (ids.length) e = ed.doc.get(ids.shift()!);
    else {
      const r = await ed.getEntity('Select an annotation object or [Undo]:', { filter: (x) => x.type === 'text' || x.type === 'mtext' || x.type === 'dimension', allowNone: true });
      if (r.kind !== 'entity') return;
      e = ed.doc.get(r.id);
    }
    if (!e) return;
    if (e.type === 'text') {
      const s = await ed.ui.editText({ initial: e.text, multiline: false, at: e.p, height: e.h });
      if (s !== null && s !== e.text) ed.doc.update({ ...(e as TextEnt), text: s });
    } else if (e.type === 'mtext') {
      const plain = (e as MTextEnt).text.replace(/\\P/g, '\n');
      const s = await ed.ui.editText({ initial: plain, multiline: true, at: e.p, height: e.h });
      if (s !== null) ed.doc.update({ ...(e as MTextEnt), text: s.replace(/\r?\n/g, '\\P') });
    } else if (e.type === 'dimension') {
      const s = await ed.ui.editText({ initial: (e as DimEnt).textOverride ?? '<>', multiline: false, at: (e as DimEnt).loc, height: ed.doc.dimStyle.dimtxt });
      if (s !== null) ed.doc.update({ ...(e as DimEnt), textOverride: s === '<>' ? undefined : s, block: undefined });
    }
  }
}

// ---------------------------------------------------------------------------
// Dimensions

async function dimTextOptions(ed: Editor, kw: string, cur: { text?: string; rot?: number }): Promise<void> {
  if (kw === 'Text' || kw === 'Mtext') {
    const s = await ed.getText('Enter dimension text <<>>:', { allowSpaces: true });
    cur.text = s === '' ? undefined : s;
  } else if (kw === 'Angle') {
    const a = await ed.getAngle('Specify angle of dimension text:');
    if (typeof a === 'number') cur.rot = a;
  }
}

async function pickExtOrigins(ed: Editor): Promise<[Vec, Vec] | null> {
  const r = await ed.getPoint('Specify first extension line origin or <select object>:', { allowNone: true });
  if (r.kind === 'none') {
    const s = await ed.getEntity('Select object to dimension:', { filter: (e) => e.type === 'line' || e.type === 'arc' || e.type === 'circle' || e.type === 'polyline' });
    if (s.kind !== 'entity') return null;
    const e = ed.doc.get(s.id)!;
    if (e.type === 'line') return [e.p1, e.p2];
    if (e.type === 'arc') return [polar(e.c, e.a0, e.r), polar(e.c, e.a1, e.r)];
    if (e.type === 'circle') { const a = angleBetween(e.c, s.p); return [polar(e.c, a, e.r), polar(e.c, a + Math.PI, e.r)]; }
    if (e.type === 'polyline') {
      let best = 0, bd = Infinity;
      for (let i = 0; i + 1 < e.pts.length; i++) { const d = dist(s.p, e.pts[i]) + dist(s.p, e.pts[i + 1]); if (d < bd) { bd = d; best = i; } }
      return [e.pts[best], e.pts[best + 1]];
    }
    return null;
  }
  if (r.kind !== 'point') return null;
  const p2 = await ed.point('Specify second extension line origin:', { base: r.p, rubber: true });
  if (!isPt(p2)) return null;
  return [r.p, p2];
}

function autoLinearRot(p1: Vec, p2: Vec, loc: Vec): number {
  const minX = Math.min(p1.x, p2.x), maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y), maxY = Math.max(p1.y, p2.y);
  const outX = loc.x < minX || loc.x > maxX, outY = loc.y < minY || loc.y > maxY;
  if (outY && !outX) return 0;
  if (outX && !outY) return Math.PI / 2;
  const dx = Math.min(Math.abs(loc.x - minX), Math.abs(loc.x - maxX));
  const dy = Math.min(Math.abs(loc.y - minY), Math.abs(loc.y - maxY));
  return dy >= dx ? 0 : Math.PI / 2;
}

export async function DIMLINEAR(ed: Editor): Promise<void> {
  const o = await pickExtOrigins(ed);
  if (!o) return;
  const [p1, p2] = o;
  const cur: { text?: string; rot?: number } = {};
  let fixed: number | null = null;
  for (;;) {
    const mk = (loc: Vec): NewEntity => ({ type: 'dimension', dimType: 'linear', p1, p2, loc, rot: fixed ?? autoLinearRot(p1, p2, loc), textOverride: cur.text });
    const r = await ed.getPoint('Specify dimension line location or [Mtext/Text/Angle/Horizontal/Vertical/Rotated]:', {
      keywords: ['Mtext', 'Text', 'Angle', 'Horizontal', 'Vertical', 'Rotated'], preview: (q) => [mk(q)],
    });
    if (r.kind === 'point') {
      const e = ed.doc.add(mk(r.p)) as DimEnt;
      ed.print(`Dimension text = ${fmtNum(Math.abs((p2.x - p1.x) * Math.cos(e.rot) + (p2.y - p1.y) * Math.sin(e.rot)))}`);
      return;
    }
    if (r.kind !== 'keyword') return;
    if (r.kw === 'Horizontal') fixed = 0;
    else if (r.kw === 'Vertical') fixed = Math.PI / 2;
    else if (r.kw === 'Rotated') { const a = await ed.getAngle('Specify angle of dimension line <0>:', { def: 0 }); if (typeof a === 'number') fixed = a; }
    else await dimTextOptions(ed, r.kw, cur);
  }
}

export async function DIMALIGNED(ed: Editor): Promise<void> {
  const o = await pickExtOrigins(ed);
  if (!o) return;
  const [p1, p2] = o;
  const cur: { text?: string } = {};
  for (;;) {
    const mk = (loc: Vec): NewEntity => ({ type: 'dimension', dimType: 'aligned', p1, p2, loc, rot: 0, textOverride: cur.text });
    const r = await ed.getPoint('Specify dimension line location or [Mtext/Text/Angle]:', { keywords: ['Mtext', 'Text', 'Angle'], preview: (q) => [mk(q)] });
    if (r.kind === 'point') { ed.doc.add(mk(r.p)); ed.print(`Dimension text = ${fmtNum(dist(p1, p2))}`); return; }
    if (r.kind !== 'keyword') return;
    await dimTextOptions(ed, r.kw, cur);
  }
}

async function radialDim(ed: Editor, kind: 'radius' | 'diameter'): Promise<void> {
  const s = await ed.getEntity('Select arc or circle:', { filter: (e) => e.type === 'arc' || e.type === 'circle' || (e.type === 'polyline' && e.bulges.some((b) => Math.abs(b) > 1e-12)) });
  if (s.kind !== 'entity') return;
  const e = ed.doc.get(s.id)!;
  let c: Vec, R: number;
  if (e.type === 'arc' || e.type === 'circle') { c = e.c; R = e.r; }
  else return void ed.print('Select an arc or circle.');
  const cur: { text?: string } = {};
  ed.print(`Dimension text = ${kind === 'radius' ? fmtNum(R) : fmtNum(R * 2)}`);
  for (;;) {
    const mk = (loc: Vec): NewEntity => {
      const a = angleBetween(c, loc);
      return kind === 'radius'
        ? { type: 'dimension', dimType: 'radius', p1: c, p2: polar(c, a, R), loc, rot: 0, textOverride: cur.text }
        : { type: 'dimension', dimType: 'diameter', p1: polar(c, a, R), p2: polar(c, a + Math.PI, R), loc, rot: 0, textOverride: cur.text };
    };
    const r = await ed.getPoint('Specify dimension line location or [Mtext/Text/Angle]:', { keywords: ['Mtext', 'Text', 'Angle'], preview: (q) => [mk(q)] });
    if (r.kind === 'point') { ed.doc.add(mk(r.p)); return; }
    if (r.kind !== 'keyword') return;
    await dimTextOptions(ed, r.kw, cur);
  }
}

export const DIMRADIUS = (ed: Editor) => radialDim(ed, 'radius');
export const DIMDIAMETER = (ed: Editor) => radialDim(ed, 'diameter');

export async function DIMANGULAR(ed: Editor): Promise<void> {
  const s = await ed.getEntity('Select arc, circle, line, or <specify vertex>:', {
    filter: (e) => e.type === 'line' || e.type === 'arc' || e.type === 'circle', allowNone: true,
  });
  let vtx: Vec, a: Vec, b: Vec;
  if (s.kind === 'none') {
    const v = await ed.point('Specify angle vertex:');
    if (!isPt(v)) return;
    const p1 = await ed.point('Specify first angle endpoint:', { base: v, rubber: true });
    if (!isPt(p1)) return;
    const p2 = await ed.point('Specify second angle endpoint:', { base: v, rubber: true });
    if (!isPt(p2)) return;
    vtx = v; a = p1; b = p2;
  } else if (s.kind === 'entity') {
    const e = ed.doc.get(s.id)!;
    if (e.type === 'arc') { vtx = e.c; a = polar(e.c, e.a0, e.r); b = polar(e.c, e.a1, e.r); }
    else if (e.type === 'circle') {
      vtx = e.c; a = polar(e.c, angleBetween(e.c, s.p), e.r);
      const p2 = await ed.point('Specify second angle endpoint:', { base: e.c, rubber: true });
      if (!isPt(p2)) return;
      b = p2;
    } else if (e.type === 'line') {
      const s2 = await ed.getEntity('Select second line:', { filter: (x) => x.type === 'line' && x.id !== e.id });
      if (s2.kind !== 'entity') return;
      const l2 = ed.doc.get(s2.id) as Entity & { type: 'line' };
      const x = lineLine(e.p1, e.p2, l2.p1, l2.p2);
      if (!x) { ed.print('Lines are parallel.', 'error'); return; }
      vtx = x;
      // Use the endpoints on the picked sides.
      a = dist(s.p, e.p1) < dist(s.p, e.p2) ? e.p1 : e.p2;
      if (dist(a, x) < 1e-9) a = a === e.p1 ? e.p2 : e.p1;
      b = dist(s2.p, l2.p1) < dist(s2.p, l2.p2) ? l2.p1 : l2.p2;
      if (dist(b, x) < 1e-9) b = b === l2.p1 ? l2.p2 : l2.p1;
    } else return;
  } else return;
  const cur: { text?: string } = {};
  for (;;) {
    const mk = (loc: Vec): NewEntity => ({ type: 'dimension', dimType: 'angular', p1: vtx, p2: a, p3: b, loc, rot: 0, textOverride: cur.text });
    const r = await ed.getPoint('Specify dimension arc line location or [Mtext/Text/Angle/Quadrant]:', { keywords: ['Mtext', 'Text', 'Angle', 'Quadrant'], preview: (q) => [mk(q)] });
    if (r.kind === 'point') {
      ed.doc.add(mk(r.p));
      const sw = sweep(angleBetween(vtx, a), angleBetween(vtx, b));
      const inside = normAng(angleBetween(vtx, r.p) - angleBetween(vtx, a)) <= sw;
      ed.print(`Dimension text = ${fmtNum(deg(inside ? sw : 2 * Math.PI - sw), 0)}`);
      return;
    }
    if (r.kind !== 'keyword') return;
    await dimTextOptions(ed, r.kw, cur);
  }
}

export async function MLEADER(ed: Editor): Promise<void> {
  const tip = await ed.point('Specify leader arrowhead location or [leader Landing first/Content first/Options] <Options>:');
  if (!isPt(tip)) return;
  const land = await ed.point('Specify leader landing location:', {
    base: tip, preview: (q) => [{ type: 'line', p1: tip, p2: q }, { type: 'solid', pts: arrowPts(tip, sub(tip, q), ed.doc.dimStyle.dimasz) }],
  });
  if (!isPt(land)) return;
  const h = ed.doc.dimStyle.dimtxt * ed.doc.dimStyle.dimscale;
  const right = land.x >= tip.x;
  const landEnd = add(land, mul({ x: right ? 1 : -1, y: 0 }, h * 2));
  const s = await ed.ui.editText({ initial: '', multiline: true, at: landEnd, height: h });
  if (!s) return;
  const asz = ed.doc.dimStyle.dimasz * ed.doc.dimStyle.dimscale;
  ed.doc.add({ type: 'polyline', pts: [tip, land, landEnd], bulges: [0, 0, 0], closed: false });
  ed.doc.add({ type: 'solid', pts: arrowPts(tip, norm(sub(tip, land)), asz) });
  ed.doc.add({ type: 'mtext', p: add(landEnd, { x: right ? h * 0.5 : -h * 0.5, y: 0 }), h, text: s.replace(/\r?\n/g, '\\P'), rot: 0, width: 0, attach: right ? 4 : 6 });
}

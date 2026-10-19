// Modify commands: ERASE, MOVE, COPY, ROTATE, SCALE, MIRROR, OFFSET, TRIM, EXTEND,
// FILLET, CHAMFER, ARRAY, EXPLODE, STRETCH, BREAK, JOIN, MATCHPROP.

import {
  type Vec, type Prim, type Mat,
  sub, dist, angleBetween, polar, fmtNum, deg, rad, mxTranslate, mxRotate, mxScale, mxMirror, mxMul, boxIntersects,
  boxExpand, eq, TAU,
} from '../../core/geom.ts';
import { type Entity, type NewEntity, type LineEnt, entTransform, entExplode, entPrims } from '../../core/entities.ts';
import {
  isCurve, trimCurve, extendCurve, offsetEntity, filletLines, chamferLines, stretchEntity, breakCurve,
} from '../../core/modify.ts';
import { type Editor, stripId } from '../editor.ts';

const isPt = (x: unknown): x is Vec => typeof x === 'object' && x !== null && 'x' in x;

/** Commits the step so the command's own Undo option reverts just the last step. */
function nextStep(ed: Editor, name: string): void {
  ed.doc.commit();
  ed.doc.begin(name);
}

async function selectEditable(ed: Editor, msg = 'Select objects'): Promise<number[]> {
  const ids = await ed.getSelection(msg);
  const ok = ids.filter((id) => { const e = ed.doc.get(id); return e && ed.doc.isEditable(e); });
  if (ok.length < ids.length) ed.print(`${ids.length - ok.length} were on a locked layer.`);
  return ok;
}

function previewTransform(ed: Editor, ids: number[], m: Mat): NewEntity[] {
  const out: NewEntity[] = [];
  for (const id of ids.slice(0, 2000)) {
    const e = ed.doc.get(id);
    if (e) out.push(stripId(entTransform(e, m, ed.doc.header.mirrtext)));
  }
  return out;
}

function applyTransform(ed: Editor, ids: number[], m: Mat, copy: boolean): void {
  for (const id of ids) {
    const e = ed.doc.get(id);
    if (!e) continue;
    const t = entTransform(e, m, ed.doc.header.mirrtext);
    if (copy) ed.doc.add(stripId(t));
    else ed.doc.update(t);
  }
}

export async function ERASE(ed: Editor): Promise<void> {
  const ids = await selectEditable(ed);
  for (const id of ids) ed.doc.remove(id);
  ed.clearSelection();
}

async function basePoint(ed: Editor, msg = 'Specify base point or [Displacement]'): Promise<Vec | null> {
  const r = await ed.getPoint(`${msg} <Displacement>:`, { keywords: ['Displacement'], allowNone: true });
  if (r.kind === 'point') return r.p;
  const d = await ed.point('Specify displacement <0.0000,0.0000>:', { allowNone: true });
  if (isPt(d)) return { x: -d.x, y: -d.y };
  return null;
}

export async function MOVE(ed: Editor): Promise<void> {
  const ids = await selectEditable(ed);
  if (!ids.length) return;
  const base = await basePoint(ed);
  if (!base) return;
  const p = await ed.point('Specify second point or <use first point as displacement>:', {
    base, rubber: true, allowNone: true, preview: (q) => previewTransform(ed, ids, mxTranslate(q.x - base.x, q.y - base.y)),
  });
  const target = isPt(p) ? p : { x: base.x * 2, y: base.y * 2 };
  applyTransform(ed, ids, mxTranslate(target.x - base.x, target.y - base.y), false);
}

export async function COPY(ed: Editor): Promise<void> {
  const ids = await selectEditable(ed);
  if (!ids.length) return;
  ed.print('Current settings:  Copy mode = Multiple');
  const base = await basePoint(ed, 'Specify base point or [Displacement/mOde]');
  if (!base) return;
  let first = true;
  for (;;) {
    const r = await ed.getPoint(first ? 'Specify second point or [Array] <use first point as displacement>:' : 'Specify second point or [Array/Exit/Undo] <Exit>:', {
      base, rubber: true, allowNone: true, keywords: first ? ['Array'] : ['Array', 'Exit', 'Undo'],
      preview: (q) => previewTransform(ed, ids, mxTranslate(q.x - base.x, q.y - base.y)),
    });
    if (r.kind === 'none') {
      if (first) applyTransform(ed, ids, mxTranslate(base.x, base.y), true);
      return;
    }
    if (r.kind === 'keyword') {
      if (r.kw === 'Exit') return;
      if (r.kw === 'Array') {
        const n = await ed.getNumber('Enter number of items to array:', { integer: true, min: 2 });
        const p = await ed.point('Specify second point or [Fit]:', {
          base, rubber: true,
          preview: (q) => { const out: NewEntity[] = []; for (let i = 1; i < n; i++) out.push(...previewTransform(ed, ids, mxTranslate((q.x - base.x) * i, (q.y - base.y) * i))); return out; },
        });
        if (!isPt(p)) return;
        for (let i = 1; i < n; i++) applyTransform(ed, ids, mxTranslate((p.x - base.x) * i, (p.y - base.y) * i), true);
        return;
      }
      continue;
    }
    if (r.kind !== 'point') continue;
    applyTransform(ed, ids, mxTranslate(r.p.x - base.x, r.p.y - base.y), true);
    first = false;
  }
}

export async function ROTATE(ed: Editor): Promise<void> {
  ed.print('Current positive angle in UCS:  ANGDIR=counterclockwise  ANGBASE=0');
  const ids = await selectEditable(ed);
  if (!ids.length) return;
  const base = await ed.point('Specify base point:');
  if (!isPt(base)) return;
  let copy = false;
  for (;;) {
    const a = await ed.getAngle('Specify rotation angle or [Copy/Reference] <0>:', {
      base, def: 0, keywords: ['Copy', 'Reference'], preview: (q) => previewTransform(ed, ids, mxRotate(angleBetween(base, q), base)),
    });
    if (a === 'Copy') { copy = true; ed.print('Rotating a copy of the selected objects.'); continue; }
    if (a === 'Reference') {
      const ref = await ed.getAngle('Specify the reference angle <0>:', { def: 0 });
      if (typeof ref !== 'number') return;
      const na = await ed.getAngle('Specify the new angle or [Points] <0>:', {
        base, def: 0, preview: (q) => previewTransform(ed, ids, mxRotate(angleBetween(base, q) - ref, base)),
      });
      if (typeof na === 'number') applyTransform(ed, ids, mxRotate(na - ref, base), copy);
      return;
    }
    if (typeof a === 'number') applyTransform(ed, ids, mxRotate(a, base), copy);
    return;
  }
}

export async function SCALE(ed: Editor): Promise<void> {
  const ids = await selectEditable(ed);
  if (!ids.length) return;
  const base = await ed.point('Specify base point:');
  if (!isPt(base)) return;
  let copy = false;
  for (;;) {
    const r = await ed.getPoint('Specify scale factor or [Copy/Reference]:', {
      base, keywords: ['Copy', 'Reference'], allowNumber: true, directDistance: false, rubber: true,
      preview: (q) => { const s = dist(base, q); return s > 1e-9 ? previewTransform(ed, ids, mxScale(s, s, base)) : []; },
    });
    if (r.kind === 'keyword' && r.kw === 'Copy') { copy = true; ed.print('Scaling a copy of the selected objects.'); continue; }
    if (r.kind === 'keyword' && r.kw === 'Reference') {
      const ref = await ed.getDistance('Specify reference length <1.0000>:', { def: 1 });
      if (typeof ref !== 'number' || ref <= 0) return;
      const nl = await ed.getDistance('Specify new length or [Points] <1.0000>:', { base, def: 1 });
      if (typeof nl === 'number' && nl > 0) applyTransform(ed, ids, mxScale(nl / ref, nl / ref, base), copy);
      return;
    }
    const s = r.kind === 'number' ? r.value : r.kind === 'point' ? dist(base, r.p) : 0;
    if (s <= 0) { ed.print('Requires a positive number.', 'error'); continue; }
    applyTransform(ed, ids, mxScale(s, s, base), copy);
    return;
  }
}

export async function MIRROR(ed: Editor): Promise<void> {
  const ids = await selectEditable(ed);
  if (!ids.length) return;
  const a = await ed.point('Specify first point of mirror line:');
  if (!isPt(a)) return;
  const b = await ed.point('Specify second point of mirror line:', {
    base: a, rubber: true, preview: (q) => (dist(a, q) > 1e-9 ? previewTransform(ed, ids, mxMirror(a, q)) : []),
  });
  if (!isPt(b) || dist(a, b) < 1e-12) return;
  const erase = await ed.getKeyword('Erase source objects? [Yes/No] <No>:', ['Yes', 'No'], 'No');
  applyTransform(ed, ids, mxMirror(a, b), erase !== 'Yes');
}

export async function OFFSET(ed: Editor): Promise<void> {
  const h = ed.doc.header;
  ed.print(`Current settings: Erase source=No  Layer=Source  OFFSETGAPTYPE=0`);
  let through = false;
  const d = await ed.getDistance(`Specify offset distance or [Through/Erase/Layer] <${through ? 'Through' : fmtNum(h.offsetDist)}>:`, { def: h.offsetDist, keywords: ['Through', 'Erase', 'Layer'] });
  if (d === 'Through') through = true;
  else if (typeof d === 'number') { if (d <= 0) { ed.print('Value must be positive and nonzero.', 'error'); return; } h.offsetDist = d; }
  else return;
  for (;;) {
    const r = await ed.getEntity('Select object to offset or [Exit/Undo] <Exit>:', { keywords: ['Exit', 'Undo'], allowNone: true });
    if (r.kind !== 'entity') { if (r.kind === 'keyword' && r.kw === 'Undo') { ed.doc.undo(); continue; } return; }
    const e = ed.doc.get(r.id)!;
    if (!['line', 'circle', 'arc', 'polyline', 'ellipse'].includes(e.type)) { ed.print('Cannot offset that object.', 'error'); continue; }
    if (through) {
      const p = await ed.point('Specify through point or [Exit/Multiple/Undo] <Exit>:', {
        allowNone: true, preview: (q) => { const o = offsetEntity(e, distToEntity(ed, e, q), q); return o ? [o] : []; },
      });
      if (!isPt(p)) return;
      const o = offsetEntity(e, distToEntity(ed, e, p), p);
      if (o) { ed.doc.add(o); nextStep(ed, 'OFFSET'); }
      continue;
    }
    const side = await ed.point('Specify point on side to offset or [Exit/Multiple/Undo] <Exit>:', {
      allowNone: true, preview: (q) => { const o = offsetEntity(e, h.offsetDist, q); return o ? [o] : []; },
    });
    if (!isPt(side)) return;
    const o = offsetEntity(e, h.offsetDist, side);
    if (o) { ed.doc.add(o); nextStep(ed, 'OFFSET'); } else ed.print('Cannot offset that object at this distance.', 'error');
  }
}

function distToEntity(ed: Editor, e: Entity, p: Vec): number {
  let d = Infinity;
  for (const pr of entPrims(e, ed.doc)) {
    if (pr.k === 'seg') {
      const ab = sub(pr.b, pr.a), l = Math.hypot(ab.x, ab.y);
      d = Math.min(d, Math.abs((ab.x * (p.y - pr.a.y) - ab.y * (p.x - pr.a.x)) / (l || 1)));
    } else d = Math.min(d, Math.abs(dist(pr.c, p) - pr.r));
  }
  return d;
}

/** Cutting/boundary geometry: every visible entity except the target. */
function boundaryPrims(ed: Editor, exclude: number, near?: Vec): Prim[] {
  const out: Prim[] = [];
  const target = ed.doc.get(exclude);
  const tb = target ? boxExpand(ed.doc.box(target), 0) : null;
  const vis = ed.view.visibleBox();
  for (const e of ed.doc.entities.values()) {
    if (e.id === exclude || !ed.doc.isVisible(e)) continue;
    const b = ed.doc.box(e);
    if (!boxIntersects(b, vis) && !(tb && boxIntersects(b, tb))) continue;
    for (const pr of entPrims(e, ed.doc, ed.view.px(0.5))) out.push(pr);
  }
  void near;
  return out;
}

export async function TRIM(ed: Editor): Promise<void> {
  ed.print('Current settings: Projection=UCS, Edge=None, Mode=Quick');
  for (;;) {
    const r = await ed.getEntity('Select object to trim or shift-select to extend or [cuTting edges/Crossing/mOde/Project/eRase/Undo]:', {
      keywords: ['cuTting edges', 'Crossing', 'mOde', 'Project', 'eRase', 'Undo'], allowNone: true,
    });
    if (r.kind === 'none') return;
    if (r.kind === 'keyword') {
      if (r.kw === 'Undo') ed.doc.undo();
      else if (r.kw === 'eRase') { const ids = await selectEditable(ed, 'Select objects to erase'); for (const id of ids) ed.doc.remove(id); }
      else ed.print('Quick mode uses all objects as cutting edges.');
      continue;
    }
    const e = ed.doc.get(r.id)!;
    if (!ed.doc.isEditable(e)) { ed.print('Object is on a locked layer.'); continue; }
    if (!isCurve(e)) { ed.print('Cannot TRIM this object.', 'error'); continue; }
    const res = trimCurve(e, boundaryPrims(ed, e.id), r.p);
    if (!res) { ed.print('Cannot trim; it needs two intersections.'); continue; }
    ed.doc.remove(e.id);
    for (const ne of res) ed.doc.add(ne);
    nextStep(ed, 'TRIM');
  }
}

export async function EXTEND(ed: Editor): Promise<void> {
  ed.print('Current settings: Projection=UCS, Edge=None, Mode=Quick');
  for (;;) {
    const r = await ed.getEntity('Select object to extend or shift-select to trim or [Boundary edges/Crossing/mOde/Project/Undo]:', {
      keywords: ['Boundary edges', 'Crossing', 'mOde', 'Project', 'Undo'], allowNone: true,
    });
    if (r.kind === 'none') return;
    if (r.kind === 'keyword') { if (r.kw === 'Undo') ed.doc.undo(); continue; }
    const e = ed.doc.get(r.id)!;
    if (!isCurve(e)) { ed.print('Cannot EXTEND this object.', 'error'); continue; }
    const res = extendCurve(e, boundaryPrims(ed, e.id), r.p);
    if (!res) { ed.print('Object does not intersect an edge.'); continue; }
    ed.doc.update(res);
    nextStep(ed, 'EXTEND');
  }
}

async function cornerCommand(ed: Editor, kind: 'FILLET' | 'CHAMFER'): Promise<void> {
  const h = ed.doc.header;
  for (;;) {
    ed.print(kind === 'FILLET' ? `Current settings: Mode = TRIM, Radius = ${fmtNum(h.filletRad)}` : `(TRIM mode) Current chamfer Dist1 = ${fmtNum(h.chamferA)}, Dist2 = ${fmtNum(h.chamferB)}`);
    const r1 = await ed.getEntity(kind === 'FILLET' ? 'Select first object or [Undo/Polyline/Radius/Trim/Multiple]:' : 'Select first line or [Undo/Polyline/Distance/Angle/Trim/mEthod/Multiple]:', {
      keywords: kind === 'FILLET' ? ['Undo', 'Polyline', 'Radius', 'Trim', 'Multiple'] : ['Undo', 'Polyline', 'Distance', 'Angle', 'Trim', 'mEthod', 'Multiple'],
      filter: (e) => e.type === 'line',
    });
    if (r1.kind === 'keyword') {
      if (r1.kw === 'Radius') {
        const v = await ed.getDistance(`Specify fillet radius <${fmtNum(h.filletRad)}>:`, { def: h.filletRad });
        if (typeof v === 'number') h.filletRad = v;
        continue;
      }
      if (r1.kw === 'Distance') {
        const a = await ed.getDistance(`Specify first chamfer distance <${fmtNum(h.chamferA)}>:`, { def: h.chamferA });
        if (typeof a === 'number') h.chamferA = a;
        const b = await ed.getDistance(`Specify second chamfer distance <${fmtNum(h.chamferA)}>:`, { def: h.chamferA });
        if (typeof b === 'number') h.chamferB = b;
        continue;
      }
      if (r1.kw === 'Undo') { ed.doc.undo(); continue; }
      ed.print(`${r1.kw} option is not available; only lines are supported.`);
      continue;
    }
    if (r1.kind !== 'entity') return;
    const l1 = ed.doc.get(r1.id) as LineEnt;
    const r2 = await ed.getEntity(kind === 'FILLET' ? 'Select second object or shift-select to apply corner or [Radius]:' : 'Select second line or shift-select to apply corner or [Distance/Angle/Method]:', {
      filter: (e) => e.type === 'line' && e.id !== l1.id,
      keywords: kind === 'FILLET' ? ['Radius'] : ['Distance'],
    });
    if (r2.kind !== 'entity') return;
    const l2 = ed.doc.get(r2.id) as LineEnt;
    const res = kind === 'FILLET' ? filletLines(l1, r1.p, l2, r2.p, h.filletRad) : chamferLines(l1, r1.p, l2, r2.p, h.chamferA, h.chamferB);
    if (typeof res === 'string') { ed.print(res, 'error'); return; }
    ed.doc.update(res.l1);
    ed.doc.update(res.l2);
    if (res.extra) ed.doc.add(res.extra);
    return;
  }
}

export const FILLET = (ed: Editor) => cornerCommand(ed, 'FILLET');
export const CHAMFER = (ed: Editor) => cornerCommand(ed, 'CHAMFER');

export async function ARRAY(ed: Editor): Promise<void> {
  const ids = await selectEditable(ed);
  if (!ids.length) return;
  const t = await ed.getKeyword('Enter array type [Rectangular/PAth/POlar] <Rectangular>:', ['Rectangular', 'PAth', 'POlar'], 'Rectangular');
  if (t === 'POlar') return polarArray(ed, ids);
  if (t === 'PAth') { ed.print('Path arrays are not supported yet.'); return; }
  return rectArray(ed, ids);
}

export async function ARRAYRECT(ed: Editor): Promise<void> {
  const ids = await selectEditable(ed);
  if (ids.length) await rectArray(ed, ids);
}

export async function ARRAYPOLAR(ed: Editor): Promise<void> {
  const ids = await selectEditable(ed);
  if (ids.length) await polarArray(ed, ids);
}

async function rectArray(ed: Editor, ids: number[]): Promise<void> {
  ed.print('Type = Rectangular  Associative = No');
  const cols = await ed.getNumber('Enter the number of columns <4>:', { def: 4, integer: true, min: 1 });
  const rows = await ed.getNumber('Enter the number of rows <3>:', { def: 3, integer: true, min: 1 });
  let b = emptyBoxOf(ed, ids);
  const dx0 = (b.maxX - b.minX) * 1.5 || 10, dy0 = (b.maxY - b.minY) * 1.5 || 10;
  const dx = cols > 1 ? await ed.getDistance(`Specify the distance between columns <${fmtNum(dx0)}>:`, { def: dx0 }) : 0;
  const dy = rows > 1 ? await ed.getDistance(`Specify the distance between rows <${fmtNum(dy0)}>:`, { def: dy0 }) : 0;
  if (typeof dx !== 'number' || typeof dy !== 'number') return;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!r && !c) continue;
    applyTransform(ed, ids, mxTranslate(c * dx, r * dy), true);
  }
  b = emptyBoxOf(ed, ids);
  ed.print(`${cols * rows - 1} copies created.`);
}

function emptyBoxOf(ed: Editor, ids: number[]) {
  let b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const id of ids) {
    const e = ed.doc.get(id);
    if (!e) continue;
    const eb = ed.doc.box(e);
    b = { minX: Math.min(b.minX, eb.minX), minY: Math.min(b.minY, eb.minY), maxX: Math.max(b.maxX, eb.maxX), maxY: Math.max(b.maxY, eb.maxY) };
  }
  return b;
}

async function polarArray(ed: Editor, ids: number[]): Promise<void> {
  ed.print('Type = Polar  Associative = No');
  const c = await ed.point('Specify center point of array or [Base point/Axis of rotation]:');
  if (!isPt(c)) return;
  const n = await ed.getNumber('Enter number of items in the array <6>:', { def: 6, integer: true, min: 2 });
  const fill = await ed.getAngle('Specify the angle to fill (+=ccw, -=cw) <360>:', { def: TAU });
  if (typeof fill !== 'number') return;
  const rot = await ed.getKeyword('Rotate arrayed items? [Yes/No] <Yes>:', ['Yes', 'No'], 'Yes');
  const full = Math.abs(Math.abs(fill) - TAU) < 1e-9;
  const step = full ? fill / n : fill / (n - 1);
  for (let i = 1; i < n; i++) {
    const a = step * i;
    let m: Mat = mxRotate(a, c);
    if (rot === 'No') {
      // translate only: move each object's reference by the rotation of its bbox center
      const b = emptyBoxOf(ed, ids);
      const ctr = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
      const np = polar(c, angleBetween(c, ctr) + a, dist(c, ctr));
      m = mxTranslate(np.x - ctr.x, np.y - ctr.y);
    }
    applyTransform(ed, ids, m, true);
  }
  void mxMul;
}

export async function EXPLODE(ed: Editor): Promise<void> {
  const ids = await selectEditable(ed);
  let n = 0;
  for (const id of ids) {
    const e = ed.doc.get(id);
    if (!e) continue;
    const parts = entExplode(e, ed.doc);
    if (!parts) { ed.print(`1 ${e.type} could not be exploded.`); continue; }
    ed.doc.remove(id);
    for (const p of parts) ed.doc.add(p);
    n++;
  }
  if (n) ed.print(`${n} object(s) exploded.`);
}

export async function STRETCH(ed: Editor): Promise<void> {
  ed.print('Select objects to stretch by crossing-window or crossing-polygon...');
  ed.lastWindow = null;
  ed.takePickfirst();
  const ids = await ed.getSelection('Select objects', { noPickfirst: true, crossingOnly: true });
  const box = ed.lastWindow;
  if (!ids.length) return;
  if (!box) { ed.print('STRETCH needs a crossing window; objects will be moved.'); }
  const base = await basePoint(ed);
  if (!base) return;
  const doStretch = (q: Vec, commit: boolean): NewEntity[] => {
    const d = sub(q, base);
    const out: NewEntity[] = [];
    for (const id of ids) {
      const e = ed.doc.get(id);
      if (!e || !ed.doc.isEditable(e)) continue;
      const s = box ? stretchEntity(e, box, d) : entTransform(e, mxTranslate(d.x, d.y));
      if (!s) continue;
      if (commit) ed.doc.update(s); else out.push(stripId(s));
    }
    return out;
  };
  const p = await ed.point('Specify second point or <use first point as displacement>:', { base, rubber: true, preview: (q) => doStretch(q, false) });
  if (isPt(p)) doStretch(p, true);
}

export async function BREAK(ed: Editor): Promise<void> {
  const r = await ed.getEntity('Select object:', { filter: (e) => isCurve(e) });
  if (r.kind !== 'entity') return;
  let p1 = r.p;
  const p2r = await ed.getPoint('Specify second break point or [First point]:', { keywords: ['First point'] });
  let p2: Vec;
  if (p2r.kind === 'keyword') {
    const a = await ed.point('Specify first break point:');
    if (!isPt(a)) return;
    p1 = a;
    const b = await ed.point('Specify second break point:', { base: a, rubber: true });
    if (!isPt(b)) return;
    p2 = b;
  } else if (p2r.kind === 'point') p2 = p2r.p;
  else return;
  const e = ed.doc.get(r.id)!;
  if (!isCurve(e)) return;
  const res = breakCurve(e, p1, p2);
  if (!res) return;
  ed.doc.remove(e.id);
  for (const ne of res) ed.doc.add(ne);
}

export async function BREAKATPOINT(ed: Editor): Promise<void> {
  const r = await ed.getEntity('Select object:', { filter: (e) => isCurve(e) && e.type !== 'circle' });
  if (r.kind !== 'entity') return;
  const p = await ed.point('Specify break point:');
  if (!isPt(p)) return;
  const e = ed.doc.get(r.id)!;
  if (!isCurve(e)) return;
  const res = breakCurve(e, p, p);
  if (!res) return;
  ed.doc.remove(e.id);
  for (const ne of res) ed.doc.add(ne);
}

/** Joins lines/arcs/polylines that share endpoints into polylines. */
export async function JOIN(ed: Editor): Promise<void> {
  const ids = await selectEditable(ed, 'Select source object or multiple objects to join at once');
  type Piece = { id: number; pts: Vec[]; bulges: number[] };
  const pieces: Piece[] = [];
  for (const id of ids) {
    const e = ed.doc.get(id);
    if (!e) continue;
    if (e.type === 'line') pieces.push({ id, pts: [e.p1, e.p2], bulges: [0] });
    else if (e.type === 'arc') {
      const sw = ((e.a1 - e.a0) % TAU + TAU) % TAU || TAU;
      pieces.push({ id, pts: [polar(e.c, e.a0, e.r), polar(e.c, e.a1, e.r)], bulges: [Math.tan(sw / 4)] });
    } else if (e.type === 'polyline' && !e.closed) pieces.push({ id, pts: e.pts.slice(), bulges: e.bulges.slice(0, e.pts.length - 1) });
  }
  if (pieces.length < 2) { ed.print('Select at least 2 lines, arcs or open polylines.'); return; }
  const tol = 1e-6;
  const reverse = (p: Piece): Piece => ({ id: p.id, pts: p.pts.slice().reverse(), bulges: p.bulges.slice().reverse().map((b) => -b) });
  let chain = pieces.shift()!;
  const used = [chain.id];
  let progress = true;
  while (progress && pieces.length) {
    progress = false;
    for (let i = 0; i < pieces.length; i++) {
      let p = pieces[i];
      const s = chain.pts[0], e = chain.pts[chain.pts.length - 1];
      if (eq(e, p.pts[p.pts.length - 1], tol)) p = reverse(p);
      if (eq(e, p.pts[0], tol)) {
        chain = { id: chain.id, pts: [...chain.pts, ...p.pts.slice(1)], bulges: [...chain.bulges, ...p.bulges] };
      } else {
        if (eq(s, p.pts[0], tol)) p = reverse(p);
        if (!eq(s, p.pts[p.pts.length - 1], tol)) continue;
        chain = { id: chain.id, pts: [...p.pts.slice(0, -1), ...chain.pts], bulges: [...p.bulges, ...chain.bulges] };
      }
      used.push(p.id);
      pieces.splice(i, 1);
      progress = true;
      break;
    }
  }
  if (used.length < 2) { ed.print('Objects do not share endpoints; nothing joined.'); return; }
  const src = ed.doc.get(used[0])!;
  let closed = false;
  if (eq(chain.pts[0], chain.pts[chain.pts.length - 1], tol) && chain.pts.length > 2) { chain.pts.pop(); closed = true; }
  for (const id of used) ed.doc.remove(id);
  ed.doc.add({ type: 'polyline', pts: chain.pts, bulges: closed ? chain.bulges : [...chain.bulges, 0], closed, layer: src.layer, color: src.color, ltype: src.ltype });
  ed.print(`${used.length} objects joined into 1 polyline.`);
}

export async function MATCHPROP(ed: Editor): Promise<void> {
  const r = await ed.getEntity('Select source object:');
  if (r.kind !== 'entity') return;
  const src = ed.doc.get(r.id)!;
  ed.print('Current active settings:  Color Layer Ltype Ltscale');
  for (;;) {
    const t = await ed.getEntity('Select destination object(s) or [Settings]:', { allowNone: true, keywords: ['Settings'] });
    if (t.kind !== 'entity') return;
    const e = ed.doc.get(t.id)!;
    ed.doc.update({ ...e, layer: src.layer, color: src.color, trueColor: src.trueColor, ltype: src.ltype, ltscale: src.ltscale } as Entity);
  }
}

export { deg, rad };

// Entity model and the per-entity operations used by the editor (bounds, picking,
// snapping, grips, transforms, explode). Rendering lives in view/renderer.ts.

import {
  type Vec, type Box, type Mat, type Prim,
  add, sub, mul, dist, mid, norm, perp, polar, angleOf, angleBetween, dir, dot, cross, rotate,
  emptyBox, boxAdd, boxUnion, boxTransform, boxValid, arcBox, seg, arcPrim, bulgeSegPrim,
  mxApply, mxApplyVec, mxDet, mxScaleFactor, mxInsert, mxMul, distToPrim, normAng, sweep,
  flattenBulge, flattenArc, pointInPolygon, TAU, lineLine, fmtNum, deg, primBox, IDENT,
} from './geom.ts';

export const BYLAYER = 256;
export const BYBLOCK = 0;

interface Base {
  id: number;
  layer: string;
  /** ACI color: 0 = ByBlock, 256 = ByLayer, 1..255 index. */
  color: number;
  /** Optional 24-bit true color 0xRRGGBB, overrides `color` when set. */
  trueColor?: number;
  /** Linetype name, or 'ByLayer' / 'ByBlock'. */
  ltype: string;
  ltscale?: number;
}

export interface LineEnt extends Base { type: 'line'; p1: Vec; p2: Vec }
export interface CircleEnt extends Base { type: 'circle'; c: Vec; r: number }
/** Counter-clockwise from a0 to a1 (radians). */
export interface ArcEnt extends Base { type: 'arc'; c: Vec; r: number; a0: number; a1: number }
export interface PolylineEnt extends Base { type: 'polyline'; pts: Vec[]; bulges: number[]; closed: boolean; width?: number }
/** Points: c + major*cos(t) + perp(major)*ratio*sin(t), t from a0 to a1. */
export interface EllipseEnt extends Base { type: 'ellipse'; c: Vec; major: Vec; ratio: number; a0: number; a1: number }
export interface SplineEnt extends Base { type: 'spline'; ctrl: Vec[]; degree: number; knots: number[]; weights?: number[]; closed: boolean; fit?: Vec[] }
export interface PointEnt extends Base { type: 'point'; p: Vec }
export interface TextEnt extends Base {
  type: 'text'; p: Vec; h: number; text: string; rot: number;
  /** 0 left, 1 center, 2 right, 3 aligned, 4 middle, 5 fit */
  halign: number;
  /** 0 baseline, 1 bottom, 2 middle, 3 top */
  valign: number;
  wf: number; style?: string; tag?: string;
}
export interface MTextEnt extends Base {
  type: 'mtext'; p: Vec; h: number; text: string; rot: number; width: number;
  /** 1..9: TL, TC, TR, ML, MC, MR, BL, BC, BR */
  attach: number; style?: string;
}
export interface HatchLoop { pts: Vec[]; bulges: number[] }
export interface PatLine { ang: number; base: Vec; off: Vec; dashes: number[] }
export interface HatchEnt extends Base {
  type: 'hatch'; loops: HatchLoop[]; pattern: string; solid: boolean; scale: number; angle: number;
  /** Pattern definition lines (already in pattern space, before scale/angle), if known. */
  patLines?: PatLine[];
}
export type DimType = 'linear' | 'aligned' | 'radius' | 'diameter' | 'angular';
export interface DimEnt extends Base {
  type: 'dimension'; dimType: DimType;
  /** linear/aligned: ext origins; radius: p1=center,p2=on-curve; diameter: p1,p2 chord ends; angular: p1=vertex,p2,p3 ext points */
  p1: Vec; p2: Vec; p3?: Vec;
  /** dim line location (linear/aligned/angular) or text point (radius/diameter) */
  loc: Vec;
  /** linear rotation (radians) */
  rot: number;
  textOverride?: string;
  /** anonymous block with pre-rendered geometry (from DXF), used when present */
  block?: string;
  measurement?: number;
}
export interface InsertEnt extends Base {
  type: 'insert'; name: string; p: Vec; sx: number; sy: number; rot: number;
  attribs: TextEnt[];
  cols?: number; rows?: number; colSpacing?: number; rowSpacing?: number;
}
export interface SolidEnt extends Base { type: 'solid'; pts: Vec[] }

export type Entity =
  | LineEnt | CircleEnt | ArcEnt | PolylineEnt | EllipseEnt | SplineEnt | PointEnt
  | TextEnt | MTextEnt | HatchEnt | DimEnt | InsertEnt | SolidEnt;
export type EntityType = Entity['type'];

/** Distributes Omit across the union so `type` stays a discriminant. */
type DistOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
export type NewEntity = DistOmit<Entity, 'id' | 'layer' | 'color' | 'ltype'> & Partial<Pick<Base, 'layer' | 'color' | 'ltype'>>;

export interface BlockDef {
  name: string;
  base: Vec;
  entities: Entity[];
  /** cached bounds in block space */
  box?: Box;
}

export interface DimStyle {
  dimscale: number;
  dimtxt: number;
  dimasz: number;
  dimexo: number;
  dimexe: number;
  dimgap: number;
  dimdec: number;
  dimadec: number;
  dimdsep: string;
}

export const defaultDimStyle = (): DimStyle => ({
  dimscale: 1, dimtxt: 2.5, dimasz: 2.5, dimexo: 0.625, dimexe: 1.25, dimgap: 0.625, dimdec: 2, dimadec: 0, dimdsep: ',',
});

/** What entity helpers need to know about the containing drawing. */
export interface DocCtx {
  blocks: Map<string, BlockDef>;
  dimStyle: DimStyle;
}

export const ENT_NAMES: Record<EntityType, string> = {
  line: 'Line', circle: 'Circle', arc: 'Arc', polyline: 'Polyline', ellipse: 'Ellipse', spline: 'Spline',
  point: 'Point', text: 'Text', mtext: 'MText', hatch: 'Hatch', dimension: 'Dimension', insert: 'Block Reference', solid: 'Solid',
};

// ---------------------------------------------------------------------------
// Text measurement

let measureCtx: CanvasRenderingContext2D | null | undefined;
const widthCache = new Map<string, number>();
export const TEXT_FONT = '"Segoe UI", Arial, Helvetica, sans-serif';

/** Width of a single-line string at height 1 (world units per unit height). */
export function textUnitWidth(s: string): number {
  const hit = widthCache.get(s);
  if (hit !== undefined) return hit;
  if (measureCtx === undefined) {
    measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
    if (measureCtx) measureCtx.font = `100px ${TEXT_FONT}`;
  }
  // Cap height of the UI font is ~0.7 of its em size; AutoCAD text height is the cap height.
  const w = measureCtx ? measureCtx.measureText(s).width / 100 / 0.7 : s.length * 0.75;
  if (widthCache.size > 20000) widthCache.clear();
  widthCache.set(s, w);
  return w;
}

/** Strips MTEXT inline formatting codes, returning plain lines. */
export function mtextLines(raw: string): string[] {
  let s = raw;
  s = s.replace(/\\[Pp]/g, '\n');
  s = s.replace(/\\S([^;^#\\]*)[\^#/]([^;]*);/g, '$1/$2');
  s = s.replace(/\\[ACcFfHhQqTtWw][^;]*;/g, '');
  s = s.replace(/\\[LlOoKkNn]/g, '');
  s = s.replace(/\\~/g, ' ');
  s = s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  s = s.replace(/\\([\\{}])/g, '\u0001$1');
  s = s.replace(/[{}]/g, '');
  s = s.replace(/\u0001(.)/g, '$1');
  return decodeSpecialChars(s).split('\n');
}

export function decodeSpecialChars(s: string): string {
  return s
    .replace(/%%[cC]/g, 'Ø')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/%%[uUoO]/g, '')
    .replace(/%%%/g, '%')
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

export const MTEXT_LINE_SPACING = 5 / 3;

/** Word-wraps MTEXT lines to the reference width. */
export function mtextLayout(e: MTextEnt): string[] {
  const lines = mtextLines(e.text);
  if (!(e.width > 0)) return lines;
  const out: string[] = [];
  const maxW = e.width / e.h;
  for (const line of lines) {
    const words = line.split(' ');
    let cur = '';
    for (const w of words) {
      const cand = cur ? cur + ' ' + w : w;
      if (cur && textUnitWidth(cand) > maxW) {
        out.push(cur);
        cur = w;
      } else cur = cand;
    }
    out.push(cur);
  }
  return out;
}

/** Local frame for text: origin at the text's insertion, x along rotation. Returns box corners in local units. */
export function textLocalBox(e: TextEnt): { x0: number; y0: number; x1: number; y1: number } {
  const w = textUnitWidth(decodeSpecialChars(e.text)) * e.h * (e.wf || 1);
  let x0 = 0;
  if (e.halign === 1 || e.halign === 4) x0 = -w / 2;
  else if (e.halign === 2) x0 = -w;
  // y0 is the baseline offset from the insertion point (bottom = descender bottom).
  let y0 = 0;
  if (e.halign === 4 || e.valign === 2) y0 = -e.h / 2;
  else if (e.valign === 1) y0 = e.h * 0.3;
  else if (e.valign === 3) y0 = -e.h;
  return { x0, y0, x1: x0 + w, y1: y0 + e.h };
}

export function mtextLocalBox(e: MTextEnt): { x0: number; y0: number; x1: number; y1: number; lines: string[] } {
  const lines = mtextLayout(e);
  let w = 0;
  for (const l of lines) w = Math.max(w, textUnitWidth(l) * e.h);
  const lh = e.h * MTEXT_LINE_SPACING;
  const total = e.h + (lines.length - 1) * lh;
  const col = (e.attach - 1) % 3;
  const row = Math.floor((e.attach - 1) / 3);
  const x0 = col === 0 ? 0 : col === 1 ? -w / 2 : -w;
  const yTop = row === 0 ? 0 : row === 1 ? total / 2 : total;
  return { x0, y0: yTop - total, x1: x0 + w, y1: yTop, lines };
}

function localBoxCorners(p: Vec, rot: number, b: { x0: number; y0: number; x1: number; y1: number }): Vec[] {
  const pts = [
    { x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 },
  ];
  return pts.map((q) => add(p, rotate(q, { x: 0, y: 0 }, rot)));
}

export function textCorners(e: TextEnt | MTextEnt): Vec[] {
  return e.type === 'text' ? localBoxCorners(e.p, e.rot, textLocalBox(e)) : localBoxCorners(e.p, e.rot, mtextLocalBox(e));
}

// ---------------------------------------------------------------------------
// Ellipse & spline evaluation

export function ellipsePoint(e: { c: Vec; major: Vec; ratio: number }, t: number): Vec {
  const minor = mul(perp(e.major), e.ratio);
  return add(e.c, add(mul(e.major, Math.cos(t)), mul(minor, Math.sin(t))));
}

export function isFullEllipse(e: EllipseEnt): boolean {
  return Math.abs(sweep(e.a0, e.a1) - TAU) < 1e-9 || Math.abs(e.a1 - e.a0) >= TAU - 1e-9;
}

export function flattenEllipse(e: EllipseEnt, maxErr: number): Vec[] {
  const r = Math.max(Math.hypot(e.major.x, e.major.y), 1e-9);
  const full = isFullEllipse(e);
  const s = full ? TAU : sweep(e.a0, e.a1);
  const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - maxErr / r)));
  const n = Math.max(8, Math.min(1440, Math.ceil(s / Math.max(step, 1e-3))));
  const out: Vec[] = [];
  for (let i = 0; i <= n; i++) out.push(ellipsePoint(e, e.a0 + (s * i) / n));
  return out;
}

export function clampedKnots(nCtrl: number, degree: number): number[] {
  const k: number[] = [];
  const nk = nCtrl + degree + 1;
  const inner = nCtrl - degree;
  for (let i = 0; i < nk; i++) {
    if (i <= degree) k.push(0);
    else if (i >= nCtrl) k.push(inner);
    else k.push(i - degree);
  }
  return k;
}

function deBoor(sp: SplineEnt, t: number): Vec {
  const p = sp.degree;
  const U = sp.knots;
  const n = sp.ctrl.length - 1;
  let k = p;
  for (let i = p; i <= n; i++) if (t >= U[i] && t < U[i + 1]) { k = i; break; }
  if (t >= U[n + 1]) k = n;
  const w = sp.weights && sp.weights.length === sp.ctrl.length ? sp.weights : null;
  const d: { x: number; y: number; w: number }[] = [];
  for (let j = 0; j <= p; j++) {
    const idx = Math.min(Math.max(j + k - p, 0), n);
    const cp = sp.ctrl[idx];
    const ww = w ? w[idx] : 1;
    d.push({ x: cp.x * ww, y: cp.y * ww, w: ww });
  }
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = j + k - p;
      const den = U[i + p - r + 1] - U[i];
      const a = den === 0 ? 0 : (t - U[i]) / den;
      d[j] = { x: (1 - a) * d[j - 1].x + a * d[j].x, y: (1 - a) * d[j - 1].y + a * d[j].y, w: (1 - a) * d[j - 1].w + a * d[j].w };
    }
  }
  return { x: d[p].x / d[p].w, y: d[p].y / d[p].w };
}

export function flattenSpline(sp: SplineEnt, maxErr: number): Vec[] {
  const n = sp.ctrl.length;
  if (n === 0) return [];
  if (n <= sp.degree || sp.knots.length !== n + sp.degree + 1) return sp.fit && sp.fit.length > 1 ? sp.fit.slice() : sp.ctrl.slice();
  const t0 = sp.knots[sp.degree], t1 = sp.knots[n];
  let polyLen = 0;
  for (let i = 1; i < n; i++) polyLen += dist(sp.ctrl[i - 1], sp.ctrl[i]);
  const steps = Math.min(4000, Math.max(16, n * 16, Math.ceil(Math.sqrt(polyLen / Math.max(maxErr, 1e-9)) * 4)));
  const out: Vec[] = [];
  for (let i = 0; i <= steps; i++) out.push(deBoor(sp, t0 + ((t1 - t0) * i) / steps));
  return out;
}

// ---------------------------------------------------------------------------
// Dimensions

export interface DimGeom {
  lines: [Vec, Vec][];
  arcs: { c: Vec; r: number; a0: number; a1: number }[];
  arrows: { tip: Vec; dir: Vec }[];
  text: { p: Vec; rot: number; h: number; s: string };
}

export function formatDimValue(val: number, dec: number, sep: string): string {
  let s = val.toFixed(dec);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0') s = '0';
  return sep === '.' ? s : s.replace('.', sep);
}

function readableAngle(a: number): number {
  a = normAng(a);
  if (a > Math.PI / 2 + 1e-9 && a <= (3 * Math.PI) / 2 + 1e-9) a -= Math.PI;
  return a;
}

export function dimMeasurement(e: DimEnt): number {
  switch (e.dimType) {
    case 'linear': return Math.abs(dot(sub(e.p2, e.p1), dir(e.rot)));
    case 'aligned': return dist(e.p1, e.p2);
    case 'radius': return dist(e.p1, e.p2);
    case 'diameter': return dist(e.p1, e.p2);
    case 'angular': {
      const a = angleBetween(e.p1, e.p2), b = angleBetween(e.p1, e.p3 ?? e.p2);
      const ang = sweep(a, b);
      const la = angleBetween(e.p1, e.loc);
      const inside = normAng(la - a) <= ang;
      return deg(inside ? ang : TAU - ang);
    }
  }
}

export function dimText(e: DimEnt, st: DimStyle): string {
  const m = dimMeasurement(e);
  const v = e.dimType === 'angular' ? formatDimValue(m, st.dimadec, st.dimdsep) + '°' : formatDimValue(m, st.dimdec, st.dimdsep);
  const prefix = e.dimType === 'radius' ? 'R' : e.dimType === 'diameter' ? 'Ø' : '';
  const base = prefix + v;
  if (e.textOverride === undefined || e.textOverride === '') return base;
  if (e.textOverride === ' ') return '';
  return decodeSpecialChars(e.textOverride.replace('<>', base));
}

export function dimGeometry(e: DimEnt, st: DimStyle): DimGeom {
  const S = st.dimscale || 1;
  const asz = st.dimasz * S, exo = st.dimexo * S, exe = st.dimexe * S, gap = st.dimgap * S, th = st.dimtxt * S;
  const g: DimGeom = { lines: [], arcs: [], arrows: [], text: { p: e.loc, rot: 0, h: th, s: dimText(e, st) } };
  const tw = textUnitWidth(g.text.s) * th;

  if (e.dimType === 'linear' || e.dimType === 'aligned') {
    const u = e.dimType === 'linear' ? dir(e.rot) : norm(sub(e.p2, e.p1));
    if (Math.hypot(u.x, u.y) < 1e-12) return g;
    const n = perp(u);
    const d1 = add(e.p1, mul(n, dot(sub(e.loc, e.p1), n)));
    const d2 = add(e.p2, mul(n, dot(sub(e.loc, e.p2), n)));
    for (const [p, d] of [[e.p1, d1], [e.p2, d2]] as [Vec, Vec][]) {
      const v = sub(d, p);
      const l = Math.hypot(v.x, v.y);
      if (l > exo) {
        const vn = mul(v, 1 / l);
        g.lines.push([add(p, mul(vn, exo)), add(d, mul(vn, exe))]);
      }
    }
    const span = dist(d1, d2);
    const ud = span > 1e-12 ? norm(sub(d2, d1)) : u;
    const outside = span < asz * 2.2;
    if (outside) {
      g.lines.push([d1, d2]);
      g.lines.push([d1, sub(d1, mul(ud, asz * 2))]);
      g.lines.push([d2, add(d2, mul(ud, asz * 2))]);
      g.arrows.push({ tip: d1, dir: ud }, { tip: d2, dir: mul(ud, -1) });
    } else {
      g.lines.push([d1, d2]);
      g.arrows.push({ tip: d1, dir: mul(ud, -1) }, { tip: d2, dir: ud });
    }
    const rot = readableAngle(angleOf(ud));
    const up = perp(dir(rot));
    g.text = { p: add(mid(d1, d2), mul(up, gap + th / 2)), rot, h: th, s: g.text.s };
    return g;
  }

  if (e.dimType === 'radius' || e.dimType === 'diameter') {
    const c = e.dimType === 'radius' ? e.p1 : mid(e.p1, e.p2);
    const r = e.dimType === 'radius' ? dist(e.p1, e.p2) : dist(e.p1, e.p2) / 2;
    const ang = angleBetween(c, e.loc);
    const u = dir(ang);
    const tip = add(c, mul(u, r));
    const tdist = dist(c, e.loc);
    const rot = readableAngle(ang);
    if (tdist > r) {
      // Text outside: leader from arrow tip to text, arrow points inward onto the curve.
      const end = add(c, mul(u, tdist));
      g.lines.push([tip, end]);
      g.arrows.push({ tip, dir: mul(u, -1) });
      if (e.dimType === 'diameter') {
        const tip2 = sub(c, mul(u, r));
        g.lines.push([tip2, tip]);
        g.arrows.push({ tip: tip2, dir: u });
      }
      const flip = Math.abs(normAng(ang - rot)) > 1e-6;
      const along = flip ? -1 : 1;
      g.lines.push([end, add(end, mul(dir(rot), along * (tw + gap * 2)))]);
      g.text = { p: add(add(end, mul(dir(rot), along * (tw / 2 + gap))), mul(perp(dir(rot)), gap + th / 2)), rot, h: th, s: g.text.s };
    } else {
      const from = e.dimType === 'radius' ? c : sub(c, mul(u, r));
      g.lines.push([from, tip]);
      g.arrows.push({ tip, dir: u });
      if (e.dimType === 'diameter') g.arrows.push({ tip: from, dir: mul(u, -1) });
      g.text = { p: add(e.loc, mul(perp(dir(rot)), gap + th / 2)), rot, h: th, s: g.text.s };
    }
    return g;
  }

  // angular
  const c = e.p1;
  const p3 = e.p3 ?? e.p2;
  let a0 = angleBetween(c, e.p2), a1 = angleBetween(c, p3);
  const la = angleBetween(c, e.loc);
  if (normAng(la - a0) > sweep(a0, a1)) [a0, a1] = [a1, a0];
  const r = dist(c, e.loc);
  g.arcs.push({ c, r, a0, a1 });
  for (const [p, a] of [[e.p2, angleBetween(c, e.p2)], [p3, angleBetween(c, p3)]] as [Vec, number][]) {
    const pd = dist(c, p);
    const s = pd + exo < r ? pd + exo : pd - exo > r ? pd - exo : null;
    if (s !== null) g.lines.push([polar(c, a, s), polar(c, a, r + (r > pd ? exe : -exe))]);
  }
  const t0 = polar(c, a0, r), t1 = polar(c, a1, r);
  g.arrows.push({ tip: t0, dir: { x: Math.sin(a0), y: -Math.cos(a0) } });
  g.arrows.push({ tip: t1, dir: { x: -Math.sin(a1), y: Math.cos(a1) } });
  const am = a0 + sweep(a0, a1) / 2;
  const rot = readableAngle(am - Math.PI / 2);
  g.text = { p: polar(c, am, r + gap + th / 2), rot, h: th, s: g.text.s };
  return g;
}

// ---------------------------------------------------------------------------
// Block helpers

export function blockBox(b: BlockDef, ctx: DocCtx, depth = 0): Box {
  if (b.box) return b.box;
  let box = emptyBox();
  for (const e of b.entities) {
    const eb = entBox(e, ctx, depth + 1);
    if (boxValid(eb)) box = boxUnion(box, eb);
  }
  b.box = box;
  return box;
}

export function insertMatrix(e: InsertEnt, b: BlockDef | undefined, col = 0, row = 0): Mat {
  const base = b ? b.base : { x: 0, y: 0 };
  const off = rotate({ x: col * (e.colSpacing ?? 0), y: row * (e.rowSpacing ?? 0) }, { x: 0, y: 0 }, e.rot);
  return mxInsert(add(e.p, off), e.sx, e.sy, e.rot, base);
}

/** Calls cb for every array instance matrix of an insert. */
export function forEachInsertInstance(e: InsertEnt, b: BlockDef | undefined, cb: (m: Mat) => void): void {
  const cols = Math.max(1, e.cols ?? 1), rows = Math.max(1, e.rows ?? 1);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cb(insertMatrix(e, b, c, r));
}

/** Resolves ByBlock/layer-0 inheritance when an entity is drawn inside an insert. */
export function inheritFromInsert<T extends Entity>(child: T, ins: Pick<Base, 'layer' | 'color' | 'trueColor' | 'ltype'>): T {
  if (child.layer !== '0' && child.color !== BYBLOCK && child.ltype.toLowerCase() !== 'byblock') return child;
  const out = { ...child };
  if (out.layer === '0') out.layer = ins.layer;
  if (out.color === BYBLOCK) {
    out.color = ins.color;
    out.trueColor = ins.trueColor;
  }
  if (out.ltype.toLowerCase() === 'byblock') out.ltype = ins.ltype;
  return out;
}

const MAX_BLOCK_DEPTH = 12;

// ---------------------------------------------------------------------------
// Bounds

export function entBox(e: Entity, ctx: DocCtx, depth = 0): Box {
  const b = emptyBox();
  switch (e.type) {
    case 'line': boxAdd(b, e.p1); boxAdd(b, e.p2); return b;
    case 'circle': return { minX: e.c.x - e.r, minY: e.c.y - e.r, maxX: e.c.x + e.r, maxY: e.c.y + e.r };
    case 'arc': return arcBox(e.c, e.r, e.a0, e.a1);
    case 'polyline': {
      const n = e.pts.length;
      for (let i = 0; i < n; i++) {
        boxAdd(b, e.pts[i]);
        const j = i + 1 < n ? i + 1 : e.closed ? 0 : -1;
        if (j >= 0 && Math.abs(e.bulges[i] || 0) > 1e-12) {
          const pr = bulgeSegPrim(e.pts[i], e.pts[j], e.bulges[i]);
          const pb = primBox(pr);
          boxAdd(b, { x: pb.minX, y: pb.minY });
          boxAdd(b, { x: pb.maxX, y: pb.maxY });
        }
      }
      return b;
    }
    case 'ellipse': for (const p of flattenEllipse(e, Math.hypot(e.major.x, e.major.y) * 0.002)) boxAdd(b, p); return b;
    case 'spline': for (const p of flattenSpline(e, 0.01)) boxAdd(b, p); return b;
    case 'point': boxAdd(b, e.p); return b;
    case 'text': case 'mtext': for (const p of textCorners(e)) boxAdd(b, p); return b;
    case 'hatch': for (const l of e.loops) for (const p of l.pts) boxAdd(b, p); return b;
    case 'solid': for (const p of e.pts) boxAdd(b, p); return b;
    case 'dimension': {
      const blk = e.block ? ctx.blocks.get(e.block) : undefined;
      if (blk && depth < MAX_BLOCK_DEPTH) {
        const bb = blockBox(blk, ctx, depth + 1);
        if (boxValid(bb)) return bb;
      }
      const g = dimGeometry(e, ctx.dimStyle);
      for (const [p, q] of g.lines) { boxAdd(b, p); boxAdd(b, q); }
      for (const a of g.arcs) { const ab = arcBox(a.c, a.r, a.a0, a.a1); boxAdd(b, { x: ab.minX, y: ab.minY }); boxAdd(b, { x: ab.maxX, y: ab.maxY }); }
      boxAdd(b, g.text.p);
      boxAdd(b, e.p1); boxAdd(b, e.p2);
      return b;
    }
    case 'insert': {
      const blk = ctx.blocks.get(e.name);
      let out = emptyBox();
      if (blk && depth < MAX_BLOCK_DEPTH) {
        const bb = blockBox(blk, ctx, depth + 1);
        if (boxValid(bb)) forEachInsertInstance(e, blk, (m) => { out = boxUnion(out, boxTransform(bb, m)); });
      }
      for (const a of e.attribs) out = boxUnion(out, entBox(a, ctx, depth + 1));
      if (!boxValid(out)) boxAdd(out, e.p);
      return out;
    }
  }
}

// ---------------------------------------------------------------------------
// Primitives

function primTransform(pr: Prim, m: Mat, out: Prim[], maxErr: number): void {
  if (pr.k === 'seg') {
    out.push(seg(mxApply(m, pr.a), mxApply(m, pr.b)));
    return;
  }
  const det = mxDet(m);
  const similar = Math.abs(Math.abs(m.a) - Math.abs(m.d)) < 1e-9 * (Math.abs(m.a) + 1) && Math.abs(Math.abs(m.b) - Math.abs(m.c)) < 1e-9 * (Math.abs(m.b) + 1);
  if (similar) {
    const s = mxScaleFactor(m);
    const c = mxApply(m, pr.c);
    if (pr.full) { out.push(arcPrim(c, pr.r * s, 0, TAU, true)); return; }
    const a0 = angleOf(mxApplyVec(m, dir(pr.a0))), a1 = angleOf(mxApplyVec(m, dir(pr.a1)));
    out.push(det < 0 ? arcPrim(c, pr.r * s, a1, a0) : arcPrim(c, pr.r * s, a0, a1));
    return;
  }
  const pts = flattenArc(pr.c, pr.r, pr.a0, pr.a1, maxErr, pr.full).map((p) => mxApply(m, p));
  for (let i = 1; i < pts.length; i++) out.push(seg(pts[i - 1], pts[i]));
}

function polyPts(pts: Vec[], closed: boolean, out: Prim[]): void {
  for (let i = 1; i < pts.length; i++) out.push(seg(pts[i - 1], pts[i]));
  if (closed && pts.length > 2) out.push(seg(pts[pts.length - 1], pts[0]));
}

export function polylineSegPrims(e: Pick<PolylineEnt, 'pts' | 'bulges' | 'closed'>): Prim[] {
  const out: Prim[] = [];
  const n = e.pts.length;
  const segs = e.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) out.push(bulgeSegPrim(e.pts[i], e.pts[(i + 1) % n], e.bulges[i] || 0));
  return out;
}

/** Decomposes an entity into segments/arcs in world space. */
export function entPrims(e: Entity, ctx: DocCtx, maxErr = 0.01, depth = 0): Prim[] {
  const out: Prim[] = [];
  switch (e.type) {
    case 'line': out.push(seg(e.p1, e.p2)); break;
    case 'circle': out.push(arcPrim(e.c, e.r, 0, TAU, true)); break;
    case 'arc': out.push(arcPrim(e.c, e.r, e.a0, e.a1)); break;
    case 'polyline': return polylineSegPrims(e);
    case 'ellipse': polyPts(flattenEllipse(e, maxErr), false, out); break;
    case 'spline': polyPts(flattenSpline(e, maxErr), e.closed, out); break;
    case 'point': out.push(seg(e.p, e.p)); break;
    case 'text': case 'mtext': polyPts(textCorners(e), true, out); break;
    case 'solid': polyPts(e.pts, true, out); break;
    case 'hatch':
      for (const l of e.loops) out.push(...polylineSegPrims({ pts: l.pts, bulges: l.bulges, closed: true }));
      break;
    case 'dimension': {
      const blk = e.block ? ctx.blocks.get(e.block) : undefined;
      if (blk && depth < MAX_BLOCK_DEPTH) {
        for (const be of blk.entities) for (const pr of entPrims(be, ctx, maxErr, depth + 1)) out.push(pr);
        break;
      }
      const g = dimGeometry(e, ctx.dimStyle);
      for (const [p, q] of g.lines) out.push(seg(p, q));
      for (const a of g.arcs) out.push(arcPrim(a.c, a.r, a.a0, a.a1));
      break;
    }
    case 'insert': {
      const blk = ctx.blocks.get(e.name);
      if (blk && depth < MAX_BLOCK_DEPTH) {
        forEachInsertInstance(e, blk, (m) => {
          for (const be of blk.entities) for (const pr of entPrims(be, ctx, maxErr, depth + 1)) primTransform(pr, m, out, maxErr);
        });
      }
      for (const a of e.attribs) out.push(...entPrims(a, ctx, maxErr, depth + 1));
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Picking

/** Closed outline (flattened) of an entity if it encloses an area. */
export function closedOutline(e: Entity, maxErr: number): Vec[] | null {
  switch (e.type) {
    case 'circle': return flattenArc(e.c, e.r, 0, TAU, maxErr, true);
    case 'ellipse': return isFullEllipse(e) ? flattenEllipse(e, maxErr) : null;
    case 'polyline': {
      if (!e.closed && !(e.pts.length > 2 && dist(e.pts[0], e.pts[e.pts.length - 1]) < 1e-9)) return null;
      return flattenPolyline(e, maxErr);
    }
    case 'spline': return e.closed ? flattenSpline(e, maxErr) : null;
    case 'solid': return e.pts.slice();
    default: return null;
  }
}

export function flattenPolyline(e: Pick<PolylineEnt, 'pts' | 'bulges' | 'closed'>, maxErr: number): Vec[] {
  const n = e.pts.length;
  if (n === 0) return [];
  const out: Vec[] = [e.pts[0]];
  const segs = e.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) out.push(...flattenBulge(e.pts[i], e.pts[(i + 1) % n], e.bulges[i] || 0, maxErr));
  if (e.closed) out.pop();
  return out;
}

export function entHit(e: Entity, p: Vec, tol: number, ctx: DocCtx): boolean {
  if (e.type === 'text' || e.type === 'mtext') return pointInPolygon(p, textCorners(e)) || entPrims(e, ctx).some((pr) => distToPrim(p, pr) <= tol);
  if (e.type === 'solid') return pointInPolygon(p, e.pts);
  if (e.type === 'hatch') {
    let inside = false;
    for (const l of e.loops) if (pointInPolygon(p, flattenPolyline({ pts: l.pts, bulges: l.bulges, closed: true }, tol))) inside = !inside;
    if (inside) return true;
  }
  if (e.type === 'insert') {
    for (const a of e.attribs) if (entHit(a, p, tol, ctx)) return true;
  }
  const prims = entPrims(e, ctx, tol * 0.5);
  for (const pr of prims) if (distToPrim(p, pr) <= tol) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Snap points

export type SnapKind = 'end' | 'mid' | 'cen' | 'qua' | 'node' | 'ins' | 'int' | 'per' | 'nea' | 'tan' | 'gcen';
export interface SnapPt { kind: SnapKind; p: Vec }

export function entSnaps(e: Entity, ctx: DocCtx, depth = 0): SnapPt[] {
  const s: SnapPt[] = [];
  const quads = (c: Vec, r: number, a0 = 0, a1 = TAU, full = true) => {
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      if (full || normAng(a - a0) <= sweep(a0, a1) + 1e-9) s.push({ kind: 'qua', p: polar(c, a, r) });
    }
  };
  switch (e.type) {
    case 'line':
      s.push({ kind: 'end', p: e.p1 }, { kind: 'end', p: e.p2 }, { kind: 'mid', p: mid(e.p1, e.p2) });
      break;
    case 'circle':
      s.push({ kind: 'cen', p: e.c });
      quads(e.c, e.r);
      break;
    case 'arc': {
      s.push({ kind: 'end', p: polar(e.c, e.a0, e.r) }, { kind: 'end', p: polar(e.c, e.a1, e.r) });
      s.push({ kind: 'mid', p: polar(e.c, e.a0 + sweep(e.a0, e.a1) / 2, e.r) }, { kind: 'cen', p: e.c });
      quads(e.c, e.r, e.a0, e.a1, false);
      break;
    }
    case 'polyline': {
      const n = e.pts.length;
      for (const p of e.pts) s.push({ kind: 'end', p });
      const prims = polylineSegPrims(e);
      for (const pr of prims) {
        if (pr.k === 'seg') s.push({ kind: 'mid', p: mid(pr.a, pr.b) });
        else { s.push({ kind: 'mid', p: polar(pr.c, pr.a0 + sweep(pr.a0, pr.a1) / 2, pr.r) }, { kind: 'cen', p: pr.c }); }
      }
      if (e.closed && n > 2) {
        let cx = 0, cy = 0;
        for (const p of e.pts) { cx += p.x; cy += p.y; }
        s.push({ kind: 'gcen', p: { x: cx / n, y: cy / n } });
      }
      break;
    }
    case 'ellipse': {
      s.push({ kind: 'cen', p: e.c });
      for (let k = 0; k < 4; k++) {
        const t = (k * Math.PI) / 2;
        if (isFullEllipse(e) || normAng(t - e.a0) <= sweep(e.a0, e.a1)) s.push({ kind: 'qua', p: ellipsePoint(e, t) });
      }
      if (!isFullEllipse(e)) s.push({ kind: 'end', p: ellipsePoint(e, e.a0) }, { kind: 'end', p: ellipsePoint(e, e.a1) });
      break;
    }
    case 'spline': {
      const pts = flattenSpline(e, 0.01);
      if (pts.length) s.push({ kind: 'end', p: pts[0] }, { kind: 'end', p: pts[pts.length - 1] });
      break;
    }
    case 'point': s.push({ kind: 'node', p: e.p }); break;
    case 'text': case 'mtext': s.push({ kind: 'ins', p: e.p }); break;
    case 'solid': for (const p of e.pts) s.push({ kind: 'end', p }); break;
    case 'dimension': s.push({ kind: 'node', p: e.p1 }, { kind: 'node', p: e.p2 }, { kind: 'node', p: e.loc }); break;
    case 'hatch': break;
    case 'insert': {
      s.push({ kind: 'ins', p: e.p });
      const blk = ctx.blocks.get(e.name);
      if (blk && depth < 3 && blk.entities.length < 2000) {
        forEachInsertInstance(e, blk, (m) => {
          for (const be of blk.entities) for (const sp of entSnaps(be, ctx, depth + 1)) s.push({ kind: sp.kind, p: mxApply(m, sp.p) });
        });
      }
      for (const a of e.attribs) s.push({ kind: 'ins', p: a.p });
      break;
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// Grips

export function entGrips(e: Entity): Vec[] {
  switch (e.type) {
    case 'line': return [e.p1, mid(e.p1, e.p2), e.p2];
    case 'circle': return [e.c, polar(e.c, 0, e.r), polar(e.c, Math.PI / 2, e.r), polar(e.c, Math.PI, e.r), polar(e.c, -Math.PI / 2, e.r)];
    case 'arc': return [polar(e.c, e.a0, e.r), polar(e.c, e.a0 + sweep(e.a0, e.a1) / 2, e.r), polar(e.c, e.a1, e.r), e.c];
    case 'polyline': return e.pts.slice();
    case 'ellipse': return [e.c, add(e.c, e.major), sub(e.c, e.major), add(e.c, mul(perp(e.major), e.ratio)), sub(e.c, mul(perp(e.major), e.ratio))];
    case 'spline': return e.fit && e.fit.length ? e.fit.slice() : e.ctrl.slice();
    case 'point': return [e.p];
    case 'text': case 'mtext': return [e.p];
    case 'solid': return e.pts.slice();
    case 'dimension': return e.dimType === 'angular' ? [e.p2, e.p3 ?? e.p2, e.loc] : [e.p1, e.p2, e.loc];
    case 'insert': return [e.p];
    case 'hatch': {
      const b = emptyBox();
      for (const l of e.loops) for (const p of l.pts) boxAdd(b, p);
      return boxValid(b) ? [{ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }] : [];
    }
  }
}

/** Circle through 3 points. */
export function circle3(a: Vec, b: Vec, c: Vec): { c: Vec; r: number } | null {
  const m1 = mid(a, b), m2 = mid(b, c);
  const cc = lineLine(m1, add(m1, perp(sub(b, a))), m2, add(m2, perp(sub(c, b))));
  return cc ? { c: cc, r: dist(cc, a) } : null;
}

/** Arc through start, a point on it, and end. */
export function arc3(p1: Vec, p2: Vec, p3: Vec): { c: Vec; r: number; a0: number; a1: number } | null {
  const ci = circle3(p1, p2, p3);
  if (!ci) return null;
  const ccw = cross(sub(p2, p1), sub(p3, p2)) > 0;
  const s = angleBetween(ci.c, p1), e = angleBetween(ci.c, p3);
  return ccw ? { ...ci, a0: s, a1: e } : { ...ci, a0: e, a1: s };
}

export function entMoveGrip(e: Entity, i: number, p: Vec): Entity {
  const d = (from: Vec) => sub(p, from);
  switch (e.type) {
    case 'line':
      if (i === 0) return { ...e, p1: p };
      if (i === 2) return { ...e, p2: p };
      { const dv = d(mid(e.p1, e.p2)); return { ...e, p1: add(e.p1, dv), p2: add(e.p2, dv) }; }
    case 'circle': return i === 0 ? { ...e, c: p } : { ...e, r: Math.max(dist(e.c, p), 1e-9) };
    case 'arc': {
      if (i === 3) return { ...e, c: p };
      const g = entGrips(e);
      g[i] = p;
      const a = arc3(g[0], g[1], g[2]);
      return a ? { ...e, ...a } : e;
    }
    case 'polyline': { const pts = e.pts.slice(); pts[i] = p; return { ...e, pts }; }
    case 'ellipse': {
      if (i === 0) return { ...e, c: p };
      if (i === 1 || i === 2) {
        const major = i === 1 ? sub(p, e.c) : sub(e.c, p);
        const oldMinor = Math.hypot(e.major.x, e.major.y) * e.ratio;
        const ml = Math.hypot(major.x, major.y);
        if (ml < 1e-9) return e;
        return oldMinor > ml ? { ...e, major: mul(perp(major), oldMinor / ml), ratio: ml / oldMinor } : { ...e, major, ratio: oldMinor / ml };
      }
      const ml = Math.hypot(e.major.x, e.major.y);
      const nr = Math.abs(dot(sub(p, e.c), norm(perp(e.major)))) / ml;
      if (nr <= 1) return { ...e, ratio: Math.max(nr, 1e-6) };
      const minorLen = nr * ml;
      return { ...e, major: mul(norm(perp(e.major)), minorLen), ratio: ml / minorLen };
    }
    case 'spline': {
      if (e.fit && e.fit.length) { const fit = e.fit.slice(); fit[i] = p; return { ...e, fit, ctrl: fit, knots: clampedKnots(fit.length, Math.min(e.degree, fit.length - 1)), degree: Math.min(e.degree, fit.length - 1) }; }
      const ctrl = e.ctrl.slice(); ctrl[i] = p; return { ...e, ctrl };
    }
    case 'point': return { ...e, p };
    case 'text': case 'mtext': return { ...e, p };
    case 'solid': { const pts = e.pts.slice(); pts[i] = p; return { ...e, pts }; }
    case 'dimension':
      if (e.dimType === 'angular') {
        if (i === 0) return { ...e, p2: p, block: undefined };
        if (i === 1) return { ...e, p3: p, block: undefined };
        return { ...e, loc: p, block: undefined };
      }
      if (i === 0) return { ...e, p1: p, block: undefined };
      if (i === 1) return { ...e, p2: p, block: undefined };
      return { ...e, loc: p, block: undefined };
    case 'insert': {
      const dv = d(e.p);
      return { ...e, p, attribs: e.attribs.map((a) => ({ ...a, p: add(a.p, dv) })) };
    }
    case 'hatch': {
      const dv = d(entGrips(e)[0]);
      return {
        ...e,
        loops: e.loops.map((l) => ({ ...l, pts: l.pts.map((q) => add(q, dv)) })),
        patLines: e.patLines?.map((pl) => ({ ...pl, base: add(pl.base, dv) })),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Transform (similarity transforms: move/rotate/uniform scale/mirror)

function mapAng(m: Mat, a: number): number {
  return angleOf(mxApplyVec(m, dir(a)));
}

export function entTransform(e: Entity, m: Mat, mirrText = false): Entity {
  const P = (p: Vec) => mxApply(m, p);
  const det = mxDet(m);
  const s = mxScaleFactor(m);
  const flip = det < 0;
  switch (e.type) {
    case 'line': return { ...e, p1: P(e.p1), p2: P(e.p2) };
    case 'circle': return { ...e, c: P(e.c), r: e.r * s };
    case 'arc': {
      const a0 = mapAng(m, e.a0), a1 = mapAng(m, e.a1);
      return flip ? { ...e, c: P(e.c), r: e.r * s, a0: a1, a1: a0 } : { ...e, c: P(e.c), r: e.r * s, a0, a1 };
    }
    case 'polyline': return { ...e, pts: e.pts.map(P), bulges: flip ? e.bulges.map((b) => -b) : e.bulges.slice(), width: e.width !== undefined ? e.width * s : undefined };
    case 'ellipse': {
      const major = mxApplyVec(m, e.major);
      if (!flip || isFullEllipse(e)) return { ...e, c: P(e.c), major, a0: e.a0, a1: e.a1 };
      return { ...e, c: P(e.c), major, a0: normAng(-e.a1), a1: normAng(-e.a0) };
    }
    case 'spline': return { ...e, ctrl: e.ctrl.map(P), fit: e.fit?.map(P) };
    case 'point': return { ...e, p: P(e.p) };
    case 'text': case 'mtext': {
      let rot = mapAng(m, e.rot);
      if (flip && !mirrText) rot = readableAngle(rot);
      return { ...e, p: P(e.p), h: e.h * s, rot, ...(e.type === 'mtext' ? { width: e.width * s } : {}) } as Entity;
    }
    case 'solid': return { ...e, pts: e.pts.map(P) };
    case 'hatch': {
      const rotA = mapAng(m, 0);
      return {
        ...e,
        loops: e.loops.map((l) => ({ pts: l.pts.map(P), bulges: flip ? l.bulges.map((b) => -b) : l.bulges.slice() })),
        scale: e.scale * s,
        angle: normAng(e.angle + rotA),
        patLines: e.patLines?.map((pl) => ({
          ang: mapAng(m, pl.ang),
          base: P(pl.base),
          off: mxApplyVec(m, pl.off),
          dashes: pl.dashes.map((d) => d * s),
        })),
      };
    }
    case 'dimension': {
      const out: DimEnt = { ...e, p1: P(e.p1), p2: P(e.p2), p3: e.p3 ? P(e.p3) : undefined, loc: P(e.loc), rot: mapAng(m, e.rot), block: undefined };
      return out;
    }
    case 'insert': {
      const lin: Mat = { ...m, e: 0, f: 0 };
      const q = mxMul(lin, mxInsert({ x: 0, y: 0 }, 1, 1, e.rot));
      const rot = angleOf(mxApplyVec(q, { x: 1, y: 0 }));
      return {
        ...e,
        p: P(e.p),
        rot,
        sx: e.sx * s,
        sy: flip ? -e.sy * s : e.sy * s,
        attribs: e.attribs.map((a) => entTransform(a, m, mirrText) as TextEnt),
        colSpacing: e.colSpacing !== undefined ? e.colSpacing * s : undefined,
        rowSpacing: e.rowSpacing !== undefined ? e.rowSpacing * s : undefined,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Explode

type Props = Pick<Base, 'layer' | 'color' | 'trueColor' | 'ltype'>;
const props = (e: Base): Props => ({ layer: e.layer, color: e.color, trueColor: e.trueColor, ltype: e.ltype });

export function primToEntity(pr: Prim, p: Props): NewEntity {
  if (pr.k === 'seg') return { type: 'line', p1: pr.a, p2: pr.b, ...p };
  if (pr.full) return { type: 'circle', c: pr.c, r: pr.r, ...p };
  return { type: 'arc', c: pr.c, r: pr.r, a0: pr.a0, a1: pr.a1, ...p };
}

/** Returns replacement entities, or null if the entity cannot be exploded. */
export function entExplode(e: Entity, ctx: DocCtx): NewEntity[] | null {
  const p = props(e);
  switch (e.type) {
    case 'polyline': return polylineSegPrims(e).map((pr) => primToEntity(pr, p));
    case 'insert': {
      const blk = ctx.blocks.get(e.name);
      if (!blk) return null;
      const out: NewEntity[] = [];
      forEachInsertInstance(e, blk, (m) => {
        const uniform = Math.abs(Math.abs(e.sx) - Math.abs(e.sy)) < 1e-9;
        for (const be of blk.entities) {
          const child = inheritFromInsert(be, e);
          if (uniform) out.push(stripId(entTransform(child, m)));
          else for (const pr of entPrims(child, ctx, 0.01)) {
            const tp: Prim[] = [];
            primTransform(pr, m, tp, 0.01);
            for (const t of tp) out.push(primToEntity(t, props(child)));
          }
        }
      });
      for (const a of e.attribs) out.push(stripId({ ...a, tag: undefined }));
      return out;
    }
    case 'dimension': {
      const out: NewEntity[] = [];
      const blk = e.block ? ctx.blocks.get(e.block) : undefined;
      if (blk) {
        for (const be of blk.entities) out.push(stripId(inheritFromInsert(be, e)));
        return out;
      }
      const g = dimGeometry(e, ctx.dimStyle);
      for (const [a, b] of g.lines) out.push({ type: 'line', p1: a, p2: b, ...p });
      for (const a of g.arcs) out.push({ type: 'arc', c: a.c, r: a.r, a0: a.a0, a1: a.a1, ...p });
      const asz = ctx.dimStyle.dimasz * ctx.dimStyle.dimscale;
      for (const ar of g.arrows) out.push({ type: 'solid', pts: arrowPts(ar.tip, ar.dir, asz), ...p });
      if (g.text.s) out.push({ type: 'mtext', p: g.text.p, h: g.text.h, text: g.text.s, rot: g.text.rot, width: 0, attach: 5, ...p });
      return out;
    }
    case 'mtext': {
      const lb = mtextLocalBox(e);
      const lh = e.h * MTEXT_LINE_SPACING;
      return lb.lines.map((s, i) => {
        const local = { x: lb.x0, y: lb.y1 - e.h - i * lh };
        return { type: 'text', p: add(e.p, rotate(local, { x: 0, y: 0 }, e.rot)), h: e.h, text: s, rot: e.rot, halign: 0, valign: 0, wf: 1, ...p } as NewEntity;
      });
    }
    case 'hatch': return e.loops.map((l) => ({ type: 'polyline', pts: l.pts, bulges: l.bulges, closed: true, ...p }) as NewEntity);
    default: return null;
  }
}

export function arrowPts(tip: Vec, d: Vec, size: number): Vec[] {
  const u = norm(d);
  const back = sub(tip, mul(u, size));
  const n = mul(perp(u), size / 6);
  return [tip, add(back, n), sub(back, n)];
}

function stripId(e: Entity): NewEntity {
  const { id: _id, ...rest } = e;
  return rest as NewEntity;
}

// ---------------------------------------------------------------------------
// Description (LIST command / properties)

export function entDescribe(e: Entity, ctx: DocCtx): string[] {
  const P = (p: Vec) => `X=${fmtNum(p.x)}  Y=${fmtNum(p.y)}`;
  const L: string[] = [`${ENT_NAMES[e.type].toUpperCase()}   Layer: "${e.layer}"`];
  switch (e.type) {
    case 'line': {
      L.push(`from point, ${P(e.p1)}`, `to point, ${P(e.p2)}`);
      L.push(`Length = ${fmtNum(dist(e.p1, e.p2))},  Angle = ${fmtNum(deg(normAng(angleBetween(e.p1, e.p2))))}`);
      break;
    }
    case 'circle': L.push(`center point, ${P(e.c)}`, `radius ${fmtNum(e.r)}`, `circumference ${fmtNum(TAU * e.r)}`, `area ${fmtNum(Math.PI * e.r * e.r)}`); break;
    case 'arc': L.push(`center point, ${P(e.c)}`, `radius ${fmtNum(e.r)}`, `start angle ${fmtNum(deg(normAng(e.a0)))}`, `end angle ${fmtNum(deg(normAng(e.a1)))}`, `length ${fmtNum(e.r * sweep(e.a0, e.a1))}`); break;
    case 'polyline': {
      L.push(e.closed ? 'Closed' : 'Open');
      let length = 0;
      for (const pr of polylineSegPrims(e)) length += pr.k === 'seg' ? dist(pr.a, pr.b) : pr.r * sweep(pr.a0, pr.a1);
      L.push(`length ${fmtNum(length)}`);
      if (e.closed) L.push(`area ${fmtNum(Math.abs(polyArea(e)))}`);
      e.pts.slice(0, 50).forEach((p) => L.push(`at point ${P(p)}`));
      break;
    }
    case 'text': case 'mtext': L.push(`text "${e.type === 'text' ? e.text : mtextLines(e.text).join(' / ')}"`, `insertion point ${P(e.p)}`, `height ${fmtNum(e.h)}`, `rotation ${fmtNum(deg(e.rot))}`); break;
    case 'insert': L.push(`block name "${e.name}"`, `at point ${P(e.p)}`, `X scale ${fmtNum(e.sx)}  Y scale ${fmtNum(e.sy)}`, `rotation ${fmtNum(deg(e.rot))}`); break;
    case 'dimension': L.push(`type ${e.dimType}`, `measurement ${dimText(e, ctx.dimStyle)}`); break;
    case 'hatch': L.push(`pattern ${e.pattern}`, `scale ${fmtNum(e.scale)}`, `angle ${fmtNum(deg(e.angle))}`, `loops ${e.loops.length}`); break;
    case 'ellipse': L.push(`center ${P(e.c)}`, `major radius ${fmtNum(Math.hypot(e.major.x, e.major.y))}`, `radius ratio ${fmtNum(e.ratio)}`); break;
    case 'point': L.push(`at point ${P(e.p)}`); break;
    case 'spline': L.push(`degree ${e.degree}`, `control points ${e.ctrl.length}`); break;
    case 'solid': e.pts.forEach((p) => L.push(`point ${P(p)}`)); break;
  }
  return L;
}

export function polyArea(e: Pick<PolylineEnt, 'pts' | 'bulges' | 'closed'>): number {
  let a = 0;
  const n = e.pts.length;
  for (let i = 0; i < n; i++) {
    const p = e.pts[i], q = e.pts[(i + 1) % n];
    a += (p.x * q.y - q.x * p.y) / 2;
    const b = e.bulges[i] || 0;
    if (Math.abs(b) > 1e-12) {
      const theta = 4 * Math.atan(b);
      const r = dist(p, q) / (2 * Math.sin(Math.abs(theta) / 2));
      a += Math.sign(b) * (r * r / 2) * (Math.abs(theta) - Math.sin(Math.abs(theta)));
    }
  }
  return a;
}

export const IDENTITY = IDENT;

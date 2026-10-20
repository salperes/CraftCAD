// ASCII DXF reader. Produces plain entity/table data that Drawing.loadFrom() consumes.

import type { Vec } from '../core/geom.ts';
import { rad, normAng, polar, dist, sweep, lineLine, TAU } from '../core/geom.ts';
import {
  type NewEntity, type BlockDef, type TextEnt, type HatchLoop, type PatLine, type DimType, type SplineEnt, type DimStyle, type Entity,
  BYLAYER, flattenSpline, defaultDimStyle, ellipsePoint,
} from '../core/entities.ts';
import type { Layer, Linetype, Header } from '../core/document.ts';

export interface DxfData {
  version: string;
  entities: NewEntity[];
  layers: Layer[];
  linetypes: Linetype[];
  blocks: { name: string; base: Vec; entities: NewEntity[] }[];
  header: Partial<Header>;
  dimStyle: DimStyle;
  currentLayer?: string;
  warnings: string[];
}

type Tag = [number, string];

const CODEPAGES: Record<string, string> = {
  ANSI_1250: 'windows-1250', ANSI_1251: 'windows-1251', ANSI_1252: 'windows-1252', ANSI_1253: 'windows-1253',
  ANSI_1254: 'windows-1254', ANSI_1255: 'windows-1255', ANSI_1256: 'windows-1256', ANSI_1257: 'windows-1257',
  ANSI_1258: 'windows-1258', ANSI_874: 'windows-874', ANSI_932: 'shift_jis', ANSI_936: 'gbk', ANSI_949: 'euc-kr', ANSI_950: 'big5',
};

/** Decodes DXF bytes using $ACADVER / $DWGCODEPAGE to pick the right text encoding. */
export function decodeDxfBytes(bytes: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 64 * 1024)));
  const ver = /\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(AC\d{4})/.exec(head)?.[1] ?? 'AC1009';
  if (ver >= 'AC1021') return new TextDecoder('utf-8').decode(bytes);
  const cp = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*(\S+)/.exec(head)?.[1]?.toUpperCase() ?? 'ANSI_1252';
  try {
    return new TextDecoder(CODEPAGES[cp] ?? 'windows-1252').decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function tokenize(text: string): Tag[] {
  const lines = text.split(/\r\n|\n|\r/);
  const tags: Tag[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) { i -= 1; continue; }
    tags.push([code, lines[i + 1]]);
  }
  return tags;
}

/** A DXF object: its type and following tags up to the next code 0. */
interface Rec { type: string; tags: Tag[] }

const num = (s: string | undefined, d = 0): number => {
  if (s === undefined) return d;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : d;
};

class RecView {
  r: Rec;
  constructor(r: Rec) {
    this.r = r;
  }
  str(code: number, d = ''): string {
    for (const [c, v] of this.r.tags) {
      if (c !== code) continue;
      if (v.trim() === '' && code !== 1) return d;
      return decodeU(code === 1 || code === 3 ? v : v.trim());
    }
    return d;
  }
  num(code: number, d = 0): number {
    for (const [c, v] of this.r.tags) if (c === code) return num(v, d);
    return d;
  }
  has(code: number): boolean {
    return this.r.tags.some(([c]) => c === code);
  }
  pt(xc: number, d: Vec = { x: 0, y: 0 }): Vec {
    let x: number | undefined, y: number | undefined;
    for (const [c, v] of this.r.tags) {
      if (c === xc && x === undefined) x = num(v);
      else if (c === xc + 10 && y === undefined) y = num(v);
    }
    return x === undefined ? d : { x, y: y ?? 0 };
  }
  all(code: number): string[] {
    return this.r.tags.filter(([c]) => c === code).map(([, v]) => (code === 3 ? decodeU(v) : v));
  }
}

const decodeU = (s: string): string =>
  s.includes('\\U+') ? s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) : s;

function common(rv: RecView) {
  const layer = rv.str(8, '0') || '0';
  const color = rv.has(62) ? Math.abs(rv.num(62)) : BYLAYER;
  const out: { layer: string; color: number; ltype: string; trueColor?: number; ltscale?: number } = {
    layer,
    color: color > 256 ? BYLAYER : color,
    ltype: rv.str(6, 'ByLayer') || 'ByLayer',
  };
  if (rv.has(420)) out.trueColor = rv.num(420) & 0xffffff;
  if (rv.has(48)) out.ltscale = rv.num(48, 1);
  return out;
}

const flipX = (p: Vec): Vec => ({ x: -p.x, y: p.y });

export function readDxf(input: Uint8Array | string): DxfData {
  const text = typeof input === 'string' ? input : decodeDxfBytes(input);
  if (text.startsWith('AutoCAD Binary DXF')) throw new Error('Binary DXF is not supported. Save the drawing as ASCII DXF.');
  const tags = tokenize(text);
  const data: DxfData = {
    version: 'AC1009', entities: [], layers: [], linetypes: [], blocks: [], header: {}, dimStyle: defaultDimStyle(), warnings: [],
  };
  const skipped = new Map<string, number>();

  let i = 0;
  const nextRec = (): Rec | null => {
    if (i >= tags.length) return null;
    const [c, v] = tags[i];
    if (c !== 0) { i++; return { type: '', tags: [] }; }
    i++;
    const rec: Rec = { type: v.trim(), tags: [] };
    while (i < tags.length && tags[i][0] !== 0) rec.tags.push(tags[i++]);
    return rec;
  };

  // Header variables carry no code-0 tags, so they arrive inside the SECTION record.
  const readHeader = (htags: Tag[]) => {
    let name = '';
    const vals: Record<string, Tag[]> = {};
    for (const [c, v] of htags) {
      if (c === 9) { name = v.trim(); vals[name] = []; } else if (name) vals[name].push([c, v]);
    }
    const g = (n: string, code: number): string | undefined => vals[n]?.find(([c]) => c === code)?.[1]?.trim();
    data.version = g('$ACADVER', 1) ?? 'AC1009';
    const h = data.header;
    if (g('$LTSCALE', 40)) h.ltscale = num(g('$LTSCALE', 40), 1);
    if (g('$TEXTSIZE', 40)) h.textsize = num(g('$TEXTSIZE', 40), 2.5);
    if (g('$INSUNITS', 70)) h.insunits = num(g('$INSUNITS', 70), 4);
    if (g('$PDMODE', 70)) h.pdmode = num(g('$PDMODE', 70));
    if (g('$PDSIZE', 40)) h.pdsize = num(g('$PDSIZE', 40));
    if (g('$FILLETRAD', 40)) h.filletRad = num(g('$FILLETRAD', 40));
    if (g('$MIRRTEXT', 70)) h.mirrtext = num(g('$MIRRTEXT', 70)) === 1;
    if (g('$EXTMIN', 10)) h.extmin = { x: num(g('$EXTMIN', 10)), y: num(g('$EXTMIN', 20)) };
    if (g('$EXTMAX', 10)) h.extmax = { x: num(g('$EXTMAX', 10)), y: num(g('$EXTMAX', 20)) };
    const ds = data.dimStyle;
    if (g('$DIMSCALE', 40)) ds.dimscale = num(g('$DIMSCALE', 40), 1) || 1;
    if (g('$DIMTXT', 40)) ds.dimtxt = num(g('$DIMTXT', 40), ds.dimtxt);
    if (g('$DIMASZ', 40)) ds.dimasz = num(g('$DIMASZ', 40), ds.dimasz);
    if (g('$DIMEXO', 40)) ds.dimexo = num(g('$DIMEXO', 40), ds.dimexo);
    if (g('$DIMEXE', 40)) ds.dimexe = num(g('$DIMEXE', 40), ds.dimexe);
    if (g('$DIMGAP', 40)) ds.dimgap = Math.abs(num(g('$DIMGAP', 40), ds.dimgap));
    if (g('$DIMDEC', 70)) ds.dimdec = num(g('$DIMDEC', 70), ds.dimdec);
    if (g('$DIMADEC', 70)) ds.dimadec = Math.max(0, num(g('$DIMADEC', 70), ds.dimadec));
    if (g('$DIMDSEP', 70)) ds.dimdsep = String.fromCharCode(num(g('$DIMDSEP', 70), 44));
    if (g('$CLAYER', 8)) data.currentLayer = g('$CLAYER', 8);
  };

  const readTables = () => {
    while (true) {
      const rec = nextRec();
      if (!rec || rec.type === 'ENDSEC') return;
      const rv = new RecView(rec);
      if (rec.type === 'LAYER') {
        const name = rv.str(2);
        if (!name) continue;
        const c = rv.num(62, 7);
        const flags = rv.num(70);
        const l: Layer = {
          name, color: Math.abs(c) || 7, ltype: rv.str(6, 'Continuous') || 'Continuous',
          on: c >= 0, frozen: (flags & 1) !== 0, locked: (flags & 4) !== 0, plot: rv.num(290, 1) !== 0,
        };
        if (rv.has(420)) l.trueColor = rv.num(420) & 0xffffff;
        if (rv.has(370)) l.lw = rv.num(370);
        data.layers.push(l);
      } else if (rec.type === 'LTYPE') {
        const name = rv.str(2);
        if (!name || /^by(layer|block)$/i.test(name)) continue;
        data.linetypes.push({ name, desc: rv.str(3), pattern: rv.all(49).map((s) => num(s)) });
      }
    }
  };

  const readEntitiesUntil = (endTypes: string[], sink: NewEntity[]): Rec | null => {
    let rec = nextRec();
    while (rec && !endTypes.includes(rec.type)) {
      if (rec.type === '') { rec = nextRec(); continue; }
      const rv = new RecView(rec);
      if (rec.type === 'POLYLINE') {
        const verts: RecView[] = [];
        let r2 = nextRec();
        while (r2 && r2.type === 'VERTEX') { verts.push(new RecView(r2)); r2 = nextRec(); }
        if (r2 && r2.type !== 'SEQEND') { rec = r2; pushAll(sink, convPolyline(rv, verts)); continue; }
        pushAll(sink, convPolyline(rv, verts));
        rec = nextRec();
        continue;
      }
      if (rec.type === 'INSERT') {
        const ins = convInsert(rv);
        if (rv.num(66) === 1) {
          let r2 = nextRec();
          while (r2 && (r2.type === 'ATTRIB' || r2.type === '')) {
            if (r2.type === 'ATTRIB') {
              const a = convText(new RecView(r2), true);
              if (a && ins) ins.attribs.push(a as unknown as TextEnt);
            }
            r2 = nextRec();
          }
          if (ins && !(rv.num(67) === 1)) sink.push(ins);
          if (r2 && r2.type !== 'SEQEND') { rec = r2; continue; }
          rec = nextRec();
          continue;
        }
        if (ins && rv.num(67) !== 1) sink.push(ins);
        rec = nextRec();
        continue;
      }
      if (rv.num(67) !== 1 && rv.num(60) !== 1) {
        const out = convEntity(rv);
        if (out === undefined) skipped.set(rec.type, (skipped.get(rec.type) ?? 0) + 1);
        else pushAll(sink, out);
      }
      rec = nextRec();
    }
    return rec;
  };

  const readBlocks = () => {
    while (true) {
      const rec = nextRec();
      if (!rec || rec.type === 'ENDSEC') return;
      if (rec.type !== 'BLOCK') continue;
      const rv = new RecView(rec);
      const name = rv.str(2) || rv.str(3);
      const base = rv.pt(10);
      const ents: NewEntity[] = [];
      const end = readEntitiesUntil(['ENDBLK', 'ENDSEC'], ents);
      if (!/^\*(model|paper)_space/i.test(name)) data.blocks.push({ name, base, entities: ents });
      if (end?.type === 'ENDSEC') return;
    }
  };

  while (i < tags.length) {
    const rec = nextRec();
    if (!rec) break;
    if (rec.type === 'EOF') break;
    if (rec.type !== 'SECTION') continue;
    const sec = new RecView(rec).str(2);
    if (sec === 'HEADER') readHeader(rec.tags);
    else if (sec === 'TABLES') readTables();
    else if (sec === 'BLOCKS') readBlocks();
    else if (sec === 'ENTITIES') readEntitiesUntil(['ENDSEC'], data.entities);
    else {
      let r = nextRec();
      while (r && r.type !== 'ENDSEC') r = nextRec();
    }
  }
  for (const [t, n] of skipped) data.warnings.push(`${n} × ${t} not supported (skipped)`);
  // LibreDWG sometimes writes every layer with a negative (off) color; a drawing with
  // all layers off is almost certainly that, so show them.
  if (data.layers.length > 0 && data.layers.every((l) => !l.on)) {
    for (const l of data.layers) l.on = true;
    data.warnings.push('All layers were marked off in the file; they have been turned on.');
  }
  if (data.entities.length === 0 && data.blocks.some((b) => /^\*paper_space/i.test(b.name) || b.entities.length)) {
    data.warnings.push('Model space is empty; paper space layouts are not supported yet.');
  }
  return data;
}

function pushAll(sink: NewEntity[], e: NewEntity | NewEntity[] | null | undefined) {
  if (!e) return;
  if (Array.isArray(e)) sink.push(...e);
  else sink.push(e);
}

const isFlipped = (rv: RecView) => rv.num(230, 1) < 0;

/** Returns undefined for unsupported entity types, null for supported-but-empty. */
function convEntity(rv: RecView): NewEntity | NewEntity[] | null | undefined {
  const t = rv.r.type;
  const cm = common(rv);
  const flip = isFlipped(rv);
  switch (t) {
    case 'LINE': return { type: 'line', p1: rv.pt(10), p2: rv.pt(11), ...cm };
    case 'CIRCLE': {
      const c = rv.pt(10);
      return { type: 'circle', c: flip ? flipX(c) : c, r: rv.num(40), ...cm };
    }
    case 'ARC': {
      const c = rv.pt(10);
      const a0 = rad(rv.num(50)), a1 = rad(rv.num(51));
      if (flip) return { type: 'arc', c: flipX(c), r: rv.num(40), a0: normAng(Math.PI - a1), a1: normAng(Math.PI - a0), ...cm };
      return { type: 'arc', c, r: rv.num(40), a0, a1, ...cm };
    }
    case 'LWPOLYLINE': {
      const pts: Vec[] = [], bulges: number[] = [];
      let cur: Vec | null = null;
      for (const [c, v] of rv.r.tags) {
        if (c === 10) { cur = { x: num(v), y: 0 }; pts.push(cur); bulges.push(0); }
        else if (c === 20 && cur) cur.y = num(v);
        else if (c === 42 && pts.length) bulges[pts.length - 1] = num(v);
      }
      if (pts.length < 1) return null;
      const closed = (rv.num(70) & 1) !== 0;
      return {
        type: 'polyline',
        pts: flip ? pts.map(flipX) : pts,
        bulges: flip ? bulges.map((b) => -b) : bulges,
        closed,
        width: rv.has(43) ? rv.num(43) : undefined,
        ...cm,
      };
    }
    case 'ELLIPSE': {
      const c = rv.pt(10), major = rv.pt(11);
      let a0 = rv.num(41, 0), a1 = rv.num(42, TAU);
      if (flip) [a0, a1] = [normAng(-a1), normAng(-a0)];
      return { type: 'ellipse', c, major, ratio: rv.num(40, 1), a0, a1, ...cm };
    }
    case 'SPLINE': {
      const ctrl: Vec[] = [], fit: Vec[] = [];
      let cc: Vec | null = null, fc: Vec | null = null;
      for (const [c, v] of rv.r.tags) {
        if (c === 10) { cc = { x: num(v), y: 0 }; ctrl.push(cc); }
        else if (c === 20 && cc) cc.y = num(v);
        else if (c === 11) { fc = { x: num(v), y: 0 }; fit.push(fc); }
        else if (c === 21 && fc) fc.y = num(v);
      }
      const knots = rv.all(40).map((s) => num(s));
      const weights = rv.all(41).map((s) => num(s, 1));
      const degree = rv.num(71, 3);
      if (ctrl.length === 0 && fit.length === 0) return null;
      const sp: Omit<SplineEnt, 'id'> = {
        type: 'spline', ctrl: ctrl.length ? ctrl : fit, degree: ctrl.length ? degree : 1,
        knots: ctrl.length ? knots : [], weights: weights.length === ctrl.length ? weights : undefined,
        closed: (rv.num(70) & 1) !== 0, fit: fit.length ? fit : undefined, ...cm,
      };
      return sp as NewEntity;
    }
    case 'POINT': return { type: 'point', p: rv.pt(10), ...cm };
    case 'TEXT': return convText(rv, false);
    case 'ATTDEF': {
      const tx = convText(rv, true);
      if (!tx) return null;
      return { ...tx, text: rv.str(2) || tx.text };
    }
    case 'MTEXT': {
      const parts = rv.all(3);
      const textVal = parts.join('') + rv.str(1);
      let p = rv.pt(10);
      let rot = rad(rv.num(50));
      if (rv.has(11)) {
        const d = rv.pt(11);
        rot = Math.atan2(d.y, d.x);
      }
      if (flip && !rv.has(11)) { p = flipX(p); rot = Math.PI - rot; }
      return { type: 'mtext', p, h: rv.num(40, 2.5), text: textVal, rot, width: rv.num(41), attach: rv.num(71, 1) || 1, ls: rv.has(44) ? rv.num(44, 1) || 1 : undefined, style: rv.str(7) || undefined, ...cm };
    }
    case 'SOLID': case 'TRACE': {
      let pts = [rv.pt(10), rv.pt(11), rv.pt(13), rv.pt(12)];
      if (dist(pts[2], pts[3]) < 1e-12) pts = pts.slice(0, 3);
      if (flip) pts = pts.map(flipX);
      return { type: 'solid', pts, ...cm };
    }
    case '3DFACE': {
      let pts = [rv.pt(10), rv.pt(11), rv.pt(12), rv.pt(13)];
      if (dist(pts[2], pts[3]) < 1e-12) pts = pts.slice(0, 3);
      return { type: 'polyline', pts, bulges: pts.map(() => 0), closed: true, ...cm };
    }
    case 'LEADER': {
      const pts: Vec[] = [];
      let cur: Vec | null = null;
      for (const [c, v] of rv.r.tags) {
        if (c === 10) { cur = { x: num(v), y: 0 }; pts.push(cur); }
        else if (c === 20 && cur) cur.y = num(v);
      }
      if (pts.length < 2) return null;
      const out: NewEntity[] = [{ type: 'polyline', pts, bulges: pts.map(() => 0), closed: false, ...cm }];
      if (rv.num(71, 1) !== 0) {
        const tip = pts[0], d = { x: pts[0].x - pts[1].x, y: pts[0].y - pts[1].y };
        const l = Math.hypot(d.x, d.y) || 1;
        const u = { x: d.x / l, y: d.y / l }, n = { x: -u.y, y: u.x };
        const s = 2.5;
        const back = { x: tip.x - u.x * s, y: tip.y - u.y * s };
        out.push({ type: 'solid', pts: [tip, { x: back.x + n.x * s / 6, y: back.y + n.y * s / 6 }, { x: back.x - n.x * s / 6, y: back.y - n.y * s / 6 }], ...cm });
      }
      return out;
    }
    case 'HATCH': return convHatch(rv, cm, flip);
    case 'DIMENSION': return convDimension(rv, cm);
    case 'ACAD_TABLE': {
      const name = rv.str(2);
      if (!name) return null;
      return { type: 'insert', name, p: { x: 0, y: 0 }, sx: 1, sy: 1, rot: 0, attribs: [], ...cm, tableBlock: true } as NewEntity;
    }
    case 'MULTILEADER': case 'MLEADER': {
      const txt = rv.str(304);
      if (!txt) return null;
      const p = rv.pt(12);
      return { type: 'mtext', p, h: rv.num(41, 2.5) || 2.5, text: txt, rot: 0, width: 0, attach: 1, ...cm };
    }
    case 'VIEWPORT': case 'SEQEND': case 'ATTRIB': case 'VERTEX': return null;
    default: return undefined;
  }
}

function convText(rv: RecView, isAttrib: boolean): Omit<TextEnt, 'id'> | null {
  const cm = common(rv);
  if (isAttrib && (rv.num(70) & 1) !== 0) return null;
  const halign = rv.num(72, 0);
  const valign = isAttrib ? rv.num(74, 0) : rv.num(73, 0);
  const fitLike = halign === 3 || halign === 5;
  const useAlign = (halign !== 0 || valign !== 0) && !fitLike && rv.has(11);
  let p = useAlign ? rv.pt(11) : rv.pt(10);
  let rot = rad(rv.num(50));
  if (isFlipped(rv)) { p = flipX(p); rot = Math.PI - rot; }
  return {
    type: 'text', p, h: rv.num(40, 2.5), text: rv.str(1), rot,
    halign: useAlign ? halign : 0, valign: useAlign ? valign : 0,
    wf: rv.num(41, 1) || 1, style: rv.str(7) || undefined, tag: isAttrib ? rv.str(2) : undefined, ...cm,
  };
}

function convInsert(rv: RecView): (NewEntity & { type: 'insert' }) | null {
  const cm = common(rv);
  const name = rv.str(2);
  if (!name) return null;
  let p = rv.pt(10), rot = rad(rv.num(50));
  let sx = rv.num(41, 1) || 1, sy = rv.num(42, 1) || 1;
  if (isFlipped(rv)) { p = flipX(p); rot = Math.PI - rot; sy = -sy; }
  const cols = rv.num(70, 1), rows = rv.num(71, 1);
  const ins: NewEntity & { type: 'insert' } = { type: 'insert', name, p, sx, sy, rot, attribs: [], ...cm };
  if (cols > 1 || rows > 1) Object.assign(ins, { cols, rows, colSpacing: rv.num(44), rowSpacing: rv.num(45) });
  return ins;
}

function convPolyline(rv: RecView, verts: RecView[]): NewEntity | null {
  const cm = common(rv);
  const flags = rv.num(70);
  if (flags & (16 | 64)) return null; // polygon / polyface meshes
  const vs = verts.filter((v) => (v.num(70) & 16) === 0);
  if (vs.length === 0) return null;
  const flip = isFlipped(rv) && (flags & 8) === 0;
  const pts = vs.map((v) => (flip ? flipX(v.pt(10)) : v.pt(10)));
  const bulges = vs.map((v) => (flip ? -v.num(42) : v.num(42)));
  return { type: 'polyline', pts, bulges, closed: (flags & 1) !== 0, ...cm };
}

function convDimension(rv: RecView, cm: ReturnType<typeof common>): NewEntity | null {
  const type = rv.num(70) & 7;
  const block = rv.str(2) || undefined;
  const p10 = rv.pt(10), p11 = rv.pt(11), p13 = rv.pt(13), p14 = rv.pt(14), p15 = rv.pt(15), p16 = rv.pt(16);
  const textOverride = rv.has(1) ? rv.str(1) : undefined;
  const base = { ...cm, textOverride: textOverride === '' ? undefined : textOverride, block, measurement: rv.has(42) ? rv.num(42) : undefined };
  let dimType: DimType = 'linear';
  let p1 = p13, p2 = p14, p3: Vec | undefined, loc = p10;
  let rot = rad(rv.num(50));
  switch (type) {
    case 0: dimType = 'linear'; break;
    case 1: dimType = 'aligned'; break;
    case 3: dimType = 'diameter'; p1 = p15; p2 = p10; loc = p11; break;
    case 4: dimType = 'radius'; p1 = p10; p2 = p15; loc = p11; break;
    case 2: {
      dimType = 'angular';
      const v = lineLine(p13, p14, p10, p15);
      if (!v) return block ? { type: 'dimension', dimType: 'linear', p1: p13, p2: p14, loc: p10, rot: 0, ...base } : null;
      p1 = v;
      p2 = dist(v, p14) > dist(v, p13) ? p14 : p13;
      p3 = dist(v, p15) > dist(v, p10) ? p15 : p10;
      loc = p16;
      rot = 0;
      break;
    }
    case 5: dimType = 'angular'; p1 = p15; p2 = p13; p3 = p14; loc = p10; rot = 0; break;
    default:
      // Ordinate and others: geometry comes from the block only.
      if (!block) return null;
      dimType = 'linear';
  }
  return { type: 'dimension', dimType, p1, p2, p3, loc, rot, ...base };
}

/** Reads HATCH boundary loops and pattern data with a sequential cursor. */
function convHatch(rv: RecView, cm: ReturnType<typeof common>, flip: boolean): NewEntity | null {
  const tags = rv.r.tags;
  let k = 0;
  const peek = () => tags[k]?.[0];
  const take = (): Tag => tags[k++];
  const val = () => num(take()[1]);
  let pattern = 'SOLID';
  let solid = false;
  const loops: HatchLoop[] = [];
  let angle = 0, scale = 1;
  const patLines: PatLine[] = [];

  while (k < tags.length) {
    const [c, v] = tags[k];
    if (c === 2) { pattern = v.trim(); k++; }
    else if (c === 70) { solid = num(v) === 1; k++; }
    else if (c === 91) {
      const nLoops = num(v);
      k++;
      for (let li = 0; li < nLoops && k < tags.length; li++) {
        while (k < tags.length && peek() !== 92) k++;
        if (k >= tags.length) break;
        const ltype = val();
        const loop = (ltype & 2) ? readPolyLoop() : readEdgeLoop();
        if (loop && loop.pts.length >= 2) loops.push(loop);
        // skip source boundary handles
        if (peek() === 97) { const n = val(); for (let s = 0; s < n && peek() === 330; s++) k++; }
      }
    } else if (c === 52) { angle = rad(num(v)); k++; }
    else if (c === 41) { scale = num(v, 1) || 1; k++; }
    else if (c === 78) {
      const n = num(v);
      k++;
      for (let pi = 0; pi < n && k < tags.length; pi++) {
        const pl: PatLine = { ang: 0, base: { x: 0, y: 0 }, off: { x: 0, y: 0 }, dashes: [] };
        if (peek() === 53) pl.ang = rad(val());
        if (peek() === 43) pl.base.x = val();
        if (peek() === 44) pl.base.y = val();
        if (peek() === 45) pl.off.x = val();
        if (peek() === 46) pl.off.y = val();
        let nd = 0;
        if (peek() === 79) nd = val();
        for (let d = 0; d < nd && peek() === 49; d++) pl.dashes.push(val());
        patLines.push(pl);
      }
    } else k++;
  }

  function readPt(xc: number): Vec {
    const p = { x: 0, y: 0 };
    if (peek() === xc) p.x = val();
    if (peek() === xc + 10) p.y = val();
    return p;
  }

  function readPolyLoop(): HatchLoop {
    let hasBulge = 0, n = 0;
    if (peek() === 72) hasBulge = val();
    if (peek() === 73) k++;
    if (peek() === 93) n = val();
    const pts: Vec[] = [], bulges: number[] = [];
    for (let j = 0; j < n && k < tags.length; j++) {
      pts.push(readPt(10));
      bulges.push(hasBulge && peek() === 42 ? val() : 0);
    }
    return { pts, bulges };
  }

  function readEdgeLoop(): HatchLoop {
    let n = 0;
    if (peek() === 93) n = val();
    const pts: Vec[] = [], bulges: number[] = [];
    for (let j = 0; j < n && k < tags.length; j++) {
      if (peek() !== 72) break;
      const et = val();
      if (et === 1) {
        const a = readPt(10), b = readPt(11);
        pts.push(a); bulges.push(0);
        void b;
      } else if (et === 2) {
        const c = readPt(10);
        const r = peek() === 40 ? val() : 0;
        let sa = peek() === 50 ? rad(val()) : 0;
        let ea = peek() === 51 ? rad(val()) : TAU;
        const ccw = peek() === 73 ? val() !== 0 : true;
        if (ccw) {
          const sw = Math.abs(ea - sa) >= TAU - 1e-9 ? TAU : sweep(sa, ea);
          pushArc(pts, bulges, c, r, sa, sw);
        } else {
          sa = -sa; ea = -ea;
          const sw = Math.abs(ea - sa) >= TAU - 1e-9 ? TAU : sweep(ea, sa);
          pushArc(pts, bulges, c, r, sa, -sw);
        }
      } else if (et === 3) {
        const c = readPt(10), major = readPt(11);
        const ratio = peek() === 40 ? val() : 1;
        let sa = peek() === 50 ? rad(val()) : 0;
        let ea = peek() === 51 ? rad(val()) : TAU;
        const ccw = peek() === 73 ? val() !== 0 : true;
        const el = { c, major, ratio };
        const steps = 32;
        if (!ccw) { sa = -sa; ea = -ea; }
        const sw = ccw ? sweep(sa, ea) : -sweep(ea, sa);
        for (let s = 0; s < steps; s++) { pts.push(ellipsePoint(el, sa + (sw * s) / steps)); bulges.push(0); }
      } else if (et === 4) {
        let degree = 3, nk = 0, nc = 0;
        if (peek() === 94) degree = val();
        if (peek() === 73) k++;
        if (peek() === 74) k++;
        if (peek() === 95) nk = val();
        if (peek() === 96) nc = val();
        const knots: number[] = [];
        for (let q = 0; q < nk && peek() === 40; q++) knots.push(val());
        const ctrl: Vec[] = [];
        const weights: number[] = [];
        for (let q = 0; q < nc && peek() === 10; q++) {
          ctrl.push(readPt(10));
          if (peek() === 42) weights.push(val());
        }
        if (peek() === 97) { const nf = val(); for (let q = 0; q < nf && peek() === 11; q++) readPt(11); }
        if (peek() === 12) readPt(12);
        if (peek() === 13) readPt(13);
        const sp = { type: 'spline', ctrl, degree, knots, weights: weights.length === ctrl.length ? weights : undefined, closed: false } as unknown as SplineEnt;
        const fl = flattenSpline(sp, 0.05);
        for (let q = 0; q < fl.length - 1; q++) { pts.push(fl[q]); bulges.push(0); }
      }
    }
    return { pts, bulges };
  }

  if (!loops.length) return null;
  const fl = flip
    ? loops.map((l) => ({ pts: l.pts.map(flipX), bulges: l.bulges.map((b) => -b) }))
    : loops;
  return {
    type: 'hatch', loops: fl, pattern, solid: solid || pattern.toUpperCase() === 'SOLID',
    scale, angle: flip ? normAng(Math.PI - angle) : angle,
    patLines: patLines.length ? patLines : undefined, ...cm,
  };
}

function pushArc(pts: Vec[], bulges: number[], c: Vec, r: number, sa: number, sw: number) {
  // Split full/large arcs into ≤180° pieces so bulges stay well-conditioned.
  const pieces = Math.max(1, Math.ceil(Math.abs(sw) / Math.PI));
  for (let s = 0; s < pieces; s++) {
    const a = sa + (sw * s) / pieces;
    pts.push(polar(c, a, r));
    bulges.push(Math.tan(sw / pieces / 4));
  }
}

/** Builds BlockDef objects (ids assigned by caller). */
export function toBlockDefs(data: DxfData, alloc: () => number): BlockDef[] {
  return data.blocks.map((b) => ({
    name: b.name,
    base: b.base,
    entities: b.entities.map((e) => ({ layer: '0', color: BYLAYER, ltype: 'ByLayer', ...e, id: alloc() }) as Entity),
  }));
}

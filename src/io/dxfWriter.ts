// ASCII DXF writer targeting AutoCAD R2000 (AC1015). Dimensions are written with
// generated anonymous *D blocks so every reader shows the same geometry.

import type { Vec } from '../core/geom.ts';
import { deg, normAng, sub, dist } from '../core/geom.ts';
import {
  type Entity, type DimEnt, type TextEnt, type HatchEnt, type NewEntity,
  BYLAYER, dimGeometry, dimMeasurement, arrowPts, isFullEllipse,
} from '../core/entities.ts';
import type { Drawing, Linetype } from '../core/document.ts';
import { patternLines } from '../core/patterns.ts';

class Out {
  private parts: string[] = [];
  private handle = 0x30;
  nextHandle(): string {
    return (this.handle++).toString(16).toUpperCase();
  }
  get handseed(): string {
    return (this.handle + 1).toString(16).toUpperCase();
  }
  tag(code: number, value: string | number): void {
    this.parts.push(code < 10 ? `  ${code}` : code < 100 ? ` ${code}` : `${code}`);
    this.parts.push(typeof value === 'number' ? fmt(value) : value);
  }
  int(code: number, value: number): void {
    this.parts.push(code < 10 ? `  ${code}` : code < 100 ? ` ${code}` : `${code}`);
    this.parts.push(String(Math.round(value)).padStart(6, ' '));
  }
  pt(code: number, p: Vec, z = 0): void {
    this.tag(code, p.x);
    this.tag(code + 10, p.y);
    this.tag(code + 20, z);
  }
  str(code: number, s: string): void {
    this.tag(code, encode(s));
  }
  toString(): string {
    return this.parts.join('\r\n') + '\r\n';
  }
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0.0';
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return n.toFixed(1);
  let s = n.toFixed(12);
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s += '0';
  return s === '-0.0' ? '0.0' : s;
}

/** R2000 strings use the drawing code page; anything non-ASCII goes out as \U+XXXX. */
function encode(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp === 10 || cp === 13) continue;
    if (cp < 128) out += ch;
    else if (cp <= 0xffff) out += '\\U+' + cp.toString(16).toUpperCase().padStart(4, '0');
    else out += '?';
  }
  return out;
}

const INVALID_NAME = /[<>/\\":;?*|=`]/g;
const cleanName = (s: string): string => s.replace(INVALID_NAME, '_') || '0';

interface BlockRec { name: string; handle: string; base: Vec; entities: Entity[]; flags: number }

export function writeDxf(doc: Drawing): string {
  const o = new Out();
  // Reserve handles for fixed objects.
  const H = {
    vportTable: o.nextHandle(), ltypeTable: o.nextHandle(), layerTable: o.nextHandle(), styleTable: o.nextHandle(),
    viewTable: o.nextHandle(), ucsTable: o.nextHandle(), appidTable: o.nextHandle(), dimstyleTable: o.nextHandle(),
    brTable: o.nextHandle(), rootDict: o.nextHandle(), groupDict: o.nextHandle(),
    plotStyleDict: o.nextHandle(), plotStyleNormal: o.nextHandle(),
    modelBR: o.nextHandle(), paperBR: o.nextHandle(), standardStyle: o.nextHandle(), standardDimstyle: o.nextHandle(),
  };

  // Collect blocks: user/imported blocks plus generated dimension blocks.
  const blocks: BlockRec[] = [];
  const usedNames = new Set<string>();
  for (const b of doc.blocks.values()) {
    if (/^\*D\d*$/i.test(b.name)) continue; // regenerated below
    const name = b.name.startsWith('*') ? b.name : cleanName(b.name);
    if (usedNames.has(name.toUpperCase())) continue;
    usedNames.add(name.toUpperCase());
    blocks.push({ name, handle: o.nextHandle(), base: b.base, entities: b.entities, flags: name.startsWith('*') ? 1 : 0 });
  }
  const dimBlocks = new Map<number, string>();
  let dimN = 1;
  const genDimBlock = (e: DimEnt) => {
    const name = `*D${dimN++}`;
    const ents = dimBlockEntities(e, doc);
    blocks.push({ name, handle: o.nextHandle(), base: { x: 0, y: 0 }, entities: ents, flags: 1 });
    dimBlocks.set(e.id, name);
  };
  for (const e of doc.entities.values()) if (e.type === 'dimension') genDimBlock(e);
  for (const b of blocks.slice()) for (const e of b.entities) if (e.type === 'dimension' && !dimBlocks.has(e.id)) genDimBlock(e);

  // Linetypes actually referenced plus the standard set.
  const ltypes = new Map<string, Linetype>();
  for (const lt of doc.linetypes.values()) ltypes.set(lt.name.toUpperCase(), lt);

  const ext = doc.extents();
  const hasExt = ext.minX <= ext.maxX;

  // ---------------------------------------------------------------- HEADER
  o.tag(0, 'SECTION'); o.tag(2, 'HEADER');
  const hv = (name: string, f: () => void) => { o.tag(9, name); f(); };
  hv('$ACADVER', () => o.tag(1, 'AC1015'));
  hv('$ACADMAINTVER', () => o.int(70, 6));
  hv('$DWGCODEPAGE', () => o.tag(3, 'ANSI_1252'));
  hv('$INSBASE', () => o.pt(10, { x: 0, y: 0 }));
  hv('$EXTMIN', () => o.pt(10, hasExt ? { x: ext.minX, y: ext.minY } : { x: 0, y: 0 }));
  hv('$EXTMAX', () => o.pt(10, hasExt ? { x: ext.maxX, y: ext.maxY } : { x: 420, y: 297 }));
  hv('$LIMMIN', () => { o.tag(10, 0); o.tag(20, 0); });
  hv('$LIMMAX', () => { o.tag(10, 420); o.tag(20, 297); });
  hv('$LTSCALE', () => o.tag(40, doc.header.ltscale));
  hv('$TEXTSIZE', () => o.tag(40, doc.header.textsize));
  hv('$TEXTSTYLE', () => o.tag(7, 'Standard'));
  hv('$CLAYER', () => o.str(8, cleanName(doc.currentLayer)));
  hv('$CELTYPE', () => o.tag(6, 'ByLayer'));
  hv('$CECOLOR', () => o.int(62, 256));
  hv('$MIRRTEXT', () => o.int(70, doc.header.mirrtext ? 1 : 0));
  hv('$FILLETRAD', () => o.tag(40, doc.header.filletRad));
  hv('$PDMODE', () => o.int(70, doc.header.pdmode));
  hv('$PDSIZE', () => o.tag(40, doc.header.pdsize));
  hv('$DIMSTYLE', () => o.tag(2, 'Standard'));
  const ds = doc.dimStyle;
  hv('$DIMSCALE', () => o.tag(40, ds.dimscale));
  hv('$DIMASZ', () => o.tag(40, ds.dimasz));
  hv('$DIMEXO', () => o.tag(40, ds.dimexo));
  hv('$DIMEXE', () => o.tag(40, ds.dimexe));
  hv('$DIMTXT', () => o.tag(40, ds.dimtxt));
  hv('$DIMGAP', () => o.tag(40, ds.dimgap));
  hv('$DIMTAD', () => o.int(70, 1));
  hv('$DIMTIH', () => o.int(70, 0));
  hv('$DIMTOH', () => o.int(70, 0));
  hv('$DIMZIN', () => o.int(70, 8));
  hv('$DIMDEC', () => o.int(70, ds.dimdec));
  hv('$DIMADEC', () => o.int(70, ds.dimadec));
  hv('$DIMDSEP', () => o.int(70, ds.dimdsep.charCodeAt(0)));
  hv('$INSUNITS', () => o.int(70, doc.header.insunits));
  hv('$MEASUREMENT', () => o.int(70, 1));
  hv('$LUNITS', () => o.int(70, 2));
  hv('$LUPREC', () => o.int(70, 4));
  hv('$HANDSEED', () => o.tag(5, 'FFFFF'));
  o.tag(0, 'ENDSEC');

  // ---------------------------------------------------------------- CLASSES
  o.tag(0, 'SECTION'); o.tag(2, 'CLASSES'); o.tag(0, 'ENDSEC');

  // ---------------------------------------------------------------- TABLES
  o.tag(0, 'SECTION'); o.tag(2, 'TABLES');
  const table = (name: string, handle: string, count: number, body: () => void, extraSubclass?: string) => {
    o.tag(0, 'TABLE'); o.tag(2, name); o.tag(5, handle); o.tag(330, '0'); o.tag(100, 'AcDbSymbolTable');
    o.int(70, count);
    if (extraSubclass) o.tag(100, extraSubclass);
    body();
    o.tag(0, 'ENDTAB');
  };
  const recHead = (type: string, owner: string, sub: string, handleCode = 5) => {
    o.tag(0, type); o.tag(handleCode, o.nextHandle()); o.tag(330, owner);
    o.tag(100, 'AcDbSymbolTableRecord'); o.tag(100, sub);
  };

  table('VPORT', H.vportTable, 1, () => {
    recHead('VPORT', H.vportTable, 'AcDbViewportTableRecord');
    o.tag(2, '*Active'); o.int(70, 0);
    o.tag(10, 0); o.tag(20, 0); o.tag(11, 1); o.tag(21, 1);
    const cx = hasExt ? (ext.minX + ext.maxX) / 2 : 210, cy = hasExt ? (ext.minY + ext.maxY) / 2 : 148.5;
    const vh = hasExt ? Math.max(ext.maxY - ext.minY, (ext.maxX - ext.minX) / 1.6) * 1.1 || 297 : 297;
    o.tag(12, cx); o.tag(22, cy); o.tag(13, 0); o.tag(23, 0); o.tag(14, 10); o.tag(24, 10); o.tag(15, 10); o.tag(25, 10);
    o.tag(16, 0); o.tag(26, 0); o.tag(36, 1); o.tag(17, 0); o.tag(27, 0); o.tag(37, 0);
    o.tag(40, vh); o.tag(41, 1.6); o.tag(42, 50); o.tag(43, 0); o.tag(44, 0); o.tag(50, 0); o.tag(51, 0);
    o.int(71, 0); o.int(72, 1000); o.int(73, 1); o.int(74, 3); o.int(75, 0); o.int(76, 1); o.int(77, 0); o.int(78, 0);
  });

  table('LTYPE', H.ltypeTable, ltypes.size + 2, () => {
    for (const name of ['ByBlock', 'ByLayer']) {
      recHead('LTYPE', H.ltypeTable, 'AcDbLinetypeTableRecord');
      o.tag(2, name); o.int(70, 0); o.tag(3, ''); o.int(72, 65); o.int(73, 0); o.tag(40, 0);
    }
    for (const lt of ltypes.values()) {
      recHead('LTYPE', H.ltypeTable, 'AcDbLinetypeTableRecord');
      o.str(2, cleanName(lt.name)); o.int(70, 0); o.str(3, lt.desc); o.int(72, 65); o.int(73, lt.pattern.length);
      o.tag(40, lt.pattern.reduce((a, b) => a + Math.abs(b), 0));
      for (const d of lt.pattern) { o.tag(49, d); o.int(74, 0); }
    }
  });

  table('LAYER', H.layerTable, doc.layers.size, () => {
    for (const l of doc.layers.values()) {
      recHead('LAYER', H.layerTable, 'AcDbLayerTableRecord');
      o.str(2, cleanName(l.name));
      o.int(70, (l.frozen ? 1 : 0) | (l.locked ? 4 : 0));
      o.int(62, l.on ? l.color : -l.color);
      if (l.trueColor !== undefined) o.int(420, l.trueColor);
      const lt = ltypes.get((l.ltype || 'Continuous').toUpperCase());
      o.str(6, lt ? cleanName(lt.name) : 'Continuous');
      if (!l.plot) o.int(290, 0);
      o.int(370, l.lw ?? -3);
      o.tag(390, H.plotStyleNormal);
    }
  });

  table('STYLE', H.styleTable, 1, () => {
    o.tag(0, 'STYLE'); o.tag(5, H.standardStyle); o.tag(330, H.styleTable);
    o.tag(100, 'AcDbSymbolTableRecord'); o.tag(100, 'AcDbTextStyleTableRecord');
    o.tag(2, 'Standard'); o.int(70, 0); o.tag(40, 0); o.tag(41, 1); o.tag(50, 0); o.int(71, 0); o.tag(42, 2.5);
    o.tag(3, 'arial.ttf'); o.tag(4, '');
  });

  table('VIEW', H.viewTable, 0, () => {});
  table('UCS', H.ucsTable, 0, () => {});
  table('APPID', H.appidTable, 1, () => {
    recHead('APPID', H.appidTable, 'AcDbRegAppTableRecord');
    o.tag(2, 'ACAD'); o.int(70, 0);
  });

  table('DIMSTYLE', H.dimstyleTable, 1, () => {
    o.tag(0, 'DIMSTYLE'); o.tag(105, H.standardDimstyle); o.tag(330, H.dimstyleTable);
    o.tag(100, 'AcDbSymbolTableRecord'); o.tag(100, 'AcDbDimStyleTableRecord');
    o.tag(2, 'Standard'); o.int(70, 0);
    o.tag(40, ds.dimscale); o.tag(41, ds.dimasz); o.tag(42, ds.dimexo); o.tag(44, ds.dimexe);
    o.int(73, 0); o.int(74, 0); o.int(77, 1); o.int(78, 8);
    o.tag(140, ds.dimtxt); o.tag(147, ds.dimgap);
    o.int(179, ds.dimadec); o.int(271, ds.dimdec); o.int(278, ds.dimdsep.charCodeAt(0));
    o.tag(340, H.standardStyle);
  }, 'AcDbDimStyleTable');

  table('BLOCK_RECORD', H.brTable, blocks.length + 2, () => {
    const br = (name: string, handle: string) => {
      o.tag(0, 'BLOCK_RECORD'); o.tag(5, handle); o.tag(330, H.brTable);
      o.tag(100, 'AcDbSymbolTableRecord'); o.tag(100, 'AcDbBlockTableRecord');
      o.str(2, name);
    };
    br('*Model_Space', H.modelBR);
    br('*Paper_Space', H.paperBR);
    for (const b of blocks) br(b.name, b.handle);
  });
  o.tag(0, 'ENDSEC');

  // ---------------------------------------------------------------- BLOCKS
  const ctx: WriteCtx = { o, doc, ltypes, dimBlocks };
  o.tag(0, 'SECTION'); o.tag(2, 'BLOCKS');
  const blockHead = (name: string, owner: string, base: Vec, flags: number, paper = false) => {
    o.tag(0, 'BLOCK'); o.tag(5, o.nextHandle()); o.tag(330, owner); o.tag(100, 'AcDbEntity');
    if (paper) o.int(67, 1);
    o.tag(8, '0'); o.tag(100, 'AcDbBlockBegin'); o.str(2, name); o.int(70, flags); o.pt(10, base); o.str(3, name); o.tag(1, '');
  };
  const blockTail = (owner: string, paper = false) => {
    o.tag(0, 'ENDBLK'); o.tag(5, o.nextHandle()); o.tag(330, owner); o.tag(100, 'AcDbEntity');
    if (paper) o.int(67, 1);
    o.tag(8, '0'); o.tag(100, 'AcDbBlockEnd');
  };
  blockHead('*Model_Space', H.modelBR, { x: 0, y: 0 }, 0); blockTail(H.modelBR);
  blockHead('*Paper_Space', H.paperBR, { x: 0, y: 0 }, 0, true); blockTail(H.paperBR, true);
  for (const b of blocks) {
    blockHead(b.name, b.handle, b.base, b.flags);
    for (const e of b.entities) writeEntity(ctx, e, b.handle);
    blockTail(b.handle);
  }
  o.tag(0, 'ENDSEC');

  // ---------------------------------------------------------------- ENTITIES
  o.tag(0, 'SECTION'); o.tag(2, 'ENTITIES');
  for (const e of doc.entities.values()) writeEntity(ctx, e, H.modelBR);
  o.tag(0, 'ENDSEC');

  // ---------------------------------------------------------------- OBJECTS
  o.tag(0, 'SECTION'); o.tag(2, 'OBJECTS');
  o.tag(0, 'DICTIONARY'); o.tag(5, H.rootDict); o.tag(330, '0'); o.tag(100, 'AcDbDictionary'); o.int(281, 1);
  o.tag(3, 'ACAD_GROUP'); o.tag(350, H.groupDict);
  o.tag(3, 'ACAD_PLOTSTYLENAME'); o.tag(350, H.plotStyleDict);
  o.tag(0, 'DICTIONARY'); o.tag(5, H.groupDict); o.tag(330, H.rootDict); o.tag(100, 'AcDbDictionary'); o.int(281, 1);
  o.tag(0, 'ACDBDICTIONARYWDFLT'); o.tag(5, H.plotStyleDict); o.tag(330, H.rootDict); o.tag(100, 'AcDbDictionary'); o.int(281, 1);
  o.tag(3, 'Normal'); o.tag(350, H.plotStyleNormal);
  o.tag(100, 'AcDbDictionaryWithDefault'); o.tag(340, H.plotStyleNormal);
  o.tag(0, 'ACDBPLACEHOLDER'); o.tag(5, H.plotStyleNormal); o.tag(330, H.plotStyleDict);
  o.tag(0, 'ENDSEC');
  o.tag(0, 'EOF');

  // Patch $HANDSEED now that all handles are allocated.
  return o.toString().replace('\r\n  5\r\nFFFFF\r\n', `\r\n  5\r\n${o.handseed}\r\n`);
}

interface WriteCtx {
  o: Out;
  doc: Drawing;
  ltypes: Map<string, Linetype>;
  dimBlocks: Map<number, string>;
}

function entHead(ctx: WriteCtx, type: string, e: Pick<Entity, 'layer' | 'color' | 'ltype' | 'trueColor' | 'ltscale'>, owner: string): string {
  const { o } = ctx;
  const h = o.nextHandle();
  o.tag(0, type); o.tag(5, h); o.tag(330, owner); o.tag(100, 'AcDbEntity');
  o.str(8, cleanName(e.layer || '0'));
  const lt = e.ltype || 'ByLayer';
  if (!/^bylayer$/i.test(lt)) {
    const known = /^byblock$/i.test(lt) ? 'ByBlock' : ctx.ltypes.get(lt.toUpperCase())?.name;
    if (known) o.str(6, cleanName(known));
  }
  if (e.color !== BYLAYER) o.int(62, e.color);
  if (e.trueColor !== undefined) o.int(420, e.trueColor);
  if (e.ltscale !== undefined && e.ltscale !== 1) o.tag(48, e.ltscale);
  return h;
}

function writeText(ctx: WriteCtx, e: TextEnt, owner: string, kind: 'TEXT' | 'ATTRIB' = 'TEXT'): void {
  const { o } = ctx;
  entHead(ctx, kind, e, owner);
  o.tag(100, 'AcDbText');
  o.pt(10, e.p);
  o.tag(40, e.h);
  o.str(1, e.text);
  if (Math.abs(e.rot) > 1e-12) o.tag(50, deg(normAng(e.rot)));
  if ((e.wf || 1) !== 1) o.tag(41, e.wf);
  o.tag(7, 'Standard');
  if (e.halign) o.int(72, e.halign);
  if (e.halign || e.valign) o.pt(11, e.p);
  if (kind === 'TEXT') {
    o.tag(100, 'AcDbText');
    if (e.valign) o.int(73, e.valign);
  } else {
    o.tag(100, 'AcDbAttribute');
    o.str(2, e.tag || 'TAG');
    o.int(70, 0);
    if (e.valign) o.int(74, e.valign);
  }
}

function writeEntity(ctx: WriteCtx, e: Entity, owner: string): void {
  const { o } = ctx;
  switch (e.type) {
    case 'line':
      entHead(ctx, 'LINE', e, owner);
      o.tag(100, 'AcDbLine'); o.pt(10, e.p1); o.pt(11, e.p2);
      return;
    case 'circle':
      entHead(ctx, 'CIRCLE', e, owner);
      o.tag(100, 'AcDbCircle'); o.pt(10, e.c); o.tag(40, e.r);
      return;
    case 'arc':
      entHead(ctx, 'ARC', e, owner);
      o.tag(100, 'AcDbCircle'); o.pt(10, e.c); o.tag(40, e.r);
      o.tag(100, 'AcDbArc'); o.tag(50, deg(normAng(e.a0))); o.tag(51, deg(normAng(e.a1)));
      return;
    case 'polyline': {
      entHead(ctx, 'LWPOLYLINE', e, owner);
      o.tag(100, 'AcDbPolyline'); o.int(90, e.pts.length); o.int(70, e.closed ? 1 : 0);
      if (e.width) o.tag(43, e.width);
      e.pts.forEach((p, i) => {
        o.tag(10, p.x); o.tag(20, p.y);
        if (Math.abs(e.bulges[i] || 0) > 1e-12) o.tag(42, e.bulges[i]);
      });
      return;
    }
    case 'ellipse': {
      entHead(ctx, 'ELLIPSE', e, owner);
      o.tag(100, 'AcDbEllipse'); o.pt(10, e.c); o.pt(11, e.major);
      o.tag(210, 0); o.tag(220, 0); o.tag(230, 1);
      o.tag(40, Math.min(1, Math.max(1e-6, e.ratio)));
      const full = isFullEllipse(e);
      o.tag(41, full ? 0 : normAng(e.a0)); o.tag(42, full ? Math.PI * 2 : normAng(e.a1) || Math.PI * 2);
      return;
    }
    case 'spline': {
      if (e.knots.length !== e.ctrl.length + e.degree + 1) {
        const pts = e.fit && e.fit.length ? e.fit : e.ctrl;
        writeEntity(ctx, { ...e, type: 'polyline', pts, bulges: pts.map(() => 0), closed: e.closed } as Entity, owner);
        return;
      }
      entHead(ctx, 'SPLINE', e, owner);
      o.tag(100, 'AcDbSpline'); o.tag(210, 0); o.tag(220, 0); o.tag(230, 1);
      const rational = !!e.weights && e.weights.some((w) => Math.abs(w - 1) > 1e-12);
      o.int(70, 8 | (e.closed ? 1 : 0) | (rational ? 4 : 0));
      o.int(71, e.degree); o.int(72, e.knots.length); o.int(73, e.ctrl.length); o.int(74, 0);
      o.tag(42, 1e-10); o.tag(43, 1e-10);
      for (const k of e.knots) o.tag(40, k);
      if (rational) for (const w of e.weights!) o.tag(41, w);
      for (const p of e.ctrl) o.pt(10, p);
      return;
    }
    case 'point':
      entHead(ctx, 'POINT', e, owner);
      o.tag(100, 'AcDbPoint'); o.pt(10, e.p);
      return;
    case 'text':
      writeText(ctx, e, owner);
      return;
    case 'mtext': {
      entHead(ctx, 'MTEXT', e, owner);
      o.tag(100, 'AcDbMText'); o.pt(10, e.p); o.tag(40, e.h); o.tag(41, e.width || 0);
      o.int(71, e.attach || 1); o.int(72, 1);
      const enc = encode(e.text);
      let rest = enc;
      while (rest.length > 250) {
        // avoid splitting an escape sequence
        let cut = 250;
        const esc = rest.lastIndexOf('\\', cut);
        if (esc > 240) cut = esc;
        o.tag(3, rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      o.tag(1, rest);
      o.tag(7, 'Standard');
      o.pt(11, { x: Math.cos(e.rot), y: Math.sin(e.rot) });
      return;
    }
    case 'solid': {
      entHead(ctx, 'SOLID', e, owner);
      o.tag(100, 'AcDbTrace');
      const [a, b, c, d] = e.pts;
      o.pt(10, a); o.pt(11, b); o.pt(12, d ?? c); o.pt(13, c);
      return;
    }
    case 'hatch':
      writeHatch(ctx, e, owner);
      return;
    case 'dimension':
      writeDimension(ctx, e, owner);
      return;
    case 'insert': {
      const h = entHead(ctx, 'INSERT', e, owner);
      o.tag(100, 'AcDbBlockReference');
      if (e.attribs.length) o.int(66, 1);
      o.str(2, e.name.startsWith('*') ? e.name : cleanName(e.name));
      o.pt(10, e.p);
      if (e.sx !== 1) o.tag(41, e.sx);
      if (e.sy !== 1) o.tag(42, e.sy);
      if (e.sx !== 1 || e.sy !== 1) o.tag(43, Math.abs(e.sx));
      if (Math.abs(e.rot) > 1e-12) o.tag(50, deg(normAng(e.rot)));
      if ((e.cols ?? 1) > 1 || (e.rows ?? 1) > 1) {
        o.int(70, e.cols ?? 1); o.int(71, e.rows ?? 1); o.tag(44, e.colSpacing ?? 0); o.tag(45, e.rowSpacing ?? 0);
      }
      if (e.attribs.length) {
        for (const a of e.attribs) writeText(ctx, a, h, 'ATTRIB');
        o.tag(0, 'SEQEND'); o.tag(5, o.nextHandle()); o.tag(330, h); o.tag(100, 'AcDbEntity'); o.str(8, cleanName(e.layer));
      }
      return;
    }
  }
}

function writeHatch(ctx: WriteCtx, e: HatchEnt, owner: string): void {
  const { o } = ctx;
  const solid = e.solid || e.pattern.toUpperCase() === 'SOLID';
  const lines = solid ? null : (e.patLines ?? patternLines(e.pattern, e.scale, e.angle) ?? patternLines('ANSI31', e.scale, e.angle));
  entHead(ctx, 'HATCH', e, owner);
  o.tag(100, 'AcDbHatch');
  o.pt(10, { x: 0, y: 0 });
  o.tag(210, 0); o.tag(220, 0); o.tag(230, 1);
  o.str(2, solid ? 'SOLID' : (e.patLines || patternLines(e.pattern, 1, 0)) ? e.pattern : 'ANSI31');
  o.int(70, solid ? 1 : 0);
  o.int(71, 0);
  o.int(91, e.loops.length);
  e.loops.forEach((l, li) => {
    o.int(92, li === 0 ? 3 : 2);
    const hasBulge = l.bulges.some((b) => Math.abs(b) > 1e-12);
    o.int(72, hasBulge ? 1 : 0); o.int(73, 1); o.int(93, l.pts.length);
    l.pts.forEach((p, i) => {
      o.tag(10, p.x); o.tag(20, p.y);
      if (hasBulge) o.tag(42, l.bulges[i] || 0);
    });
    o.int(97, 0);
  });
  o.int(75, 0);
  o.int(76, 1);
  if (lines) {
    o.tag(52, deg(normAng(e.angle)));
    o.tag(41, e.scale);
    o.int(77, 0);
    o.int(78, lines.length);
    for (const pl of lines) {
      o.tag(53, deg(normAng(pl.ang)));
      o.tag(43, pl.base.x); o.tag(44, pl.base.y);
      o.tag(45, pl.off.x); o.tag(46, pl.off.y);
      o.int(79, pl.dashes.length);
      for (const d of pl.dashes) o.tag(49, d);
    }
  }
  o.int(98, 0);
}

/** Geometry of a dimension as plain entities, used for its *D block. */
function dimBlockEntities(e: DimEnt, doc: Drawing): Entity[] {
  const blk = e.block ? doc.blocks.get(e.block) : undefined;
  if (blk) return blk.entities;
  const g = dimGeometry(e, doc.dimStyle);
  const base = { layer: '0', color: 0, ltype: 'ByBlock' };
  const out: NewEntity[] = [];
  for (const [a, b] of g.lines) if (dist(a, b) > 1e-12) out.push({ type: 'line', p1: a, p2: b, ...base });
  for (const a of g.arcs) out.push({ type: 'arc', c: a.c, r: a.r, a0: a.a0, a1: a.a1, ...base });
  const asz = doc.dimStyle.dimasz * doc.dimStyle.dimscale;
  for (const ar of g.arrows) out.push({ type: 'solid', pts: arrowPts(ar.tip, ar.dir, asz), ...base });
  if (g.text.s) out.push({ type: 'mtext', p: g.text.p, h: g.text.h, text: g.text.s, rot: g.text.rot, width: 0, attach: 5, ...base });
  return out.map((x, i) => ({ ...x, id: -1 - i }) as Entity);
}

function writeDimension(ctx: WriteCtx, e: DimEnt, owner: string): void {
  const { o, doc } = ctx;
  const g = dimGeometry(e, doc.dimStyle);
  entHead(ctx, 'DIMENSION', e, owner);
  o.tag(100, 'AcDbDimension');
  o.str(2, ctx.dimBlocks.get(e.id) ?? '');
  const typeCode = { linear: 0, aligned: 1, angular: 5, diameter: 3, radius: 4 }[e.dimType];
  switch (e.dimType) {
    case 'linear': case 'aligned': {
      const n = { x: -Math.sin(e.dimType === 'linear' ? e.rot : Math.atan2(e.p2.y - e.p1.y, e.p2.x - e.p1.x)), y: Math.cos(e.dimType === 'linear' ? e.rot : Math.atan2(e.p2.y - e.p1.y, e.p2.x - e.p1.x)) };
      const d = (e.loc.x - e.p2.x) * n.x + (e.loc.y - e.p2.y) * n.y;
      o.pt(10, { x: e.p2.x + n.x * d, y: e.p2.y + n.y * d });
      break;
    }
    case 'radius': o.pt(10, e.p1); break;
    case 'diameter': o.pt(10, e.p2); break;
    case 'angular': o.pt(10, e.loc); break;
  }
  o.pt(11, g.text.p);
  o.int(70, typeCode | 32);
  o.int(71, 5);
  o.tag(42, e.dimType === 'angular' ? (dimMeasurement(e) * Math.PI) / 180 : dimMeasurement(e));
  if (e.textOverride !== undefined) o.str(1, e.textOverride);
  o.tag(3, 'Standard');
  switch (e.dimType) {
    case 'linear':
      o.tag(100, 'AcDbAlignedDimension'); o.pt(13, e.p1); o.pt(14, e.p2);
      o.tag(50, deg(normAng(e.rot)));
      o.tag(100, 'AcDbRotatedDimension');
      break;
    case 'aligned':
      o.tag(100, 'AcDbAlignedDimension'); o.pt(13, e.p1); o.pt(14, e.p2);
      break;
    case 'radius': {
      o.tag(100, 'AcDbRadialDimension'); o.pt(15, e.p2); o.tag(40, 0);
      break;
    }
    case 'diameter':
      o.tag(100, 'AcDbDiametricDimension'); o.pt(15, e.p1); o.tag(40, 0);
      break;
    case 'angular':
      o.tag(100, 'AcDb3PointAngularDimension'); o.pt(13, e.p2); o.pt(14, e.p3 ?? e.p2); o.pt(15, e.p1);
      break;
  }
}

// Exported for tests.
export const _internal = { fmt, encode, sub };

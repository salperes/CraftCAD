// System variables, drafting settings, plotting, hatch/block editing and selection tools.

import { type Vec, fmtNum, rad, deg, mxTranslate, emptyBox, boxUnion, boxValid } from '../../core/geom.ts';
import { type Entity, type HatchEnt, type SnapKind, entTransform } from '../../core/entities.ts';
import { type Editor, stripId } from '../editor.ts';

const isPt = (x: unknown): x is Vec => typeof x === 'object' && x !== null && 'x' in x;

// ---------------------------------------------------------------------------
// System variables

interface Sysvar {
  desc: string;
  kind: 'int' | 'real' | 'bool' | 'str';
  get: (ed: Editor) => number | string;
  set: (ed: Editor, v: number | string) => string | void;
  min?: number;
  max?: number;
}

const OSMODE_BITS: [number, SnapKind][] = [
  [1, 'end'], [2, 'mid'], [4, 'cen'], [8, 'node'], [16, 'qua'], [32, 'int'], [64, 'ins'], [128, 'per'], [256, 'tan'], [512, 'nea'], [1024, 'gcen'],
];

const b = (v: number | string) => Number(v) !== 0;

export const SYSVARS: Record<string, Sysvar> = {
  TILEMODE: { desc: 'Model tab (1) or a layout tab (0)', kind: 'bool', get: (ed) => (ed.doc.layout ? 0 : 1), set: (ed, v) => { if (b(v)) ed.setLayout(null); else if (!ed.doc.layout && ed.doc.layouts[0]) ed.setLayout(ed.doc.layouts[0]); } },
  CTAB: { desc: 'Current Model or layout tab', kind: 'str', get: (ed) => ed.doc.layout?.name ?? 'Model', set: (ed, v) => { const n = String(v); if (n.toUpperCase() === 'MODEL') { ed.setLayout(null); return; } const l = ed.doc.layoutByName(n); if (!l) return `Layout "${n}" not found.`; ed.setLayout(l); } },
  CURSORSIZE: { desc: 'Crosshair size as a percentage of the screen', kind: 'int', min: 1, max: 100, get: (ed) => ed.renderer.cursorSize, set: (ed, v) => { ed.renderer.cursorSize = Number(v); ed.redrawOverlay(); } },
  APERTURE: { desc: 'Object snap target size in pixels', kind: 'int', min: 1, max: 50, get: (ed) => ed.settings.aperture, set: (ed, v) => { ed.settings.aperture = Number(v); } },
  GRIDMODE: { desc: 'Grid display on/off', kind: 'bool', get: (ed) => (ed.settings.grid ? 1 : 0), set: (ed, v) => { ed.settings.grid = b(v); ed.ui.onStatus(); } },
  GRIDUNIT: { desc: 'Grid spacing', kind: 'real', min: 1e-9, get: (ed) => ed.renderer.gridStep, set: (ed, v) => { ed.renderer.gridStep = Number(v); ed.redraw(); } },
  GRIDMAJOR: { desc: 'Major grid line frequency', kind: 'int', min: 1, max: 100, get: (ed) => ed.renderer.gridMajor, set: (ed, v) => { ed.renderer.gridMajor = Number(v); ed.redraw(); } },
  SNAPMODE: { desc: 'Snap mode on/off', kind: 'bool', get: (ed) => (ed.settings.snap ? 1 : 0), set: (ed, v) => { ed.settings.snap = b(v); ed.ui.onStatus(); } },
  SNAPUNIT: { desc: 'Snap spacing', kind: 'real', min: 1e-9, get: (ed) => ed.settings.snapStep, set: (ed, v) => { ed.settings.snapStep = Number(v); } },
  ORTHOMODE: { desc: 'Ortho mode on/off', kind: 'bool', get: (ed) => (ed.settings.ortho ? 1 : 0), set: (ed, v) => { ed.settings.ortho = b(v); if (ed.settings.ortho) ed.settings.polar = false; ed.ui.onStatus(); } },
  AUTOSNAP: { desc: 'Polar tracking on (bit 8)', kind: 'int', get: (ed) => (ed.settings.polar ? 63 : 55), set: (ed, v) => { ed.settings.polar = (Number(v) & 8) !== 0; ed.ui.onStatus(); } },
  POLARANG: { desc: 'Polar tracking angle increment', kind: 'real', min: 0.1, max: 180, get: (ed) => ed.settings.polarInc, set: (ed, v) => { ed.settings.polarInc = Number(v); } },
  OSMODE: {
    desc: 'Running object snap modes (bit code; 16384 = off)', kind: 'int', min: 0, max: 32767,
    get: (ed) => OSMODE_BITS.reduce((a, [bit, k]) => a | (ed.settings.osnapModes.has(k) ? bit : 0), ed.settings.osnap ? 0 : 16384),
    set: (ed, v) => {
      const n = Number(v);
      ed.settings.osnapModes = new Set(OSMODE_BITS.filter(([bit]) => n & bit).map(([, k]) => k));
      ed.settings.osnap = !(n & 16384);
      ed.ui.onStatus();
    },
  },
  DYNMODE: { desc: 'Dynamic input on/off', kind: 'int', get: (ed) => (ed.settings.dyn ? 3 : 0), set: (ed, v) => { ed.settings.dyn = Number(v) !== 0; ed.ui.onStatus(); } },
  LTSCALE: { desc: 'Global linetype scale', kind: 'real', min: 1e-9, get: (ed) => ed.doc.header.ltscale, set: (ed, v) => { ed.doc.header.ltscale = Number(v); ed.redraw(); } },
  TEXTSIZE: { desc: 'Default text height', kind: 'real', min: 1e-9, get: (ed) => ed.doc.header.textsize, set: (ed, v) => { ed.doc.header.textsize = Number(v); } },
  PDMODE: { desc: 'Point display style', kind: 'int', min: 0, max: 100, get: (ed) => ed.doc.header.pdmode, set: (ed, v) => { ed.doc.header.pdmode = Number(v); ed.redraw(); } },
  PDSIZE: { desc: 'Point display size', kind: 'real', get: (ed) => ed.doc.header.pdsize, set: (ed, v) => { ed.doc.header.pdsize = Number(v); ed.redraw(); } },
  FILLETRAD: { desc: 'Fillet radius', kind: 'real', min: 0, get: (ed) => ed.doc.header.filletRad, set: (ed, v) => { ed.doc.header.filletRad = Number(v); } },
  OFFSETDIST: { desc: 'Default offset distance', kind: 'real', min: 0, get: (ed) => ed.doc.header.offsetDist, set: (ed, v) => { ed.doc.header.offsetDist = Number(v); } },
  MIRRTEXT: { desc: 'Mirror text (1) or keep it readable (0)', kind: 'bool', get: (ed) => (ed.doc.header.mirrtext ? 1 : 0), set: (ed, v) => { ed.doc.header.mirrtext = b(v); } },
  INSUNITS: { desc: 'Drawing units (4 = mm, 6 = m, 1 = inch)', kind: 'int', min: 0, max: 24, get: (ed) => ed.doc.header.insunits, set: (ed, v) => { ed.doc.header.insunits = Number(v); } },
  HPNAME: { desc: 'Default hatch pattern', kind: 'str', get: (ed) => ed.doc.header.hatchPattern, set: (ed, v) => { ed.doc.header.hatchPattern = String(v).toUpperCase(); } },
  HPSCALE: { desc: 'Default hatch scale', kind: 'real', min: 1e-9, get: (ed) => ed.doc.header.hatchScale, set: (ed, v) => { ed.doc.header.hatchScale = Number(v); } },
  HPANG: { desc: 'Default hatch angle', kind: 'real', get: (ed) => deg(ed.doc.header.hatchAngle), set: (ed, v) => { ed.doc.header.hatchAngle = rad(Number(v)); } },
  DIMSCALE: { desc: 'Overall dimension scale', kind: 'real', min: 1e-9, get: (ed) => ed.doc.dimStyle.dimscale, set: (ed, v) => { ed.doc.dimStyle.dimscale = Number(v); ed.doc.invalidateBoxes(); ed.redraw(); } },
  DIMTXT: { desc: 'Dimension text height', kind: 'real', min: 1e-9, get: (ed) => ed.doc.dimStyle.dimtxt, set: (ed, v) => { ed.doc.dimStyle.dimtxt = Number(v); ed.doc.invalidateBoxes(); ed.redraw(); } },
  DIMASZ: { desc: 'Dimension arrow size', kind: 'real', min: 0, get: (ed) => ed.doc.dimStyle.dimasz, set: (ed, v) => { ed.doc.dimStyle.dimasz = Number(v); ed.redraw(); } },
  DIMDEC: { desc: 'Dimension decimal places', kind: 'int', min: 0, max: 8, get: (ed) => ed.doc.dimStyle.dimdec, set: (ed, v) => { ed.doc.dimStyle.dimdec = Number(v); ed.redraw(); } },
  CLAYER: {
    desc: 'Current layer', kind: 'str', get: (ed) => ed.doc.currentLayer,
    set: (ed, v) => { const n = String(v); if (!ed.doc.layers.has(n)) return `Layer "${n}" not found.`; ed.doc.currentLayer = n; ed.doc.emit('layers'); },
  },
};

async function setvar(ed: Editor, name: string): Promise<void> {
  const sv = SYSVARS[name];
  if (!sv) { ed.print(`Unknown variable name "${name}".`, 'error'); return; }
  const cur = sv.get(ed);
  const t = (await ed.getText(`Enter new value for ${name} <${typeof cur === 'number' ? fmtNum(cur) : cur}>:`, { allowSpaces: sv.kind === 'str' })).trim();
  if (!t) return;
  if (sv.kind === 'str') { const err = sv.set(ed, t); if (err) ed.print(err, 'error'); return; }
  let v = parseFloat(t.replace(',', '.'));
  if (sv.kind === 'bool' && /^(on|off)$/i.test(t)) v = /^on$/i.test(t) ? 1 : 0;
  if (!Number.isFinite(v) || (sv.kind !== 'real' && !Number.isInteger(v))) { ed.print(sv.kind === 'real' ? 'Requires numeric value.' : 'Requires an integer value.', 'error'); return; }
  if ((sv.min !== undefined && v < sv.min) || (sv.max !== undefined && v > sv.max)) { ed.print(`Requires a value between ${sv.min ?? '-∞'} and ${sv.max ?? '∞'}.`, 'error'); return; }
  const err = sv.set(ed, v);
  if (err) ed.print(err, 'error');
}

export async function SETVAR(ed: Editor): Promise<void> {
  for (;;) {
    const n = (await ed.getText('Enter variable name or [?]:')).trim().toUpperCase();
    if (!n) return;
    if (n === '?') {
      for (const [k, sv] of Object.entries(SYSVARS)) ed.print(`  ${k.padEnd(12)} ${String(sv.get(ed)).padEnd(14)} ${sv.desc}`, 'list');
      continue;
    }
    await setvar(ed, n);
    return;
  }
}

export function installSysvars(ed: Editor): void {
  ed.isSysvar = (name) => Object.prototype.hasOwnProperty.call(SYSVARS, name.trim().toUpperCase());
}

// ---------------------------------------------------------------------------
// GRID / SNAP / DSETTINGS

export async function GRID(ed: Editor): Promise<void> {
  const r = ed.renderer;
  const t = (await ed.getText(`Specify grid spacing(X) or [ON/OFF/Snap/Major/aDaptive] <${fmtNum(r.gridStep)}>:`, { keywords: ['ON', 'OFF', 'Snap', 'Major', 'aDaptive'] })).trim();
  if (!t) return;
  switch (t) {
    case 'ON': ed.settings.grid = true; break;
    case 'OFF': ed.settings.grid = false; break;
    case 'Snap': r.gridStep = ed.settings.snapStep; ed.settings.grid = true; break;
    case 'Major': {
      const n = await ed.getNumber(`Specify the number of minor grid lines per major grid line <${r.gridMajor}>:`, { def: r.gridMajor, integer: true, min: 1 });
      r.gridMajor = n;
      break;
    }
    case 'aDaptive': ed.print('Adaptive grid is always on.'); break;
    default: {
      const v = parseFloat(t.replace(',', '.'));
      if (!(v > 0)) { ed.print('Requires a positive number.', 'error'); return; }
      r.gridStep = v;
      ed.settings.grid = true;
    }
  }
  ed.ui.onStatus();
  ed.redraw();
}

export async function SNAP(ed: Editor): Promise<void> {
  const s = ed.settings;
  const t = (await ed.getText(`Specify snap spacing or [ON/OFF/Aspect/Style/Type] <${fmtNum(s.snapStep)}>:`, { keywords: ['ON', 'OFF', 'Aspect', 'Style', 'Type'] })).trim();
  if (!t) return;
  if (t === 'ON') s.snap = true;
  else if (t === 'OFF') s.snap = false;
  else if (t === 'Aspect' || t === 'Style' || t === 'Type') { ed.print('Only rectangular grid snap with equal X/Y spacing is supported.'); return; }
  else {
    const v = parseFloat(t.replace(',', '.'));
    if (!(v > 0)) { ed.print('Requires a positive number.', 'error'); return; }
    s.snapStep = v;
    s.snap = true;
  }
  ed.ui.onStatus();
}

export async function DSETTINGS(ed: Editor): Promise<void> { ed.ui.draftingSettings(); }
export async function PLOT(ed: Editor): Promise<void> { await ed.ui.plot(); }
export async function DIMSTYLE(ed: Editor): Promise<void> { ed.ui.dimStyleManager(); }

// ---------------------------------------------------------------------------
// HATCHEDIT

export async function HATCHEDIT(ed: Editor): Promise<void> {
  let ids = ed.takePickfirst().filter((id) => ed.doc.get(id)?.type === 'hatch');
  if (!ids.length) {
    const r = await ed.getEntity('Select hatch object:', { filter: (e) => e.type === 'hatch' });
    if (r.kind !== 'entity') return;
    ids = [r.id];
  }
  const first = ed.doc.get(ids[0]) as HatchEnt;
  const o = await ed.ui.hatchOptions({ pattern: first.solid ? 'SOLID' : first.pattern.toUpperCase(), scale: first.scale, angle: first.angle, title: 'Hatch Edit' });
  if (!o) return;
  for (const id of ids) {
    const h = ed.doc.get(id) as HatchEnt | undefined;
    if (!h) continue;
    ed.doc.update({ ...h, pattern: o.pattern, solid: o.pattern === 'SOLID', scale: o.scale, angle: o.angle, patLines: undefined });
  }
  ed.print(`${ids.length} hatch object(s) updated.`);
}

// ---------------------------------------------------------------------------
// Block editor

const BLOCK_EDITOR_BG = '#353b44';

export async function BEDIT(ed: Editor): Promise<void> {
  if (ed.blockEdit) { ed.print(`Already editing block "${ed.blockEdit.name}". Use BCLOSE first.`); return; }
  const names = [...ed.doc.blocks.keys()].filter((n) => !n.startsWith('*')).sort();
  if (!names.length) { ed.print('This drawing has no blocks to edit.'); return; }
  let name = ed.macroQueue.length ? (await ed.getText('Enter block name:')).trim() : '';
  if (!name) name = (await ed.ui.chooseFromList('Edit Block Definition', names)) ?? '';
  if (!name) return;
  const blk = ed.doc.blocks.get(name) ?? ed.doc.blocks.get([...ed.doc.blocks.keys()].find((k) => k.toUpperCase() === name.toUpperCase()) ?? '');
  if (!blk) { ed.print(`Block "${name}" not found.`, 'error'); return; }
  // Block entities are shown with the base point at the origin, as in the Block Editor.
  const m = mxTranslate(-blk.base.x, -blk.base.y);
  const ents = new Map<number, Entity>();
  for (const e of blk.entities) {
    const t = entTransform(e, m);
    ents.set(t.id, t);
  }
  // The block editor works on the Model tab.
  if (ed.doc.layout && !ed.setLayout(null)) return;
  const v = ed.view;
  ed.clearSelection();
  const saved = ed.doc.swapSpace({ entities: ents, undo: [], redo: [] });
  ed.blockEdit = { name: blk.name, saved, viewState: { cx: v.cx, cy: v.cy, scale: v.scale } };
  ed.renderer.bg = BLOCK_EDITOR_BG;
  await ed.zoomExtents();
  ed.print(`Block Editor: "${blk.name}" (${ents.size} objects). Use BSAVE to save and BCLOSE to close.`);
  ed.ui.onStatus();
}

function saveBlock(ed: Editor): void {
  const be = ed.blockEdit!;
  const blk = ed.doc.blocks.get(be.name);
  if (!blk) return;
  blk.entities = [...ed.doc.entities.values()];
  blk.base = { x: 0, y: 0 };
  blk.box = undefined;
  ed.doc.invalidateBoxes();
  ed.doc.modified = true;
  be.saved.undo = [...be.saved.undo];
  ed.print(`Block "${be.name}" saved.`);
}

export async function BSAVE(ed: Editor): Promise<void> {
  if (!ed.blockEdit) { ed.print('BSAVE is only available in the Block Editor.'); return; }
  saveBlock(ed);
  // Mark as clean by starting a fresh undo history for the session.
  ed.doc.swapSpace({ entities: ed.doc.entities, undo: [], redo: [] });
}

export async function BCLOSE(ed: Editor): Promise<void> {
  const be = ed.blockEdit;
  if (!be) { ed.print('Not in the Block Editor.'); return; }
  if (ed.doc.canUndo) {
    const k = await ed.getKeyword(`Save changes to block "${be.name}"? [Save/Discard] <Save>:`, ['Save', 'Discard'], 'Save');
    if (k === 'Save') saveBlock(ed);
  }
  ed.clearSelection();
  ed.doc.swapSpace(be.saved);
  ed.blockEdit = null;
  ed.renderer.bg = '#212830';
  Object.assign(ed.view, be.viewState);
  ed.doc.invalidateBoxes();
  ed.redraw();
  ed.print('Block Editor closed.');
  ed.ui.onStatus();
}

/** Moves the block geometry so the picked point becomes the base point (0,0). */
export async function BASE(ed: Editor): Promise<void> {
  if (!ed.blockEdit) {
    const p = await ed.point('Enter base point <0.0000,0.0000>:', { allowNone: true });
    if (isPt(p)) ed.print(`Drawing insertion base set to ${fmtNum(p.x)},${fmtNum(p.y)}.`);
    return;
  }
  const p = await ed.point('Specify base point:');
  if (!isPt(p)) return;
  const m = mxTranslate(-p.x, -p.y);
  for (const e of [...ed.doc.entities.values()]) ed.doc.update(entTransform(e, m));
  await ed.zoomExtents();
}

// ---------------------------------------------------------------------------
// Selection tools

export async function SELECTSIMILAR(ed: Editor): Promise<void> {
  const ids = await ed.getSelection('Select objects');
  const refs = ids.map((id) => ed.doc.get(id)).filter((e): e is Entity => !!e);
  if (!refs.length) return;
  const key = (e: Entity) => `${e.type}|${e.layer}|${e.type === 'insert' ? e.name : ''}`;
  const keys = new Set(refs.map(key));
  const out = [...ed.doc.entities.values()].filter((e) => ed.doc.isVisible(e) && keys.has(key(e))).map((e) => e.id);
  ed.selectIds(out);
  ed.print(`${out.length} similar object(s) selected.`);
}

export async function ADDSELECTED(ed: Editor): Promise<void> {
  const pf = ed.takePickfirst();
  const src = pf.length ? ed.doc.get(pf[0]) : undefined;
  const r = src ? null : await ed.getEntity('Select object:');
  const e = src ?? (r && r.kind === 'entity' ? ed.doc.get(r.id) : undefined);
  if (!e) return;
  ed.doc.currentLayer = e.layer;
  ed.doc.currentColor = e.color;
  ed.doc.currentLtype = e.ltype;
  ed.ui.onStatus();
  const cmd: Record<string, string> = {
    line: 'LINE', circle: 'CIRCLE', arc: 'ARC', polyline: 'PLINE', ellipse: 'ELLIPSE', spline: 'SPLINE', point: 'POINT',
    text: 'TEXT', mtext: 'MTEXT', hatch: 'HATCH', dimension: 'DIMLINEAR', insert: 'INSERT', solid: 'PLINE',
  };
  if (e.type === 'hatch') { ed.doc.header.hatchPattern = e.solid ? 'SOLID' : e.pattern; ed.doc.header.hatchScale = e.scale; ed.doc.header.hatchAngle = e.angle; }
  queueMicrotask(() => void ed.runCommand(cmd[e.type]));
}

export async function QSELECT(ed: Editor): Promise<void> {
  const ids = await ed.ui.quickSelect();
  if (ids) { ed.selectIds(ids); ed.print(`${ids.length} item(s) selected.`); }
}

export async function PASTEORIG(ed: Editor): Promise<void> {
  const cb = ed.clipboard;
  if (!cb) { ed.print('Clipboard is empty.'); return; }
  ed.selectIds(cb.ents.map((e) => ed.doc.add(e).id));
}

export async function PASTEBLOCK(ed: Editor): Promise<void> {
  const cb = ed.clipboard;
  if (!cb) { ed.print('Clipboard is empty.'); return; }
  let n = 1;
  while (ed.doc.blocks.has(`A$C${n}`)) n++;
  const name = `A$C${n}`;
  ed.doc.touchBlocks();
  ed.doc.blocks.set(name, { name, base: cb.base, entities: cb.ents.map((e) => ({ ...e, id: ed.doc.allocId() }) as Entity) });
  const p = await ed.point('Specify insertion point:', { preview: (q) => [{ type: 'insert', name, p: q, sx: 1, sy: 1, rot: 0, attribs: [] }] });
  if (!isPt(p)) return;
  ed.doc.add({ type: 'insert', name, p, sx: 1, sy: 1, rot: 0, attribs: [] });
}

export async function DRAWORDER(ed: Editor): Promise<void> {
  const ids = await ed.getSelection();
  if (!ids.length) return;
  const k = await ed.getKeyword('Enter object ordering option [Above objects/Under objects/Front/Back] <Back>:', ['Above objects', 'Under objects', 'Front', 'Back'], 'Back');
  ed.doc.reorder(ids, k === 'Front' || k === 'Above objects');
}

export function selectionBox(ed: Editor, ids: number[]) {
  let bx = emptyBox();
  for (const id of ids) { const e = ed.doc.get(id); if (e) bx = boxUnion(bx, ed.doc.box(e)); }
  return boxValid(bx) ? bx : null;
}

export { stripId };

// Layout (paper space) commands: LAYOUT, MVIEW, MSPACE, PSPACE, PAGESETUP.

import { type Vec, fmtNum } from '../../core/geom.ts';
import type { Entity, ViewportEnt } from '../../core/entities.ts';
import { MODEL, type Layout } from '../../core/document.ts';
import type { Editor } from '../editor.ts';

const isPt = (x: unknown): x is Vec => typeof x === 'object' && x !== null && 'x' in x;
const INVALID_LAYOUT = /[<>/\\":;?*|=`]/;

/** Layout commands only work on a layout tab; leaves model space of an active viewport first. */
function needLayout(ed: Editor, name: string): Layout | null {
  const l = ed.doc.layout;
  if (!l) { ed.print(`** ${name} is not allowed in the Model tab **`, 'error'); return null; }
  if (ed.activeVp !== null) {
    ed.exitViewport();
    ed.doc.begin(name);
  }
  return l;
}

function validLayoutName(ed: Editor, name: string, except?: Layout): boolean {
  if (!name || INVALID_LAYOUT.test(name) || name.length > 255) { ed.print('Invalid layout name.', 'error'); return false; }
  const other = ed.doc.layoutByName(name);
  if (name.toUpperCase() === MODEL.toUpperCase() || (other && other !== except)) { ed.print(`Layout "${name}" already exists.`, 'error'); return false; }
  return true;
}

async function askLayout(ed: Editor, msg: string): Promise<Layout | null> {
  const cur = ed.doc.layout ?? ed.doc.layouts[0];
  const t = (await ed.getText(`${msg} <${cur?.name ?? ''}>:`, { allowSpaces: true })).trim();
  const l = t ? ed.doc.layoutByName(t) : cur;
  if (!l) ed.print(`Layout "${t}" not found.`, 'error');
  return l ?? null;
}

export async function LAYOUT(ed: Editor): Promise<void> {
  const d = ed.doc;
  const kw = await ed.getKeyword('Enter layout option [Copy/Delete/New/Rename/Set/?] <set>:', ['Copy', 'Delete', 'New', 'Rename', 'Set', '?'], 'Set');
  switch (kw) {
    case 'New': {
      const def = d.uniqueLayoutName();
      const name = (await ed.getText(`Enter name of new layout <${def}>:`, { allowSpaces: true })).trim() || def;
      if (!validLayoutName(ed, name)) return;
      d.addLayout(name);
      ed.ui.onSpace();
      ed.print(`Layout "${name}" created.`);
      return;
    }
    case 'Copy': {
      const src = await askLayout(ed, 'Enter name of layout to copy');
      if (!src) return;
      const def = `${src.name} (2)`;
      const name = (await ed.getText(`Enter layout name for copy <${def}>:`, { allowSpaces: true })).trim() || def;
      if (!validLayoutName(ed, name)) return;
      copyLayout(ed, src, name);
      ed.ui.onSpace();
      ed.print(`Layout "${src.name}" copied to "${name}".`);
      return;
    }
    case 'Delete': {
      const l = await askLayout(ed, 'Enter name of layout to delete');
      if (l) deleteLayout(ed, l);
      return;
    }
    case 'Rename': {
      const l = await askLayout(ed, 'Enter layout to rename');
      if (!l) return;
      const name = (await ed.getText(`Enter new layout name <${l.name}>:`, { allowSpaces: true })).trim();
      if (!name || name === l.name) return;
      renameLayout(ed, l, name);
      return;
    }
    case '?':
      ed.print(`Layouts: ${[MODEL, ...d.layouts.map((l) => l.name)].join(', ')}`, 'list');
      return;
    default: {
      const t = (await ed.getText(`Enter layout to make current <${d.layout?.name ?? MODEL}>:`, { allowSpaces: true })).trim();
      if (!t) return;
      if (t.toUpperCase() === MODEL.toUpperCase()) { ed.setLayout(null); return; }
      const l = d.layoutByName(t);
      if (!l) { ed.print(`Layout "${t}" not found.`, 'error'); return; }
      ed.setLayout(l);
    }
  }
}

export function copyLayout(ed: Editor, src: Layout, name: string): Layout {
  const d = ed.doc;
  const l = d.addLayout(name, { ...src.paper, margins: [...src.paper.margins] });
  l.initialized = true;
  l.plot = src.plot ? { ...src.plot } : undefined;
  l.view = src.view ?? (src === d.layout ? { cx: ed.view.cx, cy: ed.view.cy, scale: ed.view.scale } : undefined);
  const into = d.paperEntities(l);
  for (const e of d.paperEntities(src).values()) {
    const { id: _id, ...rest } = e as Entity;
    d.loadInto(into, structuredClone(rest) as Parameters<typeof d.loadInto>[1]);
  }
  // Keep the tab right after its source, like AutoCAD's Move or Copy.
  d.layouts = d.layouts.filter((x) => x !== l);
  d.layouts.splice(d.layouts.indexOf(src) + 1, 0, l);
  return l;
}

export function deleteLayout(ed: Editor, l: Layout): void {
  const d = ed.doc;
  if (d.layouts.length <= 1) { ed.print('A drawing must have at least one layout.', 'error'); return; }
  if (l === d.layout) {
    const i = d.layouts.indexOf(l);
    if (!ed.setLayout(d.layouts[i + 1] ?? d.layouts[i - 1])) return;
  }
  d.deleteLayout(l);
  ed.ui.onSpace();
  ed.print(`Layout "${l.name}" deleted.`);
}

export function renameLayout(ed: Editor, l: Layout, name: string): void {
  if (!validLayoutName(ed, name, l)) return;
  const old = l.name;
  l.name = name;
  ed.doc.modified = true;
  ed.ui.onSpace();
  ed.print(`Layout "${old}" renamed to "${name}".`);
}

export async function MSPACE(ed: Editor): Promise<void> {
  const l = ed.doc.layout;
  if (!l) { ed.print('** Command not allowed in Model Tab **', 'error'); return; }
  if (ed.activeVp !== null) { ed.print('Already in model space.'); return; }
  const vps = [...ed.doc.entities.values()].filter((e): e is ViewportEnt => e.type === 'viewport' && !e.off && ed.doc.isVisible(e));
  if (!vps.length) { ed.print('There are no active model space viewports. Create one with MVIEW.', 'error'); return; }
  const sel = [...ed.selection].map((id) => ed.doc.get(id)).find((e) => e?.type === 'viewport');
  ed.enterViewport((sel ?? vps[0]).id);
}

export async function PSPACE(ed: Editor): Promise<void> {
  if (!ed.doc.layout) { ed.print('** Command not allowed in Model Tab **', 'error'); return; }
  if (ed.activeVp === null) { ed.print('Already in paper space.'); return; }
  ed.exitViewport();
}

/** Printable area of a layout in paper units. */
function printable(l: Layout): { a: Vec; b: Vec } {
  const P = l.paper, [ml, mb, mr, mt] = P.margins;
  return { a: { x: 0, y: 0 }, b: { x: P.w - ml - mr, y: P.h - mb - mt } };
}

const rect = (a: Vec, b: Vec) => ({ type: 'polyline' as const, pts: [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }], bulges: [0, 0, 0, 0], closed: true });

export async function MVIEW(ed: Editor): Promise<void> {
  const l = needLayout(ed, 'MVIEW');
  if (!l) return;
  const d = ed.doc;
  const r = await ed.getPoint('Specify corner of viewport or [ON/OFF/Fit/Lock/2/4] <Fit>:', { keywords: ['ON', 'OFF', 'Fit', 'Lock', '2', '4'], allowNone: true });
  const area = async (): Promise<{ a: Vec; b: Vec } | null> => {
    const p = await ed.getPoint('Specify first corner or [Fit] <Fit>:', { keywords: ['Fit'], allowNone: true });
    if (p.kind !== 'point') return printable(l);
    const q = await ed.point('Specify opposite corner:', { preview: (x) => [rect(p.p, x)] });
    return isPt(q) ? { a: p.p, b: q } : null;
  };
  const add = (a: Vec, b: Vec) => d.add(ed.newViewport({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) }, { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) }));
  if (r.kind === 'point') {
    const q = await ed.point('Specify opposite corner:', { preview: (x) => [rect(r.p, x)] });
    if (!isPt(q)) return;
    if (Math.abs(q.x - r.p.x) < 1e-6 || Math.abs(q.y - r.p.y) < 1e-6) { ed.print('Viewport has zero size.', 'error'); return; }
    add(r.p, q);
    return;
  }
  const kw = r.kind === 'keyword' ? r.kw : 'Fit';
  if (kw === 'Fit') { const p = printable(l); add(p.a, p.b); return; }
  if (kw === 'ON' || kw === 'OFF' || kw === 'Lock') {
    let lock = false;
    if (kw === 'Lock') lock = (await ed.getKeyword('Viewport View Locking [ON/OFF]:', ['ON', 'OFF'])) === 'ON';
    const ids = await ed.getSelection('Select objects');
    let n = 0;
    for (const id of ids) {
      const e = d.get(id);
      if (e?.type !== 'viewport') continue;
      d.update(kw === 'Lock' ? { ...e, locked: lock || undefined } : { ...e, off: kw === 'OFF' || undefined });
      n++;
    }
    ed.print(`${n} viewport(s) ${kw === 'Lock' ? (lock ? 'locked' : 'unlocked') : kw === 'ON' ? 'turned on' : 'turned off'}.`);
    return;
  }
  if (kw === '2') {
    const dir = await ed.getKeyword('Enter viewport arrangement [Horizontal/Vertical] <Vertical>:', ['Horizontal', 'Vertical'], 'Vertical');
    const ar = await area();
    if (!ar) return;
    const x0 = Math.min(ar.a.x, ar.b.x), y0 = Math.min(ar.a.y, ar.b.y), x1 = Math.max(ar.a.x, ar.b.x), y1 = Math.max(ar.a.y, ar.b.y);
    if (dir === 'Vertical') { const xm = (x0 + x1) / 2; add({ x: x0, y: y0 }, { x: xm, y: y1 }); add({ x: xm, y: y0 }, { x: x1, y: y1 }); }
    else { const ym = (y0 + y1) / 2; add({ x: x0, y: ym }, { x: x1, y: y1 }); add({ x: x0, y: y0 }, { x: x1, y: ym }); }
    return;
  }
  const ar = await area();
  if (!ar) return;
  const x0 = Math.min(ar.a.x, ar.b.x), y0 = Math.min(ar.a.y, ar.b.y), x1 = Math.max(ar.a.x, ar.b.x), y1 = Math.max(ar.a.y, ar.b.y);
  const xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
  for (const [a, b] of [[{ x: x0, y: ym }, { x: xm, y: y1 }], [{ x: xm, y: ym }, { x: x1, y: y1 }], [{ x: x0, y: y0 }, { x: xm, y: ym }], [{ x: xm, y: y0 }, { x: x1, y: ym }]] as [Vec, Vec][]) add(a, b);
}

export async function PAGESETUP(ed: Editor): Promise<void> {
  const l = ed.doc.layout;
  if (!l) { ed.print('Page setup applies to layouts; switch to a layout tab first.', 'error'); return; }
  await ed.ui.pageSetup(l);
}

/** Standard viewport scales (paper : model). */
export const VP_SCALES: [string, number][] = [
  ['1:1', 1], ['1:2', 1 / 2], ['1:5', 1 / 5], ['1:10', 1 / 10], ['1:20', 1 / 20], ['1:25', 1 / 25], ['1:50', 1 / 50],
  ['1:100', 1 / 100], ['1:200', 1 / 200], ['1:250', 1 / 250], ['1:500', 1 / 500], ['1:1000', 1 / 1000], ['1:2000', 1 / 2000], ['1:5000', 1 / 5000],
  ['2:1', 2], ['5:1', 5], ['10:1', 10],
];

/** "1:50" for standard scales, otherwise "1:57.3" / "2.4:1". */
export function scaleLabel(k: number): string {
  const std = VP_SCALES.find(([, v]) => Math.abs(v - k) <= 1e-6 * v);
  if (std) return std[0];
  return k >= 1 ? `${fmtNum(k)}:1` : `1:${fmtNum(1 / k)}`;
}

/** Parses "1:50", "1/50", "50" (= 1:50) or "2:1" into paper units per model unit. */
export function parseScale(s: string): number | null {
  const t = s.trim().replace(/,/g, '.');
  const m = /^([\d.]+)\s*[:/]\s*([\d.]+)$/.exec(t);
  if (m) { const a = parseFloat(m[1]), b = parseFloat(m[2]); return a > 0 && b > 0 ? a / b : null; }
  const n = parseFloat(t);
  return n > 0 ? 1 / n : null;
}

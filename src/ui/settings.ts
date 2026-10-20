// Drafting Settings, Dimension Style Manager and Quick Select dialogs.

import type { Editor } from '../app/editor.ts';
import { ALL_SNAPS, SNAP_LABELS } from '../app/snap.ts';
import { Drawing } from '../core/document.ts';
import { ENT_NAMES, type Entity, type EntityType } from '../core/entities.ts';
import { colorName } from '../core/aci.ts';
import { Viewport } from '../view/viewport.ts';
import { h } from './dom.ts';

function modal(title: string, cls: string): { body: HTMLElement; footer: HTMLElement; close: () => void; onClose: (fn: () => void) => void } {
  const back = h('div', { class: 'modal-back' });
  const win = h('div', { class: `modal ${cls}` });
  const x = h('button', { class: 'modal-x', html: '&times;' });
  const head = h('div', { class: 'modal-head' }, h('span', {}, title), x);
  const body = h('div', { class: 'modal-body' });
  const footer = h('div', { class: 'modal-foot' });
  win.append(head, body, footer);
  back.append(win);
  document.body.append(back);
  const closers: (() => void)[] = [];
  const close = () => back.remove();
  x.addEventListener('click', () => { close(); for (const c of closers) c(); });
  return { body, footer, close, onClose: (fn) => closers.push(fn) };
}

const btn = (label: string, primary = false) => h('button', { class: 'btn' + (primary ? ' primary' : '') }, label);
const check = (label: string, on: boolean) => {
  const inp = h('input', { type: 'checkbox' }) as HTMLInputElement;
  inp.checked = on;
  return { el: h('label', { class: 'chk' }, inp, h('span', {}, label)), inp };
};
const num = (value: number, step = 'any') => {
  const inp = h('input', { class: 'inp', type: 'number', step, value: String(+value.toFixed(6)) }) as HTMLInputElement;
  return inp;
};
const row = (label: string, el: HTMLElement) => h('div', { class: 'form-grid-row' }, h('span', {}, label), el);

// ---------------------------------------------------------------------------
// Drafting Settings (DSETTINGS)

export function draftingSettings(ed: Editor, onApply: () => void, tab = 0): void {
  const m = modal('Drafting Settings', 'ds-dlg');
  const s = ed.settings, r = ed.renderer;
  const tabs = ['Snap and Grid', 'Polar Tracking', 'Object Snap', 'Dynamic Input', 'Selection'];
  const strip = h('div', { class: 'dlg-tabs' });
  const pages: HTMLElement[] = tabs.map(() => h('div', { class: 'dlg-page' }));
  tabs.forEach((t, i) => {
    const el = h('div', { class: 'dlg-tab' }, t);
    el.addEventListener('click', () => show(i));
    strip.append(el);
  });
  const show = (i: number) => {
    [...strip.children].forEach((c, k) => c.classList.toggle('active', k === i));
    pages.forEach((p, k) => (p.hidden = k !== i));
  };

  // Snap and Grid
  const snapOn = check('Snap On (F9)', s.snap), gridOn = check('Grid On (F7)', s.grid);
  const snapX = num(s.snapStep), gridX = num(r.gridStep), major = num(r.gridMajor, '1');
  pages[0].append(h('div', { class: 'ds-cols' },
    h('fieldset', {}, h('legend', {}, 'Snap'), snapOn.el, row('Snap X/Y spacing', snapX)),
    h('fieldset', {}, h('legend', {}, 'Grid'), gridOn.el, row('Grid X/Y spacing', gridX), row('Major line every', major), h('div', { class: 'ds-note' }, 'Adaptive grid: lines merge when zoomed out.')),
  ));

  // Polar
  const polarOn = check('Polar Tracking On (F10)', s.polar);
  const inc = h('select', { class: 'inp' }) as HTMLSelectElement;
  for (const a of [90, 60, 45, 30, 22.5, 18, 15, 10, 5]) inc.append(h('option', { value: String(a), selected: a === s.polarInc }, String(a)));
  const orthoOn = check('Ortho Mode (F8)', s.ortho);
  pages[1].append(polarOn.el, row('Increment angle', inc), orthoOn.el, h('div', { class: 'ds-note' }, 'Ortho and polar tracking cannot be on at the same time.'));

  // Object snap
  const osOn = check('Object Snap On (F3)', s.osnap);
  const otOn = check('Object Snap Tracking On (F11)', s.otrack);
  const boxes = new Map<string, HTMLInputElement>();
  const grid = h('div', { class: 'os-grid' });
  for (const k of ALL_SNAPS) {
    const c = check(SNAP_LABELS[k], s.osnapModes.has(k));
    boxes.set(k, c.inp);
    grid.append(c.el);
  }
  const all = btn('Select All'), clear = btn('Clear All');
  all.addEventListener('click', () => boxes.forEach((b) => (b.checked = true)));
  clear.addEventListener('click', () => boxes.forEach((b) => (b.checked = false)));
  pages[2].append(h('div', { class: 'ds-cols' }, osOn.el, otOn.el), h('fieldset', {}, h('legend', {}, 'Object Snap modes'), grid, h('div', { class: 'ds-btns' }, all, clear)),
    h('div', { class: 'ds-note' }, 'Tracking: pause over a snap point to acquire it (+), then move horizontally or vertically to follow the dashed alignment path.'));

  // Dynamic input
  const dynOn = check('Enable Pointer Input (F12)', s.dyn);
  pages[3].append(dynOn.el, h('div', { class: 'ds-note' }, 'Shows the prompt and typed values next to the crosshair.'));

  // Selection
  const cursor = h('input', { type: 'range', min: '1', max: '100', value: String(r.cursorSize) }) as HTMLInputElement;
  const cursorVal = h('span', { class: 'ds-val' }, String(r.cursorSize));
  cursor.addEventListener('input', () => (cursorVal.textContent = cursor.value));
  const ap = h('input', { type: 'range', min: '2', max: '30', value: String(s.aperture) }) as HTMLInputElement;
  const apVal = h('span', { class: 'ds-val' }, String(s.aperture));
  ap.addEventListener('input', () => (apVal.textContent = ap.value));
  pages[4].append(row('Crosshair size (CURSORSIZE)', h('div', { class: 'ds-range' }, cursor, cursorVal)), row('Aperture size (APERTURE)', h('div', { class: 'ds-range' }, ap, apVal)));

  m.body.append(strip, ...pages);
  show(tab);
  const ok = btn('OK', true), cancel = btn('Cancel');
  ok.addEventListener('click', () => {
    s.snap = snapOn.inp.checked;
    s.snapStep = +snapX.value > 0 ? +snapX.value : s.snapStep;
    s.grid = gridOn.inp.checked;
    r.gridStep = +gridX.value > 0 ? +gridX.value : r.gridStep;
    r.gridMajor = Math.max(1, Math.round(+major.value) || r.gridMajor);
    s.polar = polarOn.inp.checked;
    s.polarInc = +inc.value;
    s.ortho = orthoOn.inp.checked && !s.polar;
    s.osnap = osOn.inp.checked;
    s.otrack = otOn.inp.checked;
    s.osnapModes = new Set([...boxes].filter(([, b]) => b.checked).map(([k]) => k as typeof ALL_SNAPS[number]));
    s.dyn = dynOn.inp.checked;
    r.cursorSize = +cursor.value;
    s.aperture = +ap.value;
    m.close();
    onApply();
  });
  cancel.addEventListener('click', m.close);
  m.footer.append(ok, cancel);
}

// ---------------------------------------------------------------------------
// Dimension Style Manager (DIMSTYLE)

export function dimStyleManager(ed: Editor, onApply: () => void): void {
  const m = modal('Dimension Style Manager — Standard', 'dim-dlg');
  const ds = { ...ed.doc.dimStyle };
  const preview = h('canvas', { class: 'dim-preview', width: 300, height: 220 }) as HTMLCanvasElement;
  const fields: [keyof typeof ds, string, string][] = [
    ['dimtxt', 'Text height', 'any'], ['dimasz', 'Arrow size', 'any'], ['dimgap', 'Offset from dim line', 'any'],
    ['dimexe', 'Extend beyond dim lines', 'any'], ['dimexo', 'Offset from origin', 'any'], ['dimdec', 'Precision (decimals)', '1'],
    ['dimadec', 'Angular precision', '1'], ['dimscale', 'Use overall scale of', 'any'],
  ];
  const form = h('div', { class: 'dim-form' });
  const draw = () => drawDimPreview(ed, preview, ds);
  for (const [k, label, step] of fields) {
    const inp = num(ds[k] as number, step);
    inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (Number.isFinite(v) && v >= 0) { (ds[k] as number) = v; draw(); } });
    form.append(row(label, inp));
  }
  const sep = h('select', { class: 'inp' }) as HTMLSelectElement;
  for (const [v, l] of [[',', "',' (Comma)"], ['.', "'.' (Period)"]]) sep.append(h('option', { value: v, selected: ds.dimdsep === v }, l));
  sep.addEventListener('change', () => { ds.dimdsep = sep.value; draw(); });
  form.append(row('Decimal separator', sep));
  m.body.append(h('div', { class: 'dim-wrap' }, form, h('div', { class: 'dim-prev-wrap' }, h('div', { class: 'ds-note' }, 'Preview of: Standard'), preview)));
  draw();
  const ok = btn('OK', true), cancel = btn('Cancel');
  ok.addEventListener('click', () => {
    ed.doc.dimStyle = { ...ds, dimdec: Math.round(ds.dimdec), dimadec: Math.round(ds.dimadec) };
    // Regenerate dimension geometry (imported dims keep their own blocks unless edited).
    ed.doc.invalidateBoxes();
    ed.doc.modified = true;
    m.close();
    onApply();
  });
  cancel.addEventListener('click', m.close);
  m.footer.append(ok, cancel);
}

function drawDimPreview(ed: Editor, canvas: HTMLCanvasElement, ds: Drawing['dimStyle']): void {
  const d = new Drawing();
  d.dimStyle = { ...ds };
  d.begin('p');
  d.add({ type: 'polyline', pts: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 25 }, { x: 0, y: 25 }], bulges: [0, 0, 0, 0], closed: true, color: 7 });
  d.add({ type: 'circle', c: { x: 20, y: 12.5 }, r: 6, color: 7 });
  d.add({ type: 'dimension', dimType: 'linear', p1: { x: 0, y: 0 }, p2: { x: 40, y: 0 }, loc: { x: 20, y: -10 }, rot: 0, color: 3 });
  d.add({ type: 'dimension', dimType: 'linear', p1: { x: 40, y: 0 }, p2: { x: 40, y: 25 }, loc: { x: 50, y: 12 }, rot: Math.PI / 2, color: 3 });
  d.add({ type: 'dimension', dimType: 'radius', p1: { x: 20, y: 12.5 }, p2: { x: 24.24, y: 16.74 }, loc: { x: 32, y: 30 }, rot: 0, color: 3 });
  d.add({ type: 'dimension', dimType: 'angular', p1: { x: 0, y: 25 }, p2: { x: 15, y: 25 }, p3: { x: 0, y: 10 }, loc: { x: 8, y: 18 }, rot: 0, color: 3 });
  d.commit();
  const v = new Viewport();
  v.resize(canvas.width, canvas.height);
  v.fit({ minX: -8, minY: -18, maxX: 60, maxY: 36 }, 0.02);
  ed.renderer.plotTo(canvas, d, v, { mono: false, lineWidthPx: 1 });
}

// ---------------------------------------------------------------------------
// Quick Select (QSELECT)

export function quickSelect(ed: Editor): Promise<number[] | null> {
  return new Promise((resolve) => {
    const m = modal('Quick Select', 'qs-dlg');
    const ents = [...ed.doc.entities.values()].filter((e) => ed.doc.isVisible(e));
    const types = [...new Set(ents.map((e) => e.type))] as EntityType[];
    const type = h('select', { class: 'inp' }) as HTMLSelectElement;
    type.append(h('option', { value: '*' }, 'Multiple'));
    for (const t of types) type.append(h('option', { value: t }, ENT_NAMES[t]));
    const prop = h('select', { class: 'inp' }) as HTMLSelectElement;
    for (const [v, l] of [['layer', 'Layer'], ['color', 'Color'], ['ltype', 'Linetype'], ['name', 'Block name']]) prop.append(h('option', { value: v }, l));
    const op = h('select', { class: 'inp' }) as HTMLSelectElement;
    for (const [v, l] of [['=', '= Equals'], ['!=', '<> Not Equal'], ['*', 'Select All']]) op.append(h('option', { value: v }, l));
    const value = h('select', { class: 'inp' }) as HTMLSelectElement;
    const valOf = (e: Entity, p: string): string => p === 'layer' ? e.layer : p === 'color' ? colorName(e.color) : p === 'ltype' ? e.ltype : e.type === 'insert' ? e.name : '';
    const fillValues = () => {
      value.innerHTML = '';
      const pool = ents.filter((e) => type.value === '*' || e.type === type.value);
      for (const v of [...new Set(pool.map((e) => valOf(e, prop.value)))].filter(Boolean).sort()) value.append(h('option', { value: v }, v));
    };
    type.addEventListener('change', fillValues);
    prop.addEventListener('change', fillValues);
    fillValues();
    const inSel = check('Append to current selection set', false);
    m.body.append(row('Object type', type), row('Properties', prop), row('Operator', op), row('Value', value), inSel.el);
    const ok = btn('OK', true), cancel = btn('Cancel');
    ok.addEventListener('click', () => {
      const out = ents.filter((e) => (type.value === '*' || e.type === type.value) && (op.value === '*' || (op.value === '=' ? valOf(e, prop.value) === value.value : valOf(e, prop.value) !== value.value))).map((e) => e.id);
      m.close();
      resolve(inSel.inp.checked ? [...new Set([...ed.selection, ...out])] : out);
    });
    cancel.addEventListener('click', () => { m.close(); resolve(null); });
    m.onClose(() => resolve(null));
    m.footer.append(ok, cancel);
  });
}

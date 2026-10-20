// Page Setup for a layout: paper size, orientation and non-printable margins (mm).

import type { Editor } from '../app/editor.ts';
import { type Layout, type PaperSetup, PAPER_SIZES } from '../core/document.ts';
import { h } from './dom.ts';
import { modal, button } from './dialogs.ts';

export function pageSetupDialog(ed: Editor, l: Layout): Promise<void> {
  return new Promise((resolve) => {
    const m = modal(`Page Setup - ${l.name}`, 'pagesetup-dlg');
    const p = l.paper;
    const std = PAPER_SIZES.find((s) => (Math.abs(s.w - p.w) < 0.01 && Math.abs(s.h - p.h) < 0.01) || (Math.abs(s.w - p.h) < 0.01 && Math.abs(s.h - p.w) < 0.01));
    const size = h('select', { class: 'inp' }) as HTMLSelectElement;
    for (const s of PAPER_SIZES) size.append(h('option', { value: s.name, selected: s === std }, s.name));
    size.append(h('option', { value: 'custom', selected: !std }, 'Custom'));
    const orient = h('select', { class: 'inp' }) as HTMLSelectElement;
    orient.append(h('option', { value: 'L', selected: p.w >= p.h }, 'Landscape'), h('option', { value: 'P', selected: p.w < p.h }, 'Portrait'));
    const num = (v: number) => h('input', { class: 'inp', type: 'number', step: 'any', min: '0', value: String(+v.toFixed(3)) }) as HTMLInputElement;
    const w = num(p.w), hh = num(p.h);
    const mg = p.margins.map(num);
    const row = (label: string, ...els: HTMLElement[]) => h('div', { class: 'form-grid-row' }, h('span', {}, label), h('div', { class: 'ps-inline' }, ...els));
    const sync = () => {
      const s = PAPER_SIZES.find((x) => x.name === size.value);
      const custom = !s;
      w.disabled = hh.disabled = !custom;
      if (s) {
        const land = orient.value === 'L';
        w.value = String(land ? Math.max(s.w, s.h) : Math.min(s.w, s.h));
        hh.value = String(land ? Math.min(s.w, s.h) : Math.max(s.w, s.h));
      }
    };
    size.addEventListener('change', sync);
    orient.addEventListener('change', () => {
      if (size.value === 'custom') { const a = w.value; w.value = hh.value; hh.value = a; } else sync();
    });
    sync();
    m.body.append(
      h('fieldset', {}, h('legend', {}, 'Paper size'), size, row('Drawing orientation', orient), row('Width x Height (mm)', w, h('span', {}, 'x'), hh)),
      h('fieldset', {}, h('legend', {}, 'Non-printable margins (mm)'), row('Left / Bottom', mg[0], mg[1]), row('Right / Top', mg[2], mg[3])),
      h('div', { class: 'ds-note' }, 'The lower-left corner of the printable area is the paper space origin (0,0). Layouts are plotted at 1:1.'),
    );
    for (const el of [w, hh, ...mg]) el.addEventListener('keydown', (ev) => ev.stopPropagation());
    const ok = button('OK', true), cancel = button('Cancel');
    const done = () => { m.close(); resolve(); };
    ok.addEventListener('click', () => {
      const W = parseFloat(w.value), H = parseFloat(hh.value);
      const M = mg.map((i) => Math.max(0, parseFloat(i.value) || 0)) as PaperSetup['margins'];
      if (!(W > 0 && H > 0) || M[0] + M[2] >= W || M[1] + M[3] >= H) { ed.print('Invalid paper size or margins.', 'error'); return; }
      const name = size.value === 'custom' ? `Custom (${+W.toFixed(2)} x ${+H.toFixed(2)} MM)` : size.value;
      l.paper = { name, w: W, h: H, margins: M };
      // Plot settings read from the file no longer match the sheet.
      l.plot = undefined;
      ed.doc.modified = true;
      if (ed.doc.layout === l && ed.activeVp === null) ed.fitPaper(l);
      ed.redraw();
      ed.ui.onSpace();
      ed.print(`Layout "${l.name}": ${name}, ${W >= H ? 'landscape' : 'portrait'}.`);
      done();
    });
    cancel.addEventListener('click', done);
    m.root.querySelector('.modal-x')!.addEventListener('click', () => resolve());
    m.footer.append(ok, cancel);
  });
}

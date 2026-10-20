// "Save Drawing As" dialog: file name and file type (DWG versions need the local converter).

import { SAVE_FORMATS, type SaveFormat, type ConverterStatus } from '../io/convert.ts';
import { h } from './dom.ts';

export function saveAsDialog(name: string, current: SaveFormat, st: ConverterStatus): Promise<{ name: string; fmt: SaveFormat } | null> {
  return new Promise((resolve) => {
    const back = h('div', { class: 'modal-back' });
    const win = h('div', { class: 'modal saveas-dlg' });
    const x = h('button', { class: 'modal-x', html: '&times;' });
    const body = h('div', { class: 'modal-body' });
    const foot = h('div', { class: 'modal-foot' });
    win.append(h('div', { class: 'modal-head' }, h('span', {}, 'Save Drawing As'), x), body, foot);
    back.append(win);
    document.body.append(back);
    const done = (v: { name: string; fmt: SaveFormat } | null) => { back.remove(); resolve(v); };
    x.addEventListener('click', () => done(null));

    const base = name.replace(/\.(dwg|dxf)$/i, '');
    const nameIn = h('input', { class: 'inp', value: base }) as HTMLInputElement;
    const type = h('select', { class: 'inp' }) as HTMLSelectElement;
    for (const f of SAVE_FORMATS) {
      const usable = f.native || st.available;
      type.append(h('option', { value: f.id, selected: f.id === (usable ? current.id : 'dxf2000'), disabled: !usable }, f.label + (usable ? '' : '  — needs converter')));
    }
    const note = h('div', { class: 'ds-note' });
    const ext = h('span', { class: 'saveas-ext' });
    const sync = () => {
      const f = SAVE_FORMATS.find((s) => s.id === type.value)!;
      ext.textContent = '.' + f.ext;
      note.textContent = f.native
        ? 'Written directly by CraftCAD.'
        : st.available ? `Converted locally with ${st.engine}.`
        : 'DWG needs ODA File Converter (free, opendesign.com) on this computer, with CraftCAD started by "npm run dev" or "npm run serve".';
    };
    type.addEventListener('change', sync);
    sync();
    if (!st.available) note.classList.add('warn');
    body.append(
      h('div', { class: 'form-grid-row' }, h('span', {}, 'File name'), h('div', { class: 'saveas-name' }, nameIn, ext)),
      h('div', { class: 'form-grid-row' }, h('span', {}, 'Files of type'), type),
      note,
    );
    const ok = h('button', { class: 'btn primary' }, 'Save');
    const cancel = h('button', { class: 'btn' }, 'Cancel');
    const submit = () => {
      const n = nameIn.value.trim().replace(/[<>:"/\\|?*]/g, '_') || 'Drawing1';
      const fmt = SAVE_FORMATS.find((s) => s.id === type.value)!;
      done({ name: `${n}.${fmt.ext}`, fmt });
    };
    ok.addEventListener('click', submit);
    cancel.addEventListener('click', () => done(null));
    nameIn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') submit(); });
    foot.append(ok, cancel);
    nameIn.focus();
    nameIn.select();
  });
}

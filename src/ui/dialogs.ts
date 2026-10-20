// Modal dialogs: layer manager, ACI color picker, hatch settings, list chooser,
// confirmation, and the in-place text editor.

import type { Editor } from '../app/editor.ts';
import type { Layer } from '../core/document.ts';
import { ACI, aciToCss, colorName } from '../core/aci.ts';
import { BYLAYER, BYBLOCK, TEXT_FONT } from '../core/entities.ts';
import { PATTERN_NAMES, PATTERNS } from '../core/patterns.ts';
import { rad, deg } from '../core/geom.ts';
import { icon } from './icons.ts';
import { h } from './dom.ts';
import { escapeHtml, layerToggleHtml } from './ribbon.ts';

function modal(title: string, cls = ''): { root: HTMLElement; body: HTMLElement; footer: HTMLElement; close: () => void } {
  const back = h('div', { class: 'modal-back' });
  const win = h('div', { class: `modal ${cls}` });
  const head = h('div', { class: 'modal-head' }, h('span', {}, title));
  const x = h('button', { class: 'modal-x', html: icon('close', 14) });
  head.append(x);
  const body = h('div', { class: 'modal-body' });
  const footer = h('div', { class: 'modal-foot' });
  win.append(head, body, footer);
  back.append(win);
  document.body.append(back);
  // drag by header
  head.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const r = win.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    const mv = (ev: MouseEvent) => { win.style.position = 'fixed'; win.style.left = ev.clientX - ox + 'px'; win.style.top = ev.clientY - oy + 'px'; win.style.margin = '0'; };
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  });
  const close = () => back.remove();
  x.addEventListener('click', close);
  return { root: back, body, footer, close };
}

function button(label: string, primary = false): HTMLButtonElement {
  return h('button', { class: 'btn' + (primary ? ' primary' : '') }, label);
}

export function confirmDialog(title: string, message: string, buttons: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const m = modal(title, 'small');
    m.body.append(h('p', { class: 'confirm-msg' }, message));
    buttons.forEach((b, i) => {
      const btn = button(b, i === 0);
      btn.addEventListener('click', () => { m.close(); resolve(b); });
      m.footer.append(btn);
    });
    m.root.querySelector('.modal-x')!.addEventListener('click', () => resolve(null));
    (m.footer.firstElementChild as HTMLElement | null)?.focus();
  });
}

export function pickAci(initial: number, allowBy = true): Promise<number | null> {
  return new Promise((resolve) => {
    const m = modal('Select Color', 'color-dlg');
    let cur = initial;
    const preview = h('div', { class: 'aci-preview' });
    const label = h('span', { class: 'aci-label' });
    const upd = () => {
      preview.style.background = cur === BYLAYER || cur === BYBLOCK ? 'transparent' : aciToCss(cur);
      label.textContent = colorName(cur);
    };
    const grid = h('div', { class: 'aci-grid' });
    // 10..249 arranged like AutoCAD: columns by hue, rows by shade.
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 24; col++) {
        const i = 10 + col * 10 + row;
        const c = h('div', { class: 'aci-cell', title: String(i) });
        c.style.background = `rgb(${ACI[i].join(',')})`;
        c.addEventListener('click', () => { cur = i; upd(); });
        c.addEventListener('dblclick', () => { m.close(); resolve(i); });
        grid.append(c);
      }
    }
    const basic = h('div', { class: 'aci-row' });
    for (let i = 1; i <= 9; i++) {
      const c = h('div', { class: 'aci-cell big', title: colorName(i) });
      c.style.background = aciToCss(i);
      c.addEventListener('click', () => { cur = i; upd(); });
      basic.append(c);
    }
    const grays = h('div', { class: 'aci-row' });
    for (let i = 250; i <= 255; i++) {
      const c = h('div', { class: 'aci-cell big', title: String(i) });
      c.style.background = aciToCss(i);
      c.addEventListener('click', () => { cur = i; upd(); });
      grays.append(c);
    }
    m.body.append(grid, h('div', { class: 'aci-sub' }, basic, grays));
    if (allowBy) {
      const by = h('div', { class: 'aci-by' });
      const bl = button('ByLayer'), bb = button('ByBlock');
      bl.addEventListener('click', () => { cur = BYLAYER; upd(); });
      bb.addEventListener('click', () => { cur = BYBLOCK; upd(); });
      by.append(bl, bb);
      m.body.append(by);
    }
    m.body.append(h('div', { class: 'aci-cur' }, h('span', {}, 'Color: '), preview, label));
    upd();
    const ok = button('OK', true), cancel = button('Cancel');
    ok.addEventListener('click', () => { m.close(); resolve(cur); });
    cancel.addEventListener('click', () => { m.close(); resolve(null); });
    m.root.querySelector('.modal-x')!.addEventListener('click', () => resolve(null));
    m.footer.append(ok, cancel);
  });
}

export function chooseFromList(title: string, items: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const m = modal(title, 'small');
    const filter = h('input', { class: 'inp', placeholder: 'Filter…' }) as HTMLInputElement;
    const list = h('div', { class: 'pick-list' });
    let sel: string | null = items[0] ?? null;
    const visible = () => items.filter((i) => i.toLowerCase().includes(filter.value.toLowerCase()));
    const render = () => {
      list.innerHTML = '';
      const vis = visible();
      if (sel === null || !vis.includes(sel)) sel = vis.find((i) => i.toLowerCase() === filter.value.toLowerCase()) ?? vis[0] ?? null;
      for (const it of vis) {
        const row = h('div', { class: 'pick-item' + (it === sel ? ' active' : '') }, it);
        row.addEventListener('click', () => { sel = it; render(); });
        row.addEventListener('dblclick', () => { m.close(); resolve(it); });
        list.append(row);
      }
    };
    filter.addEventListener('input', () => { sel = null; render(); });
    filter.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && sel) { e.preventDefault(); m.close(); resolve(sel); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const vis = visible();
        const i = sel ? vis.indexOf(sel) : -1;
        sel = vis[Math.max(0, Math.min(vis.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))] ?? sel;
        render();
      }
    });
    m.body.append(filter, list);
    render();
    const ok = button('OK', true), cancel = button('Cancel');
    ok.addEventListener('click', () => { m.close(); resolve(sel); });
    cancel.addEventListener('click', () => { m.close(); resolve(null); });
    m.root.querySelector('.modal-x')!.addEventListener('click', () => resolve(null));
    m.footer.append(ok, cancel);
    filter.focus();
  });
}

export function hatchOptions(ed: Editor, init?: { pattern: string; scale: number; angle: number; title?: string }): Promise<{ pattern: string; scale: number; angle: number } | null> {
  return new Promise((resolve) => {
    const hd = init ? { hatchPattern: init.pattern, hatchScale: init.scale, hatchAngle: init.angle } : ed.doc.header;
    const m = modal(init?.title ?? 'Hatch Settings', 'hatch-dlg');
    let pattern = hd.hatchPattern.toUpperCase();
    const grid = h('div', { class: 'pat-grid' });
    const render = () => {
      grid.innerHTML = '';
      for (const name of PATTERN_NAMES) {
        const cell = h('div', { class: 'pat-cell' + (name === pattern ? ' active' : ''), title: name === 'SOLID' ? 'Solid fill' : PATTERNS[name].desc });
        cell.append(patternSwatch(name), h('span', {}, name));
        cell.addEventListener('click', () => { pattern = name; render(); });
        cell.addEventListener('dblclick', () => { pattern = name; ok.click(); });
        grid.append(cell);
      }
    };
    const scale = h('input', { class: 'inp', type: 'number', step: 'any', value: String(hd.hatchScale) }) as HTMLInputElement;
    const angle = h('input', { class: 'inp', type: 'number', step: 'any', value: String(Math.round(deg(hd.hatchAngle) * 1e6) / 1e6) }) as HTMLInputElement;
    m.body.append(grid, h('div', { class: 'form-row' }, h('label', {}, 'Scale'), scale, h('label', {}, 'Angle'), angle));
    render();
    const ok = button('OK', true), cancel = button('Cancel');
    ok.addEventListener('click', () => {
      m.close();
      resolve({ pattern, scale: parseFloat(scale.value) || 1, angle: rad(parseFloat(angle.value) || 0) });
    });
    cancel.addEventListener('click', () => { m.close(); resolve(null); });
    m.root.querySelector('.modal-x')!.addEventListener('click', () => resolve(null));
    m.footer.append(ok, cancel);
  });
}

export function patternSwatch(name: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 48; c.height = 36;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1d232b';
  g.fillRect(0, 0, 48, 36);
  g.strokeStyle = '#d9e1ea';
  g.fillStyle = '#d9e1ea';
  g.lineWidth = 1;
  if (name === 'SOLID') { g.fillRect(4, 4, 40, 28); return c; }
  const p = PATTERNS[name];
  const k = 2.2;
  g.save();
  g.beginPath(); g.rect(2, 2, 44, 32); g.clip();
  for (const r of p.rows) {
    const a = rad(r[0]);
    const u = { x: Math.cos(a), y: -Math.sin(a) };
    const off = { x: (r[3] * Math.cos(a) - r[4] * Math.sin(a)) * k, y: -(r[3] * Math.sin(a) + r[4] * Math.cos(a)) * k };
    const dashes = r.slice(5).map((d) => Math.max(Math.abs(d) * k, 0.8));
    g.setLineDash(dashes.length ? dashes : []);
    for (let i = -30; i <= 30; i++) {
      const ox = 24 + r[1] * k + off.x * i, oy = 18 - r[2] * k + off.y * i;
      g.beginPath();
      g.moveTo(ox - u.x * 80, oy - u.y * 80);
      g.lineTo(ox + u.x * 80, oy + u.y * 80);
      g.stroke();
    }
  }
  g.restore();
  return c;
}

// ---------------------------------------------------------------------------
// Layer Properties Manager

export function layerManager(ed: Editor, onChange: () => void): void {
  const m = modal('Layer Properties Manager', 'layer-dlg');
  const toolbar = h('div', { class: 'lm-toolbar' });
  const mkTool = (ico: string, title: string, fn: () => void) => {
    const b = h('button', { class: 'tool-btn', title, html: icon(ico, 20) });
    b.addEventListener('click', fn);
    toolbar.append(b);
  };
  const table = h('div', { class: 'lm-table' });
  const status = h('div', { class: 'lm-status' });
  let selected = ed.doc.currentLayer;
  const change = (fn: () => void) => {
    ed.doc.begin('LAYER');
    ed.doc.touchLayers();
    fn();
    ed.doc.commit();
    ed.doc.emit('layers');
    onChange();
    render();
  };
  mkTool('layerProps', 'New Layer', () => change(() => {
    const name = ed.doc.uniqueLayerName();
    const base = ed.doc.layers.get(selected);
    ed.doc.layers.set(name, { name, color: base?.color ?? 7, ltype: base?.ltype ?? 'Continuous', on: true, frozen: false, locked: false, plot: true });
    selected = name;
  }));
  mkTool('erase', 'Delete Layer', () => {
    if (selected === '0' || selected === ed.doc.currentLayer) { status.textContent = 'Layer 0 and the current layer cannot be deleted.'; return; }
    for (const e of ed.doc.entities.values()) if (e.layer === selected) { status.textContent = `Layer "${selected}" contains objects and cannot be deleted.`; return; }
    change(() => { ed.doc.layers.delete(selected); selected = ed.doc.currentLayer; });
  });
  mkTool('layerCurrent', 'Set Current', () => {
    const l = ed.doc.layers.get(selected);
    if (l?.frozen) { status.textContent = 'Cannot set a frozen layer current.'; return; }
    change(() => { ed.doc.currentLayer = selected; });
  });

  const render = () => {
    table.innerHTML = '';
    table.append(h('div', { class: 'lm-row lm-headrow', html: '<span>Status</span><span>Name</span><span>On</span><span>Freeze</span><span>Lock</span><span>Plot</span><span>Color</span><span>Linetype</span>' }));
    const layers = [...ed.doc.layers.values()].sort((a, b) => (a.name === '0' ? -1 : b.name === '0' ? 1 : a.name.localeCompare(b.name)));
    for (const l of layers) table.append(layerRow(l));
    const used = new Set([...ed.doc.entities.values()].map((e) => e.layer));
    status.textContent = `All: ${layers.length} layers displayed of ${layers.length} total layers · ${used.size} in use`;
  };

  const layerRow = (l: Layer): HTMLElement => {
    const row = h('div', { class: 'lm-row' + (l.name === selected ? ' active' : '') });
    const cur = h('span', { class: 'lm-status-ico', html: l.name === ed.doc.currentLayer ? icon('layerCurrent', 16) : '' });
    const name = h('span', { class: 'lm-name' }, l.name);
    name.addEventListener('dblclick', () => {
      if (l.name === '0') return;
      const inp = h('input', { class: 'inp lm-rename', value: l.name }) as HTMLInputElement;
      name.replaceWith(inp);
      inp.focus(); inp.select();
      const done = (commit: boolean) => {
        const nn = inp.value.trim();
        if (commit && nn && nn !== l.name && !ed.doc.layers.has(nn) && !/[<>/\\":;?*|=`]/.test(nn)) {
          change(() => {
            const old = l.name;
            const nl = { ...l, name: nn };
            ed.doc.layers.delete(old);
            ed.doc.layers.set(nn, nl);
            for (const e of ed.doc.entities.values()) if (e.layer === old) ed.doc.update({ ...e, layer: nn });
            if (ed.doc.currentLayer === old) ed.doc.currentLayer = nn;
            selected = nn;
          });
        } else render();
      };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); e.stopPropagation(); });
      inp.addEventListener('blur', () => done(true));
    });
    const toggle = (k: 'on' | 'frozen' | 'locked') => {
      const t = h('span', { class: 'lm-cell', html: layerToggleHtml(l, k) });
      t.addEventListener('click', (e) => {
        e.stopPropagation();
        if (k === 'frozen' && l.name === ed.doc.currentLayer) { status.textContent = 'Cannot freeze the current layer.'; return; }
        change(() => { const L = ed.doc.layers.get(l.name)!; L[k] = !L[k]; });
      });
      return t;
    };
    const plot = h('span', { class: 'lm-cell', html: icon('printer', 16), title: 'Plot' });
    plot.style.opacity = l.plot ? '1' : '0.3';
    plot.addEventListener('click', (e) => { e.stopPropagation(); change(() => { const L = ed.doc.layers.get(l.name)!; L.plot = !L.plot; }); });
    const color = h('span', { class: 'lm-cell lm-color', html: `<span class="swatch" style="background:${l.trueColor !== undefined ? '#' + l.trueColor.toString(16).padStart(6, '0') : aciToCss(l.color)}"></span>${escapeHtml(colorName(l.color))}` });
    color.addEventListener('click', async (e) => {
      e.stopPropagation();
      const c = await pickAci(l.color, false);
      if (c !== null) change(() => { const L = ed.doc.layers.get(l.name)!; L.color = c; L.trueColor = undefined; });
    });
    const lt = h('select', { class: 'inp lm-lt' }) as HTMLSelectElement;
    for (const t of ed.doc.linetypes.values()) lt.append(h('option', { value: t.name, selected: t.name.toUpperCase() === l.ltype.toUpperCase() }, t.name));
    lt.addEventListener('change', () => change(() => { ed.doc.layers.get(l.name)!.ltype = lt.value; }));
    lt.addEventListener('click', (e) => e.stopPropagation());
    row.append(cur, name, toggle('on'), toggle('frozen'), toggle('locked'), plot, color, lt);
    row.addEventListener('click', () => { selected = l.name; render(); });
    row.addEventListener('dblclick', (e) => { if ((e.target as HTMLElement).closest('.lm-name')) return; change(() => { if (!ed.doc.layers.get(l.name)!.frozen) ed.doc.currentLayer = l.name; }); });
    return row;
  };

  m.body.append(toolbar, table, status);
  render();
  const close = button('Close', true);
  close.addEventListener('click', m.close);
  m.footer.append(close);
}

// ---------------------------------------------------------------------------
// In-place text editor

export function editTextInPlace(ed: Editor, host: HTMLElement, opts: { initial: string; multiline: boolean; at: { x: number; y: number }; height: number }): Promise<string | null> {
  return new Promise((resolve) => {
    const s = ed.view.toScreen(opts.at);
    const px = Math.max(12, Math.min(48, opts.height * ed.view.scale / 0.7));
    const box = h('div', { class: 'text-editor' });
    const ta = h('textarea', { class: 'te-area', spellcheck: false }) as HTMLTextAreaElement;
    ta.value = opts.initial;
    ta.style.font = `${px}px ${TEXT_FONT}`;
    ta.rows = Math.max(1, opts.initial.split('\n').length);
    const bar = h('div', { class: 'te-bar' }, h('span', {}, opts.multiline ? 'Enter = new line · Ctrl+Enter or click outside = OK · Esc = cancel' : 'Enter = OK · Esc = cancel'));
    box.append(bar, ta);
    box.style.left = s.x + 'px';
    box.style.top = Math.max(0, s.y - px * 1.2 - 24) + 'px';
    host.append(box);
    ta.focus();
    ta.select();
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      box.remove();
      resolve(v);
    };
    const grow = () => { ta.rows = Math.max(1, ta.value.split('\n').length); ta.style.width = Math.max(120, Math.min(900, ta.value.split('\n').reduce((a, l) => Math.max(a, l.length), 4) * px * 0.62)) + 'px'; };
    grow();
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') finish(null);
      else if (e.key === 'Enter' && (!opts.multiline || e.ctrlKey)) { e.preventDefault(); finish(ta.value); }
    });
    const outside = (e: MouseEvent) => {
      if (box.contains(e.target as Node)) return;
      window.removeEventListener('mousedown', outside, true);
      // The click only closes the editor; don't let it start a selection.
      if ((e.target as HTMLElement).tagName === 'CANVAS') { e.stopPropagation(); e.preventDefault(); }
      finish(ta.value);
    };
    setTimeout(() => window.addEventListener('mousedown', outside, true), 0);
  });
}

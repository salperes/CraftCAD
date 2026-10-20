// Properties palette: general properties for the selection, geometry for single objects.

import type { Editor } from '../app/editor.ts';
import { type Entity, ENT_NAMES, BYLAYER, polyArea, polylineSegPrims, dimText, dimMeasurement, vpResize, vpScale } from '../core/entities.ts';
import { VP_SCALES, scaleLabel } from '../app/commands/layout.ts';
import { colorName, aciToCss } from '../core/aci.ts';
import { dist, angleBetween, normAng, deg, rad, fmtNum, sweep, TAU } from '../core/geom.ts';
import { PATTERN_NAMES } from '../core/patterns.ts';
import { icon } from './icons.ts';
import { h } from './dom.ts';
import { pickAci } from './dialogs.ts';

type Field =
  | { label: string; value: string; ro: true }
  | { label: string; value: number; set: (v: number) => Entity }
  | { label: string; text: string; setText: (v: string) => Entity }
  | { label: string; options: string[]; current: string; choose: (v: string) => Entity };

export class PropertiesPalette {
  el: HTMLElement;
  private body: HTMLElement;
  private head: HTMLElement;
  private ed: Editor;
  visible = false;

  constructor(ed: Editor, host: HTMLElement) {
    this.ed = ed;
    this.el = h('div', { class: 'palette' });
    const title = h('div', { class: 'palette-title' }, h('span', {}, 'PROPERTIES'));
    const x = h('button', { class: 'cmd-btn', html: icon('close', 12) });
    x.addEventListener('click', () => this.toggle(false));
    title.append(x);
    this.head = h('div', { class: 'palette-head' });
    this.body = h('div', { class: 'palette-body' });
    this.el.append(title, this.head, this.body);
    this.el.hidden = true;
    host.append(this.el);
  }

  toggle(show?: boolean): void {
    this.visible = show ?? !this.visible;
    this.el.hidden = !this.visible;
    window.dispatchEvent(new Event('resize'));
    if (this.visible) this.refresh();
  }

  refresh(): void {
    if (!this.visible) return;
    const ed = this.ed;
    const sel = [...ed.selection].map((id) => ed.doc.get(id)).filter((e): e is Entity => !!e);
    const types = new Set(sel.map((e) => e.type));
    this.head.textContent = !sel.length ? 'No selection' : types.size === 1 ? `${ENT_NAMES[sel[0].type]}${sel.length > 1 ? ` (${sel.length})` : ''}` : `All (${sel.length})`;
    this.body.innerHTML = '';
    this.section('General', this.general(sel));
    if (sel.length === 1) {
      const g = this.geometry(sel[0]);
      if (g.length) this.section(sel[0].type === 'text' || sel[0].type === 'mtext' ? 'Text' : 'Geometry', g);
    }
  }

  private commit(ents: Entity[]): void {
    const ed = this.ed;
    ed.doc.begin('PROPERTIES');
    for (const e of ents) ed.doc.update(e);
    ed.doc.commit();
    this.refresh();
  }

  private general(sel: Entity[]): HTMLElement[] {
    const ed = this.ed;
    const rows: HTMLElement[] = [];
    const common = <T>(f: (e: Entity) => T): T | null => {
      if (!sel.length) return null;
      const v = f(sel[0]);
      return sel.every((e) => f(e) === v) ? v : null;
    };
    // Color
    const c = sel.length ? common((e) => e.color) : ed.doc.currentColor;
    const colorCell = h('span', { class: 'pv pv-click', html: c === null ? '*VARIES*' : `<span class="swatch" style="background:${c === BYLAYER ? aciToCss(ed.doc.layers.get(sel[0]?.layer ?? ed.doc.currentLayer)?.color ?? 7) : aciToCss(c)}"></span>${colorName(c)}` });
    colorCell.addEventListener('click', async () => {
      const nc = await pickAci(c ?? BYLAYER);
      if (nc === null) return;
      if (sel.length) this.commit(sel.map((e) => ({ ...e, color: nc, trueColor: undefined }) as Entity));
      else { ed.doc.currentColor = nc; this.refresh(); ed.ui.onStatus(); }
    });
    rows.push(this.row('Color', colorCell));
    // Layer
    const l = sel.length ? common((e) => e.layer) : ed.doc.currentLayer;
    const ls = h('select', { class: 'inp pv-inp' }) as HTMLSelectElement;
    if (l === null) ls.append(h('option', { value: '', selected: true }, '*VARIES*'));
    for (const name of ed.doc.layers.keys()) ls.append(h('option', { value: name, selected: name === l }, name));
    ls.addEventListener('change', () => {
      if (!ls.value) return;
      if (sel.length) this.commit(sel.map((e) => ({ ...e, layer: ls.value }) as Entity));
      else { ed.doc.currentLayer = ls.value; ed.doc.emit('layers'); }
    });
    rows.push(this.row('Layer', ls));
    // Linetype
    const lt = sel.length ? common((e) => e.ltype) : ed.doc.currentLtype;
    const lts = h('select', { class: 'inp pv-inp' }) as HTMLSelectElement;
    if (lt === null) lts.append(h('option', { value: '', selected: true }, '*VARIES*'));
    for (const name of ['ByLayer', 'ByBlock', ...[...ed.doc.linetypes.values()].map((x) => x.name)]) lts.append(h('option', { value: name, selected: name.toUpperCase() === (lt ?? '').toUpperCase() }, name));
    lts.addEventListener('change', () => {
      if (!lts.value) return;
      if (sel.length) this.commit(sel.map((e) => ({ ...e, ltype: lts.value }) as Entity));
      else ed.doc.currentLtype = lts.value;
    });
    rows.push(this.row('Linetype', lts));
    if (sel.length) {
      const s = common((e) => e.ltscale ?? 1);
      rows.push(this.numRow('Linetype scale', s, (v) => this.commit(sel.map((e) => ({ ...e, ltscale: v }) as Entity))));
    } else rows.push(this.numRow('LTSCALE', ed.doc.header.ltscale, (v) => { if (v > 0) { ed.doc.header.ltscale = v; ed.redraw(); } }));
    return rows;
  }

  private geometry(e: Entity): HTMLElement[] {
    const F: Field[] = [];
    const num = (label: string, value: number, set: (v: number) => Entity) => F.push({ label, value, set });
    const ro = (label: string, value: string) => F.push({ label, value, ro: true });
    switch (e.type) {
      case 'line':
        num('Start X', e.p1.x, (v) => ({ ...e, p1: { ...e.p1, x: v } })); num('Start Y', e.p1.y, (v) => ({ ...e, p1: { ...e.p1, y: v } }));
        num('End X', e.p2.x, (v) => ({ ...e, p2: { ...e.p2, x: v } })); num('End Y', e.p2.y, (v) => ({ ...e, p2: { ...e.p2, y: v } }));
        num('Length', dist(e.p1, e.p2), (v) => { const a = angleBetween(e.p1, e.p2); return { ...e, p2: { x: e.p1.x + Math.cos(a) * v, y: e.p1.y + Math.sin(a) * v } }; });
        ro('Angle', fmtNum(deg(normAng(angleBetween(e.p1, e.p2)))) + '°');
        ro('Delta X', fmtNum(e.p2.x - e.p1.x)); ro('Delta Y', fmtNum(e.p2.y - e.p1.y));
        break;
      case 'circle':
        num('Center X', e.c.x, (v) => ({ ...e, c: { ...e.c, x: v } })); num('Center Y', e.c.y, (v) => ({ ...e, c: { ...e.c, y: v } }));
        num('Radius', e.r, (v) => ({ ...e, r: Math.max(v, 1e-9) })); num('Diameter', e.r * 2, (v) => ({ ...e, r: Math.max(v / 2, 1e-9) }));
        ro('Circumference', fmtNum(TAU * e.r)); ro('Area', fmtNum(Math.PI * e.r * e.r));
        break;
      case 'arc':
        num('Center X', e.c.x, (v) => ({ ...e, c: { ...e.c, x: v } })); num('Center Y', e.c.y, (v) => ({ ...e, c: { ...e.c, y: v } }));
        num('Radius', e.r, (v) => ({ ...e, r: Math.max(v, 1e-9) }));
        num('Start angle', deg(normAng(e.a0)), (v) => ({ ...e, a0: rad(v) })); num('End angle', deg(normAng(e.a1)), (v) => ({ ...e, a1: rad(v) }));
        ro('Total angle', fmtNum(deg(sweep(e.a0, e.a1))) + '°'); ro('Arc length', fmtNum(e.r * sweep(e.a0, e.a1)));
        break;
      case 'polyline': {
        F.push({ label: 'Closed', options: ['Yes', 'No'], current: e.closed ? 'Yes' : 'No', choose: (v) => ({ ...e, closed: v === 'Yes' }) });
        num('Global width', e.width ?? 0, (v) => ({ ...e, width: v || undefined }));
        let L = 0;
        for (const pr of polylineSegPrims(e)) L += pr.k === 'seg' ? dist(pr.a, pr.b) : pr.r * sweep(pr.a0, pr.a1);
        ro('Vertices', String(e.pts.length)); ro('Length', fmtNum(L));
        if (e.closed) ro('Area', fmtNum(Math.abs(polyArea(e))));
        break;
      }
      case 'ellipse':
        num('Center X', e.c.x, (v) => ({ ...e, c: { ...e.c, x: v } })); num('Center Y', e.c.y, (v) => ({ ...e, c: { ...e.c, y: v } }));
        ro('Major radius', fmtNum(Math.hypot(e.major.x, e.major.y))); num('Radius ratio', e.ratio, (v) => ({ ...e, ratio: Math.min(1, Math.max(1e-6, v)) }));
        break;
      case 'point':
        num('Position X', e.p.x, (v) => ({ ...e, p: { ...e.p, x: v } })); num('Position Y', e.p.y, (v) => ({ ...e, p: { ...e.p, y: v } }));
        break;
      case 'text':
        F.push({ label: 'Contents', text: e.text, setText: (v) => ({ ...e, text: v }) });
        num('Height', e.h, (v) => ({ ...e, h: Math.max(v, 1e-9) })); num('Rotation', deg(e.rot), (v) => ({ ...e, rot: rad(v) }));
        num('Width factor', e.wf, (v) => ({ ...e, wf: v || 1 }));
        num('Position X', e.p.x, (v) => ({ ...e, p: { ...e.p, x: v } })); num('Position Y', e.p.y, (v) => ({ ...e, p: { ...e.p, y: v } }));
        break;
      case 'mtext':
        F.push({ label: 'Contents', text: e.text.replace(/\\P/g, ' ¶ '), setText: (v) => ({ ...e, text: v.replace(/ ?¶ ?/g, '\\P') }) });
        num('Text height', e.h, (v) => ({ ...e, h: Math.max(v, 1e-9) })); num('Rotation', deg(e.rot), (v) => ({ ...e, rot: rad(v) }));
        num('Defined width', e.width, (v) => ({ ...e, width: Math.max(0, v) }));
        num('Position X', e.p.x, (v) => ({ ...e, p: { ...e.p, x: v } })); num('Position Y', e.p.y, (v) => ({ ...e, p: { ...e.p, y: v } }));
        break;
      case 'insert':
        ro('Name', e.name);
        num('Position X', e.p.x, (v) => ({ ...e, p: { ...e.p, x: v } })); num('Position Y', e.p.y, (v) => ({ ...e, p: { ...e.p, y: v } }));
        num('Scale X', e.sx, (v) => ({ ...e, sx: v || 1 })); num('Scale Y', e.sy, (v) => ({ ...e, sy: v || 1 }));
        num('Rotation', deg(e.rot), (v) => ({ ...e, rot: rad(v) }));
        break;
      case 'dimension':
        ro('Type', e.dimType); ro('Measurement', dimText({ ...e, textOverride: undefined }, this.ed.doc.dimStyle));
        F.push({ label: 'Text override', text: e.textOverride ?? '', setText: (v) => ({ ...e, textOverride: v || undefined, block: undefined }) });
        ro('Value', fmtNum(dimMeasurement(e)));
        break;
      case 'hatch':
        F.push({ label: 'Pattern', options: PATTERN_NAMES, current: e.pattern.toUpperCase(), choose: (v) => ({ ...e, pattern: v, solid: v === 'SOLID', patLines: undefined }) });
        num('Scale', e.scale, (v) => ({ ...e, scale: v || 1, patLines: undefined })); num('Angle', deg(e.angle), (v) => ({ ...e, angle: rad(v), patLines: undefined }));
        ro('Loops', String(e.loops.length));
        break;
      case 'spline':
        ro('Degree', String(e.degree)); ro('Control points', String(e.ctrl.length)); ro('Closed', e.closed ? 'Yes' : 'No');
        break;
      case 'solid':
        ro('Vertices', String(e.pts.length));
        break;
      case 'viewport': {
        num('Center X', e.c.x, (v) => ({ ...e, c: { ...e.c, x: v } })); num('Center Y', e.c.y, (v) => ({ ...e, c: { ...e.c, y: v } }));
        num('Width', e.w, (v) => vpResize(e, { x: e.c.x - e.w / 2, y: e.c.y - e.h / 2 }, { x: e.c.x - e.w / 2 + Math.max(v, 1e-6), y: e.c.y + e.h / 2 }));
        num('Height', e.h, (v) => vpResize(e, { x: e.c.x - e.w / 2, y: e.c.y - e.h / 2 }, { x: e.c.x + e.w / 2, y: e.c.y - e.h / 2 + Math.max(v, 1e-6) }));
        F.push({ label: 'On', options: ['Yes', 'No'], current: e.off ? 'No' : 'Yes', choose: (v) => ({ ...e, off: v === 'No' || undefined }) });
        F.push({ label: 'Display locked', options: ['Yes', 'No'], current: e.locked ? 'Yes' : 'No', choose: (v) => ({ ...e, locked: v === 'Yes' || undefined }) });
        const k = vpScale(e);
        const label = scaleLabel(k);
        const names = VP_SCALES.map(([n]) => n);
        F.push({ label: 'Standard scale', options: names.includes(label) ? names : ['Custom', ...names], current: names.includes(label) ? label : 'Custom', choose: (v) => ({ ...e, vh: e.h / (VP_SCALES.find(([n]) => n === v)?.[1] ?? k) }) });
        num('Custom scale', k, (v) => ({ ...e, vh: e.h / Math.max(v, 1e-12) }));
        num('View center X', e.vc.x, (v) => ({ ...e, vc: { ...e.vc, x: v } })); num('View center Y', e.vc.y, (v) => ({ ...e, vc: { ...e.vc, y: v } }));
        break;
      }
    }
    return F.map((f) => {
      if ('ro' in f) return this.row(f.label, h('span', { class: 'pv ro' }, f.value));
      if ('options' in f) {
        const s = h('select', { class: 'inp pv-inp' }) as HTMLSelectElement;
        for (const o of f.options) s.append(h('option', { value: o, selected: o === f.current }, o));
        s.addEventListener('change', () => this.commit([f.choose(s.value)]));
        return this.row(f.label, s);
      }
      if ('text' in f) {
        const t = h('input', { class: 'inp pv-inp', value: f.text }) as HTMLInputElement;
        t.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') t.blur(); });
        t.addEventListener('change', () => this.commit([f.setText(t.value)]));
        return this.row(f.label, t);
      }
      return this.numRow(f.label, f.value, (v) => this.commit([f.set(v)]));
    });
  }

  private numRow(label: string, value: number | null, set: (v: number) => void): HTMLElement {
    const inp = h('input', { class: 'inp pv-inp', value: value === null ? '*VARIES*' : fmtNum(value, 6) }) as HTMLInputElement;
    inp.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') inp.blur(); });
    inp.addEventListener('change', () => {
      const v = parseFloat(inp.value.replace(',', '.'));
      if (Number.isFinite(v)) set(v);
    });
    return this.row(label, inp);
  }

  private row(label: string, value: HTMLElement): HTMLElement {
    return h('div', { class: 'prow' }, h('span', { class: 'pl' }, label), value);
  }

  private section(title: string, rows: HTMLElement[]): void {
    const sec = h('div', { class: 'psec' });
    const head = h('div', { class: 'psec-head' }, h('span', { class: 'caret', html: '&#9662;' }), title);
    const body = h('div', { class: 'psec-body' });
    head.addEventListener('click', () => { body.hidden = !body.hidden; sec.classList.toggle('collapsed', body.hidden); });
    body.append(...rows);
    sec.append(head, body);
    this.body.append(sec);
  }
}

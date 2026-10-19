// Ribbon: tabs, panels, split buttons and the layer/color/linetype combos.

import type { Editor } from '../app/editor.ts';
import { BYLAYER, BYBLOCK, type Entity } from '../core/entities.ts';
import { aciToCss, colorName } from '../core/aci.ts';
import { icon } from './icons.ts';
import { h, showMenu, tooltip, type MenuEntry } from './dom.ts';

interface Btn { label: string; icon: string; cmd: string; tip?: string }
type Item =
  | { kind: 'big'; btn: Btn; menu?: Btn[] }
  | { kind: 'col'; items: { btn: Btn; menu?: Btn[]; label?: boolean }[] }
  | { kind: 'layerCombo' } | { kind: 'propCombos' };
interface Panel { title: string; items: Item[]; wide?: boolean }
interface Tab { name: string; panels: Panel[] }

const b = (label: string, ico: string, cmd: string, tip?: string): Btn => ({ label, icon: ico, cmd, tip });

const CIRCLE_MENU = [
  b('Center, Radius', 'circle', 'CIRCLE'), b('Center, Diameter', 'circleD', 'CIRCLE;\\;D'),
  b('2-Point', 'circle2p', 'CIRCLE;2P'), b('3-Point', 'circle3p', 'CIRCLE;3P'), b('Tan, Tan, Radius', 'circleTtr', 'CIRCLE;T'),
];
const ARC_MENU = [
  b('3-Point', 'arc', 'ARC'), b('Start, Center, End', 'arcSce', 'ARC;\\;C'), b('Center, Start, End', 'arcCse', 'ARC;C'),
];
const DIM_MENU = [
  b('Linear', 'dimlinear', 'DIMLINEAR'), b('Aligned', 'dimaligned', 'DIMALIGNED'), b('Angular', 'dimangular', 'DIMANGULAR'),
  b('Radius', 'dimradius', 'DIMRADIUS'), b('Diameter', 'dimdiameter', 'DIMDIAMETER'),
];
const TEXT_MENU = [b('Multiline Text', 'mtext', 'MTEXT'), b('Single Line', 'text', 'TEXT')];
const ARRAY_MENU = [b('Rectangular Array', 'arrayRect', 'ARRAYRECT'), b('Polar Array', 'arrayPolar', 'ARRAYPOLAR')];
const TRIM_MENU = [b('Trim', 'trim', 'TRIM'), b('Extend', 'extend', 'EXTEND')];
const FILLET_MENU = [b('Fillet', 'fillet', 'FILLET'), b('Chamfer', 'chamfer', 'CHAMFER')];
const RECT_MENU = [b('Rectangle', 'rectang', 'RECTANG'), b('Polygon', 'polygon', 'POLYGON')];
const MEASURE_MENU = [b('Distance', 'dist', 'DIST'), b('Area', 'area', 'AREA'), b('List', 'list', 'LIST'), b('ID Point', 'idPoint', 'ID')];

const TABS: Tab[] = [
  {
    name: 'Home',
    panels: [
      {
        title: 'Draw',
        items: [
          { kind: 'big', btn: b('Line', 'line', 'LINE', 'Creates straight line segments') },
          { kind: 'big', btn: b('Polyline', 'pline', 'PLINE', 'Creates a 2D polyline of line and arc segments') },
          { kind: 'big', btn: b('Circle', 'circle', 'CIRCLE', 'Creates a circle'), menu: CIRCLE_MENU },
          { kind: 'big', btn: b('Arc', 'arc', 'ARC', 'Creates an arc'), menu: ARC_MENU },
          { kind: 'col', items: [{ btn: b('Rectangle', 'rectang', 'RECTANG'), menu: RECT_MENU }, { btn: b('Hatch', 'hatch', 'HATCH', 'Fills an enclosed area with a hatch pattern') }, { btn: b('Ellipse', 'ellipse', 'ELLIPSE') }] },
          { kind: 'col', items: [{ btn: b('Spline', 'spline', 'SPLINE') }, { btn: b('Point', 'point', 'POINT') }, { btn: b('Polygon', 'polygon', 'POLYGON') }] },
        ],
      },
      {
        title: 'Modify',
        items: [
          { kind: 'col', items: [{ btn: b('Move', 'move', 'MOVE'), label: true }, { btn: b('Copy', 'copy', 'COPY'), label: true }, { btn: b('Stretch', 'stretch', 'STRETCH'), label: true }] },
          { kind: 'col', items: [{ btn: b('Rotate', 'rotate', 'ROTATE'), label: true }, { btn: b('Mirror', 'mirror', 'MIRROR'), label: true }, { btn: b('Scale', 'scale', 'SCALE'), label: true }] },
          { kind: 'col', items: [{ btn: b('Trim', 'trim', 'TRIM'), menu: TRIM_MENU, label: true }, { btn: b('Fillet', 'fillet', 'FILLET'), menu: FILLET_MENU, label: true }, { btn: b('Array', 'arrayRect', 'ARRAYRECT'), menu: ARRAY_MENU, label: true }] },
          { kind: 'col', items: [{ btn: b('Erase', 'erase', 'ERASE') }, { btn: b('Explode', 'explode', 'EXPLODE') }, { btn: b('Offset', 'offset', 'OFFSET') }] },
          { kind: 'col', items: [{ btn: b('Break', 'break', 'BREAK') }, { btn: b('Join', 'join', 'JOIN') }, { btn: b('Extend', 'extend', 'EXTEND') }] },
        ],
      },
      {
        title: 'Annotation',
        items: [
          { kind: 'big', btn: b('Text', 'mtext', 'MTEXT', 'Creates multiline text'), menu: TEXT_MENU },
          { kind: 'big', btn: b('Dimension', 'dimension', 'DIMLINEAR', 'Creates dimensions'), menu: DIM_MENU },
          { kind: 'col', items: [{ btn: b('Leader', 'mleader', 'MLEADER'), label: true }, { btn: b('Edit Text', 'textedit', 'TEXTEDIT'), label: true }] },
        ],
      },
      {
        title: 'Layers',
        wide: true,
        items: [
          { kind: 'big', btn: b('Layer Properties', 'layerProps', 'LAYER', 'Manages layers and layer properties') },
          { kind: 'layerCombo' },
        ],
      },
      {
        title: 'Block',
        items: [
          { kind: 'big', btn: b('Insert', 'blockInsert', 'INSERT', 'Inserts a block') },
          { kind: 'col', items: [{ btn: b('Create', 'blockCreate', 'BLOCK'), label: true }] },
        ],
      },
      {
        title: 'Properties',
        wide: true,
        items: [
          { kind: 'big', btn: b('Match Properties', 'matchprop', 'MATCHPROP', 'Applies the properties of a selected object to other objects') },
          { kind: 'propCombos' },
        ],
      },
      {
        title: 'Utilities',
        items: [{ kind: 'big', btn: b('Measure', 'dist', 'DIST', 'Measures distance, area and more'), menu: MEASURE_MENU }],
      },
      {
        title: 'Clipboard',
        items: [
          { kind: 'big', btn: b('Paste', 'paste', 'PASTECLIP') },
          { kind: 'col', items: [{ btn: b('Copy Clip', 'copyclip', 'COPYCLIP') }, { btn: b('Cut', 'cut', 'CUTCLIP') }] },
        ],
      },
    ],
  },
  {
    name: 'Insert',
    panels: [
      { title: 'Block', items: [{ kind: 'big', btn: b('Insert', 'blockInsert', 'INSERT') }, { kind: 'big', btn: b('Create Block', 'blockCreate', 'BLOCK') }, { kind: 'big', btn: b('Explode', 'explode', 'EXPLODE') }] },
      { title: 'Import', items: [{ kind: 'big', btn: b('Open DXF/DWG', 'open', 'OPEN', 'Opens a DXF or DWG drawing') }] },
    ],
  },
  {
    name: 'Annotate',
    panels: [
      { title: 'Text', items: [{ kind: 'big', btn: b('Multiline Text', 'mtext', 'MTEXT') }, { kind: 'big', btn: b('Single Line', 'text', 'TEXT') }, { kind: 'col', items: [{ btn: b('Edit Text', 'textedit', 'TEXTEDIT'), label: true }] }] },
      {
        title: 'Dimensions',
        items: [
          { kind: 'big', btn: b('Linear', 'dimlinear', 'DIMLINEAR') }, { kind: 'big', btn: b('Aligned', 'dimaligned', 'DIMALIGNED') },
          { kind: 'col', items: [{ btn: b('Radius', 'dimradius', 'DIMRADIUS'), label: true }, { btn: b('Diameter', 'dimdiameter', 'DIMDIAMETER'), label: true }, { btn: b('Angular', 'dimangular', 'DIMANGULAR'), label: true }] },
          { kind: 'col', items: [{ btn: b('Dim Scale', 'scale', 'DIMSCALE'), label: true }] },
        ],
      },
      { title: 'Leaders', items: [{ kind: 'big', btn: b('Multileader', 'mleader', 'MLEADER') }] },
    ],
  },
  {
    name: 'View',
    panels: [
      {
        title: 'Navigate',
        items: [
          { kind: 'big', btn: b('Extents', 'zoomExtents', 'ZOOM;E', 'Zooms to display the extents of all objects') },
          { kind: 'col', items: [{ btn: b('Window', 'zoomWindow', 'ZOOM;W'), label: true }, { btn: b('Previous', 'zoomPrev', 'ZOOM;P'), label: true }, { btn: b('Pan', 'pan', 'PAN'), label: true }] },
        ],
      },
      { title: 'Display', items: [{ kind: 'big', btn: b('Regen', 'regen', 'REGEN') }, { kind: 'col', items: [{ btn: b('Linetype Scale', 'dimlinear', 'LTSCALE'), label: true }, { btn: b('Select All', 'selectAll', 'SELECTALL'), label: true }] }] },
      { title: 'Palettes', items: [{ kind: 'big', btn: b('Properties', 'properties', 'PROPERTIES') }, { kind: 'big', btn: b('Layers', 'layerProps', 'LAYER') }] },
    ],
  },
  {
    name: 'Manage',
    panels: [
      { title: 'Cleanup', items: [{ kind: 'big', btn: b('Purge', 'purge', 'PURGE', 'Removes unused blocks and layers') }] },
      { title: 'Settings', items: [{ kind: 'col', items: [{ btn: b('Object Snap', 'osnap', 'OSNAP'), label: true }, { btn: b('Linetype Scale', 'dimlinear', 'LTSCALE'), label: true }] }] },
      { title: 'Help', items: [{ kind: 'big', btn: b('Commands', 'help', 'HELP', 'Lists all commands and aliases') }] },
    ],
  },
];

export class Ribbon {
  el: HTMLElement;
  private body: HTMLElement;
  private tabsEl: HTMLElement;
  private ed: Editor;
  private refreshers: (() => void)[] = [];
  /** Last-used variant per split button (keyed by its default command). */
  private lastVariant = new Map<string, Btn>();
  pickColor!: (initial: number) => Promise<number | null>;

  constructor(ed: Editor, host: HTMLElement) {
    this.ed = ed;
    this.el = h('div', { class: 'ribbon' });
    this.tabsEl = h('div', { class: 'ribbon-tabs' });
    this.body = h('div', { class: 'ribbon-body' });
    this.el.append(this.tabsEl, this.body);
    host.append(this.el);
    TABS.forEach((t, i) => {
      const tab = h('div', { class: 'ribbon-tab' }, t.name);
      tab.addEventListener('click', () => this.show(i));
      this.tabsEl.append(tab);
    });
    this.show(0);
  }

  show(i: number): void {

    [...this.tabsEl.children].forEach((c, k) => c.classList.toggle('active', k === i));
    this.body.innerHTML = '';
    this.refreshers = [];
    for (const p of TABS[i].panels) this.body.append(this.panel(p));
    this.refresh();
  }

  refresh(): void {
    for (const r of this.refreshers) r();
  }

  private run(cmd: string): void {
    void this.ed.runMacro(cmd);
  }

  private panel(p: Panel): HTMLElement {
    const el = h('div', { class: 'rpanel' + (p.wide ? ' wide' : '') });
    const content = h('div', { class: 'rpanel-content' });
    for (const it of p.items) content.append(this.item(it));
    el.append(content, h('div', { class: 'rpanel-title' }, p.title, h('span', { class: 'rpanel-caret', html: '&#9662;' })));
    return el;
  }

  private item(it: Item): HTMLElement {
    if (it.kind === 'big') return this.bigButton(it.btn, it.menu);
    if (it.kind === 'col') {
      const col = h('div', { class: 'rcol' });
      for (const s of it.items) col.append(this.smallButton(s.btn, s.menu, s.label));
      return col;
    }
    if (it.kind === 'layerCombo') return this.layerCombo();
    return this.propCombos();
  }

  private bigButton(btn: Btn, menu?: Btn[]): HTMLElement {
    const wrap = h('div', { class: 'rbig' + (menu ? ' split' : '') });
    const top = h('button', { class: 'rbig-top', html: icon(btn.icon, 32) });
    const lbl = h('button', { class: 'rbig-label' }, btn.label, menu ? h('span', { class: 'caret', html: '&#9662;' }) : null);
    const current = () => this.lastVariant.get(btn.cmd) ?? btn;
    top.addEventListener('click', () => this.run(current().cmd));
    if (menu) {
      lbl.addEventListener('click', () => showMenu(menu.map((m) => ({
        label: m.label, icon: icon(m.icon, 20),
        action: () => { this.lastVariant.set(btn.cmd, m); top.innerHTML = icon(m.icon, 32); this.run(m.cmd); },
      })), lbl, 'ribbon-menu'));
    } else lbl.addEventListener('click', () => this.run(btn.cmd));
    tooltip(wrap, btn.label, btn.tip ?? '', btn.cmd.split(';')[0]);
    wrap.append(top, lbl);
    return wrap;
  }

  private smallButton(btn: Btn, menu?: Btn[], showLabel?: boolean): HTMLElement {
    const wrap = h('div', { class: 'rsmall' + (showLabel ? ' labeled' : '') });
    const main = h('button', { class: 'rsmall-main', html: icon(btn.icon, 18) + (showLabel ? `<span>${btn.label}</span>` : '') });
    const current = () => this.lastVariant.get(btn.cmd) ?? btn;
    main.addEventListener('click', () => this.run(current().cmd));
    wrap.append(main);
    if (menu) {
      const caret = h('button', { class: 'rsmall-caret', html: '&#9662;' });
      caret.addEventListener('click', () => showMenu(menu.map((m) => ({
        label: m.label, icon: icon(m.icon, 20),
        action: () => {
          this.lastVariant.set(btn.cmd, m);
          main.innerHTML = icon(m.icon, 18) + (showLabel ? `<span>${m.label}</span>` : '');
          this.run(m.cmd);
        },
      })), wrap, 'ribbon-menu'));
      wrap.append(caret);
    }
    tooltip(wrap, btn.label, btn.tip ?? '', btn.cmd.split(';')[0]);
    return wrap;
  }

  // ---------------------------------------------------------------------------
  // Layer combo

  private selectedEntities(): Entity[] {
    return [...this.ed.selection].map((id) => this.ed.doc.get(id)).filter((e): e is Entity => !!e);
  }

  private layerCombo(): HTMLElement {
    const ed = this.ed;
    const box = h('div', { class: 'rcombos' });
    const combo = h('div', { class: 'combo layer-combo' });
    const row = h('div', { class: 'rcombo-icons' });
    const mk = (ico: string, cmd: string, title: string) => {
      const btn = h('button', { class: 'rsmall-main', html: icon(ico, 18) });
      btn.addEventListener('click', () => void ed.runCommand(cmd));
      tooltip(btn, title, '', cmd);
      return btn;
    };
    row.append(mk('layerCurrent', 'LAYMCUR', 'Make Object\'s Layer Current'), mk('layerMatch', 'MATCHPROP', 'Match Layer'), mk('purge', 'PURGE', 'Purge unused layers'));
    const render = () => {
      const sel = this.selectedEntities();
      let name = ed.doc.currentLayer;
      if (sel.length) {
        const names = new Set(sel.map((e) => e.layer));
        name = names.size === 1 ? [...names][0] : '';
      }
      const l = ed.doc.layers.get(name);
      combo.innerHTML = l ? layerRowHtml(l) : `<span class="layer-name dim">${sel.length ? '*VARIES*' : name}</span>`;
      combo.append(h('span', { class: 'combo-caret', html: '&#9662;' }));
    };
    combo.addEventListener('click', () => {
      const sel = this.selectedEntities();
      const layers = [...ed.doc.layers.values()].sort((a, b) => (a.name === '0' ? -1 : b.name === '0' ? 1 : a.name.localeCompare(b.name)));
      const m = showMenu(layers.map((l): MenuEntry => ({ html: layerRowHtml(l) })), combo, 'layer-menu');
      [...m.querySelectorAll<HTMLElement>('.menu-item')].forEach((it, i) => {
        const l = layers[i];
        it.addEventListener('click', (ev) => {
          const t = (ev.target as HTMLElement).closest('[data-toggle]') as HTMLElement | null;
          ed.doc.begin('LAYER');
          ed.doc.touchLayers();
          if (t) {
            const k = t.dataset.toggle as 'on' | 'frozen' | 'locked';
            if (k === 'frozen' && l.name === ed.doc.currentLayer) ed.print('Cannot freeze the current layer.', 'error');
            else l[k] = !l[k];
            ed.doc.commit();
            ed.doc.emit('layers');
            t.outerHTML = layerToggleHtml(l, k);
            ev.stopPropagation();
            return;
          }
          if (sel.length) {
            for (const e of sel) ed.doc.update({ ...e, layer: l.name } as Entity);
          } else ed.doc.currentLayer = l.name;
          ed.doc.commit();
          ed.doc.emit('layers');
          m.remove();
        });
      });
    });
    this.refreshers.push(render);
    box.append(row, combo);
    return box;
  }

  private propCombos(): HTMLElement {
    const ed = this.ed;
    const box = h('div', { class: 'rcombos' });
    const color = h('div', { class: 'combo prop-combo' });
    const ltype = h('div', { class: 'combo prop-combo' });
    const renderColor = () => {
      const sel = this.selectedEntities();
      let c: number | null = ed.doc.currentColor;
      if (sel.length) { const s = new Set(sel.map((e) => e.color)); c = s.size === 1 ? [...s][0] : null; }
      color.innerHTML = c === null ? '<span class="dim">*VARIES*</span>' : colorItemHtml(c, ed);
      color.append(h('span', { class: 'combo-caret', html: '&#9662;' }));
    };
    const renderLt = () => {
      const sel = this.selectedEntities();
      let t: string | null = ed.doc.currentLtype;
      if (sel.length) { const s = new Set(sel.map((e) => e.ltype)); t = s.size === 1 ? [...s][0] : null; }
      ltype.innerHTML = t === null ? '<span class="dim">*VARIES*</span>' : ltypeItemHtml(t);
      ltype.append(h('span', { class: 'combo-caret', html: '&#9662;' }));
    };
    const applyColor = (c: number) => {
      const sel = this.selectedEntities();
      if (sel.length) {
        ed.doc.begin('CHPROP');
        for (const e of sel) ed.doc.update({ ...e, color: c, trueColor: undefined } as Entity);
        ed.doc.commit();
      } else ed.doc.currentColor = c;
      this.refresh();
    };
    color.addEventListener('click', () => {
      const opts = [BYLAYER, BYBLOCK, 1, 2, 3, 4, 5, 6, 7];
      showMenu([
        ...opts.map((c): MenuEntry => ({ html: colorItemHtml(c, ed), action: () => applyColor(c) })),
        { sep: true, label: 'More Colors...', action: async () => { const c = await this.pickColor(ed.doc.currentColor); if (c !== null) applyColor(c); } },
      ], color, 'prop-menu');
    });
    ltype.addEventListener('click', () => {
      const names = ['ByLayer', 'ByBlock', ...[...ed.doc.linetypes.values()].map((l) => l.name)];
      showMenu(names.map((n): MenuEntry => ({
        html: ltypeItemHtml(n),
        action: () => {
          const sel = this.selectedEntities();
          if (sel.length) {
            ed.doc.begin('CHPROP');
            for (const e of sel) ed.doc.update({ ...e, ltype: n } as Entity);
            ed.doc.commit();
          } else ed.doc.currentLtype = n;
          this.refresh();
        },
      })), ltype, 'prop-menu');
    });
    this.refreshers.push(renderColor, renderLt);
    box.append(color, ltype);
    return box;
  }
}

export function layerToggleHtml(l: { on: boolean; frozen: boolean; locked: boolean }, k: 'on' | 'frozen' | 'locked'): string {
  const ico = k === 'on' ? (l.on ? 'bulbOn' : 'bulbOff') : k === 'frozen' ? (l.frozen ? 'snowflake' : 'sun') : (l.locked ? 'lockClosed' : 'lockOpen');
  const title = k === 'on' ? 'On/Off' : k === 'frozen' ? 'Freeze/Thaw' : 'Lock/Unlock';
  return `<span class="ltoggle" data-toggle="${k}" title="${title}">${icon(ico, 16)}</span>`;
}

export function layerRowHtml(l: { name: string; color: number; trueColor?: number; on: boolean; frozen: boolean; locked: boolean }): string {
  const sw = l.trueColor !== undefined ? `#${l.trueColor.toString(16).padStart(6, '0')}` : aciToCss(l.color, true);
  return `<span class="layer-row">${layerToggleHtml(l, 'on')}${layerToggleHtml(l, 'frozen')}${layerToggleHtml(l, 'locked')}` +
    `<span class="swatch" style="background:${sw}"></span><span class="layer-name">${escapeHtml(l.name)}</span></span>`;
}

function colorItemHtml(c: number, ed: Editor): string {
  let css: string;
  if (c === BYLAYER) css = aciToCss(ed.doc.layers.get(ed.doc.currentLayer)?.color ?? 7);
  else if (c === BYBLOCK) css = '#ffffff';
  else css = aciToCss(c);
  return `<span class="layer-row"><span class="swatch" style="background:${css}"></span><span>${colorName(c)}</span></span>`;
}

function ltypeItemHtml(n: string): string {
  const dash: Record<string, string> = { DASHED: '6 3', HIDDEN: '3 2', CENTER: '10 2 2 2', PHANTOM: '10 2 2 2 2 2', DOT: '1 3', DASHDOT: '6 2 1 2', DIVIDE: '6 2 1 2 1 2' };
  const d = dash[n.toUpperCase()] ?? '';
  return `<span class="layer-row"><svg width="46" height="10"><line x1="1" y1="5" x2="45" y2="5" stroke="#dde4ec" stroke-width="1.4" ${d ? `stroke-dasharray="${d}"` : ''}/></svg><span>${escapeHtml(n)}</span></span>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

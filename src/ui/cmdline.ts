// Floating command line with history, clickable options, autocomplete and the
// dynamic input tooltip that follows the cursor.

import type { Editor } from '../app/editor.ts';
import { kwShortcut } from '../app/editor.ts';
import { icon } from './icons.ts';
import { h, showMenu } from './dom.ts';
import { escapeHtml } from './ribbon.ts';

const CMD_ICONS: Record<string, string> = {
  LINE: 'line', PLINE: 'pline', CIRCLE: 'circle', ARC: 'arc', RECTANG: 'rectang', POLYGON: 'polygon', ELLIPSE: 'ellipse',
  SPLINE: 'spline', POINT: 'point', HATCH: 'hatch', ERASE: 'erase', MOVE: 'move', COPY: 'copy', ROTATE: 'rotate',
  SCALE: 'scale', MIRROR: 'mirror', OFFSET: 'offset', TRIM: 'trim', EXTEND: 'extend', FILLET: 'fillet', CHAMFER: 'chamfer',
  ARRAY: 'arrayRect', ARRAYRECT: 'arrayRect', ARRAYPOLAR: 'arrayPolar', EXPLODE: 'explode', STRETCH: 'stretch', BREAK: 'break',
  JOIN: 'join', MATCHPROP: 'matchprop', TEXT: 'text', MTEXT: 'mtext', TEXTEDIT: 'textedit', DIMLINEAR: 'dimlinear',
  DIMALIGNED: 'dimaligned', DIMRADIUS: 'dimradius', DIMDIAMETER: 'dimdiameter', DIMANGULAR: 'dimangular', MLEADER: 'mleader',
  ZOOM: 'zoomExtents', PAN: 'pan', LAYER: 'layerProps', PROPERTIES: 'properties', DIST: 'dist', AREA: 'area', LIST: 'list',
  ID: 'idPoint', BLOCK: 'blockCreate', INSERT: 'blockInsert', UNDO: 'undo', REDO: 'redo', NEW: 'new', OPEN: 'open',
  QSAVE: 'save', SAVEAS: 'saveAs', PURGE: 'purge', REGEN: 'regen', HELP: 'help', PASTECLIP: 'paste', COPYCLIP: 'copyclip',
  CUTCLIP: 'cut', SELECTALL: 'selectAll', OSNAP: 'osnap',
};

export class CommandLine {
  el: HTMLElement;
  private history: HTMLElement;
  private promptEl: HTMLElement;
  private inputEl: HTMLElement;
  private ac: HTMLElement;
  private dyn: HTMLElement;
  private ed: Editor;
  private lines: { text: string; kind: string }[] = [];
  private expanded = false;
  private acItems: string[] = [];
  private acIndex = -1;
  private promptMsg = '';
  private keywords: string[] = [];

  constructor(ed: Editor, host: HTMLElement, dynHost: HTMLElement) {
    this.ed = ed;
    this.el = h('div', { class: 'cmdline' });
    this.history = h('div', { class: 'cmd-history' });
    const bar = h('div', { class: 'cmd-bar' });
    const close = h('button', { class: 'cmd-btn', title: 'Close', html: icon('close', 14) });
    const wrench = h('button', { class: 'cmd-btn', title: 'Toggle history (F2)', html: icon('wrench', 14) });
    wrench.addEventListener('click', () => this.toggleHistory());
    close.addEventListener('click', () => void ed.cancel());
    const recent = h('button', { class: 'cmd-btn', title: 'Recent commands', html: '&#9650;' });
    recent.addEventListener('click', () => this.showRecent(recent));
    this.promptEl = h('span', { class: 'cmd-prompt' });
    this.inputEl = h('span', { class: 'cmd-input' });
    const field = h('div', { class: 'cmd-field' }, h('span', { class: 'cmd-chevron', html: '&#9656;' }), this.promptEl, this.inputEl, h('span', { class: 'cmd-caret' }));
    field.addEventListener('mousedown', (e) => e.preventDefault());
    bar.append(h('div', { class: 'cmd-grip' }), close, wrench, field, recent);
    this.ac = h('div', { class: 'cmd-ac' });
    this.ac.hidden = true;
    this.el.append(this.history, this.ac, bar);
    host.append(this.el);
    this.dyn = h('div', { class: 'dyn-tip' });
    this.dyn.hidden = true;
    dynHost.append(this.dyn);
    this.promptEl.addEventListener('click', (e) => {
      const kw = (e.target as HTMLElement).closest<HTMLElement>('[data-kw]');
      if (kw) ed.submit(kw.dataset.kw!);
    });
  }

  toggleHistory(): void {
    this.expanded = !this.expanded;
    this.el.classList.toggle('expanded', this.expanded);
    this.renderHistory();
  }

  print(text: string, kind: string): void {
    if (!text && kind === 'info') { this.toggleHistory(); return; }
    for (const line of text.split('\n')) this.lines.push({ text: line, kind });
    if (this.lines.length > 600) this.lines.splice(0, this.lines.length - 600);
    this.renderHistory();
  }

  private renderHistory(): void {
    const show = this.expanded ? this.lines.slice(-40) : this.lines.slice(-3);
    // Exposed for the headless UI tests (test/ui-shot.mjs).
    (window as unknown as { __cmdlog?: string[] }).__cmdlog = this.lines.map((l) => l.text);
    this.history.innerHTML = show.map((l) => `<div class="hl ${l.kind}">${escapeHtml(l.text)}</div>`).join('');
    this.history.scrollTop = this.history.scrollHeight;
  }

  setPrompt(msg: string, keywords: string[]): void {
    this.promptMsg = msg;
    this.keywords = keywords;
    // Render [Kw1/Kw2] with clickable options and the shortcut letters highlighted.
    let html = escapeHtml(msg);
    const m = /\[([^\]]+)\]/.exec(msg);
    if (m && keywords.length) {
      const parts = m[1].split('/').map((p) => {
        const kw = keywords.find((k) => k === p) ?? keywords.find((k) => p.startsWith(k)) ?? p;
        const shortcut = kwShortcut(kw);
        const label = escapeHtml(p).replace(/[A-Z]+/, (caps) => (caps === shortcut || shortcut.startsWith(caps) ? `<u>${caps}</u>` : caps));
        return `<span class="kw" data-kw="${escapeHtml(shortcut)}">${label}</span>`;
      });
      html = escapeHtml(msg.slice(0, m.index)) + '[' + parts.join('/') + ']' + escapeHtml(msg.slice(m.index + m[0].length));
    }
    this.promptEl.innerHTML = html;
    this.el.classList.toggle('idle', msg === 'Type a command');
    this.updateDyn();
  }

  setInput(text: string): void {
    this.inputEl.textContent = text;
    this.updateAutocomplete(text);
    this.updateDyn();
  }

  private updateAutocomplete(text: string): void {
    if (this.ed.prompt || !text || /[\s,@<]/.test(text) || /^[\d.-]/.test(text)) { this.ac.hidden = true; this.acItems = []; return; }
    const t = text.toUpperCase();
    const names = new Set<string>();
    for (const [alias, name] of this.ed.aliases) if (alias.startsWith(t)) names.add(name);
    for (const name of this.ed.commands.keys()) if (name.startsWith(t) && name !== 'GRIP') names.add(name);
    const exact = this.ed.resolveCommand(t)?.name;
    const list = [...names].sort((a, b) => (a === exact ? -1 : b === exact ? 1 : a.length - b.length || a.localeCompare(b))).slice(0, 10);
    this.acItems = list;
    this.acIndex = -1;
    if (!list.length) { this.ac.hidden = true; return; }
    this.ac.innerHTML = '';
    for (const n of list) {
      const d = this.ed.commands.get(n)!;
      const it = h('div', { class: 'ac-item', html: `${icon(CMD_ICONS[n] ?? 'help', 18)}<span class="ac-name">${n}</span><span class="ac-desc">${escapeHtml(d.desc.split(': ')[1] ?? '')}</span>` });
      it.addEventListener('mousedown', (e) => { e.preventDefault(); this.ed.setInput(''); void this.ed.runCommand(n); });
      this.ac.append(it);
    }
    this.ac.hidden = false;
  }

  /** Arrow keys in the autocomplete list; returns true if handled. */
  navigate(dir: 1 | -1): boolean {
    if (this.ac.hidden || !this.acItems.length) return false;
    this.acIndex = (this.acIndex + dir + this.acItems.length) % this.acItems.length;
    [...this.ac.children].forEach((c, i) => c.classList.toggle('active', i === this.acIndex));
    this.ed.setInput(this.acItems[this.acIndex]);
    this.ac.hidden = false;
    [...this.ac.children].forEach((c, i) => c.classList.toggle('active', i === this.acIndex));
    return true;
  }

  private showRecent(anchor: HTMLElement): void {
    const recent = [...new Set(this.lines.filter((l) => l.kind === 'cmd' && l.text.startsWith('Command: ')).map((l) => l.text.slice(9)).reverse())].slice(0, 10);
    showMenu(recent.map((r) => ({ label: r, icon: icon(CMD_ICONS[r] ?? 'help', 18), action: () => void this.ed.runCommand(r) })), anchor);
  }

  /** Dynamic input tooltip near the cursor (F12). */
  updateDyn(): void {
    const ed = this.ed;
    const c = ed.cursorScreen;
    const show = ed.settings.dyn && c && (ed.prompt !== null || ed.input.length > 0);
    if (!show) { this.dyn.hidden = true; return; }
    const read = ed.dynReadout();
    const typed = ed.input;
    let html = '';
    if (ed.prompt) html += `<span class="dyn-msg">${escapeHtml(this.promptMsg.replace(/\s*\[.*\]/, '').replace(/:$/, ''))}</span>`;
    if (typed) html += `<span class="dyn-input">${escapeHtml(typed)}</span>`;
    else if (read && ed.prompt?.kind === 'point') html += `<span class="dyn-input ro">${escapeHtml(read)}</span>`;
    else if (ed.prompt?.kind === 'point' && !read) html += `<span class="dyn-input ro">${ed.cursorPt.x.toFixed(4)}, ${ed.cursorPt.y.toFixed(4)}</span>`;
    if (this.keywords.length && ed.prompt) html += `<span class="dyn-kw">&#9660;</span>`;
    this.dyn.innerHTML = html;
    this.dyn.hidden = false;
    this.dyn.style.left = c!.x + 22 + 'px';
    this.dyn.style.top = c!.y + 22 + 'px';
  }
}

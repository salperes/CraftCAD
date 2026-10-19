// Application shell: builds the workspace, wires the editor to the UI and files.

import './styles.css';
import { Editor, type EditorUI, type Settings } from './app/editor.ts';
import { registerCommands } from './app/commands/index.ts';
import { Ribbon, escapeHtml } from './ui/ribbon.ts';
import { CommandLine } from './ui/cmdline.ts';
import { PropertiesPalette } from './ui/properties.ts';
import { icon } from './ui/icons.ts';
import { h, showMenu, tooltip, type MenuEntry } from './ui/dom.ts';
import { layerManager, pickAci, chooseFromList, hatchOptions, editTextInPlace, confirmDialog } from './ui/dialogs.ts';
import { openFile, saveDxfString } from './io/files.ts';
import { fmtNum } from './core/geom.ts';
import { ALL_SNAPS, SNAP_LABELS } from './app/snap.ts';

// ---------------------------------------------------------------------------
// Layout

const app = document.getElementById('app')!;
const titlebar = h('div', { class: 'titlebar' });
const ribbonHost = h('div', { class: 'ribbon-host' });
const filetabs = h('div', { class: 'filetabs' });
const workspace = h('div', { class: 'workspace' });
const canvasWrap = h('div', { class: 'canvas-wrap' });
const mainCanvas = h('canvas', { class: 'main-canvas' });
const overlayCanvas = h('canvas', { class: 'overlay-canvas' });
const vpLabel = h('div', { class: 'vp-label', html: '[-][Top][2D Wireframe]' });
const cmdHost = h('div', { class: 'cmd-host' });
const paletteHost = h('div', { class: 'palette-host' });
const bottombar = h('div', { class: 'bottombar' });
canvasWrap.append(mainCanvas, overlayCanvas, vpLabel, cmdHost);
workspace.append(canvasWrap, paletteHost);
app.append(titlebar, ribbonHost, filetabs, workspace, bottombar);

const ed = new Editor(mainCanvas, overlayCanvas);
registerCommands(ed);
const ribbon = new Ribbon(ed, ribbonHost);
ribbon.pickColor = (c) => pickAci(c);
const cmdline = new CommandLine(ed, cmdHost, canvasWrap);
const props = new PropertiesPalette(ed, paletteHost);

// ---------------------------------------------------------------------------
// Title bar & quick access toolbar

const appBtn = h('button', { class: 'app-btn', title: 'Application menu', html: '<span class="logo">C</span>' });
const qat = h('div', { class: 'qat' });
const qatItems: [string, string, string][] = [
  ['new', 'NEW', 'New (Ctrl+N)'], ['open', 'OPEN', 'Open (Ctrl+O)'], ['save', 'QSAVE', 'Save (Ctrl+S)'], ['saveAs', 'SAVEAS', 'Save As (Ctrl+Shift+S)'],
  ['undo', 'UNDO', 'Undo (Ctrl+Z)'], ['redo', 'REDO', 'Redo (Ctrl+Y)'],
];
for (const [ico, cmd, tip] of qatItems) {
  const b = h('button', { class: 'qat-btn', html: icon(ico, 18) });
  b.addEventListener('click', () => void ed.runCommand(cmd));
  tooltip(b, tip, '', cmd);
  qat.append(b);
}
const titleText = h('div', { class: 'title-text' });
const search = h('div', { class: 'title-search', html: `${icon('search', 14)}<span>Type a keyword or command</span>` });
search.addEventListener('click', () => cmdline.print('Type a command name in the command line; press F1 for the command list.', 'info'));
titlebar.append(appBtn, qat, titleText, search);

appBtn.addEventListener('click', () => {
  const entries: MenuEntry[] = [
    { label: 'New', icon: icon('new', 20), action: () => void ed.runCommand('NEW') },
    { label: 'Open…', icon: icon('open', 20), action: () => void ed.runCommand('OPEN') },
    { label: 'Save', icon: icon('save', 20), action: () => void ed.runCommand('QSAVE') },
    { label: 'Save As DXF…', icon: icon('saveAs', 20), action: () => void ed.runCommand('SAVEAS') },
    { sep: true, label: 'Purge', icon: icon('purge', 20), action: () => void ed.runCommand('PURGE') },
    { label: 'Commands (F1)', icon: icon('help', 20), action: () => void ed.runCommand('HELP') },
  ];
  showMenu(entries, appBtn, 'app-menu');
});

// ---------------------------------------------------------------------------
// File tabs

function renderTabs(): void {
  filetabs.innerHTML = '';
  const tab = h('div', { class: 'ftab active' }, h('span', {}, ed.doc.fileName + (ed.doc.modified ? '*' : '')));
  const x = h('span', { class: 'ftab-x', html: '&times;' });
  x.addEventListener('click', () => void ed.runCommand('NEW'));
  tab.append(x);
  const plus = h('div', { class: 'ftab plus', title: 'New drawing' }, '+');
  plus.addEventListener('click', () => void ed.runCommand('NEW'));
  filetabs.append(h('div', { class: 'ftab start', title: 'Start' }, 'Start'), tab, plus);
  titleText.innerHTML = `CraftCAD &nbsp; <b>${escapeHtml(ed.doc.fileName)}</b>`;
  document.title = `${ed.doc.fileName}${ed.doc.modified ? '*' : ''} - CraftCAD`;
}

// ---------------------------------------------------------------------------
// Status bar

const layoutTabs = h('div', { class: 'layout-tabs' });
for (const [name, active] of [['Model', true], ['Layout1', false], ['Layout2', false]] as [string, boolean][]) {
  const t = h('div', { class: 'ltab' + (active ? ' active' : '') }, name);
  if (!active) t.addEventListener('click', () => cmdline.print('Paper space layouts are not supported yet.', 'info'));
  layoutTabs.append(t);
}
const status = h('div', { class: 'statusbar' });
const coords = h('div', { class: 'coords' });
bottombar.append(layoutTabs, coords, status);

interface Toggle { key: keyof Settings; ico: string; title: string; fkey: string; menu?: () => MenuEntry[] }
const toggles: Toggle[] = [
  { key: 'grid', ico: 'grid', title: 'Display drawing grid', fkey: 'F7' },
  { key: 'snap', ico: 'snapMode', title: 'Snap mode', fkey: 'F9', menu: () => [10, 5, 1, 0.5, 0.1].map((s) => ({ label: `Snap spacing ${s}`, checked: ed.settings.snapStep === s, action: () => { ed.settings.snapStep = s; ed.settings.snap = true; updateStatus(); } })) },
  { key: 'ortho', ico: 'ortho', title: 'Restrict cursor orthogonally', fkey: 'F8' },
  {
    key: 'polar', ico: 'polar', title: 'Polar tracking', fkey: 'F10',
    menu: () => [90, 45, 30, 22.5, 18, 15, 10, 5].map((a) => ({ label: `${a}°`, checked: ed.settings.polarInc === a, action: () => { ed.settings.polarInc = a; ed.settings.polar = true; ed.settings.ortho = false; updateStatus(); } })),
  },
  {
    key: 'osnap', ico: 'osnap', title: 'Object snap', fkey: 'F3',
    menu: () => ALL_SNAPS.map((k) => ({
      label: SNAP_LABELS[k], checked: ed.settings.osnapModes.has(k),
      action: () => { if (ed.settings.osnapModes.has(k)) ed.settings.osnapModes.delete(k); else ed.settings.osnapModes.add(k); ed.settings.osnap = true; updateStatus(); },
    })),
  },
  { key: 'dyn', ico: 'dyn', title: 'Dynamic input', fkey: 'F12' },
];
const toggleEls = new Map<string, HTMLElement>();
status.append(h('div', { class: 'sb-model' }, 'MODEL'));
for (const t of toggles) {
  const wrap = h('div', { class: 'sb-item' });
  const btn = h('button', { class: 'sb-btn', html: icon(t.ico, 18) });
  btn.addEventListener('click', () => ed.toggle(t.key));
  tooltip(btn, t.title, `${t.fkey}`);
  wrap.append(btn);
  if (t.menu) {
    const caret = h('button', { class: 'sb-caret', html: '&#9662;' });
    caret.addEventListener('click', () => showMenu(t.menu!(), caret, 'status-menu'));
    wrap.append(caret);
  }
  toggleEls.set(t.key, btn);
  status.append(wrap);
}
const propsBtn = h('button', { class: 'sb-btn', html: icon('properties', 18) });
propsBtn.addEventListener('click', () => props.toggle());
tooltip(propsBtn, 'Properties palette', 'Ctrl+1');
const menuBtn = h('button', { class: 'sb-btn', html: icon('menu', 18) });
menuBtn.addEventListener('click', () => showMenu([
  { label: `Crosshair size: ${ed.renderer.cursorSize}%`, action: () => { ed.renderer.cursorSize = ed.renderer.cursorSize >= 100 ? 5 : ed.renderer.cursorSize === 5 ? 25 : 100; ed.redrawOverlay(); } },
  { label: 'Zoom Extents', action: () => void ed.zoomExtents() },
], menuBtn, 'status-menu'));
status.append(propsBtn, menuBtn);

function updateStatus(): void {
  for (const [k, el] of toggleEls) el.classList.toggle('on', !!(ed.settings as unknown as Record<string, unknown>)[k]);
  ed.redraw();
  ed.updateCursor();
}

// ---------------------------------------------------------------------------
// File handling

type FileHandle = { name: string; createWritable(): Promise<{ write(d: string | Blob): Promise<void>; close(): Promise<void> }> };
let fileHandle: FileHandle | null = null;
const w = window as unknown as {
  showOpenFilePicker?: (o: unknown) => Promise<(FileHandle & { getFile(): Promise<File> })[]>;
  showSaveFilePicker?: (o: unknown) => Promise<FileHandle>;
};

async function confirmDiscard(): Promise<boolean> {
  if (!ed.doc.modified) return true;
  const r = await confirmDialog('CraftCAD', `Save changes to ${ed.doc.fileName}?`, ['Yes', 'No', 'Cancel']);
  if (r === 'Yes') { await saveFile(false); return !ed.doc.modified; }
  return r === 'No';
}

async function loadFile(file: File, handle: FileHandle | null): Promise<void> {
  cmdline.print(`Opening ${file.name} (${(file.size / 1024).toFixed(0)} KB)…`, 'info');
  try {
    const t0 = performance.now();
    if (/\.dwg$/i.test(file.name)) cmdline.print('Converting DWG with LibreDWG…', 'info');
    const r = await openFile(ed.doc, file);
    fileHandle = /\.dxf$/i.test(file.name) ? handle : null;
    if (/\.dwg$/i.test(file.name)) ed.doc.fileName = file.name.replace(/\.dwg$/i, '.dxf');
    ed.selection.clear();
    await ed.zoomExtents();
    cmdline.print(`${r.entities} objects, ${r.layers} layers, ${r.blocks} blocks (${r.version}) loaded in ${((performance.now() - t0) / 1000).toFixed(2)} s`, 'info');
    for (const warn of r.warnings) cmdline.print('  ' + warn, 'info');
    if (/\.dwg$/i.test(file.name)) cmdline.print('DWG opened; it will be saved as DXF (DWG writing is not available in this build).', 'info');
  } catch (err) {
    console.error(err);
    cmdline.print(`Could not open ${file.name}: ${(err as Error).message}`, 'error');
  }
  renderTabs();
  ribbon.refresh();
}

async function openDialog(): Promise<void> {
  if (!(await confirmDiscard())) return;
  if (w.showOpenFilePicker) {
    try {
      const [hd] = await w.showOpenFilePicker({ types: [{ description: 'Drawings', accept: { 'application/dxf': ['.dxf', '.dwg'] } }] });
      await loadFile(await hd.getFile(), hd);
    } catch (e) { if ((e as Error).name !== 'AbortError') cmdline.print(String(e), 'error'); }
    return;
  }
  const inp = h('input', { type: 'file', accept: '.dxf,.dwg' }) as HTMLInputElement;
  inp.addEventListener('change', () => { if (inp.files?.[0]) void loadFile(inp.files[0], null); });
  inp.click();
}

async function saveFile(saveAs: boolean): Promise<void> {
  const text = saveDxfString(ed.doc);
  let name = ed.doc.fileName.replace(/\.(dwg|dxf)$/i, '') + '.dxf';
  try {
    if (!saveAs && fileHandle) {
      const wr = await fileHandle.createWritable();
      await wr.write(text);
      await wr.close();
    } else if (w.showSaveFilePicker) {
      const hd = await w.showSaveFilePicker({ suggestedName: name, types: [{ description: 'AutoCAD R2000 DXF', accept: { 'application/dxf': ['.dxf'] } }] });
      const wr = await hd.createWritable();
      await wr.write(text);
      await wr.close();
      fileHandle = hd;
      name = hd.name;
    } else {
      const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/dxf' })), download: name });
      document.body.append(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
    ed.doc.fileName = name;
    ed.doc.modified = false;
    cmdline.print(`Saved ${name} (AutoCAD R2000 DXF, ${(text.length / 1024).toFixed(0)} KB)`, 'info');
  } catch (e) {
    if ((e as Error).name !== 'AbortError') cmdline.print(`Save failed: ${(e as Error).message}`, 'error');
  }
  renderTabs();
}

let untitled = 1;
async function newDrawing(): Promise<void> {
  if (!(await confirmDiscard())) return;
  ed.doc.reset();
  ed.doc.fileName = `Drawing${++untitled}.dxf`;
  fileHandle = null;
  ed.selection.clear();
  ed.view.fit({ minX: 0, minY: 0, maxX: 420, maxY: 297 });
  ed.doc.emit('all');
  renderTabs();
}

canvasWrap.addEventListener('dragover', (e) => { e.preventDefault(); canvasWrap.classList.add('drop'); });
canvasWrap.addEventListener('dragleave', () => canvasWrap.classList.remove('drop'));
canvasWrap.addEventListener('drop', async (e) => {
  e.preventDefault();
  canvasWrap.classList.remove('drop');
  const f = e.dataTransfer?.files?.[0];
  if (f && (await confirmDiscard())) await loadFile(f, null);
});
window.addEventListener('beforeunload', (e) => { if (ed.doc.modified) e.preventDefault(); });

// ---------------------------------------------------------------------------
// Editor UI bridge

const ui: EditorUI = {
  onPrompt: (msg, kws) => cmdline.setPrompt(msg, kws),
  onInput: (t) => cmdline.setInput(t),
  print: (line, kind) => cmdline.print(line, kind ?? 'info'),
  onStatus: () => { updateStatus(); ribbon.refresh(); },
  onSelection: () => { ribbon.refresh(); props.refresh(); },
  onCursor: (p) => { coords.textContent = `${fmtNum(p.x, 4)}, ${fmtNum(p.y, 4)}, 0.0000`; cmdline.updateDyn(); },
  onCommand: (name) => canvasWrap.classList.toggle('in-command', !!name),
  onDocChanged: () => { scheduleUi(); },
  editText: (o) => editTextInPlace(ed, canvasWrap, o),
  contextMenu: (s, items) => {
    const r = canvasWrap.getBoundingClientRect();
    showMenu(items.map((it) => ({ label: it.label, action: it.action, sep: it.sep })), { x: r.left + s.x, y: r.top + s.y });
  },
  openFile: openDialog,
  saveFile,
  newDrawing,
  layerManager: () => layerManager(ed, () => ribbon.refresh()),
  properties: (show) => props.toggle(show),
  chooseFromList,
  hatchOptions: () => hatchOptions(ed),
};
ed.ui = ui;

let uiPending = false;
function scheduleUi(): void {
  if (uiPending) return;
  uiPending = true;
  requestAnimationFrame(() => {
    uiPending = false;
    // Drop selected ids that no longer exist (undo/erase).
    for (const id of [...ed.selection]) if (!ed.doc.get(id)) ed.selection.delete(id);
    ribbon.refresh();
    props.refresh();
    renderTabs();
  });
}

// ---------------------------------------------------------------------------
// Input

const pos = (e: MouseEvent) => {
  const r = overlayCanvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};
overlayCanvas.addEventListener('mousemove', (e) => ed.onMouseMove(pos(e), e.buttons));
overlayCanvas.addEventListener('mousedown', (e) => { e.preventDefault(); (document.activeElement as HTMLElement | null)?.blur?.(); ed.onMouseDown(pos(e), e.button, e.shiftKey); });
window.addEventListener('mouseup', (e) => { if (e.target === overlayCanvas || e.button === 1) ed.onMouseUp(pos(e), e.button, e.shiftKey); });
overlayCanvas.addEventListener('mouseleave', () => ed.onMouseLeave());
overlayCanvas.addEventListener('wheel', (e) => { e.preventDefault(); ed.onWheel(pos(e), e.deltaY); }, { passive: false });
overlayCanvas.addEventListener('dblclick', (e) => ed.onDoubleClick(pos(e)));
overlayCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
overlayCanvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  if (document.querySelector('.modal-back')) {
    // Esc behaves like the dialog's close button so pending prompts resolve.
    if (e.key === 'Escape') ([...document.querySelectorAll<HTMLElement>('.modal-back .modal-x')].pop())?.click();
    return;
  }
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && cmdline.navigate(e.key === 'ArrowUp' ? -1 : 1)) { e.preventDefault(); return; }
  if (e.key === 'Tab' && ed.input) { cmdline.navigate(1); e.preventDefault(); return; }
  if (ed.onKey(e)) e.preventDefault();
});
window.addEventListener('paste', (e) => {
  const text = e.clipboardData?.getData('text');
  if (text && !(e.target as HTMLElement).closest('input,textarea')) ed.setInput(ed.input + text.trim());
});

vpLabel.addEventListener('click', () => showMenu([
  { label: 'Zoom Extents', icon: icon('zoomExtents', 18), action: () => void ed.zoomExtents() },
  { label: 'Zoom Window', icon: icon('zoomWindow', 18), action: () => void ed.runMacro('ZOOM;W') },
  { label: 'Zoom Previous', icon: icon('zoomPrev', 18), action: () => void ed.runMacro('ZOOM;P') },
], vpLabel));

// ---------------------------------------------------------------------------
// Sizing & start

new ResizeObserver(() => {
  const r = canvasWrap.getBoundingClientRect();
  const first = ed.view.w === 800 && ed.view.h === 600;
  ed.renderer.resize(r.width, r.height);
  ed.view.resize(r.width, r.height);
  if (first) ed.view.fit({ minX: 0, minY: 0, maxX: 420, maxY: 297 });
  ed.redraw();
}).observe(canvasWrap);

updateStatus();
renderTabs();
ed.idlePrompt();
cmdline.print('CraftCAD ready. Type a command (LINE, CIRCLE, TRIM…) or press F1 for the list. Open DXF/DWG with Ctrl+O or drag & drop.', 'info');
(window as unknown as { craftcad: Editor }).craftcad = ed;

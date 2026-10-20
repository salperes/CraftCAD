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
import { saveDxfString } from './io/files.ts';
import { openFile } from './io/dwg.ts';
import { converterStatus, serverConvert, SAVE_FORMATS, type SaveFormat } from './io/convert.ts';
import { saveAsDialog } from './ui/saveas.ts';
import { aboutDialog, APP_VERSION } from './ui/about.ts';
import { fmtNum } from './core/geom.ts';
import { ALL_SNAPS, SNAP_LABELS } from './app/snap.ts';
import { editMText, activeTextEditor } from './ui/texteditor.ts';
import { textEditorContext, hatchContext, blockEditorContext } from './ui/contexts.ts';
import { draftingSettings, dimStyleManager, quickSelect } from './ui/settings.ts';
import { plotDialog } from './ui/plot.ts';
import { loadPrefs, watchPrefs } from './app/prefs.ts';

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
const glCanvas = h('canvas', { class: 'gl-canvas' });
const selCanvas = h('canvas', { class: 'sel-canvas' });
const vpLabel = h('div', { class: 'vp-label', html: '[-][Top][2D Wireframe]' });
const cmdHost = h('div', { class: 'cmd-host' });
const paletteHost = h('div', { class: 'palette-host' });
const bottombar = h('div', { class: 'bottombar' });
canvasWrap.append(mainCanvas, glCanvas, selCanvas, overlayCanvas, vpLabel, cmdHost);
workspace.append(canvasWrap, paletteHost);
app.append(titlebar, ribbonHost, filetabs, workspace, bottombar);

const ed = new Editor(mainCanvas, overlayCanvas);
registerCommands(ed);
// WebGL draws solid curves; the 2D canvas keeps text, hatches, dimensions and dashed linetypes.
if (!ed.renderer.enableGL(glCanvas, selCanvas)) { glCanvas.remove(); selCanvas.remove(); }
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
    { sep: true, label: "What's New", icon: icon('list', 20), action: () => aboutDialog('news') },
    { label: `About CraftCAD ${APP_VERSION}`, icon: icon('help', 20), action: () => aboutDialog('about') },
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
  titleText.innerHTML = ed.blockEdit
    ? `CraftCAD &nbsp; <b>Block Editor - ${escapeHtml(ed.blockEdit.name)}</b> &nbsp; (${escapeHtml(ed.doc.fileName)})`
    : `CraftCAD ${APP_VERSION} &nbsp; <b>${escapeHtml(ed.doc.fileName)}</b>`;
  document.title = `${ed.doc.fileName}${ed.doc.modified ? '*' : ''} - CraftCAD ${APP_VERSION}`;
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
  { key: 'grid', ico: 'grid', title: 'Display drawing grid', fkey: 'F7', menu: () => [{ label: 'Grid Settings…', action: () => draftingSettings(ed, updateStatus, 0) }] },
  { key: 'snap', ico: 'snapMode', title: 'Snap mode', fkey: 'F9', menu: () => [...[10, 5, 1, 0.5, 0.1].map((s) => ({ label: `Snap spacing ${s}`, checked: ed.settings.snapStep === s, action: () => { ed.settings.snapStep = s; ed.settings.snap = true; updateStatus(); } })), { sep: true, label: 'Snap Settings…', action: () => draftingSettings(ed, updateStatus, 0) }] },
  { key: 'ortho', ico: 'ortho', title: 'Restrict cursor orthogonally', fkey: 'F8' },
  {
    key: 'polar', ico: 'polar', title: 'Polar tracking', fkey: 'F10',
    menu: () => [...[90, 45, 30, 22.5, 18, 15, 10, 5].map((a) => ({ label: `${a}°`, checked: ed.settings.polarInc === a, action: () => { ed.settings.polarInc = a; ed.settings.polar = true; ed.settings.ortho = false; updateStatus(); } })), { sep: true, label: 'Tracking Settings…', action: () => draftingSettings(ed, updateStatus, 1) }],
  },
  {
    key: 'osnap', ico: 'osnap', title: 'Object snap', fkey: 'F3',
    menu: () => ALL_SNAPS.map((k): MenuEntry => ({
      label: SNAP_LABELS[k], checked: ed.settings.osnapModes.has(k),
      action: () => { if (ed.settings.osnapModes.has(k)) ed.settings.osnapModes.delete(k); else ed.settings.osnapModes.add(k); ed.settings.osnap = true; updateStatus(); },
    })).concat([{ sep: true, label: 'Object Snap Settings…', checked: false, action: () => draftingSettings(ed, updateStatus, 2) }]),
  },
  { key: 'otrack', ico: 'otrack', title: 'Object snap tracking', fkey: 'F11', menu: () => [{ label: 'Object Snap Tracking Settings…', action: () => draftingSettings(ed, updateStatus, 2) }] },
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
  { label: 'Crosshair size', submenu: [5, 10, 25, 50, 100].map((n) => ({ label: `${n}%`, checked: ed.renderer.cursorSize === n, action: () => { ed.renderer.cursorSize = n; ed.redrawOverlay(); } })) },
  { label: 'Drafting Settings…', action: () => draftingSettings(ed, updateStatus, 4) },
  { label: 'Plot…', action: () => void ed.runCommand('PLOT') },
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
/** Format the current drawing is saved in (null = choose default on first save). */
let currentFormat: SaveFormat | null = null;
const fmt = (id: string) => SAVE_FORMATS.find((f) => f.id === id)!;
const DWG_VERSION_FMT: Record<string, string> = { AC1032: 'dwg2018', AC1027: 'dwg2013', AC1024: 'dwg2010', AC1021: 'dwg2007', AC1018: 'dwg2004', AC1015: 'dwg2000' };
const w = window as unknown as {
  showOpenFilePicker?: (o: unknown) => Promise<(FileHandle & { getFile(): Promise<File> })[]>;
  showSaveFilePicker?: (o: unknown) => Promise<FileHandle>;
};

function inBlockEditor(): boolean {
  if (!ed.blockEdit) return false;
  cmdline.print('Close the Block Editor (BCLOSE) first.', 'error');
  return true;
}

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
    const isDwg = /\.dwg$/i.test(file.name);
    const head = isDwg ? new TextDecoder('latin1').decode(new Uint8Array(await file.slice(0, 6).arrayBuffer())) : '';
    const r = await openFile(ed.doc, file, (m) => cmdline.print(m, 'info'));
    fileHandle = handle;
    currentFormat = isDwg ? fmt(DWG_VERSION_FMT[head] ?? 'dwg2018') : fmt('dxf2000');
    ed.selection.clear();
    await ed.zoomExtents();
    cmdline.print(`${r.entities} objects, ${r.layers} layers, ${r.blocks} blocks (${r.version}, via ${r.via}) loaded in ${((performance.now() - t0) / 1000).toFixed(2)} s`, 'info');
    for (const warn of r.warnings) cmdline.print('  ' + warn, 'info');
    if (isDwg && !(await converterStatus()).available) cmdline.print('No DWG converter found: saving will use DXF. Install ODA File Converter to save DWG.', 'info');
  } catch (err) {
    console.error(err);
    cmdline.print(`Could not open ${file.name}: ${(err as Error).message}`, 'error');
  }
  renderTabs();
  ribbon.refresh();
}

async function openDialog(): Promise<void> {
  if (inBlockEditor() || !(await confirmDiscard())) return;
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
  if (inBlockEditor()) return;
  const st = await converterStatus();
  let f = currentFormat ?? (st.available ? fmt('dwg2018') : fmt('dxf2000'));
  if (!f.native && !st.available) {
    cmdline.print('DWG saving needs ODA File Converter (or AutoCAD) on this computer; choose a DXF format or install the converter.', 'error');
    saveAs = true;
  }
  let name = ed.doc.fileName.replace(/\.(dwg|dxf)$/i, '') + '.' + f.ext;
  // QSAVE writes silently only to a file handle in the same format; otherwise ask like AutoCAD.
  const silent = !saveAs && fileHandle && fileHandle.name.toLowerCase().endsWith('.' + f.ext);
  if (!silent) {
    const r = await saveAsDialog(name, f, st);
    if (!r) return;
    name = r.name;
    f = r.fmt;
  }
  try {
    const t0 = performance.now();
    const text = saveDxfString(ed.doc);
    let data: string | Uint8Array = text;
    if (!f.native) {
      cmdline.print(`Converting to ${f.label.replace(/ \(.*/, '')} with ${st.engine}…`, 'info');
      data = await serverConvert(new TextEncoder().encode(text), 'dxf', f.ext, f.version);
    }
    const blob = new Blob([data as BlobPart], { type: 'application/octet-stream' });
    if (silent && fileHandle) {
      const wr = await fileHandle.createWritable();
      await wr.write(blob);
      await wr.close();
    } else if (w.showSaveFilePicker) {
      const hd = await w.showSaveFilePicker({ suggestedName: name, types: [{ description: f.label, accept: { 'application/octet-stream': ['.' + f.ext] } }] });
      const wr = await hd.createWritable();
      await wr.write(blob);
      await wr.close();
      fileHandle = hd;
      name = hd.name;
    } else {
      const a = h('a', { href: URL.createObjectURL(blob), download: name });
      document.body.append(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
    ed.doc.fileName = name;
    ed.doc.modified = false;
    currentFormat = f;
    cmdline.print(`Saved ${name} (${f.label.replace(/ \(.*/, '')}, ${(blob.size / 1024).toFixed(0)} KB) in ${((performance.now() - t0) / 1000).toFixed(1)} s`, 'info');
  } catch (e) {
    if ((e as Error).name !== 'AbortError') cmdline.print(`Save failed: ${(e as Error).message}`, 'error');
  }
  renderTabs();
}

let untitled = 1;
async function newDrawing(): Promise<void> {
  if (inBlockEditor() || !(await confirmDiscard())) return;
  ed.doc.reset();
  ed.doc.fileName = `Drawing${++untitled}.dwg`;
  fileHandle = null;
  currentFormat = null;
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
  onStatus: () => { updateStatus(); ribbon.refresh(); updateContext(); renderTabs(); },
  onSelection: () => { ribbon.refresh(); props.refresh(); updateContext(); },
  onCursor: (p) => { coords.textContent = `${fmtNum(p.x, 4)}, ${fmtNum(p.y, 4)}, 0.0000`; cmdline.updateDyn(); },
  onCommand: (name) => { canvasWrap.classList.toggle('in-command', !!name); updateContext(); },
  onDocChanged: () => { scheduleUi(); },
  editText: (o) => editTextInPlace(ed, canvasWrap, o),
  contextMenu: (s, items) => {
    const r = canvasWrap.getBoundingClientRect();
    showMenu(items, { x: r.left + s.x, y: r.top + s.y }, 'shortcut-menu');
  },
  openFile: openDialog,
  saveFile,
  newDrawing,
  layerManager: () => layerManager(ed, () => ribbon.refresh()),
  properties: (show) => props.toggle(show),
  chooseFromList,
  hatchOptions: (init) => hatchOptions(ed, init),
  editMText: (o) => editMText(ed, canvasWrap, o, () => { updateContext(); ribbon.refreshContext(); }),
  draftingSettings: () => draftingSettings(ed, updateStatus),
  plot: () => plotDialog(ed),
  dimStyleManager: () => dimStyleManager(ed, () => ed.redraw()),
  quickSelect: () => quickSelect(ed),
  about: () => aboutDialog('about'),
};

/** Shows the contextual ribbon tab that matches the current state. */
function updateContext(): void {
  if (activeTextEditor()) { ribbon.setContext(textEditorContext(ed, (c) => pickAci(c))); return; }
  if (ed.busy === 'HATCH') { ribbon.setContext(hatchContext(ed, 'create', () => ribbon.refreshContext())); return; }
  const sel = [...ed.selection].map((id) => ed.doc.get(id));
  if (!ed.busy && sel.length && sel.every((e) => e?.type === 'hatch')) {
    const ctx = hatchContext(ed, 'edit', () => ribbon.refreshContext());
    ribbon.setContext(ctx);
    ribbon.refreshContext();
    return;
  }
  if (ed.blockEdit) { ribbon.setContext(blockEditorContext(ed)); return; }
  ribbon.setContext(null);
}
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
// The browser menu would open on top of CraftCAD's own shortcut menu (which appears on
// mouseup, under the cursor), so suppress it everywhere except in editable text fields.
window.addEventListener('contextmenu', (e) => {
  const t = e.target as HTMLElement | null;
  if (t?.closest('input, textarea, [contenteditable="true"]')) return;
  e.preventDefault();
}, { capture: true });
overlayCanvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  if (document.querySelector('.modal-back:not([hidden])')) {
    // Esc behaves like the dialog's close button so pending prompts resolve.
    if (e.key === 'Escape') ([...document.querySelectorAll<HTMLElement>('.modal-back:not([hidden]) .modal-x')].pop())?.click();
    return;
  }
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && cmdline.navigate(e.key === 'ArrowUp' ? -1 : 1)) { e.preventDefault(); return; }
  if (e.key === 'Tab' && ed.input) { cmdline.navigate(1); e.preventDefault(); return; }
  if (ed.onKey(e)) e.preventDefault();
});
window.addEventListener('paste', (e) => {
  const text = e.clipboardData?.getData('text');
  if (text && !(e.target as HTMLElement).closest('input,textarea,[contenteditable]')) ed.setInput(ed.input + text.trim());
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

// Restore user preferences (cursor size, snap/grid/osnap modes, …) before the first frame.
const prefs = loadPrefs(ed);
if (prefs.palette) props.toggle(true);
watchPrefs(ed, () => props.visible);
updateStatus();
renderTabs();
ed.idlePrompt();
cmdline.print('CraftCAD ready. Type a command (LINE, CIRCLE, TRIM…) or press F1 for the list. Open DXF/DWG with Ctrl+O or drag & drop.', 'info');
(window as unknown as { craftcad: Editor }).craftcad = ed;

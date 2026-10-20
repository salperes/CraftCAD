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
import { portalHost } from './io/portal.ts';
import { converterStatus, serverConvert, SAVE_FORMATS, type SaveFormat } from './io/convert.ts';
import { saveAsDialog } from './ui/saveas.ts';
import { aboutDialog, APP_VERSION } from './ui/about.ts';
import { fmtNum } from './core/geom.ts';
import { ALL_SNAPS, SNAP_LABELS } from './app/snap.ts';
import { editMText, activeTextEditor } from './ui/texteditor.ts';
import { textEditorContext, hatchContext, blockEditorContext, layoutContext } from './ui/contexts.ts';
import { draftingSettings, dimStyleManager, quickSelect } from './ui/settings.ts';
import { plotDialog } from './ui/plot.ts';
import { pageSetupDialog } from './ui/pagesetup.ts';
import { copyLayout, deleteLayout, renameLayout, VP_SCALES, scaleLabel } from './app/commands/layout.ts';
import type { Layout } from './core/document.ts';
import { vpScale } from './core/entities.ts';
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
  portal?.setModified(ed.doc.modified);
}

// ---------------------------------------------------------------------------
// Status bar

const layoutTabs = h('div', { class: 'layout-tabs' });

/** Switches tabs, cancelling a running command first (like AutoCAD). */
async function switchTab(l: Layout | null): Promise<void> {
  if (ed.doc.layout === l && ed.activeVp === null) return;
  if (ed.busy) await ed.cancel();
  ed.setLayout(l);
}

/** Inline rename on the tab itself. */
function renameTab(t: HTMLElement, l: Layout): void {
  const inp = h('input', { class: 'ltab-edit', value: l.name }) as HTMLInputElement;
  t.replaceChildren(inp);
  inp.focus();
  inp.select();
  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    const v = inp.value.trim();
    if (save && v && v !== l.name) renameLayout(ed, l, v);
    renderLayoutTabs();
  };
  inp.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') finish(true);
    else if (ev.key === 'Escape') finish(false);
  });
  inp.addEventListener('blur', () => finish(true));
}

function newLayout(): void {
  const l = ed.doc.addLayout(ed.doc.uniqueLayoutName());
  renderLayoutTabs();
  cmdline.print(`Layout "${l.name}" created.`, 'info');
}

function layoutTabMenu(l: Layout | null, t: HTMLElement, at: { x: number; y: number }): void {
  const items: MenuEntry[] = [
    { label: 'New Layout', action: newLayout },
  ];
  if (l) {
    items.push(
      { label: 'Delete', disabled: ed.doc.layouts.length <= 1, action: () => void (async () => { if ((await confirmDialog('CraftCAD', `The layout "${l.name}" will be permanently deleted.`, ['OK', 'Cancel'])) === 'OK') { if (ed.busy) await ed.cancel(); deleteLayout(ed, l); } })() },
      { label: 'Rename', action: () => renameTab(t, l) },
      { label: 'Move or Copy…', submenu: [
        { label: 'Move Left', disabled: ed.doc.layouts.indexOf(l) === 0, action: () => moveLayout(l, -1) },
        { label: 'Move Right', disabled: ed.doc.layouts.indexOf(l) === ed.doc.layouts.length - 1, action: () => moveLayout(l, 1) },
        { sep: true, label: 'Create a Copy', action: () => { copyLayout(ed, l, uniqueCopyName(l.name)); renderLayoutTabs(); } },
      ] },
      { sep: true, label: 'Page Setup Manager…', action: () => void (async () => { await switchTab(l); await pageSetupDialog(ed, l); })() },
      { label: 'Plot…', action: () => void (async () => { await switchTab(l); await ed.runCommand('PLOT'); })() },
    );
  }
  items.push({ sep: true, label: 'Activate Model Tab', disabled: !ed.doc.layout, action: () => void switchTab(null) });
  showMenu(items, at, 'shortcut-menu');
}

function uniqueCopyName(base: string): string {
  for (let i = 2; ; i++) if (!ed.doc.layoutByName(`${base} (${i})`)) return `${base} (${i})`;
}

function moveLayout(l: Layout, d: number): void {
  const a = ed.doc.layouts, i = a.indexOf(l), j = i + d;
  if (j < 0 || j >= a.length) return;
  [a[i], a[j]] = [a[j], a[i]];
  ed.doc.modified = true;
  renderLayoutTabs();
}

function renderLayoutTabs(): void {
  layoutTabs.replaceChildren();
  const tabs: (Layout | null)[] = [null, ...ed.doc.layouts];
  for (const l of tabs) {
    const active = ed.doc.layout === l;
    const t = h('div', { class: 'ltab' + (active ? ' active' : ''), title: l ? `${l.name} — ${l.paper.name}` : 'Model space' }, l?.name ?? 'Model');
    t.addEventListener('click', () => void switchTab(l));
    t.addEventListener('contextmenu', (ev) => { ev.preventDefault(); layoutTabMenu(l, t, { x: ev.clientX, y: ev.clientY }); });
    if (l) t.addEventListener('dblclick', () => renameTab(t, l));
    layoutTabs.append(t);
  }
  const plus = h('div', { class: 'ltab plus', title: 'New layout' }, '+');
  plus.addEventListener('click', newLayout);
  layoutTabs.append(plus);
}
const status = h('div', { class: 'statusbar' });
const coords = h('div', { class: 'coords' });
bottombar.append(layoutTabs, coords, status);
renderLayoutTabs();

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
// MODEL / PAPER: in a layout, toggles between paper space and the last viewport.
const spaceBtn = h('button', { class: 'sb-model' }, 'MODEL');
spaceBtn.addEventListener('click', () => void (async () => {
  if (!ed.doc.layout) return;
  if (ed.busy) await ed.cancel();
  await ed.runCommand(ed.activeVp === null ? 'MSPACE' : 'PSPACE');
})());
tooltip(spaceBtn, 'Model or paper space', 'In a layout, switches between editing the sheet and the model inside a viewport');
// Viewport scale of the active (or selected) viewport.
const vpScaleBtn = h('button', { class: 'sb-vpscale', hidden: true });
vpScaleBtn.addEventListener('click', () => {
  const vp = ed.scaleViewport();
  if (!vp) return;
  const cur = scaleLabel(vpScale(vp));
  showMenu(VP_SCALES.map(([name, k]) => ({ label: name, checked: name === cur, action: () => ed.setViewportScale(vp.id, k) })), vpScaleBtn, 'status-menu');
});
tooltip(vpScaleBtn, 'Viewport scale', 'Scale of the active or selected layout viewport');
status.append(spaceBtn, vpScaleBtn);
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

/** Viewport scale button: shown for the active or the selected layout viewport. */
let vpScaleText = '';
function updateVpScale(): void {
  const vp = ed.scaleViewport();
  const t = vp ? scaleLabel(vpScale(vp)) : '';
  if (t === vpScaleText) return;
  vpScaleText = t;
  vpScaleBtn.hidden = !vp;
  vpScaleBtn.innerHTML = `${escapeHtml(t)} &#9662;`;
}

function updateStatus(): void {
  for (const [k, el] of toggleEls) el.classList.toggle('on', !!(ed.settings as unknown as Record<string, unknown>)[k]);
  spaceBtn.textContent = ed.doc.layout && ed.activeVp === null ? 'PAPER' : 'MODEL';
  spaceBtn.classList.toggle('in-layout', !!ed.doc.layout);
  updateVpScale();
  ed.redraw();
  ed.updateCursor();
}

// ---------------------------------------------------------------------------
// File handling

type FileHandle = { name: string; createWritable(): Promise<{ write(d: string | Blob): Promise<void>; close(): Promise<void> }> };
let fileHandle: FileHandle | null = null;
// MSS Portal embedding: QSAVE of a drawing opened from the portal goes back to the file server (as DXF).
const portal = portalHost();
let portalBound: { readonly: boolean } | null = null;
/** Format the current drawing is saved in (null = choose default on first save). */
let currentFormat: SaveFormat | null = null;
const fmt = (id: string) => SAVE_FORMATS.find((f) => f.id === id)!;
const DWG_VERSION_FMT: Record<string, string> = { AC1032: 'dwg2018', AC1027: 'dwg2013', AC1024: 'dwg2010', AC1021: 'dwg2007', AC1018: 'dwg2004', AC1015: 'dwg2000' };
const w = window as unknown as {
  showOpenFilePicker?: (o: unknown) => Promise<(FileHandle & { getFile(): Promise<File> })[]>;
  showSaveFilePicker?: (o: unknown) => Promise<FileHandle>;
};
/** Electron bridge (electron/preload.cjs); undefined in the browser. */
const desktop = window.craftcadDesktop;

/** File handle that writes to a native path through the Electron bridge. */
function desktopHandle(path: string): FileHandle {
  return {
    name: path.split(/[\\/]/).pop() ?? path,
    createWritable: async () => {
      let data: Uint8Array = new Uint8Array();
      return {
        write: async (d: string | Blob) => { data = typeof d === 'string' ? new TextEncoder().encode(d) : new Uint8Array(await d.arrayBuffer()); },
        close: async () => { await desktop!.writeFile(path, data); },
      };
    },
  };
}

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

async function loadFile(file: File, handle: FileHandle | null, fromPortal: { readonly: boolean } | null = null): Promise<void> {
  portalBound = null;
  cmdline.print(`Opening ${file.name} (${(file.size / 1024).toFixed(0)} KB)…`, 'info');
  try {
    const t0 = performance.now();
    const isDwg = /\.dwg$/i.test(file.name);
    const head = isDwg ? new TextDecoder('latin1').decode(new Uint8Array(await file.slice(0, 6).arrayBuffer())) : '';
    const r = await openFile(ed.doc, file, (m) => cmdline.print(m, 'info'));
    fileHandle = handle;
    portalBound = fromPortal;
    currentFormat = isDwg ? fmt(DWG_VERSION_FMT[head] ?? 'dwg2018') : fmt('dxf2000');
    ed.selection.clear();
    ed.resetSpaces();
    await ed.zoomExtents();
    // Drawings saved with a layout tab open come back on that tab.
    const lay = r.activeLayout ? ed.doc.layoutByName(r.activeLayout) : undefined;
    if (lay) ed.setLayout(lay);
    cmdline.print(`${r.entities} objects${ed.doc.layouts.length ? `, ${ed.doc.layouts.length} layouts` : ''}, ${r.layers} layers, ${r.blocks} blocks (${r.version}, via ${r.via}) loaded in ${((performance.now() - t0) / 1000).toFixed(2)} s`, 'info');
    for (const warn of r.warnings) cmdline.print('  ' + warn, 'info');
    if (fromPortal?.readonly) cmdline.print('Read-only: another user is editing this file. Use Save As to keep a copy on your computer.', 'info');
    if (!fromPortal && isDwg && !(await converterStatus()).available) cmdline.print('No DWG converter found: saving will use DXF. Install ODA File Converter to save DWG.', 'info');
  } catch (err) {
    console.error(err);
    cmdline.print(`Could not open ${file.name}: ${(err as Error).message}`, 'error');
  }
  renderTabs();
  renderLayoutTabs();
  updateStatus();
  ribbon.refresh();
}

async function openDialog(): Promise<void> {
  if (inBlockEditor() || !(await confirmDiscard())) return;
  if (desktop) {
    const r = await desktop.openDialog();
    if (r) await loadFile(new File([r.bytes as BlobPart], r.name), desktopHandle(r.path));
    return;
  }
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
  if (!saveAs && portal && portalBound) { await saveToPortal(); return; }
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
    const r = await saveAsDialog(name, f, st, desktop ? installBundledOda : undefined);
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
    } else if (desktop) {
      const path = await desktop.saveDialog(name, f.ext, f.label);
      if (!path) return;
      const hd = desktopHandle(path);
      const wr = await hd.createWritable();
      await wr.write(blob);
      await wr.close();
      fileHandle = hd;
      name = hd.name;
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
    portalBound = null;
    cmdline.print(`Saved ${name} (${f.label.replace(/ \(.*/, '')}, ${(blob.size / 1024).toFixed(0)} KB) in ${((performance.now() - t0) / 1000).toFixed(1)} s`, 'info');
  } catch (e) {
    if ((e as Error).name !== 'AbortError') cmdline.print(`Save failed: ${(e as Error).message}`, 'error');
  }
  renderTabs();
}

/** Desktop: runs the ODA File Converter installer shipped with CraftCAD. */
async function installBundledOda(): Promise<boolean> {
  if (!desktop) return false;
  const b = await desktop.odaBundled();
  if (!b.installer) { cmdline.print('No bundled ODA File Converter installer in this build.', 'error'); return false; }
  cmdline.print('Starting the ODA File Converter installer…', 'info');
  const r = await desktop.installOda();
  cmdline.print(r.message, r.ok ? 'info' : 'error');
  await converterStatus(true);
  return r.ok;
}

// Desktop: drawings opened from the command line / a second launch.
desktop?.onOpenFile((f) => {
  void (async () => {
    if (inBlockEditor() || !(await confirmDiscard())) return;
    await loadFile(new File([f.bytes as BlobPart], f.name), desktopHandle(f.path));
  })();
});

async function saveToPortal(): Promise<void> {
  if (portalBound?.readonly) { cmdline.print('This file is read-only (another user is editing it). Use Save As to save a copy.', 'error'); return; }
  const text = saveDxfString(ed.doc);
  cmdline.print(`Saving ${ed.doc.fileName} to the file server…`, 'info');
  try {
    const r = await portal!.save(ed.doc.fileName, text);
    if (r.fileName) ed.doc.fileName = r.fileName;
    ed.doc.modified = false;
    // The portal keeps the file's format (a DWG is converted back to DWG there).
    if (/\.dxf$/i.test(ed.doc.fileName)) currentFormat = fmt('dxf2000');
    cmdline.print(r.message ?? `Saved ${ed.doc.fileName} to the file server`, 'info');
  } catch (e) {
    cmdline.print(`Save failed: ${(e as Error).message}`, 'error');
  }
  renderTabs();
}

let untitled = 1;
async function newDrawing(): Promise<void> {
  if (inBlockEditor() || !(await confirmDiscard())) return;
  ed.doc.reset();
  ed.resetSpaces();
  ed.doc.fileName = `Drawing${++untitled}.dwg`;
  fileHandle = null;
  currentFormat = null;
  portalBound = null;
  ed.selection.clear();
  ed.view.fit({ minX: 0, minY: 0, maxX: 420, maxY: 297 });
  ed.doc.emit('all');
  renderTabs();
  renderLayoutTabs();
  updateStatus();
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
  onSelection: () => { ribbon.refresh(); props.refresh(); updateContext(); updateVpScale(); },
  onCursor: (p) => { updateVpScale(); coords.textContent = `${fmtNum(p.x, 4)}, ${fmtNum(p.y, 4)}, 0.0000`; cmdline.updateDyn(); },
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
  onSpace: () => { renderLayoutTabs(); updateStatus(); },
  pageSetup: (l) => pageSetupDialog(ed, l),
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
  if (ed.doc.layout) { ribbon.setContext(layoutContext(ed, () => { const l = ed.doc.layout; if (l) void pageSetupDialog(ed, l); })); ribbon.refreshContext(); return; }
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
portal?.onLoad((f) => void loadFile(new File([f.data], f.fileName), null, { readonly: f.readonly }));

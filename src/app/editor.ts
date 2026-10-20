// Editor: owns selection, prompts, snapping and input; runs AutoCAD-style async commands.

import {
  type Vec, type Box,
  add, sub, dist, mul, norm, dir, angleBetween, polar, rad, deg, normAng, boxFromPts, boxContainsBox, boxIntersects,
  primIntersectsBox, distToPrim, fmtNum, mxTranslate, mxRotate, mxScale, mxMirror, eq, boxValid,
} from '../core/geom.ts';
import {
  type Entity, type NewEntity, type SnapKind, type ViewportEnt,
  entPrims, entHit, entGrips, entMoveGrip, entTransform,
} from '../core/entities.ts';
import { Drawing, type SpaceState, type Layout } from '../core/document.ts';
import { Viewport, vpModelView } from '../view/viewport.ts';
import { Renderer, type OverlayState } from '../view/renderer.ts';
import { findSnap, DEFAULT_SNAPS, type SnapHit } from './snap.ts';

export class CancelError extends Error {
  constructor() { super('*Cancel*'); }
}

export type PointResult =
  | { kind: 'point'; p: Vec }
  | { kind: 'keyword'; kw: string }
  | { kind: 'none' }
  | { kind: 'number'; value: number };

export interface PointOpts {
  base?: Vec;
  keywords?: string[];
  allowNone?: boolean;
  /** Accept a bare number (returned as kind 'number' unless direct distance applies). */
  allowNumber?: boolean;
  /** Direct distance entry along the cursor direction from base (default true when base set). */
  directDistance?: boolean;
  preview?: (p: Vec) => NewEntity[];
  rubber?: boolean;
  defaultValue?: string;
}

export interface EntityPick { kind: 'entity'; id: number; p: Vec }
export type EntityResult = EntityPick | { kind: 'keyword'; kw: string } | { kind: 'none' };

interface PointPrompt { kind: 'point'; msg: string; o: PointOpts; resolve: (r: PointResult) => void; reject: (e: Error) => void }
interface SelectPrompt { kind: 'select'; msg: string; resolve: (ids: number[]) => void; reject: (e: Error) => void; single: boolean; remove: boolean; crossingOnly?: boolean }
interface EntityPrompt { kind: 'entity'; msg: string; filter?: (e: Entity) => boolean; keywords: string[]; allowNone: boolean; resolve: (r: EntityResult) => void; reject: (e: Error) => void }
interface TextPrompt { kind: 'text'; msg: string; keywords: string[]; allowSpaces: boolean; resolve: (s: string) => void; reject: (e: Error) => void }
type Prompt = PointPrompt | SelectPrompt | EntityPrompt | TextPrompt;

export interface CommandDef {
  name: string;
  aliases?: string[];
  desc: string;
  fn: (ed: Editor) => Promise<void>;
  /** Doesn't count for "repeat last command" and doesn't cancel selection. */
  noRepeat?: boolean;
  /** Runs without an undo transaction (e.g. UNDO itself, zoom). */
  noUndo?: boolean;
}

export interface MenuItem {
  label?: string;
  action?: () => void;
  sep?: boolean;
  disabled?: boolean;
  checked?: boolean;
  submenu?: MenuItem[];
}

export interface EditorUI {
  onPrompt(msg: string, keywords: string[]): void;
  onInput(text: string): void;
  print(line: string, kind?: 'info' | 'error' | 'cmd' | 'list'): void;
  onStatus(): void;
  onSelection(): void;
  onCursor(p: Vec): void;
  onCommand(name: string | null): void;
  onDocChanged(): void;
  editText(opts: { initial: string; multiline: boolean; at: Vec; height: number }): Promise<string | null>;
  contextMenu(screen: Vec, items: MenuItem[]): void;
  openFile(): Promise<void>;
  saveFile(saveAs: boolean): Promise<void>;
  newDrawing(): Promise<void>;
  layerManager(): void;
  properties(show?: boolean): void;
  chooseFromList(title: string, items: string[]): Promise<string | null>;
  hatchOptions(init?: { pattern: string; scale: number; angle: number; title?: string }): Promise<{ pattern: string; scale: number; angle: number } | null>;
  editMText(o: { text: string; h: number; attach: number; width: number; rot: number; at: Vec }): Promise<{ text: string; h: number; attach: number; width: number } | null>;
  draftingSettings(): void;
  plot(): Promise<void>;
  dimStyleManager(): void;
  quickSelect(): Promise<number[] | null>;
  about(): void;
  /** Layout tabs or the model/paper state changed. */
  onSpace(): void;
  pageSetup(l: Layout): Promise<void>;
}

export interface Settings {
  osnap: boolean;
  osnapModes: Set<SnapKind>;
  ortho: boolean;
  polar: boolean;
  polarInc: number;
  grid: boolean;
  snap: boolean;
  snapStep: number;
  dyn: boolean;
  aperture: number;
  /** Object snap tracking (OTRACK, F11). */
  otrack: boolean;
}

const GRIP_MODES = ['STRETCH', 'MOVE', 'ROTATE', 'SCALE', 'MIRROR'] as const;

export class Editor {
  doc = new Drawing();
  view = new Viewport();
  renderer: Renderer;
  ui!: EditorUI;
  commands = new Map<string, CommandDef>();
  aliases = new Map<string, string>();

  selection = new Set<number>();
  /** Objects being collected by a select prompt. */
  pending = new Set<number>();
  settings: Settings = {
    osnap: true, osnapModes: new Set(DEFAULT_SNAPS), ortho: false, polar: true, polarInc: 90,
    grid: true, snap: false, snapStep: 10, dyn: true, aperture: 10, otrack: true,
  };

  input = '';
  prompt: Prompt | null = null;
  busy: string | null = null;
  lastCommand: string | null = null;
  lastPoint: Vec = { x: 0, y: 0 };
  clipboard: { ents: NewEntity[]; base: Vec } | null = null;
  /** Filled at command start from the pre-selection. */
  private pickfirst: number[] = [];
  private previousSel: number[] = [];
  private running: Promise<void> | null = null;

  // cursor & feedback
  cursorScreen: Vec | null = null;
  cursorWorld: Vec = { x: 0, y: 0 };
  cursorPt: Vec = { x: 0, y: 0 };
  /** True when cursorPt was snapped to the grid, so the crosshair is drawn there. */
  private gridSnapped = false;
  snapHit: SnapHit | null = null;
  tracking: { from: Vec; to: Vec; full?: boolean }[] = [];
  /** Object snap tracking: acquired points, hover timer, active alignment and its label. */
  acquired: { p: Vec; kind: SnapKind }[] = [];
  private hoverAcq: { p: Vec; kind: SnapKind; t: number; done: boolean } | null = null;
  private acqTimer = 0;
  trackLabel: string | null = null;
  private trackRay: { from: Vec; dir: Vec } | null = null;
  hoverId: number | null = null;
  preview: Entity[] = [];
  private win: { a: Vec; b: Vec; dragged: boolean } | null = null;
  private hoverGrip: { id: number; idx: number; p: Vec } | null = null;
  private hotGrip: Vec | null = null;
  private panning: { x: number; y: number } | null = null;
  private lastMiddle = 0;
  private needsRender = true;
  private needsOverlay = true;
  /** Scratch: grip edit mode cycling */
  gripMode = 0;

  constructor(main: HTMLCanvasElement, overlay: HTMLCanvasElement) {
    this.renderer = new Renderer(main, overlay);
    this.doc.on((kind) => {
      this.needsRender = true;
      this.renderer.glDirty = true;
      // A new or loaded drawing starts on the Model tab.
      if (kind === 'all' && this.activeVp !== null && this.doc.live !== 'model') this.activeVp = null;
      if (kind === 'all' && !this.doc.layout) this.activeVp = null;
      this.ui?.onDocChanged();
    });
    const loop = () => {
      if (this.needsRender) {
        this.needsRender = false;
        this.renderer.grid = this.settings.grid;
        this.renderer.render(this.doc, this.view, this.prompt?.kind === 'select' ? this.pending : this.selection, this.layoutView());
        this.needsOverlay = true;
      }
      if (this.needsOverlay) {
        this.needsOverlay = false;
        this.renderer.renderOverlay(this.doc, this.view, this.overlayState());
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  redraw(): void { this.needsRender = true; }
  redrawOverlay(): void { this.needsOverlay = true; }

  register(def: CommandDef): void {
    this.commands.set(def.name, def);
    for (const a of def.aliases ?? []) this.aliases.set(a.toUpperCase(), def.name);
  }

  resolveCommand(name: string): CommandDef | undefined {
    const n = name.trim().toUpperCase().replace(/^[_.\-']+/, '');
    return this.commands.get(n) ?? this.commands.get(this.aliases.get(n) ?? '');
  }

  print(s: string, kind: 'info' | 'error' | 'cmd' | 'list' = 'info'): void {
    this.ui.print(s, kind);
  }

  // -------------------------------------------------------------------------
  // Command execution

  async runCommand(name: string, fromUser = true): Promise<void> {
    const def = this.resolveCommand(name);
    if (!def && this.isSysvar?.(name)) {
      this.macroQueue = [name.trim().toUpperCase(), ...this.macroQueue];
      return this.runCommand('SETVAR', fromUser);
    }
    if (!def) {
      this.print(`Unknown command "${name.toUpperCase()}".  Press F1 for help.`, 'error');
      return;
    }
    if (this.busy) await this.cancel();
    if (fromUser) this.print(`Command: ${def.name}`, 'cmd');
    this.busy = def.name;
    this.ui.onCommand(def.name);
    this.pickfirst = [...this.selection];
    if (!def.noRepeat) this.lastCommand = def.name;
    if (fromUser && def.name !== 'GRIP') this.recentCommands = [def.name, ...this.recentCommands.filter((c) => c !== def.name)].slice(0, 20);
    if (!def.noUndo) this.doc.begin(def.name);
    const run = (async () => {
      try {
        await def.fn(this);
      } catch (err) {
        if (err instanceof CancelError) this.print('*Cancel*');
        else {
          console.error(err);
          this.print(`Error: ${(err as Error).message}`, 'error');
        }
      } finally {
        if (!def.noUndo) this.doc.commit();
        this.prompt = null;
        this.preview = [];
        this.pending.clear();
        this.tracking = [];
        this.busy = null;
        this.pickfirst = [];
        this.macroQueue = [];
        this.panTool = false;
        this.acquired = [];
        this.trackRay = null;
        this.trackLabel = null;
        this.input = '';
        this.ui.onInput('');
        this.ui.onCommand(null);
        this.idlePrompt();
        this.redraw();
      }
    })();
    this.running = run;
    await run;
    if (this.running === run) this.running = null;
  }

  async cancel(): Promise<void> {
    if (this.prompt) {
      const p = this.prompt;
      this.prompt = null;
      p.reject(new CancelError());
    }
    if (this.running) await this.running.catch(() => {});
  }

  idlePrompt(): void {
    this.ui.onPrompt('Type a command', []);
  }

  /** Selection captured before the command started (pickfirst), consumed once. */
  takePickfirst(): number[] {
    const ids = this.pickfirst.filter((id) => this.doc.get(id));
    this.pickfirst = [];
    if (ids.length) {
      this.selection.clear();
      this.ui.onSelection();
      this.redraw();
    }
    return ids;
  }

  // -------------------------------------------------------------------------
  // Prompts

  private setPrompt(p: Prompt, msg: string, keywords: string[] = []): void {
    this.prompt = p;
    this.ui.onPrompt(msg, keywords);
    this.updateCursor();
    this.redrawOverlay();
    if (this.macroQueue.length) {
      const next = this.macroQueue.shift()!;
      // "\" pauses for user input at this prompt, like AutoCAD menu macros.
      if (next !== '\\') queueMicrotask(() => { if (this.prompt === p) this.submit(next); });
    }
  }

  /** Inputs fed to upcoming prompts, like ribbon macros "^C^C_circle _2p". */
  macroQueue: string[] = [];
  /** PAN tool active: left-drag pans. */
  panTool = false;
  /** One-shot object snap override for the next point (empty set = none). */
  snapOverride: Set<SnapKind> | null = null;
  recentCommands: string[] = [];
  /** Sysvar lookup injected by the command module (typing a sysvar name runs SETVAR). */
  isSysvar?: (name: string) => boolean;
  /** Active block editor session. */
  blockEdit: { name: string; saved: SpaceState; viewState: { cx: number; cy: number; scale: number } } | null = null;

  // -------------------------------------------------------------------------
  // Layouts, paper space and viewports

  /** Layout viewport whose model space is being edited (MSPACE), by entity id. */
  activeVp: number | null = null;
  /** Paper view of the current layout while a viewport is active. */
  readonly paperView = new Viewport();
  /** Model tab view while a layout is shown. */
  private modelView: { cx: number; cy: number; scale: number } | null = null;

  private layoutView(): { layout: Layout; paper: Viewport; activeVp: number | null } | undefined {
    const l = this.doc.layout;
    if (!l || this.blockEdit) return undefined;
    if (this.activeVp === null) return { layout: l, paper: this.view, activeVp: null };
    this.syncViewport();
    return { layout: l, paper: this.paperView, activeVp: this.activeVp };
  }

  /** The active viewport (MSPACE), read from the layout's paper space. */
  activeViewport(): ViewportEnt | null {
    const l = this.doc.layout;
    if (!l || this.activeVp === null) return null;
    const e = this.doc.paperEntities(l).get(this.activeVp);
    return e?.type === 'viewport' ? e : null;
  }

  /** Writes pan/zoom of the editor view back into the active viewport (or undoes it when locked). */
  private syncViewport(): void {
    const vp = this.activeViewport();
    if (!vp) return;
    this.paperView.resize(this.view.w, this.view.h);
    if (vp.locked) { this.applyVp(vp); return; }
    const S = this.paperView.toScreen(vp.c);
    const vc = this.view.toWorld(S);
    const vh = (vp.h * this.paperView.scale) / this.view.scale;
    if (Math.abs(vh - vp.vh) > 1e-9 * vp.vh || dist(vc, vp.vc) > 1e-9 * vh) this.doc.setStored(this.doc.paperEntities(this.doc.layout!), { ...vp, vc, vh });
  }

  /** Sets the editor view to what a viewport shows. */
  private applyVp(vp: ViewportEnt): void {
    this.paperView.resize(this.view.w, this.view.h);
    const mv = vpModelView(this.paperView, vp);
    this.view.cx = mv.cx;
    this.view.cy = mv.cy;
    this.view.scale = mv.scale;
  }

  private snapView(): { cx: number; cy: number; scale: number } {
    return { cx: this.view.cx, cy: this.view.cy, scale: this.view.scale };
  }

  /** Forgets tab views after a new or loaded drawing (which starts on the Model tab). */
  resetSpaces(): void {
    this.activeVp = null;
    this.modelView = null;
  }

  /** Shows the Model tab (null) or a layout tab. */
  setLayout(l: Layout | null): boolean {
    const d = this.doc;
    if (this.blockEdit) { this.print('Close the Block Editor first (BCLOSE).', 'error'); return false; }
    if (l === d.layout) { if (l && this.activeVp !== null) this.exitViewport(); return true; }
    if (this.activeVp !== null) this.exitViewport();
    if (!d.layout) this.modelView = this.snapView();
    else d.layout.view = this.snapView();
    this.clearSelection();
    this.win = null;
    d.activate(l, l ? 'paper' : 'model');
    if (l) {
      if (!l.initialized) this.initLayout(l);
      if (l.view) Object.assign(this.view, l.view);
      else this.fitPaper(l);
    } else if (this.modelView) Object.assign(this.view, this.modelView);
    this.renderer.glDirty = true;
    this.ui.onSpace();
    this.ui.onStatus();
    this.redraw();
    return true;
  }

  fitPaper(l: Layout): void {
    const P = l.paper, [ml, mb] = P.margins;
    this.view.fit({ minX: -ml, minY: -mb, maxX: P.w - ml, maxY: P.h - mb }, 0.06);
  }

  /** First display of an empty layout: one viewport over the printable area showing the model extents. */
  private initLayout(l: Layout): void {
    l.initialized = true;
    const paper = this.doc.paperEntities(l);
    if (paper.size) return;
    const P = l.paper, [ml, mb, mr, mt] = P.margins;
    const pw = P.w - ml - mr, ph = P.h - mb - mt, inset = Math.min(pw, ph) * 0.03;
    this.doc.loadInto(paper, this.newViewport({ x: inset, y: inset }, { x: pw - inset, y: ph - inset }));
  }

  /** Viewport over the box a–b that shows the model extents. */
  newViewport(a: Vec, b: Vec): NewEntity {
    const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const ext = this.doc.extents(this.doc.modelEntities);
    let vc = c, vh = h;
    if (boxValid(ext)) {
      const bw = Math.max(ext.maxX - ext.minX, 1e-9), bh = Math.max(ext.maxY - ext.minY, 1e-9);
      const k = Math.min(w / bw, h / bh) * 0.95;
      vc = { x: (ext.minX + ext.maxX) / 2, y: (ext.minY + ext.maxY) / 2 };
      vh = h / k;
    }
    return { type: 'viewport', c, w, h, vc, vh, layer: this.doc.currentLayer };
  }

  /** Viewport (on, in the current layout) under a screen point; the topmost one wins. */
  viewportAt(s: Vec): ViewportEnt | null {
    const l = this.doc.layout;
    if (!l) return null;
    const p = (this.activeVp !== null ? this.paperView : this.view).toWorld(s);
    let hit: ViewportEnt | null = null;
    for (const e of this.doc.paperEntities(l).values()) {
      if (e.type === 'viewport' && !e.off && this.doc.isVisible(e) && Math.abs(p.x - e.c.x) <= e.w / 2 && Math.abs(p.y - e.c.y) <= e.h / 2) hit = e;
    }
    return hit;
  }

  /** MSPACE: edits model space through a viewport (switches viewports when one is active). */
  enterViewport(id: number): boolean {
    const d = this.doc, l = d.layout;
    if (!l) return false;
    const vp = d.paperEntities(l).get(id);
    if (vp?.type !== 'viewport' || vp.off) return false;
    this.win = null;
    if (this.activeVp !== null) {
      if (this.activeVp === id) return true;
      this.syncViewport();
      this.clearSelection();
      this.activeVp = id;
      this.applyVp(vp);
      this.redraw();
      return true;
    }
    l.view = this.snapView();
    Object.assign(this.paperView, l.view);
    this.clearSelection();
    d.activate(l, 'model');
    this.activeVp = id;
    this.applyVp(vp);
    this.ui.onStatus();
    this.redraw();
    return true;
  }

  /** PSPACE: back to editing the sheet. */
  exitViewport(): void {
    const l = this.doc.layout;
    if (!l || this.activeVp === null) return;
    this.syncViewport();
    this.activeVp = null;
    this.win = null;
    this.clearSelection();
    this.doc.activate(l, 'paper');
    this.view.cx = this.paperView.cx;
    this.view.cy = this.paperView.cy;
    this.view.scale = this.paperView.scale;
    this.ui.onStatus();
    this.redraw();
  }

  /** Sets a viewport's scale (paper units per model unit), keeping its view center. */
  setViewportScale(id: number, k: number): void {
    const l = this.doc.layout;
    if (!l || !(k > 0)) return;
    const paper = this.doc.paperEntities(l);
    const vp = paper.get(id);
    if (vp?.type !== 'viewport') return;
    const nv: ViewportEnt = { ...vp, vh: vp.h / k };
    if (paper === this.doc.entities) {
      const own = !this.doc.inTxn;
      if (own) this.doc.begin('Viewport scale');
      this.doc.update(nv);
      if (own) this.doc.commit();
    } else {
      this.doc.setStored(paper, nv);
      if (id === this.activeVp) this.applyVp(nv);
    }
    this.ui.onStatus();
    this.redraw();
  }

  /** Viewport whose scale the status bar shows: the active one, or a single selected one. */
  scaleViewport(): ViewportEnt | null {
    const a = this.activeViewport();
    if (a) return a;
    if (!this.doc.layout || this.selection.size !== 1) return null;
    const e = this.doc.get([...this.selection][0]);
    return e?.type === 'viewport' ? e : null;
  }

  /** Zooms to a box; inside an active viewport the box fills the viewport. */
  fitView(b: Box, margin = 0.05): void {
    const vp = this.activeViewport();
    if (!vp) { this.view.fit(b, margin); return; }
    if (vp.locked) { this.print('The viewport display is locked.'); return; }
    if (!boxValid(b)) return;
    const bw = Math.max(b.maxX - b.minX, 1e-9), bh = Math.max(b.maxY - b.minY, 1e-9);
    const k = Math.min(vp.w / bw, vp.h / bh) * (1 - margin * 2);
    const nv: ViewportEnt = { ...vp, vc: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }, vh: vp.h / k };
    this.doc.setStored(this.doc.paperEntities(this.doc.layout!), nv);
    this.applyVp(nv);
  }

  /** View that wheel/pan act on: the sheet when the active viewport is locked. */
  private navView(): Viewport {
    return this.activeViewport()?.locked ? this.paperView : this.view;
  }

  private afterNav(): void {
    const vp = this.activeViewport();
    if (vp?.locked) this.applyVp(vp);
  }

  /** Runs "CMD;input;input…" — the command followed by pre-answered prompts. */
  async runMacro(macro: string): Promise<void> {
    const parts = macro.split(';');
    if (this.busy) await this.cancel();
    this.macroQueue = parts.slice(1);
    return this.runCommand(parts[0]);
  }

  getPoint(msg: string, o: PointOpts = {}): Promise<PointResult> {
    return new Promise((resolve, reject) => {
      this.setPrompt({ kind: 'point', msg, o, resolve: (r) => { if (r.kind === 'point') { this.lastPoint = r.p; this.acquired = []; } resolve(r); }, reject }, msg, o.keywords);
    });
  }

  /** Point or null when Enter pressed (if allowNone), keywords returned as string. */
  async point(msg: string, o: PointOpts = {}): Promise<Vec | string | null> {
    const r = await this.getPoint(msg, o);
    if (r.kind === 'point') return r.p;
    if (r.kind === 'keyword') return r.kw;
    if (r.kind === 'number' && o.base) return polar(o.base, angleBetween(o.base, this.cursorPt), r.value);
    return null;
  }

  getSelection(msg = 'Select objects', opts: { single?: boolean; noPickfirst?: boolean; crossingOnly?: boolean } = {}): Promise<number[]> {
    if (!opts.noPickfirst) {
      const pf = this.takePickfirst();
      if (pf.length) {
        this.previousSel = pf;
        return Promise.resolve(pf);
      }
    }
    this.pending.clear();
    return new Promise((resolve, reject) => {
      this.setPrompt({
        kind: 'select', msg, single: !!opts.single, remove: false, crossingOnly: opts.crossingOnly,
        resolve: (ids) => { this.previousSel = ids; resolve(ids); }, reject,
      }, msg + ':');
    });
  }

  getEntity(msg: string, o: { filter?: (e: Entity) => boolean; keywords?: string[]; allowNone?: boolean } = {}): Promise<EntityResult> {
    return new Promise((resolve, reject) => {
      this.setPrompt({ kind: 'entity', msg, filter: o.filter, keywords: o.keywords ?? [], allowNone: !!o.allowNone, resolve, reject }, msg, o.keywords);
    });
  }

  getText(msg: string, o: { keywords?: string[]; allowSpaces?: boolean } = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      this.setPrompt({ kind: 'text', msg, keywords: o.keywords ?? [], allowSpaces: !!o.allowSpaces, resolve, reject }, msg, o.keywords);
    });
  }

  /** Keyword choice with default; returns canonical keyword. */
  async getKeyword(msg: string, keywords: string[], def?: string): Promise<string> {
    for (;;) {
      const t = (await this.getText(msg, { keywords })).trim();
      if (!t && def) return def;
      const kw = matchKeyword(t, keywords);
      if (kw) return kw;
      this.print('Invalid option keyword.', 'error');
    }
  }

  /** Distance: typed number, or picked point(s). */
  async getDistance(msg: string, o: { base?: Vec; def?: number; keywords?: string[]; preview?: (p: Vec) => NewEntity[] } = {}): Promise<number | string> {
    for (;;) {
      const r = await this.getPoint(msg, { base: o.base, keywords: o.keywords, allowNone: o.def !== undefined, allowNumber: true, directDistance: false, rubber: !!o.base, preview: o.preview });
      if (r.kind === 'number') {
        if (r.value < 0) { this.print('Value must be positive.', 'error'); continue; }
        return r.value;
      }
      if (r.kind === 'none') return o.def!;
      if (r.kind === 'keyword') return r.kw;
      if (o.base) return dist(o.base, r.p);
      const p2 = await this.point('Specify second point:', { base: r.p, rubber: true });
      if (p2 && typeof p2 !== 'string') return dist(r.p, p2);
    }
  }

  /** Angle in radians: typed degrees, or picked direction from base. */
  async getAngle(msg: string, o: { base?: Vec; def?: number; keywords?: string[]; preview?: (p: Vec) => NewEntity[] } = {}): Promise<number | string> {
    for (;;) {
      const r = await this.getPoint(msg, { base: o.base, keywords: o.keywords, allowNone: o.def !== undefined, allowNumber: true, directDistance: false, rubber: !!o.base, preview: o.preview });
      if (r.kind === 'number') return rad(r.value);
      if (r.kind === 'none') return o.def!;
      if (r.kind === 'keyword') return r.kw;
      if (o.base) return angleBetween(o.base, r.p);
      const p2 = await this.point('Specify second point:', { base: r.p, rubber: true });
      if (p2 && typeof p2 !== 'string') return angleBetween(r.p, p2);
    }
  }

  async getNumber(msg: string, o: { def?: number; integer?: boolean; min?: number } = {}): Promise<number> {
    for (;;) {
      const t = (await this.getText(msg)).trim();
      if (!t && o.def !== undefined) return o.def;
      const v = parseNumber(t);
      if (v === null || (o.integer && !Number.isInteger(v)) || (o.min !== undefined && v < o.min)) {
        this.print(o.integer ? 'Requires an integer value.' : 'Requires numeric value.', 'error');
        continue;
      }
      return v;
    }
  }

  // -------------------------------------------------------------------------
  // Text input

  setInput(s: string): void {
    this.input = s;
    this.ui.onInput(s);
    this.redrawOverlay();
  }

  /** Handles Enter/Space on the command line. */
  submit(textArg?: string): void {
    const text = (textArg ?? this.input).trim();
    this.setInput('');
    const p = this.prompt;
    if (!p) {
      if (!text) {
        if (this.lastCommand) void this.runCommand(this.lastCommand);
        return;
      }
      void this.runCommand(text);
      return;
    }
    if (text) this.print(`${p.msg} ${text}`, 'cmd');
    switch (p.kind) {
      case 'text': {
        this.prompt = null;
        const kw = p.keywords.length ? matchKeyword(text, p.keywords) : null;
        p.resolve(kw ?? text);
        return;
      }
      case 'point': return this.submitPoint(p, text);
      case 'entity': {
        if (!text) {
          if (p.allowNone) { this.prompt = null; p.resolve({ kind: 'none' }); }
          return;
        }
        const kw = matchKeyword(text, p.keywords);
        if (kw) { this.prompt = null; p.resolve({ kind: 'keyword', kw }); return; }
        this.print('Invalid option keyword.', 'error');
        return;
      }
      case 'select': return this.submitSelect(p, text);
    }
  }

  private submitPoint(p: PointPrompt, text: string): void {
    const o = p.o;
    if (!text) {
      if (o.allowNone) { this.prompt = null; p.resolve({ kind: 'none' }); }
      return;
    }
    const kw = o.keywords ? matchKeyword(text, o.keywords) : null;
    if (kw) { this.prompt = null; p.resolve({ kind: 'keyword', kw }); return; }
    const ov = SNAP_OVERRIDES[text.toUpperCase()];
    if (ov !== undefined) {
      this.snapOverride = ov ? new Set([ov]) : new Set();
      this.print(ov ? `  of (${text.toUpperCase()})` : '  object snap: none');
      this.updateCursor();
      return;
    }
    const pt = parsePoint(text, this.lastPoint);
    if (pt) { this.prompt = null; p.resolve({ kind: 'point', p: pt }); return; }
    const n = parseNumber(text);
    if (n !== null) {
      const direct = o.directDistance ?? !!o.base;
      if (this.trackRay && o.directDistance !== false) {
        this.prompt = null;
        p.resolve({ kind: 'point', p: add(this.trackRay.from, mul(this.trackRay.dir, n)) });
        return;
      }
      if (direct && o.base) {
        const a = angleBetween(o.base, this.cursorPt);
        const target = dist(o.base, this.cursorPt) < 1e-12 ? 0 : a;
        this.prompt = null;
        p.resolve({ kind: 'point', p: polar(o.base, target, n) });
        return;
      }
      if (o.allowNumber) { this.prompt = null; p.resolve({ kind: 'number', value: n }); return; }
    }
    this.print('Invalid point.', 'error');
  }

  private submitSelect(p: SelectPrompt, text: string): void {
    if (!text) {
      this.prompt = null;
      const ids = [...this.pending];
      this.pending.clear();
      this.redraw();
      p.resolve(ids);
      return;
    }
    const t = text.toUpperCase();
    const add = (ids: Iterable<number>) => {
      for (const id of ids) { const e = this.doc.get(id); if (e && this.doc.isEditable(e) && this.doc.isVisible(e)) this.pending.add(id); }
      this.print(`${this.pending.size} found`);
      this.redraw();
    };
    if (t === 'ALL') add(this.doc.entities.keys());
    else if (t === 'L') { const last = [...this.doc.entities.keys()].pop(); if (last !== undefined) add([last]); }
    else if (t === 'P') add(this.previousSel);
    else if (t === 'R') { p.remove = true; this.ui.onPrompt('Remove objects:', []); }
    else if (t === 'A') { p.remove = false; this.ui.onPrompt('Select objects:', []); }
    else this.print('*Invalid selection*  Expects a point or Window/Last/Crossing/ALL/Add/Remove/Previous', 'error');
  }

  // -------------------------------------------------------------------------
  // Cursor & snapping

  private overlayState(): OverlayState {
    const p = this.prompt;
    const mode: OverlayState['cursorMode'] = !this.cursorScreen ? 'none' : !p ? 'idle' : p.kind === 'point' ? 'point' : p.kind === 'text' ? 'point' : 'select';
    const grips: OverlayState['grips'] = [];
    if (!p && this.selection.size && this.selection.size <= 200) {
      for (const id of this.selection) {
        const e = this.doc.get(id);
        if (!e || !this.doc.isVisible(e)) continue;
        for (const g of entGrips(e)) {
          const hot = this.hotGrip && eq(this.hotGrip, g, 1e-9);
          const hover = this.hoverGrip && eq(this.hoverGrip.p, g, 1e-9);
          grips.push({ p: g, state: hot ? 'hot' : hover ? 'hover' : 'cold' });
        }
      }
    }
    if (this.hotGrip && p) grips.push({ p: this.hotGrip, state: 'hot' });
    let hover: Entity | null = null;
    if (this.hoverId !== null && (!p || p.kind === 'select' || p.kind === 'entity')) hover = this.doc.get(this.hoverId) ?? null;
    const base = p?.kind === 'point' ? p.o.base : undefined;
    return {
      cursor: this.cursorScreen && this.gridSnapped ? this.view.toScreen(this.cursorPt) : this.cursorScreen,
      cursorMode: mode,
      snap: this.snapHit && (p?.kind === 'point') ? this.snapHit : null,
      tracking: this.tracking,
      acquired: p?.kind === 'point' ? this.acquired.map((a) => a.p) : [],
      trackLabel: p?.kind === 'point' ? this.trackLabel : null,
      window: this.win ? { a: this.win.a, b: this.win.b, crossing: this.win.b.x < this.win.a.x || !!(p?.kind === 'select' && p.crossingOnly) } : null,
      preview: this.preview,
      rubber: base && p?.kind === 'point' && p.o.rubber ? { from: base, to: this.cursorPt } : null,
      grips,
      hover,
      showUcs: true,
    };
  }

  /** Recomputes snapped cursor point, preview and hover state. */
  updateCursor(): void {
    if (!this.cursorScreen) return;
    const w = this.view.toWorld(this.cursorScreen);
    this.cursorWorld = w;
    const p = this.prompt;
    this.snapHit = null;
    this.tracking = [];
    this.trackLabel = null;
    this.trackRay = null;
    this.gridSnapped = false;
    let pt = w;
    if (p?.kind === 'point' || (!p && this.hotGrip)) {
      const base = p?.kind === 'point' ? p.o.base ?? null : null;
      const modes = this.snapOverride ?? this.settings.osnapModes;
      if ((this.settings.osnap || this.snapOverride) && modes.size) {
        const hit = findSnap(this.doc, w, this.view.px(this.settings.aperture), modes, base);
        if (hit) { this.snapHit = hit; pt = hit.p; }
      }
      const tracking = p?.kind === 'point' && this.settings.otrack && this.settings.osnap;
      if (tracking) this.acquireHover(this.snapHit);
      const tr = tracking && !this.snapHit ? this.trackPoint(w, base) : null;
      if (tr) pt = tr;
      else if (!this.snapHit && this.settings.snap) {
        // Grid snap moves the crosshair; ORTHO still applies relative to the base point.
        const g = this.gridSnap(w);
        pt = base && this.settings.ortho ? this.constrain(base, g) : g;
        this.gridSnapped = true;
      } else if (!this.snapHit && base) pt = this.constrain(base, w);
    } else if (this.settings.snap && p?.kind !== 'text') {
      pt = this.gridSnap(w);
      this.gridSnapped = true;
    }
    this.cursorPt = pt;
    // hover highlight
    if (!p || p.kind === 'select' || p.kind === 'entity') {
      const ps = this.gridSnapped ? this.view.toScreen(pt) : this.cursorScreen;
      const id = this.pickAt(ps, p?.kind === 'entity' ? p.filter : undefined);
      this.hoverId = id;
    } else this.hoverId = null;
    this.hoverGrip = !p ? this.gripAt(this.gridSnapped ? this.view.toScreen(pt) : this.cursorScreen) : null;
    // preview
    if (p?.kind === 'point' && p.o.preview) {
      try {
        this.preview = p.o.preview(pt).map((e, i) => ({ layer: this.doc.currentLayer, color: this.doc.currentColor, ltype: this.doc.currentLtype, ...e, id: -1 - i }) as Entity);
      } catch (err) {
        console.error(err);
        this.preview = [];
      }
    } else if (p?.kind !== 'point') this.preview = [];
    this.ui.onCursor(pt);
    this.redrawOverlay();
  }

  /** Acquires a snap point for tracking after hovering it briefly; hovering again releases it. */
  private acquireHover(hit: SnapHit | null): void {
    if (!hit || hit.kind === 'nea' || hit.kind === 'per' || hit.kind === 'tan') { this.hoverAcq = null; return; }
    const now = performance.now();
    const h = this.hoverAcq;
    if (h && eq(h.p, hit.p, 1e-9)) {
      if (!h.done && now - h.t >= ACQUIRE_MS) {
        h.done = true;
        const i = this.acquired.findIndex((a) => eq(a.p, hit.p, 1e-9));
        if (i >= 0) this.acquired.splice(i, 1);
        else {
          this.acquired.push({ p: hit.p, kind: hit.kind });
          if (this.acquired.length > 7) this.acquired.shift();
        }
      }
      return;
    }
    this.hoverAcq = { p: hit.p, kind: hit.kind, t: now, done: false };
    clearTimeout(this.acqTimer);
    this.acqTimer = window.setTimeout(() => this.updateCursor(), ACQUIRE_MS + 20);
  }

  /**
   * Aligns the cursor to horizontal/vertical lines through acquired points (and the polar
   * ray from the base point), snapping to the intersection of two such lines.
   */
  private trackPoint(w: Vec, base: Vec | null): Vec | null {
    const thresh = this.view.px(8);
    interface TLine { o: Vec; d: Vec; label: string; polar?: boolean }
    const lines: TLine[] = [];
    for (const a of this.acquired) {
      const name = SNAP_NAMES[a.kind] ?? 'Point';
      lines.push({ o: a.p, d: { x: 1, y: 0 }, label: name }, { o: a.p, d: { x: 0, y: 1 }, label: name });
    }
    if (!lines.length) return null;
    if (base && this.settings.polar) {
      const inc = rad(this.settings.polarInc);
      const a = Math.round(Math.atan2(w.y - base.y, w.x - base.x) / inc) * inc;
      lines.push({ o: base, d: dir(a), label: 'Polar', polar: true });
    } else if (base && this.settings.ortho) {
      lines.push({ o: base, d: { x: 1, y: 0 }, label: 'Ortho', polar: true }, { o: base, d: { x: 0, y: 1 }, label: 'Ortho', polar: true });
    }
    const near = lines
      .map((l) => {
        const t = (w.x - l.o.x) * l.d.x + (w.y - l.o.y) * l.d.y;
        const q = add(l.o, mul(l.d, t));
        return { l, t, q, dd: dist(q, w) };
      })
      .filter((c) => c.dd < thresh && (!c.l.polar || c.t > 0))
      .sort((a, b) => a.dd - b.dd);
    if (!near.length) return null;
    const best = near[0];
    // Intersection with a second, non-parallel alignment line near the cursor.
    for (const c of near.slice(1)) {
      const den = best.l.d.x * c.l.d.y - best.l.d.y * c.l.d.x;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((c.l.o.x - best.l.o.x) * c.l.d.y - (c.l.o.y - best.l.o.y) * c.l.d.x) / den;
      const x = add(best.l.o, mul(best.l.d, t));
      if (dist(x, w) > thresh * 1.6) continue;
      this.tracking = [{ from: best.l.o, to: x, full: !best.l.polar }, { from: c.l.o, to: x, full: !c.l.polar }];
      this.trackLabel = `${best.l.label} ${trackText(best.l.o, x)}, ${c.l.label} ${trackText(c.l.o, x)}`;
      this.trackRay = null;
      return x;
    }
    this.tracking = [{ from: best.l.o, to: best.q, full: !best.l.polar }];
    this.trackLabel = `${best.l.label}: ${trackText(best.l.o, best.q)}`;
    const len = dist(best.l.o, best.q);
    this.trackRay = len > 1e-12 ? { from: best.l.o, dir: mul(sub(best.q, best.l.o), 1 / len) } : null;
    return best.q;
  }

  private gridSnap(p: Vec): Vec {
    const s = this.settings.snapStep;
    return { x: Math.round(p.x / s) * s, y: Math.round(p.y / s) * s };
  }

  /** Applies ORTHO or POLAR tracking relative to base. */
  private constrain(base: Vec, w: Vec): Vec {
    const d = sub(w, base);
    const L = Math.hypot(d.x, d.y);
    if (L < 1e-12) return w;
    if (this.settings.ortho) {
      return Math.abs(d.x) >= Math.abs(d.y) ? { x: w.x, y: base.y } : { x: base.x, y: w.y };
    }
    if (this.settings.polar) {
      const inc = rad(this.settings.polarInc);
      const a = Math.atan2(d.y, d.x);
      const snapped = Math.round(a / inc) * inc;
      const perpPx = Math.abs(Math.sin(a - snapped)) * L * this.view.scale;
      if (perpPx < 8) {
        const u = dir(snapped);
        const proj = add(base, mul(u, Math.cos(a - snapped) * L));
        this.tracking = [{ from: base, to: proj }];
        return proj;
      }
    }
    return w;
  }

  /** Topmost entity under the pickbox. */
  pickAt(s: Vec, filter?: (e: Entity) => boolean): number | null {
    const w = this.view.toWorld(s);
    const tol = this.view.px(5);
    const box: Box = { minX: w.x - tol, minY: w.y - tol, maxX: w.x + tol, maxY: w.y + tol };
    let best: number | null = null;
    let bestD = Infinity;
    for (const e of this.doc.entities.values()) {
      if (!this.doc.isVisible(e)) continue;
      if (!boxIntersects(this.doc.box(e), box)) continue;
      if (filter && !filter(e)) continue;
      if (!entHit(e, w, tol, this.doc)) continue;
      let d = tol;
      if (e.type !== 'hatch' && e.type !== 'text' && e.type !== 'mtext' && e.type !== 'solid') {
        for (const pr of entPrims(e, this.doc, tol * 0.5)) d = Math.min(d, distToPrim(w, pr));
      } else d = tol * 0.9;
      if (d <= bestD) { bestD = d; best = e.id; }
    }
    return best;
  }

  private gripAt(s: Vec): { id: number; idx: number; p: Vec } | null {
    if (!this.selection.size || this.selection.size > 200) return null;
    for (const id of this.selection) {
      const e = this.doc.get(id);
      if (!e) continue;
      const gs = entGrips(e);
      for (let i = 0; i < gs.length; i++) {
        const g = this.view.toScreen(gs[i]);
        if (Math.abs(g.x - s.x) <= 7 && Math.abs(g.y - s.y) <= 7) return { id, idx: i, p: gs[i] };
      }
    }
    return null;
  }

  entitiesInWindow(a: Vec, b: Vec, crossing: boolean): number[] {
    const wa = this.view.toWorld(a), wb = this.view.toWorld(b);
    const box = boxFromPts(wa, wb);
    const out: number[] = [];
    for (const e of this.doc.entities.values()) {
      if (!this.doc.isVisible(e)) continue;
      const eb = this.doc.box(e);
      if (boxContainsBox(box, eb)) { out.push(e.id); continue; }
      if (!crossing || !boxIntersects(box, eb)) continue;
      if (e.type === 'hatch' || e.type === 'text' || e.type === 'mtext' || e.type === 'insert' && entHit(e, wa, 0, this.doc)) { out.push(e.id); continue; }
      if (entPrims(e, this.doc, this.view.px(1)).some((pr) => primIntersectsBox(pr, box))) out.push(e.id);
    }
    return out;
  }

  private applyPicked(ids: number[], remove: boolean): void {
    const target = this.prompt?.kind === 'select' ? this.pending : this.selection;
    let n = 0;
    for (const id of ids) {
      const e = this.doc.get(id);
      if (!e) continue;
      if (this.prompt?.kind === 'select' && !this.doc.isEditable(e)) continue;
      if (remove) target.delete(id); else { target.add(id); n++; }
    }
    if (this.prompt?.kind === 'select') {
      this.print(remove ? `${ids.length} removed, ${target.size} total` : `${n} found, ${target.size} total`);
      if (this.prompt.single && target.size) this.submit('');
    } else this.ui.onSelection();
    this.redraw();
  }

  clearSelection(): void {
    if (!this.selection.size) return;
    this.selection.clear();
    this.hotGrip = null;
    this.ui.onSelection();
    this.redraw();
  }

  selectIds(ids: number[]): void {
    this.selection = new Set(ids);
    this.ui.onSelection();
    this.redraw();
  }

  // -------------------------------------------------------------------------
  // Mouse

  /** In idle and selection prompts the pick point follows the grid-snapped crosshair. */
  private snapScreen(s: Vec): Vec {
    const k = this.prompt?.kind;
    if (!this.settings.snap || this.panning || this.panTool || k === 'point' || k === 'text') return s;
    return this.view.toScreen(this.gridSnap(this.view.toWorld(s)));
  }

  onMouseMove(s: Vec, buttons: number): void {
    if (this.panning) {
      this.navView().panPixels(s.x - this.panning.x, s.y - this.panning.y);
      this.afterNav();
      this.panning = { x: s.x, y: s.y };
      this.redraw();
    }
    this.cursorScreen = s;
    s = this.snapScreen(s);
    if (this.win) {
      this.win.b = s;
      if (dist(this.win.a, s) > 5 && buttons & 1) this.win.dragged = true;
    }
    this.updateCursor();
  }

  onMouseLeave(): void {
    this.cursorScreen = null;
    this.hoverId = null;
    this.redrawOverlay();
  }

  onMouseDown(s: Vec, button: number, shift: boolean): void {
    this.cursorScreen = s;
    if (button === 1) {
      const now = performance.now();
      if (now - this.lastMiddle < 350) { void this.zoomExtents(); this.lastMiddle = 0; return; }
      this.lastMiddle = now;
      this.panning = { x: s.x, y: s.y };
      return;
    }
    if (button === 2) return;
    if (this.panTool) { this.panning = { x: s.x, y: s.y }; return; }
    // In MSPACE only the active viewport takes picks; clicking another one activates it.
    if (this.activeVp !== null) {
      const vp = this.viewportAt(s);
      if (vp?.id !== this.activeVp) {
        if (vp && !this.prompt) this.enterViewport(vp.id);
        return;
      }
    }
    s = this.snapScreen(s);
    this.updateCursor();
    const p = this.prompt;
    if (p?.kind === 'point') {
      this.prompt = null;
      this.preview = [];
      this.snapOverride = null;
      p.resolve({ kind: 'point', p: this.cursorPt });
      return;
    }
    if (p?.kind === 'text') return;
    if (p?.kind === 'entity') {
      const id = this.pickAt(s, p.filter);
      if (id !== null) {
        this.prompt = null;
        p.resolve({ kind: 'entity', id, p: this.view.toWorld(s) });
      } else this.print('No object found.');
      return;
    }
    // selection (idle or select prompt)
    if (this.win) {
      this.finishWindow(shift);
      return;
    }
    if (!p && this.hoverGrip && !shift) {
      void this.gripEdit(this.hoverGrip);
      return;
    }
    const id = this.pickAt(s);
    if (id !== null) {
      const remove = shift || (p?.kind === 'select' && p.remove);
      this.applyPicked([id], remove);
      return;
    }
    this.win = { a: s, b: s, dragged: false };
  }

  onMouseUp(s: Vec, button: number, shift: boolean): void {
    if (button === 1 || this.panTool) { this.panning = null; return; }
    if (button === 2) { this.onRightClick(s, shift); return; }
    if (this.win && this.win.dragged) {
      this.win.b = this.snapScreen(s);
      this.finishWindow(shift);
    }
  }

  private finishWindow(shift: boolean): void {
    const w = this.win!;
    this.win = null;
    const p = this.prompt;
    const crossing = w.b.x < w.a.x || (p?.kind === 'select' && !!p.crossingOnly);
    const ids = this.entitiesInWindow(w.a, w.b, crossing);
    if (p?.kind === 'select' && p.crossingOnly) this.lastWindow = boxFromPts(this.view.toWorld(w.a), this.view.toWorld(w.b));
    this.applyPicked(ids, shift || (p?.kind === 'select' && p.remove));
    this.redrawOverlay();
  }

  /** Last crossing window (STRETCH uses it). */
  lastWindow: Box | null = null;

  onWheel(s: Vec, deltaY: number): void {
    this.navView().zoomAt(s, deltaY < 0 ? 1.25 : 0.8);
    this.afterNav();
    this.redraw();
    this.cursorScreen = s;
    this.updateCursor();
  }

  onDoubleClick(s: Vec): void {
    if (this.prompt) return;
    if (this.doc.layout) {
      const vp = this.viewportAt(s);
      if (this.activeVp !== null) {
        // Outside the active viewport: back to paper space (or into another viewport).
        if (!vp) { this.exitViewport(); return; }
        if (vp.id !== this.activeVp) { this.enterViewport(vp.id); return; }
      } else if (vp) {
        const hit = this.pickAt(s);
        if (hit === null || hit === vp.id) { this.enterViewport(vp.id); return; }
      }
    }
    const id = this.pickAt(s);
    if (id === null) return;
    const e = this.doc.get(id)!;
    this.selectIds([id]);
    if (e.type === 'text' || e.type === 'mtext' || e.type === 'dimension') { void this.runCommand('TEXTEDIT', false); return; }
    if (e.type === 'hatch') { void this.runCommand('HATCHEDIT', false); return; }
    if (e.type === 'insert' && !this.blockEdit) { void this.runMacro(`BEDIT;${e.name}`); return; }
    this.ui.properties(true);
  }

  // -------------------------------------------------------------------------
  // Shortcut menus (right click)

  private onRightClick(s: Vec, shift: boolean): void {
    if (shift) { this.ui.contextMenu(s, this.snapOverrideItems()); return; }
    const p = this.prompt;
    if (p) { this.ui.contextMenu(s, this.commandMenu(p)); return; }
    this.ui.contextMenu(s, this.selection.size ? this.selectionMenu() : this.idleMenu());
  }

  private run(cmd: string): () => void {
    return () => void this.runMacro(cmd);
  }

  private recentItems(): MenuItem[] {
    return this.recentCommands.slice(0, 10).map((c) => ({ label: c, action: this.run(c) }));
  }

  private clipboardItems(): MenuItem[] {
    const sel = this.selection.size > 0;
    return [
      { label: 'Cut', action: this.run('CUTCLIP'), disabled: !sel },
      { label: 'Copy', action: this.run('COPYCLIP'), disabled: !sel },
      { label: 'Copy with Base Point', action: this.run('COPYBASE'), disabled: !sel },
      { label: 'Paste', action: this.run('PASTECLIP'), disabled: !this.clipboard },
      { label: 'Paste as Block', action: this.run('PASTEBLOCK'), disabled: !this.clipboard },
      { label: 'Paste to Original Coordinates', action: this.run('PASTEORIG'), disabled: !this.clipboard },
    ];
  }

  private zoomItems(): MenuItem[] {
    const c = () => ({ x: this.view.w / 2, y: this.view.h / 2 });
    return [
      { label: 'Zoom Extents', action: () => void this.zoomExtents() },
      { label: 'Zoom Window', action: this.run('ZOOM;W') },
      { label: 'Zoom Previous', action: () => { if (this.view.previous()) this.redraw(); } },
      { label: 'Zoom In', action: () => { this.view.zoomAt(c(), 2); this.redraw(); } },
      { label: 'Zoom Out', action: () => { this.view.zoomAt(c(), 0.5); this.redraw(); } },
    ];
  }

  private idleMenu(): MenuItem[] {
    const items: MenuItem[] = [];
    if (this.lastCommand) items.push({ label: `Repeat ${this.lastCommand}`, action: this.run(this.lastCommand) });
    items.push({ label: 'Recent Input', submenu: this.recentItems(), disabled: !this.recentCommands.length });
    items.push({ sep: true, label: 'Clipboard', submenu: this.clipboardItems() });
    items.push({ sep: true, label: 'Undo', action: this.run('UNDO'), disabled: !this.doc.canUndo });
    items.push({ label: 'Redo', action: this.run('REDO'), disabled: !this.doc.canRedo });
    items.push({ label: 'Pan', action: () => this.startTransparentPan() });
    items.push({ label: 'Zoom', submenu: this.zoomItems() });
    items.push({ sep: true, label: 'Select All', action: this.run('SELECTALL') });
    items.push({ label: 'Quick Select…', action: this.run('QSELECT') });
    if (this.blockEdit) {
      items.push({ sep: true, label: 'Save Block', action: this.run('BSAVE') });
      items.push({ label: 'Close Block Editor', action: this.run('BCLOSE') });
    }
    items.push({ sep: true, label: 'Drafting Settings…', action: this.run('DSETTINGS') });
    items.push({ label: 'Plot…', action: this.run('PLOT') });
    return items;
  }

  private selectionMenu(): MenuItem[] {
    const ents = [...this.selection].map((id) => this.doc.get(id)).filter((e): e is Entity => !!e);
    const one = ents.length === 1 ? ents[0] : null;
    const items: MenuItem[] = [];
    if (this.lastCommand) items.push({ label: `Repeat ${this.lastCommand}`, action: this.run(this.lastCommand) });
    items.push({ label: 'Recent Input', submenu: this.recentItems(), disabled: !this.recentCommands.length });
    if (one?.type === 'insert' && !this.blockEdit) items.push({ sep: true, label: 'Block Editor', action: this.run(`BEDIT;${one.name}`) });
    if (one?.type === 'hatch') items.push({ sep: true, label: 'Hatch Edit…', action: this.run('HATCHEDIT') });
    if (one && (one.type === 'text' || one.type === 'mtext' || one.type === 'dimension')) items.push({ sep: true, label: 'Edit Text…', action: this.run('TEXTEDIT') });
    items.push({ sep: true, label: 'Clipboard', submenu: this.clipboardItems() });
    items.push({ sep: true, label: 'Erase', action: this.run('ERASE') });
    items.push({ label: 'Move', action: this.run('MOVE') });
    items.push({ label: 'Copy Selection', action: this.run('COPY') });
    items.push({ label: 'Scale', action: this.run('SCALE') });
    items.push({ label: 'Rotate', action: this.run('ROTATE') });
    items.push({ label: 'Mirror', action: this.run('MIRROR') });
    items.push({
      label: 'Draw Order', submenu: [
        { label: 'Bring to Front', action: () => this.doc.reorder([...this.selection], true) },
        { label: 'Send to Back', action: () => this.doc.reorder([...this.selection], false) },
      ],
    });
    items.push({ sep: true, label: 'Add Selected', action: this.run('ADDSELECTED'), disabled: !one });
    items.push({ label: 'Select Similar', action: this.run('SELECTSIMILAR') });
    items.push({ label: 'Deselect All', action: () => this.clearSelection() });
    items.push({ sep: true, label: 'Quick Select…', action: this.run('QSELECT') });
    items.push({ label: 'Properties', action: () => this.ui.properties(true) });
    return items;
  }

  private commandMenu(p: Prompt): MenuItem[] {
    const items: MenuItem[] = [
      { label: 'Enter', action: () => this.submit('') },
      { label: 'Cancel', action: () => void this.cancel() },
    ];
    const kws = p.kind === 'point' ? p.o.keywords ?? [] : p.kind === 'entity' || p.kind === 'text' ? p.keywords : [];
    if (this.busy === 'GRIP') {
      items.push({ sep: true, label: 'Stretch', action: () => this.setGripMode(0) });
      items.push({ label: 'Move', action: () => this.setGripMode(1) });
      items.push({ label: 'Rotate', action: () => this.setGripMode(2) });
      items.push({ label: 'Scale', action: () => this.setGripMode(3) });
      items.push({ label: 'Mirror', action: () => this.setGripMode(4) });
    }
    if (kws.length) {
      items.push({ sep: true, label: kws[0], action: () => this.submit(kwShortcut(kws[0])) });
      for (const k of kws.slice(1)) items.push({ label: k, action: () => this.submit(kwShortcut(k)) });
    }
    if (p.kind === 'select') {
      items.push({ sep: true, label: 'All', action: () => this.submit('ALL') });
      items.push({ label: 'Previous', action: () => this.submit('P') });
      items.push({ label: 'Last', action: () => this.submit('L') });
      items.push({ label: p.remove ? 'Add' : 'Remove', action: () => this.submit(p.remove ? 'A' : 'R') });
    }
    if (p.kind === 'point') items.push({ sep: true, label: 'Snap Overrides', submenu: this.snapOverrideItems() });
    items.push({ sep: true, label: 'Pan', action: () => this.startTransparentPan() });
    items.push({ label: 'Zoom', submenu: this.zoomItems() });
    return items;
  }

  /** Grip prompts advance the mode on Enter, so step back one before submitting. */
  private setGripMode(i: number): void {
    this.gripMode = (i - 1 + GRIP_MODES.length) % GRIP_MODES.length;
    this.submit('');
  }

  snapOverrideItems(): MenuItem[] {
    const pick = (k: SnapKind | 'none') => () => {
      this.snapOverride = k === 'none' ? new Set() : new Set([k]);
      this.print(k === 'none' ? 'Object snap: none (once)' : `Object snap override: ${k.toUpperCase()}`);
      this.updateCursor();
    };
    const L: [SnapKind, string][] = [
      ['end', 'Endpoint'], ['mid', 'Midpoint'], ['int', 'Intersection'], ['cen', 'Center'], ['gcen', 'Geometric Center'],
      ['qua', 'Quadrant'], ['tan', 'Tangent'], ['per', 'Perpendicular'], ['ins', 'Insert'], ['node', 'Node'], ['nea', 'Nearest'],
    ];
    return [
      ...L.map(([k, label], i) => ({ label, action: pick(k), sep: i === 3 || i === 6 || i === 8 })),
      { sep: true, label: 'None', action: pick('none') },
      { sep: true, label: 'Osnap Settings…', action: this.run('DSETTINGS') },
    ];
  }

  /** Pan with the left button until Esc/Enter, without interrupting the running command. */
  startTransparentPan(): void {
    this.panTool = true;
    this.print('Press ESC or ENTER to exit pan.');
  }

  async zoomExtents(): Promise<void> {
    this.view.pushHistory();
    const b = this.doc.extents();
    if (this.activeVp !== null) this.fitView(b);
    else if (b.minX <= b.maxX) this.view.fit(b);
    else if (this.doc.layout) this.fitPaper(this.doc.layout);
    else this.view.fit({ minX: 0, minY: 0, maxX: 420, maxY: 297 });
    this.redraw();
  }

  // -------------------------------------------------------------------------
  // Keyboard

  onKey(ev: KeyboardEvent): boolean {
    const k = ev.key;
    const ctrl = ev.ctrlKey || ev.metaKey;
    if (this.panTool && this.busy !== 'PAN' && (k === 'Escape' || k === 'Enter' || k === ' ')) {
      this.panTool = false;
      this.print('Pan ended.');
      return true;
    }
    if (k === 'Escape') {
      if (this.snapOverride) this.snapOverride = null;
      if (this.win) { this.win = null; this.redrawOverlay(); return true; }
      if (this.input) { this.setInput(''); return true; }
      if (this.busy) { void this.cancel(); return true; }
      this.hotGrip = null;
      this.clearSelection();
      this.print('Command: *Cancel*');
      return true;
    }
    if (ctrl) {
      const key = k.toLowerCase();
      const map: Record<string, string> = { z: 'UNDO', y: 'REDO', c: 'COPYCLIP', v: 'PASTECLIP', x: 'CUTCLIP', s: 'QSAVE', o: 'OPEN', n: 'NEW', a: 'SELECTALL', '1': 'PROPERTIES', p: 'PLOT' };
      if (key === 's' && ev.shiftKey) { void this.runCommand('SAVEAS'); return true; }
      if (map[key] && map[key] !== 'PLOT') { void this.runCommand(map[key]); return true; }
      return false;
    }
    const fkeys: Record<string, keyof Settings> = { F3: 'osnap', F7: 'grid', F8: 'ortho', F9: 'snap', F10: 'polar', F11: 'otrack', F12: 'dyn' };
    if (fkeys[k]) { this.toggle(fkeys[k]); return true; }
    if (k === 'F1') { void this.runCommand('HELP'); return true; }
    if (k === 'F2') { this.ui.print('', 'info'); return true; }
    if (k === 'Enter' || (k === ' ' && !(this.prompt?.kind === 'text' && this.prompt.allowSpaces))) {
      if (!this.prompt && !this.input && this.hotGrip) return true;
      this.submit();
      return true;
    }
    if (k === 'Backspace') { this.setInput(this.input.slice(0, -1)); return true; }
    if (k === 'Delete' && !this.prompt && !this.input) {
      if (this.selection.size) void this.runCommand('ERASE');
      return true;
    }
    if (k === 'ArrowUp' || k === 'ArrowDown') return false;
    if (k.length === 1 && !ev.altKey) {
      this.setInput(this.input + k);
      return true;
    }
    return false;
  }

  toggle(name: keyof Settings): void {
    const s = this.settings as unknown as Record<string, unknown>;
    s[name] = !s[name];
    if (name === 'ortho' && this.settings.ortho) this.settings.polar = false;
    if (name === 'polar' && this.settings.polar) this.settings.ortho = false;
    const labels: Record<string, string> = { osnap: 'Osnap', grid: 'Grid', ortho: 'Ortho', snap: 'Snap', polar: 'Polar', dyn: 'Dynamic input', otrack: 'Object Snap Tracking' };
    this.print(`<${labels[name] ?? name} ${s[name] ? 'on' : 'off'}>`);
    if (name === 'otrack' && !this.settings.otrack) this.acquired = [];
    this.ui.onStatus();
    this.redraw();
    this.updateCursor();
  }

  // -------------------------------------------------------------------------
  // Grip editing (hot grip with Space cycling STRETCH/MOVE/ROTATE/SCALE/MIRROR)

  private async gripEdit(g: { id: number; idx: number; p: Vec }): Promise<void> {
    if (this.busy) return;
    const ids = [...this.selection].filter((id) => { const e = this.doc.get(id); return e && this.doc.isEditable(e); });
    if (!ids.length) return;
    this.hotGrip = g.p;
    this.gripMode = 0;
    const base = g.p;
    const cmd: CommandDef = {
      name: 'GRIP', desc: 'Grip edit', noRepeat: true,
      fn: async (ed) => {
        let copy = false;
        for (;;) {
          const mode = GRIP_MODES[this.gripMode];
          const transformFor = (p: Vec): ((e: Entity) => Entity) => {
            switch (mode) {
              case 'STRETCH': return (e) => {
                if (e.id !== g.id) {
                  const gs = entGrips(e);
                  const i = gs.findIndex((q) => eq(q, base, 1e-9));
                  return i >= 0 ? entMoveGrip(e, i, p) : e;
                }
                return entMoveGrip(e, g.idx, p);
              };
              case 'MOVE': { const d = sub(p, base); return (e) => entTransform(e, mxTranslate(d.x, d.y)); }
              case 'ROTATE': { const a = angleBetween(base, p); return (e) => entTransform(e, mxRotate(a, base)); }
              case 'SCALE': { const s = Math.max(dist(base, p) / Math.max(this.view.px(60), 1e-12), 1e-9); return (e) => entTransform(e, mxScale(s, s, base)); }
              case 'MIRROR': return (e) => (dist(base, p) < 1e-12 ? e : entTransform(e, mxMirror(base, p), ed.doc.header.mirrtext));
            }
          };
          const r = await ed.getPoint(`** ${mode} **  Specify ${mode === 'STRETCH' || mode === 'MOVE' ? 'stretch point' : mode === 'ROTATE' ? 'rotation angle' : mode === 'SCALE' ? 'scale factor' : 'second point'} or`, {
            base, keywords: ['Base point', 'Copy', 'Undo', 'eXit'], allowNone: true, allowNumber: true, rubber: true,
            preview: (p) => ids.map((id) => stripId(transformFor(p)(ed.doc.get(id)!))),
          });
          if (r.kind === 'none') { this.gripMode = (this.gripMode + 1) % GRIP_MODES.length; continue; }
          if (r.kind === 'keyword') {
            if (r.kw === 'eXit') break;
            if (r.kw === 'Copy') { copy = true; continue; }
            continue;
          }
          let p: Vec;
          if (r.kind === 'number') {
            const v = r.value;
            if (mode === 'ROTATE') p = polar(base, rad(v), 1);
            else if (mode === 'SCALE') p = polar(base, 0, v * Math.max(this.view.px(60), 1e-12));
            else p = polar(base, angleBetween(base, this.cursorPt), v);
          } else p = r.p;
          const f = transformFor(p);
          for (const id of ids) {
            const e = ed.doc.get(id);
            if (!e) continue;
            const ne = f(e);
            if (copy) ed.doc.add(stripId(ne)); else ed.doc.update(ne);
          }
          if (!copy) break;
        }
      },
    };
    this.commands.set('GRIP', cmd);
    await this.runCommand('GRIP', false);
    this.hotGrip = null;
    this.redraw();
  }

  /** Converts screen-size grip SCALE reference: unit distance = 60px. */
  describePoint(p: Vec): string {
    return `${fmtNum(p.x)},${fmtNum(p.y)}`;
  }

  /** Dynamic input readout relative to the active base point. */
  dynReadout(): string | null {
    const p = this.prompt;
    if (p?.kind !== 'point' || !p.o.base) return null;
    const d = dist(p.o.base, this.cursorPt);
    const a = deg(normAng(angleBetween(p.o.base, this.cursorPt)));
    return `${fmtNum(d, 4)} < ${fmtNum(a, 0)}°`;
  }
}

// ---------------------------------------------------------------------------
// Parsing helpers

const ACQUIRE_MS = 350;

const SNAP_NAMES: Partial<Record<SnapKind, string>> = {
  end: 'Endpoint', mid: 'Midpoint', cen: 'Center', gcen: 'Geometric Center', qua: 'Quadrant', int: 'Intersection', node: 'Node', ins: 'Insertion',
};

/** "12.5000 < 90°" relative to the tracking origin. */
function trackText(o: Vec, p: Vec): string {
  return `${fmtNum(dist(o, p), 4)} < ${fmtNum(deg(normAng(angleBetween(o, p))), 0)}°`;
}

const SNAP_OVERRIDES: Record<string, SnapKind | null> = {
  END: 'end', ENDP: 'end', MID: 'mid', CEN: 'cen', GCE: 'gcen', INT: 'int', QUA: 'qua', PER: 'per', TAN: 'tan',
  NEA: 'nea', NOD: 'node', NODE: 'node', INS: 'ins', NON: null, NONE: null,
};

export function parseNumber(s: string): number | null {
  const t = s.trim().replace(/^\+/, '');
  if (!/^-?(\d+([.,]\d*)?|[.,]\d+)(e-?\d+)?$/i.test(t)) return null;
  const v = parseFloat(t.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

/** Parses AutoCAD coordinate input: x,y  @dx,dy  d<a  @d<a */
export function parsePoint(s: string, last: Vec): Vec | null {
  let t = s.trim();
  let rel = false;
  if (t.startsWith('@')) { rel = true; t = t.slice(1).trim(); if (!t) return { ...last }; }
  const num = '(-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e-?\\d+)?)';
  let m = new RegExp(`^${num}\\s*,\\s*${num}(?:\\s*,\\s*${num})?$`, 'i').exec(t);
  if (m) {
    const p = { x: parseFloat(m[1]), y: parseFloat(m[2]) };
    return rel ? add(last, p) : p;
  }
  m = new RegExp(`^${num}\\s*<\\s*${num}$`, 'i').exec(t);
  if (m) {
    const p = polar({ x: 0, y: 0 }, rad(parseFloat(m[2])), parseFloat(m[1]));
    return rel ? add(last, p) : p;
  }
  return null;
}

/** Keyword spec uses capitals for the shortcut, e.g. 'eXit' → X, 'Undo' → U. */
export function kwShortcut(kw: string): string {
  const caps = kw.replace(/[^A-Z0-9]/g, '');
  return caps || kw.toUpperCase();
}

export function matchKeyword(input: string, keywords: string[]): string | null {
  const t = input.trim().toUpperCase();
  if (!t) return null;
  for (const k of keywords) if (kwShortcut(k) === t) return k;
  for (const k of keywords) {
    const full = k.toUpperCase().replace(/\s+/g, '');
    if (full.startsWith(t.replace(/\s+/g, '')) && t.length >= kwShortcut(k).length) return k;
  }
  for (const k of keywords) if (k.toUpperCase().replace(/\s+/g, '') === t.replace(/\s+/g, '')) return k;
  return null;
}

export function stripId(e: Entity): NewEntity {
  const { id: _id, ...rest } = e;
  return rest as NewEntity;
}

export { norm };

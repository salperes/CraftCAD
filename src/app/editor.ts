// Editor: owns selection, prompts, snapping and input; runs AutoCAD-style async commands.

import {
  type Vec, type Box,
  add, sub, dist, mul, norm, dir, angleBetween, polar, rad, deg, normAng, boxFromPts, boxContainsBox, boxIntersects,
  primIntersectsBox, distToPrim, fmtNum, mxTranslate, mxRotate, mxScale, mxMirror, eq,
} from '../core/geom.ts';
import {
  type Entity, type NewEntity, type SnapKind,
  entPrims, entHit, entGrips, entMoveGrip, entTransform,
} from '../core/entities.ts';
import { Drawing } from '../core/document.ts';
import { Viewport } from '../view/viewport.ts';
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
  contextMenu(screen: Vec, items: { label: string; action: () => void; sep?: boolean }[]): void;
  openFile(): Promise<void>;
  saveFile(saveAs: boolean): Promise<void>;
  newDrawing(): Promise<void>;
  layerManager(): void;
  properties(show?: boolean): void;
  chooseFromList(title: string, items: string[]): Promise<string | null>;
  hatchOptions(): Promise<{ pattern: string; scale: number; angle: number } | null>;
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
    grid: true, snap: false, snapStep: 10, dyn: true, aperture: 10,
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
  snapHit: SnapHit | null = null;
  tracking: { from: Vec; to: Vec }[] = [];
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
    this.doc.on(() => { this.needsRender = true; this.ui?.onDocChanged(); });
    const loop = () => {
      if (this.needsRender) {
        this.needsRender = false;
        this.renderer.grid = this.settings.grid;
        this.renderer.render(this.doc, this.view, this.prompt?.kind === 'select' ? this.pending : this.selection);
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

  /** Runs "CMD;input;input…" — the command followed by pre-answered prompts. */
  async runMacro(macro: string): Promise<void> {
    const parts = macro.split(';');
    if (this.busy) await this.cancel();
    this.macroQueue = parts.slice(1);
    return this.runCommand(parts[0]);
  }

  getPoint(msg: string, o: PointOpts = {}): Promise<PointResult> {
    return new Promise((resolve, reject) => {
      this.setPrompt({ kind: 'point', msg, o, resolve: (r) => { if (r.kind === 'point') this.lastPoint = r.p; resolve(r); }, reject }, msg, o.keywords);
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
    const pt = parsePoint(text, this.lastPoint);
    if (pt) { this.prompt = null; p.resolve({ kind: 'point', p: pt }); return; }
    const n = parseNumber(text);
    if (n !== null) {
      const direct = o.directDistance ?? !!o.base;
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
      cursor: this.cursorScreen,
      cursorMode: mode,
      snap: this.snapHit && (p?.kind === 'point') ? this.snapHit : null,
      tracking: this.tracking,
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
    let pt = w;
    if (p?.kind === 'point' || (!p && this.hotGrip)) {
      const base = p?.kind === 'point' ? p.o.base ?? null : null;
      if (this.settings.osnap) {
        const hit = findSnap(this.doc, w, this.view.px(this.settings.aperture), this.settings.osnapModes, base);
        if (hit) { this.snapHit = hit; pt = hit.p; }
      }
      if (!this.snapHit && base) pt = this.constrain(base, w);
      else if (!this.snapHit && this.settings.snap) pt = this.gridSnap(w);
      if (!this.snapHit && base && this.settings.snap && !this.tracking.length && !this.settings.ortho) pt = this.gridSnap(pt);
    }
    this.cursorPt = pt;
    // hover highlight
    if (!p || p.kind === 'select' || p.kind === 'entity') {
      const id = this.pickAt(this.cursorScreen, p?.kind === 'entity' ? p.filter : undefined);
      this.hoverId = id;
    } else this.hoverId = null;
    this.hoverGrip = !p ? this.gripAt(this.cursorScreen) : null;
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

  onMouseMove(s: Vec, buttons: number): void {
    if (this.panning) {
      this.view.panPixels(s.x - this.panning.x, s.y - this.panning.y);
      this.panning = { x: s.x, y: s.y };
      this.redraw();
    }
    this.cursorScreen = s;
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
    this.updateCursor();
    const p = this.prompt;
    if (p?.kind === 'point') {
      this.prompt = null;
      this.preview = [];
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
    if (button === 2) { this.onRightClick(s); return; }
    if (this.win && this.win.dragged) {
      this.win.b = s;
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
    this.view.zoomAt(s, deltaY < 0 ? 1.25 : 0.8);
    this.redraw();
    this.cursorScreen = s;
    this.updateCursor();
  }

  onDoubleClick(s: Vec): void {
    if (this.prompt) return;
    const id = this.pickAt(s);
    if (id === null) return;
    const e = this.doc.get(id)!;
    if (e.type === 'text' || e.type === 'mtext') {
      this.selectIds([id]);
      void this.runCommand('TEXTEDIT', false);
      return;
    }
    this.selectIds([id]);
    this.ui.properties(true);
  }

  private onRightClick(s: Vec): void {
    if (this.prompt) { this.submit(''); return; }
    const items: { label: string; action: () => void; sep?: boolean }[] = [];
    if (this.lastCommand) items.push({ label: `Repeat ${this.lastCommand}`, action: () => void this.runCommand(this.lastCommand!) });
    if (this.selection.size) {
      items.push({ label: 'Erase', action: () => void this.runCommand('ERASE'), sep: true });
      items.push({ label: 'Move', action: () => void this.runCommand('MOVE') });
      items.push({ label: 'Copy Selection', action: () => void this.runCommand('COPY') });
      items.push({ label: 'Scale', action: () => void this.runCommand('SCALE') });
      items.push({ label: 'Rotate', action: () => void this.runCommand('ROTATE') });
      items.push({ label: 'Deselect All', action: () => this.clearSelection(), sep: true });
      items.push({ label: 'Properties', action: () => this.ui.properties(true) });
    } else {
      items.push({ label: 'Undo', action: () => void this.runCommand('UNDO'), sep: true });
      items.push({ label: 'Redo', action: () => void this.runCommand('REDO') });
      items.push({ label: 'Pan', action: () => void this.runCommand('PAN'), sep: true });
      items.push({ label: 'Zoom Extents', action: () => void this.zoomExtents() });
    }
    this.ui.contextMenu(s, items);
  }

  async zoomExtents(): Promise<void> {
    this.view.pushHistory();
    const b = this.doc.extents();
    if (b.minX <= b.maxX) this.view.fit(b);
    else this.view.fit({ minX: 0, minY: 0, maxX: 420, maxY: 297 });
    this.redraw();
  }

  // -------------------------------------------------------------------------
  // Keyboard

  onKey(ev: KeyboardEvent): boolean {
    const k = ev.key;
    const ctrl = ev.ctrlKey || ev.metaKey;
    if (k === 'Escape') {
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
    const fkeys: Record<string, keyof Settings> = { F3: 'osnap', F7: 'grid', F8: 'ortho', F9: 'snap', F10: 'polar', F12: 'dyn' };
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
    const labels: Record<string, string> = { osnap: 'Osnap', grid: 'Grid', ortho: 'Ortho', snap: 'Snap', polar: 'Polar', dyn: 'Dynamic input' };
    this.print(`<${labels[name] ?? name} ${s[name] ? 'on' : 'off'}>`);
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

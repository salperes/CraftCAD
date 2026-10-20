// Drawing database: entities, layers, blocks, linetypes, header variables and undo history.

import type { Vec, Box } from './geom.ts';
import { emptyBox, boxUnion, boxValid } from './geom.ts';
import {
  type Entity, type NewEntity, type BlockDef, type DimStyle, type DocCtx,
  BYLAYER, entBox, defaultDimStyle,
} from './entities.ts';

export interface Layer {
  name: string;
  color: number;
  trueColor?: number;
  ltype: string;
  on: boolean;
  frozen: boolean;
  locked: boolean;
  plot: boolean;
  lw?: number;
}

/** Dash pattern in drawing units: positive = dash, negative = gap, 0 = dot. */
export interface Linetype {
  name: string;
  desc: string;
  pattern: number[];
}

export const STANDARD_LINETYPES: Linetype[] = [
  { name: 'Continuous', desc: 'Solid line', pattern: [] },
  { name: 'DASHED', desc: 'Dashed __ __ __ __ __', pattern: [12, -6] },
  { name: 'HIDDEN', desc: 'Hidden _ _ _ _ _ _ _', pattern: [6, -3] },
  { name: 'CENTER', desc: 'Center ____ _ ____ _', pattern: [32, -6, 6, -6] },
  { name: 'PHANTOM', desc: 'Phantom ____ _ _ ____', pattern: [32, -6, 6, -6, 6, -6] },
  { name: 'DOT', desc: 'Dot . . . . . . . .', pattern: [0, -6] },
  { name: 'DASHDOT', desc: 'Dash dot __ . __ . __', pattern: [12, -6, 0, -6] },
  { name: 'DIVIDE', desc: 'Divide ____ . . ____', pattern: [12, -6, 0, -6, 0, -6] },
];

export interface Header {
  ltscale: number;
  textsize: number;
  insunits: number;
  pdmode: number;
  pdsize: number;
  extmin?: Vec;
  extmax?: Vec;
  filletRad: number;
  chamferA: number;
  chamferB: number;
  offsetDist: number;
  hatchPattern: string;
  hatchScale: number;
  hatchAngle: number;
  polygonSides: number;
  mirrtext: boolean;
}

interface Change {
  id: number;
  before?: Entity;
  after?: Entity;
}

interface Txn {
  name: string;
  changes: Change[];
  layersBefore?: Map<string, Layer>;
  layersAfter?: Map<string, Layer>;
  blocksBefore?: Map<string, BlockDef>;
  blocksAfter?: Map<string, BlockDef>;
  currentLayerBefore?: string;
  currentLayerAfter?: string;
}

export interface SpaceState {
  entities: Map<number, Entity>;
  undo: unknown[];
  redo: unknown[];
}

/** Sheet size and printable area of a layout, in paper units (mm), as shown on screen. */
export interface PaperSetup {
  name: string;
  w: number;
  h: number;
  /** Non-printable margins left, bottom, right, top; the printable area's lower left is the paper space origin. */
  margins: [number, number, number, number];
}

export interface Layout {
  name: string;
  paper: PaperSetup;
  /** Paper space entities while the layout is not the live space. */
  store?: SpaceState;
  /** Last paper view of the layout. */
  view?: { cx: number; cy: number; scale: number };
  /** False until first shown; a new empty layout then gets a default viewport. */
  initialized: boolean;
  /** Plot settings read from a file, written back unchanged. */
  plot?: Record<string, number | string>;
}

export const PAPER_SIZES: { name: string; w: number; h: number }[] = [
  { name: 'ISO A4 (297.00 x 210.00 MM)', w: 297, h: 210 },
  { name: 'ISO A3 (420.00 x 297.00 MM)', w: 420, h: 297 },
  { name: 'ISO A2 (594.00 x 420.00 MM)', w: 594, h: 420 },
  { name: 'ISO A1 (841.00 x 594.00 MM)', w: 841, h: 594 },
  { name: 'ISO A0 (1189.00 x 841.00 MM)', w: 1189, h: 841 },
  { name: 'ANSI A (11.00 x 8.50 Inches)', w: 279.4, h: 215.9 },
  { name: 'ANSI B (17.00 x 11.00 Inches)', w: 431.8, h: 279.4 },
];

export const defaultPaper = (): PaperSetup => ({ name: PAPER_SIZES[1].name, w: 420, h: 297, margins: [7.5, 7.5, 7.5, 7.5] });

export const MODEL = 'Model';

export type DocListener =(kind: 'entities' | 'layers' | 'all') => void;

const cloneLayers = (m: Map<string, Layer>) => new Map([...m].map(([k, l]) => [k, { ...l }]));

export class Drawing implements DocCtx {
  entities = new Map<number, Entity>();
  layers = new Map<string, Layer>();
  blocks = new Map<string, BlockDef>();
  linetypes = new Map<string, Linetype>();
  dimStyle: DimStyle = defaultDimStyle();
  header: Header = Drawing.defaultHeader();
  currentLayer = '0';
  currentColor = BYLAYER;
  currentLtype = 'ByLayer';
  fileName = 'Drawing1.dwg';
  modified = false;
  /** Layout tabs in order (model space is always first and not listed). */
  layouts: Layout[] = [];
  /** Active tab: null = Model. */
  layout: Layout | null = null;
  /**
   * Which entity space is live in `entities`: model space (Model tab, or a layout viewport
   * activated with MSPACE) or the active layout's paper space.
   */
  live: 'model' | 'paper' = 'model';
  /** Model space entities while paper space is live. */
  private modelStore: SpaceState | null = null;

  private nextId = 1;
  private txn: Txn | null = null;
  private undoStack: Txn[] = [];
  private redoStack: Txn[] = [];
  private listeners: DocListener[] = [];
  private boxCache = new Map<number, Box>();
  /** Entity object each cached box was computed for (boxes are shared across spaces). */
  private boxOwner = new Map<number, Entity>();

  constructor() {
    this.reset();
  }

  static defaultHeader(): Header {
    return {
      ltscale: 1, textsize: 2.5, insunits: 4, pdmode: 0, pdsize: 0,
      filletRad: 0, chamferA: 0, chamferB: 0, offsetDist: 10,
      hatchPattern: 'ANSI31', hatchScale: 1, hatchAngle: 0, polygonSides: 4, mirrtext: false,
    };
  }

  /** Clears to an empty drawing with default tables. */
  reset(): void {
    this.entities.clear();
    this.layers.clear();
    this.blocks.clear();
    this.linetypes.clear();
    this.boxCache.clear();
    this.dimStyle = defaultDimStyle();
    this.header = Drawing.defaultHeader();
    this.layers.set('0', { name: '0', color: 7, ltype: 'Continuous', on: true, frozen: false, locked: false, plot: true });
    for (const lt of STANDARD_LINETYPES) this.linetypes.set(lt.name.toUpperCase(), lt);
    this.currentLayer = '0';
    this.currentColor = BYLAYER;
    this.currentLtype = 'ByLayer';
    this.nextId = 1;
    this.undoStack = [];
    this.redoStack = [];
    this.txn = null;
    this.modified = false;
    this.layouts = ['Layout1', 'Layout2'].map((name) => ({ name, paper: defaultPaper(), initialized: false, store: { entities: new Map(), undo: [], redo: [] } }));
    this.layout = null;
    this.live = 'model';
    this.modelStore = null;
  }

  // -------------------------------------------------------------------------
  // Model space and layouts

  /** Model space entities, whichever space is live. */
  get modelEntities(): Map<number, Entity> {
    return this.live === 'model' ? this.entities : this.modelStore!.entities;
  }

  /** Paper space entities of a layout, whichever space is live. */
  paperEntities(l: Layout): Map<number, Entity> {
    return l === this.layout && this.live === 'paper' ? this.entities : l.store!.entities;
  }

  /** True when the given entity map belongs to paper space (live or stored). */
  get inPaper(): boolean {
    return this.live === 'paper';
  }

  /**
   * Switches the active tab and the live space. Each space keeps its own undo history,
   * like the block editor does.
   */
  activate(layout: Layout | null, live: 'model' | 'paper'): void {
    if (!layout) live = 'model';
    const cur: Layout | 'model' = this.live === 'model' ? 'model' : this.layout!;
    const next: Layout | 'model' = live === 'model' ? 'model' : layout!;
    if (cur !== next) {
      const target = next === 'model' ? this.modelStore! : next.store!;
      const prev = this.swapSpace(target);
      if (cur === 'model') this.modelStore = prev; else cur.store = prev;
      if (next === 'model') this.modelStore = null; else next.store = undefined;
    }
    this.layout = layout;
    this.live = live;
    this.emit('all');
  }

  layoutByName(name: string): Layout | undefined {
    const n = name.toUpperCase();
    return this.layouts.find((l) => l.name.toUpperCase() === n);
  }

  addLayout(name: string, paper = defaultPaper()): Layout {
    const l: Layout = { name, paper, initialized: false, store: { entities: new Map(), undo: [], redo: [] } };
    this.layouts.push(l);
    this.modified = true;
    return l;
  }

  /** Removes a layout that is not active. */
  deleteLayout(l: Layout): void {
    if (l === this.layout) throw new Error('Cannot delete the current layout');
    this.layouts = this.layouts.filter((x) => x !== l);
    this.modified = true;
  }

  uniqueLayoutName(prefix = 'Layout'): string {
    for (let i = 1; ; i++) if (!this.layoutByName(prefix + i)) return prefix + i;
  }

  /** Adds an entity to a stored (not live) space without undo, e.g. while loading a file. */
  loadInto(target: Map<number, Entity>, ne: NewEntity): Entity {
    const e = { layer: '0', color: BYLAYER, ltype: 'ByLayer', ...ne, id: this.allocId() } as Entity;
    if (!this.layers.has(e.layer)) this.addLayerQuiet(e.layer);
    target.set(e.id, e);
    return e;
  }

  /** Replaces an entity in a stored space without undo (viewport view changes). */
  setStored(target: Map<number, Entity>, e: Entity): void {
    if (target === this.entities) this.boxCache.delete(e.id);
    target.set(e.id, e);
    this.modified = true;
  }

  on(fn: DocListener): void {
    this.listeners.push(fn);
  }

  emit(kind: 'entities' | 'layers' | 'all' = 'entities'): void {
    for (const fn of this.listeners) fn(kind);
  }

  allocId(): number {
    return this.nextId++;
  }

  // -------------------------------------------------------------------------
  // Transactions

  begin(name: string): void {
    if (this.txn) return;
    this.txn = { name, changes: [] };
  }

  get inTxn(): boolean {
    return this.txn !== null;
  }

  commit(): void {
    const t = this.txn;
    this.txn = null;
    if (!t) return;
    if (t.changes.length || t.layersBefore || t.blocksBefore || t.currentLayerBefore !== undefined) {
      if (t.layersBefore) t.layersAfter = cloneLayers(this.layers);
      if (t.blocksBefore) t.blocksAfter = new Map(this.blocks);
      if (t.currentLayerBefore !== undefined) t.currentLayerAfter = this.currentLayer;
      this.undoStack.push(t);
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.redoStack = [];
      this.modified = true;
    }
  }

  /** Rolls back the open transaction. */
  abort(): void {
    const t = this.txn;
    this.txn = null;
    if (t) this.revert(t);
  }

  private ensureTxn(): Txn {
    if (!this.txn) {
      // Implicit single-step transaction committed on the next microtask.
      this.begin('change');
      queueMicrotask(() => this.commit());
    }
    return this.txn!;
  }

  private record(id: number, before: Entity | undefined, after: Entity | undefined): void {
    const t = this.ensureTxn();
    const existing = t.changes.find((c) => c.id === id);
    if (existing) existing.after = after;
    else t.changes.push({ id, before, after });
  }

  /** Snapshot layer table into the transaction before mutating it. */
  touchLayers(): void {
    const t = this.ensureTxn();
    if (!t.layersBefore) t.layersBefore = cloneLayers(this.layers);
    if (t.currentLayerBefore === undefined) t.currentLayerBefore = this.currentLayer;
  }

  touchBlocks(): void {
    const t = this.ensureTxn();
    if (!t.blocksBefore) t.blocksBefore = new Map(this.blocks);
  }

  private revert(t: Txn): void {
    for (let i = t.changes.length - 1; i >= 0; i--) {
      const c = t.changes[i];
      this.boxCache.delete(c.id);
      if (c.before) this.entities.set(c.id, c.before);
      else this.entities.delete(c.id);
    }
    if (t.layersBefore) this.layers = cloneLayers(t.layersBefore);
    if (t.blocksBefore) this.blocks = new Map(t.blocksBefore);
    if (t.currentLayerBefore !== undefined) this.currentLayer = t.currentLayerBefore;
  }

  private reapply(t: Txn): void {
    for (const c of t.changes) {
      this.boxCache.delete(c.id);
      if (c.after) this.entities.set(c.id, c.after);
      else this.entities.delete(c.id);
    }
    if (t.layersAfter) this.layers = cloneLayers(t.layersAfter);
    if (t.blocksAfter) this.blocks = new Map(t.blocksAfter);
    if (t.currentLayerAfter !== undefined) this.currentLayer = t.currentLayerAfter;
  }

  undo(): string | null {
    if (this.txn) this.commit();
    const t = this.undoStack.pop();
    if (!t) return null;
    this.revert(t);
    this.redoStack.push(t);
    this.modified = true;
    this.emit('all');
    return t.name;
  }

  redo(): string | null {
    const t = this.redoStack.pop();
    if (!t) return null;
    this.reapply(t);
    this.undoStack.push(t);
    this.modified = true;
    this.emit('all');
    return t.name;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // -------------------------------------------------------------------------
  // Entity operations (all recorded in the open transaction)

  /** Adds a new entity, filling layer/color/linetype from current settings when omitted. */
  add(ne: NewEntity): Entity {
    const e = {
      layer: this.currentLayer,
      color: this.currentColor,
      ltype: this.currentLtype,
      ...ne,
      id: this.allocId(),
    } as Entity;
    if (!this.layers.has(e.layer)) this.addLayerQuiet(e.layer);
    this.entities.set(e.id, e);
    this.record(e.id, undefined, e);
    this.emit();
    return e;
  }

  /** Replaces an existing entity (matched by id). */
  update(e: Entity): void {
    const before = this.entities.get(e.id);
    if (!before) return;
    this.boxCache.delete(e.id);
    this.entities.set(e.id, e);
    this.record(e.id, before, e);
    this.emit();
  }

  remove(id: number): void {
    const before = this.entities.get(id);
    if (!before) return;
    this.boxCache.delete(id);
    this.entities.delete(id);
    this.record(id, before, undefined);
    this.emit();
  }

  get(id: number): Entity | undefined {
    return this.entities.get(id);
  }

  /** Moves entities to the end (front) or start (back) of the draw order. Not undoable, like DRAWORDER. */
  reorder(ids: number[], toFront: boolean): void {
    const set = new Set(ids);
    const moved = [...this.entities.values()].filter((e) => set.has(e.id));
    const rest = [...this.entities.values()].filter((e) => !set.has(e.id));
    const order = toFront ? [...rest, ...moved] : [...moved, ...rest];
    this.entities = new Map(order.map((e) => [e.id, e]));
    this.modified = true;
    this.emit();
  }

  /**
   * Swaps the editable entity space (used by the block editor): returns the current
   * entities and undo history and installs the given ones.
   */
  swapSpace(next: SpaceState): SpaceState {
    if (this.txn) this.commit();
    const prev: SpaceState = { entities: this.entities, undo: this.undoStack, redo: this.redoStack };
    this.entities = next.entities;
    this.undoStack = next.undo as Txn[];
    this.redoStack = next.redo as Txn[];
    this.boxCache.clear();
    this.emit('all');
    return prev;
  }

  /** Bulk-load without undo (used by file import). */
  loadEntity(ne: NewEntity): Entity {
    const e = { layer: '0', color: BYLAYER, ltype: 'ByLayer', ...ne, id: this.allocId() } as Entity;
    if (!this.layers.has(e.layer)) this.addLayerQuiet(e.layer);
    this.entities.set(e.id, e);
    return e;
  }

  box(e: Entity): Box {
    let b = this.boxCache.get(e.id);
    if (!b || this.boxOwner.get(e.id) !== e) {
      b = entBox(e, this);
      this.boxCache.set(e.id, b);
      this.boxOwner.set(e.id, e);
    }
    return b;
  }

  invalidateBoxes(): void {
    this.boxCache.clear();
    for (const b of this.blocks.values()) b.box = undefined;
  }

  extents(ents: Map<number, Entity> = this.entities): Box {
    let b = emptyBox();
    for (const e of ents.values()) {
      const l = this.layers.get(e.layer);
      if (l && (!l.on || l.frozen)) continue;
      const eb = this.box(e);
      if (boxValid(eb)) b = boxUnion(b, eb);
    }
    return b;
  }

  // -------------------------------------------------------------------------
  // Layers

  addLayerQuiet(name: string, color = 7, ltype = 'Continuous'): Layer {
    const l: Layer = { name, color, ltype, on: true, frozen: false, locked: false, plot: true };
    this.layers.set(name, l);
    return l;
  }

  layerOf(e: { layer: string }): Layer {
    return this.layers.get(e.layer) ?? this.layers.get('0')!;
  }

  isVisible(e: Entity): boolean {
    const l = this.layers.get(e.layer);
    return !l || (l.on && !l.frozen);
  }

  isEditable(e: Entity): boolean {
    const l = this.layers.get(e.layer);
    return !l || !l.locked;
  }

  /** Effective ACI color (or true color) for an entity drawn directly in model space. */
  effectiveColor(e: { layer: string; color: number; trueColor?: number }): { aci: number; tc?: number } {
    if (e.trueColor !== undefined) return { aci: e.color, tc: e.trueColor };
    if (e.color === BYLAYER || e.color === 0) {
      const l = this.layerOf(e);
      return { aci: l.color, tc: l.trueColor };
    }
    return { aci: e.color };
  }

  effectiveLtype(e: { layer: string; ltype: string }): Linetype | undefined {
    let name = e.ltype;
    if (!name || name.toLowerCase() === 'bylayer' || name.toLowerCase() === 'byblock') name = this.layerOf(e).ltype;
    return this.linetypes.get(name.toUpperCase());
  }

  uniqueLayerName(prefix = 'Layer'): string {
    for (let i = 1; ; i++) if (!this.layers.has(prefix + i)) return prefix + i;
  }
}

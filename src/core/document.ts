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

export type DocListener = (kind: 'entities' | 'layers' | 'all') => void;

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
  fileName = 'Drawing1.dxf';
  modified = false;

  private nextId = 1;
  private txn: Txn | null = null;
  private undoStack: Txn[] = [];
  private redoStack: Txn[] = [];
  private listeners: DocListener[] = [];
  private boxCache = new Map<number, Box>();

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

  /** Bulk-load without undo (used by file import). */
  loadEntity(ne: NewEntity): Entity {
    const e = { layer: '0', color: BYLAYER, ltype: 'ByLayer', ...ne, id: this.allocId() } as Entity;
    if (!this.layers.has(e.layer)) this.addLayerQuiet(e.layer);
    this.entities.set(e.id, e);
    return e;
  }

  box(e: Entity): Box {
    let b = this.boxCache.get(e.id);
    if (!b || this.entities.get(e.id) !== e) {
      b = entBox(e, this);
      this.boxCache.set(e.id, b);
    }
    return b;
  }

  invalidateBoxes(): void {
    this.boxCache.clear();
    for (const b of this.blocks.values()) b.box = undefined;
  }

  extents(): Box {
    let b = emptyBox();
    for (const e of this.entities.values()) {
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

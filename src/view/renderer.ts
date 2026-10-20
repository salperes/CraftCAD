// Canvas 2D renderer: entities on the main canvas, transient feedback on the overlay.

import {
  type Vec, type Mat, type Box,
  boxIntersects, bulgeArc, angleBetween, angleOf, mxScaleFactor, dist, perp, norm, sub, add, mul, dot, cross, dir, boxValid,
  emptyBox, boxAdd,
} from '../core/geom.ts';
import {
  type Entity, type TextEnt, type MTextEnt, type HatchEnt, type DimEnt, type InsertEnt, type PatLine, type SnapKind,
  TEXT_FONT, textLocalBox, mtextLocalBox, dimGeometry, flattenSpline, forEachInsertInstance, inheritFromInsert,
  decodeSpecialChars, textUnitWidth, arrowPts, BYBLOCK, vpCorners,
} from '../core/entities.ts';
import type { Drawing, Layout } from '../core/document.ts';
import { aciToCss, trueColorCss } from '../core/aci.ts';
import { patternLines } from '../core/patterns.ts';
import { type Viewport, vpModelView } from './viewport.ts';
import { GLLayer, GL_TYPES } from './glrenderer.ts';

export const THEME = {
  bg: '#212830',
  gridMinor: 'rgba(255,255,255,0.045)',
  gridMajor: 'rgba(255,255,255,0.085)',
  axisX: 'rgba(225,80,80,0.35)',
  axisY: 'rgba(80,200,90,0.35)',
  crosshair: 'rgba(255,255,255,0.92)',
  selection: '#4c9aff',
  hover: 'rgba(120,180,255,0.9)',
  grip: '#1f6fe5',
  gripHover: '#ff7f7f',
  gripHot: '#e02020',
  snap: '#5ee05e',
  windowFill: 'rgba(40,110,255,0.16)',
  windowStroke: '#5b9bff',
  crossFill: 'rgba(40,200,80,0.16)',
  crossStroke: '#4fd36a',
  tracking: 'rgba(120,255,120,0.85)',
  layoutBg: '#3b4048',
  paper: '#ffffff',
  paperShadow: 'rgba(0,0,0,0.45)',
  printable: 'rgba(80,90,105,0.75)',
  activeViewport: '#2f7cf6',
};

/** What the main scene shows when a layout tab is active. */
export interface LayoutView {
  layout: Layout;
  /** Paper space view (equals the editor view unless a viewport is active). */
  paper: Viewport;
  /** Viewport whose model space is being edited (MSPACE), if any. */
  activeVp: number | null;
}

type Inherit = Pick<Entity, 'layer' | 'color' | 'trueColor' | 'ltype'>;

interface DrawState {
  /** World size of one screen pixel in the current coordinate system. */
  px: number;
  override?: string;
  widthPx: number;
  inherit?: Inherit;
  depth: number;
  noDash?: boolean;
  /** Main-scene pass with the WebGL layer active: skip what GL already drew. */
  skipGL?: boolean;
}

export interface OverlayState {
  cursor: Vec | null;
  cursorMode: 'idle' | 'point' | 'select' | 'none';
  snap: { kind: SnapKind; p: Vec; label: string } | null;
  /** Tracking alignment lines; full = infinite line through 'from' (object snap tracking). */
  tracking: { from: Vec; to: Vec; full?: boolean }[];
  /** Object snap tracking points (drawn as small crosses). */
  acquired: Vec[];
  trackLabel: string | null;
  window: { a: Vec; b: Vec; crossing: boolean } | null;
  preview: Entity[];
  rubber: { from: Vec; to: Vec } | null;
  grips: { p: Vec; state: 'cold' | 'hover' | 'hot' }[];
  hover: Entity | null;
  showUcs: boolean;
}

const PICKBOX = 5;
const BATCHABLE = new Set(['line', 'circle', 'arc', 'polyline', 'ellipse', 'spline']);

export class Renderer {
  main: HTMLCanvasElement;
  overlay: HTMLCanvasElement;
  mctx: CanvasRenderingContext2D;
  octx: CanvasRenderingContext2D;
  dpr = 1;
  cursorSize = 5; // percent of viewport, like CURSORSIZE
  grid = true;
  /** Grid spacing (GRIDUNIT) and major line frequency (GRIDMAJOR); adaptive subdivision when zooming. */
  gridStep = 10;
  gridMajor = 5;
  /** Background and color-7 handling (white on dark, black on paper). */
  bg = THEME.bg;
  darkBg = true;
  /** Plot as black only (monochrome.ctb). */
  mono = false;
  /** Base line width in device pixels. */
  baseWidth = 1;
  stats = { drawn: 0, ms: 0 };

  constructor(main: HTMLCanvasElement, overlay: HTMLCanvasElement) {
    this.main = main;
    this.overlay = overlay;
    this.mctx = main.getContext('2d', { alpha: false })!;
    this.octx = overlay.getContext('2d')!;
  }

  resize(w: number, h: number): void {
    this.dpr = window.devicePixelRatio || 1;
    this.gl?.resize(w, h, this.dpr);
    this.glDirty = true;
    for (const c of [this.main, this.overlay, ...(this.sel ? [this.sel] : [])]) {
      c.width = Math.round(w * this.dpr);
      c.height = Math.round(h * this.dpr);
      c.style.width = w + 'px';
      c.style.height = h + 'px';
    }
  }

  private setWorld(ctx: CanvasRenderingContext2D, v: Viewport): void {
    const d = this.dpr, s = v.scale;
    ctx.setTransform(d * s, 0, 0, -d * s, d * (v.w / 2 - v.cx * s), d * (v.h / 2 + v.cy * s));
  }

  private setScreen(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** Optional WebGL layer for solid curves, and the canvas that holds the selection highlight above it. */
  gl: GLLayer | null = null;
  sel: HTMLCanvasElement | null = null;
  glDirty = true;
  private rgbCache = new Map<string, [number, number, number]>();
  private ltCache = new Map<string, boolean>();

  /** Enables the WebGL layer (returns false when WebGL is unavailable). */
  enableGL(glCanvas: HTMLCanvasElement, selCanvas: HTMLCanvasElement): boolean {
    const gl = GLLayer.create(glCanvas);
    if (!gl) return false;
    this.gl = gl;
    this.sel = selCanvas;
    return true;
  }

  /** True when an entity cannot be drawn by the GL layer (dashed linetype or wide polyline). */
  private needs2D(e: Entity, inherit: Inherit | undefined, doc: Drawing): boolean {
    if (e.type === 'polyline' && e.width) return true;
    const src = inherit ? inheritFromInsert(e, inherit) : e;
    const key = src.layer + '\u0001' + src.ltype;
    let v = this.ltCache.get(key);
    if (v === undefined) {
      const lt = doc.effectiveLtype(src);
      v = !!lt && lt.pattern.length > 0;
      this.ltCache.set(key, v);
    }
    return v;
  }

  private toRgb(css: string): [number, number, number] {
    let c = this.rgbCache.get(css);
    if (!c) {
      const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(css);
      if (m) c = [+m[1] / 255, +m[2] / 255, +m[3] / 255];
      else {
        const hx = css.replace('#', '');
        c = [parseInt(hx.slice(0, 2), 16) / 255, parseInt(hx.slice(2, 4), 16) / 255, parseInt(hx.slice(4, 6), 16) / 255];
      }
      this.rgbCache.set(css, c);
    }
    return c;
  }

  private glBuilt: { ents: Map<number, Entity> | null; dark: boolean; mono: boolean } = { ents: null, dark: true, mono: false };

  /** Rebuilds GL buffers if the drawing changed or the zoom moved far from the tessellation scale. */
  private updateGL(doc: Drawing, ents: Map<number, Entity>, scale: number): void {
    const gl = this.gl!;
    const ratio = gl.builtScale ? scale / gl.builtScale : 0;
    const b = this.glBuilt;
    if (this.glDirty || ratio > 4 || ratio < 0.25 || b.ents !== ents || b.dark !== this.darkBg || b.mono !== this.mono) {
      this.ltCache.clear();
      this.glBuilt = { ents, dark: this.darkBg, mono: this.mono };
      gl.build(doc, ents, scale, {
        color: (e, inh) => {
          const src = inh ? inheritFromInsert(e, inh) : e;
          if (inh && !doc.isVisible(src)) return null;
          return this.toRgb(this.colorOf(src, doc, undefined));
        },
        needs2D: (e, inh) => this.needs2D(e, inh, doc),
      });
      this.glDirty = false;
    }
  }

  // -------------------------------------------------------------------------
  // Main scene

  render(doc: Drawing, v: Viewport, selection: Set<number>, lv?: LayoutView): void {
    const t0 = performance.now();
    if (lv) {
      const dark = this.darkBg;
      this.darkBg = false; // color 7 is black on the sheet
      try {
        this.stats = { drawn: this.renderLayout(doc, v, selection, lv), ms: 0 };
      } finally {
        this.darkBg = dark;
      }
      this.stats.ms = performance.now() - t0;
      return;
    }
    const ctx = this.mctx;
    this.setScreen(ctx);
    ctx.fillStyle = this.bg;
    ctx.fillRect(0, 0, v.w, v.h);
    if (this.grid) this.drawGrid(ctx, v);
    this.styleCache.clear();
    const useGL = !!this.gl;
    if (useGL) { this.updateGL(doc, doc.entities, v.scale); this.gl!.draw(v); }
    const drawn = this.drawScene(ctx, doc, doc.entities, v, useGL);
    this.drawSelection(doc, v, selection, null);
    this.stats = { drawn, ms: performance.now() - t0 };
  }

  /** Paper sheet, viewports showing model space, then paper space entities. */
  private renderLayout(doc: Drawing, v: Viewport, selection: Set<number>, lv: LayoutView): number {
    const ctx = this.mctx;
    const pv = lv.paper;
    const P = lv.layout.paper, [ml, mb, mr, mt] = P.margins;
    this.setScreen(ctx);
    ctx.fillStyle = this.plotting ? '#ffffff' : THEME.layoutBg;
    ctx.fillRect(0, 0, v.w, v.h);
    const a = pv.toScreen({ x: -ml, y: -mb }), b = pv.toScreen({ x: P.w - ml, y: P.h - mb });
    if (!this.plotting) {
      ctx.fillStyle = THEME.paperShadow;
      ctx.fillRect(a.x + 5, b.y + 5, b.x - a.x, a.y - b.y);
      ctx.fillStyle = THEME.paper;
      ctx.fillRect(a.x, b.y, b.x - a.x, a.y - b.y);
      const c = pv.toScreen({ x: 0, y: 0 }), d = pv.toScreen({ x: P.w - ml - mr, y: P.h - mb - mt });
      ctx.strokeStyle = THEME.printable;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(Math.round(c.x) + 0.5, Math.round(d.y) + 0.5, Math.round(d.x - c.x), Math.round(c.y - d.y));
      ctx.setLineDash([]);
    }
    this.styleCache.clear();
    const model = doc.modelEntities;
    const paper = doc.paperEntities(lv.layout);
    const vps: { e: Entity & { type: 'viewport' }; mv: Viewport; clip: { x: number; y: number; w: number; h: number } }[] = [];
    for (const e of paper.values()) {
      if (e.type !== 'viewport' || e.off || !doc.isVisible(e)) continue;
      const k = vpCorners(e).map((p) => pv.toScreen(p));
      const x0 = Math.max(0, Math.min(k[0].x, k[2].x)), x1 = Math.min(v.w, Math.max(k[0].x, k[2].x));
      const y0 = Math.max(0, Math.min(k[0].y, k[2].y)), y1 = Math.min(v.h, Math.max(k[0].y, k[2].y));
      if (x1 - x0 < 1 || y1 - y0 < 1) continue;
      vps.push({ e, mv: vpModelView(pv, e), clip: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } });
    }
    const useGL = !!this.gl && !this.plotting;
    if (useGL) {
      this.gl!.clear();
      if (vps.length) {
        this.updateGL(doc, model, Math.max(...vps.map((x) => x.mv.scale)));
        for (const x of vps) this.gl!.drawClip(x.mv, x.clip);
      }
    }
    let drawn = 0;
    for (const x of vps) {
      ctx.save();
      this.setScreen(ctx);
      ctx.beginPath();
      ctx.rect(x.clip.x, x.clip.y, x.clip.w, x.clip.h);
      ctx.clip();
      drawn += this.drawScene(ctx, doc, model, x.mv, useGL);
      ctx.restore();
    }
    drawn += this.drawScene(ctx, doc, paper, pv, false);
    const act = lv.activeVp !== null ? paper.get(lv.activeVp) : undefined;
    let selView = pv, selClip: { x: number; y: number; w: number; h: number } | null = null;
    if (act?.type === 'viewport') {
      const k = vpCorners(act).map((p) => pv.toScreen(p));
      this.setScreen(ctx);
      ctx.strokeStyle = THEME.activeViewport;
      ctx.lineWidth = 3;
      ctx.strokeRect(k[0].x, k[2].y, k[2].x - k[0].x, k[0].y - k[2].y);
      const x = vps.find((q) => q.e.id === act.id);
      if (x) { selView = x.mv; selClip = x.clip; }
    }
    this.drawSelection(doc, selView, selection, selClip, v);
    return drawn;
  }

  /** Selection highlight (on its own canvas above the GL lines when GL is on). */
  private drawSelection(doc: Drawing, v: Viewport, selection: Set<number>, clip: { x: number; y: number; w: number; h: number } | null, screen: Viewport = v): void {
    let sctx = this.mctx;
    if (this.gl && this.sel && !this.plotting) {
      sctx = this.sel.getContext('2d')!;
      this.setScreen(sctx);
      sctx.clearRect(0, 0, screen.w, screen.h);
    }
    if (!selection.size) return;
    sctx.save();
    if (clip) { this.setScreen(sctx); sctx.beginPath(); sctx.rect(clip.x, clip.y, clip.w, clip.h); sctx.clip(); }
    this.setWorld(sctx, v);
    sctx.lineCap = 'round';
    sctx.lineJoin = 'round';
    const px = v.px(1);
    for (const id of selection) {
      const e = doc.get(id);
      if (!e || !doc.isVisible(e)) continue;
      this.drawEntity(sctx, e, doc, { px, widthPx: 2.2, depth: 0, override: THEME.selection, noDash: true });
    }
    sctx.restore();
  }

  /** True while plotting: no sheet decorations, no GL layer. */
  private plotting = false;

  /** Draws a set of entities in world coordinates of v; returns how many were visible. */
  private drawScene(ctx: CanvasRenderingContext2D, doc: Drawing, ents: Map<number, Entity>, v: Viewport, useGL: boolean): number {
    this.setWorld(ctx, v);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const vis = v.visibleBox(2);
    const px = v.px(1);
    let drawn = 0;
    this.ltCache.clear();
    const st: DrawState = { px, widthPx: this.baseWidth, depth: 0, skipGL: useGL };
    // Consecutive simple curves with the same resolved style share one path and one stroke.
    let batch: string | null = null;
    const flush = () => {
      if (batch !== null) { ctx.stroke(); batch = null; }
    };
    for (const e of ents.values()) {
      if (!doc.isVisible(e)) continue;
      const b = doc.box(e);
      if (boxValid(b) && !boxIntersects(b, vis)) continue;
      drawn++;
      if (useGL && GL_TYPES.has(e.type) && !this.needs2D(e, undefined, doc)) continue;
      // Sub-pixel entities: draw as a dot.
      if (boxValid(b) && b.maxX - b.minX < px && b.maxY - b.minY < px && e.type !== 'text' && e.type !== 'mtext') {
        const s = this.resolveStyle(e, doc, st);
        if (!s) continue;
        flush();
        ctx.fillStyle = s.css;
        ctx.fillRect(b.minX, b.minY, px, px);
        continue;
      }
      if (BATCHABLE.has(e.type) && !(e.type === 'polyline' && e.width && e.width > px)) {
        const s = this.resolveStyle(e, doc, st);
        if (!s) continue;
        if (s.key !== batch) {
          flush();
          ctx.strokeStyle = s.css;
          ctx.lineWidth = px * this.baseWidth;
          ctx.setLineDash(s.dash ?? []);
          ctx.beginPath();
          batch = s.key;
        }
        this.pathEntity(ctx, e, px);
        continue;
      }
      flush();
      this.drawEntity(ctx, e, doc, st);
    }
    flush();
    return drawn;
  }

  private drawGrid(ctx: CanvasRenderingContext2D, v: Viewport): void {
    // Adaptive grid: minor spacing is a power of 10 (×1, ×5) giving ≥ 10px.
    let step = this.gridStep > 0 ? this.gridStep : 10;
    // Adaptive: merge or subdivide by the major factor so lines stay 8–8·m px apart.
    const mf = Math.max(2, this.gridMajor);
    while (step * v.scale < 8) step *= mf;
    while (step * v.scale > 8 * mf) step /= mf;
    const major = step * Math.max(1, this.gridMajor);
    const b = v.visibleBox();
    const drawLines = (s: number, color: string) => {
      if (s * v.scale < 4) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const x0 = Math.ceil(b.minX / s) * s;
      for (let x = x0; x <= b.maxX; x += s) {
        const sx = Math.round(v.toScreen({ x, y: 0 }).x) + 0.5;
        ctx.moveTo(sx, 0); ctx.lineTo(sx, v.h);
      }
      const y0 = Math.ceil(b.minY / s) * s;
      for (let y = y0; y <= b.maxY; y += s) {
        const sy = Math.round(v.toScreen({ x: 0, y }).y) + 0.5;
        ctx.moveTo(0, sy); ctx.lineTo(v.w, sy);
      }
      ctx.stroke();
    };
    this.setScreen(ctx);
    drawLines(step, THEME.gridMinor);
    drawLines(major, THEME.gridMajor);
    const o = v.toScreen({ x: 0, y: 0 });
    ctx.lineWidth = 1;
    if (o.y >= 0 && o.y <= v.h) { ctx.strokeStyle = THEME.axisX; ctx.beginPath(); ctx.moveTo(Math.max(0, o.x), Math.round(o.y) + 0.5); ctx.lineTo(v.w, Math.round(o.y) + 0.5); ctx.stroke(); }
    if (o.x >= 0 && o.x <= v.w) { ctx.strokeStyle = THEME.axisY; ctx.beginPath(); ctx.moveTo(Math.round(o.x) + 0.5, Math.min(v.h, o.y)); ctx.lineTo(Math.round(o.x) + 0.5, 0); ctx.stroke(); }
  }

  colorOf(e: Inherit, doc: Drawing, inherit: Inherit | undefined): string {
    let src = e;
    if (inherit) src = inheritFromInsert(e as Entity, inherit);
    if (src.trueColor !== undefined) return trueColorCss(src.trueColor);
    if (this.mono) return '#000000';
    if (src.color === BYBLOCK) return aciToCss(7, this.darkBg);
    const c = doc.effectiveColor(src);
    return c.tc !== undefined ? trueColorCss(c.tc) : aciToCss(c.aci, this.darkBg);
  }

  /** Per-frame cache of resolved color/linetype by (layer, color, linetype, scale, pixel size). */
  private styleCache = new Map<string, { css: string; dash: number[] | null; key: string } | null>();

  private resolveStyle(e: Entity, doc: Drawing, st: DrawState): { css: string; dash: number[] | null; key: string } | null {
    const src = st.inherit ? inheritFromInsert(e, st.inherit) : e;
    const key = `${src.layer}\u0001${src.color}\u0001${src.trueColor ?? ''}\u0001${src.ltype}\u0001${e.ltscale ?? 1}\u0001${st.px}\u0001${st.depth > 0 ? 1 : 0}\u0001${st.override ?? ''}\u0001${st.noDash ? 1 : 0}`;
    const hit = this.styleCache.get(key);
    if (hit !== undefined) return hit;
    let out: { css: string; dash: number[] | null; key: string } | null = null;
    if (!(st.depth > 0 && !doc.isVisible(src))) {
      const css = st.override ?? this.colorOf(src, doc, undefined);
      let dash: number[] | null = null;
      if (!st.noDash) {
        const lt = doc.effectiveLtype(src);
        if (lt && lt.pattern.length) {
          const sc = doc.header.ltscale * (e.ltscale ?? 1);
          const total = lt.pattern.reduce((a, b) => a + Math.abs(b), 0) * sc;
          if (total / st.px > 4) dash = canvasDash(lt.pattern, sc, st.px);
        }
      }
      out = { css, dash, key };
    }
    if (this.styleCache.size > 5000) this.styleCache.clear();
    this.styleCache.set(key, out);
    return out;
  }

  private applyStyle(ctx: CanvasRenderingContext2D, e: Entity, doc: Drawing, st: DrawState): boolean {
    const s = this.resolveStyle(e, doc, st);
    if (!s) return false;
    ctx.strokeStyle = s.css;
    ctx.fillStyle = s.css;
    ctx.lineWidth = st.px * st.widthPx;
    ctx.setLineDash(s.dash ?? []);
    return true;
  }

  /** Appends a simple curve to the current path (no stroke). */
  private pathEntity(ctx: CanvasRenderingContext2D, e: Entity, px: number): void {
    switch (e.type) {
      case 'line':
        ctx.moveTo(e.p1.x, e.p1.y); ctx.lineTo(e.p2.x, e.p2.y);
        break;
      case 'circle':
        ctx.moveTo(e.c.x + e.r, e.c.y); ctx.arc(e.c.x, e.c.y, e.r, 0, Math.PI * 2);
        break;
      case 'arc':
        ctx.moveTo(e.c.x + e.r * Math.cos(e.a0), e.c.y + e.r * Math.sin(e.a0)); ctx.arc(e.c.x, e.c.y, e.r, e.a0, e.a1, false);
        break;
      case 'polyline':
        if (e.pts.length >= 2) polyPath(ctx, e.pts, e.bulges, e.closed);
        break;
      case 'ellipse': {
        const rx = Math.hypot(e.major.x, e.major.y);
        const s = { x: e.c.x + e.major.x * Math.cos(e.a0) - e.major.y * e.ratio * Math.sin(e.a0), y: e.c.y + e.major.y * Math.cos(e.a0) + e.major.x * e.ratio * Math.sin(e.a0) };
        ctx.moveTo(s.x, s.y);
        ctx.ellipse(e.c.x, e.c.y, rx, rx * e.ratio, angleOf(e.major), e.a0, e.a1, false);
        break;
      }
      case 'spline': {
        const pts = this.splinePts(e, px);
        if (pts.length < 2) break;
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        if (e.closed) ctx.closePath();
        break;
      }
    }
  }

  /** Flattened spline points cached per entity and zoom octave (tolerance ≈ ½ px). */
  private splineCache = new WeakMap<object, { tol: number; pts: Vec[] }>();
  private splinePts(e: Entity & { type: 'spline' }, px: number): Vec[] {
    const tol = 2 ** Math.floor(Math.log2(px * 0.5));
    const hit = this.splineCache.get(e);
    if (hit && hit.tol === tol) return hit.pts;
    const pts = flattenSpline(e, tol);
    this.splineCache.set(e, { tol, pts });
    return pts;
  }

  drawEntity(ctx: CanvasRenderingContext2D, e: Entity, doc: Drawing, st: DrawState): void {
    if (st.depth > 12) return;
    if (!this.applyStyle(ctx, e, doc, st)) return;
    switch (e.type) {
      case 'line':
        ctx.beginPath(); ctx.moveTo(e.p1.x, e.p1.y); ctx.lineTo(e.p2.x, e.p2.y); ctx.stroke();
        break;
      case 'circle':
        ctx.beginPath(); ctx.arc(e.c.x, e.c.y, e.r, 0, Math.PI * 2); ctx.stroke();
        break;
      case 'arc':
        ctx.beginPath(); ctx.arc(e.c.x, e.c.y, e.r, e.a0, e.a1, false); ctx.stroke();
        break;
      case 'polyline': {
        if (e.pts.length < 2) {
          if (e.pts.length === 1) ctx.fillRect(e.pts[0].x, e.pts[0].y, st.px, st.px);
          break;
        }
        ctx.beginPath();
        polyPath(ctx, e.pts, e.bulges, e.closed);
        if (e.width && e.width > st.px && !st.override) {
          ctx.lineWidth = e.width;
          ctx.lineCap = 'butt';
          ctx.lineJoin = 'miter';
          ctx.stroke();
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
        } else ctx.stroke();
        break;
      }
      case 'ellipse': {
        const rx = Math.hypot(e.major.x, e.major.y);
        ctx.beginPath();
        ctx.ellipse(e.c.x, e.c.y, rx, rx * e.ratio, angleOf(e.major), e.a0, e.a1, false);
        ctx.stroke();
        break;
      }
      case 'spline': {
        const pts = this.splinePts(e, st.px);
        if (pts.length < 2) break;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        if (e.closed) ctx.closePath();
        ctx.stroke();
        break;
      }
      case 'point': {
        const s = st.px * 3;
        const pd = doc.header.pdmode & 7;
        if (pd === 0 || pd === 1) ctx.fillRect(e.p.x - st.px, e.p.y - st.px, st.px * 2, st.px * 2);
        else {
          ctx.beginPath();
          if (pd === 2) { ctx.moveTo(e.p.x - s, e.p.y); ctx.lineTo(e.p.x + s, e.p.y); ctx.moveTo(e.p.x, e.p.y - s); ctx.lineTo(e.p.x, e.p.y + s); }
          else { ctx.moveTo(e.p.x - s, e.p.y - s); ctx.lineTo(e.p.x + s, e.p.y + s); ctx.moveTo(e.p.x - s, e.p.y + s); ctx.lineTo(e.p.x + s, e.p.y - s); }
          ctx.stroke();
        }
        if (doc.header.pdmode & 32) { ctx.beginPath(); ctx.arc(e.p.x, e.p.y, s, 0, Math.PI * 2); ctx.stroke(); }
        break;
      }
      case 'solid': {
        if (e.pts.length < 3) break;
        ctx.beginPath();
        ctx.moveTo(e.pts[0].x, e.pts[0].y);
        for (let i = 1; i < e.pts.length; i++) ctx.lineTo(e.pts[i].x, e.pts[i].y);
        ctx.closePath();
        if (st.override) ctx.stroke(); else ctx.fill();
        break;
      }
      case 'text': this.drawText(ctx, e, st); break;
      case 'mtext': this.drawMText(ctx, e, st); break;
      case 'hatch': this.drawHatch(ctx, e, doc, st); break;
      case 'dimension': this.drawDimension(ctx, e, doc, st); break;
      case 'insert': this.drawInsert(ctx, e, doc, st); break;
      case 'viewport': {
        const k = vpCorners(e);
        ctx.beginPath();
        ctx.moveTo(k[0].x, k[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(k[i].x, k[i].y);
        ctx.closePath();
        ctx.stroke();
        break;
      }
    }
  }

  private drawText(ctx: CanvasRenderingContext2D, e: TextEnt, st: DrawState): void {
    const s = decodeSpecialChars(e.text);
    if (!s) return;
    if (e.h / st.px < 1.2) {
      // Too small to read: draw its baseline.
      const lb = textLocalBox(e);
      const a = add(e.p, rotateV({ x: lb.x0, y: lb.y0 }, e.rot)), b = add(e.p, rotateV({ x: lb.x1, y: lb.y0 }, e.rot));
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      return;
    }
    const lb = textLocalBox(e);
    ctx.save();
    ctx.setLineDash([]);
    ctx.translate(e.p.x, e.p.y);
    ctx.rotate(e.rot);
    ctx.translate(lb.x0, lb.y0);
    const k = e.h / 70;
    ctx.scale(k * (e.wf || 1), -k);
    ctx.font = `100px ${TEXT_FONT}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(s, 0, 0);
    ctx.restore();
  }

  private drawMText(ctx: CanvasRenderingContext2D, e: MTextEnt, st: DrawState): void {
    const lb = mtextLocalBox(e);
    const small = e.h / st.px < 1.2;
    const base = ctx.fillStyle;
    ctx.save();
    ctx.setLineDash([]);
    ctx.translate(e.p.x, e.p.y);
    ctx.rotate(e.rot);
    for (const pl of lb.lines) {
      if (small) {
        const w = pl.line.width * e.h;
        if (w > 0) { ctx.beginPath(); ctx.moveTo(pl.x, pl.y); ctx.lineTo(pl.x + w, pl.y); ctx.stroke(); }
        continue;
      }
      let x = pl.x;
      for (const r of pl.line.runs) {
        const h = e.h * r.hf;
        const w = textUnitWidth(r.text, r) * h;
        const color = r.color !== undefined && !st.override && !this.mono ? aciToCss(r.color, this.darkBg) : base;
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.save();
        ctx.translate(x, pl.y);
        const k = h / 70;
        ctx.scale(k, -k);
        ctx.font = `${r.italic ? 'italic ' : ''}${r.bold ? 'bold ' : ''}100px ${TEXT_FONT}`;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(r.text, 0, 0);
        ctx.restore();
        if (r.underline || r.overline) {
          ctx.beginPath();
          if (r.underline) { ctx.moveTo(x, pl.y - h * 0.2); ctx.lineTo(x + w, pl.y - h * 0.2); }
          if (r.overline) { ctx.moveTo(x, pl.y + h * 1.2); ctx.lineTo(x + w, pl.y + h * 1.2); }
          ctx.lineWidth = st.px * st.widthPx;
          ctx.stroke();
        }
        x += w;
      }
    }
    ctx.restore();
    ctx.fillStyle = base;
  }

  private drawHatch(ctx: CanvasRenderingContext2D, e: HatchEnt, _doc: Drawing, st: DrawState): void {
    const path = new Path2D();
    const b = emptyBox();
    for (const l of e.loops) {
      if (l.pts.length < 2) continue;
      polyPath(path, l.pts, l.bulges, true);
      for (const p of l.pts) boxAdd(b, p);
    }
    if (st.override) {
      ctx.stroke(path);
      return;
    }
    const solid = e.solid || e.pattern.toUpperCase() === 'SOLID';
    if (solid) {
      ctx.fill(path, 'evenodd');
      return;
    }
    const lines = e.patLines ?? patternLines(e.pattern, e.scale, e.angle) ?? patternLines('ANSI31', e.scale, e.angle)!;
    ctx.save();
    ctx.clip(path, 'evenodd');
    if (!this.drawPatternLines(ctx, lines, b, st)) {
      ctx.globalAlpha = 0.35;
      ctx.fill(path, 'evenodd');
    }
    ctx.restore();
  }

  /** Returns false if the pattern is too dense to draw at this zoom. */
  private drawPatternLines(ctx: CanvasRenderingContext2D, lines: PatLine[], b: Box, st: DrawState): boolean {
    const corners = [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY }, { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY }];
    let total = 0;
    const plans: { pl: PatLine; u: Vec; k0: number; k1: number; t0: number; t1: number }[] = [];
    for (const pl of lines) {
      const u = dir(pl.ang);
      const n = perp(u);
      const spacing = dot(pl.off, n);
      if (Math.abs(spacing) < 1e-12) continue;
      if (Math.abs(spacing) / st.px < 2.5) return false;
      let kmin = Infinity, kmax = -Infinity, tmin = Infinity, tmax = -Infinity;
      for (const c of corners) {
        const rel = sub(c, pl.base);
        const k = dot(rel, n) / spacing;
        kmin = Math.min(kmin, k); kmax = Math.max(kmax, k);
        const t = dot(rel, u);
        tmin = Math.min(tmin, t); tmax = Math.max(tmax, t);
      }
      const k0 = Math.floor(kmin), k1 = Math.ceil(kmax);
      total += k1 - k0;
      plans.push({ pl, u, k0, k1, t0: tmin, t1: tmax });
    }
    if (total > 6000) return false;
    ctx.lineWidth = st.px;
    for (const { pl, u, k0, k1, t0, t1 } of plans) {
      const dashes = pl.dashes.length ? canvasDash(pl.dashes, 1, st.px) : null;
      const patLen = pl.dashes.reduce((a, d) => a + Math.abs(d), 0);
      if (dashes && patLen / st.px < 3) continue;
      ctx.setLineDash(dashes ?? []);
      for (let k = k0; k <= k1; k++) {
        const origin = add(pl.base, mul(pl.off, k));
        // shift along the line so that t is measured from this line's origin
        const shift = dot(sub(pl.base, origin), u);
        const a = add(origin, mul(u, t0 + shift - Math.abs(t1 - t0)));
        const bb = add(origin, mul(u, t1 + shift + Math.abs(t1 - t0)));
        if (dashes) {
          const startT = t0 + shift - Math.abs(t1 - t0);
          const L = patLen || 1;
          ctx.lineDashOffset = ((startT % L) + L) % L;
        }
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(bb.x, bb.y);
        ctx.stroke();
      }
    }
    ctx.lineDashOffset = 0;
    ctx.setLineDash([]);
    return true;
  }

  private drawDimension(ctx: CanvasRenderingContext2D, e: DimEnt, doc: Drawing, st: DrawState): void {
    const blk = e.block ? doc.blocks.get(e.block) : undefined;
    const inherit: Inherit = st.inherit ? inheritFromInsert(e, st.inherit) : e;
    if (blk) {
      for (const be of blk.entities) this.drawEntity(ctx, be, doc, { ...st, inherit, depth: st.depth + 1, skipGL: false });
      return;
    }
    const g = dimGeometry(e, doc.dimStyle);
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const [a, b] of g.lines) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    for (const a of g.arcs) { ctx.moveTo(a.c.x + a.r * Math.cos(a.a0), a.c.y + a.r * Math.sin(a.a0)); ctx.arc(a.c.x, a.c.y, a.r, a.a0, a.a1, false); }
    ctx.stroke();
    const asz = doc.dimStyle.dimasz * doc.dimStyle.dimscale;
    for (const ar of g.arrows) {
      const p = arrowPts(ar.tip, ar.dir, asz);
      ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(p[1].x, p[1].y); ctx.lineTo(p[2].x, p[2].y); ctx.closePath(); ctx.fill();
    }
    if (g.text.s) {
      const t: TextEnt = { ...e, type: 'text', p: g.text.p, h: g.text.h, text: g.text.s, rot: g.text.rot, halign: 4, valign: 0, wf: 1 } as unknown as TextEnt;
      this.drawText(ctx, t, st);
    }
  }

  private drawInsert(ctx: CanvasRenderingContext2D, e: InsertEnt, doc: Drawing, st: DrawState): void {
    const blk = doc.blocks.get(e.name);
    const inherit: Inherit = st.inherit ? inheritFromInsert(e, st.inherit) : e;
    if (blk) {
      forEachInsertInstance(e, blk, (m: Mat) => {
        ctx.save();
        ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
        const sc = mxScaleFactor(m) || 1;
        const cst: DrawState = { ...st, px: st.px / sc, inherit, depth: st.depth + 1 };
        for (const be of blk.entities) {
          if (be.type === 'text' && be.tag !== undefined) continue; // ATTDEF inside block
          if (st.skipGL && GL_TYPES.has(be.type) && !this.needs2D(be, inherit, doc)) continue;
          this.drawEntity(ctx, be, doc, cst);
        }
        ctx.restore();
      });
    }
    for (const a of e.attribs) this.drawEntity(ctx, a, doc, { ...st, depth: st.depth + 1, inherit: st.inherit });
  }

  /** Renders the drawing into an off-screen canvas for plotting. */
  plotTo(canvas: HTMLCanvasElement, doc: Drawing, v: Viewport, o: { mono: boolean; lineWidthPx: number }, layout?: Layout): void {
    const saved = { mctx: this.mctx, dpr: this.dpr, bg: this.bg, darkBg: this.darkBg, mono: this.mono, grid: this.grid, baseWidth: this.baseWidth, gl: this.gl, plotting: this.plotting };
    this.gl = null;
    this.plotting = true;
    this.mctx = canvas.getContext('2d', { alpha: false })!;
    this.dpr = 1;
    this.bg = '#ffffff';
    this.darkBg = false;
    this.mono = o.mono;
    this.grid = false;
    this.baseWidth = o.lineWidthPx;
    try {
      this.render(doc, v, new Set(), layout ? { layout, paper: v, activeVp: null } : undefined);
    } finally {
      Object.assign(this, saved);
    }
  }

  // -------------------------------------------------------------------------
  // Overlay

  renderOverlay(doc: Drawing, v: Viewport, o: OverlayState): void {
    const ctx = this.octx;
    this.setScreen(ctx);
    ctx.clearRect(0, 0, v.w, v.h);
    const px = v.px(1);

    if (o.hover) {
      this.setWorld(ctx, v);
      ctx.lineCap = 'round';
      this.drawEntity(ctx, o.hover, doc, { px, widthPx: 2.4, depth: 0, override: THEME.hover, noDash: true });
    }

    if (o.preview.length) {
      this.setWorld(ctx, v);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const e of o.preview) this.drawEntity(ctx, e, doc, { px, widthPx: 1, depth: 0 });
    }

    if (o.rubber) {
      this.setScreen(ctx);
      const a = v.toScreen(o.rubber.from), b = v.toScreen(o.rubber.to);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
    }

    this.setScreen(ctx);
    for (const t of o.tracking) {
      const a = v.toScreen(t.from), b = v.toScreen(t.to);
      const d = norm(sub(b, a));
      const span = Math.max(v.w, v.h) * 2;
      const far = add(a, mul(d, span));
      const start = t.full ? sub(a, mul(d, span)) : a;
      ctx.strokeStyle = THEME.tracking;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(far.x, far.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(b.x - 4, b.y - 4); ctx.lineTo(b.x + 4, b.y + 4); ctx.moveTo(b.x - 4, b.y + 4); ctx.lineTo(b.x + 4, b.y - 4); ctx.stroke();
    }

    for (const g of o.grips) {
      const s = v.toScreen(g.p);
      const size = g.state === 'cold' ? 5 : 6;
      ctx.fillStyle = g.state === 'hot' ? THEME.gripHot : g.state === 'hover' ? THEME.gripHover : THEME.grip;
      ctx.fillRect(Math.round(s.x) - size, Math.round(s.y) - size, size * 2, size * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(s.x) - size + 0.5, Math.round(s.y) - size + 0.5, size * 2 - 1, size * 2 - 1);
    }

    if (o.window) {
      const { a, b, crossing } = o.window;
      ctx.fillStyle = crossing ? THEME.crossFill : THEME.windowFill;
      ctx.strokeStyle = crossing ? THEME.crossStroke : THEME.windowStroke;
      ctx.lineWidth = 1;
      ctx.setLineDash(crossing ? [6, 4] : []);
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
      ctx.setLineDash([]);
    }

    for (const q of o.acquired) {
      const s = v.toScreen(q);
      const x = Math.round(s.x) + 0.5, y = Math.round(s.y) + 0.5;
      ctx.strokeStyle = THEME.tracking;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y); ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5); ctx.stroke();
    }
    if (o.trackLabel && o.cursor) this.drawLabel(ctx, o.cursor.x + 16, o.cursor.y - 36, o.trackLabel);

    if (o.snap) this.drawSnapMarker(ctx, v.toScreen(o.snap.p), o.snap.kind, o.snap.label);

    if (o.showUcs) this.drawUcs(ctx, v);

    if (o.cursor && o.cursorMode !== 'none') this.drawCursor(ctx, v, o.cursor, o.cursorMode);
  }

  private drawCursor(ctx: CanvasRenderingContext2D, v: Viewport, c: Vec, mode: OverlayState['cursorMode']): void {
    const x = Math.round(c.x) + 0.5, y = Math.round(c.y) + 0.5;
    ctx.strokeStyle = THEME.crosshair;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    if (mode !== 'select') {
      const len = this.cursorSize >= 100 ? Math.max(v.w, v.h) : (Math.max(v.w, v.h) * this.cursorSize) / 100;
      ctx.beginPath();
      ctx.moveTo(x - len, y); ctx.lineTo(x - (mode === 'idle' ? PICKBOX : 0), y);
      ctx.moveTo(x + (mode === 'idle' ? PICKBOX : 0), y); ctx.lineTo(x + len, y);
      ctx.moveTo(x, y - len); ctx.lineTo(x, y - (mode === 'idle' ? PICKBOX : 0));
      ctx.moveTo(x, y + (mode === 'idle' ? PICKBOX : 0)); ctx.lineTo(x, y + len);
      ctx.stroke();
    }
    if (mode === 'idle' || mode === 'select') ctx.strokeRect(x - PICKBOX, y - PICKBOX, PICKBOX * 2, PICKBOX * 2);
  }

  private drawSnapMarker(ctx: CanvasRenderingContext2D, s: Vec, kind: SnapKind, label: string): void {
    const r = 7;
    const x = Math.round(s.x) + 0.5, y = Math.round(s.y) + 0.5;
    ctx.strokeStyle = THEME.snap;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    switch (kind) {
      case 'end': ctx.rect(x - r, y - r, r * 2, r * 2); break;
      case 'mid': ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r * 0.8); ctx.lineTo(x - r, y + r * 0.8); ctx.closePath(); break;
      case 'cen': ctx.arc(x, y, r, 0, Math.PI * 2); break;
      case 'gcen': ctx.arc(x, y, r, 0, Math.PI * 2); ctx.moveTo(x - 3, y); ctx.lineTo(x + 3, y); ctx.moveTo(x, y - 3); ctx.lineTo(x, y + 3); break;
      case 'qua': ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); break;
      case 'int': ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x - r, y + r); ctx.lineTo(x + r, y - r); break;
      case 'per': ctx.moveTo(x - r, y - r); ctx.lineTo(x - r, y + r); ctx.lineTo(x + r, y + r); ctx.moveTo(x - r, y); ctx.lineTo(x, y); ctx.lineTo(x, y + r); break;
      case 'tan': ctx.arc(x, y, r * 0.75, 0, Math.PI * 2); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y - r); break;
      case 'nea': ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.lineTo(x + r, y + r); ctx.closePath(); break;
      case 'node': ctx.arc(x, y, r, 0, Math.PI * 2); ctx.moveTo(x - r * 0.7, y - r * 0.7); ctx.lineTo(x + r * 0.7, y + r * 0.7); ctx.moveTo(x - r * 0.7, y + r * 0.7); ctx.lineTo(x + r * 0.7, y - r * 0.7); break;
      case 'ins': ctx.rect(x - r, y - r, r, r); ctx.rect(x, y, r, r); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y - r); ctx.lineTo(x + r, y); ctx.moveTo(x - r, y); ctx.lineTo(x - r, y + r); ctx.lineTo(x, y + r); break;
    }
    ctx.stroke();
    if (label) {
      ctx.font = '12px "Segoe UI", Arial, sans-serif';
      const w = ctx.measureText(label).width + 12;
      // Above-right of the marker so it doesn't collide with the dynamic input tooltip.
      const bx = x + 14, by = y - 34;
      ctx.fillStyle = 'rgba(45,52,62,0.95)';
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.fillRect(bx, by, w, 20);
      ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, 19);
      ctx.fillStyle = '#e8edf3';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, bx + 6, by + 10.5);
    }
  }

  private drawLabel(ctx: CanvasRenderingContext2D, bx: number, by: number, label: string): void {
    ctx.font = '12px "Segoe UI", Arial, sans-serif';
    const w = ctx.measureText(label).width + 12;
    ctx.fillStyle = 'rgba(45,52,62,0.95)';
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.fillRect(bx, by, w, 20);
    ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, 19);
    ctx.fillStyle = '#e8edf3';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + 6, by + 10.5);
  }

  private drawUcs(ctx: CanvasRenderingContext2D, v: Viewport): void {
    const ox = 34, oy = v.h - 34, L = 46;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.strokeStyle = '#e04848';
    ctx.fillStyle = '#e04848';
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + L, oy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ox + L + 8, oy); ctx.lineTo(ox + L - 2, oy - 5); ctx.lineTo(ox + L - 2, oy + 5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#3cc35a';
    ctx.fillStyle = '#3cc35a';
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox, oy - L); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ox, oy - L - 8); ctx.lineTo(ox - 5, oy - L + 2); ctx.lineTo(ox + 5, oy - L + 2); ctx.closePath(); ctx.fill();
    ctx.font = 'bold 11px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#e04848';
    ctx.fillText('X', ox + L + 10, oy + 4);
    ctx.fillStyle = '#3cc35a';
    ctx.fillText('Y', ox - 4, oy - L - 12);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(ox - 3, oy - 3, 6, 6);
  }
}

function rotateV(p: Vec, a: number): Vec {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** Builds a canvas path for a bulge polyline. Works for both contexts and Path2D. */
export function polyPath(ctx: CanvasRenderingContext2D | Path2D, pts: Vec[], bulges: number[], closed: boolean): void {
  const n = pts.length;
  ctx.moveTo(pts[0].x, pts[0].y);
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const bu = bulges[i] || 0;
    if (Math.abs(bu) < 1e-12 || dist(a, b) < 1e-12) ctx.lineTo(b.x, b.y);
    else {
      const arc = bulgeArc(a, b, bu);
      ctx.arc(arc.c.x, arc.c.y, arc.r, angleBetween(arc.c, a), angleBetween(arc.c, b), bu < 0);
    }
  }
  if (closed) ctx.closePath();
}

/** Converts a linetype pattern into a canvas dash array (world units). */
function canvasDash(pattern: number[], scale: number, px: number): number[] {
  const out: number[] = [];
  let p = pattern.slice();
  if (p.length && p[0] < 0) p = [0, ...p];
  for (let i = 0; i < p.length; i++) {
    const v = Math.abs(p[i]) * scale;
    const isDash = i % 2 === 0;
    out.push(isDash ? Math.max(v, px * 0.5) : Math.max(v, px));
  }
  if (out.length % 2 === 1) out.push(px);
  return out;
}

// re-exported helpers for tests / editor
export { cross };

// World ↔ screen mapping for the model space view (Y up in world, Y down on screen).

import type { Vec, Box } from '../core/geom.ts';
import { boxValid } from '../core/geom.ts';
import { type ViewportEnt, vpScale } from '../core/entities.ts';

export class Viewport {
  /** World point at the center of the canvas. */
  cx = 210;
  cy = 148.5;
  /** Pixels per world unit. */
  scale = 2;
  w = 800;
  h = 600;
  private history: { cx: number; cy: number; scale: number }[] = [];

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
  }

  toScreen(p: Vec): Vec {
    return { x: (p.x - this.cx) * this.scale + this.w / 2, y: this.h / 2 - (p.y - this.cy) * this.scale };
  }

  toWorld(s: Vec): Vec {
    return { x: (s.x - this.w / 2) / this.scale + this.cx, y: (this.h / 2 - s.y) / this.scale + this.cy };
  }

  /** World distance covered by n pixels. */
  px(n: number): number {
    return n / this.scale;
  }

  visibleBox(margin = 0): Box {
    const a = this.toWorld({ x: -margin, y: this.h + margin });
    const b = this.toWorld({ x: this.w + margin, y: -margin });
    return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
  }

  pushHistory(): void {
    this.history.push({ cx: this.cx, cy: this.cy, scale: this.scale });
    if (this.history.length > 50) this.history.shift();
  }

  previous(): boolean {
    const h = this.history.pop();
    if (!h) return false;
    Object.assign(this, h);
    return true;
  }

  /** Zooms by factor keeping the world point under screen point s fixed. */
  zoomAt(s: Vec, factor: number): void {
    const before = this.toWorld(s);
    this.scale = Math.min(1e9, Math.max(1e-9, this.scale * factor));
    const after = this.toWorld(s);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
  }

  panPixels(dx: number, dy: number): void {
    this.cx -= dx / this.scale;
    this.cy += dy / this.scale;
  }

  fit(b: Box, marginFrac = 0.05): void {
    if (!boxValid(b)) return;
    const bw = Math.max(b.maxX - b.minX, 1e-9), bh = Math.max(b.maxY - b.minY, 1e-9);
    this.cx = (b.minX + b.maxX) / 2;
    this.cy = (b.minY + b.maxY) / 2;
    const s = Math.min(this.w / bw, this.h / bh) * (1 - marginFrac * 2);
    this.scale = Number.isFinite(s) && s > 0 ? s : 1;
  }
}

/** Model space view seen through a layout viewport, on the same canvas as the paper view. */
export function vpModelView(pv: Viewport, vp: ViewportEnt): Viewport {
  const mv = new Viewport();
  mv.resize(pv.w, pv.h);
  const sc = pv.scale * vpScale(vp);
  const S = pv.toScreen(vp.c);
  mv.scale = sc;
  mv.cx = vp.vc.x - (S.x - pv.w / 2) / sc;
  mv.cy = vp.vc.y + (S.y - pv.h / 2) / sc;
  return mv;
}

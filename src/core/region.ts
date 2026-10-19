// Boundary detection for HATCH "pick internal point": builds a planar graph from the
// visible geometry, finds the face that encloses the point, and collects islands.

import {
  type Vec, type Prim, type Box,
  sub, dist, angleBetween, lineLineParams, lerp, flattenArc, polygonArea, pointInPolygon,
  boxFromPts, boxIntersects, emptyBox, boxAdd,
} from './geom.ts';
import { type Entity, type DocCtx, type HatchLoop, entPrims, closedOutline } from './entities.ts';

interface Seg { a: Vec; b: Vec }

function primSegs(pr: Prim, maxErr: number, out: Seg[]): void {
  if (pr.k === 'seg') {
    if (dist(pr.a, pr.b) > 1e-12) out.push({ a: pr.a, b: pr.b });
    return;
  }
  const pts = flattenArc(pr.c, pr.r, pr.a0, pr.a1, maxErr, pr.full);
  for (let i = 1; i < pts.length; i++) out.push({ a: pts[i - 1], b: pts[i] });
}

/** Splits segments at all mutual intersections. */
function splitAll(segs: Seg[]): Seg[] {
  const n = segs.length;
  const params: number[][] = segs.map(() => [0, 1]);
  const boxes = segs.map((s) => boxFromPts(s.a, s.b));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!boxIntersects(boxes[i], boxes[j])) continue;
      const r = lineLineParams(segs[i].a, segs[i].b, segs[j].a, segs[j].b);
      if (!r) continue;
      const e = 1e-9;
      if (r.t >= -e && r.t <= 1 + e && r.u >= -e && r.u <= 1 + e) {
        params[i].push(Math.min(1, Math.max(0, r.t)));
        params[j].push(Math.min(1, Math.max(0, r.u)));
      }
    }
  }
  const out: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const ps = params[i].sort((a, b) => a - b);
    for (let k = 1; k < ps.length; k++) {
      if (ps[k] - ps[k - 1] < 1e-12) continue;
      out.push({ a: lerp(segs[i].a, segs[i].b, ps[k - 1]), b: lerp(segs[i].a, segs[i].b, ps[k]) });
    }
  }
  return out;
}

interface Graph {
  pts: Vec[];
  /** adjacency: for each node, neighbor node ids sorted by angle */
  adj: number[][];
}

function buildGraph(segs: Seg[], tol: number): Graph {
  const pts: Vec[] = [];
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.round(x / tol)},${Math.round(y / tol)}`;
  const nodeOf = (p: Vec): number => {
    const gx = Math.round(p.x / tol), gy = Math.round(p.y / tol);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const ids = grid.get(`${gx + dx},${gy + dy}`);
      if (ids) for (const id of ids) if (dist(pts[id], p) <= tol) return id;
    }
    const id = pts.length;
    pts.push(p);
    const k = key(p.x, p.y);
    const arr = grid.get(k);
    if (arr) arr.push(id); else grid.set(k, [id]);
    return id;
  };
  const edges = new Set<string>();
  const adjSet: Set<number>[] = [];
  for (const s of segs) {
    const a = nodeOf(s.a), b = nodeOf(s.b);
    if (a === b) continue;
    const ek = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (edges.has(ek)) continue;
    edges.add(ek);
    (adjSet[a] ??= new Set()).add(b);
    (adjSet[b] ??= new Set()).add(a);
  }
  // prune dangling edges
  const deg = pts.map((_, i) => adjSet[i]?.size ?? 0);
  const stack = deg.map((d, i) => (d === 1 ? i : -1)).filter((i) => i >= 0);
  while (stack.length) {
    const v = stack.pop()!;
    if (!adjSet[v] || adjSet[v].size !== 1) continue;
    const [w] = adjSet[v];
    adjSet[v].delete(w);
    adjSet[w].delete(v);
    if (adjSet[w].size === 1) stack.push(w);
  }
  const adj = pts.map((p, i) => [...(adjSet[i] ?? [])].sort((x, y) => angleBetween(p, pts[x]) - angleBetween(p, pts[y])));
  return { pts, adj };
}

/** Traces the face to the left of half-edge u→v. */
function traceFace(g: Graph, u: number, v: number, limit: number): number[] | null {
  const start = [u, v];
  const loop: number[] = [u];
  let a = u, b = v;
  for (let steps = 0; steps < limit; steps++) {
    loop.push(b);
    const nb = g.adj[b];
    if (!nb.length) return null;
    // twin direction b→a; next = first neighbor clockwise from it
    const idx = nb.indexOf(a);
    const next = nb[(idx - 1 + nb.length) % nb.length];
    a = b;
    b = next;
    if (a === start[0] && b === start[1]) {
      loop.pop();
      return loop;
    }
  }
  return null;
}

export interface BoundaryResult {
  loops: HatchLoop[];
  outer: Vec[];
}

/**
 * Finds the hatch boundary around point p using the given entities.
 * maxErr controls arc flattening (world units).
 */
export function findBoundary(p: Vec, ents: Entity[], ctx: DocCtx, maxErr: number): BoundaryResult | null {
  const segs: Seg[] = [];
  for (const e of ents) {
    if (e.type === 'hatch' || e.type === 'text' || e.type === 'mtext' || e.type === 'dimension' || e.type === 'point') continue;
    for (const pr of entPrims(e, ctx, maxErr)) primSegs(pr, maxErr, segs);
  }
  if (segs.length > 60000) return null;
  const split = splitAll(segs);
  let span = 0;
  for (const s of split) span = Math.max(span, Math.abs(s.a.x), Math.abs(s.a.y));
  const tol = Math.max(maxErr * 0.05, span * 1e-10, 1e-9);
  const g = buildGraph(split, tol);

  // Ray to +x: nearest crossing edge.
  let best: { u: number; v: number; x: number } | null = null;
  for (let u = 0; u < g.pts.length; u++) {
    for (const v of g.adj[u]) {
      if (v < u) continue;
      const a = g.pts[u], b = g.pts[v];
      if ((a.y > p.y) === (b.y > p.y)) continue;
      const x = a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y);
      if (x > p.x && (!best || x < best.x)) best = { u, v, x };
    }
  }
  if (!best) return null;
  // Orient so p is on the left.
  const A = g.pts[best.u], B = g.pts[best.v];
  const leftOf = (sub(B, A).x * (p.y - A.y) - sub(B, A).y * (p.x - A.x)) > 0;
  const [u0, v0] = leftOf ? [best.u, best.v] : [best.v, best.u];
  const face = traceFace(g, u0, v0, g.pts.length * 4 + 10);
  if (!face) return null;
  const outer = face.map((i) => g.pts[i]);
  if (polygonArea(outer) <= 0 || !pointInPolygon(p, outer)) return null;

  // Islands: closed entities inside the outer boundary that don't contain p.
  const loops: HatchLoop[] = [{ pts: outer, bulges: outer.map(() => 0) }];
  const ob = emptyBox();
  for (const q of outer) boxAdd(ob, q);
  for (const e of ents) {
    const ol = closedOutline(e, maxErr) ?? (e.type === 'text' || e.type === 'mtext' ? null : null);
    if (!ol || ol.length < 3) continue;
    if (pointInPolygon(p, ol)) continue;
    if (!ol.every((q) => pointInPolygon(q, outer))) continue;
    if (sameLoop(ol, outer, tol * 10)) continue;
    loops.push({ pts: ol, bulges: ol.map(() => 0) });
  }
  return { loops, outer };
}

function sameLoop(a: Vec[], b: Vec[], tol: number): boolean {
  return Math.abs(Math.abs(polygonArea(a)) - Math.abs(polygonArea(b))) < tol * tol * 100 && a.every((p) => b.some((q) => dist(p, q) < tol * 100));
}

export function boxOfLoop(pts: Vec[]): Box {
  const b = emptyBox();
  for (const p of pts) boxAdd(b, p);
  return b;
}

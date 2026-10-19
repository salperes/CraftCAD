// 2D geometry primitives and algorithms shared by entities, snapping and modify commands.

export interface Vec {
  x: number;
  y: number;
}

export const EPS = 1e-9;
export const TAU = Math.PI * 2;

export const v = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const perp = (a: Vec): Vec => ({ x: -a.y, y: a.x });
export const angleOf = (a: Vec): number => Math.atan2(a.y, a.x);
export const angleBetween = (from: Vec, to: Vec): number => Math.atan2(to.y - from.y, to.x - from.x);
export const polar = (p: Vec, ang: number, d: number): Vec => ({ x: p.x + Math.cos(ang) * d, y: p.y + Math.sin(ang) * d });
export const dir = (ang: number): Vec => ({ x: Math.cos(ang), y: Math.sin(ang) });
export const eq = (a: Vec, b: Vec, tol = 1e-7): boolean => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
export const clone = (a: Vec): Vec => ({ x: a.x, y: a.y });

export function norm(a: Vec): Vec {
  const l = len(a);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

export function rotate(p: Vec, c: Vec, ang: number): Vec {
  const s = Math.sin(ang), co = Math.cos(ang);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * co - dy * s, y: c.y + dx * s + dy * co };
}

/** Normalizes an angle into [0, 2π). */
export function normAng(a: number): number {
  a %= TAU;
  return a < 0 ? a + TAU : a;
}

/** Counter-clockwise sweep from a0 to a1 in (0, 2π]. */
export function sweep(a0: number, a1: number): number {
  const s = normAng(a1 - a0);
  return s < 1e-12 ? TAU : s;
}

/** True if angle a lies on the counter-clockwise arc from a0 to a1. */
export function angInArc(a: number, a0: number, a1: number, tol = 1e-9): boolean {
  return normAng(a - a0) <= sweep(a0, a1) + tol;
}

// ---------------------------------------------------------------------------
// Affine matrices: x' = a*x + c*y + e, y' = b*x + d*y + f

export interface Mat {
  a: number; b: number; c: number; d: number; e: number; f: number;
}

export const IDENT: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function mxApply(m: Mat, p: Vec): Vec {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

export function mxApplyVec(m: Mat, p: Vec): Vec {
  return { x: m.a * p.x + m.c * p.y, y: m.b * p.x + m.d * p.y };
}

/** Returns m1 ∘ m2 (apply m2 first, then m1). */
export function mxMul(m1: Mat, m2: Mat): Mat {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

export function mxInvert(m: Mat): Mat {
  const det = m.a * m.d - m.b * m.c;
  const id = 1 / det;
  return {
    a: m.d * id, b: -m.b * id, c: -m.c * id, d: m.a * id,
    e: (m.c * m.f - m.d * m.e) * id,
    f: (m.b * m.e - m.a * m.f) * id,
  };
}

export const mxDet = (m: Mat): number => m.a * m.d - m.b * m.c;
export const mxTranslate = (dx: number, dy: number): Mat => ({ a: 1, b: 0, c: 0, d: 1, e: dx, f: dy });

export function mxRotate(ang: number, c: Vec = { x: 0, y: 0 }): Mat {
  const s = Math.sin(ang), co = Math.cos(ang);
  return { a: co, b: s, c: -s, d: co, e: c.x - co * c.x + s * c.y, f: c.y - s * c.x - co * c.y };
}

export function mxScale(sx: number, sy: number, c: Vec = { x: 0, y: 0 }): Mat {
  return { a: sx, b: 0, c: 0, d: sy, e: c.x - sx * c.x, f: c.y - sy * c.y };
}

/** Reflection across the line through p1 and p2. */
export function mxMirror(p1: Vec, p2: Vec): Mat {
  const ang = angleBetween(p1, p2);
  const c2 = Math.cos(2 * ang), s2 = Math.sin(2 * ang);
  const r: Mat = { a: c2, b: s2, c: s2, d: -c2, e: 0, f: 0 };
  const t1 = mxTranslate(-p1.x, -p1.y), t2 = mxTranslate(p1.x, p1.y);
  return mxMul(t2, mxMul(r, t1));
}

/** Insert-style transform: scale, then rotate, then translate to position. */
export function mxInsert(pos: Vec, sx: number, sy: number, rot: number, base: Vec = { x: 0, y: 0 }): Mat {
  const tb = mxTranslate(-base.x, -base.y);
  const s = mxScale(sx, sy);
  const r = mxRotate(rot);
  const t = mxTranslate(pos.x, pos.y);
  return mxMul(t, mxMul(r, mxMul(s, tb)));
}

/** Uniform scale factor of a similarity transform. */
export const mxScaleFactor = (m: Mat): number => Math.sqrt(Math.abs(mxDet(m)));

// ---------------------------------------------------------------------------
// Bounding boxes

export interface Box {
  minX: number; minY: number; maxX: number; maxY: number;
}

export const emptyBox = (): Box => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
export const boxValid = (b: Box): boolean => b.minX <= b.maxX && b.minY <= b.maxY;

export function boxAdd(b: Box, p: Vec): Box {
  if (p.x < b.minX) b.minX = p.x;
  if (p.y < b.minY) b.minY = p.y;
  if (p.x > b.maxX) b.maxX = p.x;
  if (p.y > b.maxY) b.maxY = p.y;
  return b;
}

export function boxUnion(a: Box, b: Box): Box {
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}

export function boxFromPts(a: Vec, b: Vec): Box {
  return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
}

export const boxIntersects = (a: Box, b: Box): boolean =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

export const boxContainsBox = (outer: Box, inner: Box): boolean =>
  inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;

export const boxContains = (b: Box, p: Vec, tol = 0): boolean =>
  p.x >= b.minX - tol && p.x <= b.maxX + tol && p.y >= b.minY - tol && p.y <= b.maxY + tol;

export function boxExpand(b: Box, d: number): Box {
  return { minX: b.minX - d, minY: b.minY - d, maxX: b.maxX + d, maxY: b.maxY + d };
}

export function boxTransform(b: Box, m: Mat): Box {
  const out = emptyBox();
  boxAdd(out, mxApply(m, { x: b.minX, y: b.minY }));
  boxAdd(out, mxApply(m, { x: b.maxX, y: b.minY }));
  boxAdd(out, mxApply(m, { x: b.maxX, y: b.maxY }));
  boxAdd(out, mxApply(m, { x: b.minX, y: b.maxY }));
  return out;
}

export function arcBox(c: Vec, r: number, a0: number, a1: number): Box {
  const b = emptyBox();
  boxAdd(b, polar(c, a0, r));
  boxAdd(b, polar(c, a1, r));
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    if (angInArc(a, a0, a1)) boxAdd(b, polar(c, a, r));
  }
  return b;
}

// ---------------------------------------------------------------------------
// Primitives used for hit testing, snapping, intersection and trimming.

export interface SegPrim { k: 'seg'; a: Vec; b: Vec }
/** Counter-clockwise arc from a0 to a1. full=true for whole circles. */
export interface ArcPrim { k: 'arc'; c: Vec; r: number; a0: number; a1: number; full?: boolean }
export type Prim = SegPrim | ArcPrim;

export const seg = (a: Vec, b: Vec): SegPrim => ({ k: 'seg', a, b });
export const arcPrim = (c: Vec, r: number, a0: number, a1: number, full = false): ArcPrim => ({ k: 'arc', c, r, a0, a1, full });

export function closestOnSeg(p: Vec, a: Vec, b: Vec): { pt: Vec; t: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < EPS * EPS) return { pt: clone(a), t: 0 };
  let t = dot(sub(p, a), ab) / l2;
  t = Math.max(0, Math.min(1, t));
  return { pt: lerp(a, b, t), t };
}

export function closestOnArc(p: Vec, c: Vec, r: number, a0: number, a1: number, full = false): Vec {
  const ang = angleBetween(c, p);
  if (full || angInArc(ang, a0, a1)) return polar(c, ang, r);
  const s = polar(c, a0, r), e = polar(c, a1, r);
  return dist(p, s) < dist(p, e) ? s : e;
}

export function closestOnPrim(p: Vec, pr: Prim): Vec {
  return pr.k === 'seg' ? closestOnSeg(p, pr.a, pr.b).pt : closestOnArc(p, pr.c, pr.r, pr.a0, pr.a1, pr.full);
}

export const distToPrim = (p: Vec, pr: Prim): number => dist(p, closestOnPrim(p, pr));

export function primStart(pr: Prim): Vec {
  return pr.k === 'seg' ? pr.a : polar(pr.c, pr.a0, pr.r);
}

export function primEnd(pr: Prim): Vec {
  return pr.k === 'seg' ? pr.b : polar(pr.c, pr.a1, pr.r);
}

export function primLength(pr: Prim): number {
  return pr.k === 'seg' ? dist(pr.a, pr.b) : pr.r * (pr.full ? TAU : sweep(pr.a0, pr.a1));
}

/** Point at normalized parameter t in [0,1] along the primitive. */
export function primPointAt(pr: Prim, t: number): Vec {
  if (pr.k === 'seg') return lerp(pr.a, pr.b, t);
  const s = pr.full ? TAU : sweep(pr.a0, pr.a1);
  return polar(pr.c, pr.a0 + s * t, pr.r);
}

/** Normalized parameter of point p (assumed on/near the primitive). */
export function primParamOf(pr: Prim, p: Vec): number {
  if (pr.k === 'seg') {
    const ab = sub(pr.b, pr.a);
    const l2 = dot(ab, ab);
    return l2 < EPS ? 0 : dot(sub(p, pr.a), ab) / l2;
  }
  const s = pr.full ? TAU : sweep(pr.a0, pr.a1);
  return normAng(angleBetween(pr.c, p) - pr.a0) / s;
}

/** Tangent direction (unit) at normalized parameter t. */
export function primTangentAt(pr: Prim, t: number): Vec {
  if (pr.k === 'seg') return norm(sub(pr.b, pr.a));
  const s = pr.full ? TAU : sweep(pr.a0, pr.a1);
  const ang = pr.a0 + s * t;
  return { x: -Math.sin(ang), y: Math.cos(ang) };
}

// ---------------------------------------------------------------------------
// Intersections. Each returns points; params are checked by caller helpers.

/** Infinite line intersection; returns params along a1->a2 and b1->b2. */
export function lineLineParams(a1: Vec, a2: Vec, b1: Vec, b2: Vec): { t: number; u: number } | null {
  const r = sub(a2, a1), s = sub(b2, b1);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-12 * (len(r) * len(s) + 1e-30)) return null;
  const qp = sub(b1, a1);
  return { t: cross(qp, s) / den, u: cross(qp, r) / den };
}

export function lineLine(a1: Vec, a2: Vec, b1: Vec, b2: Vec): Vec | null {
  const r = lineLineParams(a1, a2, b1, b2);
  return r ? lerp(a1, a2, r.t) : null;
}

/** Params t along infinite line p1->p2 where it meets circle (c, r). */
export function lineCircleParams(p1: Vec, p2: Vec, c: Vec, r: number): number[] {
  const d = sub(p2, p1), f = sub(p1, c);
  const A = dot(d, d);
  if (A < EPS * EPS) return [];
  const B = 2 * dot(f, d), C = dot(f, f) - r * r;
  let disc = B * B - 4 * A * C;
  const tol = 1e-10 * Math.max(1, B * B);
  if (disc < -tol) return [];
  if (disc < tol) return [-B / (2 * A)];
  disc = Math.sqrt(disc);
  return [(-B - disc) / (2 * A), (-B + disc) / (2 * A)];
}

export function circleCircle(c1: Vec, r1: number, c2: Vec, r2: number): Vec[] {
  const d = dist(c1, c2);
  if (d < EPS) return [];
  if (d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  const h = h2 > 0 ? Math.sqrt(h2) : 0;
  const pm = add(c1, mul(sub(c2, c1), a / d));
  if (h < 1e-9) return [pm];
  const off = mul(perp(norm(sub(c2, c1))), h);
  return [add(pm, off), sub(pm, off)];
}

const PTOL = 1e-9;

function onPrim(pr: Prim, p: Vec, extend: boolean): boolean {
  if (pr.k === 'seg') {
    if (extend) return true;
    const t = primParamOf(pr, p);
    return t >= -PTOL && t <= 1 + PTOL;
  }
  if (pr.full || extend) return true;
  return angInArc(angleBetween(pr.c, p), pr.a0, pr.a1, 1e-9);
}

/**
 * Intersection points between two primitives.
 * extA / extB treat the primitive as unbounded (infinite line / full circle).
 */
export function intersectPrims(a: Prim, b: Prim, extA = false, extB = false): Vec[] {
  let pts: Vec[] = [];
  if (a.k === 'seg' && b.k === 'seg') {
    const r = lineLineParams(a.a, a.b, b.a, b.b);
    if (r) pts = [lerp(a.a, a.b, r.t)];
  } else if (a.k === 'seg' && b.k === 'arc') {
    pts = lineCircleParams(a.a, a.b, b.c, b.r).map((t) => lerp(a.a, a.b, t));
  } else if (a.k === 'arc' && b.k === 'seg') {
    pts = lineCircleParams(b.a, b.b, a.c, a.r).map((t) => lerp(b.a, b.b, t));
  } else if (a.k === 'arc' && b.k === 'arc') {
    pts = circleCircle(a.c, a.r, b.c, b.r);
  }
  return pts.filter((p) => onPrim(a, p, extA) && onPrim(b, p, extB));
}

// ---------------------------------------------------------------------------
// Polyline bulge arcs

/** Converts a bulge segment p1->p2 into an arc (center, radius, ccw start/end angles). */
export function bulgeArc(p1: Vec, p2: Vec, bulge: number): ArcPrim {
  const theta = 4 * Math.atan(bulge);
  const chord = dist(p1, p2);
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
  const m = mid(p1, p2);
  const h = r * Math.cos(theta / 2);
  const n = norm(perp(sub(p2, p1)));
  const c = add(m, mul(n, Math.sign(bulge) * h));
  const sa = angleBetween(c, p1), ea = angleBetween(c, p2);
  return bulge > 0 ? arcPrim(c, Math.abs(r), sa, ea) : arcPrim(c, Math.abs(r), ea, sa);
}

/** Bulge for an arc of included angle (signed, ccw positive). */
export const bulgeFromAngle = (included: number): number => Math.tan(included / 4);

/** Primitive for polyline segment i (p1->p2 with bulge); direction is preserved for segs. */
export function bulgeSegPrim(p1: Vec, p2: Vec, bulge: number): Prim {
  if (Math.abs(bulge) < 1e-12 || eq(p1, p2)) return seg(p1, p2);
  return bulgeArc(p1, p2, bulge);
}

/** Point at fraction t along a bulge segment (respecting travel direction p1->p2). */
export function bulgePointAt(p1: Vec, p2: Vec, bulge: number, t: number): Vec {
  if (Math.abs(bulge) < 1e-12) return lerp(p1, p2, t);
  const a = bulgeArc(p1, p2, bulge);
  const theta = 4 * Math.atan(bulge);
  const sa = angleBetween(a.c, p1);
  return polar(a.c, sa + theta * t, a.r);
}

/** Fraction along a bulge segment (travel direction p1->p2) of a point on it. */
export function bulgeParamOf(p1: Vec, p2: Vec, bulge: number, p: Vec): number {
  if (Math.abs(bulge) < 1e-12) {
    const ab = sub(p2, p1);
    const l2 = dot(ab, ab);
    return l2 < EPS ? 0 : dot(sub(p, p1), ab) / l2;
  }
  const a = bulgeArc(p1, p2, bulge);
  const theta = 4 * Math.atan(bulge);
  const sa = angleBetween(a.c, p1);
  const ang = angleBetween(a.c, p);
  const delta = theta > 0 ? normAng(ang - sa) : normAng(sa - ang);
  return delta / Math.abs(theta);
}

/** Flattens a bulge segment into points (excluding p1, including p2). */
export function flattenBulge(p1: Vec, p2: Vec, bulge: number, maxErr: number): Vec[] {
  if (Math.abs(bulge) < 1e-12) return [p2];
  const a = bulgeArc(p1, p2, bulge);
  const theta = 4 * Math.atan(bulge);
  const n = arcSegments(a.r, Math.abs(theta), maxErr);
  const sa = angleBetween(a.c, p1);
  const out: Vec[] = [];
  for (let i = 1; i < n; i++) out.push(polar(a.c, sa + (theta * i) / n, a.r));
  out.push(p2);
  return out;
}

export function arcSegments(r: number, sweepAng: number, maxErr: number): number {
  if (r <= maxErr) return Math.max(2, Math.ceil(sweepAng / (Math.PI / 4)));
  const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - maxErr / r)));
  return Math.max(2, Math.min(720, Math.ceil(sweepAng / Math.max(step, 1e-3))));
}

export function flattenArc(c: Vec, r: number, a0: number, a1: number, maxErr: number, full = false): Vec[] {
  const s = full ? TAU : sweep(a0, a1);
  const n = arcSegments(r, s, maxErr);
  const out: Vec[] = [];
  for (let i = 0; i <= n; i++) out.push(polar(c, a0 + (s * i) / n, r));
  return out;
}

// ---------------------------------------------------------------------------
// Polygons

export function polygonArea(pts: Vec[]): number {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function pointInPolygon(p: Vec, pts: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Segment-vs-box overlap test (Liang–Barsky clip). */
export function segIntersectsBox(a: Vec, b: Vec, box: Box): boolean {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-15) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return clip(-dx, a.x - box.minX) && clip(dx, box.maxX - a.x) && clip(-dy, a.y - box.minY) && clip(dy, box.maxY - a.y);
}

export function primIntersectsBox(pr: Prim, box: Box): boolean {
  if (pr.k === 'seg') return segIntersectsBox(pr.a, pr.b, box);
  const pts = flattenArc(pr.c, pr.r, pr.a0, pr.a1, Math.max(pr.r * 0.002, 1e-6), pr.full);
  for (let i = 1; i < pts.length; i++) if (segIntersectsBox(pts[i - 1], pts[i], box)) return true;
  return false;
}

export function primBox(pr: Prim): Box {
  if (pr.k === 'seg') return boxFromPts(pr.a, pr.b);
  if (pr.full) return { minX: pr.c.x - pr.r, minY: pr.c.y - pr.r, maxX: pr.c.x + pr.r, maxY: pr.c.y + pr.r };
  return arcBox(pr.c, pr.r, pr.a0, pr.a1);
}

export const fmtNum = (n: number, dec = 4): string => {
  const s = n.toFixed(dec);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
};

export const deg = (r: number): number => (r * 180) / Math.PI;
export const rad = (d: number): number => (d * Math.PI) / 180;

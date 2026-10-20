// Curve parameterization and geometric editing algorithms behind TRIM, EXTEND, BREAK,
// OFFSET, FILLET, CHAMFER and STRETCH.

import {
  type Vec, type Prim, type Box,
  add, sub, mul, dist, norm, perp, cross, dot, polar, angleBetween, lerp, normAng, sweep, TAU,
  intersectPrims, lineLineParams, lineCircleParams, circleCircle, bulgeArc, bulgePointAt, bulgeParamOf,
  bulgeSegPrim, seg, arcPrim, closestOnSeg, closestOnArc, boxContains, angInArc, eq,
} from './geom.ts';
import {
  type Entity, type NewEntity, type LineEnt, type ArcEnt, type PolylineEnt,
  entGrips, entMoveGrip, entTransform, polylineSegPrims, vpResize,
} from './entities.ts';
import { mxTranslate } from './geom.ts';

type Props = Pick<Entity, 'layer' | 'color' | 'ltype' | 'trueColor'>;
const props = (e: Entity): Props => ({ layer: e.layer, color: e.color, ltype: e.ltype, trueColor: e.trueColor });

export type Curve = LineEnt | ArcEnt | PolylineEnt | (Entity & { type: 'circle' });

export function isCurve(e: Entity): e is Curve {
  return e.type === 'line' || e.type === 'arc' || e.type === 'circle' || e.type === 'polyline';
}

const PEPS = 1e-9;

export function curvePeriodic(e: Curve): boolean {
  return e.type === 'circle' || (e.type === 'polyline' && e.closed);
}

/** Parameter range [0, max]. Lines/arcs: [0,1]; circles: [0, 2π); polylines: [0, segments]. */
export function curveMax(e: Curve): number {
  switch (e.type) {
    case 'line': case 'arc': return 1;
    case 'circle': return TAU;
    case 'polyline': return e.closed ? e.pts.length : e.pts.length - 1;
  }
}

export function curvePointAt(e: Curve, u: number): Vec {
  switch (e.type) {
    case 'line': return lerp(e.p1, e.p2, u);
    case 'arc': return polar(e.c, e.a0 + sweep(e.a0, e.a1) * u, e.r);
    case 'circle': return polar(e.c, u, e.r);
    case 'polyline': {
      const n = e.pts.length;
      const max = curveMax(e);
      if (e.closed) u = ((u % max) + max) % max;
      u = Math.max(0, Math.min(max, u));
      let k = Math.floor(u);
      if (k >= max) k = max - 1;
      const t = u - k;
      return bulgePointAt(e.pts[k], e.pts[(k + 1) % n], e.bulges[k] || 0, t);
    }
  }
}

/** Parameter of the point on the curve closest to p. */
export function curveParamOf(e: Curve, p: Vec): number {
  switch (e.type) {
    case 'line': return closestOnSeg(p, e.p1, e.p2).t;
    case 'arc': {
      const q = closestOnArc(p, e.c, e.r, e.a0, e.a1);
      return Math.min(1, Math.max(0, normAng(angleBetween(e.c, q) - e.a0) / sweep(e.a0, e.a1)));
    }
    case 'circle': return normAng(angleBetween(e.c, p));
    case 'polyline': {
      const n = e.pts.length;
      const segs = curveMax(e);
      let best = 0, bestD = Infinity;
      for (let k = 0; k < segs; k++) {
        const a = e.pts[k], b = e.pts[(k + 1) % n], bu = e.bulges[k] || 0;
        const pr = bulgeSegPrim(a, b, bu);
        const q = pr.k === 'seg' ? closestOnSeg(p, pr.a, pr.b).pt : closestOnArc(p, pr.c, pr.r, pr.a0, pr.a1);
        const d = dist(p, q);
        if (d < bestD) { bestD = d; best = k + Math.min(1, Math.max(0, bulgeParamOf(a, b, bu, q))); }
      }
      return best;
    }
  }
}

/** Primitives of a curve, each tagged with the parameter interval it covers. */
function curvePrims(e: Curve): { pr: Prim; u0: number }[] {
  switch (e.type) {
    case 'line': return [{ pr: seg(e.p1, e.p2), u0: 0 }];
    case 'arc': return [{ pr: arcPrim(e.c, e.r, e.a0, e.a1), u0: 0 }];
    case 'circle': return [{ pr: arcPrim(e.c, e.r, 0, TAU, true), u0: 0 }];
    case 'polyline': return polylineSegPrims(e).map((pr, k) => ({ pr, u0: k }));
  }
}

/** Parameters where the curve meets the given cutting primitives. */
export function curveCuts(e: Curve, cutters: Prim[], selfCuts = false): number[] {
  const out: number[] = [];
  const own = curvePrims(e);
  for (const { pr } of own) {
    for (const c of cutters) for (const p of intersectPrims(pr, c)) out.push(curveParamOf(e, p));
  }
  if (selfCuts && own.length > 2) {
    for (let i = 0; i < own.length; i++) for (let j = i + 2; j < own.length; j++) {
      if (curvePeriodic(e) && i === 0 && j === own.length - 1) continue;
      for (const p of intersectPrims(own[i].pr, own[j].pr)) out.push(curveParamOf(e, p));
    }
  }
  out.sort((a, b) => a - b);
  const uniq: number[] = [];
  for (const u of out) if (!uniq.length || Math.abs(u - uniq[uniq.length - 1]) > 1e-7) uniq.push(u);
  return uniq;
}

/** Sub-curve between parameters u0 < u1 (u1 may exceed max for periodic curves). */
export function curveSub(e: Curve, u0: number, u1: number): NewEntity | null {
  if (u1 - u0 < PEPS) return null;
  const p = props(e);
  switch (e.type) {
    case 'line': {
      const a = lerp(e.p1, e.p2, u0), b = lerp(e.p1, e.p2, u1);
      return dist(a, b) < 1e-9 ? null : { type: 'line', p1: a, p2: b, ...p };
    }
    case 'arc': {
      const s = sweep(e.a0, e.a1);
      return { type: 'arc', c: e.c, r: e.r, a0: e.a0 + s * u0, a1: e.a0 + s * u1, ...p };
    }
    case 'circle': {
      if (u1 - u0 >= TAU - 1e-9) return { type: 'circle', c: e.c, r: e.r, ...p };
      return { type: 'arc', c: e.c, r: e.r, a0: normAng(u0), a1: normAng(u1), ...p };
    }
    case 'polyline': {
      const n = e.pts.length;
      const max = curveMax(e);
      const pts: Vec[] = [curvePointAt(e, u0)];
      const bulges: number[] = [];
      let u = u0;
      while (u < u1 - PEPS) {
        const k = Math.floor(u + PEPS);
        const segEnd = Math.min(k + 1, u1);
        const kk = ((k % max) + max) % max;
        const b = e.bulges[kk] || 0;
        const t0 = u - k, t1 = segEnd - k;
        const theta = 4 * Math.atan(b);
        bulges.push(Math.abs(b) < 1e-12 ? 0 : Math.tan((theta * (t1 - t0)) / 4));
        pts.push(segEnd >= k + 1 - PEPS ? e.pts[(kk + 1) % n] : bulgePointAt(e.pts[kk], e.pts[(kk + 1) % n], b, t1));
        u = segEnd;
      }
      bulges.push(0);
      // drop zero-length pieces
      const P: Vec[] = [pts[0]], B: number[] = [];
      for (let i = 1; i < pts.length; i++) {
        if (dist(pts[i], P[P.length - 1]) < 1e-9) continue;
        B.push(bulges[i - 1]);
        P.push(pts[i]);
      }
      B.push(0);
      if (P.length < 2) return null;
      if (P.length === 2 && Math.abs(B[0]) < 1e-12) return { type: 'line', p1: P[0], p2: P[1], ...p };
      return { type: 'polyline', pts: P, bulges: B, closed: false, width: e.width, ...p };
    }
  }
}

/**
 * TRIM (quick mode): removes the piece of `e` around pick point `pick` bounded by cuts.
 * Returns replacement entities ([] = delete), or null if nothing can be trimmed.
 */
export function trimCurve(e: Curve, cutters: Prim[], pick: Vec): NewEntity[] | null {
  const cuts = curveCuts(e, cutters, e.type === 'polyline');
  const up = curveParamOf(e, pick);
  const max = curveMax(e);
  if (curvePeriodic(e)) {
    const inner = cuts.filter((c) => c > PEPS && c < max - PEPS || e.type === 'circle');
    const cs = e.type === 'circle' ? cuts : inner.length ? cuts : [];
    if (cs.length < 2) return cs.length === 0 ? [] : null;
    let lo = -Infinity, hi = Infinity;
    for (const c of cs) {
      if (c < up && c > lo) lo = c;
      if (c > up && c < hi) hi = c;
    }
    if (lo === -Infinity) lo = cs[cs.length - 1] - max;
    if (hi === Infinity) hi = cs[0] + max;
    // keep from hi forward to lo + max
    const keepFrom = hi, keepTo = lo + max;
    const piece = curveSub(e, keepFrom, keepTo);
    return piece ? [piece] : [];
  }
  const interior = cuts.filter((c) => c > PEPS && c < max - PEPS);
  if (!interior.length) return [];
  let lo = -Infinity, hi = Infinity;
  for (const c of interior) {
    if (c < up && c > lo) lo = c;
    if (c > up && c < hi) hi = c;
  }
  const out: NewEntity[] = [];
  if (lo > -Infinity) { const a = curveSub(e, 0, lo); if (a) out.push(a); }
  if (hi < Infinity) { const b = curveSub(e, hi, max); if (b) out.push(b); }
  return out;
}

/** BREAK between two points on the curve. */
export function breakCurve(e: Curve, p1: Vec, p2: Vec): NewEntity[] | null {
  const max = curveMax(e);
  let u1 = curveParamOf(e, p1), u2 = curveParamOf(e, p2);
  if (curvePeriodic(e)) {
    if (Math.abs(u1 - u2) < PEPS) return null;
    // AutoCAD removes the counter-clockwise part from the first to the second point (circles).
    if (u2 < u1) u2 += max;
    const piece = curveSub(e, u2, u1 + max);
    return piece ? [piece] : [];
  }
  if (u1 > u2) [u1, u2] = [u2, u1];
  const out: NewEntity[] = [];
  const a = curveSub(e, 0, u1), b = curveSub(e, u2, max);
  if (a) out.push(a);
  if (b) out.push(b);
  if (Math.abs(u1 - u2) < PEPS && a && b) return out;
  return out;
}

// ---------------------------------------------------------------------------
// EXTEND

/** Extends the end of an open curve nearest to `pick` up to the closest boundary. */
export function extendCurve(e: Curve, bounds: Prim[], pick: Vec): Entity | null {
  if (curvePeriodic(e)) return null;
  const atEnd = curveParamOf(e, pick) > curveMax(e) / 2;
  if (e.type === 'line') {
    const [a, b] = atEnd ? [e.p1, e.p2] : [e.p2, e.p1];
    const t = rayHit(a, b, bounds);
    if (t === null) return null;
    const np = lerp(a, b, t);
    return atEnd ? { ...e, p2: np } : { ...e, p1: np };
  }
  if (e.type === 'arc') {
    const ang = arcExtendAngle(e.c, e.r, atEnd ? e.a1 : e.a0, atEnd, bounds, e.a0, e.a1);
    if (ang === null) return null;
    return atEnd ? { ...e, a1: ang } : { ...e, a0: ang };
  }
  if (e.type === 'polyline') {
    const n = e.pts.length;
    if (n < 2) return null;
    const pts = e.pts.slice();
    if (atEnd) {
      const b = e.bulges[n - 2] || 0;
      const np = extendSegEnd(pts[n - 2], pts[n - 1], b, true, bounds);
      if (!np) return null;
      const bulges = e.bulges.slice();
      if (Math.abs(b) > 1e-12) bulges[n - 2] = recomputeBulge(pts[n - 2], pts[n - 1], b, pts[n - 2], np);
      pts[n - 1] = np;
      return { ...e, pts, bulges };
    }
    const b = e.bulges[0] || 0;
    const np = extendSegEnd(pts[0], pts[1], b, false, bounds);
    if (!np) return null;
    const bulges = e.bulges.slice();
    if (Math.abs(b) > 1e-12) bulges[0] = recomputeBulge(pts[0], pts[1], b, np, pts[1]);
    pts[0] = np;
    return { ...e, pts, bulges };
  }
  return null;
}

/** Smallest t > 1 where the ray a→b (beyond b) meets a boundary. */
function rayHit(a: Vec, b: Vec, bounds: Prim[]): number | null {
  let best: number | null = null;
  const L = dist(a, b);
  for (const pr of bounds) {
    let ts: number[] = [];
    if (pr.k === 'seg') {
      const r = lineLineParams(a, b, pr.a, pr.b);
      if (r && r.u >= -1e-9 && r.u <= 1 + 1e-9) ts = [r.t];
    } else {
      ts = lineCircleParams(a, b, pr.c, pr.r).filter((t) => pr.full || angInArc(angleBetween(pr.c, lerp(a, b, t)), pr.a0, pr.a1));
    }
    for (const t of ts) if (t > 1 + 1e-9 / Math.max(L, 1e-9) && (best === null || t < best)) best = t;
  }
  return best;
}

function arcExtendAngle(c: Vec, r: number, from: number, forward: boolean, bounds: Prim[], a0: number, a1: number): number | null {
  const circle = arcPrim(c, r, 0, TAU, true);
  let best: number | null = null, bestD = Infinity;
  for (const pr of bounds) {
    for (const p of intersectPrims(circle, pr)) {
      const ang = angleBetween(c, p);
      if (angInArc(ang, a0, a1, 1e-9)) continue;
      const d = forward ? normAng(ang - from) : normAng(from - ang);
      if (d > 1e-9 && d < bestD) { bestD = d; best = ang; }
    }
  }
  return best;
}

function extendSegEnd(p1: Vec, p2: Vec, bulge: number, atEnd: boolean, bounds: Prim[]): Vec | null {
  if (Math.abs(bulge) < 1e-12) {
    const t = atEnd ? rayHit(p1, p2, bounds) : rayHit(p2, p1, bounds);
    if (t === null) return null;
    return atEnd ? lerp(p1, p2, t) : lerp(p2, p1, t);
  }
  const arc = bulgeArc(p1, p2, bulge);
  // Travel direction along the polyline: ccw when bulge > 0.
  const ccw = bulge > 0;
  const endAng = angleBetween(arc.c, atEnd ? p2 : p1);
  const forward = atEnd ? ccw : !ccw;
  const ang = arcExtendAngle(arc.c, arc.r, endAng, forward, bounds, arc.a0, arc.a1);
  return ang === null ? null : polar(arc.c, ang, arc.r);
}

/** Bulge for new endpoints on the same circle as the old bulge segment. */
function recomputeBulge(oldP1: Vec, oldP2: Vec, oldBulge: number, p1: Vec, p2: Vec): number {
  const arc = bulgeArc(oldP1, oldP2, oldBulge);
  const a1 = angleBetween(arc.c, p1), a2 = angleBetween(arc.c, p2);
  const th = oldBulge > 0 ? sweep(a1, a2) : sweep(a2, a1);
  return (oldBulge > 0 ? 1 : -1) * Math.tan(th / 4);
}

// ---------------------------------------------------------------------------
// OFFSET

export function offsetEntity(e: Entity, d: number, side: Vec): NewEntity | null {
  const p = props(e);
  switch (e.type) {
    case 'line': {
      const n = norm(perp(sub(e.p2, e.p1)));
      const s = Math.sign(cross(sub(e.p2, e.p1), sub(side, e.p1))) || 1;
      const off = mul(n, d * s);
      return { type: 'line', p1: add(e.p1, off), p2: add(e.p2, off), ...p };
    }
    case 'circle': {
      const inside = dist(side, e.c) < e.r;
      const r = inside ? e.r - d : e.r + d;
      return r > 1e-9 ? { type: 'circle', c: e.c, r, ...p } : null;
    }
    case 'arc': {
      const inside = dist(side, e.c) < e.r;
      const r = inside ? e.r - d : e.r + d;
      return r > 1e-9 ? { type: 'arc', c: e.c, r, a0: e.a0, a1: e.a1, ...p } : null;
    }
    case 'ellipse': {
      // Approximate: scale both axes by the offset distance.
      const ra = Math.hypot(e.major.x, e.major.y);
      const inside = isInsideEllipse(e, side);
      const nr = inside ? ra - d : ra + d;
      const nb = inside ? ra * e.ratio - d : ra * e.ratio + d;
      if (nr <= 0 || nb <= 0) return null;
      return { type: 'ellipse', c: e.c, major: mul(norm(e.major), nr), ratio: Math.min(1, nb / nr), a0: e.a0, a1: e.a1, ...p };
    }
    case 'polyline': return offsetPolyline(e, d, side);
    default: return null;
  }
}

function isInsideEllipse(e: Entity & { type: 'ellipse' }, p: Vec): boolean {
  const ra = Math.hypot(e.major.x, e.major.y);
  const u = norm(e.major), v = perp(u);
  const q = sub(p, e.c);
  const x = dot(q, u) / ra, y = dot(q, v) / (ra * e.ratio);
  return x * x + y * y < 1;
}

type OSeg = { k: 'seg'; a: Vec; b: Vec } | { k: 'arc'; c: Vec; r: number; ccw: boolean; a: Vec; b: Vec };

export function offsetPolyline(e: PolylineEnt, d: number, side: Vec): NewEntity | null {
  const n = e.pts.length;
  if (n < 2) return null;
  const segs = e.closed ? n : n - 1;
  // Determine side: left of travel direction at the closest segment.
  let bestK = 0, bestD = Infinity, bestQ = e.pts[0];
  const prims = polylineSegPrims(e);
  prims.forEach((pr, k) => {
    const q = pr.k === 'seg' ? closestOnSeg(side, pr.a, pr.b).pt : closestOnArc(side, pr.c, pr.r, pr.a0, pr.a1);
    const dd = dist(side, q);
    if (dd < bestD) { bestD = dd; bestK = k; bestQ = q; }
  });
  const a = e.pts[bestK], b = e.pts[(bestK + 1) % n], bu = e.bulges[bestK] || 0;
  let left: boolean;
  if (Math.abs(bu) < 1e-12) left = cross(sub(b, a), sub(side, a)) > 0;
  else {
    const arc = bulgeArc(a, b, bu);
    const inside = dist(side, arc.c) < arc.r;
    left = bu > 0 ? inside : !inside;
  }
  void bestQ;
  const s = left ? d : -d;

  const os: (OSeg | null)[] = [];
  for (let k = 0; k < segs; k++) {
    const p1 = e.pts[k], p2 = e.pts[(k + 1) % n], bb = e.bulges[k] || 0;
    if (dist(p1, p2) < 1e-12) { os.push(null); continue; }
    if (Math.abs(bb) < 1e-12) {
      const off = mul(norm(perp(sub(p2, p1))), s);
      os.push({ k: 'seg', a: add(p1, off), b: add(p2, off) });
    } else {
      const arc = bulgeArc(p1, p2, bb);
      const ccw = bb > 0;
      const r = ccw ? arc.r - s : arc.r + s;
      if (r <= 1e-9) { os.push(null); continue; }
      os.push({ k: 'arc', c: arc.c, r, ccw, a: polar(arc.c, angleBetween(arc.c, p1), r), b: polar(arc.c, angleBetween(arc.c, p2), r) });
    }
  }
  const valid = os.filter((x): x is OSeg => x !== null);
  if (!valid.length) return null;

  const join = (s1: OSeg, s2: OSeg): Vec => {
    const expected = s2.a;
    let cands: Vec[] = [];
    if (s1.k === 'seg' && s2.k === 'seg') {
      const r = lineLineParams(s1.a, s1.b, s2.a, s2.b);
      if (!r) return s1.b;
      return lerp(s1.a, s1.b, r.t);
    }
    if (s1.k === 'seg' && s2.k === 'arc') cands = lineCircleParams(s1.a, s1.b, s2.c, s2.r).map((t) => lerp(s1.a, s1.b, t));
    else if (s1.k === 'arc' && s2.k === 'seg') cands = lineCircleParams(s2.a, s2.b, s1.c, s1.r).map((t) => lerp(s2.a, s2.b, t));
    else if (s1.k === 'arc' && s2.k === 'arc') cands = circleCircle(s1.c, s1.r, s2.c, s2.r);
    if (!cands.length) return eq(s1.b, s2.a, 1e-9) ? s1.b : expected;
    let best = cands[0];
    for (const c of cands) if (dist(c, expected) < dist(best, expected)) best = c;
    return dist(best, expected) > Math.abs(d) * 4 + 1e-9 ? expected : best;
  };

  const m = valid.length;
  const pts: Vec[] = [];
  for (let i = 0; i < m; i++) {
    if (i === 0 && !e.closed) pts.push(valid[0].a);
    else {
      const prev = valid[(i - 1 + m) % m];
      pts.push(join(prev, valid[i]));
    }
  }
  if (!e.closed) pts.push(valid[m - 1].b);
  const bulges: number[] = [];
  for (let i = 0; i < m; i++) {
    const sg = valid[i];
    if (sg.k === 'seg') { bulges.push(0); continue; }
    const pa = pts[i], pb = pts[(i + 1) % pts.length];
    const a0 = angleBetween(sg.c, pa), a1 = angleBetween(sg.c, pb);
    const th = sg.ccw ? sweep(a0, a1) : sweep(a1, a0);
    bulges.push((sg.ccw ? 1 : -1) * Math.tan(th / 4));
  }
  if (!e.closed) bulges.push(0);
  return { type: 'polyline', pts, bulges, closed: e.closed, width: e.width, ...props(e) };
}

// ---------------------------------------------------------------------------
// FILLET / CHAMFER for two lines

export interface CornerResult {
  l1: LineEnt;
  l2: LineEnt;
  extra: NewEntity | null;
}

/** Endpoint of `l` to keep: the one on the same side of corner `x` as the pick point. */
function keepEnd(l: LineEnt, x: Vec, pick: Vec): { keep: Vec; dirFromX: Vec } {
  const u = norm(sub(l.p2, l.p1));
  const sp = dot(sub(pick, x), u);
  const s1 = dot(sub(l.p1, x), u), s2 = dot(sub(l.p2, x), u);
  let keep: Vec;
  if (sp >= 0) keep = s1 > s2 ? l.p1 : l.p2;
  else keep = s1 < s2 ? l.p1 : l.p2;
  const dirFromX = sp >= 0 ? u : mul(u, -1);
  return { keep, dirFromX };
}

function setLine(l: LineEnt, keep: Vec, other: Vec): LineEnt {
  return eq(l.p1, keep, 1e-9) ? { ...l, p2: other } : { ...l, p1: other, p2: keep };
}

export function filletLines(l1: LineEnt, pick1: Vec, l2: LineEnt, pick2: Vec, radius: number): CornerResult | string {
  const r = lineLineParams(l1.p1, l1.p2, l2.p1, l2.p2);
  if (!r) return 'Lines are parallel.';
  const x = lerp(l1.p1, l1.p2, r.t);
  const k1 = keepEnd(l1, x, pick1), k2 = keepEnd(l2, x, pick2);
  if (radius <= 1e-12) return { l1: setLine(l1, k1.keep, x), l2: setLine(l2, k2.keep, x), extra: null };
  const u1 = k1.dirFromX, u2 = k2.dirFromX;
  const ang = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2))));
  if (ang < 1e-9 || Math.abs(ang - Math.PI) < 1e-9) return 'Lines are parallel.';
  const half = ang / 2;
  const t = radius / Math.tan(half);
  if (t > dist(x, k1.keep) + 1e-9 || t > dist(x, k2.keep) + 1e-9) return 'Radius is too large.';
  const T1 = add(x, mul(u1, t)), T2 = add(x, mul(u2, t));
  const bis = norm(add(u1, u2));
  const c = add(x, mul(bis, radius / Math.sin(half)));
  let a0 = angleBetween(c, T1), a1 = angleBetween(c, T2);
  if (sweep(a0, a1) > Math.PI) [a0, a1] = [a1, a0];
  return {
    l1: setLine(l1, k1.keep, T1),
    l2: setLine(l2, k2.keep, T2),
    extra: { type: 'arc', c, r: radius, a0, a1, ...props(l1) },
  };
}

export function chamferLines(l1: LineEnt, pick1: Vec, l2: LineEnt, pick2: Vec, d1: number, d2: number): CornerResult | string {
  const r = lineLineParams(l1.p1, l1.p2, l2.p1, l2.p2);
  if (!r) return 'Lines are parallel.';
  const x = lerp(l1.p1, l1.p2, r.t);
  const k1 = keepEnd(l1, x, pick1), k2 = keepEnd(l2, x, pick2);
  if (d1 <= 1e-12 && d2 <= 1e-12) return { l1: setLine(l1, k1.keep, x), l2: setLine(l2, k2.keep, x), extra: null };
  if (d1 > dist(x, k1.keep) + 1e-9 || d2 > dist(x, k2.keep) + 1e-9) return 'Distance is too large.';
  const T1 = add(x, mul(k1.dirFromX, d1)), T2 = add(x, mul(k2.dirFromX, d2));
  return { l1: setLine(l1, k1.keep, T1), l2: setLine(l2, k2.keep, T2), extra: { type: 'line', p1: T1, p2: T2, ...props(l1) } };
}

// ---------------------------------------------------------------------------
// STRETCH

/** Moves the parts of `e` that lie inside `box` by `delta`. Returns null if unchanged. */
export function stretchEntity(e: Entity, box: Box, delta: Vec): Entity | null {
  const inside = (p: Vec) => boxContains(box, p);
  const grips = entGrips(e);
  const flags = grips.map(inside);
  if (!flags.some(Boolean)) return null;
  const moveAll = () => entTransform(e, mxTranslate(delta.x, delta.y));
  switch (e.type) {
    case 'line': return { ...e, p1: inside(e.p1) ? add(e.p1, delta) : e.p1, p2: inside(e.p2) ? add(e.p2, delta) : e.p2 };
    case 'polyline': return { ...e, pts: e.pts.map((p) => (inside(p) ? add(p, delta) : p)) };
    case 'solid': return { ...e, pts: e.pts.map((p) => (inside(p) ? add(p, delta) : p)) };
    case 'viewport': {
      if (flags.every(Boolean)) return moveAll();
      const k = grips.map((p, i) => (flags[i] ? add(p, delta) : p));
      // Edges follow their moved corners (left/right from corners 0/3 and 1/2, bottom/top from 0/1 and 2/3).
      const x0 = flags[0] || flags[3] ? k[flags[0] ? 0 : 3].x : k[0].x, x1 = flags[1] || flags[2] ? k[flags[1] ? 1 : 2].x : k[1].x;
      const y0 = flags[0] || flags[1] ? k[flags[0] ? 0 : 1].y : k[0].y, y1 = flags[2] || flags[3] ? k[flags[2] ? 2 : 3].y : k[2].y;
      return vpResize(e, { x: Math.min(x0, x1), y: Math.min(y0, y1) }, { x: Math.max(x0, x1), y: Math.max(y0, y1) });
    }
    case 'spline': return { ...e, ctrl: e.ctrl.map((p) => (inside(p) ? add(p, delta) : p)), fit: e.fit?.map((p) => (inside(p) ? add(p, delta) : p)) };
    case 'arc': {
      if (flags[0] && flags[2]) return moveAll();
      let out: Entity = e;
      if (flags[0]) out = entMoveGrip(out, 0, add(grips[0], delta));
      if (flags[2]) out = entMoveGrip(out, 2, add(grips[2], delta));
      if (!flags[0] && !flags[2] && flags[3]) out = moveAll();
      return out;
    }
    case 'dimension': {
      const mv = (p: Vec | undefined) => (p && inside(p) ? add(p, delta) : p);
      return { ...e, p1: mv(e.p1)!, p2: mv(e.p2)!, p3: mv(e.p3), loc: mv(e.loc)!, block: undefined };
    }
    case 'circle': case 'ellipse': return inside(e.c) ? moveAll() : null;
    default: return inside(grips[0]) ? moveAll() : null;
  }
}

export { arcPrim, seg };

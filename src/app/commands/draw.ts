// Draw commands: LINE, PLINE, CIRCLE, ARC, RECTANG, POLYGON, ELLIPSE, SPLINE, POINT, HATCH.

import {
  type Vec,
  add, sub, dist, mid, polar, angleBetween, angleOf, cross, dot, norm, perp, mul, rotate, TAU, fmtNum, bulgeArc, normAng,
} from '../../core/geom.ts';
import { type NewEntity, type Entity, type HatchLoop, arc3, circle3, closedOutline } from '../../core/entities.ts';
import { interpolateSpline } from '../../core/spline.ts';
import { findBoundary } from '../../core/region.ts';
import type { Editor } from '../editor.ts';

const isPt = (x: unknown): x is Vec => typeof x === 'object' && x !== null && 'x' in x;

export async function LINE(ed: Editor): Promise<void> {
  let first = await ed.point('Specify first point:', { allowNone: true });
  if (first === null) first = ed.lastPoint;
  if (!isPt(first)) return;
  const pts: Vec[] = [first];
  const ids: number[] = [];
  for (;;) {
    const last = pts[pts.length - 1];
    const kws = pts.length >= 3 ? ['Close', 'Undo'] : ['Undo'];
    const r = await ed.getPoint(`Specify next point or [${kws.join('/')}]:`, {
      base: last, keywords: kws, allowNone: true,
      preview: (p) => [{ type: 'line', p1: last, p2: p }],
    });
    if (r.kind === 'none') return;
    if (r.kind === 'keyword') {
      if (r.kw === 'Undo') {
        if (ids.length) { ed.doc.remove(ids.pop()!); pts.pop(); }
        else ed.print('All segments already undone.');
        continue;
      }
      if (r.kw === 'Close') { ed.doc.add({ type: 'line', p1: last, p2: pts[0] }); return; }
      continue;
    }
    if (r.kind !== 'point') continue;
    if (dist(r.p, last) < 1e-12) continue;
    ids.push(ed.doc.add({ type: 'line', p1: last, p2: r.p }).id);
    pts.push(r.p);
  }
}

/** Bulge for a tangent arc starting at p0 with direction t ending at p. */
function tangentBulge(p0: Vec, t: Vec, p: Vec): number {
  const c = sub(p, p0);
  const a = Math.atan2(cross(t, c), dot(t, c));
  return Math.tan(a / 2);
}

function segEndTangent(p1: Vec, p2: Vec, bulge: number): Vec {
  if (Math.abs(bulge) < 1e-12) return norm(sub(p2, p1));
  const theta = 4 * Math.atan(bulge);
  // tangent at the end = chord direction rotated by half the included angle
  return rotate(norm(sub(p2, p1)), { x: 0, y: 0 }, theta / 2);
}

export async function PLINE(ed: Editor): Promise<void> {
  const start = await ed.point('Specify start point:');
  if (!isPt(start)) return;
  ed.print('Current line-width is 0.0000');
  const pts: Vec[] = [start];
  const bulges: number[] = [];
  let arcMode = false;
  let width = 0;
  const tangentAtEnd = (): Vec => {
    const n = pts.length;
    if (n < 2) return { x: 1, y: 0 };
    return segEndTangent(pts[n - 2], pts[n - 1], bulges[n - 2]);
  };
  const pl = (extra?: { p: Vec; b: number }): NewEntity => {
    const P = extra ? [...pts, extra.p] : pts;
    const B = extra ? [...bulges, extra.b, 0] : [...bulges, 0];
    return { type: 'polyline', pts: P, bulges: B, closed: false, width: width || undefined };
  };
  const finish = (closed: boolean) => {
    if (pts.length < 2) return;
    if (closed) {
      if (dist(pts[0], pts[pts.length - 1]) < 1e-9 && pts.length > 2) { pts.pop(); }
      ed.doc.add({ type: 'polyline', pts, bulges: [...bulges, 0].slice(0, pts.length), closed: true, width: width || undefined });
    } else ed.doc.add({ type: 'polyline', pts, bulges: [...bulges, 0], closed: false, width: width || undefined });
  };
  for (;;) {
    const last = pts[pts.length - 1];
    if (!arcMode) {
      const kws = pts.length >= 3 ? ['Arc', 'Close', 'Halfwidth', 'Length', 'Undo', 'Width'] : ['Arc', 'Halfwidth', 'Length', 'Undo', 'Width'];
      const r = await ed.getPoint(`Specify next point or [${kws.join('/')}]:`, {
        base: last, keywords: kws, allowNone: true, preview: (p) => [pl({ p, b: 0 })],
      });
      if (r.kind === 'none') { finish(false); return; }
      if (r.kind === 'point') { if (dist(r.p, last) > 1e-12) { pts.push(r.p); bulges.push(0); } continue; }
      if (r.kind !== 'keyword') continue;
      switch (r.kw) {
        case 'Arc': arcMode = true; break;
        case 'Close': bulges.push(0); finish(true); return;
        case 'Undo': if (pts.length > 1) { pts.pop(); bulges.pop(); } break;
        case 'Width': case 'Halfwidth': {
          const w = await ed.getDistance(`Specify starting ${r.kw === 'Width' ? 'width' : 'half-width'} <${fmtNum(width)}>:`, { base: last, def: width });
          if (typeof w === 'number') width = r.kw === 'Width' ? w : w * 2;
          break;
        }
        case 'Length': {
          const l = await ed.getDistance('Specify length of line:', { base: last });
          if (typeof l === 'number') { pts.push(add(last, mul(tangentAtEnd(), l))); bulges.push(0); }
          break;
        }
      }
    } else {
      const kws = pts.length >= 3 ? ['CLose', 'Line', 'Second pt', 'Undo', 'Width'] : ['Line', 'Second pt', 'Undo', 'Width'];
      const t = tangentAtEnd();
      const r = await ed.getPoint(`Specify endpoint of arc or [${kws.join('/')}]:`, {
        base: last, keywords: kws, allowNone: true, preview: (p) => [pl({ p, b: tangentBulge(last, t, p) })],
      });
      if (r.kind === 'none') { finish(false); return; }
      if (r.kind === 'point') {
        if (dist(r.p, last) > 1e-12) { pts.push(r.p); bulges.push(tangentBulge(last, t, r.p)); }
        continue;
      }
      if (r.kind !== 'keyword') continue;
      switch (r.kw) {
        case 'Line': arcMode = false; break;
        case 'CLose': bulges.push(tangentBulge(last, t, pts[0])); finish(true); return;
        case 'Undo': if (pts.length > 1) { pts.pop(); bulges.pop(); } break;
        case 'Width': {
          const w = await ed.getDistance(`Specify starting width <${fmtNum(width)}>:`, { base: last, def: width });
          if (typeof w === 'number') width = w;
          break;
        }
        case 'Second pt': {
          const p2 = await ed.point('Specify second point on arc:', { base: last });
          if (!isPt(p2)) break;
          const p3 = await ed.point('Specify end point of arc:', {
            base: p2, preview: (p) => { const a = arc3(last, p2, p); return a ? [pl({ p, b: bulgeFrom3(last, p2, p) })] : []; },
          });
          if (!isPt(p3)) break;
          pts.push(p3); bulges.push(bulgeFrom3(last, p2, p3));
          break;
        }
      }
    }
  }
}

function bulgeFrom3(a: Vec, b: Vec, c: Vec): number {
  const ci = circle3(a, b, c);
  if (!ci) return 0;
  const ccw = cross(sub(b, a), sub(c, b)) > 0;
  const a0 = angleBetween(ci.c, a), a1 = angleBetween(ci.c, c);
  const sw = ccw ? normAng(a1 - a0) : normAng(a0 - a1);
  return (ccw ? 1 : -1) * Math.tan(sw / 4);
}

export async function CIRCLE(ed: Editor): Promise<void> {
  const r0 = await ed.getPoint('Specify center point for circle or [3P/2P/Ttr (tan tan radius)]:', { keywords: ['3P', '2P', 'Ttr'] });
  if (r0.kind === 'keyword') {
    if (r0.kw === '2P') {
      const a = await ed.point('Specify first end point of circle\'s diameter:');
      if (!isPt(a)) return;
      const b = await ed.point('Specify second end point of circle\'s diameter:', { base: a, preview: (p) => [{ type: 'circle', c: mid(a, p), r: dist(a, p) / 2 }] });
      if (!isPt(b)) return;
      ed.doc.add({ type: 'circle', c: mid(a, b), r: dist(a, b) / 2 });
      return;
    }
    if (r0.kw === '3P') {
      const a = await ed.point('Specify first point on circle:');
      if (!isPt(a)) return;
      const b = await ed.point('Specify second point on circle:', { base: a, rubber: true });
      if (!isPt(b)) return;
      const c = await ed.point('Specify third point on circle:', {
        base: b, preview: (p) => { const ci = circle3(a, b, p); return ci ? [{ type: 'circle', c: ci.c, r: ci.r }] : []; },
      });
      if (!isPt(c)) return;
      const ci = circle3(a, b, c);
      if (ci) ed.doc.add({ type: 'circle', c: ci.c, r: ci.r });
      return;
    }
    if (r0.kw === 'Ttr') { await circleTTR(ed); return; }
    return;
  }
  if (r0.kind !== 'point') return;
  const c = r0.p;
  const def = (ed as Editor & { _lastRadius?: number })._lastRadius;
  for (;;) {
    const r = await ed.getDistance(`Specify radius of circle or [Diameter]${def ? ` <${fmtNum(def)}>` : ''}:`, {
      base: c, def, keywords: ['Diameter'], preview: (p) => (dist(c, p) > 1e-9 ? [{ type: 'circle', c, r: dist(c, p) }] : []),
    });
    if (r === 'Diameter') {
      const d = await ed.getDistance('Specify diameter of circle:', { base: c, preview: (p) => (dist(c, p) > 1e-9 ? [{ type: 'circle', c, r: dist(c, p) / 2 }] : []) });
      if (typeof d === 'number' && d > 0) { ed.doc.add({ type: 'circle', c, r: d / 2 }); (ed as Editor & { _lastRadius?: number })._lastRadius = d / 2; }
      return;
    }
    if (typeof r === 'number' && r > 0) {
      ed.doc.add({ type: 'circle', c, r });
      (ed as Editor & { _lastRadius?: number })._lastRadius = r;
      return;
    }
  }
}

async function circleTTR(ed: Editor): Promise<void> {
  const isLine = (e: Entity) => e.type === 'line';
  const a = await ed.getEntity('Specify point on object for first tangent of circle:', { filter: isLine });
  if (a.kind !== 'entity') return;
  const b = await ed.getEntity('Specify point on object for second tangent of circle:', { filter: isLine });
  if (b.kind !== 'entity') return;
  const r = await ed.getDistance('Specify radius of circle:');
  if (typeof r !== 'number' || r <= 0) return;
  const l1 = ed.doc.get(a.id) as Entity & { type: 'line' }, l2 = ed.doc.get(b.id) as Entity & { type: 'line' };
  // Offset both lines toward the pick points and intersect.
  const off = (l: typeof l1, pick: Vec) => {
    const n = norm(perp(sub(l.p2, l.p1)));
    const s = Math.sign(cross(sub(l.p2, l.p1), sub(pick, l.p1))) || 1;
    return { a: add(l.p1, mul(n, r * s)), b: add(l.p2, mul(n, r * s)) };
  };
  const o1 = off(l1, a.p), o2 = off(l2, b.p);
  const d1 = sub(o1.b, o1.a), d2 = sub(o2.b, o2.a);
  const den = cross(d1, d2);
  if (Math.abs(den) < 1e-12) { ed.print('Circle does not exist.', 'error'); return; }
  const t = cross(sub(o2.a, o1.a), d2) / den;
  ed.doc.add({ type: 'circle', c: add(o1.a, mul(d1, t)), r });
}

export async function ARC(ed: Editor): Promise<void> {
  const r0 = await ed.getPoint('Specify start point of arc or [Center]:', { keywords: ['Center'] });
  let start: Vec, center: Vec;
  if (r0.kind === 'keyword') {
    const c = await ed.point('Specify center point of arc:');
    if (!isPt(c)) return;
    const s = await ed.point('Specify start point of arc:', { base: c, rubber: true });
    if (!isPt(s)) return;
    center = c; start = s;
  } else if (r0.kind === 'point') {
    start = r0.p;
    const r1 = await ed.getPoint('Specify second point of arc or [Center/End]:', { base: start, keywords: ['Center', 'End'], rubber: true });
    if (r1.kind === 'point') {
      const p2 = r1.p;
      const p3 = await ed.point('Specify end point of arc:', {
        base: p2, preview: (p) => { const a = arc3(start, p2, p); return a ? [{ type: 'arc', ...a }] : []; },
      });
      if (!isPt(p3)) return;
      const a = arc3(start, p2, p3);
      if (a) ed.doc.add({ type: 'arc', ...a });
      return;
    }
    if (r1.kind === 'keyword' && r1.kw === 'End') {
      const e = await ed.point('Specify end point of arc:', { base: start, rubber: true });
      if (!isPt(e)) return;
      const c = await ed.point('Specify center point of arc (hold Ctrl to switch direction) or [Angle/Direction/Radius]:', {
        base: e, preview: (p) => [{ type: 'arc', c: p, r: dist(p, start), a0: angleBetween(p, start), a1: angleBetween(p, e) }],
      });
      if (!isPt(c)) return;
      ed.doc.add({ type: 'arc', c, r: dist(c, start), a0: angleBetween(c, start), a1: angleBetween(c, e) });
      return;
    }
    if (!(r1.kind === 'keyword' && r1.kw === 'Center')) return;
    const c = await ed.point('Specify center point of arc:', { base: start, rubber: true });
    if (!isPt(c)) return;
    center = c;
  } else return;
  const R = dist(center, start);
  const a0 = angleBetween(center, start);
  const r2 = await ed.getPoint('Specify end point of arc (hold Ctrl to switch direction) or [Angle/chord Length]:', {
    base: center, keywords: ['Angle', 'chord Length'], rubber: true,
    preview: (p) => [{ type: 'arc', c: center, r: R, a0, a1: angleBetween(center, p) }],
  });
  if (r2.kind === 'point') { ed.doc.add({ type: 'arc', c: center, r: R, a0, a1: angleBetween(center, r2.p) }); return; }
  if (r2.kind === 'keyword' && r2.kw === 'Angle') {
    const ang = await ed.getAngle('Specify included angle (hold Ctrl to switch direction):', { base: center });
    if (typeof ang === 'number') ed.doc.add(ang >= 0 ? { type: 'arc', c: center, r: R, a0, a1: a0 + ang } : { type: 'arc', c: center, r: R, a0: a0 + ang, a1: a0 });
  } else if (r2.kind === 'keyword') {
    const L = await ed.getDistance('Specify length of chord:', { base: start });
    if (typeof L === 'number' && L <= 2 * R) ed.doc.add({ type: 'arc', c: center, r: R, a0, a1: a0 + 2 * Math.asin(L / (2 * R)) });
  }
}

export async function RECTANG(ed: Editor): Promise<void> {
  const rect = (a: Vec, b: Vec, rot = 0): NewEntity => {
    const pts = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
    return { type: 'polyline', pts: rot ? pts.map((p) => rotate(p, a, rot)) : pts, bulges: [0, 0, 0, 0], closed: true };
  };
  const a = await ed.point('Specify first corner point or [Chamfer/Elevation/Fillet/Thickness/Width]:', { keywords: ['Chamfer', 'Elevation', 'Fillet', 'Thickness', 'Width'] });
  if (!isPt(a)) { if (typeof a === 'string') ed.print(`${a} option is not available.`); return; }
  let rot = 0;
  for (;;) {
    const r = await ed.getPoint('Specify other corner point or [Area/Dimensions/Rotation]:', {
      keywords: ['Area', 'Dimensions', 'Rotation'], preview: (p) => [rectFromCorner(a, p, rot)],
    });
    if (r.kind === 'point') { ed.doc.add(rectFromCorner(a, r.p, rot)); return; }
    if (r.kind !== 'keyword') return;
    if (r.kw === 'Rotation') {
      const ang = await ed.getAngle('Specify rotation angle or [Pick points] <0>:', { base: a, def: 0 });
      if (typeof ang === 'number') rot = ang;
      continue;
    }
    if (r.kw === 'Dimensions' || r.kw === 'Area') {
      const L = await ed.getDistance('Specify length for rectangles <10.0000>:', { def: 10 });
      const W = await ed.getDistance('Specify width for rectangles <10.0000>:', { def: 10 });
      if (typeof L !== 'number' || typeof W !== 'number') return;
      const side = await ed.point('Specify other corner point:', {
        preview: (p) => [rectFromCorner(a, { x: a.x + Math.sign(p.x - a.x || 1) * L, y: a.y + Math.sign(p.y - a.y || 1) * W }, rot)],
      });
      if (!isPt(side)) return;
      ed.doc.add(rectFromCorner(a, { x: a.x + Math.sign(side.x - a.x || 1) * L, y: a.y + Math.sign(side.y - a.y || 1) * W }, rot));
      return;
    }
  }
  void rect;
}

function rectFromCorner(a: Vec, b: Vec, rot: number): NewEntity {
  if (!rot) {
    const pts = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
    return { type: 'polyline', pts, bulges: [0, 0, 0, 0], closed: true };
  }
  const u = { x: Math.cos(rot), y: Math.sin(rot) }, v = perp(u);
  const d = sub(b, a);
  const w = dot(d, u), h = dot(d, v);
  const pts = [a, add(a, mul(u, w)), add(add(a, mul(u, w)), mul(v, h)), add(a, mul(v, h))];
  return { type: 'polyline', pts, bulges: [0, 0, 0, 0], closed: true };
}

export async function POLYGON(ed: Editor): Promise<void> {
  const n = await ed.getNumber(`Enter number of sides <${ed.doc.header.polygonSides}>:`, { def: ed.doc.header.polygonSides, integer: true, min: 3 });
  if (n > 1024) { ed.print('Requires an integer between 3 and 1024.', 'error'); return; }
  ed.doc.header.polygonSides = n;
  const poly = (c: Vec, r: number, a0: number): NewEntity => {
    const pts: Vec[] = [];
    for (let i = 0; i < n; i++) pts.push(polar(c, a0 + (TAU * i) / n, r));
    return { type: 'polyline', pts, bulges: pts.map(() => 0), closed: true };
  };
  const r0 = await ed.getPoint('Specify center of polygon or [Edge]:', { keywords: ['Edge'] });
  if (r0.kind === 'keyword') {
    const a = await ed.point('Specify first endpoint of edge:');
    if (!isPt(a)) return;
    const mk = (b: Vec): NewEntity => {
      const side = dist(a, b);
      const R = side / (2 * Math.sin(Math.PI / n));
      const m = mid(a, b);
      const h = R * Math.cos(Math.PI / n);
      const c = add(m, mul(norm(perp(sub(b, a))), h));
      return poly(c, R, angleBetween(c, a));
    };
    const b = await ed.point('Specify second endpoint of edge:', { base: a, preview: (p) => (dist(a, p) > 1e-9 ? [mk(p)] : []) });
    if (isPt(b)) ed.doc.add(mk(b));
    return;
  }
  if (r0.kind !== 'point') return;
  const c = r0.p;
  const opt = await ed.getKeyword('Enter an option [Inscribed in circle/Circumscribed about circle] <I>:', ['Inscribed in circle', 'Circumscribed about circle'], 'Inscribed in circle');
  const circ = opt.startsWith('C');
  const mk = (p: Vec): NewEntity => {
    const d = dist(c, p);
    const a = angleBetween(c, p);
    return circ ? poly(c, d / Math.cos(Math.PI / n), a + Math.PI / n) : poly(c, d, a);
  };
  const r = await ed.getPoint('Specify radius of circle:', { base: c, allowNumber: true, directDistance: false, preview: (p) => (dist(c, p) > 1e-9 ? [mk(p)] : []) });
  if (r.kind === 'point') ed.doc.add(mk(r.p));
  else if (r.kind === 'number') ed.doc.add(mk(polar(c, circ ? -Math.PI / 2 : Math.PI / 2, r.value)));
}

export async function ELLIPSE(ed: Editor): Promise<void> {
  const r0 = await ed.getPoint('Specify axis endpoint of ellipse or [Arc/Center]:', { keywords: ['Arc', 'Center'] });
  let c: Vec, major: Vec;
  const isArc = r0.kind === 'keyword' && r0.kw === 'Arc';
  if (r0.kind === 'keyword' && r0.kw === 'Center') {
    const cc = await ed.point('Specify center of ellipse:');
    if (!isPt(cc)) return;
    const e1 = await ed.point('Specify endpoint of axis:', { base: cc, rubber: true });
    if (!isPt(e1)) return;
    c = cc; major = sub(e1, cc);
  } else {
    let a: Vec | null = r0.kind === 'point' ? r0.p : null;
    if (isArc) { const aa = await ed.point('Specify axis endpoint of elliptical arc or [Center]:'); if (!isPt(aa)) return; a = aa; }
    if (!a) return;
    const a0 = a;
    const b = await ed.point('Specify other endpoint of axis:', { base: a0, rubber: true });
    if (!isPt(b)) return;
    c = mid(a0, b); major = sub(b, c);
  }
  const ml = Math.hypot(major.x, major.y);
  if (ml < 1e-12) return;
  const mk = (p: Vec) => {
    const d = Math.abs(dot(sub(p, c), norm(perp(major))));
    if (d <= ml) return { c, major, ratio: Math.max(d / ml, 1e-6) };
    return { c, major: mul(norm(perp(major)), d), ratio: ml / d };
  };
  const p = await ed.point('Specify distance to other axis or [Rotation]:', {
    base: c, rubber: true, preview: (q) => [{ type: 'ellipse', ...mk(q), a0: 0, a1: TAU }], keywords: ['Rotation'],
  });
  if (!isPt(p)) return;
  const el = mk(p);
  if (!isArc) { ed.doc.add({ type: 'ellipse', ...el, a0: 0, a1: TAU }); return; }
  const majAng = angleOf(el.major);
  const paramOf = (q: Vec) => {
    const loc = rotate(sub(q, c), { x: 0, y: 0 }, -majAng);
    const rr = Math.hypot(el.major.x, el.major.y);
    return Math.atan2(loc.y / (rr * el.ratio), loc.x / rr);
  };
  const s = await ed.point('Specify start angle:', { base: c, rubber: true });
  if (!isPt(s)) return;
  const t0 = paramOf(s);
  const e = await ed.point('Specify end angle:', { base: c, rubber: true, preview: (q) => [{ type: 'ellipse', ...el, a0: t0, a1: paramOf(q) }] });
  if (!isPt(e)) return;
  ed.doc.add({ type: 'ellipse', ...el, a0: normAng(t0), a1: normAng(paramOf(e)) });
}

export async function SPLINE(ed: Editor): Promise<void> {
  ed.print('Current settings: Method=Fit   Knots=Chord');
  const first = await ed.point('Specify first point or [Method/Knots/Object]:', { keywords: ['Method', 'Knots', 'Object'] });
  if (!isPt(first)) return;
  const fit: Vec[] = [first];
  const mk = (pts: Vec[], closed = false): NewEntity => {
    const P = closed ? [...pts, pts[0]] : pts;
    const s = interpolateSpline(P, 3);
    return { type: 'spline', ctrl: s.ctrl, knots: s.knots, degree: s.degree, closed, fit: P };
  };
  for (;;) {
    const kws = fit.length >= 3 ? ['Close', 'Undo'] : ['Undo'];
    const r = await ed.getPoint(`Enter next point or [${kws.join('/')}]:`, {
      base: fit[fit.length - 1], keywords: kws, allowNone: true, preview: (p) => [mk([...fit, p])],
    });
    if (r.kind === 'none') break;
    if (r.kind === 'keyword') {
      if (r.kw === 'Undo' && fit.length > 1) fit.pop();
      if (r.kw === 'Close') { ed.doc.add(mk(fit, true)); return; }
      continue;
    }
    if (r.kind === 'point' && dist(r.p, fit[fit.length - 1]) > 1e-12) fit.push(r.p);
  }
  if (fit.length >= 2) ed.doc.add(mk(fit));
}

export async function POINT(ed: Editor): Promise<void> {
  ed.print(`Current point modes:  PDMODE=${ed.doc.header.pdmode}  PDSIZE=${fmtNum(ed.doc.header.pdsize)}`);
  for (;;) {
    const p = await ed.point('Specify a point:', { allowNone: true });
    if (!isPt(p)) return;
    ed.doc.add({ type: 'point', p });
  }
}

export async function HATCH(ed: Editor): Promise<void> {
  const h = ed.doc.header;
  const mkHatch = (loops: HatchLoop[]): NewEntity => {
    const solid = h.hatchPattern.toUpperCase() === 'SOLID';
    return { type: 'hatch', loops, pattern: h.hatchPattern, solid, scale: h.hatchScale, angle: h.hatchAngle };
  };
  for (;;) {
    ed.print(`Pattern: ${h.hatchPattern}   Scale: ${fmtNum(h.hatchScale)}   Angle: ${fmtNum((h.hatchAngle * 180) / Math.PI)}`);
    const r = await ed.getPoint('Pick internal point or [Select objects/seTtings]:', { keywords: ['Select objects', 'seTtings'], allowNone: true });
    if (r.kind === 'none') return;
    if (r.kind === 'keyword') {
      if (r.kw === 'seTtings') {
        const o = await ed.ui.hatchOptions();
        if (o) { h.hatchPattern = o.pattern; h.hatchScale = o.scale; h.hatchAngle = o.angle; }
        continue;
      }
      const ids = await ed.getSelection('Select objects', { noPickfirst: true });
      const loops: HatchLoop[] = [];
      for (const id of ids) {
        const e = ed.doc.get(id);
        if (!e) continue;
        if (e.type === 'polyline' && (e.closed || dist(e.pts[0], e.pts[e.pts.length - 1]) < 1e-9)) {
          loops.push({ pts: e.closed ? e.pts.slice() : e.pts.slice(0, -1), bulges: e.closed ? e.bulges.slice() : e.bulges.slice(0, -1) });
          continue;
        }
        if (e.type === 'circle') {
          loops.push({ pts: [polar(e.c, 0, e.r), polar(e.c, Math.PI, e.r)], bulges: [1, 1] });
          continue;
        }
        const ol = closedOutline(e, ed.view.px(0.5));
        if (ol) loops.push({ pts: ol, bulges: ol.map(() => 0) });
      }
      if (!loops.length) { ed.print('No valid hatch boundary in the selection.', 'error'); continue; }
      ed.doc.add(mkHatch(loops));
      continue;
    }
    if (r.kind !== 'point') continue;
    ed.print('Analyzing internal islands...');
    const vis = ed.view.visibleBox();
    const ents = [...ed.doc.entities.values()].filter((e) => ed.doc.isVisible(e) && boxOverlap(ed.doc.box(e), vis));
    const res = findBoundary(r.p, ents, ed.doc, ed.view.px(0.5));
    if (!res) { ed.print('Valid hatch boundary not found.', 'error'); continue; }
    // Replace circular/closed-polyline boundaries with exact bulge loops when the outer face matches one.
    const exact = matchClosedEntity(res.outer, ents);
    const loops = exact ? [exact, ...res.loops.slice(1)] : res.loops;
    ed.doc.add(mkHatch(loops));
  }
}

function boxOverlap(a: { minX: number; minY: number; maxX: number; maxY: number }, b: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function matchClosedEntity(outer: Vec[], ents: Entity[]): HatchLoop | null {
  let area = 0;
  for (let i = 0; i < outer.length; i++) { const p = outer[i], q = outer[(i + 1) % outer.length]; area += (p.x * q.y - q.x * p.y) / 2; }
  for (const e of ents) {
    if (e.type === 'circle') {
      const ca = Math.PI * e.r * e.r;
      if (Math.abs(ca - Math.abs(area)) / ca < 0.01 && outer.every((p) => Math.abs(dist(p, e.c) - e.r) < e.r * 0.01)) {
        return { pts: [polar(e.c, 0, e.r), polar(e.c, Math.PI, e.r)], bulges: [1, 1] };
      }
    }
    if (e.type === 'polyline' && e.closed && e.bulges.some((b) => Math.abs(b) > 1e-12)) {
      const onIt = outer.every((p) => e.pts.some((q) => dist(p, q) < 1e-6) || polySegNear(e, p));
      if (onIt) return { pts: e.pts.slice(), bulges: e.bulges.slice() };
    }
  }
  return null;
}

function polySegNear(e: Entity & { type: 'polyline' }, p: Vec): boolean {
  const n = e.pts.length;
  for (let i = 0; i < n; i++) {
    const a = e.pts[i], b = e.pts[(i + 1) % n], bu = e.bulges[i] || 0;
    if (Math.abs(bu) < 1e-12) continue;
    const arc = bulgeArc(a, b, bu);
    if (Math.abs(dist(arc.c, p) - arc.r) < arc.r * 0.01 + 1e-6) return true;
  }
  return false;
}

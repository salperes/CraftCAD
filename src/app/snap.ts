// Object snap (OSNAP) search around the cursor.

import {
  type Vec, type Prim,
  dist, closestOnPrim, intersectPrims, closestOnSeg, angleBetween, polar, angInArc, boxIntersects,
} from '../core/geom.ts';
import { type Entity, type SnapKind, entSnaps, entPrims } from '../core/entities.ts';
import type { Drawing } from '../core/document.ts';

export const SNAP_LABELS: Record<SnapKind, string> = {
  end: 'Endpoint', mid: 'Midpoint', cen: 'Center', gcen: 'Geometric Center', qua: 'Quadrant', int: 'Intersection',
  per: 'Perpendicular', tan: 'Tangent', nea: 'Nearest', node: 'Node', ins: 'Insertion',
};

export const ALL_SNAPS: SnapKind[] = ['end', 'mid', 'cen', 'gcen', 'node', 'qua', 'int', 'ins', 'per', 'tan', 'nea'];
export const DEFAULT_SNAPS: SnapKind[] = ['end', 'mid', 'cen', 'qua', 'int', 'node', 'ins', 'per'];

const PRIORITY: Record<SnapKind, number> = {
  end: 0, int: 0, mid: 0.5, cen: 0.5, gcen: 0.5, qua: 0.5, node: 0.2, ins: 0.4, per: 1, tan: 1, nea: 3,
};

export interface SnapHit {
  kind: SnapKind;
  p: Vec;
  label: string;
  entity?: number;
}

export function findSnap(
  doc: Drawing, cursor: Vec, aperture: number, modes: Set<SnapKind>, base: Vec | null, exclude?: Set<number>,
): SnapHit | null {
  const box = { minX: cursor.x - aperture, minY: cursor.y - aperture, maxX: cursor.x + aperture, maxY: cursor.y + aperture };
  const cands: Entity[] = [];
  for (const e of doc.entities.values()) {
    if (exclude?.has(e.id)) continue;
    if (!doc.isVisible(e)) continue;
    if (!boxIntersects(doc.box(e), box)) continue;
    cands.push(e);
    if (cands.length > 400) break;
  }
  if (!cands.length) return null;

  let best: SnapHit | null = null;
  let bestScore = Infinity;
  const consider = (kind: SnapKind, p: Vec, d: number, id?: number) => {
    if (d > aperture) return;
    const score = d / aperture + PRIORITY[kind] * 0.35;
    if (score < bestScore) {
      bestScore = score;
      best = { kind, p, label: SNAP_LABELS[kind], entity: id };
    }
  };

  const nearPrims: Prim[] = [];
  for (const e of cands) {
    const prims = entPrims(e, doc, aperture * 0.2);
    const near = prims.filter((pr) => dist(closestOnPrim(cursor, pr), cursor) <= aperture);
    if (near.length) for (const pr of near) nearPrims.push(pr);

    for (const s of entSnaps(e, doc)) {
      if (!modes.has(s.kind)) continue;
      let d = dist(s.p, cursor);
      if (s.kind === 'cen' && near.length) {
        // AutoCAD shows the center while hovering the curve.
        for (const pr of near) if (pr.k === 'arc' && dist(pr.c, s.p) < 1e-9) d = Math.min(d, dist(closestOnPrim(cursor, pr), cursor) + aperture * 0.3);
      }
      consider(s.kind, s.p, d, e.id);
    }

    if (base && near.length) {
      for (const pr of near) {
        if (modes.has('per')) {
          const f = pr.k === 'seg' ? closestOnSeg(base, pr.a, pr.b).pt : closestOnPrim(base, pr);
          if (dist(f, base) > 1e-9) consider('per', f, dist(f, cursor), e.id);
        }
        if (modes.has('tan') && pr.k === 'arc') {
          const d = dist(base, pr.c);
          if (d > pr.r + 1e-9) {
            const a = angleBetween(pr.c, base), t = Math.acos(pr.r / d);
            for (const ang of [a + t, a - t]) {
              if (pr.full || angInArc(ang, pr.a0, pr.a1)) {
                const q = polar(pr.c, ang, pr.r);
                consider('tan', q, dist(q, cursor), e.id);
              }
            }
          }
        }
      }
    }
  }

  if (modes.has('int') && nearPrims.length > 1) {
    const ps = nearPrims.slice(0, 60);
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        for (const p of intersectPrims(ps[i], ps[j])) consider('int', p, dist(p, cursor));
      }
    }
  }

  if (!best && modes.has('nea') && nearPrims.length) {
    let bp: Vec | null = null, bd = Infinity;
    for (const pr of nearPrims) {
      const q = closestOnPrim(cursor, pr);
      const d = dist(q, cursor);
      if (d < bd) { bd = d; bp = q; }
    }
    if (bp) consider('nea', bp, bd);
  }
  return best;
}

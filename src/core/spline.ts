// Global B-spline interpolation through fit points (chord-length parameters, averaged knots).

import type { Vec } from './geom.ts';
import { dist } from './geom.ts';

/** Cox–de Boor basis N(i,p) at u (u < last knot; the end row is handled by the caller). */
function basis(i: number, p: number, u: number, U: number[]): number {
  if (p === 0) return u >= U[i] && u < U[i + 1] ? 1 : 0;
  let a = 0, b = 0;
  const d1 = U[i + p] - U[i], d2 = U[i + p + 1] - U[i + 1];
  if (d1 > 0) a = ((u - U[i]) / d1) * basis(i, p - 1, u, U);
  if (d2 > 0) b = ((U[i + p + 1] - u) / d2) * basis(i + 1, p - 1, u, U);
  return a + b;
}

export function interpolateSpline(fit: Vec[], degree = 3): { ctrl: Vec[]; knots: number[]; degree: number } {
  const n = fit.length - 1;
  if (n < 1) return { ctrl: fit.slice(), knots: [], degree: 1 };
  const p = Math.min(degree, n);
  let total = 0;
  for (let k = 1; k <= n; k++) total += dist(fit[k], fit[k - 1]);
  const u: number[] = [0];
  for (let k = 1; k < n; k++) u.push(u[k - 1] + dist(fit[k], fit[k - 1]) / (total || 1));
  u.push(1);
  const U: number[] = [];
  for (let i = 0; i <= p; i++) U.push(0);
  for (let j = 1; j <= n - p; j++) {
    let s = 0;
    for (let i = j; i <= j + p - 1; i++) s += u[i];
    U.push(s / p);
  }
  for (let i = 0; i <= p; i++) U.push(1);

  const N: number[][] = [];
  for (let k = 0; k <= n; k++) {
    const row: number[] = [];
    for (let i = 0; i <= n; i++) row.push(k === n ? (i === n ? 1 : 0) : basis(i, p, u[k], U));
    N.push(row);
  }
  const X = solve(N, fit.map((q) => q.x));
  const Y = solve(N, fit.map((q) => q.y));
  return { ctrl: X.map((x, i) => ({ x, y: Y[i] })), knots: U, degree: p };
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / (M[i][i] || 1e-12));
}

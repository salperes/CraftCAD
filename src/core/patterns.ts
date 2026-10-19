// Hatch pattern library (ISO/metric definitions in PAT notation) and conversion to
// world-space pattern lines, matching how DXF HATCH entities store them.

import type { PatLine } from './entities.ts';
import { rad, rotate } from './geom.ts';

/** PAT rows: angle(deg), x-origin, y-origin, delta-x, delta-y, dashes... */
type PatRow = number[];

export const PATTERNS: Record<string, { desc: string; rows: PatRow[] }> = {
  ANSI31: { desc: 'ANSI Iron, Brick, Stone masonry', rows: [[45, 0, 0, 0, 3.175]] },
  ANSI32: { desc: 'ANSI Steel', rows: [[45, 0, 0, 0, 9.525], [45, 4.49013, 0, 0, 9.525]] },
  ANSI37: { desc: 'ANSI Lead, Zinc, Magnesium', rows: [[45, 0, 0, 0, 3.175], [135, 0, 0, 0, 3.175]] },
  ANSI38: { desc: 'ANSI Aluminum', rows: [[45, 0, 0, 0, 3.175], [135, 0, 0, 6.35, 3.175, 7.9375, -4.7625]] },
  LINE: { desc: 'Parallel horizontal lines', rows: [[0, 0, 0, 0, 3.175]] },
  NET: { desc: 'Horizontal / vertical grid', rows: [[0, 0, 0, 0, 3.175], [90, 0, 0, 0, 3.175]] },
  DOTS: { desc: 'A series of dots', rows: [[0, 0, 0, 0.79375, 1.5875, 0, -1.5875]] },
  DASH: { desc: 'Dashed lines', rows: [[0, 0, 0, 3.175, 3.175, 3.175, -3.175]] },
  CROSS: { desc: 'A series of crosses', rows: [[0, 0, 0, 6.35, 6.35, 3.175, -9.525], [90, 1.5875, -1.5875, 6.35, 6.35, 3.175, -9.525]] },
  SQUARE: { desc: 'Small aligned squares', rows: [[0, 0, 0, 0, 3.175, 3.175, -3.175], [90, 0, 0, 0, 3.175, 3.175, -3.175]] },
  BRICK: { desc: 'Brick or masonry-type surface', rows: [[0, 0, 0, 0, 6.35], [90, 0, 0, 0, 12.7, 6.35, -6.35], [90, 6.35, 0, 0, 12.7, -6.35, 6.35]] },
  HONEY: {
    desc: 'Honeycomb pattern',
    rows: [[0, 0, 0, 4.7625, 2.749630645, 3.175, -6.35], [120, 0, 0, 4.7625, 2.749630645, 3.175, -6.35], [60, 0, 0, 4.7625, 2.749630645, -6.35, 3.175]],
  },
  TRIANG: {
    desc: 'Equilateral triangles',
    rows: [[60, 0, 0, 4.7625, 8.2488919604, 4.7625, -4.7625], [120, 0, 0, 4.7625, 8.2488919604, 4.7625, -4.7625], [0, -2.38125, 4.1244459802, 4.7625, 8.2488919604, 4.7625, -4.7625]],
  },
  ZIGZAG: { desc: 'Staircase effect', rows: [[0, 0, 0, 3.175, 3.175, 3.175, -3.175], [90, 3.175, 0, 3.175, 3.175, 3.175, -3.175]] },
  EARTH: {
    desc: 'Earth or ground',
    rows: [
      [0, 0, 0, 6.35, 6.35, 6.35, -6.35], [0, 0, 2.38125, 6.35, 6.35, 6.35, -6.35], [0, 0, 4.7625, 6.35, 6.35, 6.35, -6.35],
      [90, 0.79375, 5.55625, 6.35, 6.35, 6.35, -6.35], [90, 3.175, 5.55625, 6.35, 6.35, 6.35, -6.35], [90, 5.55625, 5.55625, 6.35, 6.35, 6.35, -6.35],
    ],
  },
};

export const PATTERN_NAMES = ['SOLID', ...Object.keys(PATTERNS)];

/** World-space pattern lines for a named pattern at the given scale and rotation (radians). */
export function patternLines(name: string, scale: number, angle: number): PatLine[] | null {
  const p = PATTERNS[name.toUpperCase()];
  if (!p) return null;
  const o = { x: 0, y: 0 };
  return p.rows.map((r) => {
    const a = rad(r[0]);
    const base = rotate({ x: r[1] * scale, y: r[2] * scale }, o, angle);
    const off = rotate({ x: r[3] * scale, y: r[4] * scale }, o, a + angle);
    return { ang: a + angle, base, off, dashes: r.slice(5).map((d) => d * scale) };
  });
}

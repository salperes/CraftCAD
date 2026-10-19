// AutoCAD Color Index (ACI) palette, generated from the standard hue/brightness scheme.

const BASE: [number, number, number][] = [
  [0, 0, 0],
  [255, 0, 0], [255, 255, 0], [0, 255, 0], [0, 255, 255], [0, 0, 255], [255, 0, 255], [255, 255, 255],
  [65, 65, 65], [128, 128, 128],
];
const BRIGHT = [255, 165, 127, 76, 38];
const GRAYS = [51, 80, 105, 130, 190, 255];

function hueRgb(h: number, v: number): [number, number, number] {
  // Full-saturation color at hue h (degrees) and brightness v.
  const seg = h / 60;
  const i = Math.floor(seg) % 6;
  const f = seg - Math.floor(seg);
  const q = v * (1 - f), t = v * f;
  switch (i) {
    case 0: return [v, t, 0];
    case 1: return [q, v, 0];
    case 2: return [0, v, t];
    case 3: return [0, q, v];
    case 4: return [t, 0, v];
    default: return [v, 0, q];
  }
}

export const ACI: [number, number, number][] = (() => {
  const t: [number, number, number][] = BASE.slice();
  for (let i = 10; i <= 249; i++) {
    const hue = (Math.floor(i / 10) - 1) * 15;
    const row = i % 10;
    const v = BRIGHT[Math.floor(row / 2)];
    let [r, g, b] = hueRgb(hue, v);
    if (row % 2 === 1) {
      r = r + (v - r) * 0.5;
      g = g + (v - g) * 0.5;
      b = b + (v - b) * 0.5;
    }
    t.push([Math.floor(r), Math.floor(g), Math.floor(b)]);
  }
  for (const g of GRAYS) t.push([g, g, g]);
  return t;
})();

export function aciToCss(i: number, darkBg = true): string {
  if (i === 7) return darkBg ? '#ffffff' : '#000000';
  const c = ACI[i] ?? ACI[7];
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export const trueColorCss = (tc: number): string => `#${tc.toString(16).padStart(6, '0')}`;

export const ACI_NAMES: Record<number, string> = {
  0: 'ByBlock', 1: 'Red', 2: 'Yellow', 3: 'Green', 4: 'Cyan', 5: 'Blue', 6: 'Magenta', 7: 'White', 256: 'ByLayer',
};

export function colorName(i: number): string {
  return ACI_NAMES[i] ?? `Color ${i}`;
}

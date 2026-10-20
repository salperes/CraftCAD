// Original line-art icon set (32×32 viewBox) in the style of desktop CAD ribbons.

const W = '#dde4ec';   // geometry
const B = '#52b6ff';   // highlight / new geometry
const Y = '#ffcc4d';   // points, accents
const R = '#ff6464';   // removal / cutting
const G = '#62d277';   // positive / on
const D = '#8a96a8';   // secondary

const s = (d: string, c = W, w = 1.8) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const sq = (x: number, y: number, c = B, r = 2.2) => `<rect x="${x - r}" y="${y - r}" width="${r * 2}" height="${r * 2}" fill="${c}"/>`;
const dot = (x: number, y: number, c = Y, r = 1.8) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`;
const circ = (x: number, y: number, r: number, c = W, w = 1.8) => `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${c}" stroke-width="${w}"/>`;
const txt = (x: number, y: number, t: string, c = W, size = 14, weight = 700) => `<text x="${x}" y="${y}" fill="${c}" font-family="Segoe UI, Arial, sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="middle">${t}</text>`;
const fill = (d: string, c: string, o = 1) => `<path d="${d}" fill="${c}" fill-opacity="${o}"/>`;
const arrow = (d: string, head: string, c = B) => s(d, c) + fill(head, c);

export const ICONS: Record<string, string> = {
  line: s('M6 26 L26 6') + sq(6, 26) + sq(26, 6),
  pline: s('M5 25 L12 9 L19 20 Q 24 6 28 10', W) + sq(5, 25) + sq(12, 9) + sq(19, 20) + sq(28, 10),
  circle: circ(16, 16, 10) + s('M16 16 L24 10', B) + dot(16, 16, B),
  circle2p: circ(16, 16, 10) + s('M6 16 L26 16', D, 1.2) + sq(6, 16) + sq(26, 16),
  circle3p: circ(16, 16, 10) + sq(8, 10) + sq(24, 10) + sq(16, 26),
  circleD: circ(16, 16, 10) + s('M8 22 L24 10', B) + dot(16, 16, B),
  circleTtr: circ(16, 18, 8) + s('M3 10 L29 10', D) + s('M5 28 L12 4', D) + dot(16, 18, B),
  arc: s('M6 24 A 12 12 0 0 1 26 24') + sq(6, 24) + sq(16, 12.5) + sq(26, 24),
  arcSce: s('M6 22 A 11 11 0 0 1 26 22') + sq(6, 22) + dot(16, 22, B) + s('M16 22 L6 22', D, 1.2) + sq(26, 22),
  arcCse: s('M7 23 A 10 10 0 0 1 25 15') + dot(16, 24, B, 2.2) + s('M16 24 L7 23', D, 1.2) + sq(7, 23) + sq(25, 15),
  rectang: s('M5 9 H27 V24 H5 Z') + sq(5, 24) + sq(27, 9),
  polygon: s('M16 4 L27 12 L23 26 L9 26 L5 12 Z') + dot(16, 16, B),
  ellipse: `<ellipse cx="16" cy="16" rx="12" ry="7" fill="none" stroke="${W}" stroke-width="1.8"/>` + dot(16, 16, B) + sq(4, 16) + sq(28, 16),
  spline: s('M4 22 C 9 4, 15 4, 17 16 S 26 28, 28 10') + sq(4, 22) + sq(17, 16) + sq(28, 10),
  point: s('M16 9 V23 M9 16 H23', D, 1.2) + dot(16, 16, Y, 3),
  hatch: s('M5 6 H27 V26 H5 Z') + s('M5 14 L13 6 M5 22 L21 6 M9 26 L27 8 M17 26 L27 16', B, 1.4),
  gradient: `<defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="${B}"/><stop offset="1" stop-color="#1b3a5a"/></linearGradient></defs><rect x="5" y="6" width="22" height="20" fill="url(#g)" stroke="${W}" stroke-width="1.6"/>`,

  move: arrow('M16 5 V27 M5 16 H27', 'M16 2 L19.5 7 H12.5 Z M16 30 L19.5 25 H12.5 Z M2 16 L7 12.5 V19.5 Z M30 16 L25 12.5 V19.5 Z'),
  copy: s('M4 12 H16 V26 H4 Z', D) + s('M14 6 H26 V20 H14 Z') + arrow('M10 19 L20 13', 'M22 12 L17 12 L19.5 16 Z', Y),
  rotate: s('M8 22 L22 8', D) + s('M10 24 L24 10') + s('M25 19 A 10 10 0 1 1 18 6', B) + fill('M16 3 L21 6 L16 9 Z', B),
  scale: s('M4 20 H12 V28 H4 Z', D) + s('M4 4 H26 V26 H4 Z') + arrow('M10 22 L22 10', 'M24 8 L23 14 L18 9 Z', B),
  mirror: s('M16 3 V29', Y, 1.4) + fill('M4 24 L13 8 L13 24 Z', W, 0.25) + s('M4 24 L13 8 L13 24 Z') + s('M28 24 L19 8 L19 24 Z', B),
  offset: s('M4 24 Q 6 8 26 6') + s('M8 28 Q 10 13 28 11', B) + arrow('M14 12 L17 16', 'M18.5 18 L14.5 16.5 L17.5 13.5 Z', Y),
  trim: s('M4 16 H13', W) + s('M19 16 H28', R, 1.8) + s('M9 4 V28 M23 4 V28', D) + `<path d="M19 16 H28" stroke="${R}" stroke-width="1.8" stroke-dasharray="2 2"/>` + s('M23 10 L27 6 M23 22 L27 26', R, 1.4),
  extend: s('M4 16 H17') + `<path d="M17 16 H25" stroke="${B}" stroke-width="1.8" stroke-dasharray="2 2"/>` + s('M26 4 V28', D, 2.2) + fill('M25 16 L20 12.5 V19.5 Z', B),
  erase: s('M6 22 L16 8 L26 16 L18 27 H10 Z') + fill('M6 22 L11 15 L21 23 L18 27 H10 Z', R, 0.85),
  fillet: s('M5 27 V14 A 9 9 0 0 1 14 5 H27') + s('M5 14 A 9 9 0 0 1 14 5', B, 2.2) + dot(14, 14, Y, 1.4),
  chamfer: s('M5 27 V13 L13 5 H27') + s('M5 13 L13 5', B, 2.2),
  arrayRect: [6, 16, 26].flatMap((x) => [8, 20].map((y) => `<rect x="${x - 3.5}" y="${y - 3.5}" width="7" height="7" fill="none" stroke="${x === 6 && y === 20 ? W : B}" stroke-width="1.6"/>`)).join(''),
  arrayPolar: [0, 60, 120, 180, 240, 300].map((a) => { const r = (a * Math.PI) / 180; const x = 16 + Math.cos(r) * 10, y = 16 + Math.sin(r) * 10; return `<rect x="${x - 2.8}" y="${y - 2.8}" width="5.6" height="5.6" fill="none" stroke="${a === 0 ? W : B}" stroke-width="1.5"/>`; }).join('') + dot(16, 16, Y),
  explode: s('M10 10 L5 5 M22 10 L27 5 M10 22 L5 27 M22 22 L27 27', B) + s('M11 11 H21 V21 H11 Z') + dot(16, 16, Y, 1.6),
  stretch: `<path d="M4 8 H18 V24 H4" fill="none" stroke="${W}" stroke-width="1.8"/>` + `<path d="M12 4 H28 V28 H12 Z" fill="${G}" fill-opacity="0.12" stroke="${G}" stroke-width="1.2" stroke-dasharray="3 2"/>` + arrow('M18 16 H26', 'M29 16 L24 12.5 V19.5 Z', B),
  break: s('M4 16 H12 M20 16 H28') + sq(12, 16, R, 1.8) + sq(20, 16, R, 1.8),
  join: s('M4 22 L14 10') + s('M14 10 L28 18', B) + dot(14, 10, Y, 2.4),
  matchprop: s('M7 25 L18 14', W, 3) + fill('M17 9 L23 15 L27 11 L21 5 Z', Y) + s('M4 28 L8 24', B, 3),
  text: txt(16, 24, 'A', W, 22),
  mtext: txt(11, 18, 'A', W, 16) + s('M19 9 H28 M19 14 H28 M4 22 H28 M4 27 H22', B, 1.6),
  textedit: txt(12, 22, 'A', W, 18) + s('M20 26 L28 18 L25 15 L17 23 Z', Y, 1.4),
  dimlinear: s('M6 26 V8 M26 26 V8', D, 1.2) + s('M6 12 H26', B) + fill('M6 12 L11 9.5 V14.5 Z M26 12 L21 9.5 V14.5 Z', B) + s('M6 26 H26', W),
  dimaligned: s('M5 25 L23 7', W) + s('M9 29 L27 11', B) + s('M5 25 L9 29 M23 7 L27 11', D, 1.2) + fill('M9 29 L10 23.5 L14.5 26 Z M27 11 L21.5 12 L24 16.5 Z', B),
  dimradius: circ(14, 18, 10, W) + s('M14 18 L22 10 L29 4', B) + fill('M21.2 10.8 L19 15.5 L16.5 13 Z', B) + dot(14, 18, Y, 1.4),
  dimdiameter: circ(16, 16, 10, W) + s('M9 23 L23 9', B) + fill('M23 9 L21 14 L18 11 Z M9 23 L11 18 L14 21 Z', B),
  dimangular: s('M5 27 L27 27 M5 27 L22 6', W) + s('M19 27 A 14 14 0 0 0 14 16', B) + fill('M19 27 L17 22 L21.5 22.5 Z', B),
  dimension: s('M6 26 V8 M26 26 V8', D, 1.2) + s('M6 12 H26', B) + fill('M6 12 L11 9.5 V14.5 Z M26 12 L21 9.5 V14.5 Z', B) + txt(16, 25, '25', W, 9, 600),
  mleader: fill('M5 26 L11 19 L13 22 Z', B) + s('M9 22 L18 11 H28', B) + s('M18 6 H28', W, 1.4),
  layers: s('M16 4 L28 10 L16 16 L4 10 Z', B) + s('M4 16 L16 22 L28 16') + s('M4 22 L16 28 L28 22', D),
  layerProps: s('M15 5 L27 11 L15 17 L3 11 Z', B) + s('M3 17 L15 23 L27 17', W) + `<rect x="19" y="19" width="10" height="10" rx="1.5" fill="#2b3442" stroke="${Y}" stroke-width="1.4"/>` + s('M21.5 22 H26.5 M21.5 24.5 H26.5 M21.5 27 H24', Y, 1.2),
  bulbOn: `<path d="M16 4 a8 8 0 0 0 -5 14 v4 h10 v-4 a8 8 0 0 0 -5 -14 z" fill="${Y}" stroke="#a8862a" stroke-width="1"/>` + s('M12 25 H20 M13 28 H19', D, 1.6),
  bulbOff: `<path d="M16 4 a8 8 0 0 0 -5 14 v4 h10 v-4 a8 8 0 0 0 -5 -14 z" fill="#3a4555" stroke="#6b7789" stroke-width="1.2"/>` + s('M12 25 H20 M13 28 H19', D, 1.6),
  sun: circ(16, 16, 5, Y, 2) + s('M16 4 V8 M16 24 V28 M4 16 H8 M24 16 H28 M7.5 7.5 L10.3 10.3 M21.7 21.7 L24.5 24.5 M7.5 24.5 L10.3 21.7 M21.7 10.3 L24.5 7.5', Y, 1.8),
  snowflake: s('M16 4 V28 M5.6 10 L26.4 22 M5.6 22 L26.4 10 M13 6 L16 9 L19 6 M13 26 L16 23 L19 26', '#8fd0ff', 1.6),
  lockOpen: `<rect x="8" y="15" width="16" height="12" rx="2" fill="${D}"/>` + s('M12 15 V11 a5 5 0 0 1 10 -1', W, 2),
  lockClosed: `<rect x="8" y="15" width="16" height="12" rx="2" fill="${Y}"/>` + s('M11 15 V11 a5 5 0 0 1 10 0 V15', W, 2),
  printer: s('M9 12 V5 H23 V12 M7 12 H25 V22 H7 Z M10 19 H22 V27 H10 Z', W, 1.6),
  layerCurrent: s('M15 5 L27 11 L15 17 L3 11 Z', B) + s('M3 17 L15 23 L27 17', W) + s('M19 24 L22 27 L29 20', G, 2.2),
  layerMatch: s('M15 5 L27 11 L15 17 L3 11 Z', B) + s('M3 17 L15 23 L27 17', W) + fill('M20 18 L26 24 L29 21 L23 15 Z', Y),
  blockInsert: s('M6 10 L16 5 L26 10 L26 22 L16 27 L6 22 Z') + s('M6 10 L16 15 L26 10 M16 15 V27', D, 1.2) + dot(16, 27, B, 2.5),
  blockCreate: s('M8 12 L16 8 L24 12 L24 22 L16 26 L8 22 Z', D) + s('M8 12 L16 16 L24 12 M16 16 V26', D, 1.2) + s('M24 4 V12 M20 8 H28', G, 2.2),
  zoomExtents: circ(13, 13, 8) + s('M19 19 L27 27', W, 3) + s('M9 13 H17 M13 9 V17', B, 1.6),
  zoomWindow: circ(13, 13, 8) + s('M19 19 L27 27', W, 3) + `<rect x="9" y="10" width="8" height="6" fill="none" stroke="${B}" stroke-width="1.4"/>`,
  zoomPrev: circ(13, 13, 8) + s('M19 19 L27 27', W, 3) + s('M16 13 H10 M12 10.5 L9.5 13 L12 15.5', B, 1.5),
  pan: `<path d="M11 15 V7 a2 2 0 0 1 4 0 V14 V5 a2 2 0 0 1 4 0 V14 V7 a2 2 0 0 1 4 0 V18 c0 5 -3 9 -8 9 c-4 0 -6 -2 -8 -6 l-3 -5 a2 2 0 0 1 3 -2 Z" fill="none" stroke="${W}" stroke-width="1.6" stroke-linejoin="round"/>`,
  undo: s('M9 13 H20 a7 7 0 0 1 0 14 H12', W, 2) + fill('M3 13 L10 7.5 V18.5 Z', W),
  redo: s('M23 13 H12 a7 7 0 0 0 0 14 H20', W, 2) + fill('M29 13 L22 7.5 V18.5 Z', W),
  new: `<path d="M8 3 H19 L25 9 V29 H8 Z" fill="#2c3644" stroke="${W}" stroke-width="1.6"/>` + s('M19 3 V9 H25', W, 1.4) + s('M16.5 15 V24 M12 19.5 H21', G, 2),
  open: `<path d="M3 9 H12 L14 12 H27 V26 H3 Z" fill="#3a4555" stroke="${Y}" stroke-width="1.6"/>` + `<path d="M3 26 L8 15 H30 L25 26 Z" fill="${Y}" fill-opacity="0.85"/>`,
  save: `<path d="M5 5 H24 L27 8 V27 H5 Z" fill="#2c3644" stroke="${B}" stroke-width="1.6"/>` + `<rect x="9" y="5" width="12" height="7" fill="${B}"/>` + `<rect x="9" y="17" width="14" height="10" fill="${W}" fill-opacity="0.85"/>`,
  saveAs: `<path d="M5 5 H24 L27 8 V27 H5 Z" fill="#2c3644" stroke="${B}" stroke-width="1.6"/>` + `<rect x="9" y="5" width="12" height="7" fill="${B}"/>` + fill('M15 27 L17 21 L27 11 L30 14 L20 24 Z', Y),
  dist: s('M5 22 L27 22', B) + s('M5 18 V26 M27 18 V26', W) + fill('M5 22 L10 19.5 V24.5 Z M27 22 L22 19.5 V24.5 Z', B) + s('M7 8 H25 V14 H7 Z M11 8 V11 M15 8 V12 M19 8 V11 M23 8 V12', D, 1.2),
  area: fill('M6 25 L10 8 L25 6 L27 22 Z', B, 0.25) + s('M6 25 L10 8 L25 6 L27 22 Z', B) + sq(6, 25, Y) + sq(10, 8, Y) + sq(25, 6, Y) + sq(27, 22, Y),
  list: s('M8 6 H24 V27 H8 Z') + s('M12 11 H20 M12 15 H20 M12 19 H20 M12 23 H17', B, 1.4),
  idPoint: s('M16 4 V28 M4 16 H28', D, 1.2) + dot(16, 16, Y, 3) + txt(24, 11, 'xy', B, 8, 600),
  properties: `<rect x="5" y="4" width="22" height="24" rx="2" fill="#2c3644" stroke="${W}" stroke-width="1.6"/>` + s('M9 10 H15 M9 16 H15 M9 22 H15', D, 1.6) + s('M18 10 H23 M18 16 H23 M18 22 H23', B, 1.6),
  paste: `<rect x="6" y="6" width="16" height="22" rx="2" fill="#5a4a2a" stroke="${Y}" stroke-width="1.4"/>` + `<rect x="11" y="3" width="6" height="5" rx="1" fill="${W}"/>` + `<rect x="14" y="13" width="14" height="16" fill="#2c3644" stroke="${W}" stroke-width="1.4"/>`,
  copyclip: `<rect x="5" y="4" width="14" height="18" fill="#2c3644" stroke="${D}" stroke-width="1.4"/>` + `<rect x="12" y="10" width="14" height="18" fill="#2c3644" stroke="${W}" stroke-width="1.4"/>`,
  cut: circ(10, 23, 4, W, 1.6) + circ(22, 23, 4, W, 1.6) + s('M12 20 L22 4 M20 20 L10 4', B, 1.8),
  purge: s('M8 9 H24 L22 28 H10 Z') + s('M6 9 H26 M13 9 V5 H19 V9', W, 1.6) + s('M13 14 V24 M16 14 V24 M19 14 V24', R, 1.4),
  regen: s('M24 10 A 10 10 0 1 0 26 18', B, 2) + fill('M26 4 L27 12 L20 10 Z', B),
  help: circ(16, 16, 12, B, 2) + txt(16, 21.5, '?', W, 15),
  selectAll: `<rect x="4" y="4" width="24" height="24" fill="none" stroke="${B}" stroke-width="1.6" stroke-dasharray="3 2"/>` + s('M9 21 L14 10 L19 18 L23 12'),
  menu: s('M8 10 H24 M8 16 H24 M8 22 H24', W, 2),
  close: s('M9 9 L23 23 M23 9 L9 23', W, 2),
  chevronDown: s('M10 13 L16 19 L22 13', W, 2),
  wrench: s('M19 6 a6 6 0 0 0 -6 8 L5 22 L9 26 L17 18 a6 6 0 0 0 8 -6 l-4 2 l-3 -3 l2 -4 Z', W, 1.6),
  search: circ(14, 14, 7, W, 2) + s('M19 19 L26 26', W, 2.4),
  blockEdit: s('M6 10 L16 5 L26 10 L26 22 L16 27 L6 22 Z', D) + s('M6 10 L16 15 L26 10 M16 15 V27', D, 1.2) + fill('M17 25 L19 19 L27 11 L30 14 L22 22 Z', Y),
  dimStyle: s('M5 22 V8 M27 22 V8', D, 1.2) + s('M5 12 H27', B) + fill('M5 12 L10 9.5 V14.5 Z M27 12 L22 9.5 V14.5 Z', B) + `<rect x="14" y="17" width="14" height="11" rx="1.5" fill="#2b3442" stroke="${Y}" stroke-width="1.4"/>` + s('M17 21 H25 M17 24.5 H23', Y, 1.2),
  bold: txt(16, 23, 'B', W, 19, 800),
  italic: `<text x="16" y="23" fill="${W}" font-family="Georgia, serif" font-size="20" font-style="italic" text-anchor="middle">I</text>`,
  underline: txt(16, 21, 'U', W, 17, 600) + s('M9 26 H23', W, 1.8),
  textColor: txt(16, 20, 'A', W, 17, 700) + `<rect x="7" y="23" width="18" height="4" fill="${R}"/>`,
  justify: s('M6 8 H26 M6 13 H20 M6 18 H26 M6 23 H18', W, 1.8),
  symbol: txt(16, 23, '@', W, 18, 600),
  closeCheck: circ(16, 16, 11, G, 2) + s('M10.5 16.5 L14.5 20.5 L22 12', G, 2.4),
  closeRed: circ(16, 16, 11, R, 2) + s('M11 11 L21 21 M21 11 L11 21', R, 2.2),
  pickPoints: s('M5 5 H27 V27 H5 Z', D, 1.4) + s('M10 22 L13 12 L16 18', W, 1.4) + `<path d="M17 17 L17 29 L20 26 L22.5 30.5 L24.5 29.5 L22 25 L26 25 Z" fill="${W}" stroke="#222" stroke-width="0.8"/>`,
  selectObjects: s('M4 6 H22 V22 H4 Z', B, 1.6) + `<path d="M17 17 L17 29 L20 26 L22.5 30.5 L24.5 29.5 L22 25 L26 25 Z" fill="${W}" stroke="#222" stroke-width="0.8"/>`,
  basePoint: s('M16 4 V28 M4 16 H28', D, 1.2) + circ(16, 16, 5, Y, 2) + dot(16, 16, Y, 1.6),
  // status bar
  grid: s('M6 6 H26 V26 H6 Z M6 12.7 H26 M6 19.3 H26 M12.7 6 V26 M19.3 6 V26', W, 1.3),
  snapMode: [8, 16, 24].flatMap((x) => [8, 16, 24].map((y) => dot(x, y, W, 1.6))).join('') + s('M16 16 L24 8', B, 1.4),
  ortho: s('M7 7 V25 H25', W, 2) + s('M7 25 L18 14', D, 1.2),
  polar: s('M6 26 H26 M6 26 L22 10', W, 1.6) + `<path d="M15 26 A 9 9 0 0 0 12.4 19.6" fill="none" stroke="${B}" stroke-width="1.6"/>` + s('M6 26 L13 6', D, 1.1),
  osnap: `<rect x="9" y="9" width="14" height="14" fill="none" stroke="${G}" stroke-width="2"/>` + s('M4 28 L28 4', W, 1.2),
  otrack: `<path d="M4 20 H28" stroke="#62d277" stroke-width="1.6" stroke-dasharray="3 2.5" fill="none"/><path d="M12 4 V28" stroke="#62d277" stroke-width="1.6" stroke-dasharray="3 2.5" fill="none"/><rect x="8" y="16" width="8" height="8" fill="none" stroke="#dde4ec" stroke-width="1.6"/>`,
  dyn: `<rect x="5" y="9" width="22" height="14" rx="2" fill="none" stroke="${W}" stroke-width="1.6"/>` + s('M9 16 H13 M16 16 H23', B, 2),
  model: s('M4 24 L16 8 L28 24 Z', W, 1.6),
  coords: txt(16, 20, 'xy', W, 12, 600),
};

export function icon(name: string, size = 32, extraClass = ''): string {
  const body = ICONS[name] ?? ICONS.help;
  return `<svg class="ico ${extraClass}" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">${body}</svg>`;
}

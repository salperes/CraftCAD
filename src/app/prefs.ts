// User preferences persisted in localStorage (like AutoCAD's registry-stored settings).
// Drawing-level variables (LTSCALE, DIMSCALE, …) stay in the DXF file instead.

import type { Editor } from './editor.ts';
import type { SnapKind } from '../core/entities.ts';
import { ALL_SNAPS } from './snap.ts';

const KEY = 'craftcad.prefs.v1';

interface Prefs {
  osnap: boolean;
  osnapModes: SnapKind[];
  ortho: boolean;
  polar: boolean;
  polarInc: number;
  grid: boolean;
  snap: boolean;
  snapStep: number;
  dyn: boolean;
  aperture: number;
  otrack: boolean;
  cursorSize: number;
  gridStep: number;
  gridMajor: number;
  palette: boolean;
  recent: string[];
}

function snapshot(ed: Editor, palette: boolean): Prefs {
  const s = ed.settings, r = ed.renderer;
  return {
    osnap: s.osnap, osnapModes: [...s.osnapModes], ortho: s.ortho, polar: s.polar, polarInc: s.polarInc,
    grid: s.grid, snap: s.snap, snapStep: s.snapStep, dyn: s.dyn, aperture: s.aperture, otrack: s.otrack,
    cursorSize: r.cursorSize, gridStep: r.gridStep, gridMajor: r.gridMajor, palette, recent: ed.recentCommands.slice(0, 20),
  };
}

const num = (v: unknown, min: number, max: number, def: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : def);
const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);

/** Applies stored preferences; returns whether the properties palette should be shown. */
export function loadPrefs(ed: Editor): { palette: boolean } {
  let p: Partial<Prefs> = {};
  try {
    p = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
  } catch {
    return { palette: false };
  }
  const s = ed.settings, r = ed.renderer;
  s.osnap = bool(p.osnap, s.osnap);
  if (Array.isArray(p.osnapModes)) s.osnapModes = new Set(p.osnapModes.filter((k): k is SnapKind => (ALL_SNAPS as string[]).includes(k)));
  s.ortho = bool(p.ortho, s.ortho);
  s.polar = bool(p.polar, s.polar) && !s.ortho;
  s.polarInc = num(p.polarInc, 0.1, 180, s.polarInc);
  s.grid = bool(p.grid, s.grid);
  s.snap = bool(p.snap, s.snap);
  s.snapStep = num(p.snapStep, 1e-9, 1e9, s.snapStep);
  s.dyn = bool(p.dyn, s.dyn);
  s.aperture = num(p.aperture, 1, 50, s.aperture);
  s.otrack = bool(p.otrack, s.otrack);
  r.cursorSize = num(p.cursorSize, 1, 100, r.cursorSize);
  r.gridStep = num(p.gridStep, 1e-9, 1e9, r.gridStep);
  r.gridMajor = num(p.gridMajor, 1, 100, r.gridMajor);
  if (Array.isArray(p.recent)) ed.recentCommands = p.recent.filter((c): c is string => typeof c === 'string' && !!ed.resolveCommand(c)).slice(0, 20);
  return { palette: bool(p.palette, false) };
}

/** Saves preferences whenever they change (polled cheaply, plus on page hide). */
export function watchPrefs(ed: Editor, paletteVisible: () => boolean): void {
  let last = '';
  const save = () => {
    const json = JSON.stringify(snapshot(ed, paletteVisible()));
    if (json === last) return;
    last = json;
    try {
      localStorage.setItem(KEY, json);
    } catch {
      // Storage may be unavailable (private mode, blocked site data); settings then last for the session.
    }
  };
  last = JSON.stringify(snapshot(ed, paletteVisible()));
  window.setInterval(save, 1500);
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
}

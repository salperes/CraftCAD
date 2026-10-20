// PLOT dialog: renders the drawing at print resolution and sends it to the browser's
// print dialog (Save as PDF / printer) or saves a PNG.

import type { Editor } from '../app/editor.ts';
import { type Box, type Vec, boxFromPts, boxValid } from '../core/geom.ts';
import { Viewport } from '../view/viewport.ts';
import { h } from './dom.ts';

const PAPERS: Record<string, [number, number]> = {
  'ISO A4 (297 x 210 mm)': [297, 210], 'ISO A3 (420 x 297 mm)': [420, 297], 'ISO A2 (594 x 420 mm)': [594, 420],
  'ISO A1 (841 x 594 mm)': [841, 594], 'ISO A0 (1189 x 841 mm)': [1189, 841],
  'ANSI A (11 x 8.5 in)': [279.4, 215.9], 'ANSI B (17 x 11 in)': [431.8, 279.4],
};
const MARGIN = 5; // mm

interface PlotCfg {
  device: 'pdf' | 'png';
  paper: string;
  landscape: boolean;
  area: 'extents' | 'display' | 'window';
  window: Box | null;
  fit: boolean;
  mmPerUnit: number;
  unitsPerMm: number;
  center: boolean;
  mono: boolean;
  dpi: number;
  lw: number;
}

let last: PlotCfg | null = null;

function paperMm(c: PlotCfg): [number, number] {
  const [a, b] = PAPERS[c.paper];
  return c.landscape ? [Math.max(a, b), Math.min(a, b)] : [Math.min(a, b), Math.max(a, b)];
}

function plotBox(ed: Editor, c: PlotCfg): Box | null {
  if (c.area === 'window' && c.window) return c.window;
  if (c.area === 'display') return ed.view.visibleBox();
  const e = ed.doc.extents();
  return boxValid(e) ? e : null;
}

/** Builds the plot viewport for a canvas of the given pixel size (pixels per mm = k). */
function plotView(ed: Editor, c: PlotCfg, k: number, wpx: number, hpx: number): { v: Viewport; scaleText: string } | null {
  const b = plotBox(ed, c);
  if (!b) return null;
  const v = new Viewport();
  v.resize(wpx, hpx);
  const [pw, ph] = paperMm(c);
  const printW = pw - 2 * MARGIN, printH = ph - 2 * MARGIN;
  const bw = Math.max(b.maxX - b.minX, 1e-9), bh = Math.max(b.maxY - b.minY, 1e-9);
  const mmPerUnit = c.fit ? Math.min(printW / bw, printH / bh) : c.mmPerUnit / c.unitsPerMm;
  v.scale = mmPerUnit * k;
  if (c.center) { v.cx = (b.minX + b.maxX) / 2; v.cy = (b.minY + b.maxY) / 2; }
  else {
    // Lower-left of the plot area at the lower-left printable corner.
    v.cx = b.minX + (pw / 2 - MARGIN) / mmPerUnit;
    v.cy = b.minY + (ph / 2 - MARGIN) / mmPerUnit;
  }
  const ratio = mmPerUnit >= 1 ? `${+mmPerUnit.toFixed(4)} : 1` : `1 : ${+(1 / mmPerUnit).toFixed(4)}`;
  return { v, scaleText: `${ratio} (mm : drawing units)` };
}

function renderPlot(ed: Editor, c: PlotCfg, k: number): HTMLCanvasElement | null {
  const [pw, ph] = paperMm(c);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(pw * k);
  canvas.height = Math.round(ph * k);
  const pv = plotView(ed, c, k, canvas.width, canvas.height);
  if (!pv) return null;
  ed.renderer.plotTo(canvas, ed.doc, pv.v, { mono: c.mono, lineWidthPx: Math.max(1, c.lw * k) });
  return canvas;
}

export function plotDialog(ed: Editor): Promise<void> {
  return new Promise((resolve) => {
    const c: PlotCfg = last ?? {
      device: 'pdf', paper: 'ISO A3 (420 x 297 mm)', landscape: true, area: 'extents', window: null, fit: true,
      mmPerUnit: 1, unitsPerMm: 1, center: true, mono: false, dpi: 300, lw: 0.25,
    };
    const back = h('div', { class: 'modal-back' });
    const win = h('div', { class: 'modal plot-dlg' });
    const x = h('button', { class: 'modal-x', html: '&times;' });
    const body = h('div', { class: 'modal-body plot-body' });
    const foot = h('div', { class: 'modal-foot' });
    win.append(h('div', { class: 'modal-head' }, h('span', {}, 'Plot - Model'), x), body, foot);
    back.append(win);
    document.body.append(back);
    const close = () => { back.remove(); last = { ...c }; resolve(); };
    x.addEventListener('click', close);

    const sel = (opts: [string, string][], value: string, on: (v: string) => void) => {
      const s = h('select', { class: 'inp' }) as HTMLSelectElement;
      for (const [v, l] of opts) s.append(h('option', { value: v, selected: v === value }, l));
      s.addEventListener('change', () => { on(s.value); update(); });
      return s;
    };
    const numIn = (value: number, on: (v: number) => void) => {
      const i = h('input', { class: 'inp', type: 'number', step: 'any', value: String(value) }) as HTMLInputElement;
      i.addEventListener('input', () => { const v = parseFloat(i.value); if (v > 0) { on(v); update(); } });
      return i;
    };
    const chk = (label: string, value: boolean, on: (v: boolean) => void) => {
      const i = h('input', { type: 'checkbox' }) as HTMLInputElement;
      i.checked = value;
      i.addEventListener('change', () => { on(i.checked); update(); });
      return h('label', { class: 'chk' }, i, h('span', {}, label));
    };
    const field = (label: string, el: HTMLElement) => h('div', { class: 'form-grid-row' }, h('span', {}, label), el);
    const group = (title: string, ...els: HTMLElement[]) => h('fieldset', {}, h('legend', {}, title), ...els);

    const winBtn = h('button', { class: 'btn' }, 'Window <');
    winBtn.addEventListener('click', async () => {
      back.hidden = true;
      try {
        const a = await ed.point('Specify first corner:');
        const b2 = a && typeof a !== 'string' ? await ed.point('Specify opposite corner:', { preview: (q) => [rect(a as Vec, q)] }) : null;
        if (a && b2 && typeof a !== 'string' && typeof b2 !== 'string') { c.window = boxFromPts(a, b2); c.area = 'window'; areaSel.value = 'window'; }
      } catch {
        // Esc while picking: keep the previous plot area.
      } finally {
        ed.prompt = null;
        ed.idlePrompt();
        back.hidden = false;
        update();
      }
    });
    const areaSel = sel([['extents', 'Extents'], ['display', 'Display'], ['window', 'Window']], c.area, (v) => { c.area = v as PlotCfg['area']; if (v === 'window' && !c.window) winBtn.click(); });
    const scaleIn1 = numIn(c.mmPerUnit, (v) => (c.mmPerUnit = v));
    const scaleIn2 = numIn(c.unitsPerMm, (v) => (c.unitsPerMm = v));
    const scaleRow = h('div', { class: 'plot-scale' }, scaleIn1, h('span', {}, 'mm ='), scaleIn2, h('span', {}, 'units'));
    const scaleInfo = h('div', { class: 'ds-note' });
    const preview = h('canvas', { class: 'plot-preview' }) as HTMLCanvasElement;
    const sizeInfo = h('div', { class: 'ds-note' });

    const left = h('div', { class: 'plot-col' },
      group('Printer/plotter', field('Name', sel([['pdf', 'PDF / System printer (browser print dialog)'], ['png', 'PNG image file']], c.device, (v) => (c.device = v as PlotCfg['device'])))),
      group('Paper size', sel(Object.keys(PAPERS).map((k) => [k, k]), c.paper, (v) => (c.paper = v)),
        h('div', { class: 'plot-orient' }, sel([['1', 'Landscape'], ['0', 'Portrait']], c.landscape ? '1' : '0', (v) => (c.landscape = v === '1')))),
      group('Plot area', field('What to plot', areaSel), winBtn),
      group('Plot offset', chk('Center the plot', c.center, (v) => (c.center = v))),
      group('Plot scale', chk('Fit to paper', c.fit, (v) => (c.fit = v)), scaleRow, scaleInfo),
    );
    const right = h('div', { class: 'plot-col' },
      group('Plot style table (pen assignments)', sel([['color', 'None (plot colors)'], ['mono', 'monochrome.ctb']], c.mono ? 'mono' : 'color', (v) => (c.mono = v === 'mono'))),
      group('Quality', field('DPI', sel([['150', '150'], ['300', '300'], ['600', '600']], String(c.dpi), (v) => (c.dpi = +v))),
        field('Lineweight (mm)', numIn(c.lw, (v) => (c.lw = v)))),
      group('Preview', preview, sizeInfo),
    );
    body.append(left, right);

    const update = () => {
      for (const el of [scaleIn1, scaleIn2]) el.disabled = c.fit;
      const [pw, ph] = paperMm(c);
      const k = Math.min(300 / pw, 210 / ph);
      preview.width = Math.round(pw * k);
      preview.height = Math.round(ph * k);
      const pv = plotView(ed, c, k, preview.width, preview.height);
      if (pv) {
        ed.renderer.plotTo(preview, ed.doc, pv.v, { mono: c.mono, lineWidthPx: 1 });
        scaleInfo.textContent = `Scale ${pv.scaleText}`;
        const g = preview.getContext('2d')!;
        g.setLineDash([3, 3]);
        g.strokeStyle = '#7a8aa0';
        g.strokeRect(MARGIN * k + 0.5, MARGIN * k + 0.5, (pw - 2 * MARGIN) * k, (ph - 2 * MARGIN) * k);
      } else scaleInfo.textContent = 'Nothing to plot.';
      const dpi = effectiveDpi(c);
      sizeInfo.textContent = `${pw} x ${ph} mm at ${dpi} dpi${dpi < c.dpi ? ' (reduced to fit memory)' : ''}`;
    };
    update();

    const ok = h('button', { class: 'btn primary' }, 'OK');
    const cancel = h('button', { class: 'btn' }, 'Cancel');
    ok.addEventListener('click', async () => {
      const dpi = effectiveDpi(c);
      const canvas = renderPlot(ed, c, dpi / 25.4);
      if (!canvas) { ed.print('Nothing to plot.', 'error'); return; }
      const name = ed.doc.fileName.replace(/\.(dxf|dwg)$/i, '') + '-Model';
      if (c.device === 'png') await savePng(canvas, name + '.png');
      else printCanvas(canvas, paperMm(c), name);
      ed.print(`Plot sent: ${c.paper}, ${c.landscape ? 'landscape' : 'portrait'}, ${dpi} dpi.`);
      close();
    });
    cancel.addEventListener('click', close);
    foot.append(ok, cancel);
  });
}

function effectiveDpi(c: PlotCfg): number {
  const [pw, ph] = paperMm(c);
  let dpi = c.dpi;
  // Keep the canvas under ~60 Mpx.
  while (dpi > 100 && (pw * dpi / 25.4) * (ph * dpi / 25.4) > 60e6) dpi = Math.round(dpi * 0.75);
  return dpi;
}

function rect(a: Vec, b: Vec) {
  return { type: 'polyline' as const, pts: [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }], bulges: [0, 0, 0, 0], closed: true };
}

async function savePng(canvas: HTMLCanvasElement, name: string): Promise<void> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) return;
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** Prints through a hidden iframe whose @page size matches the paper. */
function printCanvas(canvas: HTMLCanvasElement, [pw, ph]: [number, number], title: string): void {
  const url = canvas.toDataURL('image/png');
  const frame = h('iframe', { class: 'print-frame' }) as HTMLIFrameElement;
  document.body.append(frame);
  const d = frame.contentDocument!;
  d.open();
  d.write(`<!doctype html><html><head><title>${title}</title><style>@page{size:${pw}mm ${ph}mm;margin:0}html,body{margin:0;padding:0}img{display:block;width:${pw}mm;height:${ph}mm}</style></head><body><img src="${url}"></body></html>`);
  d.close();
  const img = d.querySelector('img')!;
  const go = () => {
    frame.contentWindow!.focus();
    frame.contentWindow!.print();
    setTimeout(() => frame.remove(), 60_000);
  };
  if (img.complete) setTimeout(go, 50); else img.onload = go;
}

// Opens a drawing in headless Chromium and measures full-render time at several zoom levels
// plus the cost per entity type. Usage: node test/perf.mjs <playwright> <file> [url]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const [, , pwPath, file, url = 'http://127.0.0.1:5173/'] = process.argv;
const { chromium } = require(pwPath);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(url);
await page.waitForSelector('.ribbon');
await page.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'tf'; document.body.append(i); });
await page.setInputFiles('#tf', file);
await page.evaluate(() => {
  const f = document.getElementById('tf').files[0];
  const dt = new DataTransfer(); dt.items.add(f);
  document.querySelector('.canvas-wrap').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
});
await page.waitForFunction(() => window.craftcad.doc.entities.size > 0, null, { timeout: 60000 });
await page.waitForTimeout(500);
const res = await page.evaluate(() => {
  const ed = window.craftcad;
  const time = (n = 5) => {
    const t = [];
    for (let i = 0; i < n; i++) { const t0 = performance.now(); ed.renderer.render(ed.doc, ed.view, ed.selection); t.push(performance.now() - t0); }
    t.sort((a, b) => a - b);
    return +t[Math.floor(n / 2)].toFixed(1);
  };
  const out = {};
  ed.zoomExtents();
  out.extents = time();
  const c = { x: ed.view.w / 2, y: ed.view.h / 2 };
  ed.view.zoomAt(c, 8); out.zoom8 = time();
  ed.view.zoomAt(c, 8); out.zoom64 = time();
  ed.zoomExtents();
  // per-type cost at extents
  const all = [...ed.doc.entities.values()];
  const byType = {};
  for (const tp of [...new Set(all.map((e) => e.type))]) {
    const keep = new Map(ed.doc.entities);
    ed.doc.entities = new Map(all.filter((e) => e.type === tp).map((e) => [e.id, e]));
    byType[tp] = time(3);
    ed.doc.entities = keep;
  }
  out.byType = byType;
  // pan responsiveness: frames over a synthetic drag
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) { ed.view.panPixels(5, 3); ed.renderer.render(ed.doc, ed.view, ed.selection); }
  out.pan20frames = +(performance.now() - t0).toFixed(0);
  return out;
});
console.log(JSON.stringify(res, null, 1));
await page.screenshot({ path: 'test/out/perf.png' });
await browser.close();

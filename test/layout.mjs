// Layout check: tabs, default viewport, MSPACE zoom through a viewport, MVIEW, viewport scale,
// paper space editing, and opening a drawing whose content is in a layout.
// Usage: node test/layout.mjs <playwright module path> [drawing with layouts]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2]);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:5173/');
await page.waitForSelector('.ribbon');
await page.evaluate(() => localStorage.clear());
const box = await (await page.$('.overlay-canvas')).boundingBox();
const type = async (s) => { await page.keyboard.type(s, { delay: 5 }); await page.keyboard.press('Enter'); await page.waitForTimeout(60); };
const ev = (f, a) => page.evaluate(f, a);
const shot = (n) => page.screenshot({ path: `test/out/layout-${n}.png` });
const out = {};

// Model geometry
await type('REC'); await type('0,0'); await type('2000,1000');
await type('C'); await type('1000,500'); await type('300');
// 1) Layout1 tab: a viewport over the printable area showing the model extents
await page.click('.ltab:nth-child(2)');
await page.waitForTimeout(150);
out.tab = await ev(() => { const ed = window.craftcad; const vps = [...ed.doc.entities.values()].filter((e) => e.type === 'viewport'); return { layout: ed.doc.layout?.name, live: ed.doc.live, viewports: vps.length, scale: vps[0] && +(vps[0].h / vps[0].vh).toFixed(5), model: ed.doc.modelEntities.size, status: document.querySelector('.sb-model').textContent, ribbon: document.querySelector('.ribbon-tab.ctx')?.textContent }; });
await shot('1-sheet');
// 2) Double-click inside the viewport → MSPACE, wheel zoom changes its view
const vpScreen = await ev(() => { const ed = window.craftcad; const vp = [...ed.doc.entities.values()].find((e) => e.type === 'viewport'); return ed.view.toScreen(vp.c); });
await page.mouse.dblclick(box.x + vpScreen.x + 40, box.y + vpScreen.y + 30);
await page.waitForTimeout(150);
await page.mouse.move(box.x + vpScreen.x, box.y + vpScreen.y);
await page.mouse.wheel(0, -200);
await page.waitForTimeout(200);
out.mspace = await ev(() => { const ed = window.craftcad; const vp = ed.activeViewport(); return { active: ed.activeVp !== null, live: ed.doc.live, vh: vp && +vp.vh.toFixed(2), status: document.querySelector('.sb-model').textContent, vpScale: document.querySelector('.sb-vpscale').textContent }; });
// Draw in model space through the viewport
await type('L'); await type('0,0'); await type('2000,1000'); await type('');
out.modelAfterLine = await ev(() => window.craftcad.doc.modelEntities.size);
await shot('2-mspace');
// 3) ZOOM 1/100XP sets the viewport scale
await type('ZOOM'); await type('S'); await type('1/100XP');
out.xp = await ev(() => { const vp = window.craftcad.activeViewport(); return +(vp.h / vp.vh).toFixed(6); });
// 4) PSPACE, then MVIEW a second viewport and set its scale from the status bar
await type('PS');
await type('MVIEW'); await type('300,150'); await type('400,270');
const sel = await ev(() => { const ed = window.craftcad; const vp = [...ed.doc.entities.values()].filter((e) => e.type === 'viewport').pop(); ed.selectIds([vp.id]); return vp.id; });
await page.waitForTimeout(100);
await page.click('.sb-vpscale');
await page.waitForTimeout(100);
await page.locator('.status-menu').getByText('1:50', { exact: true }).click();
await page.waitForTimeout(100);
out.mview = await ev((id) => { const ed = window.craftcad; const vp = ed.doc.get(id); return { count: [...ed.doc.entities.values()].filter((e) => e.type === 'viewport').length, scale: +(vp.h / vp.vh).toFixed(6), live: ed.doc.live }; }, sel);
// Paper space text (title block)
await page.keyboard.press('Escape');
await type('TEXT'); await type('10,10'); await type('5'); await type('0'); await page.keyboard.type('Paftanın başlığı'); await page.keyboard.press('Control+Enter'); await page.waitForTimeout(80); await page.keyboard.press('Escape'); await page.waitForTimeout(80);
out.paperText = await ev(() => [...window.craftcad.doc.entities.values()].filter((e) => e.type === 'text').length);
await shot('3-pspace');
// 5) Model tab again: model unchanged by paper edits, Layout2 gets its own viewport
await page.click('.ltab:nth-child(1)');
out.model = await ev(() => ({ layout: window.craftcad.doc.layout, ents: window.craftcad.doc.entities.size, ribbon: document.querySelector('.ribbon-tab.ctx')?.textContent ?? null }));
// 6) Undo in paper space only affects paper space
await page.click('.ltab:nth-child(2)');
await type('U');
out.undo = await ev(() => ({ text: [...window.craftcad.doc.entities.values()].filter((e) => e.type === 'text').length, model: window.craftcad.doc.modelEntities.size }));
// 7) Round trip through DXF with layouts
out.dxf = await ev(async () => {
  const { saveDxfString, openDxf } = await import('/src/io/files.ts');
  const ed = window.craftcad;
  const s = saveDxfString(ed.doc);
  const { Drawing } = await import('/src/core/document.ts');
  const d = new Drawing();
  const r = openDxf(d, new TextEncoder().encode(s), 'x.dxf');
  return { layouts: d.layouts.map((l) => `${l.name}:${d.paperEntities(l).size}`), active: r.activeLayout, model: d.entities.size };
});
// 8) New layout via the + tab, rename from the context menu
await page.click('.ltab.plus');
out.tabs = await ev(() => [...document.querySelectorAll('.ltab')].map((t) => t.textContent));

// 9) A drawing whose content lives in a layout opens on that layout
if (process.argv[3]) {
  await ev(() => { window.craftcad.doc.modified = false; });
  await page.evaluateHandle(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'tf'; document.body.append(i); return i; });
  await page.setInputFiles('#tf', process.argv[3]);
  await ev(() => {
    const f = document.getElementById('tf').files[0];
    const dt = new DataTransfer(); dt.items.add(f);
    document.querySelector('.canvas-wrap').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
  });
  await page.waitForFunction(() => window.craftcad.doc.layout || window.craftcad.doc.entities.size > 0, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  out.opened = await ev(() => { const ed = window.craftcad; return { layout: ed.doc.layout?.name ?? null, paper: ed.doc.layout?.paper, paperEnts: ed.doc.entities.size, model: ed.doc.modelEntities.size, tabs: [...document.querySelectorAll('.ltab')].map((t) => t.textContent), ms: +ed.renderer.stats.ms.toFixed(1) }; });
  await shot('4-opened');
}
console.log(JSON.stringify(out, null, 1));
if (errors.length) console.log('page errors:', errors);
await browser.close();

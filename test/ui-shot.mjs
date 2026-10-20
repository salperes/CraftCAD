// Drives the running app in headless Chromium and saves screenshots.
// Usage: node test/ui-shot.mjs <playwright-module-path> [url] [scenario]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const [, , pwPath, url = 'http://127.0.0.1:5173/', scenario = 'basic'] = process.argv;
const require = createRequire(import.meta.url);
const { chromium } = require(pwPath);

mkdirSync('test/out', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(url);
await page.waitForSelector('.ribbon');
await page.waitForTimeout(400);

const canvas = await page.$('.overlay-canvas');
const box = await canvas.boundingBox();
const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
const click = async (fx, fy) => { const p = at(fx, fy); await page.mouse.move(p.x, p.y, { steps: 3 }); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(60); };
const type = async (s) => { await page.keyboard.type(s, { delay: 15 }); };
const enter = async () => { await page.keyboard.press('Enter'); await page.waitForTimeout(60); };
const shot = async (name) => { await page.screenshot({ path: `test/out/ui-${name}.png` }); };
const history = async () => page.evaluate(() => window.__cmdlog ?? []);

if (scenario === 'basic') {
  await shot('empty');
  // LINE with typed coordinates and clicks
  await type('L'); await enter();
  await type('50,50'); await enter();
  await type('@150,0'); await enter();
  await type('@0,100'); await enter();
  await click(0.30, 0.25);
  await type('C'); await enter();
  // CIRCLE center + radius
  await type('C'); await enter();
  await type('200,150'); await enter();
  await type('40'); await enter();
  // RECTANG
  await type('REC'); await enter();
  await type('260,40'); await enter();
  await type('380,120'); await enter();
  // Hover preview of a pending circle
  await type('C'); await enter();
  await click(0.62, 0.55);
  const p = at(0.66, 0.5);
  await page.mouse.move(p.x, p.y, { steps: 5 });
  await page.waitForTimeout(150);
  await shot('drawing');
  await page.keyboard.press('Escape');
  // Select by window, show grips
  const a = at(0.05, 0.05), b = at(0.95, 0.95);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(150);
  await shot('selected');
  await page.keyboard.press('Escape');
  console.log('count', await page.evaluate(() => window.craftcad.doc.entities.size));
}

// World-coordinate helpers (go through the real mouse path).
const toS = async (x, y) => page.evaluate(([x, y]) => window.craftcad.view.toScreen({ x, y }), [x, y]);
const clickW = async (x, y) => { const s = await toS(x, y); await page.mouse.move(box.x + s.x, box.y + s.y, { steps: 3 }); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(60); };
const moveW = async (x, y) => { const s = await toS(x, y); await page.mouse.move(box.x + s.x, box.y + s.y, { steps: 4 }); await page.waitForTimeout(80); };
const cmd = async (...inputs) => { for (const i of inputs) { if (i) await type(i); await enter(); } };

if (scenario === 'modify') {
  // Keep the geometry above the floating command line.
  await page.evaluate(() => { window.craftcad.view.fit({ minX: -20, minY: -90, maxX: 420, maxY: 230 }); window.craftcad.redraw(); });
  await page.keyboard.press('F3'); // osnap off for exact typed input
  await cmd('L', '0,0', '200,0', '');
  await cmd('L', '0,100', '200,100', '');
  await cmd('L', '50,-20', '50,120', '');
  await cmd('L', '150,-20', '150,120', '');
  // TRIM: remove the vertical overhangs and the middle of the top line
  await cmd('TR');
  await clickW(50, 115); await clickW(150, 115); await clickW(50, -15); await clickW(150, -15); await clickW(100, 100);
  await enter();
  // OFFSET bottom line up by 20
  await cmd('O', '20');
  await clickW(100, 0); await clickW(100, 30);
  await enter();
  // FILLET r=15 on two lines meeting at a corner
  await cmd('L', '260,0', '360,0', '');
  await cmd('L', '360,0', '360,100', '');
  await cmd('F', 'R', '15');
  await clickW(300, 0); await clickW(360, 50);
  // CIRCLE + HATCH inside a closed rectangle made of lines
  await cmd('REC', '260,130', '360,200');
  await cmd('C', '310,165', '20');
  await cmd('H');
  await clickW(270, 140);
  await enter();
  // Dimensions
  await cmd('DLI', '0,0', '200,0'); await clickW(100, -30);
  await cmd('DRA'); await clickW(330, 165); await clickW(350, 215);
  // Text
  await cmd('DT', '0,140', '6', '0');
  await page.keyboard.type('CraftCAD çizim ğüşıöç', { delay: 10 });
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(100);
  await page.keyboard.press('F3');
  await page.evaluate(() => window.craftcad.zoomExtents());
  await page.waitForTimeout(200);
  // Hover a line endpoint to show the osnap marker during a LINE prompt
  await cmd('L');
  await moveW(201.5, 1.5);
  await page.waitForTimeout(150);
  await shot('modify');
  await page.keyboard.press('Escape');
  console.log('types', await page.evaluate(() => JSON.stringify([...window.craftcad.doc.entities.values()].reduce((a, e) => (a[e.type] = (a[e.type] || 0) + 1, a), {}))));
}

if (scenario === 'dialogs') {
  await page.evaluate(() => { window.craftcad.view.fit({ minX: -20, minY: -90, maxX: 420, maxY: 230 }); window.craftcad.redraw(); });
  await cmd('REC', '20,20', '200,150');
  await cmd('C', '300,100', '50');
  await page.evaluate(() => {
    const d = window.craftcad.doc;
    d.begin('x'); d.touchLayers();
    d.layers.set('Duvar', { name: 'Duvar', color: 1, ltype: 'Continuous', on: true, frozen: false, locked: false, plot: true });
    d.layers.set('Aks', { name: 'Aks', color: 4, ltype: 'CENTER', on: true, frozen: false, locked: true, plot: true });
    d.layers.set('Mobilya', { name: 'Mobilya', color: 30, ltype: 'DASHED', on: false, frozen: false, locked: false, plot: true });
    d.commit(); d.emit('layers');
  });
  await clickW(300, 150); // select circle
  await page.keyboard.press('Control+1');
  await page.waitForTimeout(200);
  await shot('props');
  await cmd('LA');
  await page.waitForTimeout(200);
  await shot('layers');
  await page.keyboard.press('Escape');
  // Layer dropdown in the ribbon
  await page.click('.layer-combo');
  await page.waitForTimeout(150);
  await shot('layer-combo');
  await page.mouse.click(10, 500);
  // Hatch settings dialog
  await cmd('H', 'T');
  await page.waitForTimeout(200);
  await shot('hatch-dlg');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  // Autocomplete
  await page.keyboard.type('DIM', { delay: 20 });
  await page.waitForTimeout(150);
  await shot('autocomplete');
}

if (scenario === 'annot') {
  await page.evaluate(() => {
    const ed = window.craftcad, d = ed.doc;
    d.begin('x'); d.touchLayers();
    d.layers.set('Aks', { name: 'Aks', color: 1, ltype: 'CENTER', on: true, frozen: false, locked: false, plot: true });
    d.layers.set('Gizli', { name: 'Gizli', color: 6, ltype: 'HIDDEN', on: true, frozen: false, locked: false, plot: true });
    d.layers.set('Olcu', { name: 'Olcu', color: 3, ltype: 'Continuous', on: true, frozen: false, locked: false, plot: true });
    d.commit();
    ed.view.fit({ minX: -30, minY: -45, maxX: 190, maxY: 90 }); ed.redraw();
  });
  await page.keyboard.press('F3');
  await cmd('REC', '0,0', '100,60');
  await cmd('C', '50,30', '15');
  await cmd('L', '-10,30', '110,30', '');
  await page.evaluate(() => { const ed = window.craftcad; const last = [...ed.doc.entities.values()].pop(); ed.doc.begin('x'); ed.doc.update({ ...last, layer: 'Aks' }); ed.doc.commit(); ed.doc.currentLayer = 'Olcu'; });
  await cmd('DLI', '0,0', '100,0', '50,-12');
  await cmd('DLI', '100,0', '100,60', '115,30');
  await cmd('DDI'); await clickW(50, 45); await clickW(80, 55);
  await cmd('L', '130,0', '180,0', '');
  await cmd('L', '130,0', '170,40', '');
  await cmd('DAN'); await clickW(160, 0); await clickW(150, 20); await clickW(165, 15);
  await cmd('DAL', '130,0', '170,40', '140,35');
  await page.evaluate(() => { window.craftcad.doc.currentLayer = 'Gizli'; });
  await cmd('C', '150,60', '6');
  await cmd('AR'); await clickW(150, 66); await enter(); await cmd('PO', '150,50', '6', '', '');
  await page.evaluate(() => { window.craftcad.doc.currentLayer = '0'; });
  await cmd('MLD', '100,60', '120,75');
  await page.keyboard.type('Delik Ø30', { delay: 10 });
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(200);
  await page.keyboard.press('F3');
  await page.mouse.move(box.x + 5, box.y + 5);
  await shot('annot');
  const dxf = await page.evaluate(() => import('/src/io/dxfWriter.ts').then((m) => m.writeDxf(window.craftcad.doc)));
  (await import('node:fs')).writeFileSync('test/out/ui-annot.dxf', dxf);
}

if (scenario === 'v2') {
  await page.evaluate(() => { window.craftcad.view.fit({ minX: -20, minY: -90, maxX: 420, maxY: 230 }); window.craftcad.redraw(); });
  await page.keyboard.press('F3');
  await cmd('REC', '20,20', '120,100');
  await cmd('C', '70,60', '25');
  // Right-click menu (idle) with a cascading submenu
  const rc = await toS(250, 50);
  await page.mouse.click(box.x + rc.x, box.y + rc.y, { button: 'right' });
  await page.waitForTimeout(150);
  const clip = await page.$('.shortcut-menu .menu-item.has-sub:nth-of-type(3)');
  await page.hover('.shortcut-menu .menu-item.has-sub >> text=Clipboard');
  await page.waitForTimeout(150);
  await shot('v2-rclick');
  await page.mouse.click(5, 880);
  void clip;
  // HATCH: contextual Hatch Creation tab
  await cmd('H');
  await page.waitForTimeout(150);
  await shot('v2-hatchtab');
  await clickW(30, 30);
  await enter();
  // BLOCK + BEDIT
  await cmd('B', 'Kutu', '20,20');
  await clickW(70, 35); await clickW(120, 60); await enter();
  await page.waitForTimeout(100);
  await cmd('BEDIT', 'Kutu');
  await page.waitForTimeout(250);
  await cmd('C', '0,0', '10');
  await shot('v2-bedit');
  await cmd('BCLOSE', '');
  await page.waitForTimeout(150);
  // MTEXT with the Text Editor tab
  await cmd('T', '160,100', '300,60');
  await page.waitForTimeout(150);
  await page.keyboard.type('Normal ', { delay: 5 });
  await page.keyboard.press('Control+b');
  await page.keyboard.type('Kalın', { delay: 5 });
  await page.keyboard.press('Control+b');
  await page.keyboard.type(' ve ', { delay: 5 });
  await page.keyboard.press('Control+i');
  await page.keyboard.type('italik', { delay: 5 });
  await page.waitForTimeout(150);
  await shot('v2-texteditor');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(150);
  console.log('mtext', await page.evaluate(() => [...window.craftcad.doc.entities.values()].filter((e) => e.type === 'mtext').map((e) => e.text).join(' | ')));
  // Right-click during a command
  await cmd('L');
  await clickW(200, -50);
  const rc2 = await toS(260, -40);
  await page.mouse.move(box.x + rc2.x, box.y + rc2.y);
  await page.mouse.click(box.x + rc2.x, box.y + rc2.y, { button: 'right' });
  await page.waitForTimeout(150);
  await page.hover('.shortcut-menu .menu-item >> text=Snap Overrides');
  await page.waitForTimeout(150);
  await shot('v2-cmdmenu');
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 880);
  await page.keyboard.press('Escape');
  // Sysvar / GRID / SNAP
  await cmd('CURSORSIZE', '100');
  await cmd('GRID', '5');
  await cmd('SNAP', '2.5');
  console.log('vars', await page.evaluate(() => JSON.stringify({ cursor: window.craftcad.renderer.cursorSize, grid: window.craftcad.renderer.gridStep, snap: window.craftcad.settings.snapStep, snapOn: window.craftcad.settings.snap })));
  await cmd('DS');
  await page.waitForTimeout(150);
  await shot('v2-dsettings');
  await page.keyboard.press('Escape');
  await cmd('PLOT');
  await page.waitForTimeout(300);
  await shot('v2-plot');
  await page.keyboard.press('Escape');
  await cmd('D');
  await page.waitForTimeout(200);
  await shot('v2-dimstyle');
  await page.keyboard.press('Escape');
}

if (scenario === 'open') {
  const file = process.argv[5];
  const input = await page.evaluateHandle(() => {
    const i = document.createElement('input'); i.type = 'file'; i.id = 'tf'; document.body.append(i); return i;
  });
  await page.setInputFiles('#tf', file);
  await page.evaluate(async () => {
    const f = document.getElementById('tf').files[0];
    const dt = new DataTransfer(); dt.items.add(f);
    document.querySelector('.canvas-wrap').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
  });
  void input;
  await page.waitForFunction(() => window.craftcad.doc.entities.size > 0, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  await shot('open');
  console.log('render ms', await page.evaluate(() => window.craftcad.renderer.stats.ms.toFixed(1)), 'drawn', await page.evaluate(() => window.craftcad.renderer.stats.drawn));
}

console.log((await history()).slice(-80).join('\n'));
if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
await browser.close();

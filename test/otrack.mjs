// Object snap tracking check: acquire an endpoint, follow its vertical/horizontal alignment.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2]);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto('http://127.0.0.1:5173/');
await page.waitForSelector('.ribbon');
await page.evaluate(() => { localStorage.clear(); const ed = window.craftcad; ed.view.fit({ minX: -50, minY: -80, maxX: 350, maxY: 180 }); ed.redraw(); });
const box = await (await page.$('.overlay-canvas')).boundingBox();
const toS = (x, y) => page.evaluate(([x, y]) => window.craftcad.view.toScreen({ x, y }), [x, y]);
const moveW = async (x, y, steps = 6) => { const s = await toS(x, y); await page.mouse.move(box.x + s.x, box.y + s.y, { steps }); };
const type = async (s) => { await page.keyboard.type(s, { delay: 10 }); await page.keyboard.press('Enter'); await page.waitForTimeout(80); };
const lines = () => page.evaluate(() => [...window.craftcad.doc.entities.values()].filter((e) => e.type === 'line').map((e) => `(${e.p1.x.toFixed(2)},${e.p1.y.toFixed(2)})-(${e.p2.x.toFixed(2)},${e.p2.y.toFixed(2)})`));
await type('L'); await type('0,100'); await type('100,100'); await type('');
// 1) vertical alignment from the acquired endpoint (100,100)
await type('L'); await type('0,0');
await moveW(101, 99); await page.waitForTimeout(500); // hover to acquire
await moveW(100.8, 60, 10); await moveW(101.2, 40, 6);
await page.waitForTimeout(120);
const st1 = await page.evaluate(() => ({ pt: window.craftcad.cursorPt, label: window.craftcad.trackLabel, acquired: window.craftcad.acquired.length }));
await page.screenshot({ path: 'test/out/otrack-vertical.png' });
await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(60);
await type('');
// 2) horizontal alignment + typed distance along it
await type('L'); await type('200,0');
await moveW(101, 99); await page.waitForTimeout(500);
await moveW(140, 100.7, 10); await moveW(160, 99.4, 6);
await page.waitForTimeout(120);
const st2 = await page.evaluate(() => ({ pt: window.craftcad.cursorPt, label: window.craftcad.trackLabel }));
await type('50'); await type('');
// 3) intersection of two alignments: x of (100,100) and y of (0,0)
await type('L'); await type('300,150');
await moveW(101, 99); await page.waitForTimeout(500);
await moveW(1, 1); await page.waitForTimeout(500);
await moveW(80, 10, 8); await moveW(100.6, 0.7, 8);
await page.waitForTimeout(120);
const st3 = await page.evaluate(() => ({ pt: window.craftcad.cursorPt, label: window.craftcad.trackLabel, acquired: window.craftcad.acquired.length }));
await page.screenshot({ path: 'test/out/otrack-intersection.png' });
await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(60);
await type('');
console.log(JSON.stringify({ st1, st2, st3 }, null, 1));
console.log((await lines()).join('\n'));
await browser.close();

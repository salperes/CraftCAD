// Electron E2E. Start the app first (with ELECTRON_RUN_AS_NODE unset):
//   electron . --remote-debugging-port=9333 <copy-of-drawing.dwg>
// then: node test/electron-check.mjs <playwright-module>
// Checks the desktop bridge, the drawing passed on the command line, and Ctrl+S in place.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2]);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
await page.waitForSelector('.ribbon', { timeout: 60000 });
await page.waitForFunction(() => window.craftcad.doc.entities.size > 0, null, { timeout: 120000 });
console.log('desktop bridge:', await page.evaluate(() => !!window.craftcadDesktop), '| title:', await page.title());
console.log('loaded:', (await page.evaluate(() => window.__cmdlog)).filter((l) => /loaded|Converting/.test(l)).join(' / '));
console.log('health:', await page.evaluate(() => fetch('api/health').then((r) => r.text())));
console.log('bundled ODA installer:', JSON.stringify(await page.evaluate(() => window.craftcadDesktop.odaBundled())));
const type = async (s) => { await page.keyboard.type(s, { delay: 10 }); await page.keyboard.press('Enter'); await page.waitForTimeout(80); };
await page.mouse.move(700, 500);
await type('C'); await type('0,0'); await type('750');
await page.keyboard.press('Control+s');
await page.waitForFunction(() => (window.__cmdlog ?? []).some((l) => l.startsWith('Saved') || l.startsWith('Save failed')), null, { timeout: 120000 });
console.log((await page.evaluate(() => window.__cmdlog)).filter((l) => /^Saved|^Save failed/.test(l)).join('\n'));
await page.screenshot({ path: 'test/out/electron.png' });
await browser.close();

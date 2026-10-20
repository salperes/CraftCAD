// E2E: open a DWG through the local converter, Save As AutoCAD 2018 DWG, write the bytes out.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const [, , pw, file, out] = process.argv;
const { chromium } = require(pw);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto('http://127.0.0.1:5173/');
await page.waitForSelector('.ribbon');
// Stub the File System Access save picker so the saved bytes can be captured.
await page.evaluate(() => {
  window.__saved = null;
  window.showSaveFilePicker = async (o) => ({ name: o.suggestedName, createWritable: async () => ({ write: async (b) => { const url = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }); window.__saved = { name: o.suggestedName, b64: String(url).split(',')[1] }; }, close: async () => {} }) });
  const i = document.createElement('input'); i.type = 'file'; i.id = 'tf'; document.body.append(i);
});
await page.setInputFiles('#tf', file);
await page.evaluate(() => {
  const f = document.getElementById('tf').files[0];
  const dt = new DataTransfer(); dt.items.add(f);
  document.querySelector('.canvas-wrap').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
});
await page.waitForFunction(() => window.craftcad.doc.entities.size > 0, null, { timeout: 120000 });
await page.waitForTimeout(300);
// Draw something new so the saved file differs from the input.
const type = async (s) => { await page.keyboard.type(s, { delay: 10 }); await page.keyboard.press('Enter'); await page.waitForTimeout(80); };
await type('C'); await type('0,0'); await type('500');
await page.keyboard.press('Control+Shift+S');
await page.waitForSelector('.saveas-dlg');
await page.screenshot({ path: 'test/out/saveas.png' });
console.log('types:', await page.$$eval('.saveas-dlg option', (o) => o.map((x) => `${x.textContent}${x.disabled ? ' [disabled]' : ''}${x.selected ? ' *' : ''}`).join(' | ')));
await page.click('.saveas-dlg .btn.primary');
await page.waitForFunction(() => window.__saved || (window.__cmdlog ?? []).some((l) => l.startsWith('Save failed')), null, { timeout: 180000 });
const saved = await page.evaluate(() => window.__saved);
writeFileSync(out, Buffer.from(saved.b64, 'base64'));
console.log('saved', saved.name, Buffer.from(saved.b64, 'base64').length, 'bytes');
console.log((await page.evaluate(() => window.__cmdlog)).slice(-6).join('\n'));
await browser.close();

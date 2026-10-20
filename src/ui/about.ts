// About CraftCAD / What's New: version, converter status and the changelog (changelog.md).

import changelogRaw from '../../changelog.md?raw';
import { version } from '../../package.json';
import { converterStatus } from '../io/convert.ts';
import { h } from './dom.ts';
import { escapeHtml } from './ribbon.ts';

// Imported (not injected at server start) so a version bump reaches a running dev server.
export const APP_VERSION: string = version;

interface Entry { rev: string; version: string; date: string; time: string; prompt: string; report: string[] }

/** Parses changelog.md entries (newest first, blocks separated by dashed lines). */
export function parseChangelog(raw: string): Entry[] {
  const blocks = raw.split(/^-{20,}\s*$/m).map((b) => b.trim()).filter(Boolean);
  return blocks.map((b) => {
    const field = (k: string) => new RegExp(`^${k}\\s*:\\s*(.*)$`, 'm').exec(b)?.[1].trim() ?? '';
    // The report closes with a ")" on its own line; items may contain parentheses.
    const rep = /Rev\. Report:\s*\(\s*\r?\n([\s\S]*?)\r?\n\)\s*$/m.exec(b)?.[1] ?? '';
    return {
      rev: field('Rev\\. ID'), version: field('Version'), date: field('Rev\\. Date'), time: field('Rev\\. Time'),
      prompt: field('Rev\\. Prompt'),
      report: rep.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('-')).map((l) => l.slice(1).trim()),
    };
  }).filter((e) => e.version);
}

export function aboutDialog(tab: 'about' | 'news' = 'about'): void {
  const back = h('div', { class: 'modal-back' });
  const win = h('div', { class: 'modal about-dlg' });
  const x = h('button', { class: 'modal-x', html: '&times;' });
  const strip = h('div', { class: 'dlg-tabs' });
  const pages = [h('div', { class: 'dlg-page about-page' }), h('div', { class: 'dlg-page news-page' })];
  const body = h('div', { class: 'modal-body' }, strip, ...pages);
  const close = h('button', { class: 'btn primary' }, 'Close');
  win.append(h('div', { class: 'modal-head' }, h('span', {}, 'About CraftCAD'), x), body, h('div', { class: 'modal-foot' }, close));
  back.append(win);
  document.body.append(back);
  const done = () => back.remove();
  x.addEventListener('click', done);
  close.addEventListener('click', done);
  const show = (i: number) => {
    [...strip.children].forEach((c, k) => c.classList.toggle('active', k === i));
    pages.forEach((p, k) => (p.hidden = k !== i));
  };
  ['About', "What's New"].forEach((t, i) => {
    const el = h('div', { class: 'dlg-tab' }, t);
    el.addEventListener('click', () => show(i));
    strip.append(el);
  });

  const entries = parseChangelog(changelogRaw);
  const conv = h('div', { class: 'about-row' }, h('span', {}, 'DWG converter'), h('b', {}, 'checking…'));
  pages[0].append(
    h('div', { class: 'about-logo' }, h('span', { class: 'logo big' }, 'C'), h('div', {}, h('div', { class: 'about-name' }, 'CraftCAD'), h('div', { class: 'about-ver' }, `Version ${APP_VERSION}`))),
    h('div', { class: 'about-row' }, h('span', {}, 'Release'), h('b', {}, entries[0] ? `Rev. ${entries[0].rev} — ${entries[0].date}` : '—')),
    h('div', { class: 'about-row' }, h('span', {}, 'DXF'), h('b', {}, 'Read: R12–2018 · Write: AutoCAD R2000 (AC1015)')),
    h('div', { class: 'about-row' }, h('span', {}, 'DWG'), h('b', {}, 'Read: LibreDWG or local converter · Write: local converter (2000–2018)')),
    conv,
    h('div', { class: 'about-row' }, h('span', {}, 'License'), h('b', {}, 'GPL-3.0-or-later')),
    h('div', { class: 'ds-note' }, 'Lightweight web-based 2D CAD with AutoCAD-style commands.'),
  );
  void converterStatus(true).then((s) => {
    (conv.lastChild as HTMLElement).textContent = s.available ? `${s.engine} (available)` : 'not available — DWG saving disabled';
  });

  for (const e of entries) {
    pages[1].append(h('div', { class: 'news-entry', html:
      `<div class="news-head"><b>${escapeHtml(e.version)}</b><span>Rev. ${escapeHtml(e.rev)} · ${escapeHtml(e.date)}${e.time && !e.time.startsWith('—') ? ' ' + escapeHtml(e.time) : ''}</span></div>` +
      `<div class="news-prompt">${escapeHtml(e.prompt)}</div>` +
      `<ul>${e.report.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` }));
  }
  show(tab === 'news' ? 1 : 0);
}

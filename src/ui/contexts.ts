// Contextual ribbon tabs: Text Editor, Hatch Creation / Hatch Editor, Block Editor.

import type { Editor } from '../app/editor.ts';
import type { HatchEnt } from '../core/entities.ts';
import { aciToCss } from '../core/aci.ts';
import { PATTERN_NAMES, PATTERNS } from '../core/patterns.ts';
import { deg, rad, fmtNum } from '../core/geom.ts';
import { icon } from './icons.ts';
import { h, showMenu } from './dom.ts';
import { ctxPanel, ctxBig, ctxSmall, ctxCol, ctxField } from './ribbon.ts';
import { activeTextEditor } from './texteditor.ts';
import { patternSwatch } from './dialogs.ts';

export interface Context { key: string; name: string; build: (body: HTMLElement) => void }

const JUST = [
  ['Top Left', 1], ['Top Center', 2], ['Top Right', 3], ['Middle Left', 4], ['Middle Center', 5],
  ['Middle Right', 6], ['Bottom Left', 7], ['Bottom Center', 8], ['Bottom Right', 9],
] as const;

const SYMBOLS: [string, string][] = [
  ['Degree  °', '°'], ['Plus/Minus  ±', '±'], ['Diameter  Ø', 'Ø'], ['Almost Equal  ≈', '≈'], ['Not Equal  ≠', '≠'],
  ['Delta  Δ', 'Δ'], ['Ohm  Ω', 'Ω'], ['Square  ²', '²'], ['Cubed  ³', '³'], ['Center Line  ℄', '℄'],
  ['Angle  ∠', '∠'], ['Property Line  ⅊', '⅊'], ['Non-breaking Space', ' '],
];

export function textEditorContext(ed: Editor, pickColor: (c: number) => Promise<number | null>): Context {
  return {
    key: 'text', name: 'Text Editor',
    build: (body) => {
      const te = activeTextEditor();
      if (!te) return;
      const st = te.state();
      body.append(
        ctxPanel('Style', ctxCol(
          ctxField('Text height', fmtNum(te.h), (v) => { const n = parseFloat(v.replace(',', '.')); if (n > 0) te.setHeight(n); }),
          ctxField('Width', fmtNum(te.width), (v) => { const n = parseFloat(v.replace(',', '.')); if (n >= 0) te.setWidth(n); }),
          h('div', { class: 'ctx-note' }, 'Style: Standard'),
        )),
        ctxPanel('Formatting',
          ctxCol(
            h('div', { class: 'ctx-row' },
              ctxSmall('Bold (Ctrl+B)', 'bold', () => te.exec('bold'), false, st.bold),
              ctxSmall('Italic (Ctrl+I)', 'italic', () => te.exec('italic'), false, st.italic),
              ctxSmall('Underline (Ctrl+U)', 'underline', () => te.exec('underline'), false, st.underline),
            ),
            ctxSmall('Color', 'textColor', (el) => showMenu([
              { label: 'ByLayer (clear formatting)', action: () => te.color(null) },
              ...[1, 2, 3, 4, 5, 6, 7].map((c) => ({ html: `<span class="layer-row"><span class="swatch" style="background:${aciToCss(c)}"></span>Color ${c}</span>`, action: () => te.color(c) })),
              { sep: true, label: 'More Colors…', action: async () => { const c = await pickColor(1); if (c !== null && c > 0 && c < 256) te.color(c); } },
            ], el, 'prop-menu')),
          ),
        ),
        ctxPanel('Paragraph', ctxBig('Justification', 'justify', () => {
          const btn = body.querySelector('.ctx-just') as HTMLElement;
          showMenu(JUST.map(([label, n]) => ({ label, checked: te.attach === n, action: () => te.setAttach(n) })), btn);
        }, 'ctx-just')),
        ctxPanel('Insert', ctxBig('Symbol', 'symbol', () => {
          const btn = body.querySelector('.ctx-sym') as HTMLElement;
          showMenu(SYMBOLS.map(([label, ch]) => ({ label, action: () => te.insert(ch) })), btn);
        }, 'ctx-sym')),
        ctxPanel('Close', ctxBig('Close Text Editor', 'closeCheck', () => te.close(true)), ctxBig('Cancel', 'closeRed', () => te.close(false))),
      );
      void ed;
    },
  };
}

function patternGallery(current: string, onPick: (name: string) => void): HTMLElement {
  const g = h('div', { class: 'ctx-gallery' });
  for (const name of PATTERN_NAMES) {
    const cell = h('div', { class: 'ctx-pat' + (name === current ? ' active' : ''), title: name === 'SOLID' ? 'Solid fill' : `${name}: ${PATTERNS[name].desc}` });
    cell.append(patternSwatch(name), h('span', {}, name));
    cell.addEventListener('mousedown', (e) => e.preventDefault());
    cell.addEventListener('click', () => onPick(name));
    g.append(cell);
  }
  return g;
}

/** Hatch Creation (while HATCH runs) edits the defaults; Hatch Editor edits the selected hatches. */
export function hatchContext(ed: Editor, mode: 'create' | 'edit', refresh: () => void): Context {
  return {
    key: 'hatch-' + mode, name: mode === 'create' ? 'Hatch Creation' : 'Hatch Editor',
    build: (body) => {
      const hd = ed.doc.header;
      const sel = mode === 'edit' ? [...ed.selection].map((id) => ed.doc.get(id)).filter((e): e is HatchEnt => e?.type === 'hatch') : [];
      const cur = mode === 'create' ? { pattern: hd.hatchPattern, scale: hd.hatchScale, angle: hd.hatchAngle } : sel[0] ? { pattern: sel[0].solid ? 'SOLID' : sel[0].pattern.toUpperCase(), scale: sel[0].scale, angle: sel[0].angle } : null;
      if (!cur) return;
      const apply = (p: Partial<{ pattern: string; scale: number; angle: number }>) => {
        if (mode === 'create') {
          if (p.pattern) hd.hatchPattern = p.pattern;
          if (p.scale) hd.hatchScale = p.scale;
          if (p.angle !== undefined) hd.hatchAngle = p.angle;
        } else {
          ed.doc.begin('HATCHEDIT');
          for (const e of sel) {
            const pattern = p.pattern ?? (e.solid ? 'SOLID' : e.pattern);
            ed.doc.update({ ...e, pattern, solid: pattern === 'SOLID', scale: p.scale ?? e.scale, angle: p.angle ?? e.angle, patLines: undefined });
          }
          ed.doc.commit();
        }
        refresh();
      };
      if (mode === 'create') {
        body.append(ctxPanel('Boundaries',
          ctxBig('Pick Points', 'pickPoints', () => ed.print('Pick internal points in closed areas.')),
          ctxCol(ctxSmall('Select', 'selectObjects', () => ed.submit('S'))),
        ));
      }
      body.append(
        ctxPanel('Pattern', patternGallery(cur.pattern, (name) => apply({ pattern: name }))),
        ctxPanel('Properties', ctxCol(
          ctxField('Scale', fmtNum(cur.scale), (v) => { const n = parseFloat(v.replace(',', '.')); if (n > 0) apply({ scale: n }); }),
          ctxField('Angle', fmtNum(deg(cur.angle)), (v) => { const n = parseFloat(v.replace(',', '.')); if (Number.isFinite(n)) apply({ angle: rad(n) }); }),
          h('div', { class: 'ctx-note' }, mode === 'create' ? 'Applies to new hatches' : `${sel.length} hatch object(s)`),
        )),
        ctxPanel('Close', ctxBig(mode === 'create' ? 'Close Hatch Creation' : 'Close Hatch Editor', 'closeCheck', () => {
          if (mode === 'create') ed.submit(''); else ed.clearSelection();
        })),
      );
    },
  };
}

export function blockEditorContext(ed: Editor): Context {
  return {
    key: 'block', name: 'Block Editor',
    build: (body) => {
      const name = ed.blockEdit?.name ?? '';
      body.append(
        ctxPanel('Open/Save',
          ctxBig('Save Block', 'save', () => void ed.runCommand('BSAVE')),
          ctxCol(
            ctxSmall('Edit Block…', 'blockEdit', () => ed.print('Close this block first, then use BEDIT.')),
            h('div', { class: 'ctx-note' }, `Block: ${name}`),
          ),
        ),
        ctxPanel('Geometry',
          ctxBig('Base Point', 'basePoint', () => void ed.runCommand('BASE')),
          ctxCol(
            ctxSmall('Line', 'line', () => void ed.runCommand('LINE')),
            ctxSmall('Circle', 'circle', () => void ed.runCommand('CIRCLE')),
            ctxSmall('Polyline', 'pline', () => void ed.runCommand('PLINE')),
          ),
          ctxCol(
            ctxSmall('Move', 'move', () => void ed.runCommand('MOVE')),
            ctxSmall('Erase', 'erase', () => void ed.runCommand('ERASE')),
            ctxSmall('Text', 'mtext', () => void ed.runCommand('MTEXT')),
          ),
        ),
        ctxPanel('Close', ctxBig('Close Block Editor', 'closeRed', () => void ed.runCommand('BCLOSE'))),
      );
    },
  };
}

export { icon };

/** "Layout" tab shown while a layout tab is active. */
export function layoutContext(ed: Editor, onPageSetup: () => void): Context {
  const run = (m: string) => () => void ed.runMacro(m);
  return {
    key: 'layout', name: 'Layout',
    build: (body) => {
      const l = ed.doc.layout;
      body.append(
        ctxPanel('Layout',
          ctxBig('New', 'layoutNew', run('LAYOUT;New')),
          ctxBig('Page Setup', 'pageSetup', onPageSetup),
          ctxCol(h('div', { class: 'ctx-note' }, l ? `${l.name}` : ''), h('div', { class: 'ctx-note' }, l ? l.paper.name : '')),
        ),
        ctxPanel('Layout Viewports',
          ctxBig('Rectangular', 'viewport', run('MVIEW')),
          ctxCol(
            ctxSmall('Fit to printable area', 'viewport', run('MVIEW;Fit')),
            ctxSmall('Two viewports', 'viewport2', run('MVIEW;2')),
            ctxSmall('Four viewports', 'viewport4', run('MVIEW;4')),
          ),
          ctxCol(
            ctxSmall('Lock', 'lockClosed', run('MVIEW;Lock;ON')),
            ctxSmall('Unlock', 'lockOpen', run('MVIEW;Lock;OFF')),
            ctxSmall('Turn off', 'bulbOff', run('MVIEW;OFF')),
          ),
        ),
        ctxPanel('Space',
          ctxBig(ed.activeVp === null ? 'Model Space' : 'Paper Space', ed.activeVp === null ? 'mspace' : 'pspace', run(ed.activeVp === null ? 'MSPACE' : 'PSPACE')),
        ),
        ctxPanel('Output', ctxBig('Plot', 'printer', run('PLOT'))),
      );
    },
  };
}

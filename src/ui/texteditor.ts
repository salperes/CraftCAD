// In-place rich MTEXT editor (contenteditable). The ribbon's contextual "Text Editor"
// tab drives it through the ActiveTextEditor interface.

import type { Editor } from '../app/editor.ts';
import { aciToCss } from '../core/aci.ts';
import { TEXT_FONT } from '../core/entities.ts';
import { mtextToHtml, htmlToMtext } from '../core/mtext.ts';
import { h } from './dom.ts';

export interface ActiveTextEditor {
  h: number;
  attach: number;
  width: number;
  setHeight(v: number): void;
  setAttach(n: number): void;
  setWidth(v: number): void;
  exec(cmd: 'bold' | 'italic' | 'underline'): void;
  color(aci: number | null): void;
  insert(text: string): void;
  close(save: boolean): void;
  state(): { bold: boolean; italic: boolean; underline: boolean };
}

let active: ActiveTextEditor | null = null;
export const activeTextEditor = (): ActiveTextEditor | null => active;

export interface MTextEditResult { text: string; h: number; attach: number; width: number }

export function editMText(
  ed: Editor, host: HTMLElement,
  o: { text: string; h: number; attach: number; width: number; rot: number; at: { x: number; y: number } },
  onChange: () => void,
): Promise<MTextEditResult | null> {
  return new Promise((resolve) => {
    let hgt = o.h, attach = o.attach || 1, width = o.width;
    const box = h('div', { class: 'mtext-editor' });
    const ruler = h('div', { class: 'mte-ruler' });
    const area = h('div', { class: 'mte-area', contenteditable: 'true', spellcheck: 'false' });
    area.innerHTML = o.text ? mtextToHtml(o.text, (i) => aciToCss(i, true)) : '<div><br></div>';
    box.append(ruler, area);
    host.append(box);

    const layout = () => {
      const s = ed.view.toScreen(o.at);
      const px = Math.max(14, Math.min(64, (hgt * ed.view.scale) / 0.7));
      area.style.font = `${px}px ${TEXT_FONT}`;
      const wpx = width > 0 ? Math.max(120, width * ed.view.scale) : 0;
      area.style.width = wpx ? wpx + 'px' : '';
      area.style.minWidth = wpx ? '' : '160px';
      area.style.textAlign = ['left', 'center', 'right'][(attach - 1) % 3];
      box.style.left = s.x + 'px';
      box.style.top = Math.max(0, s.y - 14) + 'px';
      ruler.style.width = (wpx || area.getBoundingClientRect().width) + 'px';
    };
    layout();
    area.focus();
    const sel = window.getSelection();
    if (sel) { const r = document.createRange(); r.selectNodeContents(area); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); }

    // Keep the caret/selection when ribbon controls take focus.
    let saved: Range | null = null;
    const remember = () => {
      const s = window.getSelection();
      if (s && s.rangeCount && area.contains(s.anchorNode)) saved = s.getRangeAt(0).cloneRange();
    };
    const restore = () => {
      area.focus();
      if (saved) { const s = window.getSelection()!; s.removeAllRanges(); s.addRange(saved); }
    };
    document.addEventListener('selectionchange', remember);

    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      document.removeEventListener('selectionchange', remember);
      window.removeEventListener('mousedown', outside, true);
      const text = htmlToMtext(area);
      box.remove();
      active = null;
      onChange();
      resolve(save ? { text, h: hgt, attach, width } : null);
    };

    active = {
      get h() { return hgt; },
      get attach() { return attach; },
      get width() { return width; },
      setHeight: (v) => { if (v > 0) { hgt = v; layout(); } },
      setAttach: (n) => { attach = n; layout(); restore(); },
      setWidth: (v) => { width = Math.max(0, v); layout(); },
      exec: (cmd) => { restore(); document.execCommand(cmd); remember(); onChange(); },
      color: (aci) => {
        restore();
        if (aci === null) document.execCommand('removeFormat');
        else {
          document.execCommand('styleWithCSS', false, 'false');
          document.execCommand('foreColor', false, aciToCss(aci, true));
          for (const f of area.querySelectorAll('font[color]:not([data-aci])')) f.setAttribute('data-aci', String(aci));
        }
        remember();
      },
      insert: (t) => { restore(); document.execCommand('insertText', false, t); remember(); },
      close: (save) => finish(save),
      state: () => ({ bold: document.queryCommandState('bold'), italic: document.queryCommandState('italic'), underline: document.queryCommandState('underline') }),
    };
    onChange();

    area.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      else if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); finish(true); }
      else if (e.ctrlKey && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        active?.exec(({ b: 'bold', i: 'italic', u: 'underline' } as const)[e.key.toLowerCase() as 'b' | 'i' | 'u']);
      }
    });
    area.addEventListener('keyup', onChange);
    area.addEventListener('mouseup', onChange);
    area.addEventListener('input', () => { if (!width) ruler.style.width = area.getBoundingClientRect().width + 'px'; });
    // Plain-text paste keeps the MTEXT conversion predictable.
    area.addEventListener('paste', (e) => {
      e.preventDefault();
      document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') ?? '');
    });
    const outside = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (box.contains(t) || t.closest('.ribbon, .menu, .modal-back, .tooltip')) return;
      if (t.tagName === 'CANVAS') { e.stopPropagation(); e.preventDefault(); }
      finish(true);
    };
    setTimeout(() => window.addEventListener('mousedown', outside, true), 0);
  });
}

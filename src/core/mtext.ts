// MTEXT inline formatting: parsing into styled runs, word-wrapped layout, and
// conversion between MTEXT codes and simple HTML for the rich text editor.

import { decodeSpecialChars } from './entities.ts';

export interface RunStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  overline: boolean;
  /** ACI color override, or undefined to use the entity color. */
  color?: number;
  /** Height relative to the entity height. */
  hf: number;
  font?: string;
}

export interface Run extends RunStyle { text: string }

export interface MLine { runs: Run[]; width: number; hf: number }

const BASE: RunStyle = { bold: false, italic: false, underline: false, overline: false, hf: 1 };

/** Parses MTEXT contents into paragraphs of styled runs. */
export function parseMText(raw: string): Run[][] {
  const paras: Run[][] = [[]];
  const stack: RunStyle[] = [];
  let st: RunStyle = { ...BASE };
  let buf = '';
  const flush = () => {
    if (buf) paras[paras.length - 1].push({ ...st, text: decodeSpecialChars(buf) });
    buf = '';
  };
  const readTo = (i: number): [string, number] => {
    const j = raw.indexOf(';', i);
    return j < 0 ? [raw.slice(i), raw.length] : [raw.slice(i, j), j + 1];
  };
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '{') { flush(); stack.push({ ...st }); i++; continue; }
    if (ch === '}') { flush(); st = stack.pop() ?? { ...BASE }; i++; continue; }
    if (ch !== '\\') { buf += ch; i++; continue; }
    const c = raw[i + 1];
    if (c === undefined) { i++; continue; }
    switch (c) {
      case 'P': flush(); paras.push([]); i += 2; break;
      case '~': buf += '\u00a0'; i += 2; break;
      case '\\': case '{': case '}': buf += c; i += 2; break;
      case 'L': flush(); st = { ...st, underline: true }; i += 2; break;
      case 'l': flush(); st = { ...st, underline: false }; i += 2; break;
      case 'O': flush(); st = { ...st, overline: true }; i += 2; break;
      case 'o': flush(); st = { ...st, overline: false }; i += 2; break;
      case 'K': case 'k': case 'N': case 'n': i += 2; break;
      case 'U': {
        const m = /^\\U\+([0-9A-Fa-f]{4})/.exec(raw.slice(i));
        if (m) { buf += String.fromCharCode(parseInt(m[1], 16)); i += m[0].length; } else { buf += 'U'; i += 2; }
        break;
      }
      case 'f': case 'F': {
        flush();
        const [arg, next] = readTo(i + 2);
        const parts = arg.split('|');
        const ns = { ...st, font: parts[0] || st.font };
        for (const p of parts.slice(1)) {
          if (p === 'b1') ns.bold = true; else if (p === 'b0') ns.bold = false;
          else if (p === 'i1') ns.italic = true; else if (p === 'i0') ns.italic = false;
        }
        st = ns;
        i = next;
        break;
      }
      case 'H': {
        flush();
        const [arg, next] = readTo(i + 2);
        const v = parseFloat(arg);
        // \H1.5x is relative; plain \H2.5 is absolute (normalized later by the entity height).
        if (Number.isFinite(v) && v > 0) st = { ...st, hf: arg.trim().endsWith('x') ? st.hf * v : -v };
        i = next;
        break;
      }
      case 'C': {
        flush();
        const [arg, next] = readTo(i + 2);
        const v = parseInt(arg, 10);
        st = { ...st, color: Number.isFinite(v) && v > 0 && v < 256 ? v : undefined };
        i = next;
        break;
      }
      case 'S': {
        flush();
        const [arg, next] = readTo(i + 2);
        buf += arg.replace(/[\^#]/, '/');
        i = next;
        break;
      }
      case 'A': case 'c': case 'Q': case 'T': case 'W': case 'p': {
        const [, next] = readTo(i + 2);
        i = next;
        break;
      }
      default: buf += c; i += 2;
    }
  }
  flush();
  return paras;
}

/** Resolves absolute \H heights (stored as negative hf) against the entity height. */
function normalize(paras: Run[][], h: number): Run[][] {
  return paras.map((p) => p.map((r) => (r.hf < 0 ? { ...r, hf: -r.hf / (h || 1) } : r)));
}

export type Measure = (text: string, style: RunStyle) => number;

/** Word-wraps paragraphs to maxWidth (in units of entity height; 0 = no wrapping). */
export function layoutMText(raw: string, h: number, maxWidth: number, measure: Measure): MLine[] {
  const paras = normalize(parseMText(raw), h);
  const out: MLine[] = [];
  for (const para of paras) {
    let line: Run[] = [];
    let width = 0;
    const push = () => {
      const hf = line.length ? Math.max(...line.map((r) => r.hf)) : 1;
      out.push({ runs: line, width, hf });
      line = [];
      width = 0;
    };
    if (!para.length) { push(); continue; }
    for (const run of para) {
      if (!(maxWidth > 0)) {
        line.push(run);
        width += measure(run.text, run) * run.hf;
        continue;
      }
      // Split into words keeping the spaces attached to the preceding word.
      const words = run.text.match(/\S+\s*|\s+/g) ?? [];
      for (const w of words) {
        const ww = measure(w, run) * run.hf;
        const trimmed = measure(w.trimEnd(), run) * run.hf;
        if (line.length && width + trimmed > maxWidth) push();
        const last = line[line.length - 1];
        if (last && sameStyle(last, run)) last.text += w;
        else line.push({ ...run, text: w });
        width += ww;
      }
    }
    push();
  }
  return out;
}

function sameStyle(a: RunStyle, b: RunStyle): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.overline === b.overline && a.color === b.color && a.hf === b.hf && a.font === b.font;
}

/** Plain text of MTEXT contents (paragraphs joined with \n). */
export function mtextPlain(raw: string): string {
  return parseMText(raw).map((p) => p.map((r) => r.text).join('')).join('\n');
}

// ---------------------------------------------------------------------------
// HTML <-> MTEXT for the rich editor

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function mtextToHtml(raw: string, aciCss: (i: number) => string): string {
  return parseMText(raw).map((p) => {
    const inner = p.map((r) => {
      let t = esc(r.text).replace(/\u00a0/g, '&nbsp;');
      const style: string[] = [];
      if (r.color !== undefined) style.push(`color:${aciCss(r.color)}`);
      if (r.hf > 0 && Math.abs(r.hf - 1) > 1e-6) style.push(`font-size:${(r.hf * 100).toFixed(0)}%`);
      if (r.font) style.push(`font-family:${r.font}`);
      if (style.length) t = `<span data-aci="${r.color ?? ''}" data-hf="${r.hf}" style="${style.join(';')}">${t}</span>`;
      if (r.underline) t = `<u>${t}</u>`;
      if (r.italic) t = `<i>${t}</i>`;
      if (r.bold) t = `<b>${t}</b>`;
      return t;
    }).join('');
    return `<div>${inner || '<br>'}</div>`;
  }).join('');
}

/** Converts the editor DOM back into MTEXT codes. */
export function htmlToMtext(root: HTMLElement): string {
  const paras: string[] = [];
  let cur = '';
  const enc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\u00a0/g, '\\~');
  const walk = (n: Node, st: RunStyle) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n.textContent ?? '';
      if (!t) return;
      const codes: string[] = [];
      if (st.bold || st.italic) codes.push(`\\f${st.font ?? 'Arial'}|b${st.bold ? 1 : 0}|i${st.italic ? 1 : 0};`);
      if (st.color !== undefined) codes.push(`\\C${st.color};`);
      if (Math.abs(st.hf - 1) > 1e-6) codes.push(`\\H${+st.hf.toFixed(4)}x;`);
      if (st.underline) codes.push('\\L');
      cur += codes.length ? `{${codes.join('')}${enc(t)}}` : enc(t);
      return;
    }
    if (!(n instanceof HTMLElement)) return;
    const tag = n.tagName;
    if (tag === 'BR') { paras.push(cur); cur = ''; return; }
    const ns: RunStyle = { ...st };
    if (tag === 'B' || tag === 'STRONG' || n.style.fontWeight === 'bold' || +n.style.fontWeight >= 600) ns.bold = true;
    if (tag === 'I' || tag === 'EM' || n.style.fontStyle === 'italic') ns.italic = true;
    if (tag === 'U' || n.style.textDecoration.includes('underline')) ns.underline = true;
    if (n.dataset.aci) ns.color = +n.dataset.aci || undefined;
    else if (n.tagName === 'FONT' && n.getAttribute('data-aci')) ns.color = +n.getAttribute('data-aci')!;
    if (n.dataset.hf) ns.hf = +n.dataset.hf || 1;
    const block = tag === 'DIV' || tag === 'P';
    if (block && (cur || paras.length)) { paras.push(cur); cur = ''; }
    for (const c of n.childNodes) walk(c, ns);
  };
  for (const c of root.childNodes) walk(c, { ...BASE });
  paras.push(cur);
  // contenteditable leaves a trailing empty paragraph after a final <br>
  while (paras.length > 1 && paras[paras.length - 1] === '' && paras[paras.length - 2] === '') paras.pop();
  return paras.join('\\P').replace(/^\\P/, '');
}

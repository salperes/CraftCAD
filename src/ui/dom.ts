// Small DOM helpers and floating menus shared by the UI modules.

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, string | number | boolean | undefined> = {}, ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined) el.append(c);
  return el;
}

export function htmlEl(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

export interface MenuEntry {
  label?: string;
  icon?: string;
  html?: string;
  action?: () => void;
  sep?: boolean;
  checked?: boolean;
  disabled?: boolean;
}

let openMenu: HTMLElement | null = null;

export function closeMenu(): void {
  openMenu?.remove();
  openMenu = null;
}

/** Shows a floating menu at screen coordinates (or under an anchor element). */
export function showMenu(entries: MenuEntry[], at: { x: number; y: number } | HTMLElement, cls = ''): HTMLElement {
  closeMenu();
  const m = h('div', { class: `menu ${cls}` });
  for (const e of entries) {
    if (e.sep) { m.append(h('div', { class: 'menu-sep' })); if (!e.label) continue; }
    const it = h('div', { class: `menu-item${e.disabled ? ' disabled' : ''}${e.checked ? ' checked' : ''}` });
    if (e.html) it.innerHTML = e.html;
    else {
      it.append(h('span', { class: 'menu-ico', html: e.icon ?? '' }));
      it.append(h('span', { class: 'menu-label' }, e.label ?? ''));
    }
    if (!e.disabled && e.action) {
      it.addEventListener('mousedown', (ev) => ev.stopPropagation());
      it.addEventListener('click', (ev) => { ev.stopPropagation(); closeMenu(); e.action!(); });
    }
    m.append(it);
  }
  document.body.append(m);
  let x: number, y: number;
  if (at instanceof HTMLElement) {
    const r = at.getBoundingClientRect();
    x = r.left; y = r.bottom + 1;
  } else { x = at.x; y = at.y; }
  const mr = m.getBoundingClientRect();
  if (x + mr.width > window.innerWidth - 4) x = Math.max(4, window.innerWidth - mr.width - 4);
  if (y + mr.height > window.innerHeight - 4) y = Math.max(4, (at instanceof HTMLElement ? at.getBoundingClientRect().top - mr.height - 1 : y - mr.height));
  m.style.left = x + 'px';
  m.style.top = y + 'px';
  openMenu = m;
  return m;
}

window.addEventListener('mousedown', (ev) => {
  if (openMenu && !openMenu.contains(ev.target as Node)) closeMenu();
});
window.addEventListener('blur', closeMenu);

export function tooltip(el: HTMLElement, title: string, body = '', cmd = ''): void {
  let tip: HTMLElement | null = null;
  let timer = 0;
  el.addEventListener('mouseenter', () => {
    timer = window.setTimeout(() => {
      tip = h('div', { class: 'tooltip' }, h('div', { class: 'tt-title' }, title));
      if (body) tip.append(h('div', { class: 'tt-body' }, body));
      if (cmd) tip.append(h('div', { class: 'tt-cmd' }, h('span', {}, '▸ '), cmd));
      document.body.append(tip);
      const r = el.getBoundingClientRect();
      const tr = tip.getBoundingClientRect();
      tip.style.left = Math.min(window.innerWidth - tr.width - 6, r.left) + 'px';
      tip.style.top = r.bottom + 6 + 'px';
    }, 550);
  });
  const hide = () => { clearTimeout(timer); tip?.remove(); tip = null; };
  el.addEventListener('mouseleave', hide);
  el.addEventListener('mousedown', hide);
}

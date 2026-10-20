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
  /** Cascading submenu shown on hover. */
  submenu?: MenuEntry[];
}

let openMenus: HTMLElement[] = [];

export function closeMenu(): void {
  for (const m of openMenus) m.remove();
  openMenus = [];
}

function buildMenu(entries: MenuEntry[], cls: string, level: number): HTMLElement {
  const m = h('div', { class: `menu ${cls}` });
  let child: HTMLElement | null = null;
  const closeChild = () => {
    if (!child) return;
    const i = openMenus.indexOf(child);
    for (const x of openMenus.splice(i)) x.remove();
    child = null;
  };
  for (const e of entries) {
    if (e.sep) { m.append(h('div', { class: 'menu-sep' })); if (!e.label) continue; }
    const it = h('div', { class: `menu-item${e.disabled ? ' disabled' : ''}${e.checked ? ' checked' : ''}${e.submenu ? ' has-sub' : ''}` });
    if (e.html) it.innerHTML = e.html;
    else {
      it.append(h('span', { class: 'menu-ico', html: e.icon ?? '' }));
      it.append(h('span', { class: 'menu-label' }, e.label ?? ''));
      if (e.submenu) it.append(h('span', { class: 'menu-arrow', html: '&#9656;' }));
    }
    it.addEventListener('mousedown', (ev) => { ev.stopPropagation(); ev.preventDefault(); });
    it.addEventListener('mouseenter', () => {
      closeChild();
      if (!e.submenu || e.disabled || !e.submenu.length) return;
      child = buildMenu(e.submenu, cls, level + 1);
      const r = it.getBoundingClientRect();
      place(child, r.right - 2, r.top - 4, r.left);
    });
    if (!e.disabled && e.action) it.addEventListener('click', (ev) => { ev.stopPropagation(); closeMenu(); e.action!(); });
    m.append(it);
  }
  document.body.append(m);
  openMenus.push(m);
  void level;
  return m;
}

function place(m: HTMLElement, x: number, y: number, flipX?: number): void {
  const mr = m.getBoundingClientRect();
  if (x + mr.width > window.innerWidth - 4) x = flipX !== undefined ? Math.max(4, flipX - mr.width + 2) : Math.max(4, window.innerWidth - mr.width - 4);
  if (y + mr.height > window.innerHeight - 4) y = Math.max(4, window.innerHeight - mr.height - 4);
  m.style.left = x + 'px';
  m.style.top = y + 'px';
}

/** Shows a floating menu at screen coordinates (or under an anchor element). */
export function showMenu(entries: MenuEntry[], at: { x: number; y: number } | HTMLElement, cls = ''): HTMLElement {
  closeMenu();
  const m = buildMenu(entries, cls, 0);
  if (at instanceof HTMLElement) {
    const r = at.getBoundingClientRect();
    const mr = m.getBoundingClientRect();
    const below = r.bottom + 1 + mr.height <= window.innerHeight - 4;
    place(m, r.left, below ? r.bottom + 1 : Math.max(4, r.top - mr.height - 1));
  } else place(m, at.x, at.y);
  return m;
}

window.addEventListener('mousedown', (ev) => {
  if (openMenus.length && !openMenus.some((m) => m.contains(ev.target as Node))) closeMenu();
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

// Utility, view, file, clipboard, block and inquiry commands.

import {
  type Vec,
  dist, angleBetween, fmtNum, deg, normAng, boxFromPts, polygonArea, mxTranslate, emptyBox, boxUnion, boxValid,
} from '../../core/geom.ts';
import { type Entity, type BlockDef, entDescribe, entTransform, polyArea, blockBox } from '../../core/entities.ts';
import { type Editor, stripId } from '../editor.ts';

const isPt = (x: unknown): x is Vec => typeof x === 'object' && x !== null && 'x' in x;

export async function UNDO(ed: Editor): Promise<void> {
  const name = ed.doc.undo();
  ed.print(name ? `${name}` : 'Everything has been undone');
  ed.clearSelection();
}

export async function REDO(ed: Editor): Promise<void> {
  const name = ed.doc.redo();
  ed.print(name ? `${name}` : 'Nothing to redo');
}

export async function ZOOM(ed: Editor): Promise<void> {
  const r = await ed.getPoint('Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:', {
    keywords: ['All', 'Center', 'Dynamic', 'Extents', 'Previous', 'Scale', 'Window', 'Object'], allowNone: true,
  });
  const v = ed.view;
  if (r.kind === 'keyword') {
    switch (r.kw) {
      case 'All': case 'Extents': await ed.zoomExtents(); return;
      case 'Previous': if (!v.previous()) ed.print('No previous view saved.'); ed.redraw(); return;
      case 'Object': {
        const ids = await ed.getSelection('Select objects');
        let b = emptyBox();
        for (const id of ids) { const e = ed.doc.get(id); if (e) b = boxUnion(b, ed.doc.box(e)); }
        if (boxValid(b)) { v.pushHistory(); v.fit(b); ed.redraw(); }
        return;
      }
      case 'Center': {
        const c = await ed.point('Specify center point:');
        if (!isPt(c)) return;
        v.pushHistory();
        v.cx = c.x; v.cy = c.y; ed.redraw();
        return;
      }
      case 'Scale': {
        const t = await ed.getText('Enter a scale factor (nX or nXP):');
        const n = parseFloat(t);
        if (n > 0) { v.pushHistory(); v.scale *= n; ed.redraw(); }
        return;
      }
      default: {
        const a = await ed.point('Specify first corner:');
        if (!isPt(a)) return;
        const b = await ed.point('Specify opposite corner:', { preview: (q) => [rectOf(a, q)] });
        if (!isPt(b)) return;
        v.pushHistory(); v.fit(boxFromPts(a, b), 0); ed.redraw();
        return;
      }
    }
  }
  if (r.kind === 'point') {
    const a = r.p;
    const b = await ed.point('Specify opposite corner:', { preview: (q) => [rectOf(a, q)] });
    if (!isPt(b)) return;
    v.pushHistory(); v.fit(boxFromPts(a, b), 0); ed.redraw();
  }
}

function rectOf(a: Vec, b: Vec) {
  return { type: 'polyline' as const, pts: [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }], bulges: [0, 0, 0, 0], closed: true };
}

export async function PAN(ed: Editor): Promise<void> {
  ed.panTool = true;
  ed.print('Press ESC or ENTER to exit, or right-click to display shortcut menu.');
  await ed.getText('Drag to pan:');
}

export async function REGEN(ed: Editor): Promise<void> {
  ed.doc.invalidateBoxes();
  ed.redraw();
  ed.print('Regenerating model.');
}

export async function LAYER(ed: Editor): Promise<void> { ed.ui.layerManager(); }
export async function PROPERTIES(ed: Editor): Promise<void> { ed.ui.properties(); }

export async function DIST(ed: Editor): Promise<void> {
  const a = await ed.point('Specify first point:');
  if (!isPt(a)) return;
  const b = await ed.point('Specify second point or [Multiple points]:', { base: a, rubber: true });
  if (!isPt(b)) return;
  ed.print(`Distance = ${fmtNum(dist(a, b))},  Angle in XY Plane = ${fmtNum(deg(normAng(angleBetween(a, b))))}`, 'list');
  ed.print(`Delta X = ${fmtNum(b.x - a.x)},  Delta Y = ${fmtNum(b.y - a.y)}`, 'list');
}

export async function ID(ed: Editor): Promise<void> {
  const p = await ed.point('Specify point:');
  if (isPt(p)) ed.print(`X = ${fmtNum(p.x)}     Y = ${fmtNum(p.y)}     Z = 0.0000`, 'list');
}

export async function LIST(ed: Editor): Promise<void> {
  const ids = await ed.getSelection();
  for (const id of ids.slice(0, 50)) {
    const e = ed.doc.get(id);
    if (!e) continue;
    for (const line of entDescribe(e, ed.doc)) ed.print('  ' + line, 'list');
  }
  if (ids.length > 50) ed.print(`... ${ids.length - 50} more`, 'list');
}

export async function AREA(ed: Editor): Promise<void> {
  const r = await ed.getPoint('Specify first corner point or [Object/Add area/Subtract area] <Object>:', { keywords: ['Object', 'Add area', 'Subtract area'], allowNone: true });
  if (r.kind === 'none' || (r.kind === 'keyword' && r.kw === 'Object')) {
    const s = await ed.getEntity('Select objects:', { filter: (e) => e.type === 'circle' || e.type === 'polyline' || e.type === 'ellipse' });
    if (s.kind !== 'entity') return;
    const e = ed.doc.get(s.id)!;
    if (e.type === 'circle') ed.print(`Area = ${fmtNum(Math.PI * e.r * e.r)}, Circumference = ${fmtNum(2 * Math.PI * e.r)}`, 'list');
    else if (e.type === 'polyline') ed.print(`Area = ${fmtNum(Math.abs(polyArea(e)))}${e.closed ? '' : ' (open polyline closed for calculation)'}`, 'list');
    else if (e.type === 'ellipse') { const a = Math.hypot(e.major.x, e.major.y); ed.print(`Area = ${fmtNum(Math.PI * a * a * e.ratio)}`, 'list'); }
    return;
  }
  if (r.kind !== 'point') return;
  const pts: Vec[] = [r.p];
  for (;;) {
    const p = await ed.point('Specify next point or [Undo] <Total>:', {
      base: pts[pts.length - 1], allowNone: true, keywords: ['Undo'],
      preview: (q) => [{ type: 'polyline', pts: [...pts, q], bulges: [...pts, q].map(() => 0), closed: true }],
    });
    if (p === 'Undo') { if (pts.length > 1) pts.pop(); continue; }
    if (!isPt(p)) break;
    pts.push(p);
  }
  let per = 0;
  for (let i = 0; i < pts.length; i++) per += dist(pts[i], pts[(i + 1) % pts.length]);
  ed.print(`Area = ${fmtNum(Math.abs(polygonArea(pts)))}, Perimeter = ${fmtNum(per)}`, 'list');
}

export async function NEW(ed: Editor): Promise<void> { await ed.ui.newDrawing(); }
export async function OPEN(ed: Editor): Promise<void> { await ed.ui.openFile(); }
export async function QSAVE(ed: Editor): Promise<void> { await ed.ui.saveFile(false); }
export async function SAVEAS(ed: Editor): Promise<void> { await ed.ui.saveFile(true); }

// ---------------------------------------------------------------------------
// Clipboard

function selectionBase(ed: Editor, ids: number[]): Vec {
  let b = emptyBox();
  for (const id of ids) { const e = ed.doc.get(id); if (e) b = boxUnion(b, ed.doc.box(e)); }
  return boxValid(b) ? { x: b.minX, y: b.minY } : { x: 0, y: 0 };
}

export async function COPYCLIP(ed: Editor): Promise<void> {
  const ids = await ed.getSelection();
  if (!ids.length) return;
  ed.clipboard = { ents: ids.map((id) => stripId(ed.doc.get(id)!)), base: selectionBase(ed, ids) };
  ed.print(`${ids.length} object(s) copied to the clipboard.`);
}

export async function CUTCLIP(ed: Editor): Promise<void> {
  const ids = await ed.getSelection();
  if (!ids.length) return;
  ed.clipboard = { ents: ids.map((id) => stripId(ed.doc.get(id)!)), base: selectionBase(ed, ids) };
  for (const id of ids) ed.doc.remove(id);
}

export async function COPYBASE(ed: Editor): Promise<void> {
  const base = await ed.point('Specify base point:');
  if (!isPt(base)) return;
  const ids = await ed.getSelection();
  if (!ids.length) return;
  ed.clipboard = { ents: ids.map((id) => stripId(ed.doc.get(id)!)), base };
}

export async function PASTECLIP(ed: Editor): Promise<void> {
  const cb = ed.clipboard;
  if (!cb) { ed.print('Clipboard is empty.'); return; }
  const mk = (p: Vec) => cb.ents.map((e) => stripId(entTransform({ ...e, id: -1 } as Entity, mxTranslate(p.x - cb.base.x, p.y - cb.base.y))));
  const p = await ed.point('Specify insertion point:', { preview: (q) => mk(q) });
  if (!isPt(p)) return;
  const ids = mk(p).map((ne) => ed.doc.add(ne).id);
  ed.selectIds(ids);
}

export async function SELECTALL(ed: Editor): Promise<void> {
  const ids = [...ed.doc.entities.values()].filter((e) => ed.doc.isVisible(e)).map((e) => e.id);
  ed.selectIds(ids);
  ed.print(`${ids.length} found`);
}

// ---------------------------------------------------------------------------
// Blocks

export async function BLOCK(ed: Editor): Promise<void> {
  let name = '';
  for (;;) {
    name = (await ed.getText('Enter block name or [?]:', { allowSpaces: true })).trim();
    if (!name) return;
    if (name === '?') { ed.print([...ed.doc.blocks.keys()].filter((n) => !n.startsWith('*')).join(', ') || 'No blocks defined.', 'list'); continue; }
    if (/[<>/\\":;?*|=`]/.test(name)) { ed.print('Invalid block name.', 'error'); continue; }
    if (ed.doc.blocks.has(name)) {
      const k = await ed.getKeyword(`Block "${name}" already exists. Redefine it? [Yes/No] <N>:`, ['Yes', 'No'], 'No');
      if (k !== 'Yes') continue;
    }
    break;
  }
  const base = await ed.point('Specify insertion base point:');
  if (!isPt(base)) return;
  const ids = await ed.getSelection('Select objects', { noPickfirst: false });
  if (!ids.length) { ed.print('No objects selected; block not created.'); return; }
  const ents: Entity[] = [];
  for (const id of ids) {
    const e = ed.doc.get(id);
    if (!e) continue;
    ents.push({ ...e, id: ed.doc.allocId() } as Entity);
    ed.doc.remove(id);
  }
  ed.doc.touchBlocks();
  const def: BlockDef = { name, base, entities: ents };
  ed.doc.blocks.set(name, def);
  blockBox(def, ed.doc);
  ed.doc.invalidateBoxes();
  ed.doc.add({ type: 'insert', name, p: base, sx: 1, sy: 1, rot: 0, attribs: [] });
  ed.print(`Block "${name}" created with ${ents.length} object(s).`);
}

export async function INSERT(ed: Editor): Promise<void> {
  const names = [...ed.doc.blocks.keys()].filter((n) => !n.startsWith('*')).sort();
  if (!names.length) { ed.print('This drawing has no blocks. Use BLOCK to create one.'); return; }
  const name = await ed.ui.chooseFromList('Insert block', names);
  if (!name) return;
  const blk = ed.doc.blocks.get(name)!;
  let sc = 1, rot = 0;
  for (;;) {
    const r = await ed.getPoint('Specify insertion point or [Basepoint/Scale/Rotate]:', {
      keywords: ['Basepoint', 'Scale', 'Rotate'],
      preview: (p) => [{ type: 'insert', name, p, sx: sc, sy: sc, rot, attribs: [] }],
    });
    if (r.kind === 'keyword') {
      if (r.kw === 'Scale') { const s = await ed.getNumber('Specify scale factor for XYZ axes <1>:', { def: 1 }); if (s) sc = s; }
      if (r.kw === 'Rotate') { const a = await ed.getAngle('Specify rotation angle <0>:', { def: 0 }); if (typeof a === 'number') rot = a; }
      continue;
    }
    if (r.kind !== 'point') return;
    ed.doc.add({ type: 'insert', name, p: r.p, sx: sc, sy: sc, rot, attribs: [] });
    void blk;
    return;
  }
}

export async function PURGE(ed: Editor): Promise<void> {
  const usedBlocks = new Set<string>();
  const usedLayers = new Set<string>(['0', ed.doc.currentLayer]);
  const scan = (e: Entity) => {
    usedLayers.add(e.layer);
    if (e.type === 'insert') usedBlocks.add(e.name);
    if (e.type === 'dimension' && e.block) usedBlocks.add(e.block);
  };
  for (const e of ed.doc.entities.values()) scan(e);
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of usedBlocks) {
      const b = ed.doc.blocks.get(n);
      if (!b) continue;
      for (const e of b.entities) {
        const before = usedBlocks.size;
        scan(e);
        if (usedBlocks.size !== before) changed = true;
      }
    }
  }
  ed.doc.touchBlocks();
  ed.doc.touchLayers();
  let nb = 0, nl = 0;
  for (const n of [...ed.doc.blocks.keys()]) if (!usedBlocks.has(n)) { ed.doc.blocks.delete(n); nb++; }
  for (const n of [...ed.doc.layers.keys()]) if (!usedLayers.has(n)) { ed.doc.layers.delete(n); nl++; }
  ed.doc.emit('all');
  ed.print(`${nb} block(s) and ${nl} layer(s) purged.`);
}

export async function LAYMCUR(ed: Editor): Promise<void> {
  const r = await ed.getEntity('Select object whose layer will become current:');
  if (r.kind !== 'entity') return;
  const e = ed.doc.get(r.id)!;
  ed.doc.touchLayers();
  ed.doc.currentLayer = e.layer;
  ed.doc.emit('layers');
  ed.print(`${e.layer} is now the current layer.`);
}

export async function LTSCALE(ed: Editor): Promise<void> {
  const v = await ed.getNumber(`Enter new linetype scale factor <${fmtNum(ed.doc.header.ltscale)}>:`, { def: ed.doc.header.ltscale });
  if (v > 0) { ed.doc.header.ltscale = v; ed.print('Regenerating model.'); ed.redraw(); }
}

export async function DIMSCALE(ed: Editor): Promise<void> {
  const v = await ed.getNumber(`Enter new value for DIMSCALE <${fmtNum(ed.doc.dimStyle.dimscale)}>:`, { def: ed.doc.dimStyle.dimscale });
  if (v > 0) { ed.doc.dimStyle.dimscale = v; ed.doc.invalidateBoxes(); ed.redraw(); }
}

export async function OSNAP(ed: Editor): Promise<void> {
  const all = ['END', 'MID', 'CEN', 'GCEN', 'NOD', 'QUA', 'INT', 'INS', 'PER', 'TAN', 'NEA'];
  const map: Record<string, Parameters<typeof ed.settings.osnapModes.add>[0]> = { END: 'end', MID: 'mid', CEN: 'cen', GCEN: 'gcen', NOD: 'node', QUA: 'qua', INT: 'int', INS: 'ins', PER: 'per', TAN: 'tan', NEA: 'nea' };
  const cur = all.filter((k) => ed.settings.osnapModes.has(map[k])).join(',');
  const t = (await ed.getText(`Enter list of object snap modes <${cur}>:`)).trim().toUpperCase();
  if (!t) return;
  if (t === 'NON' || t === 'NONE' || t === 'OFF') { ed.settings.osnapModes.clear(); ed.ui.onStatus(); return; }
  ed.settings.osnapModes.clear();
  for (const k of t.split(',')) { const m = map[k.trim().slice(0, 4)] ?? map[k.trim().slice(0, 3)]; if (m) ed.settings.osnapModes.add(m); }
  ed.settings.osnap = true;
  ed.ui.onStatus();
}

export async function ABOUT(ed: Editor): Promise<void> { ed.ui.about(); }

export async function HELP(ed: Editor): Promise<void> {
  const groups: Record<string, string[]> = {};
  for (const c of ed.commands.values()) {
    if (c.name === 'GRIP') continue;
    const a = c.aliases?.length ? ` (${c.aliases.join(', ')})` : '';
    (groups[c.desc.split(':')[0]] ??= []).push(`${c.name}${a}`);
  }
  ed.print('CraftCAD commands — type a name or alias and press Enter/Space:', 'list');
  for (const [g, list] of Object.entries(groups)) ed.print(`  ${g}: ${list.join(', ')}`, 'list');
  ed.print('  Keys: F3 Osnap, F7 Grid, F8 Ortho, F9 Snap, F10 Polar, F12 Dyn, Esc cancel, Space/Enter repeat, Ctrl+Z/Y undo/redo', 'list');
}

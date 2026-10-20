// DXF import/export entry points (DWG import lives in dwg.ts).

import { Drawing } from '../core/document.ts';
import type { Entity } from '../core/entities.ts';
import { readDxf, toBlockDefs, type DxfData } from './dxfReader.ts';
import { writeDxf } from './dxfWriter.ts';

export interface LoadResult {
  entities: number;
  blocks: number;
  layers: number;
  warnings: string[];
  version: string;
}

/** Replaces the drawing contents with parsed DXF data. */
export function loadDxfData(doc: Drawing, data: DxfData, fileName: string): LoadResult {
  doc.reset();
  doc.fileName = fileName;
  for (const lt of data.linetypes) {
    if (/^continuous$/i.test(lt.name) && lt.pattern.length === 0) continue;
    doc.linetypes.set(lt.name.toUpperCase(), lt);
  }
  for (const l of data.layers) doc.layers.set(l.name, { ...l });
  if (!doc.layers.has('0')) doc.addLayerQuiet('0');
  Object.assign(doc.header, data.header);
  doc.dimStyle = data.dimStyle;
  for (const b of toBlockDefs(data, () => doc.allocId())) doc.blocks.set(b.name, b);
  for (const ne of data.entities) {
    const e = doc.loadEntity(ne);
    fixTableInsert(doc, e);
  }
  if (data.currentLayer && doc.layers.has(data.currentLayer)) doc.currentLayer = data.currentLayer;
  doc.invalidateBoxes();
  doc.modified = false;
  doc.emit('all');
  return { entities: doc.entities.size, blocks: doc.blocks.size, layers: doc.layers.size, warnings: data.warnings, version: data.version };
}

/** ACAD_TABLE anonymous blocks hold world-space geometry; place the insert at the origin. */
function fixTableInsert(_doc: Drawing, e: Entity): void {
  if (e.type === 'insert' && (e as Entity & { tableBlock?: boolean }).tableBlock) {
    delete (e as Entity & { tableBlock?: boolean }).tableBlock;
  }
}

export function openDxf(doc: Drawing, bytes: Uint8Array, fileName: string): LoadResult {
  return loadDxfData(doc, readDxf(bytes), fileName);
}

export function saveDxfString(doc: Drawing): string {
  return writeDxf(doc);
}

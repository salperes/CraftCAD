// File import/export entry points: DXF directly, DWG via LibreDWG (WebAssembly).

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

// ---------------------------------------------------------------------------
// DWG via LibreDWG

type LibreDwgApi = { dwg_write_dxf(content: ArrayBuffer | Uint8Array): Uint8Array | null };
let libPromise: Promise<LibreDwgApi> | null = null;

function loadLibreDwg(): Promise<LibreDwgApi> {
  if (!libPromise) {
    // The wasm binary is resolved relative to the package's glue code; Vite bundles it as an asset.
    libPromise = import('@mlightcad/libredwg-web').then(async (m) => (await m.LibreDwg.create()) as unknown as LibreDwgApi);
    libPromise.catch(() => { libPromise = null; });
  }
  return libPromise;
}

export async function dwgToDxfBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const lib = await loadLibreDwg();
  const out = lib.dwg_write_dxf(bytes);
  if (!out || out.length === 0) throw new Error('LibreDWG could not convert this DWG file.');
  return out;
}

export async function openDwg(doc: Drawing, bytes: Uint8Array, fileName: string): Promise<LoadResult> {
  const dxf = await dwgToDxfBytes(bytes);
  const r = loadDxfData(doc, readDxf(dxf), fileName);
  return r;
}

export async function openFile(doc: Drawing, file: File): Promise<LoadResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = file.name;
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 6));
  if (/^AC10\d\d/.test(head) || /\.dwg$/i.test(name)) return openDwg(doc, bytes, name);
  return openDxf(doc, bytes, name);
}

export function saveDxfString(doc: Drawing): string {
  return writeDxf(doc);
}

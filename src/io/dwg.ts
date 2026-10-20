// DWG import through LibreDWG (WebAssembly): DWG -> DXF bytes -> our DXF reader.

import wasmUrl from 'libredwg-web-wasm?url';
import type { Drawing } from '../core/document.ts';
import { readDxf } from './dxfReader.ts';
import { loadDxfData, openDxf, type LoadResult } from './files.ts';
import { converterStatus, serverConvert } from './convert.ts';

type LibreDwgApi = { dwg_write_dxf(content: ArrayBuffer | Uint8Array): Uint8Array | null };
let libPromise: Promise<LibreDwgApi> | null = null;

/** Loads LibreDWG once; the wasm URL comes from Vite so it resolves in dev and in builds. */
function loadLibreDwg(): Promise<LibreDwgApi> {
  if (!libPromise) {
    libPromise = (async () => {
      // The converter is downloaded on first use; a stopped dev server shows up here.
      try {
        const m = await import('@mlightcad/libredwg-web');
        const inst = await m.createModule({ locateFile: (f: string) => (f.endsWith('.wasm') ? wasmUrl : f) });
        return m.LibreDwg.createByWasmInstance(inst) as unknown as LibreDwgApi;
      } catch (err) {
        throw new Error(`the DWG converter (LibreDWG) could not be downloaded from the server. Is CraftCAD still running (npm run dev)? Reload the page and try again. [${(err as Error).message ?? err}]`);
      }
    })();
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
  return loadDxfData(doc, readDxf(dxf), fileName);
}

export interface OpenResult extends LoadResult { via: string }

/** DWG: the local converter (ODA / AutoCAD) when available, otherwise LibreDWG in the browser. */
export async function openFile(doc: Drawing, file: File, onStatus?: (s: string) => void): Promise<OpenResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 6));
  if (!(/^AC10\d\d/.test(head) || /\.dwg$/i.test(file.name))) return { ...openDxf(doc, bytes, file.name), via: 'DXF' };
  const st = await converterStatus();
  if (st.available) {
    try {
      onStatus?.(`Converting DWG with ${st.engine}…`);
      const dxf = await serverConvert(bytes, 'dwg', 'dxf', 'ACAD2018');
      return { ...loadDxfData(doc, readDxf(dxf), file.name), via: st.engine ?? 'converter' };
    } catch (e) {
      onStatus?.(`${st.engine} failed (${(e as Error).message}); falling back to LibreDWG…`);
    }
  } else onStatus?.('Converting DWG with LibreDWG…');
  return { ...(await openDwg(doc, bytes, file.name)), via: 'LibreDWG' };
}

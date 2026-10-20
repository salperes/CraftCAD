// Client for the local conversion API (server/convert.mjs): DWG save and DWG open through
// ODA File Converter or AutoCAD Core Console running on this machine.

export interface ConverterStatus { available: boolean; engine: string | null; versions: string[] }

let status: Promise<ConverterStatus> | null = null;

/** Asks the CraftCAD server which converter is installed (cached; refresh to rescan). */
export function converterStatus(refresh = false): Promise<ConverterStatus> {
  if (!status || refresh) {
    status = fetch(`api/convert/status${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' })
      .then(async (r) => (r.ok ? ((await r.json()) as ConverterStatus) : { available: false, engine: null, versions: [] }))
      .catch(() => ({ available: false, engine: null, versions: [] }));
  }
  return status;
}

export async function serverConvert(bytes: Uint8Array, from: 'dwg' | 'dxf', to: 'dwg' | 'dxf', version = 'ACAD2018'): Promise<Uint8Array> {
  const r = await fetch(`api/convert?from=${from}&to=${to}&version=${encodeURIComponent(version)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: bytes as BodyInit,
  });
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try { msg = ((await r.json()) as { error?: string }).error ?? msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return new Uint8Array(await r.arrayBuffer());
}

/** Save formats in the order AutoCAD lists them. */
export interface SaveFormat { id: string; label: string; ext: 'dwg' | 'dxf'; version: string; native?: boolean }

export const SAVE_FORMATS: SaveFormat[] = [
  { id: 'dwg2018', label: 'AutoCAD 2018 Drawing (*.dwg)', ext: 'dwg', version: 'ACAD2018' },
  { id: 'dwg2013', label: 'AutoCAD 2013/LT2013 Drawing (*.dwg)', ext: 'dwg', version: 'ACAD2013' },
  { id: 'dwg2010', label: 'AutoCAD 2010/LT2010 Drawing (*.dwg)', ext: 'dwg', version: 'ACAD2010' },
  { id: 'dwg2007', label: 'AutoCAD 2007/LT2007 Drawing (*.dwg)', ext: 'dwg', version: 'ACAD2007' },
  { id: 'dwg2004', label: 'AutoCAD 2004/LT2004 Drawing (*.dwg)', ext: 'dwg', version: 'ACAD2004' },
  { id: 'dwg2000', label: 'AutoCAD 2000/LT2000 Drawing (*.dwg)', ext: 'dwg', version: 'ACAD2000' },
  { id: 'dxf2018', label: 'AutoCAD 2018 DXF (*.dxf)', ext: 'dxf', version: 'ACAD2018' },
  { id: 'dxf2000', label: 'AutoCAD R2000 DXF (*.dxf)', ext: 'dxf', version: 'ACAD2000', native: true },
];

// Embedding protocol for MSS Portal. The portal hosts CraftCAD in a same-origin iframe
// (`?embed=1`), sends the drawing bytes and receives the DXF when the user saves (QSAVE).
//
// CraftCAD -> portal: { event: 'init' } | { event: 'save', id, fileName, dxf } | { event: 'modified', modified }
// portal -> CraftCAD: { action: 'load', fileName, data: ArrayBuffer, readonly } |
//                     { action: 'saved', id, ok, fileName?, message? }

export interface PortalFile { fileName: string; data: ArrayBuffer; readonly: boolean }
export interface PortalSaved { fileName: string; message?: string }

export interface PortalHost {
  /** Registers the load handler and tells the portal CraftCAD is ready. */
  onLoad(cb: (f: PortalFile) => void): void;
  save(fileName: string, dxf: string): Promise<PortalSaved>;
  setModified(modified: boolean): void;
}

/** Returns the portal bridge when CraftCAD runs embedded in the portal, otherwise null. */
export function portalHost(): PortalHost | null {
  if (window.parent === window || new URLSearchParams(location.search).get('embed') !== '1') return null;
  const origin = location.origin;
  const post = (msg: object) => window.parent.postMessage(msg, origin);
  let loadCb: ((f: PortalFile) => void) | null = null;
  const pending = new Map<number, { resolve: (r: PortalSaved) => void; reject: (e: Error) => void }>();
  let seq = 0;
  let lastModified: boolean | null = null;

  window.addEventListener('message', (e) => {
    // Only the hosting portal page (same origin, our parent window) may drive the editor.
    if (e.source !== window.parent || e.origin !== origin) return;
    const m = e.data as Record<string, unknown> | null;
    if (!m || typeof m !== 'object') return;
    if (m.action === 'load' && typeof m.fileName === 'string' && m.data instanceof ArrayBuffer) {
      loadCb?.({ fileName: m.fileName, data: m.data, readonly: m.readonly === true });
    } else if (m.action === 'saved' && typeof m.id === 'number') {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok === true) p.resolve({ fileName: String(m.fileName ?? ''), message: typeof m.message === 'string' ? m.message : undefined });
      else p.reject(new Error(typeof m.message === 'string' ? m.message : 'Save failed'));
    }
  });

  return {
    onLoad(cb) { loadCb = cb; post({ event: 'init' }); },
    save(fileName, dxf) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        post({ event: 'save', id, fileName, dxf });
      });
    },
    setModified(modified) {
      if (modified === lastModified) return;
      lastModified = modified;
      post({ event: 'modified', modified });
    },
  };
}

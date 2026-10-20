/** Application version from package.json, injected by Vite (vite.config.ts `define`). */
declare const __APP_VERSION__: string;

interface CraftcadDesktopFile { path: string; name: string; bytes: Uint8Array }

/** Present only in the Electron app (electron/preload.cjs). */
interface Window {
  craftcadDesktop?: {
    openDialog(): Promise<CraftcadDesktopFile | null>;
    saveDialog(name: string, ext: string, label: string): Promise<string | null>;
    writeFile(path: string, bytes: Uint8Array): Promise<boolean>;
    odaBundled(): Promise<{ installer: boolean; available: boolean }>;
    installOda(): Promise<{ ok: boolean; message: string }>;
    onOpenFile(cb: (f: CraftcadDesktopFile) => void): void;
  };
}

// Electron main process: runs the CraftCAD server (dist + DWG conversion API) on a random
// localhost port, opens it in a window, and bridges native file dialogs and the ODA installer.

import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { basename, join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/serve.mjs';
import { converterInfo } from '../server/convert.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let win = null;
let pendingFile = null;

const drawingArg = (argv) => argv.slice(1).find((a) => /\.(dwg|dxf)$/i.test(a) && existsSync(a)) ?? null;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  const f = drawingArg(argv);
  if (f) void sendFile(f);
});

async function sendFile(path) {
  const bytes = await readFile(path);
  win?.webContents.send('open-file', { path, name: basename(path), bytes });
}

/** Folder with the bundled ODA File Converter installer (packaged: resources/oda, dev: vendor/oda). */
function odaInstallerDir() {
  return app.isPackaged ? join(process.resourcesPath, 'oda') : join(here, '..', 'vendor', 'oda');
}

async function bundledOdaInstaller() {
  const dir = odaInstallerDir();
  if (!existsSync(dir)) return null;
  const ext = process.platform === 'win32' ? '.msi' : process.platform === 'darwin' ? '.dmg' : null;
  if (!ext) return null;
  const f = (await readdir(dir)).find((n) => n.toLowerCase().endsWith(ext));
  return f ? join(dir, f) : null;
}

ipcMain.handle('open-dialog', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Select File',
    properties: ['openFile'],
    filters: [{ name: 'Drawings (*.dwg, *.dxf)', extensions: ['dwg', 'dxf'] }, { name: 'All files', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const path = r.filePaths[0];
  return { path, name: basename(path), bytes: await readFile(path) };
});

ipcMain.handle('save-dialog', async (_e, { name, ext, label }) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Save Drawing As',
    defaultPath: name,
    filters: [{ name: label, extensions: [ext] }],
  });
  if (r.canceled || !r.filePath) return null;
  return extname(r.filePath) ? r.filePath : `${r.filePath}.${ext}`;
});

ipcMain.handle('write-file', async (_e, path, bytes) => {
  await writeFile(path, Buffer.from(bytes));
  return true;
});

ipcMain.handle('oda-bundled', async () => ({ installer: (await bundledOdaInstaller()) !== null, available: converterInfo(true).available }));

ipcMain.handle('install-oda', async () => {
  const msi = await bundledOdaInstaller();
  if (!msi) return { ok: false, message: 'No bundled ODA File Converter installer found.' };
  if (process.platform === 'darwin') {
    await shell.openPath(msi);
    return { ok: false, message: 'The ODA File Converter disk image was opened; drag the app to Applications, then try again.' };
  }
  // Interactive MSI install (shows the installer and the UAC prompt).
  const code = await new Promise((ok) => {
    const p = spawn('msiexec', ['/i', msi], { windowsHide: false });
    p.on('close', ok);
    p.on('error', () => ok(-1));
  });
  const info = converterInfo(true);
  return info.available
    ? { ok: true, message: `${info.engine} installed.` }
    : { ok: false, message: `ODA File Converter setup did not complete (exit code ${code}).` };
});

async function createWindow() {
  const { port } = await startServer({ root: join(app.getAppPath(), 'dist'), port: 0 });
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#212830',
    title: 'CraftCAD',
    icon: join(here, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  // Unsaved changes: the page blocks unload; ask here instead of closing silently.
  win.webContents.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['Close without saving', 'Cancel'], defaultId: 1, cancelId: 1,
      title: 'CraftCAD', message: 'The drawing has unsaved changes.', detail: 'Close CraftCAD and discard them?',
    });
    if (choice === 0) e.preventDefault();
  });
  // External links open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.webContents.on('did-finish-load', () => {
    if (pendingFile) { void sendFile(pendingFile); pendingFile = null; }
  });
  win.on('closed', () => { win = null; });
  await win.loadURL(`http://127.0.0.1:${port}/`);
}

pendingFile = drawingArg(process.argv);
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

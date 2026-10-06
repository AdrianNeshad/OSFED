export {};
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

import { EngineClient } from './engine';
import * as imobile from './imobile';
import * as afc from './afc';

const isDev = !app.isPackaged;
const LOG_PATH = path.join(os.tmpdir(), 'osfed-engine.log');

let mainWindow: any = null;
let engine: EngineClient | null = null;
let runningBackup: imobile.RunningBackup | null = null;
let runningPull: afc.RunningPull | null = null;

function enginePath(): string {
  const exe = process.platform === 'win32' ? 'osfed-engine.exe' : 'osfed-engine';
  if (isDev) return path.join(__dirname, '..', 'engine', 'bin', exe);
  return path.join((process as any).resourcesPath, 'engine', exe);
}

async function startEngine(): Promise<void> {
  const ep = enginePath();
  if (!fs.existsSync(ep)) {
    console.error(`[osfed] engine binary not found at ${ep}. Run: npm run engine:build`);
  }
  engine = new EngineClient(ep, LOG_PATH);
  engine.notificationHandler = (n) => {
    mainWindow?.webContents.send('engine:notification', n);
  };
  await engine.start();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1340,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0e1116',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5179');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── device watcher ─────────────────────────────────────────────────────────────
// Polls the connected UDID set with a cheap `idevice_id -l` and notifies the
// renderer only when it changes, so plugging/unplugging a phone refreshes the UI
// automatically with no manual Refresh. libimobiledevice has no cross-platform
// hotplug event we can rely on from the CLI tools, so a light poll is the robust
// portable approach.
let deviceWatchTimer: ReturnType<typeof setInterval> | null = null;
let lastUdidKey = '\u0000'; // sentinel so the first real scan always fires once

function startDeviceWatcher(): void {
  if (deviceWatchTimer) return;
  let busy = false;
  const tick = async () => {
    if (busy || !mainWindow) return;
    busy = true;
    try {
      const udids = await imobile.listUdids();
      const key = udids.slice().sort().join(',');
      if (key !== lastUdidKey) {
        lastUdidKey = key;
        mainWindow?.webContents.send('imobile:devicesChanged');
      }
    } catch {
      // ignore transient errors; the next tick retries
    } finally {
      busy = false;
    }
  };
  deviceWatchTimer = setInterval(tick, 2000);
  void tick();
}

function stopDeviceWatcher(): void {
  if (deviceWatchTimer) { clearInterval(deviceWatchTimer); deviceWatchTimer = null; }
}

// ── IPC: engine ──────────────────────────────────────────────────────────────

ipcMain.handle('engine:call', async (_e: any, method: string, params: any) => {
  try {
    if (!engine) throw new Error('Engine not started');
    const data = await engine.call(method, params);
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
});

// ── IPC: libimobiledevice ─────────────────────────────────────────────────────

ipcMain.handle('imobile:check', async () => imobile.checkTools());

ipcMain.handle('imobile:listDevices', async () => {
  try {
    return { success: true, data: await imobile.listDevices() };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('imobile:pair', async (_e: any, udid: string) => imobile.pair(udid));

ipcMain.handle('imobile:defaultBackupTarget', async () => imobile.defaultBackupTarget());

ipcMain.handle('imobile:startBackup', async (_e: any, args: { udid: string; targetDir: string; password: string }) => {
  try {
    runningBackup = imobile.startEncryptedBackup({
      udid: args.udid,
      targetDir: args.targetDir,
      password: args.password,
      events: {
        onLog: (line) => mainWindow?.webContents.send('imobile:backupEvent', { kind: 'log', line }),
        onProgress: (pct, status) => mainWindow?.webContents.send('imobile:backupEvent', { kind: 'progress', pct, status }),
      },
    });
    const result = await runningBackup.promise;
    runningBackup = null;
    return { success: result.success, data: result };
  } catch (err: any) {
    runningBackup = null;
    return { success: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('imobile:cancelBackup', async () => {
  runningBackup?.cancel();
  return { success: true };
});

// ── IPC: AFC advanced-logical (camera roll / media) ─────────────────────────────

ipcMain.handle('afc:status', async () => afc.afcStatus());

ipcMain.handle('afc:defaultMediaTarget', async (_e: any, udid: string) => afc.defaultMediaTarget(udid));

ipcMain.handle('afc:pullDCIM', async (_e: any, args: { udid: string; destDir: string }) => {
  try {
    runningPull = afc.pullDCIM({
      udid: args.udid,
      destDir: args.destDir,
      events: {
        onLog: (line) => mainWindow?.webContents.send('afc:event', { kind: 'log', line }),
        onProgress: (pct, status) => mainWindow?.webContents.send('afc:event', { kind: 'progress', pct, status }),
      },
    });
    const result = await runningPull.promise;
    runningPull = null;
    return { success: result.success, data: result };
  } catch (err: any) {
    runningPull = null;
    return { success: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('afc:cancelPull', async () => {
  runningPull?.cancel();
  return { success: true };
});

// ── IPC: dialogs / shell ───────────────────────────────────────────────────────

ipcMain.handle('dialog:selectFolder', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
});

ipcMain.handle('dialog:selectSaveFolder', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
});

ipcMain.handle('dialog:saveFile', async (_e: any, defaultName: string) => {
  const r = await dialog.showSaveDialog(mainWindow, { defaultPath: defaultName || 'file' });
  return r.canceled || !r.filePath ? null : r.filePath;
});

ipcMain.handle('shell:openPath', async (_e: any, p: string) => shell.openPath(p));

ipcMain.handle('app:paths', async () => ({
  home: os.homedir(),
  defaultBackupRoot:
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'MobileSync', 'Backup')
      : process.platform === 'win32'
      ? path.join(process.env.APPDATA || '', 'Apple Computer', 'MobileSync', 'Backup')
      : path.join(os.homedir(), 'MobileSync', 'Backup'),
}));

// ── lifecycle ──────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  await startEngine().catch((e) => console.error('[osfed] engine start failed:', e));
  createWindow();
  startDeviceWatcher();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  engine?.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopDeviceWatcher();
  runningBackup?.cancel();
  runningPull?.cancel();
  engine?.stop();
});

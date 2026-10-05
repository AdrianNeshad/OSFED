export {};
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Wrapper around the libimobiledevice command-line tools (idevice_id,
 * ideviceinfo, idevicepair, idevicebackup2). OSFED's start flow drives a full,
 * ALWAYS-ENCRYPTED backup over USB with these tools so the resulting backup
 * always contains the full keychain.
 */

const TOOL_NAMES = ['idevice_id', 'ideviceinfo', 'idevicepair', 'idevicebackup2'] as const;
type ToolName = (typeof TOOL_NAMES)[number];

// Common install locations in addition to PATH.
const EXTRA_DIRS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/opt/local/bin',
];

// bundledToolsDir returns the directory of the self-contained libimobiledevice
// tools shipped inside the app (so nothing needs to be installed), or null when
// no bundle exists for this platform/arch.
function bundledToolsDir(): string | null {
  const arch = process.arch === 'x64' ? 'x86_64' : process.arch; // arm64 stays
  const platKey =
    process.platform === 'darwin' ? `mac-${arch}` :
    process.platform === 'linux' ? `linux-${arch}` :
    `win-${arch}`;

  const candidates = [
    // Packaged app: <resources>/tools/<plat>/bin
    (process as any).resourcesPath ? path.join((process as any).resourcesPath, 'tools', platKey, 'bin') : '',
    // Dev (compiled to dist-electron/): <repo>/engine/tools/<plat>/bin
    path.join(__dirname, '..', 'engine', 'tools', platKey, 'bin'),
  ].filter(Boolean);

  for (const dir of candidates) {
    try {
      fs.accessSync(dir);
      return dir;
    } catch {}
  }
  return null;
}

function findTool(name: string): string | null {
  const candidates = process.platform === 'win32' ? [`${name}.exe`] : [name];

  // 1) Prefer the self-contained bundled tools (plug-and-play).
  const bundled = bundledToolsDir();
  if (bundled) {
    for (const c of candidates) {
      const full = path.join(bundled, c);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      } catch {}
    }
  }

  // 2) Fall back to a system install on PATH / common locations.
  const pathDirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of [...pathDirs, ...EXTRA_DIRS]) {
    if (!dir) continue;
    for (const c of candidates) {
      const full = path.join(dir, c);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      } catch {}
    }
  }
  return null;
}

export interface ToolStatus {
  available: boolean;
  tools: Record<ToolName, string | null>;
  installHint: string;
}

function installHint(): string {
  if (process.platform === 'darwin') return 'Install with:  brew install libimobiledevice';
  if (process.platform === 'linux') return 'Install with:  sudo apt install libimobiledevice-utils  (or your distro package)';
  if (process.platform === 'win32') return 'Install the Apple Devices app (Microsoft Store) and a libimobiledevice build, then ensure the tools are on PATH.';
  return 'Install libimobiledevice.';
}

export function checkTools(): ToolStatus {
  const tools = {} as Record<ToolName, string | null>;
  let available = true;
  for (const t of TOOL_NAMES) {
    const p = findTool(t);
    tools[t] = p;
    if (!p) available = false;
  }
  return { available, tools, installHint: installHint() };
}

function run(bin: string, args: string[], timeoutMs = 20000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err: any, stdout: string, stderr: string) => {
      resolve({ code: err?.code ?? 0, stdout: stdout || '', stderr: stderr || (err?.message ?? '') });
    });
  });
}

export interface DeviceInfo {
  udid: string;
  name: string;
  productVersion: string;
  productType: string;
  paired: boolean;
}

/** List USB-connected devices and best-effort metadata. */
export async function listDevices(): Promise<DeviceInfo[]> {
  const st = checkTools();
  if (!st.tools.idevice_id) throw new Error('LIBIMOBILEDEVICE_MISSING');

  const { stdout } = await run(st.tools.idevice_id, ['-l']);
  const udids = stdout.split('\n').map((s) => s.trim()).filter(Boolean);

  const devices: DeviceInfo[] = [];
  for (const udid of udids) {
    const info: DeviceInfo = { udid, name: '', productVersion: '', productType: '', paired: false };
    if (st.tools.ideviceinfo) {
      const r = await run(st.tools.ideviceinfo, ['-u', udid, '-s']);
      if (r.code === 0) {
        info.name = matchKey(r.stdout, 'DeviceName') || udid;
        info.productVersion = matchKey(r.stdout, 'ProductVersion') || '';
        info.productType = matchKey(r.stdout, 'ProductType') || '';
        info.paired = true;
      }
    }
    if (st.tools.idevicepair) {
      const r = await run(st.tools.idevicepair, ['-u', udid, 'validate']);
      info.paired = r.code === 0;
    }
    devices.push(info);
  }
  return devices;
}

function matchKey(text: string, key: string): string {
  // ideviceinfo -s prints "Key: Value" lines.
  const re = new RegExp(`^${key}:\\s*(.+)$`, 'm');
  const m = text.match(re);
  return m ? m[1].trim() : '';
}

export async function pair(udid: string): Promise<{ ok: boolean; message: string }> {
  const st = checkTools();
  if (!st.tools.idevicepair) return { ok: false, message: 'idevicepair not found' };
  const r = await run(st.tools.idevicepair, ['-u', udid, 'pair'], 60000);
  const out = (r.stdout + r.stderr).trim();
  return { ok: r.code === 0 || /SUCCESS/i.test(out), message: out };
}

// ── Encrypted backup ─────────────────────────────────────────────────────────

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

export interface BackupEvents {
  onLog: (line: string) => void;
  onProgress: (pct: number, status: string) => void;
}

/** A running backup, with the ability to cancel. */
export interface RunningBackup {
  promise: Promise<{ success: boolean; backupPath: string; message: string }>;
  cancel: () => void;
}

/**
 * Enable encryption (if not already on) then run a full backup into
 * `targetDir`. idevicebackup2 writes the backup into targetDir/<udid>/.
 */
export function startEncryptedBackup(opts: {
  udid: string;
  targetDir: string;
  password: string;
  events: BackupEvents;
}): RunningBackup {
  const { udid, targetDir, password, events } = opts;
  const st = checkTools();
  let child: any = null;
  let cancelled = false;

  const promise = (async () => {
    if (!st.tools.idevicebackup2) throw new Error('LIBIMOBILEDEVICE_MISSING');
    fs.mkdirSync(targetDir, { recursive: true });

    // Step 1: force encryption ON (so the backup always includes the keychain).
    events.onProgress(2, 'Enabling backup encryption…');
    const enc = await run(st.tools.idevicebackup2, ['-u', udid, 'encryption', 'on', password, targetDir], 60000);
    const encOut = (enc.stdout + enc.stderr);
    events.onLog(stripAnsi(encOut).trim());
    const alreadyOn = /already enabled/i.test(encOut);
    if (enc.code !== 0 && !alreadyOn) {
      // Most common cause: device locked / passcode confirmation needed.
      if (/passcode|locked|Enter the passcode/i.test(encOut)) {
        throw new Error('PASSCODE_REQUIRED: Unlock your device and confirm enabling encrypted backups on its screen, then try again.');
      }
      // Fall through — the backup step will re-surface a clearer error.
    }
    if (alreadyOn) {
      events.onLog('Backup encryption was already enabled on this device; using the existing backup password.');
    }

    // Step 2: full backup.
    events.onProgress(5, 'Starting full backup…');
    return await new Promise<{ success: boolean; backupPath: string; message: string }>((resolve, reject) => {
      child = spawn(st.tools.idevicebackup2!, ['-u', udid, 'backup', '--full', targetDir], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let tail = '';
      const handle = (buf: Buffer) => {
        const text = stripAnsi(buf.toString());
        // Progress block lines are separated by \n and \r.
        const parts = (tail + text).split(/[\r\n]+/);
        tail = parts.pop() || '';
        for (const raw of parts) {
          const line = raw.trim();
          if (!line) continue;
          const pm = line.match(/Backup\s+.*?(\d+)%/);
          if (pm) {
            const pct = Math.min(99, parseInt(pm[1], 10));
            events.onProgress(Math.max(5, pct), 'Backing up…');
            continue;
          }
          const sm = line.match(/^Status\s+(.*)$/);
          if (sm && sm[1]) {
            events.onProgress(-1 as any, sm[1]);
            continue;
          }
          events.onLog(line);
        }
      };
      child.stdout.on('data', handle);
      child.stderr.on('data', handle);

      child.on('error', (err: Error) => reject(err));
      child.on('exit', (code: number) => {
        const backupPath = path.join(targetDir, udid);
        const ok = code === 0 && fs.existsSync(path.join(backupPath, 'Manifest.plist'));
        if (cancelled) {
          resolve({ success: false, backupPath, message: 'Backup cancelled.' });
          return;
        }
        if (ok) {
          events.onProgress(100, 'Backup complete.');
          resolve({ success: true, backupPath, message: 'Backup complete.' });
        } else if (fs.existsSync(path.join(backupPath, 'Manifest.plist'))) {
          // iOS sometimes closes the channel right at the end; the backup is valid.
          events.onProgress(100, 'Backup complete.');
          resolve({ success: true, backupPath, message: 'Backup complete (channel closed at end).' });
        } else {
          reject(new Error(`idevicebackup2 exited with code ${code}. Make sure the device is unlocked and you tapped "Trust".`));
        }
      });
    });
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      if (child && !child.killed) child.kill();
    },
  };
}

/** Default directory OSFED writes new backups into. */
export function defaultBackupTarget(): string {
  return path.join(os.homedir(), 'OSFED', 'Backups');
}

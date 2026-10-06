export {};
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

import { resolveTool } from './imobile';

/**
 * Advanced-logical acquisition over AFC (Apple File Conduit).
 *
 * The `com.apple.afc` service exposes the device's MEDIA partition (rooted at
 * the media sandbox, i.e. the "Media" area Finder/iTunes use for photo sync) to
 * a paired + trusted host — no jailbreak, no exploit, all iOS versions. This
 * module pulls the full camera roll (/DCIM) off that partition, which gives the
 * original photo/video files directly, more completely than an iTunes backup.
 *
 * Implemented by driving libimobiledevice's `afcclient` (same pattern OSFED
 * uses for idevicebackup2). It reads only; nothing is written to the device.
 */

export interface AfcStatus {
  available: boolean;
  path: string | null;
}

export function afcStatus(): AfcStatus {
  const p = resolveTool('afcclient');
  return { available: !!p, path: p };
}

/** Default folder OSFED pulls media into. */
export function defaultMediaTarget(udid: string): string {
  return path.join(os.homedir(), 'OSFED', 'Media', udid || 'device');
}

// countDir walks a local directory and returns the number and total size of
// regular files under it — used to report live pull progress.
function countDir(root: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: any[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile()) {
        files++;
        try { bytes += fs.statSync(full).size; } catch {}
      }
    }
  }
  return { files, bytes };
}

function fmtMB(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export interface AfcEvents {
  onLog: (line: string) => void;
  onProgress: (pct: number, status: string) => void;
}

export interface RunningPull {
  promise: Promise<{ success: boolean; destDir: string; files: number; bytes: number; message: string }>;
  cancel: () => void;
}

/**
 * pullDCIM recursively copies /DCIM off the media partition into destDir using
 * `afcclient get -r`. Progress is reported by polling the growing destination
 * (independent of afcclient's own output), so it works across tool versions.
 */
export function pullDCIM(opts: { udid: string; destDir: string; events: AfcEvents }): RunningPull {
  const { udid, destDir, events } = opts;
  const st = afcStatus();
  let child: any = null;
  let cancelled = false;
  let timer: any = null;

  const promise = (async () => {
    if (!st.available || !st.path) {
      throw new Error('AFC_UNAVAILABLE: afcclient was not found. It ships with libimobiledevice.');
    }
    fs.mkdirSync(destDir, { recursive: true });
    events.onProgress(1, 'Connecting to device media (AFC)…');

    return await new Promise<{ success: boolean; destDir: string; files: number; bytes: number; message: string }>((resolve, reject) => {
      // afcclient paths are relative to the media root, so /DCIM is the camera roll.
      const args = ['-u', udid, 'get', '-r', '/DCIM', destDir];
      child = spawn(st.path!, args, { stdio: ['ignore', 'pipe', 'pipe'] });

      timer = setInterval(() => {
        const c = countDir(destDir);
        // pct -1 → leave the bar indeterminate, just update the status line.
        events.onProgress(-1, `Pulled ${c.files} files (${fmtMB(c.bytes)})…`);
      }, 800);

      let tail = '';
      const onData = (buf: Buffer) => {
        const parts = (tail + buf.toString()).split(/\r?\n/);
        tail = parts.pop() || '';
        for (const line of parts) {
          const t = line.trim();
          if (t) events.onLog(t);
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);

      child.on('error', (err: Error) => { if (timer) clearInterval(timer); reject(err); });
      child.on('exit', (code: number) => {
        if (timer) clearInterval(timer);
        const c = countDir(destDir);
        if (cancelled) {
          resolve({ success: false, destDir, files: c.files, bytes: c.bytes, message: 'Camera roll pull cancelled.' });
          return;
        }
        if (c.files > 0) {
          events.onProgress(100, `Camera roll pulled — ${c.files} files (${fmtMB(c.bytes)}).`);
          const note = code === 0 ? '' : ` (afcclient exited ${code})`;
          resolve({ success: true, destDir, files: c.files, bytes: c.bytes, message: `Pulled ${c.files} files${note}.` });
        } else {
          reject(new Error(`No files were pulled (afcclient exited ${code}). Make sure the device is unlocked and trusted.`));
        }
      });
    });
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      if (child && !child.killed) child.kill();
    },
  };
}

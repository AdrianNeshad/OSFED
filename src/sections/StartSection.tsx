import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Smartphone, HardDriveDownload, FolderOpen, RefreshCw, ShieldCheck,
  AlertTriangle, Wand2, Lock, CheckCircle2, XCircle, FolderSearch, Cpu, Images,
} from 'lucide-react';
import { Button, Card, Spinner, Badge, formatBytes } from '../components/ui';
import { engineCall } from '../lib/ipc';
import type { BackupInfo, BackupSummary, EnumerateResult } from '../lib/types';
import type { DeviceInfo, ToolStatus, AfcStatus } from '../global';

interface Props {
  backup: BackupInfo | null;
  onOpened: (info: BackupInfo) => void;
  onClose: () => void;
}

type Phase = 'idle' | 'backing-up' | 'opening' | 'afc';

export default function StartSection({ onOpened }: Props) {
  const [tools, setTools] = useState<ToolStatus | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [scanning, setScanning] = useState(false);
  const [deviceError, setDeviceError] = useState('');

  const [password, setPassword] = useState('');
  const [targetDir, setTargetDir] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [afc, setAfc] = useState<AfcStatus | null>(null);
  // UDID currently being paired, so its row shows a spinner and disables actions.
  const [pairing, setPairing] = useState<string | null>(null);

  const logRef = useRef<HTMLDivElement>(null);
  // Keep the latest phase readable from the long-lived devices-changed listener
  // without re-subscribing on every phase change.
  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;

  // ── setup ──────────────────────────────────────────────────────────────
  const refreshDevices = useCallback(async () => {
    setScanning(true);
    setDeviceError('');
    try {
      const res = await window.osfed.listDevices();
      if (!res.success) {
        if (res.error === 'LIBIMOBILEDEVICE_MISSING') setDeviceError('LIBIMOBILEDEVICE_MISSING');
        else setDeviceError(res.error || 'Could not list devices');
        setDevices([]);
      } else {
        setDevices(res.data || []);
      }
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    window.osfed.checkTools().then(setTools);
    window.osfed.defaultBackupTarget().then(setTargetDir);
    window.osfed.afcStatus().then(setAfc);
    refreshDevices();
  }, [refreshDevices]);

  // Auto-refresh when a device is plugged in or unplugged (the main process
  // watches the connected device set), so no manual Refresh is needed. Skip
  // while a backup/pull is running so we don't poke the device mid-transfer.
  useEffect(() => {
    const unsub = window.osfed.onDevicesChanged(() => {
      if (phaseRef.current === 'idle') refreshDevices();
    });
    return unsub;
  }, [refreshDevices]);

  useEffect(() => {
    const handle = (ev: any) => {
      if (ev.kind === 'log') setLog((l) => [...l.slice(-400), ev.line]);
      else {
        if (ev.pct >= 0) setProgress(ev.pct);
        if (ev.status) setStatus(ev.status);
      }
    };
    const unsubB = window.osfed.onBackupEvent(handle);
    const unsubA = window.osfed.onAfcEvent(handle);
    return () => { unsubB(); unsubA(); };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [log]);

  // ── actions ────────────────────────────────────────────────────────────
  const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let p = '';
    const arr = new Uint32Array(20);
    crypto.getRandomValues(arr);
    for (let i = 0; i < 20; i++) p += chars[arr[i] % chars.length];
    setPassword(p);
  };

  const chooseTarget = async () => {
    const dir = await window.osfed.selectSaveFolder();
    if (dir) setTargetDir(dir);
  };

  // Pair the host with the device. This is what makes iOS show the on-screen
  // "Trust" dialog — the backup itself never prompts, so the user must trust
  // the computer here first. On a fresh device the first tap triggers the
  // dialog (pending_trust); after they accept, a second tap completes it.
  const pairDevice = async (dev: DeviceInfo) => {
    setError('');
    setNotice('');
    setPairing(dev.udid);
    try {
      const r = await window.osfed.pair(dev.udid);
      if (r.ok) {
        setNotice('Device trusted. You can start the backup now.');
        await refreshDevices();
      } else if (r.code === 'pending_trust') {
        setError('Unlock your device, then tap “Trust” on its screen and enter its passcode. Then tap Pair again.');
      } else if (r.code === 'passcode') {
        setError('Unlock your device and confirm on its screen, then tap Pair again.');
      } else if (r.code === 'no_device') {
        setError('No device found. Reconnect it with a data cable (not charge-only) and unlock it.');
      } else {
        setError(r.message || 'Pairing failed. Reconnect the device and try again.');
      }
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setPairing(null);
    }
  };

  const startBackup = async (dev: DeviceInfo) => {
    setError('');
    if (!dev.paired) { setError('Trust this computer on the device first — tap Pair, then accept the dialog on the device.'); return; }
    if (!password) { setError('Set a backup password first (the keychain is only recoverable from an encrypted backup).'); return; }
    if (!targetDir) { setError('Choose a destination folder.'); return; }
    setPhase('backing-up');
    setProgress(0);
    setStatus('Preparing…');
    setLog([]);
    try {
      const res = await window.osfed.startBackup({ udid: dev.udid, targetDir, password });
      if (!res.success || !res.data?.success) {
        setError(res.error || res.data?.message || 'Backup failed.');
        setPhase('idle');
        return;
      }
      // Backup done → open it.
      setPhase('opening');
      setStatus('Opening backup…');
      const info = await engineCall<BackupInfo>('open_backup', { path: res.data.backupPath, password });
      onOpened(info);
    } catch (e: any) {
      setError(e.message || String(e));
      setPhase('idle');
    }
  };

  const cancelBackup = async () => {
    await window.osfed.cancelBackup();
    setPhase('idle');
    setStatus('Cancelled');
  };

  // Advanced logical: pull the full camera roll (/DCIM) over AFC.
  const startCameraRoll = async (dev: DeviceInfo) => {
    setError('');
    setNotice('');
    const destDir = await window.osfed.afcDefaultMediaTarget(dev.udid);
    setPhase('afc');
    setProgress(0);
    setStatus('Preparing…');
    setLog([]);
    try {
      const res = await window.osfed.pullDCIM({ udid: dev.udid, destDir });
      if (!res.success || !res.data?.success) {
        setError(res.error || res.data?.message || 'Camera roll pull failed.');
        setPhase('idle');
        return;
      }
      setPhase('idle');
      setNotice(`Pulled ${res.data.files.toLocaleString()} camera-roll files (${formatBytes(res.data.bytes)}) to ${res.data.destDir}.`);
      window.osfed.openPath(res.data.destDir);
    } catch (e: any) {
      setError(e.message || String(e));
      setPhase('idle');
    }
  };

  const cancelPull = async () => {
    await window.osfed.cancelPull();
    setPhase('idle');
    setStatus('Cancelled');
  };

  const libmissing = tools && !tools.available;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-8 py-10">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center">
            <ShieldCheck size={20} className="text-accent" />
          </div>
          <h1 className="text-title font-semibold">Start an extraction</h1>
        </div>
        <p className="text-[13px] text-text-secondary mb-8 ml-12">
          Connect a device over USB to create a full <span className="text-text-primary font-medium">encrypted</span> backup
          (required for the keychain), or open a local backup folder you already have.
        </p>

        {phase !== 'idle' ? (
          <BackupProgress phase={phase} progress={progress} status={status} log={log} logRef={logRef} onCancel={phase === 'afc' ? cancelPull : cancelBackup} />
        ) : (
          <div className="space-y-6">
            {/* libimobiledevice status */}
            {libmissing && (
              <Card className="p-4 border-warning/30">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={18} className="text-warning mt-0.5" />
                  <div className="text-[13px]">
                    <div className="font-medium text-text-primary">libimobiledevice tools not found</div>
                    <div className="text-text-secondary mt-1">
                      Live backups over cable need the libimobiledevice command-line tools.
                    </div>
                    <code className="mono inline-block mt-2 px-2 py-1 rounded bg-elevated text-text-primary text-caption">
                      {tools?.installHint}
                    </code>
                    <div className="text-text-tertiary mt-1 text-caption">You can still open existing backup folders below.</div>
                  </div>
                </div>
              </Card>
            )}

            {error && (
              <Card className="p-4 border-error/30">
                <div className="flex items-start gap-3 text-[13px]">
                  <XCircle size={18} className="text-error mt-0.5" />
                  <div className="text-text-secondary whitespace-pre-wrap">{error}</div>
                </div>
              </Card>
            )}

            {notice && (
              <Card className="p-4 border-success/30">
                <div className="flex items-start gap-3 text-[13px]">
                  <CheckCircle2 size={18} className="text-success mt-0.5" />
                  <div className="text-text-secondary whitespace-pre-wrap">{notice}</div>
                </div>
              </Card>
            )}

            {/* Create encrypted backup */}
            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <HardDriveDownload size={17} className="text-accent" />
                  <h2 className="text-subhead font-semibold">Create encrypted backup</h2>
                </div>
                <Button variant="ghost" onClick={refreshDevices} disabled={scanning}>
                  <RefreshCw size={14} className={scanning ? 'animate-spin' : ''} /> Refresh
                </Button>
              </div>

              {/* password + target */}
              <div className="grid grid-cols-1 gap-3 mb-4">
                <label className="block">
                  <span className="text-caption text-text-tertiary">Backup password</span>
                  <div className="flex gap-2 mt-1">
                    <input
                      type="text"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Set a password for the encrypted backup"
                      className="mono flex-1 bg-elevated border border-border-default rounded-md px-3 py-2 text-[13px] focus:outline-none focus:border-accent"
                    />
                    <Button variant="ghost" onClick={generatePassword} title="Generate strong password">
                      <Wand2 size={14} /> Generate
                    </Button>
                  </div>
                  <span className="text-caption text-text-tertiary mt-1 block">
                    OSFED always enables encryption so the backup includes the full keychain. Keep this password — it is required to open the backup.
                  </span>
                </label>

                <label className="block">
                  <span className="text-caption text-text-tertiary">Destination folder</span>
                  <div className="flex gap-2 mt-1">
                    <input
                      value={targetDir}
                      onChange={(e) => setTargetDir(e.target.value)}
                      className="mono flex-1 bg-elevated border border-border-default rounded-md px-3 py-2 text-[13px] focus:outline-none focus:border-accent"
                    />
                    <Button variant="ghost" onClick={chooseTarget}><FolderOpen size={14} /> Browse</Button>
                  </div>
                </label>
              </div>

              {/* devices */}
              {deviceError === 'LIBIMOBILEDEVICE_MISSING' ? (
                <div className="text-[13px] text-text-tertiary">Install libimobiledevice to detect connected devices.</div>
              ) : deviceError ? (
                <div className="text-[13px] text-error">{deviceError}</div>
              ) : scanning ? (
                <Spinner label="Scanning for devices…" />
              ) : devices.length === 0 ? (
                <div className="flex items-center gap-2 text-[13px] text-text-tertiary">
                  <Smartphone size={16} /> No device detected. Connect via USB and unlock it.
                </div>
              ) : (
                <div className="space-y-2">
                  {devices.map((d) => (
                    <div key={d.udid} className="flex items-center gap-3 p-3 rounded-md bg-elevated border border-border-subtle">
                      <Smartphone size={18} className="text-text-secondary" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-[13px] truncate">{d.name || d.udid}</div>
                        <div className="text-caption text-text-tertiary mono truncate">
                          {d.productType || 'iOS device'} · iOS {d.productVersion || '?'} · {d.udid}
                        </div>
                      </div>
                      {d.soc && d.soc !== 'unknown' && (
                        <Badge tone="default"><Cpu size={10} className="mr-1" />{d.socLabel}</Badge>
                      )}
                      {d.paired ? <Badge tone="success">Paired</Badge> : <Badge tone="warning">Not trusted</Badge>}
                      {!d.paired && (
                        <Button
                          variant="default"
                          onClick={() => pairDevice(d)}
                          disabled={pairing === d.udid}
                          title="Trust this computer — shows the Trust dialog on the device"
                        >
                          {pairing === d.udid ? <Spinner /> : <ShieldCheck size={14} />} Pair
                        </Button>
                      )}
                      {afc?.available && (
                        <Button
                          variant="default"
                          onClick={() => startCameraRoll(d)}
                          disabled={!d.paired}
                          title={d.paired ? 'Pull the full camera roll (/DCIM) over AFC' : 'Trust this computer on the device first'}
                        >
                          <Images size={14} /> Camera roll
                        </Button>
                      )}
                      <Button
                        variant="primary"
                        onClick={() => startBackup(d)}
                        disabled={!d.paired}
                        title={d.paired ? 'Create a full encrypted backup' : 'Tap Pair and trust this computer on the device first'}
                      >
                        <Lock size={14} /> Back up
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Open existing */}
            <OpenExistingPanel onOpened={onOpened} setError={setError} setPhase={setPhase} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Backup progress view ───────────────────────────────────────────────────

function BackupProgress({
  phase, progress, status, log, logRef, onCancel,
}: {
  phase: Phase; progress: number; status: string; log: string[];
  logRef: React.RefObject<HTMLDivElement>; onCancel: () => void;
}) {
  // The AFC camera-roll pull reports a live file count rather than a percentage,
  // so its bar is indeterminate.
  const indeterminate = phase === 'afc' && progress < 100;
  const title =
    phase === 'opening' ? 'Opening backup…' :
    phase === 'afc' ? 'Pulling camera roll (AFC)…' :
    'Creating encrypted backup…';
  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <Spinner />
        <h2 className="text-subhead font-semibold">{title}</h2>
      </div>
      <div className="h-2 rounded-full bg-elevated overflow-hidden mb-2">
        {indeterminate ? (
          <div className="h-full w-1/3 bg-accent/60 animate-pulse rounded-full" />
        ) : (
          <div className="h-full bg-accent transition-all duration-300" style={{ width: `${Math.max(2, progress)}%` }} />
        )}
      </div>
      <div className="flex items-center justify-between text-caption text-text-tertiary mb-4">
        <span>{status || 'Working…'}</span>
        {!indeterminate && <span className="mono">{progress}%</span>}
      </div>
      <div ref={logRef} className="mono text-caption text-text-tertiary bg-base rounded-md border border-border-subtle p-3 h-40 overflow-y-auto whitespace-pre-wrap">
        {log.length === 0 ? 'Keep your device unlocked. You may need to confirm on the device screen.' : log.join('\n')}
      </div>
      {(phase === 'backing-up' || phase === 'afc') && (
        <div className="mt-4">
          <Button variant="danger" onClick={onCancel}>Cancel</Button>
        </div>
      )}
    </Card>
  );
}

// ── Open existing backup ─────────────────────────────────────────────────────

function OpenExistingPanel({
  onOpened, setError, setPhase,
}: {
  onOpened: (i: BackupInfo) => void;
  setError: (s: string) => void;
  setPhase: (p: Phase) => void;
}) {
  const [list, setList] = useState<BackupSummary[]>([]);
  const [root, setRoot] = useState('');
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState('');
  const [pwFor, setPwFor] = useState<BackupSummary | null>(null);
  const [pw, setPw] = useState('');
  const [opening, setOpening] = useState(false);

  const scan = useCallback(async (customRoot?: string) => {
    setLoading(true);
    setNote('');
    try {
      const res = await engineCall<EnumerateResult>('enumerate_backups', customRoot ? { root: customRoot } : {});
      setRoot(res.root);
      setList(res.backups || []);
      if (res.note) setNote(res.note);
    } catch (e: any) {
      setNote(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { scan(); }, [scan]);

  const browse = async () => {
    const dir = await window.osfed.selectFolder();
    if (dir) scan(dir);
  };

  const open = async (b: BackupSummary, password?: string) => {
    setError('');
    if (b.encrypted && !password) { setPwFor(b); setPw(''); return; }
    setOpening(true);
    setPhase('opening');
    try {
      const info = await engineCall<BackupInfo>('open_backup', { path: b.path, password: password || '' });
      onOpened(info);
    } catch (e: any) {
      const msg = e.message || String(e);
      if (msg.includes('PASSWORD_REQUIRED')) { setPwFor(b); setPw(''); }
      else if (msg.includes('WRONG_PASSWORD')) { setError('Wrong backup password.'); setPwFor(b); }
      else setError(msg);
      setPhase('idle');
    } finally {
      setOpening(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <FolderOpen size={17} className="text-accent" />
          <h2 className="text-subhead font-semibold">Open existing backup</h2>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => scan()}><FolderSearch size={14} /> Scan default</Button>
          <Button variant="ghost" onClick={browse}><FolderOpen size={14} /> Choose folder…</Button>
        </div>
      </div>

      {root && <div className="text-caption text-text-tertiary mono mb-3 truncate">{root}</div>}

      {loading ? (
        <Spinner label="Scanning…" />
      ) : list.length === 0 ? (
        <div className="text-[13px] text-text-tertiary">
          No backups found here. {note && <span className="block mt-1 mono text-caption">{note}</span>}
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((b) => (
            <div key={b.path} className="flex items-center gap-3 p-3 rounded-md bg-elevated border border-border-subtle">
              <Smartphone size={18} className="text-text-secondary" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[13px] truncate">{b.deviceName || b.name}</div>
                <div className="text-caption text-text-tertiary truncate">
                  {b.productType} · iOS {b.productVersion} · {b.lastBackupDate ? new Date(b.lastBackupDate).toLocaleString() : 'unknown date'}
                </div>
              </div>
              {b.encrypted ? <Badge tone="success"><Lock size={10} className="mr-1" />Encrypted</Badge> : <Badge tone="warning">No keychain</Badge>}
              <Button variant="primary" onClick={() => open(b)} disabled={opening}>Open</Button>
            </div>
          ))}
        </div>
      )}

      {/* password prompt */}
      {pwFor && (
        <div className="mt-4 p-4 rounded-md bg-base border border-border-default">
          <div className="text-[13px] font-medium mb-2 flex items-center gap-2">
            <Lock size={14} className="text-accent" /> Password for “{pwFor.deviceName || pwFor.name}”
          </div>
          <div className="flex gap-2">
            <input
              type="password"
              autoFocus
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && open(pwFor, pw)}
              placeholder="Backup password"
              className="mono flex-1 bg-elevated border border-border-default rounded-md px-3 py-2 text-[13px] focus:outline-none focus:border-accent"
            />
            <Button variant="primary" onClick={() => open(pwFor, pw)} disabled={opening || !pw}>
              {opening ? <Spinner /> : <><CheckCircle2 size={14} /> Unlock</>}
            </Button>
            <Button variant="ghost" onClick={() => setPwFor(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

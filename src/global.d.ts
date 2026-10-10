export {};

export interface ToolStatus {
  available: boolean;
  tools: Record<'idevice_id' | 'ideviceinfo' | 'idevicepair' | 'idevicebackup2', string | null>;
  installHint: string;
}

export type PairCode = 'success' | 'pending_trust' | 'passcode' | 'no_device' | 'error';

export type SocFamily =
  | 'A5' | 'A6' | 'A7' | 'A8' | 'A9' | 'A10' | 'A11'
  | 'A12+' | 'pre-A5' | 'unknown';

export interface DeviceInfo {
  udid: string;
  name: string;
  productVersion: string;
  productType: string;
  paired: boolean;
  soc: SocFamily;
  socLabel: string;
}

export interface BackupResult {
  success: boolean;
  backupPath: string;
  message: string;
}

export interface AfcStatus {
  available: boolean;
  path: string | null;
}

export interface AfcPullResult {
  success: boolean;
  destDir: string;
  files: number;
  bytes: number;
  message: string;
}

export type AfcEvent =
  | { kind: 'log'; line: string }
  | { kind: 'progress'; pct: number; status: string };

export interface OsfedApi {
  call: (method: string, params?: any) => Promise<{ success: boolean; data?: any; error?: string }>;
  onEngineNotification: (cb: (n: { method: string; params: any }) => void) => () => void;

  checkTools: () => Promise<ToolStatus>;
  listDevices: () => Promise<{ success: boolean; data?: DeviceInfo[]; error?: string }>;
  pair: (udid: string) => Promise<{ ok: boolean; code: PairCode; message: string }>;
  defaultBackupTarget: () => Promise<string>;
  startBackup: (args: { udid: string; targetDir: string; password: string }) => Promise<{ success: boolean; data?: BackupResult; error?: string }>;
  cancelBackup: () => Promise<{ success: boolean }>;
  onBackupEvent: (cb: (ev: { kind: 'log'; line: string } | { kind: 'progress'; pct: number; status: string }) => void) => () => void;
  onDevicesChanged: (cb: () => void) => () => void;

  afcStatus: () => Promise<AfcStatus>;
  afcDefaultMediaTarget: (udid: string) => Promise<string>;
  pullDCIM: (args: { udid: string; destDir: string }) => Promise<{ success: boolean; data?: AfcPullResult; error?: string }>;
  cancelPull: () => Promise<{ success: boolean }>;
  onAfcEvent: (cb: (ev: AfcEvent) => void) => () => void;

  selectFolder: () => Promise<string | null>;
  selectSaveFolder: () => Promise<string | null>;
  selectAbFile: () => Promise<string | null>;
  saveFile: (defaultName: string) => Promise<string | null>;
  openPath: (p: string) => Promise<string>;
  paths: () => Promise<{ home: string; defaultBackupRoot: string }>;
}

declare global {
  interface Window {
    osfed: OsfedApi;
  }
}

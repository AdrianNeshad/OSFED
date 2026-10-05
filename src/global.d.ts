export {};

export interface ToolStatus {
  available: boolean;
  tools: Record<'idevice_id' | 'ideviceinfo' | 'idevicepair' | 'idevicebackup2', string | null>;
  installHint: string;
}

export interface DeviceInfo {
  udid: string;
  name: string;
  productVersion: string;
  productType: string;
  paired: boolean;
}

export interface BackupResult {
  success: boolean;
  backupPath: string;
  message: string;
}

export interface OsfedApi {
  call: (method: string, params?: any) => Promise<{ success: boolean; data?: any; error?: string }>;
  onEngineNotification: (cb: (n: { method: string; params: any }) => void) => () => void;

  checkTools: () => Promise<ToolStatus>;
  listDevices: () => Promise<{ success: boolean; data?: DeviceInfo[]; error?: string }>;
  pair: (udid: string) => Promise<{ ok: boolean; message: string }>;
  defaultBackupTarget: () => Promise<string>;
  startBackup: (args: { udid: string; targetDir: string; password: string }) => Promise<{ success: boolean; data?: BackupResult; error?: string }>;
  cancelBackup: () => Promise<{ success: boolean }>;
  onBackupEvent: (cb: (ev: { kind: 'log'; line: string } | { kind: 'progress'; pct: number; status: string }) => void) => () => void;

  selectFolder: () => Promise<string | null>;
  selectSaveFolder: () => Promise<string | null>;
  saveFile: (defaultName: string) => Promise<string | null>;
  openPath: (p: string) => Promise<string>;
  paths: () => Promise<{ home: string; defaultBackupRoot: string }>;
}

declare global {
  interface Window {
    osfed: OsfedApi;
  }
}

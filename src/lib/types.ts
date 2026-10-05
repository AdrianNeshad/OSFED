export interface BackupSummary {
  path: string;
  name: string;
  deviceName: string;
  displayName: string;
  productName: string;
  productType: string;
  productVersion: string;
  buildVersion: string;
  serialNumber: string;
  uniqueId: string;
  imei: string;
  phoneNumber: string;
  lastBackupDate: string;
  encrypted: boolean;
  itunesVersion: string;
}

export interface BackupInfo extends BackupSummary {
  handle: string;
  fileCount: number;
  domainCount: number;
  appCount: number;
  apps?: string[];
}

export interface EnumerateResult {
  root: string;
  backups: BackupSummary[] | null;
  note?: string;
}

// ── Keychain ──────────────────────────────────────────────────────────────

export interface KeychainSecret {
  isText: boolean;
  text?: string;
  len?: number;
  hex?: string;
  base64?: string;
}

export interface KeychainSummary {
  account: string;
  service: string;
  label: string;
  description: string;
  accessGroup: string;
  server: string;
  protocol: string;
  accessible: string;
  synchronizable: unknown;
  created: string | null;
  modified: string | null;
  protectionClass: number;
  secret: KeychainSecret | null;
}

export interface KeychainEntry {
  summary: KeychainSummary;
  raw: Record<string, unknown>;
}

export type KeychainClass = 'general' | 'internet' | 'certs' | 'keys';

export interface KeychainDump {
  counts: Record<KeychainClass, number>;
  general: KeychainEntry[];
  internet: KeychainEntry[];
  certs: KeychainEntry[];
  keys: KeychainEntry[];
}

// ── Files ───────────────────────────────────────────────────────────────────

export interface DomainInfo {
  domain: string;
  files: number;
  bytes: number;
}

export interface FileRecord {
  domain: string;
  path: string;
  bytes: number;
  id: string;
}

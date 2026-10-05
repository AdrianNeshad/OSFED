import {
  Smartphone, KeyRound, Clock, FileText, Database, Grid3x3, FolderTree,
  ShieldCheck, ShieldAlert, LogOut, FolderOpen,
} from 'lucide-react';
import { Card, SectionHeader, Button, Badge } from '../components/ui';
import type { SectionId } from '../lib/sections';
import type { BackupInfo } from '../lib/types';

interface Props {
  backup: BackupInfo;
  onNavigate: (s: SectionId) => void;
  onClose: () => void;
}

function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-border-subtle last:border-0">
      <span className="text-text-tertiary text-[13px]">{label}</span>
      <span className="text-text-primary text-[13px] mono text-right truncate">{value}</span>
    </div>
  );
}

export default function OverviewSection({ backup, onNavigate, onClose }: Props) {
  const stats: { id: SectionId; label: string; value: number | string; icon: any }[] = [
    { id: 'files', label: 'Files', value: backup.fileCount.toLocaleString(), icon: FileText },
    { id: 'files', label: 'Domains', value: backup.domainCount, icon: Database },
    { id: 'apps', label: 'Apps', value: backup.appCount, icon: Grid3x3 },
  ];

  const quick: { id: SectionId; label: string; icon: any; desc: string }[] = [
    { id: 'keychain', label: 'Keychain', icon: KeyRound, desc: 'Stored passwords & secrets' },
    { id: 'timeline', label: 'Timeline', icon: Clock, desc: 'Unified chronological view' },
    { id: 'files', label: 'File Browser', icon: FolderTree, desc: 'Browse & restore files' },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-8 py-8">
        <SectionHeader
          title={backup.deviceName || backup.name}
          subtitle={`${backup.productName || backup.productType} · iOS ${backup.productVersion}`}
          actions={
            <>
              <Button variant="ghost" onClick={() => window.osfed.openPath(backup.path)}>
                <FolderOpen size={14} /> Reveal
              </Button>
              <Button variant="ghost" onClick={onClose}>
                <LogOut size={14} /> Close
              </Button>
            </>
          }
        />

        <div className="mb-6">
          {backup.encrypted ? (
            <Badge tone="success"><ShieldCheck size={12} className="mr-1" /> Encrypted — keychain available</Badge>
          ) : (
            <Badge tone="warning"><ShieldAlert size={12} className="mr-1" /> Unencrypted — no keychain</Badge>
          )}
        </div>

        {/* stat tiles */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {stats.map((s, i) => {
            const Icon = s.icon;
            return (
              <button
                key={i}
                onClick={() => onNavigate(s.id)}
                className="text-left bg-surface border border-border-subtle rounded-lg p-4 hover:border-border-strong transition-colors"
              >
                <Icon size={18} className="text-text-tertiary mb-2" />
                <div className="text-title font-semibold">{s.value}</div>
                <div className="text-caption text-text-tertiary">{s.label}</div>
              </button>
            );
          })}
        </div>

        {/* quick actions */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {quick.map((q) => {
            const Icon = q.icon;
            return (
              <button
                key={q.id}
                onClick={() => onNavigate(q.id)}
                className="text-left bg-surface border border-border-subtle rounded-lg p-4 hover:border-accent/50 transition-colors group"
              >
                <Icon size={20} className="text-accent mb-2" />
                <div className="text-[13px] font-semibold">{q.label}</div>
                <div className="text-caption text-text-tertiary">{q.desc}</div>
              </button>
            );
          })}
        </div>

        {/* device details */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <Smartphone size={16} className="text-text-secondary" />
            <h2 className="text-subhead font-semibold">Device details</h2>
          </div>
          <Row label="Device name" value={backup.deviceName} />
          <Row label="Model" value={backup.productType} />
          <Row label="iOS version" value={`${backup.productVersion} (${backup.buildVersion})`} />
          <Row label="Serial number" value={backup.serialNumber} />
          <Row label="UDID" value={backup.uniqueId} />
          <Row label="IMEI" value={backup.imei} />
          <Row label="Phone number" value={backup.phoneNumber} />
          <Row label="Last backup" value={backup.lastBackupDate ? new Date(backup.lastBackupDate).toLocaleString() : ''} />
          <Row label="Backup path" value={backup.path} />
        </Card>
      </div>
    </div>
  );
}

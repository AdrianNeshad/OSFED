import { useMemo, useState } from 'react';
import { Grid3x3, Search } from 'lucide-react';
import { EmptyState, Badge } from '../components/ui';
import type { BackupInfo } from '../lib/types';

export default function AppsSection({ backup }: { backup: BackupInfo }) {
  const [query, setQuery] = useState('');
  const apps = backup.apps || [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? apps.filter((a) => a.toLowerCase().includes(q)) : apps;
    return [...list].sort();
  }, [apps, query]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-6 pb-3 border-b border-border-subtle flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Grid3x3 size={20} className="text-accent" />
          <h1 className="text-title font-semibold">Apps</h1>
          <Badge tone="default">{apps.length}</Badge>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search bundle IDs…"
            className="w-64 bg-elevated border border-border-default rounded-md pl-8 pr-3 py-1.5 text-[13px] focus:outline-none focus:border-accent"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {filtered.length === 0 ? (
          <EmptyState icon={<Grid3x3 size={36} />} title="No apps recorded in this backup" />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {filtered.map((a) => (
              <div key={a} className="flex items-center gap-2 px-3 py-2 rounded-md bg-surface border border-border-subtle">
                <div className="w-7 h-7 rounded-md bg-accent/15 border border-accent/30 flex items-center justify-center text-caption font-semibold text-accent">
                  {bundleInitial(a)}
                </div>
                <span className="mono text-caption truncate">{a}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function bundleInitial(bundle: string): string {
  const parts = bundle.split('.');
  const last = parts[parts.length - 1] || bundle;
  return (last[0] || '?').toUpperCase();
}

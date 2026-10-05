import { useEffect, useMemo, useState } from 'react';
import { Compass, Search, ExternalLink } from 'lucide-react';
import { Spinner, EmptyState, Badge } from '../components/ui';
import { engineCall } from '../lib/ipc';

interface Visit {
  visit_id: string;
  url: string;
  title: string;
  domain: string;
  visit_date: string;
  browser: string;
  visit_count: number;
}

export default function SafariSection({ handle }: { handle: string }) {
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setLoading(true);
    engineCall<{ visits: Visit[] }>('list_browser_history', { handle })
      .then((r) => setVisits(r.visits || []))
      .finally(() => setLoading(false));
  }, [handle]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? visits.filter((v) => (v.url + ' ' + v.title + ' ' + v.domain).toLowerCase().includes(q)) : visits;
  }, [visits, query]);

  if (loading) return <div className="h-full flex items-center justify-center"><Spinner label="Loading history…" /></div>;

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-6 pb-3 border-b border-border-subtle flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Compass size={20} className="text-accent" />
          <h1 className="text-title font-semibold">Safari History</h1>
          <Badge tone="default">{visits.length}</Badge>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search URLs…"
            className="w-64 bg-elevated border border-border-default rounded-md pl-8 pr-3 py-1.5 text-[13px] focus:outline-none focus:border-accent" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? <EmptyState icon={<Compass size={36} />} title="No history" /> : (
          <div className="divide-y divide-border-subtle">
            {filtered.map((v) => (
              <div key={v.visit_id} className="px-6 py-2.5 hover:bg-elevated/60">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] font-medium truncate">{v.title || v.domain || v.url}</span>
                  <span className="text-caption text-text-tertiary whitespace-nowrap">{v.visit_date ? new Date(v.visit_date).toLocaleString() : ''}</span>
                </div>
                <div className="flex items-center gap-1 text-caption text-text-tertiary mono truncate">
                  <ExternalLink size={11} /> {v.url}
                  {v.visit_count > 1 && <span className="ml-2 text-text-tertiary">· {v.visit_count}×</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

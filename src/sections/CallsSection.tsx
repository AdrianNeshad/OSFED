import { useEffect, useMemo, useState } from 'react';
import { PhoneCall, ArrowDownLeft, ArrowUpRight, PhoneMissed, Search } from 'lucide-react';
import { Spinner, EmptyState, Badge } from '../components/ui';
import { engineCall } from '../lib/ipc';

interface Call {
  call_id: number;
  address: string;
  contact_name: string;
  date: string;
  duration: number;
  direction: string;
  status: string;
  app: string;
}

export default function CallsSection({ handle }: { handle: string }) {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setLoading(true);
    engineCall<{ calls: Call[] }>('list_calls', { handle })
      .then((r) => setCalls(r.calls || []))
      .finally(() => setLoading(false));
  }, [handle]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? calls.filter((c) => (c.address + ' ' + c.contact_name).toLowerCase().includes(q)) : calls;
  }, [calls, query]);

  if (loading) return <div className="h-full flex items-center justify-center"><Spinner label="Loading calls…" /></div>;

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-6 pb-3 border-b border-border-subtle flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PhoneCall size={20} className="text-accent" />
          <h1 className="text-title font-semibold">Call Log</h1>
          <Badge tone="default">{calls.length}</Badge>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search number…"
            className="w-56 bg-elevated border border-border-default rounded-md pl-8 pr-3 py-1.5 text-[13px] focus:outline-none focus:border-accent" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? <EmptyState icon={<PhoneCall size={36} />} title="No calls" /> : (
          <table className="w-full text-[13px]">
            <tbody>
              {filtered.map((c) => {
                const Icon = c.status === 'missed' ? PhoneMissed : c.direction === 'outgoing' ? ArrowUpRight : ArrowDownLeft;
                return (
                  <tr key={c.call_id} className="border-b border-border-subtle hover:bg-elevated/60">
                    <td className="pl-6 pr-2 py-2.5 w-8">
                      <Icon size={15} className={c.status === 'missed' ? 'text-error' : 'text-text-tertiary'} />
                    </td>
                    <td className="px-2 py-2.5 font-medium">{c.contact_name || c.address || 'Unknown'}</td>
                    <td className="px-2 py-2.5 text-text-tertiary capitalize">{c.direction}</td>
                    <td className="px-2 py-2.5 text-text-tertiary">{c.duration ? `${Math.round(c.duration)}s` : '—'}</td>
                    <td className="px-2 py-2.5 text-text-tertiary">{c.app}</td>
                    <td className="px-6 py-2.5 text-text-tertiary text-right whitespace-nowrap">{c.date ? new Date(c.date).toLocaleString() : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

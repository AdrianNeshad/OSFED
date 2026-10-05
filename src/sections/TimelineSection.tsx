import { useEffect, useMemo, useState } from 'react';
import {
  Clock, MessageSquare, PhoneCall, Image as ImageIcon, StickyNote, Compass,
  Search, ArrowDownLeft, ArrowUpRight, PhoneMissed,
} from 'lucide-react';
import { Spinner, EmptyState, Badge } from '../components/ui';
import { engineCall } from '../lib/ipc';
import {
  TimelineEntry, TimelineType, TimelineResult, TYPE_ORDER,
  buildContactIndex, resolveName,
} from '../lib/timeline';

const TYPE_META: Record<TimelineType, { label: string; icon: any; color: string }> = {
  message: { label: 'Messages', icon: MessageSquare, color: 'text-imessage-blue' },
  call: { label: 'Calls', icon: PhoneCall, color: 'text-success' },
  photo: { label: 'Photos', icon: ImageIcon, color: 'text-warning' },
  note: { label: 'Notes', icon: StickyNote, color: 'text-accent' },
  browser: { label: 'Safari', icon: Compass, color: 'text-info' },
};

const PAGE = 120;

export default function TimelineSection({ handle }: { handle: string }) {
  const [data, setData] = useState<TimelineResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [types, setTypes] = useState<Set<TimelineType>>(new Set(TYPE_ORDER));
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError('');
    engineCall<TimelineResult>('timeline', { handle })
      .then(setData)
      .catch((e) => setError(e.message || String(e)))
      .finally(() => setLoading(false));
  }, [handle]);

  const contactIdx = useMemo(() => buildContactIndex(data?.contacts || []), [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const fromMs = from ? new Date(from + 'T00:00:00').getTime() : null;
    const toMs = to ? new Date(to + 'T23:59:59').getTime() : null;
    return data.entries.filter((e) => {
      if (!types.has(e.type)) return false;
      if (fromMs || toMs) {
        if (!e.timestamp) return false;
        const ts = new Date(e.timestamp).getTime();
        if (fromMs && ts < fromMs) return false;
        if (toMs && ts > toMs) return false;
      }
      if (q) {
        const hay = [
          resolveName(e, contactIdx), e.message?.text, e.message?.conversationName,
          e.call?.app, e.photo?.filename, e.note?.title, e.note?.bodyPreview,
          e.browser?.title, e.browser?.domain, e.browser?.url,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, types, query, from, to, contactIdx]);

  useEffect(() => setPage(0), [types, query, from, to]);

  const pageEntries = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.ceil(filtered.length / PAGE);

  const toggleType = (t: TimelineType) => {
    setTypes((prev) => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });
  };

  if (loading) return <div className="h-full flex items-center justify-center"><Spinner label="Building timeline…" /></div>;
  if (error) return <EmptyState icon={<Clock size={40} />} title="Timeline unavailable">{error}</EmptyState>;

  return (
    <div className="h-full flex flex-col">
      {/* header + filters */}
      <div className="px-6 pt-6 pb-3 border-b border-border-subtle">
        <div className="flex items-center gap-2 mb-4">
          <Clock size={20} className="text-accent" />
          <h1 className="text-title font-semibold">Timeline</h1>
          <Badge tone="accent">{filtered.length.toLocaleString()} events</Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {TYPE_ORDER.map((t) => {
            const meta = TYPE_META[t];
            const Icon = meta.icon;
            const active = types.has(t);
            const count = data?.counts[t] || 0;
            return (
              <button
                key={t}
                onClick={() => toggleType(t)}
                className={[
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[13px] border transition-colors',
                  active ? 'bg-elevated border-border-strong text-text-primary' : 'border-border-subtle text-text-tertiary',
                ].join(' ')}
              >
                <Icon size={14} className={active ? meta.color : ''} /> {meta.label}
                <span className="text-caption opacity-70">{count}</span>
              </button>
            );
          })}
          <div className="flex-1" />
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="bg-elevated border border-border-default rounded-md px-2 py-1.5 text-caption focus:outline-none focus:border-accent" />
          <span className="text-text-tertiary text-caption">→</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="bg-elevated border border-border-default rounded-md px-2 py-1.5 text-caption focus:outline-none focus:border-accent" />
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…"
              className="w-52 bg-elevated border border-border-default rounded-md pl-8 pr-3 py-1.5 text-[13px] focus:outline-none focus:border-accent" />
          </div>
        </div>
      </div>

      {/* list */}
      <div className="flex-1 overflow-y-auto">
        {pageEntries.length === 0 ? (
          <EmptyState icon={<Clock size={36} />} title="No events match the filters" />
        ) : (
          <div className="max-w-3xl mx-auto px-6 py-4 space-y-2">
            {pageEntries.map((e) => <EntryCard key={e.id} entry={e} name={resolveName(e, contactIdx)} />)}
          </div>
        )}
      </div>

      {/* pager */}
      {pages > 1 && (
        <div className="border-t border-border-subtle px-6 py-2 flex items-center justify-center gap-3 text-[13px]">
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="disabled:opacity-30 hover:text-accent">Prev</button>
          <span className="text-text-tertiary">Page {page + 1} / {pages}</span>
          <button disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} className="disabled:opacity-30 hover:text-accent">Next</button>
        </div>
      )}
    </div>
  );
}

function fmtTime(ts: string): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function EntryCard({ entry, name }: { entry: TimelineEntry; name: string }) {
  const meta = TYPE_META[entry.type];
  const Icon = meta.icon;
  return (
    <div className="flex gap-3 p-3 rounded-lg bg-surface border border-border-subtle">
      <div className={`w-8 h-8 rounded-md bg-elevated flex items-center justify-center shrink-0 ${meta.color}`}>
        <Icon size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-medium truncate">{name || meta.label}</span>
          <span className="text-caption text-text-tertiary whitespace-nowrap">{fmtTime(entry.timestamp)}</span>
        </div>
        <EntryBody entry={entry} />
      </div>
    </div>
  );
}

function EntryBody({ entry }: { entry: TimelineEntry }) {
  if (entry.message) {
    const m = entry.message;
    return (
      <div className="text-[13px] text-text-secondary mt-0.5">
        <span className={m.isFromMe ? 'text-accent font-medium' : 'font-medium'}>{m.isFromMe ? 'You' : m.sender || 'Them'}:</span>{' '}
        <span className="break-words">{m.text || <em className="text-text-tertiary">[no text]</em>}</span>
      </div>
    );
  }
  if (entry.call) {
    const c = entry.call;
    const DirIcon = c.status === 'missed' ? PhoneMissed : c.direction === 'outgoing' ? ArrowUpRight : ArrowDownLeft;
    return (
      <div className="text-[13px] text-text-secondary mt-0.5 flex items-center gap-1.5">
        <DirIcon size={13} className={c.status === 'missed' ? 'text-error' : 'text-text-tertiary'} />
        {c.direction} · {c.status}{c.duration ? ` · ${Math.round(c.duration)}s` : ''}{c.app ? ` · ${c.app}` : ''}
      </div>
    );
  }
  if (entry.photo) {
    const p = entry.photo;
    return <div className="text-[13px] text-text-secondary mt-0.5 mono truncate">{p.kind === 'video' ? '🎬' : '🖼'} {p.filename}</div>;
  }
  if (entry.note) {
    const n = entry.note;
    return (
      <div className="text-[13px] text-text-secondary mt-0.5">
        <span className="font-medium">{n.title || 'Untitled'}</span>
        {n.bodyPreview && <span className="text-text-tertiary"> — {n.bodyPreview}</span>}
      </div>
    );
  }
  if (entry.browser) {
    const b = entry.browser;
    return (
      <div className="text-[13px] text-text-secondary mt-0.5">
        <div className="truncate">{b.title || b.domain}</div>
        <div className="text-caption text-text-tertiary mono truncate">{b.url}</div>
      </div>
    );
  }
  return null;
}

import { useEffect, useMemo, useState } from 'react';
import { StickyNote, Search } from 'lucide-react';
import { Spinner, EmptyState } from '../components/ui';
import { engineCall } from '../lib/ipc';

interface Note {
  note_id: number;
  title: string;
  body: string;
  folder: string;
  created: string;
  modified: string;
}

export default function NotesSection({ handle }: { handle: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Note | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setLoading(true);
    engineCall<{ notes: Note[] }>('list_notes', { handle })
      .then((r) => { setNotes(r.notes || []); setSel((r.notes || [])[0] || null); })
      .finally(() => setLoading(false));
  }, [handle]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? notes.filter((n) => (n.title + ' ' + n.body).toLowerCase().includes(q)) : notes;
  }, [notes, query]);

  if (loading) return <div className="h-full flex items-center justify-center"><Spinner label="Loading notes…" /></div>;

  return (
    <div className="h-full flex">
      <div className="w-80 shrink-0 border-r border-border-subtle flex flex-col">
        <div className="p-3 border-b border-border-subtle flex items-center gap-2">
          <StickyNote size={18} className="text-accent" />
          <span className="text-subhead font-semibold">Notes</span>
        </div>
        <div className="p-2 border-b border-border-subtle">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes…"
              className="w-full bg-elevated border border-border-default rounded-md pl-8 pr-3 py-1.5 text-caption focus:outline-none focus:border-accent" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.map((n) => (
            <button key={n.note_id} onClick={() => setSel(n)}
              className={`w-full text-left px-3 py-2.5 border-b border-border-subtle ${sel?.note_id === n.note_id ? 'bg-accent/10' : 'hover:bg-elevated'}`}>
              <div className={`text-[13px] font-medium truncate ${sel?.note_id === n.note_id ? 'text-accent' : ''}`}>{n.title || 'Untitled'}</div>
              <div className="text-caption text-text-tertiary truncate">{n.body?.slice(0, 60) || '—'}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {!sel ? <EmptyState icon={<StickyNote size={36} />} title="No note selected" /> : (
          <div className="max-w-2xl mx-auto px-8 py-8">
            <h1 className="text-title font-semibold mb-1">{sel.title || 'Untitled'}</h1>
            <div className="text-caption text-text-tertiary mb-5">
              {sel.modified ? `Modified ${new Date(sel.modified).toLocaleString()}` : ''}
            </div>
            <div className="text-[14px] leading-relaxed whitespace-pre-wrap text-text-primary">{sel.body || <em className="text-text-tertiary">[empty]</em>}</div>
          </div>
        )}
      </div>
    </div>
  );
}

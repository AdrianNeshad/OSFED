import { useEffect, useMemo, useState } from 'react';
import { Users, Search, Phone, Mail, Building2 } from 'lucide-react';
import { Spinner, EmptyState, Badge } from '../components/ui';
import { engineCall } from '../lib/ipc';

interface Contact {
  name: string;
  organization: string;
  phones: string[];
  emails: string[];
}

export default function ContactsSection({ handle }: { handle: string }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setLoading(true);
    engineCall<{ contacts: Contact[] }>('list_contacts', { handle })
      .then((r) => setContacts(r.contacts || []))
      .finally(() => setLoading(false));
  }, [handle]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) =>
      [c.name, c.organization, ...c.phones, ...c.emails].filter(Boolean).join(' ').toLowerCase().includes(q)
    );
  }, [contacts, query]);

  if (loading) return <div className="h-full flex items-center justify-center"><Spinner label="Loading contacts…" /></div>;

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-6 pb-3 border-b border-border-subtle flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users size={20} className="text-accent" />
          <h1 className="text-title font-semibold">Contacts</h1>
          <Badge tone="default">{contacts.length}</Badge>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search contacts…"
            className="w-56 bg-elevated border border-border-default rounded-md pl-8 pr-3 py-1.5 text-[13px] focus:outline-none focus:border-accent" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {filtered.length === 0 ? <EmptyState icon={<Users size={36} />} title="No contacts" /> : (
          <div className="grid grid-cols-2 gap-2">
            {filtered.map((c, i) => (
              <div key={i} className="bg-surface border border-border-subtle rounded-lg p-3">
                <div className="font-medium text-[13px]">{c.name || 'Unnamed'}</div>
                {c.organization && (
                  <div className="text-caption text-text-tertiary flex items-center gap-1 mt-0.5"><Building2 size={11} /> {c.organization}</div>
                )}
                <div className="mt-2 space-y-1">
                  {c.phones.map((p, j) => (
                    <div key={`p${j}`} className="text-caption text-text-secondary flex items-center gap-1.5 mono"><Phone size={11} className="text-text-tertiary" /> {p}</div>
                  ))}
                  {c.emails.map((em, j) => (
                    <div key={`e${j}`} className="text-caption text-text-secondary flex items-center gap-1.5 mono"><Mail size={11} className="text-text-tertiary" /> {em}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

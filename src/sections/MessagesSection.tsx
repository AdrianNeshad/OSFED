import { useEffect, useMemo, useState } from 'react';
import { MessageSquare, Search } from 'lucide-react';
import { Spinner, EmptyState } from '../components/ui';
import { engineCall } from '../lib/ipc';

interface Conversation {
  chat_id: number;
  chat_identifier: string;
  display_name: string;
  service: string;
  message_count: number;
  last_message_date: string;
}
interface Message {
  message_id: number;
  text: string;
  date: string;
  is_from_me: boolean;
  sender: string;
  service: string;
  is_reaction: boolean;
}

export default function MessagesSection({ handle }: { handle: string }) {
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setLoading(true);
    engineCall<{ conversations: Conversation[] }>('list_conversations', { handle })
      .then((r) => setConvs(r.conversations || []))
      .finally(() => setLoading(false));
  }, [handle]);

  useEffect(() => {
    if (!sel) return;
    setLoadingMsgs(true);
    engineCall<{ messages: Message[] }>('get_messages', { handle, chat_id: sel.chat_id, offset: 0, limit: 2000 })
      .then((r) => setMessages((r.messages || []).filter((m) => !m.is_reaction)))
      .finally(() => setLoadingMsgs(false));
  }, [handle, sel]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? convs.filter((c) => (c.display_name || c.chat_identifier).toLowerCase().includes(q)) : convs;
    return list;
  }, [convs, query]);

  return (
    <div className="h-full flex">
      <div className="w-80 shrink-0 border-r border-border-subtle flex flex-col">
        <div className="p-3 border-b border-border-subtle flex items-center gap-2">
          <MessageSquare size={18} className="text-accent" />
          <span className="text-subhead font-semibold">Messages</span>
        </div>
        <div className="p-2 border-b border-border-subtle">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats…"
              className="w-full bg-elevated border border-border-default rounded-md pl-8 pr-3 py-1.5 text-caption focus:outline-none focus:border-accent" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? <div className="p-4"><Spinner label="Loading…" /></div> :
            filtered.map((c) => (
              <button key={c.chat_id} onClick={() => setSel(c)}
                className={`w-full text-left px-3 py-2.5 border-b border-border-subtle ${sel?.chat_id === c.chat_id ? 'bg-accent/10' : 'hover:bg-elevated'}`}>
                <div className={`text-[13px] font-medium truncate ${sel?.chat_id === c.chat_id ? 'text-accent' : ''}`}>{c.display_name || c.chat_identifier}</div>
                <div className="text-caption text-text-tertiary flex justify-between">
                  <span>{c.message_count} msgs</span>
                  <span>{c.last_message_date ? new Date(c.last_message_date).toLocaleDateString() : ''}</span>
                </div>
              </button>
            ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {!sel ? (
          <EmptyState icon={<MessageSquare size={36} />} title="Select a conversation" />
        ) : loadingMsgs ? (
          <div className="h-full flex items-center justify-center"><Spinner label="Loading messages…" /></div>
        ) : (
          <>
            <div className="px-5 py-3 border-b border-border-subtle">
              <div className="font-semibold">{sel.display_name || sel.chat_identifier}</div>
              <div className="text-caption text-text-tertiary">{sel.service} · {sel.chat_identifier}</div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1.5">
              {messages.map((m) => (
                <div key={m.message_id} className={`flex ${m.is_from_me ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[70%] rounded-2xl px-3.5 py-2 text-[13px] ${m.is_from_me ? 'bg-imessage-blue text-white' : 'bg-elevated'}`}>
                    {m.text || <em className="opacity-60">[no text]</em>}
                    <div className={`text-[10px] mt-1 ${m.is_from_me ? 'text-white/70' : 'text-text-tertiary'}`}>
                      {m.date ? new Date(m.date).toLocaleString() : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

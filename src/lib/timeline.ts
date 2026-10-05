export type TimelineType = 'message' | 'call' | 'photo' | 'note' | 'browser';

export interface TimelineEntry {
  id: string;
  type: TimelineType;
  timestamp: string;
  contactName: string;
  contactIdentifier: string;
  message?: {
    text: string;
    isFromMe: boolean;
    sender: string;
    messageType: string;
    conversationName: string;
    service: string;
  };
  call?: { direction: string; status: string; duration: number; app: string };
  photo?: { filename: string; fileHash: string; kind: string; width: number; height: number; duration: number };
  note?: { noteId: number; title: string; bodyPreview: string; body: string; modified: string };
  browser?: { url: string; title: string; domain: string; browserName: string };
}

export interface TimelineContact {
  name: string;
  organization: string;
  phones: string[];
  emails: string[];
}

export interface TimelineResult {
  entries: TimelineEntry[];
  counts: Record<TimelineType, number>;
  contacts: TimelineContact[];
  total: number;
}

export const TYPE_ORDER: TimelineType[] = ['message', 'call', 'photo', 'note', 'browser'];

export function normPhone(s: string): string {
  const d = (s || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : d;
}

/** Build a map from any identifier form → contact display name. */
export function buildContactIndex(contacts: TimelineContact[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of contacts) {
    if (!c.name) continue;
    for (const p of c.phones) {
      const np = normPhone(p);
      if (np) m.set(np, c.name);
      m.set(p, c.name);
    }
    for (const e of c.emails) m.set(e.toLowerCase(), c.name);
  }
  return m;
}

export function resolveName(entry: TimelineEntry, idx: Map<string, string>): string {
  if (entry.contactName) return entry.contactName;
  const id = entry.contactIdentifier;
  if (!id) return '';
  const np = normPhone(id);
  return idx.get(np) || idx.get(id) || idx.get(id.toLowerCase()) || id;
}

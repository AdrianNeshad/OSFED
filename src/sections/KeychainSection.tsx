import { useEffect, useMemo, useState } from 'react';
import {
  KeyRound, Search, Eye, EyeOff, Copy, Check, Globe, Lock, FileText, Shield, X, Download,
} from 'lucide-react';
import { Spinner, EmptyState, Badge, Button } from '../components/ui';
import { engineCall } from '../lib/ipc';
import type { KeychainDump, KeychainEntry, KeychainClass, KeychainSecret } from '../lib/types';

const CLASS_META: { id: KeychainClass; label: string; icon: any }[] = [
  { id: 'general', label: 'Generic', icon: KeyRound },
  { id: 'internet', label: 'Internet', icon: Globe },
  { id: 'keys', label: 'Keys', icon: Lock },
  { id: 'certs', label: 'Certificates', icon: FileText },
];

function secretText(s: KeychainSecret | null): string {
  if (!s) return '';
  if (s.isText) return s.text || '';
  return s.base64 ? `base64:${s.base64}` : s.hex ? `hex:${s.hex}` : `<${s.len ?? 0} bytes>`;
}

export default function KeychainSection({ handle }: { handle: string }) {
  const [dump, setDump] = useState<KeychainDump | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cls, setCls] = useState<KeychainClass>('general');
  const [query, setQuery] = useState('');
  const [revealAll, setRevealAll] = useState(false);
  const [selected, setSelected] = useState<KeychainEntry | null>(null);

  useEffect(() => {
    setLoading(true);
    setError('');
    setDump(null);
    setSelected(null);
    engineCall<KeychainDump>('dump_keychain', { handle })
      .then((d) => {
        setDump(d);
        // Auto-select the first non-empty class.
        const first = CLASS_META.find((c) => (d.counts[c.id] || 0) > 0);
        if (first) setCls(first.id);
      })
      .catch((e) => setError(e.message || String(e)))
      .finally(() => setLoading(false));
  }, [handle]);

  const entries = dump ? dump[cls] : [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => {
      const s = e.summary;
      return [s.account, s.service, s.label, s.server, s.accessGroup, secretText(s.secret)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [entries, query]);

  if (loading) {
    return <div className="h-full flex items-center justify-center"><Spinner label="Decrypting keychain…" /></div>;
  }

  if (error) {
    const friendly =
      error.includes('KEYCHAIN_UNAVAILABLE') ? 'The keychain is only present in encrypted backups.' :
      error.includes('KEYCHAIN_NOT_FOUND') ? 'This backup does not contain a keychain file.' :
      error;
    return (
      <EmptyState icon={<Shield size={40} />} title="Keychain unavailable">{friendly}</EmptyState>
    );
  }

  const total = dump ? Object.values(dump.counts).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="h-full flex flex-col">
      {/* header */}
      <div className="px-6 pt-6 pb-3 border-b border-border-subtle">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <KeyRound size={20} className="text-accent" />
            <h1 className="text-title font-semibold">Keychain</h1>
            <Badge tone="accent">{total} items</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setRevealAll((v) => !v)}>
              {revealAll ? <><EyeOff size={14} /> Hide secrets</> : <><Eye size={14} /> Reveal all</>}
            </Button>
            <Button variant="ghost" onClick={() => exportJson(dump!)}><Download size={14} /> Export JSON</Button>
          </div>
        </div>

        {/* class tabs */}
        <div className="flex items-center gap-1">
          {CLASS_META.map((c) => {
            const count = dump?.counts[c.id] || 0;
            const Icon = c.icon;
            const active = cls === c.id;
            return (
              <button
                key={c.id}
                onClick={() => { setCls(c.id); setSelected(null); }}
                disabled={count === 0}
                className={[
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] transition-colors',
                  active ? 'bg-accent/15 text-accent' : count === 0 ? 'text-text-tertiary/40' : 'text-text-secondary hover:bg-elevated',
                ].join(' ')}
              >
                <Icon size={14} /> {c.label}
                <span className="text-caption opacity-70">{count}</span>
              </button>
            );
          })}
          <div className="flex-1" />
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="w-56 bg-elevated border border-border-default rounded-md pl-8 pr-3 py-1.5 text-[13px] focus:outline-none focus:border-accent"
            />
          </div>
        </div>
      </div>

      {/* body: table + detail */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <EmptyState icon={<KeyRound size={36} />} title="No matching items" />
          ) : (
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-base/95 backdrop-blur border-b border-border-subtle text-caption text-text-tertiary uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-6 py-2">{cls === 'internet' ? 'Server' : 'Service'}</th>
                  <th className="text-left font-medium px-3 py-2">Account</th>
                  <th className="text-left font-medium px-3 py-2">Secret</th>
                  <th className="text-left font-medium px-3 py-2">Access group</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e, i) => (
                  <KeychainRow key={i} entry={e} cls={cls} reveal={revealAll} onClick={() => setSelected(e)} selected={selected === e} />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selected && <KeychainDetail entry={selected} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}

function KeychainRow({
  entry, cls, reveal, onClick, selected,
}: {
  entry: KeychainEntry; cls: KeychainClass; reveal: boolean; onClick: () => void; selected: boolean;
}) {
  const [show, setShow] = useState(false);
  const s = entry.summary;
  const primary = cls === 'internet' ? (s.server || s.service) : (s.service || s.label);
  const secret = secretText(s.secret);
  const visible = reveal || show;

  return (
    <tr
      onClick={onClick}
      className={`border-b border-border-subtle cursor-pointer ${selected ? 'bg-accent/10' : 'hover:bg-elevated/60'}`}
    >
      <td className="px-6 py-2.5 max-w-[220px] truncate">{primary || <span className="text-text-tertiary">—</span>}</td>
      <td className="px-3 py-2.5 max-w-[180px] truncate">{s.account || <span className="text-text-tertiary">—</span>}</td>
      <td className="px-3 py-2.5 max-w-[240px]">
        {secret ? (
          <div className="flex items-center gap-1.5">
            <span className="mono truncate">{visible ? secret : '••••••••'}</span>
            <button
              onClick={(ev) => { ev.stopPropagation(); setShow((v) => !v); }}
              className="text-text-tertiary hover:text-text-primary shrink-0"
            >
              {visible ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
            <CopyBtn value={secret} />
          </div>
        ) : (
          <span className="text-text-tertiary">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 max-w-[180px] truncate text-text-secondary mono text-caption">{s.accessGroup}</td>
    </tr>
  );
}

function CopyBtn({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className="text-text-tertiary hover:text-text-primary shrink-0"
      title="Copy"
    >
      {done ? <Check size={13} className="text-success" /> : <Copy size={13} />}
    </button>
  );
}

function KeychainDetail({ entry, onClose }: { entry: KeychainEntry; onClose: () => void }) {
  const s = entry.summary;
  const rawKeys = Object.keys(entry.raw).sort();
  return (
    <div className="w-[360px] shrink-0 border-l border-border-subtle bg-surface overflow-y-auto">
      <div className="sticky top-0 bg-surface/95 backdrop-blur px-4 py-3 border-b border-border-subtle flex items-center justify-between">
        <span className="text-subhead font-semibold truncate">{s.service || s.server || s.account || 'Item'}</span>
        <button onClick={onClose} className="text-text-tertiary hover:text-text-primary"><X size={16} /></button>
      </div>
      <div className="p-4 space-y-4">
        <Field label="Account" value={s.account} />
        <Field label="Service" value={s.service} />
        <Field label="Server" value={s.server} />
        <Field label="Label" value={s.label} />
        <Field label="Access group" value={s.accessGroup} mono />
        <Field label="Accessible" value={s.accessible} mono />
        <Field label="Created" value={s.created || ''} />
        <Field label="Modified" value={s.modified || ''} />
        <SecretField secret={s.secret} />

        <div>
          <div className="text-caption text-text-tertiary uppercase tracking-wide mb-1">Raw attributes</div>
          <div className="bg-base rounded-md border border-border-subtle divide-y divide-border-subtle">
            {rawKeys.map((k) => (
              <div key={k} className="flex gap-2 px-3 py-1.5 text-caption">
                <span className="mono text-text-tertiary w-20 shrink-0">{k}</span>
                <span className="mono text-text-secondary break-all">{renderRaw(entry.raw[k])}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-caption text-text-tertiary uppercase tracking-wide mb-0.5">{label}</div>
      <div className={`text-[13px] break-all ${mono ? 'mono' : ''}`}>{value}</div>
    </div>
  );
}

function SecretField({ secret }: { secret: KeychainSecret | null }) {
  const [show, setShow] = useState(false);
  if (!secret) return null;
  const text = secretText(secret);
  return (
    <div>
      <div className="text-caption text-text-tertiary uppercase tracking-wide mb-0.5 flex items-center gap-2">
        Secret
        <button onClick={() => setShow((v) => !v)} className="text-text-tertiary hover:text-text-primary">
          {show ? <EyeOff size={12} /> : <Eye size={12} />}
        </button>
        <CopyBtn value={text} />
      </div>
      <div className="mono text-[13px] break-all bg-base rounded-md border border-border-subtle p-2">
        {show ? text : '•'.repeat(Math.min(24, text.length || 8))}
      </div>
    </div>
  );
}

function renderRaw(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'object') {
    const o = v as any;
    if (o.__bytes__) return o.utf8 ? o.utf8 : `hex:${o.hex}`;
    return JSON.stringify(o);
  }
  return String(v);
}

function exportJson(dump: KeychainDump) {
  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'keychain.json';
  a.click();
  URL.revokeObjectURL(url);
}

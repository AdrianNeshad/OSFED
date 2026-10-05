import { useEffect, useMemo, useState } from 'react';
import { FolderTree, Search, Download, Database, Check } from 'lucide-react';
import { Spinner, EmptyState, Button, formatBytes, Badge } from '../components/ui';
import { engineCall } from '../lib/ipc';
import type { DomainInfo, FileRecord } from '../lib/types';

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

export default function FilesSection({ handle }: { handle: string }) {
  const [domains, setDomains] = useState<DomainInfo[]>([]);
  const [domain, setDomain] = useState<string>('*');
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [query, setQuery] = useState('');
  const [loadingDomains, setLoadingDomains] = useState(true);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [domFilter, setDomFilter] = useState('');

  const [selected, setSelected] = useState<FileRecord | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    setLoadingDomains(true);
    engineCall<{ domains: DomainInfo[] }>('list_domains', { handle })
      .then((r) => setDomains(r.domains || []))
      .finally(() => setLoadingDomains(false));
  }, [handle]);

  useEffect(() => {
    setLoadingFiles(true);
    setSelected(null);
    engineCall<{ files: FileRecord[]; total: number; truncated: boolean }>('list_files', { handle, domain, query, limit: 3000 })
      .then((r) => { setFiles(r.files || []); setTotal(r.total); setTruncated(r.truncated); })
      .finally(() => setLoadingFiles(false));
  }, [handle, domain, query]);

  const filteredDomains = useMemo(() => {
    const q = domFilter.trim().toLowerCase();
    return q ? domains.filter((d) => d.domain.toLowerCase().includes(q)) : domains;
  }, [domains, domFilter]);

  const download = async () => {
    if (!selected) return;
    const dest = await window.osfed.saveFile(basename(selected.path));
    if (!dest) return;
    setDownloading(true);
    setJustSaved(false);
    try {
      await engineCall<{ bytes: number; dest: string }>('export_file', {
        handle, id: selected.id, domain: selected.domain, path: selected.path, dest,
      });
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    } catch (e: any) {
      alert(`Download failed: ${e.message || e}`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-6 pb-3 border-b border-border-subtle flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderTree size={20} className="text-accent" />
          <h1 className="text-title font-semibold">File Browser</h1>
          <Badge tone="default">{total.toLocaleString()} files</Badge>
        </div>
        <Button variant="primary" onClick={download} disabled={!selected || downloading}>
          {downloading ? <Spinner /> : justSaved ? <><Check size={14} /> Saved</> : <><Download size={14} /> Download file</>}
        </Button>
      </div>

      {/* selected-file hint */}
      {selected && (
        <div className="px-6 py-1.5 border-b border-border-subtle text-caption text-text-tertiary truncate">
          Selected: <span className="mono text-text-secondary">{selected.path}</span> · {formatBytes(selected.bytes)}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* domains */}
        <div className="w-72 shrink-0 border-r border-border-subtle flex flex-col">
          <div className="p-2 border-b border-border-subtle">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input
                value={domFilter}
                onChange={(e) => setDomFilter(e.target.value)}
                placeholder="Filter domains…"
                className="w-full bg-elevated border border-border-default rounded-md pl-8 pr-3 py-1.5 text-caption focus:outline-none focus:border-accent"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            <button
              onClick={() => setDomain('*')}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-[13px] border-b border-border-subtle ${domain === '*' ? 'bg-accent/10 text-accent' : 'hover:bg-elevated'}`}
            >
              <span className="flex items-center gap-2"><Database size={13} /> All domains</span>
            </button>
            {loadingDomains ? (
              <div className="p-4"><Spinner label="Loading…" /></div>
            ) : (
              filteredDomains.map((d) => (
                <button
                  key={d.domain}
                  onClick={() => setDomain(d.domain)}
                  className={`w-full text-left px-3 py-2 border-b border-border-subtle ${domain === d.domain ? 'bg-accent/10' : 'hover:bg-elevated'}`}
                >
                  <div className={`text-[13px] truncate ${domain === d.domain ? 'text-accent' : ''}`}>{d.domain}</div>
                  <div className="text-caption text-text-tertiary">{d.files} files · {formatBytes(d.bytes)}</div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* files */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="p-2 border-b border-border-subtle">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search file paths…"
                className="w-full bg-elevated border border-border-default rounded-md pl-8 pr-3 py-1.5 text-[13px] focus:outline-none focus:border-accent"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingFiles ? (
              <div className="p-6"><Spinner label="Loading files…" /></div>
            ) : files.length === 0 ? (
              <EmptyState icon={<FolderTree size={36} />} title="No files" />
            ) : (
              <table className="w-full text-[13px]">
                <tbody>
                  {files.map((f) => {
                    const isSel = selected?.id === f.id;
                    return (
                      <tr
                        key={f.id}
                        onClick={() => setSelected(f)}
                        onDoubleClick={download}
                        className={`border-b border-border-subtle cursor-pointer ${isSel ? 'bg-accent/10' : 'hover:bg-elevated/60'}`}
                      >
                        <td className={`px-4 py-2 mono break-all ${isSel ? 'text-accent' : 'text-text-primary'}`}>{f.path}</td>
                        {domain === '*' && <td className="px-3 py-2 text-caption text-text-tertiary whitespace-nowrap">{f.domain}</td>}
                        <td className="px-4 py-2 text-caption text-text-tertiary text-right whitespace-nowrap">{formatBytes(f.bytes)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {truncated && (
              <div className="px-4 py-3 text-caption text-text-tertiary">Showing first {files.length.toLocaleString()} of {total.toLocaleString()} — refine with search.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

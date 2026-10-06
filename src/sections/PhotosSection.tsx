import { useEffect, useMemo, useRef, useState } from 'react';
import { Image as ImageIcon, Video, Search } from 'lucide-react';
import { Spinner, EmptyState, Badge, formatBytes } from '../components/ui';
import { engineCall } from '../lib/ipc';

interface Photo {
  uuid: string;
  filename: string;
  file_hash: string;
  kind: string;
  date_created: string;
  bytes: number;
  rel_path: string;
}

// PhotoTile lazily loads a real thumbnail when scrolled into view, and opens the
// full file in the OS viewer on click (so HEIC/video — which can't render in the
// app — are still viewable). Styling is identical to the previous placeholder
// tile; only the inner preview + click-to-open are added.
function PhotoTile({ handle, photo }: { handle: string; photo: Photo }) {
  const [thumb, setThumb] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const tried = useRef(false);

  useEffect(() => {
    if (photo.kind === 'video') return; // videos keep the icon; still openable
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !tried.current) {
        tried.current = true;
        io.disconnect();
        engineCall<{ dataUrl?: string; unsupported?: boolean }>('get_photo_thumb', {
          handle, id: photo.file_hash, domain: 'CameraRollDomain', path: photo.rel_path, max: 256,
        }).then((r) => { if (r?.dataUrl) setThumb(r.dataUrl); }).catch(() => {});
      }
    }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [handle, photo]);

  const open = async () => {
    setOpening(true);
    try {
      const r = await engineCall<{ path: string }>('export_to_temp', {
        handle, id: photo.file_hash, domain: 'CameraRollDomain', path: photo.rel_path,
      });
      await window.osfed.openPath(r.path);
    } catch {
      /* ignore — opening is best-effort */
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="bg-surface border border-border-subtle rounded-lg p-3 flex flex-col gap-2">
      <div
        ref={ref}
        onClick={open}
        title="Click to open"
        className="aspect-square rounded-md bg-elevated flex items-center justify-center text-text-tertiary overflow-hidden cursor-pointer relative"
      >
        {thumb ? (
          <img src={thumb} alt={photo.filename} className="w-full h-full object-cover" loading="lazy" />
        ) : photo.kind === 'video' ? <Video size={28} /> : <ImageIcon size={28} />}
        {opening && <div className="absolute inset-0 bg-base/60 flex items-center justify-center"><Spinner /></div>}
      </div>
      <div className="text-caption mono truncate" title={photo.filename}>{photo.filename}</div>
      <div className="text-caption text-text-tertiary flex justify-between">
        <span>{formatBytes(photo.bytes)}</span>
        <span>{photo.date_created ? new Date(photo.date_created).toLocaleDateString() : ''}</span>
      </div>
    </div>
  );
}

export default function PhotosSection({ handle }: { handle: string }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | 'photo' | 'video'>('all');

  useEffect(() => {
    setLoading(true);
    engineCall<{ photos: Photo[]; total: number }>('list_photos', { handle, offset: 0, limit: 100000 })
      .then((r) => { setPhotos(r.photos || []); setTotal(r.total); })
      .finally(() => setLoading(false));
  }, [handle]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return photos.filter((p) => (kind === 'all' || p.kind === kind) && (!q || p.filename.toLowerCase().includes(q)));
  }, [photos, query, kind]);

  if (loading) return <div className="h-full flex items-center justify-center"><Spinner label="Scanning media…" /></div>;

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-6 pb-3 border-b border-border-subtle flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ImageIcon size={20} className="text-accent" />
          <h1 className="text-title font-semibold">Photos & Media</h1>
          <Badge tone="default">{total.toLocaleString()}</Badge>
        </div>
        <div className="flex items-center gap-2">
          {(['all', 'photo', 'video'] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)}
              className={`px-2.5 py-1.5 rounded-md text-caption capitalize ${kind === k ? 'bg-accent/15 text-accent' : 'text-text-tertiary hover:bg-elevated'}`}>{k}</button>
          ))}
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search filenames…"
              className="w-52 bg-elevated border border-border-default rounded-md pl-8 pr-3 py-1.5 text-[13px] focus:outline-none focus:border-accent" />
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {filtered.length === 0 ? <EmptyState icon={<ImageIcon size={36} />} title="No media found" >Media lives in the CameraRollDomain of the backup. Use the File Browser to restore the actual files.</EmptyState> : (
          <div className="grid grid-cols-4 gap-2">
            {filtered.slice(0, 2000).map((p) => (
              <PhotoTile key={p.uuid} handle={handle} photo={p} />
            ))}
          </div>
        )}
        {filtered.length > 2000 && <div className="text-caption text-text-tertiary mt-3">Showing first 2,000 of {filtered.length.toLocaleString()}.</div>}
      </div>
    </div>
  );
}

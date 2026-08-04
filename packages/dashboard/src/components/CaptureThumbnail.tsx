import { useState } from 'react';
import type { SourceItem } from '../lib/api';
import { Modal } from './Modal';
import { RelativeTime } from './RelativeTime';

export function CaptureThumbnail({ source, compact = false }: { source: SourceItem; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!source.capture) return null;
  const imageUrl = source.capture.fullUrl ?? source.capture.thumbnailUrl;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`group overflow-hidden rounded-lg border border-[#30363d] bg-[#090d13] text-left hover:border-[#58a6ff]/60 ${compact ? 'w-36' : 'w-full'}`}
      >
        <img
          src={source.capture.thumbnailUrl}
          alt={`Captured browser context for ${source.rawText || 'research evidence'}`}
          className={`${compact ? 'h-20' : 'h-32'} w-full object-cover transition-transform group-hover:scale-[1.02]`}
        />
        <span className="mono block truncate px-2 py-1.5 text-[9px] uppercase tracking-wider text-[#58a6ff]">view capture</span>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={source.rawText || 'Captured browser context'} wide>
        <img src={imageUrl} alt={source.rawText || 'Captured browser context'} className="max-h-[68vh] w-full rounded-lg border border-[#30363d] bg-black object-contain" />
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[#8b949e]">
          <RelativeTime date={source.capture.capturedAt} />
          <span>{source.capture.width} × {source.capture.height}</span>
          {!source.capture.fullUrl && <span className="text-[#d29922]">Full image evicted; retained thumbnail shown.</span>}
        </div>
        {source.url && <a href={source.url} target="_blank" rel="noopener noreferrer" className="mono mt-3 block truncate text-xs text-[#58a6ff] hover:underline">{source.url}</a>}
      </Modal>
    </>
  );
}

import { useNavigate } from 'react-router-dom';
import type { FeedEvent } from '../lib/api';
import { RelativeTime } from './RelativeTime';

interface FeedCardProps {
  event: FeedEvent;
  onClick?: () => void;
}

const TYPE_STYLES: Record<FeedEvent['type'], { border: string; label: string; color: string }> = {
  reopen: { border: 'border-l-[#d29922]', label: 'REOPEN', color: 'text-[#d29922]' },
  nudge: { border: 'border-l-[#d29922]', label: 'NUDGE', color: 'text-[#d29922]' },
  digest: { border: 'border-l-[#58a6ff]', label: 'DIGEST', color: 'text-[#58a6ff]' },
  commit_closed: { border: 'border-l-[#3fb950]', label: 'CLOSED', color: 'text-[#3fb950]' },
};

export function FeedCard({ event, onClick }: FeedCardProps) {
  const navigate = useNavigate();
  const style = TYPE_STYLES[event.type];

  const handleClick = () => {
    onClick?.();
    navigate(`/threads/${event.threadId}`);
  };

  return (
    <button
      onClick={handleClick}
      className={`w-full text-left rounded-md border border-[#30363d] border-l-2 ${style.border} bg-[#161b22] p-4 transition-colors hover:bg-[#1c2128] cursor-pointer`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`mono text-xs font-semibold ${style.color}`}>{style.label}</span>
          {!event.read && <span className="h-2 w-2 rounded-full bg-[#58a6ff]" title="Unread" />}
        </div>
        <RelativeTime date={event.createdAt} />
      </div>
      <p className="text-sm font-medium text-[#e6edf3] mb-1">{event.threadTitle}</p>
      <CardContent event={event} />
    </button>
  );
}

function CardContent({ event }: { event: FeedEvent }) {
  const data = event.data;

  if (event.type === 'reopen' || event.type === 'nudge') {
    return (
      <div className="mt-2 space-y-1">
        {data?.diffSummary && (
          <p className="text-xs text-[#8b949e] mono bg-[#0d1117] rounded px-2 py-1">{data.diffSummary}</p>
        )}
        {data?.changedFactors && data.changedFactors.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {data.changedFactors.map((f) => (
              <span key={f} className="mono text-xs bg-[#d29922]/15 text-[#d29922] border border-[#d29922]/30 rounded px-1.5 py-0.5">
                {f}
              </span>
            ))}
          </div>
        )}
        {data?.previousVerdict && (
          <p className="text-xs text-[#8b949e] mt-1">Prev: {data.previousVerdict}</p>
        )}
      </div>
    );
  }

  if (event.type === 'digest') {
    return (
      <p className="text-xs text-[#8b949e] mt-1">
        {data?.itemCount ?? 0} items · {data?.timespan ?? 'recent'}
      </p>
    );
  }

  if (event.type === 'commit_closed') {
    return (
      <p className="text-xs text-[#8b949e] mt-1">{data?.verdictSummary ?? data?.verdict ?? 'No details'}</p>
    );
  }

  return null;
}

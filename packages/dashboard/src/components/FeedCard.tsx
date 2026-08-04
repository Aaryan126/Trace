import { useNavigate } from 'react-router-dom';
import type { FeedEvent } from '../lib/api';
import { RelativeTime } from './RelativeTime';
import { Icon, type IconName } from './Icon';

interface FeedCardProps {
  event: FeedEvent;
  onClick?: () => void;
}

const TYPE_STYLES: Record<FeedEvent['type'], { border: string; label: string; color: string; icon: IconName }> = {
  reopen: { border: 'border-l-[#d29922]', label: 'BRANCH REOPENED', color: 'text-[#d29922]', icon: 'revisit' },
  nudge: { border: 'border-l-[#d29922]', label: 'REVIEW NEEDED', color: 'text-[#d29922]', icon: 'activity' },
  digest: { border: 'border-l-[#58a6ff]', label: 'WEEKLY DIGEST', color: 'text-[#58a6ff]', icon: 'activity' },
  commit_closed: { border: 'border-l-[#3fb950]', label: 'VERDICT COMMITTED', color: 'text-[#3fb950]', icon: 'commit' },
};

export function FeedCard({ event, onClick }: FeedCardProps) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const baseStyle = TYPE_STYLES[event.type];
  const style = event.type === 'commit_closed' && event.resolutionStatus === 'in_progress'
    ? { ...baseStyle, border: 'border-l-[#58a6ff]', label: 'RESEARCH CHECKPOINT', color: 'text-[#58a6ff]' }
    : baseStyle;

  const handleClick = () => {
    onClick?.();
    navigate(`/threads/${event.threadId}`);
  };

  return (
    <article className={`panel w-full border-l-2 ${style.border} transition-colors hover:border-[#484f58] hover:bg-[#161b22]`}>
      <button onClick={handleClick} className="w-full cursor-pointer p-4 text-left">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon name={style.icon} className={`h-4 w-4 ${style.color}`} />
          <span className={`mono text-[10px] font-semibold tracking-wider ${style.color}`}>{style.label}</span>
          {!event.read && <span className="h-2 w-2 rounded-full bg-[#58a6ff]" title="Unread" />}
        </div>
        <RelativeTime date={event.createdAt} />
      </div>
      <p className="mb-1 text-sm font-semibold text-[#e6edf3]">{event.threadTitle}</p>
      <CardContent event={event} />
      </button>
      {event.updateCount > 1 && (
        <div className="border-t border-[#21262d] px-4 py-2.5">
          <button type="button" onClick={() => setExpanded((value) => !value)} className="text-xs font-medium text-[#58a6ff] hover:underline">
            {expanded ? 'Hide earlier checkpoints' : `Show ${event.updateCount - 1} earlier checkpoint${event.updateCount === 2 ? '' : 's'}`}
          </button>
          {expanded && (
            <ol className="mt-3 space-y-2 border-l border-[#30363d] pl-3">
              {event.updates?.slice(1).map((update) => (
                <li key={update.id} className="text-xs leading-5 text-[#8b949e]">
                  <RelativeTime date={update.createdAt} /> · {update.verdictSummary}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </article>
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
import { useState } from 'react';

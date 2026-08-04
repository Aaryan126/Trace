import { useEffect, useState, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { FeedCard } from '../components/FeedCard';
import { DecisionFlow } from '../components/DecisionFlow';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
import { fetchFeed, markFeedGroupRead, type FeedEvent } from '../lib/api';

interface OutletCtx {
  unreadCount: number;
  setUnreadCount: (n: number | ((prev: number) => number)) => void;
}

export function Home() {
  const { unreadCount, setUnreadCount } = useOutletContext<OutletCtx>();
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const LIMIT = 20;

  const load = useCallback(async (currentOffset: number, append = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchFeed({ limit: LIMIT, offset: currentOffset });
      setUnreadCount(res.unread);
      setHasMore(currentOffset + res.events.length < res.total);
      if (append) {
        setEvents((prev) => [...prev, ...res.events]);
      } else {
        setEvents(res.events);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load feed');
    } finally {
      setLoading(false);
    }
  }, [setUnreadCount]);

  useEffect(() => {
    load(0);
  }, [load]);

  const handleCardClick = async (event: FeedEvent) => {
    if (!event.read) {
      try {
        await markFeedGroupRead(event.eventIds);
        setEvents((prev) => prev.map((e) => (e.id === event.id ? { ...e, read: true } : e)));
        setUnreadCount((prev: number) => Math.max(0, prev - 1));
      } catch {
        // silently fail
      }
    }
  };

  const handleLoadMore = () => {
    const newOffset = offset + LIMIT;
    setOffset(newOffset);
    load(newOffset, true);
  };

  if (loading && events.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader
          eyebrow="Working tree"
          title="Decision activity"
          description="See what Trace committed, reopened, or needs from you."
        />
        <DecisionFlow />
        <div className="space-y-3" aria-label="Loading activity">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-[#30363d] bg-[#161b22]" />
          ))}
        </div>
      </div>
    );
  }

  if (error && events.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader
          eyebrow="Working tree"
          title="Decision activity"
          description="See what Trace committed, reopened, or needs from you."
        />
        <div className="rounded-md border border-[#f85149]/30 bg-[#f85149]/10 p-4">
          <p className="text-sm text-[#f85149]">{error}</p>
          <button onClick={() => load(0)} className="mt-2 text-sm text-[#58a6ff] hover:underline">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Working tree"
        title="Decision activity"
        description="Trace turns relevant evidence into durable verdicts and shows you exactly when context changes."
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="panel-soft flex items-center gap-4 p-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#58a6ff]/25 bg-[#58a6ff]/10 text-[#58a6ff]">
            <Icon name="activity" />
          </span>
          <div>
            <p className="text-2xl font-semibold text-[#f0f6fc]">{unreadCount}</p>
            <p className="text-xs text-[#8b949e]">Unread decision updates</p>
          </div>
        </div>
        <div className="panel-soft flex items-center gap-4 p-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#3fb950]/25 bg-[#3fb950]/10 text-[#3fb950]">
            <Icon name="commit" />
          </span>
          <div>
            <p className="text-2xl font-semibold text-[#f0f6fc]">{events.length}</p>
            <p className="text-xs text-[#8b949e]">Recent lifecycle events loaded</p>
          </div>
        </div>
      </div>

      <DecisionFlow />

      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[#e6edf3]">Latest activity</h3>
            <p className="mt-1 text-xs text-[#8b949e]">Commits are saved verdicts; revisits are new branches from an earlier decision.</p>
          </div>
          <span className="mono text-[10px] uppercase tracking-wider text-[#6e7681]">newest first</span>
        </div>
      {events.length === 0 ? (
          <EmptyState
            icon="activity"
            title="No decision activity yet"
            description="Relevant evidence will appear after it is grouped into a decision. Ordinary browsing is ignored automatically."
          />
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <FeedCard key={event.id} event={event} onClick={() => handleCardClick(event)} />
          ))}
        </div>
      )}
      {hasMore && events.length > 0 && (
        <div className="mt-6 text-center">
          <button
            onClick={handleLoadMore}
            disabled={loading}
            className="button-secondary"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
      </section>
    </div>
  );
}

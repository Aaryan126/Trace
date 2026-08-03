import { useEffect, useState, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { FeedCard } from '../components/FeedCard';
import { fetchFeed, markFeedRead, type FeedEvent } from '../lib/api';

interface OutletCtx {
  unreadCount: number;
  setUnreadCount: (n: number | ((prev: number) => number)) => void;
}

export function Home() {
  const { setUnreadCount } = useOutletContext<OutletCtx>();
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
        await markFeedRead(event.id);
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
      <div>
        <h2 className="text-xl font-semibold text-[#e6edf3] mb-6">Feed</h2>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-24 rounded-md bg-[#161b22] border border-[#30363d] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error && events.length === 0) {
    return (
      <div>
        <h2 className="text-xl font-semibold text-[#e6edf3] mb-6">Feed</h2>
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
    <div>
      <h2 className="text-xl font-semibold text-[#e6edf3] mb-6">Feed</h2>
      {events.length === 0 ? (
        <p className="text-[#8b949e] text-sm">No feed events yet.</p>
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
            className="rounded-md border border-[#30363d] bg-[#161b22] px-4 py-2 text-sm text-[#58a6ff] hover:bg-[#1c2128] disabled:opacity-50 transition-colors"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}

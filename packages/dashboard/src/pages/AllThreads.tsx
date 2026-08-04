import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
import { RelativeTime } from '../components/RelativeTime';
import { StatusBadge } from '../components/StatusBadge';
import { fetchThreads, type Thread } from '../lib/api';

const LIMIT = 20;

export function AllThreads() {
  const navigate = useNavigate();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('recent');
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchThreads({
        limit: LIMIT,
        search: debouncedSearch || undefined,
        status: status || undefined,
        sort,
        offset,
      });
      setThreads(res.threads);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load decisions');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, offset, sort, status]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setOffset(0);
      setDebouncedSearch(search);
    }, 250);
    return () => clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const currentPage = Math.floor(offset / LIMIT) + 1;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Repository"
        title="Decision threads"
        description="Each thread is one recurring choice. Evidence accumulates on branches; a commit records the verdict and why it was made."
        actions={(
          <span className="mono rounded-full border border-[#30363d] bg-[#161b22] px-3 py-1.5 text-xs text-[#8b949e]">
            {total} {total === 1 ? 'thread' : 'threads'}
          </span>
        )}
      />

      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[#21262d] bg-[#11161d]/80 p-4 lg:flex-row lg:items-center">
          <label className="relative min-w-0 flex-1 lg:max-w-md">
            <span className="sr-only">Search decision threads</span>
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6e7681]" />
            <input
              type="search"
              placeholder="Search decisions…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] py-2 pl-9 pr-3 text-sm text-[#e6edf3] placeholder-[#6e7681] focus:border-[#58a6ff] focus:outline-none"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Icon name="filter" className="h-4 w-4 text-[#6e7681]" />
            <select
              aria-label="Filter by status"
              value={status}
              onChange={(event) => { setStatus(event.target.value); setOffset(0); }}
              className="rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-[#c9d1d9] focus:border-[#58a6ff] focus:outline-none"
            >
              <option value="">All states</option>
              <option value="open">Open</option>
              <option value="closed">Committed</option>
            </select>
            <select
              aria-label="Sort decisions"
              value={sort}
              onChange={(event) => { setSort(event.target.value); setOffset(0); }}
              className="rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-[#c9d1d9] focus:border-[#58a6ff] focus:outline-none"
            >
              <option value="recent">Recent evidence first</option>
              <option value="stale">Stalest evidence first</option>
            </select>
          </div>
        </div>

        {error && threads.length === 0 ? (
          <div className="m-4 rounded-lg border border-[#f85149]/30 bg-[#f85149]/10 p-4">
            <p className="text-sm text-[#f85149]">{error}</p>
            <button onClick={() => void load()} className="mt-2 text-sm text-[#58a6ff] hover:underline">Retry</button>
          </div>
        ) : loading && threads.length === 0 ? (
          <div className="space-y-px bg-[#21262d]" aria-label="Loading decisions">
            {[...Array(6)].map((_, index) => <div key={index} className="h-[76px] animate-pulse bg-[#0d1117]" />)}
          </div>
        ) : threads.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon="branch"
              title="No decision threads found"
              description={search || status
                ? 'Try clearing your search or status filter.'
                : 'Trace will create a thread only when it finds strong evidence of an actual decision.'}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-[#21262d] bg-[#0d1117]">
                <tr>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[#6e7681]">Decision</th>
                  <th className="w-28 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[#6e7681]">State</th>
                  <th className="w-40 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[#6e7681]">Last evidence</th>
                  <th className="w-28 px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[#6e7681]">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {threads.map((thread) => (
                  <tr
                    key={thread.id}
                    onClick={() => navigate(`/threads/${thread.id}`)}
                    className="group cursor-pointer border-b border-[#21262d] bg-[#0d1117]/85 transition-colors last:border-0 hover:bg-[#161b22]"
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-start gap-3">
                        <span className="relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#30363d] bg-[#161b22] text-[#58a6ff] group-hover:border-[#58a6ff]/50">
                          <Icon name="branch" className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="font-medium leading-5 text-[#e6edf3] group-hover:text-[#58a6ff]">{thread.title}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span className="mono text-[10px] text-[#6e7681]">thread/{thread.id.slice(0, 7)}</span>
                            {thread.tags.map((tag) => (
                              <span key={tag} className="rounded border border-[#30363d] bg-[#161b22] px-1.5 py-0.5 text-[10px] text-[#8b949e]">{tag}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4"><StatusBadge status={thread.status} /></td>
                    <td className="px-4 py-4"><RelativeTime date={thread.lastActivity} /></td>
                    <td className="px-4 py-4 text-right">
                      <span className="mono inline-flex min-w-8 justify-center rounded-md border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-[#8b949e]">{thread.itemCount}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {totalPages > 1 && (
        <nav className="flex items-center justify-center gap-3" aria-label="Decision pages">
          <button
            onClick={() => setOffset(Math.max(0, offset - LIMIT))}
            disabled={offset === 0}
            className="button-secondary"
          >
            Previous
          </button>
          <span className="mono text-xs text-[#8b949e]">Page {currentPage} of {totalPages}</span>
          <button
            onClick={() => setOffset(offset + LIMIT)}
            disabled={currentPage >= totalPages}
            className="button-secondary"
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}

import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { StatusBadge } from '../components/StatusBadge';
import { RelativeTime } from '../components/RelativeTime';
import { fetchThreads, type Thread } from '../lib/api';

export function AllThreads() {
  const navigate = useNavigate();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>('');
  const [sort, setSort] = useState('recent');
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const LIMIT = 20;
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const load = useCallback(
    async (params: { search?: string; status?: string; sort?: string; offset?: number }) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchThreads({
          limit: LIMIT,
          search: params.search || undefined,
          status: params.status || undefined,
          sort: params.sort || 'recent',
          offset: params.offset ?? 0,
        });
        setThreads(res.threads);
        setTotal(res.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load threads');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    load({ search, status, sort, offset });
  }, [search, status, sort, offset, load]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setOffset(0);
    }, 300);
  };

  const totalPages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  if (loading && threads.length === 0) {
    return (
      <div>
        <h2 className="text-xl font-semibold text-[#e6edf3] mb-6">Threads</h2>
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 rounded-md bg-[#161b22] border border-[#30363d] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-[#e6edf3] mb-6">Threads</h2>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="Search threads…"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="rounded-md border border-[#30363d] bg-[#0d1117] px-3 py-1.5 text-sm text-[#e6edf3] placeholder-[#8b949e] focus:border-[#58a6ff] focus:outline-none w-64"
        />
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setOffset(0); }}
          className="rounded-md border border-[#30363d] bg-[#0d1117] px-3 py-1.5 text-sm text-[#e6edf3] focus:border-[#58a6ff] focus:outline-none"
        >
          <option value="">All</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
        <select
          value={sort}
          onChange={(e) => { setSort(e.target.value); setOffset(0); }}
          className="rounded-md border border-[#30363d] bg-[#0d1117] px-3 py-1.5 text-sm text-[#e6edf3] focus:border-[#58a6ff] focus:outline-none"
        >
          <option value="recent">Recent first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>

      {error ? (
        <div className="rounded-md border border-[#f85149]/30 bg-[#f85149]/10 p-4">
          <p className="text-sm text-[#f85149]">{error}</p>
        </div>
      ) : threads.length === 0 ? (
        <p className="text-[#8b949e] text-sm">No threads found.</p>
      ) : (
        <div className="rounded-md border border-[#30363d] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#161b22] border-b border-[#30363d]">
              <tr>
                <th className="text-left text-[#8b949e] font-medium px-4 py-2.5">Title</th>
                <th className="text-left text-[#8b949e] font-medium px-4 py-2.5 w-24">Status</th>
                <th className="text-left text-[#8b949e] font-medium px-4 py-2.5 w-32">Last Activity</th>
                <th className="text-left text-[#8b949e] font-medium px-4 py-2.5 w-20">Items</th>
                <th className="text-left text-[#8b949e] font-medium px-4 py-2.5">Tags</th>
              </tr>
            </thead>
            <tbody>
              {threads.map((thread) => (
                <tr
                  key={thread.id}
                  onClick={() => navigate(`/threads/${thread.id}`)}
                  className="border-b border-[#30363d] last:border-0 hover:bg-[#161b22] cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 text-[#e6edf3] font-medium">{thread.title}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={thread.status} />
                  </td>
                  <td className="px-4 py-3">
                    <RelativeTime date={thread.lastActivity} />
                  </td>
                  <td className="px-4 py-3 mono text-[#8b949e]">{thread.itemCount}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {thread.tags.map((tag) => (
                        <span key={tag} className="mono text-xs bg-[#30363d]/50 text-[#8b949e] rounded px-1.5 py-0.5">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => setOffset(Math.max(0, offset - LIMIT))}
            disabled={offset === 0}
            className="rounded-md border border-[#30363d] bg-[#161b22] px-3 py-1.5 text-sm text-[#58a6ff] hover:bg-[#1c2128] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Prev
          </button>
          <span className="text-sm text-[#8b949e] mono">
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => setOffset(offset + LIMIT)}
            disabled={currentPage >= totalPages}
            className="rounded-md border border-[#30363d] bg-[#161b22] px-3 py-1.5 text-sm text-[#58a6ff] hover:bg-[#1c2128] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

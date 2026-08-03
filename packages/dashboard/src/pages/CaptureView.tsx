import { useEffect, useState, useCallback } from 'react';
import { fetchCapture, postCorrection, fetchThreads, type CaptureItem, type Thread } from '../lib/api';
import { RelativeTime } from '../components/RelativeTime';
import { Modal } from '../components/Modal';

export function CaptureView() {
  const [items, setItems] = useState<CaptureItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalItem, setModalItem] = useState<CaptureItem | null>(null);
  const [newThreadTitle, setNewThreadTitle] = useState('');
  const [reassignItem, setReassignItem] = useState<CaptureItem | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchCapture();
      setItems(res.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load capture items');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    fetchThreads({ limit: 100 })
      .then((res) => setThreads(res.threads))
      .catch(() => {});
  }, []);

  const handleConfirm = async (item: CaptureItem) => {
    try {
      await postCorrection('confirm', { itemId: item.id, threadId: item.suggestion?.threadId });
      await load();
    } catch {
      // silent
    }
  };

  const handleReassign = async (item: CaptureItem, threadId: string) => {
    try {
      await postCorrection('reassign', { itemId: item.id, threadId });
      setReassignItem(null);
      await load();
    } catch {
      // silent
    }
  };

  const handleNewThread = async () => {
    if (!modalItem || !newThreadTitle.trim()) return;
    try {
      await postCorrection('new-thread', { itemId: modalItem.id, title: newThreadTitle.trim() });
      setModalOpen(false);
      setModalItem(null);
      setNewThreadTitle('');
      await load();
    } catch {
      // silent
    }
  };

  const typeIcon = (type: string) => {
    if (type === 'screenshot') return '📷';
    if (type === 'browser_history') return '🌐';
    return '📝';
  };

  if (loading && items.length === 0) {
    return (
      <div>
        <h2 className="text-xl font-semibold text-[#e6edf3] mb-6">Capture</h2>
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 rounded-md bg-[#161b22] border border-[#30363d] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div>
        <h2 className="text-xl font-semibold text-[#e6edf3] mb-6">Capture</h2>
        <div className="rounded-md border border-[#f85149]/30 bg-[#f85149]/10 p-4">
          <p className="text-sm text-[#f85149]">{error}</p>
          <button onClick={load} className="mt-2 text-sm text-[#58a6ff] hover:underline">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-[#e6edf3]">Capture</h2>
        <span className="text-xs text-[#8b949e] mono">Auto-refresh: 10s</span>
      </div>

      {items.length === 0 ? (
        <p className="text-[#8b949e] text-sm">No captured items.</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const lowConfidence = item.suggestion && item.suggestion.confidence < 0.5;
            return (
              <div
                key={item.id}
                className={`rounded-md border border-[#30363d] bg-[#161b22] p-4 ${
                  lowConfidence ? 'border-l-2 border-l-[#d29922] bg-[#d29922]/5' : ''
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{typeIcon(item.type)}</span>
                    <span className="mono text-xs text-[#8b949e]">{item.type}</span>
                  </div>
                  <RelativeTime date={item.capturedAt} />
                </div>

                <p className="text-sm text-[#e6edf3] mb-2">
                  {item.rawText.slice(0, 200)}{item.rawText.length > 200 ? '…' : ''}
                </p>

                {item.url && (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[#58a6ff] hover:underline block mb-2"
                  >
                    {item.url}
                  </a>
                )}

                {item.suggestion && (
                  <p className="text-xs text-[#8b949e] mb-3">
                    Assigned to:{' '}
                    <span className="text-[#e6edf3]">{item.suggestion.threadTitle}</span>
                    <span className={`mono ml-1.5 ${lowConfidence ? 'text-[#d29922]' : 'text-[#3fb950]'}`}>
                      {Math.round(item.suggestion.confidence * 100)}%
                    </span>
                  </p>
                )}

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleConfirm(item)}
                    className="rounded border border-[#3fb950]/30 bg-[#3fb950]/10 px-2.5 py-1 text-xs text-[#3fb950] hover:bg-[#3fb950]/20 transition-colors"
                  >
                    ✓ Confirm
                  </button>
                  {reassignItem?.id === item.id ? (
                    <select
                      onChange={(e) => handleReassign(item, e.target.value)}
                      onBlur={() => setReassignItem(null)}
                      autoFocus
                      className="rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs text-[#e6edf3]"
                    >
                      <option value="">Select thread…</option>
                      {threads.map((t) => (
                        <option key={t.id} value={t.id}>{t.title}</option>
                      ))}
                    </select>
                  ) : (
                    <button
                      onClick={() => setReassignItem(item)}
                      className="rounded border border-[#58a6ff]/30 bg-[#58a6ff]/10 px-2.5 py-1 text-xs text-[#58a6ff] hover:bg-[#58a6ff]/20 transition-colors"
                    >
                      Reassign
                    </button>
                  )}
                  <button
                    onClick={() => { setModalItem(item); setModalOpen(true); }}
                    className="rounded border border-[#30363d] bg-[#0d1117] px-2.5 py-1 text-xs text-[#8b949e] hover:text-[#e6edf3] hover:border-[#8b949e] transition-colors"
                  >
                    + New Thread
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => { setModalOpen(false); setModalItem(null); }} title="Create New Thread">
        <input
          type="text"
          value={newThreadTitle}
          onChange={(e) => setNewThreadTitle(e.target.value)}
          placeholder="Thread title…"
          className="w-full rounded-md border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-[#e6edf3] placeholder-[#8b949e] focus:border-[#58a6ff] focus:outline-none mb-4"
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={() => { setModalOpen(false); setModalItem(null); }}
            className="rounded-md border border-[#30363d] bg-[#0d1117] px-3 py-1.5 text-sm text-[#8b949e] hover:text-[#e6edf3] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleNewThread}
            disabled={!newThreadTitle.trim()}
            className="rounded-md border border-[#3fb950]/30 bg-[#3fb950]/15 px-3 py-1.5 text-sm text-[#3fb950] hover:bg-[#3fb950]/25 disabled:opacity-40 transition-colors"
          >
            Create
          </button>
        </div>
      </Modal>
    </div>
  );
}

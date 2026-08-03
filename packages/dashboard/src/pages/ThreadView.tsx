import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { StatusBadge } from '../components/StatusBadge';
import { ThreadGraph } from '../components/ThreadGraph';
import { RelativeTime } from '../components/RelativeTime';
import {
  fetchThread,
  fetchThreadTree,
  addRegret,
  mergeThread,
  type ThreadDetail,
  type TreeData,
  type CommitNode,
} from '../lib/api';

export function ThreadView() {
  const { id } = useParams<{ id: string }>();
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [tree, setTree] = useState<TreeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<CommitNode | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([fetchThread(id), fetchThreadTree(id)])
      .then(([threadData, treeData]) => {
        setThread(threadData);
        setTree(treeData);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load thread'))
      .finally(() => setLoading(false));
  }, [id]);

  const allCommits: CommitNode[] = thread
    ? thread.branches.flatMap((b) => b.commits)
    : [];

  const handleSelectNode = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    const commit = allCommits.find((c) => c.id === nodeId);
    setSelectedCommit(commit ?? null);
  };

  const handleAddRegret = async () => {
    if (!selectedCommit) return;
    try {
      await addRegret(selectedCommit.id);
      // Refresh thread
      if (id) {
        const [threadData, treeData] = await Promise.all([fetchThread(id), fetchThreadTree(id)]);
        setThread(threadData);
        setTree(treeData);
        const updated = threadData.branches.flatMap((b) => b.commits).find((c) => c.id === selectedCommit.id);
        setSelectedCommit(updated ?? null);
      }
    } catch {
      // silent
    }
  };

  const handleMerge = async () => {
    if (!thread) return;
    const branchIds = thread.branches.map((b) => b.id);
    if (branchIds.length === 0) return;
    try {
      await mergeThread(thread.id, { sourceBranchIds: branchIds, resolvedRule: 'manual merge' });
      if (id) {
        const [threadData, treeData] = await Promise.all([fetchThread(id), fetchThreadTree(id)]);
        setThread(threadData);
        setTree(treeData);
      }
    } catch {
      // silent
    }
  };

  if (loading) {
    return (
      <div>
        <div className="h-8 w-64 bg-[#161b22] rounded animate-pulse mb-4" />
        <div className="h-96 bg-[#161b22] rounded-md border border-[#30363d] animate-pulse" />
      </div>
    );
  }

  if (error || !thread) {
    return (
      <div className="rounded-md border border-[#f85149]/30 bg-[#f85149]/10 p-4">
        <p className="text-sm text-[#f85149]">{error ?? 'Thread not found'}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h2 className="text-xl font-semibold text-[#e6edf3]">{thread.title}</h2>
          <StatusBadge status={thread.status} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {thread.tags?.map((tag) => (
            <span key={tag} className="mono text-xs bg-[#30363d]/50 text-[#8b949e] rounded px-1.5 py-0.5">
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={handleAddRegret}
          disabled={!selectedCommit}
          className="rounded-md border border-[#d29922]/30 bg-[#d29922]/10 px-3 py-1.5 text-sm text-[#d29922] hover:bg-[#d29922]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Add Regret
        </button>
        <button
          onClick={handleMerge}
          disabled={thread.branches.length === 0}
          className="rounded-md border border-[#3fb950]/30 bg-[#3fb950]/10 px-3 py-1.5 text-sm text-[#3fb950] hover:bg-[#3fb950]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Merge Branches
        </button>
      </div>

      {/* Graph + Detail split */}
      <div className="flex gap-6">
        {/* Left: Graph */}
        <div className="flex-1 min-w-0 rounded-md border border-[#30363d] bg-[#161b22] p-4 overflow-auto">
          {tree ? (
            <ThreadGraph
              tree={tree}
              commits={allCommits}
              selectedId={selectedNodeId}
              onSelectNode={handleSelectNode}
            />
          ) : (
            <p className="text-[#8b949e] text-sm">No tree data.</p>
          )}
        </div>

        {/* Right: Commit detail */}
        <div className="w-80 flex-shrink-0">
          {selectedCommit ? (
            <div className="rounded-md border border-[#30363d] bg-[#161b22] p-4 sticky top-6">
              <h3 className="text-sm font-semibold text-[#e6edf3] mb-2">Commit Detail</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-[#8b949e] mb-0.5">Verdict</p>
                  <p className="text-sm text-[#e6edf3]">{selectedCommit.verdictSummary}</p>
                </div>
                <div>
                  <p className="text-xs text-[#8b949e] mb-0.5">Reasoning</p>
                  <p className="text-sm text-[#8b949e]">{selectedCommit.reasoning}</p>
                </div>
                <div>
                  <p className="text-xs text-[#8b949e] mb-0.5">Date</p>
                  <RelativeTime date={selectedCommit.createdAt} />
                </div>
                {selectedCommit.regret && (
                  <div className="rounded bg-[#d29922]/15 border border-[#d29922]/30 px-2 py-1">
                    <p className="text-xs text-[#d299922] font-medium text-[#d29922]">⚠ Regret marked</p>
                  </div>
                )}
                {selectedCommit.sourceItems?.length > 0 && (
                  <div>
                    <p className="text-xs text-[#8b949e] mb-1.5">Source Items</p>
                    <div className="space-y-2">
                      {selectedCommit.sourceItems.map((item) => (
                        <div
                          key={item.id}
                          className="rounded border border-[#30363d] bg-[#0d1117] p-2"
                        >
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="text-xs">
                              {item.type === 'screenshot' ? '📷' : item.type === 'browser_history' ? '🌐' : '📝'}
                            </span>
                            <span className="mono text-xs text-[#8b949e]">{item.type}</span>
                          </div>
                          <p className="text-xs text-[#e6edf3] line-clamp-3">
                            {item.rawText?.slice(0, 200)}{(item.rawText?.length ?? 0) > 200 ? '…' : ''}
                          </p>
                          {item.url && (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-[#58a6ff] hover:underline mt-1 block"
                            >
                              {item.url}
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-[#30363d] bg-[#161b22] p-4 text-center">
              <p className="text-sm text-[#8b949e]">Click a node to view commit details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

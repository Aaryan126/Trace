import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { RelativeTime } from '../components/RelativeTime';
import { StatusBadge } from '../components/StatusBadge';
import { ThreadGraph } from '../components/ThreadGraph';
import {
  correctComparison,
  exportThread,
  fetchThread,
  fetchThreadTree,
  fetchThreads,
  mergeThread,
  openResumePages,
  resetComparison,
  setDecisionOutcome,
  subscribeToTrace,
  type ThreadDetail,
  type TreeData,
  type Thread,
} from '../lib/api';

export function ThreadView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [tree, setTree] = useState<TreeData | null>(null);
  const [decisions, setDecisions] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeRule, setMergeRule] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id) return;
    try {
      const [threadData, treeData] = await Promise.all([fetchThread(id), fetchThreadTree(id)]);
      setThread(threadData); setTree(treeData); setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load this decision');
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { void reload(); return subscribeToTrace(() => void reload()); }, [reload]);
  useEffect(() => { fetchThreads({ sort: 'recent', limit: 100 }).then((response) => setDecisions(response.threads)).catch(() => {}); }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), 5_000); return () => clearTimeout(timer); }, [notice]);

  const commits = useMemo(() => thread?.branches.flatMap((branch) => branch.commits) ?? [], [thread]);

  async function handleMerge() {
    if (!thread || thread.branches.length < 2 || !mergeRule.trim()) return;
    await mergeThread(thread.id, { sourceBranchIds: thread.branches.map((branch) => branch.id), resolvedRule: mergeRule.trim() });
    setMergeOpen(false); setMergeRule(''); await reload();
  }

  const handleResume = useCallback(async () => {
    if (!thread) return;
    const result = await openResumePages(thread.resume.pages.map((page) => page.url));
    setNotice(result.viaExtension ? `Opened ${result.opened} research page${result.opened === 1 ? '' : 's'} in Chrome.` : result.opened ? 'Opened the first page. Reload the Trace extension to reopen the full set automatically.' : 'No resumable pages are available yet.');
  }, [thread]);

  const handleCorrection = useCallback(async (optionId: string, criterionId: string, value: string, status: 'supported' | 'unknown' | 'conflicting' | 'assumption') => {
    const branchId = thread?.currentAnswer?.branchId ?? thread?.resume.branchId;
    if (!branchId) return;
    await correctComparison(branchId, optionId, criterionId, { value, status, pinned: true });
    await reload();
  }, [reload, thread]);

  const handleReset = useCallback(async (optionId: string, criterionId: string) => {
    const branchId = thread?.currentAnswer?.branchId ?? thread?.resume.branchId;
    if (!branchId) return;
    await resetComparison(branchId, optionId, criterionId); await reload();
  }, [reload, thread]);

  const handleOutcome = useCallback(async (status: 'worked' | 'mixed' | 'regretted' | 'superseded', note: string) => {
    if (!thread?.outcomeReview) return;
    await setDecisionOutcome(thread.outcomeReview.commitId, status, note);
    await reload();
  }, [reload, thread]);

  if (loading) return <div className="decision-loading"><div /><div /><div /></div>;
  if (error || !thread || !tree) return <div className="decision-error"><Link to="/decisions">← Back to decisions</Link><p>{error ?? 'Decision not found'}</p></div>;

  return (
    <div className="decision-workspace">
      <header className="decision-header">
        <div className="decision-picker-row">
          <label>Decision<select aria-label="Choose decision" value={thread.id} onChange={(event) => navigate(`/threads/${event.target.value}`)}>{decisions.map((decision) => <option key={decision.id} value={decision.id}>{decision.title}</option>)}</select></label>
          <div className="decision-actions">
            <Link to="/decisions" className="button-secondary"><Icon name="branch" className="h-4 w-4" /> All decisions</Link>
            <button type="button" className="button-secondary" onClick={() => void exportThread(thread.id, 'markdown')}><Icon name="activity" className="h-4 w-4" /> Export</button>
            <button type="button" className="button-secondary" onClick={() => setMergeOpen(true)} disabled={thread.branches.length < 2}><Icon name="merge" className="h-4 w-4" /> Manual override</button>
          </div>
        </div>
        <div className="decision-title-row">
          <div>
            <div className="decision-kicker">DECISION/{thread.id.slice(0, 7)}</div>
            <h1>{thread.title}</h1>
            <p>Last researched <RelativeTime date={thread.lastActivity} /> · {thread.itemCount} sources · {commits.length} checkpoints</p>
          </div>
          <StatusBadge status={thread.status} />
        </div>
      </header>

      <ThreadGraph
        tree={tree}
        commits={commits}
        workingStates={thread.workingStates}
        rootBranchId={thread.branches[0]?.id}
        story={thread.story}
        currentAnswer={thread.currentAnswer}
        comparison={thread.comparison}
        resume={thread.resume}
        outcomeReview={thread.outcomeReview}
        threadTitle={thread.title}
        onResume={handleResume}
        onSetOutcome={handleOutcome}
        onCorrectComparison={handleCorrection}
        onResetComparison={handleReset}
      />

      {notice && <div className="trace-toast" role="status">{notice}</div>}

      <Modal open={mergeOpen} onClose={() => setMergeOpen(false)} title="Manual reconciliation override">
        <p className="modal-copy">Trace reconciles compatible branches automatically. Use this override only when you want to supply the durable rule yourself; the original paths remain preserved.</p>
        <textarea value={mergeRule} onChange={(event) => setMergeRule(event.target.value)} rows={4} className="modal-textarea" placeholder="Use Plus by default; use SeedVR2 when batch video output matters more than free unlimited use." />
        <div className="modal-actions"><button onClick={() => setMergeOpen(false)} className="button-secondary">Cancel</button><button onClick={() => void handleMerge()} disabled={!mergeRule.trim()} className="button-primary"><Icon name="merge" className="h-4 w-4" /> Create merge</button></div>
      </Modal>
    </div>
  );
}

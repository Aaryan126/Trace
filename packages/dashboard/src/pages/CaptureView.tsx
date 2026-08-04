import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { CaptureThumbnail } from '../components/CaptureThumbnail';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
import { RelativeTime } from '../components/RelativeTime';
import {
  fetchLiveTrace,
  retryAutomation,
  subscribeToTrace,
  undoAutomation,
  type LiveTraceResponse,
} from '../lib/api';

const EMPTY: LiveTraceResponse = { states: [], actions: [], sources: [], capture: null };

export function CaptureView() {
  const [live, setLive] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLive(await fetchLiveTrace());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Live Trace');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const unsubscribe = subscribeToTrace(() => void load());
    const fallback = setInterval(() => void load(), 30_000);
    return () => { unsubscribe(); clearInterval(fallback); };
  }, [load]);

  const activeSources = live.sources.filter((source) => ['pending', 'processing', 'error'].includes(source.automationStatus ?? ''));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Autonomous pipeline"
        title="Live Trace"
        description="Trace reads new evidence, decides where it belongs, updates the working state, and creates checkpoints automatically. This page is an audit trail, not an approval queue."
        actions={<span className="mono rounded-full border border-[#3fb950]/30 bg-[#3fb950]/10 px-3 py-1.5 text-xs text-[#3fb950]">live · localhost</span>}
      />

      <div className="grid gap-3 sm:grid-cols-4" aria-label="Automation flow">
        <FlowStep label="Capture" detail="browser or screenshot" active={activeSources.some((item) => item.automationStatus === 'pending')} />
        <FlowStep label="Understand" detail="fetch + route" active={activeSources.some((item) => item.automationStatus === 'processing')} />
        <FlowStep label="File" detail="thread and branch" active={live.actions.some((action) => action.status === 'applied')} />
        <FlowStep label="Checkpoint" detail="after 25s quiet" active={live.states.some((state) => state.status === 'checkpointing')} />
      </div>

      {live.capture && (
        <section className="panel-soft flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between" aria-label="Browser capture health">
          <div>
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${live.capture.connected && live.capture.enabled && live.capture.authorized ? 'bg-[#3fb950]' : 'bg-[#d29922]'}`} />
              <h2 className="text-sm font-semibold text-[#e6edf3]">Automatic browser screenshots</h2>
            </div>
            <p className="mt-1 text-xs text-[#8b949e]">
              {captureHealthLabel(live.capture.enabled, live.capture.authorized, live.capture.connected)}
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="mono text-[10px] uppercase tracking-wider text-[#6e7681]">last result</p>
            <p className={`mt-1 text-xs ${live.capture.lastResult === 'failed' ? 'text-[#f85149]' : 'text-[#c9d1d9]'}`}>
              {live.capture.lastResult ? `${live.capture.lastResult}${live.capture.lastReason ? ` · ${humanCaptureReason(live.capture.lastReason)}` : ''}` : 'No attempt yet'}
            </p>
          </div>
        </section>
      )}

      {error && <div className="rounded-lg border border-[#f85149]/30 bg-[#f85149]/10 p-4 text-sm text-[#f85149]">{error}</div>}

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-[#e6edf3]">Working research</h2>
            <p className="mt-1 text-sm text-[#8b949e]">Live, pre-commit state. The newest update is always first.</p>
          </div>
          <span className="mono text-xs text-[#6e7681]">{live.states.length} active</span>
        </div>
        {loading && live.states.length === 0 ? (
          <div className="h-40 animate-pulse rounded-xl border border-[#30363d] bg-[#161b22]" />
        ) : live.states.length === 0 ? (
          <EmptyState icon="activity" title="Waiting for focused research" description="Visit a comparison, evaluation, or decision-relevant page. Casual browsing will be ignored automatically." />
        ) : live.states.map((state) => (
          <article key={state.id} className="panel p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/threads/${state.threadId}`} className="font-semibold text-[#58a6ff] hover:underline">{state.threadTitle}</Link>
                  <span className="mono rounded border border-[#30363d] px-1.5 py-0.5 text-[10px] text-[#8b949e]">branch/{state.branchId.slice(0, 7)}</span>
                  <RelativeTime date={state.lastEventAt} />
                </div>
                <p className="mt-3 text-sm font-medium text-[#e6edf3]">{state.researchQuestion}</p>
                <p className="mt-2 max-w-4xl text-sm leading-6 text-[#8b949e]">{state.summary}</p>
              </div>
              <span className={`rounded-full border px-2.5 py-1 text-xs ${state.status === 'error' ? 'border-[#f85149]/30 text-[#f85149]' : state.status === 'checkpointing' ? 'border-[#d29922]/30 text-[#d29922]' : 'border-[#3fb950]/30 text-[#3fb950]'}`}>{state.status}</span>
            </div>
            <div className="mt-4 grid gap-3 border-t border-[#21262d] pt-4 md:grid-cols-3">
              <StateList label="Options" values={state.options} />
              <StateList label="Constraints" values={state.constraints} />
              <StateList label="Open questions" values={state.openQuestions} />
            </div>
            {state.tentativeDirection && <p className="mt-4 rounded-lg border border-[#58a6ff]/20 bg-[#58a6ff]/5 px-3 py-2 text-xs text-[#c9d1d9]"><span className="font-semibold text-[#58a6ff]">Tentative direction:</span> {state.tentativeDirection}</p>}
            {(state.evidence ?? []).some((source) => source.capture) && (
              <div className="mt-4 flex flex-wrap gap-3 border-t border-[#21262d] pt-4">
                {(state.evidence ?? []).filter((source) => source.capture).map((source) => <CaptureThumbnail key={source.id} source={source} compact />)}
              </div>
            )}
          </article>
        ))}
      </section>

      {activeSources.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-[#e6edf3]">In flight</h2>
          {activeSources.map((source) => (
            <div key={source.id} className="panel-soft flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <span className={`h-2 w-2 shrink-0 rounded-full ${source.automationStatus === 'error' ? 'bg-[#f85149]' : 'animate-pulse bg-[#d29922]'}`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-[#c9d1d9]">{source.rawText || source.url || 'New evidence'}</p>
                <p className="mono mt-1 text-[10px] uppercase tracking-wider text-[#6e7681]">{source.automationStatus}</p>
                {source.captureStatus && source.captureStatus !== 'not_requested' && (
                  <p className="mt-1 text-[10px] text-[#6e7681]">capture: {source.captureStatus}{source.captureReason ? ` · ${humanCaptureReason(source.captureReason)}` : ''}</p>
                )}
              </div>
              <CaptureThumbnail source={source} compact />
              {source.automationStatus === 'error' && <button onClick={() => void retryAutomation(source.id).then(load)} className="button-secondary">Retry</button>}
            </div>
          ))}
        </section>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-[#e6edf3]">Automation log</h2>
          <p className="mt-1 text-sm text-[#8b949e]">Why Trace filed, branched, ignored, or checkpointed each item.</p>
        </div>
        {live.actions.length === 0 ? <EmptyState icon="commit" title="No automatic actions yet" description="Actions appear here as soon as new evidence is routed." /> : live.actions.map((action) => (
          <article key={action.id} className="panel-soft flex flex-col gap-3 p-4 md:flex-row md:items-start">
            <span className="mono rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-[10px] uppercase text-[#58a6ff]">{action.action.replace('_', ' ')}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {action.threadId ? <Link to={`/threads/${action.threadId}`} className="text-sm font-medium text-[#e6edf3] hover:text-[#58a6ff]">{action.threadTitle}</Link> : <span className="text-sm font-medium text-[#8b949e]">Not added to research history</span>}
                <RelativeTime date={action.createdAt} />
                {action.confidence !== undefined && <span className="mono text-[10px] text-[#6e7681]">{Math.round(action.confidence * 100)}% confidence</span>}
              </div>
              <p className="mt-1.5 text-xs leading-5 text-[#8b949e]">{action.rationale}</p>
            </div>
            {action.undoable && action.status === 'applied' && <button onClick={() => void undoAutomation(action.id).then(load)} className="rounded-md px-3 py-1.5 text-xs text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]">Undo</button>}
          </article>
        ))}
      </section>
    </div>
  );
}

function FlowStep({ label, detail, active }: { label: string; detail: string; active: boolean }) {
  return <div className={`rounded-lg border p-3 ${active ? 'border-[#58a6ff]/40 bg-[#58a6ff]/5' : 'border-[#30363d] bg-[#11161d]'}`}><div className="flex items-center gap-2"><Icon name="check" className={`h-3.5 w-3.5 ${active ? 'text-[#58a6ff]' : 'text-[#3fb950]'}`} /><span className="text-xs font-semibold text-[#e6edf3]">{label}</span></div><p className="mt-1 pl-5.5 text-[11px] text-[#6e7681]">{detail}</p></div>;
}

function StateList({ label, values }: { label: string; values: string[] }) {
  return <div><p className="mono text-[10px] uppercase tracking-wider text-[#6e7681]">{label}</p>{values.length ? <ul className="mt-2 space-y-1 text-xs leading-5 text-[#c9d1d9]">{values.map((value) => <li key={value}>• {value}</li>)}</ul> : <p className="mt-2 text-xs text-[#484f58]">None yet</p>}</div>;
}

function captureHealthLabel(enabled: boolean, authorized: boolean, connected: boolean): string {
  if (!enabled) return 'Paused in the Trace menu; history-only routing remains active.';
  if (!connected) return 'Load the Trace Chrome extension once; history-only routing remains active.';
  if (!authorized) return 'Chrome page access is not authorized.';
  return 'Chrome extension connected. Approved research pages are captured automatically.';
}

function humanCaptureReason(reason: string): string {
  const labels: Record<string, string> = {
    capture_disabled: 'disabled', permission_required: 'permission required', capture_agent_offline: 'capture extension offline',
    sensitive_url: 'sensitive page excluded', rate_limited: 'rate limit', url_cooldown: 'URL cooldown',
    unsupported_system: 'unsupported macOS version', browser_not_frontmost: 'browser not frontmost',
    private_window: 'private window excluded', no_matching_window: 'active tab changed',
    capture_failed: 'browser capture failed', encoding_failed: 'image encoding failed',
    upload_failed: 'localhost upload failed', invalid_payload: 'invalid image payload',
    capture_timeout: 'capture timed out', near_duplicate: 'full duplicate omitted',
  };
  return labels[reason] ?? reason.replaceAll('_', ' ');
}

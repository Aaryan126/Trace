import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { fetchFeed, fetchLiveTrace, searchTrace, type FeedEvent, type LiveTraceResponse, type SearchResult } from '../lib/api';
import { FeedCard } from './FeedCard';
import { Icon } from './Icon';

type Surface = 'search' | 'activity' | 'system' | null;

export function Layout() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [captureConnected, setCaptureConnected] = useState(false);
  const [surface, setSurface] = useState<Surface>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => localStorage.getItem('trace-theme') === 'dark' ? 'dark' : 'light');

  useEffect(() => { fetchFeed({ limit: 1 }).then((response) => setUnreadCount(response.unread)).catch(() => {}); }, [surface]);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('trace-theme', theme); }, [theme]);
  useEffect(() => {
    const load = () => fetchLiveTrace().then((live) => setCaptureConnected(Boolean(live.capture?.enabled && live.capture?.connected))).catch(() => setCaptureConnected(false));
    void load(); const interval = setInterval(load, 30_000); return () => clearInterval(interval);
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="app-shell min-h-screen">
        <header className="topbar sticky top-0 z-40">
          <div className="mx-auto flex h-16 max-w-[1680px] items-center gap-5 px-4 sm:px-6 lg:px-8">
            <NavLink to="/" className="flex items-center gap-2.5 text-sm font-semibold text-[var(--text-strong)]"><span className="brand-mark"><Icon name="branch" className="h-4 w-4" /></span>Trace</NavLink>
            <nav className="top-tabs" aria-label="Trace views"><NavLink to="/decisions" className="top-tab top-tab-active">Decisions</NavLink><button type="button" className="top-tab" onClick={() => setSurface('search')}><Icon name="search" className="h-3.5 w-3.5" /> Search</button></nav>
            <div className="ml-auto flex items-center gap-2">
              <button type="button" className="topbar-action" onClick={() => setSurface('activity')} aria-label="Open activity"><Icon name="activity" className="h-4 w-4" /><span className="hidden sm:inline">Activity</span>{unreadCount > 0 && <span className="tab-count">{unreadCount}</span>}</button>
              <button type="button" className="topbar-action" onClick={() => setSurface('system')} aria-label="Open Trace system status"><span className={`capture-dot ${captureConnected ? 'is-online' : ''}`} /><span className="hidden sm:inline">{captureConnected ? 'Capture online' : 'Capture offline'}</span></button>
              <button type="button" className="icon-button" onClick={() => setTheme((value) => value === 'light' ? 'dark' : 'light')} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}>{theme === 'light' ? '◐' : '☀'}</button>
            </div>
          </div>
        </header>
        <main className="trace-grid min-w-0"><div className="mx-auto max-w-[1680px] px-4 py-6 sm:px-6 lg:px-8"><Outlet context={{ unreadCount, setUnreadCount }} /></div></main>
        <AnimatePresence>{surface && <SurfaceOverlay surface={surface} onClose={() => setSurface(null)} />}</AnimatePresence>
      </div>
    </MotionConfig>
  );
}

function SurfaceOverlay({ surface, onClose }: { surface: Exclude<Surface, null>; onClose: () => void }) {
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [onClose]);
  return <div className="surface-overlay" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <motion.aside className={`surface-panel surface-panel-${surface}`} role="dialog" aria-modal="true" aria-label={surface === 'search' ? 'Search Trace' : surface === 'activity' ? 'Recent activity' : 'Trace system status'} initial={{ opacity: 0, x: surface === 'search' ? 0 : 28, y: surface === 'search' ? -18 : 0, scale: surface === 'search' ? 0.98 : 1 }} animate={{ opacity: 1, x: 0, y: 0, scale: 1 }} exit={{ opacity: 0, x: surface === 'search' ? 0 : 24, y: surface === 'search' ? -12 : 0, scale: surface === 'search' ? 0.98 : 1 }} transition={{ type: 'spring', stiffness: 430, damping: 38 }}>
      <div className="surface-header"><div><span>{surface === 'search' ? 'FIND YOUR TRAIL' : surface === 'activity' ? 'AUDIT TRAIL' : 'SYSTEM STATUS'}</span><h2>{surface === 'search' ? 'Search Trace' : surface === 'activity' ? 'Recent activity' : 'Live Trace'}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close">×</button></div>
      {surface === 'search' ? <SearchSurface onClose={onClose} /> : surface === 'activity' ? <ActivitySurface onClose={onClose} /> : <SystemSurface />}
    </motion.aside>
  </div>;
}

function SearchSurface({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState(''); const [results, setResults] = useState<SearchResult[]>([]); const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const timer = setTimeout(() => { setLoading(true); searchTrace(query.trim()).then((response) => setResults(response.results)).finally(() => setLoading(false)); }, 180);
    return () => clearTimeout(timer);
  }, [query]);
  return <div className="search-surface"><label><Icon name="search" className="h-5 w-5" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search decisions, verdicts, and evidence…" /></label><div className="search-results">{loading && <p>Searching your research history…</p>}{!loading && query && !results.length && <p>No matching decision trail.</p>}{results.map((result) => <button key={result.threadId} type="button" onClick={() => { onClose(); navigate(`/threads/${result.threadId}`); }}><span>{result.matchType}</span><strong>{result.threadTitle}</strong><p>{result.excerpt}</p></button>)}</div></div>;
}

function ActivitySurface({ onClose }: { onClose: () => void }) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  useEffect(() => { fetchFeed({ limit: 30 }).then((response) => setEvents(response.events)).catch(() => {}); }, []);
  return <div className="drawer-scroll activity-drawer">{events.length ? events.map((event) => <FeedCard key={event.id} event={event} onClick={onClose} />) : <p className="drawer-empty">No activity yet. New checkpoints and reopened decisions appear here.</p>}</div>;
}

function SystemSurface() {
  const [live, setLive] = useState<LiveTraceResponse | null>(null);
  useEffect(() => { const load = () => fetchLiveTrace().then(setLive).catch(() => setLive(null)); void load(); const timer = setInterval(load, 10_000); return () => clearInterval(timer); }, []);
  if (!live) return <p className="drawer-empty">Trace service is unavailable.</p>;
  const failed = live.sources.filter((source) => source.automationStatus === 'error');
  return <div className="drawer-scroll system-drawer">
    <section><div className="system-health"><span className={`capture-dot ${live.capture?.connected ? 'is-online' : ''}`} /><div><strong>{live.capture?.connected ? 'Browser capture connected' : 'Browser capture offline'}</strong><p>{live.capture?.lastReason ?? 'Automatic routing continues from browser history.'}</p></div></div></section>
    <section><h3>Pipeline</h3><div className="pipeline-row"><span>Capture</span><span>Understand</span><span>File</span><span>Checkpoint</span></div></section>
    <section><h3>Working research · {live.states.length}</h3>{live.states.slice(0, 8).map((state) => <div className="system-item" key={state.id}><strong>{state.threadTitle}</strong><p>{state.researchQuestion}</p><small>{state.status} · {state.evidenceIds.length} sources</small></div>)}</section>
    {failed.length > 0 && <section><h3>Needs retry · {failed.length}</h3>{failed.map((source) => <div className="system-item is-error" key={source.id}><strong>{source.rawText || 'Routing failed'}</strong><p>{source.errorMessage}</p></div>)}</section>}
    <section><h3>Recent automation</h3>{live.actions.slice(0, 12).map((action) => <div className="system-item" key={action.id}><strong>{action.action.replaceAll('_', ' ')}</strong><p>{action.rationale}</p></div>)}</section>
  </div>;
}

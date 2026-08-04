import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import dagre from '@dagrejs/dagre';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';
import type { ApiComparisonMatrix, ApiResearchStoryNode } from '@trace/core';
import type { CommitNode as CommitNodeType, ThreadDetail, TreeData, WorkingState } from '../lib/api';
import { Icon } from './Icon';

type Density = 'overview' | 'reading';
type CanvasKind = ApiResearchStoryNode['kind'] | 'origin' | 'answer' | 'comparison' | 'resume';

interface CanvasNodeData extends Record<string, unknown> {
  kind: CanvasKind;
  eyebrow: string;
  title: string;
  summary: string;
  createdAt?: string;
  status?: string;
  contextLabel?: string;
  sources: CommitNodeType['sourceItems'];
  density: Density;
  comparison?: ApiComparisonMatrix;
  resume?: ThreadDetail['resume'];
  onResume?: () => void;
  onCorrect?: (optionId: string, criterionId: string, value: string, status: ComparisonStatus) => Promise<void>;
  onReset?: (optionId: string, criterionId: string) => Promise<void>;
}

type CanvasNode = Node<CanvasNodeData, 'research'>;
type ComparisonStatus = 'supported' | 'unknown' | 'conflicting' | 'assumption';

interface ThreadGraphProps {
  tree: TreeData;
  commits: CommitNodeType[];
  selectedId?: string | null;
  onSelectNode?: (id: string) => void;
  workingStates?: WorkingState[];
  rootBranchId?: string;
  story?: ThreadDetail['story'];
  currentAnswer?: ThreadDetail['currentAnswer'];
  comparison?: ApiComparisonMatrix;
  resume?: ThreadDetail['resume'];
  threadTitle?: string;
  onResume?: () => void;
  onCorrectComparison?: CanvasNodeData['onCorrect'];
  onResetComparison?: CanvasNodeData['onReset'];
}

const NODE_SIZE: Record<CanvasKind, { width: number; height: number }> = {
  origin: { width: 250, height: 140 }, session: { width: 300, height: 220 }, checkpoint: { width: 300, height: 220 },
  decision: { width: 320, height: 230 }, merge: { width: 300, height: 210 }, working: { width: 330, height: 270 },
  answer: { width: 370, height: 260 }, comparison: { width: 440, height: 350 }, resume: { width: 380, height: 390 },
};
const FOCUSED_NODE_SIZE = { width: 480, height: 430 };

const nodeTypes = { research: ResearchNode };

export function ThreadGraph(props: ThreadGraphProps) {
  const hasStory = Boolean(props.story?.nodes.length || props.commits.length || props.workingStates?.length);
  if (!hasStory) return <p className="canvas-empty">No graph data available.</p>;
  return <ReactFlowProvider><ResearchCanvas {...props} /></ReactFlowProvider>;
}

function ResearchCanvas(props: ThreadGraphProps) {
  const [density, setDensity] = useState<Density>('reading');
  const [selected, setSelected] = useState<string | null>(props.selectedId ?? null);
  const reducedMotion = useReducedMotion();
  const graph = useMemo(() => buildCanvasGraph(props, selected), [props.tree, props.commits, props.workingStates, props.story, props.currentAnswer, props.comparison, props.resume, props.threadTitle, props.onResume, props.onCorrectComparison, props.onResetComparison, selected]);
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(graph.nodes);
  const { fitView } = useReactFlow<CanvasNode, Edge>();

  useLayoutEffect(() => setNodes(graph.nodes), [graph.nodes, setNodes]);
  useEffect(() => setSelected(props.selectedId ?? null), [props.selectedId]);

  const selectNode = useCallback((_event: React.MouseEvent, node: CanvasNode) => {
    setSelected((current) => current === node.id ? null : node.id);
    if (node.data.kind !== 'working' && node.data.kind !== 'origin' && node.data.kind !== 'answer' && node.data.kind !== 'comparison' && node.data.kind !== 'resume') props.onSelectNode?.(node.id);
  }, [props.onSelectNode]);

  const updateDensity = useCallback((_event: MouseEvent | TouchEvent | null, viewport: { zoom: number }) => {
    setDensity((current) => {
      if (current === 'reading' && viewport.zoom < 0.62) return 'overview';
      if (current === 'overview' && viewport.zoom > 0.74) return 'reading';
      return current;
    });
  }, []);

  const visibleNodes = nodes.map((node) => ({ ...node, selected: node.id === selected, data: { ...node.data, density } }));

  return (
    <MotionConfig reducedMotion="user" transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.8 }}>
      <div
        className="research-canvas"
        data-testid="research-canvas"
        style={{ height: 'calc(100vh - 330px)', minHeight: 620, maxHeight: 900 }}
      >
        <ReactFlow<CanvasNode, Edge>
          nodes={visibleNodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={selectNode}
          onPaneClick={() => setSelected(null)}
          onMove={updateDensity}
          fitView
          fitViewOptions={{ padding: 0.16, maxZoom: 1 }}
          minZoom={0.32}
          maxZoom={1.5}
          nodesConnectable={false}
          deleteKeyCode={null}
          elevateNodesOnSelect
          proOptions={{ hideAttribution: true }}
          aria-label="Interactive research story map"
        >
          <Background gap={28} size={1} color="var(--grid-strong)" />
          <Controls showInteractive={false} position="bottom-left" />
          <MiniMap pannable zoomable position="bottom-right" nodeStrokeWidth={2} nodeColor={(node) => minimapColor((node.data as CanvasNodeData).kind)} />
          <Panel position="top-left" className="canvas-toolbar">
            <span className="canvas-live-dot" />
            <span>Research story</span>
            <span className="canvas-toolbar-divider" />
            <span>{density === 'overview' ? 'overview' : 'details'}</span>
          </Panel>
          <Panel position="top-right" className="canvas-toolbar">
            <button type="button" onClick={() => void fitView({ padding: 0.16, duration: reducedMotion ? 0 : 320 })}>
              <Icon name="branch" className="h-3.5 w-3.5" /> Fit story
            </button>
          </Panel>
        </ReactFlow>
      </div>
    </MotionConfig>
  );
}

function ResearchNode({ data, selected }: NodeProps<CanvasNode>) {
  const [tab, setTab] = useState<'story' | 'evidence' | 'comparison'>('story');
  const captures = data.sources.filter((source) => source.capture);
  const isSpecial = ['answer', 'comparison', 'resume'].includes(data.kind);
  const showReading = data.density === 'reading' || selected || isSpecial;

  return (
    <article
      className={`research-node research-node-${data.kind}${selected ? ' is-focused' : ''}`}
      aria-label={`${data.eyebrow}: ${data.title}`}
    >
      <Handle type="target" position={Position.Left} className="research-handle" />
      <div className="research-node-body">
        <div className="research-node-topline">
          <span className="research-node-kind"><NodeGlyph kind={data.kind} />{data.eyebrow}</span>
          {data.status && <span className={`research-status research-status-${data.status}`}>{data.status.replace('_', ' ')}</span>}
        </div>
        <h3>{data.title}</h3>
        {showReading && <p className="research-node-summary">{data.summary}</p>}

        {showReading && captures.length > 0 && (
          <div className="research-capture-strip">
            {captures.slice(0, 3).map((source) => (
              <a key={source.id} href={source.capture?.fullUrl ?? source.capture?.thumbnailUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                <img src={source.capture!.thumbnailUrl} alt={`Captured context for ${source.rawText || data.title}`} />
              </a>
            ))}
            <span>{captures.length} screenshot{captures.length === 1 ? '' : 's'}</span>
          </div>
        )}

        {data.kind === 'comparison' && data.comparison && <ComparisonGrid matrix={data.comparison} onCorrect={data.onCorrect} onReset={data.onReset} />}
        {data.kind === 'resume' && data.resume && <ResumeContent resume={data.resume} onResume={data.onResume} />}

        <AnimatePresence initial={false}>
          {selected && !['comparison', 'resume', 'origin'].includes(data.kind) && (
            <motion.div className="research-focus" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}>
              <div className="research-focus-tabs" role="tablist" aria-label="Node details">
                {(['story', 'evidence', ...(data.comparison ? ['comparison'] : [])] as Array<'story' | 'evidence' | 'comparison'>).map((value) => (
                  <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={(event) => { event.stopPropagation(); setTab(value); }}>{value}</button>
                ))}
              </div>
              {tab === 'story' && <p>{data.summary}</p>}
              {tab === 'evidence' && <EvidenceList sources={data.sources} />}
              {tab === 'comparison' && data.comparison && <ComparisonGrid matrix={data.comparison} onCorrect={data.onCorrect} onReset={data.onReset} />}
            </motion.div>
          )}
        </AnimatePresence>
        {data.createdAt && <time dateTime={data.createdAt}>{relativeTime(data.createdAt)}</time>}
      </div>
      <Handle type="source" position={Position.Right} className="research-handle" />
    </article>
  );
}

function ComparisonGrid({ matrix, onCorrect, onReset }: { matrix: ApiComparisonMatrix; onCorrect?: CanvasNodeData['onCorrect']; onReset?: CanvasNodeData['onReset'] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<ComparisonStatus>('supported');
  if (!matrix.options.length) return <p className="comparison-empty">Trace is collecting named options for this comparison.</p>;
  if (!matrix.criteria.length) return <p className="comparison-empty">Options found. Criterion-level evidence will appear here as research continues.</p>;
  return (
    <div className="comparison-wrap" onClick={(event) => event.stopPropagation()}>
      <table className="comparison-grid">
        <thead><tr><th>Criterion</th>{matrix.options.map((option) => <th key={option.id}>{option.label}</th>)}</tr></thead>
        <tbody>{matrix.criteria.map((criterion) => (
          <tr key={criterion.id}>
            <th>{criterion.label}</th>
            {matrix.options.map((option) => {
              const cell = matrix.cells.find((candidate) => candidate.optionId === option.id && candidate.criterionId === criterion.id);
              const key = `${option.id}:${criterion.id}`;
              return <td key={key} className={`comparison-cell comparison-${cell?.status ?? 'unknown'}`}>
                {editing === key ? (
                  <form onSubmit={(event) => { event.preventDefault(); void onCorrect?.(option.id, criterion.id, value, status).then(() => setEditing(null)); }}>
                    <input aria-label={`Correct ${option.label} ${criterion.label}`} value={value} onChange={(event) => setValue(event.target.value)} autoFocus />
                    <select value={status} onChange={(event) => setStatus(event.target.value as ComparisonStatus)}><option value="supported">Supported</option><option value="unknown">Unknown</option><option value="conflicting">Conflicting</option><option value="assumption">Assumption</option></select>
                    <div><button type="submit">Save</button><button type="button" onClick={() => setEditing(null)}>Cancel</button></div>
                  </form>
                ) : (
                  <button type="button" className="comparison-value" onClick={() => { setEditing(key); setValue(cell?.value ?? ''); setStatus(cell?.status ?? 'unknown'); }}>
                    <span>{cell?.value || 'Unknown'}</span>
                    <small>{cell?.corrected ? 'corrected' : cell?.status ?? 'unknown'}{cell?.sourceItemIds.length ? ` · ${cell.sourceItemIds.length} source${cell.sourceItemIds.length === 1 ? '' : 's'}` : ''}</small>
                  </button>
                )}
                {cell?.corrected && <button type="button" className="comparison-reset" onClick={() => void onReset?.(option.id, criterion.id)}>Reset</button>}
              </td>;
            })}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function ResumeContent({ resume, onResume }: { resume: ThreadDetail['resume']; onResume?: () => void }) {
  return <div className="resume-content" onClick={(event) => event.stopPropagation()}>
    {resume.nextQuestion && <div className="resume-question"><span>Next question</span><strong>{resume.nextQuestion}</strong></div>}
    {resume.pages.length > 0 && <div className="resume-pages">{resume.pages.map((page) => <div key={page.id}>{page.thumbnailUrl && <img src={page.thumbnailUrl} alt="" />}<span>{page.title}</span></div>)}</div>}
    <button type="button" className="resume-button" onClick={onResume}><Icon name="branch" className="h-4 w-4" /> Resume research{resume.pages.length ? ` · ${resume.pages.length} page${resume.pages.length === 1 ? '' : 's'}` : ''}</button>
  </div>;
}

function EvidenceList({ sources }: { sources: CommitNodeType['sourceItems'] }) {
  if (!sources.length) return <p>No source items were attached to this checkpoint.</p>;
  return <div className="focus-evidence">{sources.map((source) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{source.capture && <img src={source.capture.thumbnailUrl} alt="" />}<span>{source.rawText || source.url || 'Captured evidence'}</span></a>)}</div>;
}

function NodeGlyph({ kind }: { kind: CanvasKind }) {
  const glyph = kind === 'origin' ? '◆' : kind === 'merge' ? '◇' : kind === 'working' ? '◌' : kind === 'answer' ? '●' : kind === 'comparison' ? '▦' : kind === 'resume' ? '→' : '○';
  return <span aria-hidden="true">{glyph}</span>;
}

function buildCanvasGraph(props: ThreadGraphProps, selectedId: string | null): { nodes: CanvasNode[]; edges: Edge[] } {
  const density: Density = 'reading';
  const storyNodes: ApiResearchStoryNode[] = props.story?.nodes ?? props.commits.map((commit) => ({
    id: commit.id, kind: commit.kind === 'merge' ? 'merge' : commit.resolutionStatus === 'resolved' ? 'decision' : 'checkpoint', branchId: commit.branchId ?? props.rootBranchId ?? 'main',
    contextLabel: props.tree.nodes.find((node) => node.id === commit.id)?.contextLabel ?? 'Original research context', title: commit.verdictSummary,
    summary: commit.reasoning, createdAt: commit.createdAt, status: commit.resolutionStatus ?? 'in_progress', sourceItems: commit.sourceItems, commitId: commit.id,
  }));
  if (!props.story) {
    for (const state of props.workingStates ?? []) storyNodes.push({ id: `working:${state.id}`, kind: 'working', branchId: state.branchId, contextLabel: 'Current context', title: state.researchQuestion, summary: state.summary, createdAt: state.lastEventAt, status: 'working', sourceItems: state.evidence });
  }
  const rawNodes: CanvasNode[] = [{ id: 'origin', type: 'research', position: { x: 0, y: 0 }, draggable: false, data: { kind: 'origin', eyebrow: 'Decision', title: props.threadTitle ?? 'Research decision', summary: 'The point where this research story began.', sources: [], density } }];
  for (const item of storyNodes) rawNodes.push({ id: item.id, type: 'research', position: { x: 0, y: 0 }, data: { kind: item.kind, eyebrow: labelFor(item.kind), title: item.title, summary: item.summary, createdAt: item.createdAt, status: item.status, contextLabel: item.contextLabel, sources: item.sourceItems, density } });
  const rawEdges: Edge[] = (props.story?.edges ?? props.tree.edges).map((edge) => ({ id: `${edge.from}:${edge.to}`, source: edge.from, target: edge.to, type: 'smoothstep', animated: edge.type === 'branch', className: `story-edge story-edge-${edge.type}`, markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 } }));
  const incoming = new Set(rawEdges.map((edge) => edge.target));
  const firstNodes = storyNodes.filter((node) => !incoming.has(node.id));
  for (const node of firstNodes) rawEdges.push({ id: `origin:${node.id}`, source: 'origin', target: node.id, type: 'smoothstep', className: 'story-edge story-edge-sequential', markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 } });

  const latest = [...storyNodes].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
  if (props.currentAnswer) {
    rawNodes.push({ id: 'current-answer', type: 'research', position: { x: 0, y: 0 }, draggable: false, data: { kind: 'answer', eyebrow: props.currentAnswer.status === 'working' ? 'Current direction' : 'Current answer', title: props.currentAnswer.text, summary: props.currentAnswer.reasoning, createdAt: props.currentAnswer.updatedAt, status: props.currentAnswer.status, sources: latest?.sourceItems ?? [], density } });
    rawEdges.push({ id: `${latest?.id ?? 'origin'}:current-answer`, source: latest?.id ?? 'origin', target: 'current-answer', type: 'smoothstep', className: 'story-edge story-edge-answer', markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 } });
  }
  if (props.comparison?.options.length) {
    rawNodes.push({ id: 'comparison', type: 'research', position: { x: 0, y: 0 }, draggable: false, data: { kind: 'comparison', eyebrow: 'Live comparison', title: 'Options, claims, and unknowns', summary: 'Trace updates this source-backed matrix as evidence arrives.', sources: latest?.sourceItems ?? [], density, comparison: props.comparison, onCorrect: props.onCorrectComparison, onReset: props.onResetComparison } });
    rawEdges.push({ id: 'current-answer:comparison', source: props.currentAnswer ? 'current-answer' : latest?.id ?? 'origin', target: 'comparison', type: 'smoothstep', className: 'story-edge story-edge-context' });
  }
  if (props.resume) {
    rawNodes.push({ id: 'resume', type: 'research', position: { x: 0, y: 0 }, draggable: false, data: { kind: 'resume', eyebrow: 'You left off here', title: props.resume.nextQuestion ?? 'Continue from your latest evidence', summary: props.resume.summary, sources: [], density, resume: props.resume, onResume: props.onResume } });
    rawEdges.push({ id: 'current-answer:resume', source: props.currentAnswer ? 'current-answer' : latest?.id ?? 'origin', target: 'resume', type: 'smoothstep', animated: true, className: 'story-edge story-edge-resume', markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 } });
  }
  return layoutGraph(rawNodes, rawEdges, selectedId);
}

function layoutGraph(nodes: CanvasNode[], edges: Edge[], selectedId: string | null): { nodes: CanvasNode[]; edges: Edge[] } {
  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: 'LR', nodesep: 70, ranksep: 110, marginx: 50, marginy: 70, acyclicer: 'greedy' });
  for (const node of nodes) { graph.setNode(node.id, { ...nodeSize(node, selectedId) }); }
  for (const edge of edges) if (nodes.some((node) => node.id === edge.source) && nodes.some((node) => node.id === edge.target)) graph.setEdge(edge.source, edge.target);
  dagre.layout(graph);
  return {
    nodes: nodes.map((node) => {
      const point = graph.node(node.id); const size = nodeSize(node, selectedId);
      return { ...node, position: { x: point.x - size.width / 2, y: point.y - size.height / 2 }, style: { width: size.width, height: size.height } };
    }),
    edges: edges.filter((edge) => graph.hasNode(edge.source) && graph.hasNode(edge.target)),
  };
}

function nodeSize(node: CanvasNode, selectedId: string | null): { width: number; height: number } {
  if (node.id === selectedId && !['origin', 'comparison', 'resume'].includes(node.data.kind)) return FOCUSED_NODE_SIZE;
  return NODE_SIZE[node.data.kind];
}

function labelFor(kind: ApiResearchStoryNode['kind']): string {
  return kind === 'working' ? 'Current session' : kind === 'decision' ? 'Verdict committed' : kind === 'merge' ? 'Contexts merged' : kind === 'session' ? 'Research session' : 'Checkpoint';
}

function minimapColor(kind: CanvasKind): string {
  if (kind === 'answer') return '#16a34a';
  if (kind === 'resume') return '#7c3aed';
  if (kind === 'working') return '#2563eb';
  if (kind === 'comparison') return '#0f766e';
  return '#94a3b8';
}

function relativeTime(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60); if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24); return `${days}d ago`;
}

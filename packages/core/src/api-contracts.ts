export interface ApiSourceItem {
  id: string;
  type: 'screenshot' | 'browser_history';
  rawText: string;
  url?: string;
  capturedAt: string;
  automationStatus?: 'pending' | 'processing' | 'filed' | 'ignored' | 'error' | 'legacy_unresolved';
  contentStatus?: 'not_requested' | 'fetched' | 'metadata_only' | 'failed';
  errorMessage?: string;
  captureStatus?: 'not_requested' | 'queued' | 'capturing' | 'captured' | 'skipped' | 'failed';
  captureReason?: string;
  capture?: {
    thumbnailUrl: string;
    fullUrl?: string;
    width: number;
    height: number;
    capturedAt: string;
  };
}

export interface ApiCommit {
  id: string;
  parentId: string | null;
  branchId: string | null;
  verdictSummary: string;
  reasoning: string;
  createdAt: string;
  regret: boolean;
  sourceItems: ApiSourceItem[];
  kind?: 'checkpoint' | 'resolved' | 'merge' | 'revert';
  resolutionStatus?: 'in_progress' | 'resolved';
  comparison: ApiComparisonMatrix;
  outcome?: ApiDecisionOutcome;
}

export type ApiDecisionOutcomeStatus = 'worked' | 'mixed' | 'regretted' | 'superseded';

export interface ApiDecisionOutcome {
  status: ApiDecisionOutcomeStatus;
  note: string;
  updatedAt: string;
}

export type ApiComparisonCellStatus = 'supported' | 'unknown' | 'conflicting' | 'assumption';

export interface ApiComparisonMatrix {
  options: Array<{ id: string; label: string }>;
  criteria: Array<{ id: string; label: string }>;
  cells: Array<{
    optionId: string;
    criterionId: string;
    value: string;
    status: ApiComparisonCellStatus;
    sourceItemIds: string[];
    corrected?: boolean;
    pinned?: boolean;
  }>;
}

export interface ApiBranch {
  id: string;
  contextLabel: string;
  commits: ApiCommit[];
}

export interface ApiThread {
  id: string;
  title: string;
  status: 'open' | 'closed';
  tags: string[];
  lastActivity: string;
  itemCount: number;
  createdAt: string;
}

export interface ApiThreadDetail extends ApiThread {
  verdictSummary?: string;
  reasoning?: string;
  branches: ApiBranch[];
  workingStates?: ApiWorkingState[];
  story: {
    nodes: ApiResearchStoryNode[];
    edges: ApiTreeEdge[];
  };
  currentAnswer?: {
    text: string;
    reasoning: string;
    status: 'working' | 'committed';
    branchId: string;
    updatedAt: string;
    sourceCount: number;
  };
  comparison: ApiComparisonMatrix;
  resume: {
    branchId?: string;
    nextQuestion?: string;
    summary: string;
    pages: Array<{ id: string; title: string; url: string; capturedAt: string; thumbnailUrl?: string }>;
  };
  outcomeReview?: {
    commitId: string;
    branchId: string;
    decision: string;
    decidedAt: string;
    outcome?: ApiDecisionOutcome;
  };
}

export interface ApiResearchStoryNode {
  id: string;
  kind: 'session' | 'checkpoint' | 'decision' | 'merge' | 'working';
  branchId: string;
  contextLabel: string;
  title: string;
  summary: string;
  createdAt: string;
  status: 'working' | 'in_progress' | 'resolved';
  sourceItems: ApiSourceItem[];
  commitId?: string;
  origin?: 'automatic' | 'manual';
}

export interface ApiWorkingState {
  id: string;
  branchId: string;
  threadId: string;
  threadTitle: string;
  researchQuestion: string;
  summary: string;
  options: string[];
  constraints: string[];
  openQuestions: string[];
  tentativeDirection?: string;
  changedFactors: string[];
  evidenceIds: string[];
  evidence: ApiSourceItem[];
  status: 'active' | 'checkpointing' | 'error';
  lastEventAt: string;
  checkpointDueAt: string;
  comparison: ApiComparisonMatrix;
}

export interface ApiSearchResult {
  threadId: string;
  threadTitle: string;
  status: 'open' | 'closed';
  lastActivity: string;
  matchType: 'decision' | 'verdict' | 'evidence';
  excerpt: string;
  score: number;
}

export interface ApiAutomationAction {
  id: string;
  action: string;
  sourceItemId?: string;
  threadId?: string;
  branchId?: string;
  threadTitle?: string;
  confidence?: number;
  rationale: string;
  latencyMs?: number;
  status: 'applied' | 'failed' | 'reverted';
  undoable: boolean;
  createdAt: string;
}

export interface ApiFeedEvent {
  id: string;
  type: 'reopen' | 'nudge' | 'digest' | 'commit_closed';
  threadId: string;
  threadTitle: string;
  createdAt: string;
  read: boolean;
  eventIds: string[];
  updateCount: number;
  branchId?: string;
  kind?: 'checkpoint' | 'resolved' | 'merge' | 'revert';
  resolutionStatus?: 'in_progress' | 'resolved';
  updates?: Array<{ id: string; createdAt: string; verdictSummary: string }>;
  data: Record<string, unknown> & {
    diffSummary?: string;
    changedFactors?: string[];
    previousVerdict?: string;
    itemCount?: number;
    timespan?: string;
    verdictSummary?: string;
    verdict?: string;
  };
}

export interface ApiBrowserCaptureHealth {
  enabled: boolean;
  authorized: boolean;
  connected: boolean;
  lastHeartbeatAt: string | null;
  lastAttemptAt: string | null;
  lastResult: 'queued' | 'capturing' | 'captured' | 'skipped' | 'failed' | null;
  lastReason: string | null;
  agents: Array<{
    id: 'chrome_extension' | 'mac_screen';
    connected: boolean;
    authorized: boolean;
    lastHeartbeatAt: string | null;
  }>;
}

export interface ApiTreeNode {
  id: string;
  type: 'commit' | 'merge';
  branchId: string | null;
  contextLabel?: string;
  regret: boolean;
  createdAt: string;
}

export interface ApiTreeEdge {
  from: string;
  to: string;
  type: 'sequential' | 'branch' | 'merge';
}

export interface ApiCaptureItem extends ApiSourceItem {
  suggestion?: {
    threadId: string;
    threadTitle: string;
    confidence: number;
  };
}

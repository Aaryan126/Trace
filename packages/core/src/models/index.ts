export interface Thread {
  id: string;
  title: string;
  tags: string[];
  status: 'open' | 'closed';
  created_at: string;
  updated_at: string;
}

export interface Branch {
  id: string;
  thread_id: string;
  parent_commit_id: string | null;
  context_label: string | null;
  created_at: string;
}

export interface Commit {
  id: string;
  branch_id: string;
  verdict_summary: string;
  reasoning: string;
  source_item_ids: string[];
  created_at: string;
  regret: boolean;
  regret_note: string | null;
  kind: 'checkpoint' | 'resolved' | 'merge' | 'revert';
  resolution_status: 'in_progress' | 'resolved';
  comparison: ComparisonMatrix;
}

export type ComparisonCellStatus = 'supported' | 'unknown' | 'conflicting' | 'assumption';

export interface ComparisonOption {
  id: string;
  label: string;
}

export interface ComparisonCriterion {
  id: string;
  label: string;
}

export interface ComparisonCell {
  option_id: string;
  criterion_id: string;
  value: string;
  status: ComparisonCellStatus;
  source_item_ids: string[];
}

export interface ComparisonMatrix {
  options: ComparisonOption[];
  criteria: ComparisonCriterion[];
  cells: ComparisonCell[];
}

export interface ComparisonOverride {
  id: string;
  branch_id: string;
  option_id: string;
  criterion_id: string;
  value: string;
  status: ComparisonCellStatus;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface SourceItem {
  id: string;
  type: 'screenshot' | 'browser_history';
  raw_text: string | null;
  extracted_entities: Record<string, unknown> | null;
  url: string | null;
  captured_at: string;
  thread_id: string | null;
  branch_id: string | null;
  clustering_confidence: number | null;
  processed: boolean;
  content_text: string | null;
  content_status: 'not_requested' | 'fetched' | 'metadata_only' | 'failed';
  automation_status: 'pending' | 'processing' | 'filed' | 'ignored' | 'error' | 'legacy_unresolved';
  automation_attempts: number;
  processed_at: string | null;
  error_message: string | null;
  visual_context: string | null;
  capture_status: 'not_requested' | 'queued' | 'capturing' | 'captured' | 'skipped' | 'failed';
  capture_reason: string | null;
  capture_updated_at: string | null;
}

export interface CaptureAsset {
  id: string;
  source_item_id: string;
  full_path: string | null;
  thumbnail_path: string;
  mime_type: string;
  byte_size: number;
  width: number;
  height: number;
  visual_hash: string;
  captured_at: string;
  full_expires_at: string;
  pinned: boolean;
}

export interface BranchWorkingState {
  id: string;
  branch_id: string;
  research_question: string;
  summary: string;
  options: string[];
  constraints: string[];
  open_questions: string[];
  tentative_direction: string | null;
  evidence_ids: string[];
  changed_factors: string[];
  status: 'active' | 'checkpointing' | 'error';
  last_event_at: string;
  checkpoint_due_at: string;
  updated_at: string;
  comparison: ComparisonMatrix;
}

export interface AutomationAction {
  id: string;
  action: string;
  source_item_id: string | null;
  thread_id: string | null;
  branch_id: string | null;
  model: string | null;
  confidence: number | null;
  rationale: string;
  context_snapshot: Record<string, unknown>;
  before_snapshot: Record<string, unknown>;
  after_snapshot: Record<string, unknown>;
  latency_ms: number | null;
  status: 'applied' | 'failed' | 'reverted';
  undoable: boolean;
  created_at: string;
  reverted_at: string | null;
}

export interface MergeEvent {
  id: string;
  thread_id: string;
  source_branch_ids: string[];
  resulting_commit_id: string;
  resolved_rule: string;
  created_at: string;
}

export interface FeedEvent {
  id: string;
  type: 'reopen' | 'digest' | 'commit_closed' | 'nudge';
  thread_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  read: boolean;
}

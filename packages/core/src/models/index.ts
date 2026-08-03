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
}

export interface SourceItem {
  id: string;
  type: 'screenshot' | 'browser_history';
  raw_text: string | null;
  extracted_entities: Record<string, unknown> | null;
  url: string | null;
  captured_at: string;
  thread_id: string | null;
  processed: boolean;
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

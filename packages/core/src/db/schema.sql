CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('open', 'closed')) DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  parent_commit_id TEXT,
  context_label TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_commit_id) REFERENCES commits(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS commits (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  verdict_summary TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  source_item_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  regret INTEGER NOT NULL DEFAULT 0,
  regret_note TEXT,
  kind TEXT NOT NULL DEFAULT 'checkpoint' CHECK (kind IN ('checkpoint', 'resolved', 'merge', 'revert')),
  resolution_status TEXT NOT NULL DEFAULT 'in_progress' CHECK (resolution_status IN ('in_progress', 'resolved')),
  comparison_json TEXT NOT NULL DEFAULT '{"options":[],"criteria":[],"cells":[]}',
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS source_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('screenshot', 'browser_history')),
  raw_text TEXT,
  extracted_entities TEXT,
  url TEXT,
  captured_at TEXT NOT NULL,
  thread_id TEXT,
  branch_id TEXT,
  clustering_confidence REAL,
  processed INTEGER NOT NULL DEFAULT 0,
  content_text TEXT,
  content_status TEXT NOT NULL DEFAULT 'not_requested' CHECK (content_status IN ('not_requested', 'fetched', 'metadata_only', 'failed')),
  automation_status TEXT NOT NULL DEFAULT 'pending' CHECK (automation_status IN ('pending', 'processing', 'filed', 'ignored', 'error', 'legacy_unresolved')),
  automation_attempts INTEGER NOT NULL DEFAULT 0,
  processed_at TEXT,
  error_message TEXT,
  visual_context TEXT,
  capture_status TEXT NOT NULL DEFAULT 'not_requested' CHECK (capture_status IN ('not_requested', 'queued', 'capturing', 'captured', 'skipped', 'failed')),
  capture_reason TEXT,
  capture_updated_at TEXT,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE SET NULL,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS capture_assets (
  id TEXT PRIMARY KEY,
  source_item_id TEXT NOT NULL UNIQUE,
  full_path TEXT,
  thumbnail_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  visual_hash TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  full_expires_at TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (source_item_id) REFERENCES source_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS merge_events (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  source_branch_ids TEXT NOT NULL DEFAULT '[]',
  resulting_commit_id TEXT NOT NULL,
  resolved_rule TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'automatic' CHECK (origin IN ('automatic', 'manual')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
  FOREIGN KEY (resulting_commit_id) REFERENCES commits(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS decision_outcomes (
  id TEXT PRIMARY KEY,
  commit_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('worked', 'mixed', 'regretted', 'superseded')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (commit_id) REFERENCES commits(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS feed_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('reopen', 'digest', 'commit_closed', 'nudge')),
  thread_id TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS branch_working_states (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL UNIQUE,
  research_question TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  options TEXT NOT NULL DEFAULT '[]',
  constraints TEXT NOT NULL DEFAULT '[]',
  open_questions TEXT NOT NULL DEFAULT '[]',
  tentative_direction TEXT,
  evidence_ids TEXT NOT NULL DEFAULT '[]',
  changed_factors TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'checkpointing', 'error')),
  last_event_at TEXT NOT NULL,
  checkpoint_due_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  comparison_json TEXT NOT NULL DEFAULT '{"options":[],"criteria":[],"cells":[]}',
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comparison_overrides (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  option_id TEXT NOT NULL,
  criterion_id TEXT NOT NULL,
  value TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('supported', 'unknown', 'conflicting', 'assumption')),
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(branch_id, option_id, criterion_id),
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS automation_actions (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  source_item_id TEXT,
  thread_id TEXT,
  branch_id TEXT,
  model TEXT,
  confidence REAL,
  rationale TEXT NOT NULL DEFAULT '',
  context_snapshot TEXT NOT NULL DEFAULT '{}',
  before_snapshot TEXT NOT NULL DEFAULT '{}',
  after_snapshot TEXT NOT NULL DEFAULT '{}',
  latency_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'failed', 'reverted')),
  undoable INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  reverted_at TEXT,
  FOREIGN KEY (source_item_id) REFERENCES source_items(id) ON DELETE SET NULL,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE SET NULL,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS semantic_embeddings (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('source_item', 'thread')),
  entity_id TEXT NOT NULL,
  model TEXT NOT NULL,
  vector TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(entity_type, entity_id, model)
);

CREATE INDEX IF NOT EXISTS idx_source_items_processed ON source_items(processed, captured_at);
CREATE INDEX IF NOT EXISTS idx_source_items_thread ON source_items(thread_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_feed_events_type ON feed_events(type, created_at);
CREATE INDEX IF NOT EXISTS idx_working_states_due ON branch_working_states(checkpoint_due_at);
CREATE INDEX IF NOT EXISTS idx_automation_actions_created ON automation_actions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_capture_assets_expiry ON capture_assets(full_expires_at);
CREATE INDEX IF NOT EXISTS idx_comparison_overrides_branch ON comparison_overrides(branch_id);
CREATE INDEX IF NOT EXISTS idx_decision_outcomes_commit ON decision_outcomes(commit_id);

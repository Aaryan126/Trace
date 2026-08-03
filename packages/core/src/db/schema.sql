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
  processed INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS merge_events (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  source_branch_ids TEXT NOT NULL DEFAULT '[]',
  resulting_commit_id TEXT NOT NULL,
  resolved_rule TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
  FOREIGN KEY (resulting_commit_id) REFERENCES commits(id) ON DELETE CASCADE
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

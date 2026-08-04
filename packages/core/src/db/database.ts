import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getSchema(): string {
  return readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
}

function initialize(db: Database.Database): void {
  // Defer FK checks during schema creation (handles circular refs between branches/commits)
  db.pragma('defer_foreign_keys = ON');
  db.exec(getSchema());
  migrate(db);
  db.pragma('defer_foreign_keys = OFF');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
}

function migrate(db: Database.Database): void {
  const columns = db.pragma('table_info(source_items)') as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));

  if (!names.has('branch_id')) {
    db.exec('ALTER TABLE source_items ADD COLUMN branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL');
  }
  if (!names.has('clustering_confidence')) {
    db.exec('ALTER TABLE source_items ADD COLUMN clustering_confidence REAL');
  }

  const sourceColumns: Array<[string, string]> = [
    ['content_text', 'TEXT'],
    ['content_status', "TEXT NOT NULL DEFAULT 'not_requested'"],
    ['automation_status', "TEXT NOT NULL DEFAULT 'legacy_unresolved'"],
    ['automation_attempts', 'INTEGER NOT NULL DEFAULT 0'],
    ['processed_at', 'TEXT'],
    ['error_message', 'TEXT'],
    ['visual_context', 'TEXT'],
    ['capture_status', "TEXT NOT NULL DEFAULT 'not_requested'"],
    ['capture_reason', 'TEXT'],
    ['capture_updated_at', 'TEXT'],
  ];
  for (const [name, definition] of sourceColumns) {
    if (!names.has(name)) db.exec(`ALTER TABLE source_items ADD COLUMN ${name} ${definition}`);
  }

  const commitColumns = db.pragma('table_info(commits)') as Array<{ name: string }>;
  const commitNames = new Set(commitColumns.map((column) => column.name));
  if (!commitNames.has('kind')) db.exec("ALTER TABLE commits ADD COLUMN kind TEXT NOT NULL DEFAULT 'checkpoint'");
  if (!commitNames.has('resolution_status')) db.exec("ALTER TABLE commits ADD COLUMN resolution_status TEXT NOT NULL DEFAULT 'in_progress'");
  if (!commitNames.has('comparison_json')) db.exec(`ALTER TABLE commits ADD COLUMN comparison_json TEXT NOT NULL DEFAULT '{"options":[],"criteria":[],"cells":[]}'`);

  const workingColumns = db.pragma('table_info(branch_working_states)') as Array<{ name: string }>;
  const workingNames = new Set(workingColumns.map((column) => column.name));
  if (!workingNames.has('comparison_json')) db.exec(`ALTER TABLE branch_working_states ADD COLUMN comparison_json TEXT NOT NULL DEFAULT '{"options":[],"criteria":[],"cells":[]}'`);

  const mergeColumns = db.pragma('table_info(merge_events)') as Array<{ name: string }>;
  const mergeNames = new Set(mergeColumns.map((column) => column.name));
  if (!mergeNames.has('origin')) db.exec("ALTER TABLE merge_events ADD COLUMN origin TEXT NOT NULL DEFAULT 'automatic'");

  db.exec(`
    UPDATE source_items
    SET branch_id = (
      SELECT branches.id
      FROM branches
      WHERE branches.thread_id = source_items.thread_id
      ORDER BY branches.created_at ASC
      LIMIT 1
    )
    WHERE branch_id IS NULL AND thread_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_source_items_processed ON source_items(processed, captured_at);
    CREATE INDEX IF NOT EXISTS idx_source_items_thread ON source_items(thread_id, captured_at);
    CREATE INDEX IF NOT EXISTS idx_source_items_branch ON source_items(branch_id, captured_at);
    CREATE INDEX IF NOT EXISTS idx_source_items_automation ON source_items(automation_status, captured_at);
    CREATE INDEX IF NOT EXISTS idx_feed_events_type ON feed_events(type, created_at);
    CREATE INDEX IF NOT EXISTS idx_source_items_capture ON source_items(capture_status, capture_updated_at);

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
    CREATE INDEX IF NOT EXISTS idx_comparison_overrides_branch ON comparison_overrides(branch_id);

    CREATE TABLE IF NOT EXISTS decision_outcomes (
      id TEXT PRIMARY KEY,
      commit_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('worked', 'mixed', 'regretted', 'superseded')),
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (commit_id) REFERENCES commits(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_decision_outcomes_commit ON decision_outcomes(commit_id);

    UPDATE source_items
    SET automation_status = CASE
      WHEN processed = 0 THEN 'legacy_unresolved'
      WHEN thread_id IS NULL THEN 'ignored'
      ELSE 'filed'
    END
    WHERE automation_status IS NULL OR automation_status = '' OR (automation_status = 'legacy_unresolved' AND processed = 1);

    INSERT INTO metadata (key, value) VALUES ('schema_version', '7')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value;
  `);
}

function backupBeforeCurrentSchema(db: Database.Database, dbPath: string, existed: boolean): void {
  if (!existed || dbPath === ':memory:') return;
  const hasSourceItems = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'source_items'").get();
  if (!hasSourceItems) return;
  const hasMetadata = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'metadata'").get();
  const version = hasMetadata
    ? db.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").pluck().get() as string | undefined
    : undefined;
  if (Number(version ?? 0) >= 7) return;
  const backupDir = join(dirname(dbPath), 'backups');
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(backupDir, `trace-pre-v7-${stamp}.sqlite`);
  db.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
}

export function createDatabase(dbPath: string): Database.Database {
  const existed = existsSync(dbPath);
  const db = new Database(dbPath);
  backupBeforeCurrentSchema(db, dbPath, existed);
  initialize(db);
  return db;
}

export function createInMemoryDatabase(): Database.Database {
  const db = new Database(':memory:');
  initialize(db);
  return db;
}

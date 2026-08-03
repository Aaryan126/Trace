import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
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
  db.pragma('defer_foreign_keys = OFF');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
}

export function createDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  initialize(db);
  return db;
}

export function createInMemoryDatabase(): Database.Database {
  const db = new Database(':memory:');
  initialize(db);
  return db;
}

import type Database from 'better-sqlite3';

export class MetadataRepository {
  constructor(private db: Database.Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
  }

  get(key: string): string | null {
    const row = this.db
      .prepare('SELECT value FROM metadata WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  set(key: string, value: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)')
      .run(key, value);
  }
}

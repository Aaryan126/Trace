import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { DecisionOutcome, DecisionOutcomeStatus } from '../../models/index.js';

export class DecisionOutcomeRepository {
  constructor(private db: Database.Database) {}

  upsert(commitId: string, status: DecisionOutcomeStatus, note = ''): DecisionOutcome {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO decision_outcomes (id, commit_id, status, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(commit_id) DO UPDATE SET
        status = excluded.status,
        note = excluded.note,
        updated_at = excluded.updated_at
    `).run(uuidv4(), commitId, status, note.trim(), now, now);
    return this.getByCommit(commitId)!;
  }

  getByCommit(commitId: string): DecisionOutcome | undefined {
    return this.db.prepare('SELECT * FROM decision_outcomes WHERE commit_id = ?').get(commitId) as DecisionOutcome | undefined;
  }

  listByThread(threadId: string): DecisionOutcome[] {
    return this.db.prepare(`
      SELECT decision_outcomes.* FROM decision_outcomes
      JOIN commits ON commits.id = decision_outcomes.commit_id
      JOIN branches ON branches.id = commits.branch_id
      WHERE branches.thread_id = ?
      ORDER BY decision_outcomes.updated_at DESC
    `).all(threadId) as DecisionOutcome[];
  }
}

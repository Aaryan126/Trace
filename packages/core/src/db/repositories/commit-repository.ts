import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { Commit } from '../../models/index.js';

export class CommitRepository {
  constructor(private db: Database.Database) {}

  create(data: Omit<Commit, 'id' | 'created_at' | 'regret' | 'regret_note'> & { id?: string }): Commit {
    const commit: Commit = {
      id: data.id ?? uuidv4(),
      branch_id: data.branch_id,
      verdict_summary: data.verdict_summary,
      reasoning: data.reasoning,
      source_item_ids: data.source_item_ids,
      created_at: new Date().toISOString(),
      regret: false,
      regret_note: null,
    };

    this.db
      .prepare(
        `INSERT INTO commits (id, branch_id, verdict_summary, reasoning, source_item_ids, created_at, regret, regret_note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        commit.id,
        commit.branch_id,
        commit.verdict_summary,
        commit.reasoning,
        JSON.stringify(commit.source_item_ids),
        commit.created_at,
        0,
        null
      );

    return commit;
  }

  getById(id: string): Commit | undefined {
    const row = this.db.prepare('SELECT * FROM commits WHERE id = ?').get(id) as RawCommit | undefined;
    return row ? toCommit(row) : undefined;
  }

  listByBranch(branchId: string): Commit[] {
    const rows = this.db
      .prepare('SELECT * FROM commits WHERE branch_id = ? ORDER BY created_at ASC')
      .all(branchId) as RawCommit[];
    return rows.map(toCommit);
  }

  addRegret(id: string, note: string): Commit | undefined {
    this.db
      .prepare('UPDATE commits SET regret = ?, regret_note = ? WHERE id = ?')
      .run(1, note, id);
    return this.getById(id);
  }
}

interface RawCommit {
  id: string;
  branch_id: string;
  verdict_summary: string;
  reasoning: string;
  source_item_ids: string;
  created_at: string;
  regret: number;
  regret_note: string | null;
}

function toCommit(row: RawCommit): Commit {
  return {
    id: row.id,
    branch_id: row.branch_id,
    verdict_summary: row.verdict_summary,
    reasoning: row.reasoning,
    source_item_ids: JSON.parse(row.source_item_ids),
    created_at: row.created_at,
    regret: row.regret === 1,
    regret_note: row.regret_note,
  };
}

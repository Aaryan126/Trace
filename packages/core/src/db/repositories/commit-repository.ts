import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { Commit } from '../../models/index.js';

const EMPTY_COMPARISON = { options: [], criteria: [], cells: [] };

export class CommitRepository {
  constructor(private db: Database.Database) {}

  create(data: Omit<Commit, 'id' | 'created_at' | 'regret' | 'regret_note' | 'kind' | 'resolution_status' | 'comparison'> &
    Partial<Pick<Commit, 'kind' | 'resolution_status' | 'comparison'>> & { id?: string }): Commit {
    const commit: Commit = {
      id: data.id ?? uuidv4(),
      branch_id: data.branch_id,
      verdict_summary: data.verdict_summary,
      reasoning: data.reasoning,
      source_item_ids: data.source_item_ids,
      created_at: new Date().toISOString(),
      regret: false,
      regret_note: null,
      kind: data.kind ?? 'checkpoint',
      resolution_status: data.resolution_status ?? 'in_progress',
      comparison: data.comparison ?? EMPTY_COMPARISON,
    };

    this.db
      .prepare(
        `INSERT INTO commits (id, branch_id, verdict_summary, reasoning, source_item_ids, created_at, regret, regret_note, kind, resolution_status, comparison_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        commit.id,
        commit.branch_id,
        commit.verdict_summary,
        commit.reasoning,
        JSON.stringify(commit.source_item_ids),
        commit.created_at,
        0,
        null,
        commit.kind,
        commit.resolution_status,
        JSON.stringify(commit.comparison),
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

  getLatestByThread(threadId: string): Commit | undefined {
    const row = this.db
      .prepare(
        `SELECT commits.* FROM commits
         JOIN branches ON branches.id = commits.branch_id
         WHERE branches.thread_id = ?
         ORDER BY commits.created_at DESC, commits.rowid DESC LIMIT 1`,
      )
      .get(threadId) as RawCommit | undefined;
    return row ? toCommit(row) : undefined;
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
  kind: string;
  resolution_status: string;
  comparison_json: string;
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
    kind: row.kind as Commit['kind'],
    resolution_status: row.resolution_status as Commit['resolution_status'],
    comparison: JSON.parse(row.comparison_json || JSON.stringify(EMPTY_COMPARISON)),
  };
}

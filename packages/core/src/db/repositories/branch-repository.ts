import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { Branch } from '../../models/index.js';

export class BranchRepository {
  constructor(private db: Database.Database) {}

  create(data: Omit<Branch, 'id' | 'created_at'> & { id?: string }): Branch {
    const branch: Branch = {
      id: data.id ?? uuidv4(),
      thread_id: data.thread_id,
      parent_commit_id: data.parent_commit_id ?? null,
      context_label: data.context_label ?? null,
      created_at: new Date().toISOString(),
    };

    this.db
      .prepare(
        `INSERT INTO branches (id, thread_id, parent_commit_id, context_label, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(branch.id, branch.thread_id, branch.parent_commit_id, branch.context_label, branch.created_at);

    return branch;
  }

  getById(id: string): Branch | undefined {
    const row = this.db.prepare('SELECT * FROM branches WHERE id = ?').get(id) as RawBranch | undefined;
    return row ? toBranch(row) : undefined;
  }

  listByThread(threadId: string): Branch[] {
    const rows = this.db
      .prepare('SELECT * FROM branches WHERE thread_id = ? ORDER BY created_at ASC')
      .all(threadId) as RawBranch[];
    return rows.map(toBranch);
  }

  getNewestByThread(threadId: string): Branch | undefined {
    const row = this.db
      .prepare('SELECT * FROM branches WHERE thread_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .get(threadId) as RawBranch | undefined;
    return row ? toBranch(row) : undefined;
  }

  reassignThread(branchId: string, newThreadId: string): Branch | undefined {
    this.db.prepare('UPDATE branches SET thread_id = ? WHERE id = ?').run(newThreadId, branchId);
    return this.getById(branchId);
  }
}

interface RawBranch {
  id: string;
  thread_id: string;
  parent_commit_id: string | null;
  context_label: string | null;
  created_at: string;
}

function toBranch(row: RawBranch): Branch {
  return {
    id: row.id,
    thread_id: row.thread_id,
    parent_commit_id: row.parent_commit_id,
    context_label: row.context_label,
    created_at: row.created_at,
  };
}

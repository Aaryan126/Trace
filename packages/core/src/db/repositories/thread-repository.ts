import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { Thread } from '../../models/index.js';

export class ThreadRepository {
  constructor(private db: Database.Database) {}

  create(data: Omit<Thread, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Thread {
    const now = new Date().toISOString();
    const thread: Thread = {
      id: data.id ?? uuidv4(),
      title: data.title,
      tags: data.tags,
      status: data.status ?? 'open',
      created_at: now,
      updated_at: now,
    };

    this.db
      .prepare(
        `INSERT INTO threads (id, title, tags, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(thread.id, thread.title, JSON.stringify(thread.tags), thread.status, thread.created_at, thread.updated_at);

    return thread;
  }

  getById(id: string): Thread | undefined {
    const row = this.db.prepare('SELECT * FROM threads WHERE id = ?').get(id) as RawThread | undefined;
    return row ? toThread(row) : undefined;
  }

  list(filters?: { status?: 'open' | 'closed'; tag?: string }): Thread[] {
    let sql = 'SELECT * FROM threads';
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters?.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }
    if (filters?.tag) {
      conditions.push('tags LIKE ?');
      params.push(`%"${filters.tag}"%`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY created_at DESC';

    const rows = this.db.prepare(sql).all(...params) as RawThread[];
    return rows.map(toThread);
  }

  updateStatus(id: string, status: 'open' | 'closed'): Thread | undefined {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE threads SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
    return this.getById(id);
  }

  update(id: string, partial: Partial<Pick<Thread, 'title' | 'tags' | 'status'>>): Thread | undefined {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (partial.title !== undefined) {
      sets.push('title = ?');
      params.push(partial.title);
    }
    if (partial.tags !== undefined) {
      sets.push('tags = ?');
      params.push(JSON.stringify(partial.tags));
    }
    if (partial.status !== undefined) {
      sets.push('status = ?');
      params.push(partial.status);
    }

    if (sets.length === 0) return this.getById(id);

    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    this.db.prepare(`UPDATE threads SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.getById(id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM threads WHERE id = ?').run(id);
  }
}

interface RawThread {
  id: string;
  title: string;
  tags: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function toThread(row: RawThread): Thread {
  return {
    id: row.id,
    title: row.title,
    tags: JSON.parse(row.tags),
    status: row.status as 'open' | 'closed',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

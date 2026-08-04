import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { FeedEvent } from '../../models/index.js';

export class FeedEventRepository {
  constructor(private db: Database.Database) {}

  create(data: Omit<FeedEvent, 'id' | 'created_at' | 'read'> & { id?: string }): FeedEvent {
    const event: FeedEvent = {
      id: data.id ?? uuidv4(),
      type: data.type,
      thread_id: data.thread_id ?? null,
      payload: data.payload,
      created_at: new Date().toISOString(),
      read: false,
    };

    this.db
      .prepare(
        `INSERT INTO feed_events (id, type, thread_id, payload, created_at, read)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(event.id, event.type, event.thread_id, JSON.stringify(event.payload), event.created_at, 0);

    return event;
  }

  list(options: { limit: number; offset: number; unreadOnly?: boolean }): FeedEvent[] {
    let sql = 'SELECT * FROM feed_events';
    const params: unknown[] = [];

    if (options.unreadOnly) {
      sql += ' WHERE read = 0';
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(options.limit, options.offset);

    const rows = this.db.prepare(sql).all(...params) as RawFeedEvent[];
    return rows.map(toFeedEvent);
  }

  listAll(): FeedEvent[] {
    return (this.db.prepare('SELECT * FROM feed_events ORDER BY created_at DESC, rowid DESC').all() as RawFeedEvent[])
      .map(toFeedEvent);
  }

  markRead(id: string): FeedEvent | undefined {
    this.db.prepare('UPDATE feed_events SET read = 1 WHERE id = ?').run(id);
    const row = this.db.prepare('SELECT * FROM feed_events WHERE id = ?').get(id) as RawFeedEvent | undefined;
    return row ? toFeedEvent(row) : undefined;
  }

  markReadMany(ids: string[]): number {
    if (ids.length === 0) return 0;
    const update = this.db.prepare('UPDATE feed_events SET read = 1 WHERE id = ?');
    return this.db.transaction((eventIds: string[]) => eventIds.reduce((count, id) => count + update.run(id).changes, 0))(ids);
  }

  countUnread(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM feed_events WHERE read = 0').get() as { count: number };
    return row.count;
  }

  listByType(type: string, sinceDate?: string): FeedEvent[] {
    let sql = 'SELECT * FROM feed_events WHERE type = ?';
    const params: unknown[] = [type];

    if (sinceDate) {
      sql += ' AND created_at >= ?';
      params.push(sinceDate);
    }

    sql += ' ORDER BY created_at DESC';

    const rows = this.db.prepare(sql).all(...params) as RawFeedEvent[];
    return rows.map(toFeedEvent);
  }

  listByThreadAndType(threadId: string, type: string, sinceDate?: string): FeedEvent[] {
    let sql = 'SELECT * FROM feed_events WHERE thread_id = ? AND type = ?';
    const params: unknown[] = [threadId, type];

    if (sinceDate) {
      sql += ' AND created_at >= ?';
      params.push(sinceDate);
    }

    sql += ' ORDER BY created_at DESC';

    const rows = this.db.prepare(sql).all(...params) as RawFeedEvent[];
    return rows.map(toFeedEvent);
  }
}

interface RawFeedEvent {
  id: string;
  type: string;
  thread_id: string | null;
  payload: string;
  created_at: string;
  read: number;
}

function toFeedEvent(row: RawFeedEvent): FeedEvent {
  return {
    id: row.id,
    type: row.type as 'reopen' | 'digest' | 'commit_closed' | 'nudge',
    thread_id: row.thread_id,
    payload: JSON.parse(row.payload),
    created_at: row.created_at,
    read: row.read === 1,
  };
}

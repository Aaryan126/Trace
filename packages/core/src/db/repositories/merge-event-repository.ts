import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { MergeEvent } from '../../models/index.js';

export class MergeEventRepository {
  constructor(private db: Database.Database) {}

  create(data: Omit<MergeEvent, 'id' | 'created_at' | 'origin'> & { id?: string; origin?: MergeEvent['origin'] }): MergeEvent {
    const event: MergeEvent = {
      id: data.id ?? uuidv4(),
      thread_id: data.thread_id,
      source_branch_ids: data.source_branch_ids,
      resulting_commit_id: data.resulting_commit_id,
      resolved_rule: data.resolved_rule,
      origin: data.origin ?? 'automatic',
      created_at: new Date().toISOString(),
    };

    this.db
      .prepare(
        `INSERT INTO merge_events (id, thread_id, source_branch_ids, resulting_commit_id, resolved_rule, origin, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.id,
        event.thread_id,
        JSON.stringify(event.source_branch_ids),
        event.resulting_commit_id,
        event.resolved_rule,
        event.origin,
        event.created_at
      );

    return event;
  }

  listByThread(threadId: string): MergeEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM merge_events WHERE thread_id = ? ORDER BY created_at ASC')
      .all(threadId) as RawMergeEvent[];
    return rows.map(toMergeEvent);
  }
}

interface RawMergeEvent {
  id: string;
  thread_id: string;
  source_branch_ids: string;
  resulting_commit_id: string;
  resolved_rule: string;
  origin: string;
  created_at: string;
}

function toMergeEvent(row: RawMergeEvent): MergeEvent {
  return {
    id: row.id,
    thread_id: row.thread_id,
    source_branch_ids: JSON.parse(row.source_branch_ids),
    resulting_commit_id: row.resulting_commit_id,
    resolved_rule: row.resolved_rule,
    origin: row.origin as MergeEvent['origin'],
    created_at: row.created_at,
  };
}

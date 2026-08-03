import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { SourceItem } from '../../models/index.js';

export class SourceItemRepository {
  constructor(private db: Database.Database) {}

  create(data: Omit<SourceItem, 'id' | 'processed'> & { id?: string }): SourceItem {
    const item: SourceItem = {
      id: data.id ?? uuidv4(),
      type: data.type,
      raw_text: data.raw_text ?? null,
      extracted_entities: data.extracted_entities ?? null,
      url: data.url ?? null,
      captured_at: data.captured_at,
      thread_id: data.thread_id ?? null,
      processed: false,
    };

    this.db
      .prepare(
        `INSERT INTO source_items (id, type, raw_text, extracted_entities, url, captured_at, thread_id, processed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        item.id,
        item.type,
        item.raw_text,
        item.extracted_entities ? JSON.stringify(item.extracted_entities) : null,
        item.url,
        item.captured_at,
        item.thread_id,
        0
      );

    return item;
  }

  getById(id: string): SourceItem | undefined {
    const row = this.db.prepare('SELECT * FROM source_items WHERE id = ?').get(id) as RawSourceItem | undefined;
    return row ? toSourceItem(row) : undefined;
  }

  listUnprocessed(): SourceItem[] {
    const rows = this.db
      .prepare('SELECT * FROM source_items WHERE processed = 0 ORDER BY captured_at ASC')
      .all() as RawSourceItem[];
    return rows.map(toSourceItem);
  }

  assignToThread(id: string, threadId: string): SourceItem | undefined {
    this.db.prepare('UPDATE source_items SET thread_id = ? WHERE id = ?').run(threadId, id);
    return this.getById(id);
  }

  markProcessed(id: string): SourceItem | undefined {
    this.db.prepare('UPDATE source_items SET processed = 1 WHERE id = ?').run(id);
    return this.getById(id);
  }

  listByThread(threadId: string): SourceItem[] {
    const rows = this.db
      .prepare('SELECT * FROM source_items WHERE thread_id = ? ORDER BY captured_at ASC')
      .all(threadId) as RawSourceItem[];
    return rows.map(toSourceItem);
  }

  findByUrl(url: string): SourceItem[] {
    const rows = this.db
      .prepare('SELECT * FROM source_items WHERE url = ?')
      .all(url) as RawSourceItem[];
    return rows.map(toSourceItem);
  }
}

interface RawSourceItem {
  id: string;
  type: string;
  raw_text: string | null;
  extracted_entities: string | null;
  url: string | null;
  captured_at: string;
  thread_id: string | null;
  processed: number;
}

function toSourceItem(row: RawSourceItem): SourceItem {
  return {
    id: row.id,
    type: row.type as 'screenshot' | 'browser_history',
    raw_text: row.raw_text,
    extracted_entities: row.extracted_entities ? JSON.parse(row.extracted_entities) : null,
    url: row.url,
    captured_at: row.captured_at,
    thread_id: row.thread_id,
    processed: row.processed === 1,
  };
}

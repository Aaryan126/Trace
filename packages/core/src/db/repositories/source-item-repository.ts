import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { SourceItem } from '../../models/index.js';

export class SourceItemRepository {
  constructor(private db: Database.Database) {}

  create(
    data: Omit<SourceItem, 'id' | 'processed' | 'branch_id' | 'clustering_confidence' | 'content_text' | 'content_status' | 'automation_status' | 'automation_attempts' | 'processed_at' | 'error_message' | 'visual_context' | 'capture_status' | 'capture_reason' | 'capture_updated_at'> &
      Partial<Pick<SourceItem, 'branch_id' | 'clustering_confidence' | 'content_text' | 'content_status' | 'automation_status'>> & { id?: string },
  ): SourceItem {
    const item: SourceItem = {
      id: data.id ?? uuidv4(),
      type: data.type,
      raw_text: data.raw_text ?? null,
      extracted_entities: data.extracted_entities ?? null,
      url: data.url ?? null,
      captured_at: data.captured_at,
      thread_id: data.thread_id ?? null,
      branch_id: data.branch_id ?? null,
      clustering_confidence: data.clustering_confidence ?? null,
      processed: false,
      content_text: data.content_text ?? null,
      content_status: data.content_status ?? 'not_requested',
      automation_status: data.automation_status ?? 'pending',
      automation_attempts: 0,
      processed_at: null,
      error_message: null,
      visual_context: null,
      capture_status: 'not_requested',
      capture_reason: null,
      capture_updated_at: null,
    };

    this.db
      .prepare(
        `INSERT INTO source_items
           (id, type, raw_text, extracted_entities, url, captured_at, thread_id, branch_id, clustering_confidence, processed,
            content_text, content_status, automation_status, automation_attempts, processed_at, error_message, visual_context,
            capture_status, capture_reason, capture_updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        item.id,
        item.type,
        item.raw_text,
        item.extracted_entities ? JSON.stringify(item.extracted_entities) : null,
        item.url,
        item.captured_at,
        item.thread_id,
        item.branch_id,
        item.clustering_confidence,
        0,
        item.content_text,
        item.content_status,
        item.automation_status,
        0,
        null,
        null,
        null,
        'not_requested',
        null,
        null,
      );

    return item;
  }

  getById(id: string): SourceItem | undefined {
    const row = this.db.prepare('SELECT * FROM source_items WHERE id = ?').get(id) as RawSourceItem | undefined;
    return row ? toSourceItem(row) : undefined;
  }

  listUnprocessed(options: { newestFirst?: boolean; limit?: number } = {}): SourceItem[] {
    const direction = options.newestFirst ? 'DESC' : 'ASC';
    const limitClause = options.limit === undefined ? '' : ' LIMIT ?';
    const statement = this.db.prepare(
      `SELECT * FROM source_items
       WHERE processed = 0
       ORDER BY captured_at ${direction}, rowid ${direction}${limitClause}`,
    );
    const rows = (options.limit === undefined
      ? statement.all()
      : statement.all(options.limit)) as RawSourceItem[];
    return rows.map(toSourceItem);
  }

  assignToThread(
    id: string,
    threadId: string,
    branchId: string | null = null,
    confidence: number | null = null,
  ): SourceItem | undefined {
    this.db
      .prepare('UPDATE source_items SET thread_id = ?, branch_id = ?, clustering_confidence = ? WHERE id = ?')
      .run(threadId, branchId, confidence, id);
    return this.getById(id);
  }

  markProcessed(id: string): SourceItem | undefined {
    this.db.prepare("UPDATE source_items SET processed = 1, automation_status = 'filed', processed_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
    return this.getById(id);
  }

  markIgnored(id: string, confidence: number | null): SourceItem | undefined {
    this.db
      .prepare(
        `UPDATE source_items
         SET thread_id = NULL, branch_id = NULL, clustering_confidence = ?, processed = 1,
             automation_status = 'ignored', processed_at = ?, error_message = NULL
         WHERE id = ?`,
      )
      .run(confidence, new Date().toISOString(), id);
    return this.getById(id);
  }

  listByThread(threadId: string): SourceItem[] {
    const rows = this.db
      .prepare('SELECT * FROM source_items WHERE thread_id = ? ORDER BY captured_at ASC')
      .all(threadId) as RawSourceItem[];
    return rows.map(toSourceItem);
  }

  listByBranch(branchId: string): SourceItem[] {
    const rows = this.db
      .prepare('SELECT * FROM source_items WHERE branch_id = ? ORDER BY captured_at ASC')
      .all(branchId) as RawSourceItem[];
    return rows.map(toSourceItem);
  }

  findByUrl(url: string): SourceItem[] {
    const rows = this.db
      .prepare('SELECT * FROM source_items WHERE url = ?')
      .all(url) as RawSourceItem[];
    return rows.map(toSourceItem);
  }

  listForAutomation(limit = 100): SourceItem[] {
    const rows = this.db.prepare(
      "SELECT * FROM source_items WHERE automation_status IN ('pending', 'error') AND automation_attempts < 3 ORDER BY captured_at ASC, rowid ASC LIMIT ?",
    ).all(limit) as RawSourceItem[];
    return rows.map(toSourceItem);
  }

  listRecent(limit = 50): SourceItem[] {
    const rows = this.db.prepare('SELECT * FROM source_items ORDER BY captured_at DESC, rowid DESC LIMIT ?')
      .all(limit) as RawSourceItem[];
    return rows.map(toSourceItem);
  }

  updateEnrichment(id: string, contentText: string | null, status: SourceItem['content_status']): SourceItem | undefined {
    this.db.prepare('UPDATE source_items SET content_text = ?, content_status = ? WHERE id = ?')
      .run(contentText, status, id);
    return this.getById(id);
  }

  updateVisualContext(id: string, visualContext: string): SourceItem | undefined {
    this.db.prepare('UPDATE source_items SET visual_context = ? WHERE id = ?').run(visualContext, id);
    return this.getById(id);
  }

  updateCaptureStatus(
    id: string,
    status: SourceItem['capture_status'],
    reason: string | null = null,
  ): SourceItem | undefined {
    this.db.prepare('UPDATE source_items SET capture_status = ?, capture_reason = ?, capture_updated_at = ? WHERE id = ?')
      .run(status, reason, new Date().toISOString(), id);
    return this.getById(id);
  }

  failInterruptedCaptures(): number {
    return this.db.prepare(`
      UPDATE source_items
      SET capture_status = 'failed', capture_reason = 'capture_agent_offline', capture_updated_at = ?
      WHERE capture_status IN ('queued', 'capturing')
    `).run(new Date().toISOString()).changes;
  }

  markAutomationStatus(id: string, status: SourceItem['automation_status'], error: string | null = null): SourceItem | undefined {
    this.db.prepare(
      `UPDATE source_items SET automation_status = ?, error_message = ?,
       automation_attempts = automation_attempts + CASE WHEN ? = 'processing' THEN 1 ELSE 0 END
       WHERE id = ?`,
    ).run(status, error, status, id);
    return this.getById(id);
  }

  restorePending(id: string): SourceItem | undefined {
    this.db.prepare(
      "UPDATE source_items SET thread_id = NULL, branch_id = NULL, clustering_confidence = NULL, processed = 0, automation_status = 'pending', processed_at = NULL, error_message = NULL WHERE id = ?",
    ).run(id);
    return this.getById(id);
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
  branch_id: string | null;
  clustering_confidence: number | null;
  processed: number;
  content_text: string | null;
  content_status: string;
  automation_status: string;
  automation_attempts: number;
  processed_at: string | null;
  error_message: string | null;
  visual_context: string | null;
  capture_status: string;
  capture_reason: string | null;
  capture_updated_at: string | null;
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
    branch_id: row.branch_id,
    clustering_confidence: row.clustering_confidence,
    processed: row.processed === 1,
    content_text: row.content_text,
    content_status: row.content_status as SourceItem['content_status'],
    automation_status: row.automation_status as SourceItem['automation_status'],
    automation_attempts: row.automation_attempts,
    processed_at: row.processed_at,
    error_message: row.error_message,
    visual_context: row.visual_context,
    capture_status: row.capture_status as SourceItem['capture_status'],
    capture_reason: row.capture_reason,
    capture_updated_at: row.capture_updated_at,
  };
}

import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { CaptureAsset } from '../../models/index.js';

export class CaptureAssetRepository {
  constructor(private db: Database.Database) {}

  create(data: Omit<CaptureAsset, 'id' | 'pinned'> & { id?: string; pinned?: boolean }): CaptureAsset {
    const asset: CaptureAsset = { ...data, id: data.id ?? uuidv4(), pinned: data.pinned ?? false };
    this.db.prepare(`
      INSERT INTO capture_assets
        (id, source_item_id, full_path, thumbnail_path, mime_type, byte_size, width, height,
         visual_hash, captured_at, full_expires_at, pinned)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_item_id) DO UPDATE SET
        full_path = excluded.full_path, thumbnail_path = excluded.thumbnail_path,
        mime_type = excluded.mime_type, byte_size = excluded.byte_size,
        width = excluded.width, height = excluded.height, visual_hash = excluded.visual_hash,
        captured_at = excluded.captured_at, full_expires_at = excluded.full_expires_at
    `).run(asset.id, asset.source_item_id, asset.full_path, asset.thumbnail_path, asset.mime_type,
      asset.byte_size, asset.width, asset.height, asset.visual_hash, asset.captured_at,
      asset.full_expires_at, asset.pinned ? 1 : 0);
    return this.getBySourceItem(asset.source_item_id)!;
  }

  getBySourceItem(sourceItemId: string): CaptureAsset | undefined {
    const row = this.db.prepare('SELECT * FROM capture_assets WHERE source_item_id = ?').get(sourceItemId) as RawAsset | undefined;
    return row ? toAsset(row) : undefined;
  }

  listRecent(limit = 100): CaptureAsset[] {
    return (this.db.prepare('SELECT * FROM capture_assets ORDER BY captured_at DESC LIMIT ?').all(limit) as RawAsset[]).map(toAsset);
  }

  listFullAssetsOldestFirst(): CaptureAsset[] {
    return (this.db.prepare('SELECT * FROM capture_assets WHERE full_path IS NOT NULL AND pinned = 0 ORDER BY captured_at ASC').all() as RawAsset[]).map(toAsset);
  }

  totalFullBytes(): number {
    return (this.db.prepare('SELECT COALESCE(SUM(byte_size), 0) AS total FROM capture_assets WHERE full_path IS NOT NULL').get() as { total: number }).total;
  }

  clearFullPath(id: string): void {
    this.db.prepare('UPDATE capture_assets SET full_path = NULL, byte_size = 0 WHERE id = ?').run(id);
  }

  deleteBySourceItem(sourceItemId: string): void {
    this.db.prepare('DELETE FROM capture_assets WHERE source_item_id = ?').run(sourceItemId);
  }
}

interface RawAsset {
  id: string; source_item_id: string; full_path: string | null; thumbnail_path: string;
  mime_type: string; byte_size: number; width: number; height: number; visual_hash: string;
  captured_at: string; full_expires_at: string; pinned: number;
}

function toAsset(row: RawAsset): CaptureAsset {
  return { ...row, pinned: row.pinned === 1 };
}

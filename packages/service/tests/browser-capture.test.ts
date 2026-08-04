import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import {
  CaptureAssetRepository,
  BranchRepository,
  SourceItemRepository,
  ThreadRepository,
  createInMemoryDatabase,
} from '@trace/core';
import type { AutonomousCoordinator } from '../src/automation.js';
import { BrowserCaptureCoordinator } from '../src/browser-capture.js';

describe('BrowserCaptureCoordinator', () => {
  let db: Database;
  let directory: string;
  let items: SourceItemRepository;
  let enqueue: ReturnType<typeof vi.fn>;
  let captures: BrowserCaptureCoordinator;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T12:00:00.000Z'));
    db = createInMemoryDatabase();
    directory = mkdtempSync(join(tmpdir(), 'trace-browser-capture-'));
    items = new SourceItemRepository(db);
    enqueue = vi.fn();
    captures = new BrowserCaptureCoordinator(
      db,
      { enqueue } as unknown as AutonomousCoordinator,
      directory,
    );
    captures.reportAgentStatus(true, true);
  });

  afterEach(() => {
    captures.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it('waits for page dwell, stores a capture, and routes it with OCR context', async () => {
    const item = items.create({
      type: 'browser_history', raw_text: 'Compare Alpha and Beta', extracted_entities: null,
      url: 'https://example.com/comparison', captured_at: new Date().toISOString(), thread_id: null,
    });

    expect(captures.consider(item)).toBe(true);
    expect(captures.next()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2_000);
    const request = captures.next();
    expect(request?.sourceItemId).toBe(item.id);

    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
    expect(captures.complete(request!.id, {
      fullImageBase64: jpeg,
      thumbnailBase64: jpeg,
      ocrText: 'Alpha costs less; Beta has better privacy.',
      width: 1200,
      height: 800,
      visualHash: '0123456789abcdef',
    })).toBe(true);

    const asset = new CaptureAssetRepository(db).getBySourceItem(item.id);
    expect(asset).toBeDefined();
    expect(existsSync(asset!.full_path!)).toBe(true);
    expect(existsSync(asset!.thumbnail_path)).toBe(true);
    expect(items.getById(item.id)?.visual_context).toContain('Beta has better privacy');
    expect(items.getById(item.id)?.capture_status).toBe('captured');
    expect(captures.health().lastResult).toBe('captured');
    expect(enqueue).toHaveBeenCalledWith(item.id);
  });

  it('creates and reserves an extension visit immediately with page context', async () => {
    const result = captures.considerExtensionVisit({
      url: 'https://example.com/compare-databases',
      title: 'Compare databases',
      capturedAt: new Date().toISOString(),
      pageText: 'Postgres and SQLite differ in deployment complexity.',
    });

    expect(result.status).toBe('capture');
    expect(result.request?.url).toBe('https://example.com/compare-databases');
    const item = items.getById(result.request!.sourceItemId)!;
    expect(item.content_text).toContain('SQLite');
    expect(item.capture_status).toBe('queued');
    expect(captures.next()).toBeUndefined();
  });

  it('deduplicates an extension visit against browser history within one minute', () => {
    const item = items.create({
      type: 'browser_history', raw_text: 'Existing visit', extracted_entities: null,
      url: 'https://example.com/research', captured_at: new Date().toISOString(), thread_id: null,
    });
    const result = captures.considerExtensionVisit({
      url: item.url!, title: 'Existing visit', capturedAt: new Date().toISOString(), pageText: 'Added context',
    });
    expect(result.request?.sourceItemId).toBe(item.id);
    expect(items.findByUrl(item.url!)).toHaveLength(1);
  });

  it('skips obvious casual pages before they consume screenshot capacity', () => {
    const result = captures.considerExtensionVisit({
      url: 'https://www.youtube.com/shorts/abc', title: 'Funny clip', capturedAt: new Date().toISOString(), pageText: 'A casual video feed'.repeat(100),
    });
    expect(result.status).toBe('ignored');
    const item = items.findByUrl('https://www.youtube.com/shorts/abc')[0];
    expect(item.capture_reason).toBe('low_relevance');
    expect(enqueue).toHaveBeenCalledWith(item.id);
  });

  it('never captures the Trace localhost dashboard itself', () => {
    const result = captures.considerExtensionVisit({
      url: 'http://127.0.0.1:3333/threads/example', title: 'Trace comparison', capturedAt: new Date().toISOString(), pageText: 'comparison '.repeat(100),
    });
    expect(result.status).toBe('ignored');
    expect(items.findByUrl('http://127.0.0.1:3333/threads/example')).toHaveLength(0);
  });

  it('rejects a previously known localhost URL before known-page priority is applied', () => {
    const thread = new ThreadRepository(db).create({ title: 'Trace dashboard', tags: [], status: 'open' });
    const branch = new BranchRepository(db).create({ thread_id: thread.id, parent_commit_id: null, context_label: 'Local' });
    const known = items.create({ type: 'browser_history', raw_text: 'Known page', extracted_entities: null, url: 'http://localhost:3333/threads/known', captured_at: new Date().toISOString(), thread_id: thread.id });
    items.assignToThread(known.id, thread.id, branch.id, 1);

    const result = captures.considerExtensionVisit({ url: known.url!, title: 'Known Trace decision', capturedAt: new Date().toISOString(), pageText: 'compare options '.repeat(100) });

    expect(result.status).toBe('ignored');
    expect(items.getById(known.id)?.capture_status).toBe('not_requested');
    expect(captures.next()).toBeUndefined();
  });

  it('prioritizes explicit research and manual captures over the ten-second soft limit', () => {
    const first = captures.considerExtensionVisit({
      url: 'https://example.com/article', title: 'Long article', capturedAt: new Date().toISOString(), pageText: 'context '.repeat(100),
    });
    expect(first.status).toBe('capture');
    const research = captures.considerExtensionVisit({
      url: 'https://example.com/compare', title: 'Compare model alternatives', capturedAt: new Date().toISOString(), pageText: 'Model A versus Model B',
    });
    expect(research.status).toBe('capture');
    const manual = captures.considerExtensionVisit({
      url: 'https://example.com/manual', title: 'Manual page', capturedAt: new Date().toISOString(), pageText: '', manual: true,
    });
    expect(manual.status).toBe('capture');
  });

  it('does not capture sensitive sign-in pages', () => {
    const item = items.create({
      type: 'browser_history', raw_text: 'Google account', extracted_entities: null,
      url: 'https://accounts.google.com/signin', captured_at: new Date().toISOString(), thread_id: null,
    });
    expect(captures.consider(item)).toBe(false);
    expect(captures.next()).toBeUndefined();
    expect(items.getById(item.id)?.capture_reason).toBe('sensitive_url');
  });

  it('falls back to normal routing when the menu app skips a capture', async () => {
    const item = items.create({
      type: 'browser_history', raw_text: 'Research page', extracted_entities: null,
      url: 'https://example.com/research', captured_at: new Date().toISOString(), thread_id: null,
    });
    captures.consider(item);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(captures.skip(captures.next()!.id)).toBe(true);
    expect(enqueue).toHaveBeenCalledWith(item.id);
    expect(items.getById(item.id)?.capture_status).toBe('failed');
  });

  it('records a timeout before falling through to normal routing', async () => {
    const item = items.create({
      type: 'browser_history', raw_text: 'Slow research page', extracted_entities: null,
      url: 'https://example.com/slow', captured_at: new Date().toISOString(), thread_id: null,
    });
    captures.consider(item);
    await vi.advanceTimersByTimeAsync(2_000);
    captures.next();
    await vi.advanceTimersByTimeAsync(25_000);
    expect(items.getById(item.id)?.capture_reason).toBe('capture_timeout');
    expect(enqueue).toHaveBeenCalledWith(item.id);
  });

  it('keeps a thumbnail when a near-duplicate full image is omitted', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
    const first = items.create({ type: 'browser_history', raw_text: 'First', extracted_entities: null, url: 'https://example.com/one', captured_at: new Date().toISOString(), thread_id: null });
    captures.consider(first);
    await vi.advanceTimersByTimeAsync(2_000);
    captures.complete(captures.next()!.id, { fullImageBase64: jpeg, thumbnailBase64: jpeg, ocrText: 'one', width: 100, height: 80, visualHash: '0123456789abcdef' });

    await vi.advanceTimersByTimeAsync(10_000);
    captures.reportAgentStatus(true, true);
    const second = items.create({ type: 'browser_history', raw_text: 'Second', extracted_entities: null, url: 'https://example.com/two', captured_at: new Date().toISOString(), thread_id: null });
    captures.consider(second);
    await vi.advanceTimersByTimeAsync(2_000);
    captures.complete(captures.next()!.id, { fullImageBase64: jpeg, thumbnailBase64: jpeg, ocrText: 'two', width: 100, height: 80, visualHash: '0123456789abcdef' });

    const duplicate = new CaptureAssetRepository(db).getBySourceItem(second.id)!;
    expect(duplicate.full_path).toBeNull();
    expect(existsSync(duplicate.thumbnail_path)).toBe(true);
    expect(items.getById(second.id)?.capture_reason).toBe('near_duplicate');
  });

  it('evicts the oldest full image only when the one-gigabyte cap is exceeded', () => {
    const repository = new CaptureAssetRepository(db);
    const first = items.create({ type: 'browser_history', raw_text: 'Old', extracted_entities: null, url: 'https://example.com/old', captured_at: '2026-08-01T00:00:00.000Z', thread_id: null });
    const second = items.create({ type: 'browser_history', raw_text: 'New', extracted_entities: null, url: 'https://example.com/new', captured_at: '2026-08-02T00:00:00.000Z', thread_id: null });
    for (const [item, capturedAt] of [[first, '2026-08-01T00:00:00.000Z'], [second, '2026-08-02T00:00:00.000Z']] as const) {
      const fullPath = join(directory, `${item.id}.jpg`);
      const thumbnailPath = join(directory, `${item.id}-thumb.jpg`);
      writeFileSync(fullPath, Buffer.from([0xff, 0xd8, 0xff]));
      writeFileSync(thumbnailPath, Buffer.from([0xff, 0xd8, 0xff]));
      repository.create({ source_item_id: item.id, full_path: fullPath, thumbnail_path: thumbnailPath, mime_type: 'image/jpeg', byte_size: 600_000_000, width: 100, height: 80, visual_hash: item.id.slice(0, 16).replaceAll('-', '0'), captured_at: capturedAt, full_expires_at: '9999-12-31T23:59:59.999Z' });
    }
    captures.garbageCollect();
    expect(repository.getBySourceItem(first.id)?.full_path).toBeNull();
    expect(repository.getBySourceItem(second.id)?.full_path).not.toBeNull();
    expect(existsSync(repository.getBySourceItem(first.id)!.thumbnail_path)).toBe(true);
  });
});

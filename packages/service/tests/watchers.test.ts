import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createInMemoryDatabase,
  SourceItemRepository,
} from '@trace/core';
import type { TraceAI } from '@trace/core';
import { MetadataRepository } from '../src/watchers/metadata-repository.js';
import { ScreenshotWatcher } from '../src/watchers/screenshot.js';
import {
  BrowserHistoryReader,
  chromeTimestampToDate,
  safariTimestampToDate,
} from '../src/watchers/browser-history.js';
import Database from 'better-sqlite3';

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock('chokidar', () => ({
  watch: vi.fn(),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const readFileMock = vi.fn();
  return {
    ...actual,
    default: { ...actual, readFile: readFileMock },
    readFile: readFileMock,
  };
});

import * as chokidar from 'chokidar';
import { readFile as fsReadFile } from 'node:fs/promises';

// ─── Test helpers ────────────────────────────────────────────────────────────


function createMockAI() {
  return {
    extractFromScreenshot: vi.fn().mockResolvedValue({
      text: 'extracted text',
      entities: ['entity1'],
      url: 'https://example.com',
      appSource: 'Chrome',
    }),
  } as unknown as TraceAI;
}

// ─── Screenshot Watcher Tests ────────────────────────────────────────────────

describe('ScreenshotWatcher', () => {
  let mockWatcherInstance: {
    handlers: Record<string, ((...args: unknown[]) => void)[]>;
    on: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  let ai: ReturnType<typeof createMockAI>;
  let db: ReturnType<typeof createInMemoryDatabase>;
  let repo: SourceItemRepository;

  beforeEach(() => {
    vi.useFakeTimers();

    mockWatcherInstance = {
      handlers: {},
      on: vi.fn(function (this: typeof mockWatcherInstance, event: string, handler: (...args: unknown[]) => void) {
        if (!this.handlers[event]) this.handlers[event] = [];
        this.handlers[event].push(handler);
        return this;
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    // Bind `on` to the instance so `this` works
    mockWatcherInstance.on = mockWatcherInstance.on.bind(mockWatcherInstance);
    (chokidar.watch as ReturnType<typeof vi.fn>).mockReturnValue(mockWatcherInstance);

    (fsReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from('fake-image'));

    ai = createMockAI();
    db = createInMemoryDatabase();
    repo = new SourceItemRepository(db);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function emit(event: string, ...args: unknown[]) {
    const handlers = mockWatcherInstance.handlers[event] ?? [];
    for (const h of handlers) h(...args);
  }

  it('processes a new .png file via AI and creates a SourceItem', async () => {
    const watcher = new ScreenshotWatcher(
      { watchDir: '/tmp/test', debounceMs: 50 },
      ai,
      repo,
    );
    watcher.start();

    emit('add', '/tmp/test/screenshot.png');

    // Fire debounce timer and flush async chain
    await vi.advanceTimersByTimeAsync(100);
    await vi.runAllTicks();

    expect(fsReadFile).toHaveBeenCalledWith('/tmp/test/screenshot.png');
    expect(ai.extractFromScreenshot).toHaveBeenCalledOnce();
    const items = repo.listUnprocessed();
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('screenshot');
    expect(items[0].raw_text).toBe('extracted text');
    expect(items[0].url).toBe('https://example.com');

    watcher.stop();
  });

  it('ignores non-image files (.txt, .pdf)', async () => {
    const watcher = new ScreenshotWatcher(
      { watchDir: '/tmp/test', debounceMs: 50 },
      ai,
      repo,
    );
    watcher.start();

    emit('add', '/tmp/test/notes.txt');
    emit('add', '/tmp/test/document.pdf');
    emit('add', '/tmp/test/script.js');

    await vi.advanceTimersByTimeAsync(200);
    await vi.runAllTicks();

    expect(ai.extractFromScreenshot).not.toHaveBeenCalled();
    expect(repo.listUnprocessed()).toHaveLength(0);

    watcher.stop();
  });

  it('debounces rapid file changes — only one processing call', async () => {
    const watcher = new ScreenshotWatcher(
      { watchDir: '/tmp/test', debounceMs: 200 },
      ai,
      repo,
    );
    watcher.start();

    // Rapid changes within the debounce window
    emit('add', '/tmp/test/screenshot.png');
    await vi.advanceTimersByTimeAsync(50);
    emit('change', '/tmp/test/screenshot.png');
    await vi.advanceTimersByTimeAsync(50);
    emit('change', '/tmp/test/screenshot.png');

    // Fire the final debounce
    await vi.advanceTimersByTimeAsync(300);
    await vi.runAllTicks();

    expect(ai.extractFromScreenshot).toHaveBeenCalledTimes(1);

    watcher.stop();
  });

  it('AI failure for one file does not crash the watcher', async () => {
    (ai.extractFromScreenshot as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('AI boom'))
      .mockResolvedValueOnce({
        text: 'second text',
        entities: [],
        url: null,
        appSource: null,
      });

    const watcher = new ScreenshotWatcher(
      { watchDir: '/tmp/test', debounceMs: 50 },
      ai,
      repo,
    );
    watcher.start();

    // First file — AI fails
    emit('add', '/tmp/test/fail.png');
    await vi.advanceTimersByTimeAsync(100);
    await vi.runAllTicks();

    expect(repo.listUnprocessed()).toHaveLength(0);

    // Second file — should still work
    emit('add', '/tmp/test/ok.png');
    await vi.advanceTimersByTimeAsync(100);
    await vi.runAllTicks();

    expect(repo.listUnprocessed()).toHaveLength(1);
    expect(repo.listUnprocessed()[0].raw_text).toBe('second text');

    watcher.stop();
  });

  it('stop() prevents further processing', async () => {
    const watcher = new ScreenshotWatcher(
      { watchDir: '/tmp/test', debounceMs: 500 },
      ai,
      repo,
    );
    watcher.start();

    emit('add', '/tmp/test/screenshot.png');

    // Stop before debounce fires
    watcher.stop();

    await vi.advanceTimersByTimeAsync(600);
    await vi.runAllTicks();

    expect(ai.extractFromScreenshot).not.toHaveBeenCalled();
    expect(mockWatcherInstance.close).toHaveBeenCalled();
  });
});

// ─── Browser History Reader Tests ────────────────────────────────────────────

describe('BrowserHistoryReader', () => {
  let fixtureDir: string;
  let chromeFixturePath: string;
  let safariFixturePath: string;
  let appDb: ReturnType<typeof createInMemoryDatabase>;
  let repo: SourceItemRepository;
  let historyWatcher: {
    handlers: Record<string, ((...args: unknown[]) => void)[]>;
    on: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };

  // Chrome epoch offset: seconds between 1601-01-01 and 1970-01-01
  const CHROME_EPOCH_OFFSET = 11_644_473_600;
  // Safari epoch offset: seconds between 2001-01-01 and 1970-01-01
  const SAFARI_EPOCH_OFFSET = 978_307_200;

  function toChromeTimestamp(jsDate: Date): number {
    return (jsDate.getTime() / 1000 + CHROME_EPOCH_OFFSET) * 1_000_000;
  }

  function toSafariTimestamp(jsDate: Date): number {
    return jsDate.getTime() / 1000 - SAFARI_EPOCH_OFFSET;
  }

  beforeAll(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'trace-test-'));
    chromeFixturePath = join(fixtureDir, 'ChromeHistory');
    safariFixturePath = join(fixtureDir, 'SafariHistory.db');

    // Create Chrome fixture with known rows
    const chromeDb = new Database(chromeFixturePath);
    chromeDb.exec(`
      CREATE TABLE urls (
        id INTEGER PRIMARY KEY,
        url TEXT,
        title TEXT,
        visit_count INTEGER DEFAULT 0,
        typed_count INTEGER DEFAULT 0,
        last_visit_time INTEGER NOT NULL,
        hidden INTEGER DEFAULT 0
      )
    `);

    const ts1 = toChromeTimestamp(new Date('2024-06-15T10:30:00Z'));
    const ts2 = toChromeTimestamp(new Date('2024-06-15T11:00:00Z'));
    const ts3 = toChromeTimestamp(new Date('2024-06-15T12:00:00Z'));

    chromeDb
      .prepare('INSERT INTO urls (url, title, last_visit_time) VALUES (?, ?, ?)')
      .run('https://example.com/page1', 'Example Page 1', ts1);
    chromeDb
      .prepare('INSERT INTO urls (url, title, last_visit_time) VALUES (?, ?, ?)')
      .run('https://example.com/page2', 'Example Page 2', ts2);
    chromeDb
      .prepare('INSERT INTO urls (url, title, last_visit_time) VALUES (?, ?, ?)')
      .run('https://github.com/test', 'GitHub Test Repo', ts3);

    chromeDb.close();

    // Create Safari fixture with known rows
    const safariDb = new Database(safariFixturePath);
    safariDb.exec(`
      CREATE TABLE history_items (
        id INTEGER PRIMARY KEY,
        url TEXT NOT NULL
      );
      CREATE TABLE history_visits (
        id INTEGER PRIMARY KEY,
        history_item INTEGER NOT NULL,
        title TEXT,
        visit_time INTEGER NOT NULL,
        FOREIGN KEY (history_item) REFERENCES history_items(id)
      );
    `);

    const sTs1 = toSafariTimestamp(new Date('2024-06-15T10:30:00Z'));
    const sTs2 = toSafariTimestamp(new Date('2024-06-15T11:00:00Z'));

    safariDb.prepare('INSERT INTO history_items (id, url) VALUES (?, ?)').run(1, 'https://apple.com');
    safariDb
      .prepare('INSERT INTO history_visits (history_item, title, visit_time) VALUES (?, ?, ?)')
      .run(1, 'Apple', sTs1);

    safariDb.prepare('INSERT INTO history_items (id, url) VALUES (?, ?)').run(2, 'https://developer.apple.com');
    safariDb
      .prepare('INSERT INTO history_visits (history_item, title, visit_time) VALUES (?, ?, ?)')
      .run(2, 'Apple Developer', sTs2);

    safariDb.close();
  });

  afterAll(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    historyWatcher = {
      handlers: {},
      on: vi.fn(function (
        this: typeof historyWatcher,
        event: string,
        handler: (...args: unknown[]) => void,
      ) {
        if (!this.handlers[event]) this.handlers[event] = [];
        this.handlers[event].push(handler);
        return this;
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    historyWatcher.on = historyWatcher.on.bind(historyWatcher);
    (chokidar.watch as ReturnType<typeof vi.fn>).mockReturnValue(historyWatcher);
    appDb = createInMemoryDatabase();
    repo = new SourceItemRepository(appDb);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function emitHistoryEvent(event: string, path: string): void {
    for (const handler of historyWatcher.handlers[event] ?? []) handler(path);
  }

  it('debounces database and WAL changes into one prompt poll', async () => {
    vi.useFakeTimers();
    const reader = new BrowserHistoryReader(
      {
        chromePath: chromeFixturePath,
        safariPath: safariFixturePath,
        debounceMs: 1_500,
        pollIntervalMs: 120_000,
      },
      repo,
      appDb,
    );
    const poll = vi.spyOn(reader, 'poll').mockResolvedValue(0);

    reader.start();

    expect(chokidar.watch).toHaveBeenCalledWith(
      [fixtureDir],
      { depth: 0, ignoreInitial: true, persistent: true },
    );
    expect(poll).toHaveBeenCalledTimes(1);

    emitHistoryEvent('change', join(fixtureDir, 'unrelated.db'));
    emitHistoryEvent('change', chromeFixturePath);
    await vi.advanceTimersByTimeAsync(500);
    emitHistoryEvent('change', `${chromeFixturePath}-wal`);
    await vi.advanceTimersByTimeAsync(1_499);
    expect(poll).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(2);
    await reader.stop();
  });

  it('keeps a slow fallback poll when no file event arrives', async () => {
    vi.useFakeTimers();
    const reader = new BrowserHistoryReader(
      {
        chromePath: chromeFixturePath,
        safariPath: safariFixturePath,
        debounceMs: 1_500,
        pollIntervalMs: 120_000,
      },
      repo,
      appDb,
    );
    const poll = vi.spyOn(reader, 'poll').mockResolvedValue(0);

    reader.start();
    await vi.advanceTimersByTimeAsync(119_999);
    expect(poll).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(2);
    await reader.stop();
  });

  it('closes the file watcher and cancels pending and fallback polls on stop', async () => {
    vi.useFakeTimers();
    const reader = new BrowserHistoryReader(
      {
        chromePath: chromeFixturePath,
        safariPath: safariFixturePath,
        debounceMs: 1_500,
        pollIntervalMs: 120_000,
      },
      repo,
      appDb,
    );
    const poll = vi.spyOn(reader, 'poll').mockResolvedValue(0);

    reader.start();
    emitHistoryEvent('change', `${safariFixturePath}-wal`);
    await reader.stop();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(historyWatcher.close).toHaveBeenCalledOnce();
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('creates SourceItems from Chrome history fixture', async () => {
    const reader = new BrowserHistoryReader(
      { chromePath: chromeFixturePath, safariPath: '/nonexistent/safari', initialLookbackHours: 100_000 },
      repo,
      appDb,
    );

    const count = await reader.poll();
    expect(count).toBe(3);

    const items = repo.listUnprocessed();
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.type === 'browser_history')).toBe(true);

    const urls = items.map((i) => i.url).sort();
    expect(urls).toEqual([
      'https://example.com/page1',
      'https://example.com/page2',
      'https://github.com/test',
    ]);

    const titles = items.map((i) => i.raw_text).sort();
    expect(titles).toEqual(['Example Page 1', 'Example Page 2', 'GitHub Test Repo']);

    await reader.stop();
  });

  it('creates SourceItems from Safari history fixture', async () => {
    const reader = new BrowserHistoryReader(
      { chromePath: '/nonexistent/chrome', safariPath: safariFixturePath, initialLookbackHours: 100_000 },
      repo,
      appDb,
    );

    const count = await reader.poll();
    expect(count).toBe(2);

    const items = repo.listUnprocessed();
    expect(items).toHaveLength(2);

    const urls = items.map((i) => i.url).sort();
    expect(urls).toEqual(['https://apple.com', 'https://developer.apple.com']);

    await reader.stop();
  });

  it('deduplicates — same URL not re-ingested via duplicate check', async () => {
    // Pre-insert a source item for a URL that also exists in the Chrome fixture
    repo.create({
      type: 'browser_history',
      raw_text: 'Example Page 1',
      extracted_entities: null,
      url: 'https://example.com/page1',
      captured_at: new Date('2024-06-15T10:30:00Z').toISOString(),
      thread_id: null,
    });

    const reader = new BrowserHistoryReader(
      { chromePath: chromeFixturePath, safariPath: '/nonexistent/safari', initialLookbackHours: 100_000 },
      repo,
      appDb,
    );

    const count = await reader.poll();

    // 3 URLs in fixture, but page1 already exists with same timestamp → deduplicated
    expect(count).toBe(2);

    const items = repo.listUnprocessed();
    const page1Items = items.filter((i) => i.url === 'https://example.com/page1');
    expect(page1Items).toHaveLength(1); // only the pre-inserted one

    await reader.stop();
  });

  it('handles missing history files gracefully (returns 0)', async () => {
    const reader = new BrowserHistoryReader(
      {
        chromePath: '/nonexistent/chrome/History',
        safariPath: '/nonexistent/safari/History.db',
      },
      repo,
      appDb,
    );

    const count = await reader.poll();
    expect(count).toBe(0);
    expect(repo.listUnprocessed()).toHaveLength(0);

    await reader.stop();
  });

  it('updates last-poll timestamp after successful poll', async () => {
    const metadata = new MetadataRepository(appDb);
    expect(metadata.get('chrome_last_poll')).toBeNull();
    expect(metadata.get('safari_last_poll')).toBeNull();

    const reader = new BrowserHistoryReader(
      { chromePath: chromeFixturePath, safariPath: safariFixturePath, initialLookbackHours: 100_000 },
      repo,
      appDb,
    );

    await reader.poll();

    const chromeTs = metadata.get('chrome_last_poll');
    expect(chromeTs).not.toBeNull();
    const chromeDate = new Date(chromeTs!);
    expect(chromeDate.toISOString()).toBe('2024-06-15T12:00:00.000Z');

    const safariTs = metadata.get('safari_last_poll');
    expect(safariTs).not.toBeNull();
    const safariDate = new Date(safariTs!);
    expect(safariDate.toISOString()).toBe('2024-06-15T11:00:00.000Z');

    await reader.stop();
  });

  it('establishes a first-run baseline without importing existing browser history', async () => {
    const metadata = new MetadataRepository(appDb);
    const reader = new BrowserHistoryReader(
      { chromePath: chromeFixturePath, safariPath: safariFixturePath, initialLookbackHours: 0 },
      repo,
      appDb,
    );

    const count = await reader.poll();

    expect(count).toBe(0);
    expect(repo.listUnprocessed()).toHaveLength(0);
    expect(metadata.get('chrome_last_poll')).not.toBeNull();
    expect(metadata.get('safari_last_poll')).not.toBeNull();
    await reader.stop();
  });

  it('imports only browser visits newer than the established baseline', async () => {
    const metadata = new MetadataRepository(appDb);
    metadata.set('chrome_last_poll', '2024-06-15T11:30:00.000Z');
    const reader = new BrowserHistoryReader(
      { chromePath: chromeFixturePath, safariPath: '/nonexistent/safari', initialLookbackHours: 0 },
      repo,
      appDb,
    );

    const count = await reader.poll();
    const items = repo.listUnprocessed();

    expect(count).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0].raw_text).toBe('GitHub Test Repo');
    expect(items[0].captured_at).toBe('2024-06-15T12:00:00.000Z');
    await reader.stop();
  });

  it('Chrome timestamp conversion is correct (microseconds since 1601)', () => {
    // 0 microseconds in Chrome epoch → 1601-01-01T00:00:00Z
    const epoch = chromeTimestampToDate(0);
    expect(epoch.getUTCFullYear()).toBe(1601);
    expect(epoch.getUTCMonth()).toBe(0);
    expect(epoch.getUTCDate()).toBe(1);
    expect(epoch.getUTCHours()).toBe(0);

    // Known date round-trip
    const knownDate = new Date('2024-01-01T00:00:00Z');
    const chromeTs = toChromeTimestamp(knownDate);
    const converted = chromeTimestampToDate(chromeTs);
    expect(Math.abs(converted.getTime() - knownDate.getTime())).toBeLessThan(1000);

    // Specific known Chrome timestamp for 2024-01-01T00:00:00Z
    // (1704067200 + 11644473600) * 1000000 = 13348540800000000
    const result = chromeTimestampToDate(13_348_540_800_000_000);
    expect(result.getUTCFullYear()).toBe(2024);
    expect(result.getUTCMonth()).toBe(0);
    expect(result.getUTCDate()).toBe(1);
  });

  it('Safari timestamp conversion is correct (seconds since 2001)', () => {
    // 0 seconds in Safari epoch → 2001-01-01T00:00:00Z
    const epoch = safariTimestampToDate(0);
    expect(epoch.getUTCFullYear()).toBe(2001);
    expect(epoch.getUTCMonth()).toBe(0);
    expect(epoch.getUTCDate()).toBe(1);

    // Known date round-trip
    const knownDate = new Date('2024-06-15T12:00:00Z');
    const safariTs = toSafariTimestamp(knownDate);
    const converted = safariTimestampToDate(safariTs);
    expect(Math.abs(converted.getTime() - knownDate.getTime())).toBeLessThan(1000);
  });
});

// ─── MetadataRepository Tests ────────────────────────────────────────────────

describe('MetadataRepository', () => {
  let db: ReturnType<typeof createInMemoryDatabase>;
  let metadata: MetadataRepository;

  beforeEach(() => {
    db = createInMemoryDatabase();
    metadata = new MetadataRepository(db);
  });

  it('returns null for non-existent key', () => {
    expect(metadata.get('nonexistent')).toBeNull();
  });

  it('stores and retrieves a value', () => {
    metadata.set('key1', 'value1');
    expect(metadata.get('key1')).toBe('value1');
  });

  it('overwrites an existing key', () => {
    metadata.set('key1', 'first');
    metadata.set('key1', 'second');
    expect(metadata.get('key1')).toBe('second');
  });
});

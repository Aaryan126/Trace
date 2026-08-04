import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { watch, type FSWatcher } from 'chokidar';
import type { SourceItem, SourceItemRepository } from '@trace/core';
import { MetadataRepository } from './metadata-repository.js';

// ─── Configuration ──────────────────────────────────────────────────────────

export interface BrowserHistoryConfig {
  pollIntervalMs: number;
  debounceMs: number;
  chromePath?: string;
  safariPath?: string;
  initialLookbackHours: number;
}

const DEFAULT_POLL_INTERVAL = 120_000;
const DEFAULT_DEBOUNCE_MS = 1_500;

function defaultChromePath(): string {
  return join(
    process.env.HOME ?? '~',
    'Library',
    'Application Support',
    'Google',
    'Chrome',
    'Default',
    'History',
  );
}

function defaultSafariPath(): string {
  return join(process.env.HOME ?? '~', 'Library', 'Safari', 'History.db');
}

// ─── Timestamp helpers ──────────────────────────────────────────────────────

const CHROME_EPOCH_OFFSET_SECONDS = 11_644_473_600; // seconds between 1601-01-01 and 1970-01-01
const SAFARI_EPOCH_OFFSET_SECONDS = 978_307_200; // seconds between 2001-01-01 and 1970-01-01

/** Chrome stores microseconds since 1601-01-01 */
export function chromeTimestampToDate(microseconds: number): Date {
  const seconds = microseconds / 1_000_000 - CHROME_EPOCH_OFFSET_SECONDS;
  return new Date(seconds * 1000);
}

/** Safari stores seconds since 2001-01-01 (Mac epoch) */
export function safariTimestampToDate(seconds: number): Date {
  return new Date((seconds + SAFARI_EPOCH_OFFSET_SECONDS) * 1000);
}

function dateToChromeTimestamp(date: Date): number {
  return (date.getTime() / 1000 + CHROME_EPOCH_OFFSET_SECONDS) * 1_000_000;
}

function dateToSafariTimestamp(date: Date): number {
  return date.getTime() / 1000 - SAFARI_EPOCH_OFFSET_SECONDS;
}

// ─── Interfaces ─────────────────────────────────────────────────────────────

interface ChromeHistoryRow {
  url: string;
  title: string;
  last_visit_time: number;
}

interface SafariHistoryRow {
  url: string;
  title: string;
  visit_time: number;
}

// ─── Reader ─────────────────────────────────────────────────────────────────

export class BrowserHistoryReader {
  private readonly pollIntervalMs: number;
  private readonly debounceMs: number;
  private readonly chromePath: string;
  private readonly safariPath: string;
  private readonly initialLookbackHours: number;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private watcher: FSWatcher | null = null;
  private pollTask: Promise<number> | null = null;
  private started = false;
  private readonly metadata: MetadataRepository;

  constructor(
    config: Partial<BrowserHistoryConfig>,
    private readonly sourceItemRepo: SourceItemRepository,
    db: Database.Database,
    private readonly onItemCreated?: (item: SourceItem) => void,
  ) {
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;
    this.debounceMs = config.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.chromePath = config.chromePath ?? defaultChromePath();
    this.safariPath = config.safariPath ?? defaultSafariPath();
    this.initialLookbackHours = config.initialLookbackHours ?? 24;
    this.metadata = new MetadataRepository(db);
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    this.watcher = watch(this.historyDirectories(), {
      depth: 0,
      ignoreInitial: true,
      persistent: true,
    });
    this.watcher.on('add', (path) => this.handleHistoryFile(path));
    this.watcher.on('change', (path) => this.handleHistoryFile(path));
    this.watcher.on('unlink', (path) => this.handleHistoryFile(path));
    this.watcher.on('error', (error) => {
      console.warn('[BrowserHistoryReader] History watcher failed:', error);
    });

    // Establish the baseline immediately, then keep a slow safety heartbeat in
    // case macOS misses an event while a browser replaces a SQLite file.
    void this.poll();
    this.intervalId = setInterval(() => void this.poll(), this.pollIntervalMs);
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    if (this.pollTask) await Promise.allSettled([this.pollTask]);
  }

  async poll(): Promise<number> {
    if (this.pollTask) return this.pollTask;

    const task = this.pollOnce();
    this.pollTask = task;
    try {
      return await task;
    } finally {
      if (this.pollTask === task) this.pollTask = null;
    }
  }

  private async pollOnce(): Promise<number> {
    let count = 0;
    count += await this.pollChrome();
    count += await this.pollSafari();
    return count;
  }

  private historyFiles(): string[] {
    return [this.chromePath, this.safariPath]
      .flatMap((path) => [path, `${path}-wal`, `${path}-shm`])
      .map((path) => resolve(path));
  }

  private historyDirectories(): string[] {
    return [...new Set(this.historyFiles().map((path) => dirname(path)))];
  }

  private handleHistoryFile(path: string): void {
    if (!this.historyFiles().includes(resolve(path))) return;
    this.schedulePoll();
  }

  private schedulePoll(): void {
    if (!this.started) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.started) void this.poll();
    }, this.debounceMs);
  }

  // ─── Chrome ───────────────────────────────────────────────────────────────

  private async pollChrome(): Promise<number> {
    if (!existsSync(this.chromePath)) return 0;

    const lastPollStr = this.metadata.get('chrome_last_poll');
    if (!lastPollStr && this.initialLookbackHours <= 0) {
      this.metadata.set('chrome_last_poll', new Date().toISOString());
      return 0;
    }
    const lastPoll = lastPollStr
      ? new Date(lastPollStr)
      : new Date(Date.now() - this.initialLookbackHours * 3_600_000);

    let snapshotDirectory: string | null = null;
    try {
      const snapshot = snapshotDatabase(this.chromePath, 'trace-chrome-history-');
      snapshotDirectory = snapshot.directory;
      const db = new Database(snapshot.path, { readonly: true, fileMustExist: true });

      try {
        const chromeTs = dateToChromeTimestamp(lastPoll);
        const rows = db
          .prepare(
            'SELECT url, title, last_visit_time FROM urls WHERE last_visit_time > ? ORDER BY last_visit_time',
          )
          .all(chromeTs) as ChromeHistoryRow[];

        let count = 0;
        for (const row of rows) {
          if (this.isDuplicate(row.url, chromeTimestampToDate(row.last_visit_time))) continue;

          const item = this.sourceItemRepo.create({
            type: 'browser_history',
            raw_text: row.title || null,
            extracted_entities: null,
            url: row.url,
            captured_at: chromeTimestampToDate(row.last_visit_time).toISOString(),
            thread_id: null,
          });
          this.onItemCreated?.(item);
          count++;
        }

        if (rows.length > 0) {
          this.metadata.set(
            'chrome_last_poll',
            chromeTimestampToDate(rows[rows.length - 1].last_visit_time).toISOString(),
          );
        }
        return count;
      } finally {
        db.close();
      }
    } catch (err) {
      console.warn('[BrowserHistoryReader] Chrome poll failed:', err);
      return 0;
    } finally {
      if (snapshotDirectory) rmSync(snapshotDirectory, { recursive: true, force: true });
    }
  }

  // ─── Safari ───────────────────────────────────────────────────────────────

  private async pollSafari(): Promise<number> {
    if (!existsSync(this.safariPath)) return 0;

    const lastPollStr = this.metadata.get('safari_last_poll');
    if (!lastPollStr && this.initialLookbackHours <= 0) {
      this.metadata.set('safari_last_poll', new Date().toISOString());
      return 0;
    }
    const lastPoll = lastPollStr
      ? new Date(lastPollStr)
      : new Date(Date.now() - this.initialLookbackHours * 3_600_000);

    let snapshotDirectory: string | null = null;
    try {
      const snapshot = snapshotDatabase(this.safariPath, 'trace-safari-history-');
      snapshotDirectory = snapshot.directory;
      const db = new Database(snapshot.path, { readonly: true, fileMustExist: true });

      try {
        const safariTs = dateToSafariTimestamp(lastPoll);
        const rows = db
          .prepare(
            `SELECT hi.url, hv.title, hv.visit_time
             FROM history_items hi
             JOIN history_visits hv ON hi.id = hv.history_item
             WHERE hv.visit_time > ?
             ORDER BY hv.visit_time`,
          )
          .all(safariTs) as SafariHistoryRow[];

        let count = 0;
        for (const row of rows) {
          const capturedAt = safariTimestampToDate(row.visit_time);
          if (this.isDuplicate(row.url, capturedAt)) continue;

          const item = this.sourceItemRepo.create({
            type: 'browser_history',
            raw_text: row.title || null,
            extracted_entities: null,
            url: row.url,
            captured_at: capturedAt.toISOString(),
            thread_id: null,
          });
          this.onItemCreated?.(item);
          count++;
        }

        if (rows.length > 0) {
          this.metadata.set(
            'safari_last_poll',
            safariTimestampToDate(rows[rows.length - 1].visit_time).toISOString(),
          );
        }
        return count;
      } finally {
        db.close();
      }
    } catch (err) {
      console.warn('[BrowserHistoryReader] Safari poll failed:', err);
      return 0;
    } finally {
      if (snapshotDirectory) rmSync(snapshotDirectory, { recursive: true, force: true });
    }
  }

  // ─── Deduplication ────────────────────────────────────────────────────────

  private isDuplicate(url: string, capturedAt: Date): boolean {
    const existing = this.sourceItemRepo.findByUrl(url);
    if (existing.length === 0) return false;

    const WINDOW_MS = 60_000; // 1-minute window
    return existing.some((item) => {
      const diff = Math.abs(new Date(item.captured_at).getTime() - capturedAt.getTime());
      return diff < WINDOW_MS;
    });
  }
}

function snapshotDatabase(sourcePath: string, prefix: string): { directory: string; path: string } {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  try {
    const destinationPath = join(directory, basename(sourcePath));
    copyFileSync(sourcePath, destinationPath);
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${sourcePath}${suffix}`;
      if (existsSync(sidecar)) copyFileSync(sidecar, `${destinationPath}${suffix}`);
    }
    return { directory, path: destinationPath };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

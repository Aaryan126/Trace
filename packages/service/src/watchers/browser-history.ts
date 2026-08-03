import { copyFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type { SourceItemRepository } from '@trace/core';
import { MetadataRepository } from './metadata-repository.js';

// ─── Configuration ──────────────────────────────────────────────────────────

export interface BrowserHistoryConfig {
  pollIntervalMs: number;
  chromePath?: string;
  safariPath?: string;
}

const DEFAULT_POLL_INTERVAL = 300_000; // 5 minutes

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
  private readonly chromePath: string;
  private readonly safariPath: string;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly metadata: MetadataRepository;

  constructor(
    config: Partial<BrowserHistoryConfig>,
    private readonly sourceItemRepo: SourceItemRepository,
    db: Database.Database,
  ) {
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;
    this.chromePath = config.chromePath ?? defaultChromePath();
    this.safariPath = config.safariPath ?? defaultSafariPath();
    this.metadata = new MetadataRepository(db);
  }

  start(): void {
    // Do an initial poll immediately, then on interval
    void this.poll();
    this.intervalId = setInterval(() => void this.poll(), this.pollIntervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async poll(): Promise<number> {
    let count = 0;
    count += this.pollChrome();
    count += this.pollSafari();
    return count;
  }

  // ─── Chrome ───────────────────────────────────────────────────────────────

  private pollChrome(): number {
    if (!existsSync(this.chromePath)) return 0;

    const lastPollStr = this.metadata.get('chrome_last_poll');
    const lastPoll = lastPollStr
      ? new Date(lastPollStr)
      : new Date(0);

    const tmpPath = join(tmpdir(), `chrome-history-${randomUUID()}.db`);

    try {
      copyFileSync(this.chromePath, tmpPath);
      const db = new Database(tmpPath, { readonly: true, fileMustExist: true });

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

          this.sourceItemRepo.create({
            type: 'browser_history',
            raw_text: row.title || null,
            extracted_entities: null,
            url: row.url,
            captured_at: chromeTimestampToDate(row.last_visit_time).toISOString(),
            thread_id: null,
          });
          count++;
        }

        this.metadata.set('chrome_last_poll', new Date().toISOString());
        return count;
      } finally {
        db.close();
      }
    } catch (err) {
      console.warn('[BrowserHistoryReader] Chrome poll failed:', err);
      return 0;
    } finally {
      try {
        unlinkSync(tmpPath);
      } catch {
        // temp file may not exist if copy failed
      }
    }
  }

  // ─── Safari ───────────────────────────────────────────────────────────────

  private pollSafari(): number {
    if (!existsSync(this.safariPath)) return 0;

    const lastPollStr = this.metadata.get('safari_last_poll');
    const lastPoll = lastPollStr
      ? new Date(lastPollStr)
      : new Date(0);

    const tmpPath = join(tmpdir(), `safari-history-${randomUUID()}.db`);

    try {
      copyFileSync(this.safariPath, tmpPath);
      const db = new Database(tmpPath, { readonly: true, fileMustExist: true });

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

          this.sourceItemRepo.create({
            type: 'browser_history',
            raw_text: row.title || null,
            extracted_entities: null,
            url: row.url,
            captured_at: capturedAt.toISOString(),
            thread_id: null,
          });
          count++;
        }

        this.metadata.set('safari_last_poll', new Date().toISOString());
        return count;
      } finally {
        db.close();
      }
    } catch (err) {
      console.warn('[BrowserHistoryReader] Safari poll failed:', err);
      return 0;
    } finally {
      try {
        unlinkSync(tmpPath);
      } catch {
        // temp file may not exist if copy failed
      }
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

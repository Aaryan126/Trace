import { watch, type FSWatcher } from 'chokidar';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { homedir } from 'node:os';
import type { TraceAI, SourceItem, SourceItemRepository } from '@trace/core';

// ─── Configuration ──────────────────────────────────────────────────────────

export interface ScreenshotWatcherConfig {
  watchDir: string;
  extensions: string[];
  debounceMs: number;
}

const DEFAULT_CONFIG: ScreenshotWatcherConfig = {
  watchDir: `${homedir()}/Desktop`,
  extensions: ['.png', '.jpg', '.jpeg'],
  debounceMs: 1000,
};

// ─── Watcher ────────────────────────────────────────────────────────────────

export class ScreenshotWatcher {
  private readonly config: ScreenshotWatcherConfig;
  private watcher: FSWatcher | null = null;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private inFlight = new Set<Promise<void>>();
  private seenFiles = new Set<string>();
  private stopped = false;

  constructor(
    config: Partial<ScreenshotWatcherConfig>,
    private readonly ai: TraceAI,
    private readonly sourceItemRepo: SourceItemRepository,
    private readonly onItemCreated?: (item: SourceItem) => void,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  start(): void {
    this.stopped = false;
    this.watcher = watch(this.config.watchDir, {
      depth: 0,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: this.config.debounceMs,
        pollInterval: 100,
      },
    });

    this.watcher.on('add', (path: string) => this.handleFile(path));
    this.watcher.on('change', (path: string) => this.handleFile(path));
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    await Promise.allSettled([...this.inFlight]);
  }

  private handleFile(filePath: string): void {
    const ext = extname(filePath).toLowerCase();
    if (!this.config.extensions.includes(ext)) return;
    if (this.seenFiles.has(filePath)) return;

    // Clear any existing debounce timer for this file
    const existing = this.timers.get(filePath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.timers.delete(filePath);
      if (!this.stopped) {
        const task = this.processFile(filePath);
        this.inFlight.add(task);
        void task.finally(() => this.inFlight.delete(task));
      }
    }, this.config.debounceMs);

    this.timers.set(filePath, timer);
  }

  private async processFile(filePath: string): Promise<void> {
    try {
      const buffer = await readFile(filePath);
      if (this.stopped) return;

      const extraction = await this.ai.extractFromScreenshot(buffer, mimeTypeForExtension(extname(filePath)));
      if (this.stopped) return;

      const item = this.sourceItemRepo.create({
        type: 'screenshot',
        raw_text: extraction.text,
        extracted_entities: { entities: extraction.entities, appSource: extraction.appSource },
        url: extraction.url,
        captured_at: new Date().toISOString(),
        thread_id: null,
      });
      this.onItemCreated?.(item);
      this.seenFiles.add(filePath);
    } catch (err) {
      console.error(`[ScreenshotWatcher] Failed to process ${filePath}:`, err);
    }
  }
}

function mimeTypeForExtension(extension: string): string {
  switch (extension.toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    default:
      return 'image/png';
  }
}

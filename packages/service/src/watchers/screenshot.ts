import { watch, type FSWatcher } from 'chokidar';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { homedir } from 'node:os';
import type { BrainchAI, SourceItemRepository } from '@brainch/core';

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
  private stopped = false;

  constructor(
    config: Partial<ScreenshotWatcherConfig>,
    private readonly ai: BrainchAI,
    private readonly sourceItemRepo: SourceItemRepository,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  start(): void {
    this.stopped = false;
    this.watcher = watch(this.config.watchDir, {
      depth: 0,
      ignoreInitial: true,
      awaitWriteFinish: false,
    });

    this.watcher.on('add', (path: string) => this.handleFile(path));
    this.watcher.on('change', (path: string) => this.handleFile(path));
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    if (this.watcher) {
      void this.watcher.close();
      this.watcher = null;
    }
  }

  private handleFile(filePath: string): void {
    const ext = extname(filePath).toLowerCase();
    if (!this.config.extensions.includes(ext)) return;

    // Clear any existing debounce timer for this file
    const existing = this.timers.get(filePath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.timers.delete(filePath);
      if (!this.stopped) {
        void this.processFile(filePath);
      }
    }, this.config.debounceMs);

    this.timers.set(filePath, timer);
  }

  private async processFile(filePath: string): Promise<void> {
    try {
      const buffer = await readFile(filePath);
      if (this.stopped) return;

      const extraction = await this.ai.extractFromScreenshot(buffer);
      if (this.stopped) return;

      this.sourceItemRepo.create({
        type: 'screenshot',
        raw_text: extraction.text,
        extracted_entities: { entities: extraction.entities, appSource: extraction.appSource },
        url: extraction.url,
        captured_at: new Date().toISOString(),
        thread_id: null,
      });
    } catch (err) {
      console.error(`[ScreenshotWatcher] Failed to process ${filePath}:`, err);
    }
  }
}
